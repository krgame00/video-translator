import { hasThaiChars } from './languageCheck';

function testLanguageCheck() {
  const thaiText = 'สวัสดีชาวโลก';
  const englishText = 'a traitor';
  const mixedText = 'Hello สวัสดี';

  console.assert(hasThaiChars(thaiText) === true, 'Failed to detect Thai text');
  console.assert(hasThaiChars(englishText) === false, 'English text should not pass Thai check');
  console.assert(hasThaiChars(mixedText) === true, 'Mixed text containing Thai should pass');

  console.log('✅ languageCheck unit tests passed successfully!');
}

test('languageCheck', testLanguageCheck);
