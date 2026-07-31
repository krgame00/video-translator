import { z } from 'zod';

const envSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  TEMP_DIR: z.string().optional(),
  FFMPEG_PATH: z.string().optional(), // Path to FFmpeg executable
  FFMPEG_HWACCEL: z.string().optional(), // e.g. "cuda", "vaapi", "qsv"
});

/**
 * Validates and parses environment variables.
 * Call this in server-side entries to ensure config is correct.
 */
export function validateEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:', result.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables.');
  }
  return result.data;
}

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
  }
};
