import { formatTimeSRT, formatTimeVTT, generateSRT, generateVTT } from './srtFormatter';
import { SubtitleItem } from './types';

// Test formatTimeSRT
const srtTime = formatTimeSRT(72.4);
console.assert(srtTime === '00:01:12,400', `Expected 00:01:12,400 but got ${srtTime}`);

// Test formatTimeVTT
const vttTime = formatTimeVTT(72.4);
console.assert(vttTime === '00:01:12.400', `Expected 00:01:12.400 but got ${vttTime}`);

// Test generateSRT
const mockItems: SubtitleItem[] = [
  {
    id: '1',
    startTime: 1.2,
    endTime: 3.5,
    originalText: 'Hello world',
    translatedText: 'สวัสดีชาวโลก',
  },
];

const srtOutput = generateSRT(mockItems);
console.assert(srtOutput.includes('00:00:01,200 --> 00:00:03,500'), 'SRT timestamp mismatch');
console.assert(srtOutput.includes('สวัสดีชาวโลก'), 'SRT text mismatch');

console.log('✅ srtFormatter unit tests passed successfully!');
