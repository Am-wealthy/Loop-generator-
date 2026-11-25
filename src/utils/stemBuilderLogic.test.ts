import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultStemChannels,
  detectPitchHzAutocorrelation,
  freqToMidi,
  isMidiInScale,
  midiToFreq,
  midiToNoteName,
  snapMidiToScale,
  snapNotesToScale,
  toggleStemNote,
  transposeNotes,
} from './stemBuilderLogic.ts';

test('midiToNoteName and freqToMidi round-trip standard concert pitches', () => {
  assert.equal(midiToNoteName(60), 'C4');
  assert.equal(midiToNoteName(69), 'A4');
  assert.equal(freqToMidi(440), 69);
  assert.equal(freqToMidi(midiToFreq(65)), 65);
});

test('snapMidiToScale fixes off-key notes cleanly into target musical key', () => {
  // F#4 (66) is off-key in C Major -> snaps to G4 (67) or F4 (65)
  assert.equal(isMidiInScale(66, 'C', 'major'), false);
  const snapped = snapMidiToScale(66, 'C', 'major');
  assert.equal(isMidiInScale(snapped, 'C', 'major'), true);

  const notes = [
    { step: 0, midi: 61, durationSteps: 2, velocity: 90 }, // C#4 (off-key in C Major)
    { step: 4, midi: 64, durationSteps: 2, velocity: 90 }, // E4 (in key)
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

test('detectPitchHzAutocorrelation accurately detects synthetic sung fundamental frequency and rejects silence', () => {
  const sr = 16000;
  const len = 1024;
  const silence = new Float32Array(len);
  assert.equal(detectPitchHzAutocorrelation(silence, sr), null);

  // Synthetic 220 Hz (A3) hum wave with harmonic overtone
  const wave = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    wave[i] = 0.55 * Math.sin(2 * Math.PI * 220 * t) + 0.18 * Math.sin(2 * Math.PI * 440 * t);
  }
  const detectedHz = detectPitchHzAutocorrelation(wave, sr);
  assert.ok(detectedHz !== null);
  assert.ok(Math.abs(detectedHz - 220) < 6, `Expected ~220Hz, got ${detectedHz}`);
  assert.equal(freqToMidi(detectedHz), 57); // A3
});

test('createDefaultStemChannels populates multi-track FL-style rack sequences', () => {
  const channels = createDefaultStemChannels();
  assert.equal(channels.length, 3);
  assert.ok(channels.every((ch) => ch.notes.length > 0));
});
