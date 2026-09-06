import { segmentWords } from './srtFormatter';

export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

/** Tolerance (seconds) when checking model word timings against cue bounds. */
const BOUNDS_TOLERANCE = 0.25;

/**
 * Validates a model-provided word timing sequence against its cue:
 * non-empty, chronologically ordered, and (within tolerance) inside the cue.
 */
export function validateWordTimings(
  words: WordTiming[],
  cueStart: number,
  cueEnd: number
): boolean {
  if (!Array.isArray(words) || words.length === 0) return false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w || typeof w.text !== 'string' || w.text.trim().length === 0) return false;
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end)) return false;
    if (w.end <= w.start) return false;
    if (w.start < cueStart - BOUNDS_TOLERANCE || w.end > cueEnd + BOUNDS_TOLERANCE) return false;
    if (i > 0 && w.start < words[i - 1].end - BOUNDS_TOLERANCE) return false;
  }
  return true;
}

/**
 * Stretches/compresses a validated word sequence uniformly so it exactly
 * fills [cueStart, cueEnd], preserving order and relative durations.
 */
export function interpolateWords(
  words: WordTiming[],
  cueStart: number,
  cueEnd: number
): WordTiming[] {
  if (words.length === 0) return [];
  const spanStart = words[0].start;
  const spanEnd = words[words.length - 1].end;
  const spanLen = Math.max(0.001, spanEnd - spanStart);
  const targetLen = cueEnd - cueStart;

  return words.map((w) => {
    const start = cueStart + ((w.start - spanStart) / spanLen) * targetLen;
    const end = cueStart + ((w.end - spanStart) / spanLen) * targetLen;
    return { text: w.text, start: +start.toFixed(3), end: +end.toFixed(3) };
  });
}

/**
 * Fallback when the model's timings fail validation: segment the cue text
 * (Thai-aware, never mid-word) and allocate time proportionally to token
 * length, exactly covering [cueStart, cueEnd].
 */
export function distributeWordsByChars(
  text: string,
  cueStart: number,
  cueEnd: number
): WordTiming[] {
  const tokens = segmentWords(text).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  const totalChars = tokens.reduce((sum, t) => sum + t.length, 0) || 1;
  const duration = cueEnd - cueStart;

  const words: WordTiming[] = [];
  let cursor = cueStart;
  for (let i = 0; i < tokens.length; i++) {
    const isLast = i === tokens.length - 1;
    const share = (tokens[i].length / totalChars) * duration;
    const start = cursor;
    const end = isLast ? cueEnd : Math.min(cueEnd, cursor + share);
    words.push({ text: tokens[i], start: +start.toFixed(3), end: +Math.max(start + 0.01, end).toFixed(3) });
    cursor = end;
  }
  return words;
}
