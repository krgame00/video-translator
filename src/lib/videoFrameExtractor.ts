/**
 * Client-side video frame extraction for multimodal Gemini OCR and on-screen text translation.
 * Extracts lightweight JPEG frames at regular intervals without server-side re-encoding.
 */

export interface ExtractedFrame {
  timeSec: number;
  base64Data: string;
  mimeType: string;
}

export async function extractVideoFrames(
  videoSrc: string,
  startTime: number,
  endTime: number,
  options: {
    maxFrames?: number;
    maxWidth?: number;
    quality?: number;
  } = {}
): Promise<ExtractedFrame[]> {
  if (typeof document === 'undefined' || !videoSrc) return [];

  const maxFrames = options.maxFrames ?? 15;
  const maxWidth = options.maxWidth ?? 640;
  const quality = options.quality ?? 0.6;
  const duration = endTime - startTime;
  if (duration <= 0) return [];

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = videoSrc;

    let isCleanedUp = false;
    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    // Timeout guard: don't let frame extraction hang for more than 10 seconds
    const timeout = setTimeout(() => {
      cleanup();
      resolve([]);
    }, 10000);

    video.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      resolve([]);
    };

    video.onloadedmetadata = async () => {
      try {
        const aspect =
          video.videoWidth && video.videoHeight
            ? video.videoWidth / video.videoHeight
            : 16 / 9;
        const width = Math.min(maxWidth, video.videoWidth || maxWidth);
        const height = Math.round(width / aspect);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          clearTimeout(timeout);
          cleanup();
          return resolve([]);
        }

        // Calculate sample count (between 3 and maxFrames frames)
        const count = Math.min(maxFrames, Math.max(3, Math.ceil(duration / 3)));
        const step = duration / count;
        const frames: ExtractedFrame[] = [];

        for (let i = 0; i < count; i++) {
          const targetTime = startTime + i * step + step * 0.2;
          if (targetTime > (video.duration || endTime)) break;

          await new Promise<void>((resSeek) => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              resSeek();
            };
            video.addEventListener('seeked', onSeeked);
            video.currentTime = targetTime;
          });

          ctx.drawImage(video, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          const parts = dataUrl.split(',');
          if (parts[1]) {
            frames.push({
              timeSec: Number(targetTime.toFixed(2)),
              base64Data: parts[1],
              mimeType: 'image/jpeg',
            });
          }
        }

        clearTimeout(timeout);
        cleanup();
        resolve(frames);
      } catch (err) {
        console.warn('[VideoFrameExtractor] Error extracting frames:', err);
        clearTimeout(timeout);
        cleanup();
        resolve([]);
      }
    };
  });
}
