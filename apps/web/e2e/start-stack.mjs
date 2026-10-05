import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Browser tests talk to the web origin only. This process starts the API, the email
// worker, and Next against the test database (planit_test) and Redis database 2.
// NODE_ENV=test makes the API ignore apps/api/.env, so a configured Google secret in
// that file cannot turn the button on. Keep the local URLs in sync with global-setup.ts.

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(webRoot, '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://planit:planit_dev_password@127.0.0.1:5432/planit_test';
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://:planit_dev_redis@127.0.0.1:6379/2';

function apiEnv() {
  return {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '4000',
    LOG_LEVEL: 'warn',
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    WEB_ORIGINS: 'http://localhost:3000',
    TRUST_PROXY: 'false',
    JWT_SIGNING_KEY: 'bG9jYWwtZGV2LWp3dC1zaWduaW5nLWtleS0zMmJ5dGU=',
    OTP_PEPPER: 'bG9jYWwtZGV2LW90cC1wZXBwZXItdmFsdWUtMzJieXQ=',
    OTP_JOB_ENCRYPTION_KEY: 'bG9jYWwtZGV2LW90cC1qb2Ita2V5LTMyLWJ5dGVzISE=',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_REDIRECT_URI: '',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '1025',
    SMTP_FROM: 'PlanIT <noreply@planit.local>',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
  };
}

function webEnv() {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    API_INTERNAL_URL: 'http://127.0.0.1:4000',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  delete env.GOOGLE_CLIENT_ID;
  delete env.GOOGLE_CLIENT_SECRET;
  delete env.GOOGLE_REDIRECT_URI;
  delete env.JWT_SIGNING_KEY;
  delete env.OTP_PEPPER;
  delete env.OTP_JOB_ENCRYPTION_KEY;
  delete env.DATABASE_URL;
  delete env.REDIS_URL;
  delete env.SMTP_PASSWORD;
  return env;
}

const children = [];
let stopping = false;

function killChild(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  child.kill('SIGTERM');
}

function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children) killChild(child);
  if (process.platform === 'win32') {
    process.exit(exitCode);
    return;
  }
  setTimeout(() => process.exit(exitCode), 500);
}

function start(args, cwd, env, name) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => {
    process.stderr.write(`${name} failed to start: ${error.message}\n`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    process.stderr.write(`${name} exited (${signal ?? code ?? 0})\n`);
    stop(1);
  });
}

function runOrExit(args, cwd, env, label) {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) {
    process.stderr.write(`${label} failed\n`);
    process.exit(result.status ?? 1);
  }
}

function portInUse(port, host) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    let settled = false;
    const finish = (used) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(used);
    };
    socket.setTimeout(1_000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function waitForOk(url, label) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await delay(300);
  }
  process.stderr.write(`${label} did not become ready\n`);
  stop(1);
  await new Promise(() => {});
}

process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));

const webBusy = await portInUse(3000, 'localhost');
const apiBusy = await portInUse(4000, '127.0.0.1');
if (webBusy || apiBusy) {
  process.stderr.write(
    'Port 3000 or 4000 is already in use. Stop pnpm dev, or set PLAYWRIGHT_REUSE_SERVER=1 when those processes are the browser-test stack (planit_test, Redis database 2, Mailpit).\n',
  );
  process.exit(1);
}

const prisma = path.join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js');
const nest = path.join(apiRoot, 'node_modules', '@nestjs', 'cli', 'bin', 'nest.js');
const nextBin = path.join(webRoot, 'node_modules', 'next', 'dist', 'bin', 'next');

runOrExit([prisma, 'generate'], apiRoot, process.env, 'Prisma generate');
runOrExit([nest, 'build'], apiRoot, process.env, 'API build');

const env = apiEnv();
start([path.join(apiRoot, 'dist', 'main.js')], apiRoot, env, 'API');
start([path.join(apiRoot, 'dist', 'worker.js')], apiRoot, env, 'email worker');
await waitForOk('http://127.0.0.1:4000/api/health', 'API');
start([nextBin, 'dev', '--port', '3000', '--hostname', 'localhost'], webRoot, webEnv(), 'web');
await new Promise(() => {});
