import { useCallback, useEffect, useRef, useState } from 'react';
import { StudioAudioEngine } from './audio/AudioEngine';
import { BottomDock } from './components/BottomDock';
import { ExportModal } from './components/ExportModal';
import { FreesoundModal } from './components/FreesoundModal';
import { SequencerMatrix } from './components/SequencerMatrix';
import { StemBuilderStudio } from './components/StemBuilderStudio';
import { StudioHeader } from './components/StudioHeader';
import { TapLoopStudio } from './components/TapLoopStudio';
import { VoiceDirectorFab } from './components/VoiceDirectorFab';
import { WaveformDropzone } from './components/WaveformDropzone';
import { INITIAL_HIGHLIFE_ARRANGEMENT } from './data/presets';
import type {
  AnalysisMode,
  AnalysisStatus,
  ArrangementBlueprint,
  ExportOptions,
  KeyboardSoundId,
  LoopBars,
  PercussionTrack,
  SampleCandidate,
  ScaleType,
  StemChannel,
  StemLoopSource,
  StemNote,
  StemVoiceMode,
  StudioPage,
  TapLoopSettings,
  TapPad,
  TapPresetOption,
  VoiceCommandResponse,
} from './types/sequencer';
import {
  clampBpm,
  clampPan,
  clampVolumeDb,
  hydrateTracksWithFallbackSamples,
  matchFallbackCategory,
} from './utils/sequencerLogic';
import {
  clampCutoffHz,
  clampUnit,
  createDefaultTapPads,
  createEmptySteps,
  createNextTapPad,
  DEFAULT_TAP_LOOP_SETTINGS,
  estimateBpmFromTapIntervals,
  humanizeSteps,
} from './utils/tapLoopLogic';
import { mixAudioBufferToMonoSegment } from './utils/audioUploadHelper';
import {
  expandPatternTo64Steps,
  findMatchingTapPadIndex,
  findMatchingTrackIndex,
} from './utils/voiceCommandLogic';
import {
  createDefaultStemChannels,
  createNextStemChannel,
  snapNotesToScale,
  toggleStemNote,
  transposeNotes,
  upsertStemNote,
  type MusicalKey,
} from './utils/stemBuilderLogic';

function extractWaveformPeaks(buffer: AudioBuffer, binCount = 96): number[] {
  const channel = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(channel.length / binCount));
  const step = Math.max(4, Math.floor(blockSize / 64));
  const peaks: number[] = [];
  let maxPeak = 0.001;

  for (let i = 0; i < binCount; i++) {
    const start = i * blockSize;
    const end = Math.min(channel.length, start + blockSize);
    let peak = 0;
    for (let j = start; j < end; j += step) {
      const abs = Math.abs(channel[j]);
      if (abs > peak) peak = abs;
    }
    if (peak > maxPeak) maxPeak = peak;
    peaks.push(peak);
  }

  return peaks.map((p) => p / maxPeak);
}

function inferAudioMimeType(file: File): string {
  const rawType = file.type.split(';')[0].trim().toLowerCase();
  if (rawType && rawType !== 'application/octet-stream') {
    if (rawType === 'video/mp4' || rawType === 'audio/x-m4a' || rawType === 'audio/m4a') {
      return 'audio/mp4';
    }
    return rawType;
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    flac: 'audio/flac',
    webm: 'audio/webm',
    aiff: 'audio/aiff',
    aif: 'audio/aiff',
    amr: 'audio/amr',
    '3gp': 'audio/3gpp',
  };
  return map[ext] || 'audio/mpeg';
}

export default function App() {
  const engineRef = useRef<StudioAudioEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new StudioAudioEngine();
  }

  const [activePage, setActivePage] = useState<StudioPage>('compose');
  const [targetGroove, setTargetGroove] = useState<string>('auto');

  const [bpm, setBpm] = useState<number>(INITIAL_HIGHLIFE_ARRANGEMENT.detected_bpm);
  const [grooveStyle, setGrooveStyle] = useState<string>(
    INITIAL_HIGHLIFE_ARRANGEMENT.groove_style
  );
  const [timeSignature, setTimeSignature] = useState<string>(
    INITIAL_HIGHLIFE_ARRANGEMENT.time_signature
  );
  const [tracks, setTracks] = useState<PercussionTrack[]>(() =>
    hydrateTracksWithFallbackSamples(INITIAL_HIGHLIFE_ARRANGEMENT.tracks)
  );

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [activeBar, setActiveBar] = useState(0);
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const [loopBars, setLoopBars] = useState<LoopBars>(4);
  const [blendRatio, setBlendRatio] = useState(0);

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedDurationSec, setUploadedDurationSec] = useState(0);
  const [wasTrimmedToFiveMin, setWasTrimmedToFiveMin] = useState(false);
  const [originalPeaks, setOriginalPeaks] = useState<number[]>([]);
  const [hasPlayableOriginal, setHasPlayableOriginal] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [freesoundKey, setFreesoundKey] = useState('');
  const [serverFreesoundConfigured, setServerFreesoundConfigured] = useState(false);
  const [isFreesoundModalOpen, setIsFreesoundModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [swappingTrackId, setSwappingTrackId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Global switchable metronome (sequencer + tap loop)
  const [metronomeEnabled, setMetronomeEnabled] = useState(true);

  // Tap Loop studio state
  const [tapPads, setTapPads] = useState<TapPad[]>(() => createDefaultTapPads());
  const [tapRecordArmed, setTapRecordArmed] = useState(true);
  const [tapSettings, setTapSettings] = useState<TapLoopSettings>(() => ({
    ...DEFAULT_TAP_LOOP_SETTINGS,
  }));
  const [tapPadError, setTapPadError] = useState<string | null>(null);
  const [flashingPadIds, setFlashingPadIds] = useState<Record<string, number>>({});
  const tapTempoHistoryRef = useRef<number[]>([]);
  const flashTimersRef = useRef<Record<string, number>>({});

  // Stem Builder state
  const [stemChannels, setStemChannels] = useState<StemChannel[]>(() =>
    createDefaultStemChannels()
  );
  const [selectedStemId, setSelectedStemId] = useState<string>('stem-rhodes');
  const [stemLoopSource, setStemLoopSource] = useState<StemLoopSource>('sequencer');
  const [stemLoopMuted, setStemLoopMuted] = useState(false);
  const [stemLoopVolumeDb, setStemLoopVolumeDb] = useState(-2);
  const [stemKey, setStemKey] = useState<MusicalKey>('C');
  const [stemScale, setStemScale] = useState<ScaleType>('major');

  useEffect(() => {
    engineRef.current?.updateState({
      bpm,
      loopBars,
      blendRatio,
      tracks,
      metronomeEnabled,
    });
  }, [bpm, loopBars, blendRatio, tracks, metronomeEnabled]);

  useEffect(() => {
    const mode =
      activePage === 'taploop'
        ? 'taploop'
        : activePage === 'stems'
        ? 'stems'
        : 'sequencer';
    engineRef.current?.updateTapLoopState({
      mode,
      tapPads,
      tapClickEnabled: metronomeEnabled,
      tapSettings,
    });
  }, [activePage, tapPads, metronomeEnabled, tapSettings]);

  useEffect(() => {
    engineRef.current?.updateStemState({
      stemChannels,
      stemLoopSource,
      stemLoopMuted,
      stemLoopVolumeDb,
    });
  }, [stemChannels, stemLoopSource, stemLoopMuted, stemLoopVolumeDb]);

  useEffect(() => {
    if (activePage === 'taploop' || activePage === 'stems') {
      void engineRef.current?.preloadTapPads(tapPads);
    }
    if (activePage === 'stems') {
      void engineRef.current?.preloadTracks(tracks);
    }
  }, [activePage, tapPads, tracks]);

  const triggerPadFlash = useCallback((padId: string) => {
    setFlashingPadIds((prev) => ({ ...prev, [padId]: Date.now() }));
    const existingTimer = flashTimersRef.current[padId];
    if (existingTimer) window.clearTimeout(existingTimer);
    flashTimersRef.current[padId] = window.setTimeout(() => {
      setFlashingPadIds((prev) => {
        const next = { ...prev };
        delete next[padId];
        return next;
      });
    }, 150);
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setOnStep((step) => {
      setCurrentStep(step);
    });
    engine.setOnTapPadTrigger((padId) => {
      triggerPadFlash(padId);
    });
    return () => {
      engine.stop();
    };
  }, [triggerPadFlash]);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.serverFreesoundConfigured) {
          setServerFreesoundConfigured(true);
        }
      })
      .catch(() => undefined);
  }, []);

  const fetchFreesoundSamplesForTracks = useCallback(
    async (targetTracks: PercussionTrack[], keyOverride?: string) => {
      const activeKey = (keyOverride ?? freesoundKey).trim();
      if (!activeKey && !serverFreesoundConfigured) return;

      const updated = await Promise.all(
        targetTracks.map(async (track) => {
          if (track.isClick) return track;
          try {
            const headers: Record<string, string> = {};
            if (activeKey) headers['x-freesound-key'] = activeKey;
            const res = await fetch(
              `/api/freesound/search?q=${encodeURIComponent(track.sample_search_query)}`,
              { headers }
            );
            if (!res.ok) return track;
            const data = (await res.json()) as {
              configured?: boolean;
              results?: SampleCandidate[];
            };
            if (data.results && data.results.length > 0) {
              const fallbackSamples = track.samples ?? [];
              return {
                ...track,
                samples: [...data.results, ...fallbackSamples].slice(0, 5),
                activeSampleIndex: 0,
              };
            }
          } catch {
            // Retain fallback samples seamlessly
          }
          return track;
        })
      );

      setTracks(updated);
      void engineRef.current?.preloadTracks(updated);
    },
    [freesoundKey, serverFreesoundConfigured]
  );

  const handleTogglePlay = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (isPlaying) {
      engine.stop();
      setIsPlaying(false);
      setCurrentStep(-1);
    } else {
      setIsPlaying(true);
      await engine.start();
    }
  }, [isPlaying]);

  const handleSelectPage = useCallback(
    (nextPage: StudioPage) => {
      const getGroup = (p: StudioPage) =>
        p === 'taploop' ? 'taploop' : p === 'stems' ? 'stems' : 'sequencer';
      if (getGroup(activePage) !== getGroup(nextPage) && isPlaying) {
        engineRef.current?.stop();
        setIsPlaying(false);
        setCurrentStep(-1);
      }
      setActivePage(nextPage);
    },
    [activePage, isPlaying]
  );

  const handlePadTap = useCallback(
    async (padId: string) => {
      const engine = engineRef.current;
      const pad = tapPads.find((p) => p.id === padId);
      if (!engine || !pad) return;

      triggerPadFlash(padId);
      setTapPadError(null);

      const { stepIndex, wasPlaying, tapCtxTime } = await engine.triggerTapPadNow(
        pad,
        94
      );

      if (!tapRecordArmed) return;

      setTapPads((prev) => {
        const nextPads = prev.map((p) => {
          if (p.id !== padId) return p;
          const nextSteps = [...p.steps];
          nextSteps[stepIndex] = 94;
          return { ...p, steps: nextSteps };
        });
        engine.updateTapLoopState({
          mode: 'taploop',
          tapPads: nextPads,
          tapClickEnabled: metronomeEnabled,
          tapSettings,
        });
        return nextPads;
      });

      if (!wasPlaying) {
        setIsPlaying(true);
        await engine.startTapLoopFromFirstTap(tapCtxTime);
      }
    },
    [tapPads, tapRecordArmed, metronomeEnabled, tapSettings, triggerPadFlash]
  );

  const handleAddTapPad = () => {
    setTapPads((prev) => [...prev, createNextTapPad(prev.length)]);
  };

  const handleRemoveTapPad = (padId: string) => {
    setTapPads((prev) => (prev.length > 6 ? prev.filter((p) => p.id !== padId) : prev));
  };

  const handleSelectTapPreset = (padId: string, preset: TapPresetOption) => {
    setTapPads((prev) =>
      prev.map((p) =>
        p.id === padId
          ? {
              ...p,
              name: preset.label,
              category: preset.category,
              accentColor: preset.accentColor,
              sample: preset.sample,
              customFileName: undefined,
            }
          : p
      )
    );
  };

  const handleReplaceTapPadFile = async (padId: string, file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      setTapPadError('Pad audio file must be under 15 MB.');
      return;
    }
    setTapPadError(null);
    try {
      const sample = await engineRef.current!.loadTapPadFile(padId, file);
      setTapPads((prev) =>
        prev.map((p) =>
          p.id === padId
            ? {
                ...p,
                name: sample.name,
                category: 'Phone Audio',
                customFileName: file.name,
                sample,
              }
            : p
        )
      );
      setStatusBanner(`Loaded "${file.name}" onto pad`);
      window.setTimeout(() => setStatusBanner(null), 2500);
    } catch (err) {
      setTapPadError(
        err instanceof Error ? err.message : 'Unable to load audio file onto pad.'
      );
    }
  };

  const handleToggleTapPadMute = (padId: string) => {
    setTapPads((prev) =>
      prev.map((p) => (p.id === padId ? { ...p, muted: !p.muted } : p))
    );
  };

  const handleClearTapPadSteps = (padId: string) => {
    setTapPads((prev) =>
      prev.map((p) => (p.id === padId ? { ...p, steps: createEmptySteps() } : p))
    );
  };

  const handleClearAllTapLoops = () => {
    setTapPads((prev) => prev.map((p) => ({ ...p, steps: createEmptySteps() })));
  };

  const handleTapPadReverbChange = (padId: string, reverb: number) => {
    const safeRev = clampUnit(reverb);
    setTapPads((prev) =>
      prev.map((p) => (p.id === padId ? { ...p, reverb: safeRev } : p))
    );
  };

  const handleToggleTapStep = (padId: string, stepIndex: number) => {
    setTapPads((prev) =>
      prev.map((p) => {
        if (p.id !== padId) return p;
        const nextSteps = [...p.steps];
        nextSteps[stepIndex] = (nextSteps[stepIndex] ?? 0) > 0 ? 0 : 88;
        return { ...p, steps: nextSteps };
      })
    );
  };

  const handleSetTapStepVelocity = (
    padId: string,
    stepIndex: number,
    velocity: number
  ) => {
    const safeVel = velocity <= 0 ? 0 : Math.min(100, Math.max(15, Math.round(velocity)));
    setTapPads((prev) =>
      prev.map((p) => {
        if (p.id !== padId) return p;
        const nextSteps = [...p.steps];
        nextSteps[stepIndex] = safeVel;
        return { ...p, steps: nextSteps };
      })
    );
  };

  const handleHumanizePad = (padId: string) => {
    setTapPads((prev) =>
      prev.map((p) => (p.id === padId ? { ...p, steps: humanizeSteps(p.steps) } : p))
    );
  };

  const handleHumanizeAllPads = () => {
    setTapPads((prev) =>
      prev.map((p) => ({ ...p, steps: humanizeSteps(p.steps) }))
    );
  };

  const handleUpdateTapSettings = (patch: Partial<TapLoopSettings>) => {
    setTapSettings((prev) => ({ ...prev, ...patch }));
  };

  const handleAssignBrowseSample = (padId: string, sample: SampleCandidate) => {
    setTapPadError(null);
    setTapPads((prev) =>
      prev.map((p) =>
        p.id === padId
          ? {
              ...p,
              name: sample.name,
              category: 'Freesound',
              sample,
              customFileName: undefined,
            }
          : p
      )
    );
    setStatusBanner(`Loaded "${sample.name}" onto pad`);
    window.setTimeout(() => setStatusBanner(null), 2500);
  };

  const handleAddNewPadWithSample = (sample: SampleCandidate) => {
    setTapPadError(null);
    setTapPads((prev) => {
      const base = createNextTapPad(prev.length);
      return [
        ...prev,
        {
          ...base,
          name: sample.name,
          category: 'Freesound',
          sample,
          customFileName: undefined,
        },
      ];
    });
    setStatusBanner(`Added "${sample.name}" as new pad box`);
    window.setTimeout(() => setStatusBanner(null), 2500);
  };

  const handleTapTempo = () => {
    const now = performance.now();
    const history = [...tapTempoHistoryRef.current, now].slice(-6);
    tapTempoHistoryRef.current = history;
    const detected = estimateBpmFromTapIntervals(history);
    if (detected !== null) {
      setBpm(detected);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        void handleTogglePlay();
        return;
      }

      if (activePage === 'taploop' && !e.repeat) {
        const digitMatch = /^Digit([1-9])$/.exec(e.code);
        if (digitMatch) {
          const padIdx = Number(digitMatch[1]) - 1;
          const targetPad = tapPads[padIdx];
          if (targetPad) {
            e.preventDefault();
            void handlePadTap(targetPad.id);
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTogglePlay, activePage, tapPads, handlePadTap]);

  const handleFileSelected = async (file: File) => {
    if (file.size > 60 * 1024 * 1024) {
      setAnalysisStatus('error');
      setAnalysisError('File exceeds 60 MB upload limit. Please use a compressed MP3, WAV, or M4A.');
      return;
    }
    setUploadedFile(file);
    setUploadedDurationSec(0);
    setWasTrimmedToFiveMin(false);
    setOriginalPeaks([]);
    setHasPlayableOriginal(false);
    setAnalysisStatus('idle');
    setAnalysisError(null);

    try {
      const result = await engineRef.current!.loadUploadedFile(file);
      setUploadedDurationSec(result.durationSeconds);
      setWasTrimmedToFiveMin(result.wasTrimmed);

      if (result.buffer) {
        setOriginalPeaks(extractWaveformPeaks(result.buffer));
        setHasPlayableOriginal(true);
        setBlendRatio(0.35);
      } else if (result.playableViaElement) {
        setHasPlayableOriginal(true);
        setBlendRatio(0.35);
      } else {
        setBlendRatio(0);
      }

      if (result.wasTrimmed) {
        setStatusBanner('Song exceeded 5 minutes and was cut to 5:00 max for smooth looping.');
        window.setTimeout(() => setStatusBanner(null), 4000);
      }
    } catch {
      setBlendRatio(0);
    }
  };

  const handleClearAudio = () => {
    engineRef.current?.clearUploadedAudio();
    setUploadedFile(null);
    setUploadedDurationSec(0);
    setWasTrimmedToFiveMin(false);
    setOriginalPeaks([]);
    setHasPlayableOriginal(false);
    setAnalysisStatus('idle');
    setAnalysisError(null);
    setBlendRatio(0);
  };

  const handleAnalyzeAudio = async (mode: AnalysisMode) => {
    if (!uploadedFile) return;
    setAnalysisStatus('analyzing');
    setAnalysisError(null);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 65_000);

    try {
      // Yield a paint frame so the spinner renders smoothly before work begins
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

      const decoded = engineRef.current?.getOriginalBuffer() ?? null;
      let uploadBody: Blob = uploadedFile;
      let uploadMime = inferAudioMimeType(uploadedFile);

      // For large/long songs already decoded (up to 5 min max), extract a compact 20s 16kHz groove clip (~640 KB)
      // so upload + Gemini transcription finishes fast without memory spikes or tab freezes.
      if (decoded && (uploadedFile.size > 1_800_000 || decoded.duration > 24)) {
        const startSec =
          decoded.duration > 30 ? Math.min(15, decoded.duration * 0.2) : 0;
        const compactWav = mixAudioBufferToMonoSegment(decoded, startSec, 20);
        uploadBody = new Blob([compactWav], { type: 'audio/wav' });
        uploadMime = 'audio/wav';
      } else if (!decoded && uploadedFile.size > 20 * 1024 * 1024) {
        throw new Error(
          'This file over 20 MB could not be decoded in browser to trim. Please try MP3 or WAV.'
        );
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'x-audio-mime': uploadMime,
        'x-file-name': encodeURIComponent(uploadedFile.name),
        'x-analysis-mode': mode,
      };
      if (mode === 'compose' && targetGroove) {
        headers['x-target-groove'] = targetGroove;
      }

      const res = await fetch('/api/analyze-audio-raw', {
        method: 'POST',
        headers,
        body: uploadBody,
        signal: controller.signal,
      });

      const payload = (await res.json()) as ArrangementBlueprint & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || `Server error (${res.status})`);
      }

      const hydrated = hydrateTracksWithFallbackSamples(payload.tracks);
      const nextBpm = clampBpm(payload.detected_bpm);
      setBpm(nextBpm);
      setGrooveStyle(payload.groove_style);
      setTimeSignature(payload.time_signature);
      setTracks(hydrated);
      setActiveBar(0);
      setAnalysisStatus('ready');
      setStatusBanner(
        mode === 'compose'
          ? `Composed ${payload.groove_style} (${nextBpm} BPM) for ${uploadedFile.name}`
          : `Extracted ${payload.groove_style} (${nextBpm} BPM) from ${uploadedFile.name}`
      );
      setActivePage('sequencer');

      void engineRef.current?.preloadTracks(hydrated);
      if (freesoundKey || serverFreesoundConfigured) {
        void fetchFreesoundSamplesForTracks(hydrated);
      }
    } catch (err) {
      setAnalysisStatus('error');
      if (err instanceof DOMException && err.name === 'AbortError') {
        setAnalysisError(
          'Analysis timed out. Please try a shorter 15-30 second clip or smaller MP3.'
        );
      } else {
        setAnalysisError(
          err instanceof Error ? err.message : 'Unable to analyze audio with Gemini.'
        );
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const handleToggleStep = (instrumentId: string, stepIndex: number, accent = false) => {
    setTracks((prev) =>
      prev.map((t) => {
        if (t.instrument_id !== instrumentId) return t;
        const nextSteps = [...t.steps];
        const current = nextSteps[stepIndex] ?? 0;
        if (accent) {
          nextSteps[stepIndex] = current >= 100 ? 0 : 100;
        } else {
          nextSteps[stepIndex] = current > 0 ? 0 : 88;
        }
        return { ...t, steps: nextSteps };
      })
    );
  };

  const handleToggleMute = (instrumentId: string) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.instrument_id === instrumentId ? { ...t, muted: !t.muted } : t
      )
    );
  };

  const handleToggleSolo = (instrumentId: string) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.instrument_id === instrumentId ? { ...t, soloed: !t.soloed } : t
      )
    );
  };

  const handleVolumeChange = (instrumentId: string, db: number) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.instrument_id === instrumentId ? { ...t, volume_db: clampVolumeDb(db) } : t
      )
    );
  };

  const handlePanChange = (instrumentId: string, pan: number) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.instrument_id === instrumentId ? { ...t, pan: clampPan(pan) } : t
      )
    );
  };

  const handleSwapSample = async (instrumentId: string) => {
    const target = tracks.find((t) => t.instrument_id === instrumentId);
    if (!target) return;

    setSwappingTrackId(instrumentId);
    try {
      let candidates = target.samples ?? [];

      const hasFreesoundAlready = candidates.some((s) => s.source === 'freesound');
      if (
        !target.isClick &&
        !hasFreesoundAlready &&
        (freesoundKey.trim() || serverFreesoundConfigured)
      ) {
        const headers: Record<string, string> = {};
        if (freesoundKey.trim()) headers['x-freesound-key'] = freesoundKey.trim();
        const res = await fetch(
          `/api/freesound/search?q=${encodeURIComponent(target.sample_search_query)}`,
          { headers }
        );
        if (res.ok) {
          const data = (await res.json()) as { results?: SampleCandidate[] };
          if (data.results && data.results.length > 0) {
            candidates = [...data.results, ...candidates].slice(0, 5);
          }
        }
      }

      const nextIndex =
        candidates.length > 0 ? ((target.activeSampleIndex ?? 0) + 1) % candidates.length : 0;

      const updatedTrack: PercussionTrack = {
        ...target,
        samples: candidates,
        activeSampleIndex: nextIndex,
      };

      setTracks((prev) =>
        prev.map((t) => (t.instrument_id === instrumentId ? updatedTrack : t))
      );

      await engineRef.current?.triggerPreview(updatedTrack);
    } finally {
      setSwappingTrackId(null);
    }
  };

  // Stem Builder Handlers
  const handleAddStemChannel = () => {
    const next = createNextStemChannel(stemChannels.length);
    setStemChannels((prev) => [...prev, next]);
    setSelectedStemId(next.id);
  };

  const handleRemoveStemChannel = (channelId: string) => {
    if (stemChannels.length <= 1) return;
    engineRef.current?.clearStemHumAudio(channelId);
    const remaining = stemChannels.filter((c) => c.id !== channelId);
    setStemChannels(remaining);
    if (selectedStemId === channelId && remaining[0]) {
      setSelectedStemId(remaining[0].id);
    }
  };

  const handleStemSoundChange = (channelId: string, soundId: KeyboardSoundId) => {
    setStemChannels((prev) =>
      prev.map((ch) =>
        ch.id === channelId
          ? {
              ...ch,
              soundId,
              voiceMode: 'keyboard',
            }
          : ch
      )
    );
    void engineRef.current?.triggerKeyboardNoteNow(soundId, 60, 88, 0.35);
  };

  const handleStemVoiceModeChange = (channelId: string, voiceMode: StemVoiceMode) => {
    setStemChannels((prev) =>
      prev.map((ch) => (ch.id === channelId ? { ...ch, voiceMode } : ch))
    );
  };

  const handleToggleStemMute = (channelId: string) => {
    setStemChannels((prev) =>
      prev.map((ch) => (ch.id === channelId ? { ...ch, muted: !ch.muted } : ch))
    );
  };

  const handleToggleStemSolo = (channelId: string) => {
    setStemChannels((prev) =>
      prev.map((ch) => (ch.id === channelId ? { ...ch, soloed: !ch.soloed } : ch))
    );
  };

  const handleStemVolumeChange = (channelId: string, db: number) => {
    setStemChannels((prev) =>
      prev.map((ch) =>
        ch.id === channelId ? { ...ch, volume_db: clampVolumeDb(db) } : ch
      )
    );
  };

  const handleToggleStemNote = (
    channelId: string,
    step: number,
    midi: number,
    durationSteps: number
  ) => {
    const ch = stemChannels.find((c) => c.id === channelId);
    const wasPresent = ch?.notes.some((n) => n.step === step && n.midi === midi);
    setStemChannels((prev) =>
      prev.map((c) =>
        c.id === channelId
          ? { ...c, notes: toggleStemNote(c.notes, step, midi, durationSteps, 90) }
          : c
      )
    );
    if (!wasPresent && ch) {
      void engineRef.current?.triggerKeyboardNoteNow(
        ch.soundId,
        midi,
        90,
        0.32,
        ch.volume_db,
        ch.pan
      );
    }
  };

  const handleRecordStemNote = useCallback((channelId: string, note: StemNote) => {
    setStemChannels((prev) =>
      prev.map((c) =>
        c.id === channelId ? { ...c, notes: upsertStemNote(c.notes, note) } : c
      )
    );
  }, []);

  const handleClearStemNotes = (channelId: string) => {
    setStemChannels((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, notes: [] } : c))
    );
  };

  const handleFixOffKeyNotes = (channelId: string) => {
    setStemChannels((prev) =>
      prev.map((c) =>
        c.id === channelId
          ? {
              ...c,
              voiceMode: 'keyboard',
              notes: snapNotesToScale(c.notes, stemKey, stemScale),
            }
          : c
      )
    );
    setStatusBanner(`Snapped notes to ${stemKey} ${stemScale} and switched to keyboard voice`);
    window.setTimeout(() => setStatusBanner(null), 2800);
  };

  const handleTransposeStem = (channelId: string, semitones: number) => {
    setStemChannels((prev) =>
      prev.map((c) =>
        c.id === channelId
          ? { ...c, notes: transposeNotes(c.notes, semitones) }
          : c
      )
    );
  };

  const handlePlayKeyboardKey = async (midi: number, recordToRoll: boolean) => {
    const active = stemChannels.find((c) => c.id === selectedStemId) ?? stemChannels[0];
    if (!active || !engineRef.current) return;

    const timing = await engineRef.current.triggerKeyboardNoteNow(
      active.soundId,
      midi,
      92,
      0.38,
      active.volume_db,
      active.pan
    );

    if (recordToRoll && timing.wasPlaying) {
      handleRecordStemNote(active.id, {
        step: timing.stepIndex,
        midi,
        durationSteps: 2,
        velocity: 92,
      });
    }
  };

  const handleEnsurePlaying = async () => {
    if (!engineRef.current || isPlaying) return;
    setIsPlaying(true);
    await engineRef.current.start();
  };

  const handleSaveHumAudio = async (channelId: string, blob: Blob) => {
    try {
      await engineRef.current?.loadStemHumAudio(channelId, blob);
      setStemChannels((prev) =>
        prev.map((ch) =>
          ch.id === channelId ? { ...ch, hasHumAudio: true } : ch
        )
      );
    } catch {
      // If MediaRecorder codec cannot be decoded on this browser, keep MIDI notes cleanly
    }
  };

  const handleClearHumAudio = (channelId: string) => {
    engineRef.current?.clearStemHumAudio(channelId);
    setStemChannels((prev) =>
      prev.map((ch) =>
        ch.id === channelId
          ? { ...ch, hasHumAudio: false, voiceMode: 'keyboard' }
          : ch
      )
    );
  };

  const handleConfirmExport = async (options: ExportOptions) => {
    if (!engineRef.current || isExporting) return;
    setIsExporting(true);
    setStatusBanner(null);
    try {
      const isTapExport = activePage === 'taploop';
      const isStemsExport = activePage === 'stems';
      const wavBlob = await engineRef.current.exportWavWithClick({
        bpm,
        loopBars,
        tracks,
        blendRatio,
        tapPads,
        tapSettings,
        exportTapLoop: isTapExport,
        exportStems: isStemsExport,
        stemChannels,
        stemLoopSource,
        stemLoopMuted,
        exportOptions: options,
      });
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      const slug = isStemsExport
        ? 'stem-mix'
        : isTapExport
        ? 'tap-loop'
        : grooveStyle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const durLabel =
        options.durationMode === 'minutes' ? `${options.minutes}min` : `${loopBars}bars`;
      const fmtLabel = options.format === 'wav-compact' ? '22khz' : '44khz';
      a.href = url;
      a.download = `praiseloop-${slug}-${bpm}bpm-${durLabel}-${fmtLabel}.wav`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setIsExportModalOpen(false);
      setStatusBanner(
        `Exported ${durLabel} ${bpm} BPM ${options.format === 'wav-compact' ? 'Compact WAV' : 'Studio WAV'}${options.includeClick ? ' + Click' : ''}`
      );
      window.setTimeout(() => setStatusBanner(null), 4000);
    } catch {
      setStatusBanner('WAV export failed. Check sample state and retry.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleApplyVoiceResponse = (res: VoiceCommandResponse) => {
    const actions = Array.isArray(res.actions) ? res.actions : [];
    let currentPageTarget: StudioPage = activePage;

    for (const action of actions) {
      switch (action.type) {
        case 'set_bpm': {
          if (typeof action.bpm === 'number') {
            setBpm(clampBpm(action.bpm));
          }
          break;
        }

        case 'set_metronome': {
          if (typeof action.enabled === 'boolean') {
            setMetronomeEnabled(action.enabled);
          }
          break;
        }

        case 'set_loop_bars': {
          if (action.bars === 1 || action.bars === 2 || action.bars === 4) {
            setLoopBars(action.bars);
            if (activeBar >= action.bars) setActiveBar(0);
          }
          break;
        }

        case 'navigate_page': {
          if (
            action.page === 'compose' ||
            action.page === 'extract' ||
            action.page === 'taploop' ||
            action.page === 'sequencer' ||
            action.page === 'stems'
          ) {
            currentPageTarget = action.page;
            handleSelectPage(action.page);
          }
          break;
        }

        case 'set_fx': {
          setTapSettings((prev) => ({
            ...prev,
            ...(typeof action.cutoffHz === 'number'
              ? { cutoffHz: clampCutoffHz(action.cutoffHz) }
              : {}),
            ...(typeof action.masterReverb === 'number'
              ? { masterReverb: clampUnit(action.masterReverb) }
              : {}),
          }));
          break;
        }

        case 'open_export': {
          setIsExportModalOpen(true);
          break;
        }

        case 'mute_solo_track': {
          const keyword = action.instrument_keyword || action.display_name || '';
          if (currentPageTarget === 'taploop') {
            setTapPads((prev) => {
              const idx = findMatchingTapPadIndex(prev, keyword);
              if (idx < 0) return prev;
              return prev.map((p, i) =>
                i === idx
                  ? { ...p, muted: typeof action.muted === 'boolean' ? action.muted : !p.muted }
                  : p
              );
            });
          } else {
            setTracks((prev) => {
              const idx = findMatchingTrackIndex(prev, keyword);
              if (idx < 0) return prev;
              return prev.map((t, i) =>
                i === idx
                  ? {
                      ...t,
                      muted: typeof action.muted === 'boolean' ? action.muted : t.muted,
                      soloed: typeof action.soloed === 'boolean' ? action.soloed : t.soloed,
                    }
                  : t
              );
            });
          }
          break;
        }

        case 'set_groove_pattern': {
          const keyword = action.instrument_keyword || action.display_name || 'shekere';
          const expandedSteps = expandPatternTo64Steps(action.steps);
          const patMode = action.mode || 'replace';

          if (currentPageTarget === 'taploop') {
            setTapPads((prev) => {
              const foundIdx = findMatchingTapPadIndex(prev, keyword);
              const targetIdx = foundIdx >= 0 ? foundIdx : 0;
              const nextPads = prev.map((pad, idx) => {
                if (idx !== targetIdx) return pad;
                const nextSteps =
                  patMode === 'clear'
                    ? createEmptySteps()
                    : patMode === 'layer'
                    ? pad.steps.map((v, sIdx) => Math.max(v ?? 0, expandedSteps[sIdx] ?? 0))
                    : expandedSteps;
                return { ...pad, muted: false, steps: nextSteps };
              });
              void engineRef.current?.preloadTapPads(nextPads);
              return nextPads;
            });
          } else {
            setTracks((prev) => {
              const foundIdx = findMatchingTrackIndex(prev, keyword);
              let nextTracks: PercussionTrack[];
              if (foundIdx >= 0) {
                nextTracks = prev.map((track, idx) => {
                  if (idx !== foundIdx) return track;
                  const nextSteps =
                    patMode === 'clear'
                      ? new Array<number>(64).fill(0)
                      : patMode === 'layer'
                      ? track.steps.map((v, sIdx) => Math.max(v ?? 0, expandedSteps[sIdx] ?? 0))
                      : expandedSteps;
                  return { ...track, muted: false, steps: nextSteps };
                });
              } else {
                const newTrack: PercussionTrack = {
                  instrument_id: keyword.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
                  display_name: action.display_name || keyword,
                  sample_search_query: keyword,
                  volume_db: -2,
                  pan: 0,
                  steps: patMode === 'clear' ? new Array<number>(64).fill(0) : expandedSteps,
                  isClick: false,
                  muted: false,
                  soloed: false,
                  samples: matchFallbackCategory(keyword, keyword),
                  activeSampleIndex: 0,
                };
                const firstClickIdx = prev.findIndex((t) => t.isClick);
                if (firstClickIdx >= 0) {
                  nextTracks = [
                    ...prev.slice(0, firstClickIdx),
                    newTrack,
                    ...prev.slice(firstClickIdx),
                  ];
                } else {
                  nextTracks = [...prev, newTrack];
                }
              }
              void engineRef.current?.preloadTracks(nextTracks);
              return nextTracks;
            });

            if (currentPageTarget === 'compose' || currentPageTarget === 'extract') {
              currentPageTarget = 'sequencer';
              setActivePage('sequencer');
            }
          }
          break;
        }

        case 'transport': {
          if (action.state === 'stop') {
            engineRef.current?.stop();
            setIsPlaying(false);
            setCurrentStep(-1);
          } else if (action.state === 'play') {
            window.setTimeout(() => {
              setIsPlaying(true);
              void engineRef.current?.start();
            }, 60);
          }
          break;
        }
      }
    }

    if (res.spoken_summary) {
      setStatusBanner(res.spoken_summary);
      window.setTimeout(() => setStatusBanner(null), 4500);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#09090B] text-zinc-100 pb-32">
      <StudioHeader
        bpm={bpm}
        onBpmChange={setBpm}
        grooveStyle={grooveStyle}
        timeSignature={timeSignature}
        isPlaying={isPlaying}
        freesoundConnected={Boolean(freesoundKey.trim() || serverFreesoundConfigured)}
        onOpenFreesoundModal={() => setIsFreesoundModalOpen(true)}
        onExportWav={() => setIsExportModalOpen(true)}
        isExporting={isExporting}
      />

      <main className="mx-auto max-w-[1440px] space-y-4 px-3 pt-4 sm:space-y-5 sm:px-6 sm:pt-5">
        {statusBanner && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-medium text-amber-300"
          >
            <span>{statusBanner}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="shrink-0 text-amber-200 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {(activePage === 'compose' || activePage === 'extract') && (
          <WaveformDropzone
            mode={activePage}
            targetGroove={targetGroove}
            onTargetGrooveChange={setTargetGroove}
            uploadedFileName={uploadedFile?.name ?? null}
            uploadedDurationSec={uploadedDurationSec}
            wasTrimmedToFiveMin={wasTrimmedToFiveMin}
            originalPeaks={originalPeaks}
            hasPlayableOriginal={hasPlayableOriginal}
            tracks={tracks}
            currentStep={currentStep}
            loopBars={loopBars}
            analysisStatus={analysisStatus}
            analysisError={analysisError}
            onFileSelected={handleFileSelected}
            onAnalyzeAudio={handleAnalyzeAudio}
            onClearAudio={handleClearAudio}
            onOpenSequencer={() => setActivePage('sequencer')}
          />
        )}

        {activePage === 'taploop' && (
          <TapLoopStudio
            pads={tapPads}
            bpm={bpm}
            loopBars={loopBars}
            isPlaying={isPlaying}
            currentStep={currentStep}
            activeBar={activeBar}
            followPlayhead={followPlayhead}
            recordArmed={tapRecordArmed}
            clickEnabled={metronomeEnabled}
            tapSettings={tapSettings}
            flashingPadIds={flashingPadIds}
            padError={tapPadError}
            onSelectBar={(bar) => {
              setFollowPlayhead(false);
              setActiveBar(bar);
            }}
            onToggleFollowPlayhead={() => setFollowPlayhead((f) => !f)}
            onToggleRecordArmed={() => setTapRecordArmed((v) => !v)}
            onToggleClick={() => setMetronomeEnabled((v) => !v)}
            onTapTempo={handleTapTempo}
            onPadTap={(padId) => void handlePadTap(padId)}
            onAddPad={handleAddTapPad}
            onRemovePad={handleRemoveTapPad}
            onSelectPreset={handleSelectTapPreset}
            onReplacePadFile={(padId, file) => void handleReplaceTapPadFile(padId, file)}
            onTogglePadMute={handleToggleTapPadMute}
            onClearPadSteps={handleClearTapPadSteps}
            onClearAllPads={handleClearAllTapLoops}
            onPadReverbChange={handleTapPadReverbChange}
            onTogglePadStep={handleToggleTapStep}
            onSetPadStepVelocity={handleSetTapStepVelocity}
            onHumanizePad={handleHumanizePad}
            onHumanizeAll={handleHumanizeAllPads}
            onUpdateTapSettings={handleUpdateTapSettings}
            freesoundKey={freesoundKey}
            onAssignBrowseSample={handleAssignBrowseSample}
            onAddNewPadWithSample={handleAddNewPadWithSample}
            onOpenFreesoundModal={() => setIsFreesoundModalOpen(true)}
          />
        )}

        {activePage === 'sequencer' && (
          <SequencerMatrix
            tracks={tracks}
            activeBar={activeBar}
            onSelectBar={(bar) => {
              setFollowPlayhead(false);
              setActiveBar(bar);
            }}
            followPlayhead={followPlayhead}
            onToggleFollowPlayhead={() => setFollowPlayhead((f) => !f)}
            loopBars={loopBars}
            currentStep={currentStep}
            swappingTrackId={swappingTrackId}
            onToggleStep={handleToggleStep}
            onToggleMute={handleToggleMute}
            onToggleSolo={handleToggleSolo}
            onVolumeChange={handleVolumeChange}
            onPanChange={handlePanChange}
            onSwapSample={handleSwapSample}
            onPreviewTrack={(track) => {
              void engineRef.current?.triggerPreview(track);
            }}
          />
        )}

        {activePage === 'stems' && (
          <StemBuilderStudio
            bpm={bpm}
            loopBars={loopBars}
            isPlaying={isPlaying}
            currentStep={currentStep}
            activeBar={activeBar}
            followPlayhead={followPlayhead}
            tracks={tracks}
            tapPads={tapPads}
            stemLoopSource={stemLoopSource}
            stemLoopMuted={stemLoopMuted}
            stemLoopVolumeDb={stemLoopVolumeDb}
            stemChannels={stemChannels}
            selectedChannelId={selectedStemId}
            rootKey={stemKey}
            scaleType={stemScale}
            onSelectBar={(bar) => {
              setFollowPlayhead(false);
              setActiveBar(bar);
            }}
            onToggleFollowPlayhead={() => setFollowPlayhead((f) => !f)}
            onSelectLoopSource={setStemLoopSource}
            onToggleLoopMuted={() => setStemLoopMuted((v) => !v)}
            onLoopVolumeChange={setStemLoopVolumeDb}
            onSelectChannel={setSelectedStemId}
            onAddChannel={handleAddStemChannel}
            onRemoveChannel={handleRemoveStemChannel}
            onChannelSoundChange={handleStemSoundChange}
            onChannelVoiceModeChange={handleStemVoiceModeChange}
            onChannelMuteToggle={handleToggleStemMute}
            onChannelSoloToggle={handleToggleStemSolo}
            onChannelVolumeChange={handleStemVolumeChange}
            onToggleNote={handleToggleStemNote}
            onRecordNote={handleRecordStemNote}
            onClearChannelNotes={handleClearStemNotes}
            onFixOffKeyNotes={handleFixOffKeyNotes}
            onTransposeChannel={handleTransposeStem}
            onRootKeyChange={setStemKey}
            onScaleTypeChange={setStemScale}
            onPlayKeyboardKey={(midi, rec) => void handlePlayKeyboardKey(midi, rec)}
            onEnsurePlaying={handleEnsurePlaying}
            getPlaybackTiming={() => engineRef.current!.getCurrentPlaybackTiming()}
            onSaveHumAudio={handleSaveHumAudio}
            onClearHumAudio={handleClearHumAudio}
          />
        )}
      </main>

      <VoiceDirectorFab
        bpm={bpm}
        loopBars={loopBars}
        activePage={activePage}
        metronomeEnabled={metronomeEnabled}
        tracks={tracks}
        tapPads={tapPads}
        onApplyVoiceResponse={handleApplyVoiceResponse}
      />

      <BottomDock
        activePage={activePage}
        onSelectPage={handleSelectPage}
        isPlaying={isPlaying}
        onTogglePlay={() => void handleTogglePlay()}
        currentStep={currentStep}
        loopBars={loopBars}
        onLoopBarsChange={(bars) => {
          setLoopBars(bars);
          if (activeBar >= bars) setActiveBar(0);
        }}
        metronomeEnabled={metronomeEnabled}
        onToggleMetronome={() => setMetronomeEnabled((v) => !v)}
        blendRatio={blendRatio}
        onBlendChange={setBlendRatio}
        hasOriginalAudio={hasPlayableOriginal}
      />

      <ExportModal
        key={isExportModalOpen ? 'export-open' : 'export-closed'}
        isOpen={isExportModalOpen}
        isExporting={isExporting}
        bpm={bpm}
        loopBars={loopBars}
        hasOriginalAudio={hasPlayableOriginal}
        defaultCutoffHz={tapSettings.cutoffHz}
        defaultReverb={tapSettings.masterReverb}
        defaultReverbSize={tapSettings.reverbSize}
        defaultIncludeClick={metronomeEnabled}
        activeSourceLabel={
          activePage === 'stems'
            ? 'Stem Builder Multi-Track Mix'
            : activePage === 'taploop'
            ? 'Tap Loop Mix'
            : `${grooveStyle} Sequencer`
        }
        onExport={(opts) => void handleConfirmExport(opts)}
        onClose={() => setIsExportModalOpen(false)}
      />

      <FreesoundModal
        key={isFreesoundModalOpen ? 'open' : 'closed'}
        isOpen={isFreesoundModalOpen}
        currentKey={freesoundKey}
        onSave={(key) => {
          setFreesoundKey(key);
          if (key) {
            void fetchFreesoundSamplesForTracks(tracks, key);
          }
        }}
        onClose={() => setIsFreesoundModalOpen(false)}
      />
    </div>
  );
}
