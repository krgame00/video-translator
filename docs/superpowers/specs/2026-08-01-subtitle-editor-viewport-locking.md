# Design Spec: Subtitle Editor Viewport Locking & Floating Jump Button

## 1. Overview & Objective
Fix layout overflow when working with large subtitle lists by locking the app viewport to the screen height (`100vh`), pinning header/search controls, auto-centering the active subtitle line (`block: 'center'`), and providing a floating **"Jump to Active Subtitle"** button.

---

## 2. Technical Changes

### A. App Viewport & Grid Layout (`src/app/page.tsx`)
- Lock page layout container on large displays: `h-auto lg:h-[calc(100vh-130px)]`
- Left column (Video + Waveform + Tips): `flex flex-col space-y-4 min-h-0 overflow-y-auto`
- Right column (Subtitle Editor): `h-[600px] lg:h-full min-h-0 flex flex-col`

### B. Subtitle Editor Container (`src/components/SubtitleEditor.tsx`)
- **Sticky Header Controls & Search:** Pinned to top of Subtitle Editor container.
- **Scroll Container:** `flex-1 overflow-y-auto custom-scrollbar` with smooth scrolling.
- **Auto-Center Scroll:** Scroll active card with `block: 'center'` option so it centers in the viewport.
- **Floating Jump Button:** A sleek floating button `[🎯 Jump to Active Subtitle]` rendered at the bottom-right of the list when an active subtitle exists, allowing one-click scrolling to current playback position.

---

## 3. Verification Plan
- Verify page does not grow infinitely on long subtitle lists.
- Verify active subtitle scrolls into center view during playback.
- Verify Floating Jump button scrolls list directly to active line.
- Verify `npm run build` passes cleanly.
