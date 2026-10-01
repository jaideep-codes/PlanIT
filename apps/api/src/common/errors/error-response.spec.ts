import {
  BadRequestException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { describe, expect, it } from 'vitest';

import { AppException } from './app.exception.js';
import { toErrorResponse } from './error-response.js';

describe('toErrorResponse', () => {
  it('passes AppException code, message, and details through', () => {
    const result = toErrorResponse(
      new AppException(
        'VALIDATION_ERROR',
        'The request failed validation.',
        HttpStatus.BAD_REQUEST,
        [{ path: 'title', message: 'Required' }],
      ),
      'req-12345678',
    );
    expect(result).toEqual({
      status: 400,
      isServerFault: false,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request failed validation.',
          requestId: 'req-12345678',
          details: [{ path: 'title', message: 'Required' }],
        },
      },
    });
  });

  it('replaces framework exception messages with safe generic ones', () => {
    const result = toErrorResponse(new NotFoundException('Cannot GET /internal/admin'), undefined);
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe('NOT_FOUND');
    expect(result.body.error.message).not.toContain('/internal/admin');
  });

  it('maps throttling to RATE_LIMITED', () => {
    expect(toErrorResponse(new ThrottlerException(), 'r').body.error.code).toBe('RATE_LIMITED');
  });

  it('maps body-parser errors without exposing parser details', () => {
    const parserError = Object.assign(new SyntaxError('Unexpected token } in JSON at position 7'), {
      status: 400,
      expose: true,
      type: 'entity.parse.failed',
    });
    const result = toErrorResponse(parserError, 'r');
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('BAD_REQUEST');
    expect(result.body.error.message).not.toContain('Unexpected token');
  });

  it('maps oversized bodies to PAYLOAD_TOO_LARGE', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
    });
    expect(toErrorResponse(tooLarge, 'r').body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('hides unknown errors behind INTERNAL_ERROR and flags them as server faults', () => {
    const result = toErrorResponse(
      new Error('connect ECONNREFUSED postgres://planit:secret@db:5432'),
      'r',
    );
    expect(result.status).toBe(500);
    expect(result.isServerFault).toBe(true);
    expect(result.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId: 'r',
    });
  });

  it('does not trust a 5xx status on arbitrary error objects', () => {
    const result = toErrorResponse({ status: 503, expose: true, message: 'internal detail' }, 'r');
    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('keeps 5xx HttpExceptions generic', () => {
    const result = toErrorResponse(new ServiceUnavailableException('db pool exhausted'), 'r');
    expect(result.status).toBe(503);
    expect(result.body.error.message).toBe('The service is temporarily unavailable.');
  });

  it('omits empty details', () => {
    const result = toErrorResponse(new BadRequestException(), undefined);
    expect(result.body.error).not.toHaveProperty('details');
    expect(result.body.error).not.toHaveProperty('requestId');
  });
});
