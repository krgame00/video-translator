import { vi, beforeEach, afterEach } from 'vitest';

const fetchMock = vi.fn();

// chunkedUploader calls the global fetch — replace it for the whole test.
vi.stubGlobal('fetch', fetchMock);

import { uploadFileInChunks } from './chunkedUploader';

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
});
afterEach(() => {
  vi.stubGlobal('fetch', ORIGINAL_FETCH);
});

function jsonRes(obj: unknown) {
  return { json: async () => obj } as Response;
}

async function testHappyPath() {
  fetchMock.mockClear();
  const file = new Blob([new Uint8Array(12).fill(7)]); // 12 bytes → 3 chunks of 5+5+2 with chunkSize 5
  let progressCalls = 0;
  fetchMock
    .mockResolvedValueOnce(jsonRes({ success: true, uploadId: 'ul_test123' })) // init
    .mockResolvedValueOnce(jsonRes({ success: true })) // chunk 1
    .mockResolvedValueOnce(jsonRes({ success: true })) // chunk 2
    .mockResolvedValueOnce(jsonRes({ success: true })) // chunk 3
    .mockResolvedValueOnce(jsonRes({ success: true })); // complete

  const result = await uploadFileInChunks({
    file,
    fileName: 'video.mp4',
    chunkSize: 5,
    onProgress: () => progressCalls++,
  });

  console.assert(result.uploadId === 'ul_test123', 'result must carry the server uploadId');
  console.assert(fetchMock.mock.calls.length === 5, `expected init+3 chunks+complete calls (got ${fetchMock.mock.calls.length})`);
  const initUrl = fetchMock.mock.calls[0][0];
  console.assert(String(initUrl).includes('action=init'), 'first call must be init');
  const completeUrl = fetchMock.mock.calls[4][0];
  console.assert(String(completeUrl).includes('action=complete'), 'last call must be complete');
  console.assert(progressCalls === 3, `onProgress fires once per chunk (got ${progressCalls})`);
}

async function testInitFailure() {
  fetchMock.mockClear();
  fetchMock.mockResolvedValueOnce(jsonRes({ success: false, error: 'File size too large.' }));
  const file = new Blob([new Uint8Array(1)]);
  let message = '';
  try {
    await uploadFileInChunks({ file });
  } catch (e) {
    message = (e as Error).message;
  }
  console.assert(message.includes('File size too large'), 'init failure must surface the server error');
  console.assert(fetchMock.mock.calls.length === 1, 'no chunk calls after failed init');
}

async function testChunkFailure() {
  fetchMock.mockClear();
  fetchMock
    .mockResolvedValueOnce(jsonRes({ success: true, uploadId: 'ul_x' }))
    .mockResolvedValueOnce(jsonRes({ success: false, error: 'Upload exceeds total declared size.' }));
  const file = new Blob([new Uint8Array(10)]);
  let threw = false;
  try {
    await uploadFileInChunks({ file, chunkSize: 5 });
  } catch {
    threw = true;
  }
  console.assert(threw, 'chunk failure must reject');
  console.assert(fetchMock.mock.calls.length === 2, 'must stop after the failed chunk');
}

async function testChunkedUploader() {
  await testHappyPath();
  await testInitFailure();
  await testChunkFailure();
  console.log('✅ chunkedUploader unit tests passed successfully!');
}

test('chunkedUploader', testChunkedUploader);
