#!/usr/bin/env node
/**
 * Pre-push quality gate. Run manually with `npm run gate` or automatically
 * via the pre-push hook (see .githooks/ — activate with
 * `git config core.hooksPath .githooks`).
 */
import { spawnSync } from 'node:child_process';

function run(label, cmd, args) {
  process.stdout.write(`[gate] ${label}...\n`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) {
    process.stdout.write(`\n❌ [pre-push] Quality Gate ไม่ผ่าน (${label}) — push ถูกบล็อก\n`);
    process.exit(res.status ?? 1);
  }
}

run('typecheck (tsc --noEmit)', 'npx', ['tsc', '--noEmit']);
run('lint', 'npm', ['run', 'lint']);
run('tests', 'npm', ['test']);

process.stdout.write('✅ [pre-push] Quality Gate ผ่าน — push ได้!\n');
