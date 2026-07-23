import { processVideoSubtitles } from './src/lib/geminiVideoService';
import * as fs from 'fs';

async function runTest() {
  const filePath = `E:\\โด\\6นาที2วิ [Maplestar]-SOLO.LEVELING Aniamation (ตัวล่าสุด).mp4`;
  console.log('Checking file path:', filePath);

  if (!fs.existsSync(filePath)) {
    console.error('❌ File not found at path:', filePath);
    return;
  }

  const buffer = fs.readFileSync(filePath);
  const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
  console.log(`📹 File loaded successfully (${sizeMB} MB). Processing with Gemini AI...`);

  try {
    const subtitles = await processVideoSubtitles(buffer, 'video/mp4', 'solo_leveling.mp4', 'th');
    console.log('✅ Success! Generated Subtitles count:', subtitles.length);
    console.log('\n--- Subtitle Items ---');
    console.log(JSON.stringify(subtitles, null, 2));
  } catch (err: any) {
    console.error('❌ Test execution error:', err.message || err);
  }
}

runTest();
