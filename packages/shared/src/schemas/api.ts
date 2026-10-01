import type { ApiErrorBody } from '@planit/types';
import { z } from 'zod';

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
}) satisfies z.ZodType<ApiErrorBody>;
