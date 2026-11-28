import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, CircleDot, Keyboard } from 'lucide-react';
import type { ScaleType } from '../types/sequencer';
import {
  isBlackKeyMidi,
  isMidiInScale,
  midiToNoteName,
  MUSICAL_KEYS,
  type MusicalKey,
} from '../utils/stemBuilderLogic';

interface PianoKeyboardRowProps {
  baseOctave: number; // 2..5
  onBaseOctaveChange: (oct: number) => void;
  rootKey: MusicalKey;
  scaleType: ScaleType;
  soundLabel: string;
  punchInRecord: boolean;
  onTogglePunchIn: () => void;
  activePlayingMidis: number[];
  onPlayKey: (midi: number) => void;
}

const WHITE_KEY_SEMITONE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_KEY_SPECS: Array<{ offsetInOctave: number; afterWhiteIndex: number }> = [
  { offsetInOctave: 1, afterWhiteIndex: 0 }, // C#
  { offsetInOctave: 3, afterWhiteIndex: 1 }, // Eb
  { offsetInOctave: 6, afterWhiteIndex: 3 }, // F#
  { offsetInOctave: 8, afterWhiteIndex: 4 }, // Ab
  { offsetInOctave: 10, afterWhiteIndex: 5 }, // Bb
];

export const PianoKeyboardRow: React.FC<PianoKeyboardRowProps> = ({
  baseOctave,
  onBaseOctaveChange,
  rootKey,
  scaleType,
  soundLabel,
  punchInRecord,
  onTogglePunchIn,
  activePlayingMidis,
  onPlayKey,
}) => {
  const [pressedMidis, setPressedMidis] = useState<number[]>([]);

  const clampedOctave = Math.max(2, Math.min(4, baseOctave));
  const startMidi = (clampedOctave + 1) * 12; // e.g., Oct 3 => C3 (48) .. B4 (71)
  const rootPc = MUSICAL_KEYS.indexOf(rootKey);

  const { whiteKeys, blackKeys } = useMemo(() => {
    const whites: Array<{ midi: number; label: string; inScale: boolean; isRoot: boolean }> =
      [];
    const blacks: Array<{
      midi: number;
      label: string;
      leftPercent: number;
      inScale: boolean;
      isRoot: boolean;
    }> = [];

    for (let octIdx = 0; octIdx < 2; octIdx++) {
      const octStart = startMidi + octIdx * 12;
      WHITE_KEY_SEMITONE_OFFSETS.forEach((semi) => {
        const midi = octStart + semi;
        const pc = ((midi % 12) + 12) % 12;
        whites.push({
          midi,
          label: midiToNoteName(midi),
          inScale: isMidiInScale(midi, rootKey, scaleType),
          isRoot: pc === rootPc,
        });
      });

      BLACK_KEY_SPECS.forEach((spec) => {
        const midi = octStart + spec.offsetInOctave;
        const whiteBoundary = octIdx * 7 + spec.afterWhiteIndex + 1;
        const pc = ((midi % 12) + 12) % 12;
        blacks.push({
          midi,
          label: midiToNoteName(midi),
          leftPercent: (whiteBoundary / 14) * 100,
          inScale: isMidiInScale(midi, rootKey, scaleType),
          isRoot: pc === rootPc,
        });
      });
    }

    return { whiteKeys: whites, blackKeys: blacks };
  }, [startMidi, rootKey, scaleType, rootPc]);

  const activeSet = useMemo(
    () => new Set([...activePlayingMidis, ...pressedMidis]),
    [activePlayingMidis, pressedMidis]
  );

  const handlePressStart = (midi: number) => {
    setPressedMidis((prev) => (prev.includes(midi) ? prev : [...prev, midi]));
    onPlayKey(midi);
  };

  const handlePressEnd = (midi: number) => {
    setPressedMidis((prev) => prev.filter((m) => m !== midi));
  };

  React.useEffect(() => {
    const clearAll = () => setPressedMidis([]);
    window.addEventListener('pointerup', clearAll);
    window.addEventListener('blur', clearAll);
    return () => {
      window.removeEventListener('pointerup', clearAll);
      window.removeEventListener('blur', clearAll);
    };
  }, []);

  const rangeLabel = `${midiToNoteName(startMidi)} – ${midiToNoteName(startMidi + 23)}`;

  return (
    <section
      aria-label="Interactive Keyboard Row"
      className="rounded-xl border border-zinc-800/90 bg-[#111114] p-3 sm:p-3.5"
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Keyboard className="h-4 w-4 text-amber-400" />
          <h3 className="text-xs font-bold tracking-wide text-zinc-100 uppercase">
            Keyboard Row
          </h3>
          <span className="text-xs font-medium text-zinc-400">
            · {soundLabel}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onTogglePunchIn}
            aria-pressed={punchInRecord}
            className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${
              punchInRecord
                ? 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <CircleDot className="h-3 w-3 shrink-0" />
            <span>{punchInRecord ? 'Record Keys to Grid' : 'Audition Keys Only'}</span>
          </button>

          <div className="flex items-center rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
            <button
              type="button"
              onClick={() => onBaseOctaveChange(Math.max(2, clampedOctave - 1))}
              disabled={clampedOctave <= 2}
              aria-label="Shift keyboard octave down"
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800 disabled:opacity-35"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <span className="px-2 font-mono-tabular text-[11px] font-semibold text-zinc-200 whitespace-nowrap">
              {rangeLabel}
            </span>
            <button
              type="button"
              onClick={() => onBaseOctaveChange(Math.min(4, clampedOctave + 1))}
              disabled={clampedOctave >= 4}
              aria-label="Shift keyboard octave up"
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800 disabled:opacity-35"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 2-Octave Playable Keyboard */}
      <div className="relative h-20 w-full select-none overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 sm:h-24">
        {/* White Keys */}
        <div className="grid h-full w-full grid-cols-14 gap-px bg-zinc-800">
          {whiteKeys.map((wk) => {
            const isActive = activeSet.has(wk.midi);
            return (
              <button
                key={wk.midi}
                type="button"
                aria-label={`Play note ${wk.label}`}
                data-testid={`piano-key-${wk.label}`}
                onPointerDown={(e) => {
                  if (e.pointerType === 'mouse') {
                    e.preventDefault();
                    handlePressStart(wk.midi);
                  }
                }}
                onPointerUp={(e) => {
                  if (e.pointerType !== 'mouse') {
                    handlePressStart(wk.midi);
                    window.setTimeout(() => handlePressEnd(wk.midi), 140);
                  } else {
                    handlePressEnd(wk.midi);
                  }
                }}
                onPointerLeave={() => handlePressEnd(wk.midi)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handlePressStart(wk.midi);
                  }
                }}
                onKeyUp={() => handlePressEnd(wk.midi)}
                className={`relative flex h-full flex-col items-center justify-end pb-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 ${
                  isActive
                    ? 'bg-amber-300 text-zinc-950'
                    : 'bg-zinc-100 text-zinc-700 hover:bg-white'
                }`}
              >
                {wk.inScale && (
                  <span
                    aria-hidden="true"
                    className={`mb-1 h-1.5 w-1.5 rounded-full ${
                      wk.isRoot ? 'bg-amber-600' : 'bg-emerald-500/80'
                    }`}
                  />
                )}
                <span className="font-mono-tabular text-[9px] font-bold tracking-tighter sm:text-[10px]">
                  {wk.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Black Keys Overlay */}
        {blackKeys.map((bk) => {
          const isActive = activeSet.has(bk.midi);
          const isBlack = isBlackKeyMidi(bk.midi);
          return (
            <button
              key={bk.midi}
              type="button"
              aria-label={`Play note ${bk.label}`}
              data-testid={`piano-key-${bk.label}`}
              style={{ left: `${bk.leftPercent}%` }}
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse') {
                  e.preventDefault();
                  e.stopPropagation();
                  handlePressStart(bk.midi);
                }
              }}
              onPointerUp={(e) => {
                if (e.pointerType !== 'mouse') {
                  e.stopPropagation();
                  handlePressStart(bk.midi);
                  window.setTimeout(() => handlePressEnd(bk.midi), 140);
                } else {
                  handlePressEnd(bk.midi);
                }
              }}
              onPointerLeave={() => handlePressEnd(bk.midi)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handlePressStart(bk.midi);
                }
              }}
              onKeyUp={() => handlePressEnd(bk.midi)}
              className={`absolute top-0 z-10 flex h-[60%] w-[4.8%] min-w-[14px] -translate-x-1/2 flex-col items-center justify-end rounded-b-md border border-zinc-950 pb-1.5 shadow-md transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 ${
                isActive
                  ? 'bg-amber-500 text-zinc-950'
                  : isBlack
                  ? 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                  : 'bg-zinc-900 text-zinc-400'
              }`}
            >
              {bk.inScale && (
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    bk.isRoot ? 'bg-amber-400' : 'bg-emerald-400'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pr-14 text-[11px] text-zinc-500 sm:pr-16">
        <span>
          Key guide: <span className="text-amber-400">Amber dot</span> = {rootKey} root ·{' '}
          <span className="text-emerald-400">Emerald dot</span> = in {rootKey} {scaleType} scale
        </span>
        <span className="font-mono-tabular">
          {punchInRecord ? 'Tap keys while playing to write to Piano Roll' : 'Tap keys to audition sound'}
        </span>
      </div>
    </section>
  );
};
