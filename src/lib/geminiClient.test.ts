import { vi, beforeEach, afterEach } from 'vitest';

// Mock @google/genai with a controllable generateContent so retry policy can
// be tested without network access or real API keys.
const generateContentMock = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = { generateContent: generateContentMock };
    },
    Type: {
      ARRAY: 'ARRAY',
      OBJECT: 'OBJECT',
      STRING: 'STRING',
      NUMBER: 'NUMBER',
    },
  };
});

import { requestJSON } from './geminiClient';

const SCHEMA = { type: 'ARRAY' } as never;
const OK_BODY = [{ id: '1', startTime: '00:00:01.000', endTime: '00:00:02.000', originalText: 'hi', translatedText: 'สวัสดี' }];

function errWithStatus(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

const ORIGINAL_KEY = process.env.GEMINI_API_KEY;

beforeEach(() => {
  generateContentMock.mockReset();
  process.env.GEMINI_API_KEY = 'test-key-aaaaaaaaaa,test-key-bbbbbbbbbb';
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_KEY;
});

test('requestJSON returns parsed JSON on the first successful model', async () => {
  generateContentMock.mockResolvedValueOnce({ text: JSON.stringify(OK_BODY) });

  const result = await requestJSON<typeof OK_BODY>({
    prompt: 'test',
    schema: SCHEMA,
    initialRetryDelayMs: 1,
  });

  if (result.length !== 1 || result[0].translatedText !== 'สวัสดี') {
    throw new Error('expected parsed subtitle array');
  }
  if (generateContentMock.mock.calls.length !== 1) {
    throw new Error(`expected exactly 1 API call, got ${generateContentMock.mock.calls.length}`);
  }
});

test('requestJSON aborts immediately on non-retryable 400 (no quota burn)', async () => {
  generateContentMock.mockRejectedValue(errWithStatus(400, 'INVALID_ARGUMENT: bad prompt'));

  let threw = false;
  try {
    await requestJSON({ prompt: 'bad', schema: SCHEMA, initialRetryDelayMs: 1 });
  } catch (e) {
    threw = (e as Error).message.includes('INVALID_ARGUMENT');
  }
  if (!threw) throw new Error('expected the 400 error to propagate');
  // Must NOT have burned every key × model after a request-level failure.
  if (generateContentMock.mock.calls.length !== 1) {
    throw new Error(`expected exactly 1 API call on 400, got ${generateContentMock.mock.calls.length}`);
  }
});

test('requestJSON retries retryable 429 with backoff and succeeds on the next model', async () => {
  generateContentMock
    .mockRejectedValueOnce(errWithStatus(429, 'RESOURCE_EXHAUSTED'))
    .mockResolvedValueOnce({ text: JSON.stringify(OK_BODY) });

  const result = await requestJSON<typeof OK_BODY>({
    prompt: 'test',
    schema: SCHEMA,
    initialRetryDelayMs: 1,
  });

  if (result.length !== 1) throw new Error('expected success after one retry');
  if (generateContentMock.mock.calls.length !== 2) {
    throw new Error(`expected 2 API calls (1 fail + 1 success), got ${generateContentMock.mock.calls.length}`);
  }
});

test('requestJSON skips to the next API key on 403 key-level errors', async () => {
  generateContentMock
    .mockRejectedValueOnce(errWithStatus(403, 'API_KEY_INVALID'))
    .mockResolvedValueOnce({ text: JSON.stringify(OK_BODY) });

  const result = await requestJSON<typeof OK_BODY>({
    prompt: 'test',
    schema: SCHEMA,
    initialRetryDelayMs: 1,
  });

  if (result.length !== 1) throw new Error('expected success on the second key');
  if (generateContentMock.mock.calls.length !== 2) {
    throw new Error(`expected 2 API calls (1 key-level fail + 1 success), got ${generateContentMock.mock.calls.length}`);
  }
});
