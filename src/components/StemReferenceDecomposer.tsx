import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  AudioWaveform,
  ChevronLeft,
  ChevronRight,
  Disc3,
  Layers,
  Music2,
  Play,
  Sliders,
  Sparkles,
  Square,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  DecomposedInstrumentTrack,
  KeyboardSoundId,
  PercussionLoopPresetId,
  ReferenceDecompositionResult,
  SongSectionSegment,
  SongSectionType,
  TransitionFxEvent,
} from '../types/sequencer';
import { formatVolumeDb } from '../utils/sequencerLogic';
import {
  isBlackKeyMidi,
  KEYBOARD_SOUND_PRESETS,
  midiToNoteName,
} from '../utils/stemBuilderLogic';
import {
  isSoftwareWebGlEnvironment,
  transcribePolyphonicStemInWorker,
} from '../utils/basicPitchWorkerClient';
import type { ExtractedPolyphonicNote } from '../utils/basicPitchTranscription';
import {
  analyzeBarsAndSegmentStructure,
  assembleReferenceDecomposition,
  BUILT_IN_PERCUSSION_LOOPS,
  createSyntheticDemoReferencePcm,
  detectReferenceBpmAndBeatOffset,
  expandSectionNotesAcrossSong,
  extractMonoAndHarmonicForAnalysis,
  extractSectionRepresentativeSlices,
  getStepDurationForDecomposition,
  separateHarmonicStemPcm,
  type SectionArchetype,
} from '../utils/referenceDecomposer';

interface StemReferenceDecomposerProps {
  decomposition: ReferenceDecompositionResult | null;
  isPlaying: boolean;
  currentStep: number;
  originalMix: number;
  onDecompositionChange: (next: ReferenceDecompositionResult | null) => void;
  onSetReferenceBuffer: (buffer: AudioBuffer | null) => void;
  onOriginalMixChange: (mix: number) => void;
  onTogglePlay: (result: ReferenceDecompositionResult, startBar?: number) => Promise<void>;
  onSeekBar: (barIndex: number) => void;
  onStopPlayback: () => void;
  onLoadIntoStudio: (result: ReferenceDecompositionResult) => void;
  onUnlockAudioSync: () => void;
  getSharedAudioContext: () => AudioContext;
}

const SECTION_STYLE: Record<
  SongSectionType,
  { headerBg: string; border: string; barTint: string }
> = {
  intro: {
    headerBg: 'bg-[#1D252F] text-zinc-300',
    border: 'border-[#334152]',
    barTint: 'bg-[#1A212B]',
  },
  verse: {
    headerBg: 'bg-[#21423A] text-emerald-100',
    border: 'border-emerald-600/45',
    barTint: 'bg-[#172824]',
  },
  chorus: {
    headerBg: 'bg-[#5A3B1B] text-amber-100',
    border: 'border-amber-500/55',
    barTint: 'bg-[#2A2116]',
  },
  breakdown: {
    headerBg: 'bg-[#262339] text-violet-200',
    border: 'border-violet-500/40',
    barTint: 'bg-[#1B1927]',
  },
  bridge: {
    headerBg: 'bg-[#1E3B52] text-sky-100',
    border: 'border-sky-500/45',
    barTint: 'bg-[#172430]',
  },
  outro: {
    headerBg: 'bg-[#282B33] text-zinc-300',
    border: 'border-zinc-600/45',
    barTint: 'bg-[#181B21]',
  },
};

const COLOR_BAR_CLASS: Record<DecomposedInstrumentTrack['color'], string> = {
  amber: 'bg-amber-400',
  emerald: 'bg-emerald-400',
  sky: 'bg-sky-400',
  rose: 'bg-rose-400',
  violet: 'bg-violet-400',
};

const PERCUSSION_PRESET_OPTIONS = Object.values(BUILT_IN_PERCUSSION_LOOPS);

export const StemReferenceDecomposer: React.FC<StemReferenceDecomposerProps> = ({
  decomposition,
  isPlaying,
  currentStep,
  originalMix,
  onDecompositionChange,
  onSetReferenceBuffer,
  onOriginalMixChange,
  onTogglePlay,
  onSeekBar,
  onStopPlayback,
  onLoadIntoStudio,
  onUnlockAudioSync,
  getSharedAudioContext,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [stageLabel, setStageLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<'active' | 'all'>('active');
  const [selectedTrackNum, setSelectedTrackNum] = useState<number | null>(null);
  const [inspectBar, setInspectBar] = useState(0);

  const runAnalysisPipeline = useCallback(
    async (params: {
      fileName: string;
      monoPcm: Float32Array;
      harmonicPcm: Float32Array;
      sampleRate: number;
      durationSec: number;
      refAudioBuffer: AudioBuffer | null;
    }) => {
      const { fileName, monoPcm, harmonicPcm, sampleRate, durationSec, refAudioBuffer } = params;

      onStopPlayback();
      onSetReferenceBuffer(refAudioBuffer);

      setStageLabel('Detecting global BPM, downbeat offset & spectral energy...');
      setProgressPct(18);
      await new Promise<void>((r) => window.requestAnimationFrame(() => r()));

      const { bpm, beatOffsetSec } = detectReferenceBpmAndBeatOffset(monoPcm, sampleRate);

      setStageLabel('Segmenting Intro, Verse, Chorus/Drop, Breakdown & Outro along bar grid...');
      setProgressPct(34);
      await new Promise<void>((r) => window.requestAnimationFrame(() => r()));

      const { barMetrics, sections, totalBars } = analyzeBarsAndSegmentStructure(
        monoPcm,
        sampleRate,
        bpm,
        beatOffsetSec
      );

      setStageLabel('Extracting harmonic MIDI layers with Basic Pitch...');
      setProgressPct(46);

      const stepDurationSec = getStepDurationForDecomposition(bpm);
      const totalSteps = totalBars * 16;

      // Trim harmonic PCM cleanly from beatOffsetSec onward so bar 1 aligns cleanly
      const offsetSample = Math.max(0, Math.round(beatOffsetSec * sampleRate));
      const alignedHarmonic =
        offsetSample > 0 && offsetSample < harmonicPcm.length - sampleRate
          ? harmonicPcm.subarray(offsetSample)
          : harmonicPcm;

      const useFastSectionSampling =
        isSoftwareWebGlEnvironment() && alignedHarmonic.length > sampleRate * 8;

      let extractedNotes: ExtractedPolyphonicNote[] = [];
      if (useFastSectionSampling) {
        const repSlices = extractSectionRepresentativeSlices(
          alignedHarmonic,
          sampleRate,
          bpm,
          sections,
          barMetrics
        );
        const archetypeNotes: Partial<Record<SectionArchetype, ExtractedPolyphonicNote[]>> = {};
        for (let idx = 0; idx < repSlices.length; idx++) {
          const slice = repSlices[idx];
          const basePct = 46 + (idx / Math.max(1, repSlices.length)) * 44;
          const spanPct = (1 / Math.max(1, repSlices.length)) * 44;
          setStageLabel(
            `Extracting ${slice.archetype} harmonic MIDI layers (${idx + 1}/${repSlices.length})...`
          );
          setProgressPct(Math.round(basePct));
          const sliceNotes = await transcribePolyphonicStemInWorker(slice.pcm, sampleRate, {
            stepDurationSec,
            stepCount: 16,
            onProgress: (p) => {
              setProgressPct(Math.min(92, Math.round(basePct + p * spanPct)));
            },
          });
          archetypeNotes[slice.archetype] = sliceNotes;
        }
        extractedNotes = expandSectionNotesAcrossSong({
          archetypeNotes,
          sections,
          barMetrics,
          bpm,
          totalBars,
        });
      } else {
        extractedNotes = await transcribePolyphonicStemInWorker(alignedHarmonic, sampleRate, {
          stepDurationSec,
          stepCount: totalSteps,
          onProgress: (p) => {
            setProgressPct(Math.min(92, Math.round(46 + p * 44)));
          },
        });
      }

      setStageLabel('Splitting MIDI across 18 instrument channels & placing transition FX...');
      setProgressPct(95);
      await new Promise<void>((r) => window.requestAnimationFrame(() => r()));

      const result = assembleReferenceDecomposition({
        fileName,
        durationSec,
        bpm,
        beatOffsetSec,
        harmonicPcm: alignedHarmonic,
        sampleRate,
        barMetrics,
        sections,
        totalBars,
        extractedNotes,
      });

      const firstActive = result.instrumentTracks.find((t) => t.isActive);
      setSelectedTrackNum(firstActive ? firstActive.trackNumber : 2);
      setInspectBar(result.track1Clips[0]?.startBar ?? 0);
      onDecompositionChange(result);
      setProgressPct(100);
      setStageLabel('');
    },
    [onDecompositionChange, onSetReferenceBuffer, onStopPlayback]
  );

  const handleUploadReferenceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > 80 * 1024 * 1024) {
      setErrorMsg('Please select an audio file under 80 MB.');
      return;
    }

    onUnlockAudioSync();
    setErrorMsg(null);
    setIsAnalyzing(true);
    setProgressPct(6);
    setStageLabel(`Decoding ${file.name}...`);

    try {
      const ctx = getSharedAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => undefined);
      }

      const raw = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(raw.slice(0));

      // Trim cleanly to 5:00 max so long tracks stay responsive
      const maxFrames = Math.min(decoded.length, Math.floor(300 * decoded.sampleRate));
      let refBuffer = decoded;
      if (decoded.length > maxFrames) {
        refBuffer = ctx.createBuffer(
          decoded.numberOfChannels,
          maxFrames,
          decoded.sampleRate
        );
        for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
          refBuffer.copyToChannel(decoded.getChannelData(ch).subarray(0, maxFrames), ch);
        }
      }

      setStageLabel('Separating center & stereo harmonic layers...');
      setProgressPct(12);
      await new Promise<void>((r) => window.requestAnimationFrame(() => r()));

      const { monoPcm, harmonicPcm, sampleRate, durationSec } =
        extractMonoAndHarmonicForAnalysis(refBuffer, 300);

      await runAnalysisPipeline({
        fileName: file.name,
        monoPcm,
        harmonicPcm,
        sampleRate,
        durationSec,
        refAudioBuffer: refBuffer,
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Could not decode or analyze this audio file. Please try WAV, MP3, or M4A.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleLoadDemoReference = async () => {
    onUnlockAudioSync();
    setErrorMsg(null);
    setIsAnalyzing(true);
    setProgressPct(8);
    setStageLabel('Generating 16-bar multi-section reference audio...');

    try {
      const ctx = getSharedAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => undefined);
      }
      const demo = createSyntheticDemoReferencePcm(22050, 120);
      const refBuffer = ctx.createBuffer(1, demo.pcm.length, demo.sampleRate);
      refBuffer.getChannelData(0).set(demo.pcm);
      const harmonicPcm = separateHarmonicStemPcm(demo.pcm, demo.pcm, demo.sampleRate);

      await runAnalysisPipeline({
        fileName: 'Grace_Praise_Reference_120BPM.wav',
        monoPcm: demo.pcm,
        harmonicPcm,
        sampleRate: demo.sampleRate,
        durationSec: demo.durationSec,
        refAudioBuffer: refBuffer,
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to process demo reference track.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const updateDecomposition = useCallback(
    (updater: (prev: ReferenceDecompositionResult) => ReferenceDecompositionResult) => {
      if (!decomposition) return;
      onDecompositionChange(updater(decomposition));
    },
    [decomposition, onDecompositionChange]
  );

  const visibleInstrumentTracks = useMemo(() => {
    if (!decomposition) return [];
    return channelFilter === 'active'
      ? decomposition.instrumentTracks.filter((t) => t.isActive)
      : decomposition.instrumentTracks;
  }, [decomposition, channelFilter]);

  const activeInstrumentCount = useMemo(
    () => decomposition?.instrumentTracks.filter((t) => t.isActive).length ?? 0,
    [decomposition]
  );

  const selectedTrack = useMemo(() => {
    if (!decomposition) return null;
    return (
      decomposition.instrumentTracks.find((t) => t.trackNumber === selectedTrackNum) ??
      decomposition.instrumentTracks.find((t) => t.isActive) ??
      decomposition.instrumentTracks[0] ??
      null
    );
  }, [decomposition, selectedTrackNum]);

  const activeBarDisplay =
    isPlaying && currentStep >= 0 && decomposition
      ? Math.min(decomposition.totalBars - 1, Math.floor(currentStep / 16))
      : inspectBar;

  const activeBeatDisplay =
    isPlaying && currentStep >= 0 ? Math.floor((currentStep % 16) / 4) + 1 : 1;

  const playheadPct =
    isPlaying && currentStep >= 0 && decomposition
      ? Math.min(99.6, (currentStep / Math.max(16, decomposition.totalSteps)) * 100)
      : 0;

  const selectedTrackMidis = useMemo(() => {
    if (!selectedTrack || selectedTrack.notes.length === 0) {
      return Array.from({ length: 14 }, (_, i) => 72 - i);
    }
    const avg =
      selectedTrack.notes.reduce((sum, n) => sum + n.midi, 0) /
      selectedTrack.notes.length;
    const top = Math.min(84, Math.max(48, Math.round(avg + 7)));
    return Array.from({ length: 14 }, (_, i) => top - i).filter((m) => m >= 28);
  }, [selectedTrack]);

  const timelineColWidthPx = 46;
  const timelineWidthPx = Math.max(640, (decomposition?.totalBars ?? 16) * timelineColWidthPx);

  return (
    <div className="space-y-3 pb-16 lg:pb-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.mp4,.aac,.ogg,.flac,.webm"
        className="hidden"
        onChange={(e) => void handleUploadReferenceFile(e)}
      />

      {/* TOP TOOLBAR: Upload, Analyze, Key/BPM Summary, Playback & Studio Handoff */}
      <section className="rounded-xl border border-[#2F3A47] bg-[#1A2027] px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <AudioWaveform className="h-4 w-4 text-amber-400" />
              <h1 className="font-display text-sm font-bold tracking-tight text-zinc-100 sm:text-base whitespace-nowrap">
                Reference Song Decomposer
              </h1>
            </div>

            {decomposition && (
              <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-xs text-zinc-400">
                <span className="truncate max-w-[180px] text-zinc-200 font-semibold">
                  {decomposition.fileName}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-bold text-amber-400">{decomposition.bpm} BPM</span>
                <span aria-hidden="true">·</span>
                <span className="font-bold text-emerald-300">
                  {decomposition.rootKey}{' '}
                  {decomposition.scaleType === 'major' ? 'Major' : 'Minor'}
                </span>
                <span aria-hidden="true">·</span>
                <span>{decomposition.totalBars} Bars</span>
                <span aria-hidden="true">·</span>
                <span>{decomposition.sections.length} Sections</span>
                <span aria-hidden="true">·</span>
                <span>{activeInstrumentCount} / 18 Active Voices</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isAnalyzing}
              onClick={() => fileInputRef.current?.click()}
              className="flex h-8 items-center gap-1.5 rounded-md bg-amber-500 px-3 text-xs font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>{decomposition ? 'Upload New Song' : 'Upload Reference Song'}</span>
            </button>

            <button
              type="button"
              disabled={isAnalyzing}
              onClick={() => void handleLoadDemoReference()}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[#3C4958] bg-[#13181E] px-3 text-xs font-semibold text-zinc-200 transition-colors hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span>Try Sample Reference</span>
            </button>

            {decomposition && (
              <button
                type="button"
                onClick={() => onLoadIntoStudio(decomposition)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 text-xs font-bold text-emerald-300 transition-colors hover:bg-emerald-500/25 whitespace-nowrap shrink-0"
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Load Stems to Studio</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        {isAnalyzing && (
          <div className="mt-3 space-y-1.5 border-t border-[#2A3441] pt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-amber-300">{stageLabel}</span>
              <span className="font-mono-tabular font-bold text-zinc-300">
                {progressPct}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#11161C]">
              <div
                style={{ width: `${progressPct}%` }}
                className="h-full bg-amber-400 transition-all duration-200"
              />
            </div>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-rose-500/45 bg-rose-500/12 px-3 py-2 text-xs text-rose-200"
          >
            {errorMsg}
          </div>
        )}
      </section>

      {/* EMPTY STATE */}
      {!decomposition && !isAnalyzing && (
        <section
          aria-label="Reference Song Decomposer Empty State"
          className="flex min-h-[340px] flex-col items-center justify-center rounded-xl border border-dashed border-[#34404E] bg-[#161C24] p-8 text-center"
        >
          <Disc3 className="mb-3 h-10 w-10 text-amber-400/80" />
          <h2 className="font-display text-lg font-bold text-zinc-100">
            Analyze Any Reference Song Into 20+ Arrangement Tracks
          </h2>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-zinc-400">
            Upload an MP3 or WAV track to detect global BPM, musical key, and bar-aligned structural sections (Intro, Verse, Chorus/Drop, Breakdown, Bridge, Outro). Track 1 places dynamic light percussion loops strictly where rhythm enters, Tracks 2–19 split polyphonic Basic Pitch MIDI across 18 instrument channels by register and timbre, and Tracks 20–21 generate section transition FX.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-10 items-center gap-2 rounded-lg bg-amber-500 px-4 text-xs font-bold text-zinc-950 transition-colors hover:bg-amber-400 whitespace-nowrap"
            >
              <Upload className="h-4 w-4" />
              <span>Upload MP3 / WAV Song</span>
            </button>
            <button
              type="button"
              onClick={() => void handleLoadDemoReference()}
              className="flex h-10 items-center gap-2 rounded-lg border border-[#3C4958] bg-[#1C232C] px-4 text-xs font-semibold text-zinc-100 transition-colors hover:border-amber-500/60 hover:text-amber-300 whitespace-nowrap"
            >
              <Sparkles className="h-4 w-4 text-amber-400" />
              <span>Try Sample Reference (16 Bars)</span>
            </button>
          </div>
        </section>
      )}

      {/* POPULATED DECOMPOSED 20+ TRACK ARRANGEMENT */}
      {decomposition && (
        <>
          {/* TRANSPORT & A/B ORIGINAL MIX BAR */}
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2F3A47] bg-[#161C24] px-3 py-2.5 sm:px-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void onTogglePlay(decomposition, inspectBar)}
                className={`flex h-8 items-center gap-1.5 rounded-md px-3.5 text-xs font-bold transition-colors whitespace-nowrap ${
                  isPlaying
                    ? 'bg-rose-500 text-white hover:bg-rose-400'
                    : 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
                }`}
              >
                {isPlaying ? (
                  <>
                    <Square className="h-3 w-3 fill-current" />
                    <span>Stop Arrangement</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3 fill-current" />
                    <span>Play Decomposed Mix</span>
                  </>
                )}
              </button>

              <div className="flex items-center gap-2 font-mono-tabular text-xs">
                <span className="text-zinc-500">Bar.Beat</span>
                <span className="rounded border border-[#2F3A47] bg-[#10151C] px-2 py-1 font-bold text-amber-400">
                  {String(activeBarDisplay + 1).padStart(2, '0')}.{activeBeatDisplay}
                </span>
              </div>

              {/* Channel Filter Segmented Control */}
              <div
                role="group"
                aria-label="Filter instrument channels"
                className="flex items-center gap-0.5 rounded-md border border-[#34404E] bg-[#11161C] p-0.5"
              >
                <button
                  type="button"
                  onClick={() => setChannelFilter('active')}
                  aria-pressed={channelFilter === 'active'}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    channelFilter === 'active'
                      ? 'bg-[#26313E] text-amber-300'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Active Voices ({activeInstrumentCount})
                </button>
                <button
                  type="button"
                  onClick={() => setChannelFilter('all')}
                  aria-pressed={channelFilter === 'all'}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    channelFilter === 'all'
                      ? 'bg-[#26313E] text-amber-300'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  All 18 Channels
                </button>
              </div>
            </div>

            {/* A/B Original Mix Comparison Slider */}
            <div className="flex items-center gap-2.5">
              <Sliders className="h-3.5 w-3.5 text-zinc-400" />
              <label
                htmlFor="decomp-orig-mix"
                className="text-[11px] font-semibold text-zinc-300 whitespace-nowrap"
              >
                Original Audio Mix
              </label>
              <input
                id="decomp-orig-mix"
                type="range"
                min={0}
                max={100}
                step={2}
                value={Math.round(originalMix * 100)}
                onChange={(e) => onOriginalMixChange(Number(e.target.value) / 100)}
                className="studio-slider w-28"
              />
              <span className="font-mono-tabular w-9 text-right text-[11px] font-bold text-amber-300">
                {Math.round(originalMix * 100)}%
              </span>
            </div>
          </section>

          {/* MULTI-TRACK STRUCTURAL PLAYLIST & MIXER */}
          <section
            aria-label="Decomposed Multi-Track Timeline"
            className="overflow-hidden rounded-xl border border-[#2F3A47] bg-[#161C24]"
          >
            <div className="overflow-x-auto">
              <div style={{ minWidth: `${286 + timelineWidthPx}px` }}>
                {/* ROW 0: STRUCTURAL SECTION RULER & BAR NUMBERS */}
                <div className="flex border-b border-[#2F3A47] bg-[#11161C]">
                  <div className="sticky left-0 z-20 flex w-[286px] shrink-0 items-center justify-between border-r border-[#2F3A47] bg-[#11161C] px-3 py-2 text-[11px] font-bold text-zinc-400">
                    <span>CHANNEL · INSTRUMENT</span>
                    <span>M / S / VOL</span>
                  </div>

                  <div className="relative flex-1" style={{ width: `${timelineWidthPx}px` }}>
                    {/* Structural Sections */}
                    <div
                      className="grid border-b border-[#252E3A]"
                      style={{
                        gridTemplateColumns: `repeat(${decomposition.totalBars}, minmax(0, 1fr))`,
                      }}
                    >
                      {decomposition.sections.map((sec: SongSectionSegment) => {
                        const span = Math.max(1, sec.endBar - sec.startBar);
                        const style = SECTION_STYLE[sec.type];
                        return (
                          <button
                            key={sec.id}
                            type="button"
                            onClick={() => {
                              setInspectBar(sec.startBar);
                              onSeekBar(sec.startBar);
                            }}
                            style={{ gridColumn: `span ${span} / span ${span}` }}
                            className={`flex h-7 items-center justify-between border-r px-2 text-left text-[10px] font-bold transition-opacity hover:opacity-90 ${style.headerBg} ${style.border}`}
                            title={`${sec.label} (Bars ${sec.startBar + 1}–${sec.endBar}) · Click to jump`}
                          >
                            <span className="truncate">{sec.label}</span>
                            <span className="font-mono-tabular ml-1 text-[9px] opacity-75 shrink-0">
                              B{sec.startBar + 1}–{sec.endBar}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Bar Numbers */}
                    <div
                      className="grid"
                      style={{
                        gridTemplateColumns: `repeat(${decomposition.totalBars}, minmax(0, 1fr))`,
                      }}
                    >
                      {decomposition.barMetrics.map((m) => (
                        <button
                          key={m.barIndex}
                          type="button"
                          onClick={() => {
                            setInspectBar(m.barIndex);
                            onSeekBar(m.barIndex);
                          }}
                          className={`border-r border-[#242D38] py-1 text-center font-mono-tabular text-[10px] font-semibold transition-colors ${
                            activeBarDisplay === m.barIndex
                              ? 'bg-amber-500 text-zinc-950 font-bold'
                              : 'text-zinc-400 hover:bg-[#1E2733] hover:text-zinc-200'
                          }`}
                        >
                          {m.barIndex + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* TRACK 01: DYNAMIC LIGHT PERCUSSION LOOP TRACK */}
                <div
                  data-testid="decomp-track-01"
                  className="flex h-[58px] border-b border-[#2C3643] bg-[#182029]"
                >
                  <div className="sticky left-0 z-10 flex w-[286px] shrink-0 items-center justify-between gap-2 border-r border-[#2F3A47] bg-[#213B4F] px-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                        <span className="font-mono-tabular text-[10px] text-sky-200">01</span>
                        <span className="truncate">Dynamic Percussion Loop</span>
                      </div>
                      <div className="truncate font-mono-tabular text-[10px] text-sky-200/80">
                        {decomposition.track1Clips.length} Active Groove Zones
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          updateDecomposition((prev) => ({
                            ...prev,
                            track1Muted: !prev.track1Muted,
                          }))
                        }
                        aria-pressed={decomposition.track1Muted}
                        aria-label="Mute Track 01 Percussion Loop"
                        className={`h-6 w-6 rounded text-[10px] font-bold transition-colors ${
                          decomposition.track1Muted
                            ? 'bg-rose-500 text-white'
                            : 'bg-black/30 text-zinc-100 hover:bg-black/50'
                        }`}
                      >
                        M
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateDecomposition((prev) => {
                            const nextSolo = !prev.track1Soloed;
                            return {
                              ...prev,
                              track1Soloed: nextSolo,
                              fxSoloed: false,
                              instrumentTracks: prev.instrumentTracks.map((t) => ({
                                ...t,
                                soloed: false,
                              })),
                            };
                          })
                        }
                        aria-pressed={decomposition.track1Soloed}
                        aria-label="Solo Track 01 Percussion Loop"
                        className={`h-6 w-6 rounded text-[10px] font-bold transition-colors ${
                          decomposition.track1Soloed
                            ? 'bg-amber-400 text-zinc-950'
                            : 'bg-black/30 text-zinc-100 hover:bg-black/50'
                        }`}
                      >
                        S
                      </button>
                      <span className="font-mono-tabular w-12 shrink-0 whitespace-nowrap text-right text-[10px] text-sky-100">
                        {formatVolumeDb(decomposition.track1VolumeDb)}
                      </span>
                    </div>
                  </div>

                  {/* Timeline with ONLY grooved clips (Intro/Breakdown bars left visibly empty!) */}
                  <div
                    className="relative flex-1 bg-[#1D242E]"
                    style={{ width: `${timelineWidthPx}px` }}
                  >
                    {isPlaying && (
                      <div
                        style={{ left: `${playheadPct}%` }}
                        className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-amber-400"
                      />
                    )}
                    <div
                      className="pointer-events-none absolute inset-0 grid"
                      style={{
                        gridTemplateColumns: `repeat(${decomposition.totalBars}, minmax(0, 1fr))`,
                      }}
                    >
                      {decomposition.barMetrics.map((m) => (
                        <div
                          key={m.barIndex}
                          className={`border-r border-[#2C3644] ${
                            !m.hasPercussion ? 'bg-black/25' : ''
                          }`}
                        />
                      ))}
                    </div>

                    {decomposition.track1Clips.map((clip) => {
                      const leftPct = (clip.startBar / decomposition.totalBars) * 100;
                      const widthPct =
                        ((clip.endBar - clip.startBar) / decomposition.totalBars) * 100;
                      return (
                        <div
                          key={clip.id}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          className={`absolute inset-y-1.5 flex flex-col justify-between overflow-hidden rounded border px-1.5 py-0.5 ${
                            decomposition.track1Muted
                              ? 'border-zinc-600 bg-[#2C3A48]/50 opacity-50'
                              : 'border-sky-400/70 bg-[#274C6B]'
                          }`}
                        >
                          <div className="flex items-center gap-1">
                            <select
                              aria-label={`Loop preset for Bars ${clip.startBar + 1}-${clip.endBar}`}
                              value={clip.loopPresetId}
                              onChange={(e) => {
                                const presetId = e.target.value as PercussionLoopPresetId;
                                const presetLabel =
                                  BUILT_IN_PERCUSSION_LOOPS[presetId].label;
                                updateDecomposition((prev) => ({
                                  ...prev,
                                  track1Clips: prev.track1Clips.map((c) =>
                                    c.id === clip.id
                                      ? { ...c, loopPresetId: presetId, label: presetLabel }
                                      : c
                                  ),
                                }));
                              }}
                              className="h-4 w-full min-w-0 rounded bg-black/35 px-1 text-[10px] font-bold text-white focus:outline-none"
                            >
                              {PERCUSSION_PRESET_OPTIONS.map((opt) => (
                                <option key={opt.id} value={opt.id} className="bg-zinc-950">
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="truncate font-mono-tabular text-[9px] text-sky-200/85">
                            {clip.sectionLabel} · B{clip.startBar + 1}–{clip.endBar}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* TRACKS 02..19: 18 INSTRUMENT CHANNELS */}
                {visibleInstrumentTracks.map((track) => {
                  const rowNum = String(track.trackNumber).padStart(2, '0');
                  const isSelected = selectedTrack?.trackNumber === track.trackNumber;
                  const noteFill = COLOR_BAR_CLASS[track.color];

                  return (
                    <div
                      key={track.id}
                      data-testid={`decomp-track-${rowNum}`}
                      className={`flex h-[54px] border-b border-[#252E39] transition-colors ${
                        !track.isActive ? 'opacity-50' : ''
                      } ${isSelected ? 'bg-[#1F2833]' : 'bg-[#171D25]'}`}
                    >
                      <div
                        className={`sticky left-0 z-10 flex w-[286px] shrink-0 items-center justify-between gap-2 border-r border-[#2F3A47] px-3 py-1 ${
                          isSelected ? 'bg-[#263240]' : 'bg-[#192028]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTrackNum(track.trackNumber);
                            if (track.activeBars.length > 0) {
                              setInspectBar(track.activeBars[0]);
                            }
                          }}
                          className="min-w-0 flex-1 text-left focus:outline-none"
                        >
                          <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
                            <span className="font-mono-tabular text-[10px] text-zinc-400">
                              {rowNum}
                            </span>
                            <span className="truncate">{track.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 font-mono-tabular text-[10px] text-zinc-400">
                            <span className="uppercase">{track.register}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {track.isActive ? `${track.notes.length} notes` : 'Silent'}
                            </span>
                          </div>
                        </button>

                        <div className="flex shrink-0 items-center gap-1">
                          <select
                            aria-label={`Instrument voice for Track ${rowNum}`}
                            value={track.soundId}
                            onChange={(e) => {
                              const nextSound = e.target.value as KeyboardSoundId;
                              const meta = KEYBOARD_SOUND_PRESETS.find(
                                (p) => p.id === nextSound
                              );
                              updateDecomposition((prev) => ({
                                ...prev,
                                instrumentTracks: prev.instrumentTracks.map((t) =>
                                  t.trackNumber === track.trackNumber
                                    ? {
                                        ...t,
                                        soundId: nextSound,
                                        presetLabel: meta?.shortLabel ?? nextSound,
                                      }
                                    : t
                                ),
                              }));
                            }}
                            className="h-6 max-w-[78px] rounded border border-[#34404E] bg-[#11161C] px-1 text-[10px] font-medium text-zinc-200 focus:outline-none"
                          >
                            {KEYBOARD_SOUND_PRESETS.map((preset) => (
                              <option key={preset.id} value={preset.id}>
                                {preset.shortLabel}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            onClick={() =>
                              updateDecomposition((prev) => ({
                                ...prev,
                                instrumentTracks: prev.instrumentTracks.map((t) =>
                                  t.trackNumber === track.trackNumber
                                    ? { ...t, muted: !t.muted }
                                    : t
                                ),
                              }))
                            }
                            aria-pressed={track.muted}
                            aria-label={`Mute Track ${rowNum} ${track.name}`}
                            className={`h-6 w-6 rounded text-[10px] font-bold transition-colors ${
                              track.muted
                                ? 'bg-rose-500 text-white'
                                : 'bg-[#26303D] text-zinc-300 hover:bg-[#323F4F]'
                            }`}
                          >
                            M
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              updateDecomposition((prev) => {
                                const turningOn = !track.soloed;
                                return {
                                  ...prev,
                                  track1Soloed: false,
                                  fxSoloed: false,
                                  instrumentTracks: prev.instrumentTracks.map((t) => ({
                                    ...t,
                                    soloed:
                                      t.trackNumber === track.trackNumber ? turningOn : false,
                                  })),
                                };
                              })
                            }
                            aria-pressed={track.soloed}
                            aria-label={`Solo Track ${rowNum} ${track.name}`}
                            className={`h-6 w-6 rounded text-[10px] font-bold transition-colors ${
                              track.soloed
                                ? 'bg-amber-400 text-zinc-950'
                                : 'bg-[#26303D] text-zinc-300 hover:bg-[#323F4F]'
                            }`}
                          >
                            S
                          </button>
                        </div>
                      </div>

                      {/* MIDI Activity Lane */}
                      <div
                        onClick={() => {
                          setSelectedTrackNum(track.trackNumber);
                          if (track.activeBars.length > 0) {
                            setInspectBar(track.activeBars[0]);
                          }
                        }}
                        className="relative flex-1 cursor-pointer bg-[#141A22]"
                        style={{ width: `${timelineWidthPx}px` }}
                      >
                        {isPlaying && (
                          <div
                            style={{ left: `${playheadPct}%` }}
                            className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-amber-400"
                          />
                        )}
                        <div
                          className="pointer-events-none absolute inset-0 grid"
                          style={{
                            gridTemplateColumns: `repeat(${decomposition.totalBars}, minmax(0, 1fr))`,
                          }}
                        >
                          {decomposition.barMetrics.map((m) => (
                            <div
                              key={m.barIndex}
                              className={`border-r border-[#222B36] ${
                                m.barIndex % 2 === 1 ? 'bg-black/10' : ''
                              }`}
                            />
                          ))}
                        </div>

                        {track.notes.map((n, nIdx) => {
                          const leftPct = (n.step / decomposition.totalSteps) * 100;
                          const widthPct = Math.max(
                            0.65,
                            (n.durationSteps / decomposition.totalSteps) * 100
                          );
                          const yPct = Math.max(
                            12,
                            Math.min(84, ((84 - n.midi) / 52) * 70 + 12)
                          );
                          return (
                            <span
                              key={`${n.step}-${n.midi}-${nIdx}`}
                              style={{
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                                top: `${yPct}%`,
                              }}
                              className={`pointer-events-none absolute h-[3px] rounded-xs ${
                                track.muted ? 'bg-zinc-600' : noteFill
                              }`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* TRACKS 20..21: SECTION TRANSITION FX */}
                {[20, 21].map((fxTrackNum) => {
                  const events: TransitionFxEvent[] =
                    decomposition.transitionFxEvents.filter(
                      (ev) => ev.trackNumber === fxTrackNum
                    );
                  const fxTitle =
                    fxTrackNum === 20
                      ? 'FX Risers & Sweeps'
                      : 'Reverse Cymbals & Sub-Impacts';

                  return (
                    <div
                      key={fxTrackNum}
                      data-testid={`decomp-track-${fxTrackNum}`}
                      className="flex h-[50px] border-b border-[#2C3643] last:border-b-0 bg-[#1B1826]"
                    >
                      <div className="sticky left-0 z-10 flex w-[286px] shrink-0 items-center justify-between gap-2 border-r border-[#2F3A47] bg-[#2D2340] px-3 py-1">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-violet-100">
                            <span className="font-mono-tabular text-[10px] text-violet-300">
                              {fxTrackNum}
                            </span>
                            <span className="truncate">{fxTitle}</span>
                          </div>
                          <div className="font-mono-tabular text-[10px] text-violet-300/80">
                            {events.length} Boundary Cues
                          </div>
                        </div>

                        {fxTrackNum === 20 && (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                updateDecomposition((prev) => ({
                                  ...prev,
                                  fxMuted: !prev.fxMuted,
                                }))
                              }
                              aria-pressed={decomposition.fxMuted}
                              aria-label="Mute Transition FX"
                              className={`h-6 w-6 rounded text-[10px] font-bold ${
                                decomposition.fxMuted
                                  ? 'bg-rose-500 text-white'
                                  : 'bg-black/30 text-violet-100 hover:bg-black/50'
                              }`}
                            >
                              M
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateDecomposition((prev) => {
                                  const nextSolo = !prev.fxSoloed;
                                  return {
                                    ...prev,
                                    track1Soloed: false,
                                    fxSoloed: nextSolo,
                                    instrumentTracks: prev.instrumentTracks.map((t) => ({
                                      ...t,
                                      soloed: false,
                                    })),
                                  };
                                })
                              }
                              aria-pressed={decomposition.fxSoloed}
                              aria-label="Solo Transition FX"
                              className={`h-6 w-6 rounded text-[10px] font-bold ${
                                decomposition.fxSoloed
                                  ? 'bg-amber-400 text-zinc-950'
                                  : 'bg-black/30 text-violet-100 hover:bg-black/50'
                              }`}
                            >
                              S
                            </button>
                          </div>
                        )}
                      </div>

                      <div
                        className="relative flex-1 bg-[#16141F]"
                        style={{ width: `${timelineWidthPx}px` }}
                      >
                        {isPlaying && (
                          <div
                            style={{ left: `${playheadPct}%` }}
                            className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-amber-400"
                          />
                        )}
                        <div
                          className="pointer-events-none absolute inset-0 grid"
                          style={{
                            gridTemplateColumns: `repeat(${decomposition.totalBars}, minmax(0, 1fr))`,
                          }}
                        >
                          {decomposition.barMetrics.map((m) => (
                            <div key={m.barIndex} className="border-r border-[#272334]" />
                          ))}
                        </div>

                        {events.map((ev) => {
                          const leftPct = (ev.triggerStep / decomposition.totalSteps) * 100;
                          const widthPct = Math.max(
                            3.2,
                            (ev.durationSteps / decomposition.totalSteps) * 100
                          );
                          return (
                            <div
                              key={ev.id}
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                              className={`absolute inset-y-1.5 flex items-center overflow-hidden rounded border px-1.5 text-[9px] font-bold ${
                                decomposition.fxMuted
                                  ? 'border-zinc-600 bg-zinc-800/50 text-zinc-400 opacity-50'
                                  : ev.type === 'sub_impact'
                                  ? 'border-amber-400/70 bg-amber-500/25 text-amber-200'
                                  : 'border-violet-400/70 bg-violet-500/25 text-violet-100'
                              }`}
                              title={`${ev.label} @ Bar ${ev.startBar + 1}`}
                            >
                              <span className="truncate">{ev.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* INLINE PIANO ROLL INSPECTOR FOR SELECTED EXTRACTED TRACK */}
          {selectedTrack && (
            <section
              aria-label="Extracted Channel MIDI Inspector"
              className="rounded-xl border border-[#2F3A47] bg-[#161C24] p-3 sm:p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Music2 className="h-4 w-4 text-amber-400" />
                  <h2 className="text-xs font-bold text-zinc-100">
                    Track {String(selectedTrack.trackNumber).padStart(2, '0')} ·{' '}
                    {selectedTrack.name}
                  </h2>
                  <span className="font-mono-tabular text-xs text-zinc-400">
                    · {selectedTrack.presetLabel} · Bar {activeBarDisplay + 1} of{' '}
                    {decomposition.totalBars}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Volume control for selected channel */}
                  <div className="flex items-center gap-1.5">
                    {selectedTrack.muted ? (
                      <VolumeX className="h-3.5 w-3.5 text-rose-400" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5 text-zinc-400" />
                    )}
                    <input
                      type="range"
                      min={-48}
                      max={6}
                      step={0.5}
                      value={selectedTrack.volume_db}
                      onChange={(e) => {
                        const db = Number(e.target.value);
                        updateDecomposition((prev) => ({
                          ...prev,
                          instrumentTracks: prev.instrumentTracks.map((t) =>
                            t.trackNumber === selectedTrack.trackNumber
                              ? { ...t, volume_db: db }
                              : t
                          ),
                        }));
                      }}
                      aria-label={`Volume for Track ${selectedTrack.trackNumber}`}
                      className="studio-slider w-20"
                    />
                    <span className="font-mono-tabular w-11 text-right text-[11px] text-zinc-400">
                      {formatVolumeDb(selectedTrack.volume_db)}
                    </span>
                  </div>

                  {/* Bar Stepper */}
                  <div className="flex items-center gap-1 rounded-md border border-[#34404E] bg-[#11161C] p-0.5">
                    <button
                      type="button"
                      onClick={() => setInspectBar((b) => Math.max(0, b - 1))}
                      aria-label="Previous Bar"
                      className="flex h-6 w-6 items-center justify-center rounded text-zinc-300 hover:bg-[#242C36]"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="px-2 font-mono-tabular text-[11px] font-bold text-zinc-200">
                      Bar {activeBarDisplay + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setInspectBar((b) =>
                          Math.min(decomposition.totalBars - 1, b + 1)
                        )
                      }
                      aria-label="Next Bar"
                      className="flex h-6 w-6 items-center justify-center rounded text-zinc-300 hover:bg-[#242C36]"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-[#2F3A47] bg-[#12171E]">
                <div className="min-w-[540px]">
                  <div className="divide-y divide-[#1D252F]">
                    {selectedTrackMidis.map((midi) => {
                      const barStart = activeBarDisplay * 16;
                      const barEnd = barStart + 16;
                      const rowNotes = selectedTrack.notes.filter(
                        (n) =>
                          n.midi === midi &&
                          n.step < barEnd &&
                          n.step + Math.max(1, n.durationSteps) > barStart
                      );
                      const isBlack = isBlackKeyMidi(midi);

                      return (
                        <div key={midi} className="grid h-[18px] grid-cols-[54px_1fr]">
                          <div
                            className={`flex items-center border-r border-[#2F3A47] px-2 font-mono-tabular text-[10px] font-semibold ${
                              isBlack
                                ? 'bg-[#0F141A] text-zinc-500'
                                : 'bg-[#18202A] text-zinc-300'
                            }`}
                          >
                            {midiToNoteName(midi)}
                          </div>
                          <div className="relative grid grid-cols-16">
                            {Array.from({ length: 16 }).map((_, col) => (
                              <div
                                key={col}
                                className={`border-r border-[#202934] ${
                                  col % 4 === 0 && col > 0 ? 'border-l border-l-[#323E4D]' : ''
                                } ${isBlack ? 'bg-[#11161D]' : 'bg-[#161D26]'}`}
                              />
                            ))}
                            {rowNotes.map((note, idx) => {
                              const clippedStart = Math.max(barStart, note.step);
                              const clippedEnd = Math.min(
                                barEnd,
                                note.step + Math.max(1, note.durationSteps)
                              );
                              const colOffset = clippedStart - barStart;
                              const spanCols = Math.max(1, clippedEnd - clippedStart);
                              return (
                                <span
                                  key={`${note.step}-${idx}`}
                                  style={{
                                    left: `${(colOffset / 16) * 100}%`,
                                    width: `${(spanCols / 16) * 100}%`,
                                  }}
                                  className="absolute top-0.5 bottom-0.5 flex items-center rounded bg-amber-400 px-1 font-mono-tabular text-[9px] font-bold text-zinc-950"
                                >
                                  {midiToNoteName(midi)}
                                </span>
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
        </>
      )}
    </div>
  );
};
