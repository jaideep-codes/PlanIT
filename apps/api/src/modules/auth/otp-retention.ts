const DAY_MS = 24 * 60 * 60 * 1000;

/** An OTP row may be deleted only once it has been expired for a full day. */
export function otpDeletionCutoff(now: Date): Date {
  return new Date(now.getTime() - DAY_MS);
}

export function isOtpDueForDeletion(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= otpDeletionCutoff(now).getTime();
}
