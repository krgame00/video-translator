import { NextRequest, NextResponse } from 'next/server';
import { processVideoSubtitlesFromStream } from '@/lib/geminiVideoService';

export async function POST(req: NextRequest) {
  try {
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
      file.stream() as any,
      file.type || 'video/mp4',
      file.name,
      targetLanguage
    );

    return NextResponse.json({
      success: true,
      subtitles,
    });
  } catch (error: any) {
    console.error('Error processing video subtitles:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'An unexpected error occurred during processing.',
      },
      { status: 500 }
    );
  }
}
