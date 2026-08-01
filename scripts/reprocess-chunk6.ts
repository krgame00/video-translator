import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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

async function refineChunk6() {
  const videoPath = "E:\\VDOHEN\\23.7.69-20260723T102546Z-1-007\\37นาที46วิ [BlueMoon]-Astra Yao Cosplay 1080P (รีเควสรีรัน)-003.mp4";
  const baseFileName = path.basename(videoPath, path.extname(videoPath));
  const safeDirName = baseFileName.replace(/[^a-zA-Z0-9]/g, '_');
  const cacheDir = path.join(os.tmpdir(), `vdo_cache_${safeDirName}`);

  const chunk6Path = path.join(cacheDir, 'chunk_005.mp3');
  const jsonCachePath = path.join(cacheDir, 'chunk_005.mp3.json');

  if (fs.existsSync(chunk6Path)) {
    console.log(`[Reprocess Chunk 6] Retrying chunk 6 (${chunk6Path}) with high-precision model...`);
    try {
      const fileBuffer = fs.readFileSync(chunk6Path);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(fileBuffer));
          controller.close();
        },
      });

      const chunkSubtitles = await processVideoSubtitlesFromStream(
        stream,
        'audio/mp3',
        'chunk_005.mp3',
        'th'
      );

      console.log(`✔ Chunk 6 completed: ${chunkSubtitles.length} subtitle lines generated.`);
      fs.writeFileSync(jsonCachePath, JSON.stringify(chunkSubtitles, null, 2), 'utf8');
    } catch (e: unknown) {
      console.warn(`[Reprocess Chunk 6] Error:`, e instanceof Error ? e.message : e);
    }
  }

  // Re-merge all chunks from cache
  const files = fs.readdirSync(cacheDir).filter((f) => f.startsWith('chunk_') && f.endsWith('.mp3')).sort();
  const chunkResults: { chunkStartTime: number; subtitles: SubtitleItem[] }[] = [];

  for (let i = 0; i < files.length; i++) {
    const chunkFile = files[i];
    const chunkStartTime = i * 300;
    const cacheFile = path.join(cacheDir, `${chunkFile}.json`);

    if (fs.existsSync(cacheFile)) {
      try {
        const subs = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        chunkResults.push({ chunkStartTime, subtitles: subs });
      } catch {}
    }
  }

  const merged = mergeChunkSubtitles(chunkResults);
  const finalSubtitles = sanitizeAndFixOverlaps(merged);
  const srtContent = generateSRT(finalSubtitles);

  const outputSrtPath = videoPath.replace(/\.[^/.]+$/, '') + '.srt';
  fs.writeFileSync(outputSrtPath, srtContent, 'utf8');

  console.log(`🎉 Reprocess Completed! Total Subtitle Lines: ${finalSubtitles.length}`);
  console.log(`💾 Saved updated SRT: ${outputSrtPath}`);
}

refineChunk6();
