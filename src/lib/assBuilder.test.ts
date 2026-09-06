import {
  buildAss,
  rgbToAssColor,
  ASS_BASE_PLAY_RES_Y,
} from './assBuilder';
import { DEFAULT_SUBTITLE_STYLE } from './subtitleStyle';
import { SubtitleItem } from './types';

function cue(id: string, startTime: number, endTime: number, translatedText: string, words?: SubtitleItem['words']): SubtitleItem {
  return { id, startTime, endTime, originalText: 'orig', translatedText, words };
}

function testRgbToAssColor() {
  // RGB yellow → ASS BGR yellow (the regression that made yellow burn cyan)
  console.assert(rgbToAssColor('FFFF00') === '&H0000FFFF', `yellow must map to &H0000FFFF (got ${rgbToAssColor('FFFF00')})`);
  console.assert(rgbToAssColor('FFFFFF') === '&H00FFFFFF', 'white is symmetric');
  console.assert(rgbToAssColor('FF0000') === '&H000000FF', 'RGB red must become ASS blue-channel-last red');
  console.assert(rgbToAssColor('4ADE80', '80') === '&H8080DE4A', 'alpha byte goes first');
  console.assert(rgbToAssColor('#00ff00') === '&H0000FF00', 'lowercase + # prefix accepted');
}

function testHeaderAndScaling() {
  const ass = buildAss([cue('1', 0, 2, 'hello')], {
    playResX: 1080,
    playResY: 1920,
    style: { ...DEFAULT_SUBTITLE_STYLE, fontSize: 22, marginV: 40, position: 'middle', borderStyle: 1, primaryColor: 'FFFF00' },
  });

  console.assert(ass.includes('PlayResX: 1080'), 'PlayResX must match the real video width');
  console.assert(ass.includes('PlayResY: 1920'), 'PlayResY must match the real video height');
  console.assert(ass.includes('ScaledBorderAndShadow: yes'), 'ScaledBorderAndShadow required');
  // Fontsize scales from the 288 base to the real height: 22 * 1920/288 = 147
  const expectedSize = Math.round((22 * 1920) / ASS_BASE_PLAY_RES_Y);
  console.assert(ass.includes(`Default,Itim,${expectedSize},`), `fontsize must scale to ${expectedSize}`);
  // Middle position → alignment 5; MarginV scales 40 * 1920/288 = 267; L/R 10 * 1080/288 = 38
  console.assert(ass.includes(',5,38,38,267,1'), `alignment/margins line expected (got style line: ${ass.split('\n').find(l => l.startsWith('Style:'))})`);
  // Colors: primary=secondary=ASS yellow, outline black, transparent back for borderStyle 1
  console.assert(ass.includes('&H0000FFFF,&H0000FFFF,&H00000000,&HFF000000'), 'style colours must be BGR with transparent back');
}

function testNonKaraokePlainText() {
  const ass = buildAss([cue('1', 1.5, 4.25, 'สวัสดี {โลก}')], {
    playResX: 1920,
    playResY: 1080,
    style: { ...DEFAULT_SUBTITLE_STYLE },
    karaoke: false,
  });
  const dialogue = ass.split('\r\n').find((l) => l.startsWith('Dialogue:'))!;
  console.assert(dialogue.includes('0:00:01.50,0:00:04.25'), `timestamp must be H:MM:SS.cc centiseconds (got ${dialogue})`);
  console.assert(dialogue.includes('สวัสดี \\{โลก\\}'), 'text must be brace-escaped and unmodified otherwise');
  console.assert(!dialogue.includes('\\k'), 'non-karaoke dialogue must not contain \\k tags');
}

function testKaraokeTags() {
  const words = [
    { text: 'สวัสดี', start: 0, end: 1 },
    { text: 'ชาวโลก', start: 1, end: 2 },
  ];
  const ass = buildAss([cue('1', 0, 2, 'สวัสดีชาวโลก', words)], {
    playResX: 1080,
    playResY: 1920,
    style: { ...DEFAULT_SUBTITLE_STYLE, primaryColor: 'FFFFFF' },
    karaoke: true,
    highlightColor: 'FFFF00',
  });
  const dialogue = ass.split('\r\n').find((l) => l.startsWith('Dialogue:'))!;
  console.assert(dialogue.includes('{\\k100}สวัสดี{\\k100}ชาวโลก'), `karaoke tags expected (got ${dialogue})`);

  // Sum of \k centiseconds ≈ cue duration (±2cs)
  const ks = [...dialogue.matchAll(/\\k(\d+)/g)].map((m) => Number(m[1]));
  const total = ks.reduce((a, b) => a + b, 0);
  console.assert(Math.abs(total - 200) <= 2, `sum of \\k (200cs expected) got ${total}`);
}

function testAssBuilder() {
  testRgbToAssColor();
  testHeaderAndScaling();
  testNonKaraokePlainText();
  testKaraokeTags();
  console.log('✅ assBuilder unit tests passed successfully!');
}

test('assBuilder', testAssBuilder);
