import { useCallback, useEffect, useRef, useState } from 'react';
import { StudioAudioEngine } from './audio/AudioEngine';
import { FreesoundModal } from './components/FreesoundModal';
import { SequencerMatrix } from './components/SequencerMatrix';
import { StudioHeader } from './components/StudioHeader';
import { TransportDock } from './components/TransportDock';
import { WaveformDropzone } from './components/WaveformDropzone';
import { INITIAL_HIGHLIFE_ARRANGEMENT } from './data/presets';
import type {
  AnalysisStatus,
  ArrangementBlueprint,
  GeminiAnalysisModel,
  LoopBars,
  PercussionTrack,
  SampleCandidate,
} from './types/sequencer';
import {
  clampBpm,
  clampPan,
  clampVolumeDb,
  hydrateTracksWithFallbackSamples,
} from './utils/sequencerLogic';

function extractWaveformPeaks(buffer: AudioBuffer, binCount = 96): number[] {
  const channel = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(channel.length / binCount));
  const peaks: number[] = [];
  let maxPeak = 0.001;

  for (let i = 0; i < binCount; i++) {
    const start = i * blockSize;
    const end = Math.min(channel.length, start + blockSize);
    let peak = 0;
    for (let j = start; j < end; j += 4) {
      const abs = Math.abs(channel[j]);
      if (abs > peak) peak = abs;
    }
    if (peak > maxPeak) maxPeak = peak;
    peaks.push(peak);
  }

  return peaks.map((p) => p / maxPeak);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export default function App() {
  const engineRef = useRef<StudioAudioEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new StudioAudioEngine();
  }

  const [bpm, setBpm] = useState<number>(INITIAL_HIGHLIFE_ARRANGEMENT.detected_bpm);
  const [grooveStyle, setGrooveStyle] = useState<string>(
    INITIAL_HIGHLIFE_ARRANGEMENT.groove_style
  );
  const [timeSignature, setTimeSignature] = useState<string>(
    INITIAL_HIGHLIFE_ARRANGEMENT.time_signature
  );
  const [hasExistingPercussion, setHasExistingPercussion] = useState<boolean>(
    INITIAL_HIGHLIFE_ARRANGEMENT.has_existing_percussion
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
  const [originalPeaks, setOriginalPeaks] = useState<number[]>([]);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] =
    useState<GeminiAnalysisModel>('gemini-2.5-flash');

  const [freesoundKey, setFreesoundKey] = useState('');
  const [serverFreesoundConfigured, setServerFreesoundConfigured] = useState(false);
  const [isFreesoundModalOpen, setIsFreesoundModalOpen] = useState(false);
  const [swappingTrackId, setSwappingTrackId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  // Sync audio engine state on every change
  useEffect(() => {
    engineRef.current?.updateState({
      bpm,
      loopBars,
      blendRatio,
      tracks,
    });
  }, [bpm, loopBars, blendRatio, tracks]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setOnStep((step) => {
      setCurrentStep(step);
    });
    return () => {
      engine.stop();
    };
  }, []);

  // Check if server already has FREESOUND_API_KEY configured
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

  // Global Spacebar transport shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      void handleTogglePlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTogglePlay]);

  const handleFileSelected = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      setAnalysisStatus('error');
      setAnalysisError('File exceeds 20 MB limit. Please upload a shorter clip or compressed MP3.');
      return;
    }
    setUploadedFile(file);
    setAnalysisStatus('idle');
    setAnalysisError(null);

    try {
      const arrayBuf = await file.arrayBuffer();
      const decoded = await engineRef.current!.decodeUploadedAudio(arrayBuf);
      setOriginalPeaks(extractWaveformPeaks(decoded));
      setBlendRatio(0.35);
    } catch {
      setAnalysisStatus('error');
      setAnalysisError('Could not decode audio file in browser. Please try WAV, MP3, or M4A.');
    }
  };

  const handleClearAudio = () => {
    engineRef.current?.clearUploadedAudio();
    setUploadedFile(null);
    setOriginalPeaks([]);
    setAnalysisStatus('idle');
    setAnalysisError(null);
    setBlendRatio(0);
  };

  const handleAnalyzeAudio = async () => {
    if (!uploadedFile) return;
    setAnalysisStatus('analyzing');
    setAnalysisError(null);

    try {
      const buffer = await uploadedFile.arrayBuffer();
      const audioBase64 = arrayBufferToBase64(buffer);

      const res = await fetch('/api/analyze-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64,
          mimeType: uploadedFile.type || 'audio/mpeg',
          fileName: uploadedFile.name,
          model: selectedModel,
        }),
      });

      const payload = (await res.json()) as ArrangementBlueprint & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || `Server error (${res.status})`);
      }

      const hydrated = hydrateTracksWithFallbackSamples(payload.tracks);
      setBpm(clampBpm(payload.detected_bpm));
      setGrooveStyle(payload.groove_style);
      setTimeSignature(payload.time_signature);
      setHasExistingPercussion(payload.has_existing_percussion);
      setTracks(hydrated);
      setActiveBar(0);
      setAnalysisStatus('ready');

      void engineRef.current?.preloadTracks(hydrated);
      if (freesoundKey || serverFreesoundConfigured) {
        void fetchFreesoundSamplesForTracks(hydrated);
      }
    } catch (err) {
      setAnalysisStatus('error');
      setAnalysisError(
        err instanceof Error ? err.message : 'Unable to analyze audio with Gemini.'
      );
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

      // If Freesound key is active and we haven't pulled Freesound results yet for this track
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

  const handleExportWav = async () => {
    if (!engineRef.current || isExporting) return;
    setIsExporting(true);
    setExportMessage(null);
    try {
      const wavBlob = await engineRef.current.exportWavWithClick({
        bpm,
        loopBars,
        tracks,
        blendRatio,
      });
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      const slug = grooveStyle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      a.href = url;
      a.download = `praiseloop-${slug}-${bpm}bpm-${loopBars}bars-click.wav`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportMessage(`Exported ${loopBars}-bar ${bpm} BPM WAV + Click`);
      window.setTimeout(() => setExportMessage(null), 3500);
    } catch {
      setExportMessage('WAV export failed. Check sample state and retry.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 pb-28">
      <StudioHeader
        bpm={bpm}
        onBpmChange={setBpm}
        grooveStyle={grooveStyle}
        timeSignature={timeSignature}
        isPlaying={isPlaying}
        freesoundConnected={Boolean(freesoundKey.trim() || serverFreesoundConfigured)}
        onOpenFreesoundModal={() => setIsFreesoundModalOpen(true)}
        onExportWav={handleExportWav}
        isExporting={isExporting}
      />

      <main className="mx-auto max-w-[1440px] space-y-5 px-4 pt-5 sm:px-6">
        {exportMessage && (
          <div
            role="status"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-medium text-amber-300"
          >
            {exportMessage}
          </div>
        )}

        <WaveformDropzone
          uploadedFileName={uploadedFile?.name ?? null}
          originalPeaks={originalPeaks}
          tracks={tracks}
          currentStep={currentStep}
          loopBars={loopBars}
          analysisStatus={analysisStatus}
          analysisError={analysisError}
          hasExistingPercussion={hasExistingPercussion}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          onFileSelected={handleFileSelected}
          onAnalyzeAudio={handleAnalyzeAudio}
          onClearAudio={handleClearAudio}
        />

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
      </main>

      <TransportDock
        isPlaying={isPlaying}
        onTogglePlay={() => void handleTogglePlay()}
        currentStep={currentStep}
        loopBars={loopBars}
        onLoopBarsChange={(bars) => {
          setLoopBars(bars);
          if (activeBar >= bars) setActiveBar(0);
        }}
        blendRatio={blendRatio}
        onBlendChange={setBlendRatio}
        hasOriginalAudio={Boolean(uploadedFile)}
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
