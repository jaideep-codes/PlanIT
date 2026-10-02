/** Identity taken from a verified Google ID token. Tokens themselves are not retained. */
export interface GoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

export interface GoogleCodeExchange {
  code: string;
  codeVerifier: string;
  nonce: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface StoredOAuthRequest {
  verifier: string;
  nonce: string;
}

/**
 * Google refused the login. The message is static so a token, code, or verifier cannot leak
 * through an error string.
 */
export class GoogleTokenRejected extends Error {
  readonly reason: 'rejected' | 'unverified_email';

  constructor(reason: 'rejected' | 'unverified_email' = 'rejected') {
    super('Google token was rejected');
    this.name = 'GoogleTokenRejected';
    this.reason = reason;
  }
}

/** The token endpoint could not be reached or returned a server error. */
export class GoogleExchangeUnavailable extends Error {
  constructor() {
    super('Google sign-in is temporarily unavailable');
    this.name = 'GoogleExchangeUnavailable';
  }
}

/** HTTP status from Google's token endpoint, with the body discarded. */
export class GoogleEndpointError extends Error {
  constructor(readonly status: number) {
    super('Google token endpoint failed');
    this.name = 'GoogleEndpointError';
  }
}
