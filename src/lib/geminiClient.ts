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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parsePartialOrTruncatedJSON(text: string): any {
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

/**
 * Calls Gemini with a JSON-schema response across every API key × model,
 * continuing past both retryable and non-retryable failures (best-effort
 * resilience), then repair-parses the response.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requestJSON<T = any>(opts: RequestJSONOptions): Promise<T> {
  const apiKeys = env.apiKeys;
  if (apiKeys.length === 0) {
    throw new Error('GEMINI_API_KEY environment variable is missing or empty.');
  }

  let lastError: unknown = null;

  for (const apiKey of apiKeys) {
    const ai = new GoogleGenAI({ apiKey });

    for (const modelName of MODELS) {
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
        const error = err as { status?: number; message?: string };
        console.warn(`Attempt failed with model ${modelName} using key ...${apiKey.slice(-6)}:`, error.message);
        lastError = err;
      }
    }
  }

  throw lastError || new Error('All API keys and Gemini models failed or exceeded quota.');
}

// Re-export so callers only import from one place.
export { Type };
