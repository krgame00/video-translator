'use client';

import React, { useRef, useEffect } from 'react';
import { SubtitleItem } from '@/lib/types';

interface VideoPlayerProps {
  videoUrl: string | null;
  subtitles: SubtitleItem[];
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  seekTime: number | null;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoUrl,
  subtitles,
  currentTime,
  onTimeUpdate,
  seekTime,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Synchronize seek requests from parent/SubtitleEditor
  useEffect(() => {
    if (seekTime !== null && videoRef.current) {
      videoRef.current.currentTime = seekTime;
    }
  }, [seekTime]);

  // Find currently active subtitle
  const activeSubtitle = subtitles.find(
    (item) => currentTime >= item.startTime && currentTime <= item.endTime
  );

  return (
    <div className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl group flex items-center justify-center">
      {videoUrl ? (
        <>
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
            className="w-full h-full object-contain"
          />

          {/* Custom Subtitle Overlay */}
          {activeSubtitle && (
            <div className="absolute bottom-12 left-0 right-0 px-6 text-center pointer-events-none z-10 transition-all duration-150">
              <span className="inline-block px-4 py-2 rounded-xl bg-black/75 backdrop-blur-md border border-white/10 text-white font-medium text-lg sm:text-xl shadow-2xl tracking-wide leading-relaxed">
                {activeSubtitle.translatedText}
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="text-center p-6 text-zinc-500">
          <p className="text-base font-medium">No Video Loaded</p>
          <p className="text-xs text-zinc-600 mt-1">Upload a video to preview subtitles in real-time</p>
        </div>
      )}
    </div>
  );
};
