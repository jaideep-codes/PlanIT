import { createParamDecorator, type ExecutionContext, HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@planit/shared';

import { AppException } from '../../common/errors/app.exception.js';
import type { AuthenticatedRequest } from './session.guard.js';

export interface AuthenticatedUser {
  id: string;
  sessionId: string;
}

/** The user id and session id set by the session guard. Never read from the body or path. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new AppException(
        ERROR_CODES.UNAUTHENTICATED,
        'Authentication is required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return { id: request.user.id, sessionId: request.user.sessionId };
  },
);
