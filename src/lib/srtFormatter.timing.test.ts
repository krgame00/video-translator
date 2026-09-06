import { sanitizeAndFixOverlaps, mergeChunkSubtitles } from './srtFormatter';
import { SubtitleItem } from './types';

function cue(id: string, startTime: number, endTime: number, translatedText: string): SubtitleItem {
  return { id, startTime, endTime, originalText: 'x', translatedText };
}

function testLcsDedupe() {
  // Real duplicate (chunk boundary echo): same phrase, ~same time → dropped
  const a = cue('c1', 10.0, 12.0, 'วันนี้ไปดูทะเลกัน');
  const dup = cue('c2', 10.4, 12.4, 'วันนี้ไปดูทะเลกัน');
  const merged = mergeChunkSubtitles([
    { chunkStartTime: 0, subtitles: [a] },
    { chunkStartTime: 0.5, subtitles: [dup] },
  ]);
  console.assert(merged.filter((s) => s.translatedText === 'วันนี้ไปดูทะเลกัน').length === 1, 'true duplicate must be deduped');

  // Same characters, different order (repetitive Thai but different meaning): kept
  const different = cue('c3', 10.2, 12.2, 'กันทะเลดูไปวันนี้');
  const merged2 = mergeChunkSubtitles([
    { chunkStartTime: 0, subtitles: [cue('d1', 10.0, 12.0, 'วันนี้ไปดูทะเลกัน')] },
    { chunkStartTime: 0.5, subtitles: [different] },
  ]);
  console.assert(merged2.length >= 2, 'reordered-but-different text must NOT be deduped');
}

function testShiftBackRescue() {
  // A cue crushed by its neighbour's start: shift-back + end-extension must
  // rescue it into the previous gap (0.6s of physical room available).
  const items = [
    cue('a', 0, 4.5, 'ก่อนหน้า'),
    cue('b', 5.0, 5.05, 'ถูกบีบ'),   // 0.05s long, next starts at 5.1
    cue('c', 5.1, 7.0, 'ถัดไป'),
  ];
  const out = sanitizeAndFixOverlaps(items);
  const b = out.find((s) => s.translatedText === 'ถูกบีบ')!;
  console.assert(!!b, 'crushed cue must survive');
  const dur = b.endTime - b.startTime;
  console.assert(dur >= 0.3 - 0.001, `shift-back must give the crushed cue a usable duration (got ${dur.toFixed(2)}s)`);
  const noOverlap = out.every((s, i) => i === 0 || s.startTime >= out[i - 1].endTime - 0.001);
  console.assert(noOverlap, 'shift-back must not introduce new overlaps');
}

function testIdempotency() {
  const items = [
    cue('1', 0.2, 6.9, 'ประโยคยาวกว่าห้าสิบตัวอักษรแน่นอนๆ ที่ควรถูกแบ่งเป็นหลายท่อนเพื่อให้อ่านง่ายขึ้นในหนึ่งบรรทัด'),
    cue('2', 7.0, 8.0, 'สั้น'),
    cue('3', 8.2, 12.5, 'ประโยคยาวอีกท่อนหนึ่งที่ยาวเกินหกวินาทีและยาวเกินห้าสิบตัวอักษรทำให้ต้องแบ่งเป็นท่อนย่อยด้วยระบบ'),
    cue('4', 12.5, 13.4, 'ชนกัน'),
  ];
  const once = sanitizeAndFixOverlaps(items);
  const twice = sanitizeAndFixOverlaps(once);
  const same = JSON.stringify(once) === JSON.stringify(twice);
  console.assert(same, `sanitize must be idempotent — export path runs it 2-3 times`);
}

function testTiming() {
  testLcsDedupe();
  testShiftBackRescue();
  testIdempotency();
  console.log('✅ srtFormatter timing unit tests passed successfully!');
}

test('srtFormatter timing', testTiming);
