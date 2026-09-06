'use client';

import React, { useRef, useEffect, useState } from 'react';
import { SubtitleItem } from '@/lib/types';
import { findActiveSubtitle } from '@/lib/subtitleUtils';
import {
  SubtitleStyleSettings,
  COLOR_OPTIONS,
  FONT_SIZE_OPTIONS,
} from '@/lib/subtitleStyle';
import { ASS_BASE_PLAY_RES_Y } from '@/lib/assBuilder';
import { Settings, Type } from 'lucide-react';

interface VideoPlayerProps {
  videoUrl: string | null;
  subtitles: SubtitleItem[];
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  seekTime: number | null;
  style: SubtitleStyleSettings;
  onStyleChange: (s: SubtitleStyleSettings) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoUrl,
  subtitles,
  currentTime,
  onTimeUpdate,
  seekTime,
  style,
  onStyleChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  // Player frame height in CSS px — used to scale the font exactly like
  // libass scales it against the video's real height.
  const [frameH, setFrameH] = useState<number>(360);
  // Intrinsic aspect (w/h) of the loaded media — portrait videos get a tall
  // frame instead of being letterboxed into a 16:9 sliver.
  const [videoAspect, setVideoAspect] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect && entry.contentRect.height > 0) {
          setFrameH(Math.round(entry.contentRect.height));
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Synchronize seek requests from parent/SubtitleEditor
  useEffect(() => {
    if (seekTime !== null && videoRef.current) {
      videoRef.current.currentTime = seekTime;
    }
  }, [seekTime]);

  // Reset media-derived state when the media changes (adjust-state-during-
  // render pattern — lint-clean versus a syncing effect)
  const [prevUrl, setPrevUrl] = useState<string | null>(videoUrl);
  if (prevUrl !== videoUrl) {
    setPrevUrl(videoUrl);
    setVideoAspect(null);
  }

  // Keyboard shortcuts (Space = play/pause, Left = -5s, Right = +5s).
  // This component is the SINGLE owner of these keys — the page-level handler
  // intentionally does not bind them, so seeks can never double-fire.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'BUTTON' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'SUMMARY' ||
          target.tagName === 'A' ||
          target.isContentEditable)
      ) {
        // Never hijack keys while a form control or actionable element has
        // focus — Space must activate buttons, not toggle playback.
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

  // Find currently active subtitle (binary search; list is sorted by time)
  const activeSubtitle = findActiveSubtitle(subtitles, currentTime);

  // Font size mirrors the hardsub burn: libass sizes `Fontsize` against
  // PlayResY=288 and scales up to the frame, so the preview uses the same
  // 288 base (NOT the video's real height — that made portrait text tiny).
  const scaledFontSize = Math.max(12, Math.round((style.fontSize * frameH) / ASS_BASE_PLAY_RES_Y));

  // Position: real px from the frame edge (marginV), middle = centered
  const overlayPositionStyle: React.CSSProperties =
    style.position === 'top'
      ? { top: style.marginV }
      : style.position === 'middle'
        ? { top: '50%', transform: 'translateY(-50%)' }
        : { bottom: style.marginV };

  // Box (borderStyle 4) vs outline (1) — matching the ASS BackColour/Outline
  const bgStyle: React.CSSProperties =
    style.borderStyle === 4
      ? { backgroundColor: 'rgba(0,0,0,0.5)' }
      : { textShadow: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000' };

  // Karaoke highlight: index of the word currently being "sung"
  const activeWordIdx = (() => {
    if (!activeSubtitle?.words) return -1;
    const words = activeSubtitle.words;
    for (let i = 0; i < words.length; i++) {
      if (currentTime < words[i].end) return i;
    }
    return words.length; // all sung
  })();

  const textColor = `#${style.primaryColor}`;

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video max-h-[70svh] bg-black rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl group flex items-center justify-center"
      style={videoAspect ? { aspectRatio: String(videoAspect) } : undefined}
    >
      {videoUrl ? (
        <>
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            onLoadedMetadata={(e) => {
              const w = e.currentTarget.videoWidth;
              const h = e.currentTarget.videoHeight;
              if (w && h) setVideoAspect(w / h);
            }}
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

          {/* Style Customizer Panel — writes to the SHARED style state */}
          {showSettings && (
            <div className="absolute top-14 right-4 z-30 p-3 rounded-xl bg-zinc-900/95 border border-zinc-800 backdrop-blur-xl text-xs space-y-2.5 shadow-2xl w-60 max-h-[80%] overflow-y-auto custom-scrollbar text-zinc-200">
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
                  {FONT_SIZE_OPTIONS.map((sz) => (
                    <button
                      key={sz}
                      onClick={() => onStyleChange({ ...style, fontSize: sz })}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                        style.fontSize === sz ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Selector (shared with hardsub export) */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-400">Color:</span>
                <div className="flex items-center gap-1.5">
                  {COLOR_OPTIONS.map((col) => (
                    <button
                      key={col}
                      onClick={() => onStyleChange({ ...style, primaryColor: col })}
                      style={{ backgroundColor: `#${col}` }}
                      aria-label={`Text color ${col}`}
                      className={`w-4 h-4 rounded-full border border-white/20 transition-transform ${
                        style.primaryColor === col ? 'scale-125 ring-2 ring-blue-500' : 'hover:scale-110'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Position Selector (top / middle / bottom) */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-400">Position:</span>
                <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
                  {(['top', 'middle', 'bottom'] as const).map((pos) => (
                    <button
                      key={pos}
                      onClick={() => onStyleChange({ ...style, position: pos })}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium capitalize transition-all ${
                        style.position === pos ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>

              {/* Vertical Margin (drives both preview and burn) */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-zinc-400 shrink-0">Margin:</span>
                <input
                  type="range"
                  min={10}
                  max={120}
                  step={2}
                  value={style.marginV}
                  onChange={(e) => onStyleChange({ ...style, marginV: Number(e.target.value) })}
                  className="flex-1 accent-blue-600"
                />
                <span className="text-[10px] font-mono text-zinc-400 w-7 text-right">{style.marginV}</span>
              </div>

              {/* Background: outline vs black box */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-400">Background:</span>
                <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
                  {([1, 4] as const).map((bs) => (
                    <button
                      key={bs}
                      onClick={() => onStyleChange({ ...style, borderStyle: bs })}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                        style.borderStyle === bs ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {bs === 1 ? 'Outline' : 'Black Box'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Custom Subtitle Overlay (controlled by shared style) */}
          {activeSubtitle && (
            <div
              className="absolute left-0 right-0 px-6 text-center pointer-events-none z-10 transition-all duration-150"
              style={overlayPositionStyle}
            >
              <span
                style={{ fontSize: `${scaledFontSize}px`, ...bgStyle }}
                className="inline-block px-4 py-2 rounded-xl tracking-wide leading-relaxed font-itim"
              >
                {activeSubtitle.words && activeWordIdx >= 0 ? (
                  activeSubtitle.words.map((w, i) => (
                    <span
                      key={`${w.start}-${i}`}
                      style={{ color: i <= activeWordIdx ? textColor : '#FFFFFF' }}
                    >
                      {w.text}
                    </span>
                  ))
                ) : (
                  <span style={{ color: textColor }}>{activeSubtitle.translatedText}</span>
                )}
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
