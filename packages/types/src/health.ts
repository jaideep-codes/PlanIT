/** `GET /api/health` — liveness. Never touches dependencies. */
export interface LivenessResponse {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

export type DependencyStatus = 'up' | 'down';

export interface DependencyCheck {
  status: DependencyStatus;
  latencyMs: number;
}

/**
 * `GET /api/health/ready` — readiness.
 * - `ready`: all dependencies up.
 * - `degraded`: the database is up but Redis is down. PlanIT keeps serving because Redis
 *   is never the source of truth; caching and queues are impaired.
 * - `not_ready`: the database is down. Served with HTTP 503.
 */
export interface ReadinessResponse {
  status: 'ready' | 'degraded' | 'not_ready';
  checks: {
    database: DependencyCheck;
    redis: DependencyCheck;
  };
  timestamp: string;
}
