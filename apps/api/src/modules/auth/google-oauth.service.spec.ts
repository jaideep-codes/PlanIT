import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import { RateLimitedException } from '../../common/errors/rate-limited.exception.js';
import type { DbClient } from '../../infrastructure/database/db-client.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthRateLimitService } from './auth-rate-limit.service.js';
import type { AuthUser } from './auth.repository.js';
import type { AuthRepository } from './auth.repository.js';
import { sha256Hex } from './crypto.js';
import { pkceS256 } from './google-oauth.crypto.js';
import type { GoogleIdentityExchange } from './google-oauth.client.js';
import type { GoogleOAuthSettings } from './google-oauth.settings.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import type { GoogleOAuthStateStore } from './google-oauth.state.js';
import {
  GoogleExchangeUnavailable,
  GoogleTokenRejected,
  type GoogleCodeExchange,
  type GoogleIdentity,
  type StoredOAuthRequest,
} from './google-oauth.types.js';
import type { RequestMeta } from './request-meta.js';
import type { SessionService } from './session.service.js';

const CODE = 'auth-code-do-not-store';
const SECRET = 'google-client-secret-value';

const settings: GoogleOAuthSettings = {
  configured: true,
  clientId: 'google-client-id',
  clientSecret: SECRET,
  redirectUri: 'http://localhost:3000/api/v1/auth/google/callback',
  webOrigin: 'http://localhost:3000',
};

const meta: RequestMeta = {
  ip: '203.0.113.4',
  userAgent: 'vitest',
  requestId: 'req-google-1',
};

interface StoredUser extends AuthUser {
  displayName: string | null;
}

class MemoryState implements GoogleOAuthStateStore {
  readonly saved = new Map<string, StoredOAuthRequest>();

  save(state: string, value: StoredOAuthRequest): Promise<void> {
    this.saved.set(state, value);
    return Promise.resolve();
  }

  consume(state: string): Promise<StoredOAuthRequest | null> {
    const value = this.saved.get(state) ?? null;
    this.saved.delete(state);
    return Promise.resolve(value);
  }
}

class MemoryAccounts {
  users: StoredUser[] = [];
  links: { userId: string; providerAccountId: string }[] = [];
  failNextCreate = false;

  findByEmail(email: string): Promise<AuthUser | null> {
    return Promise.resolve(this.users.find((user) => user.email === email) ?? null);
  }

  findById(id: string): Promise<Omit<AuthUser, 'passwordHash'> | null> {
    const user = this.users.find((row) => row.id === id);
    if (!user) return Promise.resolve(null);
    return Promise.resolve({
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      status: user.status,
    });
  }

  findGoogleUserId(providerAccountId: string): Promise<string | null> {
    return Promise.resolve(
      this.links.find((link) => link.providerAccountId === providerAccountId)?.userId ?? null,
    );
  }

  createGoogleUser(
    _tx: DbClient,
    input: {
      email: string;
      displayName: string | null;
      emailVerifiedAt: Date;
      providerAccountId: string;
    },
  ): Promise<{ id: string }> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      const id = `user-${this.users.length + 1}`;
      this.users.push({
        id,
        email: input.email,
        passwordHash: null,
        emailVerifiedAt: input.emailVerifiedAt,
        status: 'ACTIVE',
        displayName: input.displayName,
      });
      this.links.push({ userId: id, providerAccountId: input.providerAccountId });
      return Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' }));
    }
    if (this.users.some((user) => user.email === input.email)) {
      return Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' }));
    }
    if (this.links.some((link) => link.providerAccountId === input.providerAccountId)) {
      return Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' }));
    }
    const id = `user-${this.users.length + 1}`;
    this.users.push({
      id,
      email: input.email,
      passwordHash: null,
      emailVerifiedAt: input.emailVerifiedAt,
      status: 'ACTIVE',
      displayName: input.displayName,
    });
    this.links.push({ userId: id, providerAccountId: input.providerAccountId });
    return Promise.resolve({ id });
  }

  linkGoogleAccount(_tx: DbClient, userId: string, providerAccountId: string): Promise<void> {
    if (this.links.some((link) => link.providerAccountId === providerAccountId)) {
      return Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' }));
    }
    this.links.push({ userId, providerAccountId });
    return Promise.resolve();
  }
}

class MemorySessions {
  readonly opened: string[] = [];

  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return fn({} as DbClient);
  }

  openFamily(
    _tx: DbClient,
    userId: string,
  ): Promise<{
    sessionId: string;
    accessToken: string;
    refreshToken: string;
  }> {
    this.opened.push(userId);
    return Promise.resolve({
      sessionId: `session-${userId}`,
      accessToken: 'access-token-value',
      refreshToken: 'refresh-token-value',
    });
  }
}

class MemoryAudit {
  readonly events: {
    action: string;
    userId: string | null;
    metadata?: object;
  }[] = [];

  record(event: { action: string; userId: string | null; metadata?: object }): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

class MemoryLimits {
  readonly calls: string[] = [];
  throwOn: string | null = null;

  enforce(action: string): Promise<void> {
    this.calls.push(action);
    if (this.throwOn === action) return Promise.reject(new RateLimitedException(15));
    return Promise.resolve();
  }
}

class MemoryGoogle implements GoogleIdentityExchange {
  readonly calls: GoogleCodeExchange[] = [];
  identity: GoogleIdentity = {
    subject: 'google-subject-1',
    email: 'ada@example.com',
    emailVerified: true,
    name: 'Ada Lovelace',
  };
  error: Error | null = null;

  exchange(input: GoogleCodeExchange): Promise<GoogleIdentity> {
    this.calls.push(input);
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(this.identity);
  }
}

function harness(configured = true) {
  const state = new MemoryState();
  const accounts = new MemoryAccounts();
  const sessions = new MemorySessions();
  const audit = new MemoryAudit();
  const limits = new MemoryLimits();
  const google = new MemoryGoogle();
  const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  const service = new GoogleOAuthService(
    { ...settings, configured },
    state,
    google,
    accounts as unknown as AuthRepository,
    sessions as unknown as SessionService,
    limits as unknown as AuthRateLimitService,
    audit as unknown as AuditService,
    logger,
  );
  return { service, state, accounts, sessions, audit, limits, google };
}

function expectNoOAuthSecrets(events: unknown[], ...extra: string[]) {
  const json = JSON.stringify(events);
  for (const secret of [CODE, SECRET, 'access-token-value', 'refresh-token-value', ...extra]) {
    expect(json).not.toContain(secret);
  }
}

async function begin(service: GoogleOAuthService) {
  const started = await service.begin(meta);
  const state = new URL(started.url).searchParams.get('state');
  expect(state).toBeTruthy();
  return { ...started, state: state ?? '' };
}

describe('Google OAuth service', () => {
  it('starts an authorization-code request with PKCE, state, and nonce', async () => {
    const { service, state, google, limits } = harness();
    const started = await begin(service);
    const url = new URL(started.url);

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('client_id')).toBe(settings.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(settings.redirectUri);
    expect(started.stateHash).toBe(sha256Hex(started.state));

    const saved = state.saved.get(started.state);
    expect(saved).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBe(saved?.nonce);
    expect(url.searchParams.get('code_challenge')).toBe(pkceS256(saved?.verifier ?? ''));
    expect(started.url).not.toContain(saved?.verifier ?? 'missing-verifier');
    expect(started.url).not.toContain(SECRET);
    expect(google.calls).toHaveLength(0);
    expect(limits.calls).toEqual(['googleStart']);
  });

  it('rejects an unknown, mismatched, or reused state before calling Google', async () => {
    const { service, state, google, audit } = harness();
    const started = await begin(service);
    const saved = state.saved.get(started.state);
    expect(saved).toBeTruthy();

    await expect(
      service.complete(
        { code: CODE, state: 'not-the-issued-state' },
        sha256Hex('not-the-issued-state'),
        meta,
      ),
    ).rejects.toMatchObject({ reason: 'failed' });
    expect(google.calls).toHaveLength(0);
    expect(state.saved.has(started.state)).toBe(true);

    await expect(
      service.complete({ code: CODE, state: started.state }, sha256Hex('other-state'), meta),
    ).rejects.toMatchObject({ reason: 'failed' });
    expect(google.calls).toHaveLength(0);
    expect(state.saved.has(started.state)).toBe(true);

    await service.complete({ code: CODE, state: started.state }, started.stateHash, meta);
    expect(google.calls).toHaveLength(1);
    expect(google.calls[0]?.codeVerifier).toBe(saved?.verifier);
    expect(google.calls[0]?.nonce).toBe(saved?.nonce);
    expect(google.calls[0]?.code).toBe(CODE);

    await expect(
      service.complete({ code: CODE, state: started.state }, started.stateHash, meta),
    ).rejects.toMatchObject({ reason: 'failed' });
    expect(google.calls).toHaveLength(1);
    expect(audit.events.some((event) => event.action === 'auth.google_link_failed')).toBe(true);
    expectNoOAuthSecrets(audit.events, saved?.verifier ?? '', saved?.nonce ?? '');
  });

  it('sends the stored PKCE verifier and creates nothing when Google rejects it', async () => {
    const { service, google, accounts, audit } = harness();
    const started = await begin(service);
    google.error = new GoogleTokenRejected('rejected');

    await expect(
      service.complete({ code: CODE, state: started.state }, started.stateHash, meta),
    ).rejects.toMatchObject({ reason: 'failed' });

    expect(google.calls[0]?.codeVerifier).toBeTruthy();
    expect(google.calls[0]?.codeVerifier).not.toBe(
      new URL(started.url).searchParams.get('code_challenge'),
    );
    expect(accounts.users).toHaveLength(0);
    expect(accounts.links).toHaveLength(0);
    expect(audit.events.at(-1)).toMatchObject({
      action: 'auth.google_link_failed',
      metadata: { provider: 'google', reason: 'rejected' },
    });
    expectNoOAuthSecrets(audit.events, google.calls[0]?.codeVerifier ?? '');
  });

  it('rejects an unverified Google email without creating or linking an account', async () => {
    const { service, google, accounts, audit } = harness();
    const started = await begin(service);
    google.identity = { ...google.identity, emailVerified: false };
    accounts.users.push({
      id: 'user-existing',
      email: 'ada@example.com',
      passwordHash: 'stored-hash',
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      status: 'ACTIVE',
      displayName: null,
    });

    await expect(
      service.complete({ code: CODE, state: started.state }, started.stateHash, meta),
    ).rejects.toMatchObject({
      reason: 'unverified_email',
      message: 'Google has not verified this email.',
    });

    expect(accounts.links).toHaveLength(0);
    expect(accounts.users[0]?.passwordHash).toBe('stored-hash');
    expect(audit.events.at(-1)).toMatchObject({
      action: 'auth.google_link_failed',
      userId: null,
      metadata: { reason: 'unverified_email' },
    });
    expectNoOAuthSecrets(audit.events);
  });

  it('does not link Google to an unverified PlanIT account', async () => {
    const { service, accounts, sessions, audit } = harness();
    const started = await begin(service);
    accounts.users.push({
      id: 'user-unverified',
      email: 'ada@example.com',
      passwordHash: 'stored-hash',
      emailVerifiedAt: null,
      status: 'ACTIVE',
      displayName: null,
    });

    await expect(
      service.complete({ code: CODE, state: started.state }, started.stateHash, meta),
    ).rejects.toMatchObject({
      reason: 'verify_email',
      message: 'Verify your email before linking Google.',
    });

    expect(accounts.links).toHaveLength(0);
    expect(accounts.users[0]?.emailVerifiedAt).toBeNull();
    expect(accounts.users[0]?.passwordHash).toBe('stored-hash');
    expect(sessions.opened).toHaveLength(0);
    expect(audit.events.at(-1)).toMatchObject({
      action: 'auth.google_link_failed',
      userId: 'user-unverified',
      metadata: { reason: 'unverified_account' },
    });
    expectNoOAuthSecrets(audit.events);
  });

  it('links Google to a verified account and leaves the password hash in place', async () => {
    const { service, accounts, sessions, audit } = harness();
    const started = await begin(service);
    const verifiedAt = new Date('2026-01-01T00:00:00.000Z');
    accounts.users.push({
      id: 'user-verified',
      email: 'ada@example.com',
      passwordHash: 'stored-hash',
      emailVerifiedAt: verifiedAt,
      status: 'ACTIVE',
      displayName: 'Ada',
    });

    const session = await service.complete(
      { code: CODE, state: started.state, scope: 'openid' },
      started.stateHash,
      meta,
    );

    expect(session.sessionId).toBe('session-user-verified');
    expect(accounts.links).toEqual([
      { userId: 'user-verified', providerAccountId: 'google-subject-1' },
    ]);
    expect(accounts.users[0]?.passwordHash).toBe('stored-hash');
    expect(accounts.users[0]?.emailVerifiedAt).toBe(verifiedAt);
    expect(sessions.opened).toEqual(['user-verified']);
    expect(audit.events.at(-1)).toMatchObject({
      action: 'auth.google_link_succeeded',
      metadata: { provider: 'google', outcome: 'linked' },
    });
    expectNoOAuthSecrets(audit.events);
  });

  it('creates a Google-only account with a null password hash', async () => {
    const { service, google, accounts, audit } = harness();
    const started = await begin(service);
    google.identity = {
      ...google.identity,
      email: ' Ada@Example.com ',
      name: 'Ada\nLovelace '.padEnd(80, 'x'),
    };

    const session = await service.complete(
      { code: CODE, state: started.state },
      started.stateHash,
      meta,
    );

    expect(session.sessionId).toBe('session-user-1');
    expect(accounts.users).toHaveLength(1);
    expect(accounts.users[0]).toMatchObject({
      email: 'ada@example.com',
      passwordHash: null,
      status: 'ACTIVE',
    });
    expect(accounts.users[0]?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(accounts.users[0]?.displayName?.startsWith('AdaLovelace')).toBe(true);
    expect(accounts.users[0]?.displayName?.length).toBeLessThanOrEqual(50);
    expect(accounts.users[0]?.displayName).not.toContain('\n');
    expect(accounts.links).toEqual([{ userId: 'user-1', providerAccountId: 'google-subject-1' }]);
    expect(audit.events.at(-1)).toMatchObject({
      action: 'auth.google_link_succeeded',
      metadata: { outcome: 'created' },
    });
    expectNoOAuthSecrets(audit.events);
  });

  it('signs in the already linked user instead of attaching that Google subject to someone else', async () => {
    const { service, google, accounts, sessions } = harness();
    const started = await begin(service);
    accounts.users.push(
      {
        id: 'user-a',
        email: 'a@example.com',
        passwordHash: null,
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
        displayName: null,
      },
      {
        id: 'user-b',
        email: 'ada@example.com',
        passwordHash: 'stored-hash',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
        displayName: null,
      },
    );
    accounts.links.push({ userId: 'user-a', providerAccountId: 'google-subject-1' });
    google.identity = { ...google.identity, email: 'ada@example.com' };

    const session = await service.complete(
      { code: CODE, state: started.state },
      started.stateHash,
      meta,
    );

    expect(session.sessionId).toBe('session-user-a');
    expect(sessions.opened).toEqual(['user-a']);
    expect(accounts.links).toHaveLength(1);
    expect(accounts.users[1]?.passwordHash).toBe('stored-hash');
  });

  it('does not link a suspended account', async () => {
    const { service, accounts, sessions } = harness();
    const started = await begin(service);
    accounts.users.push({
      id: 'user-suspended',
      email: 'ada@example.com',
      passwordHash: 'stored-hash',
      emailVerifiedAt: new Date(),
      status: 'SUSPENDED',
      displayName: null,
    });

    await expect(
      service.complete({ code: CODE, state: started.state }, started.stateHash, meta),
    ).rejects.toMatchObject({ reason: 'failed' });
    expect(accounts.links).toHaveLength(0);
    expect(sessions.opened).toHaveLength(0);
  });

  it('rate-limits the callback before consuming state or calling Google', async () => {
    const { service, state, google, limits } = harness();
    const started = await begin(service);
    limits.throwOn = 'googleCallback';

    await expect(
      service.complete({ code: CODE, state: started.state }, started.stateHash, meta),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(google.calls).toHaveLength(0);
    expect(state.saved.has(started.state)).toBe(true);
    expect(limits.calls).toContain('googleCallback');
  });

  it('audits a provider denial without storing the authorization code', async () => {
    const { service, state, google, audit } = harness();
    const started = await begin(service);

    await expect(
      service.complete(
        { error: 'access_denied', error_description: CODE, state: started.state, code: CODE },
        started.stateHash,
        meta,
      ),
    ).rejects.toMatchObject({ reason: 'failed' });

    expect(google.calls).toHaveLength(0);
    expect(state.saved.has(started.state)).toBe(false);
    expect(audit.events.at(-1)).toMatchObject({
      action: 'auth.google_link_failed',
      metadata: { reason: 'denied', providerError: 'access_denied' },
    });
    expectNoOAuthSecrets(audit.events);
  });

  it('returns unavailable when Google is not configured and does not call Google', async () => {
    const { service, google, state } = harness(false);
    await expect(service.begin(meta)).rejects.toMatchObject({
      message: 'Google sign-in is not configured.',
    });
    await expect(
      service.complete({ code: CODE, state: 'abc' }, 'cookie', meta),
    ).rejects.toMatchObject({
      message: 'Google sign-in is not configured.',
    });
    expect(google.calls).toHaveLength(0);
    expect(state.saved.size).toBe(0);
  });

  it('signs in after a unique-constraint race on account creation', async () => {
    const { service, accounts } = harness();
    const started = await begin(service);
    accounts.failNextCreate = true;

    const session = await service.complete(
      { code: CODE, state: started.state },
      started.stateHash,
      meta,
    );

    expect(session.sessionId).toBe('session-user-1');
    expect(accounts.users).toHaveLength(1);
    expect(accounts.users[0]?.passwordHash).toBeNull();
    expect(accounts.links).toHaveLength(1);
  });

  it('maps a Google outage to an unavailable error and stores no tokens', async () => {
    const { service, google, accounts, audit } = harness();
    const started = await begin(service);
    google.error = new GoogleExchangeUnavailable();

    await expect(
      service.complete({ code: CODE, state: started.state }, started.stateHash, meta),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(accounts.users).toHaveLength(0);
    expectNoOAuthSecrets(audit.events);
  });
});
