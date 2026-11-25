/**
 * Downsamples an AudioBuffer segment to compact 16 kHz mono 16-bit PCM WAV
 * so full-length gospel songs (~10-50 MB) upload and analyze in seconds
 * without freezing the browser tab or hitting payload caps.
 */
export function encodeMonoWav16kFromChannel(
  channelData: Float32Array,
  sourceSampleRate: number,
  startSeconds = 0,
  maxDurationSeconds = 20
): ArrayBuffer {
  const targetRate = 16000;
  const startFrame = Math.max(0, Math.floor(startSeconds * sourceSampleRate));
  const maxSourceFrames = Math.floor(maxDurationSeconds * sourceSampleRate);
  const availableFrames = Math.max(0, channelData.length - startFrame);
  const usedSourceFrames = Math.min(availableFrames, maxSourceFrames);

  const ratio = sourceSampleRate / targetRate;
  const outFrames = Math.max(1, Math.floor(usedSourceFrames / ratio));
  const dataSize = outFrames * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < outFrames; i++) {
    const srcIdx = Math.min(channelData.length - 1, startFrame + Math.floor(i * ratio));
    const sample = Math.max(-1, Math.min(1, channelData[srcIdx] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

export function mixAudioBufferToMonoSegment(
  buffer: AudioBuffer,
  startSeconds: number,
  maxDurationSeconds = 20
): ArrayBuffer {
  const ch0 = buffer.getChannelData(0);
  if (buffer.numberOfChannels === 1) {
    return encodeMonoWav16kFromChannel(
      ch0,
      buffer.sampleRate,
      startSeconds,
      maxDurationSeconds
    );
  }
  const ch1 = buffer.getChannelData(1);
  const startFrame = Math.max(0, Math.floor(startSeconds * buffer.sampleRate));
  const maxFrames = Math.min(
    ch0.length - startFrame,
    Math.floor(maxDurationSeconds * buffer.sampleRate)
  );
  const mono = new Float32Array(Math.max(1, maxFrames));
  for (let i = 0; i < maxFrames; i++) {
    mono[i] = 0.5 * ((ch0[startFrame + i] ?? 0) + (ch1[startFrame + i] ?? 0));
  }
  return encodeMonoWav16kFromChannel(mono, buffer.sampleRate, 0, maxDurationSeconds);
}
