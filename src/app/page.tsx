'use client';

import React, { useState, useEffect } from 'react';
import { SubtitleItem } from '@/lib/types';
import { VideoPlayer } from '@/components/VideoPlayer';
import { SubtitleEditor } from '@/components/SubtitleEditor';
import { ExportModal } from '@/components/ExportModal';
import { Upload, Sparkles, Download, Languages, Video, AlertCircle, Loader2, Clock, CheckCircle2 } from 'lucide-react';

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [targetLanguage, setTargetLanguage] = useState<string>('th');
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>([]);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [seekTime, setSeekTime] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);

  // Time Estimation States
  const [estimatedTotalSecs, setEstimatedTotalSecs] = useState<number>(0);
  const [elapsedSecs, setElapsedSecs] = useState<number>(0);

  // Restore subtitles from localStorage on initial load
  useEffect(() => {
    const saved = localStorage.getItem('video_translator_subtitles');
    if (saved) {
      try {
        setSubtitles(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved subtitles:', e);
      }
    }
  }, []);

  // Save subtitles to localStorage when modified
  useEffect(() => {
    if (subtitles.length > 0) {
      localStorage.setItem('video_translator_subtitles', JSON.stringify(subtitles));
    }
  }, [subtitles]);

  // Live timer tick during AI translation loading
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      setElapsedSecs(0);
      interval = setInterval(() => {
        setElapsedSecs((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setError(null);

      // Inspect video duration for accurate time estimation
      const tempVid = document.createElement('video');
      tempVid.src = url;
      tempVid.onloadedmetadata = () => {
        const dur = tempVid.duration || 0;
        setVideoDuration(dur);
        // Estimate: ~10s base + ~12% of video duration for Gemini STT & translation
        const est = Math.max(12, Math.round(dur * 0.12 + 10));
        setEstimatedTotalSecs(est);
      };
    }
  };

  const handleTranslate = async () => {
    if (!selectedFile) return;

    setIsLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('targetLanguage', targetLanguage);

    try {
      const res = await fetch('/api/video-translate', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to transcribe and translate video.');
      }

      setSubtitles(data.subtitles || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during translation.');
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
  const progressPercent = Math.min(95, Math.round((elapsedSecs / (estimatedTotalSecs || 1)) * 100));

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-blue-500/30">
      {/* Top Navigation Bar */}
      <header className="border-b border-zinc-800/80 bg-zinc-900/60 backdrop-blur-xl sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-tr from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-500/20">
            <Video className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              Video Subtitle Translator Studio
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Gemini AI
              </span>
            </h1>
            <p className="text-xs text-zinc-400">Interactive STT, Translation & Subtitle Editor</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {subtitles.length > 0 && (
            <button
              onClick={() => setIsExportOpen(true)}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-blue-600/20 transition-all hover:scale-[1.02]"
            >
              <Download className="w-4 h-4" />
              <span>Export Subtitles</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content View */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6 flex flex-col">
        {/* Upload & Controls Section */}
        <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-5 backdrop-blur-xl flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
            {/* File Input Button */}
            <label className="cursor-pointer w-full sm:w-auto px-4 py-2.5 rounded-xl border border-dashed border-zinc-700 hover:border-blue-500 bg-zinc-950/60 hover:bg-zinc-950 text-zinc-300 hover:text-white transition-all flex items-center justify-center gap-2 text-xs font-medium">
              <Upload className="w-4 h-4 text-blue-400" />
              <span>{selectedFile ? selectedFile.name : 'Select Video/Audio File'}</span>
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
            className="w-full md:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-xs flex items-center justify-center gap-2 shadow-xl shadow-purple-600/20 transition-all hover:scale-[1.02]"
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

        {/* Live AI Processing & Estimated Time Banner */}
        {isLoading && (
          <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-950/40 via-purple-950/30 to-zinc-900 border border-blue-500/40 space-y-3 shadow-xl">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-blue-400 font-medium">
                <Clock className="w-4 h-4 animate-spin" />
                <span>AI Processing Video Speech...</span>
              </div>
              <div className="text-zinc-400 font-mono">
                Estimated time remaining: <strong className="text-white font-bold">{formatTimeMinutes(remainingSecs)}</strong>
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

        {/* Error Alert */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-3">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Studio Workspace (Split View) */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[500px]">
          {/* Left: Video Player Stage */}
          <div className="lg:col-span-7 flex flex-col space-y-4">
            <VideoPlayer
              videoUrl={videoUrl}
              subtitles={subtitles}
              currentTime={currentTime}
              onTimeUpdate={setCurrentTime}
              seekTime={seekTime}
            />

            {/* Hint Box */}
            <div className="p-4 rounded-2xl bg-zinc-900/30 border border-zinc-800/60 text-xs text-zinc-500 flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-zinc-300">Tips for Best Results</p>
                <p className="mt-0.5 leading-relaxed">
                  Click any subtitle row on the right to edit text or jump to exact timestamps. Subtitles are automatically saved locally as you edit.
                </p>
              </div>
            </div>
          </div>

          {/* Right: Interactive Subtitle Editor Stage */}
          <div className="lg:col-span-5 h-[600px] lg:h-auto">
            <SubtitleEditor
              subtitles={subtitles}
              currentTime={currentTime}
              onSubtitlesChange={setSubtitles}
              onJumpTo={handleJumpToTime}
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
      />
    </main>
  );
}
