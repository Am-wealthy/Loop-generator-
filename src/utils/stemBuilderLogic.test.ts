import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canRedoStemHistory,
  canUndoStemHistory,
  computeContinuousStepAtTime,
  computeHumTakeAnchor,
  computeLiveExpandedTimelineSteps,
  computeLoopPhaseSeconds,
  computeMonotonicStepAtTime,
  ContinuousVocalRecorder,
  createDefaultStemChannels,
  createStemHistory,
  detectPitchHzAutocorrelation,
  detectPitchInfo,
  extendStemNoteDuration,
  freqToMidi,
  getSongTimelineSteps,
  HumCaptureTracker,
  isAnyStemSoloed,
  isMidiInScale,
  isStemChannelAudible,
  isStemLoopAudible,
  KEYBOARD_SOUND_PRESETS,
  LoopPcmRecorder,
  midiToFreq,
  midiToNoteName,
  pushStemHistory,
  redoStemHistory,
  removeStemChannel,
  snapMidiToScale,
  snapNotesToScale,
  toggleExclusiveStemChannelSolo,
  toggleExclusiveStemLoopSolo,
  toggleStemNote,
  transposeNotes,
  undoStemHistory,
} from './stemBuilderLogic.ts';

test('midiToNoteName and freqToMidi round-trip standard concert pitches', () => {
  assert.equal(midiToNoteName(60), 'C4');
  assert.equal(midiToNoteName(69), 'A4');
  assert.equal(freqToMidi(440), 69);
  assert.equal(freqToMidi(midiToFreq(65)), 65);
});

test('snapMidiToScale fixes off-key notes cleanly into target musical key', () => {
  assert.equal(isMidiInScale(66, 'C', 'major'), false);
  const snapped = snapMidiToScale(66, 'C', 'major');
  assert.equal(isMidiInScale(snapped, 'C', 'major'), true);

  const notes = [
    { step: 0, midi: 61, durationSteps: 2, velocity: 90 },
    { step: 4, midi: 64, durationSteps: 2, velocity: 90 },
  ];
  const fixed = snapNotesToScale(notes, 'C', 'major');
  assert.equal(isMidiInScale(fixed[0].midi, 'C', 'major'), true);
  assert.equal(fixed[1].midi, 64);
});

test('toggleStemNote adds, avoids duplicates, and removes on second toggle, and transposeNotes shifts safely', () => {
  let notes = toggleStemNote([], 4, 60, 2, 92);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].midi, 60);

  notes = toggleStemNote(notes, 4, 60);
  assert.equal(notes.length, 0);

  const shifted = transposeNotes([{ step: 0, midi: 60, durationSteps: 2, velocity: 88 }], 2);
  assert.equal(shifted[0].midi, 62);
});

test('detectPitchHzAutocorrelation accurately detects 220Hz, 440Hz (no octave drop), 523.25Hz, and soft hums', () => {
  const sr = 16000;
  const len = 1024;
  const silence = new Float32Array(len);
  assert.equal(detectPitchHzAutocorrelation(silence, sr), null);

  // 220 Hz with upper harmonic
  const wave220 = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    wave220[i] = 0.55 * Math.sin(2 * Math.PI * 220 * t) + 0.18 * Math.sin(2 * Math.PI * 440 * t);
  }
  const detected220 = detectPitchHzAutocorrelation(wave220, sr);
  assert.ok(detected220 !== null);
  assert.ok(Math.abs(detected220 - 220) < 4, `Expected ~220Hz, got ${detected220}`);
  assert.equal(freqToMidi(detected220), 57);

  // Pure 440 Hz A4 at 48kHz — previously dropped 1-2 octaves to A2/A3 under global max autocorrelation
  const sr48 = 48000;
  const len48 = 2048;
  const wave440 = new Float32Array(len48);
  for (let i = 0; i < len48; i++) {
    const t = i / sr48;
    wave440[i] = 0.02 * Math.sin(2 * Math.PI * 440 * t); // Also tests soft vocal level
  }
  const info440 = detectPitchInfo(wave440, sr48);
  assert.ok(info440 !== null);
  assert.ok(Math.abs(info440.hz - 440) < 4, `Expected ~440Hz A4, got ${info440.hz}`);
  assert.equal(freqToMidi(info440.hz), 69);

  // 523.25 Hz C5 soft hum (RMS ~0.008)
  const wave523 = new Float32Array(len48);
  for (let i = 0; i < len48; i++) {
    wave523[i] = 0.011 * Math.sin((2 * Math.PI * 523.25 * i) / sr48);
  }
  const detected523 = detectPitchHzAutocorrelation(wave523, sr48);
  assert.ok(detected523 !== null);
  assert.equal(freqToMidi(detected523), 72);
});

test('computeContinuousStepAtTime and computeLoopPhaseSeconds compensate lookahead and latency', () => {
  // 120 BPM -> stepDuration = 0.125s, 64 steps -> loopDuration = 8.0s
  const timing = {
    isPlaying: true,
    currentStep: 1, // nextStepTime schedules step 1; step 0 played at 10.025
    nextStepTime: 10.15,
    stepDuration: 0.125,
    stepCount: 64,
    ctxCurrentTime: 10.07,
  };

  // With 45ms latency compensation, 10.070 - 0.045 = 10.025 -> dead-on Step 0 and phase 0.000s
  const step0 = computeContinuousStepAtTime(timing, 10.07, 0.045);
  assert.ok(Math.abs(step0 - 0) < 1e-6, `Expected step 0, got ${step0}`);
  const phase0 = computeLoopPhaseSeconds(timing, 10.07, 0.045);
  assert.ok(Math.abs(phase0 - 0) < 1e-6, `Expected phase 0s, got ${phase0}`);

  // Bar 2 Beat 1 (Step 16 at t=12.025)
  const bar2Timing = {
    ...timing,
    currentStep: 17,
    nextStepTime: 12.15,
    ctxCurrentTime: 12.065,
  };
  const step16 = computeContinuousStepAtTime(bar2Timing, 12.065, 0.04);
  assert.ok(Math.abs(step16 - 16) < 1e-6, `Expected step 16, got ${step16}`);
  const phase2 = computeLoopPhaseSeconds(bar2Timing, 12.065, 0.04);
  assert.ok(Math.abs(phase2 - 2.0) < 1e-6, `Expected phase 2.0s, got ${phase2}`);

  // Wrap around loop end (Step 63 right before Step 0 at 18.025)
  const wrapTiming = {
    ...timing,
    currentStep: 0,
    nextStepTime: 18.025,
    ctxCurrentTime: 17.94,
  };
  const step63 = computeContinuousStepAtTime(wrapTiming, 17.94, 0.04);
  assert.ok(Math.abs(step63 - 63) < 1e-6, `Expected step 63, got ${step63}`);
});

test('HumCaptureTracker captures fast phrases, extends sustained notes, and detects repeated same-pitch re-attacks', () => {
  const tracker = new HumCaptureTracker();
  let notes: Array<{ step: number; midi: number; durationSteps: number; velocity: number }> = [];

  const feed = (hz: number | null, rms: number, clarity: number, continuousStep: number) => {
    const res = tracker.processFrame({
      hz,
      rms,
      clarity,
      continuousStep,
      stepCount: 64,
    });
    if (res.action?.type === 'start') {
      notes = [...notes, res.action.note];
    } else if (res.action?.type === 'extend') {
      notes = extendStemNoteDuration(
        notes,
        res.action.step,
        res.action.midi,
        res.action.durationSteps
      );
    }
  };

  // Fast 16th-note pickup A4 at step 0.05 (2 frames = 42ms), then immediate B4 at step 1.0, then sustained C5 across steps 2..4
  feed(440, 0.03, 0.9, 0.05);
  feed(440, 0.03, 0.9, 0.22);
  feed(493.88, 0.035, 0.9, 1.02);
  feed(493.88, 0.035, 0.9, 1.19);
  feed(523.25, 0.04, 0.9, 2.0);
  feed(523.25, 0.04, 0.9, 3.0);
  feed(523.25, 0.04, 0.9, 4.0);
  // Vocal dip + re-attack on same pitch C5 at step 6.0 ("hm-hm")
  feed(523.25, 0.012, 0.85, 5.2);
  feed(523.25, 0.045, 0.9, 6.0);

  assert.equal(notes.length, 4, `Expected 4 captured notes, got ${JSON.stringify(notes)}`);
  assert.deepEqual(
    notes.map((n) => [n.step, n.midi, n.durationSteps]),
    [
      [0, 69, 1], // A4 at step 0
      [1, 71, 1], // B4 at step 1
      [2, 72, 4], // Sustained C5 across steps 2,3,4,5 (soft tail at 5.2)
      [6, 72, 1], // Repeated C5 at step 6 after dip
    ]
  );

  // Brief silence gap followed by another C5 at step 8.0
  feed(null, 0.001, 0, 7.0);
  feed(null, 0.001, 0, 7.2);
  feed(523.25, 0.04, 0.9, 8.0);
  feed(523.25, 0.04, 0.9, 8.2);
  assert.equal(notes.length, 5);
  assert.equal(notes[4].step, 8);
  assert.equal(notes[4].midi, 72);
});

test('createDefaultStemChannels populates multi-track FL-style rack sequences including Synth Lead', () => {
  const channels = createDefaultStemChannels();
  assert.equal(channels.length, 3);
  assert.ok(channels.every((ch) => ch.notes.length > 0));
  assert.ok(KEYBOARD_SOUND_PRESETS.some((p) => p.id === 'synth_lead'));
});

test('undoStemHistory and redoStemHistory traverse backward and forward cleanly', () => {
  const initialChannels = createDefaultStemChannels();
  let history = createStemHistory({
    stemChannels: initialChannels,
    selectedChannelId: initialChannels[0].id,
    stemLoopSource: 'sequencer',
    stemLoopMuted: false,
    stemLoopVolumeDb: -2,
    stemKey: 'C',
    stemScale: 'major',
  });

  assert.equal(canUndoStemHistory(history), false);
  assert.equal(canRedoStemHistory(history), false);

  const modifiedChannels = initialChannels.map((ch, idx) =>
    idx === 0 ? { ...ch, soundId: 'gospel_organ' as const } : ch
  );

  history = pushStemHistory(history, {
    ...history.present,
    stemChannels: modifiedChannels,
  });

  assert.equal(canUndoStemHistory(history), true);
  assert.equal(canRedoStemHistory(history), false);
  assert.equal(history.present.stemChannels[0].soundId, 'gospel_organ');

  history = undoStemHistory(history);
  assert.equal(history.present.stemChannels[0].soundId, 'synth_lead');
  assert.equal(canUndoStemHistory(history), false);
  assert.equal(canRedoStemHistory(history), true);

  history = redoStemHistory(history);
  assert.equal(history.present.stemChannels[0].soundId, 'gospel_organ');
  assert.equal(canUndoStemHistory(history), true);
  assert.equal(canRedoStemHistory(history), false);
});

test('exclusive Stem Studio solo isolates Row 1 loop bed or any melodic row mutually', () => {
  const channels = createDefaultStemChannels();
  const base = createStemHistory({
    stemChannels: channels,
    selectedChannelId: channels[0].id,
    stemLoopSource: 'sequencer',
    stemLoopMuted: false,
    stemLoopSoloed: false,
    stemLoopVolumeDb: -2,
    stemKey: 'C',
    stemScale: 'major',
  }).present;

  // Solo Row 2 (channel 0) -> Row 1 loop & Row 3/4 become silent
  const row2Only = toggleExclusiveStemChannelSolo(base, channels[0].id);
  assert.equal(isAnyStemSoloed(row2Only.stemLoopSoloed, row2Only.stemChannels), true);
  assert.equal(isStemLoopAudible(row2Only.stemLoopMuted, row2Only.stemLoopSoloed, row2Only.stemChannels), false);
  assert.equal(isStemChannelAudible(row2Only.stemChannels[0], row2Only.stemLoopSoloed, row2Only.stemChannels), true);
  assert.equal(isStemChannelAudible(row2Only.stemChannels[1], row2Only.stemLoopSoloed, row2Only.stemChannels), false);

  // Switch exclusive solo to Row 1 loop bed -> all melodic rows silence
  const row1Only = toggleExclusiveStemLoopSolo(row2Only);
  assert.equal(row1Only.stemLoopSoloed, true);
  assert.equal(isStemLoopAudible(row1Only.stemLoopMuted, row1Only.stemLoopSoloed, row1Only.stemChannels), true);
  assert.equal(isStemChannelAudible(row1Only.stemChannels[0], row1Only.stemLoopSoloed, row1Only.stemChannels), false);

  // Toggle Row 1 off -> full mix returns
  const fullMix = toggleExclusiveStemLoopSolo(row1Only);
  assert.equal(isAnyStemSoloed(fullMix.stemLoopSoloed, fullMix.stemChannels), false);
  assert.equal(isStemLoopAudible(fullMix.stemLoopMuted, fullMix.stemLoopSoloed, fullMix.stemChannels), true);
  assert.equal(isStemChannelAudible(fullMix.stemChannels[0], fullMix.stemLoopSoloed, fullMix.stemChannels), true);
});

test('removeStemChannel deletes Row 2 and allows deleting down to zero melodic rows', () => {
  const channels = createDefaultStemChannels();
  let snap = createStemHistory({
    stemChannels: channels,
    selectedChannelId: channels[0].id,
    stemLoopSource: 'sequencer',
    stemLoopMuted: false,
    stemLoopSoloed: false,
    stemLoopVolumeDb: -2,
    stemKey: 'C',
    stemScale: 'major',
  }).present;

  // Delete Row 2 (channels[0])
  snap = removeStemChannel(snap, channels[0].id);
  assert.equal(snap.stemChannels.length, 2);
  assert.equal(snap.selectedChannelId, channels[1].id);

  // Delete Row 3 and Row 4 so zero melodic rows remain
  snap = removeStemChannel(snap, channels[1].id);
  snap = removeStemChannel(snap, channels[2].id);
  assert.equal(snap.stemChannels.length, 0);
  assert.equal(snap.selectedChannelId, '');
});

test('LoopPcmRecorder writes sample-contiguously across timing jitter with zero dropouts or clicks', () => {
  const sr = 48000;
  const loopFrames = 48000 * 4; // 4 seconds
  const recorder = new LoopPcmRecorder(loopFrames, sr);

  // Start at phase 1.0s (48000), write 4 contiguous 2048-sample sine chunks even with +/- 60ms jitter
  const chunk = new Float32Array(2048);
  let sampleIdx = 0;
  const fillSine = () => {
    for (let i = 0; i < chunk.length; i++) {
      chunk[i] = 0.4 * Math.sin((2 * Math.PI * 220 * sampleIdx) / sr);
      sampleIdx++;
    }
  };

  fillSine();
  recorder.writeChunk(chunk, 1.0);
  fillSine();
  // Simulate +55ms main-thread jitter on chunk 2: must NOT skip or leave a zero hole!
  recorder.writeChunk(chunk, 1.0 + 2048 / sr + 0.055);
  fillSine();
  recorder.writeChunk(chunk, 1.0 + 4096 / sr - 0.04);
  fillSine();
  recorder.writeChunk(chunk, 1.0 + 6144 / sr);

  const out = recorder.finalize();
  assert.ok(out !== null);
  assert.equal(out.length, loopFrames);

  // Verify Bar 1 [0..0.9s] stayed completely silent (0)
  let earlyPeak = 0;
  for (let i = 0; i < sr * 0.9; i++) {
    earlyPeak = Math.max(earlyPeak, Math.abs(out[i]));
  }
  assert.equal(earlyPeak, 0);

  // Verify the entire 8192-sample recorded span [48000..56191] is continuous with ZERO zero-holes or step cracks
  let maxStepDiff = 0;
  for (let i = 48001; i < 48000 + 8192; i++) {
    maxStepDiff = Math.max(maxStepDiff, Math.abs(out[i] - out[i - 1]));
  }
  // At 220Hz @ 48kHz, max sample-to-sample diff of amplitude 0.4 is ~0.0115
  assert.ok(maxStepDiff < 0.02, `Expected smooth waveform without jumps, got maxStepDiff=${maxStepDiff}`);
});

test('computeHumTakeAnchor waits cleanly past 4 bars and aligns onset to current loop cycle', () => {
  const stepDur = 0.125; // 120 BPM 16th note
  // Waited 2 full 4-bar loops (128 steps) and started singing right on Beat 1
  const beat1AfterWait = computeHumTakeAnchor(128.4, 64, stepDur, 0.25);
  assert.equal(beat1AfterWait.anchorCycleStartGlobalStep, 128);
  assert.ok(beat1AfterWait.leadSilenceSeconds < 0.01);

  // Waited 1 loop + 1 bar (80 steps = Bar 2)
  const bar2Entry = computeHumTakeAnchor(80, 64, stepDur, 0.25);
  assert.equal(bar2Entry.anchorCycleStartGlobalStep, 64);
  assert.equal(Math.round(bar2Entry.onsetPhaseSteps), 16);
  assert.ok(Math.abs(bar2Entry.leadSilenceSeconds - (16 * stepDur - 0.25)) < 0.001);

  // Pickup 1.5 steps before Beat 1 of loop #3 (126.5 of 128) anchors onto upcoming Beat 1 (128)
  const pickup = computeHumTakeAnchor(126.5, 64, stepDur, 0.25);
  assert.equal(pickup.anchorCycleStartGlobalStep, 128);
  assert.equal(pickup.leadSilenceSeconds, 0);
});

test('computeLiveExpandedTimelineSteps and HumCaptureTracker expand past 4 bars without wrapping', () => {
  // Stays at 4 bars until approaching the end of Bar 4
  assert.equal(computeLiveExpandedTimelineSteps(64, 48, 64), 64);
  // Approaching Bar 4 end -> opens Bar 5 (80 steps)
  assert.equal(computeLiveExpandedTimelineSteps(64, 58, 64), 80);
  // Singing in Bar 6 -> expands cleanly to Bar 7 (112 steps)
  assert.equal(computeLiveExpandedTimelineSteps(80, 100, 64), 112);

  // Extended HumCaptureTracker keeps steps in Bar 5 & Bar 6 instead of wrapping to Bar 1
  const tracker = new HumCaptureTracker();
  const res1 = tracker.processFrame({
    hz: 440,
    rms: 0.08,
    clarity: 0.9,
    continuousStep: 68.1,
    stepCount: 64,
    allowExtendedTimeline: true,
  });
  assert.equal(res1.action?.type, 'start');
  assert.equal(res1.action?.note.step, 68);

  const res2 = tracker.processFrame({
    hz: 523.25,
    rms: 0.08,
    clarity: 0.9,
    continuousStep: 84.2,
    stepCount: 64,
    allowExtendedTimeline: true,
  });
  assert.equal(res2.action?.type, 'start');
  assert.equal(res2.action?.note.step, 84);

  const monoStep = computeMonotonicStepAtTime(
    {
      isPlaying: true,
      currentStep: 96,
      nextStepTime: 10.0,
      stepDuration: 0.125,
      stepCount: 64,
      ctxCurrentTime: 10.0,
    },
    10.0,
    0
  );
  assert.equal(monoStep, 96);
});

test('ContinuousVocalRecorder preserves pre-roll and expands past 4 bars linearly', () => {
  const sr = 22050;
  const recorder = new ContinuousVocalRecorder(sr, 60);
  recorder.prependSilenceFrames(sr * 1); // 1s lead silence
  const preRoll = new Float32Array(2048).fill(0.15);
  recorder.seedPreRollChunks([preRoll]);
  // Add 8 seconds of audio (exceeding typical 4-bar 126bpm ~7.6s duration)
  for (let i = 0; i < 86; i++) {
    const chunk = new Float32Array(2048);
    for (let j = 0; j < chunk.length; j++) {
      chunk[j] = 0.25 * Math.sin((2 * Math.PI * 330 * j) / sr);
    }
    recorder.writeChunk(chunk);
  }
  const finalPcm = recorder.finalize();
  assert.ok(finalPcm !== null);
  assert.ok(finalPcm.length > sr * 8.5);
  const steps = Math.ceil((finalPcm.length / sr / 0.12) / 16) * 16;
  const songSteps = getSongTimelineSteps([{ notes: [], totalSteps: steps }], 64);
  assert.ok(songSteps >= 80, `Expected extended timeline >= 80 steps, got ${songSteps}`);
});

