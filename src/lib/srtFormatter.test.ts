import { formatTimeSRT, formatTimeVTT, generateSRT, generateVTT } from './srtFormatter';
import { SubtitleItem } from './types';

// Test formatTimeSRT
const srtTime = formatTimeSRT(72.4);
console.assert(srtTime === '00:01:12,400', `Expected 00:01:12,400 but got ${srtTime}`);

// Test formatTimeVTT
const vttTime = formatTimeVTT(72.4);
console.assert(vttTime === '00:01:12.400', `Expected 00:01:12.400 but got ${vttTime}`);

// Test generateSRT
const mockItems: SubtitleItem[] = [
  {
    id: '1',
    startTime: 1.2,
    endTime: 3.5,
    originalText: 'Hello world',
    translatedText: 'สวัสดีชาวโลก',
  },
];

const srtOutput = generateSRT(mockItems);
console.assert(srtOutput.includes('00:00:01,200 --> 00:00:03,500'), 'SRT timestamp mismatch');
console.assert(srtOutput.includes('สวัสดีชาวโลก'), 'SRT text mismatch');

// Test parseTimestampToSeconds
import { parseTimestampToSeconds } from './srtFormatter';

console.assert(parseTimestampToSeconds('00:00:01.500') === 1.5, 'Failed on 00:00:01.500');
console.assert(parseTimestampToSeconds('00:01:12.400') === 72.4, 'Failed on 00:01:12.400');
console.assert(parseTimestampToSeconds('00:15:04.100') === 904.1, 'Failed on 00:15:04.100');
console.assert(parseTimestampToSeconds('00:20:04.000') === 1204, 'Failed on 00:20:04.000');
console.assert(parseTimestampToSeconds('15:04.100') === 904.1, 'Failed on 15:04.100');
console.assert(parseTimestampToSeconds('00:01:15,500') === 75.5, 'Failed on 00:01:15,500');
console.assert(parseTimestampToSeconds(1204.5) === 1204.5, 'Failed on number 1204.5');

// Test sanitizeAndFixOverlaps
import { sanitizeAndFixOverlaps } from './srtFormatter';

const overlappingMock: SubtitleItem[] = [
  { id: '1', startTime: 1.0, endTime: 5.0, originalText: 'A', translatedText: 'A' },
  { id: '2', startTime: 3.0, endTime: 8.0, originalText: 'B', translatedText: 'B' },
  { id: '3', startTime: 7.0, endTime: 12.0, originalText: 'C', translatedText: 'C' },
];

const cleaned = sanitizeAndFixOverlaps(overlappingMock);
console.assert(cleaned[0].endTime === 2.95, `Expected 2.95 but got ${cleaned[0].endTime}`);
console.assert(cleaned[1].endTime === 6.95, `Expected 6.95 but got ${cleaned[1].endTime}`);
console.assert(cleaned[2].endTime === 12.0, `Expected 12.0 but got ${cleaned[2].endTime}`);

// Test duplicate ID handling
const duplicateIdMock: SubtitleItem[] = [
  { id: 's00047', startTime: 1.0, endTime: 3.0, originalText: 'A', translatedText: 'A' },
  { id: 's00047', startTime: 4.0, endTime: 6.0, originalText: 'B', translatedText: 'B' },
];
const deduplicated = sanitizeAndFixOverlaps(duplicateIdMock);
console.assert(deduplicated[0].id !== deduplicated[1].id, 'Failed to deduplicate IDs');

// Test long paragraph auto-splitting
import { splitLongSubtitleItem } from './srtFormatter';

const longItem: SubtitleItem = {
  id: '3',
  startTime: 186.0,
  endTime: 600.0,
  originalText: 'Long text...',
  translatedText: 'สวัสดีค่ะ ยินดีที่ได้รู้จักค่ะ? ไว้เจอกันใหม่นะ! ตั้งใจหน่อยสิ! มีอะไรโผล่ออกมาด้วย!',
};

const splitItems = splitLongSubtitleItem(longItem);
console.assert(splitItems.length > 1, `Expected multiple split items but got ${splitItems.length}`);
console.assert(splitItems[0].endTime < 600.0, 'Split item end time not adjusted');

// Test tight overlap & fallback endTime handling
const tightOverlaps: SubtitleItem[] = [
  { id: '1', startTime: 1.0, endTime: 2.0, originalText: 'A', translatedText: 'A' },
  { id: '2', startTime: 1.02, endTime: 4.0, originalText: 'B', translatedText: 'B' },
];
const cleanedTight = sanitizeAndFixOverlaps(tightOverlaps);
console.assert(cleanedTight[0].endTime <= cleanedTight[1].startTime, `Item 1 endTime (${cleanedTight[0].endTime}) should be <= Item 2 startTime (${cleanedTight[1].startTime})`);

// Test mergeChunkSubtitles offset shifting
import { mergeChunkSubtitles } from './srtFormatter';

const chunk1Subs: SubtitleItem[] = [
  { id: '1', startTime: 1.0, endTime: 3.0, originalText: 'Hello', translatedText: 'สวัสดี' },
];
const chunk2Subs: SubtitleItem[] = [
  { id: '1', startTime: 2.0, endTime: 5.0, originalText: 'World', translatedText: 'โลก' },
];

const mergedChunks = mergeChunkSubtitles([
  { chunkStartTime: 0, subtitles: chunk1Subs },
  { chunkStartTime: 300, subtitles: chunk2Subs },
]);

console.assert(mergedChunks[0].startTime === 1.0, `Expected 1.0 but got ${mergedChunks[0].startTime}`);
console.assert(mergedChunks[1].startTime === 302.0, `Expected 302.0 but got ${mergedChunks[1].startTime}`);

console.log('✅ srtFormatter unit tests passed successfully!');




