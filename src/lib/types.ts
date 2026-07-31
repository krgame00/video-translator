export interface SubtitleItem {
  id: string;
  startTime: number;      // Start time in seconds (e.g. 1.50)
  endTime: number;        // End time in seconds (e.g. 4.20)
  originalText: string;   // Transcribed original text
  translatedText: string; // Translated text (Thai)
}

export interface VideoTranslationResponse {
  success: boolean;
  subtitles?: SubtitleItem[];
  error?: string;
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
  status: 'uploading' | 'encoding' | 'completed' | 'failed';
  progress: number;
  error?: string;
  inPath: string;
  srtPath: string;
  outPath: string;
  createdAt: number;
  style?: SubtitleStyle;
}

export interface AudioChunk {
  index: number;
  buffer: Buffer;
  startTime: number;
  endTime: number;
}

export interface HardsubPrepareResponse {
  success: boolean;
  jobId?: string;
  error?: string;
}

export interface HardsubStatusResponse {
  success: boolean;
  status?: ExportJob['status'];
  progress?: number;
  error?: string;
}

export interface RefineSubtitlesRequest {
  subtitles: SubtitleItem[];
  targetLanguage?: string;
}

export interface TranslateSRTRequest {
  srtContent: string;
  targetLanguage?: string;
}
