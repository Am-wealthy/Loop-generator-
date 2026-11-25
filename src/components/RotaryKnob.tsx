import React, { useRef } from 'react';

interface RotaryKnobProps {
  label: string;
  valueLabel: string;
  subLabel?: string;
  ratio: number; // 0 .. 1
  onChangeRatio: (nextRatio: number) => void;
  accent?: 'amber' | 'emerald';
  ariaLabel: string;
  ariaValueText?: string;
}

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
  label,
  valueLabel,
  subLabel,
  ratio,
  onChangeRatio,
  accent = 'amber',
  ariaLabel,
  ariaValueText,
}) => {
  const clamped = Math.max(0, Math.min(1, ratio));
  const dragRef = useRef<{ y: number; x: number; startRatio: number } | null>(null);

  // Arc from -135 deg to +135 deg (270 deg sweep)
  const startAngle = -135;
  const endAngle = 135;
  const currentAngle = startAngle + clamped * (endAngle - startAngle);

  const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  };

  const describeArc = (
    cx: number,
    cy: number,
    r: number,
    fromDeg: number,
    toDeg: number
  ) => {
    const start = polarToCartesian(cx, cy, r, fromDeg);
    const end = polarToCartesian(cx, cy, r, toDeg);
    const largeArc = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(
      2
    )} ${end.y.toFixed(2)}`;
  };

  const pointerPos = polarToCartesian(44, 44, 20, currentAngle);
  const strokeColor = accent === 'emerald' ? '#10B981' : '#F59E0B';

  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950/90 p-3 text-center">
      <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
        {label}
      </span>

      <div
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuetext={ariaValueText ?? valueLabel}
        onPointerDown={(e) => {
          e.preventDefault();
          dragRef.current = { y: e.clientY, x: e.clientX, startRatio: clamped };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          const dy = dragRef.current.y - e.clientY;
          const dx = e.clientX - dragRef.current.x;
          const delta = (dy + dx * 0.5) / 140;
          onChangeRatio(Math.max(0, Math.min(1, dragRef.current.startRatio + delta)));
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault();
            onChangeRatio(Math.min(1, clamped + 0.05));
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault();
            onChangeRatio(Math.max(0, clamped - 0.05));
          }
        }}
        title="Drag up/down or use arrow keys to turn knob"
        className="relative cursor-ns-resize select-none touch-none rounded-full focus-visible:outline-2 focus-visible:outline-amber-400"
      >
        <svg viewBox="0 0 88 88" className="h-20 w-20">
          {/* Track Arc */}
          <path
            d={describeArc(44, 44, 34, startAngle, endAngle)}
            fill="none"
            stroke="#27272A"
            strokeWidth="5"
            strokeLinecap="round"
          />
          {/* Active Value Arc */}
          {clamped > 0.01 && (
            <path
              d={describeArc(44, 44, 34, startAngle, currentAngle)}
              fill="none"
              stroke={strokeColor}
              strokeWidth="5"
              strokeLinecap="round"
            />
          )}
          {/* Inner Brushed Dial Cap */}
          <circle
            cx="44"
            cy="44"
            r="25"
            fill="#141419"
            stroke="#3F3F46"
            strokeWidth="1.5"
          />
          <circle cx="44" cy="44" r="19" fill="#0D0D11" />
          {/* Dial Indicator Dot */}
          <line
            x1="44"
            y1="44"
            x2={pointerPos.x}
            y2={pointerPos.y}
            stroke={strokeColor}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx={pointerPos.x} cy={pointerPos.y} r="2.5" fill={strokeColor} />
        </svg>
      </div>

      <span className="font-mono-tabular rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-xs font-bold text-zinc-100">
        {valueLabel}
      </span>
      {subLabel && (
        <span className="text-[10px] text-zinc-400">{subLabel}</span>
      )}
    </div>
  );
};
