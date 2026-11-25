import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampCutoffHz,
  countActiveSteps,
  createDefaultTapPads,
  createEmptySteps,
  createNextTapPad,
  cutoffToSliderRatio,
  estimateBpmFromTapIntervals,
  humanizeSteps,
  sliderRatioToCutoff,
  snapStepFromTiming,
} from './tapLoopLogic.ts';

test('snapStepFromTiming snaps live taps cleanly onto the active 16th-note tempo grid', () => {
  // Step duration 0.125s (120 BPM). If tapped 0.03s before next step (step 4), snap ahead to step 4
  const ahead = snapStepFromTiming(0.97, 1.0, 4, 0.125, 16);
  assert.equal(ahead.stepIndex, 4);
  assert.equal(ahead.isAheadOfCurrent, true);

  // If tapped 0.10s before next step (just after step 3), snap to step 3
  const onPrev = snapStepFromTiming(0.9, 1.0, 4, 0.125, 16);
  assert.equal(onPrev.stepIndex, 3);
  assert.equal(onPrev.isAheadOfCurrent, false);

  // Wraps cleanly at step 0
  const wrapPrev = snapStepFromTiming(0.9, 1.0, 0, 0.125, 16);
  assert.equal(wrapPrev.stepIndex, 15);
});

test('cutoff slider mapping sweeps logarithmically between 180 Hz and 18000 Hz', () => {
  assert.equal(sliderRatioToCutoff(0), 180);
  assert.equal(sliderRatioToCutoff(1), 18000);
  const midHz = sliderRatioToCutoff(0.5);
  assert.ok(midHz > 1500 && midHz < 2200);
  assert.ok(Math.abs(cutoffToSliderRatio(midHz) - 0.5) < 0.02);
  assert.equal(clampCutoffHz(50), 180);
  assert.equal(clampCutoffHz(30000), 18000);
});

test('humanizeSteps adds dynamic high/low variation while keeping off-steps silent', () => {
  const input = createEmptySteps();
  input[0] = 90;
  input[1] = 90;
  input[2] = 90;
  input[3] = 90;
  const output = humanizeSteps(input, () => 0.5);
  assert.ok(output[0] > output[1]); // Downbeat louder than off-beat 16th
  assert.ok(output[2] > output[3]); // '&' louder than 'a'
  assert.equal(output[4], 0);
});

test('estimateBpmFromTapIntervals computes BPM from tap intervals and rejects stale gaps', () => {
  assert.equal(estimateBpmFromTapIntervals([1000, 1500, 2000, 2500]), 120);
  assert.equal(estimateBpmFromTapIntervals([100, 600, 5000, 5600]), 100);
  assert.equal(estimateBpmFromTapIntervals([1000]), null);
});

test('createDefaultTapPads initializes 6 pads with tempo-locked 64 steps and reverb, and createNextTapPad adds Bass', () => {
  const initial = createDefaultTapPads();
  assert.equal(initial.length, 6);
  assert.equal(initial[0].steps.length, 64);
  assert.ok(initial[0].reverb > 0);
  assert.equal(countActiveSteps(initial[0].steps, 4), 0);

  const seventh = createNextTapPad(initial.length);
  assert.ok(seventh.name.toLowerCase().includes('bass'));
  assert.equal(seventh.steps.length, 64);
});
