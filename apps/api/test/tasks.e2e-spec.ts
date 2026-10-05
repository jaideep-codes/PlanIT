import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  ACCESS_COOKIE_NAME,
  apiErrorBodySchema,
  currentUserSchema,
  taskListSchema,
  taskSchema,
} from '@planit/shared';
import type { Task } from '@planit/types';
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
const TASK_KEYS = [
  'id',
  'title',
  'notes',
  'priority',
  'status',
  'dueDate',
  'scheduledStart',
  'scheduledEnd',
  'estimatedMinutes',
  'completedAt',
  'sortOrder',
  'createdAt',
  'updatedAt',
] as const;

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

describe('one-off tasks (e2e)', () => {
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

  async function signIn(label: string): Promise<{ token: string; email: string; userId: string }> {
    const email = `${label}-${randomUUID()}@example.com`;
    await client(app).post('/api/v1/auth/signup').send({ email, password: PASSWORD }).expect(201);
    const code = await readOtp(queue, email);
    await client(app).post('/api/v1/auth/otp/verify').send({ email, code }).expect(200);
    const login = await client(app)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const user = await app.get(PrismaService).user.findUniqueOrThrow({ where: { email } });
    return { token: cookieValue(login, ACCESS_COOKIE_NAME), email, userId: user.id };
  }

  it('rejects unauthenticated task requests', async () => {
    const id = '01990000-0000-7000-8000-000000000099';
    const anon = client(app);
    for (const response of [
      await anon.get('/api/v1/tasks'),
      await anon.post('/api/v1/tasks').send({ title: 'Plan' }),
      await anon.get(`/api/v1/tasks/${id}`),
      await anon.patch(`/api/v1/tasks/${id}`).send({ title: 'Plan' }),
      await anon.delete(`/api/v1/tasks/${id}`).send({}),
      await anon.post(`/api/v1/tasks/${id}/complete`).send({}),
      await anon.post(`/api/v1/tasks/${id}/reopen`).send({}),
      await anon.patch(`/api/v1/tasks/${id}/position`).send({ beforeId: id }),
    ]) {
      expect(response.status).toBe(401);
      expect(errorOf(response).code).toBe('UNAUTHENTICATED');
      expectOwnerProjection(response.body);
    }
  });

  it('creates, reads, updates, lists, and deletes a task', async () => {
    const owner = await signIn('crud');
    const http = client(app, owner.token);
    const created = await http
      .post('/api/v1/tasks')
      .send({ title: '  Write the API  ', notes: '  details  ' })
      .expect(201);
    const task = taskSchema.parse(created.body);
    expect(Object.keys(task).sort()).toEqual([...TASK_KEYS].sort());
    expect(task).toMatchObject({
      title: 'Write the API',
      notes: 'details',
      priority: 'MEDIUM',
      status: 'TODO',
      dueDate: null,
      scheduledStart: null,
      scheduledEnd: null,
      estimatedMinutes: null,
      completedAt: null,
    });
    expectOwnerProjection(created.body);

    const fetched = await http.get(`/api/v1/tasks/${task.id}`).expect(200);
    expect(fetched.body).toEqual(created.body);

    const patched = await http
      .patch(`/api/v1/tasks/${task.id}`)
      .send({
        title: 'Updated',
        notes: '   ',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        dueDate: '2026-10-06',
        estimatedMinutes: 25,
        scheduledStart: '2026-10-06T09:00:00.000Z',
        scheduledEnd: '2026-10-06T10:00:00.000Z',
      })
      .expect(200);
    expect(taskSchema.parse(patched.body)).toMatchObject({
      title: 'Updated',
      notes: null,
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      dueDate: '2026-10-06',
      estimatedMinutes: 25,
      scheduledStart: '2026-10-06T09:00:00.000Z',
      scheduledEnd: '2026-10-06T10:00:00.000Z',
      completedAt: null,
    });
    expectOwnerProjection(patched.body);

    const listed = taskListSchema.parse((await http.get('/api/v1/tasks').expect(200)).body);
    expect(listed.items.map((item) => item.id)).toContain(task.id);
    expect(listed.nextCursor).toBeNull();

    const removed = await http.delete(`/api/v1/tasks/${task.id}`).send({}).expect(200);
    expect(taskSchema.parse(removed.body).id).toBe(task.id);
    expect(errorOf(await http.get(`/api/v1/tasks/${task.id}`).expect(404)).code).toBe('NOT_FOUND');

    const prisma = app.get(PrismaService);
    const audits = await prisma.auditLog.findMany({
      where: { userId: owner.userId, targetId: task.id, action: 'task.deleted' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toEqual({});
    expect(audits[0]?.targetType).toBe('task');
    expect(JSON.stringify(audits)).not.toContain('Updated');
    expect(JSON.stringify(audits)).not.toContain('details');
  });

  it('completes idempotently, reopens only from completed, and rejects completion through PATCH', async () => {
    const owner = await signIn('complete');
    const http = client(app, owner.token);
    const task = taskSchema.parse(
      (await http.post('/api/v1/tasks').send({ title: 'Finish' }).expect(201)).body,
    );

    const rejected = await http
      .patch(`/api/v1/tasks/${task.id}`)
      .send({ status: 'COMPLETED' })
      .expect(400);
    expect(errorOf(rejected).code).toBe('VALIDATION_ERROR');
    expect(taskSchema.parse((await http.get(`/api/v1/tasks/${task.id}`)).body).status).toBe('TODO');

    const completed = taskSchema.parse(
      (await http.post(`/api/v1/tasks/${task.id}/complete`).send({}).expect(200)).body,
    );
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).toEqual(expect.any(String));
    const again = taskSchema.parse(
      (await http.post(`/api/v1/tasks/${task.id}/complete`).send({}).expect(200)).body,
    );
    expect(again).toEqual(completed);

    const prisma = app.get(PrismaService);
    const completedAudits = await prisma.auditLog.findMany({
      where: { userId: owner.userId, targetId: task.id, action: 'task.completed' },
    });
    expect(completedAudits).toHaveLength(1);
    expect(completedAudits[0]?.metadata).toEqual({ previousStatus: 'TODO' });
    expect(JSON.stringify(completedAudits)).not.toContain('Finish');

    const reopened = taskSchema.parse(
      (await http.post(`/api/v1/tasks/${task.id}/reopen`).send({}).expect(200)).body,
    );
    expect(reopened.status).toBe('TODO');
    expect(reopened.completedAt).toBeNull();
    const reopenAudits = await prisma.auditLog.findMany({
      where: { userId: owner.userId, targetId: task.id, action: 'task.reopened' },
    });
    expect(reopenAudits).toHaveLength(1);
    expect(reopenAudits[0]?.metadata).toEqual({});

    const conflict = await http.post(`/api/v1/tasks/${task.id}/reopen`).send({}).expect(409);
    expect(errorOf(conflict).code).toBe('CONFLICT');
    expect(
      await prisma.auditLog.count({
        where: { userId: owner.userId, targetId: task.id, action: 'task.reopened' },
      }),
    ).toBe(1);

    const cancelled = taskSchema.parse(
      (await http.patch(`/api/v1/tasks/${task.id}`).send({ status: 'CANCELLED' }).expect(200)).body,
    );
    expect(cancelled.status).toBe('CANCELLED');
    const fromCancelled = taskSchema.parse(
      (await http.post(`/api/v1/tasks/${task.id}/complete`).send({}).expect(200)).body,
    );
    expect(fromCancelled.status).toBe('COMPLETED');
    const cancelledAudit = await prisma.auditLog.findFirst({
      where: {
        userId: owner.userId,
        targetId: task.id,
        action: 'task.completed',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(cancelledAudit?.metadata).toEqual({ previousStatus: 'CANCELLED' });

    const progress = taskSchema.parse(
      (await http.patch(`/api/v1/tasks/${task.id}`).send({ status: 'IN_PROGRESS' }).expect(200))
        .body,
    );
    expect(progress.status).toBe('IN_PROGRESS');
    expect(progress.completedAt).toBeNull();
    expect(
      errorOf(await http.post(`/api/v1/tasks/${task.id}/reopen`).send({}).expect(409)).code,
    ).toBe('CONFLICT');
  });

  it('filters, uses the saved sort, paginates, and moves a task between two neighbors', async () => {
    const owner = await signIn('list');
    const http = client(app, owner.token);
    const make = async (body: Record<string, unknown>) =>
      taskSchema.parse((await http.post('/api/v1/tasks').send(body).expect(201)).body);

    const low = await make({
      title: 'Low',
      priority: 'LOW',
      dueDate: '2026-10-01',
      scheduledStart: '2026-10-01T08:00:00.000Z',
      scheduledEnd: '2026-10-01T09:00:00.000Z',
    });
    const high = await make({
      title: 'High',
      priority: 'HIGH',
      dueDate: '2026-10-02',
      scheduledStart: '2026-10-02T08:00:00.000Z',
      scheduledEnd: '2026-10-02T09:00:00.000Z',
    });
    const front = await make({ title: 'Front', priority: 'HIGH', dueDate: '2026-10-01' });

    const manual = async () =>
      taskListSchema
        .parse((await http.get('/api/v1/tasks').query({ sort: 'manual' }).expect(200)).body)
        .items.map((item) => item.id);
    expect(await manual()).toEqual([front.id, high.id, low.id]);

    const defaultOrder = taskListSchema.parse((await http.get('/api/v1/tasks').expect(200)).body);
    expect(defaultOrder.items.map((item) => item.id)).toEqual([front.id, high.id, low.id]);

    const prisma = app.get(PrismaService);
    await prisma.userPreference.update({
      where: { userId: owner.userId },
      data: { defaultTaskSort: 'PRIORITY' },
    });
    const byPreference = taskListSchema.parse((await http.get('/api/v1/tasks').expect(200)).body);
    expect(byPreference.items.map((item) => item.id)).toEqual([high.id, front.id, low.id]);
    expect(await manual()).toEqual([front.id, high.id, low.id]);

    const oldestFirst = taskListSchema.parse(
      (await http.get('/api/v1/tasks').query({ sort: 'createdAt' }).expect(200)).body,
    );
    expect(oldestFirst.items.map((item) => item.id)).toEqual([low.id, high.id, front.id]);

    await http.post(`/api/v1/tasks/${front.id}/complete`).send({}).expect(200);
    const open = taskListSchema.parse(
      (await http.get('/api/v1/tasks').query({ status: 'TODO', sort: 'createdAt' }).expect(200))
        .body,
    );
    expect(open.items.map((item) => item.id)).toEqual([low.id, high.id]);
    const both = taskListSchema.parse(
      (
        await http
          .get('/api/v1/tasks')
          .query({ status: ['TODO', 'COMPLETED'], sort: 'createdAt' })
          .expect(200)
      ).body,
    );
    expect(both.items.map((item) => item.id)).toEqual([low.id, high.id, front.id]);
    const due = taskListSchema.parse(
      (await http.get('/api/v1/tasks').query({ due: '2026-10-01', sort: 'createdAt' }).expect(200))
        .body,
    );
    expect(due.items.map((item) => item.id)).toEqual([low.id, front.id]);
    const highs = taskListSchema.parse(
      (await http.get('/api/v1/tasks').query({ priority: 'HIGH', sort: 'createdAt' }).expect(200))
        .body,
    );
    expect(highs.items.map((item) => item.id)).toEqual([high.id, front.id]);
    const scheduled = taskListSchema.parse(
      (
        await http
          .get('/api/v1/tasks')
          .query({
            scheduledFrom: '2026-10-02T08:00:00.000Z',
            scheduledTo: '2026-10-02T08:00:00.000Z',
          })
          .expect(200)
      ).body,
    );
    expect(scheduled.items.map((item) => item.id)).toEqual([high.id]);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: Task[]; nextCursor: string | null } = taskListSchema.parse(
        (
          await http
            .get('/api/v1/tasks')
            .query({ limit: '1', sort: 'createdAt', ...(cursor ? { cursor } : {}) })
            .expect(200)
        ).body,
      );
      expect(page.items).toHaveLength(1);
      const item = page.items[0];
      if (!item) throw new Error('Missing page item');
      seen.push(item.id);
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([low.id, high.id, front.id]);

    expect(
      errorOf(await http.get('/api/v1/tasks').query({ cursor: 'not-a-cursor' }).expect(400)).code,
    ).toBe('BAD_REQUEST');
    const foreignCursor = oldestFirst.nextCursor;
    expect(foreignCursor).toBeNull();
    const encoded = taskListSchema.parse(
      (await http.get('/api/v1/tasks').query({ limit: '1', sort: 'createdAt' }).expect(200)).body,
    ).nextCursor;
    expect(encoded).toEqual(expect.any(String));
    expect(
      errorOf(
        await http.get('/api/v1/tasks').query({ cursor: encoded, sort: 'manual' }).expect(400),
      ).code,
    ).toBe('BAD_REQUEST');

    const moved = taskSchema.parse(
      (
        await http
          .patch(`/api/v1/tasks/${low.id}/position`)
          .send({ beforeId: front.id, afterId: high.id })
          .expect(200)
      ).body,
    );
    expect(moved.sortOrder > front.sortOrder && moved.sortOrder < high.sortOrder).toBe(true);
    expect(await manual()).toEqual([front.id, low.id, high.id]);

    const spare = await make({ title: 'Spare', priority: 'LOW', dueDate: '2026-10-03' });
    expect(
      errorOf(
        await http
          .patch(`/api/v1/tasks/${high.id}/position`)
          .send({ beforeId: spare.id, afterId: low.id })
          .expect(400),
      ).code,
    ).toBe('BAD_REQUEST');
    expect(await manual()).toEqual([spare.id, front.id, low.id, high.id]);
  });

  it('returns 404 for another user, including position neighbors, and rejects bad writes', async () => {
    const owner = await signIn('owner');
    const other = await signIn('other');
    const ownerHttp = client(app, owner.token);
    const otherHttp = client(app, other.token);
    const task = taskSchema.parse(
      (await ownerHttp.post('/api/v1/tasks').send({ title: 'Mine' }).expect(201)).body,
    );
    const foreign = taskSchema.parse(
      (await otherHttp.post('/api/v1/tasks').send({ title: 'Theirs' }).expect(201)).body,
    );

    const missing = `/api/v1/tasks/${task.id}`;
    for (const response of [
      await otherHttp.get(missing),
      await otherHttp.patch(missing).send({ title: 'Stolen' }),
      await otherHttp.delete(missing).send({}),
      await otherHttp.post(`${missing}/complete`).send({}),
      await otherHttp.post(`${missing}/reopen`).send({}),
      await otherHttp.patch(`${missing}/position`).send({ beforeId: foreign.id }),
    ]) {
      expect(response.status).toBe(404);
      expect(errorOf(response).code).toBe('NOT_FOUND');
      expectOwnerProjection(response.body);
    }
    expect(
      errorOf(
        await ownerHttp.patch(`${missing}/position`).send({ beforeId: foreign.id }).expect(404),
      ).code,
    ).toBe('NOT_FOUND');
    expect(
      errorOf(
        await ownerHttp.patch(`${missing}/position`).send({ afterId: foreign.id }).expect(404),
      ).code,
    ).toBe('NOT_FOUND');
    expect(taskSchema.parse((await ownerHttp.get(missing).expect(200)).body).title).toBe('Mine');

    const planted = '01990000-0000-7000-8000-000000000077';
    const withUser = await ownerHttp
      .post('/api/v1/tasks')
      .send({ title: 'Nope', userId: planted, passwordHash: 'secret' })
      .expect(400);
    expect(errorOf(withUser).code).toBe('VALIDATION_ERROR');
    expectOwnerProjection(withUser.body);
    expect(JSON.stringify(withUser.body)).not.toContain(planted);

    expect(
      errorOf(await ownerHttp.get('/api/v1/tasks').query({ userId: planted }).expect(400)).code,
    ).toBe('VALIDATION_ERROR');
    expect(
      errorOf(
        await ownerHttp
          .post('/api/v1/tasks')
          .send({ title: 'Half', scheduledStart: '2026-10-05T09:00:00.000Z' })
          .expect(400),
      ).code,
    ).toBe('VALIDATION_ERROR');
    expect(
      errorOf(
        await ownerHttp
          .post('/api/v1/tasks')
          .send({
            title: 'Backwards',
            scheduledStart: '2026-10-05T10:00:00.000Z',
            scheduledEnd: '2026-10-05T09:00:00.000Z',
          })
          .expect(400),
      ).code,
    ).toBe('VALIDATION_ERROR');
    expect(
      errorOf(
        await ownerHttp
          .post('/api/v1/tasks')
          .send({ title: 'Zero', estimatedMinutes: 0 })
          .expect(400),
      ).code,
    ).toBe('VALIDATION_ERROR');
    expect(
      errorOf(
        await ownerHttp
          .post('/api/v1/tasks')
          .send({ title: 'Huge', estimatedMinutes: 10081 })
          .expect(400),
      ).code,
    ).toBe('VALIDATION_ERROR');
    expect(errorOf(await ownerHttp.get('/api/v1/tasks/not-a-uuid').expect(400)).code).toBe(
      'VALIDATION_ERROR',
    );

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .set('Content-Type', 'application/json')
      .set('Cookie', `${ACCESS_COOKIE_NAME}=${owner.token}`)
      .send({ title: 'No origin' })
      .expect(403);
    expect(errorOf(blocked).code).toBe('FORBIDDEN');
  });

  it('rejects rows that violate the schedule or estimate checks', async () => {
    const owner = await signIn('checks');
    const prisma = app.get(PrismaService);
    await expect(
      prisma.task.create({
        data: {
          userId: owner.userId,
          title: 'Bad estimate',
          sortOrder: 'a0',
          estimatedMinutes: 0,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.task.create({
        data: {
          userId: owner.userId,
          title: 'Bad schedule',
          sortOrder: 'a1',
          scheduledStart: new Date('2026-10-05T10:00:00.000Z'),
          scheduledEnd: new Date('2026-10-05T09:00:00.000Z'),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.task.create({
        data: {
          userId: owner.userId,
          title: 'Completed without a time',
          sortOrder: 'a2',
          status: 'COMPLETED',
        },
      }),
    ).rejects.toThrow();
    expect(await prisma.task.count({ where: { userId: owner.userId } })).toBe(0);
  });

  it('saves defaultTaskSort and lists without sort use it', async () => {
    const anon = await client(app)
      .patch('/api/v1/users/me/task-sort')
      .send({ defaultTaskSort: 'priority' })
      .expect(401);
    expect(errorOf(anon).code).toBe('UNAUTHENTICATED');
    expectOwnerProjection(anon.body);

    const owner = await signIn('sort-pref');
    const http = client(app, owner.token);
    const me = currentUserSchema.parse((await http.get('/api/v1/users/me').expect(200)).body);
    expect(me.defaultTaskSort).toBe('manual');
    expectOwnerProjection(me);

    const make = async (body: Record<string, unknown>) =>
      taskSchema.parse((await http.post('/api/v1/tasks').send(body).expect(201)).body);
    const high = await make({ title: 'High', priority: 'HIGH' });
    const low = await make({ title: 'Low', priority: 'LOW' });

    const manual = taskListSchema.parse((await http.get('/api/v1/tasks').expect(200)).body);
    expect(manual.items.map((item) => item.id)).toEqual([low.id, high.id]);

    const rejectedProfile = await http
      .patch('/api/v1/users/me')
      .send({ displayName: 'Ada', defaultTaskSort: 'priority' })
      .expect(400);
    expect(errorOf(rejectedProfile).code).toBe('VALIDATION_ERROR');
    const rejectedTheme = await http
      .patch('/api/v1/users/me/theme')
      .send({ theme: 'dark', defaultTaskSort: 'priority' })
      .expect(400);
    expect(errorOf(rejectedTheme).code).toBe('VALIDATION_ERROR');
    const rejectedDirection = await http
      .patch('/api/v1/users/me/task-sort')
      .send({ defaultTaskSort: '-priority' })
      .expect(400);
    expect(errorOf(rejectedDirection).code).toBe('VALIDATION_ERROR');

    const saved = currentUserSchema.parse(
      (
        await http
          .patch('/api/v1/users/me/task-sort')
          .send({ defaultTaskSort: 'priority' })
          .expect(200)
      ).body,
    );
    expect(saved.defaultTaskSort).toBe('priority');
    expect(saved.theme).toBe('system');
    expectOwnerProjection(saved);

    const byPreference = taskListSchema.parse((await http.get('/api/v1/tasks').expect(200)).body);
    expect(byPreference.items.map((item) => item.id)).toEqual([high.id, low.id]);

    const prisma = app.get(PrismaService);
    await prisma.userPreference.delete({ where: { userId: owner.userId } });
    const missing = currentUserSchema.parse((await http.get('/api/v1/users/me').expect(200)).body);
    expect(missing.defaultTaskSort).toBe('manual');
    const fallback = taskListSchema.parse((await http.get('/api/v1/tasks').expect(200)).body);
    expect(fallback.items.map((item) => item.id)).toEqual([low.id, high.id]);
  });
});
