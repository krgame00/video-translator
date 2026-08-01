# Design Spec: Cinematic Dark Studio Redesign

## 1. Overview & Objective
Redesign the **Video Subtitle Studio** web application UI/UX to deliver a high-contrast, professional "Cinematic Dark Studio" control room aesthetic. The updated layout optimizes workflow efficiency for content creators and localizers with glowing audio waveform playback, real-time AI status tracking, and a sleek interactive subtitle editor.

---

## 2. Color Palette & Token System

### Core Palette
- **Canvas Base Background:** `#050507` (Deep Obsidian Black)
- **Panel Surface (Card background):** `#0f0f14` / `#161620` (Dark Charcoal Charcoal Zinc with subtle translucency)
- **Panel Border:** `#232334` (Ultra-thin 1px metallic border)
- **Primary Text:** `#f4f4f5` (Zinc 100 - High contrast WCAG AAA)
- **Muted Text:** `#a1a1aa` (Zinc 400 - Clear secondary readability)

### Accent Tokens
- **Active Waveform & Cursor (Cyan):** `#06b6d4` / `#22d3ee` (Electric Cyan)
- **AI Processing Gradient (Indigo & Violet):** `from-indigo-600 via-purple-600 to-cyan-500`
- **Success Badge (Emerald):** `#10b981` (Glowing Emerald)
- **Warning / Error Badge:** `#f43f5e` (Rose)

---

## 3. UI Component Architecture & Layout Specifications

### Header & Navigation (`src/app/page.tsx`)
- Sleek studio branding with `Video Subtitle Studio` title and Gemini 3.5/3.6 AI badge.
- Keyboard shortcuts modal trigger button with `<kbd>?</kbd>` visual cue.
- Quick Export CTA button with emerald/cyan accent.

### Top Control Bar & File Hub
- File dropzone/button with truncation for long media file names.
- Target language selector supporting Thai (ภาษาไทย), English, Japanese, Chinese, and Korean.
- Glowing `Generate Subtitles` CTA button with subtle hover scale (`scale-[1.02]`) and soft ambient box-shadow glow.

### Live AI Status & Progress Panel
- Live timer display with elapsed time, estimated remaining duration, and linear progress indicator bar.
- Actionable `Cancel` button for aborting current translation job safely.
- Error state with immediate retry trigger.

### Studio Left Stage: Video Player & Audio Waveform
- **Video Player Panel:** 16:9 responsive cinema container with subtitle overlay rendered in `Font Itim` for optimal Thai readability.
- **Waveform Visualizer:** Interactive audio peak visualizer with cyan playhead, timeline timestamp indicators, and clickable audio seeking.

### Studio Right Stage: Interactive Subtitle Editor
- Header with total subtitle count badge, text filter input, and instant subtitle add button.
- Subtitle item list with active line neon cyan border highlight synced to video playback time.
- Timecode controls (start time, end time), editable text area, loop playback test button, and delete action.

---

## 4. Typography & Font Integration
- Display/Body Font: `var(--font-itim), var(--font-geist-sans), sans-serif`
- Monospace/Timecode Font: `var(--font-geist-mono), monospace`

---

## 5. Verification & Testing Strategy
- Verify responsive desktop and laptop grid layouts (`grid-cols-1 lg:grid-cols-12`).
- Ensure dark mode contrast ratio is ≥ 4.5:1 for body copy and subtitle editor text.
- Verify zero regressions in audio extraction, chunking, AI API requests, SRT/VTT/TXT export, and local storage persistence.
