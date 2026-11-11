import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractAudioSegment } from './audioExtractor';

function makeFakeBuffer(durationSecs: number) {
  const sampleRate = 16000;
  const length = Math.ceil(durationSecs * sampleRate);
  return {
    duration: durationSecs,
    sampleRate,
    length,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer;
}

/** One shared decode spy per constructor, like one real audio decoder. */
function makeFakeCtor(decodedDurationSecs = 300) {
  const decodeSpy = vi.fn(async () => makeFakeBuffer(decodedDurationSecs));
  const renderSpy = vi.fn(async () => makeFakeBuffer(1));
  class FakeOfflineAudioContext {
    decodeAudioData = decodeSpy;
    destination = {};
    createBufferSource() {
      return { buffer: null as AudioBuffer | null, connect: () => {}, start: () => {} };
    }
    async startRendering() {
      await renderSpy();
      return makeFakeBuffer(1);
    }
  }
  return { FakeOfflineAudioContext, decodeSpy, renderSpy };
}

describe('audioExtractor decoded-buffer cache', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes the same File once across repeated gap-repair calls', async () => {
    const { FakeOfflineAudioContext, decodeSpy } = makeFakeCtor();
    vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);

    const file = new File(['dummy'], 'video.mp4', { type: 'video/mp4' });
    const blob1 = await extractAudioSegment(file, 10, 2);
    const blob2 = await extractAudioSegment(file, 20, 2);

    expect(decodeSpy).toHaveBeenCalledTimes(1); // second call must hit the cache
    expect(blob1).toBeInstanceOf(Blob);
    expect(blob2).toBeInstanceOf(Blob);
    expect(blob2.size).toBeGreaterThan(44); // WAV header plus rendered samples
  });

  it('decodes a different File separately (cache keyed per File)', async () => {
    const { FakeOfflineAudioContext, decodeSpy } = makeFakeCtor();
    vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);

    const fileA = new File(['a'], 'a.mp4', { type: 'video/mp4' });
    const fileB = new File(['b'], 'b.mp4', { type: 'video/mp4' });
    await extractAudioSegment(fileA, 0, 1);
    await extractAudioSegment(fileB, 0, 1);
    await extractAudioSegment(fileA, 1, 1); // cached — no third decode

    expect(decodeSpy).toHaveBeenCalledTimes(2);
  });

  it('does not cache buffers longer than the 2h cap', async () => {
    // 8000s > 7200s cap: every call must re-decode instead of pinning memory.
    const { FakeOfflineAudioContext, decodeSpy } = makeFakeCtor(8000);
    vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);

    const file = new File(['dummy'], 'huge.mp4', { type: 'video/mp4' });
    await extractAudioSegment(file, 0, 1);
    await extractAudioSegment(file, 10, 1);

    expect(decodeSpy).toHaveBeenCalledTimes(2);
  });
});
