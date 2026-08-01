import { NextRequest, NextResponse } from 'next/server';
import {
  isSafeUploadId,
  resolveTempPath,
  MAX_UPLOAD_BYTES,
  HttpError,
  createRateLimiter,
  getClientIp,
} from '@/lib/security';
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
  } catch {
    return null;
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
      const body = await req.json();
      const { fileName, totalSize } = body;

      if (!fileName || typeof totalSize !== 'number') {
        throw new HttpError(400, 'Missing fileName or totalSize.');
      }

      if (totalSize > MAX_UPLOAD_BYTES) {
        throw new HttpError(413, 'File size too large.');
      }

      const id = `ul_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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

      const session = loadSession(uploadId);
      if (!session) {
        throw new HttpError(404, 'Upload session not found.');
      }

      if (!req.body) {
        throw new HttpError(400, 'Empty chunk body.');
      }

      const reader = req.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          size += value.length;
          if (size > MAX_CHUNK_SIZE) {
            throw new HttpError(413, 'Chunk size exceeds limit.');
          }
          chunks.push(value);
        }
      }

      if (session.uploadedSize + size > session.totalSize) {
        throw new HttpError(400, 'Upload exceeds total declared size.');
      }

      // Append data to the temp file
      const stream = fs.createWriteStream(session.tempPath, { flags: 'a' });
      for (const chunk of chunks) {
        stream.write(chunk);
      }
      await new Promise((res) => stream.end(res));

      session.uploadedSize += size;
      saveSession(session);

      return NextResponse.json({ 
        success: true, 
        uploadedSize: session.uploadedSize,
        totalSize: session.totalSize
      });
    }

    // ACTION: COMPLETE
    if (action === 'complete') {
      if (!isSafeUploadId(uploadId)) {
        throw new HttpError(400, 'Invalid uploadId.');
      }

      const session = loadSession(uploadId);
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

      return NextResponse.json({ 
        success: true, 
        tempPath: session.tempPath,
        fileName: session.fileName
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
