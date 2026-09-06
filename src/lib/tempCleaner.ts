import * as fs from 'fs';
import * as path from 'path';
import { getTempRoot } from './security';

/**
 * Sweeps the temporary directory and removes expired temporary files created by
 * the Video Translator & Hardsub Export engines.
 *
 * Target file prefixes:
 * - `hs_` (Hardsub export jobs, temporary SRT files, input/output MP4s)
 * - `ul_` (Chunked upload sessions + raw temp files from /api/upload)
 * - `video_sub_` (Temporary uploaded video files for Gemini API)
 * - `chunk_` (Audio chunk files)
 *
 * @param maxAgeMs Maximum age in milliseconds before a file is considered expired (Default: 1 hour)
 * @returns Number of files successfully removed
 */
export function cleanExpiredTempFiles(
  maxAgeMs: number = 3600 * 1000,
  maxTotalSizeMb: number = 2048 // 2GB Quota
): number {
  const tempDir = getTempRoot();
  if (!fs.existsSync(tempDir)) return 0;

  const now = Date.now();
  let deletedCount = 0;
  let totalSizeSum = 0;

  interface TempFileInfo {
    name: string;
    path: string;
    age: number;
    size: number;
    expired: boolean;
  }

  const ourFiles: TempFileInfo[] = [];

  try {
    const files = fs.readdirSync(tempDir);

    for (const file of files) {
      if (
        file.startsWith('hs_') ||
        file.startsWith('ul_') ||
        file.startsWith('video_sub_') ||
        file.startsWith('chunk_')
      ) {
        const filePath = path.join(tempDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) {
            // Export-job font dirs (`hs_*_fonts`) — count their content size
            // so the quota branch sees them; deletion uses rmSync below.
            let dirSize = 0;
            try {
              for (const f of fs.readdirSync(filePath)) {
                dirSize += fs.statSync(path.join(filePath, f)).size;
              }
            } catch {}
            ourFiles.push({
              name: file,
              path: filePath,
              age: now - stat.mtimeMs,
              size: dirSize,
              expired: (now - stat.mtimeMs) >= maxAgeMs
            });
          } else {
            ourFiles.push({
              name: file,
              path: filePath,
              age: now - stat.mtimeMs,
              size: stat.size,
              expired: (now - stat.mtimeMs) >= maxAgeMs
            });
          }
          totalSizeSum += ourFiles[ourFiles.length - 1].size;
        } catch (fileErr) {
          console.warn(`[Temp Cleaner] Skip file ${file}:`, fileErr);
        }
      }
    }

    // 1. Delete expired items (directories via rmSync — unlinkSync throws on dirs)
    for (const item of ourFiles) {
      if (item.expired) {
        try {
          if (fs.existsSync(item.path) && fs.statSync(item.path).isDirectory()) {
            fs.rmSync(item.path, { recursive: true, force: true });
          } else {
            fs.unlinkSync(item.path);
          }
          deletedCount++;
          totalSizeSum -= item.size;
          console.log(`[Temp Cleaner] Removed expired temp file (${Math.round(item.age / 60000)}m old): ${item.name}`);
        } catch {}
      }
    }

    // 2. Size Guard: If total size still exceeds threshold, remove oldest
    // non-expired files. Files touched within the last 15 minutes are skipped
    // so in-flight uploads and active encode jobs are never killed.
    if (totalSizeSum > maxTotalSizeMb * 1024 * 1024) {
      const candidates = ourFiles.filter(
        (f) => !f.expired && f.age > 15 * 60 * 1000 && fs.existsSync(f.path)
      ).sort((a, b) => b.age - a.age); // Oldest first
      
      for (const item of candidates) {
        try {
          if (fs.existsSync(item.path) && fs.statSync(item.path).isDirectory()) {
            fs.rmSync(item.path, { recursive: true, force: true });
          } else {
            fs.unlinkSync(item.path);
          }
          deletedCount++;
          totalSizeSum -= item.size;
          console.log(`[Temp Cleaner] Quota limit exceeded. Removing oldest: ${item.name} (${Math.round(item.size / 1024 / 1024)}MB)`);
          if (totalSizeSum <= maxTotalSizeMb * 1024 * 1024 * 0.8) break; // Clear until 80% full
        } catch {}
      }
    }

  } catch (err) {
    console.error('[Temp Cleaner] Error scanning temp directory:', err);
  }

  return deletedCount;
}

/**
 * Triggers non-blocking background cleanup without waiting or throwing exceptions.
 * Suitable for calling inside Next.js Route Handlers.
 */
export function triggerBackgroundTempCleanup(maxAgeMs: number = 3600 * 1000): void {
  setTimeout(() => {
    try {
      cleanExpiredTempFiles(maxAgeMs);
    } catch (err) {
      console.warn('[Temp Cleaner Background Error]:', err);
    }
  }, 100);
}
