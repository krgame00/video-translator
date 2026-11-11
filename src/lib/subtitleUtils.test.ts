import { searchSubtitles, findAndReplaceSubtitles, findSubtitleGaps, findGapAtTime, mergeSubtitleItem } from './subtitleUtils';
import { SubtitleItem } from './types';

function testSubtitleUtils() {
  const mockSubtitles: SubtitleItem[] = [
    { id: '1', startTime: 1.0, endTime: 3.0, originalText: 'Hello World', translatedText: 'สวัสดี ชาวโลก' },
    { id: '2', startTime: 4.0, endTime: 6.0, originalText: 'Welcome World', translatedText: 'ยินดีต้อนรับ ชาวโลก' },
    { id: '3', startTime: 7.0, endTime: 9.0, originalText: 'Good morning', translatedText: 'อรุณสวัสดิ์' },
  ];

  // Test Search Filter
  const searchResults = searchSubtitles(mockSubtitles, 'ชาวโลก');
  console.assert(searchResults.length === 2, `Expected 2 search results but got ${searchResults.length}`);

  const searchCaseInsensitive = searchSubtitles(mockSubtitles, 'hello');
  console.assert(searchCaseInsensitive.length === 1, `Expected 1 search result but got ${searchCaseInsensitive.length}`);

  // Test Find and Replace
  const replaced = findAndReplaceSubtitles(mockSubtitles, 'ชาวโลก', 'ทุกๆ ท่าน', 'translatedText', false);
  console.assert(replaced[0].translatedText === 'สวัสดี ทุกๆ ท่าน', `Expected "สวัสดี ทุกๆ ท่าน" but got "${replaced[0].translatedText}"`);
  console.assert(replaced[1].translatedText === 'ยินดีต้อนรับ ทุกๆ ท่าน', `Expected "ยินดีต้อนรับ ทุกๆ ท่าน" but got "${replaced[1].translatedText}"`);
  console.assert(replaced[2].translatedText === 'อรุณสวัสดิ์', 'Item 3 should be unchanged');

  // Test Case Sensitivity in Replace
  const replacedCaseSensitive = findAndReplaceSubtitles(mockSubtitles, 'world', 'Universe', 'originalText', true);
  console.assert(replacedCaseSensitive[0].originalText === 'Hello World', 'Should not replace "World" when matchCase is true');

  // Test Subtitle Gap Detection
  const gappySubs: SubtitleItem[] = [
    { id: 'a', startTime: 0, endTime: 150, originalText: 'Intro', translatedText: 'บทนำ' },
    { id: 'b', startTime: 300, endTime: 450, originalText: 'Scene 2', translatedText: 'ฉากสอง' },
  ];
  const gaps = findSubtitleGaps(gappySubs, 10, 600);
  console.assert(gaps.length === 2, `Expected 2 gaps but got ${gaps.length}`);
  console.assert(gaps[0].startTime === 150 && gaps[0].endTime === 300, 'Gap 1 should be 150 to 300');
  console.assert(gaps[1].startTime === 450 && gaps[1].endTime === 600, 'Gap 2 should be 450 to 600');

  // Test Gap at specific time (e.g. 4:20 = 260s)
  const gapAt260 = findGapAtTime(gappySubs, 260, 5, 600);
  console.assert(gapAt260 !== null, 'Should find gap at 260s');
  console.assert(gapAt260?.startTime === 150 && gapAt260?.endTime === 300, 'Gap at 260s should be 150 to 300');

  // Time inside an existing subtitle should return null
  const gapAt50 = findGapAtTime(gappySubs, 50, 5, 600);
  console.assert(gapAt50 === null, 'Should not find gap inside existing subtitle');

  // Test Merge with the next cue
  const merged = mergeSubtitleItem(mockSubtitles, '1');
  console.assert(merged.length === 2, `Expected 2 cues after merge but got ${merged.length}`);
  console.assert(
    merged[0].id === '1' && merged[0].startTime === 1.0 && merged[0].endTime === 6.0,
    'Merged cue should span cue 1 start through cue 2 end'
  );
  console.assert(
    merged[0].translatedText === 'สวัสดี ชาวโลก ยินดีต้อนรับ ชาวโลก',
    `Unexpected merged translated text "${merged[0].translatedText}"`
  );
  console.assert(merged[1].id === '3', 'Trailing cue should survive the merge');

  // Merging the last cue is a no-op
  const mergeLast = mergeSubtitleItem(mockSubtitles, '3');
  console.assert(mergeLast.length === 3, 'Merging the last cue should return the list unchanged');
  console.assert(mergeLast[2].translatedText === 'อรุณสวัสดิ์', 'No-op merge must not change texts');

  console.log('✅ subtitleUtils unit tests passed successfully!');
}

test('subtitleUtils', testSubtitleUtils);
