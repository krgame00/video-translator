# Design Spec: Clean Minimalist Studio Redesign

## 1. Overview & Objective
Redesign the **Video Subtitle Studio** web application UI/UX to a refined, high-end "Clean Minimalist Studio" aesthetic inspired by Vercel, Linear, and Raycast. The new interface prioritizes visual hierarchy, subtle glassmorphism, monochrome slate tones with electric violet accents, and seamless cross-device responsiveness.

---

## 2. Color Palette & Token System

### Core Palette
- **Canvas Base Background:** `#09090b` (Deep Charcoal Zinc)
- **Panel Surface (Card background):** `#121218` / `#181820` (Subtle Slate Glass with 80% opacity)
- **Panel Border:** `border-zinc-800/80` (Ultra-thin 1px dark metallic border)
- **Primary Text:** `#f4f4f5` (Zinc 100 - High contrast)
- **Secondary/Muted Text:** `#a1a1aa` (Zinc 400 - Readable neutral)
- **Subtle Muted Label:** `#71717a` (Zinc 500)

### Accent Tokens
- **Primary AI & Interactive Accent (Violet):** `#8b5cf6` / `#a855f7` (Electric Violet & Purple)
- **Audio Waveform & Playhead (Cyan):** `#06b6d4` / `#22d3ee` (Electric Cyan)
- **Success Badge (Emerald):** `#10b981` (Emerald)
- **Warning / Error Badge (Rose):** `#f43f5e` (Rose)

---

## 3. UI Component Architecture & Layout Specifications

### Header & Navigation (`src/app/page.tsx`)
- Compact top navigation bar with `Video Subtitle Studio` branding and `Gemini AI Studio` badge in Violet styling.
- Keyboard shortcuts trigger button with `<kbd>?</kbd>`.
- Quick Export CTA button with refined Violet border glow.

### Top Control Bar & File Hub
- Sleek file upload trigger showing truncated file name.
- Target language selector with refined dropdown styling.
- Electric Violet `Generate Subtitles with Gemini` CTA button with hover ambient shadow.

### Studio Left Stage: Video Player & Audio Waveform
- **Video Player Panel:** 16:9 cinema container with rounded 2xl borders and subtitle overlay rendered in `Font Itim` for optimal Thai readability.
- **Waveform Visualizer:** Clean peak visualizer with Cyan playhead and clickable timeline timestamp seeking.

### Studio Right Stage: Interactive Subtitle Editor
- **Header:** Total subtitle count badge, text filter input, and instant subtitle add button.
- **Subtitle Cards:** Floating cards with `border-zinc-800`, active card highlighted with `border-l-2 border-purple-500 bg-purple-500/5`.
- **Quick Action Toolbar:** Compact, elegant Play, Split, Merge, and Delete triggers.

---

## 4. Responsive Behavior
- **Desktop (`>= lg`):** Locked `100vh` split-view Studio Control Room (Zero outer page scroll).
- **Mobile (`< lg`):** Unlocked natural scrolling page layout with fixed 500px Subtitle Editor viewport.

---

## 5. Verification Strategy
- Verify visual contrast and alignment across desktop and mobile screen sizes.
- Ensure zero regressions in subtitle editing, splitting, merging, AI translation, and SRT export.
