import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// nest start --watch compiles src/worker.ts into dist. Wait for that file, then run it
// under node --watch so the worker restarts when the API compiler rewrites dist.
const entry = new URL('../dist/worker.js', import.meta.url);
while (!existsSync(entry)) {
  await delay(300);
}

const child = spawn(process.execPath, ['--watch-path=dist', 'dist/worker.js'], {
  stdio: 'inherit',
  cwd: new URL('..', import.meta.url),
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
