import React from 'react';
import { RefreshCw, Volume2 } from 'lucide-react';
import type { LoopBars, PercussionTrack } from '../types/sequencer';
import { RotaryKnob } from './RotaryKnob';

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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-sm font-semibold text-zinc-100">
            Hardware Step Matrix
          </h2>
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
                  className={`relative rounded-md px-2.5 py-1 font-mono-tabular text-xs font-semibold transition-colors whitespace-nowrap ${
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
                      className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <span className="hidden sm:inline text-zinc-500">
            Click pad to toggle · Shift+Click for accented hit
          </span>
          <button
            type="button"
            onClick={onToggleFollowPlayhead}
            aria-pressed={followPlayhead}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
              followPlayhead
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {followPlayhead ? 'Auto-Follow Bars: On' : 'Auto-Follow Bars: Off'}
          </button>
        </div>
      </div>

      {/* Scrollable Matrix Body */}
      <div className="overflow-x-auto">
        <div className="min-w-[1060px] divide-y divide-zinc-800/80">
          {/* 16-Step Ruler Header */}
          <div className="grid grid-cols-[360px_1fr] items-center bg-zinc-950/70 px-4 py-1.5">
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

          {/* Percussion & Click Channel Strips */}
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
                className={`grid grid-cols-[360px_1fr] items-center px-4 py-2 transition-colors ${
                  track.isClick ? 'bg-zinc-950/60' : 'hover:bg-zinc-900/40'
                } ${!isAudible ? 'opacity-55' : ''}`}
              >
                {/* Left Hardware Strip Controls */}
                <div className="flex items-center justify-between gap-2 pr-3">
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
                      <span
                        className={`truncate text-xs font-semibold ${
                          track.isClick ? 'text-emerald-300' : 'text-zinc-100'
                        }`}
                      >
                        {track.display_name}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center gap-1.5">
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
                        className="truncate text-[10px] text-zinc-400 max-w-[138px]"
                      >
                        {activeSample?.name ?? track.sample_search_query}
                      </span>
                    </div>
                  </div>

                  {/* Solo, Mute, Volume Fader, Pan Knob */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => onToggleSolo(track.instrument_id)}
                        aria-pressed={Boolean(track.soloed)}
                        aria-label={`Solo ${track.display_name}`}
                        className={`h-5 w-6 rounded text-[10px] font-bold transition-colors ${
                          track.soloed
                            ? 'bg-amber-500 text-zinc-950 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                            : 'border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        S
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleMute(track.instrument_id)}
                        aria-pressed={Boolean(track.muted)}
                        aria-label={`Mute ${track.display_name}`}
                        className={`h-5 w-6 rounded text-[10px] font-bold transition-colors ${
                          track.muted
                            ? 'bg-red-500 text-white shadow-[0_0_8px_rgba(239,68,68,0.45)]'
                            : 'border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        M
                      </button>
                    </div>

                    <div className="flex w-16 flex-col items-center gap-0.5">
                      <input
                        type="range"
                        min={-36}
                        max={6}
                        step={0.5}
                        value={track.volume_db}
                        onChange={(e) =>
                          onVolumeChange(track.instrument_id, Number(e.target.value))
                        }
                        aria-label={`Volume for ${track.display_name}`}
                        className="studio-slider w-16"
                      />
                      <span className="font-mono-tabular text-[10px] text-zinc-400">
                        {track.volume_db > 0 ? `+${track.volume_db}` : track.volume_db} dB
                      </span>
                    </div>

                    <RotaryKnob
                      value={track.pan}
                      onChange={(val) => onPanChange(track.instrument_id, val)}
                      label={`Pan for ${track.display_name}`}
                    />
                  </div>
                </div>

                {/* 16 LED Step Pads */}
                <div className="grid grid-cols-16 gap-1.5">
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
                        className={`relative flex h-10 flex-col items-center justify-center rounded-md border transition-all duration-100 focus-visible:outline-2 focus-visible:outline-amber-400 ${padColorClass} ${
                          isPlayhead ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-[#09090B]' : ''
                        }`}
                      >
                        <span
                          className={`h-1.5 w-4 rounded-full transition-colors ${
                            isActive
                              ? track.isClick
                                ? 'bg-emerald-300 shadow-[0_0_8px_#34D399]'
                                : isAccent
                                ? 'bg-amber-300 shadow-[0_0_8px_#F59E0B]'
                                : 'bg-amber-500/80'
                              : 'bg-zinc-800'
                          }`}
                        />
                        {isActive && (
                          <span className="mt-1 font-mono-tabular text-[9px] leading-none text-zinc-300">
                            {velocity}
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
      </div>
    </section>
  );
};
