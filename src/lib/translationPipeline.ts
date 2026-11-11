import { AudioChunk } from './audioExtractor';
import { SubtitleItem, TranslationProgressEvent } from './types';

/**
 * Translation pipeline: chunk fan-out, retry, merge.
 *
 * Extracted from the studio page so the orchestration logic is testable in
 * plain Node (vitest, no DOM). Everything the pipeline needs from the outside
 * world is injected — `fetchImpl` for network, callbacks for progress — so
 * tests can drive failure/abort/retry paths deterministically.
 */

export const CHUNK_CONCURRENCY = 3;
export const CHUNK_MAX_ATTEMPTS = 4;
export const CHUNK_RETRY_BASE_MS = 1500;

export interface ChunkResult {
  chunkStartTime: number;
  subtitles: SubtitleItem[];
  /** True when the model's response hit the token ceiling (tail cues lost). */
  truncated?: boolean;
}

export interface PipelineCallbacks {
  onProgress(statusMessage: string): void;
  onPeaks(peaks: number[]): void;
}

export interface PipelineDeps {
  fetchImpl: typeof fetch;
  signal: AbortSignal;
}

export interface ChunkRunSummary {
  results: ChunkResult[];
  failedChunkIndexes: number[];
}

/** True for AbortError from either a real Error or a DOMException-shaped throw. */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Failures that will fail identically on every retry, so retrying them only
 * burns quota and leaves the UI spinning. Measured 2026-10-12: a chunk that
 * blows Gemini's 1M-token input ceiling returns HTTP 400 "input token count
 * exceeds the maximum", which the server relays verbatim — three client
 * attempts × four models each, all guaranteed to fail the same way.
 */
export function isNonRetryableChunkError(err: unknown): boolean {
  const msg = (err instanceof Error && err.message) || String(err);
  return /input token count exceeds|exceeds the maximum number of tokens|413|Payload Too Large/i.test(msg);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** POSTs one audio chunk to the chunk endpoint, retrying transient failures. */
async function processChunk(
  chunk: AudioChunk,
  opts: {
    targetLanguage: string;
    karaokeEnabled: boolean;
    deps: PipelineDeps;
    maxAttempts: number;
    retryBaseMs: number;
    /** Chunk-local extras (e.g. OCR frames). Runs once per chunk, before the
     *  retry loop: a failure here fails the chunk without fetch-level retries
     *  (the manual retry re-runs it). No video source degrades to audio-only. */
    prepareChunk?: (chunk: AudioChunk, formData: FormData) => Promise<void>;
    onSuccess?: () => void;
  }
): Promise<ChunkResult> {
  const { targetLanguage, karaokeEnabled, deps, maxAttempts, retryBaseMs } = opts;

  const formData = new FormData();
  formData.append('file', chunk.blob, `chunk_${chunk.chunkIndex}.wav`);
  formData.append('targetLanguage', targetLanguage);
  formData.append('chunkIndex', String(chunk.chunkIndex));
  formData.append('chunkStartTime', String(chunk.startTime));
  formData.append('wordTiming', karaokeEnabled ? '1' : '0');
  await opts.prepareChunk?.(chunk, formData);

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await deps.fetchImpl('/api/video-translate-chunk', {
        method: 'POST',
        body: formData,
        signal: deps.signal,
      });
      const data = (await res.json()) as { success?: boolean; error?: string; subtitles?: SubtitleItem[]; truncated?: boolean };
      if (!data.success) throw new Error(data.error || `Failed on chunk ${chunk.chunkIndex + 1}`);
      opts.onSuccess?.();
      return { chunkStartTime: chunk.startTime, subtitles: data.subtitles || [], truncated: Boolean(data.truncated) };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      lastErr = err;
      // Guaranteed-fail payloads (e.g. token ceiling) fail identically on
      // every model and key; retrying only burns minutes. Fail the chunk now
      // and let the retry banner own recovery.
      if (isNonRetryableChunkError(err)) throw err;
      if (attempt < maxAttempts) await delay(Math.round(retryBaseMs * Math.pow(1.8, attempt - 1)));
    }
  }
  throw lastErr ?? new Error(`Failed on chunk ${chunk.chunkIndex + 1}`);
}

/**
 * Fans chunks out in fixed-size batches (not an unbounded Promise.all) so a
 * 10-hour upload does not open 120 simultaneous uploads, blow up browser RAM,
 * and trip Gemini rate limits. Returns per-chunk results plus the indexes that
 * exhausted their retries — callers decide whether to surface a partial
 * transcript or fail outright.
 */
export async function runChunkedTranslation(
  chunks: AudioChunk[],
  opts: {
    targetLanguage: string;
    karaokeEnabled: boolean;
    deps: PipelineDeps;
    onProgress: (completed: number, total: number) => void;
    concurrency?: number;
    maxAttempts?: number;
    retryBaseMs?: number;
    /** Chunk-local extras (e.g. OCR frames extracted from the video window). */
    prepareChunk?: (chunk: AudioChunk, formData: FormData) => Promise<void>;
    /** Live re-estimate of remaining time, emitted after each chunk success. */
    onEta?: (info: { remainingSecs: number; completed: number; total: number }) => void;
  }
): Promise<ChunkRunSummary> {
  const concurrency = opts.concurrency ?? CHUNK_CONCURRENCY;
  const maxAttempts = opts.maxAttempts ?? CHUNK_MAX_ATTEMPTS;
  const retryBaseMs = opts.retryBaseMs ?? CHUNK_RETRY_BASE_MS;

  const startedAt = Date.now();
  let completed = 0;
  const failedChunkIndexes: number[] = [];
  const results: ChunkResult[] = [];

  for (let i = 0; i < chunks.length; i += concurrency) {
    if (opts.deps.signal.aborted) break;
    const batch = chunks.slice(i, i + concurrency);
    const settled = await Promise.all(
      batch.map(async (chunk) => {
        try {
          return await processChunk(chunk, {
            targetLanguage: opts.targetLanguage,
            karaokeEnabled: opts.karaokeEnabled,
            deps: opts.deps,
            maxAttempts,
            retryBaseMs,
            prepareChunk: opts.prepareChunk,
            onSuccess: () => {
              completed++;
              opts.onProgress(completed, chunks.length);
              // Wall-clock rate per completed chunk already includes the batch
              // parallelism, so scaling it by remaining chunks is an honest
              // re-estimate (retries inflate it, which is the point).
              if (opts.onEta && completed < chunks.length) {
                const elapsedSecs = (Date.now() - startedAt) / 1000;
                const rate = elapsedSecs / completed;
                opts.onEta({
                  remainingSecs: Math.round(rate * (chunks.length - completed)),
                  completed,
                  total: chunks.length,
                });
              }
            },
          });
        } catch (err: unknown) {
          if (isAbortError(err)) throw err;
          failedChunkIndexes.push(chunk.chunkIndex);
          console.warn(`Chunk ${chunk.chunkIndex + 1} failed after ${maxAttempts} attempts:`, err);
          return null;
        }
      })
    );

    for (const r of settled) {
      if (r !== null) results.push(r);
    }
  }

  return { results, failedChunkIndexes };
}

/** Single-clip path: one audio/video payload posted to the whole-file endpoint. */
export async function runSingleTranslation(
  opts: {
    blob: Blob;
    fileName: string;
    targetLanguage: string;
    karaokeEnabled: boolean;
    /** Full-file OCR fallback for videos the browser cannot audio-decode. */
    includeOnScreenText?: boolean;
    onProgress?: (event: Extract<TranslationProgressEvent, { type: 'progress' }>) => void;
    deps: PipelineDeps;
  }
): Promise<SubtitleItem[]> {
  const formData = new FormData();
  formData.append('file', opts.blob, opts.fileName);
  formData.append('targetLanguage', opts.targetLanguage);
  formData.append('wordTiming', opts.karaokeEnabled ? '1' : '0');
  if (opts.includeOnScreenText) {
    formData.append('includeOnScreenText', '1');
  }

  const res = await opts.deps.fetchImpl('/api/video-translate', {
    method: 'POST',
    body: formData,
    headers: {
      Accept: 'application/x-ndjson, application/json',
    },
    signal: opts.deps.signal,
  });

  const contentType = res.headers?.get?.('content-type') || '';

  if (contentType.includes('application/x-ndjson') && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalSubtitles: SubtitleItem[] | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as TranslationProgressEvent;
          if (event.type === 'progress') {
            opts.onProgress?.(event);
          } else if (event.type === 'complete') {
            finalSubtitles = event.subtitles;
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
        } catch (err) {
          if (err instanceof Error && err.message !== 'Unexpected end of JSON input') {
            throw err;
          }
        }
      }
    }

    if (finalSubtitles) return finalSubtitles;
    throw new Error('Server closed connection before returning completed subtitles.');
  }

  const data = (await res.json()) as { success?: boolean; error?: string; subtitles?: SubtitleItem[] };
  if (!data.success) throw new Error(data.error || 'Failed to transcribe and translate video.');
  return data.subtitles || [];
}