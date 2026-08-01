import { NextRequest, NextResponse } from 'next/server';
import { SubtitleItem } from '@/lib/types';
import { requestJSON, SUBTITLE_ARRAY_SCHEMA } from '@/lib/geminiClient';
import { readJsonBody, HttpError } from '@/lib/security';
import { parseTimestampToSeconds, sanitizeAndFixOverlaps } from '@/lib/srtFormatter';

export const maxDuration = 300; // Allow up to 5 minutes for large refinement batches

const BATCH_SIZE = 100;

const STYLE_PROMPTS: Record<string, string> = {
  anime: 'Refine the Thai translated subtitles into emotional, expressive Anime/Manga style spoken Thai dialogue (สำนวนอนิเมะ/มังงะ สนุกสนาน มีอารมณ์ร่วม ธรรมชาติ).',
  business: 'Refine the Thai translated subtitles into professional, polite, formal business Thai suitable for presentations and meetings (ภาษาทางการ สุภาพ เหมาะสำหรับงานนำเสนอ).',
  vlog: 'Refine the Thai translated subtitles into friendly, casual, conversational vlog-style spoken Thai (ภาษาพูดสบายๆ เป็นกันเอง สนิทสนม).',
  academic: 'Refine the Thai translated subtitles into grammatically precise, formal academic written Thai (ภาษาเขียนถูกต้องตามหลักไวยากรณ์และความหมายเชิงวิชาการ).',
  shorts: 'Refine and condense the Thai translated subtitles into ultra-concise, punchy, fast-reading short summaries (ย่อความ สรุปสั้น กระชับ อิมแพ็กสูง อ่านจบใน 1-2 วินาที เหมาะสำหรับคลิปสั้น TikTok/Reels/Shorts).',
};

export async function POST(req: NextRequest) {
  try {
    const body = (await readJsonBody(req)) as {
      subtitles?: SubtitleItem[];
      style?: string;
    };
    const subtitles: SubtitleItem[] = body.subtitles || [];
    const style = (body.style as string) || 'anime';

    if (!subtitles || subtitles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No subtitles provided for refinement.' },
        { status: 400 }
      );
    }

    const promptInstruction = STYLE_PROMPTS[style] || STYLE_PROMPTS.anime;
    const results: SubtitleItem[] = [];

    // Refine in batches so long subtitle lists never hit prompt/output limits
    for (let i = 0; i < subtitles.length; i += BATCH_SIZE) {
      const batch = subtitles.slice(i, i + BATCH_SIZE);

      const prompt = `You are a World-Class Professional Subtitle Proofreader & Editor.
${promptInstruction}

CRITICAL RULES:
1. Preserve exact id, startTime, endTime, and originalText for every subtitle item verbatim (format "HH:MM:SS.mmm").
2. Improve translatedText to perfectly match the requested style preset.
3. Keep the output strictly in the requested JSON schema array format.

Input Subtitles to Refine:
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
    console.error('Error refining subtitles:', error);
    const errMessage = error instanceof Error ? error.message : String(error);
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json(
      {
        success: false,
        error: errMessage || 'An error occurred during subtitle refinement.',
      },
      { status }
    );
  }
}
