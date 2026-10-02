import type { Env } from '../../config/env.js';

export const GOOGLE_OAUTH_SETTINGS = Symbol('GOOGLE_OAUTH_SETTINGS');

export interface GoogleOAuthSettings {
  configured: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Origin of the redirect URI, which is also where the browser returns after login. */
  webOrigin: string;
}

export function googleOAuthSettings(
  env: Pick<
    Env,
    'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET' | 'GOOGLE_REDIRECT_URI' | 'WEB_ORIGINS'
  >,
): GoogleOAuthSettings {
  const configured =
    env.GOOGLE_CLIENT_ID.length > 0 &&
    env.GOOGLE_CLIENT_SECRET.length > 0 &&
    env.GOOGLE_REDIRECT_URI.length > 0;
  return {
    configured,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
    webOrigin: configured ? new URL(env.GOOGLE_REDIRECT_URI).origin : (env.WEB_ORIGINS[0] ?? ''),
  };
}
