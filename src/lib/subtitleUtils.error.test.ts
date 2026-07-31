import { searchSubtitles, findAndReplaceSubtitles } from './subtitleUtils';
import { SubtitleItem } from './types';

function testErrorHandling() {
  const mockSubtitles: SubtitleItem[] = [
    { id: '1', startTime: 1.0, endTime: 3.0, originalText: 'Hello World', translatedText: 'สวัสดี ชาวโลก' },
    { id: '2', startTime: 4.0, endTime: 6.0, originalText: 'Welcome World', translatedText: 'ยินดีต้อนรับ ชาวโลก' },
    { id: '3', startTime: 7.0, endTime: 9.0, originalText: 'Good morning', translatedText: 'อรุณสวัสดิ์' },
  ];

  // Test searchSubtitles with empty array
  const emptySearch = searchSubtitles([], 'test');
  console.assert(Array.isArray(emptySearch) && emptySearch.length === 0, 'Empty array search should return empty array');

  // Test searchSubtitles with empty query
  const emptyQuerySearch = searchSubtitles(mockSubtitles, '');
  console.assert(emptyQuerySearch.length === mockSubtitles.length, 'Empty query should return all items');

  // Test searchSubtitles with special characters
  const specialCharSearch = searchSubtitles(mockSubtitles, '[\\^$');
  console.assert(Array.isArray(specialCharSearch), 'Special characters should not throw');

  // Test searchSubtitles with null/undefined items (defensive)
  const withNull = [...mockSubtitles, null as any];
  const nullSearch = searchSubtitles(withNull, 'test');
  console.assert(Array.isArray(nullSearch), 'Should handle null items gracefully');

  // Test findAndReplaceSubtitles with empty array
  const emptyReplace = findAndReplaceSubtitles([], 'find', 'replace', 'translatedText', false);
  console.assert(Array.isArray(emptyReplace) && emptyReplace.length === 0, 'Empty array replace should return empty array');

  // Test findAndReplaceSubtitles with empty find string
  const emptyFindReplace = findAndReplaceSubtitles(mockSubtitles, '', 'replace', 'translatedText', false);
  console.assert(emptyFindReplace.length === mockSubtitles.length, 'Empty find should not modify array');
  console.assert(emptyFindReplace[0].translatedText === mockSubtitles[0].translatedText, 'Items should be unchanged with empty find');

  // Test findAndReplaceSubtitles with non-existent field
  const invalidFieldReplace = findAndReplaceSubtitles(mockSubtitles, 'test', 'replace', 'invalidField' as any, false);
  console.assert(invalidFieldReplace.length === mockSubtitles.length, 'Invalid field should return original array');

  // Test findAndReplaceSubtitles with items missing the target field
  const itemsMissingField = [...mockSubtitles, { id: '4', startTime: 10, endTime: 12, originalText: 'Test', translatedText: '' }];
  // @ts-ignore - deliberately removing translatedText
  delete itemsMissingField[3].translatedText;
  const missingFieldReplace = findAndReplaceSubtitles(itemsMissingField as SubtitleItem[], 'test', 'replace', 'translatedText', false);
  console.assert(missingFieldReplace.length === 4, 'Should handle missing fields gracefully');

  // Test findAndReplaceSubtitles case sensitivity
  const caseSensitiveReplace = findAndReplaceSubtitles(mockSubtitles, 'WORLD', 'UNIVERSE', 'originalText', true);
  console.assert(caseSensitiveReplace[0].originalText === 'Hello World', 'Case sensitive should not match lowercase');
  console.assert(caseSensitiveReplace[1].originalText === 'Welcome World', 'Case sensitive should not match lowercase');

  const caseInsensitiveReplace = findAndReplaceSubtitles(mockSubtitles, 'world', 'UNIVERSE', 'originalText', false);
  console.assert(caseInsensitiveReplace[0].originalText === 'Hello UNIVERSE', 'Case insensitive should match');
  console.assert(caseInsensitiveReplace[1].originalText === 'Welcome UNIVERSE', 'Case insensitive should match');

  console.log('✅ subtitleUtils error handling tests passed successfully!');
}

testErrorHandling();