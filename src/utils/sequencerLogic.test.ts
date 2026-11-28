import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampBpm,
  dbToGain,
  encodeRepeatedStereoWavBlob,
  encodeStereoWav,
  estimateExportSizeMb,
  formatBarBeatStep,
  formatVolumeDb,
  getActiveStepCount,
  getPlaybackAudioDiagnostic,
  getStepDurationSeconds,
  isTrackAudible,
  matchFallbackCategory,
  MAX_UPLOAD_DURATION_SECONDS,
  normalizeArrangement,
  shouldStreamAudioFile,
  buildFallbackWaveformPeaks,
  toggleExclusiveTrackSolo,
} from './sequencerLogic';
import { INITIAL_HIGHLIFE_ARRANGEMENT } from '../data/presets';

test('clampBpm enforces studio range 40-220', () => {
  assert.equal(clampBpm(126), 126);
  assert.equal(clampBpm(20), 40);
  assert.equal(clampBpm(300), 220);
  assert.equal(clampBpm(Number.NaN), 126);
});

test('dbToGain and formatVolumeDb convert and format dB levels cleanly', () => {
  assert.equal(Math.round(dbToGain(0) * 1000) / 1000, 1);
  assert.equal(Math.round(dbToGain(-6) * 1000) / 1000, 0.501);
  assert.equal(dbToGain(-60), 0);
  assert.equal(formatVolumeDb(-60), 'Off');
  assert.equal(formatVolumeDb(-6), '-6 dB');
  assert.equal(formatVolumeDb(3), '+3 dB');
});

test('timing helpers calculate 16th note duration and bar.beat.step formatting', () => {
  assert.equal(getStepDurationSeconds(120), 0.125);
  assert.equal(getActiveStepCount(1), 16);
  assert.equal(getActiveStepCount(2), 32);
  assert.equal(getActiveStepCount(4), 64);
  assert.equal(formatBarBeatStep(0), '01.1.1');
  assert.equal(formatBarBeatStep(17), '02.1.2');
  assert.equal(formatBarBeatStep(63), '04.4.4');
});

test('isTrackAudible respects mute and solo precedence', () => {
  const normal = { ...INITIAL_HIGHLIFE_ARRANGEMENT.tracks[0], muted: false, soloed: false };
  const soloed = { ...normal, soloed: true };
  const mutedSolo = { ...normal, muted: true, soloed: true };

  assert.equal(isTrackAudible(normal, false), true);
  assert.equal(isTrackAudible(normal, true), false);
  assert.equal(isTrackAudible(soloed, true), true);
  assert.equal(isTrackAudible(mutedSolo, true), false);
});

test('normalizeArrangement guarantees 64 steps and synced click_hi / click_lo tracks', () => {
  const normalized = normalizeArrangement({
    detected_bpm: 132,
    groove_style: 'Alujo Praise',
    time_signature: '4/4',
    has_existing_percussion: false,
    tracks: [
      {
        instrument_id: 'shekere',
        display_name: 'Shekere',
        sample_search_query: 'shekere one shot',
        volume_db: -2,
        pan: 0.3,
        steps: [100, 0, 80],
      },
    ],
  });

  assert.equal(normalized.detected_bpm, 132);
  assert.equal(normalized.tracks.length, 3); // shekere + auto-injected click_hi + click_lo
  assert.equal(normalized.tracks[0].steps.length, 64);
  assert.equal(normalized.tracks[0].steps[0], 100);
  assert.equal(normalized.tracks[0].steps[2], 80);
  assert.equal(normalized.tracks[0].steps[63], 0);
  assert.ok(normalized.tracks[0].samples && normalized.tracks[0].samples.length >= 5);
  assert.equal(normalized.tracks[1].instrument_id, 'click_hi');
  assert.equal(normalized.tracks[1].steps[0], 100);
  assert.equal(normalized.tracks[1].steps[16], 100);
  assert.equal(normalized.tracks[2].instrument_id, 'click_lo');
  assert.equal(normalized.tracks[2].steps[4], 88);
});

test('matchFallbackCategory maps keywords to real CDN sample banks', () => {
  assert.equal(matchFallbackCategory('shekere one shot', 'shaker').length, 5);
  assert.equal(matchFallbackCategory('wooden agogo', 'agogo').length, 5);
  assert.equal(matchFallbackCategory('talking drum', 'gangan').length, 5);
});

test('encodeStereoWav writes valid RIFF WAVE header and PCM samples', () => {
  const left = new Float32Array([0, 0.5, -0.5, 1]);
  const right = new Float32Array([0, -0.5, 0.5, -1]);
  const wavBuffer = encodeStereoWav(left, right, 44100);
  const view = new DataView(wavBuffer);

  assert.equal(wavBuffer.byteLength, 44 + 4 * 4);
  assert.equal(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)), 'RIFF');
  assert.equal(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)), 'WAVE');
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint16(22, true), 2);
});

test('encodeRepeatedStereoWavBlob tiles cycle PCM cleanly for multi-minute exports', async () => {
  assert.equal(MAX_UPLOAD_DURATION_SECONDS, 300);
  const sr = 22050;
  const cycleFrames = sr; // 1 second cycle
  const left = new Float32Array(cycleFrames).fill(0.25);
  const right = new Float32Array(cycleFrames).fill(-0.25);

  const blob = encodeRepeatedStereoWavBlob(left, right, sr, 5.5, true);
  assert.equal(blob.size, 44 + Math.round(5.5 * sr) * 4);
  const headerBuf = await blob.slice(0, 44).arrayBuffer();
  const hv = new DataView(headerBuf);
  assert.equal(hv.getUint32(24, true), sr);
  assert.equal(hv.getUint32(40, true), Math.round(5.5 * sr) * 4);
  assert.ok(estimateExportSizeMb(60, 44100) > 10);
});

test('getPlaybackAudioDiagnostic detects suspended/interrupted audio context and empty taploop', () => {
  const blocked = getPlaybackAudioDiagnostic({
    isPlaying: true,
    audioContextState: 'suspended',
    activePage: 'sequencer',
    metronomeEnabled: true,
    hasPlayableOriginal: false,
    blendRatio: 0,
    activeTapPadStepCount: 0,
    stemLoopSource: 'sequencer',
    stemLoopMuted: false,
    hasPhoneLoopAudio: false,
    audibleStemNotesOrHumCount: 3,
  });
  assert.equal(blocked?.kind, 'context_blocked');

  const emptyTap = getPlaybackAudioDiagnostic({
    isPlaying: true,
    audioContextState: 'running',
    activePage: 'taploop',
    metronomeEnabled: false,
    hasPlayableOriginal: false,
    blendRatio: 0,
    activeTapPadStepCount: 0,
    stemLoopSource: 'sequencer',
    stemLoopMuted: false,
    hasPhoneLoopAudio: false,
    audibleStemNotesOrHumCount: 0,
  });
  assert.equal(emptyTap?.kind, 'empty_loop');

  const healthyStems = getPlaybackAudioDiagnostic({
    isPlaying: true,
    audioContextState: 'running',
    activePage: 'stems',
    metronomeEnabled: true,
    hasPlayableOriginal: false,
    blendRatio: 0,
    activeTapPadStepCount: 0,
    stemLoopSource: 'sequencer',
    stemLoopMuted: false,
    hasPhoneLoopAudio: false,
    audibleStemNotesOrHumCount: 2,
  });
  assert.equal(healthyStems, null);
});

test('toggleExclusiveTrackSolo plays only clicked track and toggles back cleanly', () => {
  const tracks = INITIAL_HIGHLIFE_ARRANGEMENT.tracks.slice(0, 3).map((t) => ({
    ...t,
    muted: false,
    soloed: false,
  }));
  const soloFirst = toggleExclusiveTrackSolo(tracks, tracks[0].instrument_id);
  assert.equal(soloFirst[0].soloed, true);
  assert.equal(soloFirst[1].soloed, false);
  assert.equal(soloFirst[2].soloed, false);

  // Clicking another track switches solo exclusively to that track
  const soloSecond = toggleExclusiveTrackSolo(soloFirst, tracks[1].instrument_id);
  assert.equal(soloSecond[0].soloed, false);
  assert.equal(soloSecond[1].soloed, true);
  assert.equal(soloSecond[2].soloed, false);

  // Clicking already sole-soloed track returns to full mix
  const backToAll = toggleExclusiveTrackSolo(soloSecond, tracks[1].instrument_id);
  assert.equal(backToAll.some((t) => Boolean(t.soloed)), false);
});

test('shouldStreamAudioFile streams large or long phone audio instead of OOM PCM decoding', () => {
  assert.equal(shouldStreamAudioFile(2 * 1024 * 1024, 30), false);
  assert.equal(shouldStreamAudioFile(8 * 1024 * 1024, 30), true);
  assert.equal(shouldStreamAudioFile(3 * 1024 * 1024, 150), true);
  const peaks = buildFallbackWaveformPeaks(48);
  assert.equal(peaks.length, 48);
  assert.ok(peaks.every((p) => p > 0 && p <= 1));
});

