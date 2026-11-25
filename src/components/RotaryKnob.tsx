import React, { useRef } from 'react';
import { clampPan } from '../utils/sequencerLogic';

interface RotaryKnobProps {
  value: number; // -1 to 1
  onChange: (nextValue: number) => void;
  label: string;
}

export const RotaryKnob: React.FC<RotaryKnobProps> = ({ value, onChange, label }) => {
  const startY = useRef<number | null>(null);
  const startVal = useRef<number>(value);

  const angle = value * 135; // -135deg to +135deg

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    startY.current = e.clientY;
    startVal.current = value;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (startY.current === null) return;
    const delta = (startY.current - e.clientY) / 70;
    onChange(clampPan(startVal.current + delta));
  };

  const handlePointerUp = () => {
    startY.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(clampPan(value - 0.1));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(clampPan(value + 0.1));
    }
  };

  const panText =
    Math.abs(value) < 0.05
      ? 'C'
      : value < 0
      ? `L${Math.round(Math.abs(value) * 100)}`
      : `R${Math.round(value * 100)}`;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        role="slider"
        aria-label={label}
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={value}
        aria-valuetext={panText}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => onChange(0)}
        onKeyDown={handleKeyDown}
        title="Drag vertically to pan, double-click to center"
        className="relative flex h-8 w-8 cursor-ns-resize items-center justify-center rounded-full border border-zinc-700 bg-gradient-to-b from-zinc-800 to-zinc-950 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_2px_4px_rgba(0,0,0,0.6)] focus-visible:outline-2 focus-visible:outline-amber-500"
      >
        <span
          className="block h-full w-full"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <span className="mx-auto mt-1 block h-2.5 w-0.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.8)]" />
        </span>
      </button>
      <span className="font-mono-tabular text-[10px] text-zinc-400">{panText}</span>
    </div>
  );
};
