# Subtitle Editor Viewport Locking & Floating Jump Button Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock app layout height on large screens, make Subtitle Editor internally scrollable, auto-center active playing line, and add a floating "Jump to Active Subtitle" button.

**Architecture:** Update `page.tsx` grid height constraints (`lg:h-[calc(100vh-130px)]`), update `SubtitleEditor.tsx` auto-scroll behavior to `block: 'center'`, and add sticky header styling & floating jump button element.

**Tech Stack:** Next.js, React 19, Tailwind CSS v4, Lucide React.

## Global Constraints
- Canvas Base: `#050507` (Deep Obsidian)
- Accent: `#06b6d4` (Electric Cyan)
- Zero regressions in video playback sync, SRT export, or subtitle editing.

---

### Task 1: Lock Studio Viewport Height in Page Grid

**Files:**
- Modify: `src/app/page.tsx:442-485`

**Interfaces:**
- Consumes: Page grid container
- Produces: `lg:h-[calc(100vh-130px)]` locked viewport grid with internal scrolling.

- [ ] **Step 1: Update grid height classes in `src/app/page.tsx`**

```tsx
<div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 h-auto lg:h-[calc(100vh-130px)] min-h-0">
  {/* Left: Video Player & Audio Waveform Stage */}
  <div className="lg:col-span-7 flex flex-col space-y-4 min-h-0 overflow-y-auto pr-1 custom-scrollbar">
    ...
  </div>

  {/* Right: Interactive Subtitle Editor Stage */}
  <div className="lg:col-span-5 h-[600px] lg:h-full min-h-0 flex flex-col">
    ...
  </div>
</div>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "ui: lock studio viewport height to screen size with internal panel scrolling"
```

---

### Task 2: Subtitle Editor Auto-Center & Floating Jump Button

**Files:**
- Modify: `src/components/SubtitleEditor.tsx`

**Interfaces:**
- Consumes: `activeSubtitleId`, `autoScroll`
- Produces: Auto-centered scrolling (`block: 'center'`) + Floating Jump to Active Subtitle button (`Target` icon).

- [ ] **Step 1: Update `src/components/SubtitleEditor.tsx` auto-scroll and add floating jump button**

Change `block: 'nearest'` to `block: 'center'` in `useEffect`. Render floating button at bottom-right of list container when `activeSubtitleId` is present:

```tsx
{activeSubtitleId && (
  <button
    onClick={() => {
      activeCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }}
    className="absolute bottom-4 right-6 z-20 px-3 py-2 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium flex items-center gap-1.5 shadow-xl shadow-cyan-600/30 transition-all hover:scale-105 active:scale-95 animate-in fade-in slide-in-from-bottom-2"
    title="Jump to active playing subtitle"
  >
    <Target className="w-4 h-4 text-cyan-200 animate-pulse" />
    <span>Jump to Active Subtitle</span>
  </button>
)}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/SubtitleEditor.tsx
git commit -m "feat: add auto-center scrolling and floating Jump to Active Subtitle button"
```

---

### Task 3: End-to-End Build & Verification

**Files:**
- Verification only

- [ ] **Step 1: Execute production build**

Run: `npm run build`
Expected: Clean build with zero errors.

- [ ] **Step 2: Verify git status**

Run: `git status`
Expected: Working tree clean.
