import { NextRequest, NextResponse } from 'next/server';
import { cleanExpiredTempFiles } from '@/lib/tempCleaner';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const deletedCount = cleanExpiredTempFiles(3600 * 1000);
    return NextResponse.json({
      success: true,
      message: `Cleaned ${deletedCount} expired temporary file(s) older than 1 hour.`,
      deletedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: errMessage },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
