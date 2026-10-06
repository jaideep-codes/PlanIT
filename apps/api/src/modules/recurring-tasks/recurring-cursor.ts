import { z } from 'zod';

export class BadRecurringCursorError extends Error {
  constructor() {
    super('The cursor is invalid.');
    this.name = 'BadRecurringCursorError';
  }
}

const cursorBodySchema = z.strictObject({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});

export interface RecurringCursor {
  createdAt: Date;
  id: string;
}

/** Opaque cursor for `createdAt` descending, tie-broken by `id` descending. */
export function encodeRecurringCursor(row: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: row.createdAt, id: row.id }), 'utf8').toString(
    'base64url',
  );
}

export function decodeRecurringCursor(cursor: string): RecurringCursor {
  try {
    const json: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const body = cursorBodySchema.parse(json);
    return { createdAt: new Date(body.createdAt), id: body.id };
  } catch {
    throw new BadRecurringCursorError();
  }
}
