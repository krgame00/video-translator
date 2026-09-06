export interface SubtitleItem {
  id: string;
  startTime: number;      // Start time in seconds (e.g. 1.50)
  endTime: number;        // End time in seconds (e.g. 4.20)
  originalText: string;   // Transcribed original text
  translatedText: string; // Translated text (Thai)
  words?: { text: string; start: number; end: number }[]; // karaoke word timing (optional)
}

export interface SubtitleStyle {
  fontName?: string;
  fontSize?: number;
  primaryColor?: string; // Hex color string without '#'
  outlineColor?: string; // Hex color string without '#'
  backColor?: string;    // Hex color string without '#' (with optional alpha)
  borderStyle?: number;  // 1=Outline+DropShadow, 4=OpaqueBox (standard SRT style 4 in ASS)
  marginV?: number;
  position?: 'top' | 'middle' | 'bottom';
}

export interface ExportJob {
  id: string;
  status: 'uploading' | 'encoding' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  error?: string;
  inPath: string;
  /** Path of the generated subtitle file (.ass) used for burning. */
  subPath: string;
  outPath: string;
  createdAt: number;
  style?: SubtitleStyle;
  /** Media duration in seconds (optional, enables real encode progress). */
  duration?: number;
  /** Real video dimensions — the ASS PlayRes must match them for WYSIWYG. */
  playResX?: number;
  playResY?: number;
  /** Burn {\k} word-fill karaoke tags for cues carrying `words`. */
  karaoke?: boolean;
  /** 6-hex RGB karaoke fill color (defaults to style.primaryColor). */
  highlightColor?: string;
}
