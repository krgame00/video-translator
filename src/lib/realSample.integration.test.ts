import { splitLongSubtitleItem } from './srtFormatter';
import { SubtitleItem } from './types';

test('real sample: no mid-word cuts, cues capped ~6.5s', () => {
  const items: SubtitleItem[] = [
    { id: '1', startTime: 7.135, endTime: 26.772, originalText: 'x', translatedText: 'ไม่ต้องเป็นห่วงฉันหรอกนะ ไม่เป็นไร นี่เป็นส่วนหนึ่งของการบำบัด เพื่อเพิ่มคุณภาพการนอนหลับของคุณต่างหากล่ะ' },
    { id: '2', startTime: 67.195, endTime: 73.145, originalText: 'x', translatedText: 'ถ้าอยากได้แบบที่รู้สึกดีกว่านี้ จะให้ขยับสะโพกแรงกว่านี้ก็ได้นะ' },
    { id: '3', startTime: 133.1, endTime: 143.003, originalText: 'x', translatedText: 'ได้สิ ถ้าปล่อยออกมาแบบนั้น คุณภาพการนอนหลับก็น่าจะยิ่งสูงขึ้นไปอีก' },
  ];

  const out = items.flatMap((i) => splitLongSubtitleItem(i));
  console.log('\n=== SPLIT RESULT ===');
  for (const s of out) {
    console.log(`${s.startTime.toFixed(3)} --> ${s.endTime.toFixed(3)} (${(s.endTime - s.startTime).toFixed(2)}s) | ${s.translatedText}`);
  }

  // no cue > 7s (except unavoidable), no cue > 40 chars
  for (const s of out) {
    const dur = s.endTime - s.startTime;
    console.assert(dur <= 7.0, `cue too long: ${dur}s "${s.translatedText}"`);
    console.assert(s.translatedText.length <= 40, `cue too long text: ${s.translatedText.length} "${s.translatedText}"`);
    // no cue starts with an orphaned trailing vowel/tone mark (mid-word cut indicator)
    // NOTE: \u0E40-\u0E44 (เ แ โ ใ ไ) are leading vowels, legal at word start
    console.assert(!/^[\u0E30-\u0E3F]/.test(s.translatedText), `starts with orphan trailing vowel: "${s.translatedText}"`);
    // no orphan single-char cues
    console.assert(s.translatedText.length >= 2, `orphan 1-char cue: "${s.translatedText}"`);
  }
  console.log('total cues:', out.length, '| asserts pass');
});
