import { TAP_PAD_PRESETS } from '../data/presets.ts';
import type {
  LoopBars,
  ReverbRoomSize,
  TapLoopSettings,
  TapPad,
} from '../types/sequencer.ts';
import {
  clampBpm,
  getActiveStepCount,
  getStepDurationSeconds,
} from './sequencerLogic.ts';

export const MIN_CUTOFF_HZ = 180;
export const MAX_CUTOFF_HZ = 18000;

export const DEFAULT_TAP_LOOP_SETTINGS: TapLoopSettings = {
  cutoffHz: 18000,
  resonanceQ: 1.4,
  masterReverb: 0.45,
  reverbSize: 'hall',
};

export function createEmptySteps(): number[] {
  return new Array<number>(64).fill(0);
}

export function clampUnit(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.min(1, Math.max(0, Number(val.toFixed(3))));
}

export function clampCutoffHz(hz: number): number {
  if (!Number.isFinite(hz)) return MAX_CUTOFF_HZ;
  return Math.min(MAX_CUTOFF_HZ, Math.max(MIN_CUTOFF_HZ, Math.round(hz)));
}

export function clampResonanceQ(q: number): number {
  if (!Number.isFinite(q)) return 1.4;
  return Math.min(8, Math.max(0.5, Number(q.toFixed(1))));
}

/**
 * Logarithmic slider mapping [0..1] <-> [180..18000 Hz] so turning cutoff down
 * sweeps smoothly through warm/muffled ("moldy") low-mid frequencies.
 */
export function cutoffToSliderRatio(hz: number): number {
  const safe = clampCutoffHz(hz);
  const ratio =
    Math.log(safe / MIN_CUTOFF_HZ) / Math.log(MAX_CUTOFF_HZ / MIN_CUTOFF_HZ);
  return clampUnit(ratio);
}

export function sliderRatioToCutoff(ratio: number): number {
  const r = clampUnit(ratio);
  const hz = MIN_CUTOFF_HZ * Math.pow(MAX_CUTOFF_HZ / MIN_CUTOFF_HZ, r);
  return clampCutoffHz(hz);
}

export function getReverbDecaySeconds(size: ReverbRoomSize): number {
  if (size === 'room') return 0.95;
  if (size === 'cathedral') return 3.1;
  return 1.85;
}

export interface SnapTapResult {
  stepIndex: number;
  isAheadOfCurrent: boolean;
}

/**
 * Snaps a live finger tap timestamp cleanly to the active 16th-note tempo grid.
 * If tapped slightly ahead of nextStepTime, snaps forward to currentStep so
 * the scheduler can suppress double-triggering on that same beat.
 */
export function snapStepFromTiming(
  nowTime: number,
  nextStepTime: number,
  currentStep: number,
  stepDuration: number,
  stepCount: number
): SnapTapResult {
  const safeCount = Math.max(1, stepCount);
  const normalizedCurrent = ((currentStep % safeCount) + safeCount) % safeCount;
  const deltaToNext = nextStepTime - nowTime;

  if (deltaToNext <= stepDuration * 0.48 && deltaToNext >= -0.02) {
    return {
      stepIndex: normalizedCurrent,
      isAheadOfCurrent: true,
    };
  }

  const prevStep = (normalizedCurrent - 1 + safeCount) % safeCount;
  return {
    stepIndex: prevStep,
    isAheadOfCurrent: false,
  };
}

/**
 * Applies natural FL-Studio-style human dynamic phrasing across active steps:
 * beat downbeats hit stronger while off-beats vary naturally between low ghost
 * notes and crisp high accents without shifting anything out of tempo.
 */
export function humanizeSteps(steps: number[], rng: () => number = Math.random): number[] {
  return steps.map((vel, idx) => {
    if (vel <= 0) return 0;
    const stepInBeat = idx % 4;
    const targetCenter =
      stepInBeat === 0 ? 94 : stepInBeat === 2 ? 78 : 54;
    const jitter = Math.round((rng() * 2 - 1) * 18);
    const blended = Math.round(vel * 0.35 + (targetCenter + jitter) * 0.65);
    return Math.min(100, Math.max(22, blended));
  });
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

export function countActiveSteps(steps: number[], loopBars: LoopBars): number {
  const limit = getActiveStepCount(loopBars);
  let count = 0;
  for (let i = 0; i < limit; i++) {
    if ((steps[i] ?? 0) > 0) count++;
  }
  return count;
}

export function isTapPadAudible(pad: TapPad, anySoloed: boolean): boolean {
  if (pad.muted) return false;
  if (anySoloed && !pad.soloed) return false;
  return true;
}

export function toggleExclusivePadSolo(pads: TapPad[], padId: string): TapPad[] {
  const target = pads.find((p) => p.id === padId);
  if (!target) return pads;
  const soloCount = pads.filter((p) => Boolean(p.soloed)).length;
  const turnOff = Boolean(target.soloed) && soloCount === 1;
  return pads.map((p) => ({
    ...p,
    soloed: turnOff ? false : p.id === padId,
    muted: !turnOff && p.id === padId ? false : p.muted,
  }));
}

export function createDefaultTapPads(): TapPad[] {
  return TAP_PAD_PRESETS.slice(0, 6).map((preset, index) => ({
    id: `pad-default-${index + 1}`,
    name: preset.label,
    category: preset.category,
    accentColor: preset.accentColor,
    sample: preset.sample,
    steps: createEmptySteps(),
    muted: false,
    soloed: false,
    volume_db: -1.5,
    reverb: preset.category === 'Bass' || preset.category === 'Low End' ? 0.05 : 0.25,
  }));
}

export function createNextTapPad(existingCount: number): TapPad {
  const presetIndex =
    existingCount < TAP_PAD_PRESETS.length
      ? existingCount
      : existingCount % TAP_PAD_PRESETS.length;
  const preset = TAP_PAD_PRESETS[presetIndex];
  const isLowEnd = preset.category === 'Bass' || preset.category === 'Low End';
  return {
    id: `pad-${Date.now()}-${existingCount + 1}`,
    name: preset.label,
    category: preset.category,
    accentColor: preset.accentColor,
    sample: preset.sample,
    steps: createEmptySteps(),
    muted: false,
    soloed: false,
    volume_db: -1.5,
    reverb: isLowEnd ? 0.05 : 0.25,
  };
}
