import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

import { toErrorResponse } from './error-response.js';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    logger.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const response = http.getResponse<Response>();
    const requestId = typeof request.id === 'string' ? request.id : undefined;

    const { status, body, isServerFault } = toErrorResponse(exception, requestId);

    // Full diagnostics stay server-side; the client only ever sees the safe envelope.
    if (isServerFault) {
      this.logger.error({ err: exception }, 'Unhandled exception');
    }

    if (response.headersSent) return;
    response.status(status).json(body);
  }
}
