import 'reflect-metadata';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  apiErrorBodySchema,
  livenessResponseSchema,
  readinessResponseSchema,
} from '@planit/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { APP_OPTIONS, configureApp } from '../src/bootstrap/configure-app.js';

describe('API foundation (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS);
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health reports liveness', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(livenessResponseSchema.parse(response.body).status).toBe('ok');
  });

  it('GET /api/health/ready reaches Postgres and Redis', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
    const body = readinessResponseSchema.parse(response.body);
    expect(body.status).toBe('ready');
    expect(body.checks.database.status).toBe('up');
    expect(body.checks.redis.status).toBe('up');
  });

  it('echoes a valid caller request ID and sets security headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .set('X-Request-Id', 'e2e-request-0001')
      .expect(200);
    expect(response.headers['x-request-id']).toBe('e2e-request-0001');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('returns the standard error envelope for unknown routes', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    const body = apiErrorBodySchema.parse(response.body);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(response.headers['x-request-id']);
    expect(JSON.stringify(body)).not.toContain('does-not-exist');
  });

  it('returns the standard error envelope for malformed JSON without parser details', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/anything')
      .set('Origin', 'http://localhost:3000')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);
    const body = apiErrorBodySchema.parse(response.body);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(body)).not.toMatch(/JSON at position|Unexpected/);
  });

  it('allows CORS only for configured origins', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const denied = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
