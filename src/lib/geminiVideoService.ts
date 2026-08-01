import { GoogleGenAI } from '@google/genai';
import { MODELS, parsePartialOrTruncatedJSON, requestJSON, Type } from './geminiClient';
import { SubtitleItem } from './types';
import { parseTimestampToSeconds, sanitizeAndFixOverlaps } from './srtFormatter';
import { env } from './env';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function getTempDirectory(): string {
  const custom = env.tempDir || process.env.TEMP || process.env.TMP;
  if (custom && fs.existsSync(custom)) {
    return custom;
  }
  return os.tmpdir();
}

export async function processVideoSubtitlesFromStream(
  stream: ReadableStream<Uint8Array>,
  mimeType: string,
  fileName: string,
  targetLanguage: string = 'th',
  signal?: AbortSignal
): Promise<SubtitleItem[]> {
  const apiKeys = env.apiKeys;
  if (apiKeys.length === 0) {
    throw new Error('GEMINI_API_KEY environment variable is missing or empty.');
  }

  // 1. Sanitize file name to ASCII-only
  const ext = path.extname(fileName) || '.mp4';
  const safeFileName = `video_sub_${Date.now()}${ext}`;
  const tempDir = getTempDirectory();
  const tempFilePath = path.join(tempDir, safeFileName);

  // Stream file chunks directly to disk (RAM usage stays < 5MB regardless of file size)
  const writeStream = fs.createWriteStream(tempFilePath);
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) writeStream.write(value);
  }
  await new Promise((resolve) => writeStream.end(resolve));

  let lastError: unknown = null;

  try {
    for (const apiKey of apiKeys) {
      const ai = new GoogleGenAI({ apiKey });

      for (const modelName of MODELS) {
        let uploadedFile;
        try {
          // 2. Upload file using Gemini File API
          uploadedFile = await ai.files.upload({
            file: tempFilePath,
            config: {
              mimeType: mimeType,
              displayName: safeFileName,
            },
          });

          if (!uploadedFile.name || !uploadedFile.uri) {
            throw new Error('Gemini File upload did not return valid file details.');
          }

          const fileNameOnGemini = uploadedFile.name;

          // Wait for file processing if needed
          let fileState = await ai.files.get({ name: fileNameOnGemini });
          while (fileState.state === 'PROCESSING') {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            fileState = await ai.files.get({ name: fileNameOnGemini });
          }

          if (fileState.state === 'FAILED') {
            throw new Error('File processing failed on Gemini servers.');
          }

          // 3. Language configuration & prompt construction
          const langMap: Record<string, { name: string; local: string }> = {
            th: { name: 'Thai', local: 'ภาษาไทย' },
            en: { name: 'English', local: 'English' },
            ja: { name: 'Japanese', local: '日本語' },
            zh: { name: 'Chinese', local: '中文' },
            ko: { name: 'Korean', local: '한국어' },
          };
          const langConfig = langMap[targetLanguage] || { name: targetLanguage, local: targetLanguage };

          const prompt = `You are a World-Class Professional Subtitle Translator & Synchronizer.
Your task is to transcribe the spoken speech in the audio/video file into 'originalText' and TRANSLATE it into ${langConfig.name} (${langConfig.local}) for 'translatedText'.

CRITICAL LANGUAGE REQUIREMENT (MUST FOLLOW):
1. 'originalText': Transcribe the EXACT spoken audio in its original spoken language (e.g., Japanese/English/Chinese).
2. 'translatedText': You MUST translate every single sentence into ${langConfig.name} (${langConfig.local}) language ONLY.
   - If target language is Thai, 'translatedText' MUST BE IN THAI (${langConfig.local}).
   - DO NOT output English, Japanese, or any other language in 'translatedText' when target language is ${langConfig.name}!

CRITICAL REQUIREMENTS FOR TIMESTAMP ACCURACY & FULL DURATION COVERAGE:
1. Cover the ENTIRE audio/video file duration from 00:00:00.000 to the end of the video (even if 20+ minutes long). Do NOT stop early or truncate timeline.
2. Format startTime and endTime as standard time string in "HH:MM:SS.mmm" format (e.g. "00:01:23.500" for 1 min 23.5s, "00:15:04.200" for 15 min 4.2s, "00:20:04.000" for 20 min 4s).
3. Do NOT output raw floating point numbers or MM.SS decimal formats for timestamps. Always use "HH:MM:SS.mmm".

CRITICAL SUBTITLE CUE QUALITY (MUST FOLLOW):
4. Each cue MUST be 2-7 seconds long. NEVER merge multiple sentences into one long cue, and NEVER output 10-20 second cues.
5. Break speech at sentence or clause boundaries (pauses / intonation). One complete idea per cue.
6. Keep each cue to at most 2 visual lines: ~40 characters for Thai, ~10-12 words for languages with spaces.
7. NEVER split a word across lines or cues. For Thai (no spaces between words), always end a cue at a phrase boundary — never mid-word.
8. Ignore long silent sections or background music without speech.
9. Output strictly formatted according to the requested JSON schema.`;

          const response = await ai.models.generateContent({
            model: modelName,
            contents: [
              {
                fileData: {
                  fileUri: uploadedFile.uri,
                  mimeType: uploadedFile.mimeType || mimeType,
                },
              },
              prompt,
            ],
            config: {
              maxOutputTokens: 65536,
              responseMimeType: 'application/json',
              abortSignal: signal,
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    startTime: { type: Type.STRING },
                    endTime: { type: Type.STRING },
                    originalText: { type: Type.STRING },
                    translatedText: { type: Type.STRING },
                  },
                  required: ['id', 'startTime', 'endTime', 'originalText', 'translatedText'],
                },
              },
            },
          });

          const responseText = response.text;
          if (!responseText) {
            throw new Error('Gemini API returned an empty response.');
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rawSubtitles: any[] = parsePartialOrTruncatedJSON(responseText);
          if (!rawSubtitles || !Array.isArray(rawSubtitles)) {
            throw new Error('Could not parse subtitles from Gemini API response.');
          }

          // Convert formatted timestamp strings (or numbers) into clean seconds and remove overlaps
          const rawParsed: SubtitleItem[] = rawSubtitles
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((item: any, idx: number) => {
              const startSec = parseTimestampToSeconds(item.startTime);
              const endSec = parseTimestampToSeconds(item.endTime);
              const validEnd = endSec > startSec ? endSec : startSec + 2.0;

              return {
                id: item.id || String(idx + 1),
                startTime: Math.max(0, Number(startSec.toFixed(3))),
                endTime: Math.max(0, Number(validEnd.toFixed(3))),
                originalText: String(item.originalText || '').trim(),
                translatedText: String(item.translatedText || item.text || '').trim(),
              };
            })
            .filter((item) => item.translatedText.length > 0);

          let subtitles = sanitizeAndFixOverlaps(rawParsed);

          // Post-processing fallback: If target is Thai but translatedText is missing Thai characters, translate directly
          if (targetLanguage === 'th') {
            const needsThaiTranslation = subtitles.some(
              (item) => item.translatedText.length > 0 && !/[\u0E00-\u0E7F]/.test(item.translatedText)
            );

            if (needsThaiTranslation) {
              console.log('[Language Guard] Detected non-Thai translatedText in response. Performing automatic Thai translation pass...');
              try {
                const transPrompt = `Translate the 'translatedText' of every item in this JSON array into natural, clear Thai (ภาษาไทย). Keep id, startTime, endTime, and originalText unchanged. Output valid JSON array.

Input JSON:
${JSON.stringify(subtitles, null, 2)}`;

                const fixed = await requestJSON<SubtitleItem[]>({
                  prompt: transPrompt,
                  schema: {
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
                  signal,
                });

                if (Array.isArray(fixed) && fixed.length > 0) {
                  subtitles = sanitizeAndFixOverlaps(fixed);
                }
              } catch (transErr) {
                console.warn('[Language Guard] Fallback translation warning:', transErr);
              }
            }
          }

          // Clean up remote file asynchronously
          if (uploadedFile && uploadedFile.name) {
            ai.files.delete({ name: uploadedFile.name }).catch((err) => {
              console.warn('Failed to delete remote file from Gemini API:', err);
            });
          }

          return subtitles;
        } catch (err: unknown) {
          const error = err as { status?: number; message?: string };
          console.warn(`Attempt failed with model ${modelName} using key ...${apiKey.slice(-6)}:`, error.message);
          lastError = err;

          if (uploadedFile && uploadedFile.name) {
            ai.files.delete({ name: uploadedFile.name }).catch(() => {});
          }

          // Continue to the next key/model on every failure (retryable or not)
          // so a permanent error on one model cannot kill the whole pipeline.
        }
      }
    }
  } finally {
    // Clean up temporary disk file
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {
        console.error('Failed to delete temp local file:', e);
      }
    }
  }

  throw lastError || new Error('All API keys and Gemini models failed or exceeded quota.');
}

// Backward compatibility helper using Buffer
export async function processVideoSubtitles(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
  targetLanguage: string = 'th'
): Promise<SubtitleItem[]> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(fileBuffer));
      controller.close();
    },
  });
  return processVideoSubtitlesFromStream(stream, mimeType, fileName, targetLanguage);
}
