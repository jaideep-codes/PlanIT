import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  ACCESS_COOKIE_NAME,
  apiErrorBodySchema,
  authSessionListSchema,
  currentUserSchema,
  REFRESH_COOKIE_NAME,
} from '@planit/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { APP_OPTIONS, configureApp } from '../src/bootstrap/configure-app.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { EMAIL_QUEUE } from '../src/infrastructure/queue/queue.constants.js';
import { openSealedPayload } from '../src/infrastructure/queue/sealed-payload.js';
import { OtpRepository } from '../src/modules/auth/otp.repository.js';
import { otpDeletionCutoff } from '../src/modules/auth/otp-retention.js';

const ORIGIN = 'http://localhost:3000';
const JOB_KEY = Buffer.from('bG9jYWwtZGV2LW90cC1qb2Ita2V5LTMyLWJ5dGVzISE=', 'base64');
const PASSWORD = `PlanIT-${randomUUID()}-battery`;

function post(app: NestExpressApplication, path: string) {
  return request(app.getHttpServer()).post(path).set('Origin', ORIGIN);
}

function setCookieLines(response: request.Response): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function cookieValue(response: request.Response, name: string): string | undefined {
  const line = setCookieLines(response).find((entry) => entry.startsWith(`${name}=`));
  if (!line) return undefined;
  const pair = line.split(';')[0] ?? '';
  return decodeURIComponent(pair.slice(name.length + 1));
}

function errorOf(response: request.Response): {
  code: string;
  message: string;
  requestId?: string;
} {
  return apiErrorBodySchema.parse(response.body).error;
}

function expectNoSecrets(body: unknown, ...secrets: string[]) {
  const json = JSON.stringify(body);
  expect(json).not.toMatch(/passwordHash|password_hash|\$argon2/i);
  for (const secret of secrets) {
    if (secret) expect(json).not.toContain(secret);
  }
}

async function readOtp(queue: Queue, email: string, includes?: string): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const jobs = await queue.getJobs(['waiting', 'delayed', 'paused', 'active']);
    for (const job of jobs) {
      const serialized = JSON.stringify(job.data);
      expect(serialized).not.toContain('@');
      let opened: { to: string; text: string };
      try {
        opened = openSealedPayload(JOB_KEY, job.data);
      } catch {
        continue;
      }
      if (opened.to !== email) continue;
      expect(opened.text).not.toMatch(/https?:\/\//);
      if (includes && !opened.text.toLowerCase().includes(includes)) continue;
      const code = opened.text.match(/\b(\d{6})\b/)?.[1];
      expect(code).toBeTruthy();
      await job.remove();
      return code ?? '';
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No verification email queued for ${email}`);
}

describe('credential auth (e2e)', () => {
  let app: NestExpressApplication;
  let queue: Queue;
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL ?? '', { maxRetriesPerRequest: null });
    const rateKeys = await redis.keys('rl:auth:*');
    const throttleKeys = await redis.keys('throttle:*');
    const stale = [...rateKeys, ...throttleKeys];
    if (stale.length > 0) await redis.del(...stale);

    queue = new Queue(EMAIL_QUEUE, { connection: redis });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS);
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await queue.close();
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
  });

  it('signs up, rejects a bad or unverified login, then verifies', async () => {
    const email = `ada-${randomUUID()}@example.com`;
    const signup = await post(app, '/api/v1/auth/signup')
      .send({ email, password: PASSWORD })
      .expect(201);
    expect(signup.body).toEqual({ status: 'verification_required' });
    expectNoSecrets(signup.body);

    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUnique({
      where: { email },
      include: { preference: true, plan: true },
    });
    expect(user?.emailVerifiedAt).toBeNull();
    expect(user?.preference?.theme).toBe('SYSTEM');
    expect(user?.plan?.plan).toBe('FREE');
    expect(user?.passwordHash?.startsWith('$argon2id$')).toBe(true);

    const wrong = await post(app, '/api/v1/auth/login')
      .send({ email, password: `${PASSWORD}-wrong` })
      .expect(401);
    const wrongError = errorOf(wrong);
    expect(wrongError.code).toBe('UNAUTHENTICATED');
    expect(wrongError.message).toBe('Invalid email or password.');
    expect(typeof wrongError.requestId).toBe('string');
    expectNoSecrets(wrong.body);

    const unknown = await post(app, '/api/v1/auth/login')
      .send({ email: `missing-${randomUUID()}@example.com`, password: PASSWORD })
      .expect(401);
    expect(errorOf(unknown).message).toBe(errorOf(wrong).message);

    const unverified = await post(app, '/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(403);
    expect(errorOf(unverified).code).toBe('FORBIDDEN');
    expect(errorOf(unverified).message).toBe('Verify your email before signing in.');
    expect(setCookieLines(unverified)).toHaveLength(0);
    expectNoSecrets(unverified.body, user?.passwordHash ?? '');

    const code = await readOtp(queue, email);
    const verified = await post(app, '/api/v1/auth/otp/verify').send({ email, code }).expect(200);
    expect(verified.body).toEqual({ status: 'verified' });
    expectNoSecrets(verified.body, code);
  });

  it('locks a code after five wrong attempts, including the real code', async () => {
    const email = `otp-${randomUUID()}@example.com`;
    await post(app, '/api/v1/auth/signup').send({ email, password: PASSWORD }).expect(201);
    const code = await readOtp(queue, email);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await post(app, '/api/v1/auth/otp/verify')
        .send({ email, code: '000000' })
        .expect(400);
      expect(errorOf(wrong).message).toBe('Invalid or expired code.');
      expectNoSecrets(wrong.body);
    }

    const limited = await post(app, '/api/v1/auth/otp/verify').send({ email, code }).expect(429);
    expect(errorOf(limited).code).toBe('RATE_LIMITED');
    expect(errorOf(limited).message).toBe('Too many attempts. Request a new code.');
    expect(limited.headers['retry-after']).toBeTruthy();
    expectNoSecrets(limited.body, code);
  });

  it('rotates refresh tokens, revokes the family on reuse, and logs out one session only', async () => {
    const email = `session-${randomUUID()}@example.com`;
    await post(app, '/api/v1/auth/signup').send({ email, password: PASSWORD }).expect(201);
    const code = await readOtp(queue, email);
    await post(app, '/api/v1/auth/otp/verify').send({ email, code }).expect(200);

    const first = await post(app, '/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    expect(first.body).toEqual({ status: 'authenticated' });
    const firstRefresh = cookieValue(first, REFRESH_COOKIE_NAME);
    const firstAccess = cookieValue(first, ACCESS_COOKIE_NAME);
    expect(firstRefresh).toBeTruthy();
    expect(firstAccess).toBeTruthy();
    expectNoSecrets(first.body, firstRefresh ?? '', firstAccess ?? '');

    const accessLine =
      setCookieLines(first).find((line) => line.startsWith(`${ACCESS_COOKIE_NAME}=`)) ?? '';
    const refreshLine =
      setCookieLines(first).find((line) => line.startsWith(`${REFRESH_COOKIE_NAME}=`)) ?? '';
    expect(accessLine).toMatch(/HttpOnly/i);
    expect(accessLine).toMatch(/Secure/i);
    expect(accessLine).toMatch(/SameSite=Lax/i);
    expect(accessLine).toMatch(/Path=\/(;|$)/);
    expect(accessLine).not.toMatch(/Domain=/i);
    expect(refreshLine).toMatch(/Path=\/api\/v1\/auth/);
    expect(refreshLine).toMatch(/HttpOnly/i);
    expect(refreshLine).toMatch(/Secure/i);
    expect(refreshLine).not.toMatch(/Domain=/i);

    const second = await post(app, '/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const secondRefresh = cookieValue(second, REFRESH_COOKIE_NAME);
    expect(secondRefresh).toBeTruthy();
    expect(secondRefresh).not.toBe(firstRefresh);

    const loggedOut = await post(app, '/api/v1/auth/logout')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${firstRefresh}`)
      .send({})
      .expect(200);
    expect(loggedOut.body).toEqual({ status: 'logged_out' });
    expectNoSecrets(loggedOut.body, firstRefresh ?? '');

    const firstAfterLogout = await post(app, '/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${firstRefresh}`)
      .send({})
      .expect(401);
    expectNoSecrets(firstAfterLogout.body);

    const secondStillWorks = await post(app, '/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${secondRefresh}`)
      .send({})
      .expect(200);
    const rotated = cookieValue(secondStillWorks, REFRESH_COOKIE_NAME);
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(secondRefresh);
    expectNoSecrets(secondStillWorks.body, rotated ?? '', secondRefresh ?? '');

    const reused = await post(app, '/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${secondRefresh}`)
      .send({})
      .expect(401);
    expect(errorOf(reused).code).toBe('UNAUTHENTICATED');

    await post(app, '/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${rotated}`)
      .send({})
      .expect(401);
  });

  it('rejects a state-changing request with the wrong origin', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'ada@example.com', password: PASSWORD })
      .expect(403);
    expect(errorOf(response).code).toBe('FORBIDDEN');
    expectNoSecrets(response.body, PASSWORD);
  });

  it('does not echo passwordHash or token fields from any auth response', async () => {
    const email = `leak-${randomUUID()}@example.com`;
    const planted = '$argon2id$v=19$planted-hash';
    const extra = await post(app, '/api/v1/auth/signup')
      .send({ email, password: PASSWORD, passwordHash: planted, refreshToken: 'refresh-planted' })
      .expect(400);
    expect(errorOf(extra).code).toBe('VALIDATION_ERROR');
    expectNoSecrets(extra.body, planted, PASSWORD, 'refresh-planted');
    expect(JSON.stringify(extra.body)).not.toContain('refreshToken');
  });

  it('logout revokes the live session when the refresh cookie was already rotated', async () => {
    const email = `logout-${randomUUID()}@example.com`;
    await post(app, '/api/v1/auth/signup').send({ email, password: PASSWORD }).expect(201);
    const code = await readOtp(queue, email);
    await post(app, '/api/v1/auth/otp/verify').send({ email, code }).expect(200);

    const login = await post(app, '/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const oldRefresh = cookieValue(login, REFRESH_COOKIE_NAME);
    const rotated = await post(app, '/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${oldRefresh}`)
      .send({})
      .expect(200);
    const newRefresh = cookieValue(rotated, REFRESH_COOKIE_NAME);
    const newAccess = cookieValue(rotated, ACCESS_COOKIE_NAME);
    expect(newRefresh).toBeTruthy();
    expect(newAccess).toBeTruthy();

    const loggedOut = await post(app, '/api/v1/auth/logout')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${oldRefresh}; ${ACCESS_COOKIE_NAME}=${newAccess}`)
      .send({})
      .expect(200);
    expect(loggedOut.body).toEqual({ status: 'logged_out' });
    expectNoSecrets(loggedOut.body, oldRefresh ?? '', newRefresh ?? '', newAccess ?? '', code);

    await post(app, '/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${newRefresh}`)
      .send({})
      .expect(401);
  });

  it('deletes OTP rows only after expiry plus 24 hours and keeps the audit log append-only', async () => {
    const prisma = app.get(PrismaService);
    const otps = app.get(OtpRepository);
    const hash = 'ab'.repeat(32);
    const staleEmail = `stale-${randomUUID()}@example.com`;
    const freshEmail = `fresh-${randomUUID()}@example.com`;
    await prisma.emailOtp.create({
      data: {
        email: staleEmail,
        purpose: 'EMAIL_VERIFICATION',
        codeHash: hash,
        expiresAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });
    await prisma.emailOtp.create({
      data: {
        email: freshEmail,
        purpose: 'PASSWORD_RESET',
        codeHash: hash,
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    await otps.deleteExpiredBefore(otpDeletionCutoff(new Date()));
    expect(await prisma.emailOtp.findFirst({ where: { email: staleEmail } })).toBeNull();
    expect(await prisma.emailOtp.findFirst({ where: { email: freshEmail } })).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({ orderBy: { createdAt: 'desc' } });
    expect(audit).toBeTruthy();
    await expect(
      prisma.auditLog.update({ where: { id: audit?.id }, data: { action: 'tamper' } }),
    ).rejects.toThrow(/append-only/);
    expect(audit?.ipHash === null || /^[a-f0-9]{64}$/.test(audit?.ipHash ?? '')).toBe(true);
  });

  async function signIn(email: string): Promise<{ access: string; refresh: string }> {
    await post(app, '/api/v1/auth/signup').send({ email, password: PASSWORD }).expect(201);
    const code = await readOtp(queue, email);
    await post(app, '/api/v1/auth/otp/verify').send({ email, code }).expect(200);
    const login = await post(app, '/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return {
      access: cookieValue(login, ACCESS_COOKIE_NAME) ?? '',
      refresh: cookieValue(login, REFRESH_COOKIE_NAME) ?? '',
    };
  }

  it('resets a password, revokes every session, and answers unknown emails the same way', async () => {
    const email = `reset-${randomUUID()}@example.com`;
    const nextPassword = `PlanIT-${randomUUID()}-reset`;
    const first = await signIn(email);
    const second = await post(app, '/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const secondRefresh = cookieValue(second, REFRESH_COOKIE_NAME) ?? '';

    const forgot = await post(app, '/api/v1/auth/password/forgot').send({ email }).expect(200);
    expect(forgot.body).toEqual({ status: 'reset_requested' });
    const code = await readOtp(queue, email, 'password reset');
    expectNoSecrets(forgot.body, code, PASSWORD);

    const cooled = await post(app, '/api/v1/auth/password/forgot').send({ email }).expect(429);
    expect(errorOf(cooled).message).toBe('Wait a moment before requesting another code.');

    const unknownEmail = `missing-${randomUUID()}@example.com`;
    const unknown = await post(app, '/api/v1/auth/password/forgot')
      .send({ email: unknownEmail })
      .expect(200);
    expect(unknown.body).toEqual(forgot.body);
    const unknownAgain = await post(app, '/api/v1/auth/password/forgot')
      .send({ email: unknownEmail })
      .expect(429);
    expect(errorOf(unknownAgain).message).toBe(errorOf(cooled).message);
    expectNoSecrets(unknownAgain.body, unknownEmail);

    const weak = await post(app, '/api/v1/auth/password/reset')
      .send({ email, code, password: 'correct-horse', passwordHash: 'nope' })
      .expect(400);
    expect(errorOf(weak).code).toBe('VALIDATION_ERROR');
    expectNoSecrets(weak.body, code, PASSWORD);

    const reset = await post(app, '/api/v1/auth/password/reset')
      .send({ email, code, password: nextPassword })
      .expect(200);
    expect(reset.body).toEqual({ status: 'password_reset' });
    expectNoSecrets(reset.body, code, PASSWORD, nextPassword);

    await post(app, '/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${first.refresh}`)
      .send({})
      .expect(401);
    await post(app, '/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${secondRefresh}`)
      .send({})
      .expect(401);
    await post(app, '/api/v1/auth/login').send({ email, password: PASSWORD }).expect(401);
    const again = await post(app, '/api/v1/auth/login')
      .send({ email, password: nextPassword })
      .expect(200);
    expect(again.body).toEqual({ status: 'authenticated' });

    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUnique({ where: { email } });
    const audits = await prisma.auditLog.findMany({ where: { userId: user?.id ?? '' } });
    const actions = audits.map((row) => row.action);
    expect(actions).toContain('auth.password_reset_requested');
    expect(actions).toContain('auth.password_reset');
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain(code);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(nextPassword);
    expect(serialized).not.toContain(email);
    const resetAudit = audits.find((row) => row.action === 'auth.password_reset');
    expect(resetAudit?.metadata).toMatchObject({ sessionsRevoked: 2 });
  });

  it('locks a password reset code after five wrong attempts', async () => {
    const email = `reset-otp-${randomUUID()}@example.com`;
    const nextPassword = `PlanIT-${randomUUID()}-reset`;
    await signIn(email);
    await post(app, '/api/v1/auth/password/forgot').send({ email }).expect(200);
    const code = await readOtp(queue, email, 'password reset');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await post(app, '/api/v1/auth/password/reset')
        .send({ email, code: '000000', password: nextPassword })
        .expect(400);
      expect(errorOf(wrong).message).toBe('Invalid or expired code.');
      expectNoSecrets(wrong.body, code, nextPassword);
    }

    const limited = await post(app, '/api/v1/auth/password/reset')
      .send({ email, code, password: nextPassword })
      .expect(429);
    expect(errorOf(limited).code).toBe('RATE_LIMITED');
    expect(errorOf(limited).message).toBe('Too many attempts. Request a new code.');
    expect(limited.headers['retry-after']).toBeTruthy();
    expectNoSecrets(limited.body, code, nextPassword);
  });

  it('omits passwordHash, keeps theme across a new session, and returns 404 for another user', async () => {
    const email = `owner-${randomUUID()}@example.com`;
    const otherEmail = `other-${randomUUID()}@example.com`;
    const first = await signIn(email);
    const second = await post(app, '/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const secondAccess = cookieValue(second, ACCESS_COOKIE_NAME) ?? '';
    const secondRefresh = cookieValue(second, REFRESH_COOKIE_NAME) ?? '';
    const other = await signIn(otherEmail);

    const me = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', `${ACCESS_COOKIE_NAME}=${secondAccess}`)
      .expect(200);
    const meBody = currentUserSchema.parse(me.body);
    expect(meBody.email).toBe(email);
    expect(meBody.theme).toBe('system');
    expectNoSecrets(me.body, PASSWORD);

    const rejected = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Origin', ORIGIN)
      .set('Cookie', `${ACCESS_COOKIE_NAME}=${secondAccess}`)
      .send({
        displayName: 'Ada',
        timezone: 'UTC',
        passwordHash: 'x',
        userId: otherEmail,
        theme: 'dark',
      })
      .expect(400);
    expect(errorOf(rejected).code).toBe('VALIDATION_ERROR');
    expectNoSecrets(rejected.body, PASSWORD);

    const profile = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Origin', ORIGIN)
      .set('Cookie', `${ACCESS_COOKIE_NAME}=${secondAccess}`)
      .send({ displayName: 'Ada Lovelace', timezone: 'Asia/Kolkata' })
      .expect(200);
    expect(currentUserSchema.parse(profile.body)).toMatchObject({
      email,
      displayName: 'Ada Lovelace',
      timezone: 'Asia/Kolkata',
      theme: 'system',
    });
    expectNoSecrets(profile.body);

    const themed = await request(app.getHttpServer())
      .patch('/api/v1/users/me/theme')
      .set('Origin', ORIGIN)
      .set('Cookie', `${ACCESS_COOKIE_NAME}=${secondAccess}`)
      .send({ theme: 'dark' })
      .expect(200);
    expect(currentUserSchema.parse(themed.body).theme).toBe('dark');
    expectNoSecrets(themed.body);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Cookie', `${ACCESS_COOKIE_NAME}=${secondAccess}`)
      .expect(200);
    const sessions = authSessionListSchema.parse(listed.body);
    expect(sessions.items.some((item) => item.current)).toBe(true);
    const foreignId = sessions.items.find((item) => !item.current)?.id;
    expect(foreignId).toBeTruthy();
    expect(JSON.stringify(listed.body)).not.toMatch(/refreshToken|passwordHash|tokenHash/i);

    const hidden = await request(app.getHttpServer())
      .delete(`/api/v1/auth/sessions/${foreignId ?? ''}`)
      .set('Origin', ORIGIN)
      .set('Cookie', `${ACCESS_COOKIE_NAME}=${other.access}`)
      .send({})
      .expect(404);
    expect(errorOf(hidden).code).toBe('NOT_FOUND');

    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', `${ACCESS_COOKIE_NAME}=${first.access}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/sessions/revoke-others')
      .set('Origin', ORIGIN)
      .set('Cookie', `${ACCESS_COOKIE_NAME}=${secondAccess}`)
      .send({})
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', `${ACCESS_COOKIE_NAME}=${first.access}`)
      .expect(401);

    const stillHere = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', `${ACCESS_COOKIE_NAME}=${secondAccess}`)
      .expect(200);
    expect(currentUserSchema.parse(stillHere.body).theme).toBe('dark');

    await post(app, '/api/v1/auth/logout')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${secondRefresh}`)
      .send({})
      .expect(200);
    const fresh = await post(app, '/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const freshAccess = cookieValue(fresh, ACCESS_COOKIE_NAME) ?? '';
    const persisted = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', `${ACCESS_COOKIE_NAME}=${freshAccess}`)
      .expect(200);
    expect(currentUserSchema.parse(persisted.body)).toMatchObject({
      theme: 'dark',
      displayName: 'Ada Lovelace',
    });
    expectNoSecrets(persisted.body);

    await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
  });

  it('does not simulate Google sign-in when credentials are absent', async () => {
    const availability = await request(app.getHttpServer())
      .get('/api/v1/auth/google/start')
      .set('Accept', 'application/json')
      .expect(200);
    expect(availability.body).toEqual({ available: false });
    expect(setCookieLines(availability)).toHaveLength(0);

    const start = await request(app.getHttpServer())
      .get('/api/v1/auth/google/start')
      .set('Accept', 'text/html')
      .expect(503);
    expect(errorOf(start).code).toBe('SERVICE_UNAVAILABLE');
    expect(errorOf(start).message).toBe('Google sign-in is not configured.');
    expect(start.headers.location).toBeUndefined();
    expect(setCookieLines(start)).toHaveLength(0);

    const code = `google-code-${randomUUID()}`;
    const callback = await request(app.getHttpServer())
      .get('/api/v1/auth/google/callback')
      .query({ code, state: 'a'.repeat(43) })
      .expect(503);
    expect(errorOf(callback).message).toBe('Google sign-in is not configured.');
    expect(callback.headers.location).toBeUndefined();
    expect(setCookieLines(callback)).toHaveLength(0);
    expectNoSecrets(callback.body, code);
  });
});
