'use client';

import React, { useEffect, useRef, useState } from 'react';
import { SubtitleItem } from '@/lib/types';
import { SubtitleItemCard } from './SubtitleItemCard';
import { Plus, ArrowDownAZ, RefreshCw, Eye, EyeOff } from 'lucide-react';

interface SubtitleEditorProps {
  subtitles: SubtitleItem[];
  currentTime: number;
  onSubtitlesChange: (subtitles: SubtitleItem[]) => void;
  onJumpTo: (time: number) => void;
}

export const SubtitleEditor: React.FC<SubtitleEditorProps> = ({
  subtitles,
  currentTime,
  onSubtitlesChange,
  onJumpTo,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeCardRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  // Find current active subtitle item
  const activeSubtitle = subtitles.find(
    (item) => currentTime >= item.startTime && currentTime <= item.endTime
  );
  const activeSubtitleId = activeSubtitle?.id;

  // Auto-scroll ONLY when active subtitle item changes and autoScroll is enabled
  useEffect(() => {
    if (autoScroll && activeSubtitleId && activeCardRef.current) {
      activeCardRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeSubtitleId, autoScroll]);

  const handleUpdate = (updatedItem: SubtitleItem) => {
    const updated = subtitles.map((item) =>
      item.id === updatedItem.id ? updatedItem : item
    );
    onSubtitlesChange(updated);
  };

  const handleDelete = (id: string) => {
    const updated = subtitles.filter((item) => item.id !== id);
    onSubtitlesChange(updated);
  };

  const handleAddSubtitle = () => {
    const newId = `sub-${Date.now()}`;
    const lastItem = subtitles[subtitles.length - 1];
    const startTime = lastItem ? lastItem.endTime + 0.1 : 0;
    const endTime = startTime + 2.0;

    const newItem: SubtitleItem = {
      id: newId,
      startTime: Number(startTime.toFixed(2)),
      endTime: Number(endTime.toFixed(2)),
      originalText: 'New subtitle text',
      translatedText: 'ข้อความซับไตเติลใหม่',
    };

    onSubtitlesChange([...subtitles, newItem]);
  };

  const handleSortByTime = () => {
    const sorted = [...subtitles].sort((a, b) => a.startTime - b.startTime);
    onSubtitlesChange(sorted);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950/80 border border-zinc-800/80 rounded-2xl overflow-hidden backdrop-blur-xl">
      {/* Header Controls */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/80 bg-zinc-900/40">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <span>Subtitles List</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-mono">
              {subtitles.length}
            </span>
          </h2>
          <p className="text-xs text-zinc-500">Edit, add, or adjust timings</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-Scroll Toggle Button */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-2 rounded-lg border text-xs flex items-center gap-1.5 transition-all ${
              autoScroll
                ? 'bg-blue-600/10 border-blue-500/40 text-blue-400'
                : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
            title={autoScroll ? 'Auto-scroll enabled' : 'Auto-scroll disabled'}
          >
            {autoScroll ? (
              <>
                <Eye className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Auto-Follow</span>
              </>
            ) : (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Manual</span>
              </>
            )}
          </button>

          <button
            onClick={handleSortByTime}
            className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-all text-xs flex items-center gap-1.5"
            title="Sort by timestamp"
          >
            <ArrowDownAZ className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sort</span>
          </button>

          <button
            onClick={handleAddSubtitle}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center gap-1.5 shadow-lg shadow-blue-600/20 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Subtitle</span>
          </button>
        </div>
      </div>

      {/* List Container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar"
      >
        {subtitles.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-zinc-500 space-y-3">
            <RefreshCw className="w-8 h-8 opacity-40 animate-spin-slow" />
            <p className="text-sm">No subtitles generated yet.</p>
            <p className="text-xs text-zinc-600 max-w-xs">
              Upload a video and start translation to see subtitle cards populated here.
            </p>
          </div>
        ) : (
          subtitles.map((item) => {
            const isActive = item.id === activeSubtitleId;
            return (
              <div key={item.id} ref={isActive ? activeCardRef : null}>
                <SubtitleItemCard
                  item={item}
                  isActive={isActive}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onJumpTo={onJumpTo}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
