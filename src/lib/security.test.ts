import {
  isSafeJobId,
  isSafeUploadId,
  generateJobId,
  generateUploadId,
  resolveTempPath,
  sanitizeStyle,
  readJsonBody,
  createRateLimiter,
  isAllowedUploadFileName,
  HttpError,
} from './security';
import * as path from 'path';

function testIdSafety() {
  console.assert(isSafeJobId('hs_abc123'), 'well-formed job id should pass');
  console.assert(!isSafeJobId('../etc/passwd'), 'traversal id must be rejected');
  console.assert(!isSafeJobId('hs_../x'), 'embedded traversal must be rejected');
  console.assert(!isSafeJobId(null) && !isSafeJobId(undefined), 'null ids must be rejected');
  console.assert(isSafeUploadId('ul_abc123'), 'well-formed upload id should pass');
  console.assert(!isSafeUploadId('hs_abc123'), 'upload id with job prefix must be rejected');
}

function testGeneratedIdEntropy() {
  for (let i = 0; i < 50; i++) {
    const jobId = generateJobId();
    const uploadId = generateUploadId();
    console.assert(isSafeJobId(jobId), `generated job id must satisfy its own validator (${jobId})`);
    console.assert(isSafeUploadId(uploadId), `generated upload id must satisfy its own validator (${uploadId})`);
    // 128 bits of entropy => 32 hex chars after the prefix
    console.assert(jobId.length === 3 + 32, `job id must carry 32 hex chars of entropy (${jobId})`);
    console.assert(uploadId.length === 3 + 32, `upload id must carry 32 hex chars of entropy (${uploadId})`);
  }
  const ids = new Set(Array.from({ length: 200 }, () => generateJobId()));
  console.assert(ids.size === 200, 'generated ids must be unique');
}

function testResolveTempPath() {
  const p = resolveTempPath('hs_test_file.json');
  console.assert(path.basename(p) === 'hs_test_file.json', 'resolveTempPath should return a temp-dir path');
  let threw = false;
  try { resolveTempPath('nested/hs_file.json'); } catch { threw = true; }
  console.assert(threw, 'nested path must be rejected');
  threw = false;
  try { resolveTempPath('..\\hs_file.json'); } catch { threw = true; }
  console.assert(threw, 'windows traversal must be rejected');
}

function testSanitizeStyle() {
  const def = sanitizeStyle(undefined);
  console.assert(def.fontName === 'Itim' && def.fontSize === 22, 'undefined style falls back to defaults');

  const styled = sanitizeStyle({
    fontName: 'Noto Sans',
    fontSize: 30,
    primaryColor: 'FFFF00',
    borderStyle: 4,
    marginV: 50,
  });
  console.assert(styled.fontName === 'Noto Sans', 'valid fontName accepted');
  console.assert(styled.fontSize === 30, 'valid fontSize accepted');
  console.assert(styled.primaryColor === 'FFFF00', 'valid color accepted');
  console.assert(styled.borderStyle === 4, 'valid borderStyle accepted');

  const evil = sanitizeStyle({
    fontName: 'Itim;rm -rf /',   // shell metacharacters
    fontSize: 9999,               // out of range => clamped, not rejected
    primaryColor: 'ZZZZZZ',       // not hex
    borderStyle: 9,               // not 1 or 4
    marginV: -5,                  // out of range => clamped to 0
  } as never);
  console.assert(evil.fontName === 'Itim', 'malicious fontName must fall back to default');
  console.assert(evil.fontSize === 60, 'out-of-range fontSize must be clamped to the max (60)');
  console.assert(evil.primaryColor === 'FFFFFF', 'non-hex color must fall back to default');
  console.assert(evil.borderStyle === 1, 'invalid borderStyle must fall back to default');
  console.assert(evil.marginV === 0, 'negative marginV must be clamped to 0');
}

function testAllowedUploadFileNames() {
  console.assert(isAllowedUploadFileName('movie.mp4'), 'mp4 allowed');
  console.assert(isAllowedUploadFileName('Song.MP3'), 'case-insensitive extension allowed');
  console.assert(isAllowedUploadFileName('clip.final.mkv'), 'multi-dot name allowed');
  console.assert(!isAllowedUploadFileName('payload.exe'), 'executable must be rejected');
  console.assert(!isAllowedUploadFileName('noext'), 'missing extension must be rejected');
  console.assert(!isAllowedUploadFileName('null\0byte.mp4'), 'null byte must be rejected');
  console.assert(!isAllowedUploadFileName(''), 'empty name must be rejected');
}

function makeBody(text: string, contentLength?: number) {
  const headers = new Headers();
  if (contentLength !== undefined) headers.set('content-length', String(contentLength));
  return { headers, text: async () => text };
}

async function testReadJsonBody() {
  const ok = await readJsonBody(makeBody('{"a":1}')) as { a: number };
  console.assert(ok.a === 1, 'valid JSON body parses');

  let status = 0;
  try { await readJsonBody(makeBody('not json at all')); }
  catch (e) { status = e instanceof HttpError ? e.status : 0; }
  console.assert(status === 400, `malformed JSON must return 400 (got ${status})`);

  status = 0;
  try { await readJsonBody(makeBody('{"a":1}', 999_999_999)); }
  catch (e) { status = e instanceof HttpError ? e.status : 0; }
  console.assert(status === 413, `oversized content-length must return 413 (got ${status})`);
}

function testRateLimiter() {
  const limit = createRateLimiter({ windowMs: 60_000, max: 2 });
  limit('ip1');
  limit('ip1');
  let threw = false;
  try { limit('ip1'); } catch (e) { threw = e instanceof HttpError && e.status === 429; }
  console.assert(threw, 'third hit in the window must throw 429');

  limit('ip2'); // other keys unaffected
}

async function testRateLimiterEviction() {
  const limit = createRateLimiter({ windowMs: 5, max: 1 });
  limit('a');
  let threw = false;
  try { limit('a'); } catch { threw = true; }
  console.assert(threw, 'second hit must be limited inside the window');

  await new Promise((r) => setTimeout(r, 20));

  // Push >1000 distinct keys to trigger the stale-entry sweep
  for (let i = 0; i < 1100; i++) limit(`filler-${i}`);

  let allowed = true;
  try { limit('a'); } catch { allowed = false; }
  console.assert(allowed, 'expired key must be evicted and receive a fresh window');
}

async function testSecurity() {
  testIdSafety();
  testGeneratedIdEntropy();
  testResolveTempPath();
  testSanitizeStyle();
  testAllowedUploadFileNames();
  await testReadJsonBody();
  testRateLimiter();
  await testRateLimiterEviction();
  console.log('✅ security unit tests passed successfully!');
}

test('security', testSecurity);
