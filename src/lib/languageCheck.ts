const THAI_CHAR_RE = /[\u0E00-\u0E7F]/;
const JAPANESE_KANA_RE = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\uFF65-\uFF9F]/;
const CJK_IDEOGRAPH_RE = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/;
const KOREAN_HANGUL_RE = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
const LATIN_LETTER_RE = /[A-Za-z]/;

const ALLOWED_LATIN_ACRONYMS = new Set([
  'OK', 'AI', 'TV', 'DVD', 'USB', 'VIP', 'ID', 'PC', 'DJ', 'MC', 'SNS',
  'VLOG', 'YOUTUBE', 'TIKTOK', 'FACEBOOK', 'TWITTER', 'GOOGLE', 'GPS',
  'LED', 'HD', '4K', '8K', 'FPS', 'WIFI', 'CD', 'SOS', 'FBI', 'CIA',
  'CEO', 'UFO', 'VS', 'AM', 'PM', 'APP', 'MB', 'GB', 'TB', 'RAM', 'CPU',
  'A', 'B', 'C', 'X', 'Y', 'Z'
]);

/**
 * Returns true when the text contains at least one Thai character.
 */
export function hasThaiChars(text: string): boolean {
  return THAI_CHAR_RE.test(text);
}

/**
 * Returns true if the text contains Japanese Hiragana, Katakana, or CJK Ideographs.
 */
export function hasJapaneseChars(text: string): boolean {
  return JAPANESE_KANA_RE.test(text) || CJK_IDEOGRAPH_RE.test(text);
}

/**
 * Returns true if the text contains Korean Hangul characters.
 */
export function hasKoreanChars(text: string): boolean {
  return KOREAN_HANGUL_RE.test(text);
}

/**
 * Checks whether the translated subtitle contains foreign language leakage
 * (e.g. Japanese, English, Chinese, or Korean) that does not match the target language.
 */
export function hasLanguageLeakage(text: string, targetLanguage: string = 'th'): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;

  if (targetLanguage === 'th') {
    // 1. Japanese Kana or CJK Kanji characters are never part of standard Thai subtitles
    if (JAPANESE_KANA_RE.test(trimmed) || CJK_IDEOGRAPH_RE.test(trimmed)) {
      return true;
    }

    // 2. Korean Hangul characters are never part of standard Thai subtitles
    if (KOREAN_HANGUL_RE.test(trimmed)) {
      return true;
    }

    // 3. If there are NO Thai characters at all:
    if (!THAI_CHAR_RE.test(trimmed)) {
      // If it contains Latin or other alphabet letters, it's untranslated foreign text
      if (LATIN_LETTER_RE.test(trimmed)) {
        return true;
      }
      // If it has no letters (e.g. purely numbers or punctuation like "..."), it's not leakage
      return false;
    }

    // 4. If Thai characters exist, check for leaked Latin words (names, foreign phrases, untranslated words)
    const latinWords = trimmed.match(/[A-Za-z]+/g);
    if (latinWords && latinWords.length > 0) {
      const nonAcronymWords = latinWords.filter(
        (word) => !ALLOWED_LATIN_ACRONYMS.has(word.toUpperCase())
      );

      // Any non-acronym Latin word with 3+ letters (e.g. "Senpai", "Yamete", "Remielle", "Wait")
      if (nonAcronymWords.some((w) => w.length >= 3)) {
        return true;
      }

      // Two or more Latin words in a single subtitle cue
      if (nonAcronymWords.length >= 2) {
        return true;
      }
    }

    return false;
  }

  if (targetLanguage === 'en') {
    return (
      THAI_CHAR_RE.test(trimmed) ||
      JAPANESE_KANA_RE.test(trimmed) ||
      CJK_IDEOGRAPH_RE.test(trimmed) ||
      KOREAN_HANGUL_RE.test(trimmed)
    );
  }

  if (targetLanguage === 'ja') {
    return THAI_CHAR_RE.test(trimmed) || KOREAN_HANGUL_RE.test(trimmed);
  }

  if (targetLanguage === 'zh') {
    return THAI_CHAR_RE.test(trimmed) || JAPANESE_KANA_RE.test(trimmed) || KOREAN_HANGUL_RE.test(trimmed);
  }

  if (targetLanguage === 'ko') {
    return THAI_CHAR_RE.test(trimmed) || JAPANESE_KANA_RE.test(trimmed);
  }

  return false;
}

/**
 * Returns a human-friendly description of what foreign language leaked into the text.
 */
export function getLanguageLeakageReason(text: string, targetLanguage: string = 'th'): string | null {
  const trimmed = (text || '').trim();
  if (!trimmed || !hasLanguageLeakage(trimmed, targetLanguage)) return null;

  if (targetLanguage === 'th') {
    if (JAPANESE_KANA_RE.test(trimmed) || CJK_IDEOGRAPH_RE.test(trimmed)) {
      return 'มีตัวอักษรภาษาญี่ปุ่น (Kana/Kanji)';
    }
    if (KOREAN_HANGUL_RE.test(trimmed)) {
      return 'มีตัวอักษรภาษาเกาหลี (Hangul)';
    }
    if (!THAI_CHAR_RE.test(trimmed) && LATIN_LETTER_RE.test(trimmed)) {
      return 'ยังเป็นภาษาอังกฤษ/ไม่มีภาษาไทย';
    }
    if (LATIN_LETTER_RE.test(trimmed)) {
      return 'มีคำภาษาอังกฤษหรือ Romaji ปนอยู่';
    }
  }

  return 'มีภาษาอื่นปนอยู่ในข้อความ';
}

/**
 * Sanitizes stray CJK characters or orphaned Japanese punctuation from Thai subtitles
 * when Thai characters are present in the text.
 */
export function sanitizeForeignNoise(text: string, targetLanguage: string = 'th'): string {
  let cleaned = (text || '').trim();
  if (!cleaned) return '';

  if (targetLanguage === 'th') {
    // Replace Japanese quotation marks and brackets with standard quotes
    cleaned = cleaned
      .replace(/[「」『』]/g, '"')
      .replace(/[【】]/g, ' ')
      .replace(/[・]/g, ' ');

    // If Thai characters are present, strip any stray CJK ideographs or kana prefixes/suffixes
    if (THAI_CHAR_RE.test(cleaned)) {
      cleaned = cleaned
        .replace(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]+/g, '')
        .trim();
    }

    // Clean up orphaned colons, dashes, or spaces left behind (e.g. ": สวัสดี" -> "สวัสดี")
    cleaned = cleaned
      .replace(/^[:\-\s]+/, '')
      .replace(/[:\-\s]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  return cleaned;
}
