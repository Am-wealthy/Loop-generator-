import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeMonoWav16kFromChannel } from './audioUploadHelper.ts';

test('encodeMonoWav16kFromChannel produces compact 16kHz mono RIFF WAV digest', () => {
  // Simulate 30 seconds of 44.1kHz audio
  const sr = 44100;
  const src = new Float32Array(sr * 30);
  src[sr * 10] = 0.75;

  const wav = encodeMonoWav16kFromChannel(src, sr, 10, 20);
  const view = new DataView(wav);

  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  assert.equal(riff, 'RIFF');
  assert.equal(view.getUint16(22, true), 1); // mono
  assert.equal(view.getUint32(24, true), 16000); // 16kHz
  // 20 seconds @ 16kHz 16-bit mono = 640,000 bytes + 44 header
  assert.equal(wav.byteLength, 44 + 20 * 16000 * 2);
});
