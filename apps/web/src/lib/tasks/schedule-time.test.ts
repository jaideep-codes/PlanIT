import { describe, expect, it } from 'vitest';

import { formatSchedule, utcToWallTime, wallTimeToUtc } from './schedule-time';

describe('schedule wall times', () => {
  it('converts an Asia/Kolkata wall time to UTC and back', () => {
    const instant = wallTimeToUtc('2026-10-05T14:30', 'Asia/Kolkata');
    expect(instant).toBe('2026-10-05T09:00:00.000Z');
    expect(utcToWallTime(instant, 'Asia/Kolkata')).toBe('2026-10-05T14:30');
  });

  it('uses the account offset, including daylight time', () => {
    expect(wallTimeToUtc('2026-01-15T12:00', 'America/New_York')).toBe('2026-01-15T17:00:00.000Z');
    expect(wallTimeToUtc('2026-07-15T12:00', 'America/New_York')).toBe('2026-07-15T16:00:00.000Z');
    expect(utcToWallTime('2026-07-15T16:00:00.000Z', 'America/New_York')).toBe('2026-07-15T12:00');
  });

  it('keeps a UTC wall time on the same clock', () => {
    expect(wallTimeToUtc('2026-10-05T09:15', 'UTC')).toBe('2026-10-05T09:15:00.000Z');
    expect(formatSchedule('2026-10-05T09:15:00.000Z', '2026-10-05T10:00:00.000Z', 'UTC')).toBe(
      '2026-10-05 09:15 – 2026-10-05 10:00',
    );
  });

  it('rejects a value that is not a wall time', () => {
    expect(() => wallTimeToUtc('2026-10-05', 'UTC')).toThrow('Enter a schedule time.');
    expect(() => utcToWallTime('not-a-time', 'UTC')).toThrow('Enter a schedule time.');
  });
});
