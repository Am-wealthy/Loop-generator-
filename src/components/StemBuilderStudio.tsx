import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Layers,
  Mic,
  MicOff,
  Music2,
  Play,
  Plus,
  Search,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  Wand2,
} from 'lucide-react';
import type {
  KeyboardSoundId,
  LoopBars,
  PercussionTrack,
  SampleCandidate,
  ScaleType,
  StemChannel,
  StemLoopSource,
  StemNote,
  StemVoiceMode,
  TapPad,
} from '../types/sequencer';
import { formatVolumeDb, getActiveStepCount } from '../utils/sequencerLogic';
import {
  clampMidi,
  computeContinuousStepAtTime,
  computeLoopPhaseSeconds,
  detectPitchInfo,
  getSongTimelineSteps,
  HUM_WORKLET_PROCESSOR_CODE,
  HumCaptureTracker,
  isBlackKeyMidi,
  isMidiInScale,
  KEYBOARD_SOUND_PRESETS,
  LoopPcmRecorder,
  midiToNoteName,
  MUSICAL_KEYS,
  type MusicalKey,
} from '../utils/stemBuilderLogic';
import {
  preloadBasicPitchModel,
  transcribeVocalAudioWithBasicPitch,
} from '../utils/basicPitchTranscription';
import { PianoKeyboardRow } from './PianoKeyboardRow';
import { StemVoiceBrowserModal } from './StemVoiceBrowserModal';

const registeredHumWorkletContexts = new WeakSet<AudioContext>();

function extractPcmWaveformPeaks(pcm: Float32Array, bins = 56): number[] {
  if (pcm.length === 0 || bins <= 0) return [];
  const blockSize = Math.max(1, Math.floor(pcm.length / bins));
  const step = Math.max(1, Math.floor(blockSize / 24));
  const peaks: number[] = [];
  let maxPeak = 0.001;
  for (let i = 0; i < bins; i++) {
    const start = i * blockSize;
    const end = Math.min(pcm.length, start + blockSize);
    let peak = 0;
    for (let j = start; j < end; j += step) {
      const abs = Math.abs(pcm[j]);
      if (abs > peak) peak = abs;
    }
    if (peak > maxPeak) maxPeak = peak;
    peaks.push(peak);
  }
  return peaks.map((p) => p / maxPeak);
}

interface StemBuilderStudioProps {
  bpm: number;
  loopBars: LoopBars;
  isPlaying: boolean;
  currentStep: number;
  activeBar: number;
  followPlayhead: boolean;
  tracks: PercussionTrack[];
  tapPads: TapPad[];
  stemLoopSource: StemLoopSource;
  stemLoopMuted: boolean;
  stemLoopSoloed: boolean;
  stemLoopVolumeDb: number;
  phoneLoopFileName: string | null;
  phoneLoopDurationSec: number;
  phoneLoopPeaks: number[];
  stemChannels: StemChannel[];
  selectedChannelId: string;
  rootKey: MusicalKey;
  scaleType: ScaleType;
  canUndo: boolean;
  canRedo: boolean;
  freesoundKey: string;
  secondarySoundConfigured: boolean;
  secondarySoundProvider: string;
  onUndo: () => void;
  onRedo: () => void;
  onSelectBar: (bar: number) => void;
  onToggleFollowPlayhead: () => void;
  onSelectLoopSource: (source: StemLoopSource) => void;
  onUploadPhoneLoopFile: (file: File) => Promise<void>;
  onClearPhoneLoopFile: () => void;
  onToggleLoopMuted: () => void;
  onToggleLoopSolo: () => void;
  onLoopVolumeChange: (db: number) => void;
  onSelectChannel: (channelId: string) => void;
  onAddChannel: () => void;
  onRemoveChannel: (channelId: string) => void;
  onChannelSoundChange: (channelId: string, soundId: KeyboardSoundId) => void;
  onChannelCustomSampleChange: (channelId: string, sample: SampleCandidate) => void;
  onChannelVoiceModeChange: (channelId: string, voiceMode: StemVoiceMode) => void;
  onChannelMuteToggle: (channelId: string) => void;
  onChannelSoloToggle: (channelId: string) => void;
  onChannelVolumeChange: (channelId: string, db: number) => void;
  onToggleNote: (
    channelId: string,
    step: number,
    midi: number,
    durationSteps: number
  ) => void;
  onRecordNote: (channelId: string, note: StemNote) => void;
  onExtendNote?: (
    channelId: string,
    step: number,
    midi: number,
    durationSteps: number
  ) => void;
  onClearChannelNotes: (channelId: string) => void;
  onFixOffKeyNotes: (channelId: string) => void;
  onTransposeChannel: (channelId: string, semitones: number) => void;
  onRootKeyChange: (key: MusicalKey) => void;
  onScaleTypeChange: (scale: ScaleType) => void;
  onPlayKeyboardKey: (midi: number, recordToRoll: boolean) => void;
  onUnlockAudioSync: () => void;
  onEnsurePlaying: () => Promise<void>;
  getSharedAudioContext: () => AudioContext;
  onAfterMicAcquired: () => Promise<void>;
  onSetHumRecordingState: (active: boolean, muteBackingWhileHum: boolean) => void;
  getPlaybackTiming: () => {
    isPlaying: boolean;
    currentStep: number;
    nextStepTime: number;
    stepDuration: number;
    stepCount: number;
    ctxCurrentTime: number;
    baseLatency?: number;
    outputLatency?: number;
  };
  onSaveHumAudio: (channelId: string, blob: Blob) => Promise<void>;
  onSaveHumBuffer?: (channelId: string, buffer: AudioBuffer) => void;
  onReplaceHumNotes?: (channelId: string, notes: StemNote[]) => void;
  onClearHumAudio: (channelId: string) => void;
  onPlayHumPreview: (channelId: string) => Promise<boolean>;
  onStopHumPreview: () => void;
  onAuditionKeyboardVoice: (soundId: KeyboardSoundId) => void;
  onOpenFreesoundKeyModal: () => void;
}

const CHANNEL_ACCENT: Record<
  StemChannel['color'],
  {
    border: string;
    bg: string;
    noteBg: string;
    dot: string;
    flHeader: string;
    flHeaderSelected: string;
    flClipBar: string;
    flPicker: string;
    flNoteFill: string;
  }
> = {
  amber: {
    border: 'border-amber-500/50',
    bg: 'bg-amber-500/10',
    noteBg: 'bg-amber-400 text-zinc-950 border-amber-200',
    dot: 'bg-amber-400',
    flHeader: 'bg-[#256D65] text-zinc-100',
    flHeaderSelected: 'bg-[#2D857B] text-white',
    flClipBar: 'bg-[#2C7D74]',
    flPicker: 'bg-[#286B63] border-[#3C9A8F]',
    flNoteFill: 'bg-[#6FE3D5]',
  },
  emerald: {
    border: 'border-emerald-500/50',
    bg: 'bg-emerald-500/10',
    noteBg: 'bg-emerald-400 text-zinc-950 border-emerald-200',
    dot: 'bg-emerald-400',
    flHeader: 'bg-[#43713E] text-zinc-100',
    flHeaderSelected: 'bg-[#4E8548] text-white',
    flClipBar: 'bg-[#4B8145]',
    flPicker: 'bg-[#42703E] border-[#66A860]',
    flNoteFill: 'bg-[#8AE27F]',
  },
  sky: {
    border: 'border-sky-500/50',
    bg: 'bg-sky-500/10',
    noteBg: 'bg-sky-400 text-zinc-950 border-sky-200',
    dot: 'bg-sky-400',
    flHeader: 'bg-[#854D34] text-zinc-100',
    flHeaderSelected: 'bg-[#9E5B3D] text-white',
    flClipBar: 'bg-[#925438]',
    flPicker: 'bg-[#824B32] border-[#B87252]',
    flNoteFill: 'bg-[#F0A47D]',
  },
  violet: {
    border: 'border-violet-500/50',
    bg: 'bg-violet-500/10',
    noteBg: 'bg-violet-400 text-zinc-950 border-violet-200',
    dot: 'bg-violet-400',
    flHeader: 'bg-[#7A3B58] text-zinc-100',
    flHeaderSelected: 'bg-[#924669] text-white',
    flClipBar: 'bg-[#884162]',
    flPicker: 'bg-[#763754] border-[#B05C83]',
    flNoteFill: 'bg-[#E592B8]',
  },
  rose: {
    border: 'border-rose-500/50',
    bg: 'bg-rose-500/10',
    noteBg: 'bg-rose-400 text-zinc-950 border-rose-200',
    dot: 'bg-rose-400',
    flHeader: 'bg-[#86632C] text-zinc-100',
    flHeaderSelected: 'bg-[#9F7635] text-white',
    flClipBar: 'bg-[#936D31]',
    flPicker: 'bg-[#87652D] border-[#BF9148]',
    flNoteFill: 'bg-[#F3C572]',
  },
};

export const StemBuilderStudio: React.FC<StemBuilderStudioProps> = ({
  bpm,
  loopBars,
  isPlaying,
  currentStep,
  activeBar,
  followPlayhead,
  tracks,
  tapPads,
  stemLoopSource,
  stemLoopMuted,
  stemLoopSoloed,
  stemLoopVolumeDb,
  phoneLoopFileName,
  phoneLoopDurationSec,
  phoneLoopPeaks,
  stemChannels,
  selectedChannelId,
  rootKey,
  scaleType,
  canUndo,
  canRedo,
  freesoundKey,
  secondarySoundConfigured,
  secondarySoundProvider,
  onUndo,
  onRedo,
  onSelectBar,
  onToggleFollowPlayhead,
  onSelectLoopSource,
  onUploadPhoneLoopFile,
  onClearPhoneLoopFile,
  onToggleLoopMuted,
  onToggleLoopSolo,
  onLoopVolumeChange,
  onSelectChannel,
  onAddChannel,
  onRemoveChannel,
  onChannelSoundChange,
  onChannelCustomSampleChange,
  onChannelVoiceModeChange,
  onChannelMuteToggle,
  onChannelSoloToggle,
  onChannelVolumeChange,
  onToggleNote,
  onRecordNote,
  onExtendNote,
  onClearChannelNotes,
  onFixOffKeyNotes,
  onTransposeChannel,
  onRootKeyChange,
  onScaleTypeChange,
  onPlayKeyboardKey,
  onUnlockAudioSync,
  onEnsurePlaying,
  getSharedAudioContext,
  onAfterMicAcquired,
  onSetHumRecordingState,
  getPlaybackTiming,
  onSaveHumAudio,
  onSaveHumBuffer,
  onReplaceHumNotes,
  onClearHumAudio,
  onPlayHumPreview,
  onStopHumPreview,
  onAuditionKeyboardVoice,
  onOpenFreesoundKeyModal,
}) => {
  const selectedChannel =
    stemChannels.find((c) => c.id === selectedChannelId) ?? stemChannels[0];

  const [mobilePane, setMobilePane] = useState<'rack' | 'pianoroll'>('rack');
  const [desktopViewMode, setDesktopViewMode] = useState<'split' | 'playlist' | 'pianoroll'>('split');
  const [inspectorTarget, setInspectorTarget] = useState<'loop' | 'channel'>('channel');
  const [humPeaksByChannel, setHumPeaksByChannel] = useState<Record<string, number[]>>({});

  const [baseOctave, setBaseOctave] = useState<number>(3);
  const [rollTopMidi, setRollTopMidi] = useState<number>(77); // F5 .. E4 (shows Row 2 lead melody)
  const [noteDurationSteps, setNoteDurationSteps] = useState<number>(2);
  const [punchInRecord, setPunchInRecord] = useState<boolean>(true);
  const [showGhostNotes, setShowGhostNotes] = useState<boolean>(true);
  const [voiceBrowserChannelId, setVoiceBrowserChannelId] = useState<string | null>(null);
  const [playingHumChannelId, setPlayingHumChannelId] = useState<string | null>(null);
  const [phoneUploadError, setPhoneUploadError] = useState<string | null>(null);
  const [isUploadingPhoneLoop, setIsUploadingPhoneLoop] = useState<boolean>(false);

  // Live Sing / Hum Pitch-to-MIDI Capture state
  const [hummingChannelId, setHummingChannelId] = useState<string | null>(null);
  const [humStatusText, setHumStatusText] = useState<string | null>(null);
  const [humError, setHumError] = useState<string | null>(null);
  const [liveHumMidi, setLiveHumMidi] = useState<number | null>(null);
  const [muteBackingDuringHum, setMuteBackingDuringHum] = useState<boolean>(true);

  const phoneFileInputRef = useRef<HTMLInputElement | null>(null);
  const humStreamRef = useRef<MediaStream | null>(null);
  const humNodesRef = useRef<{
    source: MediaStreamAudioSourceNode;
    hp: BiquadFilterNode;
    humNotch: BiquadFilterNode;
    lp: BiquadFilterNode;
    compressor: DynamicsCompressorNode;
    makeupGain: GainNode;
    limiter: DynamicsCompressorNode;
    pitchLp: BiquadFilterNode;
    workletNode?: AudioWorkletNode;
    merger?: ChannelMergerNode;
    scriptNode?: ScriptProcessorNode;
    silentGain: GainNode;
  } | null>(null);
  const humFinalizeRef = useRef<(() => void) | null>(null);
  const onSetHumRecordingStateRef = useRef(onSetHumRecordingState);
  const onRecordNoteRef = useRef(onRecordNote);
  const onExtendNoteRef = useRef(onExtendNote);
  const onSaveHumBufferRef = useRef(onSaveHumBuffer);
  const onReplaceHumNotesRef = useRef(onReplaceHumNotes);
  const getPlaybackTimingRef = useRef(getPlaybackTiming);
  useEffect(() => {
    onSetHumRecordingStateRef.current = onSetHumRecordingState;
    onRecordNoteRef.current = onRecordNote;
    onExtendNoteRef.current = onExtendNote;
    onSaveHumBufferRef.current = onSaveHumBuffer;
    onReplaceHumNotesRef.current = onReplaceHumNotes;
    getPlaybackTimingRef.current = getPlaybackTiming;
  }, [
    onSetHumRecordingState,
    onRecordNote,
    onExtendNote,
    onSaveHumBuffer,
    onReplaceHumNotes,
    getPlaybackTiming,
  ]);

  useEffect(() => {
    void preloadBasicPitchModel().catch(() => undefined);
  }, []);

  const activeStepsCount = getActiveStepCount(loopBars);
  const barOffset =
    followPlayhead && currentStep >= 0
      ? Math.floor((currentStep % activeStepsCount) / 16)
      : Math.min(activeBar, loopBars - 1);
  const barStartStep = barOffset * 16;

  // Keyboard shortcuts for Undo / Redo (Ctrl+Z / Cmd+Z, Ctrl+Shift+Z / Ctrl+Y)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!(e.ctrlKey || e.metaKey)) return;

      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) onUndo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        if (canRedo) onRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canUndo, canRedo, onUndo, onRedo]);

  const handleFitRollToChannel = useCallback((channel: StemChannel) => {
    if (channel.notes.length > 0) {
      const avg =
        channel.notes.reduce((sum, n) => sum + n.midi, 0) / channel.notes.length;
      const top = Math.min(84, Math.max(50, Math.round(avg + 6)));
      setRollTopMidi(top);
      setBaseOctave(avg < 56 ? 2 : 3);
    } else if (channel.soundId === 'worship_bass') {
      setRollTopMidi(54);
      setBaseOctave(2);
    } else {
      setRollTopMidi(74);
      setBaseOctave(3);
    }
  }, []);

  const stopHumCapture = useCallback(() => {
    if (humFinalizeRef.current) {
      const finalize = humFinalizeRef.current;
      humFinalizeRef.current = null;
      try {
        finalize();
      } catch {
        // Ignore buffer finalize errors
      }
    }
    if (humNodesRef.current) {
      try {
        if (humNodesRef.current.workletNode) {
          humNodesRef.current.workletNode.port.onmessage = null;
          humNodesRef.current.workletNode.disconnect();
        }
        if (humNodesRef.current.scriptNode) {
          humNodesRef.current.scriptNode.onaudioprocess = null;
          humNodesRef.current.scriptNode.disconnect();
        }
        humNodesRef.current.source.disconnect();
        humNodesRef.current.hp.disconnect();
        humNodesRef.current.humNotch.disconnect();
        humNodesRef.current.lp.disconnect();
        humNodesRef.current.compressor.disconnect();
        humNodesRef.current.makeupGain.disconnect();
        humNodesRef.current.limiter.disconnect();
        humNodesRef.current.pitchLp.disconnect();
        humNodesRef.current.merger?.disconnect();
        humNodesRef.current.silentGain.disconnect();
      } catch {
        // Already disconnected
      }
      humNodesRef.current = null;
    }
    if (humStreamRef.current) {
      humStreamRef.current.getTracks().forEach((t) => t.stop());
      humStreamRef.current = null;
    }
    onSetHumRecordingStateRef.current(false, false);
    setHummingChannelId(null);
    setLiveHumMidi(null);
  }, []);

  useEffect(() => {
    return () => {
      stopHumCapture();
    };
  }, [stopHumCapture]);

  const startHumCaptureForChannel = async (channel: StemChannel) => {
    // Unlock Web Audio synchronously inside user click before awaiting getUserMedia
    onUnlockAudioSync();

    if (hummingChannelId) {
      stopHumCapture();
    }
    onSelectChannel(channel.id);
    setHumError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setHumError('Microphone capture is not supported in this browser.');
      return;
    }

    try {
      // Isolate vocal recording: silence other melodic rows and soften/mute backing loop
      onSetHumRecordingStateRef.current(true, muteBackingDuringHum);

      // Disable noiseSuppression & autoGainControl because WebRTC speech NS treats steady
      // humming as fan noise and chops/crackles vocal audio, while AGC pumps on drum beats.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: false },
            autoGainControl: { ideal: false },
            channelCount: 1,
          },
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'OverconstrainedError') {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          throw err;
        }
      }
      humStreamRef.current = stream;

      // Start playback and re-resume the shared audio context AFTER mic acquisition so
      // website playback plays separately in the site without getting mixed into this track
      await onEnsurePlaying();
      await onAfterMicAcquired();

      const sharedCtx = getSharedAudioContext();
      if (sharedCtx.state === 'suspended') {
        await sharedCtx.resume();
      }

      void preloadBasicPitchModel().catch(() => undefined);

      const source = sharedCtx.createMediaStreamSource(stream);
      // 1. Pre-process microphone audio with vocal noise filter + volume compressor + makeup gain
      const hp = sharedCtx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 85;
      hp.Q.value = 0.707;

      const humNotch = sharedCtx.createBiquadFilter();
      humNotch.type = 'notch';
      humNotch.frequency.value = 60;
      humNotch.Q.value = 4.0;

      // Preserve vocal harmonics up to 3.8 kHz for Basic Pitch while filtering high-frequency hiss
      const lp = sharedCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3800;
      lp.Q.value = 0.707;

      const compressor = sharedCtx.createDynamicsCompressor();
      compressor.threshold.value = -32;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.18;

      const makeupGain = sharedCtx.createGain();
      makeupGain.gain.value = 1.8;

      const limiter = sharedCtx.createDynamicsCompressor();
      limiter.threshold.value = -1.5;
      limiter.knee.value = 3;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.08;

      // Fundamental-focused low-pass solely for the live visual pitch indicator
      const pitchLp = sharedCtx.createBiquadFilter();
      pitchLp.type = 'lowpass';
      pitchLp.frequency.value = 1400;
      pitchLp.Q.value = 0.707;

      const silentGain = sharedCtx.createGain();
      silentGain.gain.value = 0;

      source.connect(hp);
      hp.connect(humNotch);
      humNotch.connect(lp);
      lp.connect(compressor);
      compressor.connect(makeupGain);
      makeupGain.connect(limiter);
      limiter.connect(pitchLp);

      const targetChannelId = channel.id;
      const tracker = new HumCaptureTracker();
      const initialTiming = getPlaybackTimingRef.current();
      let loopStepCount = Math.max(16, initialTiming.stepCount || activeStepsCount);
      let loopStepDuration =
        initialTiming.stepDuration > 0 ? initialTiming.stepDuration : 60 / bpm / 4;
      const loopRecorder = new LoopPcmRecorder(
        Math.round(loopStepCount * loopStepDuration * sharedCtx.sampleRate),
        sharedCtx.sampleRate
      );
      let prevReportedLiveMidi: number | null = null;
      let hasSavedBuffer = false;

      humFinalizeRef.current = () => {
        if (hasSavedBuffer) return;
        hasSavedBuffer = true;
        const finalPcm = loopRecorder.finalize();
        if (!finalPcm) {
          setHumStatusText(
            `No vocal audio detected on ${channel.name} — hold or sing closer to the mic and try again.`
          );
          return;
        }
        const buffer = sharedCtx.createBuffer(1, finalPcm.length, sharedCtx.sampleRate);
        buffer.getChannelData(0).set(finalPcm);
        const peaks = extractPcmWaveformPeaks(finalPcm, 64);
        setHumPeaksByChannel((prev) => ({ ...prev, [targetChannelId]: peaks }));
        onSaveHumBufferRef.current?.(targetChannelId, buffer);
        setHumStatusText(
          `Analyzing quiet details, fast notes & pitch bends on ${channel.name} with Basic Pitch...`
        );

        let lastPctBucket = -1;
        void transcribeVocalAudioWithBasicPitch(finalPcm, sharedCtx.sampleRate, {
          stepDurationSec: loopStepDuration,
          stepCount: loopStepCount,
          onProgress: (pct) => {
            const bucket = Math.min(95, Math.floor((pct * 100) / 20) * 20);
            if (bucket > lastPctBucket && bucket >= 20) {
              lastPctBucket = bucket;
              setHumStatusText(
                `Analyzing quiet details, fast notes & pitch bends on ${channel.name} (${bucket}%)...`
              );
            }
          },
        })
          .then((bpNotes) => {
            if (bpNotes.length > 0) {
              onReplaceHumNotesRef.current?.(targetChannelId, bpNotes);
              setHumStatusText(
                `Captured ${bpNotes.length} expressive notes with pitch bends on ${channel.name} — loop stays separate on Row 1.`
              );
            } else {
              setHumStatusText(
                `Clean voice & notes saved on ${channel.name} — loop stays separate on Row 1.`
              );
            }
          })
          .catch(() => {
            setHumStatusText(
              `Clean voice & notes saved on ${channel.name} — loop stays separate on Row 1.`
            );
          });
      };

      const processVoiceChunk = (
        voiceBlock: Float32Array,
        pitchBlock: Float32Array,
        blockEndTimeSec: number
      ) => {
        const timing = getPlaybackTimingRef.current();
        if (!timing.isPlaying) return;

        if (
          timing.stepCount !== loopStepCount ||
          Math.abs(timing.stepDuration - loopStepDuration) > 0.001
        ) {
          loopStepCount = Math.max(16, timing.stepCount);
          loopStepDuration = timing.stepDuration > 0 ? timing.stepDuration : loopStepDuration;
          loopRecorder.reset(
            Math.round(loopStepCount * loopStepDuration * sharedCtx.sampleRate),
            sharedCtx.sampleRate
          );
        }

        const latencyCompSec = Math.min(
          0.12,
          Math.max(
            0.02,
            (timing.baseLatency ?? 0.01) + (timing.outputLatency ?? 0) + 0.015
          )
        );
        const blockDuration = voiceBlock.length / sharedCtx.sampleRate;
        const phaseSec = computeLoopPhaseSeconds(
          timing,
          blockEndTimeSec - blockDuration,
          latencyCompSec
        );
        loopRecorder.writeChunk(voiceBlock, phaseSec);

        const pitchInfo = detectPitchInfo(
          pitchBlock,
          sharedCtx.sampleRate,
          0.006,
          0.54
        );
        const continuousStep = computeContinuousStepAtTime(
          timing,
          blockEndTimeSec - blockDuration * 0.5,
          latencyCompSec
        );
        const res = tracker.processFrame({
          hz: pitchInfo?.hz ?? null,
          rms: pitchInfo?.rms ?? 0,
          clarity: pitchInfo?.clarity ?? 0,
          continuousStep,
          stepCount: loopStepCount,
        });

        if (res.liveMidi !== prevReportedLiveMidi) {
          prevReportedLiveMidi = res.liveMidi;
          setLiveHumMidi(res.liveMidi);
        }
        if (res.action?.type === 'start') {
          onRecordNoteRef.current(targetChannelId, res.action.note);
          setHumStatusText(
            `Captured ${midiToNoteName(res.action.note.midi)} at step ${res.action.note.step + 1} (${channel.name})`
          );
        } else if (res.action?.type === 'extend') {
          onExtendNoteRef.current?.(
            targetChannelId,
            res.action.step,
            res.action.midi,
            res.action.durationSteps
          );
        }
      };

      // Prefer real-time AudioWorklet thread (zero React/UI thread audio cracking);
      // fall back cleanly to 4096-sample ScriptProcessor only if AudioWorklet is unavailable.
      let usedWorklet = false;
      if (typeof AudioWorkletNode !== 'undefined' && sharedCtx.audioWorklet) {
        try {
          if (!registeredHumWorkletContexts.has(sharedCtx)) {
            const blob = new Blob([HUM_WORKLET_PROCESSOR_CODE], {
              type: 'application/javascript',
            });
            const url = URL.createObjectURL(blob);
            try {
              await sharedCtx.audioWorklet.addModule(url);
              registeredHumWorkletContexts.add(sharedCtx);
            } finally {
              URL.revokeObjectURL(url);
            }
          }
          const workletNode = new AudioWorkletNode(sharedCtx, 'hum-capture-worklet', {
            numberOfInputs: 2,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          });
          limiter.connect(workletNode, 0, 0);
          pitchLp.connect(workletNode, 0, 1);
          workletNode.connect(silentGain);
          silentGain.connect(sharedCtx.destination);
          workletNode.port.onmessage = (e: MessageEvent<{
            voice: Float32Array;
            pitch: Float32Array;
            endTime: number;
          }>) => {
            if (!e.data?.voice) return;
            processVoiceChunk(e.data.voice, e.data.pitch ?? e.data.voice, e.data.endTime);
          };
          humNodesRef.current = {
            source,
            hp,
            humNotch,
            lp,
            compressor,
            makeupGain,
            limiter,
            pitchLp,
            workletNode,
            silentGain,
          };
          usedWorklet = true;
        } catch {
          usedWorklet = false;
        }
      }

      if (!usedWorklet) {
        const merger = sharedCtx.createChannelMerger(2);
        const scriptNode = sharedCtx.createScriptProcessor(4096, 2, 1);
        limiter.connect(merger, 0, 0);
        pitchLp.connect(merger, 0, 1);
        merger.connect(scriptNode);
        scriptNode.connect(silentGain);
        silentGain.connect(sharedCtx.destination);
        scriptNode.onaudioprocess = (event: AudioProcessingEvent) => {
          if (event.outputBuffer.numberOfChannels > 0) {
            event.outputBuffer.getChannelData(0).fill(0);
          }
          const voiceBlock = event.inputBuffer.getChannelData(0);
          const pitchFull =
            event.inputBuffer.numberOfChannels > 1
              ? event.inputBuffer.getChannelData(1)
              : voiceBlock;
          const nowTiming = getPlaybackTimingRef.current();
          // Process in two 2048-sample halves for crisp note timing
          const half = Math.floor(voiceBlock.length / 2);
          const blockDur = voiceBlock.length / sharedCtx.sampleRate;
          processVoiceChunk(
            voiceBlock.subarray(0, half),
            pitchFull.subarray(0, half),
            nowTiming.ctxCurrentTime - blockDur * 0.5
          );
          processVoiceChunk(
            voiceBlock.subarray(half),
            pitchFull.subarray(half),
            nowTiming.ctxCurrentTime
          );
        };
        humNodesRef.current = {
          source,
          hp,
          humNotch,
          lp,
          compressor,
          makeupGain,
          limiter,
          pitchLp,
          merger,
          scriptNode,
          silentGain,
        };
      }

      setHummingChannelId(targetChannelId);
      setHumStatusText(
        muteBackingDuringHum
          ? `Recording ONLY your voice on ${channel.name} — Row 1 loop muted so no beat bleeds in (follow the playhead, or switch on Beat Guide with headphones).`
          : `Recording ONLY your voice on ${channel.name} with soft Beat Guide — use headphones so the loop never enters the mic.`
      );
    } catch (err) {
      stopHumCapture();
      if (
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
      ) {
        setHumError(
          'Microphone access was blocked. Please allow microphone permission in your browser settings and try again.'
        );
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setHumError('No microphone device was found. Connect a microphone and try again.');
      } else {
        setHumError(
          err instanceof Error
            ? err.message
            : 'Could not access microphone. Please allow microphone permission.'
        );
      }
    }
  };

  const handleTogglePlayHumPreview = async (channelId: string) => {
    if (playingHumChannelId === channelId) {
      onStopHumPreview();
      setPlayingHumChannelId(null);
      return;
    }
    const ok = await onPlayHumPreview(channelId);
    if (ok) {
      setPlayingHumChannelId(channelId);
    }
  };

  const handlePhoneLoopFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhoneUploadError(null);
    setIsUploadingPhoneLoop(true);
    try {
      await onUploadPhoneLoopFile(file);
    } catch (err) {
      setPhoneUploadError(
        err instanceof Error ? err.message : 'Unable to load audio loop from device.'
      );
    } finally {
      setIsUploadingPhoneLoop(false);
    }
  };

  const loopBedStepCounts = useMemo(() => {
    const counts = new Array<number>(64).fill(0);
    if (stemLoopSource === 'taploop') {
      for (const pad of tapPads) {
        if (pad.muted) continue;
        for (let s = 0; s < 64; s++) {
          if ((pad.steps[s] ?? 0) > 0) counts[s] += 1;
        }
      }
    } else if (stemLoopSource === 'sequencer') {
      for (const track of tracks) {
        if (track.isClick || track.muted) continue;
        for (let s = 0; s < 64; s++) {
          if ((track.steps[s] ?? 0) > 0) counts[s] += 1;
        }
      }
    }
    return counts;
  }, [stemLoopSource, tapPads, tracks]);

  const activeLoopElementsCount = useMemo(() => {
    if (stemLoopSource === 'taploop') {
      return tapPads.filter((p) => !p.muted && p.steps.some((v) => v > 0)).length;
    }
    if (stemLoopSource === 'sequencer') {
      return tracks.filter((t) => !t.isClick && !t.muted && t.steps.some((v) => v > 0))
        .length;
    }
    return phoneLoopFileName ? 1 : 0;
  }, [stemLoopSource, tapPads, tracks, phoneLoopFileName]);

  const offKeyCountOnSelected = useMemo(() => {
    if (!selectedChannel) return 0;
    return selectedChannel.notes.filter(
      (n) => !isMidiInScale(n.midi, rootKey, scaleType)
    ).length;
  }, [selectedChannel, rootKey, scaleType]);

  // 14 crisp semitone rows so Piano Roll + Keyboard Row fit neatly on desktop viewports
  const visiblePitchMidis = useMemo(() => {
    const top = clampMidi(rollTopMidi);
    const rows: number[] = [];
    for (let i = 0; i < 14; i++) {
      const m = top - i;
      if (m >= 36) rows.push(m);
    }
    return rows;
  }, [rollTopMidi]);

  const activePlayingMidis = useMemo(() => {
    if (!selectedChannel || currentStep < 0) return [];
    return selectedChannel.notes
      .filter((n) => n.step === currentStep)
      .map((n) => n.midi);
  }, [selectedChannel, currentStep]);

  const activeSoundPreset =
    KEYBOARD_SOUND_PRESETS.find((p) => p.id === selectedChannel?.soundId) ??
    KEYBOARD_SOUND_PRESETS[0];

  const activeVoiceDisplayLabel =
    selectedChannel?.voiceMode === 'hum_audio' && selectedChannel?.hasHumAudio
      ? 'Raw Hum Vocal'
      : selectedChannel?.voiceMode === 'custom_sample' && selectedChannel?.customVoiceSample
      ? selectedChannel.customVoiceSample.name
      : activeSoundPreset.label;

  const rootPc = MUSICAL_KEYS.indexOf(rootKey);
  const voiceBrowserTarget =
    stemChannels.find((c) => c.id === voiceBrowserChannelId) ?? null;

  const songTimelineSteps = useMemo(
    () => Math.max(64, getSongTimelineSteps(stemChannels, activeStepsCount)),
    [stemChannels, activeStepsCount]
  );
  const timelineBars = Math.max(4, Math.ceil(songTimelineSteps / 16));
  const playheadPercent =
    isPlaying && currentStep >= 0
      ? ((currentStep % songTimelineSteps) / songTimelineSteps) * 100
      : 0;

  const effectiveInspectorMode =
    inspectorTarget === 'loop' || !selectedChannel ? 'loop' : 'channel';

  return (
    <div className="space-y-3 pb-14 lg:pb-4">
      {/* Hidden input for uploading Phone Audio Loop into Track 01 */}
      <input
        ref={phoneFileInputRef}
        type="file"
        accept="audio/*,video/mp4,.mp3,.wav,.m4a,.mp4,.aac,.ogg,.opus,.flac,.webm,.3gp,.amr"
        className="hidden"
        onChange={(e) => void handlePhoneLoopFileChange(e)}
      />

      {/* TOP FL-STUDIO PLAYLIST TOOLBAR */}
      <section className="rounded-xl border border-[#2F3A47] bg-[#1A2027] px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Left: Arrangement Title + Key/Scale + Prev/Next History Arrows */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 pr-1">
              <Layers className="h-4 w-4 text-amber-400" />
              <h1 className="font-display text-sm font-bold tracking-tight text-zinc-100 sm:text-base whitespace-nowrap">
                Playlist · Arrangement
              </h1>
              <span className="hidden font-mono-tabular text-[11px] text-zinc-400 md:inline">
                · {bpm} BPM · {timelineBars} Bars
              </span>
            </div>

            {/* Key & Scale */}
            <div className="flex h-8 items-center gap-1.5 rounded-md border border-[#34404E] bg-[#13181E] px-2.5">
              <label htmlFor="stem-key-select" className="text-[11px] font-medium text-zinc-400">
                Key
              </label>
              <select
                id="stem-key-select"
                value={rootKey}
                onChange={(e) => onRootKeyChange(e.target.value as MusicalKey)}
                className="bg-transparent font-mono-tabular text-xs font-bold text-amber-400 focus:outline-none"
              >
                {MUSICAL_KEYS.map((k) => (
                  <option key={k} value={k} className="bg-zinc-950 text-zinc-100">
                    {k}
                  </option>
                ))}
              </select>
              <span className="text-zinc-600" aria-hidden="true">/</span>
              <select
                aria-label="Musical scale"
                value={scaleType}
                onChange={(e) => onScaleTypeChange(e.target.value as ScaleType)}
                className="bg-transparent text-xs font-semibold text-zinc-200 focus:outline-none"
              >
                <option value="major" className="bg-zinc-950 text-zinc-100">
                  Major
                </option>
                <option value="minor" className="bg-zinc-950 text-zinc-100">
                  Minor
                </option>
                <option value="pentatonic" className="bg-zinc-950 text-zinc-100">
                  Pentatonic
                </option>
              </select>
            </div>

            {/* Traverse Arrow Buttons (Undo <- / Redo ->) */}
            <div
              role="group"
              aria-label="Traverse edit history"
              className="flex h-8 items-center gap-0.5 rounded-md border border-[#34404E] bg-[#13181E] p-0.5"
            >
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo}
                aria-label="Prev — Undo change"
                title="Previous step (Ctrl+Z)"
                className="flex h-7 items-center gap-1 rounded px-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-[#242C36] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Prev</span>
              </button>
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo}
                aria-label="Next — Redo change"
                title="Forward step (Ctrl+Shift+Z)"
                className="flex h-7 items-center gap-1 rounded px-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-[#242C36] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <span className="hidden sm:inline">Next</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Right: Pitch Correction + Add Track + Workspace Mode */}
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedChannel && (
              <>
                <button
                  type="button"
                  onClick={() => onFixOffKeyNotes(selectedChannel.id)}
                  className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    offKeyCountOnSelected > 0
                      ? 'border-rose-500/60 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                  }`}
                >
                  {offKeyCountOnSelected > 0 ? (
                    <>
                      <Wand2 className="h-3.5 w-3.5" />
                      <span>Fix {offKeyCountOnSelected} Off-Key</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Snap to Key</span>
                    </>
                  )}
                </button>

                <div className="flex h-8 items-center rounded-md border border-[#34404E] bg-[#13181E] p-0.5">
                  <button
                    type="button"
                    onClick={() => onTransposeChannel(selectedChannel.id, -1)}
                    className="h-7 rounded px-2 font-mono-tabular text-[11px] font-semibold text-zinc-300 hover:bg-[#242C36]"
                    title="Transpose selected track down 1 semitone"
                  >
                    -1 st
                  </button>
                  <button
                    type="button"
                    onClick={() => onTransposeChannel(selectedChannel.id, 1)}
                    className="h-7 rounded px-2 font-mono-tabular text-[11px] font-semibold text-zinc-300 hover:bg-[#242C36]"
                    title="Transpose selected track up 1 semitone"
                  >
                    +1 st
                  </button>
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setInspectorTarget('channel');
                onAddChannel();
              }}
              className="flex h-8 items-center gap-1 rounded-md border border-amber-500/50 bg-amber-500/15 px-2.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/25 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Row</span>
            </button>

            {/* Desktop Split / Playlist / Piano Roll Switcher */}
            <div
              role="group"
              aria-label="Workspace layout"
              className="hidden h-8 items-center gap-0.5 rounded-md border border-[#34404E] bg-[#13181E] p-0.5 lg:flex"
            >
              {(
                [
                  { id: 'split', label: 'Split' },
                  { id: 'playlist', label: 'Playlist' },
                  { id: 'pianoroll', label: 'Piano Roll' },
                ] as const
              ).map((view) => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => setDesktopViewMode(view.id)}
                  className={`h-7 rounded px-2 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    desktopViewMode === view.id
                      ? 'bg-amber-500 text-zinc-950'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {view.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {(humStatusText || humError || phoneUploadError || hummingChannelId) && (
          <div
            role={humError || phoneUploadError ? 'alert' : 'status'}
            className={`mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-xs ${
              humError || phoneUploadError
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                : 'border-amber-500/35 bg-amber-500/10 text-amber-200'
            }`}
          >
            <span className="min-w-0 flex-1">
              {humError || phoneUploadError || humStatusText}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              {hummingChannelId && (
                <button
                  type="button"
                  onClick={() => {
                    const next = !muteBackingDuringHum;
                    setMuteBackingDuringHum(next);
                    onSetHumRecordingState(true, next);
                  }}
                  className={`rounded border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                    muteBackingDuringHum
                      ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                      : 'border-amber-400/40 bg-amber-500/15 text-amber-200'
                  }`}
                >
                  {muteBackingDuringHum
                    ? 'Loop Muted (Zero Bleed)'
                    : 'Soft Loop Guide (Headphones)'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setHumError(null);
                  setPhoneUploadError(null);
                  setHumStatusText(null);
                }}
                className="shrink-0 text-[11px] font-semibold opacity-80 hover:opacity-100"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Mobile View Switcher (< lg) */}
      <div
        role="tablist"
        aria-label="Stem workspace panes"
        className="grid grid-cols-2 gap-1 rounded-xl border border-[#2F3A47] bg-[#1A2027] p-1 lg:hidden"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'rack'}
          onClick={() => setMobilePane('rack')}
          className={`h-9 rounded-lg text-xs font-semibold transition-colors ${
            mobilePane === 'rack'
              ? 'bg-amber-500 text-zinc-950'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Playlist Arrangement
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'pianoroll'}
          onClick={() => setMobilePane('pianoroll')}
          className={`h-9 rounded-lg text-xs font-semibold transition-colors ${
            mobilePane === 'pianoroll'
              ? 'bg-amber-500 text-zinc-950'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Piano Roll &amp; Keys
        </button>
      </div>

      {/* SECTION 1: FL STUDIO PLAYLIST — ARRANGEMENT CANVAS (Pickers + Track Headers + Clips Timeline) */}
      {(desktopViewMode !== 'pianoroll' || mobilePane === 'rack') && (
        <section
          aria-label="Channel Rack — All Sequences"
          className={`overflow-hidden rounded-xl border border-[#2F3A47] bg-[#202730] shadow-inner ${
            mobilePane === 'rack' ? 'block' : 'hidden'
          } ${desktopViewMode === 'pianoroll' ? 'lg:hidden' : 'lg:block'}`}
        >
          <div className="grid grid-cols-1 lg:grid-cols-[152px_1fr]">
            {/* Far-Left FL Studio Pattern & Audio Clip Picker Sidebar */}
            <aside
              aria-label="Pattern and Clip Picker"
              className="hidden flex-col border-r border-[#2F3A47] bg-[#171D24] lg:flex"
            >
              <div className="flex h-8 items-center justify-between border-b border-[#2F3A47] px-2.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                <span>Clip Picker</span>
                <span className="font-mono-tabular text-zinc-500">
                  {stemChannels.length + 1}
                </span>
              </div>

              <div className="flex-1 space-y-1 p-1.5">
                {/* Clip 01: Loop Bed */}
                <button
                  type="button"
                  onClick={() => setInspectorTarget('loop')}
                  className={`flex w-full items-center justify-between gap-1.5 rounded-sm border px-2 py-1.5 text-left text-[11px] font-semibold transition-all ${
                    effectiveInspectorMode === 'loop'
                      ? 'border-sky-300 bg-[#3B6A90] text-white shadow-sm'
                      : 'border-[#3D6A8F]/60 bg-[#2A4B66] text-zinc-100 hover:bg-[#335B7B]'
                  }`}
                >
                  <span className="truncate">
                    {stemLoopSource === 'phone_audio'
                      ? phoneLoopFileName || 'Phone Audio'
                      : stemLoopSource === 'taploop'
                      ? 'Tap Loop'
                      : 'Sequencer Loop'}
                  </span>
                  <span className="font-mono-tabular text-[9px] opacity-80">01</span>
                </button>

                {/* Melodic & Hum Clips */}
                {stemChannels.map((ch, idx) => {
                  const accent = CHANNEL_ACCENT[ch.color];
                  const isSelected =
                    effectiveInspectorMode === 'channel' && selectedChannel?.id === ch.id;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => {
                        setInspectorTarget('channel');
                        onSelectChannel(ch.id);
                        handleFitRollToChannel(ch);
                      }}
                      className={`flex w-full items-center justify-between gap-1.5 rounded-sm border px-2 py-1.5 text-left text-[11px] font-semibold text-white transition-all ${
                        accent.flPicker
                      } ${isSelected ? 'ring-1 ring-amber-300 brightness-110' : 'opacity-90 hover:opacity-100'}`}
                    >
                      <span className="truncate">
                        {ch.name.replace(/^Row \d+\s*·\s*/, '')}
                      </span>
                      <span className="font-mono-tabular text-[9px] opacity-80">
                        {String(idx + 2).padStart(2, '0')}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-[#2F3A47] p-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setInspectorTarget('channel');
                    onAddChannel();
                  }}
                  className="flex h-7 w-full items-center justify-center gap-1 rounded-sm border border-dashed border-[#3E4C5C] bg-[#1E252E] text-[10px] font-semibold text-zinc-300 hover:border-amber-400/60 hover:text-amber-300"
                >
                  <Plus className="h-3 w-3" />
                  <span>New Track</span>
                </button>
              </div>
            </aside>

            {/* Right Area: Aligned Track Headers + Multi-Bar Arrangement Grid */}
            <div className="min-w-0 overflow-x-auto [--track-header-w:156px] sm:[--track-header-w:220px]">
              <div className="min-w-[640px]">
                {/* Timeline Bar Ruler */}
                <div className="flex h-8 border-b border-[#2F3A47] bg-[#171D24]">
                  <div className="sticky left-0 z-20 flex w-[156px] shrink-0 items-center justify-between border-r border-[#2F3A47] bg-[#171D24] px-2.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase sm:w-[220px]">
                    <span>Tracks ({stemChannels.length + 1})</span>
                    <span className="hidden font-mono-tabular text-zinc-500 sm:inline">
                      Click row
                    </span>
                  </div>

                  <div
                    className="relative grid flex-1"
                    style={{
                      gridTemplateColumns: `repeat(${timelineBars}, minmax(0, 1fr))`,
                    }}
                  >
                    {Array.from({ length: timelineBars }).map((_, barIdx) => {
                      const isCurrentRollBar = barOffset === barIdx;
                      return (
                        <button
                          key={barIdx}
                          type="button"
                          onClick={() => {
                            if (barIdx < loopBars) {
                              onSelectBar(barIdx);
                            }
                          }}
                          className={`relative flex items-center justify-between border-r border-[#333F4D] px-2 text-left font-mono-tabular text-[11px] font-bold transition-colors ${
                            isCurrentRollBar
                              ? 'bg-[#25303C] text-amber-300'
                              : 'text-zinc-400 hover:bg-[#1E2630] hover:text-zinc-200'
                          }`}
                          title={`Bar ${barIdx + 1}`}
                        >
                          <span>{barIdx + 1}</span>
                          <div className="flex items-end gap-2 opacity-40">
                            <span className="h-1.5 w-px bg-zinc-400" />
                            <span className="h-1 w-px bg-zinc-500" />
                            <span className="h-1.5 w-px bg-zinc-400" />
                          </div>
                        </button>
                      );
                    })}

                    {/* Playhead Triangle on Ruler */}
                    {isPlaying && currentStep >= 0 && (
                      <div
                        style={{ left: `${playheadPercent}%` }}
                        className="pointer-events-none absolute top-0 bottom-0 z-20 -translate-x-1/2"
                      >
                        <div className="mx-auto h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-amber-400" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Track Lanes Body (with unified full-height Playhead cursor) */}
                <div className="relative">
                  {isPlaying && currentStep >= 0 && (
                    <div
                      style={{
                        left: `calc(var(--track-header-w) + (100% - var(--track-header-w)) * ${playheadPercent / 100})`,
                      }}
                      className="pointer-events-none absolute inset-y-0 z-20 w-[1.5px] bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.7)]"
                    />
                  )}

                  {/* ROW 01: Master Loop Bed Track */}
                  <div
                    data-testid="stem-row-01"
                    className="flex h-[62px] border-b border-[#2C3643]"
                  >
                    {/* Track 01 Header Block (FL Studio Steel Blue) */}
                    <div
                      className={`sticky left-0 z-10 flex w-[156px] shrink-0 items-center justify-between gap-1.5 border-r border-[#2F3A47] px-2 py-1.5 transition-colors sm:w-[220px] sm:gap-2 sm:px-2.5 ${
                        effectiveInspectorMode === 'loop'
                          ? 'bg-[#365C7C] text-white'
                          : 'bg-[#29445B] text-zinc-100 hover:bg-[#30506B]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setInspectorTarget('loop')}
                        className="min-w-0 flex-1 text-left focus:outline-none"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono-tabular text-[10px] font-bold opacity-75">
                            01
                          </span>
                          <span className="truncate text-xs font-bold">
                            {stemLoopSource === 'phone_audio'
                              ? phoneLoopFileName || 'Phone Audio'
                              : stemLoopSource === 'taploop'
                              ? 'Tap Loop'
                              : 'Sequencer Loop'}
                          </span>
                        </div>
                        <div className="truncate font-mono-tabular text-[10px] opacity-80">
                          {stemLoopSoloed ? 'Soloed · ' : ''}
                          {stemLoopSource === 'phone_audio'
                            ? phoneLoopFileName
                              ? `${Math.round(phoneLoopDurationSec)}s phone WAV`
                              : 'Upload phone loop'
                            : `${activeLoopElementsCount} layers · ${loopBars}B`}
                        </div>
                      </button>

                      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setInspectorTarget('loop');
                            onToggleLoopSolo();
                          }}
                          aria-pressed={stemLoopSoloed}
                          aria-label={stemLoopSoloed ? 'Stop hearing only Row 1' : 'Hear only Row 1 loop'}
                          className={`rounded px-1.5 py-0.5 text-[9px] font-bold transition-colors ${
                            stemLoopSoloed
                              ? 'bg-amber-400 text-zinc-950'
                              : 'bg-black/25 text-zinc-200 hover:bg-black/40'
                          }`}
                        >
                          S
                        </button>
                        <button
                          type="button"
                          onClick={onToggleLoopMuted}
                          aria-pressed={stemLoopMuted}
                          aria-label={stemLoopMuted ? 'Unmute Row 1 loop' : 'Mute Row 1 loop'}
                          title={stemLoopMuted ? 'Unmute track' : 'Mute track'}
                          className="flex h-5 w-5 items-center justify-center rounded bg-black/25 hover:bg-black/45"
                        >
                          <span
                            className={`h-2.5 w-2.5 rounded-full transition-colors ${
                              stemLoopMuted
                                ? 'bg-zinc-600'
                                : 'bg-[#8CE94A] shadow-[0_0_6px_rgba(140,233,74,0.75)]'
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Track 01 Timeline Clip Lane */}
                    <div
                      onClick={() => setInspectorTarget('loop')}
                      className="relative flex-1 cursor-pointer bg-[#232B34]"
                    >
                      {/* Bar + 4-Beat Gridlines */}
                      <div
                        className="pointer-events-none absolute inset-0 grid"
                        style={{
                          gridTemplateColumns: `repeat(${timelineBars}, minmax(0, 1fr))`,
                        }}
                      >
                        {Array.from({ length: timelineBars }).map((_, b) => (
                          <div
                            key={b}
                            className={`grid grid-cols-4 border-r border-[#333F4D] ${
                              b % 2 === 1 ? 'bg-black/10' : ''
                            }`}
                          >
                            <span className="border-r border-white/[0.04]" />
                            <span className="border-r border-white/[0.04]" />
                            <span className="border-r border-white/[0.04]" />
                            <span />
                          </div>
                        ))}
                      </div>

                      {/* FL Clip Block */}
                      <div
                        style={{
                          left: '0%',
                          width: `${(loopBars / timelineBars) * 100}%`,
                        }}
                        className={`absolute inset-y-1 flex flex-col overflow-hidden rounded-sm border ${
                          stemLoopMuted
                            ? 'border-zinc-600/70 opacity-50'
                            : effectiveInspectorMode === 'loop'
                            ? 'border-sky-300/80 shadow-sm'
                            : 'border-[#487CA8]/80'
                        }`}
                      >
                        {/* Colored Clip Top Bar */}
                        <div className="flex h-4 shrink-0 items-center justify-between bg-[#3E6E94] px-2 text-[10px] font-bold text-white">
                          <span className="truncate">
                            {stemLoopSource === 'phone_audio'
                              ? phoneLoopFileName || 'Phone Audio Clip'
                              : stemLoopSource === 'taploop'
                              ? 'Tap Loop Pattern'
                              : 'Sequencer Pattern'}
                          </span>
                          <span className="font-mono-tabular text-[9px] opacity-85">
                            {loopBars} Bars
                          </span>
                        </div>

                        {/* Clip Body: Real Waveform OR Percussion Rhythm Bars */}
                        <div className="flex flex-1 items-center gap-px bg-[#151C24]/90 px-1">
                          {stemLoopSource === 'phone_audio' && phoneLoopPeaks.length > 0
                            ? phoneLoopPeaks.slice(0, 64).map((pk, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    height: `${Math.max(18, Math.round(pk * 92))}%`,
                                  }}
                                  className="flex-1 rounded-xs bg-zinc-100/90"
                                />
                              ))
                            : loopBedStepCounts.slice(0, loopBars * 16).map((cnt, sIdx) => (
                                <div
                                  key={sIdx}
                                  style={{
                                    height:
                                      cnt > 0
                                        ? `${Math.min(92, 26 + cnt * 18)}%`
                                        : '10%',
                                  }}
                                  className={`flex-1 rounded-xs ${
                                    cnt > 0 ? 'bg-amber-300/90' : 'bg-zinc-700/35'
                                  }`}
                                />
                              ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ROWS 02..N: Melodic / Hum Stem Tracks */}
                  {stemChannels.map((ch, idx) => {
                    const rowNumber = String(idx + 2).padStart(2, '0');
                    const accent = CHANNEL_ACCENT[ch.color];
                    const isSelected =
                      effectiveInspectorMode === 'channel' && selectedChannel?.id === ch.id;
                    const isRowHumming = hummingChannelId === ch.id;
                    const channelOffKeyCount = ch.notes.filter(
                      (n) => !isMidiInScale(n.midi, rootKey, scaleType)
                    ).length;

                    const voiceShortLabel =
                      ch.voiceMode === 'hum_audio' && ch.hasHumAudio
                        ? 'Raw Hum Audio'
                        : ch.voiceMode === 'custom_sample' && ch.customVoiceSample
                        ? ch.customVoiceSample.name
                        : KEYBOARD_SOUND_PRESETS.find((p) => p.id === ch.soundId)
                            ?.shortLabel ?? 'Synth';

                    const channelMaxStep = ch.notes.reduce(
                      (max, n) => Math.max(max, n.step + n.durationSteps),
                      loopBars * 16
                    );
                    const clipBarsSpan = Math.min(
                      timelineBars,
                      Math.max(loopBars, Math.ceil(channelMaxStep / 16))
                    );
                    const clipSpanSteps = clipBarsSpan * 16;
                    const humPeaks = humPeaksByChannel[ch.id] ?? [];

                    return (
                      <div
                        key={ch.id}
                        data-testid={`stem-row-${rowNumber}`}
                        className="flex h-[62px] border-b border-[#2C3643] last:border-b-0"
                      >
                        {/* FL Track Header Block */}
                        <div
                          className={`sticky left-0 z-10 flex w-[156px] shrink-0 items-center justify-between gap-1 border-r border-[#2F3A47] px-2 py-1.5 transition-colors sm:w-[220px] sm:gap-1.5 sm:px-2.5 ${
                            isSelected ? accent.flHeaderSelected : accent.flHeader
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setInspectorTarget('channel');
                              onSelectChannel(ch.id);
                              handleFitRollToChannel(ch);
                            }}
                            className="min-w-0 flex-1 text-left focus:outline-none"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono-tabular text-[10px] font-bold opacity-75">
                                {rowNumber}
                              </span>
                              <span className="truncate text-xs font-bold">
                                {ch.name.replace(/^Row \d+\s*·\s*/, '')}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 truncate font-mono-tabular text-[10px] opacity-85">
                              <span className="truncate">{voiceShortLabel}</span>
                              {channelOffKeyCount > 0 && (
                                <span className="rounded bg-rose-600 px-1 text-[9px] font-bold text-white">
                                  {channelOffKeyCount}!
                                </span>
                              )}
                            </div>
                          </button>

                          <div className="flex shrink-0 items-center gap-1">
                            {/* Quick Direct Mic Hum Button right on Track Header */}
                            <button
                              type="button"
                              onClick={() => {
                                setInspectorTarget('channel');
                                if (isRowHumming) {
                                  stopHumCapture();
                                } else {
                                  void startHumCaptureForChannel(ch);
                                }
                              }}
                              aria-label={
                                isRowHumming
                                  ? `Stop hum recording on ${ch.name}`
                                  : `Hum to ${ch.name}`
                              }
                              title={isRowHumming ? 'Stop Hum' : 'Hum to Row'}
                              className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                                isRowHumming
                                  ? 'bg-rose-500 text-white shadow-sm'
                                  : 'bg-black/25 text-zinc-100 hover:bg-amber-500 hover:text-zinc-950'
                              }`}
                            >
                              {isRowHumming ? (
                                <MicOff className="h-3 w-3" />
                              ) : (
                                <Mic className="h-3 w-3" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setInspectorTarget('channel');
                                onSelectChannel(ch.id);
                                handleFitRollToChannel(ch);
                                onChannelSoloToggle(ch.id);
                              }}
                              aria-pressed={ch.soloed}
                              aria-label={
                                ch.soloed
                                  ? `Stop hearing only ${ch.name}`
                                  : `Hear only ${ch.name}`
                              }
                              title="Solo track"
                              className={`rounded px-1.5 py-0.5 text-[9px] font-bold transition-colors ${
                                ch.soloed
                                  ? 'bg-amber-400 text-zinc-950'
                                  : 'bg-black/25 text-zinc-100 hover:bg-black/45'
                              }`}
                            >
                              S
                            </button>

                            <button
                              type="button"
                              onClick={() => onChannelMuteToggle(ch.id)}
                              aria-pressed={ch.muted}
                              aria-label={`Mute ${ch.name}`}
                              title={ch.muted ? 'Unmute track' : 'Mute track'}
                              className="flex h-5 w-5 items-center justify-center rounded bg-black/25 hover:bg-black/45"
                            >
                              <span
                                className={`h-2.5 w-2.5 rounded-full transition-colors ${
                                  ch.muted
                                    ? 'bg-zinc-600'
                                    : 'bg-[#8CE94A] shadow-[0_0_6px_rgba(140,233,74,0.75)]'
                                }`}
                              />
                            </button>
                          </div>
                        </div>

                        {/* Timeline Clip Lane */}
                        <div className="relative flex-1 bg-[#232B34]">
                          {/* Bar + 4-Beat Gridlines */}
                          <div
                            className="pointer-events-none absolute inset-0 grid"
                            style={{
                              gridTemplateColumns: `repeat(${timelineBars}, minmax(0, 1fr))`,
                            }}
                          >
                            {Array.from({ length: timelineBars }).map((_, b) => (
                              <div
                                key={b}
                                onClick={() => {
                                  setInspectorTarget('channel');
                                  onSelectChannel(ch.id);
                                  handleFitRollToChannel(ch);
                                  if (b < loopBars) onSelectBar(b);
                                }}
                                className={`pointer-events-auto grid cursor-pointer grid-cols-4 border-r border-[#333F4D] ${
                                  b % 2 === 1 ? 'bg-black/10' : ''
                                }`}
                              >
                                <span className="border-r border-white/[0.04]" />
                                <span className="border-r border-white/[0.04]" />
                                <span className="border-r border-white/[0.04]" />
                                <span />
                              </div>
                            ))}
                          </div>

                          {/* FL-Style Pattern / Hum Audio Clip */}
                          <div
                            onClick={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const rel = Math.max(0, Math.min(0.99, (e.clientX - rect.left) / rect.width));
                              const clickedBar = Math.min(loopBars - 1, Math.floor(rel * clipBarsSpan));
                              setInspectorTarget('channel');
                              onSelectChannel(ch.id);
                              handleFitRollToChannel(ch);
                              onSelectBar(clickedBar);
                            }}
                            style={{
                              left: '0%',
                              width: `${(clipBarsSpan / timelineBars) * 100}%`,
                            }}
                            className={`absolute inset-y-1 flex cursor-pointer flex-col overflow-hidden rounded-sm border transition-all ${
                              ch.muted
                                ? 'border-zinc-600/70 opacity-45'
                                : isSelected
                                ? 'border-amber-300/90 shadow-md'
                                : 'border-white/20 hover:border-white/40'
                            }`}
                          >
                            {/* Clip Header Bar */}
                            <div
                              className={`flex h-4 shrink-0 items-center justify-between px-2 text-[10px] font-bold text-white ${
                                ch.voiceMode === 'hum_audio' && ch.hasHumAudio
                                  ? 'bg-[#A13B4A]'
                                  : accent.flClipBar
                              }`}
                            >
                              <span className="truncate">
                                {ch.name.replace(/^Row \d+\s*·\s*/, '')} · {voiceShortLabel}
                              </span>
                              <span className="font-mono-tabular text-[9px] opacity-85">
                                {ch.notes.length > 0 ? `${ch.notes.length} notes` : 'Empty'}
                              </span>
                            </div>

                            {/* Clip Body: Vocal Audio Waveform OR MIDI Note Bars */}
                            <div className="relative flex flex-1 items-center gap-px overflow-hidden bg-[#151C24]/90 px-1">
                              {ch.voiceMode === 'hum_audio' &&
                              ch.hasHumAudio &&
                              humPeaks.length > 0 ? (
                                humPeaks.map((pk, pIdx) => (
                                  <div
                                    key={pIdx}
                                    style={{
                                      height: `${Math.max(16, Math.round(pk * 92))}%`,
                                    }}
                                    className="flex-1 rounded-xs bg-rose-200/90"
                                  />
                                ))
                              ) : (
                                ch.notes.map((note, nIdx) => {
                                  const leftPct = (note.step / clipSpanSteps) * 100;
                                  const widthPct = Math.max(
                                    1.2,
                                    (note.durationSteps / clipSpanSteps) * 100
                                  );
                                  const yPct = Math.max(
                                    8,
                                    Math.min(82, ((84 - note.midi) / 48) * 74 + 8)
                                  );
                                  const inKey = isMidiInScale(note.midi, rootKey, scaleType);
                                  return (
                                    <span
                                      key={`${note.step}-${note.midi}-${nIdx}`}
                                      style={{
                                        left: `${leftPct}%`,
                                        width: `${widthPct}%`,
                                        top: `${yPct}%`,
                                      }}
                                      className={`pointer-events-none absolute h-[3px] rounded-xs ${
                                        !inKey ? 'bg-rose-400' : accent.flNoteFill
                                      }`}
                                    />
                                  );
                                })
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ACTIVE TRACK CONSOLE INSPECTOR BAR (Clean, Uncluttered Controls for Selected Track) */}
      <section
        aria-label="Selected Track Inspector"
        className="rounded-xl border border-[#2F3A47] bg-[#171D24] px-3 py-2.5 sm:px-4"
      >
        {effectiveInspectorMode === 'loop' ? (
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono-tabular rounded bg-[#365C7C] px-2 py-0.5 text-[10px] font-bold text-white">
                TRACK 01
              </span>
              <span className="text-xs font-bold text-zinc-100">
                Loop Bed Source
              </span>

              <div
                role="group"
                aria-label="Row 1 loop source"
                className="flex items-center gap-0.5 rounded-md border border-[#34404E] bg-[#11161C] p-0.5"
              >
                <button
                  type="button"
                  onClick={() => onSelectLoopSource('sequencer')}
                  aria-pressed={stemLoopSource === 'sequencer'}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    stemLoopSource === 'sequencer'
                      ? 'bg-amber-500 text-zinc-950'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Sequencer
                </button>
                <button
                  type="button"
                  onClick={() => onSelectLoopSource('taploop')}
                  aria-pressed={stemLoopSource === 'taploop'}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    stemLoopSource === 'taploop'
                      ? 'bg-emerald-500 text-zinc-950'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Tap Loop
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (phoneLoopFileName) {
                      onSelectLoopSource('phone_audio');
                    } else {
                      phoneFileInputRef.current?.click();
                    }
                  }}
                  aria-pressed={stemLoopSource === 'phone_audio'}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    stemLoopSource === 'phone_audio'
                      ? 'bg-sky-400 text-zinc-950'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Phone Loop
                </button>
              </div>

              <button
                type="button"
                disabled={isUploadingPhoneLoop}
                onClick={() => phoneFileInputRef.current?.click()}
                className="flex h-7 items-center gap-1 rounded-md border border-[#3C4958] bg-[#1E252E] px-2.5 text-[11px] font-semibold text-zinc-100 hover:border-sky-400/60 hover:text-sky-300 disabled:opacity-60 whitespace-nowrap"
              >
                <Upload className="h-3 w-3" />
                <span>
                  {isUploadingPhoneLoop
                    ? 'Loading...'
                    : phoneLoopFileName
                    ? 'Replace Phone Audio'
                    : 'Upload Phone Audio'}
                </span>
              </button>

              {phoneLoopFileName && (
                <button
                  type="button"
                  onClick={onClearPhoneLoopFile}
                  aria-label="Remove phone loop"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[#34404E] bg-[#13181E] text-zinc-400 hover:border-rose-500/40 hover:text-rose-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onToggleLoopSolo}
                aria-pressed={stemLoopSoloed}
                className={`h-7 rounded-md border px-2.5 text-[11px] font-bold transition-colors whitespace-nowrap ${
                  stemLoopSoloed
                    ? 'border-amber-400 bg-amber-500 text-zinc-950'
                    : 'border-[#34404E] bg-[#13181E] text-zinc-300 hover:text-white'
                }`}
              >
                {stemLoopSoloed ? 'Hear Only: On' : 'Hear Only'}
              </button>
              <button
                type="button"
                onClick={onToggleLoopMuted}
                aria-pressed={stemLoopMuted}
                className={`flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  stemLoopMuted
                    ? 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                    : 'border-[#34404E] bg-[#13181E] text-zinc-300'
                }`}
              >
                {stemLoopMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                <span>{stemLoopMuted ? 'Muted' : 'Active'}</span>
              </button>
              <div className="flex items-center gap-1.5">
                <input
                  type="range"
                  min={-60}
                  max={6}
                  step={0.5}
                  value={stemLoopVolumeDb}
                  onChange={(e) => onLoopVolumeChange(Number(e.target.value))}
                  aria-label="Row 1 loop volume"
                  className="studio-slider w-20"
                />
                <span className="font-mono-tabular w-11 text-right text-[11px] text-zinc-400">
                  {formatVolumeDb(stemLoopVolumeDb)}
                </span>
              </div>
            </div>
          </div>
        ) : selectedChannel ? (
          (() => {
            const isRowHumming = hummingChannelId === selectedChannel.id;
            const isRowPlayingHum = playingHumChannelId === selectedChannel.id;
            const rowIndex = stemChannels.findIndex((c) => c.id === selectedChannel.id) + 2;
            const accent = CHANNEL_ACCENT[selectedChannel.color];

            return (
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`font-mono-tabular rounded px-2 py-0.5 text-[10px] font-bold text-white ${accent.flClipBar}`}
                  >
                    TRACK {String(rowIndex).padStart(2, '0')}
                  </span>
                  <span className="text-xs font-bold text-zinc-100">
                    {selectedChannel.name.replace(/^Row \d+\s*·\s*/, '')}
                  </span>

                  {/* Hum to Row */}
                  <button
                    type="button"
                    onClick={() => {
                      if (isRowHumming) {
                        stopHumCapture();
                      } else {
                        void startHumCaptureForChannel(selectedChannel);
                      }
                    }}
                    aria-label={
                      isRowHumming
                        ? `Stop hum recording on ${selectedChannel.name}`
                        : `Hum to ${selectedChannel.name}`
                    }
                    className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-bold transition-colors whitespace-nowrap ${
                      isRowHumming
                        ? 'bg-rose-500 text-white hover:bg-rose-400'
                        : 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
                    }`}
                  >
                    {isRowHumming ? (
                      <>
                        <MicOff className="h-3.5 w-3.5" />
                        <span>
                          Stop Hum
                          {liveHumMidi !== null ? ` (${midiToNoteName(liveHumMidi)})` : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <Mic className="h-3.5 w-3.5" />
                        <span>Hum to Row</span>
                      </>
                    )}
                  </button>

                  {selectedChannel.hasHumAudio && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleTogglePlayHumPreview(selectedChannel.id)}
                        className={`flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                          isRowPlayingHum
                            ? 'border-sky-400 bg-sky-400 text-zinc-950'
                            : 'border-[#34404E] bg-[#13181E] text-sky-300 hover:border-sky-400/50'
                        }`}
                      >
                        {isRowPlayingHum ? (
                          <Square className="h-3 w-3 fill-current" />
                        ) : (
                          <Play className="h-3 w-3 fill-current" />
                        )}
                        <span>{isRowPlayingHum ? 'Stop Hum' : 'Play Hum'}</span>
                      </button>

                      <div className="flex h-8 items-center rounded-md border border-[#34404E] bg-[#11161C] p-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            onChannelVoiceModeChange(selectedChannel.id, 'hum_audio')
                          }
                          className={`h-7 rounded px-2 text-[11px] font-semibold whitespace-nowrap ${
                            selectedChannel.voiceMode === 'hum_audio'
                              ? 'bg-sky-400 text-zinc-950'
                              : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          Raw Hum
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onChannelVoiceModeChange(
                              selectedChannel.id,
                              selectedChannel.customVoiceSample
                                ? 'custom_sample'
                                : 'keyboard'
                            )
                          }
                          className={`h-7 rounded px-2 text-[11px] font-semibold whitespace-nowrap ${
                            selectedChannel.voiceMode !== 'hum_audio'
                              ? 'bg-amber-500 text-zinc-950'
                              : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          Synth / Keys
                        </button>
                      </div>
                    </>
                  )}

                  {/* Built-in Keyboard Voice Picker */}
                  <select
                    aria-label={`Voice for ${selectedChannel.name}`}
                    value={
                      selectedChannel.voiceMode === 'custom_sample'
                        ? '__custom__'
                        : selectedChannel.soundId
                    }
                    onChange={(e) => {
                      if (e.target.value !== '__custom__') {
                        onChannelSoundChange(
                          selectedChannel.id,
                          e.target.value as KeyboardSoundId
                        );
                      }
                    }}
                    className="h-8 min-w-[140px] rounded-md border border-[#34404E] bg-[#13181E] px-2.5 text-xs font-semibold text-zinc-100 focus:border-amber-500 focus:outline-none"
                  >
                    {KEYBOARD_SOUND_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                    {selectedChannel.customVoiceSample && (
                      <option value="__custom__">
                        API: {selectedChannel.customVoiceSample.name}
                      </option>
                    )}
                  </select>

                  {/* Browse Freesound & Secondary API Voices */}
                  <button
                    type="button"
                    onClick={() => setVoiceBrowserChannelId(selectedChannel.id)}
                    aria-label={`Browse voices and API sounds for ${selectedChannel.name}`}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-[#3C4958] bg-[#1E252E] px-2.5 text-xs font-semibold text-zinc-100 hover:border-emerald-500/50 hover:text-emerald-300 whitespace-nowrap"
                  >
                    <Search className="h-3.5 w-3.5" />
                    <span>Browse Voices</span>
                  </button>
                </div>

                {/* Right Controls: Solo / Mute / Volume / Delete */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onChannelSoloToggle(selectedChannel.id)}
                    aria-pressed={selectedChannel.soloed}
                    className={`h-8 rounded-md border px-2.5 text-xs font-bold transition-colors whitespace-nowrap ${
                      selectedChannel.soloed
                        ? 'border-amber-400 bg-amber-500 text-zinc-950'
                        : 'border-[#34404E] bg-[#13181E] text-zinc-300 hover:text-white'
                    }`}
                  >
                    {selectedChannel.soloed ? 'Hear Only: On' : 'Hear Only'}
                  </button>

                  <button
                    type="button"
                    onClick={() => onChannelMuteToggle(selectedChannel.id)}
                    aria-pressed={selectedChannel.muted}
                    className={`h-8 rounded-md border px-2.5 text-xs font-bold transition-colors ${
                      selectedChannel.muted
                        ? 'border-rose-500/60 bg-rose-500/20 text-rose-300'
                        : 'border-[#34404E] bg-[#13181E] text-zinc-300'
                    }`}
                  >
                    {selectedChannel.muted ? 'Muted' : 'Mute'}
                  </button>

                  <div className="flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 text-zinc-400" />
                    <input
                      type="range"
                      min={-60}
                      max={6}
                      step={0.5}
                      value={selectedChannel.volume_db}
                      onChange={(e) =>
                        onChannelVolumeChange(selectedChannel.id, Number(e.target.value))
                      }
                      aria-label={`${selectedChannel.name} volume`}
                      className="studio-slider w-20"
                    />
                    <span className="font-mono-tabular w-11 text-right text-[11px] text-zinc-400">
                      {formatVolumeDb(selectedChannel.volume_db)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (isRowHumming) stopHumCapture();
                      onRemoveChannel(selectedChannel.id);
                    }}
                    aria-label={`Delete ${selectedChannel.name}`}
                    title={`Delete ${selectedChannel.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-[#34404E] bg-[#13181E] text-zinc-400 transition-colors hover:border-rose-500/40 hover:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })()
        ) : null}
      </section>

      {/* SECTION 2: LOWER DOCKED PIANO ROLL + 2-OCTAVE KEYBOARD ROW */}
      {(desktopViewMode !== 'playlist' || mobilePane === 'pianoroll') && (
        <div
          className={`space-y-3 ${
            mobilePane === 'pianoroll' ? 'block' : 'hidden'
          } ${desktopViewMode === 'playlist' ? 'lg:hidden' : 'lg:block'}`}
        >
          {selectedChannel ? (
            <>
              <section
                aria-label="Piano Roll Sequence Editor"
                className="rounded-xl border border-[#2F3A47] bg-[#161C24] p-3 sm:p-4"
              >
                {/* Piano Roll Header Controls */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        CHANNEL_ACCENT[selectedChannel.color].dot
                      }`}
                    />
                    <h2 className="text-xs font-bold tracking-wide text-zinc-100 uppercase">
                      Piano Roll · {selectedChannel.name}
                    </h2>
                    <span className="text-xs text-zinc-400">
                      · {activeVoiceDisplayLabel}
                    </span>
                    {selectedChannel.hasHumAudio && (
                      <button
                        type="button"
                        onClick={() => {
                          setHumPeaksByChannel((prev) => {
                            const next = { ...prev };
                            delete next[selectedChannel.id];
                            return next;
                          });
                          onClearHumAudio(selectedChannel.id);
                        }}
                        className="rounded border border-[#34404E] bg-[#11161C] px-2 py-0.5 text-[10px] font-semibold text-zinc-400 hover:border-rose-500/40 hover:text-rose-300"
                      >
                        Clear Hum
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <div
                      role="group"
                      aria-label="Piano Roll bar selector"
                      className="flex items-center gap-0.5 rounded-md border border-[#34404E] bg-[#11161C] p-0.5"
                    >
                      {Array.from({ length: loopBars }).map((_, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => onSelectBar(idx)}
                          className={`rounded px-2 py-1 font-mono-tabular text-[11px] font-semibold ${
                            barOffset === idx
                              ? 'bg-amber-500 text-zinc-950'
                              : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          B{idx + 1}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={onToggleFollowPlayhead}
                      aria-pressed={followPlayhead}
                      className={`h-7 rounded-md border px-2 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                        followPlayhead
                          ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300'
                          : 'border-[#34404E] bg-[#11161C] text-zinc-400'
                      }`}
                    >
                      Follow
                    </button>

                    <div className="flex items-center gap-0.5 rounded-md border border-[#34404E] bg-[#11161C] p-0.5">
                      {[
                        { steps: 1, label: '1/16' },
                        { steps: 2, label: '1/8' },
                        { steps: 4, label: '1/4' },
                      ].map((opt) => (
                        <button
                          key={opt.steps}
                          type="button"
                          onClick={() => setNoteDurationSteps(opt.steps)}
                          className={`rounded px-1.5 py-1 font-mono-tabular text-[10px] font-semibold ${
                            noteDurationSteps === opt.steps
                              ? 'bg-[#26303D] text-amber-300'
                              : 'text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowGhostNotes((v) => !v)}
                      aria-pressed={showGhostNotes}
                      className={`h-7 rounded-md border px-2 text-[11px] font-semibold whitespace-nowrap ${
                        showGhostNotes
                          ? 'border-sky-500/45 bg-sky-500/15 text-sky-300'
                          : 'border-[#34404E] bg-[#11161C] text-zinc-400'
                      }`}
                    >
                      Ghost
                    </button>

                    <button
                      type="button"
                      onClick={() => handleFitRollToChannel(selectedChannel)}
                      className="flex h-7 items-center gap-1 rounded-md border border-[#34404E] bg-[#11161C] px-2 text-[11px] font-semibold text-zinc-300 hover:text-white whitespace-nowrap"
                      title="Center Piano Roll on this row's notes"
                    >
                      <Sparkles className="h-3 w-3 text-amber-400" />
                      <span>Fit</span>
                    </button>

                    <div className="flex items-center rounded-md border border-[#34404E] bg-[#11161C] p-0.5">
                      <button
                        type="button"
                        onClick={() => setRollTopMidi((m) => clampMidi(m - 4))}
                        aria-label="Scroll Piano Roll down"
                        className="flex h-6 w-6 items-center justify-center rounded text-zinc-300 hover:bg-[#242C36]"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRollTopMidi((m) => clampMidi(m + 4))}
                        aria-label="Scroll Piano Roll up"
                        className="flex h-6 w-6 items-center justify-center rounded text-zinc-300 hover:bg-[#242C36]"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => onClearChannelNotes(selectedChannel.id)}
                      className="h-7 rounded-md border border-[#34404E] bg-[#11161C] px-2 text-[11px] font-semibold text-zinc-400 hover:border-rose-500/40 hover:text-rose-300 whitespace-nowrap"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* Piano Roll Grid */}
                <div className="overflow-x-auto rounded-lg border border-[#2F3A47] bg-[#131921]">
                  <div className="min-w-[520px]">
                    <div className="grid grid-cols-[58px_1fr] border-b border-[#2F3A47] bg-[#10151B]">
                      <div className="flex items-center justify-center border-r border-[#2F3A47] px-1 py-1 font-mono-tabular text-[10px] font-semibold text-zinc-500">
                        PITCH
                      </div>
                      <div className="grid grid-cols-16">
                        {Array.from({ length: 16 }).map((_, col) => {
                          const globalStep = barStartStep + col;
                          const isActiveStep = isPlaying && currentStep === globalStep;
                          const isBeatStart = col % 4 === 0;
                          return (
                            <div
                              key={col}
                              className={`border-r border-[#27313D] py-1 text-center font-mono-tabular text-[10px] ${
                                isActiveStep
                                  ? 'bg-amber-500 font-bold text-zinc-950'
                                  : isBeatStart
                                  ? 'font-bold text-zinc-200'
                                  : 'text-zinc-500'
                              }`}
                            >
                              {isBeatStart ? `${barOffset + 1}.${col / 4 + 1}` : '·'}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="divide-y divide-[#1E2630]">
                      {visiblePitchMidis.map((midi) => {
                        const noteName = midiToNoteName(midi);
                        const isBlack = isBlackKeyMidi(midi);
                        const inScale = isMidiInScale(midi, rootKey, scaleType);
                        const isRoot = ((midi % 12) + 12) % 12 === rootPc;

                        const rowNotes = selectedChannel.notes.filter(
                          (n) =>
                            n.midi === midi &&
                            n.step >= barStartStep &&
                            n.step < barStartStep + 16
                        );

                        const ghostRowNotes = showGhostNotes
                          ? stemChannels
                              .filter((other) => other.id !== selectedChannel.id && !other.muted)
                              .flatMap((other) =>
                                other.notes.filter(
                                  (n) =>
                                    n.midi === midi &&
                                    n.step >= barStartStep &&
                                    n.step < barStartStep + 16
                                )
                              )
                          : [];

                        return (
                          <div key={midi} className="grid h-[21px] grid-cols-[58px_1fr]">
                            <button
                              type="button"
                              onClick={() => onPlayKeyboardKey(midi, false)}
                              className={`flex items-center justify-between border-r border-[#2F3A47] px-2 font-mono-tabular text-[10px] font-semibold transition-colors ${
                                isBlack
                                  ? 'bg-[#10151C] text-zinc-500 hover:bg-[#1A212B]'
                                  : 'bg-[#1A222C] text-zinc-300 hover:bg-[#242F3D]'
                              }`}
                              title={`Audition ${noteName}`}
                            >
                              <span>{noteName}</span>
                              {inScale && (
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    isRoot ? 'bg-amber-400' : 'bg-emerald-500/70'
                                  }`}
                                />
                              )}
                            </button>

                            <div className="relative grid grid-cols-16">
                              {Array.from({ length: 16 }).map((_, col) => {
                                const globalStep = barStartStep + col;
                                const isBeatBorder = col % 4 === 0 && col > 0;
                                const isPlayhead = isPlaying && currentStep === globalStep;
                                return (
                                  <button
                                    key={col}
                                    type="button"
                                    aria-label={`Toggle ${noteName} at step ${globalStep + 1}`}
                                    onClick={() =>
                                      onToggleNote(
                                        selectedChannel.id,
                                        globalStep,
                                        midi,
                                        noteDurationSteps
                                      )
                                    }
                                    className={`h-full border-r border-[#232C37] transition-colors hover:bg-amber-500/15 ${
                                      isBeatBorder ? 'border-l border-l-[#344150]' : ''
                                    } ${
                                      isPlayhead
                                        ? 'bg-amber-500/15'
                                        : isBlack
                                        ? 'bg-[#131921]'
                                        : inScale
                                        ? 'bg-[#19212B]'
                                        : 'bg-[#141B23]'
                                    }`}
                                  />
                                );
                              })}

                              {ghostRowNotes.map((gn, gIdx) => {
                                const colOffset = gn.step - barStartStep;
                                const spanCols = Math.min(16 - colOffset, gn.durationSteps);
                                return (
                                  <span
                                    key={`ghost-${gn.step}-${gIdx}`}
                                    style={{
                                      left: `${(colOffset / 16) * 100}%`,
                                      width: `${(spanCols / 16) * 100}%`,
                                    }}
                                    className="pointer-events-none absolute top-1 bottom-1 rounded border border-zinc-500/35 bg-zinc-500/20"
                                  />
                                );
                              })}

                              {rowNotes.map((note, nIdx) => {
                                const colOffset = note.step - barStartStep;
                                const spanCols = Math.min(16 - colOffset, note.durationSteps);
                                const accent = CHANNEL_ACCENT[selectedChannel.color];
                                return (
                                  <button
                                    key={`note-${note.step}-${nIdx}`}
                                    type="button"
                                    onClick={() =>
                                      onToggleNote(
                                        selectedChannel.id,
                                        note.step,
                                        note.midi,
                                        note.durationSteps
                                      )
                                    }
                                    style={{
                                      left: `${(colOffset / 16) * 100}%`,
                                      width: `${(spanCols / 16) * 100}%`,
                                    }}
                                    className={`absolute top-0.5 bottom-0.5 z-10 flex items-center justify-between rounded border px-1 font-mono-tabular text-[9px] font-bold shadow-sm ${
                                      !inScale
                                        ? 'border-rose-200 bg-rose-500 text-white'
                                        : accent.noteBg
                                    }`}
                                    title={
                                      !inScale
                                        ? `${noteName} is off-key for ${rootKey} ${scaleType}. Click Fix Off-Key or tap to remove.`
                                        : `${noteName} · Click to remove`
                                    }
                                  >
                                    <span className="truncate">{noteName}</span>
                                    {!inScale && <span>!</span>}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>

              {/* Playable Piano Keyboard Row Docked Below Piano Roll */}
              <PianoKeyboardRow
                baseOctave={baseOctave}
                onBaseOctaveChange={(oct) => {
                  setBaseOctave(oct);
                  setRollTopMidi(clampMidi((oct + 2) * 12 + 2));
                }}
                rootKey={rootKey}
                scaleType={scaleType}
                soundLabel={activeVoiceDisplayLabel}
                punchInRecord={punchInRecord}
                onTogglePunchIn={() => setPunchInRecord((v) => !v)}
                activePlayingMidis={activePlayingMidis}
                onPlayKey={(midi) => onPlayKeyboardKey(midi, punchInRecord)}
              />
            </>
          ) : (
            <section
              aria-label="Empty Stem Workspace"
              className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-[#2F3A47] bg-[#161C24] p-6 text-center"
            >
              <Music2 className="mb-2.5 h-8 w-8 text-zinc-600" />
              <h2 className="text-sm font-bold text-zinc-200">
                No Melodic Stem Tracks
              </h2>
              <p className="mt-1 max-w-sm text-xs text-zinc-400">
                Add a melodic or vocal stem track to hum melodies, edit piano roll notes, or layer instruments over Track 01.
              </p>
              <button
                type="button"
                onClick={() => {
                  setInspectorTarget('channel');
                  onAddChannel();
                }}
                className="mt-4 flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 text-xs font-bold text-zinc-950 transition-colors hover:bg-amber-400"
              >
                <Plus className="h-4 w-4" />
                <span>Add Row</span>
              </button>
            </section>
          )}
        </div>
      )}

      {/* Voice & Dual-API Sound Browser Modal */}
      <StemVoiceBrowserModal
        isOpen={voiceBrowserTarget !== null}
        targetChannel={voiceBrowserTarget}
        freesoundKey={freesoundKey}
        secondarySoundConfigured={secondarySoundConfigured}
        secondarySoundProvider={secondarySoundProvider}
        onSelectKeyboardVoice={onChannelSoundChange}
        onSelectCustomSampleVoice={onChannelCustomSampleChange}
        onAuditionKeyboardVoice={onAuditionKeyboardVoice}
        onOpenFreesoundKeyModal={() => {
          setVoiceBrowserChannelId(null);
          onOpenFreesoundKeyModal();
        }}
        onClose={() => setVoiceBrowserChannelId(null)}
      />
    </div>
  );
};
