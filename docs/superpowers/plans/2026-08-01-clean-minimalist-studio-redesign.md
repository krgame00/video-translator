# Clean Minimalist Studio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Video Subtitle Studio UI to a refined, high-end "Clean Minimalist Studio" aesthetic inspired by Vercel, Linear, and Raycast.

**Architecture:** Update Next.js page layout and component styling using Tailwind CSS, focusing on dark obsidian/zinc surfaces (`#09090b`), subtle borders (`border-zinc-800/80`), electric violet (`#8b5cf6`) AI accents, and responsive viewport behavior.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS, Lucide React icons.

## Global Constraints

- Primary Background: `#09090b` (Deep Charcoal Zinc)
- Card Surfaces: `#121218` / `#181820`
- Borders: `border-zinc-800/80`
- Primary AI Accent: `#8b5cf6` (Electric Violet)
- Audio Waveform Accent: `#06b6d4` (Electric Cyan)

---

### Task 1: Main Page Base Canvas & Navigation Header

**Files:**
- Modify: `src/app/page.tsx:274-320`

- [ ] **Step 1: Update main container background and top header styling**

Update `main` background class to `bg-[#09090b]`, header background to `bg-[#0c0c10]/80 border-b border-zinc-800/80 backdrop-blur-xl`. Update `Gemini AI Studio` badge styling to `bg-purple-500/10 text-purple-400 border-purple-500/20`.

- [ ] **Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "style: update base canvas and header to clean minimalist theme"
```

---

### Task 2: Top Control Bar & File Hub Redesign

**Files:**
- Modify: `src/app/page.tsx:315-375`

- [ ] **Step 1: Refine Control Bar & File Upload Zone**

Update top control bar container to `bg-[#121218]/90 border border-zinc-800/80 rounded-2xl p-3 sm:p-4 backdrop-blur-xl`.
Update File Input button to `border-zinc-800 hover:border-purple-500/60 bg-[#09090b] hover:bg-[#15151e]`.
Update Generate CTA button to `bg-gradient-to-r from-purple-600 via-indigo-600 to-violet-600 text-white font-semibold shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 hover:scale-[1.01] transition-all`.

- [ ] **Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "style: polish top control bar with electric violet theme"
```

---

### Task 3: Video Player & Audio Waveform Panel Polish

**Files:**
- Modify: `src/components/VideoPlayer.tsx`
- Modify: `src/components/WaveformVisualizer.tsx`

- [ ] **Step 1: Polish Video Player Frame**

Update `VideoPlayer` root container border to `border-zinc-800/80 bg-[#121218] rounded-2xl shadow-xl`.

- [ ] **Step 2: Polish Waveform Visualizer Surface**

Update `WaveformVisualizer` container to `bg-[#121218]/90 border border-zinc-800/80 rounded-2xl p-3 sm:p-4 shadow-xl`.

- [ ] **Step 3: Commit**

```bash
git add src/components/VideoPlayer.tsx src/components/WaveformVisualizer.tsx
git commit -m "style: refine video player and waveform panels with minimalist dark cards"
```

---

### Task 4: Subtitle Editor Floating Cards Polish

**Files:**
- Modify: `src/components/SubtitleEditor.tsx`
- Modify: `src/components/SubtitleItemCard.tsx`

- [ ] **Step 1: Refine Subtitle Editor Stage**

Update `SubtitleEditor` container to `bg-[#121218]/90 border border-zinc-800/80 rounded-2xl backdrop-blur-xl shadow-xl`.
Update `SubtitleItemCard` default state to `bg-[#161620]/70 border-zinc-800/80 hover:border-zinc-700 hover:bg-[#1c1c28]`.
Update active state to `bg-gradient-to-r from-purple-950/40 via-indigo-950/30 to-[#121218] border-l-2 border-l-purple-500 border-zinc-800/80 shadow-md shadow-purple-500/10`.

- [ ] **Step 2: Commit**

```bash
git add src/components/SubtitleEditor.tsx src/components/SubtitleItemCard.tsx
git commit -m "style: polish subtitle editor floating cards with violet active highlights"
```

---

### Task 5: Verification & Walkthrough

**Files:**
- Create: `<appDataDir>\brain\<conversation-id>/walkthrough.md`

- [ ] **Step 1: Verify layout responsiveness and visual contrast**
- [ ] **Step 2: Create walkthrough document**
