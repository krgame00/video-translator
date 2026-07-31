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
