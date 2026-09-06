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

// (mergeSubtitleItem removed — unwired; recover from git history if a merge
// button is ever added alongside the split button.)
