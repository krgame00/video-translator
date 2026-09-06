import {
  loadSubtitleStyle,
  saveSubtitleStyle,
  DEFAULT_SUBTITLE_STYLE,
  POSITION_TO_ASS_ALIGNMENT,
} from './subtitleStyle';

function withLocalStorageStub(storage: Record<string, string>): void {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = v; },
    removeItem: (k: string) => { delete storage[k]; },
  };
}

function testLoadFallbacks() {
  withLocalStorageStub({ video_translator_style: 'not json at all {{{' });
  const garbage = loadSubtitleStyle();
  console.assert(garbage.position === DEFAULT_SUBTITLE_STYLE.position, 'garbage JSON → default position');
  console.assert(garbage.fontSize === DEFAULT_SUBTITLE_STYLE.fontSize, 'garbage JSON → default fontSize');

  // Per-field validation: bad fields fall back, good fields survive
  withLocalStorageStub({
    video_translator_style: JSON.stringify({
      position: 'middle',
      fontSize: 99,            // not in options → default
      primaryColor: '#GGGGGG', // not hex → default
      borderStyle: 9,          // invalid → default
      marginV: 5000,           // clamped to 120
    }),
  });
  const mixed = loadSubtitleStyle();
  console.assert(mixed.position === 'middle', 'valid field must survive');
  console.assert(mixed.fontSize === DEFAULT_SUBTITLE_STYLE.fontSize, 'invalid fontSize falls back');
  console.assert(mixed.primaryColor === DEFAULT_SUBTITLE_STYLE.primaryColor, 'invalid color falls back');
  console.assert(mixed.borderStyle === DEFAULT_SUBTITLE_STYLE.borderStyle, 'invalid borderStyle falls back');
  console.assert(mixed.marginV === 120, 'marginV clamps to 120');
}

function testRoundTrip() {
  const storage: Record<string, string> = {};
  withLocalStorageStub(storage);
  const saved = { position: 'top' as const, fontSize: 26, primaryColor: '4ADE80', borderStyle: 4 as const, marginV: 88 };
  saveSubtitleStyle(saved);
  const loaded = loadSubtitleStyle();
  console.assert(JSON.stringify(loaded) === JSON.stringify(saved), 'save → load must round-trip exactly');
}

function testAlignmentMapping() {
  console.assert(POSITION_TO_ASS_ALIGNMENT.bottom === 2, 'bottom-center = 2');
  console.assert(POSITION_TO_ASS_ALIGNMENT.middle === 5, 'middle-center = 5');
  console.assert(POSITION_TO_ASS_ALIGNMENT.top === 8, 'top-center = 8');
}

function testSubtitleStyle() {
  testLoadFallbacks();
  testRoundTrip();
  testAlignmentMapping();
  console.log('✅ subtitleStyle unit tests passed successfully!');
}

test('subtitleStyle', testSubtitleStyle);
