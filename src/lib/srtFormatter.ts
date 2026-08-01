import { SubtitleItem } from './types';

/**
 * Format seconds to SRT timestamp format: HH:MM:SS,mmm
 */
export function formatTimeSRT(seconds: number): string {
  const pad = (num: number, size: number) => num.toString().padStart(size, '0');
  const totalMillis = Math.round(seconds * 1000);
  const hrs = Math.floor(totalMillis / 3600000);
  const mins = Math.floor((totalMillis % 3600000) / 60000);
  const secs = Math.floor((totalMillis % 60000) / 1000);
  const millis = totalMillis % 1000;

  return `${pad(hrs, 2)}:${pad(mins, 2)}:${pad(secs, 2)},${pad(millis, 3)}`;
}

/**
 * Format seconds to VTT timestamp format: HH:MM:SS.mmm
 */
export function formatTimeVTT(seconds: number): string {
  return formatTimeSRT(seconds).replace(',', '.');
}

/**
 * Thai (and other script) word segmentation via Intl.Segmenter (ICU dictionary).
 * Returns word tokens. Falls back to character splitting when unsupported.
 */
function segmentWords(text: string): string[] {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
      return Array.from(segmenter.segment(text))
        .map((s) => s.segment)
        .filter((w) => w.trim().length > 0);
    }
  } catch {}
  // Fallback: split on whitespace, else per-character for space-less scripts
  const spaced = text.split(/\s+/).filter((w) => w.length > 0);
  return spaced.length > 1 ? spaced : Array.from(text);
}

/**
 * Wraps text into visual lines at word boundaries (no mid-word cuts).
 * A single token longer than maxChars is hard-split (rare: URLs/numbers).
 */
function wrapByWords(text: string, maxChars: number): string[] {
  const words = segmentWords(text);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + w).length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur += w;
    }
    while (cur.length > maxChars) {
      lines.push(cur.slice(0, maxChars));
      cur = cur.slice(maxChars);
    }
  }
  if (cur) lines.push(cur);
  return lines.filter((l) => l.length > 0);
}

/**
 * Splits a single long subtitle item into multiple short subtitle items if text is long or duration > 6 seconds.
 * Uses Thai-aware word segmentation so lines never cut mid-word, and caps each cue at ~6.5s.
 */
export function splitLongSubtitleItem(item: SubtitleItem): SubtitleItem[] {
  if (!item || !item.translatedText) return [item];

  const text = item.translatedText.trim();
  const duration = item.endTime - item.startTime;

  const MAX_CUE_CHARS = 40; // ~2 visual lines of Thai text
  const MAX_CUE_DURATION = 6.5; // seconds per cue (readability standard: 2-7s)

  // If text is short (< 50 chars), has no newlines, and duration <= 6.0s, keep as-is
  if (text.length <= 50 && !text.includes('\n') && duration <= 6.0) {
    return [item];
  }

  // 1. Split text by newlines or punctuation (?, !, 。, ？, ！)
  const sentenceChunks = text
    .split(/[\r\n!?。？！]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // 2. Wrap each sentence into ≤ MAX_CUE_CHARS lines at word boundaries
  let rawChunks: string[] = [];
  for (const sentence of sentenceChunks) {
    rawChunks.push(...wrapByWords(sentence, MAX_CUE_CHARS));
  }

  // 3. Further split any cue whose allocated time would exceed the readability cap
  const totalChars = rawChunks.reduce((sum, c) => sum + c.length, 0) || 1;
  const splitAtDuration: string[] = [];
  for (const chunk of rawChunks) {
    const alloc = (chunk.length / totalChars) * duration;
    if (alloc > MAX_CUE_DURATION && chunk.length > 12) {
      splitAtDuration.push(...wrapByWords(chunk, Math.max(12, Math.floor(chunk.length / Math.ceil(alloc / MAX_CUE_DURATION)))));
    } else {
      splitAtDuration.push(chunk);
    }
  }
  rawChunks = splitAtDuration;

  // 4. Merge orphan-short cues into the previous cue to avoid fragments.
  // Threshold 5 (UTF-16 units): Thai words like "เป็น" span 4 units (เ ป ็ น).
  const merged: string[] = [];
  for (const chunk of rawChunks) {
    if (merged.length > 0 && chunk.length < 5 && (merged[merged.length - 1] + chunk).length <= 40) {
      merged[merged.length - 1] += chunk;
    } else {
      merged.push(chunk);
    }
  }
  rawChunks = merged;

  if (rawChunks.length <= 1) {
    return [item];
  }

  // 5. Distribute time proportionally to character count (longer text = more time)
  const totalDuration = Math.max(2.0, item.endTime - item.startTime);
  const finalTotalChars = rawChunks.reduce((sum, c) => sum + c.length, 0) || 1;

  const result: SubtitleItem[] = [];
  let cursor = item.startTime;
  rawChunks.forEach((chunk, idx) => {
    const chunkDur = Math.max(0.5, totalDuration * (chunk.length / finalTotalChars));
    const subStart = cursor;
    const subEnd = Math.min(item.endTime, cursor + chunkDur);

    result.push({
      id: `${item.id || 'sub'}_${idx + 1}`,
      startTime: Number(subStart.toFixed(3)),
      endTime: Number(Math.max(subStart + 0.5, subEnd).toFixed(3)),
      originalText: item.originalText || '',
      translatedText: chunk,
    });
    cursor = subEnd;
  });

  return result;
}

/**
 * Sanitize and fix overlapping subtitle time ranges so that no two subtitle items render simultaneously
 */
export function sanitizeAndFixOverlaps(items: SubtitleItem[]): SubtitleItem[] {
  if (!items || items.length === 0) return [];

  // 1. Expand long items into short sub-items
  const expanded = items.flatMap((item) => splitLongSubtitleItem(item));

  // 2. Clone, deduplicate IDs, & sort by startTime ascending
  const seenIds = new Set<string>();
  const sorted = expanded
    .map((item, index) => {
      let uniqueId = item.id || `sub_${index + 1}`;
      if (seenIds.has(uniqueId)) {
        uniqueId = `${uniqueId}_${index + 1}`;
      }
      seenIds.add(uniqueId);
      return { ...item, id: uniqueId };
    })
    .sort((a, b) => a.startTime - b.startTime);

  // 3. Adjust overlapping start/end times sequentially
  // Pass A: Ensure strictly increasing startTimes with minimum spacing (0.2s)
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].startTime = Math.max(0, Number(sorted[i].startTime.toFixed(3)));
    if (i > 0) {
      const prevStart = sorted[i - 1].startTime;
      if (sorted[i].startTime < prevStart + 0.2) {
        sorted[i].startTime = Number((prevStart + 0.2).toFixed(3));
      }
    }
  }

  // Pass B: Fix endTimes to ensure valid duration and zero overlap with next startTime
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const hasNext = i < sorted.length - 1;
    const maxAllowedEnd = hasNext
      ? Number((sorted[i + 1].startTime - 0.05).toFixed(3))
      : Infinity;

    if (current.endTime <= current.startTime) {
      current.endTime = Math.min(maxAllowedEnd, Number((current.startTime + 2.0).toFixed(3)));
    } else if (current.endTime > maxAllowedEnd) {
      current.endTime = maxAllowedEnd;
    }

    if (current.endTime <= current.startTime) {
      current.endTime = Number((current.startTime + 0.1).toFixed(3));
    }
  }

  return sorted;
}



/**
 * Generate SRT string from SubtitleItem list with UTF-8 BOM and Windows CRLF line breaks
 */
export function generateSRT(subtitles: SubtitleItem[]): string {
  const cleanSubs = sanitizeAndFixOverlaps(subtitles);
  const bom = '\uFEFF';
  const body = cleanSubs
    .map((item, index) => {
      const start = formatTimeSRT(item.startTime);
      const end = formatTimeSRT(item.endTime);
      return `${index + 1}\r\n${start} --> ${end}\r\n${item.translatedText}\r\n`;
    })
    .join('\r\n');
  return bom + body;
}

/**
 * Generate WebVTT string from SubtitleItem list
 */
export function generateVTT(subtitles: SubtitleItem[]): string {
  const cleanSubs = sanitizeAndFixOverlaps(subtitles);
  const bom = '\uFEFF';
  const header = 'WEBVTT\r\n\r\n';
  const body = cleanSubs
    .map((item, index) => {
      const start = formatTimeVTT(item.startTime);
      const end = formatTimeVTT(item.endTime);
      return `${index + 1}\r\n${start} --> ${end}\r\n${item.translatedText}\r\n`;
    })
    .join('\r\n');
  return bom + header + body;
}


/**
 * Robust timestamp parser converting HH:MM:SS.mmm, MM:SS.mmm, or seconds (string/number) into total seconds (float)
 */
export function parseTimestampToSeconds(input: string | number | undefined | null): number {
  if (input === undefined || input === null) return 0;
  if (typeof input === 'number') {
    return isNaN(input) ? 0 : input;
  }

  const str = String(input).trim();
  if (!str) return 0;

  // 1. Time string formatted with colons: "HH:MM:SS.mmm" or "MM:SS.mmm"
  if (str.includes(':')) {
    const parts = str.split(':');
    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    if (parts.length === 3) {
      hours = parseFloat(parts[0]) || 0;
      minutes = parseFloat(parts[1]) || 0;
      seconds = parseFloat(parts[2].replace(',', '.')) || 0;
    } else if (parts.length === 2) {
      minutes = parseFloat(parts[0]) || 0;
      seconds = parseFloat(parts[1].replace(',', '.')) || 0;
    } else if (parts.length === 1) {
      seconds = parseFloat(parts[0].replace(',', '.')) || 0;
    }
    return hours * 3600 + minutes * 60 + seconds;
  }

  // 2. Direct floating point / integer numeric string
  const num = parseFloat(str.replace(',', '.'));
  if (isNaN(num)) {
    throw new Error(`Invalid timestamp format: ${str}`);
  }
  return num;
}

/**
 * Chunks overlap by ~1.5s, so a word straddling a boundary can be transcribed
 * twice (once per adjacent chunk). Drop a new item when an existing one starts
 * within the overlap window AND shares most of its text.
 */
function isNearBoundaryDuplicate(prev: SubtitleItem, next: SubtitleItem): boolean {
  if (Math.abs(prev.startTime - next.startTime) > 1.6) return false;

  const normalize = (s: string) =>
    s.toLowerCase().replace(/[\s.,!?;:"'()\[\]{}《》<>「」『』]/g, '');

  const a = normalize(prev.translatedText);
  const b = normalize(next.translatedText);
  if (!a || !b || Math.min(a.length, b.length) < 4) return false;

  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;

  let common = 0;
  for (const ch of shorter) {
    if (longer.includes(ch)) common++;
  }
  return common / longer.length > 0.7;
}

/**
 * Merges subtitle results from multiple audio chunks, shifting timestamps by chunk.chunkStartTime
 */
export function mergeChunkSubtitles(
  chunkResults: { chunkStartTime: number; subtitles: SubtitleItem[] }[]
): SubtitleItem[] {
  const allItems: SubtitleItem[] = [];

  for (const chunk of chunkResults) {
    const offset = chunk.chunkStartTime || 0;
    for (const item of chunk.subtitles) {
      // Basic cleanup for Thai vowels/tone marks split by space (e.g., "กำลั ง" -> "กำลัง")
      const cleanedText = item.translatedText.replace(/([\u0E00-\u0E7F])\s+([\u0E30-\u0E4E])/g, '$1$2');
      
      allItems.push({
        ...item,
        translatedText: cleanedText,
        id: `chunk_${Math.round(offset)}_${item.id}`,
        startTime: Number((item.startTime + offset).toFixed(3)),
        endTime: Number((item.endTime + offset).toFixed(3)),
      });
    }
  }

  const deduped: SubtitleItem[] = [];
  for (const item of allItems) {
    const isDup = deduped.some((prev) => isNearBoundaryDuplicate(prev, item));
    if (!isDup) deduped.push(item);
  }

  return sanitizeAndFixOverlaps(deduped);
}

/**
 * Parses an SRT or WebVTT formatted string into an array of SubtitleItem objects
 */
export function parseSRT(srtText: string): SubtitleItem[] {
  if (!srtText) return [];

  // Remove UTF-8 BOM and normalize line endings
  const clean = srtText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = clean.split(/\n\n+/);
  const results: SubtitleItem[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].trim().split('\n');
    if (lines.length < 2) continue;

    // Find line containing timestamp arrow "-->"
    let timeLineIdx = -1;
    for (let j = 0; j < lines.length; j++) {
      if (lines[j].includes('-->')) {
        timeLineIdx = j;
        break;
      }
    }

    if (timeLineIdx === -1) continue;

    const timeLine = lines[timeLineIdx];
    const [startStr, endStr] = timeLine.split('-->').map((s) => s.trim());

    const startTime = parseTimestampToSeconds(startStr);
    const endTime = parseTimestampToSeconds(endStr);
    const textLines = lines.slice(timeLineIdx + 1).map((s) => s.trim()).filter((s) => s.length > 0);
    const text = textLines.join('\n');

    if (text) {
      results.push({
        id: `srt_${results.length + 1}`,
        startTime: Math.max(0, Number(startTime.toFixed(3))),
        endTime: Math.max(startTime + 0.5, Number(endTime.toFixed(3))),
        originalText: text,
        translatedText: text,
      });
    }
  }

  return results;
}

