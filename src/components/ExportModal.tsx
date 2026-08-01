'use client';

import React, { useState } from 'react';
import { SubtitleItem } from '@/lib/types';
import { generateSRT, generateVTT, sanitizeAndFixOverlaps } from '@/lib/srtFormatter';
import { Download, FileText, X, Loader2, Clock, Zap } from 'lucide-react';

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
  const [isFFmpegExporting, setIsFFmpegExporting] = useState(false);
  const [ffmpegStatus, setFfmpegStatus] = useState('');

  // Dynamic Styling States
  const [fontSize, setFontSize] = useState(22);
  const [primaryColor, setPrimaryColor] = useState('FFFFFF');
  const [borderStyle, setBorderStyle] = useState(4); // 4 = Box background

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

  const handleCancelExport = () => {};

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
        try { errData = await uploadRes.json(); } catch {}
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050507]/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-md bg-[#0f0f14] border border-[#232334] rounded-2xl p-6 shadow-2xl space-y-6">
        <div className="flex items-center justify-between border-b border-[#232334] pb-4">
          <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
            <Download className="w-5 h-5 text-cyan-400" />
            <span>Export Subtitles</span>
          </h3>
          <button
            onClick={() => {
              handleCancelExport();
              onClose();
            }}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-[#161620] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          {/* SRT Export Option */}
          <button
            onClick={handleDownloadSRT}
            className="w-full flex items-center justify-between p-3.5 rounded-xl bg-[#09090e] border border-[#232334] hover:border-cyan-500/50 hover:bg-[#12121a] transition-all text-left group"
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-400 group-hover:scale-110 transition-transform">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">SubRip Subtitle (.srt)</p>
                <p className="text-xs text-zinc-500">Standard subtitle format (Instant download)</p>
              </div>
            </div>
            <Download className="w-4 h-4 text-zinc-500 group-hover:text-cyan-400 transition-colors" />
          </button>

          {/* VTT Export Option */}
          <button
            onClick={handleDownloadVTT}
            className="w-full flex items-center justify-between p-3.5 rounded-xl bg-[#09090e] border border-[#232334] hover:border-purple-500/50 hover:bg-[#12121a] transition-all text-left group"
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
          <div className="p-3.5 rounded-xl bg-[#09090e] border border-[#232334] space-y-3">
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
                  className="w-full bg-[#050507] border border-[#232334] rounded-lg px-2 py-1 text-white focus:outline-none text-xs"
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
                  className="w-full bg-[#050507] border border-[#232334] rounded-lg px-2 py-1 text-white focus:outline-none text-xs"
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
                  className="w-full bg-[#050507] border border-[#232334] rounded-lg px-2 py-1 text-white focus:outline-none text-xs"
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
              disabled={(!videoUrl && !selectedFile) || isFFmpegExporting}
              onClick={handleFFmpegExportHardsub}
              className="w-full flex items-center justify-between p-3.5 rounded-xl bg-gradient-to-r from-emerald-950/80 to-teal-950/80 border border-emerald-500/40 hover:border-emerald-400 hover:bg-emerald-950/90 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-950/30"
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
              <div className="p-3 rounded-xl bg-[#050507] border border-emerald-500/40 space-y-2 text-xs">
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
