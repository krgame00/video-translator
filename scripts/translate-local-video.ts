import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { processVideoSubtitlesFromStream } from '../src/lib/geminiVideoService';
import { mergeChunkSubtitles, generateSRT, sanitizeAndFixOverlaps } from '../src/lib/srtFormatter';
import { SubtitleItem } from '../src/lib/types';

// Load .env.local manually
const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of envLines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      process.env[key] = val;
    }
  }
}

const execPromise = promisify(exec);

async function runLocalVideoTranslation(videoPath: string, targetLanguage: string = 'th') {
  if (!fs.existsSync(videoPath)) {
    console.error(`[Error] Video file not found at: ${videoPath}`);
    process.exit(1);
  }

  const baseFileName = path.basename(videoPath, path.extname(videoPath));
  const safeDirName = baseFileName.replace(/[^a-zA-Z0-9]/g, '_');

  console.log(`\n==================================================`);
  console.log(`🚀 Starting Automatic Subtitle Translation`);
  console.log(`📹 Source Video: ${path.basename(videoPath)}`);
  console.log(`🌐 Target Language: ${targetLanguage.toUpperCase()}`);
  console.log(`==================================================\n`);

  // Use persistent cache dir so chunk results are preserved across restarts/retries
  const cacheDir = path.join(os.tmpdir(), `vdo_cache_${safeDirName}`);
  fs.mkdirSync(cacheDir, { recursive: true });

  const extractedAudioPath = path.join(cacheDir, 'extracted_audio.mp3');
  const chunkPattern = path.join(cacheDir, 'chunk_%03d.mp3');

  try {
    // 1. Extract audio track using FFmpeg if not already cached
    if (!fs.existsSync(extractedAudioPath) || fs.statSync(extractedAudioPath).size === 0) {
      console.log(`[Step 1/4] Extracting audio track with FFmpeg...`);
      const ffmpegExtractCmd = `ffmpeg -y -i "${videoPath}" -vn -acodec libmp3lame -ac 1 -ar 16000 -ab 64k "${extractedAudioPath}"`;
      await execPromise(ffmpegExtractCmd, { maxBuffer: 50 * 1024 * 1024 });
    }

    const audioStat = fs.statSync(extractedAudioPath);
    console.log(`✅ Audio extracted/ready (${(audioStat.size / (1024 * 1024)).toFixed(2)} MB)`);

    // 2. Segment audio into 5-minute chunks if not already created
    const existingChunks = fs.readdirSync(cacheDir).filter((f) => f.startsWith('chunk_') && f.endsWith('.mp3'));
    if (existingChunks.length === 0) {
      console.log(`[Step 2/4] Splitting audio into 5-minute chunks...`);
      const ffmpegSegmentCmd = `ffmpeg -y -i "${extractedAudioPath}" -f segment -segment_time 300 -c copy "${chunkPattern}"`;
      await execPromise(ffmpegSegmentCmd, { maxBuffer: 50 * 1024 * 1024 });
    }

    const chunkFiles = fs.readdirSync(cacheDir).filter((f) => f.startsWith('chunk_') && f.endsWith('.mp3')).sort();
    console.log(`✅ Total audio chunks: ${chunkFiles.length}`);

    // 3. Process each chunk with Gemini API (with JSON caching per chunk)
    console.log(`[Step 3/4] Processing audio chunks with Gemini AI...`);
    const chunkResults: { chunkStartTime: number; subtitles: SubtitleItem[] }[] = [];

    for (let i = 0; i < chunkFiles.length; i++) {
      const chunkFile = chunkFiles[i];
      const chunkPath = path.join(cacheDir, chunkFile);
      const chunkStartTime = i * 300;
      const jsonCachePath = path.join(cacheDir, `${chunkFile}.json`);

      // If chunk result is already cached, load it instantly!
      if (fs.existsSync(jsonCachePath)) {
        try {
          const cachedSubs: SubtitleItem[] = JSON.parse(fs.readFileSync(jsonCachePath, 'utf8'));
          console.log(`   ⚡ Chunk ${i + 1}/${chunkFiles.length} loaded from cache (${cachedSubs.length} subtitle lines).`);
          chunkResults.push({ chunkStartTime, subtitles: cachedSubs });
          continue;
        } catch (e) {
          console.warn(`   ⚠️ Cache corrupted for chunk ${i + 1}, re-processing...`);
        }
      }

      // Retry up to 3 times per chunk for high resiliency against network timeouts
      let chunkSubtitles: SubtitleItem[] = [];
      let success = false;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`   ⏳ Processing Chunk ${i + 1}/${chunkFiles.length} (${chunkFile}, attempt ${attempt}/${maxRetries})...`);
        try {
          const fileBuffer = fs.readFileSync(chunkPath);
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(fileBuffer));
              controller.close();
            },
          });

          chunkSubtitles = await processVideoSubtitlesFromStream(
            stream,
            'audio/mp3',
            chunkFile,
            targetLanguage
          );

          success = true;
          break;
        } catch (err: any) {
          console.warn(`   ⚠️ Chunk ${i + 1} attempt ${attempt} failed: ${err.message}`);
          if (attempt < maxRetries) {
            console.log(`   🔄 Waiting 5s before retrying Chunk ${i + 1}...`);
            await new Promise((r) => setTimeout(r, 5000));
          }
        }
      }

      if (!success) {
        console.error(`❌ Chunk ${i + 1} failed after ${maxRetries} attempts. Proceeding with remaining chunks.`);
      } else {
        console.log(`   ✔ Chunk ${i + 1} completed: ${chunkSubtitles.length} subtitle lines generated.`);
        // Save to cache
        fs.writeFileSync(jsonCachePath, JSON.stringify(chunkSubtitles, null, 2), 'utf8');
      }

      chunkResults.push({
        chunkStartTime,
        subtitles: chunkSubtitles,
      });
    }

    // 4. Merge subtitles & generate SRT
    console.log(`[Step 4/4] Merging and sanitizing subtitle timestamps...`);
    const merged = mergeChunkSubtitles(chunkResults);
    const finalSubtitles = sanitizeAndFixOverlaps(merged);

    const srtContent = generateSRT(finalSubtitles);
    const outputSrtPath = videoPath.replace(/\.[^/.]+$/, '') + '.srt';

    fs.writeFileSync(outputSrtPath, srtContent, 'utf8');

    // Also write a copy to public/output.srt in workspace for studio preview
    const workspaceSrtPath = path.join(__dirname, '../public/latest_subtitle.srt');
    fs.writeFileSync(workspaceSrtPath, srtContent, 'utf8');

    console.log(`\n==================================================`);
    console.log(`🎉 Translation Completed Successfully!`);
    console.log(`📄 Total Subtitle Lines: ${finalSubtitles.length}`);
    console.log(`💾 Saved SRT File: ${outputSrtPath}`);
    console.log(`==================================================\n`);

    // Clean up cache after successful full completion
    try {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    } catch (e) {}

  } catch (err: any) {
    console.error(`❌ Error during video translation:`, err);
  }
}

const inputVideo = process.argv[2] || "E:\\VDOHEN\\23.7.69-20260723T102546Z-1-007\\37นาที46วิ [BlueMoon]-Astra Yao Cosplay 1080P (รีเควสรีรัน)-003.mp4";
runLocalVideoTranslation(inputVideo, 'th');
