# Clean Minimalist Studio Design Spec (2026-08-01)

## 1. Concept & Inspiration
- **Theme**: Clean Minimalist Studio (Vercel / Linear / Apple style).
- **Core Philosophy**: A highly professional, clean, and distraction-free workspace. Avoids overly flashy elements in favor of subtle depth, crisp typography, and high contrast where it matters.
- **Vibe**: Premium, utilitarian, modern, lightweight.

## 2. Color Palette & Theming (globals.css updates)
- **Background (`--background`)**: Clean dark charcoal (`#0a0a0a` or `#000000`).
- **Foreground (`--foreground`)**: Crisp white/off-white (`#fafafa`).
- **Panel Background (`--panel-bg`)**: Slightly lighter charcoal (`#111111` or `#171717`).
- **Panel Border (`--panel-border`)**: Very subtle border (`#262626` or `#333333`).
- **Accent Colors**: 
  - Primary Accent: Violet (`#8b5cf6` or `#7c3aed`).
  - Secondary Accent: Cyan (`#06b6d4`).

## 3. Layout & Structure
- Keep the current dual-column responsive layout (Left: Video/Waveform, Right: Subtitle Editor).
- Increase border radius slightly for a softer look (`rounded-2xl` or `rounded-xl`).
- Remove heavy gradients from background elements; use flat, solid dark grays with thin borders.
- Buttons should be sleek: either flat with a subtle border and hover glow, or a very restrained gradient.

## 4. Subtitle Editor Style (Floating Card with Soft Shadow)
- **Container**: Minimalist background, hidden scrollbars.
- **Subtitle Cards (Items)**:
  - Remove harsh borders.
  - Background: Flat dark gray (`bg-zinc-900/50`).
  - Shadow: Soft drop shadow (`shadow-sm`, on hover `shadow-md shadow-violet-500/10`).
  - Hover state: Subtle background lighten (`hover:bg-zinc-800/80`), slight translateY (`-translate-y-0.5`).
  - Inputs: Borderless, transparent background, focus ring only on the active text line.
  - Active state: Subtle left border accent (e.g., `border-l-2 border-violet-500`) or a soft violet glow.

## 5. Typography
- **Primary Font**: `Inter` or `Geist Sans` (sans-serif) for an ultra-clean look.
- **Monospace Font**: `Geist Mono` or `JetBrains Mono` for timecodes.
- Ensure high legibility, proper tracking (letter-spacing), and leading (line-height).

## 6. Implementation Steps
1. Update `src/app/globals.css` with the new color variables and theme overrides.
2. Update `src/app/page.tsx` header, main layout, and buttons to use the new minimalist styles.
3. Update `src/components/SubtitleEditor.tsx` and `SubtitleItem` components to implement the Floating Card style.
4. Update `src/components/VideoPlayer.tsx` and `WaveformVisualizer.tsx` to match the cleaner aesthetic (e.g., removing heavy shadows, simplifying borders).
