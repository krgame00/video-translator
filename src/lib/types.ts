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
