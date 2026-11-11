import { LANGUAGES } from './LanguageSelect';

test('LANGUAGES contains all supported target languages with labels and flags', () => {
  expect(LANGUAGES.length).toBeGreaterThanOrEqual(5);

  const codes = LANGUAGES.map((l) => l.code);
  expect(codes).toContain('th');
  expect(codes).toContain('en');
  expect(codes).toContain('ja');
  expect(codes).toContain('zh');
  expect(codes).toContain('ko');

  for (const lang of LANGUAGES) {
    expect(lang.label.length).toBeGreaterThan(0);
    expect(lang.flag.length).toBeGreaterThan(0);
    expect(lang.local.length).toBeGreaterThan(0);
  }
});
