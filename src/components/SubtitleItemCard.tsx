'use client';

import React from 'react';
import { SubtitleItem } from '@/lib/types';
import { Play, Trash2, Clock } from 'lucide-react';

interface SubtitleItemCardProps {
  item: SubtitleItem;
  isActive: boolean;
  onUpdate: (updatedItem: SubtitleItem) => void;
  onDelete: (id: string) => void;
  onJumpTo: (time: number) => void;
}

export const SubtitleItemCard: React.FC<SubtitleItemCardProps> = ({
  item,
  isActive,
  onUpdate,
  onDelete,
  onJumpTo,
}) => {
  return (
    <div
      className={`group relative rounded-xl border p-4 transition-all duration-200 ${
        isActive
          ? 'bg-gradient-to-r from-blue-950/40 via-purple-950/30 to-zinc-900 border-blue-500/60 shadow-lg shadow-blue-500/10'
          : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        {/* Time Inputs & Jump Button */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <button
            onClick={() => onJumpTo(item.startTime)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white transition-colors"
            title="Jump to subtitle start time"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>Play</span>
          </button>

          <div className="flex items-center gap-1 bg-zinc-950/80 px-2 py-1 rounded-md border border-zinc-800 text-zinc-300">
            <Clock className="w-3 h-3 text-zinc-500" />
            <input
              type="number"
              step="0.1"
              min="0"
              value={item.startTime}
              onChange={(e) =>
                onUpdate({ ...item, startTime: parseFloat(e.target.value) || 0 })
              }
              className="w-14 bg-transparent text-center focus:outline-none focus:text-blue-400"
            />
            <span className="text-zinc-600">→</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={item.endTime}
              onChange={(e) =>
                onUpdate({ ...item, endTime: parseFloat(e.target.value) || 0 })
              }
              className="w-14 bg-transparent text-center focus:outline-none focus:text-blue-400"
            />
            <span className="text-zinc-500 text-[10px]">s</span>
          </div>
        </div>

        {/* Delete Button */}
        <button
          onClick={() => onDelete(item.id)}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
          title="Delete subtitle"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Text Editing Inputs */}
      <div className="space-y-2">
        <input
          type="text"
          value={item.translatedText}
          onChange={(e) => onUpdate({ ...item, translatedText: e.target.value })}
          placeholder="Translated Subtitle (Thai)"
          className="w-full bg-zinc-950/60 border border-zinc-800/80 focus:border-blue-500/80 rounded-lg px-3 py-1.5 text-sm text-zinc-100 font-medium placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30 transition-all"
        />

        <input
          type="text"
          value={item.originalText}
          onChange={(e) => onUpdate({ ...item, originalText: e.target.value })}
          placeholder="Original Transcript"
          className="w-full bg-transparent text-xs text-zinc-500 placeholder-zinc-700 focus:outline-none focus:text-zinc-400 transition-colors px-1"
        />
      </div>
    </div>
  );
};
