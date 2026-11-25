import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Loader2,
  Music2,
  Play,
  Plus,
  Search,
  Square,
  X,
} from 'lucide-react';
import type { SampleCandidate, TapPad } from '../types/sequencer';

interface TapBrowseModalProps {
  isOpen: boolean;
  pads: TapPad[];
  initialTargetPadId: string | 'new';
  freesoundKey: string;
  onAssignToPad: (padId: string, sample: SampleCandidate) => void;
  onAddNewPadWithSample: (sample: SampleCandidate) => void;
  onOpenKeyModal: () => void;
  onClose: () => void;
}

const QUICK_QUERIES = [
  'shaker loop',
  'afro percussion',
  'conga',
  'talking drum',
  'cowbell',
  'tambourine',
  'agogo bell',
  '808 bass',
];

function cleanSampleTitle(raw: string): string {
  return raw.replace(/\.(wav|mp3|ogg|aiff|flac|m4a)$/i, '').trim() || raw;
}

function getDefaultQueryForPad(pads: TapPad[], targetId: string | 'new'): string {
  if (targetId === 'new') return 'afro percussion';
  const pad = pads.find((p) => p.id === targetId);
  if (!pad) return 'shaker';
  const cleaned = pad.name
    .replace(/one shot/gi, '')
    .replace(/box/gi, '')
    .trim();
  return cleaned || pad.category || 'percussion';
}

export const TapBrowseModal: React.FC<TapBrowseModalProps> = ({
  isOpen,
  pads,
  initialTargetPadId,
  freesoundKey,
  onAssignToPad,
  onAddNewPadWithSample,
  onOpenKeyModal,
  onClose,
}) => {
  const [targetPadId, setTargetPadId] = useState<string | 'new'>(initialTargetPadId);
  const [query, setQuery] = useState<string>(() =>
    getDefaultQueryForPad(pads, initialTargetPadId)
  );
  const [results, setResults] = useState<SampleCandidate[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    setPreviewingId(null);
  }, []);

  const runSearch = useCallback(
    async (searchText: string, pageNum = 1) => {
      const trimmed = searchText.trim();
      if (!trimmed) return;
      setLoading(true);
      setError(null);
      stopPreview();
      try {
        const headers: Record<string, string> = {};
        if (freesoundKey.trim()) {
          headers['x-freesound-key'] = freesoundKey.trim();
        }
        const res = await fetch(
          `/api/freesound/search?q=${encodeURIComponent(
            trimmed
          )}&mode=browse&page=${pageNum}`,
          { headers }
        );
        const data = (await res.json()) as {
          configured?: boolean;
          count?: number;
          page?: number;
          results?: SampleCandidate[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || `Search failed (${res.status})`);
        }
        setConfigured(data.configured !== false);
        setResults(Array.isArray(data.results) ? data.results : []);
        setTotalCount(typeof data.count === 'number' ? data.count : 0);
        setPage(pageNum);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Unable to search Freesound sounds.'
        );
      } finally {
        setLoading(false);
      }
    },
    [freesoundKey, stopPreview]
  );

  useEffect(() => {
    if (!isOpen) {
      stopPreview();
      return;
    }
    setTargetPadId(initialTargetPadId);
    const initialQ = getDefaultQueryForPad(pads, initialTargetPadId);
    setQuery(initialQ);
    setAddedId(null);
    void runSearch(initialQ, 1);
  }, [isOpen, initialTargetPadId, pads, runSearch, stopPreview]);

  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, [stopPreview]);

  if (!isOpen) return null;

  const handleTogglePreview = (sample: SampleCandidate) => {
    if (previewingId === sample.id) {
      stopPreview();
      return;
    }
    stopPreview();
    const audio = new Audio(sample.url);
    audio.onended = () => setPreviewingId(null);
    audio.onerror = () => {
      setPreviewingId(null);
      setError('Could not preview this audio file.');
    };
    audioRef.current = audio;
    setPreviewingId(sample.id);
    void audio.play().catch(() => {
      setPreviewingId(null);
    });
  };

  const handleAddSample = (sample: SampleCandidate) => {
    stopPreview();
    const cleanedSample: SampleCandidate = {
      ...sample,
      name: cleanSampleTitle(sample.name),
    };
    setAddedId(sample.id);
    if (targetPadId === 'new') {
      onAddNewPadWithSample(cleanedSample);
    } else {
      onAssignToPad(targetPadId, cleanedSample);
    }
    onClose();
  };

  const totalPages = Math.max(1, Math.min(20, Math.ceil(totalCount / 12)));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tap-browse-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-2 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#101014] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/90 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Music2 className="h-4 w-4 shrink-0 text-amber-400" />
              <h2
                id="tap-browse-title"
                className="font-display truncate text-sm font-bold text-zinc-100 sm:text-base"
              >
                Browse Sounds &amp; Loops
              </h2>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-zinc-400">
              Search, preview, and add directly to any Tap Pad without leaving the studio
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopPreview();
              onClose();
            }}
            aria-label="Close loop browser"
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Target Pad Selector + Search Form */}
        <div className="space-y-3 border-b border-zinc-800/80 bg-[#0D0D11] p-4 sm:px-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label
              htmlFor="browse-target-pad"
              className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
            >
              Add to Pad Box
            </label>
            <select
              id="browse-target-pad"
              value={targetPadId}
              onChange={(e) => setTargetPadId(e.target.value)}
              className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 text-xs font-medium text-zinc-100 outline-none focus:border-amber-500 sm:w-72"
            >
              {pads.map((pad, idx) => (
                <option key={pad.id} value={pad.id}>
                  Pad {String(idx + 1).padStart(2, '0')}: {pad.name}
                </option>
              ))}
              <option value="new">+ Create New Pad Box</option>
            </select>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch(query, 1);
            }}
            className="flex gap-2"
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search loop or sound (e.g. afro shaker, talking drum, 808)..."
                aria-label="Search Freesound loops and percussion"
                className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-9 pr-3 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-amber-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 text-xs font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              <span>Search</span>
            </button>
          </form>

          {/* Quick Search Chips */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_QUERIES.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => {
                  setQuery(chip);
                  void runSearch(chip, 1);
                }}
                className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${
                  query.toLowerCase() === chip.toLowerCase()
                    ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:px-5">
          {!configured && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
              <p className="text-xs font-semibold text-amber-200">
                Freesound API key is required to browse online sounds.
              </p>
              <button
                type="button"
                onClick={onOpenKeyModal}
                className="mt-2.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-400"
              >
                Enter Freesound Key
              </button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
            >
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-zinc-400">
              <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
              <span className="text-xs font-medium">
                Searching Freesound library...
              </span>
            </div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-400">
              No matching sounds found. Try another search term like &ldquo;shaker&rdquo;,
              &ldquo;conga&rdquo;, or &ldquo;percussion loop&rdquo;.
            </div>
          ) : (
            <div className="space-y-2">
              {results.map((item) => {
                const isPreviewing = previewingId === item.id;
                const isAdded = addedId === item.id;
                const title = cleanSampleTitle(item.name);

                return (
                  <div
                    key={item.id}
                    data-testid={`browse-result-${item.id}`}
                    className="flex flex-col gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 transition-colors hover:border-zinc-700 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-xs font-bold text-zinc-100 sm:text-sm">
                          {title}
                        </span>
                        {typeof item.duration === 'number' && (
                          <span className="font-mono-tabular shrink-0 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                            {item.duration < 1
                              ? `${Math.round(item.duration * 1000)} ms`
                              : `${item.duration.toFixed(1)}s`}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                        {item.username && <span>by {item.username}</span>}
                        {item.tags?.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleTogglePreview(item)}
                        aria-label={
                          isPreviewing ? `Stop preview ${title}` : `Preview ${title}`
                        }
                        className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                          isPreviewing
                            ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                            : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-600'
                        }`}
                      >
                        {isPreviewing ? (
                          <Square className="h-3 w-3 fill-current" />
                        ) : (
                          <Play className="h-3 w-3 fill-current" />
                        )}
                        <span>{isPreviewing ? 'Stop' : 'Preview'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAddSample(item)}
                        className="flex h-8 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-xs font-bold text-zinc-950 transition-colors hover:bg-emerald-400"
                      >
                        {isAdded ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {targetPadId === 'new' ? 'Add New Pad' : 'Add to Box'}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Pagination */}
        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950/90 px-4 py-2.5 text-[11px] text-zinc-400 sm:px-5">
          <span>
            {totalCount > 0
              ? `${totalCount.toLocaleString()} sounds · Page ${page}/${totalPages}`
              : 'Powered by Freesound API'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loading || page <= 1}
              onClick={() => void runSearch(query, page - 1)}
              className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 hover:border-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={loading || page >= totalPages || results.length === 0}
              onClick={() => void runSearch(query, page + 1)}
              className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 hover:border-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
