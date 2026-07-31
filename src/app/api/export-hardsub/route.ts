import { NextRequest, NextResponse } from 'next/server';
import { SubtitleItem, ExportJob } from '@/lib/types';
import { generateSRT } from '@/lib/srtFormatter';
import { triggerBackgroundTempCleanup } from '@/lib/tempCleaner';
import { env } from '@/lib/env';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export const maxDuration = 300; // 5 minutes max execution per step

function getJobFilePath(jobId: string): string {
  return path.join(os.tmpdir(), `${jobId}_job.json`);
}

function saveJob(job: ExportJob): void {
  try {
    fs.writeFileSync(getJobFilePath(job.id), JSON.stringify(job), 'utf8');
  } catch (e) {
    console.error('Failed to save job file:', e);
  }
}

function loadJob(jobId: string): ExportJob | null {
  const p = getJobFilePath(jobId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

function deleteJob(jobId: string): void {
  const job = loadJob(jobId);
  const tempFiles = job
    ? [job.inPath, job.srtPath, job.outPath, getJobFilePath(jobId)]
    : [getJobFilePath(jobId)];

  tempFiles.forEach((p) => {
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (e) {}
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
    const hwaccel = env.ffmpegHwaccel ? `-hwaccel ${env.ffmpegHwaccel}` : '';
    
    // Construct force_style string based on dynamic inputs
    const style = job.style || {};
    const fontName = style.fontName || 'Itim';
    const fontSize = style.fontSize || 22;
    const primaryColor = style.primaryColor || 'FFFFFF'; // White
    const outlineColor = style.outlineColor || '000000'; // Black
    const backColor = style.backColor || '000000';    // Dark background box
    const borderStyle = style.borderStyle || 4; // default to back box border
    const marginV = style.marginV || 30;

    const forceStyle = `Fontname=${fontName},Fontsize=${fontSize},PrimaryColour=&H00${primaryColor},OutlineColour=&H00${outlineColor},BackColour=&H80${backColor},BorderStyle=${borderStyle},Outline=2,Shadow=0,MarginV=${marginV}`;

    // Using ultra-fast preset for top speed + h.264 optimization
    const ffmpegCmd = `${ffmpegBin} ${hwaccel} -y -i "${inFileName}" -vf "subtitles='${srtFileName}':force_style='${forceStyle}'" -c:v libx264 -preset ultrafast -profile:v main -level 4.1 -pix_fmt yuv420p -movflags +faststart -threads 0 -c:a copy "${outFileName}"`;

    console.log(`[FFmpeg Hardsub ${jobId}] Executing in ${tempDir}: ${ffmpegCmd}`);
    job.progress = 40;
    saveJob(job);

    await execPromise(ffmpegCmd, { cwd: tempDir, maxBuffer: 50 * 1024 * 1024 });

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
    } catch (e) {}
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
      const body = await req.json();
      const subtitles: SubtitleItem[] = body.subtitles || [];
      const style: any = body.style || {};

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
      return NextResponse.json(
        { success: false, error: errMessage },
        { status: 500 }
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

    // Stream raw incoming video bytes directly to temp file
    const writeStream = fs.createWriteStream(job.inPath);
    const reader = req.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) writeStream.write(value);
    }
    await new Promise((resolve) => writeStream.end(resolve));

    // Launch non-blocking async background encoding
    runFFmpegEncoding(jobId);

    return NextResponse.json({ success: true, status: 'encoding' });
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



