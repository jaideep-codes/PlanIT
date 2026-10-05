import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fails when known secret patterns show up in git-tracked files, and (with
 * --require-bundle) in the production web client bundle. Prints the path and
 * the rule name, never the matched value.
 *
 * Clearly fake local placeholders are allowed:
 * - the three development keys in apps/api/.env.example (they decode to local-dev-*)
 * - postgres/redis URLs on localhost that use planit_dev_password or planit_dev_redis
 * - spec fixtures whose password is exactly secret, secret-password, or secret-redis
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireBundle = process.argv.includes('--require-bundle');

const FAKE_KEYS = {
  JWT_SIGNING_KEY: 'bG9jYWwtZGV2LWp3dC1zaWduaW5nLWtleS0zMmJ5dGU=',
  OTP_PEPPER: 'bG9jYWwtZGV2LW90cC1wZXBwZXItdmFsdWUtMzJieXQ=',
  OTP_JOB_ENCRYPTION_KEY: 'bG9jYWwtZGV2LW90cC1qb2Ita2V5LTMyLWJ5dGVzISE=',
};

const SECRET_NAMES = [
  'GOOGLE_CLIENT_SECRET',
  'JWT_SIGNING_KEY',
  'OTP_PEPPER',
  'OTP_JOB_ENCRYPTION_KEY',
  'SMTP_PASSWORD',
  'DATABASE_URL',
  'REDIS_URL',
];

const FAKE_TEST_PASSWORDS = new Set([
  'secret',
  'secret-password',
  'secret-redis',
  'planit_dev_password',
  'planit_dev_redis',
  'google-secret',
]);

const URL_PATTERN = /(?:postgres(?:ql)?|rediss?):\/\/[^\s'"<>)]+/g;
const PRIVATE_KEY = /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/;
const PUBLIC_SECRET_NAME =
  /NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|PEPPER|PRIVATE|API_KEY|CLIENT_SECRET)/;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

const findings = [];

function report(file, rule) {
  const relative = path.relative(repoRoot, file).split(path.sep).join('/');
  findings.push(`${relative}: ${rule}`);
}

function isTestFile(file) {
  return (
    /\.(spec|test)\.[cm]?[jt]sx?$/.test(file) ||
    file.includes(`${path.sep}test${path.sep}`) ||
    file.includes('/test/')
  );
}

function isJwt(token) {
  try {
    const header = Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8');
    return header.includes('"alg"');
  } catch {
    return false;
  }
}

function urlAllowed(rawUrl, file) {
  const cleaned = rawUrl.replace(/[,.;]+$/g, '');
  let parsed;
  try {
    parsed = new URL(cleaned);
  } catch {
    return false;
  }
  const password = decodeURIComponent(parsed.password);
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (
    local &&
    (password.length === 0 || password === 'planit_dev_password' || password === 'planit_dev_redis')
  ) {
    return true;
  }
  return isTestFile(file) && FAKE_TEST_PASSWORDS.has(password);
}

function assignmentAllowed(name, rawValue, file) {
  const value = rawValue.trim();
  if (value.length === 0) return true;
  if (isTestFile(file) && FAKE_TEST_PASSWORDS.has(value)) return true;
  if (name === 'GOOGLE_CLIENT_SECRET' || name === 'SMTP_PASSWORD') return false;
  if (Object.prototype.hasOwnProperty.call(FAKE_KEYS, name)) return FAKE_KEYS[name] === value;
  if (name === 'DATABASE_URL' || name === 'REDIS_URL') {
    if (urlAllowed(value, file)) return true;
    // Spec fixtures such as "not a url" or a passwordless mysql URL are not credentials.
    if (!isTestFile(file)) return false;
    const embedded = /:\/\/(?:[^@/\s]+):([^@/\s]+)@/.exec(value);
    return embedded?.[1] === undefined || FAKE_TEST_PASSWORDS.has(decodeURIComponent(embedded[1]));
  }
  return false;
}

function assignmentsOnLine(line) {
  const found = [];
  for (const name of SECRET_NAMES) {
    const quoted = new RegExp(String.raw`\b${name}\s*[:=]\s*(['"])(.*?)\1`).exec(line);
    if (quoted?.[2] !== undefined) {
      found.push([name, quoted[2]]);
      continue;
    }
    const bare = new RegExp(String.raw`(^|\s)${name}\s*=\s*(\S*)`).exec(line.trim());
    if (bare?.[2] !== undefined) found.push([name, bare[2]]);
  }
  return found;
}

function scanText(file, text) {
  if (PRIVATE_KEY.test(text)) report(file, 'private key');
  if (PUBLIC_SECRET_NAME.test(text)) report(file, 'NEXT_PUBLIC_ secret name');

  JWT_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(JWT_PATTERN)) {
    const token = match[0];
    if (token && isJwt(token)) report(file, 'JWT-like credential');
  }

  URL_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0];
    if (url && !urlAllowed(url, file)) report(file, 'database or redis URL');
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    for (const [name, value] of assignmentsOnLine(trimmed)) {
      if (!assignmentAllowed(name, value, file)) report(file, `unexpected ${name} value`);
    }
  }
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

function scanTrackedFiles() {
  const listed = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });
  const files = listed
    .toString('utf8')
    .split('\0')
    .filter((file) => file.length > 0);
  for (const relative of files) {
    if (relative === 'pnpm-lock.yaml') continue;
    if (/\.(png|ico|woff2|jpg|jpeg|gif|webp)$/i.test(relative)) continue;
    const absolute = path.join(repoRoot, relative);
    const info = statSync(absolute);
    if (!info.isFile() || info.size > 1_000_000) continue;
    const buffer = readFileSync(absolute);
    if (looksBinary(buffer)) continue;
    scanText(absolute, buffer.toString('utf8'));
  }
}

const BUNDLE_PATTERNS = [
  ['passwordHash', /passwordHash|password_hash/],
  ['GOOGLE_CLIENT_SECRET', /GOOGLE_CLIENT_SECRET/],
  ['OTP_PEPPER', /OTP_PEPPER/],
  ['OTP_JOB_ENCRYPTION_KEY', /OTP_JOB_ENCRYPTION_KEY/],
  ['JWT_SIGNING_KEY', /JWT_SIGNING_KEY/],
  ['DATABASE_URL', /DATABASE_URL/],
  ['dev database password', /planit_dev_password/],
  ['dev redis password', /planit_dev_redis/],
  ['argon2 hash', /\$argon2/],
  [
    'NEXT_PUBLIC_ secret',
    /NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|PEPPER|PRIVATE|API_KEY|CLIENT_SECRET)/,
  ],
];

function walk(directory, visit) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (entry.isFile()) visit(full);
  }
}

function scanBundle() {
  const bundleRoot = path.join(repoRoot, 'apps', 'web', '.next', 'static');
  let exists = false;
  try {
    exists = statSync(bundleRoot).isDirectory();
  } catch {
    exists = false;
  }
  if (!exists) {
    if (requireBundle) {
      report(bundleRoot, 'production client bundle is missing; run pnpm build first');
    }
    return;
  }
  walk(bundleRoot, (file) => {
    if (!file.endsWith('.js')) return;
    const text = readFileSync(file, 'utf8');
    for (const [rule, pattern] of BUNDLE_PATTERNS) {
      if (pattern.test(text)) report(file, rule);
    }
    JWT_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(JWT_PATTERN)) {
      const token = match[0];
      if (token && isJwt(token)) report(file, 'JWT-like credential');
    }
  });
}

scanTrackedFiles();
scanBundle();

if (findings.length > 0) {
  const unique = [...new Set(findings)];
  process.stderr.write(`secret scan failed (${unique.length})\n`);
  for (const finding of unique) process.stderr.write(`${finding}\n`);
  process.exitCode = 1;
} else {
  const scope = requireBundle ? 'tracked files and client bundle' : 'tracked files';
  process.stdout.write(`secret scan passed (${scope})\n`);
}
