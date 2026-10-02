import { Module } from '@nestjs/common';

import { SmtpMailer } from './smtp-mailer.js';

@Module({
  providers: [SmtpMailer],
  exports: [SmtpMailer],
})
export class MailModule {}
