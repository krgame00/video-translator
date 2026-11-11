'use client';

import React from 'react';
import { SubtitleItem } from '@/lib/types';
import { Play, Trash2, Clock, Scissors, Combine, Wand2, Loader2, AlertTriangle } from 'lucide-react';
import { hasLanguageLeakage, getLanguageLeakageReason } from '@/lib/languageCheck';

interface SubtitleItemCardProps {
  item: SubtitleItem;
  isActive: boolean;
  onUpdate: (updatedItem: SubtitleItem) => void;
  onDelete: (id: string) => void;
  onJumpTo: (time: number) => void;
  onSplit?: (id: string) => void;
  onMerge?: (id: string) => void;
  onRetranslate?: (id: string) => void;
  retranslating?: boolean;
  targetLanguage?: string;
}

/**
 * Memoized so the virtualized list only re-renders the cards whose item or
 * active flag actually changed (the parent re-renders ~4x/s during playback).
 */
export const SubtitleItemCard: React.FC<SubtitleItemCardProps> = React.memo(function SubtitleItemCard({
  item,
  isActive,
  onUpdate,
  onDelete,
  onJumpTo,
  onSplit,
  onMerge,
  onRetranslate,
  retranslating,
  targetLanguage = 'th',
}) {
  const leakageReason = React.useMemo(() => {
    return item.translatedText.trim().length > 0 && hasLanguageLeakage(item.translatedText, targetLanguage)
      ? getLanguageLeakageReason(item.translatedText, targetLanguage)
      : null;
  }, [item.translatedText, targetLanguage]);

  return (
    <div
      className={`group relative rounded-xl border p-4 transition-all duration-200 ${
        isActive
          ? 'bg-blue-600/10 border-blue-500/60'
          : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        {/* Time Inputs & Jump Button */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <button
            onClick={() => onJumpTo(item.startTime)}
            className="flex items-center gap-1 px-3 py-2 rounded-md bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white transition-colors"
            title="Jump to subtitle start time"
            aria-label={`Jump to ${item.startTime}s`}
          >
            <Play className="w-3 h-3 fill-current" />
            <span>Play</span>
          </button>

          <div className="flex items-center gap-1 bg-zinc-950/80 px-2 py-1.5 rounded-md border border-zinc-800 text-zinc-300">
            <Clock className="w-3 h-3 text-zinc-500 shrink-0" />
            <input
              type="number"
              step="0.1"
              min="0"
              inputMode="decimal"
              value={item.startTime}
              aria-label="Start time (seconds)"
              onChange={(e) =>
                onUpdate({ ...item, startTime: parseFloat(e.target.value) || 0 })
              }
              className="w-16 sm:w-14 bg-transparent text-center text-base sm:text-xs focus:outline-none focus:text-blue-400"
            />
            <span className="text-zinc-600">→</span>
            <input
              type="number"
              step="0.1"
              min="0"
              inputMode="decimal"
              value={item.endTime}
              aria-label="End time (seconds)"
              onChange={(e) =>
                onUpdate({ ...item, endTime: parseFloat(e.target.value) || 0 })
              }
              className="w-16 sm:w-14 bg-transparent text-center text-base sm:text-xs focus:outline-none focus:text-blue-400"
            />
            <span className="text-zinc-500 text-[10px]">s</span>
          </div>

          {item.source === 'on_screen_text' && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
              title="ข้อความที่ตรวจพบบนจอภาพ (On-screen text / OCR)"
            >
              OCR
            </span>
          )}

          {leakageReason && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1"
              title={leakageReason}
            >
              <AlertTriangle className="w-2.5 h-2.5" />
              <span>มีภาษาอื่นปน</span>
            </span>
          )}
        </div>

        {/* Split + Delete Buttons (Always visible on touch, hover on desktop) */}
        <div className="flex items-center gap-1 shrink-0">
          {onSplit && item.endTime - item.startTime >= 1.0 && (
            <button
              onClick={() => onSplit(item.id)}
              className="p-2.5 rounded-lg text-zinc-400 sm:text-zinc-500 hover:text-blue-400 hover:bg-blue-500/10 transition-all"
              title="แบ่งซับเป็นสองท่อน (ตัดที่ขอบคำ)"
              aria-label="Split subtitle into two cues"
            >
              <Scissors className="w-4 h-4" />
            </button>
          )}
          {onMerge && (
            <button
              onClick={() => onMerge(item.id)}
              className="p-2.5 rounded-lg text-zinc-400 sm:text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
              title="รวมกับซับถัดไปเป็นท่อนเดียว"
              aria-label="Merge subtitle with the next cue"
            >
              <Combine className="w-4 h-4" />
            </button>
          )}
          {onRetranslate && (
            <button
              onClick={() => onRetranslate(item.id)}
              disabled={retranslating}
              className="p-2.5 rounded-lg text-zinc-400 sm:text-zinc-500 hover:text-indigo-400 hover:bg-indigo-500/10 transition-all disabled:opacity-40 disabled:cursor-wait"
              title="ให้ AI แปลคิวนี้ใหม่ด้วยบริบทข้างเคียง"
              aria-label="Re-translate this cue with AI"
            >
              {retranslating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={() => onDelete(item.id)}
            className="p-2.5 rounded-lg text-zinc-400 sm:text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
            title="Delete subtitle"
            aria-label="Delete subtitle"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Text Editing Inputs — 16px on touch so iOS does not auto-zoom */}
      <div className="space-y-2">
        <input
          type="text"
          value={item.translatedText}
          onChange={(e) => onUpdate({ ...item, translatedText: e.target.value, words: undefined })}
          placeholder="Translated Subtitle (Thai)"
          aria-label="Translated subtitle text"
          className="w-full bg-zinc-950/60 border border-zinc-800/80 focus:border-blue-500/80 rounded-lg px-3 py-2 text-base sm:text-sm text-zinc-100 font-medium placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30 transition-all"
        />

        <input
          type="text"
          value={item.originalText}
          onChange={(e) => onUpdate({ ...item, originalText: e.target.value })}
          placeholder="Original Transcript"
          aria-label="Original transcript text"
          className="w-full bg-transparent text-base sm:text-xs text-zinc-500 placeholder-zinc-700 focus:outline-none focus:text-zinc-400 transition-colors px-1 py-0.5"
        />
      </div>
    </div>
  );
});
