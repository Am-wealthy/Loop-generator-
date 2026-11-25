import type { PercussionTrack, TapPad } from '../types/sequencer.ts';

/**
 * Expands a 16-step bar rhythm (or partial array) smoothly across all 64 steps,
 * preserving full 64-step patterns when already provided.
 */
export function expandPatternTo64Steps(rawSteps: unknown): number[] {
  const arr = Array.isArray(rawSteps)
    ? rawSteps.map((v) => {
        const n = Number(v ?? 0);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return Math.min(100, Math.max(15, Math.round(n)));
      })
    : [];

  const out = new Array<number>(64).fill(0);
  if (arr.length === 0) return out;

  if (arr.length >= 32) {
    for (let i = 0; i < 64; i++) {
      out[i] = arr[i] ?? arr[i % 16] ?? 0;
    }
    return out;
  }

  const barLen = arr.length >= 16 ? 16 : arr.length;
  for (let i = 0; i < 64; i++) {
    out[i] = arr[i % barLen] ?? 0;
  }
  return out;
}

const KEYWORD_ALIASES: Array<[string, string[]]> = [
  ['shekere', ['shaker', 'shekere', 'cabasa', 'maraca']],
  ['wooden_agogo', ['agogo', 'wood', 'clave', 'block', 'rim']],
  ['conga_slap', ['slap', 'bongo', 'conga slap', 'high conga']],
  ['conga_low_open', ['conga', 'low conga', 'open conga']],
  ['cowbell', ['cowbell', 'bell']],
  ['tambourine', ['tambourine', 'tamb', 'jingle']],
  ['talking_drum', ['talking', 'gangan', 'omele', 'tama']],
  ['bass', ['bass', '808', 'sub', 'kick']],
];

function expandAliases(keyword: string): string[] {
  const lower = keyword.toLowerCase().trim();
  if (!lower) return [];
  const tokens = new Set<string>([lower, ...lower.split(/[\s_-]+/).filter(Boolean)]);
  for (const [canon, words] of KEYWORD_ALIASES) {
    if (lower.includes(canon) || words.some((w) => lower.includes(w))) {
      tokens.add(canon);
      for (const w of words) tokens.add(w);
    }
  }
  return Array.from(tokens);
}

export function findMatchingTrackIndex(
  tracks: PercussionTrack[],
  keyword: string
): number {
  const tokens = expandAliases(keyword);
  if (tokens.length === 0) return -1;

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.isClick) continue;
    const hay = `${t.instrument_id} ${t.display_name} ${t.sample_search_query}`.toLowerCase();
    if (tokens.some((tok) => hay.includes(tok))) {
      return i;
    }
  }
  return -1;
}

export function findMatchingTapPadIndex(
  pads: TapPad[],
  keyword: string
): number {
  const tokens = expandAliases(keyword);
  if (tokens.length === 0) return -1;

  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    const hay = `${p.id} ${p.name} ${p.category}`.toLowerCase();
    if (tokens.some((tok) => hay.includes(tok))) {
      return i;
    }
  }
  return -1;
}
