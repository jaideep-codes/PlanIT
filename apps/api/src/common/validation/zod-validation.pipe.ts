import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { ERROR_CODES } from '@planit/shared';
import type { z } from 'zod';

import { AppException } from '../errors/app.exception.js';

/**
 * Validates and parses a request part against a Zod schema:
 * `@Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskInput`.
 *
 * Request schemas should be `z.strictObject(...)` so unknown keys are rejected rather than
 * silently passed to persistence (mass-assignment protection).
 */
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new AppException(
      ERROR_CODES.VALIDATION_ERROR,
      'The request failed validation.',
      HttpStatus.BAD_REQUEST,
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      })),
    );
  }
}
