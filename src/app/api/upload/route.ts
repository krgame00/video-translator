import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import {
  isSafeUploadId,
  resolveTempPath,
  HttpError,
  createRateLimiter,
  getClientIp,
  readJsonBody,
  generateUploadId,
  isAllowedUploadFileName,
} from '@/lib/security';
import { pumpToWriteStream } from '@/lib/streamPump';
import * as fs from 'fs';

// Upload flow is sensitive to resources.
const uploadLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

// Each chunk must not exceed 10MB to avoid generic payload limits
const MAX_CHUNK_SIZE = 10 * 1024 * 1024;

interface UploadSession {
  id: string;
  fileName: string;
  totalSize: number;
  uploadedSize: number;
  tempPath: string;
  createdAt: number;
}

function getSessionFilePath(id: string): string {
  return resolveTempPath(`${id}_session.json`);
}

function saveSession(session: UploadSession): void {
  fs.writeFileSync(getSessionFilePath(session.id), JSON.stringify(session), 'utf8');
}

function loadSession(id: string): UploadSession | null {
  try {
    const p = getSessionFilePath(id);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.warn(`Corrupt upload session ${id}, discarding:`, e);
    return null;
  }
}

/**
 * Serializes session mutations per uploadId. Without this, parallel chunk
 * POSTs interleave their read-modify-write of the session file and lose
 * size accounting (or double-append), corrupting the upload.
 */
const sessionLocks = new Map<string, Promise<unknown>>();

async function withSessionLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionLocks.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  sessionLocks.set(id, next);
  try {
    return await next;
  } finally {
    if (sessionLocks.get(id) === next) sessionLocks.delete(id);
  }
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const uploadId = searchParams.get('uploadId');

  try {
    // Rate-limit only session creation (init). Chunk/complete are per-file
    // continuations; limiting them would 429 large multi-chunk uploads.
    if (action === 'init') uploadLimiter(getClientIp(req));

    // ACTION: INIT
    if (action === 'init') {
      const body = (await readJsonBody(req)) as { fileName?: string; totalSize?: number };
      const { fileName, totalSize } = body;

      if (!fileName || typeof totalSize !== 'number') {
        throw new HttpError(400, 'Missing fileName or totalSize.');
      }

      if (!isAllowedUploadFileName(fileName)) {
        throw new HttpError(400, 'Unsupported file type. Only video/audio files are accepted.');
      }

      if (totalSize > env.maxUploadBytes) {
        throw new HttpError(413, 'File size too large.');
      }

      const id = generateUploadId();
      const tempPath = resolveTempPath(`${id}_raw.tmp`);

      const session: UploadSession = {
        id,
        fileName,
        totalSize,
        uploadedSize: 0,
        tempPath,
        createdAt: Date.now(),
      };

      // Create empty file to hold content
      fs.writeFileSync(tempPath, Buffer.alloc(0));
      saveSession(session);

      return NextResponse.json({ success: true, uploadId: id });
    }

    // ACTION: CHUNK
    if (action === 'chunk') {
      if (!isSafeUploadId(uploadId)) {
        throw new HttpError(400, 'Invalid or missing uploadId.');
      }

      if (!req.body) {
        throw new HttpError(400, 'Empty chunk body.');
      }

      return await withSessionLock(uploadId!, async () => {
        const session = loadSession(uploadId!);
        if (!session) {
          throw new HttpError(404, 'Upload session not found.');
        }

        // Append data to the temp file, streaming (never buffering the whole
        // chunk in memory) and enforcing both per-chunk and total size caps.
        const stream = fs.createWriteStream(session.tempPath, { flags: 'a' });
        let written = 0;
        try {
          const { bytesWritten } = await pumpToWriteStream(req.body!.getReader(), stream, MAX_CHUNK_SIZE);
          written = bytesWritten;
        } catch (chunkErr) {
          stream.destroy();
          throw chunkErr;
        }

        if (session.uploadedSize + written > session.totalSize) {
          // Roll back this append so the file matches the recorded size again.
          try { fs.truncateSync(session.tempPath, session.uploadedSize); } catch {}
          throw new HttpError(400, 'Upload exceeds total declared size.');
        }

        session.uploadedSize += written;
        saveSession(session);

        return NextResponse.json({
          success: true,
          uploadedSize: session.uploadedSize,
          totalSize: session.totalSize
        });
      });
    }

    // ACTION: COMPLETE
    if (action === 'complete') {
      if (!isSafeUploadId(uploadId)) {
        throw new HttpError(400, 'Invalid uploadId.');
      }

      return await withSessionLock(uploadId!, async () => {
        const session = loadSession(uploadId!);
        if (!session) {
          throw new HttpError(404, 'Session not found.');
        }

        if (session.uploadedSize < session.totalSize) {
          throw new HttpError(400, 'Upload incomplete.');
        }

        // Final verification: exists and matches
        const stats = fs.statSync(session.tempPath);
        if (stats.size !== session.totalSize) {
          throw new HttpError(500, 'Final file size mismatch on server.');
        }

        // Note: the server temp path is intentionally NOT returned; clients
        // reference the upload by uploadId (e.g. export attach action).
        return NextResponse.json({
          success: true,
          fileName: session.fileName
        });
      });
    }

    throw new HttpError(400, 'Invalid action.');
  } catch (err: unknown) {
    const status = err instanceof HttpError ? err.status : 500;
    const errMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: errMessage || 'Upload failed.' },
      { status }
    );
  }
}
