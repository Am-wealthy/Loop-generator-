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
    shortLabel: 'Add Loop',
    icon: Sparkles,
  },
  {
    id: 'extract',
    label: 'Exact Song Loop',
    shortLabel: 'Exact Loop',
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
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-[#0B0B0E]/95 backdrop-blur-xl">
      {/* Compact Transport Strip */}
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-2 border-b border-zinc-800/80 px-2.5 py-1.5 sm:px-6 sm:py-2">
        {/* Play/Stop + Step Counter */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Stop playback' : 'Start playback'}
            className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-bold tracking-wide transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-amber-400 sm:h-9 sm:px-3.5 sm:text-xs ${
              isPlaying
                ? 'bg-emerald-500 text-zinc-950 shadow-[0_0_16px_rgba(16,185,129,0.4)] hover:bg-emerald-400'
                : 'bg-amber-500 text-zinc-950 shadow-[0_0_16px_rgba(245,158,11,0.3)] hover:bg-amber-400'
            }`}
          >
            {isPlaying ? (
              <>
                <Square className="h-3 w-3 fill-current" />
                <span>STOP</span>
              </>
            ) : (
              <>
                <Play className="h-3 w-3 fill-current" />
                <span>PLAY</span>
              </>
            )}
          </button>

          <span
            data-testid="transport-counter"
            className="font-mono-tabular rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] font-bold text-zinc-100 sm:text-xs"
          >
            {stepDisplay}
          </span>

          <button
            type="button"
            onClick={onToggleMetronome}
            aria-pressed={metronomeEnabled}
            aria-label={metronomeEnabled ? 'Metronome Click: On' : 'Metronome Click: Off'}
            title="Switch Metronome On or Off"
            className={`flex h-8 items-center gap-1 rounded-lg border px-2 text-[10px] font-bold transition-colors whitespace-nowrap sm:h-9 sm:px-2.5 sm:text-[11px] ${
              metronomeEnabled
                ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Timer className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden xs:inline sm:inline">
              {metronomeEnabled ? 'Click On' : 'Click Off'}
            </span>
          </button>
        </div>

        {/* Loop Bar Selector */}
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
              className={`rounded-md px-2 py-1 font-mono-tabular text-[10px] font-semibold transition-colors whitespace-nowrap sm:px-2.5 sm:text-xs ${
                loopBars === bars
                  ? 'bg-amber-500 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {bars}B
            </button>
          ))}
        </div>

        {/* Loop Only vs Blend Original Audio Crossfader */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:max-w-xs sm:gap-2">
          <button
            type="button"
            onClick={() => onBlendChange(0)}
            className={`hidden text-[11px] font-medium transition-colors whitespace-nowrap sm:inline ${
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
            className="studio-slider w-12 min-w-[44px] max-w-[76px] flex-1 sm:w-28 sm:max-w-none"
          />

          <button
            type="button"
            disabled={!hasOriginalAudio}
            onClick={() => onBlendChange(0.5)}
            className={`text-[10px] font-medium transition-colors whitespace-nowrap sm:text-[11px] ${
              !hasOriginalAudio
                ? 'cursor-not-allowed text-zinc-600'
                : blendRatio >= 0.15
                ? 'text-amber-400'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {hasOriginalAudio ? `Blend ${origPercent}%` : 'Blend'}
          </button>
        </div>
      </div>

      {/* Bottom Navigation Bar */}
      <nav
        aria-label="Studio pages"
        className="mx-auto grid max-w-[1440px] grid-cols-5"
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
              className={`relative flex h-11 items-center justify-center gap-1 px-0.5 text-[10px] font-semibold transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-amber-400 sm:h-12 sm:gap-2 sm:px-2 sm:text-xs ${
                isActive
                  ? 'text-amber-400 bg-amber-500/5'
                  : 'text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200'
              }`}
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute top-0 inset-x-3 h-0.5 rounded-full bg-amber-400 shadow-[0_0_8px_#F59E0B] sm:inset-x-6"
                />
              )}
              <Icon className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              <span className="sm:hidden">{item.shortLabel}</span>
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
