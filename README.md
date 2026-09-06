# Video Subtitle Translator Studio

AI-powered subtitle studio: upload a video (or audio), Gemini transcribes the
speech and translates it (Thai-first, multi-language), you edit cues on a
CapCut-style timeline with a live waveform, then export SRT / VTT or a
**hardsub MP4 burned by FFmpeg** — styled exactly like the in-app preview
(WYSIWYG), with optional **karaoke word-by-word highlight**.

## Features

- **Generate** — client-side audio extraction (16kHz mono WAV, 5-min chunks),
  parallel Gemini transcription + translation with key×model failover,
  speech-synced cue timing (1.5–4s cues anchored to spoken syllables).
- **Edit** — virtualized cue list, find & replace, SRT/VTT import, timeline
  drag/resize with waveform, undo/redo, Thai word-aware cue splitting.
- **Karaoke** — opt-in second Gemini pass per chunk assigns per-word timings;
  the preview highlights the word being sung and the burn emits ASS {\k}
  fills. Timings are validated and gracefully degraded to proportional
  distribution when the model drifts.
- **Hardsub export** — real .ass files with PlayRes matching the actual
  video dimensions, the Itim font shipped per job (fontsdir), BGR-correct
  colors, Thai line wrapping at word boundaries, real encode progress,
  cancellable jobs.
- **Resilience** — chunked resumable uploads, per-job FFmpeg processes with
  cancel, temp sweeping with quota guard, rate limiting on every Gemini route.

## Requirements

- Node.js 20+
- FFmpeg on PATH (or set FFMPEG_PATH)
- A Gemini API key

## Setup

    npm install

    # .env.local (required)
    GEMINI_API_KEY=your_key_here

    # optional
    # TEMP_DIR=./tmp                  temp dir for uploads/jobs (default: OS temp)
    # MAX_UPLOAD_BYTES=1073741824     upload cap (default 1GB)
    # FFMPEG_PATH=/usr/bin/ffmpeg
    # FFMPEG_HWACCEL=cuda             decode-side hwaccel
    # CRON_SECRET=secret              protects /api/cron/clean-temp when set

    npm run dev                    # development
    npm run build && npm start     # production

## Docker

    docker build -t subtitle-studio .
    docker run -p 3000:3000 -e GEMINI_API_KEY=your_key subtitle-studio

The image includes FFmpeg (with libass) and the Itim font.

## Temp cleanup

Request-handling routes trigger an opportunistic sweep (files older than 1h,
quota guard at 2GB). For unattended instances schedule the cron endpoint:

    GET/POST /api/cron/clean-temp     header: Authorization: Bearer <CRON_SECRET>

## Quality gate

    npm run gate       # tsc + eslint + vitest (same check the pre-push hook runs)
    git config core.hooksPath .githooks   # activate the versioned pre-push hook

## Project layout

    src/app/api/     upload, video-translate(-chunk), translate-srt,
                     refine-subtitles, export-hardsub, cron/clean-temp
    src/lib/         assBuilder (.ass generation), srtFormatter (timing engine),
                     geminiClient/VideoService (AI pipeline),
                     subtitleStyle (shared WYSIWYG style), security, wordTiming
    src/components/  VideoPlayer (preview+highlight), Timeline, SubtitleEditor,
                     ExportModal, SubtitleItemCard
