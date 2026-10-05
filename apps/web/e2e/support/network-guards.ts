import type { Page, Request } from '@playwright/test';

export interface PlanitTraffic {
  /**
   * Fails when a same-origin PlanIT request URL or body contains `secret`.
   * The error does not include the value.
   */
  assertAbsent(secret: string): void;
}

/**
 * Records traffic to the PlanIT web origin.
 *
 * Later phases use this for docs/ai-security.md layer E: a BYOK key must not
 * appear on PlanIT requests (scenario 18), and a provider payload must stay
 * inside the selected context scope (scenario 27). Phase 2 does not run those
 * product flows. Call `assertAbsent` for values that must not show up, such as
 * `passwordHash`.
 */
export function watchPlanitTraffic(page: Page, origin = 'http://localhost:3000'): PlanitTraffic {
  const records: string[] = [];
  const onRequest = (request: Request): void => {
    if (!request.url().startsWith(origin)) return;
    records.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`);
  };
  page.on('request', onRequest);
  return {
    assertAbsent(secret: string): void {
      if (secret.length === 0) return;
      if (records.some((record) => record.includes(secret))) {
        throw new Error('A PlanIT request included a value that must not leave the browser');
      }
    },
  };
}
