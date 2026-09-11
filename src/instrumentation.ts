/**
 * Runs once when a new Next.js server instance starts (App Router
 * `instrumentation.ts` convention). Fail-fast env validation: crash the boot
 * with one readable error instead of serving cryptic 500s on the first
 * request. No secrets are logged — only counts and paths.
 */
import { validateEnv } from './lib/env';

export function register() {
  const cfg = validateEnv();
  const keyCount = cfg.GEMINI_API_KEY.split(',').filter((k) => k.trim().length > 0).length;
  console.log(
    `[boot] env OK — gemini keys: ${keyCount}, ` +
      `tempDir: ${cfg.TEMP_DIR ?? '(os.tmpdir)'} / ` +
      `maxUpload: ${Math.round(cfg.MAX_UPLOAD_BYTES / 1024 / 1024)} MB` +
      `${cfg.FFMPEG_PATH ? ' / ffmpeg: custom' : ''}`,
  );
}
