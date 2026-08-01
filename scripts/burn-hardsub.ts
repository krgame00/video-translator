import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

async function burnHardsubVideo() {
  const args = process.argv.slice(2);
  const videoPath = args[0] || "E:\\VDOHEN\\23.7.69-20260723T102546Z-1-007\\37นาที46วิ [BlueMoon]-Astra Yao Cosplay 1080P (รีเควสรีรัน)-003.mp4";
  const srtPath = videoPath.replace(/\.[^/.]+$/, '') + '.srt';
  const outPath = videoPath.replace(/\.[^/.]+$/, '') + '_hardsub.mp4';

  if (!fs.existsSync(videoPath)) {
    console.error(`❌ Video file not found: ${videoPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(srtPath)) {
    console.error(`❌ Subtitle file not found: ${srtPath}`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🔥 Starting Hardsub Video Encoding`);
  console.log(`📹 Video: ${path.basename(videoPath)}`);
  console.log(`📄 SRT: ${path.basename(srtPath)}`);
  console.log(`💾 Output: ${path.basename(outPath)}`);
  console.log(`==================================================\n`);

  const tempDir = os.tmpdir();
  const tempSrtName = `hardsub_${Date.now()}.srt`;
  const tempSrtPath = path.join(tempDir, tempSrtName);

  // Copy SRT content without UTF-8 BOM so FFmpeg srt demuxer reads line 1 cleanly
  const srtContent = fs.readFileSync(srtPath, 'utf8').replace(/^\uFEFF/, '');
  fs.writeFileSync(tempSrtPath, srtContent, 'utf8');

  // High-speed CPU encoding using libx264 ultrafast preset, limited to 2 threads to save resources
  const ffmpegCmd = `ffmpeg -y -i "${videoPath}" -vf "subtitles='${tempSrtName}':force_style='Fontname=Itim,Fontsize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=4,Outline=2,Shadow=0,MarginV=30'" -c:v libx264 -preset ultrafast -crf 22 -threads 2 -c:a copy "${outPath}"`;

  try {
    console.log(`🚀 Executing High-Speed Hardsub Video Encoding (libx264 ultrafast)...`);
    await execPromise(ffmpegCmd, { cwd: tempDir, maxBuffer: 100 * 1024 * 1024 });
    console.log(`✅ Hardsub Encoding Completed!`);
  } catch (err: unknown) {
    console.error(`❌ Encoding Error:`, err);
  } finally {
    if (fs.existsSync(tempSrtPath)) {
      try { fs.unlinkSync(tempSrtPath); } catch {}
    }
  }

  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
    const outStat = fs.statSync(outPath);
    console.log(`\n==================================================`);
    console.log(`🎉 Hardsub Video Exported Successfully!`);
    console.log(`💾 Saved Output Video: ${outPath}`);
    console.log(`📦 File Size: ${(outStat.size / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`==================================================\n`);
  }
}

burnHardsubVideo();
