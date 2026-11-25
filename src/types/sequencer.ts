export type LoopBars = 1 | 2 | 4;

export interface SampleCandidate {
  id: string;
  name: string;
  url: string;
  source: 'freesound' | 'cdn' | 'synth';
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

export type GeminiAnalysisModel = 'gemini-2.5-flash' | 'gemini-2.5-pro';
