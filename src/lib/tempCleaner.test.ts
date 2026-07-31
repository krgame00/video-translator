import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { cleanExpiredTempFiles } from './tempCleaner';

function testTempCleaner() {
  const tempDir = os.tmpdir();
  const now = Date.now();
  const twoHoursAgo = now - 2 * 3600 * 1000;
  const thirtyMinsAgo = now - 30 * 60 * 1000;

  // 1. Create an expired export file
  const expiredExportFile = path.join(tempDir, `hs_test_expired_${now}.srt`);
  fs.writeFileSync(expiredExportFile, 'expired srt content');
  fs.utimesSync(expiredExportFile, twoHoursAgo / 1000, twoHoursAgo / 1000);

  // 2. Create an unexpired export file
  const recentExportFile = path.join(tempDir, `hs_test_recent_${now}.srt`);
  fs.writeFileSync(recentExportFile, 'recent srt content');
  fs.utimesSync(recentExportFile, thirtyMinsAgo / 1000, thirtyMinsAgo / 1000);

  // 3. Create an expired video translator file
  const expiredVideoSubFile = path.join(tempDir, `video_sub_test_expired_${now}.mp4`);
  fs.writeFileSync(expiredVideoSubFile, 'expired video sub content');
  fs.utimesSync(expiredVideoSubFile, twoHoursAgo / 1000, twoHoursAgo / 1000);

  // 4. Create an unexpired video translator file
  const recentVideoSubFile = path.join(tempDir, `video_sub_test_recent_${now}.mp4`);
  fs.writeFileSync(recentVideoSubFile, 'recent video sub content');
  fs.utimesSync(recentVideoSubFile, thirtyMinsAgo / 1000, thirtyMinsAgo / 1000);

  console.log('Running cleanExpiredTempFiles(3600 * 1000)...');
  const deletedCount = cleanExpiredTempFiles(3600 * 1000);

  const expiredExportExists = fs.existsSync(expiredExportFile);
  const recentExportExists = fs.existsSync(recentExportFile);
  const expiredVideoSubExists = fs.existsSync(expiredVideoSubFile);
  const recentVideoSubExists = fs.existsSync(recentVideoSubFile);

  // Cleanup test files if any remained
  if (recentExportExists) fs.unlinkSync(recentExportFile);
  if (recentVideoSubExists) fs.unlinkSync(recentVideoSubFile);
  if (expiredExportExists) fs.unlinkSync(expiredExportFile);
  if (expiredVideoSubExists) fs.unlinkSync(expiredVideoSubFile);

  console.assert(!expiredExportExists, 'Expired export file was not cleaned up!');
  console.assert(recentExportExists, 'Recent export file was incorrectly deleted!');
  console.assert(!expiredVideoSubExists, 'Expired video sub file was not cleaned up!');
  console.assert(recentVideoSubExists, 'Recent video sub file was incorrectly deleted!');
  console.assert(deletedCount >= 2, `Expected at least 2 deleted files, got ${deletedCount}`);

  console.log('✅ cleanExpiredTempFiles unit tests passed successfully!');
}

testTempCleaner();
