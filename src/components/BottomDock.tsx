import React from 'react';
import { Disc3, Hand, Layers, Play, Sliders, Sparkles, Square, Timer } from 'lucide-react';
import type { LoopBars, StudioPage } from '../types/sequencer';
import { formatBarBeatStep } from '../utils/sequencerLogic';

interface BottomDockProps {
  activePage: StudioPage;
  onSelectPage: (page: StudioPage) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  currentStep: number;
  customStepDisplay?: string | null;
  loopBars: LoopBars;
  onLoopBarsChange: (bars: LoopBars) => void;
  metronomeEnabled: boolean;
  onToggleMetronome: () => void;
  blendRatio: number;
  onBlendChange: (ratio: number) => void;
  hasOriginalAudio: boolean;
}

const NAV_ITEMS: Array<{
  id: StudioPage;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'compose',
    label: 'Needs Percussion',
    shortLabel: 'Compose',
    icon: Sparkles,
  },
  {
    id: 'extract',
    label: 'Exact Song Loop',
    shortLabel: 'Exact',
    icon: Disc3,
  },
  {
    id: 'taploop',
    label: 'Tap Loop',
    shortLabel: 'Tap Loop',
    icon: Hand,
  },
  {
    id: 'sequencer',
    label: 'Studio Sequencer',
    shortLabel: 'Sequencer',
    icon: Sliders,
  },
  {
    id: 'stems',
    label: 'Stem Builder',
    shortLabel: 'Stems',
    icon: Layers,
  },
];

export const BottomDock: React.FC<BottomDockProps> = ({
  activePage,
  onSelectPage,
  isPlaying,
  onTogglePlay,
  currentStep,
  customStepDisplay,
  loopBars,
  onLoopBarsChange,
  metronomeEnabled,
  onToggleMetronome,
  blendRatio,
  onBlendChange,
  hasOriginalAudio,
}) => {
  const stepDisplay =
    customStepDisplay ?? (currentStep >= 0 ? formatBarBeatStep(currentStep) : '01.1.1');
  const percPercent = Math.round((1 - blendRatio) * 100);
  const origPercent = Math.round(blendRatio * 100);

  return (
    <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800/90 bg-[#0B0B0F]/95 backdrop-blur-xl">
      {/* Row 1: Precision Transport Console */}
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-2 border-b border-zinc-800/70 px-3 py-2 sm:gap-3 sm:px-6">
        {/* Left: Primary Transport + Step Clock + Metronome */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Stop playback' : 'Start playback'}
            className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold tracking-wide transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-amber-400 sm:h-9 sm:px-3.5 ${
              isPlaying
                ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
                : 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
            }`}
          >
            {isPlaying ? (
              <>
                <Square className="h-3 w-3 fill-current" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Play className="h-3 w-3 fill-current" />
                <span>Play</span>
              </>
            )}
          </button>

          <span
            data-testid="transport-counter"
            className="font-mono-tabular flex h-8 items-center rounded-lg border border-zinc-800 bg-zinc-950 px-2 text-xs font-semibold text-zinc-100 sm:h-9 sm:px-2.5"
          >
            {stepDisplay}
          </span>

          <button
            type="button"
            onClick={onToggleMetronome}
            aria-pressed={metronomeEnabled}
            aria-label={metronomeEnabled ? 'Metronome Click: On' : 'Metronome Click: Off'}
            title="Toggle Metronome Click"
            className={`flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 sm:h-9 sm:px-2.5 ${
              metronomeEnabled
                ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300'
                : 'border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Timer className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">
              {metronomeEnabled ? 'Click On' : 'Click Off'}
            </span>
          </button>
        </div>

        {/* Center: Loop Bar Length Segmented Control */}
        <div
          role="group"
          aria-label="Loop bar selector"
          className="flex shrink-0 items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5"
        >
          {([1, 2, 4] as LoopBars[]).map((bars) => (
            <button
              key={bars}
              type="button"
              onClick={() => onLoopBarsChange(bars)}
              aria-pressed={loopBars === bars}
              className={`h-7 rounded-md px-2 font-mono-tabular text-[11px] font-semibold transition-colors whitespace-nowrap sm:h-8 sm:px-3 sm:text-xs ${
                loopBars === bars
                  ? 'bg-amber-500 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {bars}B
            </button>
          ))}
        </div>

        {/* Right: Loop vs Original Audio Blend */}
        <div
          className={`shrink-0 items-center gap-1.5 sm:min-w-[200px] sm:justify-end sm:gap-2 ${
            hasOriginalAudio ? 'flex' : 'hidden sm:flex'
          }`}
        >
          <button
            type="button"
            onClick={() => onBlendChange(0)}
            className={`hidden text-[11px] font-medium transition-colors whitespace-nowrap md:inline ${
              blendRatio < 0.15 ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Loop
          </button>

          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={blendRatio}
            onChange={(e) => onBlendChange(Number(e.target.value))}
            aria-label="Blend percussion loop with original audio"
            title={
              hasOriginalAudio
                ? `Percussion ${percPercent}% · Original ${origPercent}%`
                : 'Percussion Only (Upload audio to blend)'
            }
            className="studio-slider w-14 sm:w-28"
          />

          <button
            type="button"
            disabled={!hasOriginalAudio}
            onClick={() => onBlendChange(0.5)}
            className={`font-mono-tabular text-[11px] font-medium transition-colors whitespace-nowrap ${
              !hasOriginalAudio
                ? 'cursor-not-allowed text-zinc-600'
                : blendRatio >= 0.15
                ? 'text-amber-400'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {hasOriginalAudio ? `${origPercent}%` : 'Mix'}
          </button>
        </div>
      </div>

      {/* Row 2: Clean 5-Tab Studio Navigation */}
      <nav
        aria-label="Studio pages"
        className="mx-auto grid max-w-[1440px] grid-cols-5 px-1 sm:px-6"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectPage(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex h-12 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-semibold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-amber-400 sm:h-12 sm:flex-row sm:gap-2 sm:px-3 sm:text-xs ${
                isActive
                  ? 'bg-amber-500/8 text-amber-400'
                  : 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'
              }`}
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-amber-400 sm:inset-x-8"
                />
              )}
              <Icon className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              <span className="sm:hidden">{item.shortLabel}</span>
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </footer>
  );
};
