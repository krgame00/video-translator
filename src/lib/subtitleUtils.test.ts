import { searchSubtitles, findAndReplaceSubtitles } from './subtitleUtils';
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

  console.log('✅ subtitleUtils unit tests passed successfully!');
}

testSubtitleUtils();
