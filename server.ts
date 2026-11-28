import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
import { normalizeArrangement } from './src/utils/sequencerLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYSTEM_INSTRUCTION = `You are an elite Nigerian Afro-gospel music producer and percussion arranger. Analyze the uploaded audio and generate a 100% accurate, seamless 4-bar (64-step) percussion loop blueprint.
1. Detect exact BPM, time signature (e.g., 4/4 Highlife, 12/8 Afro-praise, Makossa, Alujo), and groove feel.
2. CASE A (Song has percussion/drums): Transcribe the exact rhythmic placement of every auxiliary percussion element across a 16-step per bar grid (64 steps total). Ignore the heavy acoustic kick drum so the loop sits cleanly with a live church drummer.
3. CASE B (Song has NO percussion — bare vocals or keyboard only): Compose an authentic, infectious Nigerian praise percussion arrangement that locks tightly into the vocal/keyboard rhythm.
4. For every percussion instrument detected or needed, provide a clean search keyword (e.g., 'shekere one shot', 'conga slap', 'conga low open', 'wooden agogo', 'cowbell', 'tambourine hit', 'talking drum') so the app can fetch real acoustic recordings. Always include a synced 'click_hi' (Beat 1) and 'click_lo' (Beats 2, 3, 4) track.

Return ONLY valid JSON:
{
  "detected_bpm": number,
  "groove_style": "string",
  "time_signature": "string",
  "has_existing_percussion": boolean,
  "tracks": [
    {
      "instrument_id": "string",
      "display_name": "string",
      "sample_search_query": "string",
      "volume_db": number,
      "pan": number,
      "steps": [0, 0, 100, 0, ...] // 64 integers (0 = off, 1-100 = velocity)
    }
  ]
}`;

const ALLOWED_AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/ogg',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/x-aac',
  'audio/webm',
  'audio/flac',
  'audio/x-flac',
  'audio/aiff',
  'audio/x-aiff',
  'audio/amr',
  'audio/3gpp',
]);

const ALLOWED_PROXY_HOSTS = new Set([
  'freesound.org',
  'www.freesound.org',
  'cdn.freesound.org',
  'cdn.jsdelivr.net',
  'raw.githubusercontent.com',
  'api.jamendo.com',
  'mp3d.jamendo.com',
  'mp3l.jamendo.com',
  'prod-1.storage.jamendo.com',
  'pixabay.com',
  'cdn.pixabay.com',
]);

function isAllowedSampleUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (
      ALLOWED_PROXY_HOSTS.has(host) ||
      host.endsWith('.freesound.org') ||
      host.endsWith('.jamendo.com') ||
      host.endsWith('.pixabay.com')
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseGeminiError(err: unknown): {
  status: number;
  message: string;
  isTransient: boolean;
  isDailyQuota: boolean;
} {
  const rawMsg = err instanceof Error ? err.message : String(err ?? 'Gemini request failed.');
  let message = rawMsg;
  let status = 500;
  try {
    const parsedErr = JSON.parse(rawMsg) as {
      error?: { code?: number; message?: string; status?: string };
    };
    if (parsedErr?.error?.message) {
      message = parsedErr.error.message;
    }
    if (typeof parsedErr?.error?.code === 'number') {
      status = parsedErr.error.code;
    }
  } catch {
    if (rawMsg.includes('503') || rawMsg.includes('UNAVAILABLE')) status = 503;
    else if (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED')) status = 429;
  }
  const isDailyQuota =
    rawMsg.includes('GenerateRequestsPerDay') || rawMsg.includes('per day limit exceeded');
  const isTransient =
    status === 503 ||
    status === 429 ||
    rawMsg.includes('UNAVAILABLE') ||
    rawMsg.includes('RESOURCE_EXHAUSTED') ||
    rawMsg.includes('high demand');
  return { status, message, isTransient, isDailyQuota };
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '35mb' }));

  app.get('/api/health', (_req, res) => {
    const secondaryKey = (
      process.env.SECONDARY_SOUND_API_KEY ||
      process.env.JAMENDO_CLIENT_ID ||
      process.env.PIXABAY_API_KEY ||
      ''
    ).trim();
    const secondaryProvider = process.env.JAMENDO_CLIENT_ID?.trim()
      ? 'jamendo'
      : process.env.PIXABAY_API_KEY?.trim()
      ? 'pixabay'
      : (process.env.SECONDARY_SOUND_API_PROVIDER || 'freesound').trim().toLowerCase();
    res.json({
      ok: true,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      serverFreesoundConfigured: Boolean(process.env.FREESOUND_API_KEY?.trim()),
      secondarySoundConfigured: Boolean(secondaryKey),
      secondarySoundProvider: secondaryProvider,
    });
  });

  async function runGeminiAudioAnalysis(params: {
    audioBase64: string;
    mimeType: string;
    fileName: string;
    analysisMode: string;
    targetGroove?: string;
  }) {
    const ai = getGeminiClient();
    if (!ai) {
      return {
        status: 503,
        body: {
          error:
            'Gemini API key is not configured on the server. Please add GEMINI_API_KEY in Settings > Secrets.',
        },
      };
    }

    const { audioBase64, mimeType, fileName, analysisMode, targetGroove } = params;
    if (!audioBase64 || audioBase64.length < 100) {
      return { status: 400, body: { error: 'A valid audio file payload is required.' } };
    }

    if (audioBase64.length > 28_000_000) {
      return {
        status: 413,
        body: {
          error:
            'Audio file exceeds the 20 MB analysis limit. Trim or compress the clip and try again.',
        },
      };
    }

    const baseMime = mimeType.split(';')[0].trim().toLowerCase();
    const mappedMime =
      baseMime === 'video/mp4' || baseMime === 'audio/x-m4a' || baseMime === 'audio/m4a'
        ? 'audio/mp4'
        : baseMime === 'audio/x-aac'
        ? 'audio/aac'
        : baseMime === 'audio/x-flac'
        ? 'audio/flac'
        : baseMime;
    const normalizedMime = ALLOWED_AUDIO_MIMES.has(mappedMime)
      ? mappedMime
      : 'audio/mpeg';

    const safeFileName = fileName.slice(0, 120) || 'uploaded-audio';
    const modeInstruction =
      analysisMode === 'extract'
        ? 'USER SELECTED MODE: CASE A (EXTRACT EXACT LOOP). This track already contains percussion/drums. Transcribe the exact rhythmic placement of every auxiliary percussion element used in the music across the 64-step grid (ignoring heavy kick drum), and set has_existing_percussion to true.'
        : `USER SELECTED MODE: CASE B (COMPOSE PERCUSSION FOR DRUMLESS MUSIC). This recording needs a percussion loop generated for it. Compose an authentic, infectious Nigerian Afro-gospel percussion arrangement locked tightly into the vocal/keyboard rhythm${
            typeof targetGroove === 'string' && targetGroove.trim() && targetGroove !== 'auto'
              ? ` with a ${targetGroove.trim()} feel`
              : ''
          }, and set has_existing_percussion to false.`;

    let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
    let lastErr: unknown = null;
    const attemptPlan = [
      { model: 'gemini-4-hydrogen', delayMs: 0 },
      { model: 'gemini-4-hydrogen', delayMs: 1200 },
      { model: 'gemini-3.1-flash-lite', delayMs: 0 },
    ];

    for (const step of attemptPlan) {
      if (step.delayMs > 0) {
        await new Promise((r) => setTimeout(r, step.delayMs));
      }
      try {
        response = await ai.models.generateContent({
          model: step.model,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: normalizedMime,
                  data: audioBase64,
                },
              },
              {
                text: `Analyze this uploaded audio ("${safeFileName}"). ${modeInstruction} Always include synced click_hi and click_lo tracks across the 64-step grid.`,
              },
            ],
          },
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                detected_bpm: { type: Type.NUMBER },
                groove_style: { type: Type.STRING },
                time_signature: { type: Type.STRING },
                has_existing_percussion: { type: Type.BOOLEAN },
                tracks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      instrument_id: { type: Type.STRING },
                      display_name: { type: Type.STRING },
                      sample_search_query: { type: Type.STRING },
                      volume_db: { type: Type.NUMBER },
                      pan: { type: Type.NUMBER },
                      steps: {
                        type: Type.ARRAY,
                        items: { type: Type.INTEGER },
                      },
                    },
                    required: [
                      'instrument_id',
                      'display_name',
                      'sample_search_query',
                      'volume_db',
                      'pan',
                      'steps',
                    ],
                  },
                },
              },
              required: [
                'detected_bpm',
                'groove_style',
                'time_signature',
                'has_existing_percussion',
                'tracks',
              ],
            },
          },
        });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const parsedErr = parseGeminiError(err);
        if (!parsedErr.isTransient) {
          break;
        }
        // Skip extra sleep on daily quota and jump straight to next model
        if (parsedErr.isDailyQuota && step.model === 'gemini-4-hydrogen') {
          continue;
        }
      }
    }

    if (lastErr || !response) {
      const parsedErr = parseGeminiError(lastErr);
      return { status: parsedErr.status, body: { error: parsedErr.message } };
    }

    const rawText = (response.text ?? '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    if (!rawText) {
      return { status: 502, body: { error: 'Gemini returned an empty analysis response.' } };
    }

    const parsed = JSON.parse(rawText);
    return { status: 200, body: normalizeArrangement(parsed) };
  }

  app.post(
    '/api/analyze-audio-raw',
    express.raw({ type: '*/*', limit: '22mb' }),
    async (req, res) => {
      try {
        const rawBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (rawBuf.byteLength < 64) {
          res.status(400).json({ error: 'A valid audio file payload is required.' });
          return;
        }
        const mimeType = String(req.header('x-audio-mime') || 'audio/mpeg');
        const rawName = String(req.header('x-file-name') || 'uploaded-audio');
        const fileName = decodeURIComponent(rawName);
        const analysisMode = String(req.header('x-analysis-mode') || 'compose');
        const targetGroove = req.header('x-target-groove') || undefined;

        const result = await runGeminiAudioAnalysis({
          audioBase64: rawBuf.toString('base64'),
          mimeType,
          fileName,
          analysisMode,
          targetGroove,
        });
        res.status(result.status).json(result.body);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to analyze audio with Gemini.';
        console.error('Gemini raw analysis error:', message);
        res.status(500).json({ error: message });
      }
    }
  );

  app.post('/api/analyze-audio', async (req, res) => {
    try {
      const { audioBase64, mimeType, fileName, analysisMode, targetGroove } = req.body ?? {};
      const result = await runGeminiAudioAnalysis({
        audioBase64: typeof audioBase64 === 'string' ? audioBase64 : '',
        mimeType: typeof mimeType === 'string' ? mimeType : '',
        fileName: typeof fileName === 'string' ? fileName : 'uploaded-audio',
        analysisMode: typeof analysisMode === 'string' ? analysisMode : 'compose',
        targetGroove: typeof targetGroove === 'string' ? targetGroove : undefined,
      });
      res.status(result.status).json(result.body);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to analyze audio with Gemini.';
      console.error('Gemini analysis error:', message);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/voice-command', async (req, res) => {
    try {
      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error:
            'Gemini API key is not configured on the server. Please add GEMINI_API_KEY in Settings > Secrets.',
        });
        return;
      }

      const { audioBase64, mimeType, commandText, context } = req.body ?? {};
      const hasAudio = typeof audioBase64 === 'string' && audioBase64.length > 100;
      const hasText = typeof commandText === 'string' && commandText.trim().length > 0;

      if (!hasAudio && !hasText) {
        res.status(400).json({ error: 'Please record a voice command or type a prompt.' });
        return;
      }

      const ctxJson = JSON.stringify(context ?? {});
      const voiceSystem = `You are the live AI Voice Studio Director inside PRAISELOOP AI (an Afro-gospel percussion sequencer & tap looper).
Listen closely to the user's voice recording and/or text command and translate it into concrete studio actions.
CRITICAL RHYTHM RULE:
When the user speaks, claps, or vocalizes a rhythm (e.g., "use shakers and create this rhythm: ta ta ta... ta ta" or "boom chik chik"), analyze the exact syllable spacing and cadence in their voice/words and output a 16-step (1 bar) or 64-step (4 bars) velocity array (integers 0-100, where 0 = rest, 55-100 = hit) on the 16th-note grid (steps 0..15 represent: 1, e, &, a, 2, e, &, a, 3, e, &, a, 4, e, &, a).
For example, "ta ta ta ... ta ta" maps clearly onto crisp rhythmic accents like [96, 0, 88, 0, 94, 0, 0, 0, 96, 0, 88, 0, 0, 0, 0, 0].
You can control EVERYTHING in the studio using one or more actions:
- set_groove_pattern: set or layer a rhythm on an instrument (shekere/shaker, wooden_agogo, conga_slap, conga_low_open, cowbell, tambourine, talking_drum, bass).
- set_bpm: change tempo (40-220).
- transport: state 'play' or 'stop'.
- set_metronome: enabled true/false (switch metronome click on or off).
- set_loop_bars: bars 1, 2, or 4.
- navigate_page: 'compose' | 'extract' | 'taploop' | 'sequencer'.
- mute_solo_track: mute or solo an instrument by keyword.
- set_fx: adjust cutoffHz (180..18000) and/or masterReverb (0..1).
- open_export: open the Export studio dialog (optionally with durationMinutes).

Current Studio Context: ${ctxJson}
Return ONLY valid JSON with spoken_summary and actions.`;

      const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [];
      if (hasAudio) {
        const cleanMime = String(mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm';
        parts.push({
          inlineData: {
            mimeType: cleanMime,
            data: audioBase64,
          },
        });
      }
      parts.push({
        text: hasText
          ? `User voice/text command: "${String(commandText).trim()}". Interpret both words and any vocalized rhythm and return studio actions.`
          : 'Listen to the user audio command and any beatboxed/vocalized rhythm, then return exact PRAISELOOP AI studio actions.',
      });

      let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
      let lastErr: unknown = null;
      const attemptPlan = [
        { model: 'gemini-4-hydrogen', delayMs: 0 },
        { model: 'gemini-3.1-flash-lite', delayMs: 0 },
      ];

      for (const step of attemptPlan) {
        if (step.delayMs > 0) await new Promise((r) => setTimeout(r, step.delayMs));
        try {
          response = await ai.models.generateContent({
            model: step.model,
            contents: { parts },
            config: {
              systemInstruction: voiceSystem,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  spoken_summary: { type: Type.STRING },
                  actions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        type: { type: Type.STRING },
                        instrument_keyword: { type: Type.STRING },
                        display_name: { type: Type.STRING },
                        steps: {
                          type: Type.ARRAY,
                          items: { type: Type.INTEGER },
                        },
                        mode: { type: Type.STRING },
                        bpm: { type: Type.NUMBER },
                        state: { type: Type.STRING },
                        enabled: { type: Type.BOOLEAN },
                        bars: { type: Type.INTEGER },
                        page: { type: Type.STRING },
                        muted: { type: Type.BOOLEAN },
                        soloed: { type: Type.BOOLEAN },
                        cutoffHz: { type: Type.NUMBER },
                        masterReverb: { type: Type.NUMBER },
                        durationMinutes: { type: Type.NUMBER },
                      },
                      required: ['type'],
                    },
                  },
                },
                required: ['spoken_summary', 'actions'],
              },
            },
          });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          const parsedErr = parseGeminiError(err);
          if (!parsedErr.isTransient) break;
        }
      }

      if (lastErr || !response) {
        const parsedErr = parseGeminiError(lastErr);
        res.status(parsedErr.status).json({ error: parsedErr.message });
        return;
      }

      const raw = (response.text ?? '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();
      const parsed = JSON.parse(raw || '{}') as {
        spoken_summary?: string;
        actions?: unknown[];
      };
      res.json({
        spoken_summary:
          typeof parsed.spoken_summary === 'string' && parsed.spoken_summary.trim()
            ? parsed.spoken_summary.trim()
            : 'Applied voice command to studio.',
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to process voice command.';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/freesound/search', async (req, res) => {
    try {
      const query = String(req.query.q ?? '').trim();
      if (!query) {
        res.status(400).json({ error: 'Query parameter "q" is required.' });
        return;
      }

      const mode = String(req.query.mode ?? 'oneshot').toLowerCase();
      const isBrowse = mode === 'browse';
      const page = Math.max(1, Math.min(20, Number(req.query.page ?? 1) || 1));
      const pageSize = isBrowse ? 12 : 5;
      const maxDur = isBrowse ? 30 : 1.5;

      const freesoundKey = (
        req.header('x-freesound-key') ||
        process.env.FREESOUND_API_KEY ||
        ''
      ).trim();

      if (!freesoundKey) {
        res.status(200).json({
          configured: false,
          results: [],
          count: 0,
          page,
        });
        return;
      }

      const apiUrl = new URL('https://freesound.org/apiv2/search/text/');
      apiUrl.searchParams.set('query', query);
      apiUrl.searchParams.set('filter', `duration:[0 TO ${maxDur}]`);
      apiUrl.searchParams.set(
        'fields',
        isBrowse ? 'id,name,duration,username,tags,previews' : 'id,name,previews'
      );
      apiUrl.searchParams.set('page_size', String(pageSize));
      apiUrl.searchParams.set('page', String(page));

      const upstream = await fetch(apiUrl.toString(), {
        headers: {
          Authorization: `Token ${freesoundKey}`,
        },
      });

      if (!upstream.ok) {
        const text = await upstream.text();
        res.status(upstream.status).json({
          error: `Freesound API error (${upstream.status}): ${text.slice(0, 180)}`,
        });
        return;
      }

      const data = (await upstream.json()) as {
        count?: number;
        results?: Array<{
          id: number;
          name: string;
          duration?: number;
          username?: string;
          tags?: string[];
          previews?: Record<string, string>;
        }>;
      };

      const results = (data.results ?? [])
        .map((item) => {
          const previewUrl =
            item.previews?.['preview-hq-mp3'] ||
            item.previews?.['preview-lq-mp3'] ||
            item.previews?.['preview-hq-ogg'] ||
            '';
          if (!previewUrl) return null;
          return {
            id: `fs-${item.id}`,
            name: item.name,
            url: `/api/sample-proxy?url=${encodeURIComponent(previewUrl)}`,
            source: 'freesound' as const,
            duration: typeof item.duration === 'number' ? item.duration : undefined,
            username: typeof item.username === 'string' ? item.username : undefined,
            tags: Array.isArray(item.tags) ? item.tags.slice(0, 4) : undefined,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .slice(0, pageSize);

      res.json({
        configured: true,
        count: typeof data.count === 'number' ? data.count : results.length,
        page,
        results,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Freesound lookup failed.';
      res.status(502).json({ error: message });
    }
  });

  app.get('/api/sound-banks/search', async (req, res) => {
    try {
      const query = String(req.query.q ?? '').trim();
      if (!query) {
        res.status(400).json({ error: 'Query parameter "q" is required.' });
        return;
      }

      const bank = String(req.query.bank ?? 'primary').toLowerCase();
      const mode = String(req.query.mode ?? 'browse').toLowerCase();
      const isBrowse = mode === 'browse';
      const page = Math.max(1, Math.min(20, Number(req.query.page ?? 1) || 1));
      const pageSize = isBrowse ? 12 : 5;
      const maxDur = isBrowse ? 30 : 2.5;

      if (bank === 'secondary') {
        const jamendoId = process.env.JAMENDO_CLIENT_ID?.trim() || '';
        const pixabayKey = process.env.PIXABAY_API_KEY?.trim() || '';
        const explicitProvider = (
          process.env.SECONDARY_SOUND_API_PROVIDER || ''
        )
          .trim()
          .toLowerCase();
        const secondaryKey = (
          req.header('x-secondary-sound-key') ||
          process.env.SECONDARY_SOUND_API_KEY ||
          jamendoId ||
          pixabayKey ||
          ''
        ).trim();

        const provider =
          explicitProvider ||
          (jamendoId ? 'jamendo' : pixabayKey ? 'pixabay' : 'freesound');

        if (!secondaryKey) {
          res.status(200).json({
            configured: false,
            bank: 'secondary',
            provider,
            results: [],
            count: 0,
            page,
          });
          return;
        }

        if (provider === 'jamendo') {
          const jUrl = new URL('https://api.jamendo.com/v3.0/tracks/');
          jUrl.searchParams.set('client_id', secondaryKey);
          jUrl.searchParams.set('format', 'json');
          jUrl.searchParams.set('limit', String(pageSize));
          jUrl.searchParams.set('offset', String((page - 1) * pageSize));
          jUrl.searchParams.set('search', query);
          jUrl.searchParams.set('audioformat', 'mp32');

          const upstream = await fetch(jUrl.toString());
          if (!upstream.ok) {
            const text = await upstream.text();
            res.status(upstream.status).json({
              error: `Secondary Sound API (Jamendo ${upstream.status}): ${text.slice(0, 160)}`,
            });
            return;
          }
          const data = (await upstream.json()) as {
            headers?: { results_fullcount?: number };
            results?: Array<{
              id: string;
              name: string;
              duration?: number;
              artist_name?: string;
              audio?: string;
            }>;
          };
          const results = (data.results ?? [])
            .filter((item) => Boolean(item.audio))
            .map((item) => ({
              id: `sec-jam-${item.id}`,
              name: item.name,
              url: `/api/sample-proxy?url=${encodeURIComponent(item.audio!)}`,
              source: 'secondary' as const,
              duration: typeof item.duration === 'number' ? item.duration : undefined,
              username: item.artist_name,
              tags: ['jamendo'],
            }));
          res.json({
            configured: true,
            bank: 'secondary',
            provider: 'jamendo',
            count: data.headers?.results_fullcount ?? results.length,
            page,
            results,
          });
          return;
        }

        // Default secondary Freesound-compatible bank
        const apiUrl = new URL('https://freesound.org/apiv2/search/text/');
        apiUrl.searchParams.set('query', query);
        apiUrl.searchParams.set('filter', `duration:[0 TO ${maxDur}]`);
        apiUrl.searchParams.set('fields', 'id,name,duration,username,tags,previews');
        apiUrl.searchParams.set('page_size', String(pageSize));
        apiUrl.searchParams.set('page', String(page));

        const upstream = await fetch(apiUrl.toString(), {
          headers: { Authorization: `Token ${secondaryKey}` },
        });
        if (!upstream.ok) {
          const text = await upstream.text();
          res.status(upstream.status).json({
            error: `Secondary Sound API error (${upstream.status}): ${text.slice(0, 180)}`,
          });
          return;
        }
        const data = (await upstream.json()) as {
          count?: number;
          results?: Array<{
            id: number;
            name: string;
            duration?: number;
            username?: string;
            tags?: string[];
            previews?: Record<string, string>;
          }>;
        };
        const results = (data.results ?? [])
          .map((item) => {
            const previewUrl =
              item.previews?.['preview-hq-mp3'] ||
              item.previews?.['preview-lq-mp3'] ||
              item.previews?.['preview-hq-ogg'] ||
              '';
            if (!previewUrl) return null;
            return {
              id: `sec-fs-${item.id}`,
              name: item.name,
              url: `/api/sample-proxy?url=${encodeURIComponent(previewUrl)}`,
              source: 'secondary' as const,
              duration: typeof item.duration === 'number' ? item.duration : undefined,
              username: typeof item.username === 'string' ? item.username : undefined,
              tags: Array.isArray(item.tags) ? item.tags.slice(0, 4) : undefined,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .slice(0, pageSize);

        res.json({
          configured: true,
          bank: 'secondary',
          provider,
          count: typeof data.count === 'number' ? data.count : results.length,
          page,
          results,
        });
        return;
      }

      // Primary bank (Freesound)
      const primaryKey = (
        req.header('x-freesound-key') ||
        process.env.FREESOUND_API_KEY ||
        ''
      ).trim();

      if (!primaryKey) {
        res.status(200).json({
          configured: false,
          bank: 'primary',
          provider: 'freesound',
          results: [],
          count: 0,
          page,
        });
        return;
      }

      const apiUrl = new URL('https://freesound.org/apiv2/search/text/');
      apiUrl.searchParams.set('query', query);
      apiUrl.searchParams.set('filter', `duration:[0 TO ${maxDur}]`);
      apiUrl.searchParams.set('fields', 'id,name,duration,username,tags,previews');
      apiUrl.searchParams.set('page_size', String(pageSize));
      apiUrl.searchParams.set('page', String(page));

      const upstream = await fetch(apiUrl.toString(), {
        headers: { Authorization: `Token ${primaryKey}` },
      });
      if (!upstream.ok) {
        const text = await upstream.text();
        res.status(upstream.status).json({
          error: `Freesound API error (${upstream.status}): ${text.slice(0, 180)}`,
        });
        return;
      }
      const data = (await upstream.json()) as {
        count?: number;
        results?: Array<{
          id: number;
          name: string;
          duration?: number;
          username?: string;
          tags?: string[];
          previews?: Record<string, string>;
        }>;
      };
      const results = (data.results ?? [])
        .map((item) => {
          const previewUrl =
            item.previews?.['preview-hq-mp3'] ||
            item.previews?.['preview-lq-mp3'] ||
            item.previews?.['preview-hq-ogg'] ||
            '';
          if (!previewUrl) return null;
          return {
            id: `fs-${item.id}`,
            name: item.name,
            url: `/api/sample-proxy?url=${encodeURIComponent(previewUrl)}`,
            source: 'freesound' as const,
            duration: typeof item.duration === 'number' ? item.duration : undefined,
            username: typeof item.username === 'string' ? item.username : undefined,
            tags: Array.isArray(item.tags) ? item.tags.slice(0, 4) : undefined,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .slice(0, pageSize);

      res.json({
        configured: true,
        bank: 'primary',
        provider: 'freesound',
        count: typeof data.count === 'number' ? data.count : results.length,
        page,
        results,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Sound bank lookup failed.';
      res.status(502).json({ error: message });
    }
  });

  app.get('/api/sample-proxy', async (req, res) => {
    try {
      const rawUrl = String(req.query.url ?? '');
      const validated = isAllowedSampleUrl(rawUrl);
      if (!validated) {
        res.status(400).json({ error: 'Sample host is not in allowlist.' });
        return;
      }

      const upstream = await fetch(validated.toString());
      if (!upstream.ok) {
        res.status(upstream.status).end();
        return;
      }

      const arrayBuffer = await upstream.arrayBuffer();
      if (arrayBuffer.byteLength > 10_000_000) {
        res.status(413).json({ error: 'Sample too large.' });
        return;
      }

      const contentType = upstream.headers.get('content-type') || 'audio/mpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(arrayBuffer));
    } catch {
      res.status(502).json({ error: 'Failed to proxy acoustic sample.' });
    }
  });

  const basicPitchModelDir = path.resolve(
    __dirname,
    'node_modules/@spotify/basic-pitch/model'
  );
  app.use('/basic-pitch-model', express.static(basicPitchModelDir));

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`PRAISELOOP AI Studio server listening on http://localhost:${port}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
