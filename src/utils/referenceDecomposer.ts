import type {
  BarAcousticMetric,
  DecomposedInstrumentTrack,
  KeyboardSoundId,
  PercussionLoopPresetId,
  ReferenceDecompositionResult,
  ScaleType,
  SongSectionSegment,
  SongSectionType,
  StemChannel,
  StemNote,
  Track1LoopClip,
  TransitionFxEvent,
} from '../types/sequencer.ts';
import type { ExtractedPolyphonicNote } from './basicPitchTranscription.ts';
import { getStepDurationSeconds } from './sequencerLogic.ts';
import {
  KEYBOARD_SOUND_PRESETS,
  MUSICAL_KEYS,
  type MusicalKey,
} from './stemBuilderLogic.ts';

export interface PercussionLoopLayer {
  instrumentId: string;
  displayName: string;
  volumeDb: number;
  pan: number;
  steps16: number[]; // 16th-note groove pattern across 1 bar
}

export interface BuiltInPercussionLoopTemplate {
  id: PercussionLoopPresetId;
  label: string;
  layers: PercussionLoopLayer[];
}

/**
 * Light, authentic percussion-only loop templates built from our existing
 * percussion sample library (no heavy acoustic drum kits).
 */
export const BUILT_IN_PERCUSSION_LOOPS: Record<
  PercussionLoopPresetId,
  BuiltInPercussionLoopTemplate
> = {
  shaker_pulse: {
    id: 'shaker_pulse',
    label: 'Soft Shaker & Clave',
    layers: [
      {
        instrumentId: 'shekere',
        displayName: 'Shekere',
        volumeDb: -5,
        pan: 0.25,
        steps16: [78, 34, 62, 38, 74, 34, 64, 38, 78, 34, 62, 38, 74, 36, 66, 42],
      },
      {
        instrumentId: 'wooden_agogo',
        displayName: 'Wooden Agogo',
        volumeDb: -6,
        pan: -0.25,
        steps16: [72, 0, 0, 0, 0, 0, 68, 0, 0, 0, 65, 0, 70, 0, 0, 0],
      },
    ],
  },
  highlife_verse: {
    id: 'highlife_verse',
    label: 'Highlife Conga & Agogo',
    layers: [
      {
        instrumentId: 'shekere',
        displayName: 'Shekere',
        volumeDb: -4,
        pan: 0.25,
        steps16: [88, 38, 68, 42, 84, 40, 70, 44, 88, 38, 68, 42, 86, 44, 74, 48],
      },
      {
        instrumentId: 'wooden_agogo',
        displayName: 'Wooden Agogo',
        volumeDb: -3,
        pan: -0.3,
        steps16: [88, 0, 0, 80, 0, 0, 84, 0, 0, 0, 78, 0, 82, 0, 0, 0],
      },
      {
        instrumentId: 'conga_slap',
        displayName: 'Conga Slap',
        volumeDb: -3.5,
        pan: -0.4,
        steps16: [0, 0, 0, 62, 86, 0, 0, 68, 0, 0, 0, 64, 88, 0, 64, 0],
      },
      {
        instrumentId: 'conga_low_open',
        displayName: 'Conga Low Open',
        volumeDb: -4,
        pan: 0.35,
        steps16: [76, 0, 0, 0, 0, 0, 80, 0, 0, 0, 82, 0, 0, 0, 0, 72],
      },
    ],
  },
  afro_chorus_lift: {
    id: 'afro_chorus_lift',
    label: 'Full Praise Percussion Lift',
    layers: [
      {
        instrumentId: 'shekere',
        displayName: 'Shekere',
        volumeDb: -3,
        pan: 0.28,
        steps16: [96, 44, 76, 52, 92, 46, 78, 52, 96, 44, 76, 52, 94, 52, 84, 62],
      },
      {
        instrumentId: 'wooden_agogo',
        displayName: 'Wooden Agogo',
        volumeDb: -2,
        pan: -0.32,
        steps16: [96, 0, 0, 88, 0, 0, 92, 0, 0, 0, 86, 0, 90, 0, 74, 0],
      },
      {
        instrumentId: 'conga_slap',
        displayName: 'Conga Slap',
        volumeDb: -2.5,
        pan: -0.45,
        steps16: [0, 0, 0, 70, 94, 0, 0, 76, 0, 0, 80, 0, 96, 74, 0, 66],
      },
      {
        instrumentId: 'conga_low_open',
        displayName: 'Conga Low Open',
        volumeDb: -3,
        pan: 0.4,
        steps16: [84, 0, 0, 0, 0, 0, 88, 0, 0, 78, 0, 0, 0, 0, 86, 90],
      },
      {
        instrumentId: 'tambourine',
        displayName: 'Tambourine',
        volumeDb: -4,
        pan: -0.2,
        steps16: [0, 0, 84, 0, 0, 0, 84, 0, 0, 0, 84, 0, 0, 0, 88, 54],
      },
      {
        instrumentId: 'cowbell',
        displayName: 'Cowbell',
        volumeDb: -5.5,
        pan: 0.15,
        steps16: [88, 0, 0, 0, 78, 0, 0, 0, 88, 0, 72, 0, 82, 0, 74, 0],
      },
      {
        instrumentId: 'talking_drum',
        displayName: 'Talking Drum',
        volumeDb: -3.5,
        pan: 0,
        steps16: [0, 0, 0, 0, 0, 0, 0, 0, 76, 0, 84, 0, 92, 72, 86, 0],
      },
    ],
  },
  bridge_groove: {
    id: 'bridge_groove',
    label: 'Syncopated Tambourine & Bell',
    layers: [
      {
        instrumentId: 'tambourine',
        displayName: 'Tambourine',
        volumeDb: -3.5,
        pan: -0.2,
        steps16: [0, 0, 84, 0, 0, 0, 82, 0, 0, 0, 84, 0, 0, 0, 86, 52],
      },
      {
        instrumentId: 'cowbell',
        displayName: 'Cowbell',
        volumeDb: -4.5,
        pan: 0.2,
        steps16: [90, 0, 0, 76, 0, 0, 84, 0, 0, 0, 82, 0, 86, 0, 0, 0],
      },
      {
        instrumentId: 'conga_low_open',
        displayName: 'Conga Low Open',
        volumeDb: -3.5,
        pan: 0.35,
        steps16: [82, 0, 0, 0, 0, 0, 84, 0, 0, 74, 0, 0, 80, 0, 82, 0],
      },
    ],
  },
};

export interface InstrumentVoiceSlotSpec {
  trackNumber: number; // 2..19
  name: string;
  soundId: KeyboardSoundId;
  register: 'bass' | 'mid' | 'high';
  brightnessBias: 'warm' | 'balanced' | 'bright';
  sustainBias: 'short' | 'medium' | 'long';
  color: StemChannel['color'];
  pan: number;
  volumeDb: number;
}

/**
 * 18 distinct harmonic/melodic channel slots (Tracks 02..19) spanning bass,
 * mid-range chordal instruments, and upper melodic leads/strings/brass.
 */
export const INSTRUMENT_18_VOICE_BANK: InstrumentVoiceSlotSpec[] = [
  {
    trackNumber: 2,
    name: 'Sub Bass',
    soundId: 'sub_bass',
    register: 'bass',
    brightnessBias: 'warm',
    sustainBias: 'long',
    color: 'emerald',
    pan: 0,
    volumeDb: -1.5,
  },
  {
    trackNumber: 3,
    name: 'Bass Guitar',
    soundId: 'worship_bass',
    register: 'bass',
    brightnessBias: 'balanced',
    sustainBias: 'short',
    color: 'emerald',
    pan: -0.05,
    volumeDb: -1.5,
  },
  {
    trackNumber: 4,
    name: 'Acoustic Piano (Low Chords)',
    soundId: 'grand_piano',
    register: 'mid',
    brightnessBias: 'balanced',
    sustainBias: 'short',
    color: 'amber',
    pan: -0.22,
    volumeDb: -2.5,
  },
  {
    trackNumber: 5,
    name: 'Acoustic Piano (High)',
    soundId: 'grand_piano',
    register: 'high',
    brightnessBias: 'balanced',
    sustainBias: 'short',
    color: 'amber',
    pan: 0.22,
    volumeDb: -2.5,
  },
  {
    trackNumber: 6,
    name: 'Electric Piano (Chords)',
    soundId: 'rhodes_ep',
    register: 'mid',
    brightnessBias: 'warm',
    sustainBias: 'medium',
    color: 'sky',
    pan: -0.28,
    volumeDb: -2.5,
  },
  {
    trackNumber: 7,
    name: 'Electric Piano (Bell)',
    soundId: 'rhodes_ep',
    register: 'high',
    brightnessBias: 'warm',
    sustainBias: 'medium',
    color: 'sky',
    pan: 0.28,
    volumeDb: -3,
  },
  {
    trackNumber: 8,
    name: 'Organ B3 (Harmony)',
    soundId: 'gospel_organ',
    register: 'mid',
    brightnessBias: 'balanced',
    sustainBias: 'long',
    color: 'rose',
    pan: -0.35,
    volumeDb: -3.5,
  },
  {
    trackNumber: 9,
    name: 'Organ B3 (Upper)',
    soundId: 'gospel_organ',
    register: 'high',
    brightnessBias: 'balanced',
    sustainBias: 'long',
    color: 'rose',
    pan: 0.35,
    volumeDb: -3.5,
  },
  {
    trackNumber: 10,
    name: 'Warm Pads (Low Swell)',
    soundId: 'warm_pad',
    register: 'mid',
    brightnessBias: 'warm',
    sustainBias: 'long',
    color: 'violet',
    pan: -0.4,
    volumeDb: -4,
  },
  {
    trackNumber: 11,
    name: 'Warm Pads (Air)',
    soundId: 'warm_pad',
    register: 'high',
    brightnessBias: 'warm',
    sustainBias: 'long',
    color: 'violet',
    pan: 0.4,
    volumeDb: -4.5,
  },
  {
    trackNumber: 12,
    name: 'Strings (Cello / Viola)',
    soundId: 'strings',
    register: 'mid',
    brightnessBias: 'bright',
    sustainBias: 'long',
    color: 'emerald',
    pan: -0.3,
    volumeDb: -3.5,
  },
  {
    trackNumber: 13,
    name: 'Strings (Violins)',
    soundId: 'strings',
    register: 'high',
    brightnessBias: 'bright',
    sustainBias: 'long',
    color: 'emerald',
    pan: 0.3,
    volumeDb: -3.5,
  },
  {
    trackNumber: 14,
    name: 'Brass / Horns (Mid)',
    soundId: 'synth_brass',
    register: 'mid',
    brightnessBias: 'bright',
    sustainBias: 'medium',
    color: 'amber',
    pan: -0.18,
    volumeDb: -3,
  },
  {
    trackNumber: 15,
    name: 'Brass / Horns (High)',
    soundId: 'synth_brass',
    register: 'high',
    brightnessBias: 'bright',
    sustainBias: 'medium',
    color: 'amber',
    pan: 0.18,
    volumeDb: -3,
  },
  {
    trackNumber: 16,
    name: 'Plucks (Mid Arp)',
    soundId: 'marimba_pluck',
    register: 'mid',
    brightnessBias: 'bright',
    sustainBias: 'short',
    color: 'sky',
    pan: -0.42,
    volumeDb: -3,
  },
  {
    trackNumber: 17,
    name: 'Plucks (High Bell)',
    soundId: 'marimba_pluck',
    register: 'high',
    brightnessBias: 'bright',
    sustainBias: 'short',
    color: 'sky',
    pan: 0.42,
    volumeDb: -3,
  },
  {
    trackNumber: 18,
    name: 'Synth Lead (Melody)',
    soundId: 'synth_lead',
    register: 'high',
    brightnessBias: 'bright',
    sustainBias: 'medium',
    color: 'rose',
    pan: 0.05,
    volumeDb: -2,
  },
  {
    trackNumber: 19,
    name: 'Choir / Top Harmony',
    soundId: 'choir_voice',
    register: 'high',
    brightnessBias: 'warm',
    sustainBias: 'long',
    color: 'violet',
    pan: -0.1,
    volumeDb: -4,
  },
];

/**
 * Estimates global BPM and bar-downbeat phase offset from an onset-flux autocorrelation curve.
 */
export function detectReferenceBpmAndBeatOffset(
  pcm: Float32Array,
  sampleRate: number
): { bpm: number; beatOffsetSec: number; confidence: number } {
  if (pcm.length < sampleRate * 2) {
    return { bpm: 120, beatOffsetSec: 0, confidence: 0.3 };
  }

  const maxAnalyzeSamples = Math.min(pcm.length, Math.floor(sampleRate * 90));
  const hop = Math.max(128, Math.round(sampleRate * 0.0116)); // ~86.2 fps
  const frameRate = sampleRate / hop;
  const frameCount = Math.floor(maxAnalyzeSamples / hop);
  if (frameCount < 40) {
    return { bpm: 120, beatOffsetSec: 0, confidence: 0.3 };
  }

  // Band-focused onset flux (positive energy increases + high-pass emphasis)
  const flux = new Float32Array(frameCount);
  let prevEnergy = 0;
  let hpState = 0;
  let prevSample = 0;
  const hpAlpha = Math.exp((-2 * Math.PI * 120) / sampleRate);

  for (let f = 0; f < frameCount; f++) {
    const start = f * hop;
    const end = Math.min(maxAnalyzeSamples, start + hop);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const s = pcm[i];
      hpState = hpAlpha * (hpState + s - prevSample);
      prevSample = s;
      sumSq += hpState * hpState;
    }
    const energy = Math.sqrt(sumSq / Math.max(1, end - start));
    const delta = Math.max(0, energy - prevEnergy);
    flux[f] = delta;
    prevEnergy = energy * 0.85 + energy * 0.15;
  }

  // Subtract local moving average to sharpen beat peaks
  const centered = new Float32Array(frameCount);
  const win = 8;
  for (let f = 0; f < frameCount; f++) {
    let localSum = 0;
    let count = 0;
    for (let k = Math.max(0, f - win); k <= Math.min(frameCount - 1, f + win); k++) {
      localSum += flux[k];
      count++;
    }
    centered[f] = Math.max(0, flux[f] - (localSum / count) * 0.85);
  }

  let bestBpm = 120;
  let bestScore = -Infinity;
  let secondScore = -Infinity;

  for (let bpm = 68; bpm <= 176; bpm++) {
    const beatFrames = (60 / bpm) * frameRate;
    const lag1 = Math.round(beatFrames);
    const lag2 = Math.round(beatFrames * 2);
    const lag4 = Math.round(beatFrames * 4);
    if (lag4 >= frameCount) continue;

    let corr1 = 0;
    let corr2 = 0;
    let corr4 = 0;
    const limit = frameCount - lag4;
    for (let i = 0; i < limit; i++) {
      const v = centered[i];
      if (v <= 0) continue;
      corr1 += v * centered[i + lag1];
      corr2 += v * centered[i + lag2];
      corr4 += v * centered[i + lag4];
    }

    // Gentle perceptual prior toward 88..148 BPM avoids false 68/176 half/double octave lock
    const octavePrior =
      bpm >= 85 && bpm <= 150 ? 1.15 : bpm >= 75 && bpm <= 160 ? 1.0 : 0.86;
    const score = (corr1 * 0.52 + corr2 * 0.34 + corr4 * 0.14) * octavePrior;

    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestBpm = bpm;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  // Find beat-1 phase offset minimizing latency from 0s
  const beatFrames = (60 / bestBpm) * frameRate;
  let bestPhase = 0;
  let bestPhaseScore = -1;
  const steps = Math.max(8, Math.round(beatFrames));
  for (let p = 0; p < steps; p++) {
    let phaseSum = 0;
    for (let k = 0; k < 32; k++) {
      const idx = Math.round(p + k * beatFrames);
      if (idx >= frameCount) break;
      phaseSum += centered[idx];
    }
    if (phaseSum > bestPhaseScore) {
      bestPhaseScore = phaseSum;
      bestPhase = p;
    }
  }

  const beatOffsetSec = Number(((bestPhase / frameRate) % (60 / bestBpm)).toFixed(3));
  const confidence =
    bestScore > 0
      ? Math.min(0.99, Math.max(0.35, 0.55 + (bestScore - Math.max(0, secondScore)) / (bestScore + 1e-6)))
      : 0.4;

  return { bpm: bestBpm, beatOffsetSec, confidence: Number(confidence.toFixed(2)) };
}

// Krumhansl-Schmuckler tonal pitch-class profiles
const KRUMHANSL_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KRUMHANSL_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearsonCorrelation(a: number[], b: number[]): number {
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < 12; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= 12;
  meanB /= 12;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < 12; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 1e-9 ? num / den : 0;
}

/**
 * Computes a 12-bin harmonic chromagram using targeted Goertzel filters over C3..B4
 * and blends with Basic Pitch MIDI histograms if available.
 */
export function detectReferenceKey(
  pcm: Float32Array,
  sampleRate: number,
  extractedNotes?: Pick<StemNote, 'midi' | 'durationSteps' | 'velocity'>[]
): { rootKey: MusicalKey; scaleType: ScaleType; confidence: number } {
  const chroma = new Array<number>(12).fill(0);

  if (pcm.length >= 2048) {
    // Sample up to 24 evenly spaced 2048-sample windows for crisp Goertzel harmonic chroma
    const winLen = Math.min(2048, pcm.length);
    const numWindows = Math.min(24, Math.max(1, Math.floor(pcm.length / winLen)));
    const stride = Math.max(winLen, Math.floor((pcm.length - winLen) / Math.max(1, numWindows - 1)));

    for (let w = 0; w < numWindows; w++) {
      const start = Math.min(pcm.length - winLen, w * stride);
      for (let pc = 0; pc < 12; pc++) {
        // Measure octaves 3 and 4 (130 Hz .. 494 Hz)
        let pcPower = 0;
        for (const octMidi of [48 + pc, 60 + pc]) {
          const freq = 440 * Math.pow(2, (octMidi - 69) / 12);
          const omega = (2 * Math.PI * freq) / sampleRate;
          const coeff = 2 * Math.cos(omega);
          let q1 = 0;
          let q2 = 0;
          for (let i = 0; i < winLen; i++) {
            const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (winLen - 1)));
            const x = pcm[start + i] * hann;
            const q0 = coeff * q1 - q2 + x;
            q2 = q1;
            q1 = q0;
          }
          const power = q1 * q1 + q2 * q2 - q1 * q2 * coeff;
          pcPower += Math.max(0, power);
        }
        chroma[pc] += Math.sqrt(pcPower);
      }
    }
  }

  if (extractedNotes && extractedNotes.length > 0) {
    const noteChroma = new Array<number>(12).fill(0);
    for (const n of extractedNotes) {
      const pc = ((Math.round(n.midi) % 12) + 12) % 12;
      noteChroma[pc] += Math.max(1, n.durationSteps) * (n.velocity / 100);
    }
    const maxAudio = Math.max(1e-6, ...chroma);
    const maxNote = Math.max(1e-6, ...noteChroma);
    for (let pc = 0; pc < 12; pc++) {
      chroma[pc] = (chroma[pc] / maxAudio) * 0.4 + (noteChroma[pc] / maxNote) * 0.6;
    }
  }

  let bestKey: MusicalKey = 'C';
  let bestScale: ScaleType = 'major';
  let bestCorr = -Infinity;
  let secondCorr = -Infinity;

  for (let root = 0; root < 12; root++) {
    const rotated = new Array<number>(12);
    for (let i = 0; i < 12; i++) {
      rotated[i] = chroma[(root + i) % 12];
    }

    const majCorr = pearsonCorrelation(rotated, KRUMHANSL_MAJOR);
    if (majCorr > bestCorr) {
      secondCorr = bestCorr;
      bestCorr = majCorr;
      bestKey = MUSICAL_KEYS[root];
      bestScale = 'major';
    } else if (majCorr > secondCorr) {
      secondCorr = majCorr;
    }

    const minCorr = pearsonCorrelation(rotated, KRUMHANSL_MINOR);
    if (minCorr > bestCorr) {
      secondCorr = bestCorr;
      bestCorr = minCorr;
      bestKey = MUSICAL_KEYS[root];
      bestScale = 'minor';
    } else if (minCorr > secondCorr) {
      secondCorr = minCorr;
    }
  }

  const confidence = Math.max(
    0.35,
    Math.min(0.99, 0.5 + (bestCorr - Math.max(-1, secondCorr)) * 0.8)
  );
  return {
    rootKey: bestKey,
    scaleType: bestScale,
    confidence: Number(confidence.toFixed(2)),
  };
}

/**
 * Computes bar-by-bar RMS energy, sub/low-band weight, percussion transient density,
 * spectral brightness, and bar-to-bar spectral change across the song timeline.
 */
export function analyzeBarsAndSegmentStructure(
  pcm: Float32Array,
  sampleRate: number,
  bpm: number,
  beatOffsetSec = 0
): { barMetrics: BarAcousticMetric[]; sections: SongSectionSegment[]; totalBars: number } {
  const barDurSec = (60 / Math.max(40, bpm)) * 4;
  const offsetSamples = Math.max(0, Math.round(beatOffsetSec * sampleRate));
  const usableSamples = Math.max(sampleRate, pcm.length - offsetSamples);
  const totalBars = Math.max(4, Math.min(128, Math.round(usableSamples / (barDurSec * sampleRate))));
  const barSamples = Math.max(1024, Math.floor(barDurSec * sampleRate));

  const lpAlpha = Math.exp((-2 * Math.PI * 165) / sampleRate);
  const midLpAlpha = Math.exp((-2 * Math.PI * 1400) / sampleRate);
  const hpAlpha = Math.exp((-2 * Math.PI * 2200) / sampleRate);

  const rawBars: Array<{
    rms: number;
    low: number;
    transient: number;
    brightness: number;
  }> = [];

  let lpState = 0;
  let midState = 0;
  let hpState = 0;
  let prevS = 0;

  for (let b = 0; b < totalBars; b++) {
    const start = Math.min(pcm.length - 1, offsetSamples + b * barSamples);
    const end = Math.min(pcm.length, start + barSamples);
    const len = Math.max(1, end - start);

    let sumSq = 0;
    let lowSq = 0;
    let midSq = 0;
    let highSq = 0;

    // 16 sub-windows inside each bar to capture percussive transient crest
    const subLen = Math.max(64, Math.floor(len / 16));
    const subHighRms: number[] = [];
    let curSubSq = 0;
    let curSubCount = 0;

    for (let i = start; i < end; i++) {
      const s = pcm[i] ?? 0;
      sumSq += s * s;

      lpState = lpAlpha * lpState + (1 - lpAlpha) * s;
      lowSq += lpState * lpState;

      midState = midLpAlpha * midState + (1 - midLpAlpha) * s;
      const midBand = midState - lpState;
      midSq += midBand * midBand;

      hpState = hpAlpha * (hpState + s - prevS);
      prevS = s;
      highSq += hpState * hpState;

      curSubSq += hpState * hpState;
      curSubCount++;
      if (curSubCount >= subLen) {
        subHighRms.push(Math.sqrt(curSubSq / curSubCount));
        curSubSq = 0;
        curSubCount = 0;
      }
    }

    const rms = Math.sqrt(sumSq / len);
    const low = Math.sqrt(lowSq / len);
    const mid = Math.sqrt(midSq / len);
    const high = Math.sqrt(highSq / len);

    let transientDelta = 0;
    for (let k = 1; k < subHighRms.length; k++) {
      transientDelta += Math.max(0, subHighRms[k] - subHighRms[k - 1] * 1.15);
    }
    const transient = subHighRms.length > 1 ? transientDelta / (subHighRms.length - 1) : 0;
    const brightness = high / Math.max(1e-5, mid + low * 0.4 + high);

    rawBars.push({ rms, low, transient, brightness });
  }

  const maxRms = Math.max(1e-4, ...rawBars.map((r) => r.rms));
  const maxLow = Math.max(1e-4, ...rawBars.map((r) => r.low));
  const maxTrans = Math.max(1e-4, ...rawBars.map((r) => r.transient));
  const maxBright = Math.max(1e-4, ...rawBars.map((r) => r.brightness));

  const sortedTrans = [...rawBars.map((r) => r.transient / maxTrans)].sort((a, b) => a - b);
  const p75Trans = sortedTrans[Math.min(sortedTrans.length - 1, Math.floor(sortedTrans.length * 0.75))];
  const percussionThreshold = Math.max(0.24, p75Trans * 0.42);

  const barMetrics: BarAcousticMetric[] = rawBars.map((r, idx) => {
    const rmsEnergy = Number(Math.min(1, r.rms / maxRms).toFixed(3));
    const lowBandEnergy = Number(Math.min(1, r.low / maxLow).toFixed(3));
    const percussionTransientScore = Number(Math.min(1, r.transient / maxTrans).toFixed(3));
    const spectralBrightness = Number(Math.min(1, r.brightness / maxBright).toFixed(3));

    const prev = idx > 0 ? rawBars[idx - 1] : r;
    const fluxRaw =
      Math.abs(r.rms - prev.rms) / maxRms +
      Math.abs(r.low - prev.low) / maxLow * 0.7 +
      Math.abs(r.brightness - prev.brightness) / maxBright * 0.6;
    const spectralFluxDelta = Number(Math.min(1, fluxRaw * 0.75).toFixed(3));

    const hasPercussion =
      rmsEnergy >= 0.14 &&
      (percussionTransientScore >= percussionThreshold ||
        (lowBandEnergy >= 0.45 && percussionTransientScore >= percussionThreshold * 0.75));

    return {
      barIndex: idx,
      rmsEnergy,
      lowBandEnergy,
      percussionTransientScore,
      spectralBrightness,
      spectralFluxDelta,
      hasPercussion,
    };
  });

  // Smooth isolated 1-bar percussion flicker so sections span coherent musical phrases
  for (let i = 1; i < barMetrics.length - 1; i++) {
    if (
      barMetrics[i].hasPercussion !== barMetrics[i - 1].hasPercussion &&
      barMetrics[i - 1].hasPercussion === barMetrics[i + 1].hasPercussion
    ) {
      barMetrics[i].hasPercussion = barMetrics[i - 1].hasPercussion;
    }
  }

  // Classify each bar into tentative structural states
  const sortedRms = [...barMetrics.map((b) => b.rmsEnergy)].sort((a, b) => a - b);
  const medianRms = sortedRms[Math.floor(sortedRms.length / 2)] ?? 0.4;
  const chorusCutoff = Math.max(0.62, medianRms * 1.18);

  const barRole = (m: BarAcousticMetric, idx: number): SongSectionType => {
    if (!m.hasPercussion) {
      if (idx < Math.max(2, Math.floor(totalBars * 0.2))) return 'intro';
      if (idx >= totalBars - Math.max(2, Math.floor(totalBars * 0.15))) return 'outro';
      return 'breakdown';
    }
    if (idx >= totalBars - 2 && m.rmsEnergy < medianRms * 0.8) {
      return 'outro';
    }
    if (m.rmsEnergy >= chorusCutoff || (m.lowBandEnergy >= 0.72 && m.spectralBrightness >= 0.58)) {
      return 'chorus';
    }
    if (idx > Math.floor(totalBars * 0.55) && m.spectralBrightness >= 0.68 && m.rmsEnergy < chorusCutoff) {
      return 'bridge';
    }
    return 'verse';
  };

  const rawRoles = barMetrics.map((m, idx) => barRole(m, idx));

  // Smooth single-bar role jitter (keep 1-bar intro/outro only if really at boundary, otherwise absorb >=2 bars)
  for (let i = 1; i < rawRoles.length - 1; i++) {
    if (rawRoles[i] !== rawRoles[i - 1] && rawRoles[i - 1] === rawRoles[i + 1]) {
      rawRoles[i] = rawRoles[i - 1];
    }
  }

  // Group contiguous equal roles into sections
  const sections: SongSectionSegment[] = [];
  let segStart = 0;
  for (let i = 1; i <= totalBars; i++) {
    if (i === totalBars || rawRoles[i] !== rawRoles[segStart]) {
      const slice = barMetrics.slice(segStart, i);
      const role = rawRoles[segStart];
      const avgEnergy =
        slice.reduce((acc, s) => acc + s.rmsEnergy, 0) / Math.max(1, slice.length);
      const avgBright =
        slice.reduce((acc, s) => acc + s.spectralBrightness, 0) / Math.max(1, slice.length);
      const percCount = slice.filter((s) => s.hasPercussion).length;
      const hasPercussion = percCount >= Math.ceil(slice.length / 2);

      const labelMap: Record<SongSectionType, string> = {
        intro: hasPercussion ? 'Intro Groove' : 'Intro / No-Loop',
        verse: 'Verse',
        chorus: 'Chorus / Drop',
        breakdown: 'Breakdown',
        bridge: 'Bridge',
        outro: hasPercussion ? 'Outro' : 'Outro / Fade',
      };

      const grooveDensity: SongSectionSegment['grooveDensity'] = !hasPercussion
        ? 'none'
        : role === 'chorus'
        ? 'full'
        : role === 'bridge' || avgEnergy >= 0.5
        ? 'medium'
        : 'light';

      sections.push({
        id: `sec-${segStart}-${i}`,
        type: role,
        label: labelMap[role],
        startBar: segStart,
        endBar: i,
        hasPercussion,
        grooveDensity,
        avgEnergy: Number(avgEnergy.toFixed(2)),
        spectralBrightness: Number(avgBright.toFixed(2)),
      });
      segStart = i;
    }
  }

  return { barMetrics, sections, totalBars };
}

/**
 * Separates harmonic/melodic layers cleanly for Basic Pitch by keeping center + wide stereo
 * harmonic balance while gently attenuating sharp broadband percussive drum transients.
 */
export function separateHarmonicStemPcm(
  left: Float32Array,
  right: Float32Array | null,
  sampleRate: number
): Float32Array {
  const n = left.length;
  if (n === 0) return new Float32Array(0);

  const combined = new Float32Array(n);
  if (right && right.length === n) {
    for (let i = 0; i < n; i++) {
      const mid = 0.5 * (left[i] + right[i]);
      const side = 0.5 * (left[i] - right[i]);
      // Side retains stereo keys/pads/strings cleanly while mid preserves bass + lead vocal
      combined[i] = mid * 0.76 + side * 0.36;
    }
  } else {
    combined.set(left);
  }

  // Soften short transient drum spikes (>3.4x rolling harmonic envelope) without smearing melodic sustain
  const slowAlpha = Math.exp(-1 / (sampleRate * 0.045));
  const fastAlpha = Math.exp(-1 / (sampleRate * 0.004));
  const lpHarmAlpha = Math.exp((-2 * Math.PI * 3600) / sampleRate);

  const out = new Float32Array(n);
  let slowEnv = 0.01;
  let fastEnv = 0.01;
  let lpState = 0;

  for (let i = 0; i < n; i++) {
    const x = combined[i];
    lpState = lpHarmAlpha * lpState + (1 - lpHarmAlpha) * x;
    const abs = Math.abs(lpState);
    slowEnv = slowAlpha * slowEnv + (1 - slowAlpha) * abs;
    fastEnv = fastAlpha * fastEnv + (1 - fastAlpha) * abs;

    const spikeRatio = fastEnv / Math.max(0.008, slowEnv);
    const transientAttenuation =
      spikeRatio > 2.6 ? Math.max(0.35, 2.6 / spikeRatio) : 1.0;

    out[i] = lpState * transientAttenuation;
  }

  return out;
}

/**
 * Track 1 Dynamic Percussion Loop Builder:
 * Places matching built-in percussion loop clips strictly at bars where rhythm enters,
 * leaving intro/acapella/breakdown/quiet-outro bars completely empty.
 */
export function buildTrack1PercussionClips(
  sections: SongSectionSegment[]
): Track1LoopClip[] {
  const clips: Track1LoopClip[] = [];
  for (const sec of sections) {
    if (!sec.hasPercussion) continue;

    let loopPresetId: PercussionLoopPresetId = 'highlife_verse';
    if (sec.type === 'chorus') {
      loopPresetId = 'afro_chorus_lift';
    } else if (sec.type === 'bridge') {
      loopPresetId = 'bridge_groove';
    } else if (sec.grooveDensity === 'light' || sec.type === 'intro' || sec.type === 'outro') {
      loopPresetId = 'shaker_pulse';
    }

    const template = BUILT_IN_PERCUSSION_LOOPS[loopPresetId];
    clips.push({
      id: `trk1-${sec.startBar}-${sec.endBar}`,
      startBar: sec.startBar,
      endBar: sec.endBar,
      loopPresetId,
      label: template.label,
      sectionLabel: sec.label,
      intensity: sec.type === 'chorus' ? 1.0 : sec.grooveDensity === 'light' ? 0.65 : 0.85,
    });
  }
  return clips;
}

/**
 * Estimates normalized spectral brightness [0..1] for a note window in PCM.
 */
export function measureNoteSpectralBrightness(
  pcm: Float32Array,
  sampleRate: number,
  startSec: number,
  durationSec: number
): number {
  if (pcm.length < 64) return 0.5;
  const start = Math.max(0, Math.floor(startSec * sampleRate));
  const end = Math.min(
    pcm.length,
    Math.max(start + 64, Math.floor((startSec + Math.min(0.6, durationSec)) * sampleRate))
  );
  let lowMid = 0;
  let highMid = 0;
  let prev = pcm[start] ?? 0;
  const stride = Math.max(1, Math.floor((end - start) / 1024));
  for (let i = start; i < end; i += stride) {
    const s = pcm[i];
    const diff = s - prev;
    prev = s;
    lowMid += s * s;
    highMid += diff * diff;
  }
  if (lowMid < 1e-8) return 0.45;
  const ratio = Math.sqrt(highMid / lowMid);
  return Math.max(0, Math.min(1, ratio * 1.45));
}

/**
 * Maps Basic Pitch polyphonic MIDI notes onto up to 18 separate mixer channels (Tracks 02..19)
 * using pitch register, brightness, sustain duration, and simultaneous polyphony separation.
 */
export function allocateMidiTo18InstrumentTracks(
  notes: ExtractedPolyphonicNote[],
  totalBars: number,
  harmonicPcm?: Float32Array,
  sampleRate = 22050
): DecomposedInstrumentTrack[] {
  const buckets = new Map<number, StemNote[]>();
  for (const spec of INSTRUMENT_18_VOICE_BANK) {
    buckets.set(spec.trackNumber, []);
  }

  // Track used track numbers per quantized step so simultaneous notes split cleanly across voices
  const usedAtStep = new Map<number, Set<number>>();
  const maxStep = totalBars * 16 - 1;

  for (const note of notes) {
    if (note.step < 0 || note.step > maxStep) continue;
    const midi = note.midi;
    const dur = note.durationSteps;
    const brightness = harmonicPcm
      ? measureNoteSpectralBrightness(
          harmonicPcm,
          sampleRate,
          note.startTimeSeconds,
          note.durationSeconds
        )
      : 0.5;

    let candidates: number[];
    if (midi <= 47) {
      // Bass register
      candidates = dur >= 4 || brightness < 0.42 ? [2, 3] : [3, 2];
    } else if (midi <= 64) {
      // Mid chord / harmony register
      if (dur >= 5) {
        candidates = brightness >= 0.56 ? [12, 8, 10, 6] : [10, 8, 6, 12];
      } else if (dur <= 2) {
        candidates = brightness >= 0.58 ? [16, 4, 14, 6] : [4, 6, 16, 14];
      } else {
        candidates = brightness >= 0.6 ? [14, 4, 6, 8] : [6, 4, 8, 10];
      }
    } else {
      // High melody / upper voicings register
      if (dur >= 5) {
        candidates = brightness >= 0.58 ? [13, 9, 11, 19] : [11, 19, 13, 9];
      } else if (dur <= 2) {
        candidates = brightness >= 0.62 ? [17, 5, 18, 7] : [5, 7, 17, 18];
      } else {
        candidates =
          brightness >= 0.64
            ? [18, 15, 13, 5]
            : brightness >= 0.45
            ? [18, 7, 5, 15]
            : [7, 19, 11, 18];
      }
    }

    let used = usedAtStep.get(note.step);
    if (!used) {
      used = new Set<number>();
      usedAtStep.set(note.step, used);
    }

    let chosen = candidates[0];
    for (const c of candidates) {
      if (!used.has(c)) {
        chosen = c;
        break;
      }
    }
    used.add(chosen);

    const list = buckets.get(chosen)!;
    // Clamp MIDI safely into synth range [36..84] while keeping octave sense for sub bass
    const playableMidi =
      midi < 36 ? Math.min(47, midi + 12) : midi > 84 ? Math.max(72, midi - 12) : midi;
    list.push({
      step: note.step,
      midi: playableMidi,
      durationSteps: Math.max(1, Math.min(32, note.durationSteps)),
      velocity: note.velocity,
      ...(typeof note.startOffsetSteps === 'number'
        ? { startOffsetSteps: note.startOffsetSteps }
        : {}),
      ...(typeof note.exactDurationSteps === 'number'
        ? { exactDurationSteps: note.exactDurationSteps }
        : {}),
      ...(note.pitchBendSemitones
        ? { pitchBendSemitones: note.pitchBendSemitones }
        : {}),
    });
  }

  return INSTRUMENT_18_VOICE_BANK.map((spec) => {
    const channelNotes = (buckets.get(spec.trackNumber) ?? []).sort(
      (a, b) => a.step - b.step || a.midi - b.midi
    );
    const barSet = new Set<number>();
    for (const n of channelNotes) {
      barSet.add(Math.floor(n.step / 16));
    }
    const presetMeta = KEYBOARD_SOUND_PRESETS.find((p) => p.id === spec.soundId);

    return {
      trackNumber: spec.trackNumber,
      id: `decomp-trk-${String(spec.trackNumber).padStart(2, '0')}`,
      name: spec.name,
      presetLabel: presetMeta?.shortLabel ?? spec.soundId,
      register: spec.register,
      soundId: spec.soundId,
      color: spec.color,
      isActive: channelNotes.length > 0,
      activeBars: Array.from(barSet).sort((a, b) => a - b),
      muted: false,
      soloed: false,
      volume_db: spec.volumeDb,
      pan: spec.pan,
      notes: channelNotes,
    };
  });
}

/**
 * Detects major section transitions and places Risers, Reverse Cymbals, Sweeps,
 * and Sub-Impacts onto Tracks 20 and 21 leading 1-2 bars into the next section.
 */
export function detectAndPlaceTransitionFx(
  sections: SongSectionSegment[]
): TransitionFxEvent[] {
  const events: TransitionFxEvent[] = [];

  for (let i = 0; i < sections.length - 1; i++) {
    const curr = sections[i];
    const next = sections[i + 1];
    const boundaryBar = next.startBar;
    const prevSpan = Math.max(1, curr.endBar - curr.startBar);

    const isGrooveDropIn = !curr.hasPercussion && next.hasPercussion;
    const isChorusDrop = next.type === 'chorus' && curr.type !== 'chorus';
    const isBreakdownDropOut = curr.hasPercussion && !next.hasPercussion;
    const energyJump = next.avgEnergy - curr.avgEnergy;

    if (isGrooveDropIn || isChorusDrop || energyJump >= 0.16) {
      const riserBars = Math.min(2, prevSpan);
      const riserStartBar = Math.max(0, boundaryBar - riserBars);
      events.push({
        id: `fx-riser-${boundaryBar}`,
        type: 'riser',
        label: 'Tension Riser',
        trackNumber: 20,
        startBar: riserStartBar,
        durationBars: riserBars,
        triggerStep: riserStartBar * 16,
        durationSteps: riserBars * 16,
        intensity: isChorusDrop ? 0.96 : 0.85,
      });

      const revStartBar = Math.max(0, boundaryBar - 1);
      events.push({
        id: `fx-revcym-${boundaryBar}`,
        type: 'reverse_cymbal',
        label: 'Reverse Cymbal',
        trackNumber: 21,
        startBar: revStartBar,
        durationBars: 1,
        triggerStep: revStartBar * 16,
        durationSteps: 16,
        intensity: 0.88,
      });

      events.push({
        id: `fx-impact-${boundaryBar}`,
        type: 'sub_impact',
        label: 'Drop Sub-Impact',
        trackNumber: 21,
        startBar: boundaryBar,
        durationBars: 1,
        triggerStep: boundaryBar * 16,
        durationSteps: 8,
        intensity: isChorusDrop ? 1.0 : 0.88,
      });
    } else if (isBreakdownDropOut) {
      const sweepStartBar = Math.max(0, boundaryBar - 1);
      events.push({
        id: `fx-sweep-${boundaryBar}`,
        type: 'sweep',
        label: 'Downlift Sweep',
        trackNumber: 20,
        startBar: sweepStartBar,
        durationBars: 1,
        triggerStep: sweepStartBar * 16,
        durationSteps: 16,
        intensity: 0.78,
      });
      events.push({
        id: `fx-soft-impact-${boundaryBar}`,
        type: 'sub_impact',
        label: 'Soft Sub-Impact',
        trackNumber: 21,
        startBar: boundaryBar,
        durationBars: 1,
        triggerStep: boundaryBar * 16,
        durationSteps: 8,
        intensity: 0.62,
      });
    } else if (next.type === 'bridge' || curr.type !== next.type) {
      const sweepStartBar = Math.max(0, boundaryBar - 1);
      events.push({
        id: `fx-sweep-bridge-${boundaryBar}`,
        type: 'sweep',
        label: 'Air Sweep',
        trackNumber: 20,
        startBar: sweepStartBar,
        durationBars: 1,
        triggerStep: sweepStartBar * 16,
        durationSteps: 16,
        intensity: 0.74,
      });
    }
  }

  return events.sort((a, b) => a.triggerStep - b.triggerStep || a.trackNumber - b.trackNumber);
}

/**
 * Generates a real multi-section 16-bar (32s @ 120 BPM) synthesized reference track
 * with distinct Intro (no drums), Verse (groove + bass/keys), Chorus/Drop (full bright ensemble),
 * Breakdown (quiet pad only), and Outro for immediate auditioning.
 */
export function createSyntheticDemoReferencePcm(
  sampleRate = 22050,
  bpm = 120
): { pcm: Float32Array; sampleRate: number; durationSec: number } {
  const barDurSec = (60 / bpm) * 4; // 2.0s per bar at 120 BPM
  const totalBars = 16;
  const durationSec = totalBars * barDurSec;
  const totalSamples = Math.floor(durationSec * sampleRate);
  const pcm = new Float32Array(totalSamples);

  const chords = [
    [261.63, 329.63, 392.0], // C major
    [220.0, 261.63, 329.63], // A minor
    [174.61, 220.0, 261.63], // F major
    [196.0, 246.94, 293.66], // G major
  ];
  const bassFreqs = [65.41, 55.0, 87.31, 98.0];
  const leadFreqs = [523.25, 659.25, 587.33, 493.88, 523.25, 659.25, 783.99, 659.25];

  let seed = 1337;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const barF = t / barDurSec;
    const bar = Math.min(totalBars - 1, Math.floor(barF));
    const beatF = (barF - bar) * 4;
    const stepF = (barF - bar) * 16;
    const stepIdx = Math.floor(stepF);
    const stepFrac = stepF - stepIdx;

    const chord = chords[bar % chords.length];
    const bassF = bassFreqs[bar % bassFreqs.length];

    let sample = 0;

    // Warm pad chords across entire song (soft in Intro Bars 0..1 & Breakdown Bars 12..13)
    const padGain = bar < 2 || (bar >= 12 && bar <= 13) ? 0.16 : bar >= 14 ? 0.12 : 0.22;
    for (const f of chord) {
      sample += Math.sin(2 * Math.PI * f * t) * (padGain / 3);
    }

    // Bass + Electric Piano chords in Verse (Bars 2..7) and Chorus (Bars 8..11)
    if (bar >= 2 && bar <= 11) {
      const bassEnv = Math.exp(-stepFrac * 0.65);
      const isBassHit = stepIdx % 4 === 0 || stepIdx === 6 || stepIdx === 14;
      if (isBassHit) {
        sample += Math.sin(2 * Math.PI * bassF * t) * 0.24 * bassEnv;
      }
      // Bright chord stabs on Beats 1 & 3
      if (stepIdx % 8 === 0 || stepIdx % 8 === 3) {
        const keyEnv = Math.exp(-stepFrac * 0.9);
        for (const f of chord) {
          sample += Math.sin(2 * Math.PI * f * 2 * t) * 0.08 * keyEnv;
        }
      }
    }

    // Percussion groove + bright Chorus Lead in Verse/Chorus (Bars 2..11), absent in Intro/Breakdown/Outro!
    if (bar >= 2 && bar <= 11) {
      const isChorus = bar >= 8 && bar <= 11;
      // High-freq shaker bursts every 8th note (2x louder in chorus)
      if (stepIdx % 2 === 0 && stepFrac < 0.45) {
        const shakerEnv = Math.exp(-stepFrac * 10);
        sample += nextRand() * (isChorus ? 0.24 : 0.13) * shakerEnv;
      }
      // Chorus melody & bright brass harmonics
      if (isChorus) {
        const leadF = leadFreqs[(bar * 4 + Math.floor(beatF)) % leadFreqs.length];
        sample +=
          (Math.sin(2 * Math.PI * leadF * t) * 0.18 +
            Math.sin(2 * Math.PI * leadF * 2 * t) * 0.08) *
          (0.65 + 0.35 * Math.exp(-(beatF % 1) * 3));
      }
    }

    // Gentle fade on Outro Bars 14..15
    if (bar >= 14) {
      const outroProg = (barF - 14) / 2;
      sample *= Math.max(0.12, 1 - outroProg * 0.8);
    }

    pcm[i] = Math.max(-0.95, Math.min(0.95, sample));
  }

  return { pcm, sampleRate, durationSec };
}

/**
 * Builds the complete 20+ track ReferenceDecompositionResult given decoded audio +
 * polyphonic Basic Pitch MIDI notes.
 */
export function assembleReferenceDecomposition(params: {
  fileName: string;
  durationSec: number;
  bpm: number;
  beatOffsetSec: number;
  harmonicPcm: Float32Array;
  sampleRate: number;
  barMetrics: BarAcousticMetric[];
  sections: SongSectionSegment[];
  totalBars: number;
  extractedNotes: ExtractedPolyphonicNote[];
}): ReferenceDecompositionResult {
  const {
    fileName,
    durationSec,
    bpm,
    beatOffsetSec,
    harmonicPcm,
    sampleRate,
    barMetrics,
    sections,
    totalBars,
    extractedNotes,
  } = params;

  const keyResult = detectReferenceKey(harmonicPcm, sampleRate, extractedNotes);
  const track1Clips = buildTrack1PercussionClips(sections);
  const instrumentTracks = allocateMidiTo18InstrumentTracks(
    extractedNotes,
    totalBars,
    harmonicPcm,
    sampleRate
  );
  const transitionFxEvents = detectAndPlaceTransitionFx(sections);

  return {
    fileName,
    durationSec,
    bpm,
    beatOffsetSec,
    rootKey: keyResult.rootKey,
    scaleType: keyResult.scaleType,
    keyConfidence: keyResult.confidence,
    totalBars,
    totalSteps: totalBars * 16,
    barMetrics,
    sections,
    track1Clips,
    track1Muted: false,
    track1Soloed: false,
    track1VolumeDb: -1.5,
    instrumentTracks,
    transitionFxEvents,
    fxMuted: false,
    fxSoloed: false,
    fxVolumeDb: -2.0,
  };
}

/**
 * Mixes an AudioBuffer safely to mono 22,050 Hz (capped to 5 minutes) for fast DSP & Basic Pitch analysis.
 */
export function extractMonoAndHarmonicForAnalysis(
  audioBuffer: AudioBuffer,
  maxSeconds = 300
): {
  monoPcm: Float32Array;
  harmonicPcm: Float32Array;
  sampleRate: number;
  durationSec: number;
} {
  const sr = audioBuffer.sampleRate;
  const maxFrames = Math.min(audioBuffer.length, Math.floor(maxSeconds * sr));
  const targetSr = 22050;
  const ratio = sr / targetSr;
  const outLen = Math.max(1024, Math.floor(maxFrames / ratio));

  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;

  const left22 = new Float32Array(outLen);
  const right22 = ch1 ? new Float32Array(outLen) : null;
  const monoPcm = new Float32Array(outLen);

  for (let i = 0; i < outLen; i++) {
    const idx = Math.min(maxFrames - 1, Math.floor(i * ratio));
    const l = ch0[idx] ?? 0;
    const r = ch1 ? ch1[idx] ?? 0 : l;
    left22[i] = l;
    if (right22) right22[i] = r;
    monoPcm[i] = ch1 ? 0.5 * (l + r) : l;
  }

  const harmonicPcm = separateHarmonicStemPcm(left22, right22, targetSr);
  return {
    monoPcm,
    harmonicPcm,
    sampleRate: targetSr,
    durationSec: outLen / targetSr,
  };
}

export function getStepDurationForDecomposition(bpm: number): number {
  return getStepDurationSeconds(bpm);
}

export type SectionArchetype = 'intro' | 'verse' | 'chorus';

export interface SectionRepresentativeSlice {
  archetype: SectionArchetype;
  barIndex: number;
  pcm: Float32Array;
}

export function mapSectionTypeToArchetype(type: SongSectionType): SectionArchetype {
  if (type === 'chorus') return 'chorus';
  if (type === 'intro' || type === 'breakdown' || type === 'outro') return 'intro';
  return 'verse';
}

/**
 * Selects up to 3 single-frame (<=39,900 samples @ 22.05kHz) representative harmonic bars
 * spanning Chorus, Verse/Bridge, and Intro/Breakdown so software/CPU devices run real
 * BasicPitch inference in ~10s instead of stalling on long sequential passes.
 */
export function extractSectionRepresentativeSlices(
  harmonicPcm: Float32Array,
  sampleRate: number,
  bpm: number,
  sections: SongSectionSegment[],
  barMetrics: BarAcousticMetric[]
): SectionRepresentativeSlice[] {
  if (harmonicPcm.length < 1024 || sections.length === 0) return [];
  const barDurSec = (60 / Math.max(40, bpm)) * 4;
  const barSamples = Math.max(1024, Math.floor(barDurSec * sampleRate));
  // Cap at 39,900 samples (@ 22.05kHz = 1.81s) so BasicPitch processes exactly 1 window cleanly
  const maxSliceSamples = Math.max(1024, Math.floor(1.809 * sampleRate));

  const picked = new Map<SectionArchetype, number>();
  const priorityOrder: SectionArchetype[] = ['chorus', 'verse', 'intro'];

  for (const arch of priorityOrder) {
    let bestBar = -1;
    let bestEnergy = -1;
    for (const sec of sections) {
      if (mapSectionTypeToArchetype(sec.type) !== arch) continue;
      for (let b = sec.startBar; b < sec.endBar; b++) {
        const energy = barMetrics[b]?.rmsEnergy ?? sec.avgEnergy;
        if (energy > bestEnergy) {
          bestEnergy = energy;
          bestBar = b;
        }
      }
    }
    if (bestBar >= 0 && bestEnergy > 0.03) {
      picked.set(arch, bestBar);
    }
  }

  const slices: SectionRepresentativeSlice[] = [];
  for (const [arch, barIndex] of picked.entries()) {
    const start = Math.max(0, Math.min(harmonicPcm.length - 1024, barIndex * barSamples));
    const end = Math.min(harmonicPcm.length, start + Math.min(barSamples, maxSliceSamples));
    if (end - start >= 1024) {
      slices.push({
        archetype: arch,
        barIndex,
        pcm: harmonicPcm.slice(start, end),
      });
    }
  }
  return slices;
}

/**
 * Expands 1-bar BasicPitch notes extracted for section archetypes cleanly across every
 * matching bar in the song structure, respecting each bar's acoustic energy.
 */
export function expandSectionNotesAcrossSong(params: {
  archetypeNotes: Partial<Record<SectionArchetype, ExtractedPolyphonicNote[]>>;
  sections: SongSectionSegment[];
  barMetrics: BarAcousticMetric[];
  bpm: number;
  totalBars: number;
}): ExtractedPolyphonicNote[] {
  const { archetypeNotes, sections, barMetrics, bpm, totalBars } = params;
  const barDurSec = (60 / Math.max(40, bpm)) * 4;
  const stepDurSec = getStepDurationSeconds(bpm);
  const out: ExtractedPolyphonicNote[] = [];

  for (let bar = 0; bar < totalBars; bar++) {
    const metric = barMetrics[bar];
    const energy = metric?.rmsEnergy ?? 0.5;
    if (energy < 0.03) continue;

    const sec = sections.find((s) => bar >= s.startBar && bar < s.endBar);
    const arch = mapSectionTypeToArchetype(sec?.type ?? 'verse');

    let sourceNotes = archetypeNotes[arch];
    let energyScale = Math.max(0.5, Math.min(1.05, 0.65 + energy * 0.4));
    if ((!sourceNotes || sourceNotes.length === 0) && arch === 'intro') {
      // Quiet intro/breakdown sustains gently if BasicPitch found few sparse transients in the quiet slice
      sourceNotes = archetypeNotes.verse ?? archetypeNotes.chorus;
      energyScale *= 0.68;
    } else if (!sourceNotes || sourceNotes.length === 0) {
      sourceNotes = archetypeNotes.verse ?? archetypeNotes.chorus ?? archetypeNotes.intro;
    }
    if (!sourceNotes || sourceNotes.length === 0) continue;

    for (const n of sourceNotes) {
      const barStep = ((n.step % 16) + 16) % 16;
      if (arch === 'intro' && (barStep % 8 !== 0 || n.durationSteps < 2)) {
        // Keep intro/breakdown spacious (longer harmonic pads/chords rather than fast busy phrases)
        continue;
      }
      const absStep = bar * 16 + barStep;
      const absStartSec = bar * barDurSec + barStep * stepDurSec;
      out.push({
        ...n,
        step: absStep,
        velocity: Math.max(24, Math.min(100, Math.round(n.velocity * energyScale))),
        startTimeSeconds: absStartSec,
      });
    }
  }

  return out.sort((a, b) => a.step - b.step || a.midi - b.midi);
}

