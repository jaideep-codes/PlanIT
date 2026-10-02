import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { buildPinoHttpOptions, serializeLoggedError } from './pino-options.js';

function captureLogger() {
  const lines: string[] = [];
  const options = buildPinoHttpOptions({ LOG_LEVEL: 'info', NODE_ENV: 'test' });
  const log = pino(
    {
      level: 'info',
      redact: options.redact,
      serializers: options.serializers,
    },
    { write: (chunk: string) => lines.push(chunk) },
  );
  return { log, text: () => lines.join('') };
}

describe('log redaction', () => {
  it('scrubs credential fields at the top level and several levels down', () => {
    const { log, text } = captureLogger();
    log.info(
      {
        password: 'pw-secret',
        passwordHash: '$argon2id$hash',
        code: '123456',
        text: 'Your PlanIT verification code is 123456.',
        accessToken: 'access-secret',
        refreshToken: 'refresh-secret',
        nested: { password: 'nested-secret' },
        deep: { a: { b: { password: 'deep-secret' } } },
        headers: { 'set-cookie': 'planit_refresh=refresh-secret' },
      },
      'credential log',
    );
    const output = JSON.parse(text()) as {
      password: string;
      passwordHash: string;
      code: string;
      text: string;
      accessToken: string;
      refreshToken: string;
      nested: { password: string };
      deep: { a: { b: { password: string } } };
      headers: { 'set-cookie': string };
    };
    expect(output.password).toBe('[REDACTED]');
    expect(output.passwordHash).toBe('[REDACTED]');
    expect(output.code).toBe('[REDACTED]');
    expect(output.text).toBe('[REDACTED]');
    expect(output.accessToken).toBe('[REDACTED]');
    expect(output.refreshToken).toBe('[REDACTED]');
    expect(output.nested.password).toBe('[REDACTED]');
    expect(output.deep.a.b.password).toBe('[REDACTED]');
    expect(output.headers['set-cookie']).toBe('[REDACTED]');
  });

  it('redacts Google credentials and an authorization code carried in an error', () => {
    const { log, text } = captureLogger();
    log.info(
      {
        client_secret: 'google-secret',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        code_verifier: 'pkce-verifier',
        nonce: 'oauth-nonce',
        id_token: 'signed-id-token',
      },
      'Google sign-in failed',
    );
    const output = JSON.parse(text()) as {
      client_secret: string;
      GOOGLE_CLIENT_SECRET: string;
      code_verifier: string;
      nonce: string;
      id_token: string;
    };
    expect(output.client_secret).toBe('[REDACTED]');
    expect(output.GOOGLE_CLIENT_SECRET).toBe('[REDACTED]');
    expect(output.code_verifier).toBe('[REDACTED]');
    expect(output.nonce).toBe('[REDACTED]');
    expect(output.id_token).toBe('[REDACTED]');
    expect(text()).not.toContain('google-secret');
    expect(text()).not.toContain('pkce-verifier');

    const logged = serializeLoggedError(
      new Error(
        'token request failed at https://oauth2.googleapis.com/token?code=auth-code&state=oauth-state',
      ),
    );
    expect(logged.message).not.toContain('auth-code');
    expect(logged.message).not.toContain('oauth-state');
    expect(logged.message).toContain('code=[REDACTED]');
  });

  it('logs a scrubbed error and keeps a non-secret error code', () => {
    const error = new Error(
      'failed $argon2id$v=19$m=19456$secret for code 654321 at postgresql://planit:secret-password@127.0.0.1:5432/planit',
    );
    (error as { code?: string }).code = 'P2002';
    const logged = serializeLoggedError(error);
    expect(logged.type).toBe('Error');
    expect(logged.errorCode).toBe('P2002');
    expect(logged.message).not.toContain('$argon2id$');
    expect(logged.message).not.toContain('654321');
    expect(logged.message).not.toContain('secret-password');
    expect(logged.message).toContain('postgresql://[REDACTED]@127.0.0.1:5432/planit');

    const { log, text } = captureLogger();
    log.error({ err: error }, 'Unhandled exception');
    const output = JSON.parse(text()) as { err: { message: string; errorCode?: string } };
    expect(output.err.errorCode).toBe('P2002');
    expect(output.err.message).not.toContain('secret-password');
    expect(output.err.message).not.toContain('654321');
    expect(output.err.message).not.toContain('$argon2id$');
  });
});
