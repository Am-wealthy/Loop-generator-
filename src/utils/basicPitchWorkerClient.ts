import type { StemNote } from '../types/sequencer.ts';
import {
  isSoftwareWebGlEnvironment,
  preloadBasicPitchModel,
  transcribePolyphonicStemWithBasicPitch,
  transcribeVocalAudioWithBasicPitch,
  type ExtractedPolyphonicNote,
  type VocalTranscriptionOptions,
} from './basicPitchTranscription.ts';

export { isSoftwareWebGlEnvironment };

type WorkerResponse =
  | { type: 'ready'; id: number }
  | { type: 'progress'; id: number; progress: number }
  | { type: 'result'; id: number; notes: StemNote[] }
  | { type: 'result_polyphonic'; id: number; notes: ExtractedPolyphonicNote[] }
  | { type: 'error'; id: number; message: string };

interface PendingJob {
  resolve: (value: StemNote[] | ExtractedPolyphonicNote[] | void) => void;
  reject: (reason?: unknown) => void;
  onProgress?: (progress: number) => void;
}

let workerInstance: Worker | null = null;
let workerFailed = false;
let nextJobId = 1;
const pendingJobs = new Map<number, PendingJob>();

function getWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (!workerInstance) {
    try {
      workerInstance = new Worker(new URL('./basicPitch.worker.ts', import.meta.url), {
        type: 'module',
      });
      workerInstance.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (!msg) return;
        const job = pendingJobs.get(msg.id);
        if (!job) return;
        if (msg.type === 'progress') {
          job.onProgress?.(msg.progress);
          return;
        }
        pendingJobs.delete(msg.id);
        if (msg.type === 'ready') {
          job.resolve();
        } else if (msg.type === 'result') {
          job.resolve(msg.notes);
        } else if (msg.type === 'result_polyphonic') {
          job.resolve(msg.notes);
        } else if (msg.type === 'error') {
          job.reject(new Error(msg.message));
        }
      };
      workerInstance.onerror = (err) => {
        workerFailed = true;
        workerInstance?.terminate();
        workerInstance = null;
        for (const [, job] of pendingJobs) {
          job.reject(err);
        }
        pendingJobs.clear();
      };
    } catch {
      workerFailed = true;
      workerInstance = null;
      return null;
    }
  }
  return workerInstance;
}

export async function preloadBasicPitchWorker(): Promise<void> {
  const worker = getWorker();
  if (!worker) {
    await preloadBasicPitchModel();
    return;
  }
  const id = nextJobId++;
  try {
    await new Promise<void>((resolve, reject) => {
      pendingJobs.set(id, {
        resolve: () => resolve(),
        reject,
      });
      worker.postMessage({ type: 'preload', id });
    });
  } catch {
    await preloadBasicPitchModel();
  }
}

export async function transcribeVocalAudioInWorker(
  pcm: Float32Array,
  sampleRate: number,
  options: VocalTranscriptionOptions
): Promise<StemNote[]> {
  const worker = getWorker();
  if (!worker) {
    return transcribeVocalAudioWithBasicPitch(pcm, sampleRate, options);
  }

  const id = nextJobId++;
  const pcmCopy = new Float32Array(pcm);
  try {
    const result = await new Promise<StemNote[]>((resolve, reject) => {
      pendingJobs.set(id, {
        resolve: (val) => resolve((val as StemNote[]) ?? []),
        reject,
        onProgress: options.onProgress,
      });
      worker.postMessage(
        {
          type: 'transcribe',
          id,
          pcmBuffer: pcmCopy.buffer,
          sampleRate,
          stepDurationSec: options.stepDurationSec,
          stepCount: options.stepCount,
          allowExtendedTimeline: options.allowExtendedTimeline,
          onsetThreshold: options.onsetThreshold,
          frameThreshold: options.frameThreshold,
          minimumNoteLengthMs: options.minimumNoteLengthMs,
          multiplePitchBends: options.multiplePitchBends,
        },
        [pcmCopy.buffer]
      );
    });
    return result;
  } catch {
    return transcribeVocalAudioWithBasicPitch(pcm, sampleRate, options);
  }
}

export async function transcribePolyphonicStemInWorker(
  pcm: Float32Array,
  sampleRate: number,
  options: {
    stepDurationSec: number;
    stepCount: number;
    onsetThreshold?: number;
    frameThreshold?: number;
    minimumNoteLengthMs?: number;
    onProgress?: (progress: number) => void;
  }
): Promise<ExtractedPolyphonicNote[]> {
  const worker = getWorker();
  if (!worker) {
    return transcribePolyphonicStemWithBasicPitch(pcm, sampleRate, options);
  }

  const id = nextJobId++;
  const pcmCopy = new Float32Array(pcm);
  try {
    const result = await new Promise<ExtractedPolyphonicNote[]>((resolve, reject) => {
      pendingJobs.set(id, {
        resolve: (val) => resolve((val as ExtractedPolyphonicNote[]) ?? []),
        reject,
        onProgress: options.onProgress,
      });
      worker.postMessage(
        {
          type: 'transcribe_polyphonic',
          id,
          pcmBuffer: pcmCopy.buffer,
          sampleRate,
          stepDurationSec: options.stepDurationSec,
          stepCount: msgSafe(options.stepCount),
          onsetThreshold: options.onsetThreshold,
          frameThreshold: options.frameThreshold,
          minimumNoteLengthMs: options.minimumNoteLengthMs,
        },
        [pcmCopy.buffer]
      );
    });
    return result;
  } catch {
    return transcribePolyphonicStemWithBasicPitch(pcm, sampleRate, options);
  }
}

function msgSafe(stepCount: number): number {
  return Math.max(16, Math.round(stepCount));
}
