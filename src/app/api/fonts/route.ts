import { NextResponse } from 'next/server';
import { listSubtitleFonts } from '@/lib/fontRegistry';

export const dynamic = 'force-dynamic';

/** Subtitle fonts the hardsub burn can actually render (scans public/fonts). */
export async function GET() {
  const fonts = listSubtitleFonts();
  return NextResponse.json({
    success: true,
    fonts: fonts.map((f) => f.family),
    files: fonts,
  });
}
