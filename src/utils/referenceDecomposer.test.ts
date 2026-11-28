import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeBarsAndSegmentStructure,
  allocateMidiTo18InstrumentTracks,
  assembleReferenceDecomposition,
  BUILT_IN_PERCUSSION_LOOPS,
  buildTrack1PercussionClips,
  createSyntheticDemoReferencePcm,
  detectAndPlaceTransitionFx,
  detectReferenceBpmAndBeatOffset,
  detectReferenceKey,
  expandSectionNotesAcrossSong,
  extractSectionRepresentativeSlices,
  INSTRUMENT_18_VOICE_BANK,
  separateHarmonicStemPcm,
} from './referenceDecomposer.ts';
import type { ExtractedPolyphonicNote } from './basicPitchTranscription.ts';

test('detectReferenceBpmAndBeatOffset identifies 120 BPM pulse accurately', () => {
  const { pcm, sampleRate } = createSyntheticDemoReferencePcm(22050, 120);
  const res = detectReferenceBpmAndBeatOffset(pcm, sampleRate);
  assert.ok(
    Math.abs(res.bpm - 120) <= 2,
    `Expected ~120 BPM, got ${res.bpm}`
  );
  assert.ok(res.confidence >= 0.35 && res.confidence <= 1);
  assert.ok(res.beatOffsetSec >= 0 && res.beatOffsetSec < 1);
});

test('detectReferenceKey detects C major from tonal demo audio and MIDI', () => {
  const { pcm, sampleRate } = createSyntheticDemoReferencePcm(22050, 120);
  const res = detectReferenceKey(pcm, sampleRate, [
    { midi: 60, durationSteps: 8, velocity: 90 },
    { midi: 64, durationSteps: 8, velocity: 85 },
    { midi: 67, durationSteps: 8, velocity: 85 },
    { midi: 48, durationSteps: 16, velocity: 92 },
  ]);
  assert.equal(res.rootKey, 'C');
  assert.equal(res.scaleType, 'major');
});

test('analyzeBarsAndSegmentStructure identifies intro/breakdown without percussion and chorus/verse with percussion', () => {
  const { pcm, sampleRate } = createSyntheticDemoReferencePcm(22050, 120);
  const { barMetrics, sections, totalBars } = analyzeBarsAndSegmentStructure(
    pcm,
    sampleRate,
    120,
    0
  );

  assert.equal(totalBars, 16);
  assert.equal(barMetrics.length, 16);

  // Intro bars (0..1) and Breakdown bars (12..13) should have zero percussion
  assert.equal(barMetrics[0].hasPercussion, false);
  assert.equal(barMetrics[1].hasPercussion, false);
  assert.equal(barMetrics[12].hasPercussion, false);
  assert.equal(barMetrics[13].hasPercussion, false);

  // Verse/Chorus bars (2..11) should detect rhythmic groove
  const groovedCount = barMetrics.slice(2, 12).filter((b) => b.hasPercussion).length;
  assert.ok(groovedCount >= 8, `Expected >=8 grooved middle bars, got ${groovedCount}`);

  assert.ok(sections.some((s) => s.type === 'intro' && !s.hasPercussion));
  assert.ok(sections.some((s) => (s.type === 'verse' || s.type === 'chorus') && s.hasPercussion));
  assert.ok(sections.some((s) => s.type === 'breakdown' && !s.hasPercussion));
});

test('buildTrack1PercussionClips uses light percussion only and skips empty intro/breakdown bars', () => {
  const { pcm, sampleRate } = createSyntheticDemoReferencePcm(22050, 120);
  const { sections } = analyzeBarsAndSegmentStructure(pcm, sampleRate, 120, 0);
  const clips = buildTrack1PercussionClips(sections);

  assert.ok(clips.length >= 1, 'Expected at least 1 Track 1 percussion loop clip');

  // Verify zero clips cover bar 0 (intro) or bar 12 (breakdown)
  for (const clip of clips) {
    assert.ok(!(clip.startBar <= 0 && clip.endBar > 0), 'Bar 0 intro must remain empty');
    assert.ok(!(clip.startBar <= 12 && clip.endBar > 12), 'Bar 12 breakdown must remain empty');
    const template = BUILT_IN_PERCUSSION_LOOPS[clip.loopPresetId];
    assert.ok(template.layers.length >= 2);
    // Ensure no heavy drum kit kick/snare IDs in Track 1 light percussion library
    for (const layer of template.layers) {
      assert.equal(layer.instrumentId.includes('kick'), false);
      assert.equal(layer.instrumentId.includes('snare'), false);
    }
  }
});

test('allocateMidiTo18InstrumentTracks splits bass, mid chords, and high melodies across up to 18 channels', () => {
  assert.equal(INSTRUMENT_18_VOICE_BANK.length, 18);

  const syntheticNotes: ExtractedPolyphonicNote[] = [
    // Bass sustained -> Track 2 Sub Bass or Track 3 Bass Guitar
    {
      step: 0,
      midi: 36,
      durationSteps: 8,
      velocity: 92,
      amplitude: 0.85,
      startTimeSeconds: 0,
      durationSeconds: 1.0,
    },
    // Mid short chord -> Track 4 Piano / 6 EP / 16 Pluck
    {
      step: 0,
      midi: 60,
      durationSteps: 2,
      velocity: 84,
      amplitude: 0.78,
      startTimeSeconds: 0,
      durationSeconds: 0.25,
    },
    // Simultaneous mid sustained harmony at same step -> different channel!
    {
      step: 0,
      midi: 64,
      durationSteps: 8,
      velocity: 78,
      amplitude: 0.74,
      startTimeSeconds: 0,
      durationSeconds: 1.0,
    },
    // High melody -> Track 18 Synth Lead or 17 Pluck / 13 Strings
    {
      step: 0,
      midi: 76,
      durationSteps: 4,
      velocity: 95,
      amplitude: 0.88,
      startTimeSeconds: 0,
      durationSeconds: 0.5,
    },
  ];

  const tracks = allocateMidiTo18InstrumentTracks(syntheticNotes, 4);
  assert.equal(tracks.length, 18);
  assert.equal(tracks[0].trackNumber, 2);
  assert.equal(tracks[17].trackNumber, 19);

  const activeTracks = tracks.filter((t) => t.isActive);
  assert.equal(activeTracks.length, 4, 'Four simultaneous register/sustain notes should route to 4 separate mixer tracks');
});

test('detectAndPlaceTransitionFx places risers, reverse cymbals, sweeps, and sub-impacts at section boundaries', () => {
  const { pcm, sampleRate } = createSyntheticDemoReferencePcm(22050, 120);
  const { sections } = analyzeBarsAndSegmentStructure(pcm, sampleRate, 120, 0);
  const fxEvents = detectAndPlaceTransitionFx(sections);

  assert.ok(fxEvents.length >= 2, 'Expected transition FX events at section changes');
  assert.ok(fxEvents.some((e) => e.type === 'riser' || e.type === 'sweep'));
  assert.ok(fxEvents.some((e) => e.type === 'sub_impact'));
  for (const ev of fxEvents) {
    assert.ok(ev.trackNumber === 20 || ev.trackNumber === 21);
    assert.ok(ev.triggerStep >= 0);
  }
});

test('separateHarmonicStemPcm and assembleReferenceDecomposition produce coherent complete arrangement', () => {
  const { pcm, sampleRate, durationSec } = createSyntheticDemoReferencePcm(22050, 120);
  const harm = separateHarmonicStemPcm(pcm, pcm, sampleRate);
  assert.equal(harm.length, pcm.length);

  const bpmRes = detectReferenceBpmAndBeatOffset(pcm, sampleRate);
  const seg = analyzeBarsAndSegmentStructure(pcm, sampleRate, bpmRes.bpm, bpmRes.beatOffsetSec);

  const sampleNotes: ExtractedPolyphonicNote[] = [
    { step: 32, midi: 36, durationSteps: 8, velocity: 90, amplitude: 0.85, startTimeSeconds: 4.0, durationSeconds: 1.0 },
    { step: 32, midi: 60, durationSteps: 6, velocity: 82, amplitude: 0.76, startTimeSeconds: 4.0, durationSeconds: 0.75 },
    { step: 128, midi: 72, durationSteps: 4, velocity: 92, amplitude: 0.88, startTimeSeconds: 16.0, durationSeconds: 0.5 },
  ];

  const result = assembleReferenceDecomposition({
    fileName: 'demo-reference.wav',
    durationSec,
    bpm: bpmRes.bpm,
    beatOffsetSec: bpmRes.beatOffsetSec,
    harmonicPcm: harm,
    sampleRate,
    barMetrics: seg.barMetrics,
    sections: seg.sections,
    totalBars: seg.totalBars,
    extractedNotes: sampleNotes,
  });

  assert.equal(result.instrumentTracks.length, 18);
  assert.ok(result.track1Clips.length >= 1);
  assert.ok(result.transitionFxEvents.length >= 1);
  assert.equal(result.instrumentTracks.filter((t) => t.isActive).length, 3);
});

test('extractSectionRepresentativeSlices caps CPU frame length and expandSectionNotesAcrossSong maps sections', () => {
  const { pcm, sampleRate } = createSyntheticDemoReferencePcm(22050, 120);
  const { barMetrics, sections, totalBars } = analyzeBarsAndSegmentStructure(pcm, sampleRate, 120, 0);
  const slices = extractSectionRepresentativeSlices(pcm, sampleRate, 120, sections, barMetrics);

  assert.ok(slices.length >= 2 && slices.length <= 3);
  for (const s of slices) {
    assert.ok(s.pcm.length <= Math.floor(1.81 * sampleRate) + 1);
  }

  const expanded = expandSectionNotesAcrossSong({
    archetypeNotes: {
      intro: [{ step: 0, midi: 60, durationSteps: 8, velocity: 72, amplitude: 0.6, startTimeSeconds: 0, durationSeconds: 1 }],
      verse: [{ step: 4, midi: 48, durationSteps: 4, velocity: 84, amplitude: 0.75, startTimeSeconds: 0.5, durationSeconds: 0.5 }],
      chorus: [{ step: 0, midi: 76, durationSteps: 4, velocity: 95, amplitude: 0.9, startTimeSeconds: 0, durationSeconds: 0.5 }],
    },
    sections,
    barMetrics,
    bpm: 120,
    totalBars,
  });

  assert.ok(expanded.length >= 8);
  assert.ok(expanded.some((n) => n.step >= 8 * 16 && n.midi === 76));
});

