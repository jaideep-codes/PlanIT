import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import type { Env } from '../../config/env.js';
import type { OutboundEmail } from '../mail/mailer.js';
import {
  EMAIL_BACKOFF_MS,
  EMAIL_JOB_ATTEMPTS,
  EMAIL_QUEUE,
  FAILED_JOB_AGE_SECONDS,
} from './queue.constants.js';
import { sealPayload } from './sealed-payload.js';

/**
 * Producer only. The worker process consumes the queue. Payloads are sealed before they
 * touch Redis, and completed jobs are removed so the ciphertext does not linger.
 */
@Injectable()
export class EmailQueueService implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue;
  private readonly key: Buffer;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(EmailQueueService.name);
    this.key = Buffer.from(config.get('OTP_JOB_ENCRYPTION_KEY', { infer: true }), 'base64');
    this.connection = new Redis(config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.queue = new Queue(EMAIL_QUEUE, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: EMAIL_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: EMAIL_BACKOFF_MS },
        removeOnComplete: true,
        removeOnFail: { age: FAILED_JOB_AGE_SECONDS },
      },
    });
  }

  async enqueue(jobId: string, message: OutboundEmail): Promise<void> {
    const sealed = sealPayload(this.key, message);
    await this.queue.add('send', sealed, { jobId });
    this.logger.info({ jobId, queue: EMAIL_QUEUE }, 'Queued transactional email');
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    try {
      await this.connection.quit();
    } catch {
      this.connection.disconnect();
    }
  }
}
