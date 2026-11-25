import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandPatternTo64Steps,
  findMatchingTapPadIndex,
  findMatchingTrackIndex,
} from './voiceCommandLogic';
import { INITIAL_HIGHLIFE_ARRANGEMENT } from '../data/presets';
import { createDefaultTapPads } from './tapLoopLogic';

test('expandPatternTo64Steps repeats 16-step vocal rhythm cleanly across 4 bars', () => {
  // "ta ta ta ... ta ta" on a 16-step grid
  const bar = [95, 0, 88, 0, 92, 0, 0, 0, 95, 0, 88, 0, 0, 0, 0, 0];
  const full = expandPatternTo64Steps(bar);
  assert.equal(full.length, 64);
  assert.equal(full[0], 95);
  assert.equal(full[2], 88);
  assert.equal(full[16], 95);
  assert.equal(full[32], 95);
  assert.equal(full[48], 95);
});

test('findMatchingTrackIndex matches natural voice keywords like shakers or gangan', () => {
  const tracks = INITIAL_HIGHLIFE_ARRANGEMENT.tracks;
  assert.equal(findMatchingTrackIndex(tracks, 'shakers'), 0);
  assert.equal(findMatchingTrackIndex(tracks, 'wooden agogo'), 1);
  assert.equal(findMatchingTrackIndex(tracks, 'talking drum'), 6);
});

test('findMatchingTapPadIndex matches tap pads by alias', () => {
  const pads = createDefaultTapPads();
  assert.equal(findMatchingTapPadIndex(pads, 'shaker'), 0);
  assert.equal(findMatchingTapPadIndex(pads, 'cowbell'), 4);
  assert.equal(findMatchingTapPadIndex(pads, 'tambourine'), 5);
});
