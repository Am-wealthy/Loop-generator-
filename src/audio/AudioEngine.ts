import type { LoopBars, PercussionTrack, SampleCandidate } from '../types/sequencer';
import {
  clampBpm,
  dbToGain,
  encodeStereoWav,
  getActiveStepCount,
  getStepDurationSeconds,
  isTrackAudible,
} from '../utils/sequencerLogic';

const LOOKAHEAD_MS = 22; // Tight low-latency scheduler interval
const SCHEDULE_AHEAD_SEC = 0.085; // 85ms lookahead window

export class StudioAudioEngine {
  private ctx: AudioContext | null = null;
  private percussionBus: GainNode | null = null;
  private originalBus: GainNode | null = null;
  private sampleCache = new Map<string, AudioBuffer>();
  private pendingLoads = new Map<string, Promise<AudioBuffer>>();

  private originalBuffer: AudioBuffer | null = null;
  private originalSource: AudioBufferSourceNode | null = null;

  private isPlaying = false;
  private timerId: number | null = null;
  private nextStepTime = 0;
  private currentStep = 0;

  private bpm = 126;
  private loopBars: LoopBars = 4;
  private blendRatio = 0; // 0 = Percussion Only, 1 = Original Audio dominant
  private tracks: PercussionTrack[] = [];

  private onStepCallback: ((step: number) => void) | null = null;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AudioCtx({
        latencyHint: 'interactive',
      });
      this.percussionBus = this.ctx.createGain();
      this.originalBus = this.ctx.createGain();
      this.percussionBus.connect(this.ctx.destination);
      this.originalBus.connect(this.ctx.destination);
      this.applyBlend();
    }
    return this.ctx;
  }

  public async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  public setOnStep(cb: (step: number) => void): void {
    this.onStepCallback = cb;
  }

  public updateState(params: {
    bpm: number;
    loopBars: LoopBars;
    blendRatio: number;
    tracks: PercussionTrack[];
  }): void {
    this.bpm = clampBpm(params.bpm);
    this.loopBars = params.loopBars;
    this.blendRatio = Math.max(0, Math.min(1, params.blendRatio));
    this.tracks = params.tracks;
    this.applyBlend();
  }

  private applyBlend(): void {
    if (!this.ctx || !this.percussionBus || !this.originalBus) return;
    const now = this.ctx.currentTime;
    // Crossfade curve: at 0 -> 100% perc, 0% original. At 0.5 -> 100% perc, 70% original. At 1 -> 25% perc, 100% original.
    const percGain = this.blendRatio <= 0.5 ? 1 : Math.max(0.2, 1 - (this.blendRatio - 0.5) * 1.6);
    const origGain = this.originalBuffer ? Math.min(1, this.blendRatio * 1.35) : 0;

    this.percussionBus.gain.setTargetAtTime(percGain, now, 0.015);
    this.originalBus.gain.setTargetAtTime(origGain, now, 0.015);
  }

  public async decodeUploadedAudio(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensureContext();
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    this.originalBuffer = decoded;
    this.applyBlend();
    return decoded;
  }

  public clearUploadedAudio(): void {
    this.stopOriginalSource();
    this.originalBuffer = null;
    this.applyBlend();
  }

  public hasOriginalAudio(): boolean {
    return this.originalBuffer !== null;
  }

  public getOriginalDuration(): number {
    return this.originalBuffer?.duration ?? 0;
  }

  public async preloadTracks(tracks: PercussionTrack[]): Promise<void> {
    const ctx = this.ensureContext();
    const tasks: Promise<void>[] = [];
    for (const track of tracks) {
      const activeSample = track.samples?.[track.activeSampleIndex ?? 0];
      if (activeSample) {
        tasks.push(
          this.loadSampleBuffer(ctx, activeSample, track.instrument_id).then(
            () => undefined,
            () => undefined
          )
        );
      }
    }
    await Promise.all(tasks);
  }

  public async loadSampleBuffer(
    targetCtx: BaseAudioContext,
    sample: SampleCandidate,
    instrumentId: string
  ): Promise<AudioBuffer> {
    if (sample.source === 'synth' || sample.url.startsWith('synth://')) {
      const cacheKey = `${sample.url}@${targetCtx.sampleRate}`;
      const existing = this.sampleCache.get(cacheKey);
      if (existing) return existing;
      const synthBuf = this.createClickOrPercSynthBuffer(targetCtx, instrumentId);
      this.sampleCache.set(cacheKey, synthBuf);
      return synthBuf;
    }

    const cacheKey = `${sample.url}@${targetCtx.sampleRate}`;
    const cached = this.sampleCache.get(cacheKey);
    if (cached) return cached;

    const inFlight = this.pendingLoads.get(cacheKey);
    if (inFlight) return inFlight;

    const promise = (async () => {
      try {
        const res = await fetch(sample.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.arrayBuffer();
        const decoded = await targetCtx.decodeAudioData(data);
        this.sampleCache.set(cacheKey, decoded);
        return decoded;
      } catch {
        // Fallback acoustic synthesis if offline/CDN blocked
        const fallback = this.createClickOrPercSynthBuffer(targetCtx, instrumentId);
        this.sampleCache.set(cacheKey, fallback);
        return fallback;
      } finally {
        this.pendingLoads.delete(cacheKey);
      }
    })();

    this.pendingLoads.set(cacheKey, promise);
    return promise;
  }

  private createClickOrPercSynthBuffer(
    ctx: BaseAudioContext,
    instrumentId: string
  ): AudioBuffer {
    const sr = ctx.sampleRate;
    const isHiClick = instrumentId === 'click_hi';
    const isLoClick = instrumentId === 'click_lo';

    if (isHiClick || isLoClick) {
      const length = Math.floor(sr * 0.06);
      const buffer = ctx.createBuffer(1, length, sr);
      const ch = buffer.getChannelData(0);
      const freq = isHiClick ? 1560 : 1040;
      for (let i = 0; i < length; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 90);
        const transient = i < sr * 0.002 ? (Math.random() * 2 - 1) * 0.25 : 0;
        ch[i] = (Math.sin(2 * Math.PI * freq * t) * 0.85 + transient) * env;
      }
      return buffer;
    }

    // Short organic woody/membrane transient fallback
    const length = Math.floor(sr * 0.18);
    const buffer = ctx.createBuffer(1, length, sr);
    const ch = buffer.getChannelData(0);
    const id = instrumentId.toLowerCase();
    const baseFreq = id.includes('conga_low') || id.includes('talking')
      ? 165
      : id.includes('cowbell')
      ? 540
      : id.includes('agogo')
      ? 780
      : 280;
    const isNoise = id.includes('shekere') || id.includes('shaker') || id.includes('tamb');

    for (let i = 0; i < length; i++) {
      const t = i / sr;
      if (isNoise) {
        const env = Math.exp(-t * 32);
        ch[i] = (Math.random() * 2 - 1) * env * 0.55;
      } else {
        const env = Math.exp(-t * 24);
        const pitchDrop = baseFreq * (1 + 0.5 * Math.exp(-t * 60));
        ch[i] = Math.sin(2 * Math.PI * pitchDrop * t) * env * 0.75;
      }
    }
    return buffer;
  }

  public async triggerPreview(track: PercussionTrack): Promise<void> {
    await this.resume();
    const ctx = this.ensureContext();
    const sample = track.samples?.[track.activeSampleIndex ?? 0];
    if (!sample || !this.percussionBus) return;
    const buffer = await this.loadSampleBuffer(ctx, sample, track.instrument_id);
    this.triggerBufferAt(ctx, this.percussionBus, buffer, track, 95, ctx.currentTime + 0.005);
  }

  public async start(): Promise<void> {
    await this.resume();
    const ctx = this.ensureContext();
    if (this.isPlaying) return;

    await this.preloadTracks(this.tracks);

    this.isPlaying = true;
    this.currentStep = 0;
    this.nextStepTime = ctx.currentTime + 0.03;

    if (this.originalBuffer && this.originalBus) {
      this.stopOriginalSource();
      const src = ctx.createBufferSource();
      src.buffer = this.originalBuffer;
      src.loop = true;
      src.connect(this.originalBus);
      src.start(this.nextStepTime);
      this.originalSource = src;
    }

    this.timerId = window.setInterval(() => this.scheduler(), LOOKAHEAD_MS);
  }

  public stop(): void {
    this.isPlaying = false;
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    this.stopOriginalSource();
    this.currentStep = 0;
    if (this.onStepCallback) {
      this.onStepCallback(-1);
    }
  }

  private stopOriginalSource(): void {
    if (this.originalSource) {
      try {
        this.originalSource.stop();
        this.originalSource.disconnect();
      } catch {
        // Ignore already stopped source
      }
      this.originalSource = null;
    }
  }

  private scheduler(): void {
    if (!this.ctx || !this.isPlaying) return;
    const stepCount = getActiveStepCount(this.loopBars);
    const stepDuration = getStepDurationSeconds(this.bpm);

    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      const stepToSchedule = this.currentStep % stepCount;
      this.scheduleStep(stepToSchedule, this.nextStepTime);
      this.nextStepTime += stepDuration;
      this.currentStep = (this.currentStep + 1) % stepCount;
    }
  }

  private scheduleStep(stepIndex: number, when: number): void {
    if (!this.ctx || !this.percussionBus) return;
    const anySoloed = this.tracks.some((t) => Boolean(t.soloed));

    for (const track of this.tracks) {
      if (!isTrackAudible(track, anySoloed)) continue;
      const velocity = track.steps[stepIndex] ?? 0;
      if (velocity <= 0) continue;

      const sample = track.samples?.[track.activeSampleIndex ?? 0];
      if (!sample) continue;

      const cacheKey = `${sample.url}@${this.ctx.sampleRate}`;
      const buffer = this.sampleCache.get(cacheKey);
      if (buffer) {
        this.triggerBufferAt(this.ctx, this.percussionBus, buffer, track, velocity, when);
      } else {
        // Lazy load in background if swapped mid-play
        void this.loadSampleBuffer(this.ctx, sample, track.instrument_id);
      }
    }

    const delayMs = Math.max(0, (when - this.ctx.currentTime) * 1000);
    window.setTimeout(() => {
      if (this.isPlaying && this.onStepCallback) {
        this.onStepCallback(stepIndex);
      }
    }, delayMs);
  }

  private triggerBufferAt(
    ctx: BaseAudioContext,
    destination: AudioNode,
    buffer: AudioBuffer,
    track: PercussionTrack,
    velocity: number,
    when: number
  ): void {
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    const velGain = Math.max(0.05, Math.min(1, velocity / 100));
    const trackGain = dbToGain(track.volume_db);
    gainNode.gain.setValueAtTime(velGain * trackGain, when);

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, track.pan)), when);

    source.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(destination);

    source.start(when);
  }

  public async exportWavWithClick(params: {
    bpm: number;
    loopBars: LoopBars;
    tracks: PercussionTrack[];
    blendRatio: number;
  }): Promise<Blob> {
    const sampleRate = 44100;
    const stepCount = getActiveStepCount(params.loopBars);
    const stepDuration = getStepDurationSeconds(params.bpm);
    const totalDuration = stepCount * stepDuration;
    const totalFrames = Math.ceil(totalDuration * sampleRate);

    const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);
    const percBus = offlineCtx.createGain();
    const percGain =
      params.blendRatio <= 0.5 ? 1 : Math.max(0.2, 1 - (params.blendRatio - 0.5) * 1.6);
    percBus.gain.setValueAtTime(percGain, 0);
    percBus.connect(offlineCtx.destination);

    if (this.originalBuffer && params.blendRatio > 0.01) {
      const origBus = offlineCtx.createGain();
      origBus.gain.setValueAtTime(Math.min(1, params.blendRatio * 1.35), 0);
      origBus.connect(offlineCtx.destination);
      const origSrc = offlineCtx.createBufferSource();
      origSrc.buffer = this.originalBuffer;
      origSrc.loop = true;
      origSrc.connect(origBus);
      origSrc.start(0);
    }

    const anySoloed = params.tracks.some((t) => Boolean(t.soloed));
    const loadedBuffers = new Map<string, AudioBuffer>();

    for (const track of params.tracks) {
      if (!isTrackAudible(track, anySoloed)) continue;
      const sample = track.samples?.[track.activeSampleIndex ?? 0];
      if (!sample) continue;
      const buf = await this.loadSampleBuffer(offlineCtx, sample, track.instrument_id);
      loadedBuffers.set(track.instrument_id, buf);
    }

    for (let step = 0; step < stepCount; step++) {
      const when = step * stepDuration;
      for (const track of params.tracks) {
        if (!isTrackAudible(track, anySoloed)) continue;
        const velocity = track.steps[step] ?? 0;
        if (velocity <= 0) continue;
        const buf = loadedBuffers.get(track.instrument_id);
        if (!buf) continue;
        this.triggerBufferAt(offlineCtx, percBus, buf, track, velocity, when);
      }
    }

    const rendered = await offlineCtx.startRendering();
    const left = rendered.getChannelData(0);
    const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
    const wavBuffer = encodeStereoWav(left, right, sampleRate);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }
}
