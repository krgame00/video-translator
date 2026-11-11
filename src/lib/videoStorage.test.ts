import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveVideoToStorage,
  loadVideoFromStorage,
  clearVideoFromStorage,
} from './videoStorage';

describe('videoStorage (IndexedDB video cache)', () => {
  let fakeStore: Record<string, unknown> = {};

  beforeEach(() => {
    fakeStore = {};
    const mockRequest = (result?: unknown): IDBRequest => {
      const req = {
        onsuccess: null as ((e: Event) => void) | null,
        onerror: null as ((e: Event) => void) | null,
        result,
      } as unknown as IDBRequest;
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess(new Event('success'));
      }, 0);
      return req;
    };

    const mockIDB = {
      open: vi.fn().mockImplementation(() => {
        const openReq = {
          onsuccess: null as (() => void) | null,
          onerror: null,
          onupgradeneeded: null,
          result: {
            objectStoreNames: {
              contains: () => true,
            },
            createObjectStore: vi.fn(),
            transaction: () => ({
              objectStore: () => ({
                put: (val: unknown, key: string) => {
                  fakeStore[key] = val;
                  return mockRequest(key);
                },
                get: (key: string) => {
                  return mockRequest(fakeStore[key] ?? null);
                },
                delete: (key: string) => {
                  delete fakeStore[key];
                  return mockRequest();
                },
              }),
            }),
          },
        };
        setTimeout(() => {
          if (openReq.onsuccess) openReq.onsuccess();
        }, 0);
        return openReq;
      }),
    } as unknown as IDBFactory;

    vi.stubGlobal('indexedDB', mockIDB);
  });

  it('saves and loads a video File from storage', async () => {
    const file = new File(['dummy-content'], 'test_video.mp4', { type: 'video/mp4' });
    await saveVideoToStorage(file);

    const loaded = await loadVideoFromStorage();
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('test_video.mp4');
    expect(loaded?.type).toBe('video/mp4');
  });

  it('restores a Blob as a File with name and type', async () => {
    const blob = new Blob(['blob-content'], { type: 'video/webm' });
    fakeStore['active_video'] = blob;

    const loaded = await loadVideoFromStorage();
    expect(loaded).toBeInstanceOf(File);
    expect(loaded?.name).toBe('cached_video.mp4');
    expect(loaded?.type).toBe('video/webm');
  });

  it('clears cached video from storage', async () => {
    const file = new File(['dummy'], 'video.mp4', { type: 'video/mp4' });
    await saveVideoToStorage(file);
    await clearVideoFromStorage();

    const loaded = await loadVideoFromStorage();
    expect(loaded).toBeNull();
  });

  it('rejects on a write error (quota) so callers can warn the user', async () => {
    const failingReq = {
      error: new Error('quota exceeded'),
      onsuccess: null as ((e: Event) => void) | null,
      onerror: null as ((e: Event) => void) | null,
    } as unknown as IDBRequest;
    // Fire after saveVideoToStorage has assigned req.onerror (openDB's own
    // 0ms timer must resolve first, so this one needs a longer delay).
    setTimeout(() => {
      if (failingReq.onerror) failingReq.onerror(new Event('error'));
    }, 20);

    const mockIDB = {
      open: vi.fn().mockImplementation(() => {
        const openReq = {
          onsuccess: null as (() => void) | null,
          onerror: null,
          onupgradeneeded: null,
          result: {
            objectStoreNames: { contains: () => true },
            createObjectStore: vi.fn(),
            transaction: () => ({
              objectStore: () => ({
                put: () => failingReq,
              }),
            }),
          },
        };
        setTimeout(() => {
          if (openReq.onsuccess) openReq.onsuccess();
        }, 0);
        return openReq;
      }),
    } as unknown as IDBFactory;
    vi.stubGlobal('indexedDB', mockIDB);

    const file = new File(['x'], 'big_video.mp4', { type: 'video/mp4' });
    await expect(saveVideoToStorage(file)).rejects.toBeInstanceOf(Error);
  });
});
