/**
 * Node-runtime half of `instrumentation.ts`. Split into its own module so the
 * `fs` import in `lib/env` never reaches the Edge bundle — `instrumentation.ts`
 * reaches this file through a dynamic `import()` guarded by `NEXT_RUNTIME`.
 *
 * Fail-fast env validation: crash the boot with one readable error instead of
 * serving cryptic 500s on the first request. No secrets are logged, only counts
 * and paths.
 */
import { validateEnv } from './lib/env';

// Runs on import: `instrumentation.ts` reaches this module through a dynamic
// `import()` guarded by `NEXT_RUNTIME === 'nodejs'`, so merely loading it
// means we are on the Node runtime at boot. Same pattern as the NodeSDK
// `sdk.start()` call in the Next.js OpenTelemetry guide.
validateAndLogBootEnv();

export function validateAndLogBootEnv(): void {
  const cfg = validateEnv();
  const keyCount = cfg.GEMINI_API_KEY.split(',').filter((k) => k.trim().length > 0).length;
  console.log(
    `[boot] env OK — gemini keys: ${keyCount}, ` +
      `tempDir: ${cfg.TEMP_DIR ?? '(os.tmpdir)'} / ` +
      `maxUpload: ${Math.round(cfg.MAX_UPLOAD_BYTES / 1024 / 1024)} MB` +
      `${cfg.FFMPEG_PATH ? ' / ffmpeg: custom' : ''}`,
  );
}