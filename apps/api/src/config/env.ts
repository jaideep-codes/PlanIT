import { z } from 'zod';

const NODE_ENVS = ['development', 'test', 'production'] as const;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/**
 * Express "trust proxy" accepts a boolean, a hop count, or named/CIDR subnets.
 * See https://expressjs.com/en/guide/behind-proxies.html
 */
export type TrustProxySetting = boolean | number | string;

function parseTrustProxy(value: string): TrustProxySetting {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return value.trim();
}

const originList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url({ protocol: /^https?$/ })).min(1));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    WEB_ORIGINS: originList,
    // Off by default: trusting X-Forwarded-For from a hop that does not overwrite it lets
    // clients spoof their IP and evade per-IP rate limits. See docs/security.md.
    TRUST_PROXY: z.string().default('false').transform(parseTrustProxy),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const origin of env.WEB_ORIGINS) {
      if (!origin.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEB_ORIGINS'],
          message: 'must use https in production',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Validates process environment at boot. Error messages include variable names and rule
 * violations only — never values, because values may be credentials.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  return result.data;
}
