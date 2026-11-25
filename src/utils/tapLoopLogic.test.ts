import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeTapPhase,
  createDefaultTapPads,
  createNextTapPad,
  estimateBpmFromTapIntervals,
  getPhaseEventsInWindow,
  normalizePhase,
  quantizePhaseTo16th,
} from './tapLoopLogic.ts';

test('normalizePhase wraps negative and overflow values into [0, 1)', () => {
  assert.equal(normalizePhase(0), 0);
  assert.equal(normalizePhase(1), 0);
  assert.ok(Math.abs(normalizePhase(-0.25) - 0.75) < 1e-9);
  assert.ok(Math.abs(normalizePhase(2.375) - 0.375) < 1e-9);
});

test('quantizePhaseTo16th aligns raw hand timings cleanly to 16th-note subdivisions', () => {
  // 1 bar = 16 steps (step spacing = 0.0625)
  assert.equal(quantizePhaseTo16th(0.01, 1), 0);
  assert.equal(quantizePhaseTo16th(0.24, 1), 0.25);
  assert.equal(quantizePhaseTo16th(0.99, 1), 0);
  assert.ok(Math.abs(computeTapPhase(0.51, 2.0, true, 1) - 0.25) < 1e-9);
  assert.ok(Math.abs(computeTapPhase(0.51, 2.0, false, 1) - 0.255) < 1e-9);
});

test('getPhaseEventsInWindow captures events across wrap-around boundary without drops or duplicates', () => {
  const events = [
    { id: 'a', phase: 0.02, velocity: 90 },
    { id: 'b', phase: 0.5, velocity: 90 },
    { id: 'c', phase: 0.98, velocity: 90 },
  ];

  // Window crossing 0.96 -> 1.04 (wrapped to 0.04)
  const matches = getPhaseEventsInWindow(events, 0.96, 0.08);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].event.id, 'c');
  assert.ok(Math.abs(matches[0].offsetRatio - 0.02) < 1e-9);
  assert.equal(matches[1].event.id, 'a');
  assert.ok(Math.abs(matches[1].offsetRatio - 0.06) < 1e-9);
});

test('estimateBpmFromTapIntervals computes BPM from tap intervals and rejects stale gaps', () => {
  // 500ms apart = 120 BPM
  assert.equal(estimateBpmFromTapIntervals([1000, 1500, 2000, 2500]), 120);
  // Stale gap (>2s) ignored so only last two taps at 600ms (100 BPM) count
  assert.equal(estimateBpmFromTapIntervals([100, 600, 5000, 5600]), 100);
  assert.equal(estimateBpmFromTapIntervals([1000]), null);
});

test('createDefaultTapPads returns at least 6 pads and createNextTapPad adds new pad boxes including bass', () => {
  const initial = createDefaultTapPads();
  assert.ok(initial.length >= 6);
  const seventh = createNextTapPad(initial.length);
  assert.notEqual(seventh.id, initial[0].id);
  assert.ok(seventh.name.toLowerCase().includes('bass'));
});
