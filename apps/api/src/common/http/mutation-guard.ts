import type { NextFunction, Request, Response } from 'express';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * State-changing requests must be JSON and come from a configured web origin.
 * Browsers attach Origin on those requests; a non-browser same-origin client may
 * instead send `Sec-Fetch-Site: same-origin` (docs/security.md §4). Failure is 403.
 */
export function createMutationGuard(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);

  return function mutationGuard(req: Request, res: Response, next: NextFunction): void {
    if (!MUTATING.has(req.method)) {
      next();
      return;
    }

    const mediaType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    const origin = req.headers.origin;
    const fetchSite = req.headers['sec-fetch-site'];
    const originOk =
      (typeof origin === 'string' && allowed.has(origin)) ||
      (origin === undefined && fetchSite === 'same-origin');

    if (mediaType !== 'application/json' || !originOk) {
      const requestId = typeof (req as { id?: unknown }).id === 'string' ? req.id : undefined;
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'The request was rejected.',
          ...(requestId !== undefined && { requestId }),
        },
      });
      return;
    }

    next();
  };
}
