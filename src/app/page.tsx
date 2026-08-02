'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { SubtitleItem } from '@/lib/types';
import { VideoPlayer } from '@/components/VideoPlayer';
import { Timeline } from '@/components/Timeline';
import { SubtitleEditor } from '@/components/SubtitleEditor';
import { ExportModal } from '@/components/ExportModal';
import { Upload, Download, Languages, Video, AlertCircle, Clock, XCircle, RotateCcw, HelpCircle, Film, Sparkles, Undo2, Redo2 } from 'lucide-react';

import { extractAudioChunks, AudioChunk } from '@/lib/audioExtractor';
import { mergeChunkSubtitles } from '@/lib/srtFormatter';

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [targetLanguage, setTargetLanguage] = useState<string>('th');
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>([]);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [seekTime, setSeekTime] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('AI Processing Video Speech...');
  const [error, setError] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);

  // Time Estimation & Hydration States
  const [estimatedTotalSecs, setEstimatedTotalSecs] = useState<number>(0);
  const [elapsedSecs, setElapsedSecs] = useState<number>(0);
  const [hasMounted, setHasMounted] = useState<boolean>(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [isLargeFile, setIsLargeFile] = useState<boolean>(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState<boolean>(false);

  // Toast notification (bottom-right) — auto-dismisses
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  // Undo / Redo history stacks for subtitle edits
  const [past, setPast] = useState<SubtitleItem[][]>([]);
  const [future, setFuture] = useState<SubtitleItem[][]>([]);
  const subtitlesRef = useRef(subtitles);
  useEffect(() => {
    subtitlesRef.current = subtitles;
  }, [subtitles]);

  const commitSubtitles = useCallback(
    (next: SubtitleItem[]) => {
      if (JSON.stringify(next) === JSON.stringify(subtitlesRef.current)) return;
      setPast((p) => [...p.slice(-49), subtitlesRef.current]);
      setFuture([]);
      setSubtitles(next);
    },
    []
  );

  // Push a history snapshot once at the start of a timeline drag gesture
  const pushHistory = useCallback(() => {
    setPast((p) => [...p.slice(-49), subtitlesRef.current]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [...f, subtitlesRef.current]);
      setSubtitles(prev);
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      setPast((p) => [...p, subtitlesRef.current]);
      setSubtitles(next);
      return f.slice(0, -1);
    });
  }, []);

  // Global Keyboard Shortcuts (Space for Play/Pause, ArrowLeft/Right for seeking, ? for Help)
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
        setIsShortcutsModalOpen((prev) => !prev);
      } else if (e.code === 'Escape') {
        setIsShortcutsModalOpen(false);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.code === 'Space') {
        e.preventDefault();
        const videoEl = document.querySelector('video');
        if (videoEl) {
          if (videoEl.paused) videoEl.play();
          else videoEl.pause();
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const videoEl = document.querySelector('video');
        if (videoEl) {
          videoEl.currentTime = Math.max(0, videoEl.currentTime - 5);
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        const videoEl = document.querySelector('video');
        if (videoEl) {
          videoEl.currentTime = Math.min(videoEl.duration || 0, videoEl.currentTime + 5);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // Restore subtitles from localStorage on initial client load after hydration
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasMounted(true);
    const saved = localStorage.getItem('video_translator_subtitles');
    if (saved) {
      try {
        setSubtitles(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved subtitles:', e);
      }
    }
  }, []);

  // Save subtitles to localStorage when modified (or clear when empty)
  useEffect(() => {
    if (!hasMounted) return;
    if (subtitles.length > 0) {
      localStorage.setItem('video_translator_subtitles', JSON.stringify(subtitles));
    } else {
      localStorage.removeItem('video_translator_subtitles');
    }
  }, [subtitles, hasMounted]);

  // Clean up object URL when component unmounts
  useEffect(() => {
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  // Live timer tick during AI translation loading
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      interval = setInterval(() => {
        setElapsedSecs((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Revoke previous object URL if present to prevent memory leak
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }

      setSelectedFile(file);
      setIsLargeFile(file.size > 500 * 1024 * 1024);
      setSubtitles([]);
      localStorage.removeItem('video_translator_subtitles');
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setError(null);
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      setToast({
        msg: subtitles.length > 0
          ? `Loaded: ${file.name} (${sizeMB}MB) — current subtitles cleared`
          : `Loaded: ${file.name} (${sizeMB}MB)`,
        type: file.size > 500 * 1024 * 1024 || subtitles.length > 0 ? 'info' : 'success',
      });

      // Inspect video duration for accurate time estimation
      const tempVid = document.createElement('video');
      tempVid.muted = true;
      tempVid.volume = 0;
      tempVid.src = url;
      tempVid.onloadedmetadata = () => {
        const dur = tempVid.duration || 0;
        setVideoDuration(dur);
        // Fast audio extraction + Gemini 3.5 Flash Lite: ~10s base + ~5% of duration
        const est = Math.max(10, Math.round(dur * 0.05 + 8));
        setEstimatedTotalSecs(est);
        // Clean up temp video element
        tempVid.src = '';
        tempVid.load();
      };
    }
  };

  const handleCancelTranslation = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsLoading(false);
      setStatusMessage('Cancelled by user');
      setError(null);
      setToast({ msg: 'Translation cancelled', type: 'info' });
    }
  };

  const handleTranslate = async () => {
    if (!selectedFile) return;

    const controller = new AbortController();
    setAbortController(controller);

    setIsLoading(true);
    setElapsedSecs(0);
    setError(null);
    setSubtitles([]); // Clear old subtitles while processing new video
    localStorage.removeItem('video_translator_subtitles');
    setStatusMessage('กำลังสกัดเฉพาะแทร็กเสียงและแบ่งท่อนเพื่อความเร็วระดับสูงสุด...');
    setToast({ msg: 'Starting AI translation…', type: 'info' });

    try {
      const chunks = await extractAudioChunks(selectedFile, 300);
      console.log(`[Audio Chunker] Total chunks created: ${chunks.length}`);

      if (chunks.length > 1) {
        setStatusMessage(`กำลังส่ง ${chunks.length} Chunks ประมวลผลพร้อมกันผ่าน Gemini AI Parallel Workers...`);

        let completedChunks = 0;
        const CONCURRENCY_LIMIT = 3;
        const MAX_ATTEMPTS = 3;
        const failedChunks: number[] = [];
        const chunkResults: { chunkStartTime: number; subtitles: SubtitleItem[] }[] = [];

        const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        const processChunk = async (chunk: AudioChunk) => {
          const formData = new FormData();
          formData.append('file', chunk.blob, `chunk_${chunk.chunkIndex}.wav`);
          formData.append('targetLanguage', targetLanguage);
          formData.append('chunkIndex', String(chunk.chunkIndex));
          formData.append('chunkStartTime', String(chunk.startTime));

          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
              const res = await fetch('/api/video-translate-chunk', { method: 'POST', body: formData, signal: controller.signal });
              const data = await res.json();
              if (!data.success) throw new Error(data.error || `Failed on chunk ${chunk.chunkIndex + 1}`);
              completedChunks++;
              setStatusMessage(`กำลังประมวลผล Gemini Parallel Stream (${completedChunks}/${chunks.length} ท่อนสำเร็จแล้ว)...`);
              return { chunkStartTime: chunk.startTime, subtitles: data.subtitles || [] };
            } catch (err: unknown) {
              if (err instanceof Error && err.name === 'AbortError') throw err;
              if (attempt < MAX_ATTEMPTS) await delay(1500 * attempt);
              else throw err;
            }
          }
          return null;
        };
        
        for (let i = 0; i < chunks.length; i += CONCURRENCY_LIMIT) {
          if (controller.signal.aborted) break;
          const batch = chunks.slice(i, i + CONCURRENCY_LIMIT);
          const batchResults = await Promise.all(batch.map(async (chunk) => {
            try {
              return await processChunk(chunk);
            } catch (err: unknown) {
              if (err instanceof Error && err.name === 'AbortError') throw err;
              failedChunks.push(chunk.chunkIndex);
              console.warn(`Chunk ${chunk.chunkIndex + 1} failed after ${MAX_ATTEMPTS} attempts:`, err);
              return null;
            }
          }));

          chunkResults.push(...batchResults.filter(
            (r): r is { chunkStartTime: number; subtitles: SubtitleItem[] } => r !== null
          ));
        }

if (!controller.signal.aborted) {
          const merged = mergeChunkSubtitles(chunkResults);
          setSubtitles(merged);
          if (failedChunks.length > 0) {
            setError(
              `บางส่วนล้มเหลว (${failedChunks.length}/${chunks.length} chunks: ${failedChunks.map((c) => c + 1).join(', ')}). แสดงผลบางส่วนที่สำเร็จแล้ว.`
            );
            setToast({ msg: `Translating success (${merged.length} cues, some failed)`, type: 'info' });
          } else {
setToast({ msg: `Subtitle ready (${merged.length} cues)`, type: 'success' });
          }
        }
      } else {
        setStatusMessage('กำลังส่งแทร็กเสียงไปยัง Gemini AI เพื่อถอดเสียงและแปลภาษา...');
        const fileToSend = chunks[0]?.blob || selectedFile;
        const fileNameToSend = selectedFile.name.replace(/\.[^/.]+$/, "") + ".wav";

        const formData = new FormData();
        formData.append('file', fileToSend, fileNameToSend);
        formData.append('targetLanguage', targetLanguage);

        const res = await fetch('/api/video-translate', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to transcribe and translate video.');
        }

        if (!controller.signal.aborted) {
          setSubtitles(data.subtitles || []);
          setToast({ msg: `Subtitle ready (${(data.subtitles || []).length} cues)`, type: 'success' });
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Translation aborted by user.');
      } else {
        console.error(err);
        setError(err instanceof Error ? err.message : 'An error occurred during translation.');
        setToast({ msg: err instanceof Error ? err.message : 'Translation failed', type: 'error' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleJumpToTime = (time: number) => {
    setSeekTime(time);
    setTimeout(() => setSeekTime(null), 50);
  };

  // Shared toast emitter passed down to child editors / export modal
  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ msg, type });
  };

  // Format seconds to mm:ss string
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
    () => subtitles.find((item) => currentTime >= item.startTime && currentTime <= item.endTime),
    [subtitles, currentTime]
  );

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-blue-600">
      {/* Contextual Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-40 px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-600 text-white shrink-0">
            <Video className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold tracking-tight text-zinc-50 flex flex-wrap items-center gap-2">
              Subtitle Studio
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/25">
                Gemini AI
              </span>
            </h1>
            <p className="text-[11px] text-zinc-400 truncate max-w-[240px] sm:max-w-sm">
              {selectedFile ? selectedFile.name : 'Speech-to-Text · Translation · Subtitle Editor'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {/* Target Language Select */}
          {selectedFile && (
            <div className="hidden sm:flex items-center gap-2 bg-zinc-950 border border-border px-3 py-1.5 rounded-lg text-xs text-zinc-300">
              <Languages className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <select
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value)}
                className="bg-transparent text-zinc-200 font-medium focus:outline-none cursor-pointer"
              >
                <option value="th" className="bg-zinc-900">ภาษาไทย</option>
                <option value="en" className="bg-zinc-900">English</option>
                <option value="ja" className="bg-zinc-900">日本語</option>
                <option value="zh" className="bg-zinc-900">中文</option>
                <option value="ko" className="bg-zinc-900">한국어</option>
              </select>
            </div>
          )}

          {/* Keyboard Shortcuts Trigger */}
          <button
            onClick={() => setIsShortcutsModalOpen(true)}
            className="text-[11px] text-zinc-300 hover:text-zinc-100 bg-zinc-900 border border-border hover:border-zinc-700 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
            title="Keyboard Shortcuts (?)"
          >
            <HelpCircle className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden sm:inline">Shortcuts</span>
          </button>

          {/* Upload new file (header, once a file is loaded the dock is gone) */}
          {selectedFile && (
            <label
              className="text-[11px] text-zinc-300 hover:text-zinc-100 bg-zinc-900 border border-border hover:border-zinc-700 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Upload a different video/audio file"
            >
              <Upload className="w-3.5 h-3.5 text-blue-400" />
              <span className="hidden sm:inline">Upload</span>
              <input type="file" accept="video/*,audio/*" onChange={handleFileSelect} className="hidden" />
            </label>
          )}

          {/* Undo / Redo */}
          {subtitles.length > 0 && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={undo}
                disabled={past.length === 0}
                className="p-2 rounded-lg bg-zinc-900 border border-border text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                onClick={redo}
                disabled={future.length === 0}
                className="p-2 rounded-lg bg-zinc-900 border border-border text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Redo (Ctrl+Shift+Z)"
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </div>
          )}

          {subtitles.length > 0 && (
            <button
              onClick={() => setIsExportOpen(true)}
              className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Export</span>
            </button>
          )}

          {/* Generate Subtitles — primary action once a file is selected */}
          {selectedFile && !isLoading && (
            <button
              onClick={handleTranslate}
              className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors"
              title="Transcribe & translate with Gemini AI"
            >
              <Sparkles className="w-4 h-4" />
              <span>Generate Subtitles</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content View */}
      <div className="relative flex-1 max-w-[1400px] w-full mx-auto p-3 sm:p-5 flex flex-col gap-4 min-h-0">
        {isLoading && (
          <div className="absolute top-3 left-3 right-3 z-30" aria-live="polite" role="status">
            <div className="p-4 rounded-2xl bg-surface border border-border shadow-2xl space-y-3">
              <div className="flex items-center justify-between text-xs gap-3">
                <div className="flex items-center gap-2 text-blue-400 font-medium min-w-0">
                  <Clock className="w-4 h-4 animate-spin shrink-0" />
                  <span className="truncate">{statusMessage}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-zinc-400 font-mono text-[11px]">
                    ~{formatTimeMinutes(remainingSecs)} left
                  </div>
                  <button
                    onClick={handleCancelTranslation}
                    className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 text-[11px] font-medium flex items-center gap-1 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                </div>
              </div>
              <div className="w-full bg-zinc-950 rounded-full h-2 overflow-hidden border border-border">
                <div className="bg-blue-500 h-full transition-all duration-500 ease-out" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-500">
                <span>Duration: {formatTimeMinutes(videoDuration)}</span>
                <span>{progressPercent}% · {formatTimeMinutes(elapsedSecs)} elapsed</span>
              </div>
            </div>
          </div>
        )}
        {/* Import Dock (shown until a file is loaded) */}
        {!selectedFile && !isLoading && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) {
                const synthetic = { target: { files: [f] } } as unknown as React.ChangeEvent<HTMLInputElement>;
                handleFileSelect(synthetic);
              }
            }}
            className="flex-1 min-h-[420px] rounded-2xl border border-dashed border-zinc-700 hover:border-blue-500 flex flex-col items-center justify-center gap-5 p-8 text-center transition-colors"
            style={{ borderRadius: 'var(--radius-lg)' }}
          >
            <div className="p-4 rounded-2xl bg-blue-600/10 border border-blue-500/25 text-blue-400">
              <Film className="w-9 h-9" />
            </div>
            <div className="space-y-1.5">
              <p className="text-base font-semibold text-zinc-200">Drop a video or audio file</p>
              <p className="text-xs text-zinc-500 max-w-sm">
                MP4 · MOV · MKV · WebM · MP3 · WAV — large files use parallel chunking automatically (max 2GB).
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="cursor-pointer px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-2 transition-colors">
                <Upload className="w-4 h-4" />
                Select File
                <input type="file" accept="video/*,audio/*" onChange={handleFileSelect} className="hidden" />
              </label>
            </div>
            <p className="text-[11px] text-zinc-600">Subtitle text saves locally as you edit.</p>
          </div>
        )}

{/* Status strip when a file is loaded (large-file / error) */}
        {selectedFile && (
          <div className="shrink-0 space-y-4">
            {isLargeFile && !isLoading && !error && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Large file detected <strong>({(selectedFile.size / (1024 * 1024)).toFixed(0)}MB)</strong>. Audio extraction uses optimized parallel chunking to preserve memory.
                </span>
              </div>
            )}

            {error && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span className="truncate">{error}</span>
                </div>
                {selectedFile && !isLoading && (
                  <button
                    onClick={handleTranslate}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-white font-medium text-xs flex items-center gap-1.5 shrink-0 border border-rose-500/40"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Studio Workspace (always visible once a file is loaded; progress overlays on top during processing) */}
        {selectedFile && (
          <div className="flex-1 flex flex-col gap-4 min-h-0">
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 min-h-0">
              {/* Left: Player (dominant) */}
              <div className="lg:col-span-7 xl:col-span-8 lg:h-[520px] min-h-0">
                <VideoPlayer
                  videoUrl={videoUrl}
                  subtitles={subtitles}
                  currentTime={currentTime}
                  onTimeUpdate={setCurrentTime}
                  seekTime={seekTime}
                />
              </div>

              {/* Right: Subtitle Editor (inspector) */}
              <div className="lg:col-span-5 xl:col-span-4 lg:h-[520px] min-h-0">
                <SubtitleEditor
                  subtitles={subtitles}
                  currentTime={currentTime}
                  onSubtitlesChange={commitSubtitles}
                  onJumpTo={handleJumpToTime}
                  targetLanguage={targetLanguage}
                  notify={showToast}
                />
              </div>
            </div>

            {/* Shared Timeline */}
            <Timeline
              selectedFile={selectedFile}
              currentTime={currentTime}
              duration={videoDuration}
              subtitles={subtitles}
              onSeek={handleJumpToTime}
              activeId={activeSubtitle?.id ?? null}
              onUpdateSub={(id, patch) =>
                setSubtitles((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
              }
              onDragStart={pushHistory}
            />
          </div>
        )}
      </div>

        {/* Export Modal */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        subtitles={subtitles}
        videoUrl={videoUrl}
        selectedFile={selectedFile}
        notify={showToast}
      />

      {/* Keyboard Shortcuts — inline dropdown (non-blocking) */}
      {isShortcutsModalOpen && (
        <div className="fixed top-16 right-4 z-50 w-72 max-w-[calc(100vw-2rem)] bg-surface border border-border rounded-xl shadow-2xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h3 className="text-xs font-bold text-zinc-100">Keyboard Shortcuts</h3>
            <button
              onClick={() => setIsShortcutsModalOpen(false)}
              className="text-zinc-400 hover:text-zinc-100 text-xs"
            >
              Esc
            </button>
          </div>
          <div className="space-y-2 text-xs">
            {[
              ['Play / Pause Video', 'Space'],
              ['Seek Backward 5s', '←'],
              ['Seek Forward 5s', '→'],
              ['Toggle Shortcuts Help', '?'],
              ['Close Panels / Help', 'Esc'],
            ].map(([label, key]) => (
              <div key={label} className="flex items-center justify-between py-1 border-b border-border/60">
                <span className="text-zinc-300">{label}</span>
                <kbd className="px-2 py-0.5 rounded bg-zinc-950 border border-border text-zinc-200 font-mono text-[10px]">{key}</kbd>
              </div>
            ))}
          </div>
        </div>
      )}
    {/* Toast notification */}
      {toast && (
        <div
          className="fixed bottom-5 right-5 z-[60] max-w-sm px-4 py-3 rounded-xl border shadow-2xl text-xs font-medium animate-fade-in"
          style={{
            background: 'var(--surface-2)',
            borderColor: toast.type === 'success' ? 'var(--ok)' : toast.type === 'error' ? 'var(--err)' : 'var(--accent)',
            color: 'var(--ink)',
          }}
        >
          <span
            className="mr-2"
            style={{ color: toast.type === 'success' ? 'var(--ok)' : toast.type === 'error' ? 'var(--err)' : 'var(--accent)' }}
          >
            {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}
          </span>
          {toast.msg}
        </div>
      )}
    </main>
  );
}
