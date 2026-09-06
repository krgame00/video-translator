import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { SubtitleStyle } from './types';
import { env } from './env';

const JOB_ID_RE = /^hs_[a-zA-Z0-9_]{1,40}$/;
const UPLOAD_ID_RE = /^ul_[a-zA-Z0-9_]{1,40}$/;

/**
 * Single source of truth for the temp directory used by uploads, export jobs,
 * the Gemini pipeline, and the temp cleaner. Falls back to os.tmpdir() when
 * TEMP_DIR is unset or does not exist so all subsystems always agree.
 */
export function getTempRoot(): string {
  const custom = env.tempDir;
  if (custom && fs.existsSync(custom)) {
    return path.resolve(custom);
  }
  return path.resolve(os.tmpdir());
}

/**
 * Export job IDs are server-generated as `hs_<32 hex chars>` (128 bits of
 * entropy). Reject anything else before it is used in file paths.
 */
export function isSafeJobId(id: string | null | undefined): id is string {
  return typeof id === 'string' && JOB_ID_RE.test(id);
}

/**
 * Upload IDs are server-generated as `ul_<32 hex chars>`.
 */
export function isSafeUploadId(id: string | null | undefined): id is string {
  return typeof id === 'string' && UPLOAD_ID_RE.test(id);
}

/** Generates an unguessable job ID (`hs_` + 128 random bits as hex). */
export function generateJobId(): string {
  return `hs_${crypto.randomBytes(16).toString('hex')}`;
}

/** Generates an unguessable upload ID (`ul_` + 128 random bits as hex). */
export function generateUploadId(): string {
  return `ul_${crypto.randomBytes(16).toString('hex')}`;
}

/** File extensions accepted for video/audio uploads. */
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus',
]);

/**
 * Light filename validation for uploads: only plain names with a known
 * media extension are accepted (defense in depth; not magic-byte sniffing).
 */
export function isAllowedUploadFileName(fileName: string): boolean {
  if (!fileName || fileName.length > 255 || fileName.includes('\0')) return false;
  const ext = path.extname(fileName).toLowerCase();
  return ALLOWED_UPLOAD_EXTENSIONS.has(ext);
}

/**
 * Resolves a plain file name inside the shared temp directory and rejects
 * anything that would escape it (path traversal defense in depth).
 */
export function resolveTempPath(name: string): string {
  const base = path.basename(name);
  if (base !== name) {
    throw new Error('Invalid temp file name.');
  }
  const tempRoot = getTempRoot() + path.sep;
  const resolved = path.resolve(getTempRoot(), base);
  if (!resolved.startsWith(tempRoot)) {
    throw new Error('Temp file path escapes temp directory.');
  }
  return resolved;
}

const DEFAULT_STYLE: SubtitleStyle = {
  fontName: 'Itim',
  fontSize: 22,
  primaryColor: 'FFFFFF',
  borderStyle: 1,
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

  for (const key of ['primaryColor'] as const) {
    if (typeof o[key] === 'string' && /^[0-9A-Fa-f]{6}$/.test(o[key])) {
      style[key] = o[key];
    }
  }

  if (o.borderStyle === 1 || o.borderStyle === 4) {
    style.borderStyle = o.borderStyle;
  }

  const marginV = clampInt(o.marginV, 0, 200);
  if (marginV !== undefined) style.marginV = marginV;

  if (o.position === 'top' || o.position === 'middle' || o.position === 'bottom') {
    style.position = o.position;
  }

  return style;
}

export interface PrepareOptions {
  playResX?: number;
  playResY?: number;
  karaoke: boolean;
  highlightColor?: string;
}

/**
 * Whitelist-validates the ASS burn options sent alongside `prepare`.
 * playRes dimensions clamp to sane video sizes; highlightColor must be hex.
 */
export function sanitizePrepareOptions(raw: unknown): PrepareOptions {
  const out: PrepareOptions = { karaoke: false };
  if (!raw || typeof raw !== 'object') return out;

  const o = raw as Record<string, unknown>;
  const playResX = clampInt(o.playResX, 100, 8000);
  if (playResX !== undefined) out.playResX = playResX;
  const playResY = clampInt(o.playResY, 100, 8000);
  if (playResY !== undefined) out.playResY = playResY;

  out.karaoke = o.karaoke === true;

  if (typeof o.highlightColor === 'string' && /^[0-9A-Fa-f]{6}$/.test(o.highlightColor)) {
    out.highlightColor = o.highlightColor.toUpperCase();
  }

  return out;
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
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON.');
  }
}

export function getClientIp(req: { headers: Headers }): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim() || 'unknown';
  return req.headers.get('x-real-ip') || 'unknown';
}

/**
 * Light in-memory per-key rate limiter (guards Gemini quota from casual abuse).
 * Stale entries are evicted once the map grows so long-lived processes do not
 * leak memory across many distinct client IPs.
 */
export function createRateLimiter(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (key: string): void => {
    const now = Date.now();
    if (hits.size > 1000) {
      for (const [k, rec] of hits) {
        if (rec.resetAt < now) hits.delete(k);
      }
    }
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
