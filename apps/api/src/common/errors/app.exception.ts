import { HttpException, type HttpStatus } from '@nestjs/common';
import type { ApiErrorDetail } from '@planit/types';

/**
 * The only exception type whose message reaches clients verbatim. Throw it from services
 * with a stable code from ERROR_CODES (or a domain code) and a user-safe message.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus,
    readonly details?: ApiErrorDetail[],
  ) {
    super({ code, message }, status);
  }
}
