import * as fs from 'fs';
import { HttpError } from './security';

export interface PumpResult {
  bytesWritten: number;
}

/**
 * Pumps a Web ReadableStream reader into a Node write stream with:
 * - an enforced byte cap (rejects chunked-transfer bodies that would bypass
 *   content-length checks), and
 * - a write-stream 'error' listener so ENOSPC/EIO rejects the returned promise
 *   instead of crashing the process as an unhandled 'error' event.
 *
 * The caller is responsible for destroying the stream on failure.
 */
export async function pumpToWriteStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  stream: fs.WriteStream,
  maxBytes: number
): Promise<PumpResult> {
  let bytesWritten = 0;
  let streamFailure: Error | null = null;

  const failed = new Promise<never>((_, reject) => {
    stream.on('error', (err: Error) => {
      streamFailure = err;
      reject(err);
    });
  });

  async function pump(): Promise<void> {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), failed]);
      if (done) break;
      if (!value) continue;
      bytesWritten += value.length;
      if (bytesWritten > maxBytes) {
        throw new HttpError(413, 'Upload exceeds the maximum allowed size.');
      }
      if (!stream.write(value)) {
        // Backpressure: wait for the stream to drain before reading more.
        await new Promise<void>((resolve) => stream.once('drain', resolve));
      }
      if (streamFailure) throw streamFailure;
    }
  }

  try {
    await Promise.race([pump(), failed]);
  } finally {
    failed.catch(() => {}); // mark the rejection handled; errors propagate via pump/race
  }

  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve());
    stream.on('error', reject);
  });

  return { bytesWritten };
}
