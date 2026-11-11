import { SubtitleItem } from './types';
import { segmentWords } from './srtFormatter';

/**
 * Binary search for the subtitle active at time t (first item whose
 * startTime <= t <= endTime). Subtitles are normally sorted by startTime;
 * falls back to a linear scan when they are not.
 */
export function findActiveSubtitle(subtitles: SubtitleItem[], t: number): SubtitleItem | undefined {
  if (subtitles.length === 0) return undefined;

  let sorted = true;
  for (let i = 1; i < subtitles.length; i++) {
    if (subtitles[i].startTime < subtitles[i - 1].startTime) {
      sorted = false;
      break;
    }
  }
  if (!sorted) {
    return subtitles.find((item) => t >= item.startTime && t <= item.endTime);
  }

  let lo = 0;
  let hi = subtitles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const item = subtitles[mid];
    if (t < item.startTime) {
      hi = mid - 1;
    } else if (t > item.endTime) {
      lo = mid + 1;
    } else {
      return item;
    }
  }
  return undefined;
}

/**
 * Filters subtitles by query string (case-insensitive) across translatedText and originalText
 */
export function searchSubtitles(subtitles: SubtitleItem[], query: string): SubtitleItem[] {
  if (!query || query.trim() === '') return subtitles;
  const q = query.toLowerCase().trim();

  return subtitles.filter(
    (item) =>
      item &&
      item.translatedText &&
      item.originalText &&
      (item.translatedText.toLowerCase().includes(q) ||
        item.originalText.toLowerCase().includes(q))
  );
}

/**
 * Replaces matching text across subtitle items. Items whose translated text
 * changed lose their karaoke word timings (stale after any text change).
 */
export function findAndReplaceSubtitles(
  subtitles: SubtitleItem[],
  findText: string,
  replaceText: string,
  targetField: 'translatedText' | 'originalText' | 'both' = 'translatedText',
  matchCase: boolean = false
): SubtitleItem[] {
  if (!findText) return subtitles;

  const flags = matchCase ? 'g' : 'gi';
  const escapedFind = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedFind, flags);

  return subtitles.map((item) => {
    if (!item) return item;
    const updated: SubtitleItem = { ...item };

    if (targetField === 'translatedText' || targetField === 'both') {
      updated.translatedText = item.translatedText ? item.translatedText.replace(regex, replaceText) : '';
    }

    if (targetField === 'originalText' || targetField === 'both') {
      updated.originalText = item.originalText ? item.originalText.replace(regex, replaceText) : '';
    }

    if (updated.translatedText !== item.translatedText) {
      updated.words = undefined;
    }

    return updated;
  });
}

/**
 * Splits a subtitle item at a specified split time (or mid point) into two adjacent items.
 * Text is split at the word boundary nearest the proportional midpoint using
 * Intl.Segmenter, so Thai text never gets cut mid-word.
 */
export function splitSubtitleItem(
  subtitles: SubtitleItem[],
  id: string,
  splitTime?: number
): SubtitleItem[] {
  const index = subtitles.findIndex((item) => item.id === id);
  if (index === -1) return subtitles;

  const item = subtitles[index];
  const midPoint = splitTime !== undefined ? splitTime : Number(((item.startTime + item.endTime) / 2).toFixed(2));

  // Cut token list at the boundary nearest the char-count midpoint.
  const splitTokens = (text: string): [string, string] => {
    const tokens = segmentWords(text);
    if (tokens.length <= 1) return [text, text];
    const total = tokens.reduce((sum, t) => sum + t.length, 0);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < tokens.length; i++) {
      acc += tokens[i].length;
      if (acc >= total / 2) {
        cut = Math.min(tokens.length - 1, Math.max(1, i + 1));
        break;
      }
    }
    return [tokens.slice(0, cut).join(''), tokens.slice(cut).join('')];
  };

  const [origHalf1, origHalf2] = splitTokens(item.originalText.trim());
  const [transHalf1, transHalf2] = splitTokens(item.translatedText.trim());

  // Old word timings are stale after a split — drop them.
  const part1: SubtitleItem = {
    ...item,
    endTime: midPoint,
    originalText: origHalf1,
    translatedText: transHalf1,
    words: undefined,
  };

  const part2: SubtitleItem = {
    id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    startTime: midPoint,
    endTime: item.endTime,
    originalText: origHalf2,
    translatedText: transHalf2,
    words: undefined,
  };

  const updated = [...subtitles];
  updated.splice(index, 1, part1, part2);
  return updated;
}

export interface SubtitleGap {
  startTime: number;
  endTime: number;
  duration: number;
}

/**
 * Finds all gaps between subtitles longer than minGapSecs (default 6s).
 * If totalDuration is provided, also checks gap before first subtitle and after last subtitle.
 */
export function findSubtitleGaps(
  subtitles: SubtitleItem[],
  minGapSecs: number = 6,
  totalDuration?: number
): SubtitleGap[] {
  if (!subtitles || subtitles.length === 0) {
    if (totalDuration && totalDuration >= minGapSecs) {
      return [{ startTime: 0, endTime: totalDuration, duration: Number(totalDuration.toFixed(3)) }];
    }
    return [];
  }

  const sorted = [...subtitles].sort((a, b) => a.startTime - b.startTime);
  const gaps: SubtitleGap[] = [];

  // Gap before first subtitle
  if (sorted[0].startTime >= minGapSecs) {
    gaps.push({
      startTime: 0,
      endTime: Number(sorted[0].startTime.toFixed(3)),
      duration: Number(sorted[0].startTime.toFixed(3)),
    });
  }

  // Gaps between consecutive subtitles
  for (let i = 0; i < sorted.length - 1; i++) {
    const curEnd = sorted[i].endTime;
    const nextStart = sorted[i + 1].startTime;
    const gap = nextStart - curEnd;
    if (gap >= minGapSecs) {
      gaps.push({
        startTime: Number(curEnd.toFixed(3)),
        endTime: Number(nextStart.toFixed(3)),
        duration: Number(gap.toFixed(3)),
      });
    }
  }

  // Gap after last subtitle
  if (totalDuration && totalDuration > sorted[sorted.length - 1].endTime) {
    const lastEnd = sorted[sorted.length - 1].endTime;
    if (totalDuration - lastEnd >= minGapSecs) {
      gaps.push({
        startTime: Number(lastEnd.toFixed(3)),
        endTime: Number(totalDuration.toFixed(3)),
        duration: Number((totalDuration - lastEnd).toFixed(3)),
      });
    }
  }

  return gaps;
}

/**
 * Finds the specific gap (if any) containing the given time.
 */
export function findGapAtTime(
  subtitles: SubtitleItem[],
  time: number,
  minGapSecs: number = 3,
  totalDuration?: number
): SubtitleGap | null {
  const gaps = findSubtitleGaps(subtitles, minGapSecs, totalDuration);
  return gaps.find((g) => time >= g.startTime && time <= g.endTime) || null;
}

function joinCueText(a: string, b: string): string {
  const left = a.trim();
  const right = b.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

/**
 * Merges a subtitle item into the NEXT one (combined text; time span from the
 * first cue's start to the second cue's end). Karaoke word timings are stale
 * after a merge — drop them. Neighbors are array-order neighbors, matching the
 * visible list. Returns the list unchanged for the last item or unknown ids.
 */
export function mergeSubtitleItem(subtitles: SubtitleItem[], id: string): SubtitleItem[] {
  const index = subtitles.findIndex((item) => item.id === id);
  if (index === -1 || index === subtitles.length - 1) return subtitles;

  const cur = subtitles[index];
  const next = subtitles[index + 1];
  const merged: SubtitleItem = {
    ...cur,
    endTime: next.endTime,
    originalText: joinCueText(cur.originalText, next.originalText),
    translatedText: joinCueText(cur.translatedText, next.translatedText),
    words: undefined,
  };

  const updated = [...subtitles];
  updated.splice(index, 2, merged);
  return updated;
}
