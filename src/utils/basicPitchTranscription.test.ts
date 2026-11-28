import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASIC_PITCH_HIGH_SENSITIVITY_CONFIG,
  BASIC_PITCH_SAMPLE_RATE,
  convertBasicPitchNotesToStemNotes,
  extractVelocityCurveFromPcm,
  findActiveVocalWindow,
  preprocessVocalPcm,
  resampleMonoAudio,
  smoothPitchBendBins,
} from './basicPitchTranscription.ts';
import { detectPitchInfo } from './stemBuilderLogic.ts';

test('BASIC_PITCH_HIGH_SENSITIVITY_CONFIG uses exact user-requested high-sensitivity parameters', () => {
  assert.equal(BASIC_PITCH_HIGH_SENSITIVITY_CONFIG.onset_threshold, 0.2);
  assert.equal(BASIC_PITCH_HIGH_SENSITIVITY_CONFIG.frame_threshold, 0.2);
  assert.equal(BASIC_PITCH_HIGH_SENSITIVITY_CONFIG.minimum_note_length, 30);
  assert.equal(BASIC_PITCH_HIGH_SENSITIVITY_CONFIG.multiple_pitch_bends, true);
});

test('preprocessVocalPcm boosts quiet humming without clipping loud peaks or cutting soft tails', () => {
  const sr = 48000;
  const totalSamples = Math.floor(sr * 1.2); // 1.2s
  const input = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sr;
    if (t < 0.2) {
      // Tiny background room noise (~0.0004)
      input[i] = 0.0004 * Math.sin(2 * Math.PI * 55 * t);
    } else if (t < 0.7) {
      // Very quiet humming (~0.005 peak, 220 Hz)
      input[i] = 0.005 * Math.sin(2 * Math.PI * 220 * t);
    } else {
      // Loud vocal peak (0.85, 330 Hz)
      input[i] = 0.85 * Math.sin(2 * Math.PI * 330 * t);
    }
  }

  const processed = preprocessVocalPcm(input, sr);
  assert.equal(processed.length, totalSamples);

  const rmsRange = (startSec: number, endSec: number) => {
    const s = Math.floor(startSec * sr);
    const e = Math.floor(endSec * sr);
    let sum = 0;
    for (let i = s; i < e; i++) sum += processed[i] * processed[i];
    return Math.sqrt(sum / Math.max(1, e - s));
  };

  const noiseRms = rmsRange(0.05, 0.18);
  const quietHumRms = rmsRange(0.32, 0.65);
  let maxPeak = 0;
  for (let i = 0; i < processed.length; i++) {
    maxPeak = Math.max(maxPeak, Math.abs(processed[i]));
  }

  // Quiet humming boosted cleanly above 0.03 RMS while background rumble stays quiet & peaks never clip
  assert.ok(quietHumRms > 0.03, `Expected quiet hum RMS > 0.03, got ${quietHumRms}`);
  assert.ok(quietHumRms > noiseRms * 15, `Expected quiet hum clearly above noise`);
  assert.ok(maxPeak <= 0.96, `Expected soft limiter ceiling <= 0.96, got ${maxPeak}`);
});

test('resampleMonoAudio accurately converts 48kHz vocal audio to 22050Hz preserving frequency', () => {
  const sr48 = 48000;
  const durationSec = 0.5;
  const src = new Float32Array(Math.floor(sr48 * durationSec));
  for (let i = 0; i < src.length; i++) {
    src[i] = 0.4 * Math.sin((2 * Math.PI * 329.63 * i) / sr48); // E4
  }

  const resampled = resampleMonoAudio(src, sr48, BASIC_PITCH_SAMPLE_RATE);
  assert.ok(Math.abs(resampled.length - Math.round(BASIC_PITCH_SAMPLE_RATE * durationSec)) <= 2);

  const pitch = detectPitchInfo(resampled.subarray(512, 2560), BASIC_PITCH_SAMPLE_RATE);
  assert.ok(pitch !== null);
  assert.ok(Math.abs(pitch.hz - 329.63) < 4, `Expected ~329.63 Hz, got ${pitch.hz}`);
});

test('smoothPitchBendBins converts 1/3-semitone bins to smooth curves and removes single-frame glitches', () => {
  // Stepped upward pitch slide 0 -> +2 semitones (6 bins) with a single-frame glitch spike of +10 bins
  const bins = [0, 0, 1, 1, 2, 10, 3, 4, 4, 5, 5, 6, 6];
  const curve = smoothPitchBendBins(bins);
  assert.ok(curve !== undefined);
  assert.equal(curve.length, bins.length);

  // Spike at index 5 must be despiked cleanly (never reaching 3.33 semitones)
  assert.ok(curve[5] < 1.8, `Expected despiked curve at index 5 < 1.8st, got ${curve[5]}`);
  // Smooth monotonic rise from near 0 to near +2 semitones
  assert.ok(curve[0] < 0.25);
  assert.ok(curve[curve.length - 1] > 1.75 && curve[curve.length - 1] <= 2.1);
});

test('convertBasicPitchNotesToStemNotes captures fast 35ms notes, micro-timing, pitch bends, and velocity curves', () => {
  const sr = 22050;
  const pcm = new Float32Array(sr * 2);
  // Create quiet swell [0.0..0.15] and loud note [0.5..1.0]
  for (let i = 0; i < pcm.length; i++) {
    const t = i / sr;
    const amp = t < 0.25 ? 0.06 : t >= 0.45 && t <= 1.05 ? 0.28 * Math.sin(Math.PI * ((t - 0.45) / 0.6)) : 0;
    pcm[i] = amp * Math.sin(2 * Math.PI * 440 * t);
  }

  const timedNotes = [
    // Fast 35ms grace pickup at t=0.04s (step 0 + offset at 120BPM where step=0.125s)
    {
      startTimeSeconds: 0.04,
      durationSeconds: 0.035,
      pitchMidi: 69,
      amplitude: 0.45,
      pitchBends: [0, 1, 1],
    },
    // Ghost octave harmonic (+12 semitones) at low amplitude that should be filtered out
    {
      startTimeSeconds: 0.51,
      durationSeconds: 0.4,
      pitchMidi: 84,
      amplitude: 0.18,
      pitchBends: [0, 0, 0],
    },
    // Main expressive sustained note with upward pitch slide at t=0.50s (step 4)
    {
      startTimeSeconds: 0.5,
      durationSeconds: 0.52,
      pitchMidi: 72,
      amplitude: 0.85,
      pitchBends: [0, 0, 1, 2, 2, 3, 3, 3],
    },
  ];

  const stemNotes = convertBasicPitchNotesToStemNotes(timedNotes, 0.125, 64, pcm, sr);
  assert.equal(stemNotes.length, 2, `Expected 2 cleaned expressive notes, got ${JSON.stringify(stemNotes)}`);

  const [fastNote, mainNote] = stemNotes;
  assert.equal(fastNote.step, 0);
  assert.equal(fastNote.midi, 69);
  assert.ok(
    (fastNote.exactDurationSteps ?? 1) < 0.4,
    `Expected fast 35ms note exactDurationSteps < 0.4, got ${fastNote.exactDurationSteps}`
  );
  assert.ok((fastNote.startOffsetSteps ?? 0) > 0.25);

  assert.equal(mainNote.step, 4);
  assert.equal(mainNote.midi, 72);
  assert.ok(mainNote.velocity > fastNote.velocity, 'Expected louder vocal note to have higher velocity');
  assert.ok(Array.isArray(mainNote.pitchBendSemitones) && mainNote.pitchBendSemitones.length > 0);
  assert.ok(Array.isArray(mainNote.velocityCurve) && mainNote.velocityCurve.length >= 4);

  const velCheck = extractVelocityCurveFromPcm(pcm, sr, 0.5, 0.5, 0.85);
  assert.ok(velCheck.velocityCurve && velCheck.velocityCurve.length >= 4);
});

test('findActiveVocalWindow trims leading and trailing silence while preserving generous pads', () => {
  const sr = 22050;
  const pcm = new Float32Array(sr * 6); // 6 seconds
  // Place vocal hum between 1.0s and 2.2s
  for (let i = Math.floor(sr * 1.0); i < Math.floor(sr * 2.2); i++) {
    pcm[i] = 0.05 * Math.sin((2 * Math.PI * 300 * i) / sr);
  }
  const { startIdx, endIdx } = findActiveVocalWindow(pcm, sr);
  assert.ok(startIdx >= Math.floor(sr * 0.8) && startIdx <= Math.floor(sr * 0.9));
  assert.ok(endIdx >= Math.floor(sr * 2.4) && endIdx <= Math.floor(sr * 2.5));
});

test('convertBasicPitchNotesToStemNotes suppresses simultaneous overtone stacks and merges tiny same-pitch splits', () => {
  const timedNotes = [
    // Split vibrato fragment on C4 (0.00-0.18 + 0.20-0.42 -> gap 20ms, should merge into one C4)
    { startTimeSeconds: 0.0, durationSeconds: 0.18, pitchMidi: 60, amplitude: 0.72, pitchBends: [0, 1] },
    { startTimeSeconds: 0.2, durationSeconds: 0.22, pitchMidi: 60, amplitude: 0.68, pitchBends: [1, 0] },
    // Simultaneous +12 and +19 harmonic partials over C4 that would sound heavy/scattered
    { startTimeSeconds: 0.01, durationSeconds: 0.35, pitchMidi: 72, amplitude: 0.65, pitchBends: [0, 0] },
    { startTimeSeconds: 0.02, durationSeconds: 0.32, pitchMidi: 79, amplitude: 0.48, pitchBends: [0, 0] },
    // Distinct fast E4 note later at t=0.50s (40ms)
    { startTimeSeconds: 0.5, durationSeconds: 0.04, pitchMidi: 64, amplitude: 0.62, pitchBends: [0, 0] },
  ];

  const out = convertBasicPitchNotesToStemNotes(timedNotes, 0.125, 64);
  assert.equal(out.length, 2, `Expected 2 clean solo notes, got ${JSON.stringify(out)}`);
  assert.equal(out[0].midi, 60);
  assert.ok((out[0].exactDurationSteps ?? 0) > 3.0);
  assert.equal(out[1].midi, 64);
});
