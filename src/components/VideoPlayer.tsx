'use client';

import React, { useRef, useEffect, useState } from 'react';
import { SubtitleItem } from '@/lib/types';
import { Settings, Type, Palette } from 'lucide-react';

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
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // Styling Customizer States
  const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg' | 'xl'>('lg');
  const [textColor, setTextColor] = useState<string>('#FFFFFF');
  const [position, setPosition] = useState<'bottom' | 'top'>('bottom');
  const [bgStyle, setBgStyle] = useState<'glass' | 'dark' | 'none'>('glass');

  // Synchronize seek requests from parent/SubtitleEditor
  useEffect(() => {
    if (seekTime !== null && videoRef.current) {
      videoRef.current.currentTime = seekTime;
    }
  }, [seekTime]);

  // Keyboard shortcuts (Space = play/pause, Left = -5s, Right = +5s)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (!videoRef.current) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (videoRef.current.paused) {
          videoRef.current.play();
        } else {
          videoRef.current.pause();
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 5);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Find currently active subtitle
  const activeSubtitle = subtitles.find(
    (item) => currentTime >= item.startTime && currentTime <= item.endTime
  );

  // Dynamic CSS classes for subtitle overlay based on settings
  const fontClasses = {
    sm: 'text-base sm:text-lg',
    md: 'text-lg sm:text-xl',
    lg: 'text-xl sm:text-2xl',
    xl: 'text-2xl sm:text-3xl font-bold',
  }[fontSize];

  const posClass = position === 'top' ? 'top-12' : 'bottom-12';

  const bgClasses = {
    glass: 'bg-black/75 backdrop-blur-md border border-white/10 shadow-2xl',
    dark: 'bg-black border border-black shadow-2xl',
    none: 'drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]',
  }[bgStyle];

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

          {/* Subtitle Overlay Style Settings Trigger */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="absolute top-4 right-4 z-20 p-2 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-zinc-300 hover:text-white transition-opacity opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
            title="Subtitle Display Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Style Customizer Panel */}
          {showSettings && (
            <div className="absolute top-14 right-4 z-30 p-3 rounded-xl bg-zinc-900/95 border border-zinc-800 backdrop-blur-xl text-xs space-y-2.5 shadow-2xl w-56 text-zinc-200">
              <div className="flex items-center justify-between text-zinc-400 font-medium">
                <span className="flex items-center gap-1">
                  <Type className="w-3.5 h-3.5 text-blue-400" />
                  <span>Subtitle Style</span>
                </span>
                <button onClick={() => setShowSettings(false)} className="text-zinc-500 hover:text-white">✕</button>
              </div>

              {/* Font Size Selector */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-400">Size:</span>
                <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
                  {(['sm', 'md', 'lg', 'xl'] as const).map((sz) => (
                    <button
                      key={sz}
                      onClick={() => setFontSize(sz)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all ${
                        fontSize === sz ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Selector */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-400">Color:</span>
                <div className="flex items-center gap-1.5">
                  {['#FFFFFF', '#FACC15', '#38BDF8', '#4ADE80'].map((col) => (
                    <button
                      key={col}
                      onClick={() => setTextColor(col)}
                      style={{ backgroundColor: col }}
                      className={`w-4 h-4 rounded-full border border-white/20 transition-transform ${
                        textColor === col ? 'scale-125 ring-2 ring-blue-500' : 'hover:scale-110'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Position Selector */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-400">Position:</span>
                <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
                  {(['bottom', 'top'] as const).map((pos) => (
                    <button
                      key={pos}
                      onClick={() => setPosition(pos)}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium capitalize transition-all ${
                        position === pos ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Custom Subtitle Overlay */}
          {activeSubtitle && (
            <div className={`absolute ${posClass} left-0 right-0 px-6 text-center pointer-events-none z-10 transition-all duration-150`}>
              <span
                style={{ color: textColor }}
                className={`inline-block px-4 py-2 rounded-xl ${bgClasses} ${fontClasses} tracking-wide leading-relaxed font-itim`}
              >
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
