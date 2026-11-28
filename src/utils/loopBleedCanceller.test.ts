import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRms,
  estimateAcousticDelaySamples,
  isolateCleanVocalFromLoopBleed,
  polishCleanHumBuffer,
  RealTimeLoopBleedCanceller,
} from './loopBleedCanceller.ts';

function makePercussionLoopRef(sampleRate: number, seconds: number): Float32Array {
  const n = Math.floor(sampleRate * seconds);
  const ref = new Float32Array(n);
  // Crisp shaker + conga beats every 0.25s
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const beatPhase = (t * 4) % 1;
    const env = Math.exp(-beatPhase * 18);
    // Conga tone + shaker noise-like harmonics
    ref[i] =
      (Math.sin(2 * Math.PI * 195 * t) * 0.32 +
        Math.sin(2 * Math.PI * 1140 * t) * 0.14) *
      env;
  }
  return ref;
}

test('isolateCleanVocalFromLoopBleed leaves headphone recordings untouched when no bleed is correlated', () => {
  const sr = 22050;
  const n = sr * 2;
  const ref = makePercussionLoopRef(sr, 2);
  const mic = new Float32Array(n);
  // Singer humming 261.63Hz clean melody only (uncorrelated with 195Hz/1140Hz loop)
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    mic[i] = t > 0.5 && t < 1.5 ? Math.sin(2 * Math.PI * 261.63 * t) * 0.38 : 0;
  }

  const res = isolateCleanVocalFromLoopBleed(mic, ref, sr);
  assert.equal(res.bleedCancelled, false);
  assert.equal(res.cleanPcm.length, mic.length);
  // Verify clean note RMS is preserved identically
  const origRms = computeRms(mic, Math.floor(0.6 * sr), Math.floor(1.4 * sr));
  const outRms = computeRms(res.cleanPcm, Math.floor(0.6 * sr), Math.floor(1.4 * sr));
  assert.ok(Math.abs(origRms - outRms) < 1e-4);
});

test('isolateCleanVocalFromLoopBleed finds acoustic delay, cancels speaker loop bleed, and preserves hummed voice', () => {
  const sr = 22050;
  const seconds = 3;
  const n = sr * seconds;
  const ref = makePercussionLoopRef(sr, seconds);
  const trueHum = new Float32Array(n);
  const mic = new Float32Array(n);
  const delaySamples = Math.round(0.032 * sr); // 32ms acoustic delay

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // Singer hums between 1.1s and 2.3s cleanly; bars 0..1.1s and 2.3..3.0s have only loop bleed!
    const hum = t >= 1.1 && t <= 2.3 ? Math.sin(2 * Math.PI * 293.66 * t) * 0.35 : 0;
    trueHum[i] = hum;
    const directBleed = i >= delaySamples ? ref[i - delaySamples] * 0.42 : 0;
    const earlyRefl = i >= delaySamples + 8 ? ref[i - delaySamples - 8] * 0.14 : 0;
    mic[i] = hum + directBleed + earlyRefl;
  }

  const est = estimateAcousticDelaySamples(mic, ref, sr);
  assert.equal(est.hasBleed, true);
  assert.ok(
    Math.abs(est.delaySamples - delaySamples) <= 4,
    `Expected delay ~${delaySamples}, got ${est.delaySamples}`
  );

  const res = isolateCleanVocalFromLoopBleed(mic, ref, sr);
  assert.equal(res.bleedCancelled, true);
  assert.ok(res.bleedReductionDb >= 8, `Expected >=8dB bleed reduction, got ${res.bleedReductionDb}`);

  // Pre-hum bleed-only gap (0.2s..0.95s) should be dramatically quieter than raw mic bleed
  const rawGapRms = computeRms(mic, Math.floor(0.2 * sr), Math.floor(0.95 * sr));
  const cleanGapRms = computeRms(res.cleanPcm, Math.floor(0.2 * sr), Math.floor(0.95 * sr));
  assert.ok(
    cleanGapRms < rawGapRms * 0.25,
    `Expected bleed-only gap RMS to drop >75%, raw=${rawGapRms.toFixed(4)} clean=${cleanGapRms.toFixed(4)}`
  );

  // Sung hum region (1.2s..2.2s) must retain vocal loudness without hollowing out voice
  const trueHumRms = computeRms(trueHum, Math.floor(1.2 * sr), Math.floor(2.2 * sr));
  const cleanHumRms = computeRms(res.cleanPcm, Math.floor(1.2 * sr), Math.floor(2.2 * sr));
  assert.ok(
    cleanHumRms >= trueHumRms * 0.72,
    `Expected sung hum to preserve >=72% energy, true=${trueHumRms.toFixed(4)} clean=${cleanHumRms.toFixed(4)}`
  );
});

test('RealTimeLoopBleedCanceller suppresses pure bleed blocks while passing active vocal double-talk', () => {
  const sr = 22050;
  const blockSize = 2048;
  const ref = makePercussionLoopRef(sr, 2.5);
  const canceller = new RealTimeLoopBleedCanceller(sr, 200);
  const delaySamples = Math.round(0.025 * sr);

  let pureBleedDetections = 0;
  // Feed 6 blocks of pure loop bleed (user waiting to hum)
  for (let b = 0; b < 6; b++) {
    const start = b * blockSize;
    const refBlock = ref.subarray(start, start + blockSize);
    const micBlock = new Float32Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      const idx = start + i - delaySamples;
      micBlock[i] = idx >= 0 ? ref[idx] * 0.35 : 0;
    }
    const out = canceller.processLiveBlock(micBlock, refBlock);
    if (b >= 2 && out.isPureLoopBleed) {
      pureBleedDetections++;
    }
  }
  assert.ok(
    pureBleedDetections >= 2,
    `Expected pure speaker bleed blocks to be flagged, got ${pureBleedDetections}`
  );

  // Now feed active vocal hum (330Hz) on top of the loop bleed
  const start = 6 * blockSize;
  const refBlock = ref.subarray(start, start + blockSize);
  const micWithHum = new Float32Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    const idx = start + i - delaySamples;
    const t = (start + i) / sr;
    micWithHum[i] =
      Math.sin(2 * Math.PI * 330 * t) * 0.42 + (idx >= 0 ? ref[idx] * 0.35 : 0);
  }
  const humOut = canceller.processLiveBlock(micWithHum, refBlock);
  assert.equal(humOut.isPureLoopBleed, false);
});

test('polishCleanHumBuffer boosts soft hum safely without clipping', () => {
  const sr = 22050;
  const pcm = new Float32Array(sr);
  for (let i = 0; i < sr; i++) {
    pcm[i] = Math.sin((2 * Math.PI * 220 * i) / sr) * 0.08;
  }
  const polished = polishCleanHumBuffer(pcm, sr);
  const peak = polished.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak > 0.15 && peak <= 0.95);
});
