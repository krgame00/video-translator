import { z } from 'zod';
import * as fs from 'fs';

/** Default cap for a single upload when MAX_UPLOAD_BYTES is unset (1 GB). */
export const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

/** Default per-job FFmpeg kill timeout when FFMPEG_TIMEOUT_MS is unset (4 min). */
export const DEFAULT_FFMPEG_TIMEOUT_MS = 4 * 60 * 1000;

/** Hard ceiling: refuses absurd MAX_UPLOAD_BYTES overrides (> 20 GB) instead of OOMing the box. */
const MAX_UPLOAD_BYTES_CEILING = 20 * 1024 * 1024 * 1024;
/** Ceiling: refuses absurd FFMPEG_TIMEOUT_MS overrides (> 30 min) so one job can't pin the single encoder slot forever. */
const FFMPEG_TIMEOUT_MS_CEILING = 30 * 60 * 1000;

const emptyToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const envSchema = z.object({
  GEMINI_API_KEY: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .min(1, 'GEMINI_API_KEY is required (comma-separated for key rotation)')
      .refine((raw) => raw.split(',').some((k) => k.trim().length > 0), {
        message: 'GEMINI_API_KEY must contain at least one non-empty key',
      }),
  ),
  TEMP_DIR: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .refine((dir) => !dir || fs.existsSync(dir), {
        message: 'TEMP_DIR points to a path that does not exist',
      }),
  ),
  MAX_UPLOAD_BYTES: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number()
      .int('MAX_UPLOAD_BYTES must be an integer number of bytes')
      .positive('MAX_UPLOAD_BYTES must be positive')
      .max(MAX_UPLOAD_BYTES_CEILING, 'MAX_UPLOAD_BYTES exceeds the 20 GB ceiling')
      .optional()
      .default(DEFAULT_MAX_UPLOAD_BYTES),
  ),
  FFMPEG_PATH: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(512).optional()),
  FFMPEG_HWACCEL: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(32).optional()),
  FFMPEG_TIMEOUT_MS: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number()
      .int('FFMPEG_TIMEOUT_MS must be an integer number of milliseconds')
      .positive('FFMPEG_TIMEOUT_MS must be positive')
      .max(FFMPEG_TIMEOUT_MS_CEILING, 'FFMPEG_TIMEOUT_MS exceeds the 30-minute ceiling')
      .optional()
      .default(DEFAULT_FFMPEG_TIMEOUT_MS),
  ),
  CRON_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).max(256).optional()),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validates process.env against the schema and throws a single readable
 * error listing every problem. Called once at server boot (see
 * src/instrumentation.ts) so misconfiguration fails fast instead of
 * surfacing as a cryptic 500 on the first request.
 */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): EnvConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

/**
 * Server-side environment accessors. Values are read lazily so tests and
 * route handlers always see the current process.env. Boot-time validation
 * (validateEnv) guarantees the required keys exist in production.
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
  /**
   * Lazy read (never a module-level const) so tests and runtime env changes
   * are honored. Falls back to 1 GB on missing/invalid values; boot
   * validation rejects invalid values outright in production.
   */
  get maxUploadBytes(): number {
    const raw = process.env.MAX_UPLOAD_BYTES;
    if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_UPLOAD_BYTES;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_UPLOAD_BYTES;
    return Math.min(parsed, MAX_UPLOAD_BYTES_CEILING);
  },
  /**
   * Lazy read (never a module-level const) so tests and runtime env changes
   * are honored. Falls back to 4 min on missing/invalid values; boot
   * validation rejects invalid values outright in production.
   */
  get ffmpegTimeoutMs(): number {
    const raw = process.env.FFMPEG_TIMEOUT_MS;
    if (raw === undefined || raw.trim() === '') return DEFAULT_FFMPEG_TIMEOUT_MS;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_FFMPEG_TIMEOUT_MS;
    return Math.min(parsed, FFMPEG_TIMEOUT_MS_CEILING);
  },
};
