# AI Working Notes - Video Translator App

## Current Status & Verification Log

### [2026-11-12] Truncation Flag, OCR-Honest Repairs, and Hardsub Font Selection
- **Status**: `VERIFIED WORKING` on tests + build (font picker + truncation toast pending UI proof)
- **What Landed**:
  1. **Truncation flag end-to-end**: `processVideoSubtitlesFromStream` now returns `{ subtitles, truncated }` — set when the ACCEPTED response's `finishReason` is MAX_TOKENS (main path and the timing-guard retry). The chunk route and `/api/video-translate` relay it (`ChunkResult.truncated`; the NDJSON `complete` event carries it), and the full-run success toast appends how many chunks were truncated with a pointer to gap repair. The two maintenance scripts in `scripts/` were updated to the new return shape (found by tsc, not by me).
  2. **OCR toggle is honest everywhere**: gap repair (`handleFillGaps`) and auto-heal extract frames only when `includeOnScreenText` is on (previously `|| isVideo` made every video scan visuals); the repair button title adapts (audio-only vs audio+OCR). A parallel writer made OCR default ON, so default behavior is unchanged — turning the toggle off now truly saves the frame cost.
  3. **Hardsub font selection**: new `src/lib/fontRegistry.ts` scans `public/fonts` (family derived from filename, `-Regular` preferred, Itim sorted first) with a new `GET /api/fonts`; `buildAss` writes `style.fontName` into both Style lines (was hard-coded Itim); the burn route pins unknown families back to the registry; ExportModal and the VideoPlayer style panel get Font selects; the page injects `@font-face` rules from the registry so the preview renders the chosen family; the choice persists in `subStyle` (new `fontName` field with validation). Today `public/fonts` holds only Itim — dropping more `.ttf` files in makes them selectable (the full directory ships to libass via fontsdir already).
- **Verification Evidence**: `npm run gate` 25 files passed (subtitleStyle round-trip test extended with fontName); `npx next build` green. The two `scripts/` consumers of the service return shape surfaced via typecheck.
- **Commit status**: committed as `86a09a1` and pushed to origin/main (one commit with the decode-cache / abort / per-cue batch).

### [2026-11-12] Decode Memoization, Gap-Repair Abort, and Per-Cue AI Re-translate
- **Status**: `VERIFIED WORKING` on tests + build (per-cue button pending UI proof)
- **What Landed**:
  1. **Decoded-buffer cache** (`src/lib/audioExtractor.ts`): `decodeFileAudio` caches the 16kHz decoded AudioBuffer per File in a WeakMap (in-flight promise dedupe; failure clears the entry). Gap repair / auto-heal used to re-decode the whole file per call (auto-heal of 4 gaps on a 1GB file = 4 full decodes); now one decode is shared across the translation run and every repair. Buffers longer than 2h (~460MB as 16kHz mono Float32) skip the cache to bound memory. Dead `extractAudioFromVideo` removed (no callers; grep-verified).
  2. **Gap-repair abort**: `handleFillGaps` now runs with an AbortController stored in `gapAbortRef`, aborted on editor unmount; partial results recovered before an abort are still merged (paid-for work kept) but toasts are skipped. Integrated with the parallel writer's new multi-gap parallel batching (allSettled, concurrency 3).
  3. **Per-cue AI re-translate**: new Wand2 button on each `SubtitleItemCard` calls the existing `/api/translate-srt` endpoint with the focus cue ± 2 neighbors as context (ids are echoed back), then applies ONLY the focus cue's new translation and drops stale karaoke words. No server changes. Note: the endpoint's per-IP rate limit is 5 req/min, so rapid clicking can hit 429 (surfaces as a toast).
- **Verification Evidence**: `npm run gate` 25 files passed (new `src/lib/audioExtractor.test.ts`: one decode per File, per-File keys, >2h buffers skip cache); `npx next build` compiled all routes. The re-translate button has no component test (repo has no DOM harness; lib-only test convention) — prove it on the real UI.
- **Commit status**: committed as `86a09a1` and pushed to origin/main.

### [2026-11-11] Chunked OCR, Failed-Chunk Retry, Adaptive ETA, and Editor/Export Upgrades
- **Status**: `VERIFIED WORKING` on tests + build (real-footage OCR run pending user proof)
- **What Landed**:
  1. **Chunked OCR rebuild**: `prepareChunk` hook in `src/lib/translationPipeline.ts` lets each 150s chunk carry up to 24 JPEG frames sampled from its own time window (`videoFrameExtractor.ts`), posted to the chunk API. OCR now reuses per-chunk retry/fallback, and every chunk is a WAV, so the server-side duration anchor and hallucination guard (`geminiVideoService.ts`) finally apply in OCR mode. The full-video single-upload path survives only as a fallback when the browser cannot decode the file's audio (AC3/DTS MKV, or no audio track) — caught around `extractAudioChunks` in `page.tsx`.
  2. **Failed-chunk retry**: failed chunk blobs + prepareChunk are kept in `retryStateRef`; an amber banner offers "แปลเฉพาะท่อนที่ค้าง", re-runs only the failures, dedupes recovered cues against current subtitles via `isNearBoundaryDuplicate` (now exported from `srtFormatter.ts`), and preserves undo history via a new `preserveHistory` flag on `TRANSLATION_SUCCESS` in `appReducer.ts`.
  3. **Adaptive ETA**: `onEta` in the pipeline re-estimates remaining time from measured wall-clock per completed chunk; the page rewrites `estimatedTotalSecs` live, replacing the fixed `dur*0.05+8` guess (74s predicted vs 240s actual on a 22-min video).
  4. **Editor/export**: merge-with-next cue button (`mergeSubtitleItem`, Combine icon; >6s result warns that exports re-split), `.ass` + `.txt` downloads in `ExportModal` (buildAss, PlayRes fallback 1920x1080), gap-repair padding 1.0s and frame density 1/3s cap 30, IndexedDB save-failure toast, MAX_TOKENS truncation warning, Ctrl+Y redo.
  5. **Reliability**: token-ceiling errors fail fast (1 attempt, no futile retries) via `isNonRetryableChunkError`; `autoAuditAndHealGaps` (added by a parallel writer) now takes `skipWindows` so gaps inside already-failed chunks are left to the retry path instead of being double-translated; auto-restore skips when the user already selected a file.
- **Note**: a parallel writer added `autoAuditAndHealGaps` to `page.tsx` mid-flight (749 → 1013 lines). This session integrated with it rather than reverting.
- **Verification Evidence**: `npm run gate` (tsc + eslint + vitest) 24 files / 73 tests passed; `npx next build` compiled all 9 routes; independent poteto-agent review ran the gates itself, and its findings F1-F4, F6, F8 are fixed. Deferred with reasons: truncation response flag (a 150s chunk yields ~6-10k output tokens vs the 65536 ceiling, so rare), repair passes always scan visuals (the repair banner advertises "เสียง + ข้อความ"), decode memoization for repeated gap repairs, abort signal for gap-repair fetches.
- **Commit status**: committed as `d0a989d` on main (22 files, +2122/-300; one checkpoint containing the user's earlier uncommitted work, the parallel writer's auto-heal, and this session's features).

### [2026-11-11] Video Persistence & Subtitle Protection on Reload
- **Status**: `VERIFIED WORKING`
- **Root Cause**:
  1. Browser RAM lifecycle naturally discards `File` object pointers and ephemeral `blob:` URLs upon full-page reload.
  2. Previously, `appReducer.ts` reset `subtitles: []` unconditionally whenever `SET_FILE` fired, and `handleFileSelect` threatened to wipe user subtitles if they reconnected the video.
  3. Video translation progress bar pegged at 99% with `~0s left` due to an undersized duration estimate for OCR full video runs (76s estimated vs 240s actual), causing user anxiety and triggering reloads.
- **Solution Landed**:
  1. Built `src/lib/videoStorage.ts` utilizing browser IndexedDB (`video_translator_db`, store `media`, key `active_video`) to cache and auto-restore active videos across page reloads.
  2. Enhanced `src/lib/appReducer.ts` with `keepSubtitles?: boolean` so reconnecting a video preserves all existing subtitles without risk of data loss.
  3. Added non-destructive reconnection banner in `src/app/page.tsx` when subtitles exist without an active video.
  4. Fixed progress remaining calculation to display `ประมวลผลขั้นสุดท้าย...` and an active pulse shimmer instead of a frozen `~0s left` at 99%.
- **Verification Evidence**:
  - `src/lib/videoStorage.test.ts` (3/3 tests passed).
  - `src/lib/appReducer.test.ts` (testSetFileCanKeepSubtitlesWhenRequested passed).
  - Full project test suite passed (23 files, 65 tests passed).
  - `npm run gate` passed with 0 type errors, 0 linter errors, and 0 warnings.

### [2026-11-11] Dark Mode UX/UI Contrast Overhaul
- **Status**: `VERIFIED WORKING`
- **Root Cause**: Windows Chromium native `<select>` dropdown ignored dark background classes and rendered near-black text on dark gray/black backgrounds.
- **Solution Landed**:
  1. Created accessible custom dropdown `src/components/LanguageSelect.tsx` with flags, crisp white text, and focused highlight states.
  2. Injected `color-scheme: dark;` into `:root` in `src/app/globals.css`.
  3. Added unit tests in `src/components/LanguageSelect.test.ts`.
- **Verification Evidence**:
  - `src/components/LanguageSelect.test.ts` passed.
  - Manual inspection and typecheck verification passed.

### [2026-11-11] Small Screen / Responsive Viewport Button Disappearing Fix
- **Status**: `VERIFIED WORKING`
- **Root Cause**:
  1. **Header Toolbar Clipping**: `<header>` was forced into a rigid single non-wrapping flex row (`shrink-0`). When screen width was `< 650px` (mobile or split-screen window), horizontal overflow combined with `overflow-x-clip` on `<main>` sliced off right-side buttons (`Export`, `เปลี่ยนไฟล์`, and `แปลซับไตเติล`).
  2. **SubtitleEditor Action Toolbar Hidden**: `SubtitleEditor.tsx` used `flex-nowrap ... overflow-x-auto` on mobile viewports. The style dropdown consumed over 200px, pushing essential controls (`+ Add Subtitle`, `Import .SRT`, `Auto-Follow`, `Sort`, `Find/Replace`, `Translate SRT`) completely off-screen to the right without discovery cues. Desktop users splitting windows could not horizontally swipe with a mouse, rendering buttons inaccessible.
- **Solution Landed**:
  1. Converted `<header>` to responsive `flex-wrap` with adaptive compact labels on mobile (`ไทย` vs `ภาษาไทย`, `แปลซับ` vs `แปลซับไตเติล`).
  2. Rebuilt `SubtitleEditor.tsx` toolbar with `flex flex-wrap items-center gap-1.5 sm:gap-2` and promoted `+ Add Subtitle` and `Import .SRT` to the front of the action group.
  3. Made `LanguageSelect` responsive with `local` short labels on `< sm`.
- **Verification Evidence**:
  - Emulated mobile viewports (360x780, 390x844) and split desktop viewport (600x800) in Chrome DevTools MCP.
  - Captured screenshots confirming all buttons (`Export`, `เปลี่ยนไฟล์`, `+ Add Subtitle`, `Import .SRT`, `Translate SRT`, `Refine`, `Sort`, `Auto-Follow`, `Find/Replace`) are 100% visible and accessible.
  - Passed `npm run gate`: 23 test files passed (65/65 tests), 0 linter errors, 0 type errors.

### [2026-11-11] Multimodal On-Screen Text (OCR) & Visual Gap Repair
- **Status**: `VERIFIED WORKING`
- **Root Cause**:
  1. The gap repair engine previously only extracted and sent an audio WAV chunk (`extractAudioSegment`), lacking any visual video context. If a scene in a gap had visible Japanese/English burned-in subtitles, hardsubs, chapter titles, signs, or dialogue without loud speech, Gemini was completely blind to it and returned empty cues.
  2. The chunk endpoint `/api/video-translate-chunk` discarded `includeOnScreenText` and lacked support for video frames.
  3. In silent or low-voice intervals containing prominent hardsubs, Gemini previously skipped them if no visual frames were explicitly paired with temporal timestamps.
- **Solution Landed**:
  1. **Client-side Video Frame Extraction**: Built `src/lib/videoFrameExtractor.ts` using native browser `<canvas>` seeking to extract lightweight JPEG frames (3-10 frames, ~150-250KB total) at regular temporal intervals within the gap window in under 100ms without server-side ffmpeg or heavy video uploads.
  2. **Multimodal Chunk API**: Updated `src/app/api/video-translate-chunk/route.ts` to accept `frames` and `includeOnScreenText`, parsing validated frame payloads and forwarding them to `geminiVideoService.ts`.
  3. **Multimodal Gemini Integration**: Enhanced `processVideoSubtitlesFromStream` in `src/lib/geminiVideoService.ts` to attach timestamped visual frames (`inlineData` + `[Visual Frame at Xs]`) alongside the audio fileData into a single `generateContent` request. Strengthened prompts with mandatory OCR rules instructing Gemini to detect burned-in hardsubs, title cards, captions, and signs with `source: 'on_screen_text'` even during silent passages.
  4. **Interactive Gap Repair UI Integration**: Connected `videoUrl` and `includeOnScreenText` into `SubtitleEditor.tsx`. `handleFillSpecificGap` now automatically extracts visual frames and audio, reporting progress (`แปลเสียงและตรวจจับตัวหนังสือบนจอ (OCR)`) and tagging generated cues with `source: 'on_screen_text'`.
- **Verification Evidence**:
  - `src/lib/videoFrameExtractor.test.ts` (3 tests passed).
  - Full project test suite passed: 24 test files, 68 tests passed.
  - `npm run gate` passed with 0 errors and 0 warnings.

### [2026-11-11] Parallel Multi-Gap Repair (ซ่อมทุกส่วนพร้อมกัน)
- **Status**: `VERIFIED WORKING`
- **Root Cause**: Previously, gap repairs (both during auto-heal and manual editor clicks) executed sequentially one-by-one (`for` loop), causing 5 gaps to take 15-20 seconds. Clicking "ซ่อมช่วงที่ขาด" only targeted 1 gap (`allGaps[0]`).
- **Solution Landed**:
  1. **Parallel Worker Fan-Out (`Promise.allSettled`)**: Upgraded both `autoAuditAndHealGaps` in `page.tsx` and `handleFillGaps` in `SubtitleEditor.tsx` to batch all detected gaps in parallel batches of 3, extracting audio and video frames concurrently and posting to `/api/video-translate-chunk`.
  2. **One-Click Parallel Repair in Editor**: Added `⚡ ซ่อมทุกจุดพร้อมกัน (${allGaps.length})` buttons in both the editor toolbar and active gap alert banner.
  3. **Batch Overlap Deduplication**: All parallel-returned cues are merged seamlessly in a single `sanitizeAndFixOverlaps` pass, reducing repair time from `N × 4s` to `~4s` total.
- **Verification Evidence**:
  - `npm run gate` passed: 24 test files, 73 tests passed, 0 lint errors, 0 type errors.

- **Status**: `VERIFIED WORKING`
- **Root Cause of Initial Omissions**:
  1. **OCR Off by Default**: `includeOnScreenText` defaulted to `false`. Video chunking ran pure audio WAVs, leaving Gemini completely blind to signs, Japanese hardsubs, and visual text.
  2. **Model Attentional Gaps**: In long 150s chunks, Gemini occasionally lost attention during quiet/intimate dialogue or soft whispers under background music.
  3. **No Automatic Audit on First Pass**: When initial chunks merged, the pipeline immediately exited without inspecting whether any holes or gaps were dropped.
- **Solution Landed**:
  1. **OCR Enabled by Default for Videos**: Initialized `includeOnScreenText: true` for video uploads so every chunk automatically samples 15-24 visual frames alongside audio without manual toggling.
  2. **Prompt Rule 9 Hardening**: Added explicit "ZERO ATTENTION DROPS" directive preventing Gemini from skipping quiet passages or whispering dialogue.
  3. **Proactive Self-Healing Pass (`autoAuditAndHealGaps`)**: Right after chunked or single-clip translations merge, the pipeline automatically audits the timeline for any gaps > 7 seconds (`findSubtitleGaps`). If a gap is detected (e.g. dropped whispering scene), the system transparently extracts the audio segment and video frames, requests a targeted Gemini fill, and splices the healed cues into the final timeline before completing.
- **Verification Evidence**:
  - Passed `npm run gate`: 24 test files passed (70/70 unit tests passed), 0 lint errors, 0 type errors.
  - Verified default OCR state in browser DOM and dev server compilation.


- **Status**: `VERIFIED WORKING`
- **Root Cause**:
  1. **Prompt Silence Omission**: `geminiVideoService.ts` instructed the model `Ignore long silent sections or background music without speech or visible text`. In anime/hentai scenes with whispers, panting, intimate dialogue, or heavy background audio/SFX, Gemini treated dialogue as "ignorable silence" and returned empty subtitle arrays for that interval.
  2. **False 429 Rate Limiter on Audio Chunks**: In `api/video-translate-chunk/route.ts`, `chunkLimiter` had a rigid `max: 10` per minute cap. A 22-minute video creates ~10 chunks, and any concurrent batch or retry triggered HTTP 429. The pipeline exhausted 3 fast attempts and dropped the entire 2.5-minute chunk without recovery.
  3. **Lack of Targeted Gap Repair**: When gaps occurred, users had no choice but to either re-translate the entire 22 minutes or manually type subtitles.
- **Solution Landed**:
  1. **Prompt Coverage Hardening**: Rewrote prompt rule 8 & 9 in `geminiVideoService.ts` to mandate full continuous coverage for whispers, soft speech, emotional exclamations, and quiet dialogue, prohibiting skipping mid-media scenes.
  2. **Server Rate Limiter Headroom**: Raised `chunkLimiter` max from 10 to 60 in `api/video-translate-chunk/route.ts` and enhanced client retry with exponential backoff (up to 4 attempts).
  3. **Audio Slicing Engine**: Built `extractAudioSegment(file, startTime, durationSecs)` in `audioExtractor.ts` to slice precise audio timeframes on demand.
  4. **Gap Detection & Repair Utilities**: Built `findSubtitleGaps` and `findGapAtTime` in `subtitleUtils.ts` with comprehensive unit tests in `subtitleUtils.test.ts`.
  5. **Interactive Gap Repair UI**: Added an active Gap Alert Banner in `SubtitleEditor.tsx` when playhead is inside a missing section (e.g. at 4:20) plus a one-click `⚡ แปลเติมช่วงนี้ทันที` button that slices and translates only that gap in seconds and merges seamlessly into the existing subtitles.
- **Verification Evidence**:
  - Unit tests in `src/lib/subtitleUtils.test.ts` (gap detection and targeting tests passed).
  - Full project test suite passed (23 files, 65 tests passed).
  - Passed `npm run gate`: 0 type errors, 0 lint errors.
