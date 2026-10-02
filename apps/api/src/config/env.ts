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

/** Base64 that decodes to exactly `size` bytes. The error names the rule, never the value. */
function base64Bytes(size: number) {
  return z.string().superRefine((value, ctx) => {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      ctx.addIssue({ code: 'custom', message: `must be base64 encoding ${size} bytes` });
      return;
    }
    if (Buffer.from(value, 'base64').length !== size) {
      ctx.addIssue({ code: 'custom', message: `must decode to ${size} bytes` });
    }
  });
}

function addGoogleOAuthIssues(
  env: {
    NODE_ENV: (typeof NODE_ENVS)[number];
    WEB_ORIGINS: string[];
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    GOOGLE_REDIRECT_URI: string;
  },
  ctx: z.RefinementCtx,
): void {
  const id = env.GOOGLE_CLIENT_ID;
  const secret = env.GOOGLE_CLIENT_SECRET;
  const redirect = env.GOOGLE_REDIRECT_URI;
  const present = [id, secret, redirect].filter((value) => value.length > 0).length;
  if (present === 0) return;
  if (present !== 3) {
    ctx.addIssue({
      code: 'custom',
      path: ['GOOGLE_CLIENT_ID'],
      message:
        'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI must all be set or all be empty',
    });
    return;
  }
  if (id.length > 256 || secret.length > 512) {
    ctx.addIssue({
      code: 'custom',
      path: ['GOOGLE_CLIENT_ID'],
      message:
        'GOOGLE_CLIENT_ID must be at most 256 characters and GOOGLE_CLIENT_SECRET at most 512',
    });
    return;
  }
  let url: URL;
  try {
    url = new URL(redirect);
  } catch {
    ctx.addIssue({
      code: 'custom',
      path: ['GOOGLE_REDIRECT_URI'],
      message: 'must be an absolute http(s) URL',
    });
    return;
  }
  if (url.username || url.password || url.search || url.hash) {
    ctx.addIssue({
      code: 'custom',
      path: ['GOOGLE_REDIRECT_URI'],
      message: 'must not include credentials, a query, or a fragment',
    });
    return;
  }
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const localHttp = env.NODE_ENV !== 'production' && url.protocol === 'http:' && localhost;
  if (url.protocol !== 'https:' && !localHttp) {
    ctx.addIssue({
      code: 'custom',
      path: ['GOOGLE_REDIRECT_URI'],
      message: 'must use https, or http://localhost in development',
    });
    return;
  }
  if (url.pathname !== '/api/v1/auth/google/callback') {
    ctx.addIssue({
      code: 'custom',
      path: ['GOOGLE_REDIRECT_URI'],
      message: 'must use the path /api/v1/auth/google/callback',
    });
    return;
  }
  if (!env.WEB_ORIGINS.includes(url.origin)) {
    ctx.addIssue({
      code: 'custom',
      path: ['GOOGLE_REDIRECT_URI'],
      message: 'origin must be one of WEB_ORIGINS',
    });
  }
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
    /** HMAC key for access tokens. 32 bytes, base64. */
    JWT_SIGNING_KEY: base64Bytes(32),
    /** HMAC pepper for OTP codes. 32 bytes, base64. Also keys IP address hashes. */
    OTP_PEPPER: base64Bytes(32),
    /** AES-256-GCM key for queued email payloads. 32 bytes, base64. */
    OTP_JOB_ENCRYPTION_KEY: base64Bytes(32),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
    SMTP_FROM: z.string().min(3),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASSWORD: z.string().optional().default(''),
    /**
     * Google sign-in. All three stay empty until the flow is configured. The client secret
     * is read only by the API. None of these may use a NEXT_PUBLIC_ name.
     */
    GOOGLE_CLIENT_ID: z
      .string()
      .default('')
      .transform((value) => value.trim()),
    GOOGLE_CLIENT_SECRET: z
      .string()
      .default('')
      .transform((value) => value.trim()),
    GOOGLE_REDIRECT_URI: z
      .string()
      .default('')
      .transform((value) => value.trim()),
  })
  .superRefine((env, ctx) => {
    addGoogleOAuthIssues(env, ctx);
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
