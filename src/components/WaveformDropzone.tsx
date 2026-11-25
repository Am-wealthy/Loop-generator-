import React, { useEffect, useRef, useState } from 'react';
import { Upload, Sparkles, Music2, Trash2, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import type { AnalysisStatus, GeminiAnalysisModel, LoopBars, PercussionTrack } from '../types/sequencer';
import { getActiveStepCount } from '../utils/sequencerLogic';

interface WaveformDropzoneProps {
  uploadedFileName: string | null;
  originalPeaks: number[];
  tracks: PercussionTrack[];
  currentStep: number;
  loopBars: LoopBars;
  analysisStatus: AnalysisStatus;
  analysisError: string | null;
  hasExistingPercussion: boolean;
  selectedModel: GeminiAnalysisModel;
  onSelectModel: (model: GeminiAnalysisModel) => void;
  onFileSelected: (file: File) => void;
  onAnalyzeAudio: () => void;
  onClearAudio: () => void;
}

export const WaveformDropzone: React.FC<WaveformDropzoneProps> = ({
  uploadedFileName,
  originalPeaks,
  tracks,
  currentStep,
  loopBars,
  analysisStatus,
  analysisError,
  hasExistingPercussion,
  selectedModel,
  onSelectModel,
  onFileSelected,
  onAnalyzeAudio,
  onClearAudio,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const percCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const activeSteps = getActiveStepCount(loopBars);
  const playheadRatio =
    currentStep >= 0 ? (currentStep % activeSteps) / Math.max(1, activeSteps) : -1;

  // Draw Top Waveform: Uploaded Original Audio
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

    // Center hairline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    if (originalPeaks.length === 0) {
      // Subtle standby grid bars
      const bars = 64;
      const gap = width / bars;
      for (let i = 0; i < bars; i++) {
        const h = 4 + ((i * 7) % 9);
        ctx.fillStyle = 'rgba(113, 113, 122, 0.25)';
        ctx.fillRect(i * gap + 1, height / 2 - h / 2, Math.max(2, gap - 3), h);
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
  }, [originalPeaks, playheadRatio]);

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
    <section
      aria-label="Audio upload and dual waveform comparison"
      className="rounded-xl border border-zinc-800 bg-[#111114]/90 p-4 sm:p-5 backdrop-blur-md"
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-stretch">
        {/* Dropzone Controls */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`lg:col-span-5 flex flex-col justify-between rounded-lg border border-dashed p-4 transition-colors ${
            isDragging
              ? 'border-amber-400 bg-amber-500/10'
              : 'border-zinc-700/80 bg-zinc-950/70'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFileSelected(file);
              e.target.value = '';
            }}
          />

          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-amber-400">
                {uploadedFileName ? (
                  <Music2 className="h-5 w-5" />
                ) : (
                  <Upload className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0">
                <h1 className="font-display text-sm font-semibold text-zinc-100">
                  {uploadedFileName
                    ? uploadedFileName
                    : 'Drop Gospel Praise Track or Bare Keyboard / Vocal'}
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  {uploadedFileName
                    ? 'Ready for Gemini Afro-Gospel percussion transcription & click sync.'
                    : 'Upload MP3, WAV, M4A, or OGG (up to 20 MB). Gemini extracts existing percussion or composes an authentic praise loop.'}
                </p>
              </div>
            </div>

            {uploadedFileName && (
              <button
                type="button"
                onClick={onClearAudio}
                aria-label="Remove uploaded audio"
                className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800 whitespace-nowrap"
              >
                {uploadedFileName ? 'Replace Audio' : 'Choose Audio File'}
              </button>

              <label className="sr-only" htmlFor="gemini-model-select">
                Gemini Model
              </label>
              <select
                id="gemini-model-select"
                value={selectedModel}
                onChange={(e) => onSelectModel(e.target.value as GeminiAnalysisModel)}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs font-medium text-zinc-300 outline-none focus:border-amber-500"
              >
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
              </select>
            </div>

            <button
              type="button"
              disabled={!uploadedFileName || analysisStatus === 'analyzing'}
              onClick={onAnalyzeAudio}
              className="flex items-center gap-2 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-bold text-zinc-950 transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 whitespace-nowrap"
            >
              {analysisStatus === 'analyzing' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span>
                {analysisStatus === 'analyzing' ? 'Analyzing Audio...' : 'Extract / Generate Loop'}
              </span>
            </button>
          </div>

          {analysisStatus === 'error' && analysisError && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{analysisError}</span>
            </div>
          )}

          {analysisStatus === 'ready' && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>
                {hasExistingPercussion
                  ? 'Case A: Transcribed percussion pockets (kick omitted for live drummer).'
                  : 'Case B: Composed custom Nigerian praise arrangement locked to your recording.'}
              </span>
            </div>
          )}
        </div>

        {/* Dual Waveform Comparison Display */}
        <div className="lg:col-span-7 flex flex-col justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/90 p-3.5">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium">
              <span className="text-amber-400">
                Original Reference Audio {uploadedFileName ? `· ${uploadedFileName}` : '· Standby'}
              </span>
              <span className="font-mono-tabular text-zinc-500">
                {uploadedFileName ? 'WAVEFORM READY' : 'AWAITING FILE'}
              </span>
            </div>
            <div className="h-14 w-full overflow-hidden rounded-md border border-zinc-800/80 bg-[#09090B]">
              <canvas
                ref={origCanvasRef}
                data-testid="original-waveform-canvas"
                className="h-full w-full block"
              />
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium">
              <span className="text-emerald-400">
                AI Percussion Loop Envelope ({loopBars} {loopBars === 1 ? 'Bar' : 'Bars'} ·{' '}
                {activeSteps} Steps)
              </span>
              <span className="font-mono-tabular text-zinc-500">
                {tracks.filter((t) => !t.isClick).length} CHANNELS + CLICK
              </span>
            </div>
            <div className="h-14 w-full overflow-hidden rounded-md border border-zinc-800/80 bg-[#09090B]">
              <canvas
                ref={percCanvasRef}
                data-testid="percussion-waveform-canvas"
                className="h-full w-full block"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
