'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { SubtitleItem } from '@/lib/types';
import { SubtitleItemCard } from './SubtitleItemCard';
import { Plus, ArrowDownAZ, RefreshCw, Eye, EyeOff, Sparkles, Loader2, FileText, Languages, Search, Replace, X, AlertTriangle, Zap } from 'lucide-react';
import { parseSRT, sanitizeAndFixOverlaps } from '@/lib/srtFormatter';
import { searchSubtitles, findAndReplaceSubtitles, findActiveSubtitle, splitSubtitleItem, mergeSubtitleItem, findSubtitleGaps, findGapAtTime, type SubtitleGap } from '@/lib/subtitleUtils';
import { extractAudioSegment } from '@/lib/audioExtractor';
import { extractVideoFrames, type ExtractedFrame } from '@/lib/videoFrameExtractor';
import { hasLanguageLeakage } from '@/lib/languageCheck';
import { isAbortError } from '@/lib/translationPipeline';

interface SubtitleEditorProps {
  subtitles: SubtitleItem[];
  currentTime: number;
  onSubtitlesChange: (subtitles: SubtitleItem[]) => void;
  onJumpTo: (time: number) => void;
  targetLanguage?: string;
  notify?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  selectedFile?: File | null;
  videoDuration?: number;
  videoUrl?: string | null;
  includeOnScreenText?: boolean;
}

export const SubtitleEditor: React.FC<SubtitleEditorProps> = ({
  subtitles,
  currentTime,
  onSubtitlesChange,
  onJumpTo,
  targetLanguage = 'th',
  notify,
  selectedFile,
  videoDuration,
  videoUrl,
  includeOnScreenText = false,
}) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const subtitlesRef = useRef(subtitles);
  useEffect(() => { subtitlesRef.current = subtitles; }, [subtitles]);

  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [selectedStyle, setSelectedStyle] = useState<string>('anime');
  const [isRefining, setIsRefining] = useState<boolean>(false);
  const [isTranslatingSRT, setIsTranslatingSRT] = useState<boolean>(false);
  const [isFixingLeakage, setIsFixingLeakage] = useState<boolean>(false);
  const [filterLeakedOnly, setFilterLeakedOnly] = useState<boolean>(false);
  const [isFillingGap, setIsFillingGap] = useState<boolean>(false);
  const [gapStatus, setGapStatus] = useState<string>('');
  const [retranslatingId, setRetranslatingId] = useState<string | null>(null);
  // Gap repair runs requests that can take minutes; leaving the editor must
  // abort them instead of leaving orphaned requests with no receiver.
  const gapAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => gapAbortRef.current?.abort(), []);

  const formatClock = useCallback((secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }, []);

  // Detect gaps > 6 seconds
  const allGaps = useMemo(
    () => findSubtitleGaps(subtitles, 6, videoDuration),
    [subtitles, videoDuration]
  );

  // Active gap at playhead position
  const activeGap = useMemo(
    () => findGapAtTime(subtitles, currentTime, 3, videoDuration),
    [subtitles, currentTime, videoDuration]
  );

  // Search & Find-Replace States
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showFindReplace, setShowFindReplace] = useState<boolean>(false);
  const [findText, setFindText] = useState<string>('');
  const [replaceText, setReplaceText] = useState<string>('');
  const [matchCase, setMatchCase] = useState<boolean>(false);

  const leakedCount = useMemo(
    () => subtitles.filter((s) => s.translatedText.trim().length > 0 && hasLanguageLeakage(s.translatedText, targetLanguage)).length,
    [subtitles, targetLanguage]
  );

  // Compute the filtered list ONCE per render
  const filteredSubtitles = useMemo(() => {
    let list = searchSubtitles(subtitles, searchQuery);
    if (filterLeakedOnly) {
      list = list.filter((s) => s.translatedText.trim().length > 0 && hasLanguageLeakage(s.translatedText, targetLanguage));
    }
    return list;
  }, [subtitles, searchQuery, filterLeakedOnly, targetLanguage]);

  const handleExecuteReplace = useCallback(() => {
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
  }, [findText, replaceText, matchCase, subtitles, onSubtitlesChange, notify]);

  const handleImportSRT = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (e.target instanceof HTMLInputElement) e.target.value = '';

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        try {
          const parsed = parseSRT(content);
          if (parsed.length === 0) {
            notify?.(`Could not parse subtitles from "${file.name}". Check format.`, 'error');
          } else {
            onSubtitlesChange(parsed);
            notify?.(`Imported ${parsed.length} cues from ${file.name}`, 'success');
          }
        } catch {
          // parseTimestampToSeconds throws on malformed timestamp lines
          notify?.(`ไฟล์ "${file.name}" มีบรรทัดเวลาที่อ่านไม่ได้ — ตรวจรูปแบบ SRT/VTT อีกครั้ง`, 'error');
        }
      }
    };
    reader.readAsText(file, 'utf-8');
  }, [onSubtitlesChange, notify]);

  const handleTranslateSRT = useCallback(async () => {
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
      if (data.partial) {
        notify?.(
          `แปลสำเร็จบางส่วน (${(data.subtitles || []).length} cues) — ${data.failedBatches?.length ?? '?'} batch ล้มเหลว กดอีกครั้งเพื่อลองใหม่`,
          'error'
        );
      } else {
        notify?.(`Translated ${(data.subtitles || []).length} cues`, 'success');
      }
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      notify?.(`SRT translation error: ${errMessage}`, 'error');
    } finally {
      setIsTranslatingSRT(false);
    }
  }, [subtitles, targetLanguage, onSubtitlesChange, notify]);

  const handleRefineSubtitles = useCallback(async () => {
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
      if (data.partial) {
        notify?.(
          `ปรับสไตล์สำเร็จบางส่วน (${(data.subtitles || []).length} cues) — ${data.failedBatches?.length ?? '?'} batch ล้มเหลว กดอีกครั้งเพื่อลองใหม่`,
          'error'
        );
      } else {
        notify?.(`Refined ${(data.subtitles || []).length} cues`, 'success');
      }
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      notify?.(`AI refinement error: ${errMessage}`, 'error');
    } finally {
      setIsRefining(false);
    }
  }, [subtitles, selectedStyle, onSubtitlesChange, notify]);

  const handleFixLeakage = useCallback(async () => {
    if (subtitles.length === 0 || leakedCount === 0) return;
    setIsFixingLeakage(true);
    try {
      const res = await fetch('/api/fix-leakage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtitles, targetLanguage }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to fix language leakage.');
      }
      onSubtitlesChange(data.subtitles || []);
      notify?.(
        `แก้ไขและแปลภาษาอื่นที่หลุดสำเร็จ ${data.fixedCount} จุด`,
        'success'
      );
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      notify?.(`แก้ไขภาษาอื่นล้มเหลว: ${errMessage}`, 'error');
    } finally {
      setIsFixingLeakage(false);
    }
  }, [subtitles, targetLanguage, leakedCount, onSubtitlesChange, notify]);

  const handleFillGaps = useCallback(
    async (gapsToFill: SubtitleGap[]) => {
      if (!selectedFile) {
        notify?.('กรุณาเลือกไฟล์วิดีโอก่อนเพื่อตัดเสียงช่วงที่ขาด', 'error');
        return;
      }
      if (isFillingGap || gapsToFill.length === 0) return;

      const controller = new AbortController();
      gapAbortRef.current = controller;
      setIsFillingGap(true);
      const isMulti = gapsToFill.length > 1;
      setGapStatus(
        isMulti
          ? `กำลังเตรียมซ่อมแซมช่วงที่ขาด ${gapsToFill.length} จุดพร้อมกัน (Parallel Workers)...`
          : `กำลังตัดเสียงช่วง ${formatClock(gapsToFill[0].startTime)} - ${formatClock(gapsToFill[0].endTime)}...`
      );

      try {
        const isVideo =
          selectedFile.type.startsWith('video/') ||
          /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(selectedFile.name);

        const concurrency = 3;
        const allRecoveredCues: SubtitleItem[] = [];
        let successGapsCount = 0;

        for (let i = 0; i < gapsToFill.length; i += concurrency) {
          const batch = gapsToFill.slice(i, i + concurrency);
          if (isMulti) {
            setGapStatus(
              `กำลังประมวลผลแปลเก็บตก ${batch.length} จุดพร้อมกัน (${i + 1}-${Math.min(i + batch.length, gapsToFill.length)} จาก ${gapsToFill.length})...`
            );
          }

          const batchSettled = await Promise.allSettled(
            batch.map(async (gap) => {
              const padStart = Math.max(0, gap.startTime - 1.0);
              const padDuration = Math.min(gap.duration + 2.0, 180);
              const padEnd = padStart + padDuration;
              const audioBlob = await extractAudioSegment(selectedFile, padStart, padDuration);

              let framesData: ExtractedFrame[] = [];
              // The OCR toggle is honest everywhere: repairs scan visuals only
              // when the user opted into on-screen text, and the gap-repair
              // buttons describe the behavior accordingly.
              if (videoUrl && includeOnScreenText && isVideo) {
                try {
                  framesData = await extractVideoFrames(videoUrl, padStart, padEnd, {
                    maxFrames: Math.min(24, Math.max(3, Math.ceil(padDuration / 3))),
                    maxWidth: 640,
                    quality: 0.65,
                  });
                } catch (frameErr) {
                  console.warn('[SubtitleEditor] Frame extraction failed, falling back to audio only:', frameErr);
                }
              }

              const formData = new FormData();
              formData.append('file', audioBlob, `gap_${Math.round(padStart)}.wav`);
              formData.append('chunkIndex', '0');
              formData.append('chunkStartTime', String(padStart));
              formData.append('targetLanguage', targetLanguage);
              formData.append('wordTiming', '0');
              formData.append('includeOnScreenText', framesData.length > 0 ? '1' : '0');
              if (framesData.length > 0) {
                formData.append('frames', JSON.stringify(framesData));
              }

              const res = await fetch('/api/video-translate-chunk', {
                method: 'POST',
                body: formData,
                signal: controller.signal,
              });

              const data = await res.json();
              if (!data.success) {
                throw new Error(data.error || 'Failed to translate gap');
              }

              const rawCues = (data.subtitles || []) as SubtitleItem[];
              return rawCues.map((c, idx) => ({
                ...c,
                id: `gap_${Math.round(padStart)}_${idx + 1}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                startTime: Number((c.startTime + padStart).toFixed(3)),
                endTime: Number((c.endTime + padStart).toFixed(3)),
              }));
            })
          );

          for (const res of batchSettled) {
            if (res.status === 'fulfilled' && res.value.length > 0) {
              allRecoveredCues.push(...res.value);
              successGapsCount++;
            }
          }
        }

        // Partial results from an aborted run are still paid-for work: apply
        // them, but skip the toasts (the editor may already be unmounted).
        if (allRecoveredCues.length === 0) {
          if (!controller.signal.aborted) {
            notify?.('Gemini ไม่พบเสียงพูดหรือข้อความเพิ่มเติมในช่วงที่ขาด', 'info');
          }
          return;
        }

        const ocrCount = allRecoveredCues.filter((c) => c.source === 'on_screen_text').length;
        const merged = sanitizeAndFixOverlaps([...subtitlesRef.current, ...allRecoveredCues]);
        onSubtitlesChange(merged);
        if (!controller.signal.aborted) {
          notify?.(
            `ซ่อมแซมช่วงที่ขาด${isMulti ? `ทั้งหมด (${successGapsCount}/${gapsToFill.length} จุด)` : ''} สำเร็จ (+${allRecoveredCues.length} รายการ${
              ocrCount > 0 ? ` รวมข้อความบนจอ ${ocrCount}` : ''
            })`,
            'success'
          );
        }
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        const msg = err instanceof Error ? err.message : String(err);
        notify?.(`เกิดข้อผิดพลาดในการซ่อมช่วงที่ขาด: ${msg}`, 'error');
      } finally {
        setIsFillingGap(false);
        setGapStatus('');
        if (gapAbortRef.current === controller) gapAbortRef.current = null;
      }
    },
    [
      selectedFile,
      videoUrl,
      includeOnScreenText,
      isFillingGap,
      targetLanguage,
      onSubtitlesChange,
      notify,
      formatClock,
    ]
  );

  const handleFillSpecificGap = useCallback(
    (gap: SubtitleGap) => handleFillGaps([gap]),
    [handleFillGaps]
  );

  // Find current active subtitle item (binary search; list is sorted by time)
  const activeSubtitleId = useMemo(
    () => findActiveSubtitle(subtitles, currentTime)?.id,
    [subtitles, currentTime]
  );

  // Auto-scroll ONLY when the active subtitle changes (search typing does not
  // retrigger because the filtered index is read from a ref).
  const filteredRef = useRef(filteredSubtitles);
  useEffect(() => { filteredRef.current = filteredSubtitles; }, [filteredSubtitles]);

  useEffect(() => {
    if (!autoScroll || !activeSubtitleId) return;
    const idx = filteredRef.current.findIndex((item) => item.id === activeSubtitleId);
    if (idx >= 0) {
      virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center', behavior: 'smooth' });
    }
  }, [activeSubtitleId, autoScroll]);

  // Stable handlers (via ref) so memoized cards do not re-render on every
  // parent render during playback.
  const handleUpdate = useCallback((updatedItem: SubtitleItem) => {
    onSubtitlesChange(subtitlesRef.current.map((item) =>
      item.id === updatedItem.id ? updatedItem : item
    ));
  }, [onSubtitlesChange]);

  const handleDelete = useCallback((id: string) => {
    onSubtitlesChange(subtitlesRef.current.filter((item) => item.id !== id));
  }, [onSubtitlesChange]);

  const handleSplit = useCallback((id: string) => {
    onSubtitlesChange(splitSubtitleItem(subtitlesRef.current, id));
    notify?.('Split cue at the midpoint (word-aware)', 'info');
  }, [onSubtitlesChange, notify]);

  const handleMerge = useCallback((id: string) => {
    const current = subtitlesRef.current;
    const idx = current.findIndex((item) => item.id === id);
    if (idx === -1 || idx === current.length - 1) {
      notify?.('ไม่มีซับถัดไปให้รวม', 'info');
      return;
    }
    const mergedList = mergeSubtitleItem(current, id);
    const mergedCue = mergedList[idx];
    onSubtitlesChange(mergedList);
    // Exports run sanitizeAndFixOverlaps, which re-splits cues longer than
    // 6s — warn so the editor view and the exported file do not diverge
    // silently.
    notify?.(
      mergedCue && mergedCue.endTime - mergedCue.startTime > 6.0
        ? 'Merged cue with the next one (รวมแล้วยาวเกิน 6 วินาที ตอน export ระบบจะตัดแบ่งใหม่ให้เอง)'
        : 'Merged cue with the next one',
      'info'
    );
  }, [onSubtitlesChange, notify]);

  // Re-translates ONE cue with its ±2 neighbors as context (so pronouns and
  // naming stay consistent), reusing the existing SRT translation endpoint.
  // Only the focus cue's new text is applied; neighbor results are discarded.
  const handleRetranslateCue = useCallback(async (id: string) => {
    if (retranslatingId) return;
    const current = subtitlesRef.current;
    const idx = current.findIndex((item) => item.id === id);
    if (idx === -1) return;

    setRetranslatingId(id);
    try {
      const context = current
        .slice(Math.max(0, idx - 2), idx + 3)
        .map((c) => ({ ...c, translatedText: '' }));
      const res = await fetch('/api/translate-srt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtitles: context, targetLanguage }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Retranslate failed.');
      }
      const fixed = (data.subtitles || []).find((s: SubtitleItem) => s.id === id);
      if (!fixed || !fixed.translatedText) {
        notify?.('AI ไม่ส่งผลแปลของคิวนี้กลับมา ลองอีกครั้ง', 'error');
        return;
      }
      onSubtitlesChange(
        current.map((item) =>
          item.id === id ? { ...item, translatedText: fixed.translatedText, words: undefined } : item
        )
      );
      notify?.('แปลคิวนี้ใหม่ด้วยบริบทข้างเคียงแล้ว', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      notify?.(`แปลใหม่ไม่สำเร็จ: ${msg}`, 'error');
    } finally {
      setRetranslatingId(null);
    }
  }, [retranslatingId, targetLanguage, onSubtitlesChange, notify]);

  const handleAddSubtitle = useCallback(() => {
    const current = subtitlesRef.current;
    const newId = `sub-${Date.now()}`;
    const lastItem = current[current.length - 1];
    const startTime = lastItem ? lastItem.endTime + 0.1 : 0;
    const endTime = startTime + 2.0;

    const newItem: SubtitleItem = {
      id: newId,
      startTime: Number(startTime.toFixed(2)),
      endTime: Number(endTime.toFixed(2)),
      originalText: 'New subtitle text',
      translatedText: 'ข้อความซับไตเติลใหม่',
    };

    onSubtitlesChange([...current, newItem]);
    notify?.(`Added subtitle at ${startTime.toFixed(1)}s`, 'info');
  }, [onSubtitlesChange, notify]);

  const handleSortByTime = useCallback(() => {
    const sorted = [...subtitlesRef.current].sort((a, b) => a.startTime - b.startTime);
    onSubtitlesChange(sorted);
  }, [onSubtitlesChange]);

  return (
    <div className="flex flex-col h-full bg-zinc-950/80 border border-zinc-800/80 rounded-2xl overflow-hidden backdrop-blur-xl">
      {/* Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 sm:px-5 sm:py-3.5 border-b border-zinc-800/80 bg-zinc-900/40 gap-2.5 sm:gap-3">
        <div className="flex items-center justify-between sm:block">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <span>Subtitles List</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-mono">
              {subtitles.length}
            </span>
          </h2>
          <p className="text-xs text-zinc-500 hidden sm:block">Edit, add, or adjust timings</p>
        </div>

        {/* Action Toolbar: wraps gracefully on mobile/split-screen so NO buttons are hidden or cut off */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Primary Action: Add Subtitle */}
          <button
            onClick={handleAddSubtitle}
            className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition-all cursor-pointer shrink-0"
            title="เพิ่มซับไตเติลใหม่"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Subtitle</span>
          </button>

          {/* Import SRT File Button */}
          <label
            className="px-2 sm:px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 transition-all text-xs flex items-center gap-1.5 cursor-pointer shrink-0"
            title="นำเข้าไฟล์ซับไตเติล .srt หรือ .vtt"
          >
            <FileText className="w-3.5 h-3.5 text-emerald-400" />
            <span>Import .SRT</span>
            <input
              type="file"
              accept=".srt,.vtt,text/plain"
              onChange={handleImportSRT}
              className="hidden"
            />
          </label>

          {/* Auto-Scroll Toggle Button */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            aria-pressed={autoScroll}
            className={`p-1.5 sm:p-2 rounded-lg border text-xs flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
              autoScroll
                ? 'bg-blue-600/10 border-blue-500/40 text-blue-400'
                : 'bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
            title={autoScroll ? 'เปิดการเลื่อนตามเสียงอัตโนมัติ (Auto-scroll)' : 'ปิดการเลื่อนตามเสียง'}
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

          {/* Sort by Timestamp */}
          <button
            onClick={handleSortByTime}
            className="p-1.5 sm:p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-all text-xs flex items-center gap-1.5 shrink-0 cursor-pointer"
            title="เรียงซับไตเติลตามลำดับเวลา"
          >
            <ArrowDownAZ className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sort</span>
          </button>

          {/* Find & Replace Toggle Button */}
          {subtitles.length > 0 && (
            <button
              onClick={() => setShowFindReplace(!showFindReplace)}
              aria-pressed={showFindReplace}
              className={`p-1.5 sm:p-2 rounded-lg border text-xs flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                showFindReplace
                  ? 'bg-purple-600/20 border-purple-500/50 text-purple-300'
                  : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
              title="ค้นหาและแทนที่คำในซับไตเติล (Find & Replace)"
            >
              <Replace className="w-3.5 h-3.5 text-purple-400" />
              <span className="hidden sm:inline">Find/Replace</span>
            </button>
          )}

          {/* AI Style Refinement Control */}
          {subtitles.length > 0 && (
            <div className="flex items-center gap-1 bg-purple-950/40 border border-purple-500/30 p-1 rounded-xl shrink-0">
              <select
                value={selectedStyle}
                onChange={(e) => setSelectedStyle(e.target.value)}
                style={{ colorScheme: 'dark' }}
                className="bg-transparent text-purple-300 text-xs font-medium focus:outline-none cursor-pointer px-1 max-w-[125px] sm:max-w-none"
              >
                <option value="anime" className="bg-zinc-900 text-white">🎨 อนิเมะ/มังงะ</option>
                <option value="shorts" className="bg-zinc-900 text-white">⚡ คลิปสั้น Shorts</option>
                <option value="business" className="bg-zinc-900 text-white">💼 ทางการ/ธุรกิจ</option>
                <option value="vlog" className="bg-zinc-900 text-white">📹 Vlog กันเอง</option>
                <option value="academic" className="bg-zinc-900 text-white">🎓 วิชาการ</option>
              </select>
              <button
                disabled={isRefining}
                onClick={handleRefineSubtitles}
                className="px-2 sm:px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium flex items-center gap-1 disabled:opacity-50 transition-colors cursor-pointer"
                title="ขัดเกลาสำนวนและสไตล์ด้วย AI"
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

          {/* Direct SRT Translate Button */}
          {subtitles.length > 0 && (
            <button
              disabled={isTranslatingSRT}
              onClick={handleTranslateSRT}
              className="px-2.5 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/40 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 transition-all shrink-0 cursor-pointer"
              title="แปลข้อความซับเดิมด้วย Gemini AI"
            >
              {isTranslatingSRT ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
              ) : (
                <Languages className="w-3.5 h-3.5 text-indigo-400" />
              )}
              <span>Translate SRT</span>
            </button>
          )}

          {/* Fix Language Leakage Button */}
          {subtitles.length > 0 && leakedCount > 0 && (
            <button
              disabled={isFixingLeakage}
              onClick={handleFixLeakage}
              className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 hover:bg-amber-500/30 text-amber-300 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 transition-all shrink-0 cursor-pointer"
              title={`ตรวจพบภาษาอื่นหลุด ${leakedCount} จุด คลิกเพื่อให้ AI แปลแก้ไขเป็นภาษาที่ถูกต้อง`}
            >
              {isFixingLeakage ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span>แก้ภาษาหลุด ({leakedCount})</span>
            </button>
          )}

          {/* Fill Gap Button (when gaps > 6s exist) */}
          {subtitles.length > 0 && selectedFile && allGaps.length > 0 && (
            <div className="flex items-center gap-1 shrink-0">
              {activeGap && (
                <button
                  disabled={isFillingGap}
                  onClick={() => {
                    onJumpTo(activeGap.startTime);
                    handleFillSpecificGap(activeGap);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-cyan-600/20 border border-cyan-500/40 hover:bg-cyan-600/30 text-cyan-300 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 transition-all shrink-0 cursor-pointer"
                  title="แปลเติมเฉพาะช่วงนี้"
                >
                  {isFillingGap ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  )}
                  <span>แปลเติมช่วงนี้ ({formatClock(activeGap.duration)})</span>
                </button>
              )}

              <button
                disabled={isFillingGap}
                onClick={() => handleFillGaps(allGaps)}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 transition-all shrink-0 cursor-pointer ${
                  activeGap && allGaps.length > 1
                    ? 'bg-zinc-900 border-cyan-500/40 hover:bg-cyan-950/40 text-cyan-200'
                    : 'bg-cyan-600/25 border-cyan-500/50 hover:bg-cyan-600/40 text-cyan-200'
                }`}
                title={`ซ่อมแซมช่วงที่ขาดทั้งหมด ${allGaps.length} จุดพร้อมกันผ่าน Parallel Workers`}
              >
                {isFillingGap ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                ) : (
                  <Zap className="w-3.5 h-3.5 text-cyan-400 fill-current" />
                )}
                <span>ซ่อมทุกจุดพร้อมกัน ({allGaps.length})</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Active Gap Alert & One-Click Fill Banner */}
      {activeGap && activeGap.duration >= 6 && selectedFile && (
        <div className="mx-3 sm:mx-5 mt-2.5 p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/40 text-cyan-200 text-xs flex flex-wrap items-center justify-between gap-2 shadow-sm animate-in fade-in">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="truncate">
              {isFillingGap && gapStatus ? (
                <span className="text-cyan-300 font-medium animate-pulse">{gapStatus}</span>
              ) : (
                <>
                  ตรวจพบช่วงที่ไม่มีซับ: <strong>{formatClock(activeGap.startTime)} → {formatClock(activeGap.endTime)}</strong> ({formatClock(activeGap.duration)})
                  {allGaps.length > 1 && (
                    <span className="text-cyan-400 font-medium ml-1.5">(มี {allGaps.length} จุดในคลิป)</span>
                  )}
                </>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              disabled={isFillingGap}
              onClick={() => handleFillSpecificGap(activeGap)}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-cyan-500/40 text-cyan-200 font-medium text-xs flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer disabled:opacity-50"
              title={includeOnScreenText
                ? 'ตรวจพบช่วงว่างในคลิป คลิกเพื่อดึงเสียงและสแกนข้อความบนจอภาพ (OCR) มาแปลเติม'
                : 'ตรวจพบช่วงว่างในคลิป คลิกเพื่อดึงเสียงช่วงนี้มาแปลเติม (เปิดสวิตช์ OCR เพื่อสแกนข้อความบนจอด้วย)'}
            >
              {isFillingGap ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>แปลเฉพาะช่วงนี้</span>
            </button>
            {allGaps.length > 1 && (
              <button
                disabled={isFillingGap}
                onClick={() => handleFillGaps(allGaps)}
                className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                title={`แปลและซ่อมแซมทุกช่วงที่ขาด ${allGaps.length} จุดพร้อมกัน`}
              >
                {isFillingGap ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 fill-current" />}
                <span>⚡ ซ่อมทุกจุดพร้อมกัน ({allGaps.length})</span>
              </button>
            )}
          </div>
        </div>
      )}

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
                  aria-label="Clear search"
                  className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {searchQuery && (
              <span className="text-[11px] text-zinc-400 font-mono">
                {filteredSubtitles.length} / {subtitles.length} matches
              </span>
            )}
            {leakedCount > 0 && (
              <button
                onClick={() => setFilterLeakedOnly(!filterLeakedOnly)}
                aria-pressed={filterLeakedOnly}
                className={`px-2.5 py-1.5 rounded-xl border text-xs flex items-center gap-1.5 transition-all shrink-0 ${
                  filterLeakedOnly
                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-200'
                    : 'bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-amber-300 hover:border-amber-500/40'
                }`}
                title="แสดงเฉพาะซับไตเติลที่มีภาษาอื่นหลุดมา"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">เฉพาะภาษาอื่นปน</span>
                <span className="font-mono text-amber-400">({leakedCount})</span>
              </button>
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

      {/* List Container: virtualized so thousands of cues stay smooth */}
      {subtitles.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-zinc-500 space-y-3">
          <RefreshCw className="w-8 h-8 opacity-40 animate-spin-slow" />
          <p className="text-sm">No subtitles generated yet.</p>
          <p className="text-xs text-zinc-600 max-w-xs">
            Upload a video or import an .SRT file to start editing.
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <Virtuoso
            ref={virtuosoRef}
            data={filteredSubtitles}
            className="h-full custom-scrollbar"
            itemContent={(_index, item) => (
              <div className="px-4 pt-3">
                <SubtitleItemCard
                  item={item}
                  isActive={item.id === activeSubtitleId}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onJumpTo={onJumpTo}
                  onSplit={handleSplit}
                  onMerge={handleMerge}
                  onRetranslate={handleRetranslateCue}
                  retranslating={retranslatingId === item.id}
                  targetLanguage={targetLanguage}
                />
              </div>
            )}
          />
        </div>
      )}
    </div>
  );
};
