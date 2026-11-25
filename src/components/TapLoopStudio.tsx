import React, { useRef, useState } from 'react';
import {
  Disc,
  Hand,
  Plus,
  RotateCcw,
  Timer,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { TAP_PAD_PRESETS } from '../data/presets';
import type { LoopBars, TapPad, TapPresetOption } from '../types/sequencer';
import { normalizePhase } from '../utils/tapLoopLogic';

interface TapLoopStudioProps {
  pads: TapPad[];
  bpm: number;
  loopBars: LoopBars;
  isPlaying: boolean;
  tapPhase: number;
  recordArmed: boolean;
  quantize: boolean;
  clickEnabled: boolean;
  flashingPadIds: Record<string, number>;
  padError: string | null;
  onToggleRecordArmed: () => void;
  onToggleQuantize: () => void;
  onToggleClick: () => void;
  onTapTempo: () => void;
  onPadTap: (padId: string) => void;
  onAddPad: () => void;
  onRemovePad: (padId: string) => void;
  onSelectPreset: (padId: string, preset: TapPresetOption) => void;
  onReplacePadFile: (padId: string, file: File) => void;
  onTogglePadMute: (padId: string) => void;
  onClearPadEvents: (padId: string) => void;
  onClearAllPads: () => void;
}

export const TapLoopStudio: React.FC<TapLoopStudioProps> = ({
  pads,
  bpm,
  loopBars,
  isPlaying,
  tapPhase,
  recordArmed,
  quantize,
  clickEnabled,
  flashingPadIds,
  padError,
  onToggleRecordArmed,
  onToggleQuantize,
  onToggleClick,
  onTapTempo,
  onPadTap,
  onAddPad,
  onRemovePad,
  onSelectPreset,
  onReplacePadFile,
  onTogglePadMute,
  onClearPadEvents,
  onClearAllPads,
}) => {
  const fileInputsRef = useRef<Record<string, HTMLInputElement | null>>({});
  const [tapTempoFlash, setTapTempoFlash] = useState(false);

  const safePhase = tapPhase >= 0 ? normalizePhase(tapPhase) : 0;
  const totalBeats = loopBars * 4;
  const activeBeatIndex = tapPhase >= 0 ? Math.floor(safePhase * totalBeats) % totalBeats : -1;
  const activeBeatInBar = activeBeatIndex >= 0 ? (activeBeatIndex % 4) + 1 : 0;
  const activeBar = activeBeatIndex >= 0 ? Math.floor(activeBeatIndex / 4) + 1 : 1;
  const recordedPadCount = pads.filter((p) => p.events.length > 0).length;

  const handleTapTempoClick = () => {
    setTapTempoFlash(true);
    window.setTimeout(() => setTapTempoFlash(false), 120);
    onTapTempo();
  };

  return (
    <div className="space-y-4">
      {/* Studio Toolbar & Cycle Monitor */}
      <section
        aria-label="Tap loop controls"
        className="rounded-xl border border-zinc-800 bg-[#0B0B0E]/95 p-4 shadow-2xl sm:p-5"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-1 inline-flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
              <Hand className="h-3.5 w-3.5" />
              <span>Live Hand-Rhythm Tap Looper</span>
            </div>
            <h1 className="font-display text-xl font-bold tracking-tight text-zinc-50 sm:text-2xl">
              Tap Any Pad to Record &amp; Layer Continuous Loops
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-400 sm:text-sm">
              Tap a pad following the rhythm of your hands and it loops continuously. Layer a
              second pad—like bass or talking drum—right over the first, or load custom audio from
              your phone.
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

            {/* Free Hand vs 16th Snap */}
            <button
              type="button"
              onClick={onToggleQuantize}
              aria-pressed={quantize}
              className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                quantize
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-600'
              }`}
            >
              <Disc className="h-3.5 w-3.5" />
              <span>{quantize ? 'Timing: 16th Snap' : 'Timing: Free Hand'}</span>
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

        {/* Live Cycle Sweep & Beat Pulse Bar */}
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
                  ? `LOOPING · BAR ${activeBar}/${loopBars} · BEAT ${activeBeatInBar || 1}`
                  : `STANDBY · ${loopBars} ${loopBars === 1 ? 'BAR' : 'BARS'} CYCLE`}
              </span>
              <span className="text-zinc-500">
                ({recordedPadCount}/{pads.length} pads looping)
              </span>
            </div>

            {/* 4-Beat LED Indicator */}
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
            {/* Bar division markers */}
            {Array.from({ length: loopBars - 1 }, (_, i) => (
              <span
                key={i}
                aria-hidden="true"
                style={{ left: `${((i + 1) / loopBars) * 100}%` }}
                className="absolute inset-y-0 w-px bg-zinc-700/80"
              />
            ))}
            <div
              style={{ width: isPlaying ? `${safePhase * 100}%` : '0%' }}
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

      {/* Pad Boxes Matrix (at least 6 default pads + Add Pad Box button) */}
      <section aria-label="Percussion tap pads">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:gap-4">
          {pads.map((pad, idx) => {
            const isFlashing = Boolean(flashingPadIds[pad.id]);
            const hasEvents = pad.events.length > 0;
            const isEmerald = pad.accentColor === 'emerald';
            const selectedPresetId =
              TAP_PAD_PRESETS.find((p) => p.sample.url === pad.sample.url)?.id ?? 'custom';

            return (
              <div
                key={pad.id}
                data-testid={`tap-pad-card-${idx + 1}`}
                className={`group flex flex-col overflow-hidden rounded-xl border transition-all ${
                  isFlashing
                    ? isEmerald
                      ? 'border-emerald-400 bg-emerald-500/15 shadow-[0_0_24px_rgba(16,185,129,0.28)]'
                      : 'border-amber-400 bg-amber-500/15 shadow-[0_0_24px_rgba(245,158,11,0.28)]'
                    : hasEvents && !pad.muted
                    ? isEmerald
                      ? 'border-emerald-500/45 bg-[#111316]'
                      : 'border-amber-500/45 bg-[#121216]'
                    : 'border-zinc-800 bg-[#0E0E12]'
                } ${pad.muted ? 'opacity-65' : ''}`}
              >
                {/* Top Strip: Pad index, Mute, Clear, Remove */}
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
                      title={pad.muted ? 'Unmute pad' : 'Mute pad'}
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
                      onClick={() => onClearPadEvents(pad.id)}
                      disabled={!hasEvents}
                      aria-label={`Clear loop on ${pad.name}`}
                      title="Clear recorded taps on this pad"
                      className={`flex h-6 w-6 items-center justify-center rounded border transition-colors ${
                        hasEvents
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
                        title="Remove added pad"
                        className="flex h-6 w-6 items-center justify-center rounded border border-zinc-800 bg-zinc-900 text-zinc-500 transition-colors hover:border-rose-500/40 hover:text-rose-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Main Tactile Tap Pad Surface */}
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onPadTap(pad.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onPadTap(pad.id);
                    }
                  }}
                  aria-label={`Tap pad ${idx + 1}: ${pad.name}`}
                  className="relative flex min-h-[124px] flex-1 flex-col items-center justify-center gap-2 px-3 py-4 text-center touch-manipulation select-none active:scale-[0.98] sm:min-h-[144px]"
                >
                  {/* Status Pill */}
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono-tabular text-[10px] font-semibold ${
                      hasEvents
                        ? isEmerald
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                        : 'border-zinc-800 bg-zinc-900/90 text-zinc-500'
                    }`}
                  >
                    {hasEvents ? (
                      <>
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isEmerald ? 'bg-emerald-400' : 'bg-amber-400'
                          }`}
                        />
                        {pad.events.length} {pad.events.length === 1 ? 'hit' : 'hits'} looping
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

                  {/* Recorded Events Mini Loop Timeline */}
                  <div className="relative mt-1 h-2.5 w-full overflow-hidden rounded-full border border-zinc-800/80 bg-zinc-950">
                    {pad.events.map((ev) => (
                      <span
                        key={ev.id}
                        aria-hidden="true"
                        style={{ left: `${normalizePhase(ev.phase) * 100}%` }}
                        className={`absolute top-0.5 h-1.5 w-1 -translate-x-1/2 rounded-full ${
                          isEmerald ? 'bg-emerald-400' : 'bg-amber-400'
                        }`}
                      />
                    ))}
                    {isPlaying && (
                      <span
                        aria-hidden="true"
                        style={{ left: `${safePhase * 100}%` }}
                        className="absolute inset-y-0 w-0.5 bg-white/80"
                      />
                    )}
                  </div>
                </button>

                {/* Bottom Controls: Sound Preset Selector + Replace With Phone Audio */}
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  className="flex flex-col gap-1.5 border-t border-zinc-800/80 bg-zinc-950/70 p-2"
                >
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
            className="flex min-h-[210px] flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-zinc-700/80 bg-zinc-950/50 p-4 text-center transition-all hover:border-amber-500/60 hover:bg-amber-500/5 active:scale-[0.98]"
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
    </div>
  );
};
