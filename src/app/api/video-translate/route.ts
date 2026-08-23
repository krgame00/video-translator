import { NextRequest, NextResponse } from 'next/server';
import { processVideoSubtitlesFromStream } from '@/lib/geminiVideoService';
import { assertContentLength, HttpError, createRateLimiter, getClientIp } from '@/lib/security';

// Each request uploads a full media file to Gemini — expensive. Guard quota.
const translateLimiter = createRateLimiter({ windowMs: 60_000, max: 3 });

export const maxDuration = 300; // Allow up to 5 minutes for video processing

export async function POST(req: NextRequest) {
  try {
    translateLimiter(getClientIp(req));
    assertContentLength(req);

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      throw new HttpError(400, 'Request body must be multipart/form-data with a "file" field.');
    }
    const file = formData.get('file') as File | null;
    const targetLanguage = (formData.get('targetLanguage') as string) || 'th';

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No video/audio file provided.' },
        { status: 400 }
      );
    }

    // Light media type check (extension fallback for empty MIME on some clients)
    const looksLikeMedia = file.type.startsWith('video/') || file.type.startsWith('audio/');
    if (!looksLikeMedia && !/\.(mp4|mov|mkv|webm|avi|m4v|mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(file.name)) {
      return NextResponse.json(
        { success: false, error: 'Unsupported file type. Only video/audio files are accepted.' },
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
