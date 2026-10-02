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
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { clearSessionCookies, readCookie, writeSessionCookies } from './auth.cookies.js';
import { AuthService } from './auth.service.js';
import { CurrentUser, type AuthenticatedUser } from './current-user.decorator.js';
import { requestMeta } from './request-meta.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
}
