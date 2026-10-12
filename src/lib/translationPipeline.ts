import { AudioChunk } from './audioExtractor';
import { SubtitleItem } from './types';

/**
 * Translation pipeline: chunk fan-out, retry, merge.
 *
 * Extracted from the studio page so the orchestration logic is testable in
 * plain Node (vitest, no DOM). Everything the pipeline needs from the outside
 * world is injected — `fetchImpl` for network, callbacks for progress — so
 * tests can drive failure/abort/retry paths deterministically.
 */

export const CHUNK_CONCURRENCY = 3;
export const CHUNK_MAX_ATTEMPTS = 3;
export const CHUNK_RETRY_BASE_MS = 1500;

export interface ChunkResult {
  chunkStartTime: number;
  subtitles: SubtitleItem[];
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

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await deps.fetchImpl('/api/video-translate-chunk', {
        method: 'POST',
        body: formData,
        signal: deps.signal,
      });
      const data = (await res.json()) as { success?: boolean; error?: string; subtitles?: SubtitleItem[] };
      if (!data.success) throw new Error(data.error || `Failed on chunk ${chunk.chunkIndex + 1}`);
      opts.onSuccess?.();
      return { chunkStartTime: chunk.startTime, subtitles: data.subtitles || [] };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      lastErr = err;
      if (attempt < maxAttempts) await delay(retryBaseMs * attempt);
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
  }
): Promise<ChunkRunSummary> {
  const concurrency = opts.concurrency ?? CHUNK_CONCURRENCY;
  const maxAttempts = opts.maxAttempts ?? CHUNK_MAX_ATTEMPTS;
  const retryBaseMs = opts.retryBaseMs ?? CHUNK_RETRY_BASE_MS;

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
            onSuccess: () => {
              completed++;
              opts.onProgress(completed, chunks.length);
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

/** Single-clip path: one audio payload posted to the whole-file endpoint. */
export async function runSingleTranslation(
  opts: {
    blob: Blob;
    fileName: string;
    targetLanguage: string;
    karaokeEnabled: boolean;
    deps: PipelineDeps;
  }
): Promise<SubtitleItem[]> {
  const formData = new FormData();
  formData.append('file', opts.blob, opts.fileName);
  formData.append('targetLanguage', opts.targetLanguage);
  formData.append('wordTiming', opts.karaokeEnabled ? '1' : '0');

  const res = await opts.deps.fetchImpl('/api/video-translate', {
    method: 'POST',
    body: formData,
    signal: opts.deps.signal,
  });
  const data = (await res.json()) as { success?: boolean; error?: string; subtitles?: SubtitleItem[] };
  if (!data.success) throw new Error(data.error || 'Failed to transcribe and translate video.');
  return data.subtitles || [];
}