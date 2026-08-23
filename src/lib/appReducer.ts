import { SubtitleItem } from './types';

// ==================== Types ====================

export interface AppState {
  // File & Video
  selectedFile: File | null;
  videoUrl: string | null;
  videoDuration: number;
  isLargeFile: boolean;

  // Subtitles
  subtitles: SubtitleItem[];
  targetLanguage: string;
  currentTime: number;
  seekTime: number | null;

  // Loading / Progress
  isLoading: boolean;
  statusMessage: string;
  error: string | null;
  estimatedTotalSecs: number;
  elapsedSecs: number;

  // History
  past: SubtitleItem[][];
  future: SubtitleItem[][];

  // UI
  isExportOpen: boolean;
  isShortcutsModalOpen: boolean;
  hasMounted: boolean;

  // Toast
  toast: { msg: string; type: 'success' | 'error' | 'info' } | null;

  // Abort
  abortController: AbortController | null;
}

export type AppAction =
  | { type: 'SET_FILE'; payload: { file: File; url: string; duration: number; isLargeFile: boolean } }
  | { type: 'SET_SUBTITLES'; payload: SubtitleItem[] }
  | { type: 'UPDATE_SUBTITLES'; payload: SubtitleItem[] }
  | { type: 'SET_CURRENT_TIME'; payload: number }
  | { type: 'SET_SEEK_TIME'; payload: number | null }
  | { type: 'SET_TARGET_LANGUAGE'; payload: string }
  | { type: 'START_TRANSLATION'; payload: { estimatedSecs: number; statusMessage: string; controller: AbortController } }
  | { type: 'UPDATE_PROGRESS'; payload: { elapsedSecs?: number; statusMessage?: string } }
  | { type: 'TRANSLATION_SUCCESS'; payload: SubtitleItem[] }
  | { type: 'TRANSLATION_ERROR'; payload: string }
  | { type: 'TRANSLATION_CANCELLED' }
  | { type: 'SET_EXPORT_OPEN'; payload: boolean }
  | { type: 'SET_SHORTCUTS_OPEN'; payload: boolean }
  | { type: 'SET_HAS_MOUNTED'; payload: boolean }
  | { type: 'SET_TOAST'; payload: { msg: string; type: 'success' | 'error' | 'info' } | null }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'PUSH_HISTORY' }
  | { type: 'SET_VIDEO_DURATION'; payload: number }
  | { type: 'SET_ESTIMATED_SECS'; payload: number };

// ==================== Initial State ====================

export const initialState: AppState = {
  selectedFile: null,
  videoUrl: null,
  videoDuration: 0,
  isLargeFile: false,
  subtitles: [],
  targetLanguage: 'th',
  currentTime: 0,
  seekTime: null,
  isLoading: false,
  statusMessage: 'AI Processing Video Speech...',
  error: null,
  estimatedTotalSecs: 0,
  elapsedSecs: 0,
  past: [],
  future: [],
  isExportOpen: false,
  isShortcutsModalOpen: false,
  hasMounted: false,
  toast: null,
  abortController: null,
};

const HISTORY_LIMIT = 50;

// ==================== Reducer ====================

/**
 * Pure reducer for the studio page. Object URLs are NOT revoked here (that is
 * a side effect owned by the component) so this module stays testable in Node.
 */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_FILE':
      return {
        ...state,
        selectedFile: action.payload.file,
        videoUrl: action.payload.url,
        videoDuration: action.payload.duration,
        isLargeFile: action.payload.isLargeFile,
        subtitles: [],
        past: [],
        future: [],
        error: null,
        elapsedSecs: 0,
        statusMessage: 'AI Processing Video Speech...',
      };

    case 'SET_SUBTITLES':
      return { ...state, subtitles: action.payload, past: [], future: [] };

    // Live subtitle edit WITHOUT a history entry. The component layer decides
    // when to snapshot history (PUSH_HISTORY) so a burst of keystrokes or a
    // timeline drag collapses into one undo step instead of flooding history.
    case 'UPDATE_SUBTITLES':
      if (action.payload === state.subtitles) return state;
      return { ...state, subtitles: action.payload };

    case 'SET_CURRENT_TIME':
      return { ...state, currentTime: action.payload };

    case 'SET_SEEK_TIME':
      return { ...state, seekTime: action.payload };

    case 'SET_TARGET_LANGUAGE':
      return { ...state, targetLanguage: action.payload };

    case 'START_TRANSLATION':
      return {
        ...state,
        isLoading: true,
        elapsedSecs: 0,
        estimatedTotalSecs: action.payload.estimatedSecs,
        statusMessage: action.payload.statusMessage,
        error: null,
        abortController: action.payload.controller,
      };

    case 'UPDATE_PROGRESS':
      return {
        ...state,
        elapsedSecs: action.payload.elapsedSecs ?? state.elapsedSecs,
        statusMessage: action.payload.statusMessage ?? state.statusMessage,
      };

    // The !isLoading guard drops results that arrive after a cancel completed
    // (TRANSLATION_CANCELLED nulls the controller, so the aborted-signal
    // check alone would miss a subsequent late error).
    case 'TRANSLATION_SUCCESS':
      if (!state.isLoading || state.abortController?.signal.aborted) return state;
      return {
        ...state,
        isLoading: false,
        subtitles: action.payload,
        past: [],
        future: [],
        toast: { msg: `Subtitle ready (${action.payload.length} cues)`, type: 'success' },
      };

    case 'TRANSLATION_ERROR':
      if (!state.isLoading || state.abortController?.signal.aborted) return state;
      return {
        ...state,
        isLoading: false,
        error: action.payload,
        toast: { msg: action.payload, type: 'error' },
      };

    case 'TRANSLATION_CANCELLED':
      return {
        ...state,
        isLoading: false,
        abortController: null,
        statusMessage: 'Cancelled by user',
        toast: { msg: 'Translation cancelled', type: 'info' },
      };

    case 'SET_EXPORT_OPEN':
      return { ...state, isExportOpen: action.payload };

    case 'SET_SHORTCUTS_OPEN':
      return { ...state, isShortcutsModalOpen: action.payload };

    case 'SET_HAS_MOUNTED':
      return { ...state, hasMounted: action.payload };

    case 'SET_TOAST':
      return { ...state, toast: action.payload };

    case 'UNDO': {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1];
      return {
        ...state,
        subtitles: prev,
        past: state.past.slice(0, -1),
        future: [...state.future, state.subtitles],
      };
    }

    case 'REDO': {
      if (state.future.length === 0) return state;
      const next = state.future[state.future.length - 1];
      return {
        ...state,
        subtitles: next,
        past: [...state.past, state.subtitles],
        future: state.future.slice(0, -1),
      };
    }

    // Snapshots the CURRENT subtitles into history. Call once at the start of
    // a logical edit (first keystroke of a burst, timeline drag start, apply
    // of a bulk operation) — never on every change event.
    case 'PUSH_HISTORY':
      if (state.past.length > 0 && state.past[state.past.length - 1] === state.subtitles) return state;
      return {
        ...state,
        past: [...state.past.slice(-(HISTORY_LIMIT - 1)), state.subtitles],
        future: [],
      };

    case 'SET_VIDEO_DURATION':
      return { ...state, videoDuration: action.payload };

    case 'SET_ESTIMATED_SECS':
      return { ...state, estimatedTotalSecs: action.payload };

    default:
      return state;
  }
}
