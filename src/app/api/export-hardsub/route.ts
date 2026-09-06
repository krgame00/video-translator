import { NextRequest, NextResponse } from 'next/server';
import { SubtitleItem, ExportJob } from '@/lib/types';
import { buildAss } from '@/lib/assBuilder';
import { triggerBackgroundTempCleanup } from '@/lib/tempCleaner';
import { env } from '@/lib/env';
import {
  isSafeJobId,
  isSafeUploadId,
  resolveTempPath,
  getTempRoot,
  sanitizeStyle,
  sanitizePrepareOptions,
  MAX_UPLOAD_BYTES,
  HttpError,
  createRateLimiter,
  getClientIp,
  readJsonBody,
  generateJobId,
} from '@/lib/security';
import { pumpToWriteStream } from '@/lib/streamPump';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';

// Job creation is expensive (spawns FFmpeg + temp files). Limit casual abuse.
const prepareLimiter = createRateLimiter({ windowMs: 60_000, max: 5 });

/** Running FFmpeg encoders, so cancel requests can kill the process. */
const activeEncodes = new Map<string, ChildProcess>();

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
  } catch (e) {
    console.warn(`Corrupt export job ${jobId}, discarding:`, e);
    return null;
  }
}

function deleteJob(jobId: string): void {
  if (!isSafeJobId(jobId)) return;
  const job = loadJob(jobId);
  const tempFiles = job
    ? [job.inPath, job.subPath, job.outPath, getJobFilePath(jobId)]
    : [getJobFilePath(jobId)];

  tempFiles.forEach((p) => {
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch {}
    }
  });
  // Fonts dir is a directory, not a file
  if (job) {
    const fontsDir = path.join(getTempRoot(), `${jobId}_fonts`);
    if (fs.existsSync(fontsDir)) {
      try { fs.rmSync(fontsDir, { recursive: true, force: true }); } catch {}
    }
  }
}

async function runFFmpegEncoding(jobId: string) {
  let child: ChildProcess | null = null;
  try {
    const job = loadJob(jobId);
    if (!job || job.status === 'cancelled') return;

    job.status = 'encoding';
    job.progress = Math.max(job.progress, 5);
    saveJob(job);

    const tempDir = getTempRoot();
    const inFileName = `${jobId}_in.mp4`;
    const subFileName = `${jobId}.ass`;
    const fontsDirName = `${jobId}_fonts`;
    const outFileName = `${jobId}_out.mp4`;

    const ffmpegBin = env.ffmpegPath || 'ffmpeg';

    // Ship the Itim web font with the job so libass renders the SAME font as
    // the web preview (system font lookup would silently substitute otherwise).
    let fontsDirArg = '';
    const repoFontsDir = path.join(process.cwd(), 'public', 'fonts');
    if (fs.existsSync(repoFontsDir)) {
      const jobFontsDir = path.join(tempDir, fontsDirName);
      try {
        fs.cpSync(repoFontsDir, jobFontsDir, { recursive: true });
        fontsDirArg = `:fontsdir='${fontsDirName}'`;
      } catch (e) {
        console.warn('[FFmpeg Hardsub] Font copy failed, falling back to system fonts:', e);
      }
    }

    // All styling lives inside the .ass file (PlayRes = real video dims),
    // so no force_style overrides here — that would fight the embedded Style.
    const ffmpegArgs: string[] = [];
    if (env.ffmpegHwaccel) ffmpegArgs.push('-hwaccel', env.ffmpegHwaccel);
    ffmpegArgs.push('-progress', 'pipe:1', '-nostats');
    ffmpegArgs.push(
      '-y',
      '-i', inFileName,
      '-vf', `ass='${subFileName}'${fontsDirArg}`,
      '-c:v', 'libx264',
      // veryfast + crf 26: ultrafast's default rate control produced ~14Mbps
      // files (250MB for a 3-min portrait clip) that stall weak players;
      // veryfast compresses ~4x smaller at similar visual quality for only
      // ~2.4x encode time (still realtime-plus on a desktop CPU).
      '-preset', 'veryfast',
      '-crf', '26',
      '-profile:v', 'main',
      '-level', '4.1',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-threads', '0',
      '-c:a', 'copy',
      outFileName
    );

    console.log(`[FFmpeg Hardsub ${jobId}] Executing in ${tempDir}: ${ffmpegBin} ${ffmpegArgs.join(' ')}`);

    child = spawn(ffmpegBin, ffmpegArgs, {
      cwd: tempDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeEncodes.set(jobId, child);

    const totalDuration = typeof job.duration === 'number' && job.duration > 0 ? job.duration : 0;
    let stderrTail = '';
    let stdoutBuf = '';
    let lastProgressSave = Date.now();

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (data: string) => {
      stdoutBuf += data;
      let newlineIdx: number;
      while ((newlineIdx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, newlineIdx).trim();
        stdoutBuf = stdoutBuf.slice(newlineIdx + 1);
        const match = line.match(/^out_time_us=(\d+)$/);
        if (!match || totalDuration <= 0) continue;
        // Job may have been cancelled concurrently; stop updating then.
        if (!activeEncodes.has(jobId)) return;
        const encodedSecs = Number(match[1]) / 1_000_000;
        const pct = Math.min(99, Math.max(1, Math.round((encodedSecs / totalDuration) * 100)));
        if (pct > job.progress) {
          job.progress = pct;
          const now = Date.now();
          if (now - lastProgressSave > 2000) {
            saveJob(job);
            lastProgressSave = now;
          }
        }
      }
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (data: string) => {
      stderrTail = (stderrTail + data).slice(-2000);
    });

    const exitCode = await new Promise<number>((resolve, reject) => {
      child!.on('close', (code) => resolve(code ?? -1));
      child!.on('error', reject);
    });

    if (!activeEncodes.has(jobId)) {
      // Cancelled while encoding; the cancel handler already cleaned up.
      return;
    }

    if (exitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${exitCode}. ${stderrTail.split('\n').slice(-3).join(' ').slice(0, 300)}`);
    }

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
  } finally {
    activeEncodes.delete(jobId);
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

      const body = (await readJsonBody(req)) as {
        subtitles?: SubtitleItem[];
        style?: unknown;
        duration?: number;
        playResX?: number;
        playResY?: number;
        karaoke?: boolean;
        highlightColor?: string;
      };
      const subtitles: SubtitleItem[] = body.subtitles || [];
      const style = sanitizeStyle(body.style);
      const burn = sanitizePrepareOptions(body);

      if (!subtitles || subtitles.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No subtitles provided for export.' },
          { status: 400 }
        );
      }

      const id = generateJobId();
      const tempDir = getTempRoot();
      const subPath = path.join(tempDir, `${id}.ass`);
      const inPath = path.join(tempDir, `${id}_in.mp4`);
      const outPath = path.join(tempDir, `${id}_out.mp4`);

      // Real video dimensions make libass PlayRes match the frame — the core
      // of preview == burn (WYSIWYG). Sensible fallback for audio-only jobs.
      const playResX = burn.playResX ?? 1920;
      const playResY = burn.playResY ?? 1080;

      const assContent = buildAss(subtitles, {
        playResX,
        playResY,
        style,
        karaoke: burn.karaoke,
        highlightColor: burn.highlightColor,
      });
      fs.writeFileSync(subPath, assContent, 'utf8');

      const job: ExportJob = {
        id,
        status: 'uploading',
        progress: 0,
        inPath,
        subPath,
        outPath,
        createdAt: Date.now(),
        duration: typeof body.duration === 'number' && body.duration > 0 ? body.duration : undefined,
        playResX,
        playResY,
        karaoke: burn.karaoke,
        highlightColor: burn.highlightColor,
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
    if (!jobId || !isSafeJobId(jobId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing jobId parameter.' },
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

      // Only accept video for a fresh job — a retry/double-submit during an
      // active encode would truncate inPath and spawn a second FFmpeg.
      if (job.status !== 'uploading') {
        return NextResponse.json(
          { success: false, error: `Job is already ${job.status}; start a new export.` },
          { status: 409 }
        );
      }

      if (!req.body) {
        return NextResponse.json(
          { success: false, error: 'No video stream payload provided.' },
          { status: 400 }
        );
      }

      // Stream raw incoming video bytes directly to temp file. The pump
      // enforces MAX_UPLOAD_BYTES even when no content-length header exists
      // and converts write errors (ENOSPC etc.) into a clean 500.
      const writeStream = fs.createWriteStream(job.inPath);
      try {
        await pumpToWriteStream(req.body.getReader(), writeStream, MAX_UPLOAD_BYTES);
      } catch (uploadErr) {
        writeStream.destroy();
        deleteJob(jobId);
        throw uploadErr;
      }

      // Launch non-blocking async background encoding
      void runFFmpegEncoding(jobId);

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

  // Mode 2b: Attach a chunked upload (from /api/upload) to this job
  if (action === 'attach') {
    if (!jobId || !isSafeJobId(jobId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid jobId parameter.' },
        { status: 400 }
      );
    }

    const uploadId = searchParams.get('uploadId');
    if (!isSafeUploadId(uploadId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid uploadId parameter.' },
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

      if (job.status !== 'uploading') {
        return NextResponse.json(
          { success: false, error: `Job is already ${job.status}; start a new export.` },
          { status: 409 }
        );
      }

      // Load chunked upload session to get the verified temp file
      const sessionPath = resolveTempPath(`${uploadId}_session.json`);
      let session: { uploadedSize: number; totalSize: number; tempPath?: string } | null = null;
      try {
        if (fs.existsSync(sessionPath)) {
          session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
        }
      } catch {}
      if (!session) {
        return NextResponse.json(
          { success: false, error: 'Chunked upload session not found or expired.' },
          { status: 404 }
        );
      }

      // Chunked upload temp file follows the `${uploadId}_raw.tmp` convention
      const rawPath = resolveTempPath(`${uploadId}_raw.tmp`);
      if (session.uploadedSize < session.totalSize || !fs.existsSync(rawPath)) {
        return NextResponse.json(
          { success: false, error: 'Chunked upload is incomplete.' },
          { status: 400 }
        );
      }

      // Move verified temp file into the job's input path (async so a 1GB
      // copy never blocks the event loop), then clean up session
      await fs.promises.copyFile(rawPath, job.inPath);
      try { await fs.promises.unlink(rawPath); } catch {}
      try { await fs.promises.unlink(sessionPath); } catch {}

      void runFFmpegEncoding(jobId);

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

  // Mode 3: Cancel a running/pending export (kills the FFmpeg process)
  if (action === 'cancel') {
    if (!jobId || !isSafeJobId(jobId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing jobId parameter.' },
        { status: 400 }
      );
    }

    const child = activeEncodes.get(jobId);
    if (child) {
      try { child.kill('SIGKILL'); } catch {}
    }

    const job = loadJob(jobId);
    if (job) {
      job.status = 'cancelled';
      job.error = 'Cancelled by user.';
      saveJob(job);
    }
    deleteJob(jobId);

    return NextResponse.json({ success: true, status: 'cancelled' });
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

    // ReadableStream.from adapts the Node stream with proper backpressure —
    // the previous push-into-controller approach buffered the whole video
    // (potentially hundreds of MB) in server memory during download.
    // (cast: lib.dom's ReadableStream static type lacks `.from`)
    const fromNode = ReadableStream as unknown as {
      from: (src: fs.ReadStream) => ReadableStream<Uint8Array>;
    };
    const webStream = fromNode.from(fileStream);
    fileStream.on('end', () => deleteJob(jobId));

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
