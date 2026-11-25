import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Hand,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { TAP_PAD_PRESETS } from '../data/presets';
import type {
  LoopBars,
  ReverbRoomSize,
  TapLoopSettings,
  TapPad,
  TapPresetOption,
} from '../types/sequencer';
import { getActiveStepCount } from '../utils/sequencerLogic';
import {
  countActiveSteps,
  cutoffToSliderRatio,
  sliderRatioToCutoff,
} from '../utils/tapLoopLogic';

type TapSubPage = 'pads' | 'sequence';

interface TapLoopStudioProps {
  pads: TapPad[];
  bpm: number;
  loopBars: LoopBars;
  isPlaying: boolean;
  currentStep: number;
  activeBar: number;
  followPlayhead: boolean;
  recordArmed: boolean;
  clickEnabled: boolean;
  tapSettings: TapLoopSettings;
  flashingPadIds: Record<string, number>;
  padError: string | null;
  onSelectBar: (bar: number) => void;
  onToggleFollowPlayhead: () => void;
  onToggleRecordArmed: () => void;
  onToggleClick: () => void;
  onTapTempo: () => void;
  onPadTap: (padId: string) => void;
  onAddPad: () => void;
  onRemovePad: (padId: string) => void;
  onSelectPreset: (padId: string, preset: TapPresetOption) => void;
  onReplacePadFile: (padId: string, file: File) => void;
  onTogglePadMute: (padId: string) => void;
  onClearPadSteps: (padId: string) => void;
  onClearAllPads: () => void;
  onPadReverbChange: (padId: string, reverb: number) => void;
  onTogglePadStep: (padId: string, stepIndex: number) => void;
  onSetPadStepVelocity: (padId: string, stepIndex: number, velocity: number) => void;
  onHumanizePad: (padId: string) => void;
  onHumanizeAll: () => void;
  onUpdateTapSettings: (patch: Partial<TapLoopSettings>) => void;
}

const STEP_LABELS = [
  '1', 'e', '&', 'a',
  '2', 'e', '&', 'a',
  '3', 'e', '&', 'a',
  '4', 'e', '&', 'a',
];

function formatCutoffLabel(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(1)} kHz`;
  return `${hz} Hz`;
}

function getCutoffMood(hz: number): string {
  if (hz < 750) return 'Deep Moldy / Sub';
  if (hz < 2200) return 'Warm Moldy Filter';
  if (hz < 6500) return 'Mellow Studio';
  return 'Open & Crisp';
}

export const TapLoopStudio: React.FC<TapLoopStudioProps> = ({
  pads,
  bpm,
  loopBars,
  isPlaying,
  currentStep,
  activeBar,
  followPlayhead,
  recordArmed,
  clickEnabled,
  tapSettings,
  flashingPadIds,
  padError,
  onSelectBar,
  onToggleFollowPlayhead,
  onToggleRecordArmed,
  onToggleClick,
  onTapTempo,
  onPadTap,
  onAddPad,
  onRemovePad,
  onSelectPreset,
  onReplacePadFile,
  onTogglePadMute,
  onClearPadSteps,
  onClearAllPads,
  onPadReverbChange,
  onTogglePadStep,
  onSetPadStepVelocity,
  onHumanizePad,
  onHumanizeAll,
  onUpdateTapSettings,
}) => {
  const fileInputsRef = useRef<Record<string, HTMLInputElement | null>>({});
  const [tapSubPage, setTapSubPage] = useState<TapSubPage>('pads');
  const [tapTempoFlash, setTapTempoFlash] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slideEditBars, setSlideEditBars] = useState(false);

  const paintingVelocityRef = useRef<string | null>(null);
  const touchPadGestureRef = useRef<{
    padId: string;
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  const touchBarGestureRef = useRef<{
    padId: string;
    globalStep: number;
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
    rectTop: number;
    rectHeight: number;
  } | null>(null);

  // Cancel any pending touch tap if the page scrolls
  useEffect(() => {
    const cancelOnScroll = () => {
      if (touchPadGestureRef.current) {
        touchPadGestureRef.current.moved = true;
      }
      if (touchBarGestureRef.current) {
        touchBarGestureRef.current.moved = true;
      }
    };
    window.addEventListener('scroll', cancelOnScroll, { passive: true });
    return () => window.removeEventListener('scroll', cancelOnScroll);
  }, []);

  const totalSteps = getActiveStepCount(loopBars);
  const effectiveBar =
    followPlayhead && currentStep >= 0
      ? Math.floor((currentStep % totalSteps) / 16)
      : Math.min(activeBar, loopBars - 1);
  const barStartStep = effectiveBar * 16;
  const activeStepInBar =
    currentStep >= 0 && Math.floor((currentStep % totalSteps) / 16) === effectiveBar
      ? currentStep % 16
      : -1;
  const activeBeatInBar =
    currentStep >= 0 ? Math.floor((currentStep % 16) / 4) + 1 : 0;
  const displayBar =
    currentStep >= 0 ? Math.floor((currentStep % totalSteps) / 16) + 1 : 1;

  const recordedPadCount = pads.filter((p) => countActiveSteps(p.steps, loopBars) > 0).length;
  const sweepPercent =
    isPlaying && currentStep >= 0
      ? (((currentStep % totalSteps) + 1) / totalSteps) * 100
      : 0;

  const cutoffRatio = cutoffToSliderRatio(tapSettings.cutoffHz);
  const masterRevPct = Math.round(tapSettings.masterReverb * 100);

  const handleTapTempoClick = () => {
    setTapTempoFlash(true);
    window.setTimeout(() => setTapTempoFlash(false), 120);
    onTapTempo();
  };

  const computeVelocityFromY = (clientY: number, rectTop: number, rectHeight: number) => {
    const relY = 1 - (clientY - rectTop) / Math.max(1, rectHeight);
    const clamped = Math.max(0, Math.min(1, relY));
    return clamped < 0.08 ? 0 : Math.round(15 + clamped * 85);
  };

  const updateBarVelocityFromPointer = (
    e: React.PointerEvent<HTMLDivElement>,
    padId: string,
    globalStep: number
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const velocity = computeVelocityFromY(e.clientY, rect.top, rect.height);
    onSetPadStepVelocity(padId, globalStep, velocity);
  };

  return (
    <div
      className="space-y-4"
      onPointerUp={() => {
        paintingVelocityRef.current = null;
      }}
    >
      {/* Top Toolbar + 2-Page Switcher (Tap Pads vs Tap Sequence) */}
      <section
        aria-label="Tap loop controls"
        className="rounded-xl border border-zinc-800 bg-[#0B0B0E]/95 p-4 shadow-2xl sm:p-5"
      >
        {/* 2-Page Switcher Bar inside Tap Loop */}
        <div className="mb-4 flex flex-col gap-3 border-b border-zinc-800/80 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div
            role="tablist"
            aria-label="Tap Loop sections"
            className="grid w-full grid-cols-2 rounded-xl border border-zinc-800 bg-zinc-950 p-1 sm:w-auto sm:min-w-[340px]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tapSubPage === 'pads'}
              onClick={() => setTapSubPage('pads')}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-all whitespace-nowrap ${
                tapSubPage === 'pads'
                  ? 'bg-amber-500 text-zinc-950 shadow-[0_0_14px_rgba(245,158,11,0.3)]'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Hand className="h-3.5 w-3.5 shrink-0" />
              <span>Tap Pads</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={tapSubPage === 'sequence'}
              onClick={() => setTapSubPage('sequence')}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-all whitespace-nowrap ${
                tapSubPage === 'sequence'
                  ? 'bg-emerald-500 text-zinc-950 shadow-[0_0_14px_rgba(16,185,129,0.3)]'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5 shrink-0" />
              <span>Tap Sequence</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() =>
              setTapSubPage((p) => (p === 'pads' ? 'sequence' : 'pads'))
            }
            className="flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-amber-500/50 hover:text-amber-300 whitespace-nowrap"
          >
            <span>
              {tapSubPage === 'pads' ? 'Open Tap Sequence' : 'Back to Tap Pads'}
            </span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-1 inline-flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
              {tapSubPage === 'pads' ? (
                <Hand className="h-3.5 w-3.5" />
              ) : (
                <BarChart3 className="h-3.5 w-3.5" />
              )}
              <span>
                {tapSubPage === 'pads'
                  ? `Tap Pads · Locked @ ${bpm} BPM`
                  : `Tap Sequence & Velocity Bars · ${bpm} BPM`}
              </span>
            </div>
            <h1 className="font-display text-xl font-bold tracking-tight text-zinc-50 sm:text-2xl">
              {tapSubPage === 'pads'
                ? 'Tap Percussion Pads & Layer Custom Sounds'
                : 'Adjust Steps & Humanize Velocity Bars'}
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-400 sm:text-sm">
              {tapSubPage === 'pads'
                ? 'Scroll freely anytime without triggering sounds. Tap a pad cleanly to record its rhythm continuously in tempo, add extra pads, or replace sounds from your phone.'
                : 'Toggle steps across Bars 1–4 and shape each hit low, high, or very high using the FL-style velocity bar chart. Everything stays locked to your BPM.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Overdub Record Mode */}
            <button
              type="button"
              onClick={onToggleRecordArmed}
              aria-pressed={recordArmed}
              className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-all whitespace-nowrap ${
                recordArmed
                  ? 'border-rose-500/50 bg-rose-500/15 text-rose-300 shadow-[0_0_16px_rgba(244,63,94,0.2)]'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-600'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  recordArmed ? 'animate-pulse bg-rose-400' : 'bg-zinc-500'
                }`}
              />
              <span>{recordArmed ? 'Rec Overdub: ON' : 'Audition Only'}</span>
            </button>

            {/* Click Guide */}
            <button
              type="button"
              onClick={onToggleClick}
              aria-pressed={clickEnabled}
              className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                clickEnabled
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-600'
              }`}
            >
              <Timer className="h-3.5 w-3.5" />
              <span>{clickEnabled ? 'Click: On' : 'Click: Off'}</span>
            </button>

            {/* Tap Tempo */}
            <button
              type="button"
              onClick={handleTapTempoClick}
              className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 font-mono-tabular text-xs font-semibold transition-all whitespace-nowrap ${
                tapTempoFlash
                  ? 'border-amber-400 bg-amber-500/25 text-amber-200'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-amber-500/50 hover:text-amber-300'
              }`}
            >
              <span>Tap Tempo · {bpm}</span>
            </button>

            {/* Settings (Cutoff & General Reverb) */}
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              aria-expanded={settingsOpen}
              className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                settingsOpen || tapSettings.cutoffHz < 16000
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-amber-500/40'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Settings</span>
              <span className="hidden font-mono-tabular text-[10px] text-zinc-400 sm:inline">
                ({formatCutoffLabel(tapSettings.cutoffHz)} · Rev {masterRevPct}%)
              </span>
            </button>

            {/* Clear All Loops */}
            <button
              type="button"
              onClick={onClearAllPads}
              disabled={recordedPadCount === 0}
              className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                recordedPadCount === 0
                  ? 'cursor-not-allowed border-zinc-800 bg-zinc-950 text-zinc-600'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-rose-500/40 hover:text-rose-300'
              }`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Clear Loops</span>
            </button>
          </div>
        </div>

        {/* Expandable Settings Panel: Master Filter Cutoff + General Reverb */}
        {settingsOpen && (
          <div
            role="region"
            aria-label="Tap Loop FX Settings"
            className="mt-4 grid grid-cols-1 gap-4 rounded-xl border border-amber-500/30 bg-zinc-950/90 p-4 md:grid-cols-2"
          >
            {/* Cutoff Filter Control */}
            <div className="space-y-2.5 rounded-lg border border-zinc-800 bg-[#0D0D11] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-zinc-100">
                    Master Filter Cutoff
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Turn down for a warm, muffled &ldquo;moldy&rdquo; texture
                  </div>
                </div>
                <span className="font-mono-tabular rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                  {formatCutoffLabel(tapSettings.cutoffHz)}
                </span>
              </div>

              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={cutoffRatio}
                aria-label="Master filter cutoff frequency"
                onChange={(e) =>
                  onUpdateTapSettings({
                    cutoffHz: sliderRatioToCutoff(Number(e.target.value)),
                  })
                }
                className="studio-slider w-full"
              />

              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                <span>180 Hz (Moldy)</span>
                <span className="font-semibold text-amber-400/90">
                  {getCutoffMood(tapSettings.cutoffHz)}
                </span>
                <span>18 kHz (Open)</span>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <span className="text-[11px] font-medium text-zinc-400 whitespace-nowrap">
                  Filter Warmth (Q)
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={8}
                  step={0.1}
                  value={tapSettings.resonanceQ}
                  aria-label="Filter resonance warmth"
                  onChange={(e) =>
                    onUpdateTapSettings({ resonanceQ: Number(e.target.value) })
                  }
                  className="studio-slider flex-1"
                />
                <span className="w-10 text-right font-mono-tabular text-[11px] text-zinc-300">
                  {tapSettings.resonanceQ.toFixed(1)}
                </span>
              </div>
            </div>

            {/* General Reverb Control */}
            <div className="space-y-2.5 rounded-lg border border-zinc-800 bg-[#0D0D11] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-zinc-100">
                    General Master Reverb
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Overall room depth applied across all percussion reverb sends
                  </div>
                </div>
                <span className="font-mono-tabular rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                  {masterRevPct}%
                </span>
              </div>

              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={tapSettings.masterReverb}
                aria-label="General master reverb amount"
                onChange={(e) =>
                  onUpdateTapSettings({ masterReverb: Number(e.target.value) })
                }
                className="studio-slider w-full"
              />

              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                <span>0% (Dry)</span>
                <span>50% (Church Stage)</span>
                <span>100% (Lush Hall)</span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] font-medium text-zinc-400">
                  Reverb Space
                </span>
                <div
                  role="group"
                  aria-label="Reverb room size"
                  className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5"
                >
                  {(['room', 'hall', 'cathedral'] as ReverbRoomSize[]).map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => onUpdateTapSettings({ reverbSize: size })}
                      aria-pressed={tapSettings.reverbSize === size}
                      className={`rounded-md px-2.5 py-1 text-[10px] font-semibold capitalize transition-colors ${
                        tapSettings.reverbSize === size
                          ? 'bg-emerald-500 text-zinc-950'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Live Tempo-Locked Cycle Progress Bar */}
        <div className="mt-4 rounded-lg border border-zinc-800/90 bg-zinc-950/90 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-2 font-mono-tabular">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  isPlaying ? 'bg-emerald-400 shadow-[0_0_8px_#10B981]' : 'bg-zinc-600'
                }`}
              />
              <span className="font-semibold text-zinc-200">
                {isPlaying
                  ? `LOCKED @ ${bpm} BPM · BAR ${displayBar}/${loopBars} · BEAT ${
                      activeBeatInBar || 1
                    }`
                  : `TEMPO LOCKED @ ${bpm} BPM · ${loopBars} ${
                      loopBars === 1 ? 'BAR' : 'BARS'
                    }`}
              </span>
              <span className="text-zinc-500">
                ({recordedPadCount}/{pads.length} active)
              </span>
            </div>

            <div className="flex items-center gap-1.5 font-mono-tabular">
              {[1, 2, 3, 4].map((beat) => {
                const isActiveBeat = isPlaying && activeBeatInBar === beat;
                return (
                  <span
                    key={beat}
                    className={`flex h-5 w-6 items-center justify-center rounded text-[10px] font-bold transition-colors ${
                      isActiveBeat
                        ? beat === 1
                          ? 'bg-emerald-500 text-zinc-950 shadow-[0_0_10px_#10B981]'
                          : 'bg-amber-500 text-zinc-950 shadow-[0_0_8px_#F59E0B]'
                        : 'border border-zinc-800 bg-zinc-900 text-zinc-500'
                    }`}
                  >
                    {beat}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-900">
            {Array.from({ length: loopBars - 1 }, (_, i) => (
              <span
                key={i}
                aria-hidden="true"
                style={{ left: `${((i + 1) / loopBars) * 100}%` }}
                className="absolute inset-y-0 w-px bg-zinc-700/80"
              />
            ))}
            <div
              style={{ width: `${sweepPercent}%` }}
              className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-[width] duration-75"
            />
          </div>
        </div>

        {padError && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
          >
            {padError}
          </div>
        )}
      </section>

      {/* SUB-PAGE 1: TAP PADS ONLY */}
      {tapSubPage === 'pads' && (
        <section aria-label="Percussion tap pads" className="touch-pan-y">
          <div className="grid grid-cols-2 gap-3 touch-pan-y sm:grid-cols-3 lg:grid-cols-4 sm:gap-4">
            {pads.map((pad, idx) => {
              const isFlashing = Boolean(flashingPadIds[pad.id]);
              const activeHits = countActiveSteps(pad.steps, loopBars);
              const hasSteps = activeHits > 0;
              const isEmerald = pad.accentColor === 'emerald';
              const selectedPresetId =
                TAP_PAD_PRESETS.find((p) => p.sample.url === pad.sample.url)?.id ?? 'custom';

              return (
                <div
                  key={pad.id}
                  data-testid={`tap-pad-card-${idx + 1}`}
                  className={`group flex flex-col overflow-hidden rounded-xl border touch-pan-y transition-all ${
                    isFlashing
                      ? isEmerald
                        ? 'border-emerald-400 bg-emerald-500/15 shadow-[0_0_24px_rgba(16,185,129,0.28)]'
                        : 'border-amber-400 bg-amber-500/15 shadow-[0_0_24px_rgba(245,158,11,0.28)]'
                      : hasSteps && !pad.muted
                      ? isEmerald
                        ? 'border-emerald-500/45 bg-[#111316]'
                        : 'border-amber-500/45 bg-[#121216]'
                      : 'border-zinc-800 bg-[#0E0E12]'
                  } ${pad.muted ? 'opacity-65' : ''}`}
                >
                  {/* Top Strip */}
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    className="flex items-center justify-between gap-1 border-b border-zinc-800/80 bg-zinc-950/60 px-2.5 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="font-mono-tabular rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-300">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span className="truncate text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                        {pad.customFileName ? 'Phone Audio' : pad.category}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onTogglePadMute(pad.id)}
                        aria-label={pad.muted ? `Unmute ${pad.name}` : `Mute ${pad.name}`}
                        aria-pressed={pad.muted}
                        className={`flex h-6 w-6 items-center justify-center rounded border text-[10px] font-bold transition-colors ${
                          pad.muted
                            ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100'
                        }`}
                      >
                        {pad.muted ? (
                          <VolumeX className="h-3 w-3" />
                        ) : (
                          <Volume2 className="h-3 w-3" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => onClearPadSteps(pad.id)}
                        disabled={!hasSteps}
                        aria-label={`Clear loop on ${pad.name}`}
                        className={`flex h-6 w-6 items-center justify-center rounded border transition-colors ${
                          hasSteps
                            ? 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-500/50 hover:text-amber-300'
                            : 'cursor-not-allowed border-zinc-800/60 bg-zinc-950 text-zinc-700'
                        }`}
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>

                      {pads.length > 6 && (
                        <button
                          type="button"
                          onClick={() => onRemovePad(pad.id)}
                          aria-label={`Remove pad ${pad.name}`}
                          className="flex h-6 w-6 items-center justify-center rounded border border-zinc-800 bg-zinc-900 text-zinc-500 transition-colors hover:border-rose-500/40 hover:text-rose-300"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Tactile Scroll-Safe Tap Pad Body */}
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      if (e.pointerType === 'mouse') {
                        if (e.button === 0) onPadTap(pad.id);
                        return;
                      }
                      // For touch/pen, wait until pointerUp and ignore if finger scrolled > 8px
                      touchPadGestureRef.current = {
                        padId: pad.id,
                        pointerId: e.pointerId,
                        x: e.clientX,
                        y: e.clientY,
                        moved: false,
                      };
                    }}
                    onPointerMove={(e) => {
                      const g = touchPadGestureRef.current;
                      if (!g || g.pointerId !== e.pointerId || g.moved) return;
                      if (Math.abs(e.clientX - g.x) > 8 || Math.abs(e.clientY - g.y) > 8) {
                        g.moved = true;
                      }
                    }}
                    onPointerCancel={() => {
                      touchPadGestureRef.current = null;
                    }}
                    onPointerUp={(e) => {
                      if (e.pointerType === 'mouse') return;
                      const g = touchPadGestureRef.current;
                      touchPadGestureRef.current = null;
                      if (g && g.padId === pad.id && g.pointerId === e.pointerId && !g.moved) {
                        onPadTap(pad.id);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onPadTap(pad.id);
                      }
                    }}
                    aria-label={`Tap pad ${idx + 1}: ${pad.name}`}
                    className="relative flex min-h-[116px] flex-1 flex-col items-center justify-center gap-2 px-3 py-3 text-center touch-pan-y select-none sm:min-h-[132px]"
                  >
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono-tabular text-[10px] font-semibold ${
                        hasSteps
                          ? isEmerald
                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                            : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                          : 'border-zinc-800 bg-zinc-900/90 text-zinc-500'
                      }`}
                    >
                      {hasSteps ? (
                        <>
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              isEmerald ? 'bg-emerald-400' : 'bg-amber-400'
                            }`}
                          />
                          {activeHits} {activeHits === 1 ? 'step' : 'steps'} looping
                        </>
                      ) : recordArmed ? (
                        'Tap to record'
                      ) : (
                        'Tap to play'
                      )}
                    </span>

                    <span className="font-display line-clamp-2 text-sm font-bold tracking-tight text-zinc-100 sm:text-base">
                      {pad.name}
                    </span>

                    {/* Mini Bar Step Activity Preview */}
                    <div className="grid w-full grid-cols-16 gap-0.5 pt-1">
                      {Array.from({ length: 16 }, (_, s) => {
                        const v = pad.steps[barStartStep + s] ?? 0;
                        const isPlayhead = isPlaying && activeStepInBar === s;
                        return (
                          <span
                            key={s}
                            aria-hidden="true"
                            className={`h-1.5 rounded-sm transition-colors ${
                              v > 0
                                ? isEmerald
                                  ? 'bg-emerald-400'
                                  : 'bg-amber-400'
                                : isPlayhead
                                ? 'bg-zinc-600'
                                : 'bg-zinc-800/90'
                            }`}
                          />
                        );
                      })}
                    </div>
                  </button>

                  {/* Bottom Controls: Per-Pad Reverb, Preset & Replace Phone Audio */}
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    className="flex flex-col gap-1.5 border-t border-zinc-800/80 bg-zinc-950/70 p-2"
                  >
                    <div className="flex items-center gap-2 px-0.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        Rev
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={pad.reverb}
                        aria-label={`Reverb amount for ${pad.name}`}
                        onChange={(e) =>
                          onPadReverbChange(pad.id, Number(e.target.value))
                        }
                        className="studio-slider min-w-0 flex-1"
                      />
                      <span className="w-8 text-right font-mono-tabular text-[10px] text-zinc-300">
                        {Math.round(pad.reverb * 100)}%
                      </span>
                    </div>

                    <select
                      aria-label={`Select sound preset for ${pad.name}`}
                      value={selectedPresetId}
                      onChange={(e) => {
                        const preset = TAP_PAD_PRESETS.find((p) => p.id === e.target.value);
                        if (preset) onSelectPreset(pad.id, preset);
                      }}
                      className="h-7 w-full min-w-0 rounded border border-zinc-800 bg-zinc-900 px-2 text-[11px] font-medium text-zinc-200 focus:border-amber-500/60 focus:outline-none"
                    >
                      {pad.customFileName && (
                        <option value="custom">Phone: {pad.customFileName}</option>
                      )}
                      {TAP_PAD_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>

                    <input
                      ref={(el) => {
                        fileInputsRef.current[pad.id] = el;
                      }}
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      aria-label={`Upload phone audio for ${pad.name}`}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onReplacePadFile(pad.id, file);
                        e.target.value = '';
                      }}
                    />

                    <button
                      type="button"
                      onClick={() => fileInputsRef.current[pad.id]?.click()}
                      className="flex h-7 w-full items-center justify-center gap-1.5 rounded border border-zinc-700/80 bg-zinc-900 px-2 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-amber-500/50 hover:text-amber-300"
                    >
                      <Upload className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {pad.customFileName ? 'Replace File' : 'Replace from Phone'}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}

            {/* "+ Add Pad Box" Card Button */}
            <button
              type="button"
              onClick={onAddPad}
              aria-label="Add Pad Box"
              className="flex min-h-[210px] flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-zinc-700/80 bg-zinc-950/50 p-4 text-center touch-pan-y transition-all hover:border-amber-500/60 hover:bg-amber-500/5 active:scale-[0.98]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
                <Plus className="h-6 w-6" />
              </div>
              <div>
                <div className="font-display text-sm font-bold text-zinc-100">
                  Add Pad Box
                </div>
                <p className="mt-1 text-[11px] leading-snug text-zinc-400">
                  Add bass, talking drum, or load a custom sound from your phone
                </p>
              </div>
            </button>
          </div>
        </section>
      )}

      {/* SUB-PAGE 2: TAP SEQUENCE & FL-STYLE VELOCITY BAR CHART */}
      {tapSubPage === 'sequence' && (
        <section
          aria-label="Tap Loop Sequencer and Velocity Bars"
          className="overflow-hidden rounded-xl border border-zinc-800 bg-[#0B0B0E]/95 shadow-2xl touch-pan-y"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/70 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-amber-400" />
                <h2 className="font-display text-sm font-bold tracking-tight text-zinc-100 sm:text-base">
                  Tap Loop Sequencer &amp; Humanize Bars
                </h2>
              </div>

              <div
                role="tablist"
                aria-label="Tap Loop Bar selector"
                className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5"
              >
                {Array.from({ length: loopBars }, (_, barIdx) => {
                  const isSelected = effectiveBar === barIdx;
                  return (
                    <button
                      key={barIdx}
                      type="button"
                      role="tab"
                      aria-selected={isSelected}
                      onClick={() => onSelectBar(barIdx)}
                      className={`rounded-md px-2.5 py-1 font-mono-tabular text-[11px] font-semibold transition-colors whitespace-nowrap ${
                        isSelected
                          ? 'bg-amber-500 text-zinc-950 shadow-sm'
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                      }`}
                    >
                      Bar {barIdx + 1}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSlideEditBars((v) => !v)}
                aria-pressed={slideEditBars}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                  slideEditBars
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Touch Slide Edit: {slideEditBars ? 'On' : 'Off'}
              </button>

              <button
                type="button"
                onClick={onHumanizeAll}
                className="flex h-7 items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 whitespace-nowrap"
              >
                <Sparkles className="h-3 w-3" />
                <span>Humanize All</span>
              </button>

              <button
                type="button"
                onClick={onToggleFollowPlayhead}
                aria-pressed={followPlayhead}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                  followPlayhead
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Auto-Follow: {followPlayhead ? 'On' : 'Off'}
              </button>
            </div>
          </div>

          <div className="divide-y divide-zinc-800/80">
            {pads.map((pad, idx) => {
              const isEmerald = pad.accentColor === 'emerald';
              const barSteps = pad.steps.slice(barStartStep, barStartStep + 16);
              const hasBarHits = barSteps.some((v) => v > 0);

              return (
                <div
                  key={`seq-${pad.id}`}
                  data-testid={`tap-seq-row-${idx + 1}`}
                  className="space-y-2.5 px-3 py-3.5 sm:px-5"
                >
                  {/* Row Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-mono-tabular rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-300">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span className="truncate text-xs font-bold text-zinc-100 sm:text-sm">
                        {pad.name}
                      </span>
                      <span className="hidden text-[11px] text-zinc-500 sm:inline">
                        Tap or drag bars low/high to humanize dynamics
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-950 px-2 py-1">
                        <span className="text-[10px] font-semibold text-zinc-400">Rev</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={pad.reverb}
                          aria-label={`Sequencer reverb for ${pad.name}`}
                          onChange={(e) =>
                            onPadReverbChange(pad.id, Number(e.target.value))
                          }
                          className="studio-slider w-14 sm:w-20"
                        />
                        <span className="w-7 text-right font-mono-tabular text-[10px] text-zinc-300">
                          {Math.round(pad.reverb * 100)}%
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => onHumanizePad(pad.id)}
                        disabled={!hasBarHits && countActiveSteps(pad.steps, loopBars) === 0}
                        className="flex h-7 items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 text-[11px] font-semibold text-zinc-200 transition-colors hover:border-emerald-500/50 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Sparkles className="h-3 w-3" />
                        <span>Humanize</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onTogglePadMute(pad.id)}
                        aria-pressed={pad.muted}
                        className={`h-7 rounded border px-2 font-mono-tabular text-[11px] font-bold transition-colors ${
                          pad.muted
                            ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100'
                        }`}
                      >
                        {pad.muted ? 'MUTED' : 'M'}
                      </button>
                    </div>
                  </div>

                  {/* 16 Tempo-Locked Steps + Aligned FL-Style Vertical Velocity Bar Chart */}
                  <div className="grid grid-cols-8 gap-1.5 lg:grid-cols-16">
                    {Array.from({ length: 16 }, (_, stepOffset) => {
                      const globalStep = barStartStep + stepOffset;
                      const vel = pad.steps[globalStep] ?? 0;
                      const isOn = vel > 0;
                      const isPlayhead = isPlaying && activeStepInBar === stepOffset;
                      const isBeatStart = stepOffset % 4 === 0;

                      return (
                        <div key={stepOffset} className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => onTogglePadStep(pad.id, globalStep)}
                            aria-label={`${pad.name} step ${stepOffset + 1} ${isOn ? `on (${vel}%)` : 'off'}`}
                            aria-pressed={isOn}
                            className={`flex h-7 items-center justify-center rounded border font-mono-tabular text-[10px] font-bold transition-all ${
                              isOn
                                ? isEmerald
                                  ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-200'
                                  : 'border-amber-400/70 bg-amber-500/20 text-amber-200'
                                : isBeatStart
                                ? 'border-zinc-700/80 bg-zinc-900/90 text-zinc-400 hover:border-zinc-600'
                                : 'border-zinc-800/80 bg-zinc-950/90 text-zinc-600 hover:border-zinc-700'
                            } ${isPlayhead ? 'ring-1 ring-white/80' : ''}`}
                          >
                            {STEP_LABELS[stepOffset]}
                          </button>

                          {/* Scroll-safe FL-Studio Velocity Bar Column */}
                          <div
                            role="slider"
                            tabIndex={0}
                            aria-label={`${pad.name} step ${stepOffset + 1} humanize velocity`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={vel}
                            onPointerDown={(e) => {
                              if (e.pointerType === 'mouse' || slideEditBars) {
                                e.preventDefault();
                                paintingVelocityRef.current = pad.id;
                                updateBarVelocityFromPointer(e, pad.id, globalStep);
                                return;
                              }
                              const rect = e.currentTarget.getBoundingClientRect();
                              touchBarGestureRef.current = {
                                padId: pad.id,
                                globalStep,
                                pointerId: e.pointerId,
                                x: e.clientX,
                                y: e.clientY,
                                moved: false,
                                rectTop: rect.top,
                                rectHeight: rect.height,
                              };
                            }}
                            onPointerMove={(e) => {
                              if (e.pointerType !== 'mouse' && !slideEditBars) {
                                const g = touchBarGestureRef.current;
                                if (!g || g.pointerId !== e.pointerId || g.moved) return;
                                if (
                                  Math.abs(e.clientX - g.x) > 8 ||
                                  Math.abs(e.clientY - g.y) > 8
                                ) {
                                  g.moved = true;
                                }
                              } else if (
                                slideEditBars &&
                                paintingVelocityRef.current === pad.id
                              ) {
                                updateBarVelocityFromPointer(e, pad.id, globalStep);
                              }
                            }}
                            onPointerCancel={() => {
                              touchBarGestureRef.current = null;
                            }}
                            onPointerUp={(e) => {
                              if (e.pointerType !== 'mouse' && !slideEditBars) {
                                const g = touchBarGestureRef.current;
                                touchBarGestureRef.current = null;
                                if (
                                  g &&
                                  g.padId === pad.id &&
                                  g.globalStep === globalStep &&
                                  g.pointerId === e.pointerId &&
                                  !g.moved
                                ) {
                                  const v = computeVelocityFromY(
                                    e.clientY,
                                    g.rectTop,
                                    g.rectHeight
                                  );
                                  onSetPadStepVelocity(pad.id, globalStep, v);
                                }
                              }
                            }}
                            onPointerEnter={(e) => {
                              if (
                                paintingVelocityRef.current === pad.id &&
                                (e.buttons & 1) === 1
                              ) {
                                updateBarVelocityFromPointer(e, pad.id, globalStep);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                                e.preventDefault();
                                onSetPadStepVelocity(
                                  pad.id,
                                  globalStep,
                                  Math.min(100, (vel || 40) + 10)
                                );
                              } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                                e.preventDefault();
                                const next = vel - 10;
                                onSetPadStepVelocity(
                                  pad.id,
                                  globalStep,
                                  next < 10 ? 0 : next
                                );
                              }
                            }}
                            title={`Step ${stepOffset + 1}: ${isOn ? `${vel}% velocity` : 'Off'}`}
                            className={`relative flex h-14 cursor-ns-resize flex-col justify-end overflow-hidden rounded border bg-zinc-950 select-none ${
                              slideEditBars ? 'touch-none' : 'touch-pan-y'
                            } ${
                              isPlayhead
                                ? 'border-zinc-400'
                                : 'border-zinc-800/90 hover:border-zinc-700'
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-x-0 bottom-[25%] h-px bg-zinc-800/60"
                            />
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-x-0 bottom-[50%] h-px bg-zinc-800/80"
                            />
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-x-0 bottom-[75%] h-px bg-zinc-800/60"
                            />

                            {isOn && (
                              <div
                                style={{ height: `${vel}%` }}
                                className={`w-full transition-[height] duration-75 ${
                                  vel >= 90
                                    ? isEmerald
                                      ? 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.45)]'
                                      : 'bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.45)]'
                                    : vel >= 60
                                    ? isEmerald
                                      ? 'bg-emerald-500/80'
                                      : 'bg-amber-500/80'
                                    : isEmerald
                                    ? 'bg-emerald-600/65'
                                    : 'bg-amber-600/65'
                                }`}
                              />
                            )}

                            {isOn && (
                              <span className="pointer-events-none absolute inset-x-0 bottom-0.5 text-center font-mono-tabular text-[8px] font-bold text-zinc-950">
                                {vel}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
