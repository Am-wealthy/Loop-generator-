import React, { useEffect, useRef, useState } from 'react';
import {
  Upload,
  Sparkles,
  Music2,
  Trash2,
  AlertCircle,
  Loader2,
  CheckCircle2,
  ArrowRight,
  Disc3,
} from 'lucide-react';
import type { AnalysisMode, AnalysisStatus, LoopBars, PercussionTrack } from '../types/sequencer';
import { getActiveStepCount } from '../utils/sequencerLogic';

interface WaveformDropzoneProps {
  mode: AnalysisMode;
  targetGroove: string;
  onTargetGrooveChange: (groove: string) => void;
  uploadedFileName: string | null;
  uploadedDurationSec: number;
  wasTrimmedToFiveMin: boolean;
  originalPeaks: number[];
  hasPlayableOriginal: boolean;
  tracks: PercussionTrack[];
  currentStep: number;
  loopBars: LoopBars;
  analysisStatus: AnalysisStatus;
  analysisError: string | null;
  onFileSelected: (file: File) => void;
  onAnalyzeAudio: (mode: AnalysisMode) => void;
  onClearAudio: () => void;
  onOpenSequencer: () => void;
}

const GROOVE_OPTIONS = [
  { value: 'auto', label: 'Auto-Detect Feel' },
  { value: 'Nigerian Highlife Praise', label: 'Nigerian Highlife' },
  { value: '12/8 Afro-Praise', label: '12/8 Afro-Praise' },
  { value: 'Alujo', label: 'Alujo Groove' },
  { value: 'Makossa', label: 'Makossa Praise' },
];

export const WaveformDropzone: React.FC<WaveformDropzoneProps> = ({
  mode,
  targetGroove,
  onTargetGrooveChange,
  uploadedFileName,
  uploadedDurationSec,
  wasTrimmedToFiveMin,
  originalPeaks,
  hasPlayableOriginal,
  tracks,
  currentStep,
  loopBars,
  analysisStatus,
  analysisError,
  onFileSelected,
  onAnalyzeAudio,
  onClearAudio,
  onOpenSequencer,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const percCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const activeSteps = getActiveStepCount(loopBars);
  const playheadRatio =
    currentStep >= 0 ? (currentStep % activeSteps) / Math.max(1, activeSteps) : -1;

  const isCompose = mode === 'compose';

  // Draw Top Waveform: Uploaded Original Audio (decoded peaks OR sleek live-blend track envelope)
  useEffect(() => {
    const canvas = origCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    if (originalPeaks.length === 0) {
      const bars = 64;
      const gap = width / bars;
      for (let i = 0; i < bars; i++) {
        const wave = uploadedFileName
          ? 0.25 + 0.45 * Math.abs(Math.sin(i * 0.38) * Math.cos(i * 0.17))
          : 0.12 + ((i * 7) % 9) * 0.02;
        const h = Math.max(4, wave * (height - 14));
        const ratio = i / bars;
        const isPassed = playheadRatio >= 0 && ratio <= playheadRatio;
        ctx.fillStyle = uploadedFileName
          ? isPassed
            ? '#F59E0B'
            : 'rgba(245, 158, 11, 0.35)'
          : 'rgba(113, 113, 122, 0.25)';
        ctx.fillRect(i * gap + 1, height / 2 - h / 2, Math.max(2, gap - 3), h);
      }
      if (uploadedFileName && playheadRatio >= 0) {
        const px = playheadRatio * width;
        ctx.strokeStyle = '#FBBF24';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, 2);
        ctx.lineTo(px, height - 2);
        ctx.stroke();
      }
      return;
    }

    const barCount = originalPeaks.length;
    const stepW = width / barCount;
    const barW = Math.max(2, stepW - 2);

    for (let i = 0; i < barCount; i++) {
      const amp = Math.max(0.06, originalPeaks[i]);
      const barH = amp * (height - 10);
      const x = i * stepW + (stepW - barW) / 2;
      const y = (height - barH) / 2;
      const ratio = i / barCount;
      const isPassed = playheadRatio >= 0 && ratio <= playheadRatio;
      ctx.fillStyle = isPassed ? '#F59E0B' : 'rgba(245, 158, 11, 0.42)';
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 1.5);
      ctx.fill();
    }

    if (playheadRatio >= 0) {
      const px = playheadRatio * width;
      ctx.strokeStyle = '#FBBF24';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 2);
      ctx.lineTo(px, height - 2);
      ctx.stroke();
    }
  }, [originalPeaks, playheadRatio, uploadedFileName]);

  // Draw Bottom Waveform: Extracted / Active Percussion Loop Energy
  useEffect(() => {
    const canvas = percCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const anySoloed = tracks.some((t) => Boolean(t.soloed));
    const stepW = width / activeSteps;
    const barW = Math.max(2, stepW - 2);

    for (let s = 0; s < activeSteps; s++) {
      let stepEnergy = 0;
      for (const track of tracks) {
        if (track.isClick) continue;
        if (track.muted) continue;
        if (anySoloed && !track.soloed) continue;
        stepEnergy += (track.steps[s] ?? 0) / 100;
      }
      const norm = Math.min(1, stepEnergy / 2.8);
      const barH = Math.max(4, norm * (height - 10));
      const x = s * stepW + (stepW - barW) / 2;
      const y = (height - barH) / 2;

      const isActiveStep = currentStep === s;
      const isBeat = s % 4 === 0;
      if (isActiveStep) {
        ctx.fillStyle = '#34D399';
      } else if (norm > 0.05) {
        ctx.fillStyle = isBeat ? 'rgba(16, 185, 129, 0.85)' : 'rgba(16, 185, 129, 0.45)';
      } else {
        ctx.fillStyle = 'rgba(63, 63, 70, 0.35)';
      }
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 1.5);
      ctx.fill();
    }

    if (playheadRatio >= 0) {
      const px = playheadRatio * width;
      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 2);
      ctx.lineTo(px, height - 2);
      ctx.stroke();
    }
  }, [tracks, activeSteps, currentStep, playheadRatio]);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  return (
    <div className="space-y-5">
      {/* Page Intro Banner */}
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-zinc-800 bg-[#111114]/90 p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
            {isCompose ? (
              <>
                <Sparkles className="h-4 w-4 shrink-0" />
                <span>Compose Percussion for Drumless Music</span>
              </>
            ) : (
              <>
                <Disc3 className="h-4 w-4 shrink-0" />
                <span>Exact Loop Extraction from Song</span>
              </>
            )}
          </div>
          <h1 className="font-display mt-1 text-xl font-bold tracking-tight text-zinc-100 sm:text-2xl">
            {isCompose
              ? 'Add Authentic Praise Percussion to Vocals or Keys'
              : 'Recreate the Exact Percussion Loop Used in Your Song'}
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-400 sm:text-sm">
            {isCompose
              ? 'Upload a bare keyboard progression, acoustic guitar, or vocal recording without drums. Gemini composes a tight 4-bar Nigerian Afro-gospel percussion arrangement plus synced click.'
              : 'Upload a full gospel praise track. Gemini transcribes every auxiliary percussion instrument (shekere, agogo, congas, cowbell, talking drum) across 64 steps—leaving out heavy kick drums for your live drummer.'}
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenSequencer}
          className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-amber-500/50 hover:text-amber-300 whitespace-nowrap"
        >
          <span>Open Sequencer</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Upload Dropzone + Dual Waveform Comparison */}
      <section
        aria-label={isCompose ? 'Compose percussion upload' : 'Extract song loop upload'}
        className="rounded-xl border border-zinc-800 bg-[#111114]/90 p-4 sm:p-5 backdrop-blur-md"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-stretch">
          {/* Dropzone Card */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`lg:col-span-5 flex min-w-0 flex-col justify-between rounded-lg border border-dashed p-4 transition-colors ${
              isDragging
                ? 'border-amber-400 bg-amber-500/10'
                : 'border-zinc-700/80 bg-zinc-950/70'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm,.aiff,.amr,.3gp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFileSelected(file);
                e.target.value = '';
              }}
            />

            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-amber-400">
                  {uploadedFileName ? (
                    <Music2 className="h-5 w-5" />
                  ) : (
                    <Upload className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="font-display truncate text-sm font-semibold text-zinc-100">
                    {uploadedFileName
                      ? uploadedFileName
                      : isCompose
                      ? 'Drop Bare Vocal / Keyboard Recording'
                      : 'Drop Full Gospel Praise Song'}
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                    {uploadedFileName
                      ? isCompose
                        ? `Loaded${
                            uploadedDurationSec > 0
                              ? ` (${Math.floor(uploadedDurationSec / 60)}:${String(
                                  Math.round(uploadedDurationSec % 60)
                                ).padStart(2, '0')})`
                              : ''
                          }${wasTrimmedToFiveMin ? ' · Cut to 5:00 max' : ''}. Click Generate Percussion Loop.`
                        : `Loaded${
                            uploadedDurationSec > 0
                              ? ` (${Math.floor(uploadedDurationSec / 60)}:${String(
                                  Math.round(uploadedDurationSec % 60)
                                ).padStart(2, '0')})`
                              : ''
                          }${wasTrimmedToFiveMin ? ' · Cut to 5:00 max' : ''}. Click Extract Exact Song Loop.`
                      : 'Supports MP3, WAV, M4A, AAC, OGG, and FLAC (auto-cut to 5:00 max).'}
                  </p>
                </div>
              </div>

              {uploadedFileName && (
                <button
                  type="button"
                  onClick={onClearAudio}
                  aria-label="Remove uploaded audio"
                  className="shrink-0 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            {isCompose && (
              <div className="mt-4">
                <label
                  htmlFor="target-groove-select"
                  className="block text-[11px] font-medium text-zinc-400"
                >
                  Target Afro-Gospel Feel
                </label>
                <select
                  id="target-groove-select"
                  value={targetGroove}
                  onChange={(e) => onTargetGrooveChange(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 outline-none focus:border-amber-500"
                >
                  {GROOVE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800 whitespace-nowrap"
              >
                {uploadedFileName ? 'Replace Audio' : 'Choose Audio File'}
              </button>

              <button
                type="button"
                disabled={!uploadedFileName || analysisStatus === 'analyzing'}
                onClick={() => onAnalyzeAudio(mode)}
                className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-zinc-950 transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 whitespace-nowrap"
              >
                {analysisStatus === 'analyzing' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isCompose ? (
                  <Sparkles className="h-3.5 w-3.5" />
                ) : (
                  <Disc3 className="h-3.5 w-3.5" />
                )}
                <span>
                  {analysisStatus === 'analyzing'
                    ? 'Analyzing Audio...'
                    : isCompose
                    ? 'Generate Percussion Loop'
                    : 'Extract Exact Song Loop'}
                </span>
              </button>
            </div>

            {analysisStatus === 'error' && analysisError && (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="break-words">{analysisError}</span>
              </div>
            )}

            {analysisStatus === 'ready' && (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {isCompose
                      ? 'Loop generated and synced to your recording.'
                      : 'Exact song percussion loop extracted.'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onOpenSequencer}
                  className="shrink-0 font-semibold text-emerald-200 underline underline-offset-2 hover:text-white"
                >
                  Edit Matrix
                </button>
              </div>
            )}
          </div>

          {/* Dual Waveform Comparison Display */}
          <div className="lg:col-span-7 flex min-w-0 flex-col justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/90 p-3.5">
            <div className="min-w-0">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-medium">
                <span className="truncate text-amber-400">
                  Original Audio {uploadedFileName ? `· ${uploadedFileName}` : '· Standby'}
                </span>
                <span className="font-mono-tabular shrink-0 text-zinc-500">
                  {uploadedFileName
                    ? wasTrimmedToFiveMin
                      ? '5:00 MAX TRIMMED'
                      : originalPeaks.length > 0
                      ? 'WAVEFORM READY'
                      : hasPlayableOriginal
                      ? 'LIVE BLEND READY'
                      : 'READY FOR AI'
                    : 'AWAITING FILE'}
                </span>
              </div>
              <div className="h-16 w-full overflow-hidden rounded-md border border-zinc-800/80 bg-[#09090B]">
                <canvas
                  ref={origCanvasRef}
                  data-testid="original-waveform-canvas"
                  className="block h-full w-full"
                />
              </div>
            </div>

            <div className="min-w-0">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-medium">
                <span className="truncate text-emerald-400">
                  Percussion Loop ({loopBars} {loopBars === 1 ? 'Bar' : 'Bars'} · {activeSteps}{' '}
                  Steps)
                </span>
                <span className="font-mono-tabular shrink-0 text-zinc-500">
                  {tracks.filter((t) => !t.isClick).length} CH + CLICK
                </span>
              </div>
              <div className="h-16 w-full overflow-hidden rounded-md border border-zinc-800/80 bg-[#09090B]">
                <canvas
                  ref={percCanvasRef}
                  data-testid="percussion-waveform-canvas"
                  className="block h-full w-full"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
