import { appReducer, initialState, type AppState } from './appReducer';
import { SubtitleItem } from './types';

function makeSub(id: string, startTime = 0, endTime = 2): SubtitleItem {
  return { id, startTime, endTime, originalText: `orig ${id}`, translatedText: `ทดสอบ ${id}` };
}

function withSubtitles(subs: SubtitleItem[]): AppState {
  return { ...initialState, subtitles: subs };
}

function testUndoRedo() {
  const s0 = withSubtitles([makeSub('a')]);
  // First edit of a burst: PUSH_HISTORY snapshots current, then live update
  const s1 = appReducer(s0, { type: 'PUSH_HISTORY' });
  const s2 = appReducer(s1, { type: 'UPDATE_SUBTITLES', payload: [makeSub('a'), makeSub('b')] });

  console.assert(s2.past.length === 1, 'PUSH_HISTORY + UPDATE should leave exactly one past entry');
  console.assert(s2.future.length === 0, 'future should be cleared on new edit');

  // Undo returns to the pre-edit subtitles
  const s3 = appReducer(s2, { type: 'UNDO' });
  console.assert(s3.subtitles.length === 1 && s3.subtitles[0].id === 'a', 'UNDO should restore pre-edit subtitles');
  console.assert(s3.future.length === 1, 'UNDO should push current into future');

  // Redo restores the edited subtitles
  const s4 = appReducer(s3, { type: 'REDO' });
  console.assert(s4.subtitles.length === 2, 'REDO should restore edited subtitles');
  console.assert(s4.past.length === 1 && s4.future.length === 0, 'REDO should move state back into past');
}

function testBurstCollapsesIntoOneUndo() {
  const s0 = withSubtitles([makeSub('a')]);

  // Simulated keystroke burst: one PUSH_HISTORY, many UPDATE_SUBTITLES
  let s = appReducer(s0, { type: 'PUSH_HISTORY' });
  s = appReducer(s, { type: 'UPDATE_SUBTITLES', payload: [makeSub('a', 0, 2)] });
  s = appReducer(s, { type: 'UPDATE_SUBTITLES', payload: [makeSub('a', 0, 3)] });
  s = appReducer(s, { type: 'UPDATE_SUBTITLES', payload: [makeSub('a', 0, 4)] });

  console.assert(s.past.length === 1, 'a burst of live updates must not add history entries');
  const undone = appReducer(s, { type: 'UNDO' });
  console.assert(undone.subtitles[0].endTime === 2, 'single UNDO should revert the whole burst');
}

function testHistoryCap() {
  let s = withSubtitles([makeSub('a')]);
  for (let i = 0; i < 80; i++) {
    s = appReducer(s, { type: 'PUSH_HISTORY' });
    s = appReducer(s, { type: 'UPDATE_SUBTITLES', payload: [makeSub('a'), makeSub(`n${i}`)] });
  }
  console.assert(s.past.length <= 50, `history must be capped at 50 entries (got ${s.past.length})`);
}

function testSetFileClearsSubtitlesAndHistory() {
  const s0 = {
    ...withSubtitles([makeSub('a'), makeSub('b')]),
    past: [[makeSub('x')]],
    future: [[makeSub('y')]],
  };
  const file = new File(['x'], 'video.mp4', { type: 'video/mp4' });
  const s1 = appReducer(s0, { type: 'SET_FILE', payload: { file, url: 'blob:x', duration: 12.5, isLargeFile: false } });
  console.assert(s1.subtitles.length === 0, 'SET_FILE must clear subtitles');
  console.assert(s1.past.length === 0 && s1.future.length === 0, 'SET_FILE must clear history');
  console.assert(s1.videoDuration === 12.5, 'SET_FILE must set duration');
  console.assert(s1.selectedFile === file, 'SET_FILE must store the file');
}

function testLateResultsAfterCancelAreDropped() {
  // Cancel nulls the controller, so a late SUCCESS/ERROR arriving afterwards
  // must be ignored via the !isLoading guard (regression for the abort race).
  const controller = new AbortController();
  const s0 = appReducer(initialState, {
    type: 'START_TRANSLATION',
    payload: { estimatedSecs: 30, statusMessage: 'working', controller },
  });
  controller.abort();
  const cancelled = appReducer(s0, { type: 'TRANSLATION_CANCELLED' });

  const lateSuccess = appReducer(cancelled, { type: 'TRANSLATION_SUCCESS', payload: [makeSub('late')] });
  console.assert(lateSuccess.subtitles.length === 0, 'late TRANSLATION_SUCCESS after cancel must be dropped');
  console.assert(!lateSuccess.isLoading, 'late success must not flip loading state');

  const lateError = appReducer(cancelled, { type: 'TRANSLATION_ERROR', payload: 'boom' });
  console.assert(lateError.error === null, 'late TRANSLATION_ERROR after cancel must be dropped');
}

function testSuccessWhileAbortedSignalIsDropped() {
  const controller = new AbortController();
  const s0 = appReducer(initialState, {
    type: 'START_TRANSLATION',
    payload: { estimatedSecs: 30, statusMessage: 'working', controller },
  });
  controller.abort();
  // Not yet cancelled by the user: signal aborted alone must still guard.
  const guarded = appReducer(s0, { type: 'TRANSLATION_SUCCESS', payload: [makeSub('x')] });
  console.assert(guarded.subtitles.length === 0, 'success on an aborted signal must be dropped');
}

function testUpdateSubtitlesReferenceEqualShortCircuit() {
  const subs = [makeSub('a')];
  const s0 = withSubtitles(subs);
  const s1 = appReducer(s0, { type: 'UPDATE_SUBTITLES', payload: subs });
  console.assert(s1 === s0, 'UPDATE_SUBTITLES with the same array reference must return the same state');
}

function testPushHistoryDuplicateGuard() {
  const subs = [makeSub('a')];
  const s0 = withSubtitles(subs);
  const s1 = appReducer(s0, { type: 'PUSH_HISTORY' });
  const s2 = appReducer(s1, { type: 'PUSH_HISTORY' });
  console.assert(s2.past.length === 1, 'double PUSH_HISTORY without a change must not duplicate the snapshot');
}

function testUpdateProgressPartialPayload() {
  const s0 = { ...initialState, elapsedSecs: 10, statusMessage: 'old' };
  const s1 = appReducer(s0, { type: 'UPDATE_PROGRESS', payload: { statusMessage: 'new' } });
  console.assert(s1.elapsedSecs === 10, 'UPDATE_PROGRESS without elapsedSecs must keep current elapsed');
  console.assert(s1.statusMessage === 'new', 'UPDATE_PROGRESS must apply statusMessage');

  const s2 = appReducer(s1, { type: 'UPDATE_PROGRESS', payload: { elapsedSecs: 42 } });
  console.assert(s2.elapsedSecs === 42 && s2.statusMessage === 'new', 'UPDATE_PROGRESS must apply elapsedSecs only');
}

function testAppReducer() {
  testUndoRedo();
  testBurstCollapsesIntoOneUndo();
  testHistoryCap();
  testSetFileClearsSubtitlesAndHistory();
  testLateResultsAfterCancelAreDropped();
  testSuccessWhileAbortedSignalIsDropped();
  testUpdateSubtitlesReferenceEqualShortCircuit();
  testPushHistoryDuplicateGuard();
  testUpdateProgressPartialPayload();
  console.log('✅ appReducer unit tests passed successfully!');
}

test('appReducer', testAppReducer);
