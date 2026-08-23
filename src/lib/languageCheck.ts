const THAI_CHAR_RE = /[\u0E00-\u0E7F]/;

/**
 * Returns true when the text contains at least one Thai character.
 * Used by the Language Guard fallback in the video pipeline.
 */
export function hasThaiChars(text: string): boolean {
  return THAI_CHAR_RE.test(text);
}
