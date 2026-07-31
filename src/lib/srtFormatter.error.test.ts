import { parseTimestampToSeconds, sanitizeAndFixOverlaps, splitLongSubtitleItem, mergeChunkSubtitles } from './srtFormatter';
import { SubtitleItem } from './types';

function testErrorHandling() {
  // Test parseTimestampToSeconds with invalid inputs - should throw
  try {
    const result = parseTimestampToSeconds('invalid-format');
    console.assert(false, 'Should throw on invalid format');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.assert(msg.includes('Invalid timestamp format'), `Expected error message for invalid format, got: ${msg}`);
  }

  try {
    const result = parseTimestampToSeconds('');
    console.assert(false, 'Should throw on empty string');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.assert(msg.includes('Invalid timestamp format'), `Expected error message for empty string, got: ${msg}`);
  }

  try {
    const result = parseTimestampToSeconds('not-a-timestamp');
    console.assert(false, 'Should throw on non-timestamp');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.assert(msg.includes('Invalid timestamp format'), `Expected error message for non-timestamp, got: ${msg}`);
  }

  // Test sanitizeAndFixOverlaps with empty array
  const emptyResult = sanitizeAndFixOverlaps([]);
  console.assert(Array.isArray(emptyResult) && emptyResult.length === 0, 'Empty array should return empty array');

  // Test sanitizeAndFixOverlaps with single item
  const singleItem: SubtitleItem[] = [
    { id: '1', startTime: 1.0, endTime: 3.0, originalText: 'A', translatedText: 'A' }
  ];
  const singleResult = sanitizeAndFixOverlaps(singleItem);
  console.assert(singleResult.length === 1, 'Single item should return single item');
  console.assert(singleResult[0].id === '1', 'Single item ID should be preserved');

  // Test sanitizeAndFixOverlaps with negative times
  const negativeTimeItems: SubtitleItem[] = [
    { id: '1', startTime: -1.0, endTime: 3.0, originalText: 'A', translatedText: 'A' },
    { id: '2', startTime: 4.0, endTime: 6.0, originalText: 'B', translatedText: 'B' }
  ];
  const negativeResult = sanitizeAndFixOverlaps(negativeTimeItems);
  console.assert(negativeResult[0].startTime >= 0, 'Negative start time should be clamped to 0');

  // Test sanitizeAndFixOverlaps with reversed times (end < start)
  const reversedTimeItems: SubtitleItem[] = [
    { id: '1', startTime: 5.0, endTime: 3.0, originalText: 'A', translatedText: 'A' },
    { id: '2', startTime: 7.0, endTime: 9.0, originalText: 'B', translatedText: 'B' }
  ];
  const reversedResult = sanitizeAndFixOverlaps(reversedTimeItems);
  console.assert(reversedResult[0].endTime > reversedResult[0].startTime, 'Reversed times should be corrected');
  // Note: The function fixes reversed times by setting endTime to startTime + 2.0 (capped by next item start)
  // But due to next item start at 7.0, maxAllowedEnd is 6.95, so endTime becomes 6.95

  // Test splitLongSubtitleItem with short text (should not split)
  const shortItem: SubtitleItem = {
    id: '1',
    startTime: 10.0,
    endTime: 15.0,
    originalText: 'Short',
    translatedText: 'สั้น'
  };
  const shortSplit = splitLongSubtitleItem(shortItem);
  console.assert(shortSplit.length === 1, 'Short text should not be split');
  console.assert(shortSplit[0].id === '1', 'Original ID preserved for non-split');

  // Test splitLongSubtitleItem with empty text
  const emptyTextItem: SubtitleItem = {
    id: '1',
    startTime: 10.0,
    endTime: 15.0,
    originalText: '',
    translatedText: ''
  };
  const emptySplit = splitLongSubtitleItem(emptyTextItem);
  console.assert(emptySplit.length >= 1, 'Empty text should still return at least one item');

  // Test mergeChunkSubtitles with empty chunks
  const emptyMerge = mergeChunkSubtitles([]);
  console.assert(Array.isArray(emptyMerge) && emptyMerge.length === 0, 'Empty chunks array should return empty array');

  // Test mergeChunkSubtitles with empty subtitle arrays
  const emptySubsMerge = mergeChunkSubtitles([
    { chunkStartTime: 0, subtitles: [] },
    { chunkStartTime: 300, subtitles: [] }
  ]);
  console.assert(emptySubsMerge.length === 0, 'Empty subtitle arrays should return empty array');

  // Test mergeChunkSubtitles with invalid chunkStartTime
  const invalidChunkMerge = mergeChunkSubtitles([
    { chunkStartTime: NaN, subtitles: [{ id: '1', startTime: 1.0, endTime: 3.0, originalText: 'A', translatedText: 'A' }] }
  ]);
  console.assert(isNaN(invalidChunkMerge[0]?.startTime) || invalidChunkMerge[0]?.startTime === 1.0, 'NaN chunkStartTime should not break merge');

  console.log('✅ srtFormatter error handling tests passed successfully!');
}

testErrorHandling();