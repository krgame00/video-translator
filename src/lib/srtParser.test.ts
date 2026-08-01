import { parseSRT } from './srtFormatter';

function testSRTParser() {
  const srtContent = `\uFEFF1
00:00:01,200 --> 00:00:03,500
Hello World!

2
00:00:04,000 --> 00:00:07,800
This is line one.
This is line two.
`;

  const parsed = parseSRT(srtContent);

  console.assert(parsed.length === 2, `Expected 2 subtitle items but got ${parsed.length}`);
  console.assert(parsed[0].startTime === 1.2, `Expected startTime 1.2 but got ${parsed[0].startTime}`);
  console.assert(parsed[0].endTime === 3.5, `Expected endTime 3.5 but got ${parsed[0].endTime}`);
  console.assert(parsed[0].translatedText === 'Hello World!', `Expected "Hello World!" but got "${parsed[0].translatedText}"`);
  console.assert(parsed[1].startTime === 4.0, `Expected startTime 4.0 but got ${parsed[1].startTime}`);
  console.assert(parsed[1].endTime === 7.8, `Expected endTime 7.8 but got ${parsed[1].endTime}`);
  console.assert(parsed[1].translatedText.includes('This is line one.'), 'Line 1 missing');
  console.assert(parsed[1].translatedText.includes('This is line two.'), 'Line 2 missing');

  console.log('✅ parseSRT unit tests passed successfully!');
}

test('srtParser', testSRTParser);
