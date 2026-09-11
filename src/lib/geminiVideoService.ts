import { GoogleGenAI } from '@google/genai';
import { MODELS, parsePartialOrTruncatedJSON, requestJSON, Type } from './geminiClient';
import { SubtitleItem } from './types';
import { parseTimestampToSeconds, sanitizeAndFixOverlaps, clampSubtitlesToDuration } from './srtFormatter';
import { env } from './env';
import { getTempRoot } from './security';
import { pumpToWriteStream } from './streamPump';
import { hasThaiChars } from './languageCheck';
import { validateWordTimings, interpolateWords, distributeWordsByChars, type WordTiming } from './wordTiming';
import * as fs from 'fs';
import * as path from 'path';

// Type-safe interfaces for Gemini API responses
interface GeminiRawSubtitleItem {
  id: string;
  startTime: string;
  endTime: string;
  originalText: string;
  translatedText: string;
  text?: string; // fallback field sometimes returned by model
}

interface GeminiRawWordTiming {
  id: string;
  words: { text: string; startTime: string; endTime: string }[];
}

const WORD_TIMING_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      words: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            startTime: { type: Type.STRING },
            endTime: { type: Type.STRING },
          },
          required: ['text', 'startTime', 'endTime'],
        },
      },
    },
    required: ['id', 'words'],
  },
};

/**
 * Optional second pass for karaoke: re-listens to the SAME uploaded file and
 * asks Gemini for per-word timings inside each cue (no re-upload — the file
 * is already processed server-side). Any cue whose timings fail validation
 * falls back to character-proportional distribution, so the highlight
 * degrades smoothly instead of breaking.
 */
async function attachWordTimings(
  ai: GoogleGenAI,
  uploaded: { name: string; uri: string },
  mimeType: string,
  subtitles: SubtitleItem[],
  signal?: AbortSignal
): Promise<SubtitleItem[]> {
  try {
    const fallback = subtitles.map((cue) => ({
      ...cue,
      words: distributeWordsByChars(cue.translatedText, cue.startTime, cue.endTime),
    }));

    const cueList = subtitles.map((c) => ({
      id: c.id,
      cueStart: c.startTime,
      cueEnd: c.endTime,
      text: c.translatedText,
    }));
    if (cueList.length === 0) return fallback;

    const prompt = `You are a precise speech-to-word-timing aligner. Listen to the audio and assign the exact spoken time range for each word of each subtitle cue.

For every cue below, split its text into the words that are actually SPOKEN and give the instant each word starts and finishes ("HH:MM:SS.mmm"). Word times must stay inside the cue's [cueStart, cueEnd] range and be in chronological order. Preserve the cue id exactly.

Cues:
${JSON.stringify(cueList)}`;

    // The pass must actually LISTEN to the audio (fileData attachment) —
    // text-only guessing produced fictional timings. Tries models in quota
    // order; any failure falls through to proportional distribution.
    let raw: GeminiRawWordTiming[] | null = null;
    let lastErr: unknown = null;
    for (const modelName of MODELS) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            { fileData: { fileUri: uploaded.uri, mimeType } },
            prompt,
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: WORD_TIMING_SCHEMA,
            abortSignal: signal,
          },
        });
        const responseText = response.text;
        if (!responseText) throw new Error('Gemini returned an empty word-timing response.');
        const parsed = parsePartialOrTruncatedJSON(responseText) as GeminiRawWordTiming[] | null;
        if (!Array.isArray(parsed)) throw new Error('Could not parse word-timing JSON.');
        raw = parsed;
        break;
      } catch (err) {
        lastErr = err;
        if (signal?.aborted) break;
      }
    }
    if (!raw) throw lastErr ?? new Error('Word-timing alignment failed on every model.');

    const byId = new Map<string, GeminiRawWordTiming['words']>();
    for (const item of raw || []) {
      if (item && item.id) byId.set(item.id, item.words || []);
    }

    return subtitles.map((cue) => {
      const rawWords = byId.get(cue.id) || [];
      const parsed: WordTiming[] = rawWords.map((w) => ({
        text: String(w.text || ''),
        start: parseTimestampToSeconds(w.startTime),
        end: parseTimestampToSeconds(w.endTime),
      }));
      if (validateWordTimings(parsed, cue.startTime, cue.endTime)) {
        return { ...cue, words: interpolateWords(parsed, cue.startTime, cue.endTime) };
      }
      return { ...cue, words: distributeWordsByChars(cue.translatedText, cue.startTime, cue.endTime) };
    });
  } catch (err) {
    console.warn('[Word Timing] Pass failed, falling back to proportional distribution:', err);
    return subtitles.map((cue) => ({
      ...cue,
      words: distributeWordsByChars(cue.translatedText, cue.startTime, cue.endTime),
    }));
  }
}

export async function processVideoSubtitlesFromStream(
  stream: ReadableStream<Uint8Array>,
  mimeType: string,
  fileName: string,
  targetLanguage: string = 'th',
  signal?: AbortSignal,
  wordTiming: boolean = false
): Promise<SubtitleItem[]> {
  const apiKeys = env.apiKeys;
  if (apiKeys.length === 0) {
    throw new Error('GEMINI_API_KEY environment variable is missing or empty.');
  }

  // 1. Sanitize file name to ASCII-only
  const ext = path.extname(fileName) || '.mp4';
  const safeFileName = `video_sub_${Date.now()}${ext}`;
  const tempDir = getTempRoot();
  const tempFilePath = path.join(tempDir, safeFileName);

  // Stream file chunks directly to disk with a hard byte cap (guards against
  // chunked-transfer bodies that arrive without a content-length header) and
  // write-error handling (ENOSPC rejects instead of crashing the process).
  const writeStream = fs.createWriteStream(tempFilePath);
  const reader = stream.getReader();
  try {
    await pumpToWriteStream(reader, writeStream, env.maxUploadBytes);
  } catch (pumpErr) {
    writeStream.destroy();
    if (fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch {}
    }
    throw pumpErr;
  }

  // Real media duration (seconds) parsed from the streamed temp file when possible.
  // Used to (a) anchor the model's timeline and (b) clamp away over-length hallucinations.
  const audioDuration = wavDurationSeconds(tempFilePath);

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

          // Wait for file processing if needed (bounded to 5 minutes so a
          // stuck Gemini-side state cannot hang the request forever)
          const processingDeadline = Date.now() + 5 * 60 * 1000;
          let fileState = await ai.files.get({ name: fileNameOnGemini });
          while (fileState.state === 'PROCESSING') {
            if (Date.now() > processingDeadline) {
              throw new Error('Gemini file processing timed out after 5 minutes.');
            }
            if (signal?.aborted) throw new Error('Client disconnected during Gemini file processing.');
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
${audioDuration > 0 ? `REAL MEDIA DURATION IS ${audioDuration.toFixed(3)} SECONDS. This is the true length of the audio. The final cue's endTime MUST be <= ${formatDur(audioDuration)}. NEVER invent timestamps past this instant. Keep each cue's start and end proportional to the actual speech you hear, NOT fabricated to fill arbitrary gaps.\n` : ''}
2. Format startTime and endTime as standard time string in "HH:MM:SS.mmm" format (e.g. "00:01:23.500" for 1 min 23.5s, "00:15:04.200" for 15 min 4.2s, "00:20:04.000" for 20 min 4s).
3. Do NOT output raw floating point numbers or MM.SS decimal formats for timestamps. Always use "HH:MM:SS.mmm".

CRITICAL SUBTITLE CUE QUALITY (MUST FOLLOW):
4. Each cue MUST be 1.5-4 seconds long (hard limits: never shorter than 2s, never longer than 7s). NEVER merge multiple sentences into one long cue, and NEVER output 10-20 second cues.
5. Break speech at sentence or clause boundaries (pauses / intonation). One complete idea per cue.
6. Keep each cue to at most 2 visual lines: ~40 characters for Thai, ~10-12 words for languages with spaces.
7. NEVER split a word across lines or cues. For Thai (no spaces between words), always end a cue at a phrase boundary — never mid-word.
8. Ignore long silent sections or background music without speech.
9. Output strictly formatted according to the requested JSON schema.

CRITICAL SPEECH-SYNC RULES (HIGHEST PRIORITY):
A. 'startTime' = the exact instant the FIRST syllable of that cue is spoken. 'endTime' = the exact instant the LAST syllable FINISHES. Never start a cue before its speech begins; never let a cue linger after its speech ends.
B. If a sentence contains an internal silent pause longer than 0.8 seconds, split it into TWO cues AT the pause. Never let one cue span a silent gap.
C. Timestamps must follow the ACTUAL speech rhythm you hear — not proportional guesses. A sentence spoken quickly gets a short cue even if it has many characters; a slowly-spoken short phrase gets a longer cue.`;

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

          const rawSubtitles = parsePartialOrTruncatedJSON(responseText) as GeminiRawSubtitleItem[] | null;
          if (!rawSubtitles || !Array.isArray(rawSubtitles)) {
            throw new Error('Could not parse subtitles from Gemini API response.');
          }

          // Convert formatted timestamp strings (or numbers) into clean seconds and remove overlaps
          const rawParsed: SubtitleItem[] = rawSubtitles
            .map((item: GeminiRawSubtitleItem, idx: number) => {
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

          let subtitles = audioDuration > 0
            ? clampSubtitlesToDuration(rawParsed, audioDuration)
            : sanitizeAndFixOverlaps(rawParsed);

          // Hallucination recovery: retry ONCE if the model's raw timeline is
          // wildly out of bounds (over/under coverage) or returned nothing.
          // The raw (unclamped) extents decide this, because clamping already
          // hides over-length timelines behind a clean cut.
          if (audioDuration > 0 && rawParsed.length > 0) {
            const rawMaxEnd = Math.max(...rawParsed.map((s) => s.endTime));
            const rawMinStart = Math.min(...rawParsed.map((s) => s.startTime));
            const rawCover = rawMaxEnd - rawMinStart;
            const over = rawMaxEnd > audioDuration * 1.6;
            const under = rawCover < audioDuration * 0.3;
            if (over || under) {
              console.warn(
                `[Timing Guard] Model timeline out of range (rawCover=${rawCover.toFixed(1)}s, audio=${audioDuration.toFixed(1)}s). Retrying once...`
              );
              try {
                const retryPrompt = `Re-transcribe and re-translate the speech in this audio file, but ONLY its true timestamps matter.
REAL AUDIO DURATION IS EXACTLY ${audioDuration.toFixed(3)} SECONDS. Every cue MUST lie strictly inside [0, ${audioDuration.toFixed(3)}]. The first cue starts at 00:00:00.000, the last cue ends no later than ${formatDur(audioDuration)}.
Assign each cue's start/end to the exact moment the words are actually spoken: startTime = the instant the FIRST syllable is spoken, endTime = the instant the LAST syllable finishes. Do NOT stretch cues, do NOT invent long silent gaps, and do NOT output any timestamp past the real duration. Most cues are 1.5-4 seconds (hard limits 2-7s); if a sentence contains a silent pause longer than 0.8 seconds, split it into two cues AT the pause. Skip regions with no speech.
TRANSLATE 'translatedText' into ${langConfig.name} (${langConfig.local}). Output valid JSON array with id, startTime, endTime (HH:MM:SS.mmm), originalText, translatedText.`;

                const retryRes = await ai.models.generateContent({
                  model: modelName,
                  contents: [
                    {
                      fileData: {
                        fileUri: uploadedFile.uri,
                        mimeType: uploadedFile.mimeType || mimeType,
                      },
                    },
                    retryPrompt,
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

                const retryText = retryRes.text;
                if (retryText) {
                  const retryRaw = parsePartialOrTruncatedJSON(retryText) as GeminiRawSubtitleItem[] | null;
                  if (Array.isArray(retryRaw) && retryRaw.length > 0) {
                    const retryParsed: SubtitleItem[] = retryRaw
                      .map((item: GeminiRawSubtitleItem, idx: number) => {
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
                      .filter((item: SubtitleItem) => item.translatedText.length > 0);
                    if (retryParsed.length > 0) {
                      subtitles = clampSubtitlesToDuration(retryParsed, audioDuration);
                    }
                  }
                }
              } catch (retryErr) {
                console.warn('[Timing Guard] Retry failed, keeping first result:', retryErr);
              }
            }
          }

          // Post-processing fallback: If target is Thai but translatedText is missing Thai characters, translate directly
          if (targetLanguage === 'th') {
            const needsThaiTranslation = subtitles.some(
              (item) => item.translatedText.length > 0 && !hasThaiChars(item.translatedText)
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
                  subtitles = audioDuration > 0
                    ? clampSubtitlesToDuration(fixed, audioDuration)
                    : sanitizeAndFixOverlaps(fixed);
                }
              } catch (transErr) {
                console.warn('[Language Guard] Fallback translation warning:', transErr);
              }
            }
          }

          // Optional karaoke pass: per-word timings, reusing the SAME uploaded
          // file (no re-upload, no second processing wait). Never fails the
          // request — falls back to proportional distribution internally.
          if (wordTiming && subtitles.length > 0) {
            subtitles = await attachWordTimings(
              ai,
              { name: uploadedFile.name, uri: uploadedFile.uri },
              mimeType,
              subtitles,
              signal
            );
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

          // Client disconnected: stop immediately. Without this, every
          // remaining key×model retries with a FULL media re-upload.
          if (signal?.aborted) throw err;

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

// Backward compatibility helper using Buffer — no remaining callers; removed.

/**
 * Read the real duration (seconds) of a 16-bit PCM WAV file from its RIFF header.
 * The extraction pipeline always emits WAV, so this gives an authoritative media length
 * used to anchor and clamp model timestamps. Returns null on any parse failure
 * (e.g. a non-WAV fallback payload) so the pipeline degrades gracefully.
 */
function wavDurationSeconds(filePath: string): number {
  try {
    const fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(44);
    const read = fs.readSync(fd, head, 0, 44, 0);
    fs.closeSync(fd);
    if (read < 44) return 0;
    if (head.toString('latin1', 0, 4) !== 'RIFF') return 0;
    if (head.toString('latin1', 8, 12) !== 'WAVE') return 0;

    // Offset 28-31 = byte rate; offset 36-39 = "data"; offset 40-43 = data chunk size
    if (head.toString('latin1', 36, 40) !== 'data') return 0;
    const byteRate = head.readUInt32LE(28);
    const dataSize = head.readUInt32LE(40);
    if (!byteRate || !dataSize) return 0;
    return dataSize / byteRate;
  } catch {
    return 0;
  }
}

/** Format a duration in seconds as "HH:MM:SS.mmm" for prompt anchoring. */
function formatDur(secs: number): string {
  const s = Math.max(0, secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const [int, frac = '000'] = sec.toFixed(3).split('.');
  const mm = String(m).padStart(2, '0');
  const hh = String(h).padStart(2, '0');
  const ss = String(int).padStart(2, '0');
  return `${hh}:${mm}:${ss}.${frac}`;
}
