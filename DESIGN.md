---
name: Video Subtitle Studio
description: AI-powered interactive video speech-to-text, translation, and subtitle editor
colors:
  primary: "#2563eb"
  neutral-bg: "#09090b"
  neutral-surface: "#18181b"
  neutral-border: "#27272a"
  accent-purple: "#9333ea"
  accent-indigo: "#4f46e5"
  text-primary: "#ededed"
  text-muted: "#a1a1aa"
typography:
  display:
    fontFamily: "var(--font-itim), var(--font-geist-sans), sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "var(--font-itim), var(--font-geist-sans), sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xl: "0.75rem"
  2xl: "1rem"
spacing:
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    padding: "10px 24px"
---

# Design System: Video Subtitle Studio

## 1. Overview

**Creative North Star: "The High-Contrast Subtitle Control Room"**

Video Subtitle Studio is a focused, high-precision media translation environment. It combines dark-mode utilitarian surface contrast with responsive audio waveform and subtitle synchronization. Designed for content creators and localizers, every UI element prioritizes legibility, speed, and real-time processing status.

The system explicitly rejects SaaS clichés such as washed-out gray text, excessive decorative blur, or multi-step wizard modals that hide progress.

**Key Characteristics:**
- **Sleek Dark Mode Canvas:** Deep zinc-950 base background (`#09090b`) with layered zinc-900 surfaces (`#18181b`).
- **High Legibility:** High-contrast text (`#ededed`) paired with rounded Itim/Geist typography for Thai and English.
- **Vibrant Functional Accents:** Sapphire blue (`#2563eb`) and purple (`#9333ea`) gradients dedicated exclusively to primary actions and active AI states.

## 2. Colors

The palette relies on a stark dark-mode neutral foundation punctuated by vivid purple and blue primary accents.

### Primary
- **Sapphire Blue** (`#2563eb`): Used for primary action buttons, timeline highlights, and active status indicators.

### Secondary
- **Vivid Purple** (`#9333ea`): Used for AI translation badges, glowing progress bars, and secondary interactive cues.

### Neutral
- **Deep Slate Background** (`#09090b`): Canvas background providing maximum contrast for video previews and waveforms.
- **Card Surface** (`#18181b`): Layered surface for upload areas, subtitle list containers, and modal dialogs.
- **Subtle Stroke** (`#27272a`): Crisp 1px structural borders dividing content regions.
- **High-Contrast Ink** (`#ededed`): Primary body text ensuring ≥4.5:1 WCAG contrast against dark surfaces.

### Named Rules
**The Single-Accent Action Rule.** Saturated blue-purple gradients are reserved strictly for executable user actions (Generate, Export) and active AI progress indicators.

## 3. Typography

**Display Font:** Itim / Geist Sans (`var(--font-itim), var(--font-geist-sans), sans-serif`)
**Body Font:** Itim / Geist Sans (`var(--font-itim), var(--font-geist-sans), sans-serif`)
**Label/Mono Font:** Geist Mono (`var(--font-geist-mono), monospace`)

**Character:** Friendly yet precise typography optimized for clear Thai script reading and exact timestamp tracking.

### Hierarchy
- **Display** (Bold 700, 1.5rem, line-height 1.2): Main header title ("Video Subtitle Studio").
- **Headline** (SemiBold 600, 1.125rem, line-height 1.3): Section headers and modal titles.
- **Body** (Regular 400, 0.875rem, line-height 1.5): Subtitle editor text and user instructions.
- **Label** (Medium 500, 0.75rem, letter-spacing 0.05em): Timecodes, status pills, and input labels.

## 4. Elevation

Depth is conveyed through subtle border contrast (`#27272a`) and backdrop blurring (`backdrop-blur-xl`), rather than heavy drop shadows.

### Shadow Vocabulary
- **Glow Accent** (`box-shadow: 0 10px 25px -5px rgba(37, 99, 235, 0.2)`): Used on primary CTA buttons and active processing banners to create depth on dark backgrounds.

### Named Rules
**The Flat-Surface Rule.** Cards and panels sit flat against the canvas; elevation glow appears exclusively during active processing or interactive hover states.

## 5. Components

### Buttons
- **Shape:** Rounded xl (`0.75rem`)
- **Primary:** `bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600`, white text (`#ffffff`), padding `10px 24px`.
- **Hover / Focus:** Scale `1.02` with elevated shadow glow (`shadow-purple-600/20`).

### Cards / Containers
- **Corner Style:** Rounded 2xl (`1rem`)
- **Background:** Semi-transparent zinc (`bg-zinc-900/40`) with `backdrop-blur-xl`
- **Border:** 1px subtle stroke (`border-zinc-800/80`)
- **Internal Padding:** `1.25rem` (20px)

### Subtitle Editor Item
- **Style:** Bordered list item with time range input and inline editable text area.
- **Focus / Active:** Blue border highlight (`border-blue-500`) when playback cursor reaches subtitle timestamp.

## 6. Do's and Don'ts

### Do:
- **Do** maintain high-contrast text (`#ededed`) against dark surfaces (`#09090b` / `#18181b`).
- **Do** use `font-itim` for Thai subtitle rendering to ensure maximum readability.
- **Do** provide immediate feedback and smooth progress indicators during AI processing.

### Don't:
- **Don't** use low-contrast gray text on dark surfaces that fails 4.5:1 contrast checks.
- **Don't** use colored side-stripe borders or multi-colored decorative text gradients.
- **Don't** hide processing progress or time estimates behind generic non-descriptive loaders.
