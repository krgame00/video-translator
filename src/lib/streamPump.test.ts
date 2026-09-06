import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pumpToWriteStream } from './streamPump';
import { HttpError } from './security';

function readerOf(chunks: Uint8Array[]): ReadableStreamDefaultReader<Uint8Array> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return stream.getReader();
}

async function testNormalWrite() {
  const file = path.join(os.tmpdir(), `pump_ok_${Date.now()}.tmp`);
  const stream = fs.createWriteStream(file);
  const payload = new TextEncoder().encode('hello pump world');
  const result = await pumpToWriteStream(readerOf([payload]), stream, 1024);
  const content = fs.readFileSync(file, 'utf8');
  fs.unlinkSync(file);
  console.assert(content === 'hello pump world', `content must round-trip (got "${content}")`);
  console.assert(result.bytesWritten === payload.length, 'bytesWritten must match payload');
}

async function testByteCap() {
  const file = path.join(os.tmpdir(), `pump_cap_${Date.now()}.tmp`);
  const stream = fs.createWriteStream(file);
  const big = new Uint8Array(600).fill(65);
  let threw = false;
  try {
    await pumpToWriteStream(readerOf([big, big, big]), stream, 1024); // 1800 > 1024
  } catch (e) {
    threw = e instanceof HttpError && e.status === 413;
  }
  stream.destroy();
  if (fs.existsSync(file)) fs.unlinkSync(file);
  console.assert(threw, 'exceeding maxBytes must throw HttpError 413');
}

async function testWriteError() {
  // A stream destroyed with an error must make the pump reject (instead of
  // the process crashing on an unhandled 'error' event).
  const file = path.join(os.tmpdir(), `pump_err_${Date.now()}.tmp`);
  const stream = fs.createWriteStream(file);
  stream.destroy(new Error('boom'));
  const payload = new TextEncoder().encode('x');
  let threw = false;
  try {
    await pumpToWriteStream(readerOf([payload]), stream, 1024);
  } catch {
    threw = true;
  }
  if (fs.existsSync(file)) fs.unlinkSync(file);
  console.assert(threw, 'destroyed write stream must reject the pump promise');
}

async function testStreamPump() {
  await testNormalWrite();
  await testByteCap();
  await testWriteError();
  console.log('✅ streamPump unit tests passed successfully!');
}

test('streamPump', testStreamPump);
