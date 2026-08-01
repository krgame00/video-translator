# Design Spec: CapCut-Style Subtitle Editor & Dual Timeline Track

## 1. Overview & Objective
Enhance the Video Subtitle Studio editor interface with a **CapCut-inspired Side Inspector** and **Dual-Track Studio Timeline**. This provides video editors and content creators with professional tools to split, merge, jump, and visually scrub subtitle blocks alongside audio waveforms.

---

## 2. Component Specifications

### A. CapCut Subtitle Card Item (`SubtitleItemCard.tsx`)
- **Index Badge:** Line index badge (`#01`, `#02`, `#03`...) styled in dark cyan rounded pill.
- **Timecode Format:** `00:00.0 → 00:02.5` with single-click edit capability.
- **CapCut Hover Quick Toolbar:**
  - `Play` (Loop play current segment)
  - `Split ✂️` (Split current subtitle line at cursor position or midpoint into 2 items)
  - `Merge 🔗` (Combine current subtitle line with the next item)
  - `Delete 🗑️` (Remove line)
- **Active Selection Glow:** CapCut Electric Cyan left border (`border-l-4 border-l-cyan-400`), active line glow, and smooth auto-scroll.

### B. Subtitle Editor Container (`SubtitleEditor.tsx`)
- Search & Filter Bar + Find & Replace support.
- Split and Merge handler logic for atomic state mutations.
- Index counter badge and quick SRT import/export buttons.

### C. CapCut Dual-Track Studio Timeline (`WaveformVisualizer.tsx`)
- **Track 1 (Audio Peak Waveform):** Real-time cyan amplitude peaks decoded via Web Audio API.
- **Track 2 (Subtitle Blocks Timeline):** CapCut-style color-coded blocks showing exact start and end times of every subtitle line.
- Click on any subtitle block to jump video playback directly to that subtitle's timestamp and focus its card in the editor list.

---

## 3. Data Structures & Functions
```typescript
// Split subtitle item at splitTime
function splitSubtitle(subtitles: SubtitleItem[], id: string, splitTime?: number): SubtitleItem[];

// Merge subtitle item with the adjacent item
function mergeSubtitle(subtitles: SubtitleItem[], id: string): SubtitleItem[];
```

---

## 4. Verification & Testing Strategy
- Test split functionality: ensure timecodes and text split cleanly into two adjacent items.
- Test merge functionality: ensure start time of item A and end time of item B are preserved, with text joined by space.
- Verify production build with `npm run build`.
