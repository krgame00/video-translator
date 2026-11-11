import { NextRequest, NextResponse } from 'next/server';
import { processVideoSubtitlesFromStream } from '@/lib/geminiVideoService';
import { assertContentLength, HttpError, createRateLimiter, getClientIp } from '@/lib/security';
import { TranslationProgressEvent } from '@/lib/types';

// Each request uploads a full media file to Gemini — expensive. Guard quota.
const translateLimiter = createRateLimiter({ windowMs: 60_000, max: 3 });

export const maxDuration = 600; // Allow up to 10 minutes for full-video multimodal processing

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
    const wordTiming = formData.get('wordTiming') === '1';
    const includeOnScreenText = formData.get('includeOnScreenText') === '1';

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

    const wantsStream = req.headers.get('accept')?.includes('application/x-ndjson');

    if (wantsStream) {
      const encoder = new TextEncoder();
      const transform = new TransformStream<Uint8Array, Uint8Array>();
      const writer = transform.writable.getWriter();

      const emit = async (event: TranslationProgressEvent) => {
        try {
          await writer.write(encoder.encode(JSON.stringify(event) + '\n'));
        } catch {}
      };

      (async () => {
        try {
          const { subtitles, truncated } = await processVideoSubtitlesFromStream(
            file.stream() as unknown as ReadableStream<Uint8Array>,
            file.type || 'video/mp4',
            file.name,
            targetLanguage,
            req.signal,
            wordTiming,
            includeOnScreenText,
            emit
          );
          await emit({ type: 'complete', subtitles, truncated });
        } catch (err: unknown) {
          const errMessage = err instanceof Error ? err.message : String(err);
          await emit({ type: 'error', message: errMessage || 'An unexpected error occurred during processing.' });
        } finally {
          try {
            await writer.close();
          } catch {}
        }
      })();

      return new Response(transform.readable, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        },
      });
    }

    // Stream file contents directly to disk to consume near-zero Node memory
    const { subtitles, truncated } = await processVideoSubtitlesFromStream(
      file.stream() as unknown as ReadableStream<Uint8Array>,
      file.type || 'video/mp4',
      file.name,
      targetLanguage,
      req.signal,
      wordTiming,
      includeOnScreenText
    );

    return NextResponse.json({
      success: true,
      subtitles,
      truncated,
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
