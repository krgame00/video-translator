import * as fs from 'fs';
import * as path from 'path';
import { parseSRT, generateSRT } from '../src/lib/srtFormatter';
import { SubtitleItem } from '../src/lib/types';
import { GoogleGenAI, Type } from '@google/genai';

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

const rawKeys = process.env.GEMINI_API_KEY || '';
const apiKey = rawKeys.split(',')[0].trim();
if (!apiKey) {
  console.error("No API key found.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function fixSrt() {
  const srtPath = "E:\\VDOHEN\\23.7.69-20260723T102546Z-1-007\\37นาที46วิ [BlueMoon]-Astra Yao Cosplay 1080P (รีเควสรีรัน)-003.srt";
  if (!fs.existsSync(srtPath)) {
    console.error("SRT not found.");
    return;
  }

  const srtContent = fs.readFileSync(srtPath, 'utf8');
  const subs = parseSRT(srtContent);
  
  // Find lines without Thai
  const thaiRegex = /[\u0E00-\u0E7F]/;
  const needsFixing = subs.filter(s => !thaiRegex.test(s.translatedText));
  
  if (needsFixing.length === 0) {
    console.log("All lines seem to have Thai characters. Nothing to fix.");
    return;
  }
  
  console.log(`Found ${needsFixing.length} lines without Thai characters. Sending to Gemini-3.5-flash...`);
  
  // We process in batches of 50 to avoid prompt limits
  const batchSize = 50;
  for (let i = 0; i < needsFixing.length; i += batchSize) {
    const batch = needsFixing.slice(i, i + batchSize);
    console.log(`Processing batch ${i/batchSize + 1} (${batch.length} lines)...`);
    
    const prompt = `Translate the 'translatedText' of every item in this JSON array into natural, clear Thai (ภาษาไทย). Keep id, startTime, endTime, and originalText unchanged. Output valid JSON array.

Input JSON:
${JSON.stringify(batch, null, 2)}`;

    try {
      const transResponse = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                startTime: { type: Type.NUMBER },
                endTime: { type: Type.NUMBER },
                originalText: { type: Type.STRING },
                translatedText: { type: Type.STRING },
              },
              required: ['id', 'startTime', 'endTime', 'originalText', 'translatedText'],
            },
          },
        },
      });

      if (transResponse.text) {
        const fixedBatch = JSON.parse(transResponse.text);
        if (Array.isArray(fixedBatch)) {
          for (const fixed of fixedBatch) {
            const originalItem = subs.find(s => s.id === fixed.id);
            if (originalItem) {
              originalItem.translatedText = fixed.translatedText;
            }
          }
        }
      }
    } catch (e) {
      console.error("Batch failed:", e);
    }
  }
  
  // Save fixed SRT
  const newSrtContent = generateSRT(subs);
  fs.writeFileSync(srtPath, newSrtContent, 'utf8');
  console.log("SRT file fixed and saved!");
}

fixSrt();
