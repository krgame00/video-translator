'use client';

import React, { useState, useRef } from 'react';
import { SubtitleItem } from '@/lib/types';
import { generateSRT, generateVTT, sanitizeAndFixOverlaps } from '@/lib/srtFormatter';
import { Download, FileText, Video, X, Loader2, Clock, StopCircle, Zap } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  subtitles: SubtitleItem[];
  videoUrl: string | null;
  selectedFile?: File | null;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  subtitles,
  videoUrl,
  selectedFile,
}) => {
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [isFFmpegExporting, setIsFFmpegExporting] = useState(false);
  const [ffmpegStatus, setFfmpegStatus] = useState('');
  const [exportProgress, setExportProgress] = useState(0);
  const [estRemainingSecs, setEstRemainingSecs] = useState(0);

  // Dynamic Styling States
  const [fontSize, setFontSize] = useState(22);
  const [primaryColor, setPrimaryColor] = useState('FFFFFF');
  const [borderStyle, setBorderStyle] = useState(4); // 4 = Box background

  const cancelExportRef = useRef(false);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);

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

  const handleCancelExport = () => {
    cancelExportRef.current = true;
    if (activeVideoRef.current) {
      activeVideoRef.current.pause();
    }
    setIsExportingVideo(false);
  };

  // 🚀 FFmpeg Server-Side High-Speed Hardsub Export (5x - 10x Speed, Perfect Audio Sync)
  // 🚀 FFmpeg Server-Side High-Speed Hardsub Export (GPU Accelerated + Async Polling)
  const handleFFmpegExportHardsub = async () => {
    if (!selectedFile && !videoUrl) return;

    setIsFFmpegExporting(true);
    setFfmpegStatus('กำลังเตรียมข้อมูลคำบรรยาย...');

    try {
      const cleanSubtitles = sanitizeAndFixOverlaps(subtitles);

      // 1. Prepare export job
      const prepRes = await fetch('/api/export-hardsub?action=prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          subtitles: cleanSubtitles,
          style: {
            fontSize,
            primaryColor,
            borderStyle,
            fontName: 'Itim'
          }
        }),
      });

      const prepData = await prepRes.json();
      if (!prepData.success || !prepData.jobId) {
        throw new Error(prepData.error || 'Failed to initialize export session.');
      }

      const jobId = prepData.jobId;
      setFfmpegStatus('กำลังส่งไฟล์วิดีโอเข้าสู่ FFmpeg Engine...');

      let fileToSend: Blob;
      if (selectedFile) {
        fileToSend = selectedFile;
      } else {
        const resVid = await fetch(videoUrl!);
        fileToSend = await resVid.blob();
      }

      // 2. Stream raw binary video payload directly to server
      const uploadRes = await fetch(`/api/export-hardsub?action=upload&jobId=${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: fileToSend,
      });

      if (!uploadRes.ok) {
        let errData;
        try { errData = await uploadRes.json(); } catch (e) {}
        throw new Error(errData?.error || `Upload failed with HTTP ${uploadRes.status}`);
      }

      setFfmpegStatus('กำลังประมวลผลด้วย FFmpeg GPU Hardware Acceleration (NVENC)...');

      // 3. Poll job status every 1.5s until complete (0% risk of browser fetch timeout)
      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/export-hardsub?action=status&jobId=${jobId}`);
            if (!statusRes.ok) return;

            const statusData = await statusRes.json();
            if (!statusData.success) return;

            if (statusData.status === 'encoding') {
              setFfmpegStatus(`กำลังประมวลผลด้วย FFmpeg GPU Hardware... (${statusData.progress || 30}%)`);
            } else if (statusData.status === 'completed') {
              clearInterval(interval);
              resolve();
            } else if (statusData.status === 'failed') {
              clearInterval(interval);
              reject(new Error(statusData.error || 'FFmpeg encoding failed.'));
            }
          } catch (pollErr) {
            console.warn('Status poll warning:', pollErr);
          }
        }, 1500);
      });

      setFfmpegStatus('ประมวลผลเสร็จสิ้น! กำลังเริ่มดาวน์โหลด...');

      // 4. Trigger download
      const downloadUrl = `/api/export-hardsub?action=download&jobId=${jobId}`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = (selectedFile?.name.replace(/\.[^/.]+$/, "") || "hardsub_video") + "_hardsub.mp4";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (err: unknown) {
      console.error(err);
      const errMessage = err instanceof Error ? err.message : String(err);
      alert('FFmpeg Hardsub Export Error: ' + errMessage);
    } finally {
      setIsFFmpegExporting(false);
      setFfmpegStatus('');
    }
  };

  // Client-side Canvas Fallback Hardsub Rendering
  const handleExportHardsubVideo = async () => {
    if (!videoUrl) return;

    setIsExportingVideo(true);
    setExportProgress(0);
    cancelExportRef.current = false;

    try {
      const tempVideo = document.createElement('video');
      tempVideo.src = videoUrl;
      tempVideo.crossOrigin = 'anonymous';
      tempVideo.muted = true;
      tempVideo.volume = 1.0;
      activeVideoRef.current = tempVideo;

      await new Promise((resolve) => {
        tempVideo.onloadedmetadata = resolve;
      });

      const renderSpeed = 1.0;
      tempVideo.playbackRate = renderSpeed;

      const canvas = document.createElement('canvas');
      canvas.width = tempVideo.videoWidth || 1280;
      canvas.height = tempVideo.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      const canvasStream = canvas.captureStream(30);

      let audioTracks: MediaStreamTrack[] = [];
      let audioCtx: AudioContext | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioCtx.createMediaElementSource(tempVideo);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        audioTracks = dest.stream.getAudioTracks();
      } catch (e) {
        console.warn('Audio rerouting fallback:', e);
      }

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
        if (audioCtx) {
          audioCtx.close().catch(() => {});
        }
        if (!cancelExportRef.current && chunks.length > 0) {
          const blob = new Blob(chunks, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'hardsub_video.webm';
          link.click();
          URL.revokeObjectURL(url);
        }
        setIsExportingVideo(false);
        activeVideoRef.current = null;
      };

      mediaRecorder.start();
      tempVideo.currentTime = 0;
      await tempVideo.play();

      const duration = tempVideo.duration;

      const renderFrame = () => {
        if (cancelExportRef.current || tempVideo.paused || tempVideo.ended) {
          mediaRecorder.stop();
          return;
        }

        ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);

        const curTime = tempVideo.currentTime;
        const pct = Math.min(100, Math.round((curTime / duration) * 100));
        setExportProgress(pct);

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
      activeVideoRef.current = null;
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
            onClick={() => {
              handleCancelExport();
              onClose();
            }}
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

          {/* Dynamic Style Customization Section */}
          <div className="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 space-y-3">
            <p className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
              <span>Subtitle Hardsub Style (ตั้งค่าสไตล์ซับ)</span>
            </p>

            <div className="grid grid-cols-3 gap-2 text-xs">
              {/* Size Selector */}
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Font Size</label>
                <select
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-1 text-white focus:outline-none text-xs"
                >
                  <option value={18}>Small (18px)</option>
                  <option value={22}>Normal (22px)</option>
                  <option value={26}>Large (26px)</option>
                </select>
              </div>

              {/* Color Selector */}
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Text Color</label>
                <select
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-1 text-white focus:outline-none text-xs"
                >
                  <option value="FFFFFF">White (ขาว)</option>
                  <option value="FFFF00">Yellow (เหลือง)</option>
                  <option value="00FFFF">Cyan (ฟ้า)</option>
                </select>
              </div>

              {/* Background Style */}
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Background</label>
                <select
                  value={borderStyle}
                  onChange={(e) => setBorderStyle(Number(e.target.value))}
                  className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-1 text-white focus:outline-none text-xs"
                >
                  <option value={4}>Black Box (กล่อง)</option>
                  <option value={1}>Outline Only (ขอบ)</option>
                </select>
              </div>
            </div>
          </div>

          {/* ⭐ FFmpeg High-Speed Hardsub Video Option */}
          <div className="space-y-2">
            <button
              disabled={(!videoUrl && !selectedFile) || isFFmpegExporting || isExportingVideo}
              onClick={handleFFmpegExportHardsub}
              className="w-full flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-emerald-950/80 to-teal-950/80 border border-emerald-500/40 hover:border-emerald-400 hover:bg-emerald-950/90 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-950/30"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-emerald-500/20 text-emerald-400 group-hover:scale-110 transition-transform">
                  {isFFmpegExporting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Zap className="w-5 h-5 fill-current" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-bold text-emerald-300 flex items-center gap-1.5">
                    Hardsub Video (.mp4)
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      ⚡ 5x-10x Fast
                    </span>
                  </p>
                  <p className="text-xs text-zinc-400">
                    {isFFmpegExporting ? 'FFmpeg Processing...' : 'FFmpeg Server-Side Encoding (1-2 mins)'}
                  </p>
                </div>
              </div>
              <Download className="w-4 h-4 text-emerald-400 group-hover:translate-y-0.5 transition-transform" />
            </button>

            {isFFmpegExporting && (
              <div className="p-3 rounded-xl bg-zinc-950 border border-emerald-500/40 space-y-2 text-xs">
                <div className="flex items-center gap-2 text-emerald-400 font-medium animate-pulse">
                  <Clock className="w-4 h-4 animate-spin" />
                  <span>{ffmpegStatus}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
