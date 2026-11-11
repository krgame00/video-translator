import { NextRequest, NextResponse } from 'next/server';
import { SubtitleItem } from '@/lib/types';
import { requestJSON, SUBTITLE_ARRAY_SCHEMA } from '@/lib/geminiClient';
import { triggerBackgroundTempCleanup } from '@/lib/tempCleaner';
import { readJsonBody, HttpError, createRateLimiter, getClientIp } from '@/lib/security';
import { hasLanguageLeakage, sanitizeForeignNoise } from '@/lib/languageCheck';

export const maxDuration = 300;

const fixLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
const BATCH_SIZE = 50;

export async function POST(req: NextRequest) {
  triggerBackgroundTempCleanup();

  try {
    fixLimiter(getClientIp(req));

    const body = (await readJsonBody(req)) as {
      subtitles?: SubtitleItem[];
      targetLanguage?: string;
    };
    const subtitles: SubtitleItem[] = body.subtitles || [];
    const targetLanguage = (body.targetLanguage as string) || 'th';

    if (!subtitles || subtitles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No subtitles provided.' },
        { status: 400 }
      );
    }

    const leakedIndices = subtitles
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.translatedText.trim().length > 0 && hasLanguageLeakage(item.translatedText, targetLanguage));

    if (leakedIndices.length === 0) {
      // All items are already clean
      return NextResponse.json({
        success: true,
        fixedCount: 0,
        message: 'ไม่พบข้อความภาษาอื่นหลุด ทุกบรรทัดถูกต้องแล้ว',
        subtitles,
      });
    }

    const langMap: Record<string, { name: string; local: string }> = {
      th: { name: 'Thai', local: 'ภาษาไทย' },
      en: { name: 'English', local: 'English' },
      ja: { name: 'Japanese', local: '日本語' },
      zh: { name: 'Chinese', local: '中文' },
      ko: { name: 'Korean', local: '한국어' },
    };
    const langConfig = langMap[targetLanguage] || { name: targetLanguage, local: targetLanguage };

    const fixedItemsMap = new Map<string, string>();
    const failedBatches: number[] = [];

    for (let i = 0; i < leakedIndices.length; i += BATCH_SIZE) {
      const batch = leakedIndices.slice(i, i + BATCH_SIZE).map(({ item }) => ({
        id: item.id,
        startTime: item.startTime,
        endTime: item.endTime,
        originalText: item.originalText,
        translatedText: item.translatedText,
      }));

      const prompt = `You are a World-Class Subtitle Language Specialist.
The following subtitle items have foreign language leakage (untranslated Japanese kana/kanji, English words, Chinese characters, or non-${langConfig.name} text) in their 'translatedText'.
Fix and translate every single item's 'translatedText' into 100% PURE, NATURAL ${langConfig.name} (${langConfig.local}).

CRITICAL REPAIR RULES:
1. Every character in 'translatedText' MUST be in ${langConfig.name} (${langConfig.local}).
2. Transliterate all character names, places, and titles phonetically into ${langConfig.name} script (e.g. เรมิเอล, เซนไป, ยามาดะ).
3. Translate all moans, cries, sighs, gasps, and emotional interjections into natural ${langConfig.name} words (e.g. อ่า..., อือ..., เฮือก, ไม่นะ).
4. ABSOLUTELY NO Japanese characters (Kanji, Hiragana, Katakana), Chinese characters, Korean hangul, or English words in 'translatedText'.
5. Keep id, startTime, endTime, and originalText unchanged. Output valid JSON array.

Input Subtitles to Repair:
${JSON.stringify(batch, null, 2)}`;

      try {
        const raw = await requestJSON<
          { id: string; startTime: string | number; endTime: string | number; originalText: string; translatedText: string }[]
        >({
          prompt,
          schema: SUBTITLE_ARRAY_SCHEMA,
          signal: req.signal,
        });

        for (const item of raw || []) {
          const cleanText = sanitizeForeignNoise(String(item.translatedText || '').trim(), targetLanguage);
          fixedItemsMap.set(item.id, cleanText);
        }
      } catch (batchErr) {
        console.error(`Fix leakage batch ${i} failed:`, batchErr);
        failedBatches.push(i);
      }
    }

    // Merge repaired items back into original array
    let updatedSubtitles = subtitles.map((sub) => {
      if (fixedItemsMap.has(sub.id)) {
        return {
          ...sub,
          translatedText: fixedItemsMap.get(sub.id) || sub.translatedText,
        };
      }
      return sub;
    });

    // Run final safety net sanitization
    updatedSubtitles = updatedSubtitles.map((sub) => ({
      ...sub,
      translatedText: sanitizeForeignNoise(sub.translatedText, targetLanguage),
    }));

    return NextResponse.json({
      success: true,
      fixedCount: fixedItemsMap.size,
      partial: failedBatches.length > 0,
      subtitles: updatedSubtitles,
    });
  } catch (error: unknown) {
    console.error('Error fixing language leakage:', error);
    const errMessage = error instanceof Error ? error.message : String(error);
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json(
      {
        success: false,
        error: errMessage || 'An error occurred during language leakage repair.',
      },
      { status }
    );
  }
}
