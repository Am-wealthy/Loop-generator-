import type {
  KeyboardSoundId,
  ScaleType,
  StemChannel,
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
  const safeStep = Math.max(0, Math.min(63, Math.round(step)));
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
      durationSteps: Math.max(1, Math.min(16, Math.round(durationSteps))),
      velocity: Math.max(20, Math.min(100, Math.round(velocity))),
    },
  ].sort((a, b) => a.step - b.step || b.midi - a.midi);
}

export function upsertStemNote(notes: StemNote[], incoming: StemNote): StemNote[] {
  const safeStep = Math.max(0, Math.min(63, Math.round(incoming.step)));
  const safeMidi = clampMidi(incoming.midi);
  const filtered = notes.filter((n) => !(n.step === safeStep && n.midi === safeMidi));
  return [
    ...filtered,
    {
      step: safeStep,
      midi: safeMidi,
      durationSteps: Math.max(1, Math.min(16, Math.round(incoming.durationSteps || 2))),
      velocity: Math.max(20, Math.min(100, Math.round(incoming.velocity || 88))),
    },
  ].sort((a, b) => a.step - b.step || b.midi - a.midi);
}

/**
 * Pure normalized autocorrelation fundamental frequency detector tuned for
 * human singing & humming (75 Hz - 880 Hz). Returns null on silence or unvoiced noise.
 */
export function detectPitchHzAutocorrelation(
  samples: Float32Array,
  sampleRate: number,
  minRms = 0.015
): number | null {
  const n = samples.length;
  if (n < 256 || sampleRate <= 0) return null;

  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / n);
  if (rms < minRms) return null;

  const minLag = Math.max(8, Math.floor(sampleRate / 880));
  const maxLag = Math.min(Math.floor(n / 2), Math.floor(sampleRate / 75));
  if (maxLag <= minLag) return null;

  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let cross = 0;
    let normA = 0;
    let normB = 0;
    const limit = n - lag;
    for (let i = 0; i < limit; i++) {
      const a = samples[i];
      const b = samples[i + lag];
      cross += a * b;
      normA += a * a;
      normB += b * b;
    }
    const denom = Math.sqrt(normA * normB);
    if (denom <= 1e-8) continue;
    const corr = cross / denom;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestCorr < 0.72) {
    return null;
  }

  return sampleRate / bestLag;
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
      id: 'stem-rhodes',
      name: 'Gospel Rhodes Chords',
      color: 'amber',
      soundId: 'rhodes_ep',
      voiceMode: 'keyboard',
      hasHumAudio: false,
      muted: false,
      soloed: false,
      volume_db: -2,
      pan: -0.15,
      notes: [
        // Classic Highlife I - IV - V - I progression across 4 bars (C Maj)
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
      name: 'Praise Bassline',
      color: 'emerald',
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
    {
      id: 'stem-hum-lead',
      name: 'Vocal / Hum Lead',
      color: 'sky',
      soundId: 'grand_piano',
      voiceMode: 'keyboard',
      hasHumAudio: false,
      muted: false,
      soloed: false,
      volume_db: -1.5,
      pan: 0.15,
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
  ];
}

export function createNextStemChannel(
  existingCount: number,
  soundId: KeyboardSoundId = 'synth_brass'
): StemChannel {
  const preset =
    KEYBOARD_SOUND_PRESETS.find((p) => p.id === soundId) ?? KEYBOARD_SOUND_PRESETS[0];
  const color = CHANNEL_COLORS[existingCount % CHANNEL_COLORS.length];
  return {
    id: `stem-${Date.now()}-${existingCount + 1}`,
    name: `${preset.shortLabel} ${existingCount + 1}`,
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
