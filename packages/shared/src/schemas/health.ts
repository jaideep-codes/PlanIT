import type { LivenessResponse, ReadinessResponse } from '@planit/types';
import { z } from 'zod';

const dependencyCheckSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative(),
});

export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.iso.datetime(),
}) satisfies z.ZodType<LivenessResponse>;

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'degraded', 'not_ready']),
  checks: z.object({
    database: dependencyCheckSchema,
    redis: dependencyCheckSchema,
  }),
  timestamp: z.iso.datetime(),
}) satisfies z.ZodType<ReadinessResponse>;
