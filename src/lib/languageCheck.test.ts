import {
  hasThaiChars,
  hasJapaneseChars,
  hasKoreanChars,
  hasLanguageLeakage,
  getLanguageLeakageReason,
  sanitizeForeignNoise,
} from './languageCheck';

test('detects Thai characters correctly', () => {
  expect(hasThaiChars('สวัสดีชาวโลก')).toBe(true);
  expect(hasThaiChars('Hello world')).toBe(false);
  expect(hasThaiChars('Hello สวัสดี')).toBe(true);
});

test('detects Japanese characters correctly', () => {
  expect(hasJapaneseChars('あ')).toBe(true); // Hiragana
  expect(hasJapaneseChars('レミエル')).toBe(true); // Katakana
  expect(hasJapaneseChars('先輩')).toBe(true); // Kanji
  expect(hasJapaneseChars('สวัสดี')).toBe(false);
  expect(hasJapaneseChars('Hello')).toBe(false);
});

test('detects Korean characters correctly', () => {
  expect(hasKoreanChars('안녕하세요')).toBe(true);
  expect(hasKoreanChars('สวัสดี')).toBe(false);
});

test('detects language leakage in Thai subtitles', () => {
  // Pure Thai: no leakage
  expect(hasLanguageLeakage('สวัสดีครับทุกคน', 'th')).toBe(false);
  expect(hasLanguageLeakage('อ่า... ไม่นะ!', 'th')).toBe(false);

  // Pure numbers or symbols: no leakage
  expect(hasLanguageLeakage('100% 00:15 ...', 'th')).toBe(false);

  // Thai with allowed global acronyms: no leakage
  expect(hasLanguageLeakage('ดูวิดีโอ 4K 60 FPS บน YouTube ได้เลย (OK)', 'th')).toBe(false);
  expect(hasLanguageLeakage('เสียบสาย USB เข้ากับ PC', 'th')).toBe(false);

  // Untranslated pure English: leakage!
  expect(hasLanguageLeakage('Wait a minute!', 'th')).toBe(true);
  expect(getLanguageLeakageReason('Wait a minute!', 'th')).toBe('ยังเป็นภาษาอังกฤษ/ไม่มีภาษาไทย');

  // Thai with Japanese Katakana (e.g. character name): leakage!
  expect(hasLanguageLeakage('レミエル: ฉันเข้าใจแล้ว', 'th')).toBe(true);
  expect(getLanguageLeakageReason('レミエル: ฉันเข้าใจแล้ว', 'th')).toBe('มีตัวอักษรภาษาญี่ปุ่น (Kana/Kanji)');

  // Thai with Japanese Hiragana: leakage!
  expect(hasLanguageLeakage('อ่า... ああ', 'th')).toBe(true);

  // Thai with Kanji: leakage!
  expect(hasLanguageLeakage('รุ่นพี่ 先輩 ไปเถอะ', 'th')).toBe(true);

  // Thai with leaked Romaji or English words: leakage!
  expect(hasLanguageLeakage('Senpai ไปกันเถอะ', 'th')).toBe(true);
  expect(hasLanguageLeakage('อย่าทำนะ Yamete', 'th')).toBe(true);
  expect(hasLanguageLeakage('Remielle-sama', 'th')).toBe(true);

  // Korean leakage:
  expect(hasLanguageLeakage('สวัสดี อันยอง 안녕', 'th')).toBe(true);
  expect(getLanguageLeakageReason('สวัสดี อันยอง 안녕', 'th')).toBe('มีตัวอักษรภาษาเกาหลี (Hangul)');
});

test('sanitizes foreign noise from Thai subtitles', () => {
  // Strips Japanese kana prefix if Thai exists
  expect(sanitizeForeignNoise('レミエル: สวัสดีครับ', 'th')).toBe('สวัสดีครับ');

  // Replaces Japanese quotes
  expect(sanitizeForeignNoise('「เข้าใจแล้ว」', 'th')).toBe('"เข้าใจแล้ว"');

  // Cleans stray colon
  expect(sanitizeForeignNoise(': อ่า...', 'th')).toBe('อ่า...');
});
