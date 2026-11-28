import type {
  ArrangementBlueprint,
  LoopBars,
  PercussionTrack,
  SampleCandidate,
} from '../types/sequencer.ts';
import { FALLBACK_SAMPLE_CATALOG } from '../data/presets.ts';

export const MIN_BPM = 40;
export const MAX_BPM = 220;

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 126;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

export function clampPan(pan: number): number {
  if (!Number.isFinite(pan)) return 0;
  return Math.min(1, Math.max(-1, Number(pan.toFixed(2))));
}

export function clampVolumeDb(db: number): number {
  if (!Number.isFinite(db)) return -3;
  return Math.min(6, Math.max(-60, Number(db.toFixed(1))));
}

export function dbToGain(db: number): number {
  if (db <= -59.5) return 0;
  return Math.pow(10, db / 20);
}

export function formatVolumeDb(db: number): string {
  const safe = clampVolumeDb(db);
  if (safe <= -59.5) return 'Off';
  return safe > 0 ? `+${safe} dB` : `${safe} dB`;
}

export function getStepDurationSeconds(bpm: number): number {
  const safeBpm = clampBpm(bpm);
  return 60 / safeBpm / 4; // 16th-note duration
}

export function getActiveStepCount(loopBars: LoopBars): number {
  return loopBars * 16;
}

export function formatBarBeatStep(stepIndex: number): string {
  const safe = Math.max(0, Math.floor(stepIndex)) % 64;
  const bar = Math.floor(safe / 16) + 1;
  const stepInBar = safe % 16;
  const beat = Math.floor(stepInBar / 4) + 1;
  const sub = (stepInBar % 4) + 1;
  return `${String(bar).padStart(2, '0')}.${beat}.${sub}`;
}

export function isTrackAudible(track: PercussionTrack, anySoloed: boolean): boolean {
  if (track.muted) return false;
  if (anySoloed && !track.soloed) return false;
  return true;
}

/**
 * Exclusive "Hear Only" toggle for percussion tracks:
 * clicking an unselected or non-sole track solos ONLY that track (silencing all others);
 * clicking an already sole-soloed track returns to full mix.
 */
export function toggleExclusiveTrackSolo(
  tracks: PercussionTrack[],
  instrumentId: string
): PercussionTrack[] {
  const target = tracks.find((t) => t.instrument_id === instrumentId);
  if (!target) return tracks;
  const soloCount = tracks.filter((t) => Boolean(t.soloed)).length;
  const turnOff = Boolean(target.soloed) && soloCount === 1;
  return tracks.map((t) => ({
    ...t,
    soloed: turnOff ? false : t.instrument_id === instrumentId,
    muted: !turnOff && t.instrument_id === instrumentId ? false : t.muted,
  }));
}

/**
 * Determines whether a phone/desktop uploaded audio file should stream via HTMLAudioElement
 * instead of full PCM decodeAudioData in RAM (preventing mobile browser OOM crashes).
 */
export function shouldStreamAudioFile(
  fileSizeBytes: number,
  durationSeconds: number,
  maxDecodeBytes = 6 * 1024 * 1024,
  maxDecodeSeconds = 90
): boolean {
  if (fileSizeBytes > maxDecodeBytes) return true;
  if (Number.isFinite(durationSeconds) && durationSeconds > maxDecodeSeconds) return true;
  return false;
}

export function buildFallbackWaveformPeaks(binCount = 48, seedOffset = 0): number[] {
  const safeCount = Math.max(8, Math.min(256, binCount));
  const peaks: number[] = [];
  for (let i = 0; i < safeCount; i++) {
    const wave =
      0.28 +
      0.52 *
        Math.abs(
          Math.sin((i + seedOffset) * 0.42) * Math.cos((i + seedOffset) * 0.19)
        );
    peaks.push(Number(Math.min(1, wave).toFixed(3)));
  }
  return peaks;
}

export function matchFallbackCategory(
  query: string,
  instrumentId: string
): SampleCandidate[] {
  const text = `${instrumentId} ${query}`.toLowerCase();

  if (text.includes('click_hi') || text.includes('click hi') || text.includes('beat 1')) {
    return FALLBACK_SAMPLE_CATALOG.click_hi;
  }
  if (text.includes('click_lo') || text.includes('click lo') || text.includes('click')) {
    return FALLBACK_SAMPLE_CATALOG.click_lo;
  }
  if (text.includes('shekere') || text.includes('shaker') || text.includes('cabasa') || text.includes('maraca')) {
    return FALLBACK_SAMPLE_CATALOG.shekere;
  }
  if (text.includes('agogo') || text.includes('wood') || text.includes('clave') || text.includes('rim')) {
    return FALLBACK_SAMPLE_CATALOG.wooden_agogo;
  }
  if (text.includes('slap') || text.includes('mute') || text.includes('bongo')) {
    return FALLBACK_SAMPLE_CATALOG.conga_slap;
  }
  if (text.includes('conga') || text.includes('open') || text.includes('low')) {
    return FALLBACK_SAMPLE_CATALOG.conga_low_open;
  }
  if (text.includes('cowbell') || text.includes('bell')) {
    return FALLBACK_SAMPLE_CATALOG.cowbell;
  }
  if (text.includes('tambourine') || text.includes('jingle')) {
    return FALLBACK_SAMPLE_CATALOG.tambourine;
  }
  if (text.includes('talking') || text.includes('gangan') || text.includes('omele') || text.includes('drum')) {
    return FALLBACK_SAMPLE_CATALOG.talking_drum;
  }

  return FALLBACK_SAMPLE_CATALOG.conga_slap;
}

export function normalizeSteps(steps: unknown): number[] {
  const arr = Array.isArray(steps) ? steps : [];
  const normalized = new Array<number>(64).fill(0);
  for (let i = 0; i < 64; i++) {
    const val = Number(arr[i] ?? 0);
    if (Number.isFinite(val) && val > 0) {
      normalized[i] = Math.min(100, Math.max(1, Math.round(val)));
    }
  }
  return normalized;
}

export function hydrateTracksWithFallbackSamples(
  tracks: PercussionTrack[]
): PercussionTrack[] {
  return tracks.map((track) => {
    const isClick =
      Boolean(track.isClick) ||
      track.instrument_id === 'click_hi' ||
      track.instrument_id === 'click_lo';
    const fallbackSamples = matchFallbackCategory(
      track.sample_search_query,
      track.instrument_id
    );
    const existingSamples =
      track.samples && track.samples.length > 0 ? track.samples : fallbackSamples;

    return {
      ...track,
      isClick,
      muted: Boolean(track.muted),
      soloed: Boolean(track.soloed),
      samples: existingSamples,
      activeSampleIndex: track.activeSampleIndex ?? 0,
    };
  });
}

export function normalizeArrangement(raw: unknown): ArrangementBlueprint {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawTracks = Array.isArray(obj.tracks) ? obj.tracks : [];

  const tracks: PercussionTrack[] = rawTracks
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item, idx) => {
      const id =
        typeof item.instrument_id === 'string' && item.instrument_id.trim()
          ? item.instrument_id.trim().toLowerCase().replace(/\s+/g, '_')
          : `perc_${idx + 1}`;
      const displayName =
        typeof item.display_name === 'string' && item.display_name.trim()
          ? item.display_name.trim()
          : id.replace(/_/g, ' ');
      const query =
        typeof item.sample_search_query === 'string' && item.sample_search_query.trim()
          ? item.sample_search_query.trim()
          : displayName;
      const isClick = id === 'click_hi' || id === 'click_lo';

      return {
        instrument_id: id,
        display_name: displayName,
        sample_search_query: query,
        volume_db: clampVolumeDb(Number(item.volume_db ?? -3)),
        pan: clampPan(Number(item.pan ?? 0)),
        steps: normalizeSteps(item.steps),
        isClick,
        muted: false,
        soloed: false,
      };
    });

  // Always guarantee synced click_hi (Beat 1) and click_lo (Beats 2, 3, 4)
  if (!tracks.some((t) => t.instrument_id === 'click_hi')) {
    const hiSteps = new Array<number>(64).fill(0);
    [0, 16, 32, 48].forEach((idx) => {
      hiSteps[idx] = 100;
    });
    tracks.push({
      instrument_id: 'click_hi',
      display_name: 'Click Hi (Beat 1)',
      sample_search_query: 'metronome click high',
      volume_db: -2,
      pan: 0,
      steps: hiSteps,
      isClick: true,
      muted: false,
      soloed: false,
    });
  }

  if (!tracks.some((t) => t.instrument_id === 'click_lo')) {
    const loSteps = new Array<number>(64).fill(0);
    [4, 8, 12, 20, 24, 28, 36, 40, 44, 52, 56, 60].forEach((idx) => {
      loSteps[idx] = 88;
    });
    tracks.push({
      instrument_id: 'click_lo',
      display_name: 'Click Lo (2, 3, 4)',
      sample_search_query: 'metronome click low',
      volume_db: -4,
      pan: 0,
      steps: loSteps,
      isClick: true,
      muted: false,
      soloed: false,
    });
  }

  return {
    detected_bpm: clampBpm(Number(obj.detected_bpm ?? 126)),
    groove_style:
      typeof obj.groove_style === 'string' && obj.groove_style.trim()
        ? obj.groove_style.trim()
        : 'Afro-Gospel Praise',
    time_signature:
      typeof obj.time_signature === 'string' && obj.time_signature.trim()
        ? obj.time_signature.trim()
        : '4/4',
    has_existing_percussion: Boolean(obj.has_existing_percussion),
    tracks: hydrateTracksWithFallbackSamples(tracks),
  };
}

export function encodeStereoWav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number
): ArrayBuffer {
  const numFrames = Math.min(left.length, right.length);
  const numChannels = 2;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16-bit
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    offset += 4;
  }

  return buffer;
}

export const MAX_UPLOAD_DURATION_SECONDS = 300; // 5 minutes max

export function estimateExportSizeMb(
  durationSeconds: number,
  sampleRate: number
): number {
  const bytes = 44 + Math.max(1, Math.round(durationSeconds * sampleRate)) * 4;
  return Number((bytes / (1024 * 1024)).toFixed(1));
}

/**
 * Encodes one seamless loop cycle into 16-bit PCM bytes once, then streams
 * repeated references into a multi-minute WAV Blob without duplicating huge Float32 buffers.
 */
export function encodeRepeatedStereoWavBlob(
  cycleLeft: Float32Array,
  cycleRight: Float32Array,
  sampleRate: number,
  targetDurationSeconds: number,
  normalizePeak = false
): Blob {
  const cycleFrames = Math.max(1, Math.min(cycleLeft.length, cycleRight.length));
  const desiredFrames = Math.max(
    cycleFrames,
    Math.round(Math.max(0.25, targetDurationSeconds) * sampleRate)
  );

  let peakGain = 1;
  if (normalizePeak) {
    let maxAbs = 0.0001;
    for (let i = 0; i < cycleFrames; i++) {
      const aL = Math.abs(cycleLeft[i] ?? 0);
      const aR = Math.abs(cycleRight[i] ?? 0);
      if (aL > maxAbs) maxAbs = aL;
      if (aR > maxAbs) maxAbs = aR;
    }
    if (maxAbs > 0.01) {
      peakGain = Math.min(4, 0.94 / maxAbs);
    }
  }

  const cycleBytes = new Uint8Array(cycleFrames * 4);
  const cycleView = new DataView(cycleBytes.buffer);
  for (let i = 0; i < cycleFrames; i++) {
    const l = Math.max(-1, Math.min(1, (cycleLeft[i] ?? 0) * peakGain));
    const r = Math.max(-1, Math.min(1, (cycleRight[i] ?? 0) * peakGain));
    cycleView.setInt16(i * 4, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    cycleView.setInt16(i * 4 + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
  }

  const dataSize = desiredFrames * 4;
  const header = new ArrayBuffer(44);
  const hv = new DataView(header);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) hv.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  hv.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  hv.setUint32(16, 16, true);
  hv.setUint16(20, 1, true);
  hv.setUint16(22, 2, true);
  hv.setUint32(24, sampleRate, true);
  hv.setUint32(28, sampleRate * 4, true);
  hv.setUint16(32, 4, true);
  hv.setUint16(34, 16, true);
  writeStr(36, 'data');
  hv.setUint32(40, dataSize, true);

  const parts: BlobPart[] = [header];
  let remainingFrames = desiredFrames;
  while (remainingFrames >= cycleFrames) {
    parts.push(cycleBytes);
    remainingFrames -= cycleFrames;
  }
  if (remainingFrames > 0) {
    parts.push(cycleBytes.subarray(0, remainingFrames * 4));
  }

  return new Blob(parts, { type: 'audio/wav' });
}

export interface AudioPlaybackDiagnosticInput {
  isPlaying: boolean;
  audioContextState: AudioContextState | 'uninitialized' | string;
  activePage: 'compose' | 'extract' | 'taploop' | 'sequencer' | 'stems';
  metronomeEnabled: boolean;
  hasPlayableOriginal: boolean;
  blendRatio: number;
  activeTapPadStepCount: number;
  stemLoopSource: 'sequencer' | 'taploop' | 'phone_audio';
  stemLoopMuted: boolean;
  hasPhoneLoopAudio: boolean;
  audibleStemNotesOrHumCount: number;
}

export interface AudioPlaybackDiagnostic {
  kind: 'context_blocked' | 'empty_loop';
  message: string;
}

export function getPlaybackAudioDiagnostic(
  input: AudioPlaybackDiagnosticInput
): AudioPlaybackDiagnostic | null {
  if (!input.isPlaying) return null;

  if (
    input.audioContextState === 'suspended' ||
    input.audioContextState === 'interrupted'
  ) {
    return {
      kind: 'context_blocked',
      message:
        'Browser sound is paused — tap here to unlock audio (and check device volume / mute switch).',
    };
  }

  const origAudible = input.hasPlayableOriginal && input.blendRatio > 0.02;

  if (input.activePage === 'taploop') {
    if (
      input.activeTapPadStepCount === 0 &&
      !input.metronomeEnabled &&
      !origAudible
    ) {
      return {
        kind: 'empty_loop',
        message:
          'No pad beats are recorded yet and Click is Off — tap any pad or enable Click On to hear audio.',
      };
    }
  }

  if (input.activePage === 'stems') {
    const phoneSelectedWithoutFile =
      input.stemLoopSource === 'phone_audio' && !input.hasPhoneLoopAudio;
    const tapSelectedEmpty =
      input.stemLoopSource === 'taploop' && input.activeTapPadStepCount === 0;
    const row1Silent =
      input.stemLoopMuted || phoneSelectedWithoutFile || tapSelectedEmpty;

    if (
      row1Silent &&
      input.audibleStemNotesOrHumCount === 0 &&
      !input.metronomeEnabled &&
      !origAudible
    ) {
      return {
        kind: 'empty_loop',
        message:
          'No active notes or loop audio in Stem Studio — switch Row 1 to Sequencer, upload a loop, or add notes.',
      };
    }
  }

  return null;
}

