import React, { useState } from 'react';
import { Clock, Download, Loader2, SlidersHorizontal, X } from 'lucide-react';
import type { ExportFormat, ExportOptions, LoopBars, ReverbRoomSize } from '../types/sequencer';
import { estimateExportSizeMb, getActiveStepCount, getStepDurationSeconds } from '../utils/sequencerLogic';
import { cutoffToSliderRatio, sliderRatioToCutoff } from '../utils/tapLoopLogic';
import { RotaryKnob } from './RotaryKnob';

interface ExportModalProps {
  isOpen: boolean;
  isExporting: boolean;
  bpm: number;
  loopBars: LoopBars;
  hasOriginalAudio: boolean;
  defaultCutoffHz: number;
  defaultReverb: number;
  defaultReverbSize: ReverbRoomSize;
  defaultIncludeClick: boolean;
  activeSourceLabel: string;
  onExport: (options: ExportOptions) => void;
  onClose: () => void;
}

const MINUTE_PRESETS = [1, 2, 3, 5, 10];

function formatCutoff(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${hz} Hz`;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  isExporting,
  bpm,
  loopBars,
  hasOriginalAudio,
  defaultCutoffHz,
  defaultReverb,
  defaultReverbSize,
  defaultIncludeClick,
  activeSourceLabel,
  onExport,
  onClose,
}) => {
  const [durationMode, setDurationMode] = useState<'default' | 'minutes'>('default');
  const [minutes, setMinutes] = useState<number>(3);
  const [cutoffHz, setCutoffHz] = useState<number>(defaultCutoffHz);
  const [resonanceQ, setResonanceQ] = useState<number>(1.1);
  const [reverbAmount, setReverbAmount] = useState<number>(defaultReverb);
  const [reverbSize, setReverbSize] = useState<ReverbRoomSize>(defaultReverbSize);
  const [format, setFormat] = useState<ExportFormat>('wav-studio');
  const [includeClick, setIncludeClick] = useState<boolean>(defaultIncludeClick);
  const [includeOriginalBlend, setIncludeOriginalBlend] = useState<boolean>(hasOriginalAudio);
  const [normalizePeak, setNormalizePeak] = useState<boolean>(true);

  if (!isOpen) return null;

  const cycleSeconds = getActiveStepCount(loopBars) * getStepDurationSeconds(bpm);
  const totalSeconds = durationMode === 'minutes' ? minutes * 60 : cycleSeconds;
  const sampleRate = format === 'wav-compact' ? 22050 : 44100;
  const estMb = estimateExportSizeMb(totalSeconds, sampleRate);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-2 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#101014] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/90 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-amber-400" />
              <h2
                id="export-modal-title"
                className="font-display text-sm font-bold text-zinc-100 sm:text-base"
              >
                Export Loop Studio Mix
              </h2>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-zinc-400">
              {activeSourceLabel} · {bpm} BPM · {loopBars} {loopBars === 1 ? 'Bar' : 'Bars'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export options"
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {/* 1. Duration (Leave Default or Minutes) */}
          <div className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
                <Clock className="h-3.5 w-3.5 text-amber-400" />
                <span>Loop Length</span>
              </div>
              <span className="font-mono-tabular text-[11px] font-semibold text-amber-300">
                {durationMode === 'default'
                  ? `Default (${cycleSeconds.toFixed(1)}s · ${loopBars} bars)`
                  : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setDurationMode('default')}
                aria-pressed={durationMode === 'default'}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  durationMode === 'default'
                    ? 'border-amber-400 bg-amber-500 text-zinc-950'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                }`}
              >
                Leave Default ({loopBars}B)
              </button>

              {MINUTE_PRESETS.map((m) => {
                const active = durationMode === 'minutes' && minutes === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setDurationMode('minutes');
                      setMinutes(m);
                    }}
                    aria-pressed={active}
                    className={`rounded-lg border px-2.5 py-1.5 font-mono-tabular text-xs font-semibold transition-colors ${
                      active
                        ? 'border-emerald-400 bg-emerald-500 text-zinc-950'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                    }`}
                  >
                    {m} min
                  </button>
                );
              })}
            </div>

            {durationMode === 'minutes' && (
              <div className="flex items-center gap-3 pt-1">
                <label
                  htmlFor="export-custom-minutes"
                  className="text-[11px] font-medium text-zinc-400 whitespace-nowrap"
                >
                  Custom Minutes (1–15):
                </label>
                <input
                  id="export-custom-minutes"
                  type="range"
                  min={1}
                  max={15}
                  step={1}
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                  className="studio-slider flex-1"
                />
                <span className="font-mono-tabular w-12 text-right text-xs font-bold text-emerald-300">
                  {minutes}m
                </span>
              </div>
            )}
          </div>

          {/* 2. Rotary Cutoff & Reverb Knobs */}
          <div className="grid grid-cols-2 gap-3">
            <RotaryKnob
              label="Cutoff Knob"
              valueLabel={formatCutoff(cutoffHz)}
              subLabel={cutoffHz < 2000 ? 'Warm / Moldy' : 'Crisp & Open'}
              ratio={cutoffToSliderRatio(cutoffHz)}
              onChangeRatio={(r) => setCutoffHz(sliderRatioToCutoff(r))}
              accent="amber"
              ariaLabel="Export cutoff frequency knob"
              ariaValueText={formatCutoff(cutoffHz)}
            />

            <RotaryKnob
              label="Reverb Knob"
              valueLabel={`${Math.round(reverbAmount * 100)}%`}
              subLabel={`Space: ${reverbSize}`}
              ratio={reverbAmount}
              onChangeRatio={(r) => setReverbAmount(Number(r.toFixed(2)))}
              accent="emerald"
              ariaLabel="Export reverb amount knob"
              ariaValueText={`${Math.round(reverbAmount * 100)} percent`}
            />
          </div>

          {/* Resonance + Reverb Room Size */}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span className="font-medium text-zinc-400">Filter Resonance (Q)</span>
                <span className="font-mono-tabular font-bold text-amber-300">
                  {resonanceQ.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={8}
                step={0.1}
                value={resonanceQ}
                aria-label="Export filter resonance"
                onChange={(e) => setResonanceQ(Number(e.target.value))}
                className="studio-slider w-full"
              />
            </div>

            <div>
              <div className="mb-1.5 text-[11px] font-medium text-zinc-400">
                Reverb Room Character
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
                {(['room', 'hall', 'cathedral'] as ReverbRoomSize[]).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setReverbSize(sz)}
                    aria-pressed={reverbSize === sz}
                    className={`rounded-md py-1 text-[11px] font-semibold capitalize transition-colors ${
                      reverbSize === sz
                        ? 'bg-emerald-500 text-zinc-950'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Export Format ("Exportation Form") & Mix Options */}
          <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5">
            <div>
              <div className="mb-1.5 text-xs font-bold text-zinc-100">Export Format</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormat('wav-studio')}
                  aria-pressed={format === 'wav-studio'}
                  className={`rounded-lg border p-2 text-left transition-colors ${
                    format === 'wav-studio'
                      ? 'border-amber-400 bg-amber-500/15 text-amber-200'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                  }`}
                >
                  <div className="text-xs font-bold">WAV Studio (44.1 kHz)</div>
                  <div className="text-[10px] text-zinc-400">
                    Lossless 16-bit church &amp; DAW master
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setFormat('wav-compact')}
                  aria-pressed={format === 'wav-compact'}
                  className={`rounded-lg border p-2 text-left transition-colors ${
                    format === 'wav-compact'
                      ? 'border-amber-400 bg-amber-500/15 text-amber-200'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                  }`}
                >
                  <div className="text-xs font-bold">WAV Compact (22 kHz)</div>
                  <div className="text-[10px] text-zinc-400">
                    50% smaller file for long worship sets
                  </div>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIncludeClick((v) => !v)}
                aria-pressed={includeClick}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                  includeClick
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                }`}
              >
                Metronome Click: {includeClick ? 'Included' : 'Off'}
              </button>

              <button
                type="button"
                disabled={!hasOriginalAudio}
                onClick={() => setIncludeOriginalBlend((v) => !v)}
                aria-pressed={includeOriginalBlend}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  includeOriginalBlend && hasOriginalAudio
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                }`}
              >
                Song Blend: {includeOriginalBlend && hasOriginalAudio ? 'Included' : 'Perc Only'}
              </button>

              <button
                type="button"
                onClick={() => setNormalizePeak((v) => !v)}
                aria-pressed={normalizePeak}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                  normalizePeak
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                }`}
              >
                Auto-Normalize: {normalizePeak ? 'On' : 'Off'}
              </button>
            </div>
          </div>
        </div>

        {/* Footer Action */}
        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-950/90 px-4 py-3 sm:px-5">
          <div className="font-mono-tabular text-[11px] text-zinc-400">
            Est. ~{estMb} MB · {format === 'wav-compact' ? '22.05 kHz' : '44.1 kHz'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isExporting}
              onClick={() =>
                onExport({
                  durationMode,
                  minutes,
                  cutoffHz,
                  resonanceQ,
                  reverbAmount,
                  reverbSize,
                  format,
                  includeClick,
                  includeOriginalBlend,
                  normalizePeak,
                })
              }
              className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-zinc-950 shadow-[0_0_20px_rgba(245,158,11,0.35)] transition-colors hover:bg-amber-400 disabled:opacity-60"
            >
              {isExporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              <span>{isExporting ? 'Exporting...' : 'Download Mix'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
