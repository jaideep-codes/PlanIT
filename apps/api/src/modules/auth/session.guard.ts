import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ACCESS_COOKIE_NAME, ERROR_CODES } from '@planit/shared';
import type { Request } from 'express';

import { IS_PUBLIC } from '../../common/auth/public.decorator.js';
import { AppException } from '../../common/errors/app.exception.js';
import { VERIFY_EMAIL_MESSAGE } from './auth.constants.js';
import { readCookie } from './auth.cookies.js';
import { SessionService } from './session.service.js';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; sessionId: string };
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readCookie(request.headers.cookie, ACCESS_COOKIE_NAME);
    if (!token) {
      throw new AppException(
        ERROR_CODES.UNAUTHENTICATED,
        'Authentication is required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const result = await this.sessions.authenticate(token);
    if (result === 'unverified') {
      throw new AppException(ERROR_CODES.FORBIDDEN, VERIFY_EMAIL_MESSAGE, HttpStatus.FORBIDDEN);
    }
    if (!result) {
      throw new AppException(
        ERROR_CODES.UNAUTHENTICATED,
        'Authentication is required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    request.user = { id: result.userId, sessionId: result.sessionId };
    return true;
  }
}
