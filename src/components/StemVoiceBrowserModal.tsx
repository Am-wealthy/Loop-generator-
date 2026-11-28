import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Loader2,
  Music2,
  Play,
  Search,
  Sparkles,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import type { KeyboardSoundId, SampleCandidate, StemChannel } from '../types/sequencer';
import { KEYBOARD_SOUND_PRESETS } from '../utils/stemBuilderLogic';

type VoiceBrowserTab = 'keyboards' | 'primary_api' | 'secondary_api';

interface StemVoiceBrowserModalProps {
  isOpen: boolean;
  targetChannel: StemChannel | null;
  freesoundKey: string;
  secondarySoundConfigured: boolean;
  secondarySoundProvider: string;
  onSelectKeyboardVoice: (channelId: string, soundId: KeyboardSoundId) => void;
  onSelectCustomSampleVoice: (channelId: string, sample: SampleCandidate) => void;
  onAuditionKeyboardVoice: (soundId: KeyboardSoundId) => void;
  onOpenFreesoundKeyModal: () => void;
  onClose: () => void;
}

const VOICE_QUICK_QUERIES = [
  'synth lead',
  'piano note',
  'rhodes chord',
  'organ c4',
  'brass stab',
  'marimba',
  'choir pad',
  'bass pluck',
];

function cleanSampleTitle(raw: string): string {
  return raw.replace(/\.(wav|mp3|ogg|aiff|flac|m4a)$/i, '').trim() || raw;
}

export const StemVoiceBrowserModal: React.FC<StemVoiceBrowserModalProps> = ({
  isOpen,
  targetChannel,
  freesoundKey,
  secondarySoundConfigured,
  secondarySoundProvider,
  onSelectKeyboardVoice,
  onSelectCustomSampleVoice,
  onAuditionKeyboardVoice,
  onOpenFreesoundKeyModal,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<VoiceBrowserTab>('keyboards');
  const [query, setQuery] = useState('synth lead');
  const [results, setResults] = useState<SampleCandidate[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

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
    async (bank: 'primary' | 'secondary', searchText: string, pageNum = 1) => {
      const trimmed = searchText.trim();
      if (!trimmed) return;
      setLoading(true);
      setError(null);
      stopPreview();
      try {
        const headers: Record<string, string> = {};
        if (bank === 'primary' && freesoundKey.trim()) {
          headers['x-freesound-key'] = freesoundKey.trim();
        }
        const res = await fetch(
          `/api/sound-banks/search?bank=${bank}&q=${encodeURIComponent(
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
          throw new Error(data.error || `Sound search failed (${res.status})`);
        }
        setConfigured(data.configured !== false);
        setResults(Array.isArray(data.results) ? data.results : []);
        setTotalCount(typeof data.count === 'number' ? data.count : 0);
        setPage(pageNum);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Unable to search sound bank.'
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
    if (activeTab === 'primary_api') {
      void runSearch('primary', query, 1);
    } else if (activeTab === 'secondary_api') {
      void runSearch('secondary', query, 1);
    }
  }, [isOpen, activeTab, query, runSearch, stopPreview]);

  useEffect(() => {
    return () => stopPreview();
  }, [stopPreview]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stopPreview();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, stopPreview]);

  if (!isOpen || !targetChannel) return null;

  const handleTogglePreviewSample = (sample: SampleCandidate) => {
    if (previewingId === sample.id) {
      stopPreview();
      return;
    }
    stopPreview();
    const audio = new Audio(sample.url);
    audio.onended = () => setPreviewingId(null);
    audio.onerror = () => {
      setPreviewingId(null);
      setError('Could not preview this audio sample.');
    };
    audioRef.current = audio;
    setPreviewingId(sample.id);
    void audio.play().catch(() => setPreviewingId(null));
  };

  const totalPages = Math.max(1, Math.min(20, Math.ceil(totalCount / 12)));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stem-voice-browser-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          stopPreview();
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-2 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#101014] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/90 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Music2 className="h-4 w-4 shrink-0 text-amber-400" />
              <h2
                id="stem-voice-browser-title"
                className="font-display truncate text-sm font-bold text-zinc-100 sm:text-base"
              >
                Choose Voice for {targetChannel.name}
              </h2>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-zinc-400">
              Pick a studio keyboard or browse online API banks to transform your hummed melody
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopPreview();
              onClose();
            }}
            aria-label="Close voice browser"
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Source Bank Tabs */}
        <div className="border-b border-zinc-800 bg-[#0D0D11] px-4 py-2.5 sm:px-5">
          <div
            role="tablist"
            aria-label="Voice library sources"
            className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'keyboards'}
              onClick={() => setActiveTab('keyboards')}
              className={`truncate rounded-md px-1.5 py-1.5 text-[11px] font-semibold transition-colors sm:px-2.5 sm:text-xs ${
                activeTab === 'keyboards'
                  ? 'bg-amber-500 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="sm:hidden">Keyboards</span>
              <span className="hidden sm:inline">Studio Keyboards</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'primary_api'}
              onClick={() => setActiveTab('primary_api')}
              className={`truncate rounded-md px-1.5 py-1.5 text-[11px] font-semibold transition-colors sm:px-2.5 sm:text-xs ${
                activeTab === 'primary_api'
                  ? 'bg-emerald-500 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="sm:hidden">API Bank 1</span>
              <span className="hidden sm:inline">API Bank 1 (Freesound)</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'secondary_api'}
              onClick={() => setActiveTab('secondary_api')}
              className={`truncate rounded-md px-1.5 py-1.5 text-[11px] font-semibold transition-colors sm:px-2.5 sm:text-xs ${
                activeTab === 'secondary_api'
                  ? 'bg-sky-400 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="sm:hidden">API Bank 2</span>
              <span className="hidden sm:inline">
                API Bank 2 ({secondarySoundConfigured ? secondarySoundProvider : 'Sound API'})
              </span>
            </button>
          </div>
        </div>

        {/* Body */}
        {activeTab === 'keyboards' ? (
          <div className="flex-1 overflow-y-auto p-4 sm:px-5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {KEYBOARD_SOUND_PRESETS.map((preset) => {
                const isActive =
                  targetChannel.voiceMode === 'keyboard' &&
                  targetChannel.soundId === preset.id;
                return (
                  <div
                    key={preset.id}
                    className={`flex items-center justify-between gap-2 rounded-xl border p-3 transition-colors ${
                      isActive
                        ? 'border-amber-500/60 bg-amber-500/10'
                        : 'border-zinc-800 bg-zinc-950/80 hover:border-zinc-700'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                        <span className="truncate text-xs font-bold text-zinc-100">
                          {preset.label}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-zinc-400">{preset.role}</p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onAuditionKeyboardVoice(preset.id)}
                        aria-label={`Audition ${preset.label}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500"
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectKeyboardVoice(targetChannel.id, preset.id);
                          onClose();
                        }}
                        className={`flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold transition-colors ${
                          isActive
                            ? 'bg-amber-500 text-zinc-950'
                            : 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
                        }`}
                      >
                        {isActive && <Check className="h-3.5 w-3.5" />}
                        <span>{isActive ? 'Selected' : 'Use Voice'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            {/* Search controls for API Bank 1 or Bank 2 */}
            <div className="space-y-2.5 border-b border-zinc-800/80 bg-[#0D0D11] px-4 py-3 sm:px-5">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runSearch(
                    activeTab === 'primary_api' ? 'primary' : 'secondary',
                    query,
                    1
                  );
                }}
                className="flex gap-2"
              >
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search synth, piano, organ, strings, guitar..."
                    aria-label="Search online instrument sounds"
                    className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-9 pr-3 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-amber-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !query.trim()}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                  <span>Search</span>
                </button>
              </form>

              <div className="flex flex-wrap gap-1.5">
                {VOICE_QUICK_QUERIES.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setQuery(chip)}
                    className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${
                      query.toLowerCase() === chip.toLowerCase()
                        ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:px-5">
              {!configured && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
                  <p className="text-xs font-semibold text-amber-200">
                    {activeTab === 'primary_api'
                      ? 'Freesound API key (API Bank 1) is not active yet.'
                      : 'Secondary Sound API key (API Bank 2) is not configured in server secrets yet.'}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {activeTab === 'primary_api'
                      ? 'Connect your Freesound API key or switch to Studio Keyboards.'
                      : 'Add SECONDARY_SOUND_API_KEY, JAMENDO_CLIENT_ID, or PIXABAY_API_KEY in Secrets to enable Bank 2.'}
                  </p>
                  {activeTab === 'primary_api' && (
                    <button
                      type="button"
                      onClick={onOpenFreesoundKeyModal}
                      className="mt-3 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-400"
                    >
                      Configure Freesound Key
                    </button>
                  )}
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
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-zinc-400">
                  <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
                  <span className="text-xs font-medium">Searching sound bank...</span>
                </div>
              ) : configured && results.length === 0 ? (
                <div className="py-10 text-center text-xs text-zinc-400">
                  No matching instrument samples found. Try &ldquo;synth lead&rdquo; or &ldquo;piano&rdquo;.
                </div>
              ) : (
                <div className="space-y-2">
                  {results.map((item) => {
                    const isPreviewing = previewingId === item.id;
                    const title = cleanSampleTitle(item.name);
                    return (
                      <div
                        key={item.id}
                        className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-xs font-bold text-zinc-100">
                              {title}
                            </span>
                            {typeof item.duration === 'number' && (
                              <span className="font-mono-tabular shrink-0 text-[10px] text-amber-300">
                                {item.duration.toFixed(1)}s
                              </span>
                            )}
                          </div>
                          {item.username && (
                            <p className="mt-0.5 text-[10px] text-zinc-500">
                              by {item.username}
                            </p>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleTogglePreviewSample(item)}
                            className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold ${
                              isPreviewing
                                ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                                : 'border-zinc-700 bg-zinc-900 text-zinc-200'
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
                            onClick={() => {
                              stopPreview();
                              onSelectCustomSampleVoice(targetChannel.id, {
                                ...item,
                                name: title,
                              });
                              onClose();
                            }}
                            className="flex h-8 items-center gap-1 rounded-lg bg-emerald-500 px-3 text-xs font-bold text-zinc-950 hover:bg-emerald-400"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>Use Voice</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {configured && results.length > 0 && (
              <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950/90 px-4 py-2.5 text-[11px] text-zinc-400 sm:px-5">
                <span>
                  {totalCount.toLocaleString()} sounds · Page {page}/{totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={loading || page <= 1}
                    onClick={() =>
                      void runSearch(
                        activeTab === 'primary_api' ? 'primary' : 'secondary',
                        query,
                        page - 1
                      )
                    }
                    className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-semibold text-zinc-300 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={loading || page >= totalPages}
                    onClick={() =>
                      void runSearch(
                        activeTab === 'primary_api' ? 'primary' : 'secondary',
                        query,
                        page + 1
                      )
                    }
                    className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-semibold text-zinc-300 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
