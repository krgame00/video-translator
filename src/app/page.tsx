'use client';

import React, { useState, useEffect } from 'react';
import { SubtitleItem } from '@/lib/types';
import { VideoPlayer } from '@/components/VideoPlayer';
import { WaveformVisualizer } from '@/components/WaveformVisualizer';
import dynamic from 'next/dynamic';
import { Upload, Sparkles, Download, Languages, Video, AlertCircle, Loader2, Clock, XCircle, Command, RotateCcw, HelpCircle } from 'lucide-react';

import { extractAudioChunks, AudioChunk } from '@/lib/audioExtractor';
import { mergeChunkSubtitles } from '@/lib/srtFormatter';

const SubtitleEditor = dynamic(() => import('@/components/SubtitleEditor').then(mod => ({ default: mod.SubtitleEditor })), { ssr: false });
const ExportModal = dynamic(() => import('@/components/ExportModal').then(mod => ({ default: mod.ExportModal })), { ssr: false });

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
  }, []);

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
      if (subtitles.length > 0 && typeof window !== 'undefined') {
        const confirmClear = window.confirm('Selecting a new file will clear your current subtitles. Continue?');
        if (!confirmClear) {
          e.target.value = '';
          return;
        }
      }

      // Revoke previous object URL if present to prevent memory leak
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }

      setSelectedFile(file);
      setIsLargeFile(file.size > 500 * 1024 * 1024);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setError(null);

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
      setError('Translation process was cancelled.');
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
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Translation aborted by user.');
      } else {
        console.error(err);
        setError(err instanceof Error ? err.message : 'An error occurred during translation.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleJumpToTime = (time: number) => {
    setSeekTime(time);
    setTimeout(() => setSeekTime(null), 50);
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

  return (
    <main className="min-h-screen bg-zinc-950 text-white flex flex-col font-sans selection:bg-blue-600">
      {/* Top Navigation Bar */}
      <header className="border-b border-zinc-800/80 bg-zinc-900/60 backdrop-blur-xl sticky top-0 z-40 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="p-2 rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20 shrink-0">
            <Video className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight text-white flex flex-wrap items-center gap-1.5 sm:gap-2">
              Video Subtitle Studio
              <span className="text-[9px] sm:text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Gemini AI
              </span>
            </h1>
            <p className="text-[11px] sm:text-xs text-zinc-400 hidden sm:block">Interactive STT, Translation & Subtitle Editor</p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Keyboard Shortcuts Trigger Button */}
          <button
            onClick={() => setIsShortcutsModalOpen(true)}
            className="text-[10px] text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 transition-all shadow-sm"
            title="Keyboard Shortcuts (?)"
          >
            <HelpCircle className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden sm:inline font-medium">Shortcuts</span>
            <kbd className="text-[9px] font-mono bg-zinc-800 text-zinc-400 px-1 py-0.2 rounded border border-zinc-700">?</kbd>
          </button>

          {subtitles.length > 0 && (
            <button
              onClick={() => setIsExportOpen(true)}
              className="px-3 sm:px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center gap-1.5 sm:gap-2 shadow-lg shadow-blue-600/20 transition-all hover:scale-[1.02]"
            >
              <Download className="w-4 h-4" />
              <span>Export</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content View */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6 flex flex-col">
        {/* Upload & Controls Section */}
        <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-5 backdrop-blur-xl flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
            {/* File Input Button */}
            <label className="cursor-pointer w-full sm:w-auto px-4 py-2.5 rounded-xl border border-dashed border-zinc-700 hover:border-blue-500 bg-zinc-950/60 hover:bg-zinc-950 text-zinc-300 hover:text-white transition-all flex items-center justify-center gap-2 text-xs font-medium max-w-full">
              <Upload className="w-4 h-4 text-blue-400 shrink-0" />
              <span className="truncate max-w-[200px] sm:max-w-[280px]">{selectedFile ? selectedFile.name : 'Select Video/Audio File'}</span>
              <input
                type="file"
                accept="video/*,audio/*"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>

            {/* Target Language Select */}
            <div className="flex items-center gap-2 bg-zinc-950/60 border border-zinc-800 px-3 py-2 rounded-xl text-xs text-zinc-300 w-full sm:w-auto">
              <Languages className="w-4 h-4 text-purple-400 shrink-0" />
              <span className="text-zinc-500 shrink-0">Translate to:</span>
              <select
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value)}
                className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
              >
                <option value="th" className="bg-zinc-900">Thai (ภาษาไทย)</option>
                <option value="en" className="bg-zinc-900">English</option>
                <option value="ja" className="bg-zinc-900">Japanese (日本語)</option>
                <option value="zh" className="bg-zinc-900">Chinese (中文)</option>
                <option value="ko" className="bg-zinc-900">Korean (한국어)</option>
              </select>
            </div>
          </div>

          {/* Action Button */}
          <button
            disabled={!selectedFile || isLoading}
            onClick={handleTranslate}
            className="w-full md:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-xs flex items-center justify-center gap-2 shadow-xl shadow-blue-600/20 transition-all hover:scale-[1.02]"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generating Subtitles...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 fill-current" />
                <span>Generate Subtitles with Gemini</span>
              </>
            )}
          </button>
        </div>

        {/* Large File Memory Safeguard Warning Banner */}
        {isLargeFile && selectedFile && !isLoading && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Large file detected (<strong>{(selectedFile.size / (1024 * 1024)).toFixed(0)}MB</strong>). Audio extraction will automatically use optimized parallel chunking to preserve system memory.
              </span>
            </div>
          </div>
        )}

        {/* Live AI Processing & Estimated Time Banner */}
        {isLoading && (
          <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-950/40 via-purple-950/30 to-zinc-900 border border-blue-500/40 space-y-3 shadow-xl" aria-live="polite" role="status">
            <div className="flex items-center justify-between text-xs gap-3">
              <div className="flex items-center gap-2 text-blue-400 font-medium">
                <Clock className="w-4 h-4 animate-spin" />
                <span>{statusMessage}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-zinc-400 font-mono text-[11px] sm:text-xs">
                  Remaining: <strong className="text-white font-bold">
                    {remainingSecs > 0 ? formatTimeMinutes(remainingSecs) : 'Finalizing...'}
                  </strong>
                </div>
                <button
                  onClick={handleCancelTranslation}
                  className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 text-[11px] font-medium flex items-center gap-1 transition-all"
                  title="Cancel Translation"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Cancel</span>
                </button>
              </div>
            </div>

            {/* Smooth Progress Bar */}
            <div className="w-full bg-zinc-950/80 rounded-full h-2 overflow-hidden border border-zinc-800">
              <div
                className="bg-gradient-to-r from-blue-500 to-purple-500 h-full transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-zinc-500">
              <span>Video duration: {formatTimeMinutes(videoDuration)}</span>
              <span>Progress: ~{progressPercent}% (Elapsed: {formatTimeMinutes(elapsedSecs)})</span>
            </div>
          </div>
        )}

        {/* Error Alert with Retry */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
            {selectedFile && (
              <button
                onClick={handleTranslate}
                className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-white font-medium text-xs flex items-center gap-1.5 transition-all shrink-0 border border-rose-500/40"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            )}
          </div>
        )}

        {/* Studio Workspace (Split View Layout) */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 min-h-0">
          {/* Left: Video Player & Audio Waveform Stage */}
          <div className="lg:col-span-7 flex flex-col space-y-4 min-h-0">
            <VideoPlayer
              videoUrl={videoUrl}
              subtitles={subtitles}
              currentTime={currentTime}
              onTimeUpdate={setCurrentTime}
              seekTime={seekTime}
            />

            {/* Audio Waveform & Subtitle Visualizer */}
            <WaveformVisualizer
              selectedFile={selectedFile}
              currentTime={currentTime}
              duration={videoDuration}
              subtitles={subtitles}
              onSeek={handleJumpToTime}
            />

            {/* Tips for Best Results Card */}
            <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 text-xs text-zinc-400 flex items-start gap-3 backdrop-blur-xl">
              <Sparkles className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold text-zinc-200">Tips for Best Results</p>
                <p className="text-zinc-400 leading-relaxed">
                  Click any subtitle row on the right to edit text or jump to exact timestamps. Use <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px] border border-zinc-700">Space</kbd> to toggle playback and <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px] border border-zinc-700">←/→</kbd> to seek. Subtitles are automatically saved locally as you edit.
                </p>
              </div>
            </div>
          </div>

          {/* Right: Interactive Subtitle Editor Stage */}
          <div className="lg:col-span-5 h-[500px] lg:h-[620px] min-h-0 overflow-hidden flex flex-col">
            <SubtitleEditor
              subtitles={subtitles}
              currentTime={currentTime}
              onSubtitlesChange={setSubtitles}
              onJumpTo={handleJumpToTime}
              targetLanguage={targetLanguage}
            />
          </div>
        </div>
      </div>

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        subtitles={subtitles}
        videoUrl={videoUrl}
        selectedFile={selectedFile}
      />

      {/* Keyboard Shortcuts Helper Modal */}
      {isShortcutsModalOpen && (
        <div className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Command className="w-5 h-5 text-blue-400" />
                <h3 className="text-sm font-bold text-white">Keyboard Shortcuts</h3>
              </div>
              <button
                onClick={() => setIsShortcutsModalOpen(false)}
                className="text-zinc-400 hover:text-white text-xs px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-all"
              >
                Esc
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-300">Play / Pause Video</span>
                <kbd className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-zinc-200 font-mono text-[11px]">Space</kbd>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-300">Seek Backward 5 Seconds</span>
                <kbd className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-zinc-200 font-mono text-[11px]">← Left Arrow</kbd>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-300">Seek Forward 5 Seconds</span>
                <kbd className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-zinc-200 font-mono text-[11px]">→ Right Arrow</kbd>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-zinc-800/60">
                <span className="text-zinc-300">Toggle Shortcuts Help</span>
                <kbd className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-zinc-200 font-mono text-[11px]">?</kbd>
              </div>

              <div className="flex items-center justify-between py-1.5">
                <span className="text-zinc-300">Close Modals / Help</span>
                <kbd className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-zinc-200 font-mono text-[11px]">Esc</kbd>
              </div>
            </div>

            <div className="pt-2 text-center">
              <button
                onClick={() => setIsShortcutsModalOpen(false)}
                className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium text-xs transition-all shadow-md"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
