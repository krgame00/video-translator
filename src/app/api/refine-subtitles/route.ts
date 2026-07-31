import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { SubtitleItem } from '@/lib/types';

function getApiKeys(): string[] {
  const raw = process.env.GEMINI_API_KEY || '';
  const keys = raw.split(',').map((k) => k.trim()).filter((k) => k.length > 0);
  if (keys.length === 0) {
    throw new Error('GEMINI_API_KEY environment variable is missing.');
  }
  return keys;
}

const modelsToTry = [
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

const STYLE_PROMPTS: Record<string, string> = {
  anime: 'Refine the Thai translated subtitles into emotional, expressive Anime/Manga style spoken Thai dialogue (สำนวนอนิเมะ/มังงะ สนุกสนาน มีอารมณ์ร่วม ธรรมชาติ).',
  business: 'Refine the Thai translated subtitles into professional, polite, formal business Thai suitable for presentations and meetings (ภาษาทางการ สุภาพ เหมาะสำหรับงานนำเสนอ).',
  vlog: 'Refine the Thai translated subtitles into friendly, casual, conversational vlog-style spoken Thai (ภาษาพูดสบายๆ เป็นกันเอง สนิทสนม).',
  academic: 'Refine the Thai translated subtitles into grammatically precise, formal academic written Thai (ภาษาเขียนถูกต้องตามหลักไวยากรณ์และความหมายเชิงวิชาการ).',
  shorts: 'Refine and condense the Thai translated subtitles into ultra-concise, punchy, fast-reading short summaries (ย่อความ สรุปสั้น กระชับ อิมแพ็กสูง อ่านจบใน 1-2 วินาที เหมาะสำหรับคลิปสั้น TikTok/Reels/Shorts).',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const subtitles: SubtitleItem[] = body.subtitles || [];
    const style = (body.style as string) || 'anime';

    if (!subtitles || subtitles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No subtitles provided for refinement.' },
        { status: 400 }
      );
    }

    const apiKeys = getApiKeys();
    const promptInstruction = STYLE_PROMPTS[style] || STYLE_PROMPTS.anime;

    const prompt = `You are a World-Class Professional Subtitle Proofreader & Editor.
${promptInstruction}

CRITICAL RULES:
1. Preserve exact id, startTime, endTime, and originalText for every subtitle item verbatim.
2. Improve translatedText to perfectly match the requested style preset.
3. Keep the output strictly in the requested JSON schema array format.

Input Subtitles to Refine:
${JSON.stringify(subtitles, null, 2)}`;

    let lastError: unknown = null;

    for (const apiKey of apiKeys) {
      const ai = new GoogleGenAI({ apiKey });

      for (const modelName of modelsToTry) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
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

          const responseText = response.text;
          if (!responseText) {
            throw new Error('Gemini API returned an empty response.');
          }

          const refinedSubtitles: SubtitleItem[] = JSON.parse(responseText);

          return NextResponse.json({
            success: true,
            subtitles: refinedSubtitles,
          });
        } catch (err: unknown) {
          lastError = err;
          const errMessage = err instanceof Error ? err.message : String(err);
          console.warn(`[Refine Subtitles] Attempt failed with model ${modelName}:`, errMessage);
        }
      }
    }

    throw lastError || new Error('All API keys and Gemini models failed or exceeded quota.');
  } catch (error: unknown) {
    console.error('Error refining subtitles:', error);
    const errMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        success: false,
        error: errMessage || 'An error occurred during subtitle refinement.',
      },
      { status: 500 }
    );
  }
}
