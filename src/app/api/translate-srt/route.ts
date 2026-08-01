import { NextRequest, NextResponse } from 'next/server';
import { SubtitleItem } from '@/lib/types';
import { requestJSON, SUBTITLE_ARRAY_SCHEMA } from '@/lib/geminiClient';
import { triggerBackgroundTempCleanup } from '@/lib/tempCleaner';
import { readJsonBody, HttpError } from '@/lib/security';
import { parseTimestampToSeconds, sanitizeAndFixOverlaps } from '@/lib/srtFormatter';

export const maxDuration = 300; // Allow up to 5 minutes for large SRT batches

const BATCH_SIZE = 100;

export async function POST(req: NextRequest) {
  triggerBackgroundTempCleanup();

  try {
    const body = (await readJsonBody(req)) as {
      subtitles?: SubtitleItem[];
      targetLanguage?: string;
    };
    const subtitles: SubtitleItem[] = body.subtitles || [];
    const targetLanguage = (body.targetLanguage as string) || 'th';

    if (!subtitles || subtitles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No subtitle items provided for SRT translation.' },
        { status: 400 }
      );
    }

    const langName = targetLanguage === 'th' ? 'Thai' : targetLanguage;
    const results: SubtitleItem[] = [];

    // Translate in batches so long subtitle lists never hit prompt/output limits
    for (let i = 0; i < subtitles.length; i += BATCH_SIZE) {
      const batch = subtitles.slice(i, i + BATCH_SIZE);

      const prompt = `You are a Professional Subtitle Translator.
Your task is to translate the originalText of each subtitle item into natural, high-quality ${langName}.

CRITICAL REQUIREMENTS:
1. Preserve exact id, startTime, and endTime for every subtitle item verbatim (format "HH:MM:SS.mmm").
2. Store the original text in originalText and the newly translated text in translatedText.
3. Keep the output strictly in the requested JSON schema array format.

Input Subtitles to Translate:
${JSON.stringify(batch, null, 2)}`;

      const raw = await requestJSON<
        { id: string; startTime: string | number; endTime: string | number; originalText: string; translatedText: string }[]
      >({
        prompt,
        schema: SUBTITLE_ARRAY_SCHEMA,
        signal: req.signal,
      });

      for (const item of raw || []) {
        results.push({
          id: item.id,
          startTime: parseTimestampToSeconds(item.startTime),
          endTime: parseTimestampToSeconds(item.endTime),
          originalText: String(item.originalText || '').trim(),
          translatedText: String(item.translatedText || '').trim(),
        });
      }
    }

    return NextResponse.json({
      success: true,
      subtitles: sanitizeAndFixOverlaps(results),
    });
  } catch (error: unknown) {
    console.error('Error translating SRT:', error);
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json(
      {
        success: false,
        error: (error instanceof Error ? error.message : String(error)) || 'An error occurred during SRT translation.',
      },
      { status }
    );
  }
}
