/**
 * Server-side environment accessors. Values are read lazily so tests and
 * route handlers always see the current process.env.
 */
export const env = {
  get apiKeys(): string[] {
    const raw = process.env.GEMINI_API_KEY || '';
    return raw.split(',').map((k) => k.trim()).filter((k) => k.length > 0);
  },
  get tempDir(): string | undefined {
    return process.env.TEMP_DIR;
  },
  get ffmpegPath(): string | undefined {
    return process.env.FFMPEG_PATH;
  },
  get ffmpegHwaccel(): string | undefined {
    return process.env.FFMPEG_HWACCEL;
  },
  /** Required by /api/cron/clean-temp when set; unset keeps the endpoint open. */
  get cronSecret(): string | undefined {
    return process.env.CRON_SECRET;
  },
};
