import React, { useRef } from 'react';
import { RefreshCw, Volume2 } from 'lucide-react';
import type { LoopBars, PercussionTrack } from '../types/sequencer';
import { formatVolumeDb } from '../utils/sequencerLogic';

interface SequencerMatrixProps {
  tracks: PercussionTrack[];
  activeBar: number; // 0..3
  onSelectBar: (barIndex: number) => void;
  followPlayhead: boolean;
  onToggleFollowPlayhead: () => void;
  loopBars: LoopBars;
  currentStep: number; // -1 when stopped, else 0..63
  swappingTrackId: string | null;
  onToggleStep: (instrumentId: string, stepIndex: number, accent?: boolean) => void;
  onToggleMute: (instrumentId: string) => void;
  onToggleSolo: (instrumentId: string) => void;
  onVolumeChange: (instrumentId: string, db: number) => void;
  onPanChange: (instrumentId: string, pan: number) => void;
  onSwapSample: (instrumentId: string) => void;
  onPreviewTrack: (track: PercussionTrack) => void;
}

const STEP_LABELS = ['1', 'e', '&', 'a', '2', 'e', '&', 'a', '3', 'e', '&', 'a', '4', 'e', '&', 'a'];

const PanKnob: React.FC<{
  value: number;
  onChange: (val: number) => void;
  label: string;
}> = ({ value, onChange, label }) => {
  const dragRef = useRef<{ y: number; start: number } | null>(null);
  const safeVal = Math.max(-1, Math.min(1, value));
  const angleDeg = safeVal * 135;
  const panText =
    Math.abs(safeVal) < 0.05
      ? 'C'
      : safeVal < 0
      ? `L${Math.round(Math.abs(safeVal) * 100)}`
      : `R${Math.round(safeVal * 100)}`;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={Math.round(safeVal * 100)}
        aria-valuetext={panText}
        onPointerDown={(e) => {
          e.preventDefault();
          dragRef.current = { y: e.clientY, start: safeVal };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          const delta = (dragRef.current.y - e.clientY) / 70;
          onChange(Math.max(-1, Math.min(1, Number((dragRef.current.start + delta).toFixed(2)))));
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onDoubleClick={() => onChange(0)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            onChange(Math.min(1, Number((safeVal + 0.1).toFixed(2))));
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(Math.max(-1, Number((safeVal - 0.1).toFixed(2))));
          }
        }}
        title="Drag to pan L/R · Double-click to center"
        className="relative flex h-7 w-7 cursor-ns-resize select-none touch-none items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 focus-visible:outline-2 focus-visible:outline-amber-400"
      >
        <div
          className="h-3 w-0.5 origin-bottom rounded-full bg-amber-400"
          style={{ transform: `rotate(${angleDeg}deg) translateY(-2px)` }}
        />
      </div>
      <span className="font-mono-tabular text-[9px] leading-none text-zinc-500">{panText}</span>
    </div>
  );
};

export const SequencerMatrix: React.FC<SequencerMatrixProps> = ({
  tracks,
  activeBar,
  onSelectBar,
  followPlayhead,
  onToggleFollowPlayhead,
  loopBars,
  currentStep,
  swappingTrackId,
  onToggleStep,
  onToggleMute,
  onToggleSolo,
  onVolumeChange,
  onPanChange,
  onSwapSample,
  onPreviewTrack,
}) => {
  const anySoloed = tracks.some((t) => Boolean(t.soloed));
  const playingBar = currentStep >= 0 ? Math.floor(currentStep / 16) : -1;
  const displayedBar = followPlayhead && playingBar >= 0 ? playingBar : activeBar;
  const stepOffset = displayedBar * 16;

  return (
    <section
      aria-label="16-Step Hardware Percussion Sequencer"
      className="rounded-xl border border-zinc-800 bg-[#111114]/90 backdrop-blur-md"
    >
      {/* Matrix Bar Selector & Step Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-3 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <h1 className="font-display text-sm font-semibold text-zinc-100 sm:text-base">
            16-Step Studio Matrix
          </h1>
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            {[0, 1, 2, 3].map((barIdx) => {
              const disabled = barIdx >= loopBars;
              const isSelected = displayedBar === barIdx;
              const isPlayingHere = playingBar === barIdx;
              return (
                <button
                  key={barIdx}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelectBar(barIdx)}
                  className={`relative rounded-md px-2 py-1 font-mono-tabular text-[11px] font-semibold transition-colors whitespace-nowrap sm:px-2.5 sm:text-xs ${
                    isSelected
                      ? 'bg-zinc-800 text-amber-400'
                      : disabled
                      ? 'cursor-not-allowed text-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Bar {barIdx + 1}
                  {isPlayingHere && (
                    <span
                      aria-hidden="true"
                      className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="hidden xl:inline text-zinc-500">
            Click pad to toggle · Shift+Click for accent
          </span>
          <button
            type="button"
            onClick={onToggleFollowPlayhead}
            aria-pressed={followPlayhead}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap sm:text-xs ${
              followPlayhead
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {followPlayhead ? 'Auto-Follow: On' : 'Auto-Follow: Off'}
          </button>
        </div>
      </div>

      {/* Desktop Header Ruler (>= 1024px) */}
      <div className="hidden lg:grid lg:grid-cols-[350px_1fr] items-center border-b border-zinc-800/80 bg-zinc-950/70 px-4 py-1.5">
        <div className="flex items-center justify-between pr-4 text-[11px] font-semibold tracking-wide text-zinc-500">
          <span>CHANNEL / ACOUSTIC SAMPLE</span>
          <span>S · M · VOL · PAN</span>
        </div>
        <div className="grid grid-cols-16 gap-1.5">
          {STEP_LABELS.map((lbl, i) => {
            const absStep = stepOffset + i;
            const isPlayhead = currentStep === absStep;
            const isBeatStart = i % 4 === 0;
            return (
              <div
                key={i}
                className={`flex h-6 items-center justify-center rounded font-mono-tabular text-[11px] font-semibold transition-colors ${
                  isPlayhead
                    ? 'bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-400/60'
                    : isBeatStart
                    ? 'text-amber-400'
                    : 'text-zinc-500'
                }`}
              >
                {lbl}
              </div>
            );
          })}
        </div>
      </div>

      {/* Responsive Channel Strips */}
      <div className="divide-y divide-zinc-800/80">
        {tracks.map((track) => {
          const activeSample = track.samples?.[track.activeSampleIndex ?? 0];
          const sampleIndex = (track.activeSampleIndex ?? 0) + 1;
          const sampleTotal = track.samples?.length ?? 1;
          const isAudible = !track.muted && (!anySoloed || Boolean(track.soloed));
          const isSwapping = swappingTrackId === track.instrument_id;

          return (
            <div
              key={track.instrument_id}
              data-testid={`channel-strip-${track.instrument_id}`}
              className={`flex flex-col gap-3 px-3 py-3 transition-colors sm:px-4 lg:grid lg:grid-cols-[350px_1fr] lg:items-center lg:gap-0 lg:py-2 ${
                track.isClick ? 'bg-zinc-950/60' : 'hover:bg-zinc-900/40'
              } ${!isAudible ? 'opacity-55' : ''}`}
            >
              {/* Strip Controls */}
              <div className="flex min-w-0 items-center justify-between gap-2 lg:pr-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onPreviewTrack(track)}
                      aria-label={`Audition ${track.display_name}`}
                      title="Audition sample"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-zinc-800 bg-zinc-900 text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-400"
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleSolo(track.instrument_id)}
                      title={`Click to hear only ${track.display_name}`}
                      className={`truncate rounded px-1 py-0.5 text-left text-xs font-semibold transition-colors ${
                        track.soloed
                          ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50'
                          : track.isClick
                          ? 'text-emerald-300 hover:bg-zinc-800/80'
                          : 'text-zinc-100 hover:bg-zinc-800/80 hover:text-amber-300'
                      }`}
                    >
                      {track.display_name}
                    </button>
                  </div>

                  <div className="mt-1 flex min-w-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSwapSample(track.instrument_id)}
                      disabled={isSwapping}
                      aria-label={`Swap sample for ${track.display_name}`}
                      title="Cycle through real Freesound / CDN acoustic recordings"
                      className="flex shrink-0 items-center gap-1 rounded border border-zinc-800 bg-zinc-900/90 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 transition-colors hover:border-amber-500/50 hover:text-amber-300 whitespace-nowrap"
                    >
                      <RefreshCw
                        className={`h-2.5 w-2.5 ${isSwapping ? 'animate-spin' : ''}`}
                      />
                      <span>
                        Swap ({sampleIndex}/{sampleTotal})
                      </span>
                    </button>
                    <span
                      title={activeSample?.name ?? track.sample_search_query}
                      className="truncate text-[10px] text-zinc-400"
                    >
                      {activeSample?.name ?? track.sample_search_query}
                    </span>
                  </div>
                </div>

                {/* Solo (Hear Only), Mute, Volume Fader, Pan Knob */}
                <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => onToggleSolo(track.instrument_id)}
                      aria-pressed={Boolean(track.soloed)}
                      aria-label={`Hear only ${track.display_name}`}
                      title={track.soloed ? 'Playing only this track (click for all)' : 'Hear only this track'}
                      className={`h-5 min-w-[34px] rounded px-1 text-[9px] font-bold transition-colors whitespace-nowrap ${
                        track.soloed
                          ? 'bg-amber-500 text-zinc-950 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                          : 'border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-500/50 hover:text-amber-300'
                      }`}
                    >
                      {track.soloed ? 'Only' : 'S'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleMute(track.instrument_id)}
                      aria-pressed={Boolean(track.muted)}
                      aria-label={`Mute ${track.display_name}`}
                      className={`h-5 min-w-[34px] rounded px-1 text-[10px] font-bold transition-colors ${
                        track.muted
                          ? 'bg-red-500 text-white shadow-[0_0_8px_rgba(239,68,68,0.45)]'
                          : 'border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      M
                    </button>
                  </div>

                  <div className="flex w-14 flex-col items-center gap-0.5 sm:w-16">
                    <input
                      type="range"
                      min={-60}
                      max={6}
                      step={0.5}
                      value={track.volume_db}
                      onChange={(e) =>
                        onVolumeChange(track.instrument_id, Number(e.target.value))
                      }
                      aria-label={`Volume for ${track.display_name}`}
                      className="studio-slider w-14 sm:w-16"
                    />
                    <span className="font-mono-tabular text-[10px] text-zinc-400">
                      {formatVolumeDb(track.volume_db)}
                    </span>
                  </div>

                  <PanKnob
                    value={track.pan}
                    onChange={(val) => onPanChange(track.instrument_id, val)}
                    label={`Pan for ${track.display_name}`}
                  />
                </div>
              </div>

              {/* 16 LED Step Pads: 8x2 on mobile/tablet, 16x1 on desktop */}
              <div className="grid grid-cols-8 gap-1.5 lg:grid-cols-16">
                {Array.from({ length: 16 }).map((_, localIdx) => {
                  const absStep = stepOffset + localIdx;
                  const velocity = track.steps[absStep] ?? 0;
                  const isActive = velocity > 0;
                  const isAccent = velocity >= 90;
                  const isPlayhead = currentStep === absStep;
                  const isBeatGroupOdd = Math.floor(localIdx / 4) % 2 === 1;

                  let padColorClass = isBeatGroupOdd
                    ? 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-600'
                    : 'border-zinc-800 bg-zinc-950/90 hover:border-zinc-600';

                  if (isActive && track.isClick) {
                    padColorClass =
                      'border-emerald-400 bg-emerald-500/30 shadow-[inset_0_0_12px_rgba(16,185,129,0.45)]';
                  } else if (isActive) {
                    padColorClass = isAccent
                      ? 'border-amber-400 bg-amber-500/35 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                      : 'border-amber-500/60 bg-amber-500/20';
                  }

                  return (
                    <button
                      key={absStep}
                      type="button"
                      onClick={(e) =>
                        onToggleStep(track.instrument_id, absStep, e.shiftKey)
                      }
                      aria-pressed={isActive}
                      aria-label={`${track.display_name} Bar ${displayedBar + 1} Step ${localIdx + 1} ${isActive ? `velocity ${velocity}` : 'off'}`}
                      className={`relative flex h-9 flex-col items-center justify-center rounded-md border transition-all duration-100 focus-visible:outline-2 focus-visible:outline-amber-400 lg:h-10 ${padColorClass} ${
                        isPlayhead
                          ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-[#09090B]'
                          : ''
                      }`}
                    >
                      <span
                        className={`h-1.5 w-3.5 rounded-full transition-colors sm:w-4 ${
                          isActive
                            ? track.isClick
                              ? 'bg-emerald-300 shadow-[0_0_8px_#34D399]'
                              : isAccent
                              ? 'bg-amber-300 shadow-[0_0_8px_#F59E0B]'
                              : 'bg-amber-500/80'
                            : 'bg-zinc-800'
                        }`}
                      />
                      {isActive ? (
                        <span className="mt-0.5 font-mono-tabular text-[9px] leading-none text-zinc-300 lg:mt-1">
                          {velocity}
                        </span>
                      ) : (
                        <span className="mt-0.5 font-mono-tabular text-[8px] leading-none text-zinc-600 lg:hidden">
                          {STEP_LABELS[localIdx]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
