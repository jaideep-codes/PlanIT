import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { EmailQueueService } from '../../infrastructure/queue/email-queue.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { HibpPasswordBreachChecker } from './password-breach.js';
import { OtpRepository } from './otp.repository.js';
import { OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';
import { SessionGuard } from './session.guard.js';
import { SessionRepository } from './session.repository.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [
    HibpPasswordBreachChecker,
    PasswordService,
    AuthRateLimitService,
    AuthRepository,
    SessionRepository,
    OtpRepository,
    EmailQueueService,
    SessionService,
    OtpService,
    AuthService,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AuthModule {}
