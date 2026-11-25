export type LoopBars = 1 | 2 | 4;

export type StudioPage = 'compose' | 'extract' | 'taploop' | 'sequencer';

export type AnalysisMode = 'compose' | 'extract';

export interface SampleCandidate {
  id: string;
  name: string;
  url: string;
  source: 'freesound' | 'cdn' | 'synth' | 'custom';
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
