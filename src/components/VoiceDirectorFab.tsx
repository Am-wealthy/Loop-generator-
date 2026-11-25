import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Send, Sparkles, Square, X } from 'lucide-react';
import type {
  LoopBars,
  PercussionTrack,
  StudioPage,
  TapPad,
  VoiceCommandResponse,
} from '../types/sequencer';

interface VoiceDirectorFabProps {
  bpm: number;
  loopBars: LoopBars;
  activePage: StudioPage;
  metronomeEnabled: boolean;
  tracks: PercussionTrack[];
  tapPads: TapPad[];
  onApplyVoiceResponse: (res: VoiceCommandResponse) => void;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read recorded voice audio.'));
    reader.readAsDataURL(blob);
  });
}

export const VoiceDirectorFab: React.FC<VoiceDirectorFabProps> = ({
  bpm,
  loopBars,
  activePage,
  metronomeEnabled,
  tracks,
  tapPads,
  onApplyVoiceResponse,
}) => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [commandInput, setCommandInput] = useState('');
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  const stopStream = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopStream();
  }, []);

  const buildContextPayload = () => ({
    bpm,
    loopBars,
    activePage,
    metronomeEnabled,
    tracks: tracks.filter((t) => !t.isClick).map((t) => t.display_name),
    tapPads: tapPads.map((p) => p.name),
  });

  const submitVoiceCommand = async (payload: {
    audioBase64?: string;
    mimeType?: string;
    commandText?: string;
  }) => {
    setIsProcessing(true);
    setError(null);
    try {
      const res = await fetch('/api/voice-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          context: buildContextPayload(),
        }),
      });
      const data = (await res.json()) as VoiceCommandResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Voice command error (${res.status})`);
      }
      setLastReply(data.spoken_summary);
      onApplyVoiceResponse(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to process voice command.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const startRecording = async () => {
    setError(null);
    setPanelOpen(true);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Microphone recording is unavailable in this browser. Type your command below.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        stopStream();
        setIsRecording(false);
        setRecordSeconds(0);
        if (blob.size < 200) return;
        try {
          const audioBase64 = await blobToBase64(blob);
          await submitVoiceCommand({
            audioBase64,
            mimeType: blob.type || 'audio/webm',
            commandText: commandInput.trim() || undefined,
          });
        } catch (err) {
          setError(
            err instanceof Error ? err.message : 'Failed to encode voice audio.'
          );
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      stopStream();
      setError('Microphone permission denied or unavailable. Type your command below.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      stopStream();
      setIsRecording(false);
    }
  };

  return (
    <div className="fixed bottom-[114px] right-3 z-40 flex flex-col items-end gap-2 sm:bottom-[120px] sm:right-6">
      {panelOpen && (
        <div
          role="dialog"
          aria-label="Voice Studio Director"
          className="w-[calc(100vw-24px)] max-w-sm overflow-hidden rounded-2xl border border-zinc-800 bg-[#101015]/95 shadow-2xl backdrop-blur-xl"
        >
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/90 px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span className="font-display text-xs font-bold text-zinc-100">
                Voice Over Studio Control
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (isRecording) stopRecording();
                setPanelOpen(false);
              }}
              aria-label="Close voice panel"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-3 p-3.5">
            <p className="text-[11px] leading-relaxed text-zinc-400">
              Speak commands or vocalize a rhythm—e.g. &ldquo;Use shakers and create this
              rhythm: ta ta ta... ta ta&rdquo;, &ldquo;Turn metronome off&rdquo;, or
              &ldquo;BPM 118 and play&rdquo;.
            </p>

            {/* Primary Mic Capture Control */}
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => {
                if (isRecording) {
                  stopRecording();
                } else {
                  void startRecording();
                }
              }}
              className={`flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-all ${
                isRecording
                  ? 'border-rose-400 bg-rose-500/20 text-rose-200 shadow-[0_0_20px_rgba(244,63,94,0.25)]'
                  : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Interpreting Voice &amp; Rhythm...</span>
                </>
              ) : isRecording ? (
                <>
                  <Square className="h-3.5 w-3.5 fill-current animate-pulse" />
                  <span>Stop &amp; Apply ({recordSeconds}s)</span>
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" />
                  <span>Tap to Speak / Beatbox Rhythm</span>
                </>
              )}
            </button>

            {/* Text Command Fallback */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!commandInput.trim() || isProcessing) return;
                const txt = commandInput.trim();
                setCommandInput('');
                void submitVoiceCommand({ commandText: txt });
              }}
              className="flex gap-1.5"
            >
              <input
                type="text"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                placeholder='Or type: "use shakers ta ta ta, ta ta"'
                aria-label="Voice or text studio command"
                className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                disabled={isProcessing || !commandInput.trim()}
                aria-label="Send voice command"
                className="flex h-8 shrink-0 items-center justify-center rounded-lg bg-amber-500 px-2.5 text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </form>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-300"
              >
                {error}
              </div>
            )}

            {lastReply && (
              <div
                data-testid="voice-director-reply"
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[11px] font-medium text-emerald-200"
              >
                {lastReply}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Circular Voice Over Button */}
      <button
        type="button"
        onClick={() => {
          if (isRecording) {
            stopRecording();
          } else {
            setPanelOpen((o) => !o);
          }
        }}
        aria-label={
          isRecording
            ? 'Stop voice recording'
            : panelOpen
            ? 'Hide Voice Control'
            : 'Open Voice Over Control'
        }
        aria-expanded={panelOpen}
        className={`flex h-12 w-12 items-center justify-center rounded-full border shadow-2xl transition-all active:scale-95 sm:h-14 sm:w-14 ${
          isRecording
            ? 'border-rose-400 bg-rose-500 text-white shadow-[0_0_24px_rgba(244,63,94,0.55)] animate-pulse'
            : panelOpen
            ? 'border-amber-400 bg-amber-500 text-zinc-950 shadow-[0_0_24px_rgba(245,158,11,0.45)]'
            : 'border-amber-500/60 bg-[#141419]/95 text-amber-400 shadow-[0_8px_28px_rgba(0,0,0,0.65)] hover:border-amber-400 hover:bg-amber-500 hover:text-zinc-950'
        }`}
      >
        {isProcessing ? (
          <Loader2 className="h-5 w-5 animate-spin sm:h-6 sm:w-6" />
        ) : isRecording ? (
          <Square className="h-4 w-4 fill-current sm:h-5 sm:w-5" />
        ) : (
          <Mic className="h-5 w-5 sm:h-6 sm:w-6" />
        )}
      </button>
    </div>
  );
};
