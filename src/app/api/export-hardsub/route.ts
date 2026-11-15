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
  HttpError,
  createRateLimiter,
  getClientIp,
  readJsonBody,
  generateJobId,
} from '@/lib/security';
import { pumpToWriteStream } from '@/lib/streamPump';
import { listSubtitleFonts } from '@/lib/fontRegistry';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';

// Job creation is expensive (spawns FFmpeg + temp files). Limit casual abuse.
// 10/min leaves room for legitimate retry bursts.
const prepareLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

/** Running FFmpeg encoders, so cancel requests can kill the process. */
const activeEncodes = new Map<string, ChildProcess>();

// Encode one job at a time by default: FFmpeg spawns saturate every core, so
// parallel jobs make the whole machine (including other requests) unusable.
// Queued jobs keep status 'encoding' with their initial progress until their
// turn. Machines with cores to spare can raise this via FFMPEG_MAX_JOBS (1-4).
const pendingEncodes: string[] = [];

function scheduleEncode(jobId: string): void {
  if (activeEncodes.size >= env.ffmpegMaxJobs) {
    pendingEncodes.push(jobId);
    console.log(`[FFmpeg Hardsub] Queued ${jobId} (${pendingEncodes.length} waiting)`);
    return;
  }
  void runFFmpegEncoding(jobId);
}

function onEncodeFinished(): void {
  // Skip stale queue entries: a job cancelled while waiting was already
  // cleaned up by the cancel handler — running it would re-create output
  // for a job the user abandoned.
  let next = pendingEncodes.shift();
  while (next) {
    const job = loadJob(next);
    if (job && job.status !== 'cancelled') {
      void runFFmpegEncoding(next);
      return;
    }
    next = pendingEncodes.shift();
  }
}

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

interface ProbedVideoDimensions {
  width: number;
  height: number;
  isAnamorphic?: boolean;
}

/**
 * Uses ffprobe to detect real DISPLAY dimensions of the uploaded video,
 * accounting for rotation metadata and non-square pixels (SAR != 1:1).
 *
 * Videos shot on phones or downloaded from platforms are often stored as
 * anamorphic (e.g. 1080×1080 with SAR 9:16) or landscape with rotate=90.
 * FFprobe returns raw stream dims — we must normalize SAR and rotation so
 * PlayResX/PlayResY match the actual visual frame geometry.
 */
async function probeVideoDimensions(videoPath: string): Promise<ProbedVideoDimensions | null> {
  try {
    const ffprobeBin = env.ffprobePath || 'ffprobe';
    return await new Promise((resolve) => {
      const proc = spawn(ffprobeBin, [
        '-v', 'error',
        '-select_streams', 'V:0',
        // stream=width,height,sample_aspect_ratio,display_aspect_ratio → raw dims & pixel aspect ratio
        // stream_tags=rotate   → "rotate=90" iPhone/Android metadata
        // stream_side_data=rotation → modern Display Matrix rotation field
        '-show_entries', 'stream=width,height,sample_aspect_ratio,display_aspect_ratio:stream_tags=rotate:stream_side_data=rotation',
        '-of', 'json',
        videoPath,
      ]);
      let out = '';
      proc.stdout?.on('data', (d: Buffer | string) => { out += d.toString(); });
      proc.on('close', (code) => {
        if (code !== 0) return resolve(null);
        try {
          const parsed = JSON.parse(out);
          const stream = parsed.streams?.[0];
          if (!stream) return resolve(null);

          let width: number = stream.width;
          let height: number = stream.height;

          // --- Non-square pixel (Anamorphic) handling ---
          // Phones or downloaders may store 9:16 vertical video as 1080×1080 with SAR 9:16.
          // Libass draws on raw pixels; if PlayRes does not match DAR, the player squeezes
          // or stretches subtitles during display. Normalize to display aspect ratio.
          const sar = stream?.sample_aspect_ratio;
          let isAnamorphic = false;
          if (sar && typeof sar === 'string' && sar !== '1:1' && sar !== '0:1') {
            const [num, den] = sar.split(':').map(Number);
            if (num > 0 && den > 0 && num !== den) {
              isAnamorphic = true;
              if (num < den) {
                height = Math.round(height * (den / num));
              } else {
                width = Math.round(width * (num / den));
              }
            }
          }

          // --- Rotation detection ---
          // 1. Legacy tag: stream.tags.rotate = "90", "180", "270", "-90" etc.
          const rotateTag = stream?.tags?.rotate;
          // 2. Modern side_data: Display Matrix with a "rotation" field (degrees, may be negative)
          type SideData = { side_data_type?: string; rotation?: number };
          const sideDataList: SideData[] = stream?.side_data_list ?? [];
          const displayMatrix = sideDataList.find(
            (sd) => sd.side_data_type === 'Display Matrix'
          );

          let rotation = 0;
          if (rotateTag !== undefined && rotateTag !== null) {
            rotation = Math.abs(parseInt(String(rotateTag), 10)) % 360;
          } else if (displayMatrix?.rotation !== undefined) {
            rotation = Math.abs(Math.round(displayMatrix.rotation)) % 360;
          }

          // Swap width ↔ height for 90° or 270° so PlayRes matches display orientation.
          if (rotation === 90 || rotation === 270) {
            [width, height] = [height, width];
          }

          console.log(`[FFmpeg Hardsub] ffprobe: raw=${stream.width}×${stream.height} sar=${sar || '1:1'} rotate=${rotation}° → display=${width}×${height} (anamorphic=${isAnamorphic})`);

          if (typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0) {
            resolve({ width: Math.round(width), height: Math.round(height), isAnamorphic });
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
      proc.on('error', () => resolve(null));
    });
  } catch {
    return null;
  }
}

/**
 * Probes whether a given video encoder can successfully encode a test frame.
 */
async function probeEncoder(ffmpegBin: string, encoder: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegBin, [
      '-f', 'lavfi',
      '-i', 'color=c=black:s=64x64:d=0.04',
      '-c:v', encoder,
      '-f', 'null',
      '-',
    ]);
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

let cachedVideoEncoder: string | null = null;

interface VideoEncoderConfig {
  encoder: string;
  args: string[];
}

/**
 * Resolves the optimal video encoder based on environment preference and hardware capability.
 * Defaults to auto-detecting hardware acceleration (NVIDIA NVENC, Intel QSV, AMD AMF)
 * with graceful fallback to CPU (libx264).
 */
async function resolveVideoEncoder(ffmpegBin: string): Promise<VideoEncoderConfig> {
  const configured = env.ffmpegVideoEncoder;

  let chosen = configured;
  if (!chosen || chosen === 'auto') {
    if (cachedVideoEncoder) {
      chosen = cachedVideoEncoder;
    } else {
      if (await probeEncoder(ffmpegBin, 'h264_nvenc')) {
        console.log('[FFmpeg Hardsub] NVIDIA GPU encoder (h264_nvenc) verified and active');
        chosen = 'h264_nvenc';
      } else if (await probeEncoder(ffmpegBin, 'h264_qsv')) {
        console.log('[FFmpeg Hardsub] Intel QSV GPU encoder (h264_qsv) verified and active');
        chosen = 'h264_qsv';
      } else if (await probeEncoder(ffmpegBin, 'h264_amf')) {
        console.log('[FFmpeg Hardsub] AMD AMF GPU encoder (h264_amf) verified and active');
        chosen = 'h264_amf';
      } else {
        console.log('[FFmpeg Hardsub] No GPU encoder available; using CPU (libx264)');
        chosen = 'libx264';
      }
      cachedVideoEncoder = chosen;
    }
  }

  if (chosen === 'h264_nvenc') {
    return {
      encoder: 'h264_nvenc',
      args: [
        '-c:v', 'h264_nvenc',
        '-preset', 'p4',
        '-rc', 'vbr',
        '-cq', '30',
        '-b:v', '0',
        '-profile:v', 'main',
        '-level', '4.1',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
      ],
    };
  }

  if (chosen === 'h264_qsv') {
    return {
      encoder: 'h264_qsv',
      args: [
        '-c:v', 'h264_qsv',
        '-preset', 'faster',
        '-global_quality', '28',
        '-profile:v', 'main',
        '-level', '4.1',
        '-pix_fmt', 'nv12',
        '-movflags', '+faststart',
      ],
    };
  }

  if (chosen === 'h264_amf') {
    return {
      encoder: 'h264_amf',
      args: [
        '-c:v', 'h264_amf',
        '-usage', 'transcoding',
        '-quality', 'speed',
        '-rc', 'cqp',
        '-qp_i', '28',
        '-qp_p', '28',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
      ],
    };
  }

  return {
    encoder: 'libx264',
    args: [
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '28',
      '-profile:v', 'main',
      '-level', '4.1',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-threads', '0',
    ],
  };
}

async function runFFmpegEncoding(jobId: string) {
  let child: ChildProcess | null = null;
  try {
    const job = loadJob(jobId);
    if (!job || job.status === 'cancelled') return;

    // Probe actual video file on disk to guarantee PlayResX/PlayResY match
    // the video frame 100% (prevents font stretching on portrait/vertical videos).
    const probed = await probeVideoDimensions(job.inPath);
    if (probed && (probed.width !== job.playResX || probed.height !== job.playResY)) {
      console.log(`[FFmpeg Hardsub ${jobId}] Auto-aligning PlayRes from ${job.playResX}x${job.playResY} to probed ${probed.width}x${probed.height} (anti-stretch guard)`);
      job.playResX = probed.width;
      job.playResY = probed.height;
      if (job.subtitles && job.style) {
        const updatedAss = buildAss(job.subtitles, {
          playResX: probed.width,
          playResY: probed.height,
          style: job.style,
          karaoke: job.karaoke,
          highlightColor: job.highlightColor,
        });
        fs.writeFileSync(job.subPath, updatedAss, 'utf8');
      }
      saveJob(job);
    }

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
    const encoderConfig = await resolveVideoEncoder(ffmpegBin);
    console.log(`[FFmpeg Hardsub ${jobId}] Encoder selected: ${encoderConfig.encoder}`);

    let videoFilter = `ass='${subFileName}'${fontsDirArg}`;
    if (probed?.isAnamorphic && job.playResX && job.playResY) {
      console.log(`[FFmpeg Hardsub ${jobId}] Anamorphic SAR detected — scaling video to square pixels ${job.playResX}x${job.playResY} (setsar=1) before burning subtitles`);
      videoFilter = `scale=${job.playResX}:${job.playResY},setsar=1,ass='${subFileName}'${fontsDirArg}`;
    }

    const ffmpegArgs: string[] = [];
    if (env.ffmpegHwaccel) ffmpegArgs.push('-hwaccel', env.ffmpegHwaccel);
    ffmpegArgs.push('-progress', 'pipe:1', '-nostats');
    ffmpegArgs.push(
      '-y',
      '-i', inFileName,
      '-vf', videoFilter,
      ...encoderConfig.args,
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
      // Per-job kill timeout: an FFmpeg hang (stalled stdin, broken pipe,
      // corrupt input) must never pin the single encoder slot forever and
      // block the whole queue behind it. Env-tunable via FFMPEG_TIMEOUT_MS.
      const timeoutMs = env.ffmpegTimeoutMs;
      const timer = setTimeout(() => {
        console.error(`[FFmpeg Hardsub ${jobId}] Timed out after ${timeoutMs} ms — killing encoder.`);
        try { child!.kill('SIGKILL'); } catch {}
        reject(new Error(`FFmpeg encoding timed out after ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      // A fired timer finishing the process must not keep the server alive.
      if (typeof timer.unref === 'function') timer.unref();
      child!.on('close', (code) => {
        clearTimeout(timer);
        resolve(code ?? -1);
      });
      child!.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });

    // A SIGKILLed process also surfaces via 'close' — but the timeout already
    // rejected above, and the finally block releases the slot. Guard here for
    // the case where the child died on its own between timeout setup and wait.
    if (!activeEncodes.has(jobId)) {
      // Cancelled or timed out while encoding; state was already recorded.
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
    onEncodeFinished();
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
      // The burn ships public/fonts to libass via fontsdir — a family that is
      // not in the registry would silently substitute at render time. Pin it.
      const availableFamilies = listSubtitleFonts().map((f) => f.family);
      if (!availableFamilies.includes(style.fontName ?? '')) {
        style.fontName = availableFamilies[0] ?? 'Itim';
      }
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
        subtitles,
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
        await pumpToWriteStream(req.body.getReader(), writeStream, env.maxUploadBytes);
      } catch (uploadErr) {
        writeStream.destroy();
        deleteJob(jobId);
        throw uploadErr;
      }

      // Launch non-blocking async background encoding
      scheduleEncode(jobId);

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

      scheduleEncode(jobId);

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
      // Release the encoder slot immediately: runFFmpegEncoding's finally
      // also deletes, but the killed process may take seconds to exit and
      // the queue must not stall behind a job the user already abandoned.
      activeEncodes.delete(jobId);
    } else {
      // Not yet encoding — remove from the wait queue so onEncodeFinished
      // never picks up a job the user abandoned.
      const queuedIdx = pendingEncodes.indexOf(jobId);
      if (queuedIdx !== -1) pendingEncodes.splice(queuedIdx, 1);
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
