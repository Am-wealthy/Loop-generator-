import type { StemNote } from '../types/sequencer.ts';
import {
  preloadBasicPitchModel,
  transcribePolyphonicStemWithBasicPitch,
  transcribeVocalAudioWithBasicPitch,
  type ExtractedPolyphonicNote,
} from './basicPitchTranscription.ts';

if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  (globalThis as { window: typeof globalThis }).window = globalThis;
}

type WorkerRequest =
  | { type: 'preload'; id: number }
  | {
      type: 'transcribe';
      id: number;
      pcmBuffer: ArrayBuffer;
      sampleRate: number;
      stepDurationSec: number;
      stepCount: number;
      allowExtendedTimeline?: boolean;
      onsetThreshold?: number;
      frameThreshold?: number;
      minimumNoteLengthMs?: number;
      multiplePitchBends?: boolean;
    }
  | {
      type: 'transcribe_polyphonic';
      id: number;
      pcmBuffer: ArrayBuffer;
      sampleRate: number;
      stepDurationSec: number;
      stepCount: number;
      onsetThreshold?: number;
      frameThreshold?: number;
      minimumNoteLengthMs?: number;
    };

type WorkerResponse =
  | { type: 'ready'; id: number }
  | { type: 'progress'; id: number; progress: number }
  | { type: 'result'; id: number; notes: StemNote[] }
  | { type: 'result_polyphonic'; id: number; notes: ExtractedPolyphonicNote[] }
  | { type: 'error'; id: number; message: string };

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'preload') {
    try {
      await preloadBasicPitchModel();
      const reply: WorkerResponse = { type: 'ready', id: msg.id };
      self.postMessage(reply);
    } catch (err) {
      const reply: WorkerResponse = {
        type: 'error',
        id: msg.id,
        message: err instanceof Error ? err.message : 'Failed to preload Basic Pitch',
      };
      self.postMessage(reply);
    }
    return;
  }

  if (msg.type === 'transcribe') {
    try {
      const pcm = new Float32Array(msg.pcmBuffer);
      const notes = await transcribeVocalAudioWithBasicPitch(pcm, msg.sampleRate, {
        stepDurationSec: msg.stepDurationSec,
        stepCount: msg.stepCount,
        allowExtendedTimeline: msg.allowExtendedTimeline,
        onsetThreshold: msg.onsetThreshold,
        frameThreshold: msg.frameThreshold,
        minimumNoteLengthMs: msg.minimumNoteLengthMs,
        multiplePitchBends: msg.multiplePitchBends,
        onProgress: (progress) => {
          const progReply: WorkerResponse = { type: 'progress', id: msg.id, progress };
          self.postMessage(progReply);
        },
      });
      const reply: WorkerResponse = { type: 'result', id: msg.id, notes };
      self.postMessage(reply);
    } catch (err) {
      const reply: WorkerResponse = {
        type: 'error',
        id: msg.id,
        message: err instanceof Error ? err.message : 'Basic Pitch worker failed',
      };
      self.postMessage(reply);
    }
    return;
  }

  if (msg.type === 'transcribe_polyphonic') {
    try {
      const pcm = new Float32Array(msg.pcmBuffer);
      const notes = await transcribePolyphonicStemWithBasicPitch(pcm, msg.sampleRate, {
        stepDurationSec: msg.stepDurationSec,
        stepCount: msg.stepCount,
        onsetThreshold: msg.onsetThreshold,
        frameThreshold: msg.frameThreshold,
        minimumNoteLengthMs: msg.minimumNoteLengthMs,
        onProgress: (progress) => {
          const progReply: WorkerResponse = { type: 'progress', id: msg.id, progress };
          self.postMessage(progReply);
        },
      });
      const reply: WorkerResponse = { type: 'result_polyphonic', id: msg.id, notes };
      self.postMessage(reply);
    } catch (err) {
      const reply: WorkerResponse = {
        type: 'error',
        id: msg.id,
        message: err instanceof Error ? err.message : 'Polyphonic Basic Pitch worker failed',
      };
      self.postMessage(reply);
    }
  }
};
