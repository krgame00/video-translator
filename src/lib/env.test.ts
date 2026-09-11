import { beforeEach, afterEach, test, expect } from 'vitest';
import * as os from 'os';
import { validateEnv, env, DEFAULT_MAX_UPLOAD_BYTES, DEFAULT_FFMPEG_TIMEOUT_MS } from './env';

const KEYS = [
  'GEMINI_API_KEY',
  'TEMP_DIR',
  'MAX_UPLOAD_BYTES',
  'FFMPEG_PATH',
  'FFMPEG_HWACCEL',
  'FFMPEG_TIMEOUT_MS',
  'CRON_SECRET',
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  process.env.GEMINI_API_KEY = 'test-key-1, test-key-2';
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test('validateEnv passes with keys only and applies defaults', () => {
  const cfg = validateEnv();
  expect(cfg.MAX_UPLOAD_BYTES).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  expect(cfg.TEMP_DIR).toBeUndefined();
  expect(env.apiKeys).toEqual(['test-key-1', 'test-key-2']);
});

test('validateEnv throws when GEMINI_API_KEY is missing', () => {
  delete process.env.GEMINI_API_KEY;
  expect(() => validateEnv()).toThrow(/GEMINI_API_KEY/);
});

test('validateEnv throws when GEMINI_API_KEY has only blank entries', () => {
  process.env.GEMINI_API_KEY = ' , ,';
  expect(() => validateEnv()).toThrow(/at least one non-empty key/);
});

test('validateEnv throws on non-numeric MAX_UPLOAD_BYTES', () => {
  process.env.MAX_UPLOAD_BYTES = 'not-a-number';
  expect(() => validateEnv()).toThrow(/MAX_UPLOAD_BYTES/);
});

test('validateEnv throws on non-positive MAX_UPLOAD_BYTES', () => {
  process.env.MAX_UPLOAD_BYTES = '-5';
  expect(() => validateEnv()).toThrow(/MAX_UPLOAD_BYTES/);
});

test('validateEnv accepts a valid MAX_UPLOAD_BYTES override', () => {
  process.env.MAX_UPLOAD_BYTES = String(512 * 1024 * 1024);
  expect(validateEnv().MAX_UPLOAD_BYTES).toBe(512 * 1024 * 1024);
  expect(env.maxUploadBytes).toBe(512 * 1024 * 1024);
});

test('validateEnv throws when TEMP_DIR does not exist', () => {
  process.env.TEMP_DIR = '/definitely/not/a/real/dir/xyz123';
  expect(() => validateEnv()).toThrow(/TEMP_DIR/);
});

test('validateEnv passes when TEMP_DIR exists', () => {
  process.env.TEMP_DIR = os.tmpdir();
  expect(validateEnv().TEMP_DIR).toBe(os.tmpdir());
});

test('env.maxUploadBytes falls back to 1 GB on invalid runtime value', () => {
  process.env.MAX_UPLOAD_BYTES = 'garbage';
  expect(env.maxUploadBytes).toBe(DEFAULT_MAX_UPLOAD_BYTES);
});

test('validateEnv applies default FFMPEG_TIMEOUT_MS', () => {
  expect(validateEnv().FFMPEG_TIMEOUT_MS).toBe(DEFAULT_FFMPEG_TIMEOUT_MS);
  expect(env.ffmpegTimeoutMs).toBe(DEFAULT_FFMPEG_TIMEOUT_MS);
});

test('validateEnv throws on non-numeric FFMPEG_TIMEOUT_MS', () => {
  process.env.FFMPEG_TIMEOUT_MS = 'soon';
  expect(() => validateEnv()).toThrow(/FFMPEG_TIMEOUT_MS/);
});

test('validateEnv throws when FFMPEG_TIMEOUT_MS exceeds the 30-minute ceiling', () => {
  process.env.FFMPEG_TIMEOUT_MS = String(31 * 60 * 1000);
  expect(() => validateEnv()).toThrow(/30-minute/);
});

test('validateEnv accepts a valid FFMPEG_TIMEOUT_MS override', () => {
  process.env.FFMPEG_TIMEOUT_MS = String(10 * 60 * 1000);
  expect(validateEnv().FFMPEG_TIMEOUT_MS).toBe(10 * 60 * 1000);
  expect(env.ffmpegTimeoutMs).toBe(10 * 60 * 1000);
});

test('env.ffmpegTimeoutMs falls back to 4 min on invalid runtime value', () => {
  process.env.FFMPEG_TIMEOUT_MS = 'garbage';
  expect(env.ffmpegTimeoutMs).toBe(DEFAULT_FFMPEG_TIMEOUT_MS);
});
