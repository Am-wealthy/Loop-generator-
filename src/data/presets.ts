import type {
  ArrangementBlueprint,
  SampleCandidate,
  TapPresetOption,
} from '../types/sequencer.ts';

const DIRT_BASE = 'https://cdn.jsdelivr.net/gh/tidalcycles/Dirt-Samples@master';

function cdnSample(id: string, name: string, path: string): SampleCandidate {
  const encodedPath = path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return {
    id,
    name,
    url: `${DIRT_BASE}/${encodedPath}`,
    source: 'cdn',
  };
}

export const FALLBACK_SAMPLE_CATALOG: Record<string, SampleCandidate[]> = {
  shekere: [
    cdnSample('cdn-shekere-1', 'Cabasa Acoustic Tight', 'drumtraks/000_DT Cabasa.wav'),
    cdnSample('cdn-shekere-2', 'Shaker Crisp Shot', 'future/013_Shake2.wav'),
    cdnSample('cdn-shekere-3', 'Shaker Wide Brush', 'future/014_Shake4.wav'),
    cdnSample('cdn-shekere-4', 'Studio Maraca Accent', 'odx/002_DXShaker.wav'),
    cdnSample('cdn-shekere-5', 'Crisp Acoustic Hat', 'gretsch/004_closedhat.wav'),
  ],
  wooden_agogo: [
    cdnSample('cdn-agogo-1', 'Nipon Wood Block Hi', 'east/000_nipon_wood_block.wav'),
    cdnSample('cdn-agogo-2', 'Shime Wood Rim Hi', 'east/003_shime_hi.wav'),
    cdnSample('cdn-agogo-3', 'Shime Wood Rim Lo', 'east/004_shime_hi_2.wav'),
    cdnSample('cdn-agogo-4', 'Dry Rimshot Knock', 'drumtraks/008_DT Rimshot.wav'),
    cdnSample('cdn-agogo-5', 'Wood Clave Snap', 'odx/003_DXRimshot.wav'),
  ],
  conga_slap: [
    cdnSample('cdn-conga-slap-1', 'Conga Slap Mute', 'future/015_lockett_conga_mute2.wav'),
    cdnSample('cdn-conga-slap-2', 'Hand Drum Slap 1', 'hand/hand1-mono.wav'),
    cdnSample('cdn-conga-slap-3', 'Hand Drum Slap 2', 'hand/hand3-mono.wav'),
    cdnSample('cdn-conga-slap-4', 'Hand Drum Slap 3', 'hand/hand4-mono.wav'),
    cdnSample('cdn-conga-slap-5', 'Hand Drum Slap 4', 'hand/hand7-mono.wav'),
  ],
  conga_low_open: [
    cdnSample('cdn-conga-open-1', 'Conga Open Warm', 'future/016_lockett_conga_open1.wav'),
    cdnSample('cdn-conga-open-2', 'Hand Drum Open 1', 'hand/hand2-mono.wav'),
    cdnSample('cdn-conga-open-3', 'Hand Drum Open 2', 'hand/hand8-mono.wav'),
    cdnSample('cdn-conga-open-4', 'Hand Drum Open 3', 'hand/hand9-mono.wav'),
    cdnSample('cdn-conga-open-5', 'Ohkawa Open Tone', 'east/002_ohkawa_open.wav'),
  ],
  cowbell: [
    cdnSample('cdn-cowbell-1', 'Gretsch Brass Cowbell', 'gretsch/006_cowbell.wav'),
    cdnSample('cdn-cowbell-2', 'Classic Stage Cowbell', 'drumtraks/002_DT Cowbell.wav'),
    cdnSample('cdn-cowbell-3', 'Ride Bell Bright', 'gretsch/018_ridebell.wav'),
    cdnSample('cdn-cowbell-4', 'Metallic Agogo Bell 1', 'perc/000_perc0.wav'),
    cdnSample('cdn-cowbell-5', 'Metallic Agogo Bell 2', 'perc/001_perc1.wav'),
  ],
  tambourine: [
    cdnSample('cdn-tamb-1', 'Acoustic Tambourine Hit', 'drumtraks/010_DT Tambourine.wav'),
    cdnSample('cdn-tamb-2', 'Brass Foot Chick 1', 'gretsch/010_foothat.wav'),
    cdnSample('cdn-tamb-3', 'Brass Foot Chick 2', 'gretsch/011_foothat2.wav'),
    cdnSample('cdn-tamb-4', 'Tight Jingle Shimmer', 'future/012_Mhhcf3.wav'),
    cdnSample('cdn-tamb-5', 'Open Brass Jingle', 'gretsch/016_openclosedhat.wav'),
  ],
  talking_drum: [
    cdnSample('cdn-talking-1', 'Gangan Pitch Tone 1', 'east/006_taiko_1.wav'),
    cdnSample('cdn-talking-2', 'Gangan Pitch Tone 2', 'east/007_taiko_2.wav'),
    cdnSample('cdn-talking-3', 'Gangan Pitch Tone 3', 'east/008_taiko_3.wav'),
    cdnSample('cdn-talking-4', 'Hand Drum Phrase 1', 'hand/hand11-mono.wav'),
    cdnSample('cdn-talking-5', 'Hand Drum Phrase 2', 'hand/hand12-mono.wav'),
  ],
  click_hi: [
    { id: 'synth-click-hi', name: 'Studio Click Hi (Beat 1)', url: 'synth://click_hi', source: 'synth' },
    cdnSample('cdn-click-hi-2', 'Woodblock Click Hi', 'east/000_nipon_wood_block.wav'),
  ],
  click_lo: [
    { id: 'synth-click-lo', name: 'Studio Click Lo (2,3,4)', url: 'synth://click_lo', source: 'synth' },
    cdnSample('cdn-click-lo-2', 'Woodblock Click Lo', 'east/004_shime_hi_2.wav'),
  ],
};

// Helper to repeat a 16-step bar pattern cleanly or build 4-bar variations
function repeatBars(bar1: number[], bar2?: number[], bar3?: number[], bar4?: number[]): number[] {
  return [
    ...bar1,
    ...(bar2 ?? bar1),
    ...(bar3 ?? bar1),
    ...(bar4 ?? bar2 ?? bar1),
  ];
}

// Authentic 126 BPM Nigerian Highlife 4-Bar (64-Step) Startup Arrangement
// Sits cleanly with a live church drummer (no heavy acoustic kick)
export const INITIAL_HIGHLIFE_ARRANGEMENT: ArrangementBlueprint = {
  detected_bpm: 126,
  groove_style: 'Nigerian Highlife Praise',
  time_signature: '4/4 Highlife',
  has_existing_percussion: true,
  tracks: [
    {
      instrument_id: 'shekere',
      display_name: 'Shekere',
      sample_search_query: 'shekere one shot',
      volume_db: -3.5,
      pan: 0.25,
      steps: repeatBars(
        [95, 42, 72, 48, 90, 44, 75, 48, 95, 42, 72, 48, 90, 44, 78, 52],
        [95, 42, 72, 48, 90, 44, 75, 48, 95, 42, 72, 48, 92, 50, 82, 60]
      ),
    },
    {
      instrument_id: 'wooden_agogo',
      display_name: 'Wooden Agogo',
      sample_search_query: 'wooden agogo',
      volume_db: -2.0,
      pan: -0.3,
      // Classic Highlife 3-2 / 2-3 timeline clave phrasing
      steps: repeatBars(
        [96, 0, 0, 88, 0, 0, 92, 0, 0, 0, 85, 0, 90, 0, 0, 0],
        [96, 0, 0, 88, 0, 0, 92, 0, 0, 0, 86, 0, 88, 0, 72, 0]
      ),
    },
    {
      instrument_id: 'conga_slap',
      display_name: 'Conga Slap',
      sample_search_query: 'conga slap',
      volume_db: -2.5,
      pan: -0.45,
      steps: repeatBars(
        [0, 0, 0, 68, 92, 0, 0, 74, 0, 0, 0, 68, 94, 0, 70, 0],
        [0, 0, 0, 68, 92, 0, 0, 76, 0, 0, 80, 0, 96, 72, 0, 64]
      ),
    },
    {
      instrument_id: 'conga_low_open',
      display_name: 'Conga Low Open',
      sample_search_query: 'conga low open',
      volume_db: -3.0,
      pan: 0.4,
      steps: repeatBars(
        [82, 0, 0, 0, 0, 0, 86, 0, 0, 0, 88, 0, 0, 0, 0, 76],
        [82, 0, 0, 0, 0, 0, 86, 0, 0, 78, 0, 0, 0, 0, 84, 88]
      ),
    },
    {
      instrument_id: 'cowbell',
      display_name: 'Cowbell',
      sample_search_query: 'cowbell',
      volume_db: -5.5,
      pan: 0.15,
      steps: repeatBars(
        [88, 0, 0, 0, 78, 0, 0, 0, 88, 0, 0, 0, 78, 0, 70, 0],
        [88, 0, 0, 0, 78, 0, 0, 0, 88, 0, 72, 0, 82, 0, 74, 0]
      ),
    },
    {
      instrument_id: 'tambourine',
      display_name: 'Tambourine',
      sample_search_query: 'tambourine hit',
      volume_db: -4.5,
      pan: -0.2,
      steps: repeatBars(
        [0, 0, 84, 0, 0, 0, 84, 0, 0, 0, 84, 0, 0, 0, 86, 48]
      ),
    },
    {
      instrument_id: 'talking_drum',
      display_name: 'Talking Drum',
      sample_search_query: 'talking drum',
      volume_db: -3.0,
      pan: 0.0,
      // Melodic turnaround phrases in bars 2 and 4
      steps: repeatBars(
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 78, 0, 86, 0, 92, 74, 88, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 76, 84, 90, 0, 82, 92, 96, 80, 90, 72]
      ),
    },
    {
      instrument_id: 'click_hi',
      display_name: 'Click Hi (Beat 1)',
      sample_search_query: 'metronome click high',
      volume_db: -2.0,
      pan: 0.0,
      isClick: true,
      steps: repeatBars([100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    },
    {
      instrument_id: 'click_lo',
      display_name: 'Click Lo (2, 3, 4)',
      sample_search_query: 'metronome click low',
      volume_db: -4.0,
      pan: 0.0,
      isClick: true,
      steps: repeatBars([0, 0, 0, 0, 88, 0, 0, 0, 88, 0, 0, 0, 88, 0, 0, 0]),
    },
  ],
};

export const TAP_PAD_PRESETS: TapPresetOption[] = [
  {
    id: 'preset-shekere',
    label: 'Shekere Shaker',
    category: 'Shaker',
    accentColor: 'amber',
    sample: FALLBACK_SAMPLE_CATALOG.shekere[0],
  },
  {
    id: 'preset-agogo',
    label: 'Wooden Agogo',
    category: 'Timeline',
    accentColor: 'amber',
    sample: FALLBACK_SAMPLE_CATALOG.wooden_agogo[0],
  },
  {
    id: 'preset-conga-slap',
    label: 'Conga Slap',
    category: 'Hand Drum',
    accentColor: 'amber',
    sample: FALLBACK_SAMPLE_CATALOG.conga_slap[0],
  },
  {
    id: 'preset-conga-open',
    label: 'Conga Low Open',
    category: 'Hand Drum',
    accentColor: 'amber',
    sample: FALLBACK_SAMPLE_CATALOG.conga_low_open[0],
  },
  {
    id: 'preset-cowbell',
    label: 'Cowbell',
    category: 'Bell',
    accentColor: 'amber',
    sample: FALLBACK_SAMPLE_CATALOG.cowbell[0],
  },
  {
    id: 'preset-tambourine',
    label: 'Tambourine',
    category: 'Jingle',
    accentColor: 'amber',
    sample: FALLBACK_SAMPLE_CATALOG.tambourine[0],
  },
  {
    id: 'preset-warm-bass',
    label: 'Warm Sub Bass',
    category: 'Bass',
    accentColor: 'emerald',
    sample: {
      id: 'synth-warm-bass',
      name: 'Warm Praise Bass',
      url: 'synth://warm_bass',
      source: 'synth',
    },
  },
  {
    id: 'preset-talking-drum',
    label: 'Talking Drum',
    category: 'Gangan',
    accentColor: 'amber',
    sample: FALLBACK_SAMPLE_CATALOG.talking_drum[0],
  },
  {
    id: 'preset-deep-bass',
    label: 'Deep 808 Bass',
    category: 'Bass',
    accentColor: 'emerald',
    sample: {
      id: 'synth-deep-bass',
      name: 'Deep 808 Sub',
      url: 'synth://deep_bass',
      source: 'synth',
    },
  },
  {
    id: 'preset-kick-thump',
    label: 'Kick Thump',
    category: 'Low End',
    accentColor: 'emerald',
    sample: {
      id: 'synth-kick-thump',
      name: 'Acoustic Kick Thump',
      url: 'synth://kick_thump',
      source: 'synth',
    },
  },
  {
    id: 'preset-clave',
    label: 'Wood Clave Snap',
    category: 'Timeline',
    accentColor: 'amber',
    sample: FALLBACK_SAMPLE_CATALOG.wooden_agogo[4],
  },
  {
    id: 'preset-shaker-brush',
    label: 'Crisp Shaker Brush',
    category: 'Shaker',
    accentColor: 'amber',
    sample: FALLBACK_SAMPLE_CATALOG.shekere[1],
  },
];

