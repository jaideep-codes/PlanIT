import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@planit/shared';

import { AppException } from './app.exception.js';

/** 429 whose Retry-After (seconds) the exception filter copies onto the response. */
export class RateLimitedException extends AppException {
  constructor(
    readonly retryAfterSeconds: number,
    message = 'Too many requests. Please slow down and try again shortly.',
  ) {
    super(ERROR_CODES.RATE_LIMITED, message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
