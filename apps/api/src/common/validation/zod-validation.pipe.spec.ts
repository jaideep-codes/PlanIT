import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppException } from '../errors/app.exception.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const schema = z.strictObject({
  title: z.string().trim().min(1),
  estimatedMinutes: z.coerce.number().int().positive().optional(),
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns parsed output', () => {
    expect(pipe.transform({ title: '  Read  ', estimatedMinutes: '30' })).toEqual({
      title: 'Read',
      estimatedMinutes: 30,
    });
  });

  it('rejects unknown keys (mass assignment)', () => {
    try {
      pipe.transform({ title: 'Read', userId: 'someone-else' });
      expect.unreachable('pipe should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      const appError = error as AppException;
      expect(appError.code).toBe('VALIDATION_ERROR');
      expect(appError.getStatus()).toBe(400);
      expect(appError.details?.[0]?.message).toMatch(/userId/);
    }
  });

  it('reports field paths', () => {
    try {
      pipe.transform({ title: '' });
      expect.unreachable('pipe should have thrown');
    } catch (error) {
      expect((error as AppException).details).toEqual([expect.objectContaining({ path: 'title' })]);
    }
  });
});
