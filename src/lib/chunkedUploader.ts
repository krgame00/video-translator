export interface ChunkedUploaderOptions {
  file: Blob;
  fileName?: string;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  chunkSize?: number;
}

export interface ChunkedUploadResult {
  uploadId: string;
  tempPath: string;
}

export async function uploadFileInChunks({
  file,
  fileName = 'video.mp4',
  onProgress,
  chunkSize = 5 * 1024 * 1024, // default 5MB chunks
}: ChunkedUploaderOptions): Promise<ChunkedUploadResult> {
  const totalSize = file.size;

  // 1. INIT
  const initRes = await fetch('/api/upload?action=init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, totalSize }),
  });
  const initData = await initRes.json();
  if (!initData.success) {
    throw new Error(initData.error || 'Failed to init upload');
  }
  const uploadId = initData.uploadId;

  // 2. CHUNK
  let uploadedSize = 0;
  while (uploadedSize < totalSize) {
    const end = Math.min(uploadedSize + chunkSize, totalSize);
    const chunk = file.slice(uploadedSize, end);

    const chunkRes = await fetch(`/api/upload?action=chunk&uploadId=${uploadId}`, {
      method: 'POST',
      body: chunk,
    });
    const chunkData = await chunkRes.json();
    if (!chunkData.success) {
      throw new Error(chunkData.error || 'Failed to upload chunk');
    }

    uploadedSize = end;
    if (onProgress) {
      onProgress(uploadedSize, totalSize);
    }
  }

  // 3. COMPLETE
  const compRes = await fetch(`/api/upload?action=complete&uploadId=${uploadId}`, {
    method: 'POST',
  });
  const compData = await compRes.json();
  if (!compData.success) {
    throw new Error(compData.error || 'Failed to complete upload');
  }

  return { uploadId, tempPath: compData.tempPath };
}
