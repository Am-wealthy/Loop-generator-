export type LoopBars = 1 | 2 | 4;

export type StudioPage = 'compose' | 'extract' | 'taploop' | 'sequencer' | 'stems';

export type AnalysisMode = 'compose' | 'extract';

export interface SampleCandidate {
  id: string;
  name: string;
  url: string;
  source: 'freesound' | 'secondary' | 'cdn' | 'synth' | 'custom';
  duration?: number;
  username?: string;
  tags?: string[];
}

export interface PercussionTrack {
  instrument_id: string;
  display_name: string;
  sample_search_query: string;
  volume_db: number;
  pan: number;
  steps: number[]; // 64 integers (0 = off, 1-100 = velocity)
  muted?: boolean;
  soloed?: boolean;
  isClick?: boolean;
  samples?: SampleCandidate[];
  activeSampleIndex?: number;
}

export interface ArrangementBlueprint {
  detected_bpm: number;
  groove_style: string;
  time_signature: string;
  has_existing_percussion: boolean;
  tracks: PercussionTrack[];
}

export type AnalysisStatus = 'idle' | 'analyzing' | 'ready' | 'error';

export interface TapPresetOption {
  id: string;
  label: string;
  category: string;
  accentColor: 'amber' | 'emerald';
  sample: SampleCandidate;
}

export type ReverbRoomSize = 'room' | 'hall' | 'cathedral';

export interface TapLoopSettings {
  cutoffHz: number; // 180 .. 18000 Hz low-pass filter
  resonanceQ: number; // 0.5 .. 8.0 filter warmth
  masterReverb: number; // 0 .. 1 general reverb level
  reverbSize: ReverbRoomSize;
}

export interface TapPad {
  id: string;
  name: string;
  category: string;
  accentColor: 'amber' | 'emerald';
  sample: SampleCandidate;
  customFileName?: string;
  steps: number[]; // 64 integers (0 = off, 1-100 = velocity, locked to master BPM)
  muted: boolean;
  soloed?: boolean;
  volume_db: number;
  reverb: number; // 0 .. 1 per-percussion reverb send
}

export type ExportFormat = 'wav-studio' | 'wav-compact';

export interface ExportOptions {
  durationMode: 'default' | 'minutes';
  minutes: number; // 1 .. 15 when durationMode === 'minutes'
  cutoffHz: number; // 180 .. 18000 Hz
  resonanceQ: number; // 0.5 .. 8
  reverbAmount: number; // 0 .. 1
  reverbSize: ReverbRoomSize;
  format: ExportFormat;
  includeClick: boolean;
  includeOriginalBlend: boolean;
  normalizePeak: boolean;
}

export type VoiceActionType =
  | 'set_groove_pattern'
  | 'set_bpm'
  | 'transport'
  | 'set_metronome'
  | 'set_loop_bars'
  | 'navigate_page'
  | 'mute_solo_track'
  | 'set_fx'
  | 'open_export';

export interface VoiceAction {
  type: VoiceActionType;
  instrument_keyword?: string;
  display_name?: string;
  steps?: number[];
  mode?: 'replace' | 'layer' | 'clear';
  bpm?: number;
  state?: 'play' | 'stop';
  enabled?: boolean;
  bars?: LoopBars;
  page?: StudioPage;
  muted?: boolean;
  soloed?: boolean;
  cutoffHz?: number;
  masterReverb?: number;
  durationMinutes?: number;
}

export interface VoiceCommandResponse {
  spoken_summary: string;
  actions: VoiceAction[];
}

export type KeyboardSoundId =
  | 'grand_piano'
  | 'rhodes_ep'
  | 'gospel_organ'
  | 'synth_lead'
  | 'synth_brass'
  | 'warm_pad'
  | 'strings'
  | 'worship_bass'
  | 'sub_bass'
  | 'marimba_pluck'
  | 'choir_voice';

export type StemVoiceMode = 'keyboard' | 'hum_audio' | 'custom_sample';

export type StemLoopSource = 'sequencer' | 'taploop' | 'phone_audio';

export type ScaleType = 'major' | 'minor' | 'pentatonic';

export interface StemNote {
  step: number; // 0+ (supports extended multi-bar song timelines)
  midi: number; // 36..84
  durationSteps: number; // 1..32
  velocity: number; // 1..100
  startOffsetSteps?: number; // -0.5..0.5 sub-step micro-timing offset
  exactDurationSteps?: number; // Exact duration in steps (preserves fast 30ms notes)
  pitchBendSemitones?: number[]; // Continuous smoothed pitch-bend curve in semitones
  velocityCurve?: number[]; // Continuous normalized volume/expression curve [0..1]
}

export interface StemChannel {
  id: string;
  name: string;
  color: 'amber' | 'emerald' | 'sky' | 'rose' | 'violet';
  soundId: KeyboardSoundId;
  customVoiceSample?: SampleCandidate;
  voiceMode: StemVoiceMode;
  hasHumAudio: boolean;
  muted: boolean;
  soloed: boolean;
  volume_db: number;
  pan: number;
  totalSteps?: number; // Bar-aligned timeline length (extends past 64 when singing longer phrases)
  notes: StemNote[];
}

export type StemSubPage = 'studio' | 'decomposer';

export type SongSectionType =
  | 'intro'
  | 'verse'
  | 'chorus'
  | 'breakdown'
  | 'bridge'
  | 'outro';

export interface BarAcousticMetric {
  barIndex: number; // 0-based
  rmsEnergy: number; // 0..1 normalized
  lowBandEnergy: number; // 0..1 normalized
  percussionTransientScore: number; // 0..1 normalized
  spectralBrightness: number; // 0..1 normalized
  spectralFluxDelta: number; // 0..1 normalized bar-to-bar change
  hasPercussion: boolean;
}

export interface SongSectionSegment {
  id: string;
  type: SongSectionType;
  label: string;
  startBar: number; // 0-based inclusive
  endBar: number; // 0-based exclusive (count = endBar - startBar)
  hasPercussion: boolean;
  grooveDensity: 'none' | 'light' | 'medium' | 'full';
  avgEnergy: number;
  spectralBrightness: number;
}

export type PercussionLoopPresetId =
  | 'shaker_pulse'
  | 'highlife_verse'
  | 'afro_chorus_lift'
  | 'bridge_groove';

export interface Track1LoopClip {
  id: string;
  startBar: number;
  endBar: number;
  loopPresetId: PercussionLoopPresetId;
  label: string;
  sectionLabel: string;
  intensity: number; // 0.35..1.0
}

export interface DecomposedInstrumentTrack {
  trackNumber: number; // 2..19 (up to 18 channels)
  id: string;
  name: string;
  presetLabel: string;
  register: 'bass' | 'mid' | 'high';
  soundId: KeyboardSoundId;
  color: StemChannel['color'];
  isActive: boolean;
  activeBars: number[];
  muted: boolean;
  soloed: boolean;
  volume_db: number;
  pan: number;
  notes: StemNote[];
}

export type TransitionFxType =
  | 'riser'
  | 'reverse_cymbal'
  | 'sweep'
  | 'sub_impact';

export interface TransitionFxEvent {
  id: string;
  type: TransitionFxType;
  label: string;
  trackNumber: 20 | 21;
  startBar: number;
  durationBars: number;
  triggerStep: number;
  durationSteps: number;
  intensity: number; // 0.4..1.0
}

export interface ReferenceDecompositionResult {
  fileName: string;
  durationSec: number;
  bpm: number;
  beatOffsetSec: number;
  rootKey: 'C' | 'C#' | 'D' | 'Eb' | 'E' | 'F' | 'F#' | 'G' | 'Ab' | 'A' | 'Bb' | 'B';
  scaleType: ScaleType;
  keyConfidence: number;
  totalBars: number;
  totalSteps: number;
  barMetrics: BarAcousticMetric[];
  sections: SongSectionSegment[];
  track1Clips: Track1LoopClip[];
  track1Muted: boolean;
  track1Soloed: boolean;
  track1VolumeDb: number;
  instrumentTracks: DecomposedInstrumentTrack[]; // 18 channels (Tracks 02..19)
  transitionFxEvents: TransitionFxEvent[]; // Tracks 20..21
  fxMuted: boolean;
  fxSoloed: boolean;
  fxVolumeDb: number;
}
