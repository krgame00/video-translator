'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { SubtitleItem } from '@/lib/types';
import { generateSRT, generateVTT, sanitizeAndFixOverlaps } from '@/lib/srtFormatter';
import { uploadFileInChunks } from '@/lib/chunkedUploader';
import { COLOR_OPTIONS, type SubtitleStyleSettings } from '@/lib/subtitleStyle';
import { Download, FileText, X, Loader2, Clock, Zap, XCircle, Sparkles } from 'lucide-react';

// Files above this size use chunked upload instead of a single-stream fetch
// (avoids proxy payload limits / client memory pressure on very large videos).
const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024;
// Give up polling after 20 minutes so a lost job cannot poll forever.
const POLL_TIMEOUT_MS = 20 * 60 * 1000;

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  subtitles: SubtitleItem[];
  videoUrl: string | null;
  selectedFile?: File | null;
  /** Media duration in seconds; enables real server-side encode progress. */
  duration?: number;
  /** Real video dimensions (PlayRes) so the burn matches the preview. */
  playResX?: number;
  playResY?: number;
  /** SHARED subtitle style — prefilled from the player and written back. */
  style: SubtitleStyleSettings;
  onStyleChange: (s: SubtitleStyleSettings) => void;
  notify?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  subtitles,
  videoUrl,
  selectedFile,
  duration,
  playResX,
  playResY,
  style,
  onStyleChange,
  notify,
}) => {
  const [isFFmpegExporting, setIsFFmpegExporting] = useState(false);
  const [ffmpegStatus, setFfmpegStatus] = useState('');
  // Karaoke burn is opt-in and only meaningful when word timings exist
  const hasWordTimings = subtitles.some((s) => Array.isArray(s.words) && s.words.length > 0);
  const [karaoke, setKaraoke] = useState(false);

  // Polling lifecycle refs (interval, hard timeout, active job id, and a
  // resolver that lets Cancel settle the in-flight polling promise cleanly).
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const cancelPollResolveRef = useRef<(() => void) | null>(null);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  /** Best-effort server-side cancel: kills the FFmpeg process and cleans temp files. */
  const cancelServerJob = useCallback(() => {
    const jobId = activeJobIdRef.current;
    activeJobIdRef.current = null;
    if (jobId) {
      fetch(`/api/export-hardsub?action=cancel&jobId=${jobId}`, { method: 'POST' }).catch(() => {});
    }
  }, []);

  const handleCancelExport = useCallback(() => {
    if (!isFFmpegExporting) return;
    stopPolling();
    cancelServerJob();
    cancelPollResolveRef.current?.();
    cancelPollResolveRef.current = null;
    setIsFFmpegExporting(false);
    setFfmpegStatus('');
    notify?.('ยกเลิกการ export แล้ว (hardsub export cancelled)', 'info');
  }, [isFFmpegExporting, stopPolling, cancelServerJob, notify]);

  // Leaving/unmounting the page mid-export must not leak the poll loop.
  useEffect(() => {
    return () => {
      stopPolling();
      cancelServerJob();
      cancelPollResolveRef.current?.();
      cancelPollResolveRef.current = null;
    };
  }, [stopPolling, cancelServerJob]);

  const handleClose = useCallback(() => {
    if (isFFmpegExporting) {
      handleCancelExport();
    }
    onClose();
  }, [isFFmpegExporting, handleCancelExport, onClose]);

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
    notify?.(`Downloaded ${subtitles.length} cues (.srt)`, 'success');
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
    notify?.(`Downloaded ${subtitles.length} cues (.vtt)`, 'success');
  };

  // FFmpeg server-side hardsub export: prepare job → upload video → poll
  // status → download. Cancellable and bounded by POLL_TIMEOUT_MS.
  const handleFFmpegExportHardsub = async () => {
    if (!selectedFile && !videoUrl) return;

    setIsFFmpegExporting(true);
    setFfmpegStatus('กำลังเตรียมข้อมูลคำบรรยาย...');
    notify?.('Starting hardsub video export…', 'info');

    try {
      const cleanSubtitles = sanitizeAndFixOverlaps(subtitles);

      // 1. Prepare export job
      const prepRes = await fetch('/api/export-hardsub?action=prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subtitles: cleanSubtitles,
          duration,
          playResX,
          playResY,
          karaoke,
          style: {
            fontSize: style.fontSize,
            primaryColor: style.primaryColor,
            borderStyle: style.borderStyle,
            marginV: style.marginV,
            position: style.position,
            fontName: 'Itim'
          }
        }),
      });

      const prepData = await prepRes.json();
      if (!prepData.success || !prepData.jobId) {
        throw new Error(prepData.error || 'Failed to initialize export session.');
      }

      const jobId = prepData.jobId;
      activeJobIdRef.current = jobId;
      setFfmpegStatus('กำลังส่งไฟล์วิดีโอเข้าสู่ FFmpeg Engine...');

      let fileToSend: Blob;
      if (selectedFile) {
        fileToSend = selectedFile;
      } else {
        const resVid = await fetch(videoUrl!);
        fileToSend = await resVid.blob();
      }

      if (fileToSend.size > LARGE_FILE_THRESHOLD) {
        // 2b. Large file: chunked upload (file.slice) + attach to job
        setFfmpegStatus('กำลังส่งไฟล์วิดีโอขนาดใหญ่ (Chunked Upload)...');

        const { uploadId } = await uploadFileInChunks({
          file: fileToSend,
          fileName: selectedFile?.name || 'video.mp4',
          onProgress: (uploaded, total) => {
            const pct = Math.min(100, Math.round((uploaded / total) * 100));
            setFfmpegStatus(`กำลังอัปโหลดวิดีโอแบบแบ่งส่วน... ${pct}% (${(uploaded / 1048576).toFixed(0)}MB / ${(total / 1048576).toFixed(0)}MB)`);
          },
        });

        const attachRes = await fetch(
          `/api/export-hardsub?action=attach&jobId=${jobId}&uploadId=${uploadId}`,
          { method: 'POST' }
        );
        if (!attachRes.ok) {
          let errData;
          try { errData = await attachRes.json(); } catch {}
          throw new Error(errData?.error || `Attach failed with HTTP ${attachRes.status}`);
        }
      } else {
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
      }

      setFfmpegStatus('กำลังเข้ารหัสวิดีโอด้วย FFmpeg (Server-Side)...');

      // 3. Poll job status every 1.5s until complete, with a hard timeout.
      //    Cancel resolves the promise so the async flow ends cleanly.
      let wasCancelled = false;
      await new Promise<void>((resolve, reject) => {
        cancelPollResolveRef.current = () => {
          wasCancelled = true;
          resolve();
        };

        pollIntervalRef.current = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/export-hardsub?action=status&jobId=${jobId}`);
            if (!statusRes.ok) return;

            const statusData = await statusRes.json();
            if (!statusData.success) return;

            if (statusData.status === 'encoding') {
              setFfmpegStatus(`กำลังเข้ารหัสด้วย FFmpeg... (${statusData.progress ?? 30}%)`);
            } else if (statusData.status === 'completed') {
              stopPolling();
              resolve();
            } else if (statusData.status === 'failed' || statusData.status === 'cancelled') {
              stopPolling();
              reject(new Error(statusData.error || 'FFmpeg encoding failed.'));
            }
          } catch (pollErr) {
            console.warn('Status poll warning:', pollErr);
          }
        }, 1500);

        pollTimeoutRef.current = setTimeout(() => {
          stopPolling();
          reject(new Error('หมดเวลารอผลการเข้ารหัส (20 นาที) — โปรดลองอีกครั้ง'));
        }, POLL_TIMEOUT_MS);
      });

      if (wasCancelled) return;

      setFfmpegStatus('ประมวลผลเสร็จสิ้น! กำลังเริ่มดาวน์โหลด...');

      // 4. Trigger download
      const downloadUrl = `/api/export-hardsub?action=download&jobId=${jobId}`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = (selectedFile?.name.replace(/\.[^/.]+$/, "") || "hardsub_video") + "_hardsub.mp4";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      notify?.(`Hardsub video ready for download`, 'success');

    } catch (err: unknown) {
      console.error(err);
      const errMessage = err instanceof Error ? err.message : String(err);
      notify?.(`Hardsub export error: ${errMessage}`, 'error');
    } finally {
      stopPolling();
      activeJobIdRef.current = null;
      cancelPollResolveRef.current = null;
      setIsFFmpegExporting(false);
      setFfmpegStatus('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050507]/80 backdrop-blur-md animate-fade-in" role="dialog" aria-modal="true" aria-label="Export subtitles">
      <div className="w-full max-w-md max-h-[88svh] overflow-y-auto custom-scrollbar bg-[#0f0f14] border border-[#232334] rounded-2xl p-4 sm:p-6 shadow-2xl space-y-6">
        <div className="flex items-center justify-between border-b border-[#232334] pb-4">
          <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
            <Download className="w-5 h-5 text-cyan-400" />
            <span>Export Subtitles</span>
          </h3>
          <button
            onClick={handleClose}
            aria-label="Close export dialog"
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

          {/* Dynamic Style Customization Section — SHARED with the player preview */}
          <div className="p-3.5 rounded-xl bg-[#09090e] border border-[#232334] space-y-3">
            <p className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
              <span>Subtitle Hardsub Style (ตั้งค่าสไตล์ซับ)</span>
              <span className="text-[10px] text-emerald-400 font-normal">synced with preview</span>
            </p>

            <div className="grid grid-cols-3 gap-2 text-xs">
              {/* Size Selector */}
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Font Size</label>
                <select
                  value={style.fontSize}
                  onChange={(e) => onStyleChange({ ...style, fontSize: Number(e.target.value) })}
                  className="w-full bg-[#050507] border border-[#232334] rounded-lg px-2 py-1 text-white focus:outline-none text-xs"
                >
                  {[18, 22, 26].map((sz) => (
                    <option key={sz} value={sz}>{sz}px</option>
                  ))}
                </select>
              </div>

              {/* Color Selector */}
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Text Color</label>
                <select
                  value={style.primaryColor}
                  onChange={(e) => onStyleChange({ ...style, primaryColor: e.target.value })}
                  className="w-full bg-[#050507] border border-[#232334] rounded-lg px-2 py-1 text-white focus:outline-none text-xs"
                >
                  {COLOR_OPTIONS.map((col) => (
                    <option key={col} value={col}>#{col}</option>
                  ))}
                </select>
              </div>

              {/* Background Style */}
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Background</label>
                <select
                  value={style.borderStyle}
                  onChange={(e) => onStyleChange({ ...style, borderStyle: Number(e.target.value) as 1 | 4 })}
                  className="w-full bg-[#050507] border border-[#232334] rounded-lg px-2 py-1 text-white focus:outline-none text-xs"
                >
                  <option value={4}>Black Box (กล่อง)</option>
                  <option value={1}>Outline Only (ขอบ)</option>
                </select>
              </div>
            </div>

            {/* Position + Margin (mirrors the player settings) */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Position</label>
                <select
                  value={style.position}
                  onChange={(e) => onStyleChange({ ...style, position: e.target.value as 'top' | 'middle' | 'bottom' })}
                  className="w-full bg-[#050507] border border-[#232334] rounded-lg px-2 py-1 text-white focus:outline-none text-xs capitalize"
                >
                  <option value="bottom">Bottom (ล่าง)</option>
                  <option value="middle">Middle (กลาง)</option>
                  <option value="top">Top (บน)</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-zinc-400 block mb-1">Margin V: {style.marginV}</label>
                <input
                  type="range"
                  min={10}
                  max={120}
                  step={2}
                  value={style.marginV}
                  onChange={(e) => onStyleChange({ ...style, marginV: Number(e.target.value) })}
                  className="w-full accent-emerald-500"
                />
              </div>
            </div>

            {/* Karaoke (word-fill) burn option */}
            {hasWordTimings && (
              <div className="p-2.5 rounded-lg bg-[#050507] border border-amber-500/30 space-y-2">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-[11px] font-medium text-amber-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    คาราโอเกะ (ไฮไลต์ทีละคำ)
                  </span>
                  <input
                    type="checkbox"
                    checked={karaoke}
                    onChange={(e) => setKaraoke(e.target.checked)}
                    className="rounded border-zinc-600 bg-zinc-900 text-amber-500 focus:ring-0"
                  />
                </label>
                {karaoke && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-400">สีไฮไลต์:</span>
                    {COLOR_OPTIONS.map((col) => (
                      <button
                        key={col}
                        onClick={() => onStyleChange({ ...style, primaryColor: col })}
                        style={{ backgroundColor: `#${col}` }}
                        aria-label={`Highlight color ${col}`}
                        className={`w-4 h-4 rounded-full border border-white/20 transition-transform ${
                          style.primaryColor === col ? 'scale-125 ring-2 ring-amber-400' : 'hover:scale-110'
                        }`}
                      />
                    ))}
                    <span className="text-[9px] text-zinc-500 ml-1">(ยังไม่ถูกเลือก = ใช้สีข้อความ)</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* FFmpeg Server-Side Hardsub Video Option */}
          <div className="space-y-2">
            <button
              disabled={(!videoUrl && !selectedFile) || isFFmpegExporting}
              onClick={handleFFmpegExportHardsub}
              className="w-full flex items-center justify-between p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-500/40 hover:border-emerald-400 hover:bg-emerald-950/90 transition-colors text-left group disabled:opacity-50 disabled:cursor-not-allowed"
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
                      ⚡ Fast Encode
                    </span>
                  </p>
                  <p className="text-xs text-zinc-400">
                    {isFFmpegExporting ? 'FFmpeg Processing...' : 'FFmpeg Server-Side Encoding (CPU x264 ultrafast)'}
                  </p>
                </div>
              </div>
              <Download className="w-4 h-4 text-emerald-400 group-hover:translate-y-0.5 transition-transform" />
            </button>

            {isFFmpegExporting && (
              <div className="p-3 rounded-xl bg-[#050507] border border-emerald-500/40 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-medium animate-pulse min-w-0">
                    <Clock className="w-4 h-4 shrink-0" />
                    <span className="truncate">{ffmpegStatus}</span>
                  </div>
                  <button
                    onClick={handleCancelExport}
                    className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 font-medium flex items-center gap-1 shrink-0 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" /> ยกเลิก
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
