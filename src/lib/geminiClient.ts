import { GoogleGenAI, Type } from '@google/genai';
import type { Schema } from '@google/genai';
import { env } from './env';

/**
 * Model priority list (highest quota first). Single source of truth for
 * every Gemini-backed route. User quota dashboard informed the ordering.
 */
export const MODELS = [
  'gemini-3.5-flash-lite', // Primary Default (High Quota: 500 RPD, 15 RPM)
  'gemini-3.6-flash',      // High-Precision Model (20 RPD, 5 RPM)
  'gemini-3-flash',        // (20 RPD, 5 RPM)
  'gemini-3.5-flash',      // (20 RPD, 5 RPM)
  'gemini-3.1-flash-lite', // (500 RPD, 15 RPM)
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
];

export function parsePartialOrTruncatedJSON(text: string): unknown {
  if (!text) return null;
  const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();

  // 1. Standard JSON parse
  try {
    return JSON.parse(cleanText);
  } catch {
    // 2. Auto-repair truncated JSON array
    try {
      let repaired = cleanText;

      // If cut off inside an unclosed string, close the quote
      const quoteMatches = repaired.match(/"/g) || [];
      if (quoteMatches.length % 2 !== 0) {
        repaired += '"';
      }

      // Find the last valid complete JSON object closing brace '}'
      const lastBraceIndex = repaired.lastIndexOf('}');
      if (lastBraceIndex !== -1) {
        repaired = repaired.substring(0, lastBraceIndex + 1) + ']';
        return JSON.parse(repaired);
      }
    } catch (e2) {
      console.warn('[JSON Repair] Could not recover truncated JSON automatically:', e2);
    }
  }
  return null;
}

export interface RequestJSONOptions {
  prompt: string;
  schema: Schema;
  signal?: AbortSignal;
  maxOutputTokens?: number;
  /** Base delay for exponential backoff between retryable attempts (tests can lower it). */
  initialRetryDelayMs?: number;
}

/**
 * Shared JSON response schema for subtitle arrays.
 * Timestamps are STRING ("HH:MM:SS.mmm") to match the main transcription path;
 * callers convert back to seconds with parseTimestampToSeconds.
 */
export const SUBTITLE_ARRAY_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      startTime: { type: Type.STRING },
      endTime: { type: Type.STRING },
      originalText: { type: Type.STRING },
      translatedText: { type: Type.STRING },
    },
    required: ['id', 'startTime', 'endTime', 'originalText', 'translatedText'],
  },
};

interface GeminiLikeError {
  status?: number;
  message?: string;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const KEY_LEVEL_STATUSES = new Set([401, 403]);

function isRetryableError(err: unknown): boolean {
  const e = err as GeminiLikeError;
  if (e && typeof e.status === 'number') return RETRYABLE_STATUSES.has(e.status);
  // Network-layer failures (fetch dropped, DNS, socket timeout) carry no status.
  const msg = (e && typeof e.message === 'string' && e.message) || '';
  return /network|fetch|timeout|ECONN|ENET|EAI_AGAIN|socket/i.test(msg) && msg.length > 0;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('Aborted.'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error('Aborted.'));
    }, { once: true });
  });
}

/**
 * Calls Gemini with a JSON-schema response across every API key × model.
 * Retryable failures (429/5xx/network) advance to the next model after an
 * exponential backoff; request-level 400 errors abort immediately (the same
 * prompt would fail everywhere — no point burning quota); key-level 401/403
 * skips straight to the next key. A model that failed on two different keys
 * is skipped for the remaining keys.
 */
export async function requestJSON<T>(opts: RequestJSONOptions): Promise<T> {
  const apiKeys = env.apiKeys;
  if (apiKeys.length === 0) {
    throw new Error('GEMINI_API_KEY environment variable is missing or empty.');
  }

  let lastError: unknown = null;
  let retryDelayMs = opts.initialRetryDelayMs ?? 500;
  const modelFailureCount = new Map<string, number>();

  for (const apiKey of apiKeys) {
    const ai = new GoogleGenAI({ apiKey });

    for (const modelName of MODELS) {
      if ((modelFailureCount.get(modelName) ?? 0) >= 2) continue;

      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: opts.prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: opts.schema,
            maxOutputTokens: opts.maxOutputTokens,
            abortSignal: opts.signal,
          },
        });

        const responseText = response.text;
        if (!responseText) {
          throw new Error('Gemini API returned an empty response.');
        }

        const parsed = parsePartialOrTruncatedJSON(responseText);
        if (parsed === null || parsed === undefined) {
          throw new Error('Could not parse JSON from Gemini API response.');
        }

        return parsed as T;
      } catch (err: unknown) {
        const error = err as GeminiLikeError;
        lastError = err;
        modelFailureCount.set(modelName, (modelFailureCount.get(modelName) ?? 0) + 1);

        if (opts.signal?.aborted) throw err;

        if (typeof error.status === 'number' && error.status === 400) {
          // Invalid argument: identical prompt will fail on every key/model.
          throw err;
        }

        if (typeof error.status === 'number' && KEY_LEVEL_STATUSES.has(error.status)) {
          // This key is dead; the remaining models would fail identically.
          console.warn(`Key ...${apiKey.slice(-6)} rejected (status ${error.status}); trying next key.`);
          break;
        }

        if (isRetryableError(err)) {
          console.warn(`Retryable failure with model ${modelName} on key ...${apiKey.slice(-6)}; backing off ${retryDelayMs}ms.`);
          try {
            await sleep(retryDelayMs, opts.signal);
          } catch {
            throw err;
          }
          retryDelayMs = Math.min(8000, retryDelayMs * 2);
        } else {
          console.warn(`Attempt failed with model ${modelName} using key ...${apiKey.slice(-6)}:`, error.message);
        }
      }
    }
  }

  throw lastError || new Error('All API keys and Gemini models failed or exceeded quota.');
}

// Re-export so callers only import from one place.
export { Type };
