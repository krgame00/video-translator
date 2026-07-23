import { GoogleGenAI, Type } from '@google/genai';
import { SubtitleItem } from './types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Helper to get active API keys from environment variable (supports comma-separated list)
 */
function getApiKeys(): string[] {
  const raw = process.env.GEMINI_API_KEY || '';
  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  if (keys.length === 0) {
    throw new Error('GEMINI_API_KEY environment variable is missing or empty.');
  }
  return keys;
}

export async function processVideoSubtitlesFromStream(
  stream: ReadableStream<Uint8Array>,
  mimeType: string,
  fileName: string,
  targetLanguage: string = 'th'
): Promise<SubtitleItem[]> {
  const apiKeys = getApiKeys();

  // Active models based on user quota dashboard
  const modelsToTry = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-1.5-flash',
    'gemini-2.0-flash'
  ];

  // 1. Sanitize file name to ASCII-only
  const ext = path.extname(fileName) || '.mp4';
  const safeFileName = `video_sub_${Date.now()}${ext}`;
  const tempDir = os.tmpdir();
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

  let lastError: any = null;

  try {
    for (const apiKey of apiKeys) {
      const ai = new GoogleGenAI({ apiKey });

      for (const modelName of modelsToTry) {
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

          // 3. Prompt Gemini with structured schema
          const prompt = `You are a Professional Subtitle Translator & Synchronizer.
Your task is to transcribe the speech in the provided audio/video file and translate it into ${targetLanguage === 'th' ? 'Thai' : targetLanguage}.
Requirements:
1. Provide precise millisecond-level start and end timestamps in seconds (e.g., 1.50 for 1 second 500ms).
2. Break long utterances into concise lines (maximum 10-12 words per line) for optimal reading speed.
3. Ignore silent sections or background music without speech.
4. Output strictly formatted according to the requested JSON schema.`;

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

          const responseText = response.text;
          if (!responseText) {
            throw new Error('Gemini API returned an empty response.');
          }

          const subtitles: SubtitleItem[] = JSON.parse(responseText);

          // Clean up remote file asynchronously
          if (uploadedFile && uploadedFile.name) {
            ai.files.delete({ name: uploadedFile.name }).catch((err) => {
              console.warn('Failed to delete remote file from Gemini API:', err);
            });
          }

          return subtitles;
        } catch (err: any) {
          console.warn(`Attempt failed with model ${modelName} using key ...${apiKey.slice(-6)}:`, err.message);
          lastError = err;

          if (uploadedFile && uploadedFile.name) {
            ai.files.delete({ name: uploadedFile.name }).catch(() => {});
          }

          const isRetryableError =
            err.status === 429 ||
            err.status === 404 ||
            err.status === 503 ||
            err.message?.includes('429') ||
            err.message?.includes('404') ||
            err.message?.includes('503') ||
            err.message?.includes('Quota') ||
            err.message?.includes('RESOURCE_EXHAUSTED') ||
            err.message?.includes('UNAVAILABLE') ||
            err.message?.includes('high demand') ||
            err.message?.includes('not found') ||
            err.message?.includes('no longer available');

          if (!isRetryableError) {
            throw err;
          }
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
