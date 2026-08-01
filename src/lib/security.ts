import * as path from 'path';
import * as os from 'os';
import { SubtitleStyle } from './types';

const JOB_ID_RE = /^hs_[a-zA-Z0-9]{1,40}$/;

/**
 * Export job IDs are server-generated as `hs_<timestamp>_<random>`.
 * Reject anything else before it is used in file paths or shell commands.
 */
export function isSafeJobId(id: string | null | undefined): id is string {
  return typeof id === 'string' && JOB_ID_RE.test(id);
}

/**
 * Resolves a plain file name inside the OS temp directory and rejects
 * anything that would escape it (path traversal defense in depth).
 */
export function resolveTempPath(name: string): string {
  const base = path.basename(name);
  if (base !== name) {
    throw new Error('Invalid temp file name.');
  }
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  const resolved = path.resolve(os.tmpdir(), base);
  if (!resolved.startsWith(tempRoot)) {
    throw new Error('Temp file path escapes temp directory.');
  }
  return resolved;
}

const DEFAULT_STYLE: SubtitleStyle = {
  fontName: 'Itim',
  fontSize: 22,
  primaryColor: 'FFFFFF',
  outlineColor: '000000',
  backColor: '000000',
  borderStyle: 4,
  marginV: 30,
};

function clampInt(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * Whitelist-validates client-supplied subtitle style values.
 * Invalid fields fall back to defaults instead of throwing, so a crafted
 * `fontName`/`primaryColor` can never break out of the FFmpeg filter string.
 */
export function sanitizeStyle(raw: unknown): SubtitleStyle {
  const style: SubtitleStyle = { ...DEFAULT_STYLE };
  if (!raw || typeof raw !== 'object') return style;

  const o = raw as Record<string, unknown>;

  if (typeof o.fontName === 'string' && /^[A-Za-z0-9 _-]{1,64}$/.test(o.fontName)) {
    style.fontName = o.fontName;
  }

  const fontSize = clampInt(o.fontSize, 10, 60);
  if (fontSize !== undefined) style.fontSize = fontSize;

  for (const key of ['primaryColor', 'outlineColor', 'backColor'] as const) {
    if (typeof o[key] === 'string' && /^[0-9A-Fa-f]{6}$/.test(o[key])) {
      style[key] = o[key];
    }
  }

  if (o.borderStyle === 1 || o.borderStyle === 4) {
    style.borderStyle = o.borderStyle;
  }

  const marginV = clampInt(o.marginV, 0, 200);
  if (marginV !== undefined) style.marginV = marginV;

  return style;
}

/** Maximum accepted upload size in bytes (default 1 GB, override via MAX_UPLOAD_BYTES env). */
export const MAX_UPLOAD_BYTES = (() => {
  const raw = process.env.MAX_UPLOAD_BYTES;
  if (!raw) return 1024 * 1024 * 1024;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1024 * 1024 * 1024;
})();

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

interface BodyLike {
  headers: Headers;
  text(): Promise<string>;
}

export function assertContentLength(req: BodyLike): void {
  const raw = req.headers.get('content-length');
  if (!raw) return;
  const size = parseInt(raw, 10);
  if (Number.isFinite(size) && size > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, 'Upload exceeds the maximum allowed size.');
  }
}

export async function readJsonBody(
  req: BodyLike,
  maxBytes: number = 10 * 1024 * 1024
): Promise<unknown> {
  const raw = req.headers.get('content-length');
  if (raw) {
    const size = parseInt(raw, 10);
    if (Number.isFinite(size) && size > maxBytes) {
      throw new HttpError(413, 'Request body exceeds the maximum allowed size.');
    }
  }
  const text = await req.text();
  if (text.length > maxBytes) {
    throw new HttpError(413, 'Request body exceeds the maximum allowed size.');
  }
  return JSON.parse(text);
}

export function getClientIp(req: { headers: Headers }): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim() || 'unknown';
  return req.headers.get('x-real-ip') || 'unknown';
}

/** Light in-memory per-key rate limiter (guards Gemini quota from casual abuse). */
export function createRateLimiter(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (key: string): void => {
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || rec.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      return;
    }
    rec.count += 1;
    if (rec.count > opts.max) {
      throw new HttpError(429, 'Too many requests. Please try again later.');
    }
  };
}
