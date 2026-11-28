import type {
  KeyboardSoundId,
  ScaleType,
  StemChannel,
  StemLoopSource,
  StemNote,
} from '../types/sequencer.ts';

export interface KeyboardSoundPreset {
  id: KeyboardSoundId;
  label: string;
  shortLabel: string;
  role: string;
  defaultOctave: number;
}

export const KEYBOARD_SOUND_PRESETS: KeyboardSoundPreset[] = [
  {
    id: 'grand_piano',
    label: 'Stage Grand Piano',
    shortLabel: 'Grand Piano',
    role: 'Chords & Lead',
    defaultOctave: 4,
  },
  {
    id: 'rhodes_ep',
    label: 'Suitcase Rhodes EP',
    shortLabel: 'Rhodes EP',
    role: 'Warm Gospel Chords',
    defaultOctave: 4,
  },
  {
    id: 'gospel_organ',
    label: 'Gospel Organ B3',
    shortLabel: 'Organ B3',
    role: 'Sustain & Shout',
    defaultOctave: 4,
  },
  {
    id: 'synth_lead',
    label: 'Afro Synth Lead',
    shortLabel: 'Synth Lead',
    role: 'Solo & Melodies',
    defaultOctave: 4,
  },
  {
    id: 'synth_brass',
    label: 'Afro Synth Brass',
    shortLabel: 'Synth Brass',
    role: 'Praise Stabs',
    defaultOctave: 4,
  },
  {
    id: 'warm_pad',
    label: 'Warm Worship Pad',
    shortLabel: 'Warm Pad',
    role: 'Atmosphere',
    defaultOctave: 4,
  },
  {
    id: 'worship_bass',
    label: 'Fretless Worship Bass',
    shortLabel: 'Worship Bass',
    role: 'Low End',
    defaultOctave: 2,
  },
  {
    id: 'marimba_pluck',
    label: 'Afro Marimba Pluck',
    shortLabel: 'Marimba',
    role: 'Highlife Riff',
    defaultOctave: 4,
  },
  {
    id: 'choir_voice',
    label: 'Vocal Choir Voice',
    shortLabel: 'Choir Voice',
    role: 'Vocal Synth',
    defaultOctave: 4,
  },
];

export const MUSICAL_KEYS = [
  'C',
  'C#',
  'D',
  'Eb',
  'E',
  'F',
  'F#',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
] as const;

export type MusicalKey = (typeof MUSICAL_KEYS)[number];

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
};

export function clampMidi(midi: number): number {
  if (!Number.isFinite(midi)) return 60;
  return Math.min(84, Math.max(36, Math.round(midi)));
}

export function midiToNoteName(midi: number): string {
  const safe = clampMidi(midi);
  const name = NOTE_NAMES[((safe % 12) + 12) % 12];
  const octave = Math.floor(safe / 12) - 1;
  return `${name}${octave}`;
}

export function isBlackKeyMidi(midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(hz: number): number {
  if (!Number.isFinite(hz) || hz <= 0) return 60;
  return clampMidi(Math.round(69 + 12 * Math.log2(hz / 440)));
}

export function getScalePitchClasses(
  rootKey: MusicalKey,
  scaleType: ScaleType
): number[] {
  const rootPc = Math.max(0, MUSICAL_KEYS.indexOf(rootKey));
  return SCALE_INTERVALS[scaleType].map((interval) => (rootPc + interval) % 12);
}

export function isMidiInScale(
  midi: number,
  rootKey: MusicalKey,
  scaleType: ScaleType
): boolean {
  const pcs = getScalePitchClasses(rootKey, scaleType);
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return pcs.includes(pc);
}

export function snapMidiToScale(
  midi: number,
  rootKey: MusicalKey,
  scaleType: ScaleType
): number {
  const safe = clampMidi(midi);
  if (isMidiInScale(safe, rootKey, scaleType)) return safe;
  for (let offset = 1; offset <= 6; offset++) {
    if (safe + offset <= 84 && isMidiInScale(safe + offset, rootKey, scaleType)) {
      return safe + offset;
    }
    if (safe - offset >= 36 && isMidiInScale(safe - offset, rootKey, scaleType)) {
      return safe - offset;
    }
  }
  return safe;
}

export function snapNotesToScale(
  notes: StemNote[],
  rootKey: MusicalKey,
  scaleType: ScaleType
): StemNote[] {
  return notes.map((note) => ({
    ...note,
    midi: snapMidiToScale(note.midi, rootKey, scaleType),
  }));
}

export function transposeNotes(notes: StemNote[], semitones: number): StemNote[] {
  return notes.map((note) => ({
    ...note,
    midi: clampMidi(note.midi + semitones),
  }));
}

export function toggleStemNote(
  notes: StemNote[],
  step: number,
  midi: number,
  durationSteps = 2,
  velocity = 88
): StemNote[] {
  const safeStep = Math.max(0, Math.min(2047, Math.round(step)));
  const safeMidi = clampMidi(midi);
  const exists = notes.some((n) => n.step === safeStep && n.midi === safeMidi);
  if (exists) {
    return notes.filter((n) => !(n.step === safeStep && n.midi === safeMidi));
  }
  return [
    ...notes,
    {
      step: safeStep,
      midi: safeMidi,
      durationSteps: Math.max(1, Math.min(32, Math.round(durationSteps))),
      velocity: Math.max(20, Math.min(100, Math.round(velocity))),
    },
  ].sort((a, b) => a.step - b.step || b.midi - a.midi);
}

export function upsertStemNote(notes: StemNote[], incoming: StemNote): StemNote[] {
  const safeStep = Math.max(0, Math.min(2047, Math.round(incoming.step)));
  const safeMidi = clampMidi(incoming.midi);
  const filtered = notes.filter((n) => !(n.step === safeStep && n.midi === safeMidi));
  return [
    ...filtered,
    {
      step: safeStep,
      midi: safeMidi,
      durationSteps: Math.max(1, Math.min(32, Math.round(incoming.durationSteps || 2))),
      velocity: Math.max(20, Math.min(100, Math.round(incoming.velocity || 88))),
      ...(typeof incoming.startOffsetSteps === 'number'
        ? { startOffsetSteps: incoming.startOffsetSteps }
        : {}),
      ...(typeof incoming.exactDurationSteps === 'number'
        ? { exactDurationSteps: incoming.exactDurationSteps }
        : {}),
      ...(incoming.pitchBendSemitones
        ? { pitchBendSemitones: [...incoming.pitchBendSemitones] }
        : {}),
      ...(incoming.velocityCurve
        ? { velocityCurve: [...incoming.velocityCurve] }
        : {}),
    },
  ].sort((a, b) => a.step - b.step || b.midi - a.midi);
}

export function extendStemNoteDuration(
  notes: StemNote[],
  step: number,
  midi: number,
  durationSteps: number
): StemNote[] {
  const safeStep = Math.max(0, Math.min(2047, Math.round(step)));
  const safeMidi = clampMidi(midi);
  const safeDur = Math.max(1, Math.min(32, Math.round(durationSteps)));
  let changed = false;
  const updated = notes.map((n) => {
    if (n.step === safeStep && n.midi === safeMidi && n.durationSteps !== safeDur) {
      changed = true;
      return { ...n, durationSteps: safeDur };
    }
    return n;
  });
  return changed ? updated : notes;
}

export function getChannelTimelineSteps(
  channel: Pick<StemChannel, 'notes' | 'totalSteps'>,
  defaultStepCount = 64
): number {
  const minSteps = Math.max(16, Math.ceil(defaultStepCount / 16) * 16);
  let maxEnd = Math.max(minSteps, channel.totalSteps ?? 0);
  for (const n of channel.notes) {
    const end = n.step + Math.max(1, Math.round(n.durationSteps || 1));
    if (end > maxEnd) maxEnd = end;
  }
  return Math.max(minSteps, Math.ceil(maxEnd / 16) * 16);
}

export function getSongTimelineSteps(
  channels: Pick<StemChannel, 'notes' | 'totalSteps'>[],
  defaultStepCount = 64
): number {
  const minSteps = Math.max(16, Math.ceil(defaultStepCount / 16) * 16);
  let maxSteps = minSteps;
  for (const ch of channels) {
    const chSteps = getChannelTimelineSteps(ch, minSteps);
    if (chSteps > maxSteps) maxSteps = chSteps;
  }
  return maxSteps;
}

export interface DetectedPitchInfo {
  hz: number;
  rms: number;
  clarity: number;
}

/**
 * McLeod Normalized Square Difference Function (NSDF) pitch detector tuned for
 * human singing & humming (70 Hz - 920 Hz). Uses first-major-peak selection +
 * parabolic interpolation to prevent octave-drop errors (e.g. 440 Hz -> A2).
 */
export function detectPitchInfo(
  samples: Float32Array,
  sampleRate: number,
  minRms = 0.006,
  minCorrelation = 0.54
): DetectedPitchInfo | null {
  const n = samples.length;
  if (n < 256 || sampleRate <= 0) return null;

  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / n);
  if (rms < minRms) return null;

  const minLag = Math.max(8, Math.floor(sampleRate / 920));
  const maxLag = Math.min(Math.floor(n * 0.6), Math.floor(sampleRate / 70));
  if (maxLag <= minLag) return null;

  const startLag = Math.max(4, minLag - 1);
  const endLag = Math.min(n - 4, maxLag + 1);
  const nsdf = new Float32Array(endLag + 1);

  for (let lag = startLag; lag <= endLag; lag++) {
    let cross = 0;
    let energy = 0;
    const limit = n - lag;
    for (let i = 0; i < limit; i++) {
      const a = samples[i];
      const b = samples[i + lag];
      cross += a * b;
      energy += a * a + b * b;
    }
    nsdf[lag] = energy > 1e-9 ? (2 * cross) / energy : 0;
  }

  let globalMax = 0;
  const peaks: Array<{ lag: number; val: number }> = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    const v = nsdf[lag];
    if (v > 0 && v >= nsdf[lag - 1] && v >= nsdf[lag + 1]) {
      peaks.push({ lag, val: v });
      if (v > globalMax) globalMax = v;
    }
  }

  if (peaks.length === 0 || globalMax < minCorrelation) {
    return null;
  }

  // Pick the earliest positive peak that reaches >= 85% of the global maximum
  // so integer-multiple subharmonic lags (2T, 3T, 4T) do not cause octave drops.
  const threshold = Math.max(minCorrelation, globalMax * 0.85);
  const chosen = peaks.find((p) => p.val >= threshold) ?? peaks[0];

  const y0 = nsdf[chosen.lag - 1];
  const y1 = nsdf[chosen.lag];
  const y2 = nsdf[chosen.lag + 1];
  const denom = 2 * (y0 - 2 * y1 + y2);
  let refinedLag = chosen.lag;
  if (Math.abs(denom) > 1e-9) {
    const delta = (y0 - y2) / denom;
    if (Number.isFinite(delta)) {
      refinedLag += Math.max(-0.5, Math.min(0.5, delta));
    }
  }

  if (refinedLag <= 0) return null;
  return {
    hz: sampleRate / refinedLag,
    rms,
    clarity: chosen.val,
  };
}

/**
 * Backward-compatible helper returning fundamental frequency in Hz, or null on silence/noise.
 */
export function detectPitchHzAutocorrelation(
  samples: Float32Array,
  sampleRate: number,
  minRms = 0.006,
  minCorrelation = 0.54
): number | null {
  return detectPitchInfo(samples, sampleRate, minRms, minCorrelation)?.hz ?? null;
}

export interface PlaybackTimingSnapshot {
  isPlaying: boolean;
  currentStep: number;
  nextStepTime: number;
  stepDuration: number;
  stepCount: number;
  ctxCurrentTime: number;
  baseLatency?: number;
  outputLatency?: number;
}

function positiveMod(value: number, mod: number): number {
  if (mod <= 0) return 0;
  return ((value % mod) + mod) % mod;
}

/**
 * Computes the exact continuous 16th-note step position [0, stepCount) heard
 * at `audioTimeSec`, accounting for AudioEngine lookahead (`nextStepTime`) and
 * input/output latency compensation.
 */
export function computeContinuousStepAtTime(
  timing: PlaybackTimingSnapshot,
  audioTimeSec: number,
  latencyCompensationSec = 0
): number {
  const stepCount = Math.max(1, timing.stepCount);
  if (!timing.isPlaying || timing.stepDuration <= 0) return 0;
  const effectiveTime = audioTimeSec - Math.max(0, latencyCompensationSec);
  const rawStep =
    timing.currentStep + (effectiveTime - timing.nextStepTime) / timing.stepDuration;
  return positiveMod(rawStep, stepCount);
}

/**
 * Computes the monotonic (un-wrapped) continuous 16th-note step at `audioTimeSec`
 * so extended vocal hums continue linearly into Bar 5, 6, 7, 8+ without wrapping to Bar 1.
 */
export function computeMonotonicStepAtTime(
  timing: PlaybackTimingSnapshot,
  audioTimeSec: number,
  latencyCompensationSec = 0
): number {
  if (!timing.isPlaying || timing.stepDuration <= 0) return 0;
  const effectiveTime = audioTimeSec - Math.max(0, latencyCompensationSec);
  const rawStep =
    timing.currentStep + (effectiveTime - timing.nextStepTime) / timing.stepDuration;
  return Math.max(0, rawStep);
}

export interface HumTakeAnchor {
  anchorCycleStartGlobalStep: number;
  onsetPhaseSteps: number;
  leadSilenceSeconds: number;
}

/**
 * Anchors a vocal hum take when the user first starts singing after waiting through
 * any number of loop cycles. Aligns their voice cleanly inside Beat 1..End of the
 * active loop cycle (handling pickups right before Beat 1 without adding empty bars).
 */
export function computeHumTakeAnchor(
  globalContinuousStep: number,
  loopStepCount: number,
  stepDurationSec: number,
  preRollDurationSec = 0
): HumTakeAnchor {
  const safeLoopSteps = Math.max(16, Math.round(loopStepCount));
  const safeStepDur = Math.max(0.02, stepDurationSec);
  const safeGlobal = Math.max(0, globalContinuousStep);
  const cycleIndex = Math.floor(safeGlobal / safeLoopSteps);
  const phaseSteps = safeGlobal - cycleIndex * safeLoopSteps;

  // If the singer starts as a pickup within the final 3 sixteenth notes before the next cycle's Beat 1,
  // anchor directly onto the upcoming Beat 1 so we don't prepend nearly 4 empty bars of silence.
  if (phaseSteps >= safeLoopSteps - 3) {
    return {
      anchorCycleStartGlobalStep: (cycleIndex + 1) * safeLoopSteps,
      onsetPhaseSteps: 0,
      leadSilenceSeconds: 0,
    };
  }

  return {
    anchorCycleStartGlobalStep: cycleIndex * safeLoopSteps,
    onsetPhaseSteps: phaseSteps,
    leadSilenceSeconds: Math.max(0, phaseSteps * safeStepDur - Math.max(0, preRollDurationSec)),
  };
}

/**
 * Expands the active Stem timeline bar-by-bar smoothly as a singer hums past Bar 4.
 */
export function computeLiveExpandedTimelineSteps(
  currentSteps: number,
  takeStep: number,
  baseLoopSteps: number
): number {
  const minSteps = Math.max(16, Math.ceil(baseLoopSteps / 16) * 16);
  const currentBarAligned = Math.max(minSteps, Math.ceil(currentSteps / 16) * 16);
  if (takeStep < currentBarAligned - 8) {
    return currentBarAligned;
  }
  const needed = Math.ceil((Math.max(0, takeStep) + 12) / 16) * 16;
  return Math.min(2048, Math.max(currentBarAligned, needed));
}

/**
 * Computes the exact phase in seconds [0, loopDuration) within the active loop
 * at `audioTimeSec` so recorded vocal samples align dead-on Beat 1..End.
 */
export function computeLoopPhaseSeconds(
  timing: PlaybackTimingSnapshot,
  audioTimeSec: number,
  latencyCompensationSec = 0
): number {
  const stepCount = Math.max(1, timing.stepCount);
  const loopDuration = stepCount * Math.max(0.01, timing.stepDuration);
  if (!timing.isPlaying || timing.stepDuration <= 0) return 0;
  const effectiveTime = audioTimeSec - Math.max(0, latencyCompensationSec);
  const rawPhase =
    timing.currentStep * timing.stepDuration + (effectiveTime - timing.nextStepTime);
  return positiveMod(rawPhase, loopDuration);
}

export interface HumFrameInput {
  hz: number | null;
  rms: number;
  clarity: number;
  continuousStep: number;
  stepCount: number;
  allowExtendedTimeline?: boolean;
}

export type HumTrackerAction =
  | { type: 'start'; note: StemNote }
  | { type: 'extend'; step: number; midi: number; durationSteps: number };

export interface HumFrameResult {
  liveMidi: number | null;
  action: HumTrackerAction | null;
}

/**
 * Stateful frame-by-frame hum-to-MIDI tracker designed for continuous audio frames (~21ms):
 * - Captures short 16th-note pickups without high-latency debounce drops
 * - Stamps each note at its true acoustic onset frame
 * - Extends durationSteps while sustained instead of re-triggering duplicates
 * - Detects RMS dip + re-attack so repeated same-pitch notes ("hm-hm") are all captured
 */
export class HumCaptureTracker {
  private activeNote: {
    step: number;
    midi: number;
    startContinuous: number;
    lastDuration: number;
  } | null = null;
  private pendingMidi: number | null = null;
  private pendingCount = 0;
  private pendingStartContinuous = 0;
  private recentPeakRms = 0;
  private prevRms = 0;
  private sawDipSinceNoteStart = false;
  private silentFrames = 0;

  public reset(): void {
    this.activeNote = null;
    this.pendingMidi = null;
    this.pendingCount = 0;
    this.pendingStartContinuous = 0;
    this.recentPeakRms = 0;
    this.prevRms = 0;
    this.sawDipSinceNoteStart = false;
    this.silentFrames = 0;
  }

  public processFrame(input: HumFrameInput): HumFrameResult {
    const stepCount = Math.max(1, input.stepCount);
    const extended = Boolean(input.allowExtendedTimeline);
    const normalizeStep = (raw: number) =>
      extended
        ? Math.max(0, Math.min(2047, Math.round(raw)))
        : ((Math.round(raw) % stepCount) + stepCount) % stepCount;

    if (input.hz === null || !Number.isFinite(input.hz) || input.hz <= 0) {
      this.silentFrames += 1;
      this.prevRms = input.rms;
      if (this.silentFrames >= 2) {
        this.activeNote = null;
        this.pendingMidi = null;
        this.pendingCount = 0;
        this.sawDipSinceNoteStart = false;
      }
      return { liveMidi: null, action: null };
    }

    this.silentFrames = 0;
    const midi = freqToMidi(input.hz);
    const snappedStep = normalizeStep(input.continuousStep);
    const velocity = Math.min(
      100,
      Math.max(48, Math.round(52 + Math.min(1, input.rms * 10) * 48))
    );

    if (this.activeNote !== null && this.activeNote.midi === midi) {
      this.pendingMidi = null;
      this.pendingCount = 0;
      this.recentPeakRms = Math.max(this.recentPeakRms, input.rms);
      if (input.rms < this.recentPeakRms * 0.45) {
        this.sawDipSinceNoteStart = true;
      }
      const isReattack =
        this.sawDipSinceNoteStart &&
        input.rms > this.prevRms * 1.4 &&
        input.rms >= 0.01 &&
        snappedStep !== this.activeNote.step;

      if (isReattack) {
        this.activeNote = {
          step: snappedStep,
          midi,
          startContinuous: input.continuousStep,
          lastDuration: 1,
        };
        this.recentPeakRms = input.rms;
        this.sawDipSinceNoteStart = false;
        this.prevRms = input.rms;
        return {
          liveMidi: midi,
          action: {
            type: 'start',
            note: {
              step: snappedStep,
              midi,
              durationSteps: 1,
              velocity,
            },
          },
        };
      }

      let elapsed = extended
        ? Math.max(0, input.continuousStep - this.activeNote.startContinuous)
        : positiveMod(input.continuousStep - this.activeNote.startContinuous, stepCount);
      if (!extended && elapsed > stepCount * 0.75) elapsed = 0;
      const heldSteps = Math.max(1, Math.min(32, Math.round(elapsed) + 1));
      this.prevRms = input.rms;
      if (heldSteps > this.activeNote.lastDuration) {
        this.activeNote.lastDuration = heldSteps;
        return {
          liveMidi: midi,
          action: {
            type: 'extend',
            step: this.activeNote.step,
            midi: this.activeNote.midi,
            durationSteps: heldSteps,
          },
        };
      }
      return { liveMidi: midi, action: null };
    }

    if (this.pendingMidi === midi) {
      this.pendingCount += 1;
    } else {
      this.pendingMidi = midi;
      this.pendingCount = 1;
      this.pendingStartContinuous = input.continuousStep;
    }

    const confirmed =
      this.activeNote === null
        ? this.pendingCount >= 2 || input.clarity >= 0.76
        : this.pendingCount >= 2 || (input.clarity >= 0.84 && input.rms >= 0.012);

    this.prevRms = input.rms;
    if (!confirmed) {
      return { liveMidi: midi, action: null };
    }

    const onsetStep = normalizeStep(this.pendingStartContinuous);
    this.activeNote = {
      step: onsetStep,
      midi,
      startContinuous: this.pendingStartContinuous,
      lastDuration: 1,
    };
    this.pendingMidi = null;
    this.pendingCount = 0;
    this.recentPeakRms = input.rms;
    this.sawDipSinceNoteStart = false;

    return {
      liveMidi: midi,
      action: {
        type: 'start',
        note: {
          step: onsetStep,
          midi,
          durationSteps: 1,
          velocity,
        },
      },
    };
  }
}

/**
 * Self-contained AudioWorkletProcessor code executed on the dedicated real-time
 * audio rendering thread so React/DOM activity never drops mic frames or cracks voice audio.
 */
export const HUM_WORKLET_PROCESSOR_CODE = `
class HumCaptureWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 2048;
    this.voiceBuf = new Float32Array(this.chunkSize);
    this.pitchBuf = new Float32Array(this.chunkSize);
    this.offset = 0;
  }
  process(inputs) {
    const voiceIn = inputs[0] && inputs[0][0];
    const pitchIn = (inputs[1] && inputs[1][0]) || voiceIn;
    if (!voiceIn || voiceIn.length === 0) return true;
    for (let i = 0; i < voiceIn.length; i++) {
      this.voiceBuf[this.offset] = voiceIn[i];
      this.pitchBuf[this.offset] = pitchIn ? pitchIn[i] : voiceIn[i];
      this.offset++;
      if (this.offset >= this.chunkSize) {
        const vOut = this.voiceBuf;
        const pOut = this.pitchBuf;
        this.port.postMessage(
          { voice: vOut, pitch: pOut, endTime: currentTime },
          [vOut.buffer, pOut.buffer]
        );
        this.voiceBuf = new Float32Array(this.chunkSize);
        this.pitchBuf = new Float32Array(this.chunkSize);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('hum-capture-worklet', HumCaptureWorkletProcessor);
`;

/**
 * Assembles contiguous microphone chunks into a beat-phase-aligned loop PCM buffer
 * without mid-take cursor jumps or discontinuous gate clicks.
 */
export class LoopPcmRecorder {
  public loopFrames: number;
  public sampleRate: number;
  public loopPcm: Float32Array;
  private writeCursor: number | null = null;
  private anchorCursor = 0;
  private totalWritten = 0;
  private maxPeak = 0;

  constructor(loopFrames: number, sampleRate: number) {
    this.loopFrames = Math.max(1024, Math.round(loopFrames));
    this.sampleRate = Math.max(8000, sampleRate);
    this.loopPcm = new Float32Array(this.loopFrames);
  }

  public reset(loopFrames: number, sampleRate: number): void {
    this.loopFrames = Math.max(1024, Math.round(loopFrames));
    this.sampleRate = Math.max(8000, sampleRate);
    this.loopPcm = new Float32Array(this.loopFrames);
    this.writeCursor = null;
    this.anchorCursor = 0;
    this.totalWritten = 0;
    this.maxPeak = 0;
  }

  public getMaxPeak(): number {
    return this.maxPeak;
  }

  public writeChunk(chunk: Float32Array, expectedPhaseSec: number): void {
    const len = chunk.length;
    if (len === 0 || this.loopFrames <= 0) return;

    const expectedCursor =
      ((Math.round(expectedPhaseSec * this.sampleRate) % this.loopFrames) +
        this.loopFrames) %
      this.loopFrames;

    if (this.writeCursor === null) {
      this.writeCursor = expectedCursor;
      this.anchorCursor = expectedCursor;
    } else {
      // Only resync if drift exceeds 250ms (e.g. pause/seek) so minor clock jitter
      // never creates zero-filled holes or waveform clicks.
      const diff = Math.abs(expectedCursor - this.writeCursor);
      const wrapDiff = Math.min(diff, this.loopFrames - diff);
      if (wrapDiff > Math.round(0.25 * this.sampleRate)) {
        this.writeCursor = expectedCursor;
      }
    }

    let sumSq = 0;
    for (let i = 0; i < len; i++) {
      const s = chunk[i];
      sumSq += s * s;
      const abs = Math.abs(s);
      if (abs > this.maxPeak) this.maxPeak = abs;
    }
    const rms = Math.sqrt(sumSq / len);

    if (this.totalWritten < this.loopFrames) {
      for (let i = 0; i < len; i++) {
        this.loopPcm[(this.writeCursor + i) % this.loopFrames] = chunk[i];
      }
    } else if (rms >= 0.0015) {
      const xfade = Math.min(Math.floor(this.sampleRate * 0.006), Math.floor(len / 4));
      for (let i = 0; i < len; i++) {
        const idx = (this.writeCursor + i) % this.loopFrames;
        if (xfade > 0 && i < xfade) {
          const w = i / xfade;
          this.loopPcm[idx] = this.loopPcm[idx] * (1 - w) + chunk[i] * w;
        } else if (xfade > 0 && i >= len - xfade) {
          const w = (len - 1 - i) / xfade;
          this.loopPcm[idx] = this.loopPcm[idx] * (1 - w) + chunk[i] * w;
        } else {
          this.loopPcm[idx] = chunk[i];
        }
      }
    }

    this.writeCursor = (this.writeCursor + len) % this.loopFrames;
    this.totalWritten += len;
  }

  public finalize(): Float32Array | null {
    if (this.maxPeak <= 0.0012 || this.totalWritten === 0) return null;
    const out = new Float32Array(this.loopPcm);
    const fadeFrames = Math.min(
      Math.floor(this.sampleRate * 0.01),
      Math.floor(this.loopFrames / 4)
    );

    if (this.totalWritten < this.loopFrames && this.writeCursor !== null) {
      for (let i = 0; i < fadeFrames; i++) {
        const w = i / fadeFrames;
        out[(this.anchorCursor + i) % this.loopFrames] *= w;
        const tailIdx =
          (((this.writeCursor - 1 - i) % this.loopFrames) + this.loopFrames) %
          this.loopFrames;
        out[tailIdx] *= w;
      }
    } else {
      for (let i = 0; i < fadeFrames; i++) {
        const w = i / fadeFrames;
        out[i] *= w;
        out[this.loopFrames - 1 - i] *= w;
      }
    }
    return out;
  }
}

/**
 * Records continuous microphone vocal chunks linearly from Bar 1 onward without
 * wrapping back over earlier bars when the singer continues past 4 bars.
 */
export class ContinuousVocalRecorder {
  public sampleRate: number;
  private maxFrames: number;
  private chunks: Float32Array[] = [];
  private totalFrames = 0;
  private maxPeak = 0;

  constructor(sampleRate: number, maxDurationSec = 180) {
    this.sampleRate = Math.max(8000, sampleRate);
    this.maxFrames = Math.max(this.sampleRate, Math.round(maxDurationSec * this.sampleRate));
  }

  public reset(sampleRate = this.sampleRate): void {
    this.sampleRate = Math.max(8000, sampleRate);
    this.chunks = [];
    this.totalFrames = 0;
    this.maxPeak = 0;
  }

  public getTotalFrames(): number {
    return this.totalFrames;
  }

  public getDurationSeconds(): number {
    return this.totalFrames / this.sampleRate;
  }

  public getMaxPeak(): number {
    return this.maxPeak;
  }

  public prependSilenceFrames(frameCount: number): void {
    const safeFrames = Math.min(
      Math.max(0, Math.round(frameCount)),
      Math.max(0, this.maxFrames - this.totalFrames)
    );
    if (safeFrames <= 0) return;
    this.chunks.push(new Float32Array(safeFrames));
    this.totalFrames += safeFrames;
  }

  public seedPreRollChunks(chunks: Float32Array[]): void {
    for (const chunk of chunks) {
      this.writeChunk(chunk);
    }
  }

  public writeChunk(chunk: Float32Array): void {
    if (chunk.length === 0 || this.totalFrames >= this.maxFrames) return;
    const available = this.maxFrames - this.totalFrames;
    const takeLen = Math.min(chunk.length, available);
    const copy = new Float32Array(takeLen);
    for (let i = 0; i < takeLen; i++) {
      const s = chunk[i];
      copy[i] = s;
      const abs = Math.abs(s);
      if (abs > this.maxPeak) this.maxPeak = abs;
    }
    this.chunks.push(copy);
    this.totalFrames += takeLen;
  }

  public finalize(): Float32Array | null {
    if (this.maxPeak <= 0.0012 || this.totalFrames === 0) return null;
    const out = new Float32Array(this.totalFrames);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    const fadeFrames = Math.min(
      Math.floor(this.sampleRate * 0.01),
      Math.floor(this.totalFrames / 4)
    );
    for (let i = 0; i < fadeFrames; i++) {
      const w = i / fadeFrames;
      out[i] *= w;
      out[this.totalFrames - 1 - i] *= w;
    }
    return out;
  }
}

const CHANNEL_COLORS: StemChannel['color'][] = [
  'amber',
  'emerald',
  'sky',
  'violet',
  'rose',
];

export function createDefaultStemChannels(): StemChannel[] {
  return [
    {
      id: 'stem-hum-lead',
      name: 'Row 2 · Hum / Lead Synth',
      color: 'amber',
      soundId: 'synth_lead',
      voiceMode: 'keyboard',
      hasHumAudio: false,
      muted: false,
      soloed: false,
      volume_db: -1.5,
      pan: 0,
      notes: [
        { step: 0, midi: 72, durationSteps: 2, velocity: 90 },
        { step: 4, midi: 74, durationSteps: 2, velocity: 86 },
        { step: 8, midi: 76, durationSteps: 4, velocity: 94 },
        { step: 16, midi: 72, durationSteps: 2, velocity: 88 },
        { step: 20, midi: 69, durationSteps: 4, velocity: 90 },
        { step: 32, midi: 71, durationSteps: 2, velocity: 88 },
        { step: 36, midi: 74, durationSteps: 2, velocity: 90 },
        { step: 48, midi: 72, durationSteps: 6, velocity: 95 },
      ],
    },
    {
      id: 'stem-rhodes',
      name: 'Row 3 · Gospel Rhodes Chords',
      color: 'emerald',
      soundId: 'rhodes_ep',
      voiceMode: 'keyboard',
      hasHumAudio: false,
      muted: false,
      soloed: false,
      volume_db: -2,
      pan: -0.15,
      notes: [
        { step: 0, midi: 60, durationSteps: 4, velocity: 88 },
        { step: 0, midi: 64, durationSteps: 4, velocity: 82 },
        { step: 0, midi: 67, durationSteps: 4, velocity: 82 },
        { step: 6, midi: 60, durationSteps: 2, velocity: 76 },
        { step: 6, midi: 64, durationSteps: 2, velocity: 76 },
        { step: 16, midi: 65, durationSteps: 4, velocity: 90 },
        { step: 16, midi: 69, durationSteps: 4, velocity: 84 },
        { step: 16, midi: 72, durationSteps: 4, velocity: 82 },
        { step: 32, midi: 67, durationSteps: 4, velocity: 90 },
        { step: 32, midi: 71, durationSteps: 4, velocity: 84 },
        { step: 32, midi: 74, durationSteps: 4, velocity: 80 },
        { step: 48, midi: 60, durationSteps: 6, velocity: 92 },
        { step: 48, midi: 64, durationSteps: 6, velocity: 86 },
        { step: 48, midi: 67, durationSteps: 6, velocity: 86 },
      ],
    },
    {
      id: 'stem-bass',
      name: 'Row 4 · Praise Bassline',
      color: 'sky',
      soundId: 'worship_bass',
      voiceMode: 'keyboard',
      hasHumAudio: false,
      muted: false,
      soloed: false,
      volume_db: -1,
      pan: 0,
      notes: [
        { step: 0, midi: 48, durationSteps: 3, velocity: 94 },
        { step: 6, midi: 48, durationSteps: 2, velocity: 84 },
        { step: 10, midi: 52, durationSteps: 2, velocity: 86 },
        { step: 16, midi: 41, durationSteps: 3, velocity: 94 },
        { step: 22, midi: 45, durationSteps: 2, velocity: 86 },
        { step: 32, midi: 43, durationSteps: 3, velocity: 94 },
        { step: 38, midi: 47, durationSteps: 2, velocity: 86 },
        { step: 48, midi: 48, durationSteps: 4, velocity: 96 },
        { step: 56, midi: 55, durationSteps: 2, velocity: 82 },
      ],
    },
  ];
}

export function createNextStemChannel(
  existingCount: number,
  soundId: KeyboardSoundId = 'synth_brass'
): StemChannel {
  const preset =
    KEYBOARD_SOUND_PRESETS.find((p) => p.id === soundId) ?? KEYBOARD_SOUND_PRESETS[0];
  const color = CHANNEL_COLORS[existingCount % CHANNEL_COLORS.length];
  const rowNum = existingCount + 2; // Row 1 is Loop Bed, melodic rows start at Row 2
  return {
    id: `stem-${Date.now()}-${existingCount + 1}`,
    name: `Row ${rowNum} · ${preset.shortLabel}`,
    color,
    soundId: preset.id,
    voiceMode: 'keyboard',
    hasHumAudio: false,
    muted: false,
    soloed: false,
    volume_db: -2,
    pan: 0,
    notes: [],
  };
}

// ============================================================================
// Pure Undo / Redo Traverse History Stack for Stem Studio
// ============================================================================

export interface StemHistorySnapshot {
  stemChannels: StemChannel[];
  selectedChannelId: string;
  stemLoopSource: StemLoopSource;
  stemLoopMuted: boolean;
  stemLoopSoloed?: boolean;
  stemLoopVolumeDb: number;
  stemKey: MusicalKey;
  stemScale: ScaleType;
}

export function isAnyStemSoloed(
  stemLoopSoloed: boolean | undefined,
  stemChannels: StemChannel[]
): boolean {
  return Boolean(stemLoopSoloed) || stemChannels.some((c) => Boolean(c.soloed));
}

export function isStemLoopAudible(
  stemLoopMuted: boolean,
  stemLoopSoloed: boolean | undefined,
  stemChannels: StemChannel[]
): boolean {
  if (stemLoopMuted) return false;
  if (isAnyStemSoloed(stemLoopSoloed, stemChannels) && !stemLoopSoloed) return false;
  return true;
}

export function isStemChannelAudible(
  channel: StemChannel,
  stemLoopSoloed: boolean | undefined,
  allChannels: StemChannel[]
): boolean {
  if (channel.muted) return false;
  if (isAnyStemSoloed(stemLoopSoloed, allChannels) && !channel.soloed) return false;
  return true;
}

export function toggleExclusiveStemChannelSolo(
  snapshot: StemHistorySnapshot,
  channelId: string
): StemHistorySnapshot {
  const target = snapshot.stemChannels.find((c) => c.id === channelId);
  if (!target) return snapshot;
  const soloedChannelsCount = snapshot.stemChannels.filter((c) => Boolean(c.soloed)).length;
  const turnOff =
    Boolean(target.soloed) && !snapshot.stemLoopSoloed && soloedChannelsCount === 1;

  return {
    ...snapshot,
    stemLoopSoloed: false,
    stemChannels: snapshot.stemChannels.map((c) => ({
      ...c,
      soloed: turnOff ? false : c.id === channelId,
      muted: !turnOff && c.id === channelId ? false : c.muted,
    })),
  };
}

export function toggleExclusiveStemLoopSolo(
  snapshot: StemHistorySnapshot
): StemHistorySnapshot {
  const anyChannelSoloed = snapshot.stemChannels.some((c) => Boolean(c.soloed));
  const turnOff = Boolean(snapshot.stemLoopSoloed) && !anyChannelSoloed;

  return {
    ...snapshot,
    stemLoopSoloed: !turnOff,
    stemLoopMuted: !turnOff ? false : snapshot.stemLoopMuted,
    stemChannels: snapshot.stemChannels.map((c) => ({ ...c, soloed: false })),
  };
}

export function removeStemChannel(
  snapshot: StemHistorySnapshot,
  channelId: string
): StemHistorySnapshot {
  const remaining = snapshot.stemChannels.filter((c) => c.id !== channelId);
  if (remaining.length === snapshot.stemChannels.length) {
    return snapshot;
  }
  const nextSelected =
    snapshot.selectedChannelId === channelId
      ? remaining[0]?.id ?? ''
      : snapshot.selectedChannelId;
  return {
    ...snapshot,
    stemChannels: remaining,
    selectedChannelId: nextSelected,
  };
}

export interface StemHistoryState {
  past: StemHistorySnapshot[];
  present: StemHistorySnapshot;
  future: StemHistorySnapshot[];
}

const MAX_HISTORY_ENTRIES = 45;

export function cloneStemSnapshot(snapshot: StemHistorySnapshot): StemHistorySnapshot {
  return {
    ...snapshot,
    stemLoopSoloed: Boolean(snapshot.stemLoopSoloed),
    stemChannels: snapshot.stemChannels.map((ch) => ({
      ...ch,
      customVoiceSample: ch.customVoiceSample ? { ...ch.customVoiceSample } : undefined,
      notes: ch.notes.map((n) => ({
        ...n,
        ...(n.pitchBendSemitones ? { pitchBendSemitones: [...n.pitchBendSemitones] } : {}),
        ...(n.velocityCurve ? { velocityCurve: [...n.velocityCurve] } : {}),
      })),
    })),
  };
}

export function createStemHistory(initial: StemHistorySnapshot): StemHistoryState {
  return {
    past: [],
    present: cloneStemSnapshot(initial),
    future: [],
  };
}

export function pushStemHistory(
  history: StemHistoryState,
  next: StemHistorySnapshot
): StemHistoryState {
  const nextPast = [...history.past, cloneStemSnapshot(history.present)].slice(
    -MAX_HISTORY_ENTRIES
  );
  return {
    past: nextPast,
    present: cloneStemSnapshot(next),
    future: [],
  };
}

export function undoStemHistory(history: StemHistoryState): StemHistoryState {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  const nextPast = history.past.slice(0, -1);
  return {
    past: nextPast,
    present: cloneStemSnapshot(previous),
    future: [cloneStemSnapshot(history.present), ...history.future].slice(
      0,
      MAX_HISTORY_ENTRIES
    ),
  };
}

export function redoStemHistory(history: StemHistoryState): StemHistoryState {
  if (history.future.length === 0) return history;
  const [next, ...restFuture] = history.future;
  return {
    past: [...history.past, cloneStemSnapshot(history.present)].slice(
      -MAX_HISTORY_ENTRIES
    ),
    present: cloneStemSnapshot(next),
    future: restFuture,
  };
}

export function canUndoStemHistory(history: StemHistoryState): boolean {
  return history.past.length > 0;
}

export function canRedoStemHistory(history: StemHistoryState): boolean {
  return history.future.length > 0;
}
