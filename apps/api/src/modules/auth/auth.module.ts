import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import type { Env } from '../../config/env.js';
import { EmailQueueService } from '../../infrastructure/queue/email-queue.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { GOOGLE_IDENTITY_EXCHANGE, GoogleOAuthHttpClient } from './google-oauth.client.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { GOOGLE_OAUTH_SETTINGS, googleOAuthSettings } from './google-oauth.settings.js';
import { GOOGLE_OAUTH_STATE_STORE, RedisGoogleOAuthStateStore } from './google-oauth.state.js';
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
    {
      provide: GOOGLE_OAUTH_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        googleOAuthSettings({
          GOOGLE_CLIENT_ID: config.get('GOOGLE_CLIENT_ID', { infer: true }),
          GOOGLE_CLIENT_SECRET: config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
          GOOGLE_REDIRECT_URI: config.get('GOOGLE_REDIRECT_URI', { infer: true }),
          WEB_ORIGINS: config.get('WEB_ORIGINS', { infer: true }),
        }),
    },
    GoogleOAuthHttpClient,
    { provide: GOOGLE_IDENTITY_EXCHANGE, useExisting: GoogleOAuthHttpClient },
    RedisGoogleOAuthStateStore,
    { provide: GOOGLE_OAUTH_STATE_STORE, useExisting: RedisGoogleOAuthStateStore },
    GoogleOAuthService,
    AuthService,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AuthModule {}
