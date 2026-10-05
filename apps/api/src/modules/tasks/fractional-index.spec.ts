import { describe, expect, it } from 'vitest';

import {
  between,
  FRACTIONAL_INDEX_FIRST_KEY,
  FRACTIONAL_INDEX_MAX_LENGTH,
  FractionalIndexExhaustedError,
} from './fractional-index.js';

function byCodePoint(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

describe('fractional index', () => {
  it('starts at a0 and puts a new front key before every existing key', () => {
    expect(FRACTIONAL_INDEX_FIRST_KEY).toBe('a0');
    expect(between(null, null)).toBe('a0');
    expect(between(null, 'a0')).toBe('Zz');
    expect(between('a0', null)).toBe('a1');
    expect(between('a0', 'a1')).toBe('a0V');

    const keys = [between(null, null)];
    for (let count = 0; count < 40; count += 1) {
      keys.unshift(between(null, keys[0] ?? null));
    }
    expect(keys).toEqual([...keys].sort(byCodePoint));
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key.length).toBeLessThanOrEqual(FRACTIONAL_INDEX_MAX_LENGTH);
      expect(key.startsWith('A')).toBe(false);
    }
  });

  it('keeps a key strictly between two neighbors', () => {
    const lower = 'a0';
    const upper = 'a1';
    let cursor = upper;
    const produced = [lower];
    for (let count = 0; count < 20; count += 1) {
      const next = between(lower, cursor);
      expect(next > lower).toBe(true);
      expect(next < cursor).toBe(true);
      expect(next.length).toBeLessThanOrEqual(FRACTIONAL_INDEX_MAX_LENGTH);
      produced.push(next);
      cursor = next;
    }
    expect(new Set(produced).size).toBe(produced.length);
  });

  it('throws once the only remaining key would be longer than 64 characters', () => {
    let upper = between('a0', 'a1');
    let steps = 0;
    let thrown = false;
    for (; steps < 500; steps += 1) {
      try {
        const next = between('a0', upper);
        expect(next.length).toBeLessThanOrEqual(FRACTIONAL_INDEX_MAX_LENGTH);
        expect(next > 'a0' && next < upper).toBe(true);
        upper = next;
      } catch (error) {
        expect(error).toBeInstanceOf(FractionalIndexExhaustedError);
        thrown = true;
        break;
      }
    }
    expect(thrown).toBe(true);
    expect(upper.length).toBeGreaterThan(32);
    expect(upper.length).toBeLessThanOrEqual(FRACTIONAL_INDEX_MAX_LENGTH);
    expect(() => between('a0', 'a0')).toThrow(FractionalIndexExhaustedError);
  });
});
