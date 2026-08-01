# CapCut-Style Subtitle Editor & Dual Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a CapCut-inspired Subtitle Editor with Index Badges, Split/Merge segment actions, and a Dual-Track Timeline (Audio Peaks + Subtitle Track Blocks).

**Architecture:** Extend subtitle utility helpers in `subtitleUtils.ts` with `splitSubtitle` and `mergeSubtitle`, update `SubtitleItemCard.tsx` with CapCut index badges and action toolbars, update `SubtitleEditor.tsx` with state handlers, and enhance `WaveformVisualizer.tsx` to render a 2-track CapCut timeline canvas.

**Tech Stack:** Next.js, React 19, Tailwind CSS v4, Lucide React, HTML5 Canvas API.

## Global Constraints
- Canvas Base: `#050507` (Deep Obsidian)
- Active Highlight: `#06b6d4` (Electric Cyan)
- Thai Subtitle Font: `var(--font-itim), var(--font-geist-sans), sans-serif`
- Full feature preservation (Zero regressions in SRT export, video player sync, Gemini translation API).

---

### Task 1: Add Subtitle Split & Merge Utility Helpers

**Files:**
- Modify: `src/lib/subtitleUtils.ts`

**Interfaces:**
- Consumes: `SubtitleItem` array
- Produces: `splitSubtitleItem(subtitles: SubtitleItem[], id: string, splitTime?: number): SubtitleItem[]`, `mergeSubtitleItem(subtitles: SubtitleItem[], id: string): SubtitleItem[]`

- [ ] **Step 1: Implement `splitSubtitleItem` and `mergeSubtitleItem` in `src/lib/subtitleUtils.ts`**

```typescript
export function splitSubtitleItem(
  subtitles: SubtitleItem[],
  id: string,
  splitTime?: number
): SubtitleItem[] {
  const index = subtitles.findIndex((item) => item.id === id);
  if (index === -1) return subtitles;

  const item = subtitles[index];
  const midPoint = splitTime ?? Number(((item.startTime + item.endTime) / 2).toFixed(2));

  // Split text by words/spaces
  const origWords = item.originalText.split(' ');
  const transWords = item.translatedText.split(' ');

  const origHalf1 = origWords.slice(0, Math.ceil(origWords.length / 2)).join(' ');
  const origHalf2 = origWords.slice(Math.ceil(origWords.length / 2)).join(' ') || origHalf1;

  const transHalf1 = transWords.slice(0, Math.ceil(transWords.length / 2)).join(' ');
  const transHalf2 = transWords.slice(Math.ceil(transWords.length / 2)).join(' ') || transHalf1;

  const part1: SubtitleItem = {
    ...item,
    endTime: midPoint,
    originalText: origHalf1,
    translatedText: transHalf1,
  };

  const part2: SubtitleItem = {
    id: `sub-${Date.now()}`,
    startTime: midPoint,
    endTime: item.endTime,
    originalText: origHalf2,
    translatedText: transHalf2,
  };

  const updated = [...subtitles];
  updated.splice(index, 1, part1, part2);
  return updated;
}

export function mergeSubtitleItem(
  subtitles: SubtitleItem[],
  id: string
): SubtitleItem[] {
  const index = subtitles.findIndex((item) => item.id === id);
  if (index === -1 || index >= subtitles.length - 1) return subtitles;

  const current = subtitles[index];
  const next = subtitles[index + 1];

  const merged: SubtitleItem = {
    id: current.id,
    startTime: current.startTime,
    endTime: next.endTime,
    originalText: `${current.originalText} ${next.originalText}`.trim(),
    translatedText: `${current.translatedText} ${next.translatedText}`.trim(),
  };

  const updated = [...subtitles];
  updated.splice(index, 2, merged);
  return updated;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/subtitleUtils.ts
git commit -m "feat: add splitSubtitleItem and mergeSubtitleItem helper utilities"
```

---

### Task 2: CapCut Subtitle Item Card Refinement

**Files:**
- Modify: `src/components/SubtitleItemCard.tsx`

**Interfaces:**
- Consumes: `item`, `index`, `isLast`, `isActive`, `onUpdate`, `onDelete`, `onJumpTo`, `onSplit`, `onMerge`
- Produces: CapCut-styled card with `#01` Index pill, timecodes, action toolbar (`Split ✂️`, `Merge 🔗`, `Play ▶`, `Delete 🗑️`)

- [ ] **Step 1: Update `src/components/SubtitleItemCard.tsx`**

Add CapCut Index Pill (`#01`), action icons (`Scissors`, `Merge`, `Play`, `Trash2`), and split/merge callback props.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/SubtitleItemCard.tsx
git commit -m "ui: upgrade SubtitleItemCard with CapCut index badges and Split/Merge action toolbar"
```

---

### Task 3: Subtitle Editor Integration

**Files:**
- Modify: `src/components/SubtitleEditor.tsx`

**Interfaces:**
- Consumes: `subtitles`, `onSubtitlesChange`, `onJumpTo`
- Produces: SubtitleEditor passing `index`, `isLast`, `onSplit`, `onMerge` down to cards.

- [ ] **Step 1: Integrate Split and Merge actions in `src/components/SubtitleEditor.tsx`**

Add `handleSplit(id)` and `handleMerge(id)` handlers and pass them to `SubtitleItemCard`.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/SubtitleEditor.tsx
git commit -m "feat: connect Split and Merge subtitle actions in SubtitleEditor"
```

---

### Task 4: CapCut Dual-Track Studio Timeline Canvas

**Files:**
- Modify: `src/components/WaveformVisualizer.tsx`

**Interfaces:**
- Consumes: `selectedFile`, `currentTime`, `duration`, `subtitles`, `onSeek`
- Produces: Dual-track canvas (Track 1 = Audio Peak Waveform, Track 2 = CapCut Subtitle Blocks with timecode tooltips and click-to-seek)

- [ ] **Step 1: Redesign `src/components/WaveformVisualizer.tsx` to render a 2-Track CapCut Timeline Canvas**

Split canvas height (Top: Audio Waveform 36px, Bottom: Subtitle Blocks Track 28px). Render subtitle blocks with rounded corners, cyan playhead crossing both tracks, and subtitle index text labels.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/WaveformVisualizer.tsx
git commit -m "ui: implement CapCut Dual-Track Timeline with Audio Waveform and Subtitle Block tracks"
```

---

### Task 5: End-to-End Build & Verification

**Files:**
- Verification only

- [ ] **Step 1: Execute production build**

Run: `npm run build`
Expected: Clean build without TypeScript or lint errors.

- [ ] **Step 2: Verify git status**

Run: `git status`
Expected: Working tree clean.
