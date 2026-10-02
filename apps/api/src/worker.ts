import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'nestjs-pino';

import type { Env } from './config/env.js';
import { EMAIL_QUEUE, MAINTENANCE_QUEUE } from './infrastructure/queue/queue.constants.js';
import { EmailProcessor } from './worker/email.processor.js';
import { OtpCleanupProcessor } from './worker/otp-cleanup.processor.js';
import { WorkerModule } from './worker.module.js';

function connection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const logger = app.get(Logger);
  const redisUrl = app
    .get<ConfigService<Env, true>>(ConfigService)
    .get('REDIS_URL', { infer: true });

  const emailProcessor = app.get(EmailProcessor);
  const cleanup = app.get(OtpCleanupProcessor);

  const emailWorker = new Worker(
    EMAIL_QUEUE,
    (job) => emailProcessor.process(job.data, { id: job.id, attemptsMade: job.attemptsMade }),
    { connection: connection(redisUrl), concurrency: 5 },
  );
  const maintenanceWorker = new Worker(MAINTENANCE_QUEUE, () => cleanup.process(), {
    connection: connection(redisUrl),
  });
  const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection: connection(redisUrl) });

  const logFailure =
    (queue: string) => (job: { id?: string; attemptsMade?: number } | undefined, error: Error) => {
      const reason = /\d{6}/.test(error.message) ? 'job failed' : error.message;
      logger.error({ jobId: job?.id, queue, attempt: job?.attemptsMade, reason }, 'Job failed');
    };
  emailWorker.on('failed', logFailure(EMAIL_QUEUE));
  maintenanceWorker.on('failed', logFailure(MAINTENANCE_QUEUE));

  await maintenanceQueue.upsertJobScheduler(
    'otp-cleanup',
    { pattern: '15 * * * *' },
    { name: 'delete-expired-otps', data: {} },
  );
  await cleanup.process();

  logger.log('PlanIT worker started', 'Bootstrap');

  const shutdown = async () => {
    await emailWorker.close();
    await maintenanceWorker.close();
    await maintenanceQueue.close();
    await app.close();
  };
  process.once('SIGINT', () => {
    void shutdown().then(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().then(() => process.exit(0));
  });
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `PlanIT worker failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
