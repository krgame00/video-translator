import { SubtitleItem } from './types';

/**
 * Format seconds to SRT timestamp format: HH:MM:SS,mmm
 */
export function formatTimeSRT(seconds: number): string {
  const pad = (num: number, size: number) => num.toString().padStart(size, '0');
  const totalMillis = Math.round(seconds * 1000);
  const hrs = Math.floor(totalMillis / 3600000);
  const mins = Math.floor((totalMillis % 3600000) / 60000);
  const secs = Math.floor((totalMillis % 60000) / 1000);
  const millis = totalMillis % 1000;

  return `${pad(hrs, 2)}:${pad(mins, 2)}:${pad(secs, 2)},${pad(millis, 3)}`;
}

/**
 * Format seconds to VTT timestamp format: HH:MM:SS.mmm
 */
export function formatTimeVTT(seconds: number): string {
  return formatTimeSRT(seconds).replace(',', '.');
}

/**
 * Generate SRT string from SubtitleItem list
 */
export function generateSRT(subtitles: SubtitleItem[]): string {
  return subtitles
    .map((item, index) => {
      const start = formatTimeSRT(item.startTime);
      const end = formatTimeSRT(item.endTime);
      return `${index + 1}\n${start} --> ${end}\n${item.translatedText}\n`;
    })
    .join('\n');
}

/**
 * Generate WebVTT string from SubtitleItem list
 */
export function generateVTT(subtitles: SubtitleItem[]): string {
  const header = 'WEBVTT\n\n';
  const body = subtitles
    .map((item, index) => {
      const start = formatTimeVTT(item.startTime);
      const end = formatTimeVTT(item.endTime);
      return `${index + 1}\n${start} --> ${end}\n${item.translatedText}\n`;
    })
    .join('\n');
  return header + body;
}
