'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { SubtitleItem } from '@/lib/types';

interface TimelineProps {
  selectedFile: File | null;
  currentTime: number;
  duration: number;
  subtitles: SubtitleItem[];
  onSeek: (time: number) => void;
  activeId?: string | null;
  onUpdateSub?: (id: string, patch: Partial<Pick<SubtitleItem, 'startTime' | 'endTime'>>) => void;
  onDragStart?: () => void;
}

type GestureMode = 'move' | 'resizeStart' | 'resizeEnd';

interface Gesture {
  mode: GestureMode;
  id: string;
  startClientX: number;
  origStart: number;
  origEnd: number;
}

export const Timeline: React.FC<TimelineProps> = ({
  selectedFile,
  currentTime,
  duration,
  subtitles,
  onSeek,
  activeId,
  onUpdateSub,
  onDragStart,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [isDecoding, setIsDecoding] = useState(false);
  const [cursor, setCursor] = useState<'crosshair' | 'grabbing' | 'ew-resize' | 'grab' | 'pointer' | 'default'>('crosshair');
  const gestureRef = useRef<Gesture | null>(null);

  // Decode audio amplitude peaks (single pass, reused for draws)
  useEffect(() => {
    if (!selectedFile) {
      setTimeout(() => setPeaks([]), 0);
      return;
    }
    let isSubscribed = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDecoding(true);

    selectedFile
      .arrayBuffer()
      .then((ab) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioCtx
          .decodeAudioData(ab)
          .then((buffer) => {
            if (!isSubscribed) {
              audioCtx.close().catch(() => {});
              return;
            }
            const rawData = buffer.getChannelData(0);
            const sampleCount = 600;
            const blockSize = Math.floor(rawData.length / sampleCount);
            const extractedPeaks: number[] = [];
            for (let i = 0; i < sampleCount; i++) {
              const start = i * blockSize;
              let sum = 0;
              for (let j = 0; j < blockSize; j += 10) {
                sum += Math.abs(rawData[start + j] || 0);
              }
              extractedPeaks.push(sum / (blockSize / 10));
            }
            const max = Math.max(...extractedPeaks) || 1;
            setPeaks(extractedPeaks.map((p) => p / max));
            setIsDecoding(false);
            audioCtx.close().catch(() => {});
          })
          .catch(() => {
            audioCtx.close().catch(() => {});
            if (isSubscribed) setIsDecoding(false);
          });
      })
      .catch(() => {
        if (isSubscribed) setIsDecoding(false);
      });

    return () => {
      isSubscribed = false;
    };
  }, [selectedFile]);

  // Single draw pass: waveform + subtitle blocks + playhead + time ruler
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const dur = duration > 0 ? duration : 0;
    const toX = (t: number) => (dur > 0 ? (t / dur) * width : 0);

    // 1. Subtitle blocks (blue when active, neutral otherwise)
    subtitles.forEach((sub) => {
      const x0 = toX(sub.startTime);
      const x1 = toX(sub.endTime);
      const bw = Math.max(4, x1 - x0);
      const isActive = sub.id === activeId;
      ctx.fillStyle = isActive
        ? 'oklch(0.68 0.14 250)'
        : 'oklch(0.24 0.04 250)';
      ctx.beginPath();
      ctx.roundRect(x0, 6, bw, 22, 4);
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x0, 6, bw, 22, 4);
        ctx.stroke();
        // Edge handles on the active block
        ctx.fillStyle = '#fff';
        ctx.fillRect(x0 - 2, 6, 4, 22);
        ctx.fillRect(x1 - 2, 6, 4, 22);
      }
    });

    // 2. Waveform peaks (bottom area)
    const waveTop = 44;
    const waveWidth = canvas.width;
    peaks.forEach((peak, i) => {
      const x = (i / peaks.length) * waveWidth;
      const barW = waveWidth / peaks.length;
      const barH = Math.max(3, peak * (height - waveTop - 10));
      const y = height - barH - 4;
      const isPlayed = currentTime / dur >= i / peaks.length;
      ctx.fillStyle = isPlayed
        ? 'oklch(0.68 0.14 250)'
        : 'oklch(0.2 0.01 250)';
      ctx.beginPath();
      ctx.roundRect(x, y, Math.max(2, barW - 1), barH, 2);
      ctx.fill();
    });

    // 3. Playhead
    const px = currentTime > 0 && dur > 0 ? toX(currentTime) : 0;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();
  }, [peaks, currentTime, duration, subtitles, activeId]);

  const pxToTime = useCallback(
    (clientX: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || duration <= 0) return 0;
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return pct * duration;
    },
    [duration]
  );

  // Hit-test pointer position against subtitle blocks (edges take priority)
  const hitTest = useCallback(
    (time: number): { id: string; mode: GestureMode } | null => {
      const found = subtitles.find(
        (s) => time >= s.startTime && time <= s.endTime
      );
      if (!found) return null;
      const dur = duration || 1;
      const W = canvasRef.current?.clientWidth || 0;
      const startPx = (found.startTime / dur) * W;
      const endPx = (found.endTime / dur) * W;
      const tPx = (time / dur) * W;
      if (Math.abs(tPx - startPx) <= EDGE_PX) return { id: found.id, mode: 'resizeStart' };
      if (Math.abs(tPx - endPx) <= EDGE_PX) return { id: found.id, mode: 'resizeEnd' };
      return { id: found.id, mode: 'move' } as const;
    },
    [subtitles, duration]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || duration <= 0) return;
      const time = pxToTime(e.clientX);
      const hit = hitTest(time);
      if (!hit) {
        onSeek(time);
        return;
      }
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const sub = subtitles.find((s) => s.id === hit.id);
      if (!sub) return;
      gestureRef.current = {
        mode: hit.mode,
        id: sub.id,
        startClientX: e.clientX,
        origStart: sub.startTime,
        origEnd: sub.endTime,
      };
      if (onDragStart) onDragStart();
      setCursor(hit.mode === 'move' ? 'grabbing' : 'ew-resize');
    },
    [duration, pxToTime, hitTest, subtitles, onSeek, onDragStart]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const g = gestureRef.current;
      if (!g || !onUpdateSub || duration <= 0) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = ((e.clientX - g.startClientX) / rect.width) * duration;
      const dur = duration;
      let start = g.origStart;
      let end = g.origEnd;
      if (g.mode === 'move') {
        start = Math.max(0, Math.min(dur, g.origStart + dx));
        end = Math.max(start + 0.1, Math.min(dur, g.origEnd + dx));
      } else if (g.mode === 'resizeStart') {
        start = Math.max(0, Math.min(g.origEnd - 0.1, g.origStart + dx));
      } else if (g.mode === 'resizeEnd') {
        end = Math.max(g.origStart + 0.1, Math.min(dur, g.origEnd + dx));
      }
      onUpdateSub(g.id, {
        startTime: Number(start.toFixed(3)),
        endTime: Number(end.toFixed(3)),
      });
    },
    [duration, onUpdateSub]
  );

  const endGesture = useCallback(() => {
    gestureRef.current = null;
    setCursor('crosshair');
  }, []);

  const handleHover = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (gestureRef.current) return;
      const time = pxToTime(e.clientX);
      const hit = hitTest(time);
      setCursor(hit ? (hit.mode === 'move' ? 'grab' : 'ew-resize') : 'crosshair');
    },
    [pxToTime, hitTest]
  );

  if (!selectedFile) return null;

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 space-y-2.5 select-none" style={{ borderRadius: 'var(--radius-lg)' }}>
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span className="font-medium text-zinc-300">Timeline</span>
        <span className="font-mono text-[11px] text-zinc-500">
          {formatClock(currentTime)} / {formatClock(duration)}
        </span>
      </div>
      <div className="relative w-full h-24 bg-zinc-950 rounded-xl overflow-hidden border border-border">
        <canvas
          ref={canvasRef}
          width={1200}
          height={96}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onPointerLeave={endGesture}
          onPointerEnter={handleHover}
          style={{ touchAction: 'none', cursor }}
          className="w-full h-full"
        />
        {isDecoding && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60 pointer-events-none">
            <span className="text-[11px] font-mono text-blue-400 animate-pulse">Decoding Audio Peaks…</span>
          </div>
        )}
      </div>
      <p className="text-[11px] text-zinc-500">
        Click to seek · drag block to move · drag edge to resize duration (active block shows white handles)
      </p>
    </div>
  );
};

// Edge hit tolerance in px
const EDGE_PX = 6;

function formatClock(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.trunc(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}