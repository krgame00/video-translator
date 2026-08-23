import { findActiveSubtitle } from './subtitleUtils';
import { SubtitleItem } from './types';

function cue(id: string, startTime: number, endTime: number): SubtitleItem {
  return { id, startTime, endTime, originalText: 'x', translatedText: 'x' };
}

const sorted = [
  cue('a', 0, 2),
  cue('b', 2.5, 4),
  cue('c', 5, 8),
  cue('d', 9, 10),
];

function testFindActiveSubtitle() {
  console.assert(findActiveSubtitle([], 1) === undefined, 'empty list has no active cue');
  console.assert(findActiveSubtitle(sorted, 1)?.id === 'a', 'time inside first cue');
  console.assert(findActiveSubtitle(sorted, 3)?.id === 'b', 'time inside middle cue');
  console.assert(findActiveSubtitle(sorted, 9.999)?.id === 'd', 'time inside last cue');
  console.assert(findActiveSubtitle(sorted, 4.5) === undefined, 'gap between cues has no active cue');
  console.assert(findActiveSubtitle(sorted, 100) === undefined, 'time past the end has no active cue');
  console.assert(findActiveSubtitle(sorted, 2)?.id === 'a', 'exact boundary counts as active');

  // Unsorted input falls back to a linear scan instead of wrong results
  const unsorted = [cue('late', 9, 10), cue('early', 0, 2)];
  console.assert(findActiveSubtitle(unsorted, 1)?.id === 'early', 'unsorted list falls back to linear scan');
  console.assert(findActiveSubtitle(unsorted, 9.5)?.id === 'late', 'unsorted list linear scan late cue');

  console.log('✅ findActiveSubtitle unit tests passed successfully!');
}

test('findActiveSubtitle', testFindActiveSubtitle);
