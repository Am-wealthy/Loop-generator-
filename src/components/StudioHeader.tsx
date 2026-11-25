import React, { useRef, useState } from 'react';
import { Download, KeyRound, Minus, Plus, Loader2 } from 'lucide-react';
import { clampBpm } from '../utils/sequencerLogic';

interface StudioHeaderProps {
  bpm: number;
  onBpmChange: (nextBpm: number) => void;
  grooveStyle: string;
  timeSignature: string;
  isPlaying: boolean;
  freesoundConnected: boolean;
  onOpenFreesoundModal: () => void;
  onExportWav: () => void;
  isExporting: boolean;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  bpm,
  onBpmChange,
  grooveStyle,
  timeSignature,
  isPlaying,
  freesoundConnected,
  onOpenFreesoundModal,
  onExportWav,
  isExporting,
}) => {
  const dragStartY = useRef<number | null>(null);
  const dragStartBpm = useRef<number>(bpm);
  const [isEditingBpm, setIsEditingBpm] = useState(false);
  const [bpmDraft, setBpmDraft] = useState(String(bpm));

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isEditingBpm) return;
    dragStartY.current = e.clientY;
    dragStartBpm.current = bpm;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return;
    const deltaY = dragStartY.current - e.clientY;
    const deltaBpm = Math.round(deltaY / 3);
    if (deltaBpm !== 0) {
      onBpmChange(clampBpm(dragStartBpm.current + deltaBpm));
    }
  };

  const handlePointerUp = () => {
    dragStartY.current = null;
  };

  const commitBpmDraft = () => {
    const parsed = Number(bpmDraft);
    if (Number.isFinite(parsed)) {
      onBpmChange(clampBpm(parsed));
    }
    setIsEditingBpm(false);
  };

  const grooveBadgeLabel = `${grooveStyle.toUpperCase()} • ${bpm} BPM`;

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800 bg-[#09090B]/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2.5 px-3 py-2.5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-4 lg:py-3">
        {/* Row 1 on mobile / Left+Right on desktop */}
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/90 shadow-inner sm:h-10 sm:w-10"
              aria-hidden="true"
            >
              <svg viewBox="0 0 28 24" className="h-5 w-6 text-amber-400" fill="none">
                <rect
                  x="2"
                  y={isPlaying ? '6' : '9'}
                  width="3"
                  height={isPlaying ? '12' : '6'}
                  rx="1.5"
                  fill="currentColor"
                  className={isPlaying ? 'animate-pulse' : ''}
                />
                <rect
                  x="8"
                  y={isPlaying ? '2' : '5'}
                  width="3"
                  height={isPlaying ? '20' : '14'}
                  rx="1.5"
                  fill="currentColor"
                />
                <rect
                  x="14"
                  y={isPlaying ? '5' : '3'}
                  width="3"
                  height={isPlaying ? '14' : '18'}
                  rx="1.5"
                  fill="#10B981"
                />
                <rect
                  x="20"
                  y={isPlaying ? '3' : '7'}
                  width="3"
                  height={isPlaying ? '18' : '10'}
                  rx="1.5"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <span className="font-display block truncate text-base font-bold tracking-tight text-zinc-100 sm:text-lg">
                PRAISELOOP AI
              </span>
              <span className="hidden truncate text-[11px] font-medium tracking-wide text-zinc-400 sm:block">
                Afro-Gospel Percussion Console
              </span>
            </div>
          </div>

          {/* Mobile compact actions */}
          <div className="flex shrink-0 items-center gap-2 lg:hidden">
            <button
              type="button"
              onClick={onOpenFreesoundModal}
              aria-label={freesoundConnected ? 'Freesound Key: Active' : 'Freesound API Key'}
              className={`flex h-9 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                freesoundConnected
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-zinc-700 bg-zinc-900/80 text-zinc-300'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span className="hidden xs:inline">Freesound</span>
            </button>

            <button
              type="button"
              onClick={onExportWav}
              disabled={isExporting}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-[11px] font-bold tracking-wide text-zinc-950 shadow-[0_0_16px_rgba(245,158,11,0.3)] transition-all hover:bg-amber-400 disabled:opacity-60 whitespace-nowrap"
            >
              {isExporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              <span>{isExporting ? 'WAV...' : 'EXPORT WAV'}</span>
            </button>
          </div>
        </div>

        {/* Center Groove Style Badge + Master BPM Hardware Control */}
        <div className="flex min-w-0 items-center justify-between gap-2 lg:justify-center lg:gap-3">
          <div
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/75 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 lg:flex-initial lg:px-3 lg:text-xs"
            title={`Time signature: ${timeSignature}`}
          >
            <span className="font-mono-tabular truncate font-semibold tracking-wide text-amber-400">
              {grooveBadgeLabel}
            </span>
            <span className="hidden text-zinc-600 sm:inline" aria-hidden="true">
              /
            </span>
            <span className="hidden shrink-0 text-zinc-400 sm:inline">{timeSignature}</span>
          </div>

          <div
            className="flex shrink-0 items-center rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 shadow-inner sm:p-1"
            aria-label="Master BPM adjuster"
          >
            <button
              type="button"
              onClick={() => onBpmChange(clampBpm(bpm - 1))}
              aria-label="Decrease BPM"
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-amber-500 sm:h-8 sm:w-8"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>

            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onDoubleClick={() => {
                setBpmDraft(String(bpm));
                setIsEditingBpm(true);
              }}
              title="Drag vertically to scrub BPM, or double-click to type"
              className="flex min-w-[68px] cursor-ns-resize select-none items-baseline justify-center gap-1 px-1.5 sm:min-w-[82px] sm:px-2"
            >
              {isEditingBpm ? (
                <input
                  type="number"
                  min={40}
                  max={220}
                  value={bpmDraft}
                  autoFocus
                  onChange={(e) => setBpmDraft(e.target.value)}
                  onBlur={commitBpmDraft}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitBpmDraft();
                    if (e.key === 'Escape') setIsEditingBpm(false);
                  }}
                  aria-label="Master BPM value"
                  className="font-mono-tabular w-12 rounded bg-zinc-900 px-1 text-center text-sm font-bold text-amber-400 outline-none ring-1 ring-amber-500 sm:w-14"
                />
              ) : (
                <>
                  <span className="font-mono-tabular text-sm font-bold text-amber-400 sm:text-base">
                    {bpm}
                  </span>
                  <span className="text-[10px] font-medium text-zinc-500">BPM</span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => onBpmChange(clampBpm(bpm + 1))}
              aria-label="Increase BPM"
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-amber-500 sm:h-8 sm:w-8"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Desktop actions */}
        <div className="hidden shrink-0 items-center gap-3 lg:flex">
          <button
            type="button"
            onClick={onOpenFreesoundModal}
            className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-amber-500 ${
              freesoundConnected
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                : 'border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100'
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>{freesoundConnected ? 'Freesound Key: Active' : 'Freesound API Key'}</span>
          </button>

          <button
            type="button"
            onClick={onExportWav}
            disabled={isExporting}
            className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold tracking-wide text-zinc-950 shadow-[0_0_24px_rgba(245,158,11,0.35)] transition-all hover:bg-amber-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-amber-300"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            <span>{isExporting ? 'RENDERING WAV...' : 'EXPORT WAV + CLICK'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
