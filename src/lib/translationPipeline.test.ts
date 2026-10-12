import { test, expect, vi } from 'vitest';
import {
  runChunkedTranslation,
  runSingleTranslation,
  isAbortError,
} from './translationPipeline';
import type { AudioChunk } from './audioExtractor';

function makeChunk(index: number): AudioChunk {
  return {
    chunkIndex: index,
    startTime: index * 300,
    endTime: (index + 1) * 300,
    blob: new Blob(['fake-audio'], { type: 'audio/wav' }),
  };
}

function okResponse(subtitles: unknown[] = [{ id: '1' }]) {
  return { json: async () => ({ success: true, subtitles }) } as unknown as Response;
}

/** Fails `failTimes` then succeeds — records every attempt. */
function flakyFetch(failTimes: number, calls: number[] = []) {
  return vi.fn(async () => {
    calls.push(1);
    if (calls.length <= failTimes) {
      return { json: async () => ({ success: false, error: 'boom' }) } as unknown as Response;
    }
    return okResponse();
  }) as unknown as typeof fetch;
}

test('isAbortError only matches AbortError', () => {
  expect(isAbortError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true);
  expect(isAbortError(new Error('boom'))).toBe(false);
  expect(isAbortError(null)).toBe(false);
});

test('runChunkedTranslation retries transient failures then succeeds', async () => {
  const attempts: number[] = [];
  const fetchImpl = flakyFetch(2, attempts);
  const ctrl = new AbortController();
  const progress: [number, number][] = [];

  const { results, failedChunkIndexes } = await runChunkedTranslation([makeChunk(0)], {
    targetLanguage: 'th',
    karaokeEnabled: false,
    deps: { fetchImpl, signal: ctrl.signal },
    onProgress: (c, t) => progress.push([c, t]),
    retryBaseMs: 1,
  });

  expect(results).toHaveLength(1);
  expect(failedChunkIndexes).toEqual([]);
  expect(attempts).toHaveLength(3); // 2 failures + 1 success
  expect(progress).toEqual([[1, 1]]);
});

test('runChunkedTranslation records exhausted chunks instead of throwing', async () => {
  const fetchImpl = flakyFetch(99);
  const ctrl = new AbortController();

  const { results, failedChunkIndexes } = await runChunkedTranslation(
    [makeChunk(0), makeChunk(1)],
    {
      targetLanguage: 'th',
      karaokeEnabled: false,
      deps: { fetchImpl, signal: ctrl.signal },
      onProgress: () => {},
      retryBaseMs: 1,
    }
  );

  expect(results).toEqual([]);
  expect(failedChunkIndexes).toEqual([0, 1]);
});

test('runChunkedTranslation propagates abort without recording failures', async () => {
  const fetchImpl = vi.fn(async () => {
    throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  }) as unknown as typeof fetch;
  const ctrl = new AbortController();

  await expect(
    runChunkedTranslation([makeChunk(0)], {
      targetLanguage: 'th',
      karaokeEnabled: false,
      deps: { fetchImpl, signal: ctrl.signal },
      onProgress: () => {},
      retryBaseMs: 1,
    })
  ).rejects.toMatchObject({ name: 'AbortError' });
});

test('runChunkedTranslation batches within the concurrency limit', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl = vi.fn(async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return okResponse();
  }) as unknown as typeof fetch;
  const ctrl = new AbortController();

  await runChunkedTranslation([0, 1, 2, 3, 4].map(makeChunk), {
    targetLanguage: 'th',
    karaokeEnabled: false,
    deps: { fetchImpl, signal: ctrl.signal },
    onProgress: () => {},
    concurrency: 2,
  });

  expect(maxInFlight).toBeLessThanOrEqual(2);
});

test('runSingleTranslation returns subtitles and throws on API failure', async () => {
  const ctrl = new AbortController();
  const ok = (await runSingleTranslation({
    blob: new Blob(['x']),
    fileName: 'clip.wav',
    targetLanguage: 'th',
    karaokeEnabled: false,
    deps: { fetchImpl: flakyFetch(0), signal: ctrl.signal },
  })) as unknown[];
  expect(ok).toHaveLength(1);

  await expect(
    runSingleTranslation({
      blob: new Blob(['x']),
      fileName: 'clip.wav',
      targetLanguage: 'th',
      karaokeEnabled: false,
      deps: { fetchImpl: flakyFetch(1), signal: ctrl.signal },
    })
  ).rejects.toThrow('boom');
});

test('receiver-sensitive fetch (window.fetch) is called with a valid receiver', async () => {
  // Regression: page.tsx used to inject bare `fetch`. The pipeline invoked it as
  // `deps.fetchImpl(...)`, so `this` became the deps object instead of `window`
  // and browsers threw "Illegal invocation" on every translate. Plain mock fns
  // are receiver-independent, so they never caught it — this fake reproduces
  // the browser's brand check.
  const win = { name: 'window' } as unknown as Window;
  const brandCheckedFetch = function (this: unknown) {
    if (this !== win) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    return Promise.resolve(okResponse());
  } as unknown as typeof fetch;

  const ctrl = new AbortController();
  await expect(
    runSingleTranslation({
      blob: new Blob(['x']),
      fileName: 'clip.wav',
      targetLanguage: 'th',
      karaokeEnabled: false,
      deps: { fetchImpl: brandCheckedFetch.bind(win), signal: ctrl.signal },
    })
  ).resolves.toHaveLength(1);
});
