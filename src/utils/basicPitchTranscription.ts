import type { NoteEventTime } from '@spotify/basic-pitch';
import type { StemNote } from '../types/sequencer.ts';
import { clampMidi } from './stemBuilderLogic.ts';

export const BASIC_PITCH_MODEL_URL = '/basic-pitch-model/model.json';
export const BASIC_PITCH_SAMPLE_RATE = 22050;
export const BASIC_PITCH_FFT_HOP = 256;
export const BASIC_PITCH_ANNOTATIONS_FPS = Math.floor(
  BASIC_PITCH_SAMPLE_RATE / BASIC_PITCH_FFT_HOP
); // 86 frames/sec (~11.6ms per frame)
export const BASIC_PITCH_CONTOURS_BINS_PER_SEMITONE = 3;

export const BASIC_PITCH_HIGH_SENSITIVITY_CONFIG = {
  onset_threshold: 0.2,
  frame_threshold: 0.2,
  minimum_note_length: 30, // milliseconds -> ~3 frames at 86 fps
  multiple_pitch_bends: true,
} as const;

export interface VocalTranscriptionOptions {
  stepDurationSec: number;
  stepCount: number;
  allowExtendedTimeline?: boolean;
  polyphonic?: boolean;
  onsetThreshold?: number;
  frameThreshold?: number;
  minimumNoteLengthMs?: number;
  multiplePitchBends?: boolean;
  onProgress?: (progress: number) => void;
}

export interface ExtractedPolyphonicNote extends StemNote {
  startTimeSeconds: number;
  durationSeconds: number;
  amplitude: number;
}

/**
 * Pre-processes microphone vocal PCM with:
 * 1) DC-offset removal + vocal noise filter (75 Hz high-pass rumble removal & 4.2 kHz hiss low-pass)
 * 2) Smooth soft-knee envelope compressor + upward makeup boost so quiet humming is boosted
 *    without hard-gating or cutting off soft vocal tails, plus a tanh safety ceiling.
 */
export function preprocessVocalPcm(
  samples: Float32Array,
  sampleRate: number
): Float32Array {
  const n = samples.length;
  if (n === 0) return new Float32Array(0);

  // 1. Remove DC offset
  let mean = 0;
  for (let i = 0; i < n; i++) {
    mean += samples[i];
  }
  mean /= n;

  // 2. Gentle noise filter: 75 Hz 1-pole HP + 4200 Hz 1-pole LP (keeps vocal harmonics intact)
  const sr = Math.max(8000, sampleRate);
  const hpAlpha = Math.exp((-2 * Math.PI * 75) / sr);
  const lpAlpha = Math.exp((-2 * Math.PI * Math.min(4200, sr * 0.42)) / sr);

  const filtered = new Float32Array(n);
  let hpState = 0;
  let prevIn = 0;
  let lpState = 0;
  for (let i = 0; i < n; i++) {
    const x = samples[i] - mean;
    hpState = hpAlpha * (hpState + x - prevIn);
    prevIn = x;
    lpState = lpAlpha * lpState + (1 - lpAlpha) * hpState;
    filtered[i] = lpState;
  }

  // 3. Smooth RMS envelope follower + upward/downward compressor + gentle soft noise-floor taper
  const envAttack = Math.exp(-1 / (sr * 0.008)); // 8ms fast attack catches quick hums
  const envRelease = Math.exp(-1 / (sr * 0.14)); // 140ms smooth release preserves quiet tails
  const noiseFloor = 0.0024;
  const targetLevel = 0.24;
  const maxBoostGain = 14;

  const out = new Float32Array(n);
  let envSq = 0;
  let smoothedGain = 1;
  const gainSmooth = Math.exp(-1 / (sr * 0.012));

  for (let i = 0; i < n; i++) {
    const s = filtered[i];
    const sq = s * s;
    const coeff = sq > envSq ? envAttack : envRelease;
    envSq = coeff * envSq + (1 - coeff) * sq;
    const env = Math.sqrt(Math.max(0, envSq));

    let desiredGain = 1;
    if (env < noiseFloor) {
      // Soft quadratic taper below room-noise floor (never abrupt hard cutoff clicks)
      const ratio = env / noiseFloor;
      desiredGain = 0.08 + 0.92 * ratio * ratio;
    } else if (env < targetLevel) {
      // Upward compression boost for quiet humming
      desiredGain = Math.min(maxBoostGain, targetLevel / Math.max(noiseFloor, env));
    } else {
      // Gentle downward compression above target level (4:1 soft knee)
      const compressed = targetLevel + (env - targetLevel) * 0.25;
      desiredGain = compressed / env;
    }

    smoothedGain = gainSmooth * smoothedGain + (1 - gainSmooth) * desiredGain;
    // Soft-tanh ceiling at 0.94 prevents digital clipping/cracking on sudden loud peaks
    out[i] = Math.tanh(s * smoothedGain * 1.05) * 0.94;
  }

  return out;
}

/**
 * Anti-aliased mono resampler converting live context audio (44.1/48 kHz) to
 * Spotify Basic Pitch's required 22,050 Hz mono sample rate.
 */
export function resampleMonoAudio(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = BASIC_PITCH_SAMPLE_RATE
): Float32Array {
  if (samples.length === 0) return new Float32Array(0);
  if (sourceSampleRate === targetSampleRate) return new Float32Array(samples);

  const ratio = sourceSampleRate / targetSampleRate;
  const targetLen = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(targetLen);

  // Light pre-filter when downsampling to avoid aliasing
  let src = samples;
  if (ratio > 1.05) {
    const cutoff = targetSampleRate * 0.44;
    const alpha = Math.exp((-2 * Math.PI * cutoff) / sourceSampleRate);
    const lp = new Float32Array(samples.length);
    let y = samples[0];
    for (let i = 0; i < samples.length; i++) {
      y = alpha * y + (1 - alpha) * samples[i];
      lp[i] = y;
    }
    src = lp;
  }

  for (let i = 0; i < targetLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = src[Math.min(src.length - 1, idx)];
    const b = src[Math.min(src.length - 1, idx + 1)];
    out[i] = a + (b - a) * frac;
  }

  return out;
}

/**
 * Converts Basic Pitch contour bin offsets (1/3 semitone per bin) into a
 * smoothed continuous semitone pitch-bend curve free of single-frame glitches.
 */
export function smoothPitchBendBins(
  pitchBends: number[] | undefined,
  maxBendSemitones = 3.5,
  maxPoints = 48
): number[] | undefined {
  if (!pitchBends || pitchBends.length < 2) return undefined;

  const rawSemis = pitchBends.map((bin) => {
    const semi = bin / BASIC_PITCH_CONTOURS_BINS_PER_SEMITONE;
    return Math.max(-maxBendSemitones, Math.min(maxBendSemitones, semi));
  });

  // 1. 3-point median despiking removes isolated 1-frame octave/contour glitches
  const despiked = rawSemis.map((v, idx) => {
    if (idx === 0 || idx === rawSemis.length - 1) return v;
    const trio = [rawSemis[idx - 1], v, rawSemis[idx + 1]].sort((a, b) => a - b);
    return trio[1];
  });

  // 2. 5-point Gaussian smoothing removes stepped 1/3-semitone quantization chatter
  const kernel = [0.1, 0.2, 0.4, 0.2, 0.1];
  const smoothed = despiked.map((_, idx) => {
    let sum = 0;
    for (let k = -2; k <= 2; k++) {
      const clampedIdx = Math.max(0, Math.min(despiked.length - 1, idx + k));
      sum += despiked[clampedIdx] * kernel[k + 2];
    }
    return Math.round(sum * 1000) / 1000;
  });

  // Ignore trivial flat curves (< 4 cents total variation)
  let maxAbs = 0;
  for (let i = 0; i < smoothed.length; i++) {
    const a = Math.abs(smoothed[i]);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs < 0.04) return undefined;

  if (smoothed.length <= maxPoints) {
    return smoothed;
  }

  const decimated: number[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const pos = (i / (maxPoints - 1)) * (smoothed.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(smoothed.length - 1, lo + 1);
    const frac = pos - lo;
    const val = smoothed[lo] + (smoothed[hi] - smoothed[lo]) * frac;
    decimated.push(Math.round(val * 1000) / 1000);
  }
  return decimated;
}

/**
 * Extracts a smooth normalized expression/velocity envelope [0.18..1.0] and an
 * expressive overall note velocity [28..100] from vocal PCM + Basic Pitch amplitude.
 */
export function extractVelocityCurveFromPcm(
  samples: Float32Array | undefined,
  sampleRate: number | undefined,
  startSec: number,
  durationSec: number,
  baseAmplitude: number,
  maxPoints = 20
): { velocity: number; velocityCurve?: number[] } {
  const safeAmp = Math.max(0, Math.min(1, Number.isFinite(baseAmplitude) ? baseAmplitude : 0.65));

  if (!samples || !sampleRate || samples.length === 0 || durationSec <= 0.02) {
    return {
      velocity: Math.max(32, Math.min(100, Math.round(36 + safeAmp * 64))),
    };
  }

  const startIdx = Math.max(0, Math.floor(startSec * sampleRate));
  const endIdx = Math.min(
    samples.length,
    Math.max(startIdx + 1, Math.floor((startSec + durationSec) * sampleRate))
  );
  const totalSamples = endIdx - startIdx;
  if (totalSamples < 16) {
    return {
      velocity: Math.max(32, Math.min(100, Math.round(36 + safeAmp * 64))),
    };
  }

  const points = Math.max(4, Math.min(maxPoints, Math.round(durationSec * 40)));
  const sliceLen = Math.max(1, Math.floor(totalSamples / points));
  const rmsPoints: number[] = [];
  let notePeakRms = 0;
  let noteAvgRms = 0;

  for (let p = 0; p < points; p++) {
    const s = startIdx + p * sliceLen;
    const e = p === points - 1 ? endIdx : Math.min(endIdx, s + sliceLen);
    let sumSq = 0;
    for (let i = s; i < e; i++) {
      const v = samples[i];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, e - s));
    rmsPoints.push(rms);
    if (rms > notePeakRms) notePeakRms = rms;
    noteAvgRms += rms;
  }
  noteAvgRms /= points;

  // Blend neural frame amplitude with actual compressed vocal RMS for dynamic range
  const pcmEnergyNorm = Math.min(1, noteAvgRms / 0.34);
  const blended = 0.45 * safeAmp + 0.55 * pcmEnergyNorm;
  const velocity = Math.max(28, Math.min(100, Math.round(30 + blended * 70)));

  if (notePeakRms <= 1e-4) {
    return { velocity };
  }

  const normalized = rmsPoints.map((r) => Math.max(0.18, Math.min(1.0, r / notePeakRms)));
  const smoothed = normalized.map((v, i) => {
    const prev = normalized[Math.max(0, i - 1)];
    const next = normalized[Math.min(normalized.length - 1, i + 1)];
    return Math.round(((prev + 2 * v + next) / 4) * 1000) / 1000;
  });

  return { velocity, velocityCurve: smoothed };
}

/**
 * Converts Spotify Basic Pitch `NoteEventTime[]` output into expressive `StemNote[]`
 * with sub-step timing, fast-note preservation, smoothed pitch bends, and velocity curves.
 */
export function convertBasicPitchNotesToStemNotes(
  timedNotes: NoteEventTime[],
  stepDurationSec: number,
  stepCount: number,
  vocalPcm?: Float32Array,
  sampleRate?: number,
  allowExtendedTimeline = false
): StemNote[] {
  if (!Array.isArray(timedNotes) || timedNotes.length === 0) return [];
  const safeStepDur = Math.max(0.03, stepDurationSec);
  const safeStepCount = allowExtendedTimeline
    ? Math.max(16, Math.min(2048, Math.round(stepCount)))
    : Math.max(1, Math.min(64, Math.round(stepCount)));

  const valid = [...timedNotes]
    .filter(
      (n) =>
        Number.isFinite(n.startTimeSeconds) &&
        Number.isFinite(n.durationSeconds) &&
        n.durationSeconds >= 0.022 &&
        Number.isFinite(n.pitchMidi)
    )
    .sort((a, b) => a.pitchMidi - b.pitchMidi || a.startTimeSeconds - b.startTimeSeconds);

  // 1. Merge tiny split fragments of the exact same pitch (<42ms gap) so vibrato/breath doesn't stutter
  const mergedSamePitch: NoteEventTime[] = [];
  for (const curr of valid) {
    const prev = mergedSamePitch[mergedSamePitch.length - 1];
    if (
      prev &&
      Math.round(prev.pitchMidi) === Math.round(curr.pitchMidi) &&
      curr.startTimeSeconds - (prev.startTimeSeconds + prev.durationSeconds) < 0.042
    ) {
      const mergedEnd = Math.max(
        prev.startTimeSeconds + prev.durationSeconds,
        curr.startTimeSeconds + curr.durationSeconds
      );
      prev.durationSeconds = mergedEnd - prev.startTimeSeconds;
      prev.amplitude = Math.max(prev.amplitude, curr.amplitude);
      if (curr.pitchBends && curr.pitchBends.length > 0) {
        prev.pitchBends = [...(prev.pitchBends ?? []), ...curr.pitchBends];
      }
    } else {
      mergedSamePitch.push({ ...curr });
    }
  }

  // 2. Keep the single true vocal fundamental at any instant (suppress polyphonic harmonic stacks
  // such as +12/+19/+24 overtones and overlapping transient glitches that sound scattered/heavy)
  const prioritized = [...mergedSamePitch].sort((a, b) => {
    const scoreA = a.amplitude * Math.min(0.65, a.durationSeconds + 0.12);
    const scoreB = b.amplitude * Math.min(0.65, b.durationSeconds + 0.12);
    return scoreB - scoreA;
  });

  const keptVocalNotes: NoteEventTime[] = [];
  for (const cand of prioritized) {
    const candStart = cand.startTimeSeconds;
    const candEnd = candStart + cand.durationSeconds;

    let overlapsExisting = false;
    for (let i = 0; i < keptVocalNotes.length; i++) {
      const kept = keptVocalNotes[i];
      const keptStart = kept.startTimeSeconds;
      const keptEnd = keptStart + kept.durationSeconds;
      const overlap = Math.max(0, Math.min(candEnd, keptEnd) - Math.max(candStart, keptStart));
      const minDur = Math.min(cand.durationSeconds, kept.durationSeconds);

      const isSimultaneous =
        overlap > minDur * 0.42 || Math.abs(candStart - keptStart) < 0.045;

      if (isSimultaneous) {
        // If cand is an octave/12th fundamental BELOW a kept overtone with solid strength, prefer fundamental
        const interval = Math.round(kept.pitchMidi) - Math.round(cand.pitchMidi);
        const isLowerFundamental =
          (interval === 12 || interval === 19 || interval === 24) &&
          cand.amplitude >= kept.amplitude * 0.55 &&
          cand.durationSeconds >= kept.durationSeconds * 0.65;
        if (isLowerFundamental) {
          keptVocalNotes[i] = cand;
        }
        overlapsExisting = true;
        break;
      }
    }

    if (!overlapsExisting) {
      keptVocalNotes.push(cand);
    }
  }

  const cleaned = keptVocalNotes.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

  const out: StemNote[] = [];
  const seenKeys = new Set<string>();

  for (const n of cleaned) {
    const rawStep = n.startTimeSeconds / safeStepDur;
    const roundedStep = Math.round(rawStep);
    const wrappedStep = allowExtendedTimeline
      ? Math.max(0, Math.min(2047, roundedStep))
      : ((roundedStep % safeStepCount) + safeStepCount) % safeStepCount;
    const startOffsetSteps = Math.max(
      -0.48,
      Math.min(0.48, Math.round((rawStep - roundedStep) * 1000) / 1000)
    );

    const exactDurationSteps = Math.max(
      0.22,
      Math.min(16, Math.round((n.durationSeconds / safeStepDur) * 1000) / 1000)
    );
    const durationSteps = Math.max(1, Math.min(16, Math.round(exactDurationSteps)));
    const midi = clampMidi(n.pitchMidi);

    const dedupeKey = `${wrappedStep}:${midi}`;
    if (seenKeys.has(dedupeKey)) {
      // Keep the next step slot if two rapid re-articulations fall inside the same quantized step
      const altStep = allowExtendedTimeline
        ? Math.min(2047, wrappedStep + 1)
        : (wrappedStep + 1) % safeStepCount;
      const altKey = `${altStep}:${midi}`;
      if (seenKeys.has(altKey)) continue;
      seenKeys.add(altKey);

      const { velocity, velocityCurve } = extractVelocityCurveFromPcm(
        vocalPcm,
        sampleRate,
        n.startTimeSeconds,
        n.durationSeconds,
        n.amplitude
      );
      out.push({
        step: altStep,
        midi,
        durationSteps,
        velocity,
        startOffsetSteps: -0.35,
        exactDurationSteps,
        pitchBendSemitones: smoothPitchBendBins(n.pitchBends),
        velocityCurve,
      });
      continue;
    }

    seenKeys.add(dedupeKey);
    const { velocity, velocityCurve } = extractVelocityCurveFromPcm(
      vocalPcm,
      sampleRate,
      n.startTimeSeconds,
      n.durationSeconds,
      n.amplitude
    );

    out.push({
      step: wrappedStep,
      midi,
      durationSteps,
      velocity,
      startOffsetSteps,
      exactDurationSteps,
      pitchBendSemitones: smoothPitchBendBins(n.pitchBends),
      velocityCurve,
    });
  }

  return out.sort((a, b) => a.step - b.step || b.midi - a.midi);
}

let cachedSoftwareWebGl: boolean | null = null;

export function isSoftwareWebGlEnvironment(): boolean {
  if (cachedSoftwareWebGl !== null) return cachedSoftwareWebGl;
  try {
    let gl: WebGLRenderingContext | null = null;
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      gl =
        (canvas.getContext('webgl2') as WebGLRenderingContext | null) ||
        (canvas.getContext('webgl') as WebGLRenderingContext | null);
    } else if (typeof OffscreenCanvas !== 'undefined') {
      const oc = new OffscreenCanvas(1, 1);
      gl =
        (oc.getContext('webgl2') as WebGLRenderingContext | null) ||
        (oc.getContext('webgl') as WebGLRenderingContext | null);
    }
    if (!gl) {
      cachedSoftwareWebGl = true;
      return true;
    }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '') : '';
    cachedSoftwareWebGl = /swiftshader|llvmpipe|software|basic render driver|mesa offscreen/i.test(
      renderer
    );
    return cachedSoftwareWebGl;
  } catch {
    cachedSoftwareWebGl = true;
    return true;
  }
}

let basicPitchInstancePromise: Promise<{
  tf: typeof import('@tensorflow/tfjs');
  bpModule: typeof import('@spotify/basic-pitch');
  model: InstanceType<(typeof import('@spotify/basic-pitch'))['BasicPitch']>;
}> | null = null;

async function getBasicPitchInstance() {
  if (!basicPitchInstancePromise) {
    basicPitchInstancePromise = (async () => {
      if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
        (globalThis as { window: typeof globalThis }).window = globalThis;
      }
      const [tf, bpModule] = await Promise.all([
        import('@tensorflow/tfjs'),
        import('@spotify/basic-pitch'),
      ]);
      const preferCpu = isSoftwareWebGlEnvironment();
      if (preferCpu) {
        await tf.setBackend('cpu');
        await tf.ready();
      } else {
        try {
          await tf.ready();
        } catch {
          await tf.setBackend('cpu');
          await tf.ready();
        }
      }
      const model = new bpModule.BasicPitch(BASIC_PITCH_MODEL_URL);
      await model.model;
      return { tf, bpModule, model };
    })().catch((err) => {
      basicPitchInstancePromise = null;
      throw err;
    });
  }
  return basicPitchInstancePromise;
}

async function evaluateModelWithFallback(
  audio: Float32Array,
  onResult: (frames: number[][], onsets: number[][], contours: number[][]) => void,
  onProgress: (pct: number) => void
) {
  const instance = await getBasicPitchInstance();
  try {
    await instance.model.evaluateModel(audio, onResult, onProgress);
    return instance.bpModule;
  } catch (err) {
    if (instance.tf.getBackend() !== 'cpu') {
      await instance.tf.setBackend('cpu');
      await instance.tf.ready();
      await instance.model.evaluateModel(audio, onResult, onProgress);
      return instance.bpModule;
    }
    throw err;
  }
}

export async function preloadBasicPitchModel(): Promise<void> {
  await getBasicPitchInstance();
}

export function findActiveVocalWindow(
  pcm: Float32Array,
  sampleRate: number,
  threshold = 0.0008,
  prePadSec = 0.15,
  postPadSec = 0.25
): { startIdx: number; endIdx: number } {
  const n = pcm.length;
  if (n === 0) return { startIdx: 0, endIdx: 0 };

  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (Math.abs(pcm[i]) > threshold) {
      if (first === -1) first = i;
      last = i;
    }
  }

  if (first === -1) {
    return { startIdx: 0, endIdx: n };
  }

  const preSamples = Math.round(prePadSec * sampleRate);
  const postSamples = Math.round(postPadSec * sampleRate);
  const startIdx = Math.max(0, first - preSamples);
  const endIdx = Math.min(n, last + 1 + postSamples);
  return { startIdx, endIdx };
}

/**
 * Full Spotify Basic Pitch high-sensitivity vocal-to-synth transcription pipeline:
 * 1. Pre-process vocal PCM (noise filter + upward/downward compressor)
 * 2. Resample to 22,050 Hz mono
 * 3. Run BasicPitch neural model
 * 4. Decode with onset_threshold=0.2, frame_threshold=0.2, minimum_note_length=30ms, multiple_pitch_bends=true
 * 5. Return expressive StemNote[] with continuous pitch bends & velocity curves
 */
export async function transcribeVocalAudioWithBasicPitch(
  pcm: Float32Array,
  sampleRate: number,
  options: VocalTranscriptionOptions
): Promise<StemNote[]> {
  if (pcm.length < 512) return [];

  const { startIdx, endIdx } = findActiveVocalWindow(pcm, sampleRate);
  const activeSlice =
    startIdx > 0 || endIdx < pcm.length ? pcm.subarray(startIdx, endIdx) : pcm;
  if (activeSlice.length < 512) return [];

  const trimOffsetSec = startIdx / Math.max(8000, sampleRate);
  const conditioned = preprocessVocalPcm(activeSlice, sampleRate);
  const resampled22k = resampleMonoAudio(conditioned, sampleRate, BASIC_PITCH_SAMPLE_RATE);
  if (resampled22k.length < 512) return [];

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  const bpModule = await evaluateModelWithFallback(
    resampled22k,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (pct) => {
      options.onProgress?.(pct);
    }
  );

  if (frames.length === 0 || onsets.length === 0) {
    return [];
  }

  const onsetThreshold =
    options.onsetThreshold ?? BASIC_PITCH_HIGH_SENSITIVITY_CONFIG.onset_threshold;
  const frameThreshold =
    options.frameThreshold ?? BASIC_PITCH_HIGH_SENSITIVITY_CONFIG.frame_threshold;
  const minNoteMs =
    options.minimumNoteLengthMs ?? BASIC_PITCH_HIGH_SENSITIVITY_CONFIG.minimum_note_length;
  const multiplePitchBends =
    options.multiplePitchBends ?? BASIC_PITCH_HIGH_SENSITIVITY_CONFIG.multiple_pitch_bends;

  // Convert milliseconds -> Basic Pitch frames (86 fps, where toMidi.js checks `durationFrames <= minNoteLen`)
  const minNoteLenFrames = Math.max(
    1,
    Math.round((minNoteMs / 1000) * BASIC_PITCH_ANNOTATIONS_FPS) - 1
  );

  const rawNotes = bpModule.outputToNotesPoly(
    frames,
    onsets,
    onsetThreshold,
    frameThreshold,
    minNoteLenFrames,
    true,
    1100,
    65,
    true,
    11
  );

  const notesWithBends = multiplePitchBends
    ? bpModule.addPitchBendsToNoteEvents(contours, rawNotes)
    : rawNotes;

  const rawTimedNotes = bpModule.noteFramesToTime(notesWithBends);
  const timedNotes = rawTimedNotes.map((n) => ({
    ...n,
    startTimeSeconds: n.startTimeSeconds + trimOffsetSec,
  }));

  // Align conditioned PCM slice to full loop timeline for velocity curve extraction
  let fullConditioned = conditioned;
  if (startIdx > 0 || endIdx < pcm.length) {
    fullConditioned = new Float32Array(pcm.length);
    fullConditioned.set(conditioned, startIdx);
  }

  return convertBasicPitchNotesToStemNotes(
    timedNotes,
    options.stepDurationSec,
    options.stepCount,
    fullConditioned,
    sampleRate,
    Boolean(options.allowExtendedTimeline)
  );
}

/**
 * Polyphonic harmonic/melodic stem extraction using @spotify/basic-pitch.
 * Preserves bass fundamentals (MIDI 28..49), mid-range chords, and high melodies
 * simultaneously across arbitrary song durations on quantized 16th-note grids.
 */
export function normalizeHarmonicStemPcm(samples: Float32Array): Float32Array {
  const n = samples.length;
  if (n === 0) return new Float32Array(0);
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / n);
  if (rms < 1e-5 && peak < 1e-5) return new Float32Array(n);

  const targetRmsGain = rms > 1e-5 ? Math.min(4.5, 0.22 / rms) : 1;
  const maxPeakSafe = peak > 1e-5 ? 0.92 / peak : 1;
  const gain = Math.min(targetRmsGain, maxPeakSafe);

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.max(-0.96, Math.min(0.96, samples[i] * gain));
  }
  return out;
}

export function convertPolyphonicBasicPitchNotes(
  timedNotes: NoteEventTime[],
  stepDurationSec: number,
  maxSteps = 4096
): ExtractedPolyphonicNote[] {
  if (!Array.isArray(timedNotes) || timedNotes.length === 0) return [];
  const safeStepDur = Math.max(0.03, stepDurationSec);
  const valid = [...timedNotes]
    .filter(
      (n) =>
        Number.isFinite(n.startTimeSeconds) &&
        Number.isFinite(n.durationSeconds) &&
        n.durationSeconds >= 0.04 &&
        Number.isFinite(n.pitchMidi) &&
        n.amplitude >= 0.14
    )
    .sort((a, b) => a.pitchMidi - b.pitchMidi || a.startTimeSeconds - b.startTimeSeconds);

  // Merge tiny same-pitch re-articulations (<38ms gap)
  const merged: NoteEventTime[] = [];
  for (const curr of valid) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      Math.round(prev.pitchMidi) === Math.round(curr.pitchMidi) &&
      curr.startTimeSeconds - (prev.startTimeSeconds + prev.durationSeconds) < 0.038
    ) {
      const end = Math.max(
        prev.startTimeSeconds + prev.durationSeconds,
        curr.startTimeSeconds + curr.durationSeconds
      );
      prev.durationSeconds = end - prev.startTimeSeconds;
      prev.amplitude = Math.max(prev.amplitude, curr.amplitude);
    } else {
      merged.push({ ...curr });
    }
  }

  const out: ExtractedPolyphonicNote[] = [];
  const seen = new Set<string>();
  for (const n of merged) {
    const rawStep = n.startTimeSeconds / safeStepDur;
    const step = Math.max(0, Math.min(maxSteps - 1, Math.round(rawStep)));
    const midi = Math.max(28, Math.min(96, Math.round(n.pitchMidi)));
    const key = `${step}:${midi}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const exactDur = Math.max(
      0.25,
      Math.min(32, Math.round((n.durationSeconds / safeStepDur) * 1000) / 1000)
    );
    const durationSteps = Math.max(1, Math.min(32, Math.round(exactDur)));
    const velocity = Math.max(28, Math.min(100, Math.round(28 + Math.min(1, n.amplitude) * 72)));

    out.push({
      step,
      midi,
      durationSteps,
      velocity,
      startOffsetSteps: Math.max(
        -0.45,
        Math.min(0.45, Math.round((rawStep - step) * 1000) / 1000)
      ),
      exactDurationSteps: exactDur,
      pitchBendSemitones: smoothPitchBendBins(n.pitchBends),
      startTimeSeconds: n.startTimeSeconds,
      durationSeconds: n.durationSeconds,
      amplitude: n.amplitude,
    });
  }

  return out.sort((a, b) => a.step - b.step || a.midi - b.midi);
}

export async function transcribePolyphonicStemWithBasicPitch(
  pcm: Float32Array,
  sampleRate: number,
  options: {
    stepDurationSec: number;
    stepCount: number;
    onsetThreshold?: number;
    frameThreshold?: number;
    minimumNoteLengthMs?: number;
    onProgress?: (progress: number) => void;
  }
): Promise<ExtractedPolyphonicNote[]> {
  if (pcm.length < 1024) return [];
  const normalized = normalizeHarmonicStemPcm(pcm);
  const resampled22k = resampleMonoAudio(normalized, sampleRate, BASIC_PITCH_SAMPLE_RATE);
  if (resampled22k.length < 1024) return [];

  // Process long songs in ~28s overlapping-safe bar-aligned chunks so TF.js memory stays bounded
  const CHUNK_SEC = 28;
  const chunkSamples = CHUNK_SEC * BASIC_PITCH_SAMPLE_RATE;
  const totalSamples = resampled22k.length;
  const allTimedNotes: NoteEventTime[] = [];
  let cachedBpModule: typeof import('@spotify/basic-pitch') | null = null;

  for (let offset = 0; offset < totalSamples; offset += chunkSamples) {
    const end = Math.min(totalSamples, offset + chunkSamples);
    const slice = resampled22k.subarray(offset, end);
    if (slice.length < 1024) continue;

    const frames: number[][] = [];
    const onsets: number[][] = [];
    const contours: number[][] = [];

    const chunkStartRatio = offset / totalSamples;
    const chunkSpanRatio = (end - offset) / totalSamples;

    const bpMod = await evaluateModelWithFallback(
      slice,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      (pct) => {
        options.onProgress?.(Math.min(1, chunkStartRatio + pct * chunkSpanRatio));
      }
    );
    cachedBpModule = bpMod;
    const bpModule = cachedBpModule;

    if (frames.length === 0 || onsets.length === 0) continue;

    const onsetThreshold = options.onsetThreshold ?? 0.34;
    const frameThreshold = options.frameThreshold ?? 0.28;
    const minNoteMs = options.minimumNoteLengthMs ?? 55;
    const minNoteLenFrames = Math.max(
      1,
      Math.round((minNoteMs / 1000) * BASIC_PITCH_ANNOTATIONS_FPS) - 1
    );

    const rawNotes = bpModule.outputToNotesPoly(
      frames,
      onsets,
      onsetThreshold,
      frameThreshold,
      minNoteLenFrames,
      true,
      1400,
      45,
      true,
      11
    );
    const timed = bpModule.noteFramesToTime(rawNotes);
    const offsetSec = offset / BASIC_PITCH_SAMPLE_RATE;
    for (const tn of timed) {
      allTimedNotes.push({
        ...tn,
        startTimeSeconds: tn.startTimeSeconds + offsetSec,
      });
    }
  }

  return convertPolyphonicBasicPitchNotes(
    allTimedNotes,
    options.stepDurationSec,
    Math.max(16, options.stepCount)
  );
}
