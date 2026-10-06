import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  ACCESS_COOKIE_NAME,
  apiErrorBodySchema,
  recurringTaskListSchema,
  recurringTaskSchema,
  taskListSchema,
  taskOccurrenceListSchema,
  taskOccurrenceSchema,
  taskSchema,
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

const ORIGIN = 'http://localhost:3000';
const JOB_KEY = Buffer.from('bG9jYWwtZGV2LW90cC1qb2Ita2V5LTMyLWJ5dGVzISE=', 'base64');
const PASSWORD = `PlanIT-${randomUUID()}-battery`;

function errorOf(response: request.Response): { code: string; message: string } {
  return apiErrorBodySchema.parse(response.body).error;
}

function expectOwnerProjection(body: unknown): void {
  const json = JSON.stringify(body);
  expect(json).not.toMatch(/passwordHash|password_hash/);
  expect(json).not.toMatch(/"userId"/);
}

function setCookieLines(response: request.Response): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function cookieValue(response: request.Response, name: string): string {
  const line = setCookieLines(response).find((entry) => entry.startsWith(`${name}=`));
  if (!line) throw new Error(`Missing ${name} cookie`);
  const pair = line.split(';')[0] ?? '';
  return decodeURIComponent(pair.slice(name.length + 1));
}

async function readOtp(queue: Queue, email: string): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const jobs = await queue.getJobs(['waiting', 'delayed', 'paused', 'active']);
    for (const job of jobs) {
      let opened: { to: string; text: string };
      try {
        opened = openSealedPayload(JOB_KEY, job.data);
      } catch {
        continue;
      }
      if (opened.to !== email) continue;
      const code = opened.text.match(/\b(\d{6})\b/)?.[1];
      if (!code) continue;
      await job.remove();
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No verification email queued for ${email}`);
}

function client(app: NestExpressApplication, token?: string) {
  const server = request(app.getHttpServer());
  const withAuth = (req: request.Test, mutate: boolean) => {
    if (mutate) req.set('Origin', ORIGIN);
    if (token) req.set('Cookie', `${ACCESS_COOKIE_NAME}=${token}`);
    return req;
  };
  return {
    get: (path: string) => withAuth(server.get(path), false),
    post: (path: string) => withAuth(server.post(path), true),
    patch: (path: string) => withAuth(server.patch(path), true),
    delete: (path: string) => withAuth(server.delete(path), true),
  };
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

describe('recurring tasks (e2e)', () => {
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

  async function signIn(label: string): Promise<{ token: string; userId: string }> {
    const email = `${label}-${randomUUID()}@example.com`;
    await client(app).post('/api/v1/auth/signup').send({ email, password: PASSWORD }).expect(201);
    const code = await readOtp(queue, email);
    await client(app).post('/api/v1/auth/otp/verify').send({ email, code }).expect(200);
    const login = await client(app)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const user = await app.get(PrismaService).user.findUniqueOrThrow({ where: { email } });
    return { token: cookieValue(login, ACCESS_COOKIE_NAME), userId: user.id };
  }

  function dailyBody(title: string, startDate = utcToday()) {
    return { title, frequency: 'DAILY', interval: 1, startDate };
  }

  it('creates, lists, gets, patches, stops, and deletes a series', async () => {
    const owner = await signIn('series');
    const http = client(app, owner.token);
    const today = utcToday();
    const created = recurringTaskSchema.parse(
      (await http.post('/api/v1/recurring-tasks').send(dailyBody('  Standup  ')).expect(201)).body,
    );
    expectOwnerProjection(created);
    expect(created).toMatchObject({
      title: 'Standup',
      frequency: 'DAILY',
      interval: 1,
      enabled: true,
      startDate: today,
      endDate: null,
      timezone: 'UTC',
    });
    expect(created.recurrenceRule).toContain('WKST=MO');

    const second = recurringTaskSchema.parse(
      (await http.post('/api/v1/recurring-tasks').send(dailyBody('Later')).expect(201)).body,
    );
    const listed = recurringTaskListSchema.parse(
      (await http.get('/api/v1/recurring-tasks').expect(200)).body,
    );
    expect(listed.items.map((item) => item.id).slice(0, 2)).toEqual([second.id, created.id]);
    expectOwnerProjection(listed);

    const fetched = recurringTaskSchema.parse(
      (await http.get(`/api/v1/recurring-tasks/${created.id}`).expect(200)).body,
    );
    expect(fetched.title).toBe('Standup');

    const patched = recurringTaskSchema.parse(
      (
        await http
          .patch(`/api/v1/recurring-tasks/${created.id}`)
          .send({ title: 'Renamed' })
          .expect(200)
      ).body,
    );
    expect(patched.title).toBe('Renamed');
    const materialized = taskListSchema
      .parse((await http.get('/api/v1/tasks').query({ due: today, limit: '20' }).expect(200)).body)
      .items.find((item) => item.recurringTaskId === created.id);
    expect(materialized?.title).toBe('Standup');
    expect(materialized?.recurringTaskId).toBe(created.id);

    const stopped = recurringTaskSchema.parse(
      (await http.post(`/api/v1/recurring-tasks/${created.id}/stop`).send({}).expect(200)).body,
    );
    expect(stopped.enabled).toBe(false);
    expect(stopped.endDate === today || stopped.endDate === addDays(today, -1)).toBe(true);

    const removed = recurringTaskSchema.parse(
      (await http.delete(`/api/v1/recurring-tasks/${second.id}`).send({}).expect(200)).body,
    );
    expect(removed.id).toBe(second.id);
    expect(errorOf(await http.get(`/api/v1/recurring-tasks/${second.id}`).expect(404)).code).toBe(
      'NOT_FOUND',
    );

    const audits = await app.get(PrismaService).auditLog.findMany({
      where: {
        userId: owner.userId,
        action: { in: ['recurring_task.stopped', 'recurring_task.deleted'] },
      },
    });
    expect(audits.map((row) => row.action).sort()).toEqual([
      'recurring_task.deleted',
      'recurring_task.stopped',
    ]);
    expect(JSON.stringify(audits)).not.toMatch(/Standup|Renamed|Later|FREQ=/);
  });

  it('skips one date and detaches an edited date', async () => {
    const owner = await signIn('skip');
    const http = client(app, owner.token);
    const today = utcToday();
    const series = recurringTaskSchema.parse(
      (await http.post('/api/v1/recurring-tasks').send(dailyBody('Skip me')).expect(201)).body,
    );
    expect(
      errorOf(
        await http
          .post(`/api/v1/recurring-tasks/${series.id}/occurrences/2020-01-05/skip`)
          .send({})
          .expect(400),
      ).code,
    ).toBe('BAD_REQUEST');

    const skipped = taskOccurrenceSchema.parse(
      (
        await http
          .post(`/api/v1/recurring-tasks/${series.id}/occurrences/${today}/skip`)
          .send({})
          .expect(200)
      ).body,
    );
    expect(skipped).toMatchObject({ status: 'SKIPPED', taskId: null, occurrenceDate: today });
    const again = taskOccurrenceSchema.parse(
      (
        await http
          .post(`/api/v1/recurring-tasks/${series.id}/occurrences/${today}/skip`)
          .send({})
          .expect(200)
      ).body,
    );
    expect(again.id).toBe(skipped.id);
    const tasks = (await http.get('/api/v1/tasks').query({ due: today }).expect(200)).body as {
      items: Array<{ id: string }>;
    };
    expect(tasks.items).toEqual([]);

    const next = addDays(today, 1);
    const edited = taskSchema.parse(
      (
        await http
          .patch(`/api/v1/recurring-tasks/${series.id}/occurrences/${next}`)
          .send({ title: 'Just once' })
          .expect(200)
      ).body,
    );
    expect(edited).toMatchObject({ title: 'Just once', recurringTaskId: null, dueDate: next });
    await http
      .patch(`/api/v1/recurring-tasks/${series.id}`)
      .send({ title: 'Series changed' })
      .expect(200);
    const still = taskSchema.parse((await http.get(`/api/v1/tasks/${edited.id}`).expect(200)).body);
    expect(still.title).toBe('Just once');
    expect(still.recurringTaskId).toBeNull();
    expectOwnerProjection(skipped);
    expectOwnerProjection(edited);
  });

  it('completes and reopens a generated task and does not recreate a deleted one', async () => {
    const owner = await signIn('complete');
    const http = client(app, owner.token);
    const today = utcToday();
    const series = recurringTaskSchema.parse(
      (await http.post('/api/v1/recurring-tasks').send(dailyBody('Finish')).expect(201)).body,
    );
    const range = taskOccurrenceListSchema.parse(
      (
        await http
          .get(`/api/v1/recurring-tasks/${series.id}/occurrences`)
          .query({ from: today, to: addDays(today, 2) })
          .expect(200)
      ).body,
    );
    const open = range.items.find((item) => item.occurrenceDate === today);
    const later = range.items.find((item) => item.occurrenceDate === addDays(today, 1));
    expect(open?.taskId).toEqual(expect.any(String));
    expect(later?.taskId).toEqual(expect.any(String));

    await http.post(`/api/v1/tasks/${open?.taskId}/complete`).send({}).expect(200);
    const completed = taskOccurrenceSchema.parse(
      rangeAfter(await readRange(http, series.id, today, today), today),
    );
    expect(completed.status).toBe('COMPLETED');
    await http.post(`/api/v1/tasks/${open?.taskId}/reopen`).send({}).expect(200);
    const reopened = taskOccurrenceSchema.parse(
      rangeAfter(await readRange(http, series.id, today, today), today),
    );
    expect(reopened.status).toBe('MATERIALIZED');

    await http.delete(`/api/v1/tasks/${later?.taskId}`).send({}).expect(200);
    const gone = taskOccurrenceSchema.parse(
      rangeAfter(
        await readRange(http, series.id, addDays(today, 1), addDays(today, 1)),
        addDays(today, 1),
      ),
    );
    expect(gone).toMatchObject({ status: 'SKIPPED', taskId: null });
    const listed = (
      await http
        .get('/api/v1/tasks')
        .query({ due: addDays(today, 1) })
        .expect(200)
    ).body as { items: unknown[] };
    expect(listed.items).toEqual([]);
    const stillGone = taskOccurrenceSchema.parse(
      rangeAfter(
        await readRange(http, series.id, addDays(today, 1), addDays(today, 1)),
        addDays(today, 1),
      ),
    );
    expect(stillGone).toEqual(gone);
  });

  it('hides another user and rejects userId plus a range longer than 62 days', async () => {
    const owner = await signIn('owner');
    const other = await signIn('other');
    const today = utcToday();
    const series = recurringTaskSchema.parse(
      (
        await client(app, owner.token)
          .post('/api/v1/recurring-tasks')
          .send(dailyBody('Private'))
          .expect(201)
      ).body,
    );
    const foreign = client(app, other.token);
    const paths = [
      () => foreign.get(`/api/v1/recurring-tasks/${series.id}`),
      () => foreign.patch(`/api/v1/recurring-tasks/${series.id}`).send({ title: 'Nope' }),
      () => foreign.delete(`/api/v1/recurring-tasks/${series.id}`).send({}),
      () => foreign.post(`/api/v1/recurring-tasks/${series.id}/stop`).send({}),
      () => foreign.post(`/api/v1/recurring-tasks/${series.id}/occurrences/${today}/skip`).send({}),
      () =>
        foreign
          .patch(`/api/v1/recurring-tasks/${series.id}/occurrences/${today}`)
          .send({ title: 'Nope' }),
      () =>
        foreign
          .get(`/api/v1/recurring-tasks/${series.id}/occurrences`)
          .query({ from: today, to: today }),
    ];
    for (const call of paths) {
      const response = await call();
      expect(response.status).toBe(404);
      expect(errorOf(response).code).toBe('NOT_FOUND');
      expectOwnerProjection(response.body);
    }

    const http = client(app, owner.token);
    expect(
      errorOf(
        await http
          .post('/api/v1/recurring-tasks')
          .send({ ...dailyBody('Nope'), userId: owner.userId })
          .expect(400),
      ).code,
    ).toBe('VALIDATION_ERROR');
    expect(
      errorOf(
        await http
          .patch(`/api/v1/recurring-tasks/${series.id}`)
          .send({ title: 'Nope', userId: owner.userId })
          .expect(400),
      ).code,
    ).toBe('VALIDATION_ERROR');
    expect(
      errorOf(
        await http
          .get(`/api/v1/recurring-tasks/${series.id}/occurrences`)
          .query({ from: '2026-01-01', to: '2026-06-01' })
          .expect(400),
      ).code,
    ).toBe('VALIDATION_ERROR');
  });
});

function rangeAfter(body: { items: Array<{ occurrenceDate: string }> }, date: string) {
  const row = body.items.find((item) => item.occurrenceDate === date);
  if (!row) throw new Error(`Missing occurrence ${date}`);
  return row;
}

async function readRange(
  http: ReturnType<typeof client>,
  seriesId: string,
  from: string,
  to: string,
) {
  const response = await http
    .get(`/api/v1/recurring-tasks/${seriesId}/occurrences`)
    .query({ from, to })
    .expect(200);
  return taskOccurrenceListSchema.parse(response.body);
}
