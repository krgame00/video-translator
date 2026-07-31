import { SubtitleItem } from './types';

function hasThaiCharacters(text: string): boolean {
  return /[\u0E00-\u0E7F]/.test(text);
}

function testLanguageCheck() {
  const thaiText = 'สวัสดีชาวโลก';
  const englishText = 'a traitor';
  const mixedText = 'Hello สวัสดี';

  console.assert(hasThaiCharacters(thaiText) === true, 'Failed to detect Thai text');
  console.assert(hasThaiCharacters(englishText) === false, 'English text should not pass Thai check');
  console.assert(hasThaiCharacters(mixedText) === true, 'Mixed text containing Thai should pass');

  console.log('✅ languageCheck unit tests passed successfully!');
}

testLanguageCheck();
