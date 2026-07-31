'use client';

import React, { useEffect, useRef, useState } from 'react';
import { SubtitleItem } from '@/lib/types';
import { Activity } from 'lucide-react';

interface WaveformVisualizerProps {
  selectedFile: File | null;
  currentTime: number;
  duration: number;
  subtitles: SubtitleItem[];
  onSeek: (time: number) => void;
}

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  selectedFile,
  currentTime,
  duration,
  subtitles,
  onSeek,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [isDecoding, setIsDecoding] = useState<boolean>(false);

  // Decode audio amplitude peaks when file changes
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
            const sampleCount = 200; // 200 bars across waveform
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
            const normalized = extractedPeaks.map((p) => p / max);

            setPeaks(normalized);
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

  // Render Canvas Waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    if (peaks.length === 0) return;

    const barWidth = width / peaks.length;
    const progressPct = duration > 0 ? currentTime / duration : 0;
    const currentX = progressPct * width;

    // 1. Draw Subtitle Range Highlight Regions
    subtitles.forEach((sub) => {
      if (duration <= 0) return;
      const startX = (sub.startTime / duration) * width;
      const endX = (sub.endTime / duration) * width;
      const subWidth = Math.max(3, endX - startX);

      ctx.fillStyle = 'rgba(168, 85, 247, 0.25)';
      ctx.beginPath();
      ctx.roundRect(startX, 4, subWidth, height - 8, 4);
      ctx.fill();

      ctx.fillStyle = '#C084FC';
      ctx.fillRect(startX, height - 4, subWidth, 2);
    });

    // 2. Draw Waveform Peaks
    peaks.forEach((peak, i) => {
      const x = i * barWidth;
      const barHeight = Math.max(4, peak * (height - 16));
      const y = (height - barHeight) / 2;

      ctx.fillStyle = x <= currentX ? '#3B82F6' : '#52525B';
      ctx.beginPath();
      ctx.roundRect(x, y, Math.max(2, barWidth - 1), barHeight, 2);
      ctx.fill();
    });

    // 3. Draw Playhead Needle Line
    ctx.strokeStyle = '#60A5FA';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(currentX, 0);
    ctx.lineTo(currentX, height);
    ctx.stroke();
  }, [peaks, currentTime, duration, subtitles]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || duration <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    onSeek(pct * duration);
  };

  if (!selectedFile) return null;

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-4 space-y-2 backdrop-blur-xl">
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span className="flex items-center gap-1.5 font-medium text-zinc-300">
          <Activity className="w-4 h-4 text-purple-400" />
          <span>Audio Waveform & Subtitle Track Visualizer</span>
        </span>
        {isDecoding ? (
          <span className="text-blue-400 font-mono animate-pulse text-[11px]">
            Decoding Audio Peaks...
          </span>
        ) : (
          <span className="text-zinc-500 text-[11px]">Click anywhere on waveform to jump</span>
        )}
      </div>

      <div className="relative w-full h-16 bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800/80 cursor-pointer shadow-inner">
        <canvas
          ref={canvasRef}
          width={800}
          height={64}
          onClick={handleCanvasClick}
          className="w-full h-full object-fill"
        />
      </div>
    </div>
  );
};
