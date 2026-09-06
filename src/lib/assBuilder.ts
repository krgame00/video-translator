import { SubtitleItem, SubtitleStyle } from './types';
import { POSITION_TO_ASS_ALIGNMENT } from './subtitleStyle';

/**
 * ASS library default PlayResY — the UI font-size scale is defined against
 * this, then scaled to the real frame (this is what makes preview == burn).
 */
export const ASS_BASE_PLAY_RES_Y = 288;

export interface AssBuildOptions {
  playResX: number;        // real video width  (e.g. 1080)
  playResY: number;        // real video height (e.g. 1920)
  style: SubtitleStyle;    // all fields optional — defaults applied below
  /** Emit {\k} word-fill tags for cues carrying `words` data. */
  karaoke?: boolean;
  /** 6-hex RGB highlight color for karaoke fill; defaults to primaryColor. */
  highlightColor?: string;
}

/**
 * Converts a 6-hex RGB color to ASS &HAABBGGRR format (BGR byte order).
 * 'FFFF00' (RGB yellow) → '&H0000FFFF' (ASS yellow). Alpha 00 = opaque.
 */
export function rgbToAssColor(rgb6: string, alphaHex = '00'): string {
  const hex = rgb6.replace(/^#/, '').toUpperCase().padStart(6, '0');
  const r = hex.slice(0, 2);
  const g = hex.slice(2, 4);
  const b = hex.slice(4, 6);
  return `&H${alphaHex}${b}${g}${r}`;
}

/** ASS timestamp: H:MM:SS.cc (1-digit hour, centiseconds). */
function formatAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const totalCs = Math.round(clamped * 100);
  const hrs = Math.floor(totalCs / 360000);
  const mins = Math.floor((totalCs % 360000) / 6000);
  const secs = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  const pad = (n: number, size = 2) => String(n).padStart(size, '0');
  return `${hrs}:${pad(mins)}:${pad(secs)}.${pad(cs)}`;
}

/** Escapes raw text for an ASS Dialogue Text field. */
function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

/** Builds one Dialogue line's Text field (karaoke \k when words are present). */
function buildDialogueText(item: SubtitleItem, karaoke: boolean): string {
  const text = (item.translatedText || '').trim();
  if (!karaoke || !Array.isArray(item.words) || item.words.length === 0) {
    return escapeAssText(text);
  }
  // \k durations are centiseconds; the fill sweeps Secondary→Primary.
  return item.words
    .map((w) => {
      const cs = Math.max(1, Math.round((w.end - w.start) * 100));
      return `{\\k${cs}}${escapeAssText(w.text)}`;
    })
    .join('');
}

/**
 * Builds a complete .ass subtitle file whose PlayRes matches the real video
 * dimensions, so libass renders fonts/positions exactly like the web preview.
 */
export function buildAss(subtitles: SubtitleItem[], opts: AssBuildOptions): string {
  const playResX = Math.max(16, Math.round(opts.playResX));
  const playResY = Math.max(16, Math.round(opts.playResY));
  const style = opts.style;

  const fontScale = playResY / ASS_BASE_PLAY_RES_Y;
  const fontsize = Math.max(8, Math.round((style.fontSize || 22) * fontScale));
  const marginV = Math.max(0, Math.round((style.marginV ?? 30) * fontScale));
  const marginLR = Math.max(0, Math.round(10 * (playResX / ASS_BASE_PLAY_RES_Y)));
  const alignment = POSITION_TO_ASS_ALIGNMENT[style.position ?? 'bottom'] ?? 2;

  const primary = rgbToAssColor(opts.highlightColor || style.primaryColor || 'FFFFFF');
  const secondary = rgbToAssColor(style.primaryColor || 'FFFFFF');
  const outline = rgbToAssColor('000000');
  // BorderStyle 1 (outline) → fully transparent box; 4 (opaque box) → 50% black
  const back = style.borderStyle === 4 ? '&H80000000' : '&HFF000000';
  const borderStyle = style.borderStyle === 4 ? 4 : 1;

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
  ].join('\r\n');

  const styles = [
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Itim,${fontsize},${primary},${secondary},${outline},${back},0,0,0,0,100,100,0,0,${borderStyle},2,0,${alignment},${marginLR},${marginLR},${marginV},1`,
  ].join('\r\n');

  const events = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...subtitles.map(
      (item) =>
        `Dialogue: 0,${formatAssTime(item.startTime)},${formatAssTime(item.endTime)},Default,,0,0,0,,${buildDialogueText(item, !!opts.karaoke)}`
    ),
  ].join('\r\n');

  return [header, styles, events].join('\r\n\r\n') + '\r\n';
}
