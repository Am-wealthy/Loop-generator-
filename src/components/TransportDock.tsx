import React from 'react';
import { Play, Square } from 'lucide-react';
import type { LoopBars } from '../types/sequencer';
import { formatBarBeatStep } from '../utils/sequencerLogic';

interface TransportDockProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  currentStep: number;
  loopBars: LoopBars;
  onLoopBarsChange: (bars: LoopBars) => void;
  blendRatio: number;
  onBlendChange: (ratio: number) => void;
  hasOriginalAudio: boolean;
}

export const TransportDock: React.FC<TransportDockProps> = ({
  isPlaying,
  onTogglePlay,
  currentStep,
  loopBars,
  onLoopBarsChange,
  blendRatio,
  onBlendChange,
  hasOriginalAudio,
}) => {
  const stepDisplay = currentStep >= 0 ? formatBarBeatStep(currentStep) : '01.1.1';
  const percPercent = Math.round((1 - blendRatio) * 100);
  const origPercent = Math.round(blendRatio * 100);

  return (
    <div className="fixed bottom-3 left-1/2 z-40 w-[calc(100%-1.5rem)] max-w-4xl -translate-x-1/2">
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-zinc-800 bg-[#121216]/95 px-3.5 py-2.5 shadow-[0_18px_50px_rgba(0,0,0,0.75)] backdrop-blur-xl sm:gap-3 sm:px-5 sm:py-3">
        {/* Play / Stop + Counter */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Stop playback' : 'Start playback'}
            className={`flex h-9 items-center gap-2 rounded-xl px-3.5 text-xs font-bold tracking-wide transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-amber-400 sm:h-10 sm:px-4 ${
              isPlaying
                ? 'bg-emerald-500 text-zinc-950 shadow-[0_0_20px_rgba(16,185,129,0.45)] hover:bg-emerald-400'
                : 'bg-amber-500 text-zinc-950 shadow-[0_0_20px_rgba(245,158,11,0.35)] hover:bg-amber-400'
            }`}
          >
            {isPlaying ? (
              <>
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>STOP</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>PLAY</span>
              </>
            )}
          </button>

          <div className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1">
            <span className="hidden sm:block text-[9px] font-medium tracking-wider text-zinc-500">
              BAR · BEAT · STEP
            </span>
            <span
              data-testid="transport-counter"
              className="font-mono-tabular text-xs font-bold text-zinc-100 sm:text-sm"
            >
              {stepDisplay}
            </span>
          </div>
        </div>

        {/* Loop Bar Selector */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="hidden sm:inline text-[11px] font-medium text-zinc-400 whitespace-nowrap">
            Loop
          </span>
          <div
            role="group"
            aria-label="Loop bar selector"
            className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1"
          >
            {([1, 2, 4] as LoopBars[]).map((bars) => (
              <button
                key={bars}
                type="button"
                onClick={() => onLoopBarsChange(bars)}
                aria-pressed={loopBars === bars}
                className={`rounded-md px-2 py-1 font-mono-tabular text-[11px] font-semibold transition-colors whitespace-nowrap sm:px-2.5 sm:text-xs ${
                  loopBars === bars
                    ? 'bg-amber-500 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {bars} {bars === 1 ? 'BAR' : 'BARS'}
              </button>
            ))}
          </div>
        </div>

        {/* Percussion Loop Only vs Blend with Original Audio Crossfader */}
        <div className="flex w-full items-center gap-2.5 sm:w-auto sm:min-w-[240px]">
          <button
            type="button"
            onClick={() => onBlendChange(0)}
            className={`text-[11px] font-medium transition-colors whitespace-nowrap ${
              blendRatio < 0.15 ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Loop Only
          </button>

          <div className="flex flex-1 flex-col items-center">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={blendRatio}
              onChange={(e) => onBlendChange(Number(e.target.value))}
              aria-label="Blend percussion loop with original audio"
              className="studio-slider w-full min-w-[90px]"
            />
            <span className="font-mono-tabular hidden sm:block mt-0.5 text-[10px] text-zinc-500 whitespace-nowrap">
              {hasOriginalAudio
                ? `Perc ${percPercent}% · Orig ${origPercent}%`
                : 'Percussion Only (Upload audio to blend)'}
            </span>
          </div>

          <button
            type="button"
            disabled={!hasOriginalAudio}
            onClick={() => onBlendChange(0.5)}
            className={`text-[11px] font-medium transition-colors whitespace-nowrap ${
              !hasOriginalAudio
                ? 'cursor-not-allowed text-zinc-600'
                : blendRatio >= 0.15
                ? 'text-amber-400'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Blend Orig
          </button>
        </div>
      </div>
    </div>
  );
};
