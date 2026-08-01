# Cinematic Dark Studio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Video Subtitle Studio UI/UX to a high-contrast, professional "Cinematic Dark Studio" control room aesthetic across all page sections and components.

**Architecture:** Update CSS design tokens in `globals.css`, refine Tailwind classes in layout containers and component sub-views (`page.tsx`, `VideoPlayer.tsx`, `WaveformVisualizer.tsx`, `SubtitleEditor.tsx`, `SubtitleItemCard.tsx`, `ExportModal.tsx`), adding glowing state cues and electric cyan/indigo accents.

**Tech Stack:** Next.js (App Router), React 19, Tailwind CSS v4, Lucide React, HTML5 Audio/Video, Web Audio API.

## Global Constraints
- Canvas base background: `#050507` (Deep Obsidian Black)
- Panel Surface: `#0f0f14` / `#161620`
- Active Neon Accent: `#06b6d4` (Electric Cyan)
- Thai Subtitle Font: `var(--font-itim), var(--font-geist-sans), sans-serif`
- Maintain 100% feature parity (Audio extraction, parallel chunking, Gemini translation API, SRT/VTT/TXT export, LocalStorage saving).

---

### Task 1: Global Theme Tokens & Styles Update

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: CSS Variables `--background`, `--foreground`, `--font-itim`, `--font-mono`
- Produces: CSS utility classes for Obsidian canvas, glowing borders, custom scrollbars, and accent shadows.

- [ ] **Step 1: Update `src/app/globals.css` theme variables and utilities**

```css
@import "tailwindcss";

:root {
  --background: #050507;
  --foreground: #f4f4f5;
  --panel-bg: #0f0f14;
  --panel-border: #232334;
  --accent-cyan: #06b6d4;
  --accent-indigo: #6366f1;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-itim), var(--font-geist-sans), sans-serif;
  --font-mono: var(--font-geist-mono);
  --font-itim: var(--font-itim), cursive;
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-itim), var(--font-geist-sans), Arial, sans-serif;
}

.font-itim {
  font-family: var(--font-itim), cursive, sans-serif;
}

/* Studio Custom Scrollbar */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: #09090e;
}
::-webkit-scrollbar-thumb {
  background: #1e1e2d;
  border-radius: 9999px;
}
::-webkit-scrollbar-thumb:hover {
  background: #06b6d4;
}
```

- [ ] **Step 2: Verify CSS build**

Run: `npm run build`
Expected: Build succeeds with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style: update global theme variables for cinematic dark studio"
```

---

### Task 2: Header, Top Control Hub & AI Banner Redesign

**Files:**
- Modify: `src/app/page.tsx:274-423`

**Interfaces:**
- Consumes: `selectedFile`, `targetLanguage`, `isLoading`, `progressPercent`, `remainingSecs`, `error`
- Produces: Cinematic studio header, file target zone, language selector, and glowing CTA button.

- [ ] **Step 1: Update Header, Upload Control Hub and AI Processing Status styling in `src/app/page.tsx`**

Enhance header bar with obsidian backdrop, metallic border `#232334`, electric cyan active pills, and custom glowing CTA button for `handleTranslate`.

- [ ] **Step 2: Verify page compilation**

Run: `npm run build`
Expected: Build succeeds with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "ui: redesign header, control hub, and AI progress banner for cinematic studio"
```

---

### Task 3: Video Player & Subtitle Canvas Overlay Redesign

**Files:**
- Modify: `src/components/VideoPlayer.tsx`

**Interfaces:**
- Consumes: `videoUrl`, `subtitles`, `currentTime`, `onTimeUpdate`, `seekTime`
- Produces: 16:9 cinema video viewport with high-contrast Thai subtitle overlay (`Itim` font, text-shadow).

- [ ] **Step 1: Refine `src/components/VideoPlayer.tsx` styles**

Apply dark obsidian frame, 1px metallic border `#232334`, styled video controls, and high-visibility subtitle overlay text with text drop-shadow (`drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]`).

- [ ] **Step 2: Verify video component compilation**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/VideoPlayer.tsx
git commit -m "ui: upgrade video player cinema container and subtitle canvas overlay"
```

---

### Task 4: Audio Waveform Visualizer Redesign

**Files:**
- Modify: `src/components/WaveformVisualizer.tsx`

**Interfaces:**
- Consumes: `selectedFile`, `currentTime`, `duration`, `subtitles`, `onSeek`
- Produces: Electric Cyan waveform canvas rendering audio peaks, hover timecodes, and subtitle block markers.

- [ ] **Step 1: Refine `src/components/WaveformVisualizer.tsx` styling**

Update canvas peak colors to Electric Cyan (`#06b6d4`), cyan playhead cursor (`#22d3ee`), and dark obsidian canvas container (`#09090e` / border `#232334`).

- [ ] **Step 2: Verify waveform component compilation**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/WaveformVisualizer.tsx
git commit -m "ui: polish waveform visualizer with electric cyan audio peaks and markers"
```

---

### Task 5: Interactive Subtitle Editor & Card Items Redesign

**Files:**
- Modify: `src/components/SubtitleEditor.tsx`
- Modify: `src/components/SubtitleItemCard.tsx`

**Interfaces:**
- Consumes: `subtitles`, `currentTime`, `onSubtitlesChange`, `onJumpTo`, `targetLanguage`
- Produces: Interactive subtitle list with glowing active line indicator (electric cyan border & subtle background glow).

- [ ] **Step 1: Update `src/components/SubtitleEditor.tsx` and `src/components/SubtitleItemCard.tsx`**

Add active card neon cyan border highlight (`border-cyan-500 shadow-cyan-500/10`), line number pills, clear timecode edit fields, and action buttons for quick jump/delete/add.

- [ ] **Step 2: Verify subtitle editor compilation**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/SubtitleEditor.tsx src/components/SubtitleItemCard.tsx
git commit -m "ui: redesign subtitle editor and item cards with active line neon glow"
```

---

### Task 6: Export Modal & Keyboard Shortcuts Overlay Refinement

**Files:**
- Modify: `src/components/ExportModal.tsx`
- Modify: `src/app/page.tsx:498-551`

**Interfaces:**
- Consumes: `isExportOpen`, `isShortcutsModalOpen`, `subtitles`, `videoUrl`
- Produces: Glassmorphic dark modal dialogs for exporting formats (SRT, VTT, TXT) and viewing keyboard shortcuts.

- [ ] **Step 1: Polish modals in `src/components/ExportModal.tsx` and `src/app/page.tsx`**

Apply dark obsidian modals with metallic borders `#232334`, cyan focus states, and tabbed export selectors.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/ExportModal.tsx src/app/page.tsx
git commit -m "ui: polish export modal and keyboard shortcuts help dialog"
```

---

### Task 7: End-to-End Build & Verification

**Files:**
- Verification only

- [ ] **Step 1: Execute production build test**

Run: `npm run build`
Expected: Clean build without errors or TypeScript lint issues.

- [ ] **Step 2: Final git status check**

Run: `git status`
Expected: Working tree clean.
