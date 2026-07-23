'use client';

import React, { useState } from 'react';
import { SubtitleItem } from '@/lib/types';
import { generateSRT, generateVTT } from '@/lib/srtFormatter';
import { Download, FileText, Video, X, Loader2, Clock } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  subtitles: SubtitleItem[];
  videoUrl: string | null;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  subtitles,
  videoUrl,
}) => {
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [estRemainingSecs, setEstRemainingSecs] = useState(0);

  if (!isOpen) return null;

  const handleDownloadSRT = () => {
    const content = generateSRT(subtitles);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'subtitles.srt';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadVTT = () => {
    const content = generateVTT(subtitles);
    const blob = new Blob([content], { type: 'text/vtt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'subtitles.vtt';
    link.click();
    URL.revokeObjectURL(url);
  };

  // Client-side Hardsub Rendering with Normal 1x Speed and Full Audio Stream
  const handleExportHardsubVideo = async () => {
    if (!videoUrl) return;

    setIsExportingVideo(true);
    setExportProgress(0);

    try {
      const tempVideo = document.createElement('video');
      tempVideo.src = videoUrl;
      tempVideo.crossOrigin = 'anonymous';
      tempVideo.muted = false;
      tempVideo.volume = 1.0;

      await new Promise((resolve) => {
        tempVideo.onloadedmetadata = resolve;
      });

      // Normal 1x Speed Playback
      const renderSpeed = 1.0;
      tempVideo.playbackRate = renderSpeed;

      const canvas = document.createElement('canvas');
      canvas.width = tempVideo.videoWidth || 1280;
      canvas.height = tempVideo.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      const canvasStream = canvas.captureStream(30);

      // Capture original audio track from the video element
      let audioTracks: MediaStreamTrack[] = [];
      try {
        const fullStream =
          (tempVideo as any).captureStream ? (tempVideo as any).captureStream() :
          (tempVideo as any).mozCaptureStream ? (tempVideo as any).mozCaptureStream() : null;
        if (fullStream) {
          audioTracks = fullStream.getAudioTracks();
        }
      } catch (e) {
        console.warn('Audio capture fallback:', e);
      }

      // Create combined stream containing Canvas Video + Original Audio
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioTracks,
      ]);

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9,opus',
      });

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'hardsub_video.webm';
        link.click();
        URL.revokeObjectURL(url);
        setIsExportingVideo(false);
      };

      mediaRecorder.start();
      tempVideo.currentTime = 0;
      await tempVideo.play();

      const duration = tempVideo.duration;

      const renderFrame = () => {
        if (tempVideo.paused || tempVideo.ended) {
          mediaRecorder.stop();
          return;
        }

        ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);

        // Render current active subtitle
        const curTime = tempVideo.currentTime;
        const pct = Math.min(100, Math.round((curTime / duration) * 100));
        setExportProgress(pct);

        // Estimate remaining real time at 1x speed
        const remainingVidSecs = Math.max(0, duration - curTime);
        const estSecs = Math.round(remainingVidSecs / renderSpeed);
        setEstRemainingSecs(estSecs);

        const activeSub = subtitles.find(
          (s) => curTime >= s.startTime && curTime <= s.endTime
        );

        if (activeSub) {
          const fontSize = Math.max(18, Math.round(canvas.height * 0.045));
          ctx.font = `600 ${fontSize}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';

          const text = activeSub.translatedText;
          const padding = 16;
          const textMetrics = ctx.measureText(text);
          const rectWidth = textMetrics.width + padding * 2;
          const rectHeight = fontSize + padding;
          const x = canvas.width / 2;
          const y = canvas.height - canvas.height * 0.08;

          // Draw background pill
          ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
          ctx.beginPath();
          ctx.roundRect(
            x - rectWidth / 2,
            y - rectHeight + 4,
            rectWidth,
            rectHeight,
            12
          );
          ctx.fill();

          // Draw subtitle text
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(text, x, y);
        }

        requestAnimationFrame(renderFrame);
      };

      renderFrame();
    } catch (err) {
      console.error('Hardsub export failed:', err);
      alert('Failed to export hardsub video. Please try downloading .srt instead.');
      setIsExportingVideo(false);
    }
  };

  const formatEstTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m > 0 ? `${m}m ` : ''}${s}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <Download className="w-5 h-5 text-blue-400" />
            <span>Export Subtitles</span>
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          {/* SRT Export Option */}
          <button
            onClick={handleDownloadSRT}
            className="w-full flex items-center justify-between p-4 rounded-xl bg-zinc-950/80 border border-zinc-800 hover:border-blue-500/50 hover:bg-zinc-950 transition-all text-left group"
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-400 group-hover:scale-110 transition-transform">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">SubRip Subtitle (.srt)</p>
                <p className="text-xs text-zinc-500">Standard subtitle format (Instant download)</p>
              </div>
            </div>
            <Download className="w-4 h-4 text-zinc-500 group-hover:text-blue-400 transition-colors" />
          </button>

          {/* VTT Export Option */}
          <button
            onClick={handleDownloadVTT}
            className="w-full flex items-center justify-between p-4 rounded-xl bg-zinc-950/80 border border-zinc-800 hover:border-purple-500/50 hover:bg-zinc-950 transition-all text-left group"
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400 group-hover:scale-110 transition-transform">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">WebVTT Subtitle (.vtt)</p>
                <p className="text-xs text-zinc-500">HTML5 web video format (Instant download)</p>
              </div>
            </div>
            <Download className="w-4 h-4 text-zinc-500 group-hover:text-purple-400 transition-colors" />
          </button>

          {/* Hardsub Video Export Option */}
          <div className="space-y-2">
            <button
              disabled={!videoUrl || isExportingVideo}
              onClick={handleExportHardsubVideo}
              className="w-full flex items-center justify-between p-4 rounded-xl bg-zinc-950/80 border border-zinc-800 hover:border-emerald-500/50 hover:bg-zinc-950 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition-transform">
                  {isExportingVideo ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Video className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-200">Hardsub Video (.webm)</p>
                  <p className="text-xs text-zinc-500">
                    {isExportingVideo
                      ? `Rendering (Normal 1x speed)... ${exportProgress}%`
                      : 'Burn subtitles directly into video'}
                  </p>
                </div>
              </div>
              <Download className="w-4 h-4 text-zinc-500 group-hover:text-emerald-400 transition-colors" />
            </button>

            {/* Live Progress & Time Estimation for Hardsub Export */}
            {isExportingVideo && (
              <div className="p-3 rounded-xl bg-zinc-950 border border-emerald-500/30 space-y-2">
                <div className="flex items-center justify-between text-xs text-emerald-400">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 animate-spin" />
                    Estimated time remaining:
                  </span>
                  <span className="font-bold text-white font-mono">
                    {formatEstTime(estRemainingSecs)}
                  </span>
                </div>
                <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-300"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
