const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

interface ZonedParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

function readPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? '';
}

function partsInTimeZone(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const hour = readPart(parts, 'hour') === '24' ? '00' : readPart(parts, 'hour');
  return {
    year: readPart(parts, 'year'),
    month: readPart(parts, 'month').padStart(2, '0'),
    day: readPart(parts, 'day').padStart(2, '0'),
    hour: hour.padStart(2, '0'),
    minute: readPart(parts, 'minute').padStart(2, '0'),
    second: readPart(parts, 'second').padStart(2, '0'),
  };
}

/** Milliseconds to add to UTC to reach the wall clock in `timeZone` at `instant`. */
function offsetMilliseconds(instant: Date, timeZone: string): number {
  const parts = partsInTimeZone(instant, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/**
 * Interprets a `datetime-local` value as a wall time in `timeZone` and returns a UTC instant.
 * Due dates do not use this function; they stay `YYYY-MM-DD`.
 */
export function wallTimeToUtc(wallTime: string, timeZone: string): string {
  const match = WALL_TIME.exec(wallTime);
  if (!match) throw new Error('Enter a schedule time.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    throw new Error('Enter a schedule time.');
  }
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = guess - offsetMilliseconds(new Date(guess), timeZone);
  utc = guess - offsetMilliseconds(new Date(utc), timeZone);
  return new Date(utc).toISOString();
}

/** Formats a UTC instant as a `datetime-local` value in `timeZone`. */
export function utcToWallTime(instant: string, timeZone: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error('Enter a schedule time.');
  const parts = partsInTimeZone(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Both ends, in the account timezone, for a task row. */
export function formatSchedule(start: string, end: string, timeZone: string): string {
  const from = utcToWallTime(start, timeZone).replace('T', ' ');
  const to = utcToWallTime(end, timeZone).replace('T', ' ');
  return `${from} – ${to}`;
}
