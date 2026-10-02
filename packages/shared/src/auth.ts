/**
 * Cookie names shared by the API (which sets them) and the web app (which only checks
 * whether the access cookie is present). The refresh cookie is not `__Host-` prefixed:
 * that prefix requires `Path=/`, and the refresh cookie is scoped to the auth routes.
 */
export const ACCESS_COOKIE_NAME = '__Host-planit_access';
export const REFRESH_COOKIE_NAME = 'planit_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
