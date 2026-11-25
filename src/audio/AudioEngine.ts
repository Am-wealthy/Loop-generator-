import type {
  LoopBars,
  PercussionTrack,
  SampleCandidate,
  TapPad,
} from '../types/sequencer';
import {
  clampBpm,
  dbToGain,
  encodeStereoWav,
  getActiveStepCount,
  getStepDurationSeconds,
  isTrackAudible,
} from '../utils/sequencerLogic';
import {
  getLoopDurationSeconds,
  getPhaseEventsInWindow,
  normalizePhase,
} from '../utils/tapLoopLogic';

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
  private fallbackAudioEl: HTMLAudioElement | null = null;
  private fallbackObjectUrl: string | null = null;

  private isPlaying = false;
  private timerId: number | null = null;
  private nextStepTime = 0;
  private currentStep = 0;

  private engineMode: 'sequencer' | 'taploop' = 'sequencer';
  private tapPads: TapPad[] = [];
  private tapClickEnabled = false;
  private tapCycleStartTime = 0;
  private tapWindowCursor = 0;
  private customTapBuffers = new Map<string, AudioBuffer>();

  private bpm = 126;
  private loopBars: LoopBars = 4;
  private blendRatio = 0; // 0 = Percussion Only, 1 = Original Audio dominant
  private tracks: PercussionTrack[] = [];

  private onStepCallback: ((step: number) => void) | null = null;
  private onTapPhaseCallback: ((phase: number) => void) | null = null;
  private onTapPadTriggerCallback: ((padId: string) => void) | null = null;

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

  public getAudioTime(): number {
    return this.ensureContext().currentTime;
  }

  public setOnStep(cb: (step: number) => void): void {
    this.onStepCallback = cb;
  }

  public setOnTapPhase(cb: (phase: number) => void): void {
    this.onTapPhaseCallback = cb;
  }

  public setOnTapPadTrigger(cb: (padId: string) => void): void {
    this.onTapPadTriggerCallback = cb;
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

  public updateTapLoopState(params: {
    mode: 'sequencer' | 'taploop';
    tapPads: TapPad[];
    tapClickEnabled: boolean;
  }): void {
    this.engineMode = params.mode;
    this.tapPads = params.tapPads;
    this.tapClickEnabled = params.tapClickEnabled;
  }

  private applyBlend(): void {
    const percGain = this.blendRatio <= 0.5 ? 1 : Math.max(0.2, 1 - (this.blendRatio - 0.5) * 1.6);
    const hasOrig = Boolean(this.originalBuffer || this.fallbackAudioEl);
    const origGain = hasOrig ? Math.min(1, this.blendRatio * 1.35) : 0;

    if (this.fallbackAudioEl) {
      this.fallbackAudioEl.volume = Math.max(0, Math.min(1, origGain));
    }

    if (!this.ctx || !this.percussionBus || !this.originalBus) return;
    const now = this.ctx.currentTime;
    this.percussionBus.gain.setTargetAtTime(percGain, now, 0.015);
    this.originalBus.gain.setTargetAtTime(this.originalBuffer ? origGain : 0, now, 0.015);
  }

  private stripId3v2IfPresent(arrayBuffer: ArrayBuffer): ArrayBuffer | null {
    if (arrayBuffer.byteLength < 10) return null;
    const bytes = new Uint8Array(arrayBuffer);
    // "ID3" magic header
    if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
    const flags = bytes[5];
    const hasFooter = (flags & 0x10) !== 0;
    const tagSize =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    const offset = 10 + tagSize + (hasFooter ? 10 : 0);
    if (offset <= 10 || offset >= arrayBuffer.byteLength - 64) return null;
    return arrayBuffer.slice(offset);
  }

  public async loadUploadedFile(
    file: File
  ): Promise<{ buffer: AudioBuffer | null; playableViaElement: boolean }> {
    this.clearUploadedAudio();
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Autoplay policy may defer resume until user gesture; decodeAudioData can still run
      }
    }

    const arrayBuffer = await file.arrayBuffer();

    // 1. Try direct Web Audio decodeAudioData
    try {
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      this.originalBuffer = decoded;
      this.applyBlend();
      return { buffer: decoded, playableViaElement: false };
    } catch {
      // 2. Retry after stripping ID3v2 artwork/metadata headers on MP3 files
      const stripped = this.stripId3v2IfPresent(arrayBuffer);
      if (stripped) {
        try {
          const decoded = await ctx.decodeAudioData(stripped);
          this.originalBuffer = decoded;
          this.applyBlend();
          return { buffer: decoded, playableViaElement: false };
        } catch {
          // Proceed to HTMLAudioElement fallback
        }
      }
    }

    // 3. Fallback to HTMLAudioElement (supports streaming MP3, AAC, M4A, Opus, etc.)
    const objectUrl = URL.createObjectURL(file);
    const audioEl = new Audio(objectUrl);
    audioEl.loop = true;
    audioEl.preload = 'metadata';

    const canPlay = await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        audioEl.removeEventListener('loadedmetadata', onOk);
        audioEl.removeEventListener('canplay', onOk);
        audioEl.removeEventListener('error', onErr);
        resolve(ok);
      };
      const onOk = () => done(true);
      const onErr = () => done(false);
      const timer = window.setTimeout(() => done(false), 1800);
      audioEl.addEventListener('loadedmetadata', onOk);
      audioEl.addEventListener('canplay', onOk);
      audioEl.addEventListener('error', onErr);
      audioEl.load();
    });

    if (canPlay) {
      this.fallbackObjectUrl = objectUrl;
      this.fallbackAudioEl = audioEl;
      this.applyBlend();
      return { buffer: null, playableViaElement: true };
    }

    URL.revokeObjectURL(objectUrl);
    this.applyBlend();
    return { buffer: null, playableViaElement: false };
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
    if (this.fallbackAudioEl) {
      this.fallbackAudioEl.pause();
      this.fallbackAudioEl.src = '';
      this.fallbackAudioEl = null;
    }
    if (this.fallbackObjectUrl) {
      URL.revokeObjectURL(this.fallbackObjectUrl);
      this.fallbackObjectUrl = null;
    }
    this.applyBlend();
  }

  public hasOriginalAudio(): boolean {
    return this.originalBuffer !== null || this.fallbackAudioEl !== null;
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

  public async preloadTapPads(pads: TapPad[]): Promise<void> {
    const ctx = this.ensureContext();
    await Promise.all(
      pads.map((pad) =>
        this.loadSampleBuffer(ctx, pad.sample, pad.id).then(
          () => undefined,
          () => undefined
        )
      )
    );
  }

  private trimLeadingSilence(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
    const maxScanFrames = Math.min(buffer.length, Math.floor(buffer.sampleRate * 0.25));
    const threshold = 0.012;
    let firstActiveFrame = 0;
    let found = false;

    for (let i = 0; i < maxScanFrames; i++) {
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        if (Math.abs(buffer.getChannelData(ch)[i]) >= threshold) {
          firstActiveFrame = Math.max(0, i - Math.floor(buffer.sampleRate * 0.002));
          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (!found || firstActiveFrame <= 64) {
      return buffer;
    }

    const remaining = buffer.length - firstActiveFrame;
    if (remaining <= 64) return buffer;

    const trimmed = ctx.createBuffer(buffer.numberOfChannels, remaining, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      trimmed.copyToChannel(src.subarray(firstActiveFrame), ch);
    }
    return trimmed;
  }

  public async loadTapPadFile(padId: string, file: File): Promise<SampleCandidate> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Ignore if deferred
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    let decoded: AudioBuffer | null = null;

    try {
      decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch {
      const stripped = this.stripId3v2IfPresent(arrayBuffer);
      if (stripped) {
        try {
          decoded = await ctx.decodeAudioData(stripped);
        } catch {
          decoded = null;
        }
      }
    }

    if (!decoded) {
      throw new Error('Could not decode this audio file. Please try WAV, MP3, or M4A.');
    }

    const tightBuffer = this.trimLeadingSilence(ctx, decoded);
    const customUrl = `custom://${padId}/${Date.now()}-${encodeURIComponent(file.name)}`;
    this.customTapBuffers.set(customUrl, tightBuffer);
    this.sampleCache.set(`${customUrl}@${ctx.sampleRate}`, tightBuffer);

    return {
      id: `custom-${padId}-${Date.now()}`,
      name: file.name.replace(/\.[^.]+$/, ''),
      url: customUrl,
      source: 'custom',
    };
  }

  public async loadSampleBuffer(
    targetCtx: BaseAudioContext,
    sample: SampleCandidate,
    instrumentId: string
  ): Promise<AudioBuffer> {
    if (sample.source === 'custom' || sample.url.startsWith('custom://')) {
      const custom = this.customTapBuffers.get(sample.url);
      if (custom) {
        return custom;
      }
    }

    if (sample.source === 'synth' || sample.url.startsWith('synth://')) {
      const cacheKey = `${sample.url}@${targetCtx.sampleRate}`;
      const existing = this.sampleCache.get(cacheKey);
      if (existing) return existing;
      const synthBuf = this.createClickOrPercSynthBuffer(
        targetCtx,
        sample.url.replace('synth://', '') || instrumentId
      );
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
    const id = instrumentId.toLowerCase();
    const isHiClick = id === 'click_hi';
    const isLoClick = id === 'click_lo';

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

    if (id.includes('warm_bass') || id.includes('deep_bass')) {
      const duration = id.includes('deep_bass') ? 0.42 : 0.34;
      const length = Math.floor(sr * duration);
      const buffer = ctx.createBuffer(1, length, sr);
      const ch = buffer.getChannelData(0);
      const fund = id.includes('deep_bass') ? 55 : 73.42; // A1 or D2 warm praise bass
      for (let i = 0; i < length; i++) {
        const t = i / sr;
        const attack = Math.min(1, t / 0.006);
        const env = attack * Math.exp(-t * (id.includes('deep_bass') ? 5.8 : 7.5));
        const pitch = fund * (1 + 0.45 * Math.exp(-t * 48));
        const fundamental = Math.sin(2 * Math.PI * pitch * t);
        const harmonic = 0.35 * Math.sin(2 * Math.PI * pitch * 2 * t) * Math.exp(-t * 14);
        ch[i] = Math.tanh((fundamental + harmonic) * 1.15) * env * 0.85;
      }
      return buffer;
    }

    if (id.includes('kick_thump')) {
      const length = Math.floor(sr * 0.24);
      const buffer = ctx.createBuffer(1, length, sr);
      const ch = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 15);
        const pitch = 52 * (1 + 2.4 * Math.exp(-t * 55));
        const click = i < sr * 0.005 ? (Math.random() * 2 - 1) * 0.3 : 0;
        ch[i] = Math.tanh((Math.sin(2 * Math.PI * pitch * t) + click) * 1.2) * env * 0.88;
      }
      return buffer;
    }

    // Short organic woody/membrane transient fallback
    const length = Math.floor(sr * 0.18);
    const buffer = ctx.createBuffer(1, length, sr);
    const ch = buffer.getChannelData(0);
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

  public async triggerTapPadNow(pad: TapPad, velocity = 96): Promise<{
    tapCtxTime: number;
    wasPlaying: boolean;
    elapsedInCycle: number;
    loopDuration: number;
  }> {
    await this.resume();
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    const loopDuration = getLoopDurationSeconds(this.bpm, this.loopBars);

    const cacheKey = `${pad.sample.url}@${ctx.sampleRate}`;
    const cached =
      this.customTapBuffers.get(pad.sample.url) ?? this.sampleCache.get(cacheKey);
    const buffer = cached ?? (await this.loadSampleBuffer(ctx, pad.sample, pad.id));

    if (this.percussionBus) {
      this.triggerPadBufferAt(
        ctx,
        this.percussionBus,
        buffer,
        pad.volume_db,
        velocity,
        now + 0.002
      );
    }

    const wasPlaying = this.isPlaying;
    const elapsedInCycle = wasPlaying ? Math.max(0, now - this.tapCycleStartTime) : 0;
    return { tapCtxTime: now, wasPlaying, elapsedInCycle, loopDuration };
  }

  public async startTapLoopFromTap(tapCtxTime: number): Promise<void> {
    await this.resume();
    const ctx = this.ensureContext();
    if (this.isPlaying) return;

    await this.preloadTapPads(this.tapPads);

    this.isPlaying = true;
    this.engineMode = 'taploop';
    this.tapCycleStartTime = tapCtxTime;
    this.tapWindowCursor = ctx.currentTime;
    this.currentStep = 0;
    this.nextStepTime = tapCtxTime;

    this.startOriginalPlayback(ctx.currentTime + 0.01);
    this.timerId = window.setInterval(() => this.scheduler(), LOOKAHEAD_MS);
  }

  private startOriginalPlayback(when: number): void {
    if (this.originalBuffer && this.originalBus) {
      this.stopOriginalSource();
      const ctx = this.ensureContext();
      const src = ctx.createBufferSource();
      src.buffer = this.originalBuffer;
      src.loop = true;
      src.connect(this.originalBus);
      src.start(when);
      this.originalSource = src;
    } else if (this.fallbackAudioEl) {
      this.fallbackAudioEl.currentTime = 0;
      void this.fallbackAudioEl.play().catch(() => undefined);
    }
  }

  public async start(): Promise<void> {
    await this.resume();
    const ctx = this.ensureContext();
    if (this.isPlaying) return;

    if (this.engineMode === 'taploop') {
      await this.preloadTapPads(this.tapPads);
      // Preload click hi/lo synths in case click guide is enabled
      await this.loadSampleBuffer(
        ctx,
        { id: 'synth-click-hi', name: 'Click Hi', url: 'synth://click_hi', source: 'synth' },
        'click_hi'
      );
      await this.loadSampleBuffer(
        ctx,
        { id: 'synth-click-lo', name: 'Click Lo', url: 'synth://click_lo', source: 'synth' },
        'click_lo'
      );
      this.isPlaying = true;
      this.tapCycleStartTime = ctx.currentTime + 0.03;
      this.tapWindowCursor = this.tapCycleStartTime;
      this.startOriginalPlayback(this.tapCycleStartTime);
      this.timerId = window.setInterval(() => this.scheduler(), LOOKAHEAD_MS);
      return;
    }

    await this.preloadTracks(this.tracks);

    this.isPlaying = true;
    this.currentStep = 0;
    this.nextStepTime = ctx.currentTime + 0.03;

    this.startOriginalPlayback(this.nextStepTime);

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
    if (this.onTapPhaseCallback) {
      this.onTapPhaseCallback(-1);
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
    if (this.fallbackAudioEl) {
      this.fallbackAudioEl.pause();
      this.fallbackAudioEl.currentTime = 0;
    }
  }

  private scheduler(): void {
    if (!this.ctx || !this.isPlaying) return;

    if (this.engineMode === 'taploop') {
      this.scheduleTapLoopWindow();
      return;
    }

    const stepCount = getActiveStepCount(this.loopBars);
    const stepDuration = getStepDurationSeconds(this.bpm);

    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      const stepToSchedule = this.currentStep % stepCount;
      this.scheduleStep(stepToSchedule, this.nextStepTime);
      this.nextStepTime += stepDuration;
      this.currentStep = (this.currentStep + 1) % stepCount;
    }
  }

  private scheduleTapLoopWindow(): void {
    if (!this.ctx || !this.percussionBus) return;
    const loopDuration = getLoopDurationSeconds(this.bpm, this.loopBars);
    if (loopDuration <= 0) return;

    const targetEnd = this.ctx.currentTime + SCHEDULE_AHEAD_SEC;
    if (this.tapWindowCursor < this.ctx.currentTime - 0.1) {
      this.tapWindowCursor = this.ctx.currentTime;
    }

    if (targetEnd > this.tapWindowCursor) {
      const windowStart = this.tapWindowCursor;
      const startPhase = normalizePhase((windowStart - this.tapCycleStartTime) / loopDuration);
      const spanPhase = (targetEnd - windowStart) / loopDuration;

      for (const pad of this.tapPads) {
        if (pad.muted || pad.events.length === 0) continue;
        const matches = getPhaseEventsInWindow(pad.events, startPhase, spanPhase);
        if (matches.length === 0) continue;

        const buffer =
          this.customTapBuffers.get(pad.sample.url) ??
          this.sampleCache.get(`${pad.sample.url}@${this.ctx.sampleRate}`);
        if (!buffer) {
          void this.loadSampleBuffer(this.ctx, pad.sample, pad.id);
          continue;
        }

        for (const match of matches) {
          const when = windowStart + match.offsetRatio * loopDuration;
          if (
            match.event.skipUntilCtxTime &&
            when < match.event.skipUntilCtxTime
          ) {
            continue;
          }
          this.triggerPadBufferAt(
            this.ctx,
            this.percussionBus,
            buffer,
            pad.volume_db,
            match.event.velocity,
            when
          );
          const delayMs = Math.max(0, (when - this.ctx.currentTime) * 1000);
          const padId = pad.id;
          window.setTimeout(() => {
            if (this.isPlaying && this.onTapPadTriggerCallback) {
              this.onTapPadTriggerCallback(padId);
            }
          }, delayMs);
        }
      }

      if (this.tapClickEnabled) {
        const totalBeats = this.loopBars * 4;
        const clickEvents = Array.from({ length: totalBeats }, (_, beatIdx) => ({
          id: `click-${beatIdx}`,
          phase: beatIdx / totalBeats,
          velocity: beatIdx % 4 === 0 ? 96 : 74,
          isBeatOne: beatIdx % 4 === 0,
        }));
        const clickMatches = getPhaseEventsInWindow(clickEvents, startPhase, spanPhase);
        for (const match of clickMatches) {
          const isBeatOne = (match.event as { isBeatOne?: boolean }).isBeatOne;
          const synthKey = isBeatOne ? 'synth://click_hi' : 'synth://click_lo';
          const clickBuf = this.sampleCache.get(`${synthKey}@${this.ctx.sampleRate}`);
          if (clickBuf) {
            const when = windowStart + match.offsetRatio * loopDuration;
            this.triggerPadBufferAt(
              this.ctx,
              this.percussionBus,
              clickBuf,
              isBeatOne ? -3 : -5,
              match.event.velocity,
              when
            );
          }
        }
      }

      this.tapWindowCursor = targetEnd;
    }

    if (this.onTapPhaseCallback) {
      const currentPhase = normalizePhase(
        (this.ctx.currentTime - this.tapCycleStartTime) / loopDuration
      );
      this.onTapPhaseCallback(currentPhase);
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

  private triggerPadBufferAt(
    ctx: BaseAudioContext,
    destination: AudioNode,
    buffer: AudioBuffer,
    volumeDb: number,
    velocity: number,
    when: number
  ): void {
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    const velGain = Math.max(0.05, Math.min(1, velocity / 100));
    const padGain = dbToGain(volumeDb);
    gainNode.gain.setValueAtTime(velGain * padGain, when);

    source.connect(gainNode);
    gainNode.connect(destination);
    source.start(when);
  }

  public async exportWavWithClick(params: {
    bpm: number;
    loopBars: LoopBars;
    tracks: PercussionTrack[];
    blendRatio: number;
    tapPads?: TapPad[];
    exportTapLoop?: boolean;
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

    if (params.exportTapLoop && params.tapPads) {
      const padBuffers = new Map<string, AudioBuffer>();
      for (const pad of params.tapPads) {
        if (pad.muted || pad.events.length === 0) continue;
        const buf = await this.loadSampleBuffer(offlineCtx, pad.sample, pad.id);
        padBuffers.set(pad.id, buf);
      }

      for (const pad of params.tapPads) {
        if (pad.muted || pad.events.length === 0) continue;
        const buf = padBuffers.get(pad.id);
        if (!buf) continue;
        for (const ev of pad.events) {
          const when = normalizePhase(ev.phase) * totalDuration;
          this.triggerPadBufferAt(offlineCtx, percBus, buf, pad.volume_db, ev.velocity, when);
        }
      }

      // Render synced Click Hi (Beat 1) and Click Lo (Beats 2, 3, 4)
      const clickHiBuf = await this.loadSampleBuffer(
        offlineCtx,
        { id: 'synth-click-hi', name: 'Click Hi', url: 'synth://click_hi', source: 'synth' },
        'click_hi'
      );
      const clickLoBuf = await this.loadSampleBuffer(
        offlineCtx,
        { id: 'synth-click-lo', name: 'Click Lo', url: 'synth://click_lo', source: 'synth' },
        'click_lo'
      );
      const totalBeats = params.loopBars * 4;
      for (let b = 0; b < totalBeats; b++) {
        const when = (b / totalBeats) * totalDuration;
        const isBeatOne = b % 4 === 0;
        this.triggerPadBufferAt(
          offlineCtx,
          percBus,
          isBeatOne ? clickHiBuf : clickLoBuf,
          isBeatOne ? -2 : -4,
          isBeatOne ? 100 : 88,
          when
        );
      }
    } else {
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
    }

    const rendered = await offlineCtx.startRendering();
    const left = rendered.getChannelData(0);
    const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
    const wavBuffer = encodeStereoWav(left, right, sampleRate);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }
}
