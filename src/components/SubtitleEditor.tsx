'use client';

import React, { useEffect, useRef, useState } from 'react';
import { SubtitleItem } from '@/lib/types';
import { SubtitleItemCard } from './SubtitleItemCard';
import { Plus, ArrowDownAZ, RefreshCw, Eye, EyeOff, Sparkles, Loader2, FileText, Languages, Search, Replace, X } from 'lucide-react';
import { parseSRT } from '@/lib/srtFormatter';
import { searchSubtitles, findAndReplaceSubtitles } from '@/lib/subtitleUtils';

interface SubtitleEditorProps {
  subtitles: SubtitleItem[];
  currentTime: number;
  onSubtitlesChange: (subtitles: SubtitleItem[]) => void;
  onJumpTo: (time: number) => void;
  targetLanguage?: string;
  notify?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const SubtitleEditor: React.FC<SubtitleEditorProps> = ({
  subtitles,
  currentTime,
  onSubtitlesChange,
  onJumpTo,
  targetLanguage = 'th',
  notify,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeCardRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [selectedStyle, setSelectedStyle] = useState<string>('anime');
  const [isRefining, setIsRefining] = useState<boolean>(false);
  const [isTranslatingSRT, setIsTranslatingSRT] = useState<boolean>(false);

  // Search & Find-Replace States
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showFindReplace, setShowFindReplace] = useState<boolean>(false);
  const [findText, setFindText] = useState<string>('');
  const [replaceText, setReplaceText] = useState<string>('');
  const [matchCase, setMatchCase] = useState<boolean>(false);

  const handleExecuteReplace = () => {
    if (!findText) return;
    const count = subtitles.reduce(
      (n, s) => n + (s.translatedText.split(findText).length - 1),
      0
    );
    const updated = findAndReplaceSubtitles(subtitles, findText, replaceText, 'translatedText', matchCase);
    onSubtitlesChange(updated);
    notify?.(`Replaced ${count || 'all'} occurrence(s) of "${findText}"`, 'info');
    setFindText('');
    setReplaceText('');
  };

  const handleImportSRT = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const parsed = parseSRT(content);
        if (parsed.length === 0) {
          notify?.(`Could not parse subtitles from "${file.name}". Check format.`, 'error');
        } else {
          onSubtitlesChange(parsed);
          notify?.(`Imported ${parsed.length} cues from ${file.name}`, 'success');
        }
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleTranslateSRT = async () => {
    if (subtitles.length === 0) return;
    setIsTranslatingSRT(true);
    try {
      const res = await fetch('/api/translate-srt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtitles, targetLanguage }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to translate SRT subtitles.');
      }
      onSubtitlesChange(data.subtitles || []);
      notify?.(`Translated ${(data.subtitles || []).length} cues`, 'success');
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      notify?.(`SRT translation error: ${errMessage}`, 'error');
    } finally {
      setIsTranslatingSRT(false);
    }
  };

  const handleRefineSubtitles = async () => {
    if (subtitles.length === 0) return;
    setIsRefining(true);
    try {
      const res = await fetch('/api/refine-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtitles, style: selectedStyle }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to refine subtitles.');
      }
      onSubtitlesChange(data.subtitles || []);
      notify?.(`Refined ${(data.subtitles || []).length} cues`, 'success');
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      notify?.(`AI refinement error: ${errMessage}`, 'error');
    } finally {
      setIsRefining(false);
    }
  };

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
        block: 'center',
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
    notify?.(`Added subtitle at ${startTime.toFixed(1)}s`, 'info');
  };

  const handleSortByTime = () => {
    const sorted = [...subtitles].sort((a, b) => a.startTime - b.startTime);
    onSubtitlesChange(sorted);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950/80 border border-zinc-800/80 rounded-2xl overflow-hidden backdrop-blur-xl">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between p-3 sm:px-5 sm:py-4 border-b border-zinc-800/80 bg-zinc-900/40 gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <span>Subtitles List</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-mono">
              {subtitles.length}
            </span>
          </h2>
          <p className="text-xs text-zinc-500">Edit, add, or adjust timings</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* AI Style Refinement Control */}
          {subtitles.length > 0 && (
            <div className="flex items-center gap-1 bg-purple-950/40 border border-purple-500/30 p-1 rounded-xl">
              <select
                value={selectedStyle}
                onChange={(e) => setSelectedStyle(e.target.value)}
                className="bg-transparent text-purple-300 text-xs font-medium focus:outline-none cursor-pointer px-1"
              >
                <option value="anime" className="bg-zinc-900 text-white">🎨 อนิเมะ/มังงะ</option>
                <option value="shorts" className="bg-zinc-900 text-white">⚡ คลิปสั้น TikTok/Shorts (สรุปย่อ)</option>
                <option value="business" className="bg-zinc-900 text-white">💼 ทางการ/ธุรกิจ</option>
                <option value="vlog" className="bg-zinc-900 text-white">📹 Vlog กันเอง</option>
                <option value="academic" className="bg-zinc-900 text-white">🎓 วิชาการ</option>
              </select>
              <button
                disabled={isRefining}
                onClick={handleRefineSubtitles}
                className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium flex items-center gap-1 disabled:opacity-50 transition-colors"
                title="Refine Subtitle Tone & Style with AI"
              >
                {isRefining ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 fill-current text-yellow-300" />
                )}
                <span>Refine</span>
              </button>
            </div>
          )}

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

          {/* Direct SRT Translate Button */}
          {subtitles.length > 0 && (
            <button
              disabled={isTranslatingSRT}
              onClick={handleTranslateSRT}
              className="px-2.5 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/40 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 transition-all"
              title="Translate existing SRT original text directly with Gemini AI"
            >
              {isTranslatingSRT ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
              ) : (
                <Languages className="w-3.5 h-3.5 text-indigo-400" />
              )}
              <span>Translate SRT</span>
            </button>
          )}

          {/* Find & Replace Toggle Button */}
          {subtitles.length > 0 && (
            <button
              onClick={() => setShowFindReplace(!showFindReplace)}
              className={`p-2 rounded-lg border text-xs flex items-center gap-1.5 transition-all ${
                showFindReplace
                  ? 'bg-purple-600/20 border-purple-500/50 text-purple-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
              title="Find & Replace text across subtitles"
            >
              <Replace className="w-3.5 h-3.5 text-purple-400" />
              <span className="hidden sm:inline">Find/Replace</span>
            </button>
          )}

          {/* Import SRT File Button */}
          <label
            className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 transition-all text-xs flex items-center gap-1.5 cursor-pointer"
            title="Import existing .srt or .vtt subtitle file"
          >
            <FileText className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Import .SRT</span>
            <input
              type="file"
              accept=".srt,.vtt,text/plain"
              onChange={handleImportSRT}
              className="hidden"
            />
          </label>

          <button
            onClick={handleAddSubtitle}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center gap-1.5 shadow-lg shadow-blue-600/20 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Subtitle</span>
          </button>
        </div>
      </div>

      {/* Live Search & Find/Replace Panel */}
      {subtitles.length > 0 && (
        <div className="bg-zinc-900/90 border-b border-zinc-800 px-5 py-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search subtitles by keyword..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-8 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {searchQuery && (
              <span className="text-[11px] text-zinc-400 font-mono">
                {searchSubtitles(subtitles, searchQuery).length} / {subtitles.length} matches
              </span>
            )}
          </div>

          {/* Expanded Find & Replace Bar */}
          {showFindReplace && (
            <div className="p-3 rounded-xl bg-zinc-950 border border-purple-500/30 space-y-2 text-xs">
              <div className="flex flex-col sm:flex-row items-center gap-2">
                <input
                  type="text"
                  placeholder="Find text..."
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                />
                <input
                  type="text"
                  placeholder="Replace with..."
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                />
                <button
                  disabled={!findText}
                  onClick={handleExecuteReplace}
                  className="w-full sm:w-auto px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-medium text-xs whitespace-nowrap transition-all shadow-md shadow-purple-600/20"
                >
                  Replace All
                </button>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={matchCase}
                    onChange={(e) => setMatchCase(e.target.checked)}
                    className="rounded border-zinc-800 bg-zinc-900 text-purple-600 focus:ring-0"
                  />
                  <span>Match Case (ตรงตามอักษรพิมพ์เล็ก-ใหญ่)</span>
                </label>
              </div>
            </div>
          )}
        </div>
      )}

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
              Upload a video or import an .SRT file to start editing.
            </p>
          </div>
        ) : (
          searchSubtitles(subtitles, searchQuery).map((item, index) => {
            const isActive = item.id === activeSubtitleId;
            return (
              <div key={`${item.id}-${index}`} ref={isActive ? activeCardRef : null}>
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
