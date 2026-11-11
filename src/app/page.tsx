'use client';

import React, { useReducer, useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { VideoPlayer } from '@/components/VideoPlayer';
import { Timeline } from '@/components/Timeline';
import { SubtitleEditor } from '@/components/SubtitleEditor';
import { ExportModal } from '@/components/ExportModal';
import { LanguageSelect } from '@/components/LanguageSelect';
import { Upload, Download, Video, AlertCircle, AlertTriangle, Clock, XCircle, RotateCcw, HelpCircle, Film, Sparkles, Undo2, Redo2, FileText, MicVocal } from 'lucide-react';

import { extractAudioChunks, extractAudioSegment, type AudioChunk } from '@/lib/audioExtractor';
import { extractVideoFrames } from '@/lib/videoFrameExtractor';
import { mergeChunkSubtitles, sanitizeAndFixOverlaps, isNearBoundaryDuplicate } from '@/lib/srtFormatter';
import { findActiveSubtitle, findSubtitleGaps } from '@/lib/subtitleUtils';
import { appReducer, initialState } from '@/lib/appReducer';
import { SubtitleItem } from '@/lib/types';
import { SubtitleStyleSettings, DEFAULT_SUBTITLE_STYLE, loadSubtitleStyle, saveSubtitleStyle } from '@/lib/subtitleStyle';
import { runChunkedTranslation, runSingleTranslation } from '@/lib/translationPipeline';
import { saveVideoToStorage, loadVideoFromStorage } from '@/lib/videoStorage';

const SUBTITLES_STORAGE_KEY = 'video_translator_subtitles';
const KARAOKE_STORAGE_KEY = 'karaoke_enabled';
const ON_SCREEN_TEXT_STORAGE_KEY = 'on_screen_text_enabled';
// Text-edit bursts within this window collapse into one undo step.
const HISTORY_BURST_MS = 800;

export default function Home() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const {
    selectedFile, videoUrl, videoDuration, videoWidth, videoHeight, isLargeFile, subtitles, targetLanguage,
    currentTime, seekTime, isLoading, statusMessage, error, estimatedTotalSecs,
    elapsedSecs, past, future, isExportOpen, isShortcutsModalOpen, hasMounted,
    toast, abortController
  } = state;

  // Shared subtitle style (player preview == hardsub burn), persisted
  const [subStyle, setSubStyle] = useState<SubtitleStyleSettings>(DEFAULT_SUBTITLE_STYLE);
  // Karaoke word-highlight generation (opt-in, costs one extra AI pass/chunk)
  const [karaokeEnabled, setKaraokeEnabled] = useState(false);
  // Full video OCR for on-screen text/captions (enabled by default for complete capture)
  const [includeOnScreenText, setIncludeOnScreenText] = useState(true);
  // Waveform peaks computed during audio extraction — the Timeline reuses
  // them instead of re-reading and re-decoding the whole file a second time.
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);

  // Partial-failure bookkeeping: audio chunk blobs and raw results of the last
  // chunked run, kept so "retry failed chunks" re-runs ONLY the failed ones
  // instead of the whole video. Cleared on new runs and file changes.
  const retryStateRef = useRef<{
    failedChunks: AudioChunk[];
    prepareChunk?: (chunk: AudioChunk, formData: FormData) => Promise<void>;
  } | null>(null);
  const [failedChunkCount, setFailedChunkCount] = useState(0);

  const subtitlesRef = useRef(subtitles);
  useEffect(() => { subtitlesRef.current = subtitles; }, [subtitles]);
  const videoUrlRef = useRef(videoUrl);
  useEffect(() => { videoUrlRef.current = videoUrl; }, [videoUrl]);
  // Mirrors elapsedSecs for callbacks outside the render cycle (onEta) so they
  // can anchor the re-estimated total to the real elapsed time.
  const elapsedRef = useRef(0);
  useEffect(() => { elapsedRef.current = elapsedSecs; }, [elapsedSecs]);

  const loadVideoFile = useCallback((file: File, keepSubtitles: boolean = false) => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    const url = URL.createObjectURL(file);
    retryStateRef.current = null;
    setFailedChunkCount(0);

    const tempVid = document.createElement('video');
    tempVid.muted = true;
    tempVid.volume = 0;
    tempVid.src = url;
    tempVid.onloadedmetadata = () => {
      const dur = tempVid.duration || 0;
      setWaveformPeaks([]);
      dispatch({
        type: 'SET_FILE',
        payload: {
          file,
          url,
          duration: dur,
          isLargeFile: file.size > 500 * 1024 * 1024,
          videoWidth: tempVid.videoWidth || 0,
          videoHeight: tempVid.videoHeight || 0,
          keepSubtitles,
        },
      });
      dispatch({ type: 'SET_ESTIMATED_SECS', payload: Math.max(10, Math.round(dur * 0.05 + 8)) });
      dispatch({
        type: 'SET_TOAST',
        payload: {
          msg: keepSubtitles && subtitlesRef.current.length > 0
            ? `เชื่อมต่อวิดีโอ "${file.name}" กับซับไตเติลเดิม (${subtitlesRef.current.length} รายการ) สำเร็จ`
            : `โหลดวิดีโอ: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
          type: 'success',
        },
      });
      saveVideoToStorage(file).catch(() => {
        dispatch({ type: 'SET_TOAST', payload: {
          msg: 'บันทึกวิดีโอลงเบราว์เซอร์ไม่สำเร็จ (โควตาเต็มหรือพื้นที่ไม่พอ) รีโหลดแล้วต้องเลือกไฟล์ใหม่ แต่ซับไตเติลยังอยู่ครบ',
          type: 'info',
        } });
      });
      tempVid.onloadedmetadata = null;
      tempVid.onerror = null;
      tempVid.removeAttribute('src');
      tempVid.load();
    };
    tempVid.onerror = () => {
      URL.revokeObjectURL(url);
      dispatch({
        type: 'SET_TOAST',
        payload: {
          msg: `ไม่สามารถอ่านไฟล์ "${file.name}" ได้ — อาจเป็น codec ที่เบราว์เซอร์ไม่รองรับ ลองแปลงเป็น MP4 (H.264/AAC) ก่อน`,
          type: 'error',
        },
      });
    };
  }, []);

  // ----- Effects -----

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => dispatch({ type: 'SET_TOAST', payload: null }), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  // Hydration & localStorage restore
  useEffect(() => {
    dispatch({ type: 'SET_HAS_MOUNTED', payload: true });
    const saved = localStorage.getItem(SUBTITLES_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          dispatch({ type: 'SET_SUBTITLES', payload: parsed });
        }
      } catch (e) {
        console.error('Failed to parse saved subtitles:', e);
      }
    }
    // Load persisted preferences AFTER mount (hydration-safe). The microtask
    // keeps setState out of the effect body (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      setSubStyle(loadSubtitleStyle());
      setKaraokeEnabled(localStorage.getItem(KARAOKE_STORAGE_KEY) === '1');
      const savedOcr = localStorage.getItem(ON_SCREEN_TEXT_STORAGE_KEY);
      setIncludeOnScreenText(savedOcr === null ? true : savedOcr === '1');
    });
  }, []);

  // Auto-restore cached video from IndexedDB if available. Skip when the user
  // already loaded a file before the IDB read resolves — the restore must
  // never clobber an explicit selection that won the race.
  useEffect(() => {
    loadVideoFromStorage().then((cachedFile) => {
      if (cachedFile && !videoUrlRef.current) {
        loadVideoFile(cachedFile, true);
      }
    });
  }, [loadVideoFile]);

  // Persist shared subtitle style (debounced)
  useEffect(() => {
    if (!hasMounted) return;
    const t = setTimeout(() => saveSubtitleStyle(subStyle), 400);
    return () => clearTimeout(t);
  }, [subStyle, hasMounted]);

  const handleKaraokeToggle = useCallback(() => {
    setKaraokeEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem(KARAOKE_STORAGE_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  const handleOnScreenTextToggle = useCallback(() => {
    setIncludeOnScreenText((prev) => {
      const next = !prev;
      try { localStorage.setItem(ON_SCREEN_TEXT_STORAGE_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  // Save to localStorage (debounced so every keystroke does not stringify
  // the entire subtitle array synchronously)
  useEffect(() => {
    if (!hasMounted) return;
    const t = setTimeout(() => {
      if (subtitles.length > 0) {
        localStorage.setItem(SUBTITLES_STORAGE_KEY, JSON.stringify(subtitles));
      } else {
        localStorage.removeItem(SUBTITLES_STORAGE_KEY);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [subtitles, hasMounted]);

  // Cleanup on unmount
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  // Live timer anchored to Date.now() so it never drifts or recreates the
  // interval every tick
  useEffect(() => {
    if (!isLoading) return;
    const startedAt = Date.now() - elapsedSecs * 1000;
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      dispatch({
        type: 'UPDATE_PROGRESS',
        payload: { elapsedSecs: Math.max(0, Math.round((Date.now() - startedAt) / 1000)) },
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Keyboard shortcuts: ?, Esc, Ctrl+Z / Ctrl+Shift+Z only.
  // Space / arrow seeking lives in VideoPlayer (the single owner) so the
  // handlers can no longer double-fire and seek 10s per keypress.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.getAttribute('contenteditable') === 'true'
      );
      if (isInput) return;

      if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) {
        e.preventDefault();
        dispatch({ type: 'SET_SHORTCUTS_OPEN', payload: !isShortcutsModalOpen });
      } else if (e.code === 'Escape') {
        dispatch({ type: 'SET_SHORTCUTS_OPEN', payload: false });
        dispatch({ type: 'SET_EXPORT_OPEN', payload: false });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) dispatch({ type: 'REDO' });
        else dispatch({ type: 'UNDO' });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'REDO' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isShortcutsModalOpen]);

  // ----- Event Handlers -----

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target instanceof HTMLInputElement) e.target.value = '';
    if (!file) return;

    // Only confirm if a video is ALREADY active in the player and user is replacing it
    let keepSubtitles = subtitlesRef.current.length > 0;
    if (selectedFile && subtitlesRef.current.length > 0) {
      const replaceChoice = window.confirm(
        `คุณมีคำบรรยายอยู่แล้ว (${subtitlesRef.current.length} cues)\nกด [ตกลง / OK] เพื่อใช้วิดีโอนี้คู่กับซับไตเติลเดิม\nกด [ยกเลิก / Cancel] เพื่อล้างซับไตเติลและเริ่มใหม่`
      );
      keepSubtitles = replaceChoice;
    }

    loadVideoFile(file, keepSubtitles);
  }, [selectedFile, loadVideoFile]);

  const handleCancelTranslation = useCallback(() => {
    if (abortController) {
      abortController.abort();
      dispatch({ type: 'TRANSLATION_CANCELLED' });
    }
  }, [abortController]);

  // Proactive Self-Healing & Gap-Audit: inspects timeline gaps > 7s and automatically
  // fetches audio + visual frames to fill omissions transparently in the first pass.
  const autoAuditAndHealGaps = useCallback(
    async (
      initialSubs: SubtitleItem[],
      file: File,
      totalDuration: number,
      signal: AbortSignal,
      isOcr: boolean,
      skipWindows: { start: number; end: number }[] = []
    ): Promise<{ subtitles: SubtitleItem[]; healedCount: number }> => {
      if (!file || totalDuration <= 15 || initialSubs.length === 0) {
        return { subtitles: initialSubs, healedCount: 0 };
      }

      const gaps = findSubtitleGaps(initialSubs, 7, totalDuration)
        // Windows of chunks that already failed: retrying them re-translates
        // the whole span, so healing here would duplicate that work and risk
        // stacked near-duplicates.
        .filter((g) => !skipWindows.some((w) => g.startTime < w.end && w.start < g.endTime));
      if (gaps.length === 0 || signal.aborted) {
        return { subtitles: initialSubs, healedCount: 0 };
      }

      const sortedGaps = [...gaps].sort((a, b) => b.duration - a.duration);
      const gapsToHeal = sortedGaps.slice(0, 6);
      const concurrency = 3;
      let workingSubs = initialSubs;
      let healedCount = 0;

      for (let i = 0; i < gapsToHeal.length; i += concurrency) {
        if (signal.aborted) break;
        const batch = gapsToHeal.slice(i, i + concurrency);
        dispatch({
          type: 'UPDATE_PROGRESS',
          payload: {
            statusMessage: `ตรวจพบช่วงว่าง ${gaps.length} จุด — กำลังสแกนและแปลเติม ${batch.length} จุดพร้อมกัน (Parallel Auto-Heal)...`,
          },
        });

        const batchSettled = await Promise.allSettled(
          batch.map(async (gap) => {
            const padStart = Math.max(0, gap.startTime - 1.0);
            const padDuration = Math.min(gap.duration + 2.0, 180);
            const padEnd = padStart + padDuration;
            const audioBlob = await extractAudioSegment(file, padStart, padDuration);

            const formData = new FormData();
            formData.append('file', audioBlob, `auto_heal_${Math.round(padStart)}.wav`);
            formData.append('chunkIndex', '0');
            formData.append('chunkStartTime', String(padStart));
            formData.append('targetLanguage', targetLanguage);
            formData.append('wordTiming', karaokeEnabled ? '1' : '0');

            if (videoUrlRef.current && isOcr) {
              const frames = await extractVideoFrames(videoUrlRef.current, padStart, padEnd, {
                maxFrames: Math.min(24, Math.max(3, Math.ceil(padDuration / 3))),
                maxWidth: 640,
                quality: 0.65,
              });
              if (frames.length > 0) {
                formData.append('frames', JSON.stringify(frames));
                formData.append('includeOnScreenText', '1');
              }
            }

            const res = await fetch('/api/video-translate-chunk', {
              method: 'POST',
              body: formData,
              signal,
            });

            const data = await res.json();
            if (data.success && Array.isArray(data.subtitles) && data.subtitles.length > 0) {
              return data.subtitles.map((c: SubtitleItem, ci: number) => ({
                ...c,
                id: `auto_heal_${Math.round(padStart)}_${ci + 1}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                startTime: Number((c.startTime + padStart).toFixed(3)),
                endTime: Number((c.endTime + padStart).toFixed(3)),
              }));
            }
            return [];
          })
        );

        const newCues: SubtitleItem[] = [];
        for (const r of batchSettled) {
          if (r.status === 'fulfilled' && r.value.length > 0) {
            newCues.push(...r.value);
            healedCount++;
          }
        }
        if (newCues.length > 0) {
          workingSubs = sanitizeAndFixOverlaps([...workingSubs, ...newCues]);
        }
      }

      return { subtitles: workingSubs, healedCount };
    },
    [targetLanguage, karaokeEnabled]
  );

  const handleTranslate = useCallback(async () => {
    if (!selectedFile) return;

    retryStateRef.current = null;
    setFailedChunkCount(0);

    const controller = new AbortController();
    const isVideo = selectedFile.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(selectedFile.name);
    const ocrMode = includeOnScreenText && isVideo;
    const estimatedSecsForRun = ocrMode
      ? Math.max(60, Math.round((videoDuration || 600) * 0.1 + 15))
      : estimatedTotalSecs;

    dispatch({ type: 'START_TRANSLATION', payload: {
      estimatedSecs: estimatedSecsForRun,
      statusMessage: ocrMode
        ? 'กำลังสกัดเสียงและเฟรมภาพเป็นท่อน ๆ เพื่อตรวจจับทั้งเสียงพูดและข้อความบนจอ (OCR)...'
        : 'กำลังสกัดเฉพาะแทร็กเสียงและแบ่งท่อนเพื่อความเร็วระดับสูงสุด...',
      controller,
    } });
    dispatch({ type: 'SET_TOAST', payload: { msg: 'Starting AI translation…', type: 'info' } });

    try {
      // 300s of 16kHz mono WAV is ~9.4MB, which exceeds Gemini's 1M-token
      // input limit (measured: 30s passes, 60s fails with "input token count
      // exceeds the maximum"). 150s keeps every chunk well inside the limit
      // while staying long enough for cheap per-request overhead.
      let chunks: AudioChunk[];
      let extractedPeaks: number[];
      try {
        ({ chunks, peaks: extractedPeaks } = await extractAudioChunks(selectedFile, 150));
      } catch (extractErr) {
        // Some videos cannot be decoded in the browser (AC3/DTS audio in MKV,
        // or no audio track at all). In OCR mode the full-file path still
        // works because Gemini decodes server-side. Otherwise surface the
        // original codec error to the user.
        if (!ocrMode) throw extractErr;
        console.warn('[Audio Chunker] Browser decode failed, falling back to full-file OCR:', extractErr);
        const subtitles = await runSingleTranslation({
          blob: selectedFile,
          fileName: selectedFile.name,
          targetLanguage,
          karaokeEnabled,
          includeOnScreenText: true,
          onProgress: (evt) => {
            dispatch({ type: 'UPDATE_PROGRESS', payload: { statusMessage: evt.message } });
          },
          deps: { fetchImpl: fetch.bind(window), signal: controller.signal },
        });
        if (!controller.signal.aborted) {
          dispatch({ type: 'TRANSLATION_SUCCESS', payload: subtitles });
        }
        return;
      }
      setWaveformPeaks(extractedPeaks);
      console.log(`[Audio Chunker] Total chunks created: ${chunks.length}`);

      // Chunk-local OCR frames: each chunk carries JPEG frames sampled from its
      // own [start, end] window. OCR then reuses the same resilient per-chunk
      // retry path as audio, and every chunk is a WAV, so the server-side
      // duration anchor and hallucination guard apply per chunk automatically.
      const prepareChunk = ocrMode
        ? async (chunk: AudioChunk, fd: FormData) => {
            const src = videoUrlRef.current;
            if (!src) return;
            const frames = await extractVideoFrames(src, chunk.startTime, chunk.endTime, {
              maxFrames: 24,
              maxWidth: 640,
              quality: 0.65,
            });
            if (frames.length > 0) {
              fd.append('frames', JSON.stringify(frames));
              fd.append('includeOnScreenText', '1');
            }
          }
        : undefined;

      if (chunks.length > 1 || ocrMode) {
        dispatch({ type: 'UPDATE_PROGRESS', payload: {
          statusMessage: `กำลังส่ง ${chunks.length} Chunks ประมวลผลพร้อมกันผ่าน Gemini AI Parallel Workers...`
        } });

        const { results: chunkResults, failedChunkIndexes: failedChunks } = await runChunkedTranslation(chunks, {
          targetLanguage,
          karaokeEnabled,
          prepareChunk,
          // Bind to window: passing bare `fetch` loses its receiver when the
          // pipeline invokes it as `deps.fetchImpl(...)`, and window.fetch
          // then throws "Illegal invocation". Tests inject plain mock fns,
          // which are receiver-independent, so they are unaffected.
          deps: { fetchImpl: fetch.bind(window), signal: controller.signal },
          onProgress: (completed) => dispatch({ type: 'UPDATE_PROGRESS', payload: {
            statusMessage: `กำลังประมวลผล Gemini Parallel Stream (${completed}/${chunks.length} ท่อนสำเร็จแล้ว)...`
          } }),
          onEta: ({ remainingSecs }) => {
            dispatch({ type: 'SET_ESTIMATED_SECS', payload: Math.round(elapsedRef.current + remainingSecs) });
          },
        });

        if (!controller.signal.aborted) {
          const merged = mergeChunkSubtitles(chunkResults);

          // Auto-Audit & Self-Healing: verify and fill any dropped gaps in the first round!
          const { subtitles: completeSubs, healedCount } = await autoAuditAndHealGaps(
            merged,
            selectedFile,
            videoDuration || 0,
            controller.signal,
            ocrMode || isVideo,
            failedChunks.length > 0
              ? chunks
                  .filter((c) => failedChunks.includes(c.chunkIndex))
                  .map((c) => ({ start: c.startTime, end: c.endTime }))
              : []
          );

          if (!controller.signal.aborted) {
            dispatch({ type: 'TRANSLATION_SUCCESS', payload: completeSubs });
            if (failedChunks.length > 0) {
              retryStateRef.current = {
                failedChunks: chunks.filter((c) => failedChunks.includes(c.chunkIndex)),
                prepareChunk,
              };
              setFailedChunkCount(failedChunks.length);
              dispatch({
                type: 'SET_TOAST',
                payload: {
                  msg: `แปลสำเร็จบางส่วน (${completeSubs.length} cues, ${failedChunks.length} ท่อนล้มเหลว) — กดปุ่มด้านล่างเพื่อแปลเฉพาะท่อนที่ค้าง`,
                  type: 'info',
                },
              });
            } else if (healedCount > 0) {
              dispatch({
                type: 'SET_TOAST',
                payload: {
                  msg: `แปลสำเร็จครบถ้วนรอบแรก (${completeSubs.length} cues, อุดรอยโหว่อัตโนมัติ ${healedCount} จุด)`,
                  type: 'success',
                },
              });
            } else {
              dispatch({
                type: 'SET_TOAST',
                payload: {
                  msg: `แปลสำเร็จครบถ้วนรอบแรก (${completeSubs.length} cues)`,
                  type: 'success',
                },
              });
            }
          }
        }
      } else {
        dispatch({ type: 'UPDATE_PROGRESS', payload: {
          statusMessage: 'กำลังส่งแทร็กเสียงไปยัง Gemini AI เพื่อถอดเสียงและแปลภาษา...'
        } });
        const fileToSend = chunks[0]?.blob || selectedFile;
        const fileNameToSend = selectedFile.name.replace(/\.[^/.]+$/, "") + ".wav";

        const subtitles = await runSingleTranslation({
          blob: fileToSend,
          fileName: fileNameToSend,
          targetLanguage,
          karaokeEnabled,
          onProgress: (evt) => {
            dispatch({
              type: 'UPDATE_PROGRESS',
              payload: { statusMessage: evt.message },
            });
          },
          deps: { fetchImpl: fetch.bind(window), signal: controller.signal },
        });

        if (!controller.signal.aborted) {
          const { subtitles: completeSubs, healedCount } = await autoAuditAndHealGaps(
            subtitles,
            selectedFile,
            videoDuration || 0,
            controller.signal,
            ocrMode || isVideo
          );

          if (!controller.signal.aborted) {
            dispatch({ type: 'TRANSLATION_SUCCESS', payload: completeSubs });
            if (healedCount > 0) {
              dispatch({
                type: 'SET_TOAST',
                payload: {
                  msg: `แปลสำเร็จครบถ้วนรอบแรก (${completeSubs.length} cues, อุดรอยโหว่อัตโนมัติ ${healedCount} จุด)`,
                  type: 'success',
                },
              });
            } else {
              dispatch({
                type: 'SET_TOAST',
                payload: {
                  msg: `แปลสำเร็จครบถ้วนรอบแรก (${completeSubs.length} cues)`,
                  type: 'success',
                },
              });
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Translation aborted by user.');
      } else {
        console.error(err);
        dispatch({ type: 'TRANSLATION_ERROR', payload: err instanceof Error ? err.message : 'An error occurred during translation.' });
      }
    }
  }, [selectedFile, targetLanguage, estimatedTotalSecs, karaokeEnabled, includeOnScreenText, videoDuration, autoAuditAndHealGaps]);

  const handleJumpToTime = useCallback((time: number) => {
    dispatch({ type: 'SET_SEEK_TIME', payload: time });
    setTimeout(() => dispatch({ type: 'SET_SEEK_TIME', payload: null }), 50);
  }, []);

  // Re-runs ONLY the chunks that failed in the last chunked run, then appends
  // the recovered cues to the CURRENT subtitles (user edits preserved, and the
  // pre-merge list is snapshotted so the merge itself is undoable). Cues
  // duplicating a neighboring chunk inside the 1.5s overlap are dropped with
  // the same boundary-duplicate rule the initial merge uses.
  const handleRetryFailedChunks = useCallback(async () => {
    const retryState = retryStateRef.current;
    if (!retryState || retryState.failedChunks.length === 0) return;

    const controller = new AbortController();
    dispatch({ type: 'START_TRANSLATION', payload: {
      estimatedSecs: Math.max(30, retryState.failedChunks.length * 45),
      statusMessage: `กำลังแปลซ้ำเฉพาะ ${retryState.failedChunks.length} ท่อนที่ล้มเหลว...`,
      controller,
    } });
    dispatch({ type: 'SET_TOAST', payload: { msg: 'Retrying failed chunks…', type: 'info' } });

    try {
      const { results: newResults, failedChunkIndexes: stillFailed } = await runChunkedTranslation(
        retryState.failedChunks,
        {
          targetLanguage,
          karaokeEnabled,
          prepareChunk: retryState.prepareChunk,
          deps: { fetchImpl: fetch.bind(window), signal: controller.signal },
          onProgress: (completed, total) => dispatch({ type: 'UPDATE_PROGRESS', payload: {
            statusMessage: `กำลังแปลซ้ำท่อนที่ค้าง (${completed}/${total} สำเร็จ)...`,
          } }),
          onEta: ({ remainingSecs }) => {
            dispatch({ type: 'SET_ESTIMATED_SECS', payload: Math.round(elapsedRef.current + remainingSecs) });
          },
        }
      );

      if (!controller.signal.aborted) {
        const recovered = mergeChunkSubtitles(newResults);
        const dedupedRecovered = recovered.filter(
          (cue) => !subtitlesRef.current.some((prev) => isNearBoundaryDuplicate(prev, cue))
        );
        dispatch({
          type: 'TRANSLATION_SUCCESS',
          payload: sanitizeAndFixOverlaps([...subtitlesRef.current, ...dedupedRecovered]),
          preserveHistory: true,
        });

        if (stillFailed.length > 0) {
          retryStateRef.current = {
            ...retryState,
            failedChunks: retryState.failedChunks.filter((c) => stillFailed.includes(c.chunkIndex)),
          };
          setFailedChunkCount(stillFailed.length);
          dispatch({ type: 'SET_TOAST', payload: {
            msg: `ยังล้มเหลว ${stillFailed.length} ท่อน กดแปลซ้ำอีกครั้งได้ทันที`,
            type: 'error',
          } });
        } else {
          retryStateRef.current = null;
          setFailedChunkCount(0);
        }
      }
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        dispatch({ type: 'TRANSLATION_ERROR', payload: err instanceof Error ? err.message : 'Retry failed.' });
      }
    }
  }, [targetLanguage, karaokeEnabled]);

  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    dispatch({ type: 'SET_TOAST', payload: { msg, type } });
  }, []);

  const pushHistory = useCallback(() => dispatch({ type: 'PUSH_HISTORY' }), []);

  // Subtitle edits arrive on every keystroke / pointer frame. The first edit
  // of a burst snapshots history (one undo step per burst); the rest update
  // live without touching history.
  const lastLiveEditRef = useRef(0);
  const handleSubtitlesLiveChange = useCallback((next: SubtitleItem[]) => {
    const now = Date.now();
    if (now - lastLiveEditRef.current > HISTORY_BURST_MS) {
      dispatch({ type: 'PUSH_HISTORY' });
    }
    lastLiveEditRef.current = now;
    dispatch({ type: 'UPDATE_SUBTITLES', payload: next });
  }, []);

  const handleTimelineUpdateSub = useCallback((id: string, patch: Partial<Pick<SubtitleItem, 'startTime' | 'endTime'>>) => {
    dispatch({
      type: 'UPDATE_SUBTITLES',
      payload: subtitlesRef.current.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s, ...patch };
        // Shift karaoke word timings along with the cue so the preview
        // highlight tracks the moved cue instead of stale absolute times.
        if (next.words && patch.startTime !== undefined) {
          const d = patch.startTime - s.startTime;
          next.words = next.words.map((w) => ({
            ...w,
            start: +(Math.max(next.startTime, w.start + d)).toFixed(3),
            end: +(Math.min(next.endTime, w.end + d)).toFixed(3),
          }));
        }
        return next;
      }),
    });
  }, []);

  const formatTimeMinutes = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m > 0 ? `${m}m ` : ''}${s}s`;
  };

  const remainingSecs = Math.max(0, estimatedTotalSecs - elapsedSecs);
  const progressPercent = elapsedSecs < (estimatedTotalSecs || 1)
    ? Math.min(95, Math.round((elapsedSecs / (estimatedTotalSecs || 1)) * 100))
    : Math.min(99, 95 + Math.floor((elapsedSecs - (estimatedTotalSecs || 1)) / 10));

  const activeSubtitle = useMemo(
    () => findActiveSubtitle(subtitles, currentTime),
    [subtitles, currentTime]
  );

  // Workspace is usable in two modes: with a loaded video, or subtitle-only
  // (e.g. cues restored from localStorage after a refresh).
  const showWorkspace = !!selectedFile || subtitles.length > 0;

  // ----- Render -----
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-blue-600 overflow-x-clip">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur-xl sticky top-0 z-40 px-3 sm:px-6 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="p-1.5 sm:p-2 rounded-xl bg-blue-600 text-white shrink-0"><Video className="w-4 h-4 sm:w-5 sm:h-5" /></div>
          <div className="min-w-0">
            <h1 className="text-xs sm:text-base font-bold tracking-tight text-zinc-50 flex items-center gap-1.5 sm:gap-2 min-w-0">
              <span className="truncate">Subtitle Studio</span>
              <span className="text-[9px] sm:text-[10px] uppercase font-semibold px-1.5 sm:px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/25 shrink-0">
                Gemini AI
              </span>
            </h1>
            <p className="hidden md:block text-[11px] text-zinc-400 truncate max-w-[240px] sm:max-w-sm">
              {selectedFile ? selectedFile.name : 'Speech-to-Text · Translation · Subtitle Editor'}
            </p>
          </div>
        </div>

        {/* Action Controls Cluster */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 justify-end min-w-0">
          {/* Target Language Dropdown */}
          <LanguageSelect
            value={targetLanguage}
            onChange={(lang) => dispatch({ type: 'SET_TARGET_LANGUAGE', payload: lang })}
          />

          {/* Translation Options when a file is selected */}
          {selectedFile && (
            <div className="flex items-center gap-1 bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 shrink-0">
              <button
                onClick={handleOnScreenTextToggle}
                aria-pressed={includeOnScreenText}
                className={`px-2 py-1.5 rounded-md text-xs font-medium flex items-center gap-1 transition-all cursor-pointer ${
                  includeOnScreenText
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent'
                }`}
                title="แปลข้อความบนจอภาพด้วย (OCR) — สแกนทั้งเสียงและป้ายข้อความ/ซับในภาพ"
              >
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden md:inline">แปลข้อความบนจอ (OCR)</span>
                <span className="md:hidden">OCR</span>
              </button>

              <button
                onClick={handleKaraokeToggle}
                aria-pressed={karaokeEnabled}
                className={`px-2 py-1.5 rounded-md text-xs font-medium flex items-center gap-1 transition-all cursor-pointer ${
                  karaokeEnabled
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent'
                }`}
                title="ไฮไลต์คำร้องตามจังหวะเสียง (Karaoke)"
              >
                <MicVocal className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden lg:inline">คาราโอเกะ</span>
              </button>
            </div>
          )}

          {/* Primary Action: Generate / Translate Subtitles */}
          {selectedFile && !isLoading && (
            <button
              onClick={handleTranslate}
              className="px-2.5 sm:px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer shrink-0"
              title="เริ่มถอดเสียงและแปลซับไตเติลด้วย Gemini AI"
            >
              <Sparkles className="w-3.5 h-3.5 fill-current" />
              <span className="hidden sm:inline">แปลซับไตเติล</span>
              <span className="sm:hidden">แปลซับ</span>
            </button>
          )}

          {/* Undo / Redo */}
          {subtitles.length > 0 && (
            <div className="flex items-center gap-0.5 bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 shrink-0">
              <button
                onClick={() => dispatch({ type: 'UNDO' })}
                disabled={past.length === 0}
                aria-label="Undo (Ctrl+Z)"
                className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-zinc-900 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
                title="ย้อนกลับ (Ctrl+Z)"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => dispatch({ type: 'REDO' })}
                disabled={future.length === 0}
                aria-label="Redo (Ctrl+Shift+Z)"
                className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-zinc-900 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
                title="ทำซ้ำ (Ctrl+Shift+Z)"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Export Subtitles Button */}
          {subtitles.length > 0 && (
            <button
              onClick={() => dispatch({ type: 'SET_EXPORT_OPEN', payload: true })}
              className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0"
              title="ส่งออกซับไตเติล (SRT / VTT / ฝังลงในวิดีโอ)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>
          )}

          {/* Upload New File Button */}
          {(selectedFile || subtitles.length > 0) && (
            <label
              className="text-xs text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 px-2 sm:px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              title="เปลี่ยนหรืออัปโหลดไฟล์วิดีโอใหม่"
              aria-label="Upload a video/audio file"
            >
              <Upload className="w-3.5 h-3.5 text-blue-400" />
              <span className="hidden md:inline">เปลี่ยนไฟล์</span>
              <input type="file" accept="video/*,audio/*" onChange={handleFileSelect} className="hidden" />
            </label>
          )}

          {/* Keyboard Shortcuts Help */}
          <button
            onClick={() => dispatch({ type: 'SET_SHORTCUTS_OPEN', payload: true })}
            className="hidden sm:flex text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 p-1.5 sm:px-2 sm:py-1.5 rounded-lg items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            title="คีย์ลัด (Keyboard Shortcuts)"
          >
            <HelpCircle className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden lg:inline">Shortcuts</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="relative flex-1 max-w-[1400px] w-full mx-auto p-3 sm:p-5 flex flex-col gap-4 min-h-0">
        {isLoading && (
          <div className="absolute inset-0 z-30 flex items-start justify-center pt-3 bg-zinc-950/70 backdrop-blur-sm" aria-live="polite" role="status">
            <div className="w-full max-w-3xl p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 shadow-2xl space-y-3">
              <div className="flex items-center justify-between text-xs gap-3">
                <div className="flex items-center gap-2 text-blue-400 font-medium min-w-0">
                  <Clock className="w-4 h-4 animate-spin shrink-0" />
                  <span className="truncate">{statusMessage}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-zinc-400 font-mono text-[11px]">
                    {remainingSecs > 5 ? `~${formatTimeMinutes(remainingSecs)} left` : 'ประมวลผลขั้นสุดท้าย...'}
                  </div>
                  <button onClick={handleCancelTranslation} className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 text-[11px] font-medium flex items-center gap-1 transition-colors">
                    <XCircle className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
              <div className="w-full bg-zinc-950 rounded-full h-2 overflow-hidden border border-zinc-800">
                <div
                  className={`h-full transition-all duration-500 ease-out ${
                    progressPercent >= 90
                      ? 'bg-gradient-to-r from-blue-600 via-cyan-400 to-blue-500 animate-pulse'
                      : 'bg-blue-500'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-500">
                <span>Duration: {formatTimeMinutes(videoDuration)}</span>
                <span>{progressPercent}% · {formatTimeMinutes(elapsedSecs)} elapsed</span>
              </div>
            </div>
          </div>
        )}

        {!showWorkspace && !isLoading && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) { const synthetic = { target: { files: [f] } } as unknown as React.ChangeEvent<HTMLInputElement>; handleFileSelect(synthetic); } }}
            className="flex-1 min-h-[420px] rounded-2xl border border-dashed border-zinc-700 hover:border-blue-500 flex flex-col items-center justify-center gap-5 p-8 text-center transition-colors"
          >
            <div className="p-4 rounded-2xl bg-blue-600/10 border border-blue-500/25 text-blue-400"><Film className="w-9 h-9" /></div>
            <div className="space-y-1.5">
              <p className="text-base font-semibold text-zinc-200">Drop a video or audio file</p>
              <p className="text-xs text-zinc-500 max-w-sm">MP4 · MOV · MKV · WebM · MP3 · WAV — large files use parallel chunking automatically (max 1GB).</p>
            </div>
            <label className="cursor-pointer px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-2 transition-colors">
              <Upload className="w-4 h-4" /> Select File
              <input type="file" accept="video/*,audio/*" onChange={handleFileSelect} className="hidden" />
            </label>
            <p className="text-[11px] text-zinc-600">Subtitle text saves locally as you edit.</p>
          </div>
        )}

        {showWorkspace && (
          <div className="shrink-0 space-y-4">
            {!selectedFile && subtitles.length > 0 && (
              <div className="p-3 sm:p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                  <span>
                    ซับไตเติลของคุณบันทึกไว้อย่างปลอดภัย ({subtitles.length} รายการ) ไม่ต้องเริ่มแปลใหม่! ท่านสามารถเลือกไฟล์วิดีโอเพื่อดูพรีวิวและเล่นต่อได้ทันที
                  </span>
                </div>
                <label className="cursor-pointer px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1.5 shrink-0 transition-colors self-start sm:self-auto shadow-sm">
                  <Upload className="w-3.5 h-3.5" />
                  <span>เชื่อมต่อไฟล์วิดีโอ</span>
                  <input type="file" accept="video/*,audio/*" onChange={handleFileSelect} className="hidden" />
                </label>
              </div>
            )}

            {isLargeFile && !isLoading && !error && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Large file detected <strong>({(selectedFile!.size / (1024 * 1024)).toFixed(0)}MB)</strong>. Audio extraction uses optimized parallel chunking to preserve memory.</span>
              </div>
            )}

            {error && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span className="truncate">{error}</span>
                </div>
                {selectedFile && !isLoading && (
                  <button onClick={handleTranslate} className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-white font-medium text-xs flex items-center gap-1.5 shrink-0 border border-rose-500/40">
                    <RotateCcw className="w-3.5 h-3.5" /> Retry
                  </button>
                )}
              </div>
            )}

            {failedChunkCount > 0 && !isLoading && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                  <span className="truncate">
                    แปลสำเร็จบางส่วน ({failedChunkCount} ท่อนล้มเหลว) ซับที่ได้ใช้งานได้ปกติ
                  </span>
                </div>
                <button
                  onClick={handleRetryFailedChunks}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-white font-medium text-xs flex items-center gap-1.5 shrink-0 border border-amber-500/40"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> แปลเฉพาะ {failedChunkCount} ท่อนที่ค้าง
                </button>
              </div>
            )}
          </div>
        )}

        {/* Studio Workspace: single column with bounded heights on phones
            (the virtualized list needs an explicit height), 12-col grid
            from lg: up. svh tracks the mobile browser chrome. */}
        {showWorkspace && (
          <div className="flex-1 flex flex-col gap-4 min-h-0">
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 min-h-0">
              <div className="lg:col-span-7 xl:col-span-8 lg:h-[520px] min-h-0 min-w-0">
                <VideoPlayer videoUrl={videoUrl} subtitles={subtitles} currentTime={currentTime} onTimeUpdate={(t) => dispatch({ type: 'SET_CURRENT_TIME', payload: t })} seekTime={seekTime} style={subStyle} onStyleChange={setSubStyle} />
              </div>
              {/* Must carry a matching col-span: the grid is 12 columns from
                  lg: up, and a child without one defaults to span 1 — an
                  eighth-width sidebar that squeezes the toolbar and clips the
                  header copy. Mirrors the video column above (7 / 8 of 12). */}
              <div className="lg:col-span-5 xl:col-span-4 h-[72svh] min-h-[420px] lg:h-[520px] lg:min-h-0">
                <SubtitleEditor
                  subtitles={subtitles}
                  currentTime={currentTime}
                  onSubtitlesChange={handleSubtitlesLiveChange}
                  onJumpTo={handleJumpToTime}
                  targetLanguage={targetLanguage}
                  notify={showToast}
                  selectedFile={selectedFile}
                  videoDuration={videoDuration}
                  videoUrl={videoUrl}
                  includeOnScreenText={includeOnScreenText}
                />
              </div>
            </div>
            {selectedFile && (
              <Timeline selectedFile={selectedFile} currentTime={currentTime} duration={videoDuration} subtitles={subtitles} onSeek={handleJumpToTime} activeId={activeSubtitle?.id ?? null} onUpdateSub={handleTimelineUpdateSub} onDragStart={pushHistory} sharedPeaks={waveformPeaks} onDecodeError={() => showToast('ไม่สามารถถอดรหัสเสียงสำหรับ waveform ได้ (ไฟล์อาจใหญ่เกินหรือ codec ไม่รองรับ) — Timeline ยังใช้งานได้ปกติ', 'info')} />
            )}
          </div>
        )}
      </div>

      {/* Export Modal */}
      <ExportModal isOpen={isExportOpen} onClose={() => dispatch({ type: 'SET_EXPORT_OPEN', payload: false })} subtitles={subtitles} videoUrl={videoUrl} selectedFile={selectedFile} duration={videoDuration} playResX={videoWidth || undefined} playResY={videoHeight || undefined} style={subStyle} onStyleChange={setSubStyle} notify={showToast} />

      {/* Keyboard Shortcuts */}
      {isShortcutsModalOpen && (
        <div className="fixed top-16 right-4 z-50 w-72 max-w-[calc(100vw-2rem)] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <h3 className="text-xs font-bold text-zinc-100">Keyboard Shortcuts</h3>
            <button onClick={() => dispatch({ type: 'SET_SHORTCUTS_OPEN', payload: false })} className="text-zinc-400 hover:text-zinc-100 text-xs">Esc</button>
          </div>
          <div className="space-y-2 text-xs">
            {[
              ['Play / Pause Video', 'Space'],
              ['Seek Backward 5s', '←'],
              ['Seek Forward 5s', '→'],
              ['Undo', 'Ctrl+Z'],
              ['Redo', 'Ctrl+Shift+Z / Ctrl+Y'],
              ['Toggle Shortcuts Help', '?'],
              ['Close Panels / Help', 'Esc'],
            ].map(([label, key]) => (
              <div key={label} className="flex items-center justify-between py-1 border-b border-zinc-800/60">
                <span className="text-zinc-300">{label}</span>
                <kbd className="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-200 font-mono text-[10px]">{key}</kbd>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toast: full-width banner above the home indicator on phones,
          corner card from sm: up. */}
      {toast && (
        <div className="fixed z-[60] inset-x-3 bottom-[max(1.25rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-5 sm:right-5 sm:max-w-sm px-4 py-3 rounded-xl border shadow-2xl text-xs font-medium animate-fade-in" role="status" aria-live="polite"
          style={{
            background: 'var(--surface-2)',
            borderColor: toast.type === 'success' ? 'var(--ok)' : toast.type === 'error' ? 'var(--err)' : 'var(--accent)',
            color: 'var(--ink)',
          }}
        >
          <span className="mr-2" style={{ color: toast.type === 'success' ? 'var(--ok)' : toast.type === 'error' ? 'var(--err)' : 'var(--accent)' }}>
            {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}
          </span>
          {toast.msg}
        </div>
      )}
    </main>
  );
}
