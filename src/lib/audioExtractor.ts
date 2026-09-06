export interface AudioChunk {
  chunkIndex: number;
  startTime: number;
  endTime: number;
  blob: Blob;
}

export interface ExtractionResult {
  chunks: AudioChunk[];
  /** Downsampled waveform peaks (≈600 points over the full duration),
   *  computed from the same decode — the Timeline reuses these instead of
   *  re-reading the whole file and decoding a second time. */
  peaks: number[];
}

/** Total waveform resolution shared across all chunks. */
const PEAK_POINTS = 600;

/**
 * Browser-side Web Audio API Audio Extractor
 * Extracts light 16kHz mono WAV audio from any input video/audio file in seconds.
 */
export async function extractAudioFromVideo(file: File): Promise<Blob> {
  if (file.size > 500 * 1024 * 1024) {
    console.warn(`[Audio Extractor] Large file detected (${(file.size / 1024 / 1024).toFixed(0)}MB > 500MB). Client extraction may require significant RAM.`);
  }

  const arrayBuffer = await file.arrayBuffer();
  const dummyCtx = new OfflineAudioContext(1, 16000, 16000);
  const audioBuffer = await dummyCtx.decodeAudioData(arrayBuffer);

  const targetSampleRate = 16000;
  const duration = audioBuffer.duration;
  const targetLength = Math.ceil(duration * targetSampleRate);

  const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const renderedBuffer = await offlineCtx.startRendering();
  return encodeWAV(renderedBuffer.getChannelData(0), targetSampleRate);
}

export async function extractAudioChunks(
  file: File,
  chunkDurationSecs: number = 300
): Promise<ExtractionResult> {
  let audioBuffer: AudioBuffer;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const webkitOfflineCtx = (window as typeof window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    const dummyCtx = new (window.OfflineAudioContext || webkitOfflineCtx)(1, 16000, 16000);
    audioBuffer = await dummyCtx.decodeAudioData(arrayBuffer);
    // decodeAudioData copies — the raw file copy can be released immediately
    // instead of pinning up to ~1GB for the whole extraction.
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('allocation') || errMsg.includes('buffer') || err instanceof RangeError) {
      throw new Error(`เบราว์เซอร์หน่วยความจำ (RAM) ไม่พอสำหรับอ่านไฟล์ขนาดใหญ่ (${(file.size / 1024 / 1024).toFixed(0)}MB) กรุณาใช้ไฟล์ที่ขนาดเล็กลง หรือแปลงไฟล์วิดีโอนี้เป็น .mp3 หรือ .wav ก่อนอัปโหลดครับ`);
    }
    throw new Error(`Browser failed to decode audio track: ${errMsg}`);
  }

  const targetSampleRate = 16000;
  const duration = audioBuffer.duration;
  const rawPeaks: number[] = [];

  const renderSegment = async (chunkStart: number, chunkLenSecs: number): Promise<Float32Array> => {
    const targetLength = Math.ceil(chunkLenSecs * targetSampleRate);
    const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0, chunkStart, chunkLenSecs);
    const rendered = await offlineCtx.startRendering();
    return rendered.getChannelData(0);
  };

  // Single short clip: render once in full, reuse this decode (the old path
  // re-loaded and re-decoded the entire file a second time).
  if (duration <= chunkDurationSecs + 30) {
    const samples = await renderSegment(0, duration);
    rawPeaks.push(...downsamplePeaks(samples, Math.max(16, PEAK_POINTS)));
    const blob = encodeWAV(samples, targetSampleRate);
    return {
      chunks: [{ chunkIndex: 0, startTime: 0, endTime: duration, blob }],
      peaks: normalizePeaks(rawPeaks),
    };
  }

  const numChunks = Math.ceil(duration / chunkDurationSecs);
  const chunks: AudioChunk[] = [];
  const OVERLAP_SECS = 1.5; // 1.5 seconds overlap to prevent cutting words mid-way

  for (let i = 0; i < numChunks; i++) {
    const chunkStart = i * chunkDurationSecs;
    const chunkEnd = Math.min(
      duration,
      i === numChunks - 1 ? duration : (i + 1) * chunkDurationSecs + OVERLAP_SECS
    );
    const chunkLenSecs = chunkEnd - chunkStart;

    if (chunkLenSecs <= 0) continue;

    const samples = await renderSegment(chunkStart, chunkLenSecs);
    const blob = encodeWAV(samples, targetSampleRate);

    // Peaks for this chunk, proportionally sized to keep ≈600 points overall
    const points = Math.max(4, Math.round(PEAK_POINTS * (chunkLenSecs / duration)));
    rawPeaks.push(...downsamplePeaks(samples, points));

    chunks.push({
      chunkIndex: i,
      startTime: chunkStart,
      endTime: chunkEnd,
      blob,
    });
  }

  return { chunks, peaks: normalizePeaks(rawPeaks) };
}

/** Reduces PCM data to `points` absolute-amplitude peaks. */
function downsamplePeaks(samples: Float32Array, points: number): number[] {
  if (samples.length === 0) return new Array(points).fill(0);
  const blockSize = Math.max(1, Math.floor(samples.length / points));
  const peaks: number[] = [];
  for (let i = 0; i < points; i++) {
    const start = i * blockSize;
    if (start >= samples.length) break;
    let max = 0;
    const end = Math.min(samples.length, start + blockSize);
    const stride = Math.max(1, Math.floor(blockSize / 64));
    for (let j = start; j < end; j += stride) {
      const v = Math.abs(samples[j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  return peaks;
}

/** Normalizes peaks to a 0..1 range against the global maximum. */
function normalizePeaks(raw: number[]): number[] {
  const max = Math.max(...raw, 0.0001);
  return raw.map((p) => p / max);
}

function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* RIFF chunk length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (pcm) */
  view.setUint16(20, 1, true);
  /* channel count */
  view.setUint16(22, 1, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 2, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);

  // Float32 to Int16 PCM conversion
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
