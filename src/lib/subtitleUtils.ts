import { SubtitleItem } from './types';

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
 * Replaces matching text across subtitle array items
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
    const updated = { ...item };

    if (targetField === 'translatedText' || targetField === 'both') {
      updated.translatedText = item.translatedText ? item.translatedText.replace(regex, replaceText) : '';
    }

    if (targetField === 'originalText' || targetField === 'both') {
      updated.originalText = item.originalText ? item.originalText.replace(regex, replaceText) : '';
    }

    return updated;
  });
}

/**
 * Splits a subtitle item at a specified split time (or mid point) into two adjacent items
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

  // Split original and translated text by spaces
  const origWords = item.originalText.trim().split(/\s+/);
  const transWords = item.translatedText.trim().split(/\s+/);

  const origCut = Math.max(1, Math.ceil(origWords.length / 2));
  const transCut = Math.max(1, Math.ceil(transWords.length / 2));

  const origHalf1 = origWords.slice(0, origCut).join(' ');
  const origHalf2 = origWords.slice(origCut).join(' ') || origHalf1;

  const transHalf1 = transWords.slice(0, transCut).join(' ');
  const transHalf2 = transWords.slice(transCut).join(' ') || transHalf1;

  const part1: SubtitleItem = {
    ...item,
    endTime: midPoint,
    originalText: origHalf1,
    translatedText: transHalf1,
  };

  const part2: SubtitleItem = {
    id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    startTime: midPoint,
    endTime: item.endTime,
    originalText: origHalf2,
    translatedText: transHalf2,
  };

  const updated = [...subtitles];
  updated.splice(index, 1, part1, part2);
  return updated;
}

/**
 * Merges a subtitle item with the next adjacent subtitle item
 */
export function mergeSubtitleItem(
  subtitles: SubtitleItem[],
  id: string
): SubtitleItem[] {
  const index = subtitles.findIndex((item) => item.id === id);
  if (index === -1 || index >= subtitles.length - 1) return subtitles;

  const current = subtitles[index];
  const next = subtitles[index + 1];

  const merged: SubtitleItem = {
    id: current.id,
    startTime: current.startTime,
    endTime: next.endTime,
    originalText: `${current.originalText} ${next.originalText}`.trim(),
    translatedText: `${current.translatedText} ${next.translatedText}`.trim(),
  };

  const updated = [...subtitles];
  updated.splice(index, 2, merged);
  return updated;
}
