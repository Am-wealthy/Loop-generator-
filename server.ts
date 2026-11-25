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
]);

function isAllowedSampleUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (ALLOWED_PROXY_HOSTS.has(host) || host.endsWith('.freesound.org')) {
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

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '35mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      serverFreesoundConfigured: Boolean(process.env.FREESOUND_API_KEY?.trim()),
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

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
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

    const rawText = (response.text ?? '').trim();
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

  app.get('/api/freesound/search', async (req, res) => {
    try {
      const query = String(req.query.q ?? '').trim();
      if (!query) {
        res.status(400).json({ error: 'Query parameter "q" is required.' });
        return;
      }

      const freesoundKey = (
        req.header('x-freesound-key') ||
        process.env.FREESOUND_API_KEY ||
        ''
      ).trim();

      if (!freesoundKey) {
        res.status(200).json({
          configured: false,
          results: [],
        });
        return;
      }

      const apiUrl = new URL('https://freesound.org/apiv2/search/text/');
      apiUrl.searchParams.set('query', query);
      apiUrl.searchParams.set('filter', 'duration:[0 TO 1.5]');
      apiUrl.searchParams.set('fields', 'id,name,previews');
      apiUrl.searchParams.set('page_size', '5');

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
        results?: Array<{
          id: number;
          name: string;
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
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .slice(0, 5);

      res.json({
        configured: true,
        results,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Freesound lookup failed.';
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
