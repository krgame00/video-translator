import { NextRequest, NextResponse } from 'next/server';
import { processVideoSubtitlesFromStream } from '@/lib/geminiVideoService';
import { assertContentLength, HttpError } from '@/lib/security';

export const maxDuration = 300; // Allow up to 5 minutes for video processing

export async function POST(req: NextRequest) {
  try {
    assertContentLength(req);

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const targetLanguage = (formData.get('targetLanguage') as string) || 'th';

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No video/audio file provided.' },
        { status: 400 }
      );
    }

    // Stream file contents directly to disk to consume near-zero Node memory
    const subtitles = await processVideoSubtitlesFromStream(
      file.stream() as unknown as ReadableStream<Uint8Array>,
      file.type || 'video/mp4',
      file.name,
      targetLanguage,
      req.signal
    );

    return NextResponse.json({
      success: true,
      subtitles,
    });
  } catch (error: unknown) {
    console.error('Error processing video subtitles:', error);
    const errMessage = error instanceof Error ? error.message : String(error);
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json(
      {
        success: false,
        error: errMessage || 'An unexpected error occurred during processing.',
      },
      { status }
    );
  }
}
