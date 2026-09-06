import { validateWordTimings, interpolateWords, distributeWordsByChars, type WordTiming } from './wordTiming';

function words(list: [number, number][]): WordTiming[] {
  return list.map(([start, end], i) => ({ text: `w${i}`, start, end }));
}

function testValidate() {
  console.assert(validateWordTimings(words([[0, 1], [1, 2]]), 0, 2) === true, 'valid sequence passes');
  console.assert(validateWordTimings([], 0, 2) === false, 'empty must fail');
  console.assert(validateWordTimings(words([[0, 1], [0.5, 2]]), 0, 2) === false, 'overlapping words must fail');
  console.assert(validateWordTimings(words([[0, 1], [1, 2], [2.5, 3]]), 0, 2) === false, 'word beyond cue end must fail');
  console.assert(validateWordTimings(words([[0, 1], [1, 0.5]]), 0, 2) === false, 'end <= start must fail');
  console.assert(validateWordTimings([{ text: '   ', start: 0, end: 1 }], 0, 2) === false, 'blank text must fail');
}

function testInterpolate() {
  // Sequence spanning [10, 12] stretched onto [0, 2] — ratios preserved
  const out = interpolateWords(words([[10, 10.5], [10.5, 11], [11, 12]]), 0, 2);
  console.assert(out.length === 3, 'interpolate keeps word count');
  console.assert(out[0].start === 0, 'interpolated sequence must start at cue start');
  console.assert(out[2].end === 2, 'interpolated sequence must end at cue end');
  console.assert(out[1].start === 0.5, 'midpoint maps proportionally (10.5 → 0.5)');
  const sorted = out.every((w, i) => i === 0 || w.start >= out[i - 1].end);
  console.assert(sorted, 'interpolated words stay chronological');
}

function testDistribute() {
  const text = 'สวัสดีชาวโลกและยินดีต้อนรับ';
  const out = distributeWordsByChars(text, 5, 9);

  console.assert(out.length > 1, 'Thai text must segment into multiple words');
  console.assert(out[0].start === 5, 'distribution must start at cue start');
  console.assert(out[out.length - 1].end === 9, 'distribution must end at cue end');
  const joined = out.map((w) => w.text).join('');
  console.assert(joined === text, `Thai tokens must reproduce the original text with no mid-word cuts (got "${joined}")`);
  const chronological = out.every((w, i) => i === 0 || w.start >= out[i - 1].end);
  console.assert(chronological, 'distributed words stay chronological');

  console.assert(distributeWordsByChars('', 0, 2).length === 0, 'empty text yields no words');
}

function testWordTiming() {
  testValidate();
  testInterpolate();
  testDistribute();
  console.log('✅ wordTiming unit tests passed successfully!');
}

test('wordTiming', testWordTiming);
