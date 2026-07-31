export interface AudioChunk {
  chunkIndex: number;
  startTime: number;
  endTime: number;
  blob: Blob;
}

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
): Promise<AudioChunk[]> {
  const arrayBuffer = await file.arrayBuffer();
  const dummyCtx = new OfflineAudioContext(1, 16000, 16000);
  const audioBuffer = await dummyCtx.decodeAudioData(arrayBuffer);

  const targetSampleRate = 16000;
  const duration = audioBuffer.duration;

  if (duration <= chunkDurationSecs + 30) {
    const singleBlob = await extractAudioFromVideo(file);
    return [{ chunkIndex: 0, startTime: 0, endTime: duration, blob: singleBlob }];
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
    const targetLength = Math.ceil(chunkLenSecs * targetSampleRate);

    if (chunkLenSecs <= 0 || targetLength <= 0) continue;

    const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0, chunkStart, chunkLenSecs);

    const rendered = await offlineCtx.startRendering();
    const blob = encodeWAV(rendered.getChannelData(0), targetSampleRate);

    chunks.push({
      chunkIndex: i,
      startTime: chunkStart,
      endTime: chunkEnd,
      blob,
    });
  }

  return chunks;
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
