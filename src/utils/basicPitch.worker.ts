import type { StemNote } from '../types/sequencer.ts';
import {
  preloadBasicPitchModel,
  transcribeVocalAudioWithBasicPitch,
} from './basicPitchTranscription.ts';

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
    };

type WorkerResponse =
  | { type: 'ready'; id: number }
  | { type: 'progress'; id: number; progress: number }
  | { type: 'result'; id: number; notes: StemNote[] }
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
  }
};
