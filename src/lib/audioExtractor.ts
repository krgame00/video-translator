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
 * Gemini charges audio by CONTENT, not duration: the token ceiling is hit by
 * dense speech long before a quiet stretch of the same length (measured on the
 * same video — 42s at offset 0 passed, the same 42s at offset 60 failed with
 * "input token count exceeds the maximum").
 *
 * 8kHz mono halves the payload versus 16kHz and still transcribes speech
 * accurately (verified against real dialogue), which buys roughly 2x the
 * seconds per request. Paired with the 150s chunk this keeps every request
 * inside the 1M-token limit for ordinary content.
 */
const TARGET_SAMPLE_RATE = 8000;
export async function extractAudioFromVideo(file: File): Promise<Blob> {
  if (file.size > 500 * 1024 * 1024) {
    console.warn(`[Audio Extractor] Large file detected (${(file.size / 1024 / 1024).toFixed(0)}MB > 500MB). Client extraction may require significant RAM.`);
  }

  const arrayBuffer = await file.arrayBuffer();
  const dummyCtx = new OfflineAudioContext(1, 16000, 16000);
  const audioBuffer = await dummyCtx.decodeAudioData(arrayBuffer);

  const targetSampleRate = TARGET_SAMPLE_RATE;
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

/**
 * Extracts a specific audio slice [startTime, startTime + durationSecs] from a media file.
 * Used for targeted gap repair without re-reading or re-translating the entire video.
 */
export async function extractAudioSegment(
  file: File,
  startTime: number,
  durationSecs: number
): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  const AudioCtx =
    (typeof window !== 'undefined' &&
      (window.OfflineAudioContext ||
        (window as typeof window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext)) ||
    (globalThis as typeof globalThis & { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;

  if (!AudioCtx) throw new Error('OfflineAudioContext unavailable in this environment');
  const dummyCtx = new AudioCtx(1, 16000, 16000);
  const audioBuffer = await dummyCtx.decodeAudioData(arrayBuffer);

  const targetSampleRate = TARGET_SAMPLE_RATE;
  const duration = audioBuffer.duration;
  const clampedStart = Math.max(0, Math.min(duration, startTime));
  const clampedDuration = Math.max(0.5, Math.min(duration - clampedStart, durationSecs));
  const targetLength = Math.ceil(clampedDuration * targetSampleRate);

  const offlineCtx = new AudioCtx(1, targetLength, targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0, clampedStart, clampedDuration);
  const rendered = await offlineCtx.startRendering();

  return encodeWAV(rendered.getChannelData(0), targetSampleRate);
}

// Default chunk length: 150s of 16kHz mono WAV ≈ 4.7MB, safely inside
// Gemini's 1M-token input limit (300s ≈ 9.4MB overflows it).
export async function extractAudioChunks(
  file: File,
  chunkDurationSecs: number = 150
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

  const targetSampleRate = TARGET_SAMPLE_RATE;
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
