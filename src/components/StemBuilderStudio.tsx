import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Layers,
  Mic,
  MicOff,
  Music2,
  Plus,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  Wand2,
} from 'lucide-react';
import type {
  KeyboardSoundId,
  LoopBars,
  PercussionTrack,
  ScaleType,
  StemChannel,
  StemLoopSource,
  StemNote,
  StemVoiceMode,
  TapPad,
} from '../types/sequencer';
import { getActiveStepCount } from '../utils/sequencerLogic';
import {
  clampMidi,
  detectPitchHzAutocorrelation,
  freqToMidi,
  isBlackKeyMidi,
  isMidiInScale,
  KEYBOARD_SOUND_PRESETS,
  midiToNoteName,
  MUSICAL_KEYS,
  type MusicalKey,
} from '../utils/stemBuilderLogic';
import { PianoKeyboardRow } from './PianoKeyboardRow';

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
  stemLoopVolumeDb: number;
  stemChannels: StemChannel[];
  selectedChannelId: string;
  rootKey: MusicalKey;
  scaleType: ScaleType;
  onSelectBar: (bar: number) => void;
  onToggleFollowPlayhead: () => void;
  onSelectLoopSource: (source: StemLoopSource) => void;
  onToggleLoopMuted: () => void;
  onLoopVolumeChange: (db: number) => void;
  onSelectChannel: (channelId: string) => void;
  onAddChannel: () => void;
  onRemoveChannel: (channelId: string) => void;
  onChannelSoundChange: (channelId: string, soundId: KeyboardSoundId) => void;
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
  onClearChannelNotes: (channelId: string) => void;
  onFixOffKeyNotes: (channelId: string) => void;
  onTransposeChannel: (channelId: string, semitones: number) => void;
  onRootKeyChange: (key: MusicalKey) => void;
  onScaleTypeChange: (scale: ScaleType) => void;
  onPlayKeyboardKey: (midi: number, recordToRoll: boolean) => void;
  onEnsurePlaying: () => Promise<void>;
  getPlaybackTiming: () => {
    isPlaying: boolean;
    currentStep: number;
    nextStepTime: number;
    stepDuration: number;
    stepCount: number;
    ctxCurrentTime: number;
  };
  onSaveHumAudio: (channelId: string, blob: Blob) => Promise<void>;
  onClearHumAudio: (channelId: string) => void;
}

const CHANNEL_ACCENT: Record<
  StemChannel['color'],
  { border: string; bg: string; noteBg: string; dot: string }
> = {
  amber: {
    border: 'border-amber-500/45',
    bg: 'bg-amber-500/10',
    noteBg: 'bg-amber-400 text-zinc-950 border-amber-200',
    dot: 'bg-amber-400',
  },
  emerald: {
    border: 'border-emerald-500/45',
    bg: 'bg-emerald-500/10',
    noteBg: 'bg-emerald-400 text-zinc-950 border-emerald-200',
    dot: 'bg-emerald-400',
  },
  sky: {
    border: 'border-sky-500/45',
    bg: 'bg-sky-500/10',
    noteBg: 'bg-sky-400 text-zinc-950 border-sky-200',
    dot: 'bg-sky-400',
  },
  violet: {
    border: 'border-violet-500/45',
    bg: 'bg-violet-500/10',
    noteBg: 'bg-violet-400 text-zinc-950 border-violet-200',
    dot: 'bg-violet-400',
  },
  rose: {
    border: 'border-rose-500/45',
    bg: 'bg-rose-500/10',
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
  stemLoopVolumeDb,
  stemChannels,
  selectedChannelId,
  rootKey,
  scaleType,
  onSelectBar,
  onToggleFollowPlayhead,
  onSelectLoopSource,
  onToggleLoopMuted,
  onLoopVolumeChange,
  onSelectChannel,
  onAddChannel,
  onRemoveChannel,
  onChannelSoundChange,
  onChannelVoiceModeChange,
  onChannelMuteToggle,
  onChannelSoloToggle,
  onChannelVolumeChange,
  onToggleNote,
  onRecordNote,
  onClearChannelNotes,
  onFixOffKeyNotes,
  onTransposeChannel,
  onRootKeyChange,
  onScaleTypeChange,
  onPlayKeyboardKey,
  onEnsurePlaying,
  getPlaybackTiming,
  onSaveHumAudio,
  onClearHumAudio,
}) => {
  const selectedChannel =
    stemChannels.find((c) => c.id === selectedChannelId) ?? stemChannels[0];

  const [baseOctave, setBaseOctave] = useState<number>(3);
  const [rollTopMidi, setRollTopMidi] = useState<number>(77); // F5 .. C4 (18 semitones)
  const [noteDurationSteps, setNoteDurationSteps] = useState<number>(2);
  const [punchInRecord, setPunchInRecord] = useState<boolean>(true);
  const [showGhostNotes, setShowGhostNotes] = useState<boolean>(true);

  // Live Sing / Hum Pitch-to-MIDI Capture state
  const [isHumming, setIsHumming] = useState<boolean>(false);
  const [humStatusText, setHumStatusText] = useState<string | null>(null);
  const [humError, setHumError] = useState<string | null>(null);
  const [liveHumMidi, setLiveHumMidi] = useState<number | null>(null);

  const humStreamRef = useRef<MediaStream | null>(null);
  const humCtxRef = useRef<AudioContext | null>(null);
  const humIntervalRef = useRef<number | null>(null);
  const humRecorderRef = useRef<MediaRecorder | null>(null);
  const humChunksRef = useRef<Blob[]>([]);
  const lastHumTriggerRef = useRef<{ step: number; midi: number } | null>(null);
  const pendingPitchRef = useRef<{ midi: number; count: number }>({
    midi: 0,
    count: 0,
  });

  const activeStepsCount = getActiveStepCount(loopBars);
  const barOffset =
    followPlayhead && currentStep >= 0
      ? Math.floor((currentStep % activeStepsCount) / 16)
      : Math.min(activeBar, loopBars - 1);
  const barStartStep = barOffset * 16;

  // Sync Piano Roll pitch window when selecting a Bass or high lead channel
  const handleFitRollToChannel = useCallback((channel: StemChannel) => {
    if (channel.notes.length > 0) {
      const avg =
        channel.notes.reduce((sum, n) => sum + n.midi, 0) / channel.notes.length;
      const top = Math.min(84, Math.max(53, Math.round(avg + 8)));
      setRollTopMidi(top);
      setBaseOctave(avg < 56 ? 2 : 3);
    } else if (channel.soundId === 'worship_bass') {
      setRollTopMidi(56);
      setBaseOctave(2);
    } else {
      setRollTopMidi(77);
      setBaseOctave(3);
    }
  }, []);

  const stopHumCapture = useCallback(() => {
    if (humIntervalRef.current !== null) {
      window.clearInterval(humIntervalRef.current);
      humIntervalRef.current = null;
    }
    if (humRecorderRef.current && humRecorderRef.current.state !== 'inactive') {
      try {
        humRecorderRef.current.stop();
      } catch {
        // Already stopped
      }
    }
    if (humStreamRef.current) {
      humStreamRef.current.getTracks().forEach((t) => t.stop());
      humStreamRef.current = null;
    }
    if (humCtxRef.current) {
      void humCtxRef.current.close().catch(() => undefined);
      humCtxRef.current = null;
    }
    setIsHumming(false);
    setLiveHumMidi(null);
    lastHumTriggerRef.current = null;
    pendingPitchRef.current = { midi: 0, count: 0 };
  }, []);

  useEffect(() => {
    return () => {
      stopHumCapture();
    };
  }, [stopHumCapture]);

  const startHumCapture = async () => {
    if (!selectedChannel) return;
    setHumError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setHumError('Microphone capture is not supported in this browser.');
      return;
    }

    try {
      await onEnsurePlaying();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      humStreamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const micCtx = new AudioCtx();
      humCtxRef.current = micCtx;
      if (micCtx.state === 'suspended') {
        await micCtx.resume();
      }

      const source = micCtx.createMediaStreamSource(stream);
      const analyser = micCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const timeDomainBuf = new Float32Array(analyser.fftSize);
      const targetChannelId = selectedChannel.id;

      // Also record raw hum audio so user can audition raw hum OR swap with any keyboard voice
      humChunksRef.current = [];
      if (typeof MediaRecorder !== 'undefined') {
        try {
          const recorder = new MediaRecorder(stream);
          humRecorderRef.current = recorder;
          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              humChunksRef.current.push(e.data);
            }
          };
          recorder.onstop = () => {
            const chunks = humChunksRef.current;
            if (chunks.length > 0) {
              const mimeType = recorder.mimeType || 'audio/webm';
              const blob = new Blob(chunks, { type: mimeType });
              void onSaveHumAudio(targetChannelId, blob);
              setHumStatusText(
                'Hum captured to sequence — switch voices or click Fix Off-Key anytime.'
              );
            }
          };
          recorder.start(250);
        } catch {
          humRecorderRef.current = null;
        }
      }

      setIsHumming(true);
      setHumStatusText('Listening... sing or hum along with the loop.');
      lastHumTriggerRef.current = null;

      humIntervalRef.current = window.setInterval(() => {
        analyser.getFloatTimeDomainData(timeDomainBuf);
        const hz = detectPitchHzAutocorrelation(timeDomainBuf, micCtx.sampleRate, 0.016);
        if (!hz) {
          setLiveHumMidi(null);
          pendingPitchRef.current = { midi: 0, count: 0 };
          return;
        }

        const detectedMidi = freqToMidi(hz);
        setLiveHumMidi(detectedMidi);

        if (Math.abs(pendingPitchRef.current.midi - detectedMidi) <= 1) {
          pendingPitchRef.current.count += 1;
        } else {
          pendingPitchRef.current = { midi: detectedMidi, count: 1 };
        }

        if (pendingPitchRef.current.count < 2) return;

        const timing = getPlaybackTiming();
        const activeStep =
          timing.currentStep >= 0 ? timing.currentStep % timing.stepCount : 0;

        const last = lastHumTriggerRef.current;
        const isDuplicateSameCell =
          last && last.step === activeStep && Math.abs(last.midi - detectedMidi) <= 1;
        if (isDuplicateSameCell) return;

        lastHumTriggerRef.current = { step: activeStep, midi: detectedMidi };
        onRecordNote(targetChannelId, {
          step: activeStep,
          midi: detectedMidi,
          durationSteps: noteDurationSteps,
          velocity: 92,
        });
        setHumStatusText(
          `Captured ${midiToNoteName(detectedMidi)} at step ${activeStep + 1}`
        );
      }, 65);
    } catch (err) {
      stopHumCapture();
      setHumError(
        err instanceof Error
          ? err.message
          : 'Could not access microphone. Please allow microphone permission.'
      );
    }
  };

  // Compute aggregated drum hit summary across all 64 steps for the Imported Website Loop strip
  const loopBedStepCounts = useMemo(() => {
    const counts = new Array<number>(64).fill(0);
    if (stemLoopSource === 'taploop') {
      for (const pad of tapPads) {
        if (pad.muted) continue;
        for (let s = 0; s < 64; s++) {
          if ((pad.steps[s] ?? 0) > 0) counts[s] += 1;
        }
      }
    } else {
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
    return tracks.filter((t) => !t.isClick && !t.muted && t.steps.some((v) => v > 0))
      .length;
  }, [stemLoopSource, tapPads, tracks]);

  const offKeyCountOnSelected = useMemo(() => {
    if (!selectedChannel) return 0;
    return selectedChannel.notes.filter(
      (n) => !isMidiInScale(n.midi, rootKey, scaleType)
    ).length;
  }, [selectedChannel, rootKey, scaleType]);

  // Build visible 18-semitone rows for the Piano Roll (high to low)
  const visiblePitchMidis = useMemo(() => {
    const top = clampMidi(rollTopMidi);
    const rows: number[] = [];
    for (let i = 0; i < 18; i++) {
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

  const rootPc = MUSICAL_KEYS.indexOf(rootKey);

  return (
    <div className="space-y-4">
      {/* FL-Studio-Inspired Top Command Strip */}
      <section className="rounded-xl border border-zinc-800/90 bg-[#111114] p-3.5 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          {/* Website Loop Source Import */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 pr-1">
              <Layers className="h-4 w-4 text-amber-400" />
              <div>
                <h2 className="font-display text-sm font-bold tracking-wide text-zinc-100 sm:text-base">
                  Stem Builder
                </h2>
                <p className="text-[11px] text-zinc-400">
                  Import your website loop, sing or play melodies, fix off-key notes &amp; swap voices
                </p>
              </div>
            </div>

            <div
              role="group"
              aria-label="Import loop source from website"
              className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1"
            >
              <button
                type="button"
                onClick={() => onSelectLoopSource('sequencer')}
                aria-pressed={stemLoopSource === 'sequencer'}
                className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  stemLoopSource === 'sequencer'
                    ? 'bg-amber-500 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Import Sequencer Loop
              </button>
              <button
                type="button"
                onClick={() => onSelectLoopSource('taploop')}
                aria-pressed={stemLoopSource === 'taploop'}
                className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  stemLoopSource === 'taploop'
                    ? 'bg-emerald-500 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Import Tap Loop
              </button>
            </div>
          </div>

          {/* Key, Off-Key Pitch Correction & Sing/Hum Capture */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1">
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

              <span className="text-zinc-700">/</span>

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

            {selectedChannel && (
              <>
                <button
                  type="button"
                  onClick={() => onFixOffKeyNotes(selectedChannel.id)}
                  className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${
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

                <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
                  <button
                    type="button"
                    onClick={() => onTransposeChannel(selectedChannel.id, -1)}
                    className="rounded px-2 py-1 font-mono-tabular text-[11px] font-semibold text-zinc-300 hover:bg-zinc-800"
                    title="Transpose active channel down 1 semitone"
                  >
                    -1 st
                  </button>
                  <button
                    type="button"
                    onClick={() => onTransposeChannel(selectedChannel.id, 1)}
                    className="rounded px-2 py-1 font-mono-tabular text-[11px] font-semibold text-zinc-300 hover:bg-zinc-800"
                    title="Transpose active channel up 1 semitone"
                  >
                    +1 st
                  </button>
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                if (isHumming) {
                  stopHumCapture();
                } else {
                  void startHumCapture();
                }
              }}
              className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-all whitespace-nowrap ${
                isHumming
                  ? 'bg-rose-500 text-white shadow-[0_0_16px_rgba(244,63,94,0.45)] hover:bg-rose-400'
                  : 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
              }`}
            >
              {isHumming ? (
                <>
                  <MicOff className="h-3.5 w-3.5" />
                  <span>
                    Stop Hum{liveHumMidi !== null ? ` (${midiToNoteName(liveHumMidi)})` : ''}
                  </span>
                </>
              ) : (
                <>
                  <Mic className="h-3.5 w-3.5" />
                  <span>Sing / Hum Sequence</span>
                </>
              )}
            </button>
          </div>
        </div>

        {(humStatusText || humError) && (
          <div
            className={`mt-2.5 flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs ${
              humError
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
            }`}
          >
            <span>{humError || humStatusText}</span>
            <button
              type="button"
              onClick={() => {
                setHumError(null);
                setHumStatusText(null);
              }}
              className="text-[11px] font-semibold opacity-80 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}
      </section>

      {/* SECTION A: FL-Studio Style Unified Channel Rack — ALL Sequences Visible */}
      <section
        aria-label="Channel Rack — All Sequences"
        className="rounded-xl border border-zinc-800/90 bg-[#111114] p-3.5 sm:p-4"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Music2 className="h-4 w-4 text-amber-400" />
            <h3 className="text-xs font-bold tracking-wide text-zinc-100 uppercase">
              Channel Rack · All Sequences ({stemChannels.length + 1} Tracks @ {bpm} BPM)
            </h3>
          </div>

          <button
            type="button"
            onClick={onAddChannel}
            className="flex h-7 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-[11px] font-semibold text-zinc-100 transition-colors hover:border-amber-500/50 hover:text-amber-300 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Keyboard Stem</span>
          </button>
        </div>

        <div className="space-y-2">
          {/* Imported Website Drum / Percussion Loop Bed Row */}
          <div className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/90 p-2.5 lg:grid-cols-[360px_1fr] lg:items-center">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-7 w-1 shrink-0 rounded-full bg-amber-500" />
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-zinc-100">
                    {stemLoopSource === 'taploop'
                      ? 'Imported Tap Loop Bed'
                      : 'Imported Sequencer Loop Bed'}
                  </div>
                  <div className="font-mono-tabular text-[10px] text-zinc-400">
                    {activeLoopElementsCount} active percussion layers · Synced {loopBars}B
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleLoopMuted}
                  aria-pressed={stemLoopMuted}
                  aria-label={stemLoopMuted ? 'Unmute imported loop' : 'Mute imported loop'}
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
                <input
                  type="range"
                  min={-24}
                  max={6}
                  step={0.5}
                  value={stemLoopVolumeDb}
                  onChange={(e) => onLoopVolumeChange(Number(e.target.value))}
                  aria-label="Imported loop volume"
                  className="studio-slider w-16"
                />
              </div>
            </div>

            {/* 64-Step Full Loop Overview Strip */}
            <div
              aria-label="Imported loop 64-step pattern overview"
              className="grid h-8 grid-cols-16 gap-px rounded border border-zinc-800/80 bg-zinc-900/60 p-1"
            >
              {Array.from({ length: 16 }).map((_, groupIdx) => {
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
                          height: cnt > 0 ? `${Math.min(100, 28 + cnt * 18)}%` : '14%',
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

          {/* All Melodic / Keyboard / Hum Stem Channels */}
          {stemChannels.map((ch) => {
            const isSelected = selectedChannel?.id === ch.id;
            const accent = CHANNEL_ACCENT[ch.color];
            const channelOffKeyCount = ch.notes.filter(
              (n) => !isMidiInScale(n.midi, rootKey, scaleType)
            ).length;

            return (
              <div
                key={ch.id}
                onClick={() => onSelectChannel(ch.id)}
                className={`grid cursor-pointer grid-cols-1 gap-2.5 rounded-lg border p-2.5 transition-colors lg:grid-cols-[360px_1fr] lg:items-center ${
                  isSelected
                    ? `${accent.border} ${accent.bg}`
                    : 'border-zinc-800/80 bg-zinc-950/75 hover:border-zinc-700'
                }`}
              >
                {/* Left Controls: Channel Color, Sound Picker, Hum/Key Voice Switch, S/M, Gain */}
                <div
                  className="flex min-w-0 flex-col gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectChannel(ch.id)}
                      className="flex min-w-0 items-center gap-2 text-left"
                    >
                      <span className={`h-6 w-1 shrink-0 rounded-full ${accent.dot}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-bold text-zinc-100">
                            {ch.name}
                          </span>
                          {channelOffKeyCount > 0 && (
                            <span className="rounded bg-rose-500/20 px-1 py-0.5 font-mono-tabular text-[9px] font-bold text-rose-300">
                              {channelOffKeyCount} off-key
                            </span>
                          )}
                        </div>
                        <span className="font-mono-tabular text-[10px] text-zinc-400">
                          {ch.notes.length} notes
                          {ch.hasHumAudio ? ' · Hum audio ready' : ''}
                        </span>
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onChannelSoloToggle(ch.id)}
                        aria-pressed={ch.soloed}
                        className={`h-6 w-6 rounded border font-mono-tabular text-[10px] font-bold transition-colors ${
                          ch.soloed
                            ? 'border-amber-400 bg-amber-500 text-zinc-950'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                        }`}
                        title="Solo channel"
                      >
                        S
                      </button>
                      <button
                        type="button"
                        onClick={() => onChannelMuteToggle(ch.id)}
                        aria-pressed={ch.muted}
                        className={`h-6 w-6 rounded border font-mono-tabular text-[10px] font-bold transition-colors ${
                          ch.muted
                            ? 'border-rose-500/60 bg-rose-500/20 text-rose-300'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                        }`}
                        title="Mute channel"
                      >
                        M
                      </button>
                      {stemChannels.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onRemoveChannel(ch.id)}
                          aria-label={`Remove ${ch.name}`}
                          className="flex h-6 w-6 items-center justify-center rounded border border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-rose-500/40 hover:text-rose-300"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Sound Picker + Hum Replacement Switch + Volume */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      aria-label={`Keyboard sound for ${ch.name}`}
                      value={ch.soundId}
                      onChange={(e) =>
                        onChannelSoundChange(ch.id, e.target.value as KeyboardSoundId)
                      }
                      className="h-7 min-w-[140px] flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 text-[11px] font-semibold text-zinc-100 focus:border-amber-500 focus:outline-none"
                    >
                      {KEYBOARD_SOUND_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>

                    {ch.hasHumAudio && (
                      <div className="flex items-center rounded border border-zinc-800 bg-zinc-900 p-0.5">
                        <button
                          type="button"
                          onClick={() => onChannelVoiceModeChange(ch.id, 'keyboard')}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                            ch.voiceMode === 'keyboard'
                              ? 'bg-amber-500 text-zinc-950'
                              : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                          title="Replace hummed notes with selected keyboard voice"
                        >
                          Keys Voice
                        </button>
                        <button
                          type="button"
                          onClick={() => onChannelVoiceModeChange(ch.id, 'hum_audio')}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                            ch.voiceMode === 'hum_audio'
                              ? 'bg-sky-400 text-zinc-950'
                              : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                          title="Play raw recorded hum vocal"
                        >
                          Hum Vocal
                        </button>
                      </div>
                    )}

                    <input
                      type="range"
                      min={-24}
                      max={6}
                      step={0.5}
                      value={ch.volume_db}
                      onChange={(e) =>
                        onChannelVolumeChange(ch.id, Number(e.target.value))
                      }
                      aria-label={`${ch.name} volume`}
                      className="studio-slider w-16"
                    />
                  </div>
                </div>

                {/* Right Mini Piano Roll Strip — All 64 Steps Visible Across 4 Bars */}
                <div
                  aria-label={`${ch.name} full sequence preview`}
                  className="relative h-12 w-full overflow-hidden rounded border border-zinc-800/80 bg-zinc-950"
                >
                  {/* 4 Bar dividers */}
                  {[1, 2, 3].map((b) => (
                    <div
                      key={b}
                      style={{ left: `${(b / 4) * 100}%` }}
                      className="pointer-events-none absolute inset-y-0 w-px bg-zinc-800"
                    />
                  ))}

                  {/* Highlight active bar window */}
                  <div
                    style={{
                      left: `${(barOffset / 4) * 100}%`,
                      width: '25%',
                    }}
                    className="pointer-events-none absolute inset-y-0 border-x border-amber-500/30 bg-amber-500/5"
                  />

                  {/* Dim unused bars when loopBars < 4 */}
                  {loopBars < 4 && (
                    <div
                      style={{
                        left: `${(loopBars / 4) * 100}%`,
                        width: `${((4 - loopBars) / 4) * 100}%`,
                      }}
                      className="pointer-events-none absolute inset-y-0 bg-zinc-950/75"
                    />
                  )}

                  {/* Note pills inside mini rack preview */}
                  {ch.notes.map((note, idx) => {
                    const leftPct = (note.step / 64) * 100;
                    const widthPct = Math.max(1.4, (note.durationSteps / 64) * 100);
                    const yPct = Math.max(
                      6,
                      Math.min(86, ((84 - note.midi) / 48) * 80 + 6)
                    );
                    const inKey = isMidiInScale(note.midi, rootKey, scaleType);
                    return (
                      <span
                        key={`${note.step}-${note.midi}-${idx}`}
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

                  {/* Live Playhead */}
                  {isPlaying && currentStep >= 0 && (
                    <div
                      style={{ left: `${(currentStep / 64) * 100}%` }}
                      className="pointer-events-none absolute inset-y-0 w-0.5 bg-amber-400 shadow-[0_0_8px_#F59E0B]"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* SECTION B: Interactive Piano Roll for Active Stem Channel */}
      {selectedChannel && (
        <section
          aria-label="Piano Roll Sequence Editor"
          className="rounded-xl border border-zinc-800/90 bg-[#111114] p-3.5 sm:p-4"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  CHANNEL_ACCENT[selectedChannel.color].dot
                }`}
              />
              <h3 className="text-xs font-bold tracking-wide text-zinc-100 uppercase">
                Piano Roll · {selectedChannel.name}
              </h3>
              <span className="text-xs text-zinc-400">
                ({activeSoundPreset.shortLabel})
              </span>
              {selectedChannel.hasHumAudio && (
                <button
                  type="button"
                  onClick={() => onClearHumAudio(selectedChannel.id)}
                  className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] font-semibold text-zinc-400 hover:border-rose-500/40 hover:text-rose-300"
                >
                  Discard Raw Hum
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {/* Bar tabs */}
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

              {/* Step Note Length */}
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

              {/* Ghost Notes & Pitch Window Controls */}
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
                Ghost Notes
              </button>

              <button
                type="button"
                onClick={() => handleFitRollToChannel(selectedChannel)}
                className="flex h-7 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[11px] font-semibold text-zinc-300 hover:text-white whitespace-nowrap"
                title="Center Piano Roll vertically on this channel's notes"
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

          {/* Piano Roll Matrix */}
          <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950">
            <div className="min-w-[540px]">
              {/* Step Beat Header */}
              <div className="grid grid-cols-[62px_1fr] border-b border-zinc-800 bg-[#0D0D10]">
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

              {/* Semitone Rows */}
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
                    <div key={midi} className="grid grid-cols-[62px_1fr] h-6">
                      {/* Left Piano Key Label */}
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

                      {/* 16 Step Grid Cells */}
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

                        {/* Ghost Notes Layer */}
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

                        {/* Active Channel Notes Layer */}
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
      )}

      {/* Interactive Keyboard Row Docked Below Piano Roll */}
      <PianoKeyboardRow
        baseOctave={baseOctave}
        onBaseOctaveChange={(oct) => {
          setBaseOctave(oct);
          setRollTopMidi(clampMidi((oct + 2) * 12 + 5));
        }}
        rootKey={rootKey}
        scaleType={scaleType}
        soundLabel={
          selectedChannel?.voiceMode === 'hum_audio' && selectedChannel?.hasHumAudio
            ? `${activeSoundPreset.shortLabel} (Preview)`
            : activeSoundPreset.label
        }
        punchInRecord={punchInRecord}
        onTogglePunchIn={() => setPunchInRecord((v) => !v)}
        activePlayingMidis={activePlayingMidis}
        onPlayKey={(midi) => onPlayKeyboardKey(midi, punchInRecord)}
      />

      {/* Audio status footer note */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pr-16 text-[11px] text-zinc-500">
        <div className="flex items-center gap-1.5">
          <AudioLines className="h-3.5 w-3.5 text-amber-400" />
          <span>
            Off-key notes highlight in <span className="text-rose-400">rose</span>. Use{' '}
            <span className="text-zinc-300">Fix Off-Key</span>,{' '}
            <span className="text-zinc-300">±1 st</span>, or pick a keyboard voice to replace hummed melodies.
          </span>
        </div>
        <span className="font-mono-tabular">
          {loopBars} Bars · {bpm} BPM
        </span>
      </div>
    </div>
  );
};
