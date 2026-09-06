import { splitSubtitleItem } from './subtitleUtils';
import { SubtitleItem } from './types';

function cue(id: string, translatedText: string, startTime = 0, endTime = 10): SubtitleItem {
  return { id, startTime, endTime, originalText: 'original text here', translatedText };
}

function testThaiSplitNeverCutsMidWord() {
  const text = 'ประโยคยาวสำหรับทดสอบการแบ่งซับไทยต้องไม่ตัดกลางคำเด็ดขาด';
  const out = splitSubtitleItem([cue('a', text)], 'a');

  console.assert(out.length === 2, `split must produce two cues (got ${out.length})`);
  // Both halves must be composed of whole tokens: concatenation reproduces
  // the original string exactly (no inserted/lost characters).
  console.assert(
    out[0].translatedText + out[1].translatedText === text,
    `token halves must concatenate to the original (got "${out[0].translatedText}" + "${out[1].translatedText}")`
  );
  console.assert(out[0].translatedText.length > 0 && out[1].translatedText.length > 0, 'both halves non-empty');
}

function testSplitBoundsAndIds() {
  const out = splitSubtitleItem([cue('a', 'สวัสดีชาวโลกทั้งหลาย', 2, 8)], 'a');
  console.assert(out[0].startTime === 2 && out[0].endTime === 5, 'first half spans [start, midpoint]');
  console.assert(out[1].startTime === 5 && out[1].endTime === 8, 'second half spans [midpoint, end]');
  console.assert(out[0].id === 'a', 'first half keeps the original id');
  console.assert(out[1].id !== 'a' && out[1].id.length > 0, 'second half gets a fresh unique id');
}

function testSplitDropsStaleWords() {
  const withWords = cue('a', 'คำแรกคำที่สองคำสุดท้าย', 0, 6);
  withWords.words = [
    { text: 'คำแรก', start: 0, end: 2 },
    { text: 'คำที่สอง', start: 2, end: 4 },
    { text: 'คำสุดท้าย', start: 4, end: 6 },
  ];
  const out = splitSubtitleItem([withWords], 'a');
  console.assert(out.every((s) => s.words === undefined), 'split children must drop stale word timings');
}

function testSplitExplicitTimeAndUntouchedOthers() {
  const other = cue('b', 'ไม่เกี่ยว', 0, 5);
  const out = splitSubtitleItem([cue('a', 'หนึ่งสองสามสี่ห้าหกเจ็ดแปด', 0, 10), other], 'a', 4);
  console.assert(out.length === 3, 'other cues untouched, split adds one');
  console.assert(out.find((s) => s.id === 'b')?.endTime === 5, 'other cue intact');
  console.assert(out[0].endTime === 4 && out[1].startTime === 4, 'explicit splitTime honoured');
}

function testSplit() {
  testThaiSplitNeverCutsMidWord();
  testSplitBoundsAndIds();
  testSplitDropsStaleWords();
  testSplitExplicitTimeAndUntouchedOthers();
  console.log('✅ subtitleUtils split unit tests passed successfully!');
}

test('subtitleUtils split', testSplit);
