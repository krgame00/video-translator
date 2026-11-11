import { describe, it, expect } from 'vitest';
import { extractVideoFrames } from './videoFrameExtractor';

describe('videoFrameExtractor', () => {
  it('returns empty array when videoSrc is empty', async () => {
    const frames = await extractVideoFrames('', 0, 10);
    expect(frames).toEqual([]);
  });

  it('returns empty array when duration is zero or negative', async () => {
    const framesZero = await extractVideoFrames('blob:http://localhost/mock-video', 10, 10);
    expect(framesZero).toEqual([]);

    const framesNeg = await extractVideoFrames('blob:http://localhost/mock-video', 15, 10);
    expect(framesNeg).toEqual([]);
  });

  it('handles non-browser or missing DOM context gracefully without throwing', async () => {
    // In vitest Node/happy-dom environment, if video fails or is unsupported, it returns [] cleanly
    const frames = await extractVideoFrames('blob:http://localhost/mock-nonexistent', 0, 5, {
      maxFrames: 5,
    });
    expect(Array.isArray(frames)).toBe(true);
  });
});
