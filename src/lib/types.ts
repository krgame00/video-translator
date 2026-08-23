export interface SubtitleItem {
  id: string;
  startTime: number;      // Start time in seconds (e.g. 1.50)
  endTime: number;        // End time in seconds (e.g. 4.20)
  originalText: string;   // Transcribed original text
  translatedText: string; // Translated text (Thai)
}

export interface SubtitleStyle {
  fontName?: string;
  fontSize?: number;
  primaryColor?: string; // Hex color string without '#'
  outlineColor?: string; // Hex color string without '#'
  backColor?: string;    // Hex color string without '#' (with optional alpha)
  borderStyle?: number;  // 1=Outline+DropShadow, 3=OpaqueBox (standard SRT style 4 in ASS)
  marginV?: number;
}

export interface ExportJob {
  id: string;
  status: 'uploading' | 'encoding' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  error?: string;
  inPath: string;
  srtPath: string;
  outPath: string;
  createdAt: number;
  style?: SubtitleStyle;
  /** Media duration in seconds (optional, enables real encode progress). */
  duration?: number;
}
