import React, { useState } from 'react';
import { KeyRound, X } from 'lucide-react';

interface FreesoundModalProps {
  isOpen: boolean;
  currentKey: string;
  onSave: (key: string) => void;
  onClose: () => void;
}

export const FreesoundModal: React.FC<FreesoundModalProps> = ({
  isOpen,
  currentKey,
  onSave,
  onClose,
}) => {
  const [draft, setDraft] = useState(currentKey);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="freesound-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#121216] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-4 w-4 text-amber-400" />
            <h2
              id="freesound-modal-title"
              className="font-display text-base font-semibold text-zinc-100"
            >
              Freesound Acoustic Sample Key
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Freesound settings"
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2.5 text-xs leading-relaxed text-zinc-400">
          Optional: Enter a free Freesound.org API token to dynamically fetch and cycle through top
          5 live recorded acoustic one-shots for every percussion channel. Without a key, the studio
          uses its built-in open-source acoustic CDN sample banks.
        </p>

        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(draft.trim());
            onClose();
          }}
        >
          <div>
            <label
              htmlFor="freesound-key-input"
              className="block text-xs font-medium text-zinc-300"
            >
              FREESOUND_API_KEY
            </label>
            <input
              id="freesound-key-input"
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste your Freesound API key..."
              className="font-mono-tabular mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            {currentKey && (
              <button
                type="button"
                onClick={() => {
                  setDraft('');
                  onSave('');
                  onClose();
                }}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              >
                Clear Key
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400"
            >
              Save Key
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
