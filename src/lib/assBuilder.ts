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

/** Thai combining marks (vowels/tones above & below) take no horizontal space. */
const THAI_ZERO_WIDTH = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g;

/** Estimated Itim glyph advance per spacing character as a fraction of Fontsize
 *  (measured ~0.33 on burned frames; 0.42 adds a safety margin). */
const THAI_AVANCE_RATIO = 0.42;

const unitOf = (s: string) => s.replace(THAI_ZERO_WIDTH, '').length;

/**
 * Pre-wraps text into \N-ready lines at Thai/Latin word boundaries while
 * preserving every original separator (spaces, punctuation). libass cannot
 * wrap space-less Thai by itself, so without this long cues overflow the
 * frame horizontally on portrait videos.
 */
function wrapAssLines(text: string, maxUnitsPerLine: number): string[] {
  if (maxUnitsPerLine <= 0 || !text) return [text];

  let parts: string[];
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      // granularity 'word' keeps whitespace/punctuation as their own segments
      parts = Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(text))
        .map((s) => s.segment);
    } else {
      parts = text.split(/(\s+)/).filter((p) => p.length > 0);
    }
  } catch {
    parts = [text];
  }

  const lines: string[] = [];
  let cur = '';
  for (const part of parts) {
    if (/^\s+$/.test(part)) {
      if (cur) cur += part; // inner separator; dropped if it ends up trailing
      continue;
    }
    if (cur && unitOf(cur) + unitOf(part) > maxUnitsPerLine) {
      lines.push(cur.trimEnd());
      cur = part;
    } else {
      cur += part;
    }
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines.length > 0 ? lines : [text];
}

/** Builds one Dialogue line's Text field (karaoke \k when words are present). */
function buildDialogueText(
  item: SubtitleItem,
  karaoke: boolean,
  maxUnitsPerLine: number
): string {
  const text = (item.translatedText || '').trim();

  // Karaoke: group word spans into wrapped lines with the same unit budget,
  // emitting {\k} per word and \N between lines. Latin words get a trailing
  // space inside their span so spaced languages don't concatenate.
  if (karaoke && Array.isArray(item.words) && item.words.length > 0) {
    const lines: { text: string; cs: number }[][] = [];
    let cur: { text: string; cs: number }[] = [];
    let curUnits = 0;
    for (const w of item.words) {
      const u = unitOf(w.text);
      if (cur.length && curUnits + u > maxUnitsPerLine) {
        lines.push(cur);
        cur = [];
        curUnits = 0;
      }
      cur.push({ text: w.text, cs: Math.max(1, Math.round((w.end - w.start) * 100)) });
      curUnits += u;
    }
    if (cur.length) lines.push(cur);
    return lines
      .map((line) =>
        line
          .map((w) => {
            const sep = /[A-Za-z0-9]$/.test(w.text) ? ' ' : '';
            return `{\\k${w.cs}}${escapeAssText(w.text)}${sep}`;
          })
          .join('')
      )
      .join('\\N');
  }

  const wrapped = wrapAssLines(text, maxUnitsPerLine);
  return wrapped.map(escapeAssText).join('\\N');
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

  const primary = rgbToAssColor(style.primaryColor || 'FFFFFF');
  const secondary = primary;
  const outline = rgbToAssColor('000000');
  // BorderStyle 1 (outline) → fully transparent box; 4 (opaque box) → 50% black
  const back = style.borderStyle === 4 ? '&H80000000' : '&HFF000000';
  const borderStyle = style.borderStyle === 4 ? 4 : 1;

  // Karaoke style: sung words (Primary) sweep from the base text (Secondary)
  // to the highlight color. Kept as a SEPARATE style so plain cues in a mixed
  // file keep the exact text color.
  const karaokePrimary = rgbToAssColor(opts.highlightColor || style.primaryColor || 'FFFFFF');
  const karaokeStyleLine = `Style: Karaoke,Itim,${fontsize},${karaokePrimary},${secondary},${outline},${back},0,0,0,0,100,100,0,0,${borderStyle},2,0,${alignment},${marginLR},${marginLR},${marginV},1`;

  // Line-budget: spacing characters per wrapped line, from the real frame
  // width minus scaled side margins (Thai glyph ≈ 0.58 × Fontsize wide).
  const usableWidth = playResX - 2 * marginLR;
  const maxUnitsPerLine = Math.max(6, Math.floor(usableWidth / (fontsize * THAI_AVANCE_RATIO)));

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    // 0 = smart wrapping: long lines fold to 2 lines inside the margins
    // instead of overflowing the frame width (critical on portrait videos)
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
  ].join('\r\n');

  const styles = [
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Itim,${fontsize},${primary},${secondary},${outline},${back},0,0,0,0,100,100,0,0,${borderStyle},2,0,${alignment},${marginLR},${marginLR},${marginV},1`,
    karaokeStyleLine,
  ].join('\r\n');

  const events = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...subtitles.map((item) => {
      const isKaraoke = !!opts.karaoke && Array.isArray(item.words) && item.words.length > 0;
      const text = buildDialogueText(item, isKaraoke, maxUnitsPerLine);
      const styleName = isKaraoke ? 'Karaoke' : 'Default';
      return `Dialogue: 0,${formatAssTime(item.startTime)},${formatAssTime(item.endTime)},${styleName},,0,0,0,,${text}`;
    }),
  ].join('\r\n');

  return [header, styles, events].join('\r\n\r\n') + '\r\n';
}
