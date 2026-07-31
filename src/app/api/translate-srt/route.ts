import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { SubtitleItem } from '@/lib/types';
import { triggerBackgroundTempCleanup } from '@/lib/tempCleaner';

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

export async function POST(req: NextRequest) {
  triggerBackgroundTempCleanup();

  try {
    const body = await req.json();
    const subtitles: SubtitleItem[] = body.subtitles || [];
    const targetLanguage = (body.targetLanguage as string) || 'th';

    if (!subtitles || subtitles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No subtitle items provided for SRT translation.' },
        { status: 400 }
      );
    }

    const apiKeys = getApiKeys();
    const langName = targetLanguage === 'th' ? 'Thai' : targetLanguage;

    const prompt = `You are a Professional Subtitle Translator.
Your task is to translate the originalText of each subtitle item into natural, high-quality ${langName}.

CRITICAL REQUIREMENTS:
1. Preserve exact id, startTime, and endTime for every subtitle item verbatim.
2. Store the original text in originalText and the newly translated text in translatedText.
3. Keep the output strictly in the requested JSON schema array format.

Input Subtitles to Translate:
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

          const translatedSubtitles: SubtitleItem[] = JSON.parse(responseText);

          return NextResponse.json({
            success: true,
            subtitles: translatedSubtitles,
          });
        } catch (err: unknown) {
          lastError = err;
          const errMessage = err instanceof Error ? err.message : String(err);
          console.warn(`[SRT Translate] Attempt failed with model ${modelName}:`, errMessage);
        }
      }
    }

    throw lastError || new Error('All API keys and Gemini models failed or exceeded quota.');
  } catch (error: unknown) {
    console.error('Error translating SRT:', error);
    return NextResponse.json(
      {
        success: false,
        error: (error instanceof Error ? error.message : String(error)) || 'An error occurred during SRT translation.',
      },
      { status: 500 }
    );
  }
}
