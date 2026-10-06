import { describe, expect, it } from 'vitest';

import {
  DELETE_EXPIRED_OTPS_JOB,
  RECURRENCE_MATERIALIZE_JOB,
  runMaintenanceJob,
} from './maintenance-dispatch.js';

describe('maintenance job dispatch', () => {
  it('runs OTP cleanup and recurrence by job name', async () => {
    const calls: string[] = [];
    const handlers = {
      deleteExpiredOtps: () => {
        calls.push('otp');
        return Promise.resolve(0);
      },
      materializeRecurrence: () => {
        calls.push('recurrence');
        return Promise.resolve();
      },
    };
    await runMaintenanceJob(DELETE_EXPIRED_OTPS_JOB, handlers);
    await runMaintenanceJob(RECURRENCE_MATERIALIZE_JOB, handlers);
    expect(calls).toEqual(['otp', 'recurrence']);
  });

  it('does not run OTP cleanup for an unknown job name', async () => {
    const handlers = {
      deleteExpiredOtps: () => Promise.reject(new Error('otp should not run')),
      materializeRecurrence: () => Promise.reject(new Error('recurrence should not run')),
    };
    await expect(runMaintenanceJob('something-else', handlers)).rejects.toThrow(
      'Unknown maintenance job.',
    );
  });
});
