export type LoopBars = 1 | 2 | 4;

export type StudioPage = 'compose' | 'extract' | 'taploop' | 'sequencer';

export type AnalysisMode = 'compose' | 'extract';

export interface SampleCandidate {
  id: string;
  name: string;
  url: string;
  source: 'freesound' | 'cdn' | 'synth' | 'custom';
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
