# AI Working Notes - Video Translator App

## Current Status & Verification Log

### [2026-11-15] HARDSUB EXPORT BITRATE & FILE SIZE OPTIMIZATION (CQ 30 VBR) — VERIFIED WORKING
- **Status**: `VERIFIED WORKING` — Tested with real 1080x1920 video and Thai hardsub text. Quality gate clean: tsc ✅ (0 errors), eslint ✅ (0 errors), vitest ✅ 79/79 passed (25 files).
- **Context & Problem**:
  - After solving the anamorphic squish issue, the exported video file size increased to ~299MB (15-min video) because the canvas was expanded to true 1080x1920 square pixels and NVENC was using fixed CQ 26 without true VBR bitrate release.
  - User requested: "แล้วทำไมไฟล์มันใหญ่ขึ้นด้วยละ" & "ปรับหน่อยครับ" to reduce output file size.
- **Empirical Test Results on User Sample (`anamorphic_sample.mp4`)**:
  - `CQ 26 (baseline)`: 1,756,588 bytes (~299MB per 15 min)
  - `CQ 28`: 1,385,344 bytes (21% reduction, ~235MB per 15 min)
  - `CQ 30 (-rc vbr -cq 30 -b:v 0)`: 1,122,718 bytes (36% reduction, ~190MB per 15 min)
  - Visual frame inspection (`frame_cq30.jpg`): Thai subtitles and video textures remain completely sharp, clean, and artifact-free.
- **Implementation**:
  - In `src/app/api/export-hardsub/route.ts`:
    - Updated NVENC config to: `-c:v h264_nvenc -preset p4 -rc vbr -cq 30 -b:v 0 -profile:v main -level 4.1 -pix_fmt yuv420p -movflags +faststart`.
    - Updated CPU fallback (`libx264`) to `-crf 28`.
    - Updated Intel QSV to `-global_quality 28` and AMD AMF to `-qp_i 28 -qp_p 28`.
- **Verification Evidence**:
  - `npx tsc --noEmit`: Exit 0.
  - `npm run lint`: Exit 0.
  - `npm test`: 25 test files passed, 79/79 unit tests green.
  - Extracted frame artifact: `frame_cq30.jpg` visually verifies pristine Thai font readability.
- **Commit status**: not committed (user owns commit timing).

### [2026-11-15] ANAMORPHIC VIDEO (NON-SQUARE PIXELS SAR 9:16) SUBTITLE SQUISH FIX — VERIFIED WORKING
- **Status**: `VERIFIED WORKING` — Tested with real anamorphic user video (`1080x1080` container with `SAR 9:16`). Quality gate clean: tsc ✅ (0 errors), eslint ✅ (0 errors), vitest ✅ 79/79 passed (25 files).
- **Root Cause Analysis (Smoking Gun)**:
  - User's video has anamorphic non-square pixels: `width: 1080, height: 1080, sample_aspect_ratio: 9:16, display_aspect_ratio: 9:16`.
  - When played, players display it as a 9:16 portrait video by stretching height (or squeezing width).
  - Even with `PlayResX: 1080, PlayResY: 1920`, if the underlying video container remains 1080×1080 with non-square pixels, libass renders onto the raw 1080×1080 frame buffer where font width is 1:1, and then player SAR playback squeezes the text horizontally to 56% width (บีบ).
- **Fix**:
  - In `src/app/api/export-hardsub/route.ts`:
    1. `probeVideoDimensions()` detects `isAnamorphic` and normalizes display dimensions (1080×1920).
    2. When `isAnamorphic` is detected, the video filtergraph injects `scale=${job.playResX}:${job.playResY},setsar=1` BEFORE the `ass` filter (`scale=1080:1920,setsar=1,ass='sub.ass'`).
    3. Normalizes the video to true square pixels (1080×1920, SAR 1:1) so libass burns directly onto the true canvas.
    4. The output file is a standard 1080×1920 square-pixel MP4 playable on all players with zero distortion.
- **Verification Evidence**:
  - Live FFmpeg burn with `scale=1080:1920,setsar=1,ass='...'` on user's exact cue extracted to `frame_user_cue_fixed.jpg`: verified Thai text "งั้น มาช่วยตัวเองลับๆแบบ ไม่ให้ใครจับได้กันดีกว่า" is 100% round, natural, and completely free of any horizontal squish.
  - `npx tsc --noEmit`: Exit 0.
  - `npm test`: 25 test files passed, 79/79 unit tests passed.
- **Commit status**: not committed (user owns commit timing).

### [2026-11-15] HARDWARE ACCELERATION (NVIDIA GPU NVENC) ENABLED — VERIFIED WORKING
- **Status**: `VERIFIED WORKING` — Tested with NVIDIA GeForce RTX 5050 (Driver 32.0.16.2101) + FFmpeg NVENC (`h264_nvenc`). Quality gate clean: tsc ✅ (0 errors), eslint ✅ (0 errors), vitest ✅ 79/79 passed (25 files).
- **Hardware Verified**:
  - GPU: NVIDIA GeForce RTX 5050 detected via `Get-CimInstance Win32_VideoController`.
  - Encoder: `h264_nvenc` verified functional via live FFmpeg test encode on `vertical.mp4` with ASS subtitle filter (`speed=3.35x` vs ~1x CPU).
  - Subtitle rendering: Thai glyphs & ASS styles confirmed crisp via extracted frame `frame_nvenc_test.jpg`.
- **Architecture & Implementation**:
  1. `src/lib/env.ts`: Added `FFMPEG_VIDEO_ENCODER` config schema (`z.string().optional().default('auto')`) and `env.ffmpegVideoEncoder` accessor.
  2. `src/lib/env.test.ts`: Added `FFMPEG_VIDEO_ENCODER` to tracked environment keys and added unit tests for defaults and overrides.
  3. `src/app/api/export-hardsub/route.ts`: Added `resolveVideoEncoder()` with automated hardware probe:
     - Automatically verifies and prioritizes `h264_nvenc` (NVIDIA GPU), `h264_qsv` (Intel), `h264_amf` (AMD), with graceful fallback to `libx264` (CPU).
     - Configured NVENC with `-preset p4 -cq 26 -profile:v main -level 4.1 -pix_fmt yuv420p -movflags +faststart`.
  4. `.env.local`: Configured `FFMPEG_VIDEO_ENCODER=h264_nvenc` explicitly.
- **Verification Evidence**:
  - `npx tsc --noEmit`: Exit 0.
  - `npm run lint`: Exit 0.
  - `npm test`: 25 test files passed, 79/79 unit tests green.
  - Test video encode output: `scratch/test-vertical/test_nvenc_out.mp4` successfully generated via `h264_nvenc`.
- **Commit status**: not committed (user owns commit timing).

### [2026-11-13] HARDSUB PORTRAIT VIDEO TEXT STRETCH FIX — VERIFIED WORKING (gate ✅)
- **Status**: `VERIFIED WORKING` — tsc ✅ / eslint ✅ (0 errors) / vitest 77 tests ✅ (25 files), exit 0
- **Root Cause**: Browser `videoWidth`/`videoHeight` on a `<video>` element reports correct portrait dimensions (1080×1920). However, the .ass `PlayResX`/`PlayResY` could mismatch if the client failed to report dimensions (fallback was 1920×1080), causing libass to stretch text horizontally on portrait video.
- **Fix** (5 files changed):
  1. `src/lib/types.ts` — Added `subtitles?: SubtitleItem[]` and `style?: SubtitleStyle` to `ExportJob` interface so the route can re-generate .ass after video probe.
  2. `src/lib/env.ts` — Added `FFPROBE_PATH` env var support (zod schema + accessor).
  3. `src/lib/appReducer.ts` — Added `SET_VIDEO_DIMENSIONS` action type and reducer case.
  4. `src/components/VideoPlayer.tsx` — Added `onVideoDimensions` prop; calls callback in `onLoadedMetadata` and via `useEffect` if already loaded.
  5. `src/app/api/export-hardsub/route.ts` — Added `probeVideoDimensions()` (ffprobe `-show_entries frame=width,height:stream=width,height -read_intervals "%+#1"`); integrated anti-stretch guard in `runFFmpegEncoding()`: if probed dims differ from job PlayRes, auto-aligns and regenerates .ass file before encoding starts.
  6. `src/app/page.tsx` — Wired `onVideoDimensions` callback; cleaned up 4 unused icon imports (`AlertCircle`, `AlertTriangle`, `RotateCcw`, `FileText`).
- **Verification Evidence**: `npx tsc --noEmit` exit 0; `eslint` 0 errors; `vitest run` 77/77 tests passed (25 files). Gate clean.
- **NOT yet manually tested** with a real portrait .mp4 export — user should test in browser at http://localhost:3001.
- **Commit status**: not committed (user owns commit timing).

### [2026-11-13] DEV SERVER LAUNCH & BROWSER VERIFICATION — VERIFIED WORKING
- **Status**: `VERIFIED WORKING` — Next.js dev server up on port 3001 (PID 28644/23872), loaded `http://localhost:3001/` with HTTP 200, HMR connected.
- **Context**: User requested "รันเปิดหน่อยครับ" after seeing Super K manga screen in previous browser tab on port 3000.
- **Verification Evidence**:
  - `Get-NetTCPConnection` confirmed port 3001 in Listen state.
  - `Invoke-WebRequest` returned HTTP 200 OK.
  - Turbopack compiled `/` and `/api/fonts` cleanly.
  - Chrome DevTools MCP snapshot verified page title `"Video Subtitle Translator Studio | Gemini AI"` with video stage, timeline, and `⚡ ซ่อมทุกจุดพร้อมกัน (3)` button visible.
  - Console logged `[HMR] connected` with 0 runtime errors.

### [2026-11-13] MULTIMODAL ZERO-ATTENTION-DROPS & PARALLEL GAP REPAIR — VERIFIED WORKING
- **Status**: `VERIFIED WORKING` — 24 test files / 73 tests green; dev server running cleanly on port 3001.
- **What Landed**:
  1. **Multimodal OCR & Quiet Whisper Capture Rules**: Enhanced system prompt with rules 8 & 9 ("Zero Attention Drops: Capturing on-screen signboards, lower thirds, titles, and low-volume whisper audio").
  2. **Client-side Video Frame Extraction**: Injected into `prepareChunk` and `handleFillGaps` (`videoFrameExtractor.ts`) using `<canvas>` sampling up to 24 frames per chunk.
  3. **Parallel Gap Healing**: `autoAuditAndHealGaps` and `handleFillGaps` run parallel workers in batches of 3 (`Promise.allSettled`), healing all detected audio/visual gaps simultaneously without blocking.
- **Verification Evidence**: Quality gates clean (tsc, eslint, vitest). Parallel repair button renders with badge count in real UI.

### [2026-11-13] FEATURE BUILD REVISED: Immersive Half-Screen Editor (A-style) — VERIFIED ON REAL APP
- **Status**: `VERIFIED WORKING` — real app screenshots at 1440×900 and 390×844 with the injected demo video + fake cues (uncommitted)
- **Design evolution**: user picked A+C (page 4 only) → paused once → confirmed the C-card layout build → then asked for the "ครึ่ง ๆ" half-screen style (why isn't it half-half?) — final: **A's immersive half-screen look with C's task-card content, no stepper**. The C-card build from earlier the same day was replaced by this revision.
- **What Landed (revision)**:
  1. **VideoPlayer `fill` prop**: immersive mode renders the player absolutely inside the parent (no aspect-video lock, no card border) — the video becomes the stage background; the live Thai caption stays.
  2. **Workspace = immersive stage** (`page.tsx`): stage fills the left area (video + vignette), **floating glass Timeline capsule** bottom-left, **floating task banners** (reconnect / large-file / error+retry / failed-chunks+retry) above it, **chunk strip** floating under the header with real per-chunk cells, **glass rail right (340px)** holding SubtitleEditor; on mobile the rail stacks below the stage in normal flow (60svh). Export stays in the top header. No stepper, no footer.
  3. **SubtitleEditor as a glass rail**: container transparent + backdrop-blur via the rail wrapper; header/search strips use translucent whites.
- **Verification Evidence**: gate 25 files green; `next build` green (2.1min while contending with the dev server); REAL APP screenshots at both viewports show the video filling the stage with the burned-style Thai caption, the floating Timeline capsule with real cue blocks, the glass rail with all editor tools and cue cards, and the reconnect toast ("เชื่อมต่อวิดีโอ demo-clip.mp4 กับซับไตเติลเดิม (6 รายการ) สำเร็จ").
- **Known tradeoffs**: the editor toolbar wraps vertically inside the 340px rail (usable, slightly tall); video letterboxes on non-16:9 stages (object-contain by design).
- **Mobile fix (user report: ซ้อนกันดูวิดีโอไม่ได้)**: on small screens the floating UI (banners top-16, Timeline capsule bottom-3, chunk strip) covered the video stage. Mobile now stacks everything in normal flow — video block 42svh alone, then chunk strip card, then task cards, then Timeline card, then editor rail 60svh; the floating overlay + vignette are desktop-only (`xl:`). Desktop floating geometry re-verified by measurement (stage x40 w1020 h795, rail x1060 w340 — no overlap, no stepper text, no horizontal overflow) after a parallel writer added `onVideoDimensions` (kept in my restructure).
- **Slim control bar (user crop: ซับ + แถบเลื่อนบาง)**: in fill mode the native video controls are hidden and VideoPlayer renders its own slim glass bar at the stage bottom — play/pause, clock (`fmtClock` handles h:mm:ss), thin seek track with drag (pointer capture), mute toggle; the caption overlay lifts +50px above it. Timeline moved from the floating stage capsule into the rail top (Timeline card above SubtitleEditor on every viewport) so nothing covers the video; the old floating capsule was removed. Verified on real app at both viewports — slim bar sits directly under the caption exactly like the user's crop.
- **Observations for later**: `hasLanguageLeakage` flagged the pure-Thai c1 cue (badge มีภาษาอื่นปน) — possible false positive worth a look; Next 16 locks one dev server per project dir (`taskkill //PID <pid> //F` then restart — Git Bash eats single-slash flags).
- **Commit status**: not committed (user owns commit timing).

### [2026-11-12] UI Redesign Prototypes (3 directions) — DESIGN DECIDED (see entry below)
- **Status**: `PROTOTYPE COMPLETE` — throwaway mockups verified on real browser screenshots (1440×900 + 390×844 per direction); NOT production code
- **Artifact**: `scratch/ui-redesign-video-2026-11-12/` — `index.html` switcher (keys 1/2/3) + `variant-a/b/c.html`, single-file vanilla HTML/CSS, demo scene is inline SVG (no image assets, no deps)
- **Directions**: A Cinema Immersion (full-bleed stage, floating glass capsule + banners, right rail subtitles → bottom sheet on mobile); B Pro Console (NLE 3-pane: list/stage/inspector + full-width timeline with cue/gap blocks + waveform + status bar exposing chunk grid/ETA/failed workers; mobile tabs); C Guided Flow (5-step stepper, all steps clickable: file pick + resumable projects, settings cards, translation grid with per-chunk cue counts and 429 cells + adaptive ETA, review, export); **D = the user's final pick, refined twice with screenshots — C's step-4 page layout as the main design + A's glass pill toolbar** (`variant-d.html`): stepper + chunk strip + stage card left / task cards + cue panel right (all from C), with the glass pill row (language, OCR, karaoke, translate, Export, undo/redo, shortcuts) from A in the head row. Scope: the editor page as the main workspace design; other pages keep the current UI. NOT yet confirmed for Feature build — the user explicitly paused the build once.
- **All variants show real app features**: Thai cue cards with OCR/leak badges, split/merge/retranslate/delete ops, gap-repair and failed-chunk-retry banners, 12-cell chunk grid, waveform, hardsub style controls, SRT/VTT/ASS/TXT exports
- **Verification Evidence**: 6 real screenshots via browser-use IAB; caught-and-fixed layout bugs (banner/caption overlap, rail/topbar collision, mobile horizontal overflow in B, inspector scrollbar); switcher click flake after goto solved with CUA keypress (matches the manga-session lesson)
- **Next**: user picks a direction (or a blend, e.g. B layout + A floating caption) → Feature playbook builds it for real; scratch files stay uncommitted until then

### [2026-11-12] Vercel Deploy Fix — maxDuration Hobby Ceiling
- **Status**: `VERIFIED WORKING` — deployment back to `success` (confirmed via GitHub deployment statuses on the fix commit)
- **Root Cause**: commit `3d76e56` set `maxDuration = 600` in `api/video-translate/route.ts`; the Hobby plan caps Serverless `maxDuration` at 300, and the builder rejects the whole deployment. That commit reached a real deployment for the first time when `d0a989d`/`86a09a1` were pushed.
- **Fix**: 600 → 300 with a ceiling comment; grep confirms every other route already declares 300.
- **Runtime caveat**: the full-video OCR fallback can exceed 300s on Vercel (Hobby) — long videos should use the chunked path (default) or a plan upgrade.
- **Verification Evidence**: gate 25 files passed; pushed `9ab769b`; `gh api deployments/<id>/statuses` returned `success | Deployment has completed`.

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
