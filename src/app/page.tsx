'use client';

import React, { useReducer, useEffect, useMemo, useCallback, useRef } from 'react';
import { SubtitleItem } from '@/lib/types';
import { VideoPlayer } from '@/components/VideoPlayer';
import { Timeline } from '@/components/Timeline';
import { SubtitleEditor } from '@/components/SubtitleEditor';
import { ExportModal } from '@/components/ExportModal';
import { Upload, Download, Languages, Video, AlertCircle, Clock, XCircle, RotateCcw, HelpCircle, Film, Sparkles, Undo2, Redo2 } from 'lucide-react';

import { extractAudioChunks, AudioChunk } from '@/lib/audioExtractor';
import { mergeChunkSubtitles } from '@/lib/srtFormatter';

// ==================== Types ====================

interface AppState {
  // File & Video
  selectedFile: File | null;
  videoUrl: string | null;
  videoDuration: number;
  isLargeFile: boolean;
  
  // Subtitles
  subtitles: SubtitleItem[];
  targetLanguage: string;
  currentTime: number;
  seekTime: number | null;
  
  // Loading / Progress
  isLoading: boolean;
  statusMessage: string;
  error: string | null;
  estimatedTotalSecs: number;
  elapsedSecs: number;
  
  // History
  past: SubtitleItem[][];
  future: SubtitleItem[][];
  
  // UI
  isExportOpen: boolean;
  isShortcutsModalOpen: boolean;
  hasMounted: boolean;
  
  // Toast
  toast: { msg: string; type: 'success' | 'error' | 'info' } | null;
  
  // Abort
  abortController: AbortController | null;
}

type AppAction =
  | { type: 'SET_FILE'; payload: { file: File; url: string; duration: number; isLargeFile: boolean } }
  | { type: 'CLEAR_FILE' }
  | { type: 'SET_SUBTITLES'; payload: SubtitleItem[] }
  | { type: 'COMMIT_SUBTITLES'; payload: SubtitleItem[] }
  | { type: 'SET_CURRENT_TIME'; payload: number }
  | { type: 'SET_SEEK_TIME'; payload: number | null }
  | { type: 'SET_TARGET_LANGUAGE'; payload: string }
  | { type: 'START_TRANSLATION'; payload: { estimatedSecs: number; statusMessage: string; controller: AbortController } }
  | { type: 'UPDATE_PROGRESS'; payload: { elapsedSecs: number; statusMessage?: string } }
  | { type: 'TRANSLATION_SUCCESS'; payload: SubtitleItem[] }
  | { type: 'TRANSLATION_ERROR'; payload: string }
  | { type: 'TRANSLATION_CANCELLED' }
  | { type: 'SET_EXPORT_OPEN'; payload: boolean }
  | { type: 'SET_SHORTCUTS_OPEN'; payload: boolean }
  | { type: 'SET_HAS_MOUNTED'; payload: boolean }
  | { type: 'SET_TOAST'; payload: { msg: string; type: 'success' | 'error' | 'info' } | null }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'PUSH_HISTORY' }
  | { type: 'SET_VIDEO_DURATION'; payload: number }
  | { type: 'SET_ESTIMATED_SECS'; payload: number };

// ==================== Initial State ====================

const initialState: AppState = {
  selectedFile: null,
  videoUrl: null,
  videoDuration: 0,
  isLargeFile: false,
  subtitles: [],
  targetLanguage: 'th',
  currentTime: 0,
  seekTime: null,
  isLoading: false,
  statusMessage: 'AI Processing Video Speech...',
  error: null,
  estimatedTotalSecs: 0,
  elapsedSecs: 0,
  past: [],
  future: [],
  isExportOpen: false,
  isShortcutsModalOpen: false,
  hasMounted: false,
  toast: null,
  abortController: null,
};

// ==================== Reducer ====================

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_FILE': {
      if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
      return {
        ...state,
        selectedFile: action.payload.file,
        videoUrl: action.payload.url,
        videoDuration: action.payload.duration,
        isLargeFile: action.payload.isLargeFile,
        subtitles: [],
        past: [],
        future: [],
        error: null,
        elapsedSecs: 0,
        statusMessage: 'AI Processing Video Speech...',
      };
    }
    case 'CLEAR_FILE':
      if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
      return { ...initialState };
    
    case 'SET_SUBTITLES':
      return { ...state, subtitles: action.payload, past: [], future: [] };
    
    case 'COMMIT_SUBTITLES':
      if (JSON.stringify(action.payload) === JSON.stringify(state.subtitles)) return state;
      return {
        ...state,
        subtitles: action.payload,
        past: [...state.past.slice(-49), state.subtitles],
        future: [],
      };
    
    case 'SET_CURRENT_TIME':
      return { ...state, currentTime: action.payload };
    
    case 'SET_SEEK_TIME':
      return { ...state, seekTime: action.payload };
    
    case 'SET_TARGET_LANGUAGE':
      return { ...state, targetLanguage: action.payload };
    
    case 'START_TRANSLATION':
      return {
        ...state,
        isLoading: true,
        elapsedSecs: 0,
        estimatedTotalSecs: action.payload.estimatedSecs,
        statusMessage: action.payload.statusMessage,
        error: null,
        abortController: action.payload.controller,
      };
    
    case 'UPDATE_PROGRESS':
      return {
        ...state,
        elapsedSecs: action.payload.elapsedSecs,
        statusMessage: action.payload.statusMessage ?? state.statusMessage,
      };
    
    case 'TRANSLATION_SUCCESS':
      if (state.abortController?.signal.aborted) return state;
      return {
        ...state,
        isLoading: false,
        subtitles: action.payload,
        past: [],
        future: [],
        toast: { msg: `Subtitle ready (${action.payload.length} cues)`, type: 'success' },
      };
    
    case 'TRANSLATION_ERROR':
      if (state.abortController?.signal.aborted) return state;
      return {
        ...state,
        isLoading: false,
        error: action.payload,
        toast: { msg: action.payload, type: 'error' },
      };
    
    case 'TRANSLATION_CANCELLED':
      return {
        ...state,
        isLoading: false,
        abortController: null,
        statusMessage: 'Cancelled by user',
        toast: { msg: 'Translation cancelled', type: 'info' },
      };
    
    case 'SET_EXPORT_OPEN':
      return { ...state, isExportOpen: action.payload };
    
    case 'SET_SHORTCUTS_OPEN':
      return { ...state, isShortcutsModalOpen: action.payload };
    
    case 'SET_HAS_MOUNTED':
      return { ...state, hasMounted: action.payload };
    
    case 'SET_TOAST':
      return { ...state, toast: action.payload };
    
    case 'UNDO':
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1];
      return {
        ...state,
        subtitles: prev,
        past: state.past.slice(0, -1),
        future: [...state.future, state.subtitles],
      };
    
    case 'REDO':
      if (state.future.length === 0) return state;
      const next = state.future[state.future.length - 1];
      return {
        ...state,
        subtitles: next,
        past: [...state.past, state.subtitles],
        future: state.future.slice(0, -1),
      };
    
    case 'PUSH_HISTORY':
      return {
        ...state,
        past: [...state.past.slice(-49), state.subtitles],
        future: [],
      };
    
    case 'SET_VIDEO_DURATION':
      return { ...state, videoDuration: action.payload };
    
    case 'SET_ESTIMATED_SECS':
      return { ...state, estimatedTotalSecs: action.payload };
    
    default:
      return state;
  }
}

// ==================== Component ====================

export default function Home() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const { 
    selectedFile, videoUrl, videoDuration, isLargeFile, subtitles, targetLanguage,
    currentTime, seekTime, isLoading, statusMessage, error, estimatedTotalSecs,
    elapsedSecs, past, future, isExportOpen, isShortcutsModalOpen, hasMounted,
    toast, abortController
  } = state;

  const subtitlesRef = useRef(subtitles);
  useEffect(() => { subtitlesRef.current = subtitles; }, [subtitles]);

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
    const saved = localStorage.getItem('video_translator_subtitles');
    if (saved) {
      try {
        dispatch({ type: 'SET_SUBTITLES', payload: JSON.parse(saved) });
      } catch (e) {
        console.error('Failed to parse saved subtitles:', e);
      }
    }
  }, []);

  // Save to localStorage
  useEffect(() => {
    if (!hasMounted) return;
    if (subtitles.length > 0) {
      localStorage.setItem('video_translator_subtitles', JSON.stringify(subtitles));
    } else {
      localStorage.removeItem('video_translator_subtitles');
    }
  }, [subtitles, hasMounted]);

  // Cleanup on unmount
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  // Live timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      interval = setInterval(() => dispatch({ type: 'UPDATE_PROGRESS', payload: { elapsedSecs: elapsedSecs + 1 } }), 1000);
    }
    return () => clearInterval(interval);
  }, [isLoading, elapsedSecs]);

  // Keyboard shortcuts
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
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) dispatch({ type: 'REDO' });
        else dispatch({ type: 'UNDO' });
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
        if (videoEl) videoEl.currentTime = Math.max(0, videoEl.currentTime - 5);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        const videoEl = document.querySelector('video');
        if (videoEl) videoEl.currentTime = Math.min(videoEl.duration || 0, videoEl.currentTime + 5);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isShortcutsModalOpen]);

  // ----- Event Handlers -----
  
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (videoUrl) URL.revokeObjectURL(videoUrl);

    const url = URL.createObjectURL(file);
    dispatch({ type: 'SET_TOAST', payload: {
      msg: subtitles.length > 0
        ? `Loaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB) — subtitles cleared`
        : `Loaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
      type: file.size > 500 * 1024 * 1024 || subtitles.length > 0 ? 'info' : 'success'
    } });

    const tempVid = document.createElement('video');
    tempVid.muted = true;
    tempVid.volume = 0;
    tempVid.src = url;
    tempVid.onloadedmetadata = () => {
      const dur = tempVid.duration || 0;
      dispatch({ type: 'SET_FILE', payload: { file, url, duration: dur, isLargeFile: file.size > 500 * 1024 * 1024 } });
      dispatch({ type: 'SET_VIDEO_DURATION', payload: dur });
      dispatch({ type: 'SET_ESTIMATED_SECS', payload: Math.max(10, Math.round(dur * 0.05 + 8)) });
      tempVid.src = '';
      tempVid.load();
    };
  }, [videoUrl, subtitles.length]);

  const handleCancelTranslation = useCallback(() => {
    if (abortController) {
      abortController.abort();
      dispatch({ type: 'TRANSLATION_CANCELLED' });
    }
  }, [abortController]);

  const handleTranslate = useCallback(async () => {
    if (!selectedFile) return;

    const controller = new AbortController();
    dispatch({ type: 'START_TRANSLATION', payload: {
      estimatedSecs: estimatedTotalSecs,
      statusMessage: 'กำลังสกัดเฉพาะแทร็กเสียงและแบ่งท่อนเพื่อความเร็วระดับสูงสุด...',
      controller,
    } });
    dispatch({ type: 'SET_TOAST', payload: { msg: 'Starting AI translation…', type: 'info' } });

    try {
      const chunks = await extractAudioChunks(selectedFile, 300);
      console.log(`[Audio Chunker] Total chunks created: ${chunks.length}`);

      if (chunks.length > 1) {
        dispatch({ type: 'UPDATE_PROGRESS', payload: { 
          elapsedSecs, 
          statusMessage: `กำลังส่ง ${chunks.length} Chunks ประมวลผลพร้อมกันผ่าน Gemini AI Parallel Workers...` 
        } });

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
              const res = await fetch('/api/video-translate-chunk', { 
                method: 'POST', 
                body: formData, 
                signal: controller.signal 
              });
              const data = await res.json();
              if (!data.success) throw new Error(data.error || `Failed on chunk ${chunk.chunkIndex + 1}`);
              completedChunks++;
              dispatch({ type: 'UPDATE_PROGRESS', payload: { 
                elapsedSecs, 
                statusMessage: `กำลังประมวลผล Gemini Parallel Stream (${completedChunks}/${chunks.length} ท่อนสำเร็จแล้ว)...` 
              } });
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
            try { return await processChunk(chunk); }
            catch (err: unknown) {
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
          dispatch({ type: 'TRANSLATION_SUCCESS', payload: merged });
          if (failedChunks.length > 0) {
            dispatch({ type: 'SET_TOAST', payload: { 
              msg: `Translating success (${merged.length} cues, some failed)`, 
              type: 'info' 
            } });
          }
        }
      } else {
        dispatch({ type: 'UPDATE_PROGRESS', payload: { 
          elapsedSecs, 
          statusMessage: 'กำลังส่งแทร็กเสียงไปยัง Gemini AI เพื่อถอดเสียงและแปลภาษา...' 
        } });
        const fileToSend = chunks[0]?.blob || selectedFile;
        const fileNameToSend = selectedFile.name.replace(/\.[^/.]+$/, "") + ".wav";

        const formData = new FormData();
        formData.append('file', fileToSend, fileNameToSend);
        formData.append('targetLanguage', targetLanguage);

        const res = await fetch('/api/video-translate', {
          method: 'POST', body: formData, signal: controller.signal
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed to transcribe and translate video.');

        if (!controller.signal.aborted) {
          dispatch({ type: 'TRANSLATION_SUCCESS', payload: data.subtitles || [] });
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
  }, [selectedFile, targetLanguage, estimatedTotalSecs, elapsedSecs]);

  const handleJumpToTime = useCallback((time: number) => {
    dispatch({ type: 'SET_SEEK_TIME', payload: time });
    setTimeout(() => dispatch({ type: 'SET_SEEK_TIME', payload: null }), 50);
  }, []);

  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    dispatch({ type: 'SET_TOAST', payload: { msg, type } });
  }, []);

  const pushHistory = useCallback(() => dispatch({ type: 'PUSH_HISTORY' }), []);

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

  // ----- Render -----
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-blue-600">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur-xl sticky top-0 z-40 px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-600 text-white shrink-0"><Video className="w-5 h-5" /></div>
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
          {selectedFile && (
            <div className="hidden sm:flex items-center gap-2 bg-zinc-950 border border-zinc-800 px-3 py-1.5 rounded-lg text-xs text-zinc-300">
              <Languages className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <select value={targetLanguage} onChange={(e) => dispatch({ type: 'SET_TARGET_LANGUAGE', payload: e.target.value })} className="bg-transparent text-zinc-200 font-medium focus:outline-none cursor-pointer">
                <option value="th" className="bg-zinc-900">ภาษาไทย</option>
                <option value="en" className="bg-zinc-900">English</option>
                <option value="ja" className="bg-zinc-900">日本語</option>
                <option value="zh" className="bg-zinc-900">中文</option>
                <option value="ko" className="bg-zinc-900">한국어</option>
              </select>
            </div>
          )}

          <button onClick={() => dispatch({ type: 'SET_SHORTCUTS_OPEN', payload: true })} className="text-[11px] text-zinc-300 hover:text-zinc-100 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors" title="Keyboard Shortcuts (?)">
            <HelpCircle className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden sm:inline">Shortcuts</span>
          </button>

          {selectedFile && (
            <label className="text-[11px] text-zinc-300 hover:text-zinc-100 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer" title="Upload a different video/audio file">
              <Upload className="w-3.5 h-3.5 text-blue-400" />
              <span className="hidden sm:inline">Upload</span>
              <input type="file" accept="video/*,audio/*" onChange={handleFileSelect} className="hidden" />
            </label>
          )}

          {subtitles.length > 0 && (
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => dispatch({ type: 'UNDO' })} disabled={past.length === 0} className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Undo (Ctrl+Z)">
                <Undo2 className="w-4 h-4" />
              </button>
              <button onClick={() => dispatch({ type: 'REDO' })} disabled={future.length === 0} className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Redo (Ctrl+Shift+Z)">
                <Redo2 className="w-4 h-4" />
              </button>
            </div>
          )}

          {subtitles.length > 0 && (
            <button onClick={() => dispatch({ type: 'SET_EXPORT_OPEN', payload: true })} className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors">
              <Download className="w-4 h-4" />
              <span>Export</span>
            </button>
          )}

          {selectedFile && !isLoading && (
            <button onClick={handleTranslate} className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors" title="Transcribe & translate with Gemini AI">
              <Sparkles className="w-4 h-4" />
              <span>Generate Subtitles</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="relative flex-1 max-w-[1400px] w-full mx-auto p-3 sm:p-5 flex flex-col gap-4 min-h-0">
        {isLoading && (
          <div className="absolute top-3 left-3 right-3 z-30" aria-live="polite" role="status">
            <div className="p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 shadow-2xl space-y-3">
              <div className="flex items-center justify-between text-xs gap-3">
                <div className="flex items-center gap-2 text-blue-400 font-medium min-w-0">
                  <Clock className="w-4 h-4 animate-spin shrink-0" />
                  <span className="truncate">{statusMessage}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-zinc-400 font-mono text-[11px]">~{formatTimeMinutes(remainingSecs)} left</div>
                  <button onClick={handleCancelTranslation} className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 text-[11px] font-medium flex items-center gap-1 transition-colors">
                    <XCircle className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
              <div className="w-full bg-zinc-950 rounded-full h-2 overflow-hidden border border-zinc-800">
                <div className="bg-blue-500 h-full transition-all duration-500 ease-out" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-500">
                <span>Duration: {formatTimeMinutes(videoDuration)}</span>
                <span>{progressPercent}% · {formatTimeMinutes(elapsedSecs)} elapsed</span>
              </div>
            </div>
          </div>
        )}

        {!selectedFile && !isLoading && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) { const synthetic = { target: { files: [f] } } as unknown as React.ChangeEvent<HTMLInputElement>; handleFileSelect(synthetic); } }}
            className="flex-1 min-h-[420px] rounded-2xl border border-dashed border-zinc-700 hover:border-blue-500 flex flex-col items-center justify-center gap-5 p-8 text-center transition-colors"
          >
            <div className="p-4 rounded-2xl bg-blue-600/10 border border-blue-500/25 text-blue-400"><Film className="w-9 h-9" /></div>
            <div className="space-y-1.5">
              <p className="text-base font-semibold text-zinc-200">Drop a video or audio file</p>
              <p className="text-xs text-zinc-500 max-w-sm">MP4 · MOV · MKV · WebM · MP3 · WAV — large files use parallel chunking automatically (max 2GB).</p>
            </div>
            <label className="cursor-pointer px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-2 transition-colors">
              <Upload className="w-4 h-4" /> Select File
              <input type="file" accept="video/*,audio/*" onChange={handleFileSelect} className="hidden" />
            </label>
            <p className="text-[11px] text-zinc-600">Subtitle text saves locally as you edit.</p>
          </div>
        )}

        {selectedFile && (
          <div className="shrink-0 space-y-4">
            {isLargeFile && !isLoading && !error && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Large file detected <strong>({(selectedFile.size / (1024 * 1024)).toFixed(0)}MB)</strong>. Audio extraction uses optimized parallel chunking to preserve memory.</span>
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
          </div>
        )}

        {/* Studio Workspace */}
        {selectedFile && (
          <div className="flex-1 flex flex-col gap-4 min-h-0">
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 min-h-0">
              <div className="lg:col-span-7 xl:col-span-8 lg:h-[520px] min-h-0">
                <VideoPlayer videoUrl={videoUrl} subtitles={subtitles} currentTime={currentTime} onTimeUpdate={(t) => dispatch({ type: 'SET_CURRENT_TIME', payload: t })} seekTime={seekTime} />
              </div>
              <div className="lg:col-span-5 xl:col-span-4 lg:h-[520px] min-h-0">
                <SubtitleEditor subtitles={subtitles} currentTime={currentTime} onSubtitlesChange={(s) => dispatch({ type: 'COMMIT_SUBTITLES', payload: s })} onJumpTo={handleJumpToTime} targetLanguage={targetLanguage} notify={showToast} />
              </div>
            </div>
            <Timeline selectedFile={selectedFile} currentTime={currentTime} duration={videoDuration} subtitles={subtitles} onSeek={handleJumpToTime} activeId={activeSubtitle?.id ?? null} onUpdateSub={(id, patch) => dispatch({ type: 'COMMIT_SUBTITLES', payload: subtitles.map((s) => s.id === id ? { ...s, ...patch } : s) })} onDragStart={pushHistory} />
          </div>
        )}
      </div>

      {/* Export Modal */}
      <ExportModal isOpen={isExportOpen} onClose={() => dispatch({ type: 'SET_EXPORT_OPEN', payload: false })} subtitles={subtitles} videoUrl={videoUrl} selectedFile={selectedFile} notify={showToast} />

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

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] max-w-sm px-4 py-3 rounded-xl border shadow-2xl text-xs font-medium animate-fade-in"
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