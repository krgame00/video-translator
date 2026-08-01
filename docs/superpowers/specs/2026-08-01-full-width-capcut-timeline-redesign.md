# Design Spec: Full-Width CapCut Timeline Redesign

## 1. Overview & Objective
Transform the **Video Subtitle Studio** UI layout from a 2-column split view into a professional, video-first **Full-Width CapCut / Premiere Pro Timeline Layout**. The new architecture centers the Video Preview Stage in the upper half of the screen and places a 100% full-width Timeline & Subtitle Dock along the bottom.

---

## 2. Layout & Architectural Specs

### Top Navigation & Control Header (`src/app/page.tsx`)
- Combined Navbar & File Hub in a single top header:
  - Left: Video Subtitle Studio logo & Gemini AI badge.
  - Middle: File Upload button (`Select Video/Audio File`) & Target Language selector.
  - Right: `Generate Subtitles` CTA button, Shortcuts modal trigger, and `Export` CTA button.

### Upper Stage: Cinema Video Preview (Centered Stage)
- Centered 16:9 Cinema Video Stage (`max-w-4xl mx-auto`).
- Video Player container with subtitle overlay, playback settings, and rounded 2xl dark metallic borders.
- Subtitles overlay rendered in `Font Itim` for Thai readability.

### Lower Dock: Full-Width CapCut Timeline & Subtitle Dock (`100% Width`)
- Spans 100% of the workspace width below the video player.
- **Top Section (Track 1):** Dual-Track Audio Waveform Visualizer & Playhead with clickable timestamp scrubbing.
- **Bottom Section (Track 2):** Full-Width Subtitle Editor Dock with search filter, AI style refiner, instant add button, and scrollable subtitle cards.
- Each Subtitle Card spans full or grid width with CapCut quick action buttons (Play, Split, Merge, Delete).

---

## 3. Color Tokens (Obsidian CapCut Studio)
- **Base Background:** `#09090b` (Deep Charcoal Zinc)
- **Panel Surface:** `#121218` (Dark Slate Glass)
- **Border:** `border-zinc-800`
- **Primary Accent (AI & Actions):** `#8b5cf6` (Electric Violet)
- **Waveform & Cursor Accent:** `#06b6d4` (Electric Cyan)

---

## 4. Responsive Strategy
- **Desktop (`>= lg`):** Locked 100vh workspace with Centered Video Stage (top 55%) and Full-Width Timeline Dock (bottom 45%).
- **Mobile (`< lg`):** Natural scrolling layout with Video Player on top and Timeline Dock below.
