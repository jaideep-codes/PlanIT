export const DELETE_EXPIRED_OTPS_JOB = 'delete-expired-otps';
export const RECURRENCE_MATERIALIZE_JOB = 'recurrence-materialize';

export interface MaintenanceHandlers {
  deleteExpiredOtps: () => Promise<unknown>;
  materializeRecurrence: () => Promise<unknown>;
}

/** Routes a maintenance job by name. An unknown name does not run OTP cleanup. */
export async function runMaintenanceJob(
  name: string,
  handlers: MaintenanceHandlers,
): Promise<void> {
  if (name === DELETE_EXPIRED_OTPS_JOB) {
    await handlers.deleteExpiredOtps();
    return;
  }
  if (name === RECURRENCE_MATERIALIZE_JOB) {
    await handlers.materializeRecurrence();
    return;
  }
  throw new Error('Unknown maintenance job.');
}
