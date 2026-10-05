/**
 * Lexicographic fractional index for manual task order.
 *
 * The digit alphabet is base 62 in ASCII order:
 * `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`.
 * The first character is an integer-length head. `A`–`Z` sit before the origin
 * and `a`–`z` sit at or after it. The first key, used when a user has no tasks,
 * is `a0`.
 *
 * `between(lower, upper)` returns a key that sorts strictly between the neighbors.
 * `null` means that side of the list is open. New tasks call `between(null, smallest)`
 * so they land at the front.
 *
 * Keys are at most 64 characters, matching the `sort_order` check. When the gap
 * is too small to name another key that still fits, this throws
 * `FractionalIndexExhaustedError`. The position route returns 409 and does not
 * rewrite other rows.
 */

export const FRACTIONAL_INDEX_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Integer-length heads. Upper case is before the origin; lower case is after it. */
const HEADS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export const FRACTIONAL_INDEX_FIRST_KEY = 'a0';

export const FRACTIONAL_INDEX_MAX_LENGTH = 64;

const ZERO = '0';
const LAST_DIGIT = 'z';
const SMALLEST_INTEGER = `A${ZERO.repeat(26)}`;

export class FractionalIndexExhaustedError extends Error {
  constructor() {
    super('Fractional index exceeded 64 characters.');
    this.name = 'FractionalIndexExhaustedError';
  }
}

function digitIndex(digit: string): number {
  const index = FRACTIONAL_INDEX_ALPHABET.indexOf(digit);
  if (index < 0) throw new Error('Invalid fractional-index digit.');
  return index;
}

function integerLength(head: string): number {
  const code = head.charCodeAt(0);
  if (code >= 97 && code <= 122) return code - 97 + 2;
  if (code >= 65 && code <= 90) return 90 - code + 2;
  throw new Error('Invalid fractional-index head.');
}

function integerPart(key: string): string {
  const length = integerLength(key[0] ?? '');
  if (length > key.length) throw new Error('Invalid fractional index.');
  return key.slice(0, length);
}

function assertKey(key: string): void {
  if (key === SMALLEST_INTEGER) throw new Error('Invalid fractional index.');
  const head = integerPart(key);
  const fraction = key.slice(head.length);
  if (!HEADS.includes(key[0] ?? '')) throw new Error('Invalid fractional index.');
  for (const digit of fraction) {
    if (!FRACTIONAL_INDEX_ALPHABET.includes(digit)) throw new Error('Invalid fractional index.');
  }
  if (fraction.endsWith(ZERO)) throw new Error('Invalid fractional index.');
}

function midpoint(lower: string, upper: string | null): string {
  if (upper !== null && lower >= upper) throw new Error('Fractional midpoint is empty.');
  if (lower.endsWith(ZERO) || (upper !== null && upper.endsWith(ZERO))) {
    throw new Error('Invalid fractional index.');
  }
  if (upper) {
    let shared = 0;
    while ((lower[shared] || ZERO) === upper[shared]) shared += 1;
    if (shared > 0) {
      return upper.slice(0, shared) + midpoint(lower.slice(shared), upper.slice(shared));
    }
  }
  const lowerDigit = lower ? digitIndex(lower[0] ?? '') : 0;
  const upperDigit = upper !== null ? digitIndex(upper[0] ?? '') : FRACTIONAL_INDEX_ALPHABET.length;
  if (upperDigit - lowerDigit > 1) {
    const middle = Math.round(0.5 * (lowerDigit + upperDigit));
    return FRACTIONAL_INDEX_ALPHABET[middle] ?? '';
  }
  if (upper && upper.length > 1) return upper.slice(0, 1);
  return (FRACTIONAL_INDEX_ALPHABET[lowerDigit] ?? '') + midpoint(lower.slice(1), null);
}

function incrementInteger(key: string): string | null {
  const head = key[0] ?? '';
  const digits = key.slice(1).split('');
  let carry = true;
  for (let index = digits.length - 1; carry && index >= 0; index -= 1) {
    const next = digitIndex(digits[index] ?? '') + 1;
    if (next === FRACTIONAL_INDEX_ALPHABET.length) {
      digits[index] = ZERO;
    } else {
      digits[index] = FRACTIONAL_INDEX_ALPHABET[next] ?? ZERO;
      carry = false;
    }
  }
  if (!carry) return head + digits.join('');
  if (head === 'z') return null;
  if (head === 'Z') return FRACTIONAL_INDEX_FIRST_KEY;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') digits.push(ZERO);
  else digits.pop();
  return nextHead + digits.join('');
}

function decrementInteger(key: string): string | null {
  const head = key[0] ?? '';
  const digits = key.slice(1).split('');
  let borrow = true;
  for (let index = digits.length - 1; borrow && index >= 0; index -= 1) {
    const next = digitIndex(digits[index] ?? '') - 1;
    if (next === -1) {
      digits[index] = LAST_DIGIT;
    } else {
      digits[index] = FRACTIONAL_INDEX_ALPHABET[next] ?? LAST_DIGIT;
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join('');
  if (head === 'A') return null;
  if (head === 'a') return `Z${LAST_DIGIT}`;
  const nextHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (nextHead < 'Z') digits.push(LAST_DIGIT);
  else digits.pop();
  return nextHead + digits.join('');
}

function generate(lower: string | null, upper: string | null): string {
  if (lower !== null) assertKey(lower);
  if (upper !== null) assertKey(upper);
  if (lower !== null && upper !== null && lower >= upper) {
    throw new FractionalIndexExhaustedError();
  }
  if (lower === null && upper === null) return FRACTIONAL_INDEX_FIRST_KEY;
  if (lower === null && upper !== null) {
    const head = integerPart(upper);
    const fraction = upper.slice(head.length);
    if (head === SMALLEST_INTEGER) return head + midpoint('', fraction);
    if (head < upper) return head;
    const previous = decrementInteger(head);
    if (previous === null) throw new FractionalIndexExhaustedError();
    return previous;
  }
  if (lower !== null && upper === null) {
    const head = integerPart(lower);
    const fraction = lower.slice(head.length);
    const next = incrementInteger(head);
    return next === null ? head + midpoint(fraction, null) : next;
  }
  if (lower === null || upper === null) throw new FractionalIndexExhaustedError();
  const lowerHead = integerPart(lower);
  const lowerFraction = lower.slice(lowerHead.length);
  const upperHead = integerPart(upper);
  if (lowerHead === upperHead) {
    return lowerHead + midpoint(lowerFraction, upper.slice(upperHead.length));
  }
  const next = incrementInteger(lowerHead);
  if (next === null) throw new FractionalIndexExhaustedError();
  if (next < upper) return next;
  return lowerHead + midpoint(lowerFraction, null);
}

/** A key that sorts strictly between `lower` and `upper`. Either side may be open. */
export function between(lower: string | null, upper: string | null): string {
  const key = generate(lower, upper);
  if (key.length < 1 || key.length > FRACTIONAL_INDEX_MAX_LENGTH) {
    throw new FractionalIndexExhaustedError();
  }
  return key;
}
