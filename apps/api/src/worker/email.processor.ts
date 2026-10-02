import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import type { Env } from '../config/env.js';
import { SmtpMailer } from '../infrastructure/mail/smtp-mailer.js';
import { openSealedPayload } from '../infrastructure/queue/sealed-payload.js';

@Injectable()
export class EmailProcessor {
  private readonly key: Buffer;

  constructor(
    config: ConfigService<Env, true>,
    private readonly mailer: SmtpMailer,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(EmailProcessor.name);
    this.key = Buffer.from(config.get('OTP_JOB_ENCRYPTION_KEY', { infer: true }), 'base64');
  }

  async process(data: unknown, meta: { id?: string; attemptsMade: number }): Promise<void> {
    const message = openSealedPayload(this.key, data);
    await this.mailer.send(message);
    this.logger.info(
      { jobId: meta.id, queue: 'email', attempt: meta.attemptsMade + 1 },
      'Sent transactional email',
    );
  }
}
