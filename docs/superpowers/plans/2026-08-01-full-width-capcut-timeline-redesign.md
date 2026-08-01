# Full-Width CapCut Timeline Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Video Subtitle Studio layout into a professional, video-first Full-Width CapCut Timeline architecture (Center Video Preview on top, 100% Full-Width Timeline & Subtitle Dock along bottom).

**Architecture:** Restructure Next.js main layout grid from 2-column split-view (`grid-cols-12`) to a vertical stack layout: Integrated Top Navigation Bar, Centered 16:9 Video Preview Stage (top 55%), and 100% Full-Width Timeline Dock (bottom 45%).

**Tech Stack:** Next.js 16, React 19, Tailwind CSS, Lucide React icons.

## Global Constraints

- Layout Structure: Integrated Header (top), Centered Video Stage (middle), 100% Full-Width Dock (bottom).
- Main Canvas: `#09090b` (Deep Charcoal Zinc)
- Dock & Surfaces: `#121218`
- Primary Accent: `#8b5cf6` (Electric Violet)
- Waveform Accent: `#06b6d4` (Electric Cyan)

---

### Task 1: Top Integrated Header & Controls Redesign

**Files:**
- Modify: `src/app/page.tsx:274-365`

- [ ] **Step 1: Integrate Header, File Upload, Language Selector, and Action Buttons into a single sleek navbar**

Merge the top header and control bar into a single streamlined top navbar. Left side contains logo & Gemini AI badge, center contains file selector & language dropdown, right side contains Generate CTA, Shortcuts, and Export buttons.

- [ ] **Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "refactor: integrate top navbar with file hub and generate controls"
```

---

### Task 2: Upper Stage - Centered Cinema Video Preview

**Files:**
- Modify: `src/app/page.tsx:370-460`
- Modify: `src/components/VideoPlayer.tsx`

- [ ] **Step 1: Center Video Player Stage in upper section**

Refactor upper section to `max-w-4xl w-full mx-auto flex flex-col items-center justify-center flex-1 min-h-0 py-2`. Video player takes center stage with high-contrast 16:9 aspect ratio and rounded 2xl borders.

- [ ] **Step 2: Commit**

```bash
git add src/app/page.tsx src/components/VideoPlayer.tsx
git commit -m "refactor: center video preview stage in upper workspace"
```

---

### Task 3: Lower Dock - 100% Full-Width CapCut Timeline Layout

**Files:**
- Modify: `src/app/page.tsx:460-520`
- Modify: `src/components/WaveformVisualizer.tsx`

- [ ] **Step 1: Transform lower workspace into 100% width Timeline Dock**

Move `WaveformVisualizer` and `SubtitleEditor` into a 100% full-width bottom panel container (`w-full shrink-0 border-t border-zinc-800 bg-[#121218]/90 backdrop-blur-xl p-3 space-y-3`).

- [ ] **Step 2: Update WaveformVisualizer canvas width for full-width timeline**

Ensure `WaveformVisualizer` canvas expands dynamically to fill 100% width of the bottom dock.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx src/components/WaveformVisualizer.tsx
git commit -m "feat: implement 100% full-width CapCut timeline bottom dock"
```

---

### Task 4: Subtitle Editor Dock & Full-Width Cards

**Files:**
- Modify: `src/components/SubtitleEditor.tsx`
- Modify: `src/components/SubtitleItemCard.tsx`

- [ ] **Step 1: Refine Subtitle Editor inside bottom dock**

Update `SubtitleEditor` layout to render cleanly inside the 100% full-width bottom dock, supporting multi-column grid layout (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3`) or full-width rows for subtitle cards.

- [ ] **Step 2: Commit**

```bash
git add src/components/SubtitleEditor.tsx src/components/SubtitleItemCard.tsx
git commit -m "style: refine subtitle cards layout for full-width bottom dock"
```

---

### Task 5: Verification & Walkthrough

**Files:**
- Create: `<appDataDir>\brain\<conversation-id>/walkthrough.md`

- [ ] **Step 1: Test Desktop and Mobile layouts via browser subagent**
- [ ] **Step 2: Update walkthrough document with new screenshots**
