import * as fs from 'fs';
import * as path from 'path';

export interface SubtitleFont {
  /** Family name written into the ASS Style line and the preview font-family. */
  family: string;
  /** File name inside public/fonts that backs this family. */
  file: string;
}

const FONT_FILE_RE = /\.(ttf|otf)$/i;
const REGULAR_RE = /-Regular\.(ttf|otf)$/i;
const FAMILY_SUFFIX_RE = /-(Regular|Bold|Italic|Medium|Light|Black|Thin|SemiBold|ExtraBold|ExtraLight)$/i;

/**
 * Lists subtitle fonts available to the hardsub burn. The FFmpeg job ships the
 * whole public/fonts directory to libass via fontsdir, so every file here is
 * burnable; the family name is derived from the file name. Files of the same
 * family collapse into one entry, preferring "-Regular" for the preview.
 */
export function listSubtitleFonts(repoRoot: string = process.cwd()): SubtitleFont[] {
  const fontsDir = path.join(repoRoot, 'public', 'fonts');
  let files: string[] = [];
  try {
    files = fs.readdirSync(fontsDir).filter((f) => FONT_FILE_RE.test(f));
  } catch {
    return [];
  }

  const byFamily = new Map<string, SubtitleFont>();
  for (const file of files) {
    const stem = file.replace(FONT_FILE_RE, '');
    const family = stem.split(FAMILY_SUFFIX_RE)[0].trim() || stem;
    const existing = byFamily.get(family);
    if (!existing || REGULAR_RE.test(file)) {
      byFamily.set(family, { family, file });
    }
  }

  const fonts = [...byFamily.values()];
  // Itim first — it is the historical default and is always shipped.
  fonts.sort((a, b) => {
    if (a.family === 'Itim') return -1;
    if (b.family === 'Itim') return 1;
    return a.family.localeCompare(b.family);
  });
  return fonts;
}
