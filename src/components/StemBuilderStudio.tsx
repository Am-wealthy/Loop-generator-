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
  { border: string; bg: string; noteBg: string; dot: string }
> = {
  amber: {
    border: 'border-amber-500/50',
    bg: 'bg-amber-500/8',
    noteBg: 'bg-amber-400 text-zinc-950 border-amber-200',
    dot: 'bg-amber-400',
  },
  emerald: {
    border: 'border-emerald-500/50',
    bg: 'bg-emerald-500/8',
    noteBg: 'bg-emerald-400 text-zinc-950 border-emerald-200',
    dot: 'bg-emerald-400',
  },
  sky: {
    border: 'border-sky-500/50',
    bg: 'bg-sky-500/8',
    noteBg: 'bg-sky-400 text-zinc-950 border-sky-200',
    dot: 'bg-sky-400',
  },
  violet: {
    border: 'border-violet-500/50',
    bg: 'bg-violet-500/8',
    noteBg: 'bg-violet-400 text-zinc-950 border-violet-200',
    dot: 'bg-violet-400',
  },
  rose: {
    border: 'border-rose-500/50',
    bg: 'bg-rose-500/8',
    noteBg: 'bg-rose-400 text-zinc-950 border-rose-200',
    dot: 'bg-rose-400',
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

  return (
    <div className="space-y-3.5">
      {/* Hidden input for uploading Phone Audio Loop into Row 1 */}
      <input
        ref={phoneFileInputRef}
        type="file"
        accept="audio/*,video/mp4,.mp3,.wav,.m4a,.mp4,.aac,.ogg,.opus,.flac,.webm,.3gp,.amr"
        className="hidden"
        onChange={(e) => void handlePhoneLoopFileChange(e)}
      />

      {/* Compact Unified Studio Command Bar */}
      <section className="rounded-xl border border-zinc-800 bg-[#111114] px-3.5 py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Studio Title + Key/Scale + Undo/Redo Traverse Arrows */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 pr-1">
              <Layers className="h-4 w-4 text-amber-400" />
              <h1 className="font-display text-sm font-bold tracking-tight text-zinc-100 sm:text-base">
                Stem Studio
              </h1>
            </div>

            {/* Key & Scale */}
            <div className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5">
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
              <span className="text-zinc-700" aria-hidden="true">/</span>
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
              className="flex h-8 items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5"
            >
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo}
                aria-label="Undo previous change"
                title="Previous step (Ctrl+Z)"
                className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Prev</span>
              </button>
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo}
                aria-label="Redo forward change"
                title="Forward step (Ctrl+Shift+Z)"
                className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <span className="hidden sm:inline">Next</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Right: Active Row Correction & Hum Capture */}
          <div className="flex flex-wrap items-center gap-2">
            {selectedChannel && (
              <>
                <button
                  type="button"
                  onClick={() => onFixOffKeyNotes(selectedChannel.id)}
                  className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    offKeyCountOnSelected > 0
                      ? 'border-rose-500/50 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                      : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
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

                <div className="flex h-8 items-center rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
                  <button
                    type="button"
                    onClick={() => onTransposeChannel(selectedChannel.id, -1)}
                    className="h-7 rounded px-2 font-mono-tabular text-[11px] font-semibold text-zinc-300 hover:bg-zinc-800"
                    title="Transpose selected row down 1 semitone"
                  >
                    -1 st
                  </button>
                  <button
                    type="button"
                    onClick={() => onTransposeChannel(selectedChannel.id, 1)}
                    className="h-7 rounded px-2 font-mono-tabular text-[11px] font-semibold text-zinc-300 hover:bg-zinc-800"
                    title="Transpose selected row up 1 semitone"
                  >
                    +1 st
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {(humStatusText || humError || phoneUploadError || hummingChannelId) && (
          <div
            role={humError || phoneUploadError ? 'alert' : 'status'}
            className={`mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs ${
              humError || phoneUploadError
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
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
        className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-[#111114] p-1 lg:hidden"
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
          Channel Rack (All Sequences)
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

      {/* MAIN 2-PANE SPLIT WORKSPACE */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        {/* LEFT PANE: FL-Studio Style Unified Channel Rack (All Sequences Visible) */}
        <section
          aria-label="Channel Rack — All Sequences"
          className={`rounded-xl border border-zinc-800 bg-[#111114] p-3.5 sm:p-4 lg:col-span-5 ${
            mobilePane === 'rack' ? 'block' : 'hidden lg:block'
          }`}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Music2 className="h-4 w-4 text-amber-400" />
              <h2 className="text-xs font-bold tracking-wide text-zinc-100 uppercase">
                Channel Rack · {stemChannels.length + 1} Rows
              </h2>
            </div>

            <button
              type="button"
              onClick={onAddChannel}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 text-xs font-semibold text-zinc-100 transition-colors hover:border-amber-500/50 hover:text-amber-300 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Row</span>
            </button>
          </div>

          <div className="space-y-2.5">
            {/* ROW 1: Master Loop Bed (App Sequencer, App Tap Loop, OR Phone Audio Upload) */}
            <div
              data-testid="stem-row-01"
              className={`rounded-lg border p-3 transition-colors ${
                stemLoopSoloed
                  ? 'border-amber-500/60 bg-amber-500/10'
                  : 'border-zinc-800 bg-zinc-950/90'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={onToggleLoopSolo}
                  aria-label={`Click to hear only Row 1 loop`}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="font-mono-tabular flex h-6 w-6 shrink-0 items-center justify-center rounded bg-amber-500/20 text-[10px] font-bold text-amber-300">
                    01
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-zinc-100">
                      {stemLoopSource === 'phone_audio'
                        ? phoneLoopFileName || 'Phone Audio Loop'
                        : stemLoopSource === 'taploop'
                        ? 'Website Tap Loop'
                        : 'Website Sequencer Loop'}
                    </div>
                    <div className="font-mono-tabular text-[10px] text-zinc-400">
                      {stemLoopSoloed ? 'Hearing Only · ' : ''}
                      {stemLoopSource === 'phone_audio'
                        ? phoneLoopFileName
                          ? `${Math.round(phoneLoopDurationSec)}s phone loop`
                          : 'Choose an audio file from your phone'
                        : `${activeLoopElementsCount} layers · ${loopBars}B · ${bpm} BPM`}
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onToggleLoopSolo}
                    aria-pressed={stemLoopSoloed}
                    aria-label={stemLoopSoloed ? 'Stop hearing only Row 1' : 'Hear only Row 1 loop'}
                    className={`flex h-7 items-center gap-1 rounded border px-2 text-[10px] font-bold transition-colors whitespace-nowrap ${
                      stemLoopSoloed
                        ? 'border-amber-400 bg-amber-500 text-zinc-950'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-amber-500/50 hover:text-amber-300'
                    }`}
                  >
                    <span>{stemLoopSoloed ? 'Only On' : 'Hear Only'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={onToggleLoopMuted}
                    aria-pressed={stemLoopMuted}
                    aria-label={stemLoopMuted ? 'Unmute Row 1 loop' : 'Mute Row 1 loop'}
                    className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
                      stemLoopMuted
                        ? 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white'
                    }`}
                  >
                    {stemLoopMuted ? (
                      <VolumeX className="h-3.5 w-3.5" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <div className="flex items-center gap-1">
                    <input
                      type="range"
                      min={-60}
                      max={6}
                      step={0.5}
                      value={stemLoopVolumeDb}
                      onChange={(e) => onLoopVolumeChange(Number(e.target.value))}
                      aria-label="Row 1 loop volume"
                      className="studio-slider w-14 sm:w-16"
                    />
                    <span className="font-mono-tabular w-11 text-right text-[10px] text-zinc-400">
                      {formatVolumeDb(stemLoopVolumeDb)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Row 1 Source Switcher: Website Loop vs Phone Audio */}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <div
                  role="group"
                  aria-label="Row 1 loop source"
                  className="grid min-w-0 basis-full grid-cols-3 gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900/70 p-0.5 sm:basis-auto sm:flex-1"
                >
                  <button
                    type="button"
                    onClick={() => onSelectLoopSource('sequencer')}
                    aria-pressed={stemLoopSource === 'sequencer'}
                    className={`truncate rounded-md px-1.5 py-1 text-[10px] font-semibold transition-colors sm:px-2 sm:text-[11px] ${
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
                    className={`truncate rounded-md px-1.5 py-1 text-[10px] font-semibold transition-colors sm:px-2 sm:text-[11px] ${
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
                    className={`truncate rounded-md px-1.5 py-1 text-[10px] font-semibold transition-colors sm:px-2 sm:text-[11px] ${
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
                  className="flex h-7 items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 text-[11px] font-semibold text-zinc-200 hover:border-sky-400/50 hover:text-sky-300 disabled:opacity-60 whitespace-nowrap"
                >
                  <Upload className="h-3 w-3" />
                  <span>
                    {isUploadingPhoneLoop
                      ? 'Loading...'
                      : phoneLoopFileName
                      ? 'Replace'
                      : 'Upload'}
                  </span>
                </button>

                {phoneLoopFileName && (
                  <button
                    type="button"
                    onClick={onClearPhoneLoopFile}
                    aria-label="Remove phone loop"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-rose-500/40 hover:text-rose-300"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Row 1 64-Step / Waveform Strip */}
              <div
                aria-label="Row 1 loop sequence overview"
                className="mt-2.5 grid h-7 grid-cols-16 gap-px rounded border border-zinc-800/80 bg-zinc-900/60 p-1"
              >
                {stemLoopSource === 'phone_audio' && phoneLoopPeaks.length > 0
                  ? Array.from({ length: 16 }).map((_, groupIdx) => {
                      const peakSlice = phoneLoopPeaks.slice(groupIdx * 3, groupIdx * 3 + 3);
                      const isPlayheadHere =
                        isPlaying &&
                        currentStep >= groupIdx * 4 &&
                        currentStep < groupIdx * 4 + 4;
                      return (
                        <div
                          key={groupIdx}
                          className={`flex items-center gap-px px-px ${
                            isPlayheadHere ? 'bg-sky-400/20' : ''
                          }`}
                        >
                          {peakSlice.map((pk, subIdx) => (
                            <div
                              key={subIdx}
                              style={{ height: `${Math.max(18, Math.round(pk * 100))}%` }}
                              className={`flex-1 rounded-xs ${
                                stemLoopMuted ? 'bg-zinc-600' : 'bg-sky-400/85'
                              }`}
                            />
                          ))}
                        </div>
                      );
                    })
                  : Array.from({ length: 16 }).map((_, groupIdx) => {
                      const start = groupIdx * 4;
                      const slice = loopBedStepCounts.slice(start, start + 4);
                      const maxHits = Math.max(0, ...slice);
                      const inActiveRange = start < activeStepsCount;
                      const isPlayheadHere =
                        currentStep >= start && currentStep < start + 4 && isPlaying;
                      return (
                        <div
                          key={groupIdx}
                          className={`flex items-end gap-px rounded-xs px-px ${
                            groupIdx % 4 === 0 ? 'border-l border-zinc-700/80' : ''
                          } ${!inActiveRange ? 'opacity-25' : ''} ${
                            isPlayheadHere ? 'bg-amber-500/20' : ''
                          }`}
                        >
                          {slice.map((cnt, subIdx) => (
                            <div
                              key={subIdx}
                              style={{
                                height:
                                  cnt > 0 ? `${Math.min(100, 28 + cnt * 18)}%` : '14%',
                              }}
                              className={`flex-1 rounded-xs ${
                                cnt > 0
                                  ? stemLoopMuted
                                    ? 'bg-zinc-600'
                                    : maxHits > 1
                                    ? 'bg-amber-400'
                                    : 'bg-emerald-400/80'
                                  : 'bg-zinc-800/70'
                              }`}
                            />
                          ))}
                        </div>
                      );
                    })}
              </div>
            </div>

            {/* ROWS 2, 3, 4...: Melodic / Hum Stem Rows inside the same Channel Rack */}
            {stemChannels.map((ch, idx) => {
              const rowNumber = String(idx + 2).padStart(2, '0');
              const isSelected = selectedChannel?.id === ch.id;
              const isRowHumming = hummingChannelId === ch.id;
              const isRowPlayingHum = playingHumChannelId === ch.id;
              const accent = CHANNEL_ACCENT[ch.color];
              const channelOffKeyCount = ch.notes.filter(
                (n) => !isMidiInScale(n.midi, rootKey, scaleType)
              ).length;

              return (
                <div
                  key={ch.id}
                  data-testid={`stem-row-${rowNumber}`}
                  className={`rounded-lg border p-3 transition-colors ${
                    isSelected
                      ? `${accent.border} ${accent.bg}`
                      : 'border-zinc-800/90 bg-zinc-950/75 hover:border-zinc-700'
                  }`}
                >
                  {/* Row Header: Select Button + S/M/Delete */}
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectChannel(ch.id);
                        handleFitRollToChannel(ch);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className={`font-mono-tabular flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold text-zinc-950 ${accent.dot}`}
                      >
                        {rowNumber}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-bold text-zinc-100">
                            {ch.name}
                          </span>
                          {channelOffKeyCount > 0 && (
                            <span className="font-mono-tabular text-[10px] font-semibold text-rose-400">
                              · {channelOffKeyCount} off-key
                            </span>
                          )}
                        </div>
                        <div className="font-mono-tabular text-[10px] text-zinc-400">
                          {ch.notes.length} notes
                          {ch.hasHumAudio ? ' · Hum recorded' : ''}
                          {ch.voiceMode === 'custom_sample' && ch.customVoiceSample
                            ? ` · ${ch.customVoiceSample.name}`
                            : ''}
                        </div>
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectChannel(ch.id);
                          handleFitRollToChannel(ch);
                          onChannelSoloToggle(ch.id);
                        }}
                        aria-pressed={ch.soloed}
                        aria-label={
                          ch.soloed ? `Stop hearing only ${ch.name}` : `Hear only ${ch.name}`
                        }
                        className={`h-7 rounded border px-2 text-[10px] font-bold transition-colors whitespace-nowrap ${
                          ch.soloed
                            ? 'border-amber-400 bg-amber-500 text-zinc-950'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-amber-500/50 hover:text-amber-300'
                        }`}
                      >
                        {ch.soloed ? 'Only On' : 'Hear Only'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onChannelMuteToggle(ch.id)}
                        aria-pressed={ch.muted}
                        aria-label={`Mute ${ch.name}`}
                        className={`h-7 w-7 rounded border font-mono-tabular text-[10px] font-bold transition-colors ${
                          ch.muted
                            ? 'border-rose-500/60 bg-rose-500/20 text-rose-300'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        M
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (isRowHumming) {
                            stopHumCapture();
                          }
                          onRemoveChannel(ch.id);
                        }}
                        aria-label={`Delete ${ch.name}`}
                        title={`Delete ${ch.name}`}
                        className="flex h-7 w-7 items-center justify-center rounded border border-zinc-800 bg-zinc-900 text-zinc-400 transition-colors hover:border-rose-500/40 hover:text-rose-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {/* Row Actions: Hum to Row, Play Hum, Voice Selector, Browse API Voices, Volume */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
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
                      className={`flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-bold transition-colors whitespace-nowrap ${
                        isRowHumming
                          ? 'bg-rose-500 text-white hover:bg-rose-400'
                          : 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
                      }`}
                    >
                      {isRowHumming ? (
                        <>
                          <MicOff className="h-3 w-3" />
                          <span>
                            Stop Hum
                            {liveHumMidi !== null ? ` (${midiToNoteName(liveHumMidi)})` : ''}
                          </span>
                        </>
                      ) : (
                        <>
                          <Mic className="h-3 w-3" />
                          <span>Hum to Row</span>
                        </>
                      )}
                    </button>

                    {ch.hasHumAudio && (
                      <button
                        type="button"
                        onClick={() => void handleTogglePlayHumPreview(ch.id)}
                        className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                          isRowPlayingHum
                            ? 'border-sky-400 bg-sky-400 text-zinc-950'
                            : 'border-zinc-700 bg-zinc-900 text-sky-300 hover:border-sky-400/50'
                        }`}
                      >
                        {isRowPlayingHum ? (
                          <Square className="h-2.5 w-2.5 fill-current" />
                        ) : (
                          <Play className="h-2.5 w-2.5 fill-current" />
                        )}
                        <span>{isRowPlayingHum ? 'Stop Hum' : 'Play Hum'}</span>
                      </button>
                    )}

                    <select
                      aria-label={`Voice for ${ch.name}`}
                      value={
                        ch.voiceMode === 'custom_sample' ? '__custom__' : ch.soundId
                      }
                      onChange={(e) => {
                        if (e.target.value !== '__custom__') {
                          onChannelSoundChange(ch.id, e.target.value as KeyboardSoundId);
                        }
                      }}
                      className="h-7 min-w-[115px] flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] font-semibold text-zinc-100 focus:border-amber-500 focus:outline-none"
                    >
                      {KEYBOARD_SOUND_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                      {ch.customVoiceSample && (
                        <option value="__custom__">
                          API: {ch.customVoiceSample.name}
                        </option>
                      )}
                    </select>

                    <button
                      type="button"
                      onClick={() => setVoiceBrowserChannelId(ch.id)}
                      aria-label={`Browse voices and API sounds for ${ch.name}`}
                      className="flex h-7 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[11px] font-semibold text-zinc-200 hover:border-emerald-500/50 hover:text-emerald-300 whitespace-nowrap"
                    >
                      <Search className="h-3 w-3" />
                      <span>Browse</span>
                    </button>

                    <div className="flex items-center gap-1">
                      <Volume2 className="h-3 w-3 shrink-0 text-zinc-400" />
                      <input
                        type="range"
                        min={-60}
                        max={6}
                        step={0.5}
                        value={ch.volume_db}
                        onChange={(e) =>
                          onChannelVolumeChange(ch.id, Number(e.target.value))
                        }
                        aria-label={`${ch.name} volume`}
                        className="studio-slider w-14 sm:w-16"
                      />
                      <span className="font-mono-tabular w-11 text-right text-[10px] text-zinc-400">
                        {formatVolumeDb(ch.volume_db)}
                      </span>
                    </div>
                  </div>

                  {/* Hum Audio vs Keyboard/Synth Voice Mode Switch (appears once hummed) */}
                  {ch.hasHumAudio && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-zinc-800/80 bg-zinc-900/60 px-2 py-1">
                      <span className="text-[10px] font-medium text-zinc-400">
                        Row Voice Mode:
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onChannelVoiceModeChange(ch.id, 'hum_audio')}
                          className={`rounded px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                            ch.voiceMode === 'hum_audio'
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
                              ch.id,
                              ch.customVoiceSample ? 'custom_sample' : 'keyboard'
                            )
                          }
                          className={`rounded px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                            ch.voiceMode !== 'hum_audio'
                              ? 'bg-amber-500 text-zinc-950'
                              : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          {ch.voiceMode === 'custom_sample' && ch.customVoiceSample
                            ? ch.customVoiceSample.name
                            : KEYBOARD_SOUND_PRESETS.find((p) => p.id === ch.soundId)
                                ?.shortLabel ?? 'Synth / Keys'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Full 64-step Mini Sequence Overview */}
                  <div
                    aria-label={`${ch.name} 64-step sequence`}
                    className="relative mt-2.5 h-10 w-full overflow-hidden rounded border border-zinc-800/80 bg-zinc-950"
                  >
                    {[1, 2, 3].map((b) => (
                      <div
                        key={b}
                        style={{ left: `${(b / 4) * 100}%` }}
                        className="pointer-events-none absolute inset-y-0 w-px bg-zinc-800"
                      />
                    ))}

                    <div
                      style={{
                        left: `${(barOffset / 4) * 100}%`,
                        width: '25%',
                      }}
                      className="pointer-events-none absolute inset-y-0 border-x border-amber-500/30 bg-amber-500/5"
                    />

                    {loopBars < 4 && (
                      <div
                        style={{
                          left: `${(loopBars / 4) * 100}%`,
                          width: `${((4 - loopBars) / 4) * 100}%`,
                        }}
                        className="pointer-events-none absolute inset-y-0 bg-zinc-950/75"
                      />
                    )}

                    {ch.notes.map((note, nIdx) => {
                      const leftPct = (note.step / 64) * 100;
                      const widthPct = Math.max(1.5, (note.durationSteps / 64) * 100);
                      const yPct = Math.max(
                        8,
                        Math.min(82, ((84 - note.midi) / 48) * 76 + 8)
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
                          className={`pointer-events-none absolute h-1.5 rounded-xs ${
                            !inKey
                              ? 'bg-rose-400'
                              : ch.muted
                              ? 'bg-zinc-600'
                              : accent.dot
                          }`}
                        />
                      );
                    })}

                    {isPlaying && currentStep >= 0 && (
                      <div
                        style={{ left: `${(currentStep / 64) * 100}%` }}
                        className="pointer-events-none absolute inset-y-0 w-0.5 bg-amber-400"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* RIGHT PANE: Interactive Piano Roll + Docked Keyboard Row */}
        {selectedChannel ? (
          <div
            className={`space-y-3.5 lg:col-span-7 ${
              mobilePane === 'pianoroll' ? 'block' : 'hidden lg:block'
            }`}
          >
            <section
              aria-label="Piano Roll Sequence Editor"
              className="rounded-xl border border-zinc-800 bg-[#111114] p-3.5 sm:p-4"
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
                      onClick={() => onClearHumAudio(selectedChannel.id)}
                      className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] font-semibold text-zinc-400 hover:border-rose-500/40 hover:text-rose-300"
                    >
                      Clear Hum
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <div
                    role="group"
                    aria-label="Piano Roll bar selector"
                    className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5"
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
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400'
                    }`}
                  >
                    Follow
                  </button>

                  <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
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
                            ? 'bg-zinc-800 text-amber-300'
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
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400'
                    }`}
                  >
                    Ghost
                  </button>

                  <button
                    type="button"
                    onClick={() => handleFitRollToChannel(selectedChannel)}
                    className="flex h-7 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[11px] font-semibold text-zinc-300 hover:text-white whitespace-nowrap"
                    title="Center Piano Roll on this row's notes"
                  >
                    <Sparkles className="h-3 w-3 text-amber-400" />
                    <span>Fit</span>
                  </button>

                  <div className="flex items-center rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
                    <button
                      type="button"
                      onClick={() => setRollTopMidi((m) => clampMidi(m - 4))}
                      aria-label="Scroll Piano Roll down"
                      className="flex h-6 w-6 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRollTopMidi((m) => clampMidi(m + 4))}
                      aria-label="Scroll Piano Roll up"
                      className="flex h-6 w-6 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => onClearChannelNotes(selectedChannel.id)}
                    className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[11px] font-semibold text-zinc-400 hover:border-rose-500/40 hover:text-rose-300 whitespace-nowrap"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Piano Roll Grid */}
              <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950">
                <div className="min-w-[520px]">
                  <div className="grid grid-cols-[58px_1fr] border-b border-zinc-800 bg-[#0D0D10]">
                    <div className="flex items-center justify-center border-r border-zinc-800 px-1 py-1 font-mono-tabular text-[10px] font-semibold text-zinc-500">
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
                            className={`border-r border-zinc-800/70 py-1 text-center font-mono-tabular text-[10px] ${
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

                  <div className="divide-y divide-zinc-900">
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
                            className={`flex items-center justify-between border-r border-zinc-800 px-2 font-mono-tabular text-[10px] font-semibold transition-colors ${
                              isBlack
                                ? 'bg-zinc-950 text-zinc-500 hover:bg-zinc-900'
                                : 'bg-zinc-900/75 text-zinc-300 hover:bg-zinc-800'
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
                                  className={`h-full border-r border-zinc-800/45 transition-colors hover:bg-amber-500/15 ${
                                    isBeatBorder ? 'border-l border-l-zinc-700/80' : ''
                                  } ${
                                    isPlayhead
                                      ? 'bg-amber-500/15'
                                      : isBlack
                                      ? 'bg-zinc-950/90'
                                      : inScale
                                      ? 'bg-zinc-900/40'
                                      : 'bg-zinc-950/60'
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
          </div>
        ) : (
          <div
            className={`lg:col-span-7 ${
              mobilePane === 'pianoroll' ? 'block' : 'hidden lg:block'
            }`}
          >
            <section
              aria-label="Empty Stem Workspace"
              className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-[#111114]/70 p-6 text-center"
            >
              <Music2 className="mb-2.5 h-8 w-8 text-zinc-600" />
              <h2 className="text-sm font-bold text-zinc-200">
                No Melodic Stem Rows
              </h2>
              <p className="mt-1 max-w-sm text-xs text-zinc-400">
                Add a melodic or vocal stem row to record humming, edit piano roll notes, or layer instruments over Row 1.
              </p>
              <button
                type="button"
                onClick={onAddChannel}
                className="mt-4 flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 text-xs font-bold text-zinc-950 transition-colors hover:bg-amber-400"
              >
                <Plus className="h-4 w-4" />
                <span>Add Row</span>
              </button>
            </section>
          </div>
        )}
      </div>

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
