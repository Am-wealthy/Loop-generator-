import { TAP_PAD_PRESETS } from '../data/presets.ts';
import type { LoopBars, TapLoopEvent, TapPad } from '../types/sequencer.ts';
import { clampBpm, getActiveStepCount, getStepDurationSeconds } from './sequencerLogic.ts';

export function normalizePhase(rawPhase: number): number {
  if (!Number.isFinite(rawPhase)) return 0;
  const wrapped = ((rawPhase % 1) + 1) % 1;
  return wrapped >= 1 ? 0 : wrapped;
}

export function quantizePhaseTo16th(phase: number, loopBars: LoopBars): number {
  const safePhase = normalizePhase(phase);
  const totalSteps = getActiveStepCount(loopBars);
  const nearestStep = Math.round(safePhase * totalSteps) % totalSteps;
  return nearestStep / totalSteps;
}

export function computeTapPhase(
  elapsedSeconds: number,
  loopDurationSeconds: number,
  quantize: boolean,
  loopBars: LoopBars
): number {
  if (!Number.isFinite(loopDurationSeconds) || loopDurationSeconds <= 0) return 0;
  const rawPhase = normalizePhase(elapsedSeconds / loopDurationSeconds);
  return quantize ? quantizePhaseTo16th(rawPhase, loopBars) : rawPhase;
}

export interface ScheduledTapMatch {
  event: TapLoopEvent;
  offsetRatio: number; // Relative to windowStart [0, windowSpan)
}

export function getPhaseEventsInWindow(
  events: TapLoopEvent[],
  windowStartPhase: number,
  windowSpanPhase: number
): ScheduledTapMatch[] {
  if (events.length === 0 || windowSpanPhase <= 0) return [];

  const start = normalizePhase(windowStartPhase);
  const span = Math.min(1, Math.max(0, windowSpanPhase));
  const end = start + span;
  const matches: ScheduledTapMatch[] = [];

  for (const event of events) {
    const p = normalizePhase(event.phase);
    if (end < 1) {
      if (p >= start && p < end) {
        matches.push({ event, offsetRatio: p - start });
      }
    } else {
      const wrappedEnd = end - 1;
      if (p >= start) {
        matches.push({ event, offsetRatio: p - start });
      } else if (p < wrappedEnd) {
        matches.push({ event, offsetRatio: 1 - start + p });
      }
    }
  }

  matches.sort((a, b) => a.offsetRatio - b.offsetRatio);
  return matches;
}

export function estimateBpmFromTapIntervals(tapTimestampsMs: number[]): number | null {
  if (tapTimestampsMs.length < 2) return null;
  const recent: number[] = [];
  for (let i = tapTimestampsMs.length - 1; i >= 0; i--) {
    const current = tapTimestampsMs[i];
    if (recent.length > 0 && recent[0] - current > 2000) {
      break;
    }
    recent.unshift(current);
    if (recent.length >= 6) break;
  }
  if (recent.length < 2) return null;

  const intervals: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff >= 180 && diff <= 2000) {
      intervals.push(diff);
    }
  }
  if (intervals.length === 0) return null;

  const avgMs = intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
  return clampBpm(60000 / avgMs);
}

export function getLoopDurationSeconds(bpm: number, loopBars: LoopBars): number {
  return getActiveStepCount(loopBars) * getStepDurationSeconds(bpm);
}

export function phaseToBarBeatStep(phase: number, loopBars: LoopBars): string {
  const totalSteps = getActiveStepCount(loopBars);
  const stepIndex = Math.floor(normalizePhase(phase) * totalSteps) % totalSteps;
  const bar = Math.floor(stepIndex / 16) + 1;
  const stepInBar = stepIndex % 16;
  const beat = Math.floor(stepInBar / 4) + 1;
  const sub = (stepInBar % 4) + 1;
  return `${String(bar).padStart(2, '0')}.${beat}.${sub}`;
}

export function createDefaultTapPads(): TapPad[] {
  return TAP_PAD_PRESETS.slice(0, 6).map((preset, index) => ({
    id: `pad-default-${index + 1}`,
    name: preset.label,
    category: preset.category,
    accentColor: preset.accentColor,
    sample: preset.sample,
    events: [],
    muted: false,
    volume_db: -1.5,
  }));
}

export function createNextTapPad(existingCount: number): TapPad {
  const presetIndex =
    existingCount < TAP_PAD_PRESETS.length
      ? existingCount
      : existingCount % TAP_PAD_PRESETS.length;
  const preset = TAP_PAD_PRESETS[presetIndex];
  return {
    id: `pad-${Date.now()}-${existingCount + 1}`,
    name: preset.label,
    category: preset.category,
    accentColor: preset.accentColor,
    sample: preset.sample,
    events: [],
    muted: false,
    volume_db: -1.5,
  };
}
