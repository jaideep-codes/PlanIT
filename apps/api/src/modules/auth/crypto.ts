import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { ACCESS_TTL_SECONDS } from './auth.constants.js';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** HMAC-SHA256(pepper, code), hex-encoded. The raw code is never stored. */
export function otpCodeHash(pepper: Buffer, code: string): string {
  return createHmac('sha256', pepper).update(code, 'utf8').digest('hex');
}

export function otpMatches(pepper: Buffer, code: string, codeHashHex: string): boolean {
  const actual = Buffer.from(otpCodeHash(pepper, code), 'hex');
  const expected = Buffer.from(codeHashHex, 'hex');
  if (expected.length !== actual.length) {
    timingSafeEqual(actual, actual);
    return false;
  }
  return timingSafeEqual(actual, expected);
}

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Time-ordered UUID v7, used for refresh-token families (session ids come from Postgres). */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(now);
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  const byte6 = bytes[6] ?? 0;
  const byte8 = bytes[8] ?? 0;
  bytes[6] = (byte6 & 0x0f) | 0x70;
  bytes[8] = (byte8 & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface AccessClaims {
  sub: string;
  sid: string;
  exp: number;
}

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** HS256 JWT whose payload is exactly `{ sub, sid, exp }`. */
export function signAccessToken(
  key: Buffer,
  claims: { sub: string; sid: string },
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({
    sub: claims.sub,
    sid: claims.sid,
    exp: nowSeconds + ACCESS_TTL_SECONDS,
  });
  const signingInput = `${header}.${payload}`;
  const signature = createHmac('sha256', key).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function verifyAccessToken(
  key: Buffer,
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): AccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const headerPart = parts[0];
  const payloadPart = parts[1];
  const signaturePart = parts[2];
  if (!headerPart || !payloadPart || !signaturePart) return null;

  const expected = createHmac('sha256', key)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64url');
  const actualBuf = Buffer.from(signaturePart);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf))
    return null;

  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isRecord(header) || header.alg !== 'HS256') return null;
  if (!isRecord(payload)) return null;
  const keys = Object.keys(payload).sort();
  if (keys.join(',') !== 'exp,sid,sub') return null;
  const { sub, sid, exp } = payload;
  if (typeof sub !== 'string' || sub.length === 0) return null;
  if (typeof sid !== 'string' || sid.length === 0) return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= nowSeconds) return null;
  return { sub, sid, exp };
}

/** HMAC-SHA256(pepper, `ip:` + address). Domain-separated from OTP codes. */
export function hashIp(pepper: Buffer, ip: string): string {
  return createHmac('sha256', pepper).update(`ip:${ip}`, 'utf8').digest('hex');
}
