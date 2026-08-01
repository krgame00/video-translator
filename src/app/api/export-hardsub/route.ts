import { NextRequest, NextResponse } from 'next/server';
import { SubtitleItem, ExportJob } from '@/lib/types';
import { generateSRT } from '@/lib/srtFormatter';
import { triggerBackgroundTempCleanup } from '@/lib/tempCleaner';
import { env } from '@/lib/env';
import {
  isSafeJobId,
  resolveTempPath,
  sanitizeStyle,
  MAX_UPLOAD_BYTES,
  HttpError,
  createRateLimiter,
  getClientIp,
} from '@/lib/security';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFilePromise = promisify(execFile);

// Job creation is expensive (spawns FFmpeg + temp files). Limit casual abuse.
const prepareLimiter = createRateLimiter({ windowMs: 60_000, max: 5 });

export const maxDuration = 300; // 5 minutes max execution per step

function getJobFilePath(jobId: string): string {
  if (!isSafeJobId(jobId)) {
    throw new Error('Invalid jobId.');
  }
  return resolveTempPath(`${jobId}_job.json`);
}

function saveJob(job: ExportJob): void {
  try {
    fs.writeFileSync(getJobFilePath(job.id), JSON.stringify(job), 'utf8');
  } catch (e) {
    console.error('Failed to save job file:', e);
  }
}

function loadJob(jobId: string): ExportJob | null {
  try {
    const p = getJobFilePath(jobId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function deleteJob(jobId: string): void {
  if (!isSafeJobId(jobId)) return;
  const job = loadJob(jobId);
  const tempFiles = job
    ? [job.inPath, job.srtPath, job.outPath, getJobFilePath(jobId)]
    : [getJobFilePath(jobId)];

  tempFiles.forEach((p) => {
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch {}
    }
  });
}

async function runFFmpegEncoding(jobId: string) {
  try {
    const job = loadJob(jobId);
    if (!job) return;

    job.status = 'encoding';
    job.progress = 15;
    saveJob(job);

    const tempDir = os.tmpdir();
    const inFileName = `${jobId}_in.mp4`;
    const srtFileName = `${jobId}.srt`;
    const outFileName = `${jobId}_out.mp4`;

    const ffmpegBin = env.ffmpegPath || 'ffmpeg';

    // Construct force_style string based on dynamic inputs (already whitelist-sanitized)
    const style = job.style || {};
    const fontName = style.fontName || 'Itim';
    const fontSize = style.fontSize || 22;
    const primaryColor = style.primaryColor || 'FFFFFF'; // White
    const outlineColor = style.outlineColor || '000000'; // Black
    const backColor = style.backColor || '000000';    // Dark background box
    const borderStyle = style.borderStyle || 4; // default to back box border
    const marginV = style.marginV || 30;

    const forceStyle = `Fontname=${fontName},Fontsize=${fontSize},PrimaryColour=&H00${primaryColor},OutlineColour=&H00${outlineColor},BackColour=&H80${backColor},BorderStyle=${borderStyle},Outline=2,Shadow=0,MarginV=${marginV}`;

    // Using ultra-fast preset for top speed + h.264 optimization.
    // execFile with an args array (no shell) so no value can inject commands.
    const ffmpegArgs: string[] = [];
    if (env.ffmpegHwaccel) ffmpegArgs.push('-hwaccel', env.ffmpegHwaccel);
    ffmpegArgs.push(
      '-y',
      '-i', inFileName,
      '-vf', `subtitles='${srtFileName}':force_style='${forceStyle}'`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-profile:v', 'main',
      '-level', '4.1',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-threads', '0',
      '-c:a', 'copy',
      outFileName
    );

    console.log(`[FFmpeg Hardsub ${jobId}] Executing in ${tempDir}: ${ffmpegBin} ${ffmpegArgs.join(' ')}`);
    job.progress = 40;
    saveJob(job);

    await execFilePromise(ffmpegBin, ffmpegArgs, { cwd: tempDir, maxBuffer: 50 * 1024 * 1024 });

    if (!fs.existsSync(job.outPath) || fs.statSync(job.outPath).size === 0) {
      throw new Error('FFmpeg output video file was not generated.');
    }

    job.status = 'completed';
    job.progress = 100;
    saveJob(job);
  } catch (err: unknown) {
    console.error(`[FFmpeg Hardsub Failed ${jobId}]:`, err);
    try {
      const job = loadJob(jobId);
      if (job) {
        job.status = 'failed';
        const errMessage = err instanceof Error ? err.message : String(err);
        job.error = errMessage || 'FFmpeg encoding failed.';
        saveJob(job);
      }
    } catch {}
  }
}

export async function POST(req: NextRequest) {
  triggerBackgroundTempCleanup();
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const jobId = searchParams.get('jobId');

  // Mode 1: Prepare session
  if (action === 'prepare') {
    try {
      prepareLimiter(getClientIp(req));

      const body = await req.json();
      const subtitles: SubtitleItem[] = body.subtitles || [];
      const style = sanitizeStyle(body.style);

      if (!subtitles || subtitles.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No subtitles provided for export.' },
          { status: 400 }
        );
      }

      const id = `hs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const tempDir = os.tmpdir();
      const srtPath = path.join(tempDir, `${id}.srt`);
      const inPath = path.join(tempDir, `${id}_in.mp4`);
      const outPath = path.join(tempDir, `${id}_out.mp4`);

      // Write clean SRT without BOM so FFmpeg srt demuxer reads line 1 cleanly
      const srtContent = generateSRT(subtitles).replace(/^\uFEFF/, '');
      fs.writeFileSync(srtPath, srtContent, 'utf8');

      const job: ExportJob = {
        id,
        status: 'uploading',
        progress: 0,
        inPath,
        srtPath,
        outPath,
        createdAt: Date.now(),
        style,
      };
      saveJob(job);

      return NextResponse.json({ success: true, jobId: id });
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      const status = err instanceof HttpError ? err.status : 500;
      return NextResponse.json(
        { success: false, error: errMessage },
        { status }
      );
    }
  }

  // Mode 2: Upload video binary stream

  if (action === 'upload') {
    if (!jobId) {
      return NextResponse.json(
        { success: false, error: 'Missing jobId parameter.' },
        { status: 400 }
      );
    }

    if (!isSafeJobId(jobId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid jobId.' },
        { status: 400 }
      );
    }

    try {
      const job = loadJob(jobId);
      if (!job) {
        return NextResponse.json(
          { success: false, error: 'Invalid or expired export jobId.' },
          { status: 404 }
        );
      }

      if (!req.body) {
        return NextResponse.json(
          { success: false, error: 'No video stream payload provided.' },
          { status: 400 }
        );
      }

      // Stream raw incoming video bytes directly to temp file (with size cap)
      const writeStream = fs.createWriteStream(job.inPath);
      const reader = req.body.getReader();
      let received = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            received += value.length;
            if (received > MAX_UPLOAD_BYTES) {
              throw new HttpError(413, 'Upload exceeds the maximum allowed size.');
            }
            writeStream.write(value);
          }
        }
        await new Promise((resolve) => writeStream.end(resolve));
      } catch (uploadErr) {
        writeStream.destroy();
        deleteJob(jobId);
        throw uploadErr;
      }

      // Launch non-blocking async background encoding
      runFFmpegEncoding(jobId);

      return NextResponse.json({ success: true, status: 'encoding' });
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      const status = err instanceof HttpError ? err.status : 500;
      return NextResponse.json(
        { success: false, error: errMessage },
        { status }
      );
    }
  }

  return NextResponse.json({ success: false, error: 'Invalid action.' }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json(
      { success: false, error: 'Missing jobId parameter.' },
      { status: 400 }
    );
  }

  if (!isSafeJobId(jobId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid jobId.' },
      { status: 400 }
    );
  }

  const job = loadJob(jobId);
  if (!job) {
    return NextResponse.json(
      { success: false, error: 'Export job not found or expired.' },
      { status: 404 }
    );
  }

  // Poll status endpoint
  if (action === 'status') {
    return NextResponse.json({
      success: true,
      status: job.status,
      progress: job.progress,
      error: job.error,
    });
  }

  // Download video endpoint
  if (action === 'download') {
    if (job.status !== 'completed' || !fs.existsSync(job.outPath)) {
      return NextResponse.json(
        { success: false, error: 'Export job is not completed yet.' },
        { status: 400 }
      );
    }

    const stats = fs.statSync(job.outPath);
    const fileStream = fs.createReadStream(job.outPath);

    const webStream = new ReadableStream({
      start(controller) {
        fileStream.on('data', (chunk) => controller.enqueue(chunk));
        fileStream.on('end', () => {
          controller.close();
          deleteJob(jobId);
        });
        fileStream.on('error', (err) => {
          controller.error(err);
        });
      },
    });

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': stats.size.toString(),
        'Content-Disposition': 'attachment; filename="hardsub_video.mp4"',
      },
    });
  }

  return NextResponse.json({ success: false, error: 'Invalid action.' }, { status: 400 });
}



