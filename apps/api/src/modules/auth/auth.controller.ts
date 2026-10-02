import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ACCESS_COOKIE_NAME,
  emptyRequestSchema,
  ERROR_CODES,
  loginRequestSchema,
  otpResendRequestSchema,
  otpVerifyRequestSchema,
  passwordForgotRequestSchema,
  passwordResetRequestSchema,
  REFRESH_COOKIE_NAME,
  sessionIdSchema,
  signupRequestSchema,
  type LoginRequest,
  type OtpResendRequest,
  type OtpVerifyRequest,
  type PasswordForgotRequest,
  type PasswordResetRequest,
  type SignupRequest,
} from '@planit/shared';
import type { AuthAcknowledgement, AuthSessionList, SessionRevocation } from '@planit/types';
import type { Request, Response } from 'express';

import { Public } from '../../common/auth/public.decorator.js';
import { AppException } from '../../common/errors/app.exception.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { GOOGLE_UNAVAILABLE_MESSAGE } from './auth.constants.js';
import {
  clearOAuthStateCookie,
  clearSessionCookies,
  OAUTH_STATE_COOKIE_NAME,
  readCookie,
  writeOAuthStateCookie,
  writeSessionCookies,
} from './auth.cookies.js';
import { AuthService } from './auth.service.js';
import { CurrentUser, type AuthenticatedUser } from './current-user.decorator.js';
import { GoogleOAuthService, GoogleSignInException } from './google-oauth.service.js';
import { requestMeta } from './request-meta.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleOAuthService,
  ) {}

  @Public()
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  signup(
    @Body(new ZodValidationPipe(signupRequestSchema)) body: SignupRequest,
    @Req() req: Request,
  ): Promise<AuthAcknowledgement> {
    return this.auth.signup(body, requestMeta(req));
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  verify(
    @Body(new ZodValidationPipe(otpVerifyRequestSchema)) body: OtpVerifyRequest,
    @Req() req: Request,
  ): Promise<AuthAcknowledgement> {
    return this.auth.verifyEmail(body, requestMeta(req));
  }

  @Public()
  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  resend(
    @Body(new ZodValidationPipe(otpResendRequestSchema)) body: OtpResendRequest,
    @Req() req: Request,
  ): Promise<AuthAcknowledgement> {
    return this.auth.resend(body, requestMeta(req));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthAcknowledgement> {
    const session = await this.auth.login(body, requestMeta(req));
    writeSessionCookies(response, session);
    return { status: 'authenticated' };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(emptyRequestSchema)) _body: Record<string, never>,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthAcknowledgement> {
    const session = await this.auth.refresh(
      readCookie(req.headers.cookie, REFRESH_COOKIE_NAME),
      requestMeta(req),
    );
    writeSessionCookies(response, session);
    return { status: 'authenticated' };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body(new ZodValidationPipe(emptyRequestSchema)) _body: Record<string, never>,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthAcknowledgement> {
    await this.auth.logout(
      {
        refresh: readCookie(req.headers.cookie, REFRESH_COOKIE_NAME),
        access: readCookie(req.headers.cookie, ACCESS_COOKIE_NAME),
      },
      requestMeta(req),
    );
    clearSessionCookies(response);
    return { status: 'logged_out' };
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  forgotPassword(
    @Body(new ZodValidationPipe(passwordForgotRequestSchema)) body: PasswordForgotRequest,
    @Req() req: Request,
  ): Promise<AuthAcknowledgement> {
    return this.auth.requestPasswordReset(body, requestMeta(req));
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body(new ZodValidationPipe(passwordResetRequestSchema)) body: PasswordResetRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthAcknowledgement> {
    await this.auth.resetPassword(body, requestMeta(req));
    clearSessionCookies(response);
    return { status: 'password_reset' };
  }

  @Get('sessions')
  listSessions(@CurrentUser() user: AuthenticatedUser): Promise<AuthSessionList> {
    return this.auth.listSessions(user.id, user.sessionId);
  }

  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  revokeOtherSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(emptyRequestSchema)) _body: Record<string, never>,
    @Req() req: Request,
  ): Promise<SessionRevocation> {
    return this.auth.revokeOtherSessions(user.id, user.sessionId, requestMeta(req));
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(sessionIdSchema)) sessionId: string,
    @Body(new ZodValidationPipe(emptyRequestSchema)) _body: Record<string, never>,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionRevocation> {
    const result = await this.auth.revokeSession(
      user.id,
      sessionId,
      user.sessionId,
      requestMeta(req),
    );
    if (result.currentSessionRevoked) clearSessionCookies(response);
    return result;
  }

  @Public()
  @Get('google/start')
  async googleStart(@Req() req: Request, @Res() response: Response): Promise<void> {
    if (acceptsAvailability(req)) {
      response.status(HttpStatus.OK).json({ available: this.google.isConfigured() });
      return;
    }
    if (!this.google.isConfigured()) {
      throw new AppException(
        ERROR_CODES.SERVICE_UNAVAILABLE,
        GOOGLE_UNAVAILABLE_MESSAGE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const started = await this.google.begin(requestMeta(req));
    writeOAuthStateCookie(response, started.stateHash);
    response.redirect(HttpStatus.FOUND, started.url);
  }

  @Public()
  @Get('google/callback')
  async googleCallback(@Req() req: Request, @Res() response: Response): Promise<void> {
    const stateCookie = readCookie(req.headers.cookie, OAUTH_STATE_COOKIE_NAME);
    if (stateCookie) clearOAuthStateCookie(response);
    try {
      const session = await this.google.complete(req.query, stateCookie, requestMeta(req));
      writeSessionCookies(response, session);
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.redirect(HttpStatus.SEE_OTHER, this.google.successUrl());
    } catch (error) {
      if (error instanceof GoogleSignInException && this.google.isConfigured()) {
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.redirect(HttpStatus.SEE_OTHER, this.google.failureUrl(error.reason));
        return;
      }
      throw error;
    }
  }
}

/** A JSON client is asking whether Google is configured. A browser navigation is not. */
function acceptsAvailability(req: Request): boolean {
  const header = req.headers.accept;
  if (typeof header !== 'string') return false;
  const types = header.split(',').map((part) => part.split(';')[0]?.trim().toLowerCase());
  return types.includes('application/json') && !types.includes('text/html');
}
