import { NextRequest, NextResponse } from 'next/server';
import { cleanExpiredTempFiles } from '@/lib/tempCleaner';

export const dynamic = 'force-dynamic';

/**
 * The cleanup sweep is a maintenance operation. When CRON_SECRET is set in
 * the environment, callers must present it (Authorization: Bearer <secret>
 * or ?secret=<secret>). When unset (local development) the endpoint stays
 * open so existing workflows keep working.
 */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;

  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.replace(/^Bearer\s+/i, '').trim();
  const provided = bearer || req.nextUrl.searchParams.get('secret');
  return provided === secret;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }

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
