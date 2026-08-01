import { NextRequest, NextResponse } from 'next/server';
import { processVideoSubtitlesFromStream } from '@/lib/geminiVideoService';
import { triggerBackgroundTempCleanup } from '@/lib/tempCleaner';
import { assertContentLength, HttpError } from '@/lib/security';

export const maxDuration = 300; // 5 minutes per chunk request

export async function POST(req: NextRequest) {
  triggerBackgroundTempCleanup();
  try {
    assertContentLength(req);

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const targetLanguage = (formData.get('targetLanguage') as string) || 'th';
    const chunkIndex = parseInt((formData.get('chunkIndex') as string) || '0', 10);
    const chunkStartTime = parseFloat((formData.get('chunkStartTime') as string) || '0');

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No audio chunk file provided.' },
        { status: 400 }
      );
    }

    const subtitles = await processVideoSubtitlesFromStream(
      file.stream() as unknown as ReadableStream<Uint8Array>,
      file.type || 'audio/wav',
      file.name || `chunk_${chunkIndex}.wav`,
      targetLanguage,
      req.signal
    );

    return NextResponse.json({
      success: true,
      chunkIndex,
      chunkStartTime,
      subtitles,
    });
  } catch (error: unknown) {
    console.error('Error processing audio chunk:', error);
    const errMessage = error instanceof Error ? error.message : String(error);
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json(
      {
        success: false,
        error: errMessage || 'Error processing audio chunk.',
      },
      { status }
    );
  }
}
