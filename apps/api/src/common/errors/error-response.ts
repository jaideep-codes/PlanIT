import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from '@planit/shared';
import type { ApiErrorBody } from '@planit/types';

import { AppException } from './app.exception.js';

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ERROR_CODES.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HttpStatus.METHOD_NOT_ALLOWED]: ERROR_CODES.METHOD_NOT_ALLOWED,
  [HttpStatus.CONFLICT]: ERROR_CODES.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ERROR_CODES.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ERROR_CODES.VALIDATION_ERROR,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ERROR_CODES.SERVICE_UNAVAILABLE,
};

const SAFE_MESSAGES: Record<ErrorCode, string> = {
  BAD_REQUEST: 'The request could not be processed.',
  VALIDATION_ERROR: 'The request failed validation.',
  UNAUTHENTICATED: 'Authentication is required.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  METHOD_NOT_ALLOWED: 'This method is not allowed for the requested resource.',
  CONFLICT: 'The request conflicts with the current state of the resource.',
  PAYLOAD_TOO_LARGE: 'The request body is too large.',
  RATE_LIMITED: 'Too many requests. Please slow down and try again shortly.',
  INTERNAL_ERROR: 'An unexpected error occurred.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
};

export interface ErrorResponse {
  status: number;
  body: ApiErrorBody;
  /** True when the error is unexpected and must be logged with full diagnostics. */
  isServerFault: boolean;
}

function codeForStatus(status: number): ErrorCode {
  return (
    CODE_BY_STATUS[status] ?? (status >= 500 ? ERROR_CODES.INTERNAL_ERROR : ERROR_CODES.BAD_REQUEST)
  );
}

/** http-errors instances (thrown by body-parser) carry a client-safe 4xx `status`. */
function clientErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const { status, expose } = exception as { status?: unknown; expose?: unknown };
  if (expose === true && typeof status === 'number' && status >= 400 && status < 500) {
    return status;
  }
  return undefined;
}

/**
 * Converts any thrown value into the public error envelope. Only AppException messages are
 * passed through; everything else gets a generic message for its status so that framework,
 * library, database, or provider internals never reach clients.
 */
export function toErrorResponse(exception: unknown, requestId: string | undefined): ErrorResponse {
  const build = (
    status: number,
    code: string,
    message: string,
    details?: ApiErrorBody['error']['details'],
  ) => ({
    status,
    isServerFault: status >= 500,
    body: {
      error: {
        code,
        message,
        ...(requestId !== undefined && { requestId }),
        ...(details !== undefined && details.length > 0 && { details }),
      },
    },
  });

  if (exception instanceof AppException) {
    return build(exception.getStatus(), exception.code, exception.message, exception.details);
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = codeForStatus(status);
    return build(status, code, SAFE_MESSAGES[code]);
  }

  const status = clientErrorStatus(exception);
  if (status !== undefined) {
    const code = codeForStatus(status);
    return build(status, code, SAFE_MESSAGES[code]);
  }

  return build(
    HttpStatus.INTERNAL_SERVER_ERROR,
    ERROR_CODES.INTERNAL_ERROR,
    SAFE_MESSAGES.INTERNAL_ERROR,
  );
}
