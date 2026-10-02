import { createHash } from 'node:crypto';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 1_500;

export function sha1Password(password: string): string {
  return createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
}

/** Parses a HIBP range response (`SUFFIX:COUNT` lines, including k-anonymity padding). */
export function rangeContainsSuffix(body: string, suffix: string): boolean {
  const target = suffix.toUpperCase();
  for (const line of body.split('\n')) {
    const [hash, count] = line.trim().split(':');
    if (!hash || hash.toUpperCase() !== target) continue;
    return Number(count) > 0;
  }
  return false;
}

/**
 * Have I Been Pwned k-anonymity range API. Only the first 5 hex characters of the SHA-1
 * leave the process. Throws when the service cannot be reached; the caller decides
 * whether that fails open.
 */
export class HibpPasswordBreachChecker {
  async isBreached(password: string): Promise<boolean> {
    const digest = sha1Password(password);
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    const response = await fetch(`${RANGE_URL}${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'PlanIT-password-check' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`breached-password check returned ${response.status}`);
    }
    return rangeContainsSuffix(await response.text(), suffix);
  }
}
