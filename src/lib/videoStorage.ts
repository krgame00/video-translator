const DB_NAME = 'video_translator_db';
const DB_VERSION = 1;
const STORE_NAME = 'media';
const VIDEO_KEY = 'active_video';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = typeof window !== 'undefined'
      ? window.indexedDB
      : (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB;
    if (!idb) {
      return reject(new Error('IndexedDB is not supported'));
    }
    const request = idb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persists the currently loaded video file to browser IndexedDB
 * so it survives browser refresh / reload. Rejects on quota or storage
 * errors so the caller can warn the user instead of failing silently.
 */
export async function saveVideoToStorage(file: File): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(file, VIDEO_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Restores the cached video file from browser IndexedDB after reload.
 */
export async function loadVideoFromStorage(): Promise<File | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(VIDEO_KEY);
      req.onsuccess = () => {
        const result = req.result;
        if (result instanceof File) {
          resolve(result);
        } else if (result instanceof Blob) {
          const fileName = (result as File).name || 'cached_video.mp4';
          const fileType = result.type || 'video/mp4';
          const restored = new File([result], fileName, {
            type: fileType,
            lastModified: (result as File).lastModified || Date.now(),
          });
          resolve(restored);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to load video from IndexedDB:', err);
    return null;
  }
}

/**
 * Removes the cached video file from IndexedDB.
 */
export async function clearVideoFromStorage(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(VIDEO_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to clear video from IndexedDB:', err);
  }
}
