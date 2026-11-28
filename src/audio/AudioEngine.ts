import type {
  ExportOptions,
  KeyboardSoundId,
  LoopBars,
  PercussionTrack,
  ReferenceDecompositionResult,
  ReverbRoomSize,
  SampleCandidate,
  StemChannel,
  StemLoopSource,
  TapLoopSettings,
  TapPad,
  TransitionFxEvent,
} from '../types/sequencer';
import { BUILT_IN_PERCUSSION_LOOPS } from '../utils/referenceDecomposer';
import {
  buildFallbackWaveformPeaks,
  clampBpm,
  dbToGain,
  encodeRepeatedStereoWavBlob,
  getActiveStepCount,
  getStepDurationSeconds,
  isTrackAudible,
  MAX_UPLOAD_DURATION_SECONDS,
  shouldStreamAudioFile,
} from '../utils/sequencerLogic';
import {
  clampCutoffHz,
  clampResonanceQ,
  clampUnit,
  DEFAULT_TAP_LOOP_SETTINGS,
  getReverbDecaySeconds,
  isTapPadAudible,
  snapStepFromTiming,
} from '../utils/tapLoopLogic';
import {
  getChannelTimelineSteps,
  getSongTimelineSteps,
  isAnyStemSoloed,
  isStemChannelAudible,
  isStemLoopAudible,
  midiToFreq,
} from '../utils/stemBuilderLogic';

const LOOKAHEAD_MS = 22; // Tight low-latency scheduler interval
const SCHEDULE_AHEAD_SEC = 0.085; // 85ms lookahead window
const SAMPLE_FETCH_TIMEOUT_MS = 2500;

function createSilentWavDataUri(durationSeconds = 0.5): string {
  const sampleRate = 8000;
  const numFrames = Math.max(1, Math.floor(sampleRate * durationSeconds));
  const dataSize = numFrames * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

const SILENT_LOOP_WAV_DATA_URI = createSilentWavDataUri(0.5);

export class StudioAudioEngine {
  private ctx: AudioContext | null = null;
  private masterCompressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private percussionBus: GainNode | null = null;
  private originalBus: GainNode | null = null;
  private silentKeepaliveEl: HTMLAudioElement | null = null;
  private fallbackBufferCache = new Map<string, AudioBuffer>();

  // Tap Loop FX graph:
  // Dry Pad -> tapMasterFilter -> percussionBus
  // Pad Reverb Send -> tapReverbConvolver -> tapReverbReturn -> tapMasterFilter
  private tapMasterFilter: BiquadFilterNode | null = null;
  private tapReverbConvolver: ConvolverNode | null = null;
  private tapReverbReturn: GainNode | null = null;
  private currentReverbSize: ReverbRoomSize = 'hall';

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

  private engineMode: 'sequencer' | 'taploop' | 'stems' | 'decomposer' = 'sequencer';
  private tapPads: TapPad[] = [];
  private metronomeEnabled = true;
  private tapSettings: TapLoopSettings = { ...DEFAULT_TAP_LOOP_SETTINGS };
  private skipOnceMap = new Map<string, { stepIndex: number; untilTime: number }>();
  private customTapBuffers = new Map<string, AudioBuffer>();

  // Reference Song Decomposer state
  private decomposerResult: ReferenceDecompositionResult | null = null;
  private decomposerRefBuffer: AudioBuffer | null = null;
  private decomposerRefSource: AudioBufferSourceNode | null = null;
  private decomposerRefGain: GainNode | null = null;
  private decomposerOriginalMix = 0; // 0 = Extracted Stems Only, 1 = Original Reference Song Only
  private decomposerNoiseBuffer: AudioBuffer | null = null;

  // Stem Builder state
  private stemChannels: StemChannel[] = [];
  private stemLoopSource: StemLoopSource = 'sequencer';
  private stemLoopMuted = false;
  private stemLoopSoloed = false;
  private stemLoopVolumeDb = -2;
  private stemHumBuffers = new Map<string, AudioBuffer>();
  private activeHumSources: Array<{ channelId: string; src: AudioBufferSourceNode }> = [];
  private activeHumGains: Array<{ channelId: string; gain: GainNode }> = [];
  private humPreviewSource: AudioBufferSourceNode | null = null;
  private stemPhoneLoopBuffer: AudioBuffer | null = null;
  private stemPhoneLoopSource: AudioBufferSourceNode | null = null;
  private stemPhoneLoopGain: GainNode | null = null;
  private stemPhoneLoopEl: HTMLAudioElement | null = null;
  private stemPhoneLoopObjectUrl: string | null = null;

  // Hum recording isolation state
  private isRecordingHum = false;
  private muteBackingWhileHum = false;

  private bpm = 126;
  private loopBars: LoopBars = 4;
  private blendRatio = 0; // 0 = Percussion Only, 1 = Original Audio dominant
  private tracks: PercussionTrack[] = [];

  private onStepCallback: ((step: number) => void) | null = null;
  private onTapPadTriggerCallback: ((padId: string) => void) | null = null;
  private onAudioStateChangeCallback: ((state: AudioContextState) => void) | null = null;

  private buildReverbImpulse(
    ctx: BaseAudioContext,
    decaySeconds: number
  ): AudioBuffer {
    const sr = ctx.sampleRate;
    const length = Math.max(1, Math.floor(sr * decaySeconds));
    const impulse = ctx.createBuffer(2, length, sr);

    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        // Early pre-delay smoothness + exponential natural hall tail
        const env = Math.pow(1 - t, 2.6) * (i < sr * 0.01 ? i / (sr * 0.01) : 1);
        const white = Math.random() * 2 - 1;
        // Gentle low-pass damping inside impulse so tail sounds warm, never harsh
        lp = lp * 0.42 + white * 0.58;
        data[i] = lp * env * 0.65;
      }
    }
    return impulse;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AudioCtx({
        latencyHint: 'interactive',
      });
      this.ctx.addEventListener('statechange', () => {
        if (this.ctx && this.onAudioStateChangeCallback) {
          this.onAudioStateChangeCallback(this.ctx.state);
        }
      });

      this.masterCompressor = this.ctx.createDynamicsCompressor();
      this.masterCompressor.threshold.value = -12;
      this.masterCompressor.knee.value = 12;
      this.masterCompressor.ratio.value = 4;
      this.masterCompressor.attack.value = 0.003;
      this.masterCompressor.release.value = 0.14;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1.1;

      this.percussionBus = this.ctx.createGain();
      this.originalBus = this.ctx.createGain();

      this.percussionBus.connect(this.masterCompressor);
      this.originalBus.connect(this.masterCompressor);
      this.masterCompressor.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.tapMasterFilter = this.ctx.createBiquadFilter();
      this.tapMasterFilter.type = 'lowpass';
      this.tapMasterFilter.frequency.value = this.tapSettings.cutoffHz;
      this.tapMasterFilter.Q.value = this.tapSettings.resonanceQ;
      this.tapMasterFilter.connect(this.percussionBus);

      this.tapReverbConvolver = this.ctx.createConvolver();
      this.currentReverbSize = this.tapSettings.reverbSize;
      this.tapReverbConvolver.buffer = this.buildReverbImpulse(
        this.ctx,
        getReverbDecaySeconds(this.currentReverbSize)
      );

      this.tapReverbReturn = this.ctx.createGain();
      this.tapReverbReturn.gain.value = this.tapSettings.masterReverb * 1.25;
      this.tapReverbConvolver.connect(this.tapReverbReturn);
      this.tapReverbReturn.connect(this.tapMasterFilter);

      this.applyBlend();
      this.applyTapSettingsToAudioNodes();
    }
    return this.ctx;
  }

  /**
   * Synchronously unlocks Web Audio & mobile/iOS audio session inside a user gesture
   * (pointerdown/touchstart/click/keydown) without waiting on promises or network calls.
   */
  public unlockSync(): AudioContext {
    try {
      const nav = navigator as unknown as {
        audioSession?: { type?: string };
      };
      if (nav.audioSession && nav.audioSession.type !== 'playback') {
        nav.audioSession.type = 'playback';
      }
    } catch {
      // Ignore unsupported audioSession API
    }

    const ctx = this.ensureContext();
    if (ctx.state !== 'running') {
      void ctx
        .resume()
        .then(() => {
          if (this.onAudioStateChangeCallback) {
            this.onAudioStateChangeCallback(ctx.state);
          }
        })
        .catch(() => undefined);
    }

    // Play a 1-sample silent buffer synchronously inside gesture to unlock iOS/Safari/iframe audio
    try {
      const silentBuf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const silentSrc = ctx.createBufferSource();
      silentSrc.buffer = silentBuf;
      silentSrc.connect(ctx.destination);
      silentSrc.start(0);
    } catch {
      // Ignore if context is closed
    }

    // Prime continuous looping silent HTMLAudioElement inside user gesture so iOS/mobile
    // routes Web Audio through Media Playback even when hardware mute switch is on or in an iframe.
    try {
      if (!this.silentKeepaliveEl) {
        const el = new Audio(SILENT_LOOP_WAV_DATA_URI);
        el.loop = true;
        el.preload = 'auto';
        el.volume = 0.01;
        el.setAttribute('playsinline', 'true');
        el.setAttribute('webkit-playsinline', 'true');
        this.silentKeepaliveEl = el;
      }
      if (this.silentKeepaliveEl.paused) {
        void this.silentKeepaliveEl.play().catch(() => undefined);
      }
    } catch {
      // Ignore
    }

    if (this.onAudioStateChangeCallback) {
      this.onAudioStateChangeCallback(ctx.state);
    }
    return ctx;
  }

  public getSharedAudioContext(): AudioContext {
    return this.ensureContext();
  }

  public async resumeAfterMicStart(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        // Ignore if still blocked
      }
    }
    if (this.isPlaying && this.silentKeepaliveEl && this.silentKeepaliveEl.paused) {
      try {
        void this.silentKeepaliveEl.play().catch(() => undefined);
      } catch {
        // Ignore
      }
    }
    if (this.onAudioStateChangeCallback) {
      this.onAudioStateChangeCallback(ctx.state);
    }
  }

  private getEffectiveStemSongSteps(): number {
    const percStepCount = getActiveStepCount(this.loopBars);
    return this.engineMode === 'stems'
      ? getSongTimelineSteps(this.stemChannels, percStepCount)
      : percStepCount;
  }

  public setHumRecordingState(
    active: boolean,
    muteBackingWhileHum = false,
    minTimelineSteps?: number
  ): void {
    const wasActive = this.isRecordingHum;
    this.isRecordingHum = active;
    this.muteBackingWhileHum = muteBackingWhileHum;
    if (active) {
      this.stopActiveHumSources();
      if (!wasActive && this.isPlaying) {
        this.currentStep = 0;
      }
    } else if (wasActive && this.isPlaying) {
      const songSteps = Math.max(
        this.getEffectiveStemSongSteps(),
        minTimelineSteps ?? 0
      );
      this.currentStep = this.currentStep % Math.max(1, songSteps);
    }
    this.applyBlend();
    this.syncStemLoopOutputs();
  }

  public getAudioContextState(): AudioContextState | 'uninitialized' {
    return this.ctx ? this.ctx.state : 'uninitialized';
  }

  public setOnAudioStateChange(cb: (state: AudioContextState) => void): void {
    this.onAudioStateChangeCallback = cb;
  }

  public async resume(): Promise<void> {
    const ctx = this.unlockSync();
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        // Ignore if blocked before gesture
      }
    }
    if (this.onAudioStateChangeCallback) {
      this.onAudioStateChangeCallback(ctx.state);
    }
  }

  public setOnStep(cb: (step: number) => void): void {
    this.onStepCallback = cb;
  }

  public setOnTapPadTrigger(cb: (padId: string) => void): void {
    this.onTapPadTriggerCallback = cb;
  }

  public updateState(params: {
    bpm: number;
    loopBars: LoopBars;
    blendRatio: number;
    tracks: PercussionTrack[];
    metronomeEnabled?: boolean;
  }): void {
    this.bpm = clampBpm(params.bpm);
    this.loopBars = params.loopBars;
    this.blendRatio = Math.max(0, Math.min(1, params.blendRatio));
    this.tracks = params.tracks;
    if (typeof params.metronomeEnabled === 'boolean') {
      this.metronomeEnabled = params.metronomeEnabled;
    }
    this.applyBlend();
  }

  public updateTapLoopState(params: {
    mode: 'sequencer' | 'taploop' | 'stems' | 'decomposer';
    tapPads: TapPad[];
    tapClickEnabled: boolean;
    tapSettings?: TapLoopSettings;
  }): void {
    this.engineMode = params.mode;
    this.tapPads = params.tapPads;
    this.metronomeEnabled = params.tapClickEnabled;
    if (params.tapSettings) {
      this.tapSettings = {
        cutoffHz: clampCutoffHz(params.tapSettings.cutoffHz),
        resonanceQ: clampResonanceQ(params.tapSettings.resonanceQ),
        masterReverb: clampUnit(params.tapSettings.masterReverb),
        reverbSize: params.tapSettings.reverbSize,
      };
    }
    this.applyTapSettingsToAudioNodes();
  }

  public setDecomposerData(result: ReferenceDecompositionResult | null): void {
    this.decomposerResult = result;
    if (result && this.engineMode === 'decomposer') {
      this.bpm = clampBpm(result.bpm);
    }
  }

  public setDecomposerReferenceBuffer(buffer: AudioBuffer | null): void {
    this.stopDecomposerRefSource();
    this.decomposerRefBuffer = buffer;
  }

  public setDecomposerOriginalMix(mix: number): void {
    this.decomposerOriginalMix = clampUnit(mix);
    this.applyBlend();
  }

  public async toggleDecomposerPlayback(
    result: ReferenceDecompositionResult,
    startBar = 0
  ): Promise<boolean> {
    const ctx = this.unlockSync();
    if (this.isPlaying && this.engineMode === 'decomposer') {
      this.stop();
      return false;
    }
    if (this.isPlaying) {
      this.stop();
    }
    this.engineMode = 'decomposer';
    this.decomposerResult = result;
    this.bpm = clampBpm(result.bpm);
    this.ensureClickBuffersCached(ctx);
    this.isPlaying = true;
    const clampedBar = Math.max(0, Math.min(result.totalBars - 1, startBar));
    this.currentStep = clampedBar * 16;
    this.nextStepTime = ctx.currentTime + 0.025;
    this.applyBlend();
    this.startDecomposerRefSource(this.nextStepTime, clampedBar);
    this.scheduler();
    this.timerId = window.setInterval(() => this.scheduler(), LOOKAHEAD_MS);

    if (ctx.state !== 'running') {
      void ctx
        .resume()
        .then(() => {
          if (this.onAudioStateChangeCallback) {
            this.onAudioStateChangeCallback(ctx.state);
          }
          if (this.isPlaying && ctx.state === 'running') {
            if (this.nextStepTime < ctx.currentTime - 0.02) {
              this.nextStepTime = ctx.currentTime + 0.015;
            }
            this.scheduler();
          }
        })
        .catch(() => undefined);
    }
    return true;
  }

  public seekDecomposerBar(barIndex: number): void {
    if (!this.decomposerResult || this.engineMode !== 'decomposer') return;
    const clampedBar = Math.max(
      0,
      Math.min(this.decomposerResult.totalBars - 1, barIndex)
    );
    this.currentStep = clampedBar * 16;
    if (this.isPlaying && this.ctx) {
      this.nextStepTime = this.ctx.currentTime + 0.02;
      this.startDecomposerRefSource(this.nextStepTime, clampedBar);
    }
    if (this.onStepCallback) {
      this.onStepCallback(this.currentStep);
    }
  }

  private startDecomposerRefSource(when: number, startBar: number): void {
    this.stopDecomposerRefSource();
    if (!this.decomposerRefBuffer || !this.decomposerResult || !this.ctx || !this.masterCompressor) {
      return;
    }
    const stepDuration = getStepDurationSeconds(this.decomposerResult.bpm);
    const offsetSec = Math.max(
      0,
      this.decomposerResult.beatOffsetSec + startBar * 16 * stepDuration
    );
    if (offsetSec >= this.decomposerRefBuffer.duration - 0.05) return;

    const src = this.ctx.createBufferSource();
    src.buffer = this.decomposerRefBuffer;
    const gain = this.ctx.createGain();
    const origGain = this.decomposerOriginalMix;
    gain.gain.setValueAtTime(origGain, when);
    src.connect(gain);
    gain.connect(this.masterCompressor);
    src.start(when, offsetSec);
    this.decomposerRefSource = src;
    this.decomposerRefGain = gain;
  }

  private stopDecomposerRefSource(): void {
    if (this.decomposerRefSource) {
      try {
        this.decomposerRefSource.stop();
        this.decomposerRefSource.disconnect();
      } catch {
        // Already stopped
      }
      this.decomposerRefSource = null;
    }
    if (this.decomposerRefGain) {
      try {
        this.decomposerRefGain.disconnect();
      } catch {
        // Ignore
      }
      this.decomposerRefGain = null;
    }
  }

  private computeEffectiveStemLoopGain(): number {
    const audible = isStemLoopAudible(
      this.stemLoopMuted,
      this.stemLoopSoloed,
      this.stemChannels
    );
    if (!audible) return 0;
    if (this.isRecordingHum && this.muteBackingWhileHum) return 0;
    const base = dbToGain(this.stemLoopVolumeDb);
    // Duck Row 1 loop gently while humming so speaker bleed doesn't drown the vocal mic
    return this.isRecordingHum ? base * 0.22 : base;
  }

  private syncStemLoopOutputs(): void {
    const targetGain = this.computeEffectiveStemLoopGain();
    if (this.ctx && this.stemPhoneLoopGain) {
      this.stemPhoneLoopGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.018);
    }
    if (this.stemPhoneLoopEl) {
      const shouldSilenceEl =
        this.engineMode !== 'stems' ||
        this.stemLoopSource !== 'phone_audio' ||
        targetGain <= 0.001;
      this.stemPhoneLoopEl.muted = shouldSilenceEl;
      this.stemPhoneLoopEl.volume = shouldSilenceEl
        ? 0
        : Math.max(0, Math.min(1, targetGain));
    }
  }

  public updateStemState(params: {
    stemChannels: StemChannel[];
    stemLoopSource: StemLoopSource;
    stemLoopMuted: boolean;
    stemLoopSoloed?: boolean;
    stemLoopVolumeDb: number;
  }): void {
    const prevSource = this.stemLoopSource;
    this.stemChannels = params.stemChannels;
    this.stemLoopSource = params.stemLoopSource;
    this.stemLoopMuted = params.stemLoopMuted;
    this.stemLoopSoloed = Boolean(params.stemLoopSoloed);
    this.stemLoopVolumeDb = params.stemLoopVolumeDb;
    if (this.isPlaying && this.engineMode === 'stems' && prevSource !== this.stemLoopSource) {
      if (this.stemLoopSource === 'phone_audio') {
        this.startStemPhoneLoopSource((this.ctx?.currentTime ?? 0) + 0.01);
      } else {
        this.stopStemPhoneLoopSource();
      }
    }
    if (this.ctx && this.activeHumGains.length > 0) {
      const now = this.ctx.currentTime;
      for (const entry of this.activeHumGains) {
        const ch = this.stemChannels.find((c) => c.id === entry.channelId);
        const audible =
          Boolean(ch) &&
          !this.isRecordingHum &&
          isStemChannelAudible(ch!, this.stemLoopSoloed, this.stemChannels);
        const target = audible && ch ? dbToGain(ch.volume_db) : 0;
        entry.gain.gain.setTargetAtTime(target, now, 0.015);
      }
    }
    this.syncStemLoopOutputs();
  }

  private async probeAudioMetadata(file: File): Promise<{
    ok: boolean;
    durationSeconds: number;
    element: HTMLAudioElement;
    objectUrl: string;
  }> {
    const objectUrl = URL.createObjectURL(file);
    const audioEl = new Audio(objectUrl);
    audioEl.loop = true;
    audioEl.preload = 'metadata';
    audioEl.setAttribute('playsinline', 'true');
    audioEl.setAttribute('webkit-playsinline', 'true');
    audioEl.addEventListener('timeupdate', () => {
      if (audioEl.currentTime >= MAX_UPLOAD_DURATION_SECONDS) {
        audioEl.currentTime = 0;
      }
    });

    const ok = await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (result: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        audioEl.removeEventListener('loadedmetadata', onOk);
        audioEl.removeEventListener('loadeddata', onOk);
        audioEl.removeEventListener('canplay', onOk);
        audioEl.removeEventListener('error', onErr);
        resolve(result);
      };
      const onOk = () => done(true);
      const onErr = () => done(false);
      const timer = window.setTimeout(() => done(false), 2600);
      audioEl.addEventListener('loadedmetadata', onOk);
      audioEl.addEventListener('loadeddata', onOk);
      audioEl.addEventListener('canplay', onOk);
      audioEl.addEventListener('error', onErr);
      audioEl.load();
    });

    const rawDur = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
    return { ok, durationSeconds: rawDur, element: audioEl, objectUrl };
  }

  private hasId3v2Header(buffer: ArrayBuffer): boolean {
    if (buffer.byteLength < 10) return false;
    const b = new Uint8Array(buffer, 0, 3);
    return b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33;
  }

  public async loadStemPhoneLoopFile(file: File): Promise<{
    durationSeconds: number;
    peaks: number[];
  }> {
    if (!file || file.size <= 0) {
      throw new Error('Selected audio file appears empty. Please pick another loop.');
    }

    this.clearStemPhoneLoop();
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Ignore deferred autoplay resume
      }
    }

    const probe = await this.probeAudioMetadata(file);
    const shouldStream = shouldStreamAudioFile(
      file.size,
      probe.durationSeconds,
      6 * 1024 * 1024,
      90
    );

    if (shouldStream && probe.ok) {
      this.stemPhoneLoopEl = probe.element;
      this.stemPhoneLoopObjectUrl = probe.objectUrl;
      this.syncStemLoopOutputs();
      if (this.isPlaying && this.engineMode === 'stems' && this.stemLoopSource === 'phone_audio') {
        this.startStemPhoneLoopSource(ctx.currentTime + 0.01);
      }
      return {
        durationSeconds: Math.min(
          probe.durationSeconds > 0 ? probe.durationSeconds : 30,
          MAX_UPLOAD_DURATION_SECONDS
        ),
        peaks: buildFallbackWaveformPeaks(48, file.name.length),
      };
    }

    let decoded: AudioBuffer | null = null;
    if (!shouldStream) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const maybeStripped = this.hasId3v2Header(arrayBuffer)
          ? this.stripId3v2IfPresent(arrayBuffer)
          : null;
        try {
          decoded = await ctx.decodeAudioData(arrayBuffer);
        } catch {
          if (maybeStripped) {
            decoded = await ctx.decodeAudioData(maybeStripped);
          }
        }
      } catch {
        decoded = null;
      }
    }

    if (decoded) {
      URL.revokeObjectURL(probe.objectUrl);
      probe.element.src = '';

      const trimmed = this.trimBufferToMaxDuration(ctx, decoded);
      this.stemPhoneLoopBuffer = trimmed.buffer;

      const chan = trimmed.buffer.getChannelData(0);
      const binCount = 48;
      const blockSize = Math.max(1, Math.floor(chan.length / binCount));
      const step = Math.max(4, Math.floor(blockSize / 32));
      const peaks: number[] = [];
      let maxPeak = 0.001;
      for (let i = 0; i < binCount; i++) {
        const start = i * blockSize;
        const end = Math.min(chan.length, start + blockSize);
        let pk = 0;
        for (let j = start; j < end; j += step) {
          const a = Math.abs(chan[j]);
          if (a > pk) pk = a;
        }
        if (pk > maxPeak) maxPeak = pk;
        peaks.push(pk);
      }
      if (this.isPlaying && this.engineMode === 'stems' && this.stemLoopSource === 'phone_audio') {
        this.startStemPhoneLoopSource(ctx.currentTime + 0.01);
      }
      return {
        durationSeconds: trimmed.durationSeconds,
        peaks: peaks.map((p) => p / maxPeak),
      };
    }

    // Fallback to streaming HTMLAudioElement when mobile codec fails Web Audio decodeAudioData
    if (probe.ok) {
      this.stemPhoneLoopEl = probe.element;
      this.stemPhoneLoopObjectUrl = probe.objectUrl;
      this.syncStemLoopOutputs();
      if (this.isPlaying && this.engineMode === 'stems' && this.stemLoopSource === 'phone_audio') {
        this.startStemPhoneLoopSource(ctx.currentTime + 0.01);
      }
      return {
        durationSeconds: Math.min(
          probe.durationSeconds > 0 ? probe.durationSeconds : 30,
          MAX_UPLOAD_DURATION_SECONDS
        ),
        peaks: buildFallbackWaveformPeaks(48, file.name.length),
      };
    }

    URL.revokeObjectURL(probe.objectUrl);
    probe.element.src = '';
    throw new Error('Could not load this loop file. Please try WAV, MP3, M4A, or AAC.');
  }

  public clearStemPhoneLoop(): void {
    this.stopStemPhoneLoopSource();
    this.stemPhoneLoopBuffer = null;
    if (this.stemPhoneLoopEl) {
      this.stemPhoneLoopEl.pause();
      this.stemPhoneLoopEl.src = '';
      this.stemPhoneLoopEl = null;
    }
    if (this.stemPhoneLoopObjectUrl) {
      URL.revokeObjectURL(this.stemPhoneLoopObjectUrl);
      this.stemPhoneLoopObjectUrl = null;
    }
  }

  private startStemPhoneLoopSource(when: number): void {
    this.stopStemPhoneLoopSource();
    if (this.engineMode !== 'stems' || this.stemLoopSource !== 'phone_audio') {
      return;
    }
    if (this.stemPhoneLoopBuffer) {
      const ctx = this.ensureContext();
      const src = ctx.createBufferSource();
      src.buffer = this.stemPhoneLoopBuffer;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(this.computeEffectiveStemLoopGain(), when);
      src.connect(gain);
      gain.connect(this.percussionBus ?? ctx.destination);
      src.start(when);
      this.stemPhoneLoopSource = src;
      this.stemPhoneLoopGain = gain;
    } else if (this.stemPhoneLoopEl) {
      this.syncStemLoopOutputs();
      this.stemPhoneLoopEl.currentTime = 0;
      void this.stemPhoneLoopEl.play().catch(() => undefined);
    }
  }

  private stopStemPhoneLoopSource(): void {
    if (this.stemPhoneLoopSource) {
      try {
        this.stemPhoneLoopSource.stop();
        this.stemPhoneLoopSource.disconnect();
      } catch {
        // Already stopped
      }
      this.stemPhoneLoopSource = null;
    }
    if (this.stemPhoneLoopGain) {
      try {
        this.stemPhoneLoopGain.disconnect();
      } catch {
        // Ignore
      }
      this.stemPhoneLoopGain = null;
    }
    if (this.stemPhoneLoopEl && !this.stemPhoneLoopEl.paused) {
      try {
        this.stemPhoneLoopEl.pause();
        this.stemPhoneLoopEl.currentTime = 0;
      } catch {
        // Ignore
      }
    }
  }

  public setStemHumAudioBuffer(channelId: string, buffer: AudioBuffer): void {
    this.stemHumBuffers.set(channelId, buffer);
  }

  public async loadStemHumAudio(channelId: string, blob: Blob): Promise<void> {
    const ctx = this.ensureContext();
    const arr = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arr.slice(0));
    this.stemHumBuffers.set(channelId, decoded);
  }

  public clearStemHumAudio(channelId: string): void {
    this.stopActiveHumSourcesForChannel(channelId);
    this.stemHumBuffers.delete(channelId);
  }

  public async playStemHumPreview(channelId: string): Promise<boolean> {
    const ctx = this.unlockSync();
    if (ctx.state !== 'running') {
      await this.resume();
    }
    this.stopStemHumPreview();
    const humBuf = this.stemHumBuffers.get(channelId);
    if (!humBuf) return false;

    // Skip leading silence when previewing standalone so Bar 2/3 hums play immediately,
    // while keeping full loop-aligned silence at offset 0 for in-time beat playback.
    let offsetSec = 0;
    const chan = humBuf.getChannelData(0);
    let firstActive = -1;
    for (let i = 0; i < chan.length; i++) {
      if (Math.abs(chan[i]) > 0.008) {
        firstActive = i;
        break;
      }
    }
    if (firstActive > 0) {
      offsetSec = Math.max(0, firstActive / humBuf.sampleRate - 0.02);
    }

    const src = ctx.createBufferSource();
    src.buffer = humBuf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1.0, ctx.currentTime);
    src.connect(gain);
    gain.connect(this.percussionBus ?? ctx.destination);
    src.onended = () => {
      if (this.humPreviewSource === src) {
        this.humPreviewSource = null;
      }
    };
    src.start(ctx.currentTime + 0.01, offsetSec);
    this.humPreviewSource = src;
    return true;
  }

  public stopStemHumPreview(): void {
    if (this.humPreviewSource) {
      try {
        this.humPreviewSource.stop();
        this.humPreviewSource.disconnect();
      } catch {
        // Already stopped
      }
      this.humPreviewSource = null;
    }
  }

  public getCurrentPlaybackTiming(): {
    isPlaying: boolean;
    currentStep: number;
    nextStepTime: number;
    stepDuration: number;
    stepCount: number;
    loopBedStepCount: number;
    ctxCurrentTime: number;
    baseLatency: number;
    outputLatency: number;
  } {
    const ctx = this.ensureContext();
    return {
      isPlaying: this.isPlaying,
      currentStep: this.currentStep,
      nextStepTime: this.nextStepTime,
      stepDuration: getStepDurationSeconds(this.bpm),
      stepCount: this.getEffectiveStemSongSteps(),
      loopBedStepCount: getActiveStepCount(this.loopBars),
      ctxCurrentTime: ctx.currentTime,
      baseLatency: typeof ctx.baseLatency === 'number' ? ctx.baseLatency : 0,
      outputLatency: typeof ctx.outputLatency === 'number' ? ctx.outputLatency : 0,
    };
  }

  private applyTapSettingsToAudioNodes(): void {
    if (!this.ctx || !this.tapMasterFilter || !this.tapReverbReturn) return;
    const now = this.ctx.currentTime;
    const targetCutoff =
      this.engineMode === 'taploop' ? this.tapSettings.cutoffHz : 20000;
    const targetQ =
      this.engineMode === 'taploop' ? this.tapSettings.resonanceQ : 0.7;

    this.tapMasterFilter.frequency.setTargetAtTime(targetCutoff, now, 0.018);
    this.tapMasterFilter.Q.setTargetAtTime(targetQ, now, 0.018);
    this.tapReverbReturn.gain.setTargetAtTime(
      this.tapSettings.masterReverb * 1.25,
      now,
      0.02
    );

    if (
      this.tapReverbConvolver &&
      this.tapSettings.reverbSize !== this.currentReverbSize
    ) {
      this.currentReverbSize = this.tapSettings.reverbSize;
      this.tapReverbConvolver.buffer = this.buildReverbImpulse(
        this.ctx,
        getReverbDecaySeconds(this.currentReverbSize)
      );
    }
  }

  private applyBlend(): void {
    if (this.engineMode === 'decomposer') {
      const mix = this.decomposerOriginalMix;
      const stemsGain = mix > 0.96 ? 0 : Math.max(0.28, 1 - mix * 0.68);
      if (this.ctx && this.percussionBus) {
        this.percussionBus.gain.setTargetAtTime(stemsGain, this.ctx.currentTime, 0.018);
      }
      if (this.ctx && this.decomposerRefGain) {
        this.decomposerRefGain.gain.setTargetAtTime(mix, this.ctx.currentTime, 0.018);
      }
      if (this.ctx && this.originalBus) {
        this.originalBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.015);
      }
      return;
    }

    const percGain =
      this.blendRatio <= 0.5 ? 1 : Math.max(0.2, 1 - (this.blendRatio - 0.5) * 1.6);
    const hasOrig = Boolean(this.originalBuffer || this.fallbackAudioEl);
    const silenceOrigForHum =
      this.isRecordingHum && (this.muteBackingWhileHum || this.engineMode === 'stems');
    const origGain =
      hasOrig && !silenceOrigForHum ? Math.min(1, this.blendRatio * 1.35) : 0;

    if (this.fallbackAudioEl) {
      this.fallbackAudioEl.volume = Math.max(0, Math.min(1, origGain));
    }

    if (!this.ctx || !this.percussionBus || !this.originalBus) return;
    const now = this.ctx.currentTime;
    this.percussionBus.gain.setTargetAtTime(percGain, now, 0.015);
    this.originalBus.gain.setTargetAtTime(
      this.originalBuffer ? origGain : 0,
      now,
      0.015
    );
  }

  private stripId3v2IfPresent(arrayBuffer: ArrayBuffer): ArrayBuffer | null {
    if (arrayBuffer.byteLength < 10) return null;
    const bytes = new Uint8Array(arrayBuffer);
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

  private trimBufferToMaxDuration(
    ctx: BaseAudioContext,
    buffer: AudioBuffer,
    maxSeconds = MAX_UPLOAD_DURATION_SECONDS
  ): { buffer: AudioBuffer; wasTrimmed: boolean; durationSeconds: number } {
    if (buffer.duration <= maxSeconds) {
      return {
        buffer,
        wasTrimmed: false,
        durationSeconds: buffer.duration,
      };
    }
    const maxFrames = Math.max(1, Math.floor(maxSeconds * buffer.sampleRate));
    const trimmed = ctx.createBuffer(
      buffer.numberOfChannels,
      maxFrames,
      buffer.sampleRate
    );
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      trimmed.copyToChannel(buffer.getChannelData(ch).subarray(0, maxFrames), ch);
    }
    return {
      buffer: trimmed,
      wasTrimmed: true,
      durationSeconds: maxSeconds,
    };
  }

  public async loadUploadedFile(file: File): Promise<{
    buffer: AudioBuffer | null;
    playableViaElement: boolean;
    wasTrimmed: boolean;
    durationSeconds: number;
  }> {
    this.clearUploadedAudio();
    if (!file || file.size <= 0) {
      return {
        buffer: null,
        playableViaElement: false,
        wasTrimmed: false,
        durationSeconds: 0,
      };
    }

    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Autoplay policy may defer resume until user gesture
      }
    }

    const probe = await this.probeAudioMetadata(file);
    const shouldStream = shouldStreamAudioFile(
      file.size,
      probe.durationSeconds,
      8 * 1024 * 1024,
      120
    );

    if (!shouldStream) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const maybeStripped = this.hasId3v2Header(arrayBuffer)
          ? this.stripId3v2IfPresent(arrayBuffer)
          : null;
        let decoded: AudioBuffer | null = null;
        try {
          decoded = await ctx.decodeAudioData(arrayBuffer);
        } catch {
          if (maybeStripped) {
            decoded = await ctx.decodeAudioData(maybeStripped);
          }
        }
        if (decoded) {
          URL.revokeObjectURL(probe.objectUrl);
          probe.element.src = '';
          const trimmed = this.trimBufferToMaxDuration(ctx, decoded);
          this.originalBuffer = trimmed.buffer;
          this.applyBlend();
          return {
            buffer: trimmed.buffer,
            playableViaElement: false,
            wasTrimmed: trimmed.wasTrimmed,
            durationSeconds: trimmed.durationSeconds,
          };
        }
      } catch {
        // Fall through to HTMLAudioElement streaming
      }
    }

    if (probe.ok) {
      this.fallbackObjectUrl = probe.objectUrl;
      this.fallbackAudioEl = probe.element;
      this.applyBlend();
      const rawDur = probe.durationSeconds;
      return {
        buffer: null,
        playableViaElement: true,
        wasTrimmed: rawDur > MAX_UPLOAD_DURATION_SECONDS,
        durationSeconds: Math.min(rawDur, MAX_UPLOAD_DURATION_SECONDS),
      };
    }

    URL.revokeObjectURL(probe.objectUrl);
    probe.element.src = '';
    this.applyBlend();
    return {
      buffer: null,
      playableViaElement: false,
      wasTrimmed: false,
      durationSeconds: 0,
    };
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

  public getOriginalBuffer(): AudioBuffer | null {
    return this.originalBuffer;
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
    await Promise.all([
      ...pads.map((pad) =>
        this.loadSampleBuffer(ctx, pad.sample, pad.id).then(
          () => undefined,
          () => undefined
        )
      ),
      this.loadSampleBuffer(
        ctx,
        { id: 'synth-click-hi', name: 'Click Hi', url: 'synth://click_hi', source: 'synth' },
        'click_hi'
      ),
      this.loadSampleBuffer(
        ctx,
        { id: 'synth-click-lo', name: 'Click Lo', url: 'synth://click_lo', source: 'synth' },
        'click_lo'
      ),
    ]);
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
    if (!file || file.size <= 0) {
      throw new Error('Selected pad audio file appears empty.');
    }
    if (file.size > 8 * 1024 * 1024) {
      throw new Error('One-shot pad samples must be under 8 MB. Use Stem Studio Row 1 for full phone loops.');
    }

    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Ignore if deferred
      }
    }

    const probe = await this.probeAudioMetadata(file);
    URL.revokeObjectURL(probe.objectUrl);
    probe.element.src = '';
    if (probe.durationSeconds > 20) {
      throw new Error('Pad hits should be under 20 seconds. Upload full loops in Stem Studio Row 1.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const maybeStripped = this.hasId3v2Header(arrayBuffer)
      ? this.stripId3v2IfPresent(arrayBuffer)
      : null;
    let decoded: AudioBuffer | null = null;

    try {
      decoded = await ctx.decodeAudioData(arrayBuffer);
    } catch {
      if (maybeStripped) {
        try {
          decoded = await ctx.decodeAudioData(maybeStripped);
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

  private getOrCreateFallbackBuffer(
    targetCtx: BaseAudioContext,
    instrumentId: string
  ): AudioBuffer {
    const key = `fallback://${instrumentId}@${targetCtx.sampleRate}`;
    const existing = this.fallbackBufferCache.get(key);
    if (existing) return existing;
    const created = this.createClickOrPercSynthBuffer(targetCtx, instrumentId);
    this.fallbackBufferCache.set(key, created);
    return created;
  }

  private ensureClickBuffersCached(targetCtx: BaseAudioContext): void {
    const hiKey = `synth://click_hi@${targetCtx.sampleRate}`;
    if (!this.sampleCache.has(hiKey)) {
      this.sampleCache.set(
        hiKey,
        this.createClickOrPercSynthBuffer(targetCtx, 'click_hi')
      );
    }
    const loKey = `synth://click_lo@${targetCtx.sampleRate}`;
    if (!this.sampleCache.has(loKey)) {
      this.sampleCache.set(
        loKey,
        this.createClickOrPercSynthBuffer(targetCtx, 'click_lo')
      );
    }
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
      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(),
        SAMPLE_FETCH_TIMEOUT_MS
      );
      try {
        const res = await fetch(sample.url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.arrayBuffer();
        const decoded = await targetCtx.decodeAudioData(data);
        this.sampleCache.set(cacheKey, decoded);
        return decoded;
      } catch {
        const fallback = this.getOrCreateFallbackBuffer(targetCtx, instrumentId);
        this.sampleCache.set(cacheKey, fallback);
        return fallback;
      } finally {
        window.clearTimeout(timeoutId);
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
      const fund = id.includes('deep_bass') ? 55 : 73.42;
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
    const ctx = this.unlockSync();
    const sample = track.samples?.[track.activeSampleIndex ?? 0];
    if (!sample || !this.percussionBus) return;
    const cacheKey = `${sample.url}@${ctx.sampleRate}`;
    const cached = this.sampleCache.get(cacheKey);
    if (cached) {
      this.triggerBufferAt(ctx, this.percussionBus, cached, track, 95, ctx.currentTime + 0.005);
      return;
    }
    const immediate = this.getOrCreateFallbackBuffer(ctx, track.instrument_id);
    this.triggerBufferAt(ctx, this.percussionBus, immediate, track, 95, ctx.currentTime + 0.005);
    void this.loadSampleBuffer(ctx, sample, track.instrument_id);
  }

  /**
   * Triggers a Tap Pad immediately with zero latency through the Tap Loop filter & reverb graph
   * and returns the exact tempo-snapped stepIndex (0..stepCount-1).
   */
  public async triggerTapPadNow(
    pad: TapPad,
    velocity = 94
  ): Promise<{
    stepIndex: number;
    wasPlaying: boolean;
    tapCtxTime: number;
  }> {
    const ctx = this.unlockSync();
    const tapCtxTime = ctx.currentTime;
    const stepCount = getActiveStepCount(this.loopBars);
    const stepDuration = getStepDurationSeconds(this.bpm);
    const wasPlaying = this.isPlaying;

    const snap = wasPlaying
      ? snapStepFromTiming(
          tapCtxTime,
          this.nextStepTime,
          this.currentStep,
          stepDuration,
          stepCount
        )
      : { stepIndex: 0, isAheadOfCurrent: false };

    if (wasPlaying && snap.isAheadOfCurrent) {
      this.skipOnceMap.set(pad.id, {
        stepIndex: snap.stepIndex,
        untilTime: this.nextStepTime + stepDuration * 0.5,
      });
    }

    const cacheKey = `${pad.sample.url}@${ctx.sampleRate}`;
    const cached =
      this.customTapBuffers.get(pad.sample.url) ?? this.sampleCache.get(cacheKey);

    if (cached && this.tapMasterFilter) {
      this.triggerTapPadWithFx(
        ctx,
        this.tapMasterFilter,
        this.tapReverbConvolver,
        cached,
        pad.volume_db,
        pad.reverb,
        velocity,
        ctx.currentTime + 0.004
      );
    } else if (this.tapMasterFilter) {
      const immediate =
        pad.sample.source === 'synth' || pad.sample.url.startsWith('synth://')
          ? this.getOrCreateFallbackBuffer(
              ctx,
              pad.sample.url.replace('synth://', '') || pad.id
            )
          : this.getOrCreateFallbackBuffer(ctx, pad.id);
      this.triggerTapPadWithFx(
        ctx,
        this.tapMasterFilter,
        this.tapReverbConvolver,
        immediate,
        pad.volume_db,
        pad.reverb,
        velocity,
        ctx.currentTime + 0.004
      );
      void this.loadSampleBuffer(ctx, pad.sample, pad.id);
    }

    return {
      stepIndex: snap.stepIndex,
      wasPlaying,
      tapCtxTime,
    };
  }

  public async startTapLoopFromFirstTap(tapCtxTime: number): Promise<void> {
    const ctx = this.unlockSync();
    if (this.isPlaying) return;

    this.ensureClickBuffersCached(ctx);
    void this.preloadTapPads(this.tapPads);

    const stepCount = getActiveStepCount(this.loopBars);
    const stepDuration = getStepDurationSeconds(this.bpm);

    this.isPlaying = true;
    this.engineMode = 'taploop';
    this.applyTapSettingsToAudioNodes();
    // Step 0 already played live at tapCtxTime; schedule Step 1 right in tempo
    this.currentStep = 1 % stepCount;
    this.nextStepTime = Math.max(ctx.currentTime + 0.005, tapCtxTime + stepDuration);

    if (this.onStepCallback) {
      this.onStepCallback(0);
    }

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

  public async triggerKeyboardNoteNow(
    soundId: KeyboardSoundId,
    midi: number,
    velocity = 90,
    durationSeconds = 0.42,
    volumeDb = -2,
    pan = 0
  ): Promise<{
    stepIndex: number;
    wasPlaying: boolean;
  }> {
    const ctx = this.unlockSync();
    const dest = this.percussionBus ?? ctx.destination;
    const stepCount = getActiveStepCount(this.loopBars);
    const stepDuration = getStepDurationSeconds(this.bpm);
    const snap = this.isPlaying
      ? snapStepFromTiming(
          ctx.currentTime,
          this.nextStepTime,
          this.currentStep,
          stepDuration,
          stepCount
        )
      : { stepIndex: 0, isAheadOfCurrent: false };

    this.scheduleKeyboardSynthNote(
      ctx,
      dest,
      soundId,
      midi,
      durationSeconds,
      volumeDb,
      pan,
      velocity,
      ctx.currentTime + 0.006
    );

    return {
      stepIndex: snap.stepIndex,
      wasPlaying: this.isPlaying,
    };
  }

  public async triggerCustomSampleNoteNow(
    sample: SampleCandidate,
    channelId: string,
    midi: number,
    velocity = 90,
    durationSeconds = 0.42,
    volumeDb = -2,
    pan = 0
  ): Promise<{
    stepIndex: number;
    wasPlaying: boolean;
  }> {
    const ctx = this.unlockSync();
    const dest = this.percussionBus ?? ctx.destination;
    const stepCount = getActiveStepCount(this.loopBars);
    const stepDuration = getStepDurationSeconds(this.bpm);
    const snap = this.isPlaying
      ? snapStepFromTiming(
          ctx.currentTime,
          this.nextStepTime,
          this.currentStep,
          stepDuration,
          stepCount
        )
      : { stepIndex: 0, isAheadOfCurrent: false };

    const cached = this.sampleCache.get(`${sample.url}@${ctx.sampleRate}`);
    if (cached) {
      this.schedulePitchedSampleNote(
        ctx,
        dest,
        cached,
        midi,
        durationSeconds,
        volumeDb,
        pan,
        velocity,
        ctx.currentTime + 0.006
      );
    } else {
      this.scheduleKeyboardSynthNote(
        ctx,
        dest,
        'synth_lead',
        midi,
        durationSeconds,
        volumeDb,
        pan,
        velocity,
        ctx.currentTime + 0.006
      );
      void this.loadSampleBuffer(ctx, sample, channelId);
    }

    return {
      stepIndex: snap.stepIndex,
      wasPlaying: this.isPlaying,
    };
  }

  public async start(): Promise<void> {
    const ctx = this.unlockSync();
    if (this.isPlaying) return;

    this.ensureClickBuffersCached(ctx);

    // Preload acoustic samples in the background so playback begins on Beat 1 immediately
    // with synthesized percussion fallback instead of blocking on external CDN requests.
    if (this.engineMode === 'taploop') {
      void this.preloadTapPads(this.tapPads);
    } else if (this.engineMode === 'stems') {
      void Promise.all([
        this.preloadTracks(this.tracks),
        this.preloadTapPads(this.tapPads),
        ...this.stemChannels
          .filter((ch) => ch.customVoiceSample)
          .map((ch) =>
            this.loadSampleBuffer(ctx, ch.customVoiceSample!, ch.id).then(
              () => undefined,
              () => undefined
            )
          ),
      ]);
    } else {
      void this.preloadTracks(this.tracks);
    }

    this.isPlaying = true;
    this.currentStep = 0;
    this.nextStepTime = ctx.currentTime + 0.025;
    this.applyTapSettingsToAudioNodes();

    this.startOriginalPlayback(this.nextStepTime);
    this.startStemPhoneLoopSource(this.nextStepTime);
    this.scheduler();
    this.timerId = window.setInterval(() => this.scheduler(), LOOKAHEAD_MS);

    if (ctx.state !== 'running') {
      void ctx
        .resume()
        .then(() => {
          if (this.onAudioStateChangeCallback) {
            this.onAudioStateChangeCallback(ctx.state);
          }
          if (this.isPlaying && ctx.state === 'running') {
            if (this.nextStepTime < ctx.currentTime - 0.02) {
              this.nextStepTime = ctx.currentTime + 0.015;
            }
            this.scheduler();
          }
        })
        .catch(() => undefined);
    }
  }

  public stop(): void {
    this.isPlaying = false;
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    this.skipOnceMap.clear();
    this.stopActiveHumSources();
    this.stopStemHumPreview();
    this.stopStemPhoneLoopSource();
    this.stopDecomposerRefSource();
    this.stopOriginalSource();
    if (this.silentKeepaliveEl && !this.silentKeepaliveEl.paused) {
      try {
        this.silentKeepaliveEl.pause();
      } catch {
        // Ignore
      }
    }
    this.currentStep = 0;
    if (this.onStepCallback) {
      this.onStepCallback(-1);
    }
  }

  private stopActiveHumSources(): void {
    for (const entry of this.activeHumSources) {
      try {
        entry.src.stop();
        entry.src.disconnect();
      } catch {
        // Already stopped
      }
    }
    this.activeHumSources = [];
    this.activeHumGains = [];
  }

  private stopActiveHumSourcesForChannel(channelId: string): void {
    const remaining: Array<{ channelId: string; src: AudioBufferSourceNode }> = [];
    for (const entry of this.activeHumSources) {
      if (entry.channelId === channelId) {
        try {
          entry.src.stop();
          entry.src.disconnect();
        } catch {
          // Already stopped
        }
      } else {
        remaining.push(entry);
      }
    }
    this.activeHumSources = remaining;
    this.activeHumGains = this.activeHumGains.filter((g) => g.channelId !== channelId);
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
    const percStepCount = getActiveStepCount(this.loopBars);
    const stemSongStepCount =
      this.engineMode === 'stems'
        ? getSongTimelineSteps(this.stemChannels, percStepCount)
        : percStepCount;
    const activeBpm =
      this.engineMode === 'decomposer' && this.decomposerResult
        ? this.decomposerResult.bpm
        : this.bpm;
    const stepDuration = getStepDurationSeconds(activeBpm);

    // Clamp drift so steps are never scheduled far in the past after thread stalls or resume latency
    if (this.nextStepTime < this.ctx.currentTime - 0.04) {
      this.nextStepTime = this.ctx.currentTime + 0.012;
    }

    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      if (this.engineMode === 'decomposer' && this.decomposerResult) {
        const decompSteps = Math.max(16, this.decomposerResult.totalSteps);
        const stepToSchedule = this.currentStep % decompSteps;
        if (stepToSchedule === 0 && this.currentStep > 0) {
          this.startDecomposerRefSource(this.nextStepTime, 0);
        }
        this.scheduleDecomposerStep(stepToSchedule, this.nextStepTime, stepDuration);
        this.nextStepTime += stepDuration;
        this.currentStep = (this.currentStep + 1) % decompSteps;
      } else if (this.engineMode === 'taploop') {
        const stepToSchedule = this.currentStep % percStepCount;
        this.scheduleTapLoopStep(stepToSchedule, this.nextStepTime);
        this.nextStepTime += stepDuration;
        this.currentStep = (this.currentStep + 1) % percStepCount;
      } else if (this.engineMode === 'stems') {
        const stepToSchedule = this.isRecordingHum
          ? this.currentStep
          : this.currentStep % stemSongStepCount;
        this.scheduleStemsStep(stepToSchedule, this.nextStepTime, stepDuration);
        this.nextStepTime += stepDuration;
        this.currentStep = this.isRecordingHum
          ? this.currentStep + 1
          : (this.currentStep + 1) % stemSongStepCount;
      } else {
        const stepToSchedule = this.currentStep % percStepCount;
        this.scheduleStep(stepToSchedule, this.nextStepTime);
        this.nextStepTime += stepDuration;
        this.currentStep = (this.currentStep + 1) % percStepCount;
      }
    }
  }

  private getOrCreateDecomposerNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
    if (
      this.decomposerNoiseBuffer &&
      this.decomposerNoiseBuffer.sampleRate === ctx.sampleRate
    ) {
      return this.decomposerNoiseBuffer;
    }
    const sr = ctx.sampleRate;
    const len = sr * 4;
    const buf = ctx.createBuffer(1, len, sr);
    const ch = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.18 + white * 0.82;
      ch[i] = last;
    }
    this.decomposerNoiseBuffer = buf;
    return buf;
  }

  private scheduleTransitionFxEvent(
    ctx: BaseAudioContext,
    destination: AudioNode,
    event: TransitionFxEvent,
    stepDuration: number,
    volumeDb: number,
    when: number
  ): void {
    const durSec = Math.max(0.25, event.durationSteps * stepDuration);
    const gainScale = dbToGain(volumeDb) * event.intensity * 0.48;
    if (gainScale <= 0.001) return;

    if (event.type === 'sub_impact') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(98, when);
      osc.frequency.exponentialRampToValueAtTime(34, when + Math.min(0.65, durSec));

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, when);
      gain.gain.linearRampToValueAtTime(gainScale * 1.45, when + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, when + Math.min(0.85, durSec));

      osc.connect(gain);
      gain.connect(destination);
      osc.start(when);
      osc.stop(when + Math.min(0.9, durSec + 0.05));
      return;
    }

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this.getOrCreateDecomposerNoiseBuffer(ctx);
    noiseSrc.loop = true;

    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();
    noiseSrc.connect(filter);
    filter.connect(env);
    env.connect(destination);

    if (event.type === 'riser') {
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(2.6, when);
      filter.frequency.setValueAtTime(220, when);
      filter.frequency.exponentialRampToValueAtTime(4800, when + durSec);
      env.gain.setValueAtTime(0.001, when);
      env.gain.exponentialRampToValueAtTime(gainScale * 0.85, when + Math.max(0.1, durSec - 0.03));
      env.gain.linearRampToValueAtTime(0.0008, when + durSec);

      // Add subtle pitch sweep under noise riser
      const pitchOsc = ctx.createOscillator();
      pitchOsc.type = 'triangle';
      pitchOsc.frequency.setValueAtTime(140, when);
      pitchOsc.frequency.exponentialRampToValueAtTime(620, when + durSec);
      const pitchGain = ctx.createGain();
      pitchGain.gain.setValueAtTime(0.001, when);
      pitchGain.gain.exponentialRampToValueAtTime(gainScale * 0.28, when + Math.max(0.1, durSec - 0.04));
      pitchGain.gain.linearRampToValueAtTime(0.0008, when + durSec);
      pitchOsc.connect(pitchGain);
      pitchGain.connect(destination);
      pitchOsc.start(when);
      pitchOsc.stop(when + durSec + 0.02);
    } else if (event.type === 'reverse_cymbal') {
      filter.type = 'highpass';
      filter.Q.setValueAtTime(1.4, when);
      filter.frequency.setValueAtTime(2200, when);
      filter.frequency.exponentialRampToValueAtTime(8400, when + durSec);
      env.gain.setValueAtTime(0.001, when);
      env.gain.exponentialRampToValueAtTime(gainScale * 0.9, when + Math.max(0.08, durSec - 0.015));
      env.gain.linearRampToValueAtTime(0.0005, when + durSec);
    } else {
      // Air / Downlift sweep
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(1.8, when);
      filter.frequency.setValueAtTime(3600, when);
      filter.frequency.exponentialRampToValueAtTime(240, when + durSec);
      env.gain.setValueAtTime(gainScale * 0.72, when);
      env.gain.exponentialRampToValueAtTime(0.001, when + durSec);
    }

    noiseSrc.start(when);
    noiseSrc.stop(when + durSec + 0.04);
  }

  private scheduleDecomposerStep(
    stepIndex: number,
    when: number,
    stepDuration: number
  ): void {
    if (!this.ctx || !this.percussionBus || !this.decomposerResult) return;

    const result = this.decomposerResult;
    const barIdx = Math.floor(stepIndex / 16);
    const stepInBar = stepIndex % 16;

    const anySoloed = Boolean(
      result.track1Soloed ||
        result.fxSoloed ||
        result.instrumentTracks.some((t) => Boolean(t.soloed))
    );

    // Track 1: Dynamic Percussion Loop (only on rhythmic bars — intro/breakdown stay silent)
    const activeClip = result.track1Clips.find(
      (c) => barIdx >= c.startBar && barIdx < c.endBar
    );
    const track1Audible =
      Boolean(activeClip) &&
      !result.track1Muted &&
      (!anySoloed || result.track1Soloed);

    if (activeClip && track1Audible) {
      const template = BUILT_IN_PERCUSSION_LOOPS[activeClip.loopPresetId];
      for (const layer of template.layers) {
        const rawVel = layer.steps16[stepInBar] ?? 0;
        if (rawVel <= 0) continue;
        const vel = Math.max(15, Math.min(100, Math.round(rawVel * activeClip.intensity)));
        const buf = this.getOrCreateFallbackBuffer(this.ctx, layer.instrumentId);
        this.triggerBufferAt(
          this.ctx,
          this.percussionBus,
          buf,
          {
            instrument_id: layer.instrumentId,
            display_name: layer.displayName,
            sample_search_query: layer.instrumentId,
            volume_db: result.track1VolumeDb + layer.volumeDb,
            pan: layer.pan,
            steps: [],
          },
          vel,
          when
        );
      }
    }

    // Optional Metronome guide if enabled
    if (this.metronomeEnabled && stepInBar % 4 === 0) {
      const isBeatOne = stepInBar === 0;
      const clickBuf = this.getOrCreateFallbackBuffer(
        this.ctx,
        isBeatOne ? 'click_hi' : 'click_lo'
      );
      this.triggerPadBufferAt(
        this.ctx,
        this.percussionBus,
        clickBuf,
        isBeatOne ? -4 : -7,
        isBeatOne ? 90 : 72,
        when
      );
    }

    // Tracks 2..19: Extracted polyphonic MIDI instrument voices
    for (const track of result.instrumentTracks) {
      if (!track.isActive || track.muted || (anySoloed && !track.soloed)) continue;
      for (const note of track.notes) {
        if (note.step !== stepIndex) continue;
        const noteWhen = Math.max(
          this.ctx.currentTime + 0.002,
          when + (note.startOffsetSteps ?? 0) * stepDuration
        );
        const noteDur = Math.max(
          0.032,
          (note.exactDurationSteps ?? note.durationSteps) * stepDuration
        );
        this.scheduleKeyboardSynthNote(
          this.ctx,
          this.percussionBus,
          track.soundId,
          note.midi,
          noteDur,
          track.volume_db,
          track.pan,
          note.velocity,
          noteWhen,
          note.pitchBendSemitones,
          note.velocityCurve
        );
      }
    }

    // Tracks 20..21: Section Transition FX (Risers, Reverse Cymbals, Sweeps, Sub-Impacts)
    const fxAudible = !result.fxMuted && (!anySoloed || result.fxSoloed);
    if (fxAudible) {
      for (const ev of result.transitionFxEvents) {
        if (ev.triggerStep === stepIndex) {
          this.scheduleTransitionFxEvent(
            this.ctx,
            this.percussionBus,
            ev,
            stepDuration,
            result.fxVolumeDb,
            when
          );
        }
      }
    }

    const delayMs = Math.max(0, (when - this.ctx.currentTime) * 1000);
    window.setTimeout(() => {
      if (this.isPlaying && this.onStepCallback) {
        this.onStepCallback(stepIndex);
      }
    }, delayMs);
  }

  private scheduleStemsStep(
    stepIndex: number,
    when: number,
    stepDuration: number
  ): void {
    if (!this.ctx || !this.percussionBus) return;

    const percStepCount = getActiveStepCount(this.loopBars);
    const loopBedStep = ((stepIndex % percStepCount) + percStepCount) % percStepCount;
    const anyStemSoloed = isAnyStemSoloed(this.stemLoopSoloed, this.stemChannels);
    const loopBedAllowed =
      isStemLoopAudible(this.stemLoopMuted, this.stemLoopSoloed, this.stemChannels) &&
      !(this.isRecordingHum && this.muteBackingWhileHum);
    const recordingDuckDb = this.isRecordingHum ? -12 : 0;

    // 1. Imported Website Loop Bed or Phone Audio Loop Bed (repeats smoothly under longer vocal stems)
    if (loopBedAllowed) {
      const effectiveLoopVolDb =
        this.stemLoopVolumeDb <= -59.5 ? -60 : this.stemLoopVolumeDb + recordingDuckDb;
      const loopSilenced = effectiveLoopVolDb <= -59.5;
      if (this.stemLoopSource === 'phone_audio') {
        // Phone audio buffer or HTMLAudioElement is managed via startStemPhoneLoopSource & syncStemLoopOutputs
      } else if (this.stemLoopSource === 'taploop') {
        const anyPadSoloed = this.tapPads.some((p) => Boolean(p.soloed));
        for (const pad of this.tapPads) {
          if (!isTapPadAudible(pad, anyPadSoloed)) continue;
          const vel = pad.steps[loopBedStep] ?? 0;
          if (vel <= 0) continue;
          const cachedBuf =
            this.customTapBuffers.get(pad.sample.url) ??
            this.sampleCache.get(`${pad.sample.url}@${this.ctx.sampleRate}`);
          const buf =
            cachedBuf ??
            this.getOrCreateFallbackBuffer(
              this.ctx,
              pad.sample.url.startsWith('synth://')
                ? pad.sample.url.replace('synth://', '')
                : pad.id
            );
          if (!cachedBuf) {
            void this.loadSampleBuffer(this.ctx, pad.sample, pad.id);
          }
          if (this.tapMasterFilter) {
            const combinedVolDb =
              loopSilenced || pad.volume_db <= -59.5
                ? -60
                : pad.volume_db + effectiveLoopVolDb;
            this.triggerTapPadWithFx(
              this.ctx,
              this.tapMasterFilter,
              this.tapReverbConvolver,
              buf,
              combinedVolDb,
              pad.reverb,
              vel,
              when
            );
          }
        }
      } else {
        const anySoloOrig = this.tracks.some((t) => Boolean(t.soloed));
        for (const track of this.tracks) {
          if (track.isClick && (!this.metronomeEnabled || this.isRecordingHum)) continue;
          if (!isTrackAudible(track, anySoloOrig)) continue;
          const vel = track.steps[loopBedStep] ?? 0;
          if (vel <= 0) continue;
          const sample = track.samples?.[track.activeSampleIndex ?? 0];
          if (!sample) continue;
          const cachedBuf = this.sampleCache.get(`${sample.url}@${this.ctx.sampleRate}`);
          const buf =
            cachedBuf ??
            this.getOrCreateFallbackBuffer(
              this.ctx,
              sample.url.startsWith('synth://')
                ? sample.url.replace('synth://', '')
                : track.instrument_id
            );
          if (!cachedBuf) {
            void this.loadSampleBuffer(this.ctx, sample, track.instrument_id);
          }
          const adjustedTrack = {
            ...track,
            volume_db: track.isClick
              ? track.volume_db
              : loopSilenced || track.volume_db <= -59.5
              ? -60
              : track.volume_db + effectiveLoopVolDb,
          };
          this.triggerBufferAt(this.ctx, this.percussionBus, buf, adjustedTrack, vel, when);
        }
      }
    }

    // Metronome click if switch is on and Row 1 isn't solo-excluded and not actively mic-recording
    if (
      this.metronomeEnabled &&
      !this.isRecordingHum &&
      (!anyStemSoloed || this.stemLoopSoloed) &&
      (this.stemLoopSource === 'taploop' || this.stemLoopSource === 'phone_audio') &&
      loopBedStep % 4 === 0
    ) {
      const isBeatOne = loopBedStep % 16 === 0;
      const clickKey = isBeatOne ? 'synth://click_hi' : 'synth://click_lo';
      const clickBuf =
        this.sampleCache.get(`${clickKey}@${this.ctx.sampleRate}`) ??
        this.getOrCreateFallbackBuffer(this.ctx, isBeatOne ? 'click_hi' : 'click_lo');
      this.triggerPadBufferAt(
        this.ctx,
        this.percussionBus,
        clickBuf,
        isBeatOne ? -2 : -4,
        isBeatOne ? 98 : 78,
        when
      );
    }

    // 2. Melodic & Hum Stem Channels (silenced during active hum recording so only your voice is captured!)
    if (!this.isRecordingHum) {
      for (const ch of this.stemChannels) {
        if (!isStemChannelAudible(ch, this.stemLoopSoloed, this.stemChannels)) continue;
        const chSteps = getChannelTimelineSteps(ch, percStepCount);
        const chStep = ((stepIndex % chSteps) + chSteps) % chSteps;

        if (ch.voiceMode === 'hum_audio' && ch.hasHumAudio) {
          if (chStep === 0) {
            const humBuf = this.stemHumBuffers.get(ch.id);
            if (humBuf) {
              this.stopActiveHumSourcesForChannel(ch.id);
              const src = this.ctx.createBufferSource();
              src.buffer = humBuf;
              const gain = this.ctx.createGain();
              gain.gain.setValueAtTime(dbToGain(ch.volume_db), when);
              const panner = this.ctx.createStereoPanner();
              panner.pan.setValueAtTime(Math.max(-1, Math.min(1, ch.pan)), when);
              src.connect(gain);
              gain.connect(panner);
              panner.connect(this.percussionBus);
              const chDurSec = chSteps * stepDuration;
              src.start(when);
              if (humBuf.duration > chDurSec + 0.08) {
                src.stop(when + chDurSec);
              }
              const humEntry = { channelId: ch.id, src };
              const humGainEntry = { channelId: ch.id, gain };
              this.activeHumSources.push(humEntry);
              this.activeHumGains.push(humGainEntry);
              src.onended = () => {
                this.activeHumSources = this.activeHumSources.filter((s) => s !== humEntry);
                this.activeHumGains = this.activeHumGains.filter((g) => g !== humGainEntry);
              };
            }
          }
          continue;
        }

        if (ch.voiceMode === 'custom_sample' && ch.customVoiceSample) {
          const sampleBuf = this.sampleCache.get(
            `${ch.customVoiceSample.url}@${this.ctx.sampleRate}`
          );
          if (sampleBuf) {
            for (const note of ch.notes) {
              if (note.step !== chStep) continue;
              const noteWhen = Math.max(
                this.ctx.currentTime + 0.002,
                when + (note.startOffsetSteps ?? 0) * stepDuration
              );
              const noteDur = Math.max(
                0.032,
                (note.exactDurationSteps ?? note.durationSteps) * stepDuration
              );
              this.schedulePitchedSampleNote(
                this.ctx,
                this.percussionBus,
                sampleBuf,
                note.midi,
                noteDur,
                ch.volume_db,
                ch.pan,
                note.velocity,
                noteWhen,
                note.pitchBendSemitones,
                note.velocityCurve
              );
            }
            continue;
          } else {
            void this.loadSampleBuffer(this.ctx, ch.customVoiceSample, ch.id);
          }
        }

        for (const note of ch.notes) {
          if (note.step !== chStep) continue;
          const noteWhen = Math.max(
            this.ctx.currentTime + 0.002,
            when + (note.startOffsetSteps ?? 0) * stepDuration
          );
          const noteDur = Math.max(
            0.032,
            (note.exactDurationSteps ?? note.durationSteps) * stepDuration
          );
          this.scheduleKeyboardSynthNote(
            this.ctx,
            this.percussionBus,
            ch.soundId,
            note.midi,
            noteDur,
            ch.volume_db,
            ch.pan,
            note.velocity,
            noteWhen,
            note.pitchBendSemitones,
            note.velocityCurve
          );
        }
      }
    }

    const delayMs = Math.max(0, (when - this.ctx.currentTime) * 1000);
    window.setTimeout(() => {
      if (this.isPlaying && this.onStepCallback) {
        this.onStepCallback(stepIndex);
      }
    }, delayMs);
  }

  private schedulePitchBendAutomation(
    detuneParam: AudioParam,
    baseCents: number,
    pitchBendSemitones: number[] | undefined,
    when: number,
    durationSec: number
  ): void {
    if (!pitchBendSemitones || pitchBendSemitones.length === 0) {
      detuneParam.setValueAtTime(baseCents, when);
      return;
    }
    const clamped = (s: number) =>
      baseCents + Math.max(-450, Math.min(450, s * 100));
    detuneParam.setValueAtTime(clamped(pitchBendSemitones[0]), when);
    if (pitchBendSemitones.length === 1) return;
    const span = Math.max(0.02, durationSec);
    for (let i = 1; i < pitchBendSemitones.length; i++) {
      const t = when + (i / (pitchBendSemitones.length - 1)) * span;
      detuneParam.linearRampToValueAtTime(clamped(pitchBendSemitones[i]), t);
    }
  }

  private scheduleVelocityExpression(
    exprParam: AudioParam,
    velocityCurve: number[] | undefined,
    when: number,
    durationSec: number
  ): void {
    if (!velocityCurve || velocityCurve.length < 2) {
      exprParam.setValueAtTime(1.0, when);
      return;
    }
    const safeVal = (v: number) => Math.max(0.18, Math.min(1.15, v));
    exprParam.setValueAtTime(safeVal(velocityCurve[0]), when);
    const span = Math.max(0.02, durationSec);
    for (let i = 1; i < velocityCurve.length; i++) {
      const t = when + (i / (velocityCurve.length - 1)) * span;
      exprParam.linearRampToValueAtTime(safeVal(velocityCurve[i]), t);
    }
  }

  private schedulePitchedSampleNote(
    ctx: BaseAudioContext,
    destination: AudioNode,
    buffer: AudioBuffer,
    midi: number,
    durationSec: number,
    volumeDb: number,
    pan: number,
    velocity: number,
    when: number,
    pitchBendSemitones?: number[],
    velocityCurve?: number[]
  ): void {
    const velGain = Math.pow(Math.max(0.1, Math.min(1, velocity / 100)), 0.85);
    const peakGain = velGain * dbToGain(volumeDb) * 0.72;
    if (peakGain <= 0.001) return;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.setValueAtTime(Math.pow(2, (midi - 60) / 12), when);
    this.schedulePitchBendAutomation(
      src.detune,
      0,
      pitchBendSemitones,
      when,
      durationSec
    );

    const env = ctx.createGain();
    const noteEnd = when + Math.max(0.04, durationSec);
    const attackSec = Math.min(0.016, durationSec * 0.25);
    env.gain.setValueAtTime(0.001, when);
    env.gain.linearRampToValueAtTime(peakGain, when + attackSec);
    env.gain.setValueAtTime(peakGain * 0.92, Math.max(when + attackSec + 0.005, noteEnd - 0.025));
    env.gain.exponentialRampToValueAtTime(0.001, noteEnd + 0.14);

    const exprGain = ctx.createGain();
    this.scheduleVelocityExpression(exprGain.gain, velocityCurve, when, durationSec);

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), when);

    src.connect(env);
    env.connect(exprGain);
    exprGain.connect(panner);
    panner.connect(destination);
    src.start(when);
    src.stop(Math.min(when + buffer.duration + 0.1, noteEnd + 0.2));
  }

  private scheduleKeyboardSynthNote(
    ctx: BaseAudioContext,
    destination: AudioNode,
    soundId: KeyboardSoundId,
    midi: number,
    durationSec: number,
    volumeDb: number,
    pan: number,
    velocity: number,
    when: number,
    pitchBendSemitones?: number[],
    velocityCurve?: number[]
  ): void {
    const freq = midiToFreq(midi);
    const velGain = Math.pow(Math.max(0.1, Math.min(1, velocity / 100)), 0.85);
    const velBrightness = 0.45 + 0.65 * velGain;
    const peakGain = velGain * dbToGain(volumeDb) * 0.64;
    if (peakGain <= 0.001) return;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';

    const envGain = ctx.createGain();
    const exprGain = ctx.createGain();
    this.scheduleVelocityExpression(exprGain.gain, velocityCurve, when, durationSec);

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), when);

    filter.connect(envGain);
    envGain.connect(exprGain);
    exprGain.connect(panner);
    panner.connect(destination);

    const oscs: OscillatorNode[] = [];
    const safeDur = Math.max(0.032, durationSec);
    const noteEnd = when + safeDur;
    const hasExplicitBend = Boolean(pitchBendSemitones && pitchBendSemitones.length >= 2);
    const addOscWithBend = (osc: OscillatorNode, baseCents = 0) => {
      this.schedulePitchBendAutomation(
        osc.detune,
        baseCents,
        pitchBendSemitones,
        when,
        safeDur
      );
      oscs.push(osc);
    };

    // Subtle organic vibrato only on long sustained melodic notes when no explicit bend curve exists
    let vibratoOsc: OscillatorNode | null = null;
    const attachGentleVibrato = (targets: OscillatorNode[], depthCents = 5) => {
      if (hasExplicitBend || safeDur < 0.28) return;
      vibratoOsc = ctx.createOscillator();
      vibratoOsc.type = 'sine';
      vibratoOsc.frequency.setValueAtTime(5.1, when);
      const vGain = ctx.createGain();
      vGain.gain.setValueAtTime(0, when);
      vGain.gain.linearRampToValueAtTime(depthCents, Math.min(noteEnd, when + 0.22));
      vibratoOsc.connect(vGain);
      for (const t of targets) {
        vGain.connect(t.detune);
      }
      oscs.push(vibratoOsc);
    };

    const smoothAttack = Math.min(0.018, safeDur * 0.28);

    if (soundId === 'sub_bass') {
      const subFreq = midi >= 48 ? freq * 0.5 : freq;
      const o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.setValueAtTime(subFreq, when);
      const o2 = ctx.createOscillator();
      o2.type = 'triangle';
      o2.frequency.setValueAtTime(subFreq * 2, when);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.18, when);
      o1.connect(filter);
      o2.connect(g2);
      g2.connect(filter);
      addOscWithBend(o1, 0);
      addOscWithBend(o2, 0);

      filter.frequency.setValueAtTime(Math.min(480, subFreq * 4.5), when);
      envGain.gain.setValueAtTime(0.001, when);
      envGain.gain.linearRampToValueAtTime(peakGain * 1.25, when + Math.min(0.018, smoothAttack));
      envGain.gain.setValueAtTime(
        peakGain * 1.15,
        Math.max(when + smoothAttack + 0.005, noteEnd - 0.02)
      );
      envGain.gain.exponentialRampToValueAtTime(0.001, noteEnd + 0.1);
    } else if (soundId === 'strings') {
      const strOscs: OscillatorNode[] = [];
      [-7.5, -2.5, 2.5, 7.5].forEach((cents, idx) => {
        const osc = ctx.createOscillator();
        osc.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
        osc.frequency.setValueAtTime(freq, when);
        const g = ctx.createGain();
        g.gain.setValueAtTime(idx % 2 === 0 ? 0.24 : 0.34, when);
        osc.connect(g);
        g.connect(filter);
        addOscWithBend(osc, cents);
        strOscs.push(osc);
      });
      attachGentleVibrato(strOscs, 5.5);
      filter.Q.setValueAtTime(1.1, when);
      filter.frequency.setValueAtTime(850 * velBrightness, when);
      filter.frequency.linearRampToValueAtTime(
        Math.max(1100, 2900 * velBrightness),
        when + Math.min(0.11, safeDur * 0.6)
      );
      const strAttack = Math.min(0.075, safeDur * 0.45);
      envGain.gain.setValueAtTime(0.001, when);
      envGain.gain.linearRampToValueAtTime(peakGain * 0.85, when + strAttack);
      envGain.gain.setValueAtTime(
        peakGain * 0.8,
        Math.max(when + strAttack + 0.006, noteEnd - 0.02)
      );
      envGain.gain.exponentialRampToValueAtTime(0.001, noteEnd + 0.22);
    } else if (soundId === 'worship_bass') {
      const o1 = ctx.createOscillator();
      o1.type = 'triangle';
      o1.frequency.setValueAtTime(freq, when);
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(freq * 0.5, when);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.55, when);
      o1.connect(filter);
      o2.connect(g2);
      g2.connect(filter);
      addOscWithBend(o1, 0);
      addOscWithBend(o2, 0);

      filter.frequency.setValueAtTime(Math.min(2000, freq * 5.5 * velBrightness), when);
      filter.frequency.exponentialRampToValueAtTime(Math.max(150, freq * 2.0), noteEnd);
      envGain.gain.setValueAtTime(0.001, when);
      envGain.gain.linearRampToValueAtTime(peakGain * 1.2, when + Math.min(0.012, smoothAttack));
      envGain.gain.exponentialRampToValueAtTime(0.001, noteEnd + 0.08);
    } else if (soundId === 'gospel_organ') {
      const ratios = [1, 2, 3, 4];
      const weights = [0.55, 0.34, 0.22, 0.14];
      const organOscs: OscillatorNode[] = [];
      ratios.forEach((r, idx) => {
        const osc = ctx.createOscillator();
        osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq * r, when);
        const g = ctx.createGain();
        g.gain.setValueAtTime(weights[idx], when);
        osc.connect(g);
        g.connect(filter);
        addOscWithBend(osc, idx === 1 ? 2 : idx === 2 ? -2 : 0);
        organOscs.push(osc);
      });
      attachGentleVibrato(organOscs, 4);
      filter.frequency.setValueAtTime(Math.min(5000, 3400 * velBrightness), when);
      envGain.gain.setValueAtTime(0.001, when);
      envGain.gain.linearRampToValueAtTime(peakGain * 0.9, when + smoothAttack);
      envGain.gain.setValueAtTime(
        peakGain * 0.85,
        Math.max(when + smoothAttack + 0.004, noteEnd - 0.015)
      );
      envGain.gain.exponentialRampToValueAtTime(0.001, noteEnd + 0.075);
    } else if (soundId === 'synth_lead') {
      const leadOscs: OscillatorNode[] = [];
      [-4.5, 0, 4.5].forEach((cents, idx) => {
        const osc = ctx.createOscillator();
        // Warm triangle core + silky detuned saw layers (eliminates harsh buzzy square edge)
        osc.type = idx === 1 ? 'triangle' : 'sawtooth';
        osc.frequency.setValueAtTime(freq, when);
        const g = ctx.createGain();
        g.gain.setValueAtTime(idx === 1 ? 0.56 : 0.28, when);
        osc.connect(g);
        g.connect(filter);
        addOscWithBend(osc, cents);
        leadOscs.push(osc);
      });
      attachGentleVibrato(leadOscs, 6);
      filter.Q.setValueAtTime(1.5, when);
      const startCut = Math.min(5200, Math.max(900, freq * 6.5 * velBrightness));
      const sustainCut = Math.max(520, freq * 2.4 * velBrightness);
      filter.frequency.setValueAtTime(startCut * 0.72, when);
      filter.frequency.linearRampToValueAtTime(startCut, when + Math.min(0.035, safeDur * 0.4));
      filter.frequency.exponentialRampToValueAtTime(sustainCut, noteEnd + 0.08);
      envGain.gain.setValueAtTime(0.001, when);
      envGain.gain.linearRampToValueAtTime(peakGain * 0.92, when + smoothAttack);
      envGain.gain.setValueAtTime(
        peakGain * 0.84,
        Math.max(when + smoothAttack + 0.004, noteEnd - 0.02)
      );
      envGain.gain.exponentialRampToValueAtTime(0.001, noteEnd + 0.14);
    } else if (soundId === 'synth_brass') {
      const brassOscs: OscillatorNode[] = [];
      [-5, 5].forEach((cents) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, when);
        osc.connect(filter);
        addOscWithBend(osc, cents);
        brassOscs.push(osc);
      });
      attachGentleVibrato(brassOscs, 4);
      filter.Q.setValueAtTime(1.2, when);
      filter.frequency.setValueAtTime(650 * velBrightness, when);
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(900, 3400 * velBrightness),
        when + Math.min(0.055, safeDur * 0.45)
      );
      filter.frequency.exponentialRampToValueAtTime(Math.max(550, 1300 * velBrightness), noteEnd + 0.05);
      envGain.gain.setValueAtTime(0.001, when);
      envGain.gain.linearRampToValueAtTime(peakGain * 0.86, when + Math.min(0.025, safeDur * 0.35));
      envGain.gain.exponentialRampToValueAtTime(0.001, noteEnd + 0.12);
    } else if (soundId === 'warm_pad' || soundId === 'choir_voice') {
      const isChoir = soundId === 'choir_voice';
      const padOscs: OscillatorNode[] = [];
      [-6, 0, 6].forEach((cents, idx) => {
        const osc = ctx.createOscillator();
        osc.type = isChoir ? (idx === 1 ? 'sawtooth' : 'triangle') : 'triangle';
        osc.frequency.setValueAtTime(freq, when);
        const g = ctx.createGain();
        g.gain.setValueAtTime(isChoir && idx === 1 ? 0.32 : 0.45, when);
        osc.connect(g);
        g.connect(filter);
        addOscWithBend(osc, cents);
        padOscs.push(osc);
      });
      attachGentleVibrato(padOscs, isChoir ? 7 : 4);
      filter.frequency.setValueAtTime((isChoir ? 1450 : 2100) * velBrightness, when);
      filter.Q.setValueAtTime(isChoir ? 1.8 : 0.9, when);
      const padAttack = Math.min(0.055, safeDur * 0.4);
      envGain.gain.setValueAtTime(0.001, when);
      envGain.gain.linearRampToValueAtTime(peakGain * 0.84, when + padAttack);
      envGain.gain.exponentialRampToValueAtTime(0.001, noteEnd + 0.2);
    } else if (soundId === 'rhodes_ep') {
      const fund = ctx.createOscillator();
      fund.type = 'sine';
      fund.frequency.setValueAtTime(freq, when);
      const tine = ctx.createOscillator();
      tine.type = 'sine';
      tine.frequency.setValueAtTime(freq * 4, when);
      const tineGain = ctx.createGain();
      tineGain.gain.setValueAtTime(0.24 * velBrightness, when);
      tineGain.gain.exponentialRampToValueAtTime(0.005, when + 0.12);
      fund.connect(filter);
      tine.connect(tineGain);
      tineGain.connect(filter);
      addOscWithBend(fund, 0);
      addOscWithBend(tine, 0);
      filter.frequency.setValueAtTime(Math.max(1200, 3200 * velBrightness), when);
      envGain.gain.setValueAtTime(0.001, when);
      envGain.gain.linearRampToValueAtTime(peakGain, when + Math.min(0.008, smoothAttack));
      envGain.gain.exponentialRampToValueAtTime(0.001, noteEnd + 0.16);
    } else if (soundId === 'marimba_pluck') {
      const o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.setValueAtTime(freq, when);
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(freq * 4, when);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.32 * velBrightness, when);
      g2.gain.exponentialRampToValueAtTime(0.001, when + 0.045);
      o1.connect(filter);
      o2.connect(g2);
      g2.connect(filter);
      addOscWithBend(o1, 0);
      addOscWithBend(o2, 0);
      filter.frequency.setValueAtTime(Math.max(1600, 3800 * velBrightness), when);
      envGain.gain.setValueAtTime(0.001, when);
      envGain.gain.linearRampToValueAtTime(peakGain * 1.12, when + 0.005);
      envGain.gain.exponentialRampToValueAtTime(0.001, when + Math.min(0.32, safeDur + 0.1));
    } else {
      // grand_piano default
      const o1 = ctx.createOscillator();
      o1.type = 'triangle';
      o1.frequency.setValueAtTime(freq, when);
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(freq * 2, when);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.32 * velBrightness, when);
      g2.gain.exponentialRampToValueAtTime(0.02, noteEnd + 0.12);
      o1.connect(filter);
      o2.connect(g2);
      g2.connect(filter);
      addOscWithBend(o1, 0);
      addOscWithBend(o2, 0);
      filter.frequency.setValueAtTime(Math.max(1800, 4800 * velBrightness), when);
      filter.frequency.exponentialRampToValueAtTime(Math.max(900, 1600 * velBrightness), noteEnd + 0.14);
      envGain.gain.setValueAtTime(0.001, when);
      envGain.gain.linearRampToValueAtTime(peakGain, when + Math.min(0.008, smoothAttack));
      envGain.gain.exponentialRampToValueAtTime(0.001, noteEnd + 0.15);
    }

    const stopTime = noteEnd + 0.24;
    for (const osc of oscs) {
      osc.start(when);
      osc.stop(stopTime);
    }
  }

  private scheduleTapLoopStep(stepIndex: number, when: number): void {
    if (!this.ctx || !this.tapMasterFilter) return;

    const anyPadSoloed = this.tapPads.some((p) => Boolean(p.soloed));
    for (const pad of this.tapPads) {
      if (!isTapPadAudible(pad, anyPadSoloed)) continue;
      const velocity = pad.steps[stepIndex] ?? 0;
      if (velocity <= 0) continue;

      const skipEntry = this.skipOnceMap.get(pad.id);
      if (skipEntry && skipEntry.stepIndex === stepIndex && when <= skipEntry.untilTime) {
        this.skipOnceMap.delete(pad.id);
        continue;
      }

      const cachedBuffer =
        this.customTapBuffers.get(pad.sample.url) ??
        this.sampleCache.get(`${pad.sample.url}@${this.ctx.sampleRate}`);

      const buffer =
        cachedBuffer ??
        this.getOrCreateFallbackBuffer(
          this.ctx,
          pad.sample.url.startsWith('synth://')
            ? pad.sample.url.replace('synth://', '')
            : pad.id
        );
      if (!cachedBuffer) {
        void this.loadSampleBuffer(this.ctx, pad.sample, pad.id);
      }

      this.triggerTapPadWithFx(
        this.ctx,
        this.tapMasterFilter,
        this.tapReverbConvolver,
        buffer,
        pad.volume_db,
        pad.reverb,
        velocity,
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

    // Tempo-locked metronome Click Guide when enabled (on beats 0, 4, 8, 12, ...)
    if (this.metronomeEnabled && stepIndex % 4 === 0 && this.percussionBus) {
      const isBeatOne = stepIndex % 16 === 0;
      const clickKey = isBeatOne ? 'synth://click_hi' : 'synth://click_lo';
      const clickBuf =
        this.sampleCache.get(`${clickKey}@${this.ctx.sampleRate}`) ??
        this.getOrCreateFallbackBuffer(this.ctx, isBeatOne ? 'click_hi' : 'click_lo');
      this.triggerPadBufferAt(
        this.ctx,
        this.percussionBus,
        clickBuf,
        isBeatOne ? -3 : -5,
        isBeatOne ? 98 : 78,
        when
      );
    }

    const delayMs = Math.max(0, (when - this.ctx.currentTime) * 1000);
    window.setTimeout(() => {
      if (this.isPlaying && this.onStepCallback) {
        this.onStepCallback(stepIndex);
      }
    }, delayMs);
  }

  private scheduleStep(stepIndex: number, when: number): void {
    if (!this.ctx || !this.percussionBus) return;
    const anySoloed = this.tracks.some((t) => Boolean(t.soloed));

    for (const track of this.tracks) {
      if (track.isClick && !this.metronomeEnabled) continue;
      if (!isTrackAudible(track, anySoloed)) continue;
      const velocity = track.steps[stepIndex] ?? 0;
      if (velocity <= 0) continue;

      const sample = track.samples?.[track.activeSampleIndex ?? 0];
      if (!sample) continue;

      const cacheKey = `${sample.url}@${this.ctx.sampleRate}`;
      const cachedBuffer = this.sampleCache.get(cacheKey);
      const buffer =
        cachedBuffer ??
        this.getOrCreateFallbackBuffer(
          this.ctx,
          sample.url.startsWith('synth://')
            ? sample.url.replace('synth://', '')
            : track.instrument_id
        );
      if (!cachedBuffer) {
        void this.loadSampleBuffer(this.ctx, sample, track.instrument_id);
      }
      this.triggerBufferAt(this.ctx, this.percussionBus, buffer, track, velocity, when);
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

  private triggerTapPadWithFx(
    ctx: BaseAudioContext,
    filterDest: AudioNode,
    reverbConvolver: ConvolverNode | null,
    buffer: AudioBuffer,
    volumeDb: number,
    padReverb: number,
    velocity: number,
    when: number
  ): void {
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const levelNode = ctx.createGain();
    const velGain = Math.max(0.05, Math.min(1, velocity / 100));
    const padGain = dbToGain(volumeDb);
    levelNode.gain.setValueAtTime(velGain * padGain, when);

    source.connect(levelNode);
    levelNode.connect(filterDest);

    if (reverbConvolver && padReverb > 0.005) {
      const sendGain = ctx.createGain();
      sendGain.gain.setValueAtTime(clampUnit(padReverb), when);
      levelNode.connect(sendGain);
      sendGain.connect(reverbConvolver);
    }

    source.start(when);
  }

  public async exportWavWithClick(params: {
    bpm: number;
    loopBars: LoopBars;
    tracks: PercussionTrack[];
    blendRatio: number;
    tapPads?: TapPad[];
    tapSettings?: TapLoopSettings;
    exportTapLoop?: boolean;
    exportStems?: boolean;
    stemChannels?: StemChannel[];
    stemLoopSource?: StemLoopSource;
    stemLoopMuted?: boolean;
    stemLoopSoloed?: boolean;
    stemLoopVolumeDb?: number;
    exportOptions?: ExportOptions;
  }): Promise<Blob> {
    const opts = params.exportOptions;
    const sampleRate = opts?.format === 'wav-compact' ? 22050 : 44100;
    const percStepCount = getActiveStepCount(params.loopBars);
    const stepCount =
      params.exportStems && params.stemChannels
        ? getSongTimelineSteps(params.stemChannels, percStepCount)
        : percStepCount;
    const stepDuration = getStepDurationSeconds(params.bpm);
    const cycleDuration = stepCount * stepDuration;
    const cycleFrames = Math.ceil(cycleDuration * sampleRate);

    const cutoffHz = clampCutoffHz(opts?.cutoffHz ?? params.tapSettings?.cutoffHz ?? 18000);
    const resonanceQ = clampResonanceQ(opts?.resonanceQ ?? params.tapSettings?.resonanceQ ?? 1.0);
    const reverbAmount = clampUnit(opts?.reverbAmount ?? params.tapSettings?.masterReverb ?? 0.35);
    const reverbSize = opts?.reverbSize ?? params.tapSettings?.reverbSize ?? 'hall';
    const includeClick = opts ? opts.includeClick : true;
    const includeBlend = opts ? opts.includeOriginalBlend : params.blendRatio > 0.01;
    const normalizePeak = opts?.normalizePeak ?? true;

    const targetDurationSeconds =
      opts?.durationMode === 'minutes'
        ? Math.max(1, Math.min(15, opts.minutes)) * 60
        : cycleDuration;

    const offlineCtx = new OfflineAudioContext(2, cycleFrames, sampleRate);
    const percBus = offlineCtx.createGain();
    const effectiveBlend = includeBlend ? Math.max(0.2, params.blendRatio) : 0;
    const percGain =
      effectiveBlend <= 0.5 ? 1 : Math.max(0.2, 1 - (effectiveBlend - 0.5) * 1.6);
    percBus.gain.setValueAtTime(percGain, 0);
    percBus.connect(offlineCtx.destination);

    if (this.originalBuffer && includeBlend && effectiveBlend > 0.01) {
      const origBus = offlineCtx.createGain();
      origBus.gain.setValueAtTime(Math.min(1, effectiveBlend * 1.35), 0);
      origBus.connect(offlineCtx.destination);
      const origSrc = offlineCtx.createBufferSource();
      origSrc.buffer = this.originalBuffer;
      origSrc.loop = true;
      origSrc.connect(origBus);
      origSrc.start(0);
    }

    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'lowpass';
    const nyquistSafeCutoff = Math.min(cutoffHz, Math.floor(sampleRate * 0.45));
    filter.frequency.setValueAtTime(nyquistSafeCutoff, 0);
    filter.Q.setValueAtTime(resonanceQ, 0);
    filter.connect(percBus);

    const convolver = offlineCtx.createConvolver();
    convolver.buffer = this.buildReverbImpulse(
      offlineCtx,
      getReverbDecaySeconds(reverbSize)
    );
    const reverbReturn = offlineCtx.createGain();
    reverbReturn.gain.setValueAtTime(reverbAmount * 1.25, 0);
    convolver.connect(reverbReturn);
    reverbReturn.connect(filter);

    const stemRow1Audible = isStemLoopAudible(
      Boolean(params.stemLoopMuted),
      params.stemLoopSoloed,
      params.stemChannels ?? []
    );
    const usePhoneBed =
      Boolean(params.exportStems) &&
      stemRow1Audible &&
      params.stemLoopSource === 'phone_audio' &&
      this.stemPhoneLoopBuffer !== null;
    const useTapBed =
      Boolean(params.exportTapLoop) ||
      (Boolean(params.exportStems) &&
        stemRow1Audible &&
        params.stemLoopSource === 'taploop');
    const useSequencerBed =
      !params.exportTapLoop &&
      (!params.exportStems ||
        (stemRow1Audible && params.stemLoopSource === 'sequencer'));

    const stemLoopVolDb = params.stemLoopVolumeDb ?? this.stemLoopVolumeDb;
    const stemLoopSilenced = Boolean(params.exportStems) && stemLoopVolDb <= -59.5;
    if (usePhoneBed && this.stemPhoneLoopBuffer) {
      const phoneSrc = offlineCtx.createBufferSource();
      phoneSrc.buffer = this.stemPhoneLoopBuffer;
      phoneSrc.loop = true;
      const phoneGain = offlineCtx.createGain();
      phoneGain.gain.setValueAtTime(dbToGain(stemLoopVolDb), 0);
      phoneSrc.connect(phoneGain);
      phoneGain.connect(percBus);
      phoneSrc.start(0);
    }

    if (useTapBed && params.tapPads) {
      const anyPadSoloed = params.tapPads.some((p) => Boolean(p.soloed));
      const padBuffers = new Map<string, AudioBuffer>();
      for (const pad of params.tapPads) {
        if (!isTapPadAudible(pad, anyPadSoloed)) continue;
        const buf = await this.loadSampleBuffer(offlineCtx, pad.sample, pad.id);
        padBuffers.set(pad.id, buf);
      }

      for (let step = 0; step < stepCount; step++) {
        const when = step * stepDuration;
        const bedStep = step % percStepCount;
        for (const pad of params.tapPads) {
          if (!isTapPadAudible(pad, anyPadSoloed)) continue;
          const velocity = pad.steps[bedStep] ?? 0;
          if (velocity <= 0) continue;
          const buf = padBuffers.get(pad.id);
          if (!buf) continue;
          const effectivePadRev = Math.max(pad.reverb, reverbAmount * 0.6);
          const padExportVolDb = params.exportStems
            ? stemLoopSilenced || pad.volume_db <= -59.5
              ? -60
              : pad.volume_db + stemLoopVolDb
            : pad.volume_db;
          this.triggerTapPadWithFx(
            offlineCtx,
            filter,
            convolver,
            buf,
            padExportVolDb,
            effectivePadRev,
            velocity,
            when
          );
        }
      }

      if (includeClick) {
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
        for (let step = 0; step < stepCount; step += 4) {
          const when = step * stepDuration;
          const isBeatOne = step % 16 === 0;
          this.triggerPadBufferAt(
            offlineCtx,
            percBus,
            isBeatOne ? clickHiBuf : clickLoBuf,
            isBeatOne ? -2 : -4,
            isBeatOne ? 100 : 88,
            when
          );
        }
      }
    } else if (useSequencerBed) {
      const anySoloed = params.tracks.some((t) => Boolean(t.soloed));
      const loadedBuffers = new Map<string, AudioBuffer>();

      for (const track of params.tracks) {
        if (track.isClick && !includeClick) continue;
        if (!isTrackAudible(track, anySoloed)) continue;
        const sample = track.samples?.[track.activeSampleIndex ?? 0];
        if (!sample) continue;
        const buf = await this.loadSampleBuffer(offlineCtx, sample, track.instrument_id);
        loadedBuffers.set(track.instrument_id, buf);
      }

      for (let step = 0; step < stepCount; step++) {
        const when = step * stepDuration;
        const bedStep = step % percStepCount;
        for (const track of params.tracks) {
          if (track.isClick && !includeClick) continue;
          if (!isTrackAudible(track, anySoloed)) continue;
          const velocity = track.steps[bedStep] ?? 0;
          if (velocity <= 0) continue;
          const buf = loadedBuffers.get(track.instrument_id);
          if (!buf) continue;
          if (track.isClick) {
            this.triggerBufferAt(offlineCtx, percBus, buf, track, velocity, when);
          } else {
            const adjustedTrack = params.exportStems
              ? {
                  ...track,
                  volume_db:
                    stemLoopSilenced || track.volume_db <= -59.5
                      ? -60
                      : track.volume_db + stemLoopVolDb,
                }
              : track;
            this.triggerBufferAt(offlineCtx, filter, buf, adjustedTrack, velocity, when);
            if (reverbAmount > 0.01) {
              const send = offlineCtx.createGain();
              send.gain.setValueAtTime(reverbAmount * 0.65, when);
              send.connect(convolver);
              this.triggerBufferAt(offlineCtx, send, buf, adjustedTrack, velocity, when);
            }
          }
        }
      }
    }

    if (params.exportStems && params.stemChannels) {
      for (const ch of params.stemChannels) {
        if (!isStemChannelAudible(ch, params.stemLoopSoloed, params.stemChannels)) continue;
        const chSteps = getChannelTimelineSteps(ch, percStepCount);

        if (ch.voiceMode === 'hum_audio' && ch.hasHumAudio) {
          const humBuf = this.stemHumBuffers.get(ch.id);
          if (humBuf) {
            for (let cycleStart = 0; cycleStart < stepCount; cycleStart += chSteps) {
              const src = offlineCtx.createBufferSource();
              src.buffer = humBuf;
              const g = offlineCtx.createGain();
              g.gain.setValueAtTime(dbToGain(ch.volume_db), cycleStart * stepDuration);
              src.connect(g);
              g.connect(filter);
              src.start(cycleStart * stepDuration);
            }
          }
          continue;
        }

        if (ch.voiceMode === 'custom_sample' && ch.customVoiceSample) {
          const sampleBuf = await this.loadSampleBuffer(
            offlineCtx,
            ch.customVoiceSample,
            ch.id
          );
          for (let cycleStart = 0; cycleStart < stepCount; cycleStart += chSteps) {
            for (const note of ch.notes) {
              const globalStep = cycleStart + note.step;
              if (globalStep >= stepCount) continue;
              const noteWhen = Math.max(
                0,
                (globalStep + (note.startOffsetSteps ?? 0)) * stepDuration
              );
              const noteDur = Math.max(
                0.032,
                (note.exactDurationSteps ?? note.durationSteps) * stepDuration
              );
              this.schedulePitchedSampleNote(
                offlineCtx,
                filter,
                sampleBuf,
                note.midi,
                noteDur,
                ch.volume_db,
                ch.pan,
                note.velocity,
                noteWhen,
                note.pitchBendSemitones,
                note.velocityCurve
              );
            }
          }
          continue;
        }

        for (let cycleStart = 0; cycleStart < stepCount; cycleStart += chSteps) {
          for (const note of ch.notes) {
            const globalStep = cycleStart + note.step;
            if (globalStep >= stepCount) continue;
            const noteWhen = Math.max(
              0,
              (globalStep + (note.startOffsetSteps ?? 0)) * stepDuration
            );
            const noteDur = Math.max(
              0.032,
              (note.exactDurationSteps ?? note.durationSteps) * stepDuration
            );
            this.scheduleKeyboardSynthNote(
              offlineCtx,
              filter,
              ch.soundId,
              note.midi,
              noteDur,
              ch.volume_db,
              ch.pan,
              note.velocity,
              noteWhen,
              note.pitchBendSemitones,
              note.velocityCurve
            );
          }
        }
      }
    }

    const rendered = await offlineCtx.startRendering();
    const left = rendered.getChannelData(0);
    const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
    return encodeRepeatedStereoWavBlob(
      left,
      right,
      sampleRate,
      targetDurationSeconds,
      normalizePeak
    );
  }
}
