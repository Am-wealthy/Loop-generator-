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

export interface TapLoopEvent {
  id: string;
  phase: number; // Normalized [0, 1) position inside the active loop cycle
  velocity: number; // 1-100
  skipUntilCtxTime?: number; // Prevents same-pass double trigger on live tap
}

export interface TapPresetOption {
  id: string;
  label: string;
  category: string;
  accentColor: 'amber' | 'emerald';
  sample: SampleCandidate;
}

export interface TapPad {
  id: string;
  name: string;
  category: string;
  accentColor: 'amber' | 'emerald';
  sample: SampleCandidate;
  customFileName?: string;
  events: TapLoopEvent[];
  muted: boolean;
  volume_db: number;
}
