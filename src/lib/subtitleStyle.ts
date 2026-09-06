export interface SubtitleStyleSettings {
  position: 'top' | 'middle' | 'bottom'; // default 'bottom'
  fontSize: number;                      // 18 | 22 | 26 (libass units)
  primaryColor: string;                  // 6-hex, no '#'
  borderStyle: 1 | 4;                    // 1 = outline, 4 = opaque box
  marginV: number;                       // px from frame edge, 10–120
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleSettings = {
  position: 'bottom',
  fontSize: 22,
  primaryColor: 'FFFFFF',
  borderStyle: 1,
  marginV: 30,
};

export const COLOR_OPTIONS = ['FFFFFF', 'FFFF00', '00FFFF', '4ADE80'];
export const FONT_SIZE_OPTIONS = [18, 22, 26];

export const POSITION_TO_ASS_ALIGNMENT: Record<SubtitleStyleSettings['position'], number> = {
  bottom: 2,
  middle: 5,
  top: 8,
}; // ASS numpad alignment

export const SUBTITLE_STYLE_STORAGE_KEY = 'video_translator_style';

/**
 * Loads subtitle style from localStorage with per-field validation and fallback to defaults.
 */
export function loadSubtitleStyle(): SubtitleStyleSettings {
  const fallback = { ...DEFAULT_SUBTITLE_STYLE };
  if (typeof localStorage === 'undefined') {
    return fallback;
  }

  try {
    const raw = localStorage.getItem(SUBTITLE_STYLE_STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;

    const result: SubtitleStyleSettings = { ...fallback };

    if (parsed.position === 'top' || parsed.position === 'middle' || parsed.position === 'bottom') {
      result.position = parsed.position;
    }

    if (typeof parsed.fontSize === 'number' && Number.isFinite(parsed.fontSize)) {
      if (FONT_SIZE_OPTIONS.includes(parsed.fontSize)) {
        result.fontSize = parsed.fontSize;
      }
    }

    if (typeof parsed.primaryColor === 'string') {
      const cleanHex = parsed.primaryColor.replace(/^#/, '').toUpperCase();
      if (/^[0-9A-F]{6}$/.test(cleanHex)) {
        result.primaryColor = cleanHex;
      }
    }

    if (parsed.borderStyle === 1 || parsed.borderStyle === 4) {
      result.borderStyle = parsed.borderStyle;
    }

    if (typeof parsed.marginV === 'number' && Number.isFinite(parsed.marginV)) {
      result.marginV = Math.min(120, Math.max(10, Math.round(parsed.marginV)));
    }

    return result;
  } catch {
    return fallback;
  }
}

/**
 * Saves subtitle style to localStorage.
 */
export function saveSubtitleStyle(s: SubtitleStyleSettings): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(SUBTITLE_STYLE_STORAGE_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('Failed to save subtitle style to localStorage:', e);
  }
}
