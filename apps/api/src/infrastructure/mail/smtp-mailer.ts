import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { PinoLogger } from 'nestjs-pino';

import type { Env } from '../../config/env.js';
import type { Mailer, OutboundEmail } from './mailer.js';

@Injectable()
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(SmtpMailer.name);
    const user = config.get('SMTP_USER', { infer: true });
    const pass = config.get('SMTP_PASSWORD', { infer: true });
    this.from = config.get('SMTP_FROM', { infer: true });
    this.transport = nodemailer.createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      secure: config.get('SMTP_PORT', { infer: true }) === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  async send(message: OutboundEmail): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message.replace(/\d{6}/g, '******') : 'send failed';
      this.logger.error({ reason }, 'Transactional email failed');
      throw new Error('Transactional email failed');
    }
  }
}
