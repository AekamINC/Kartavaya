/**
 * Deterministic `randomUUID`.
 *
 * Sequential rather than random so a test can assert WHICH punch is which after
 * a sort, and so a failure message names a stable id. The shape is still a valid
 * v4-looking UUID because `client_punch_id` is the server's idempotency key and
 * anything malformed would hide a real contract break.
 */

let n = 0;

export function randomUUID(): string {
  n += 1;
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export function __resetCrypto(): void {
  n = 0;
}

/** The id `randomUUID` will return on its next call. */
export function __peekNextUUID(): string {
  return `00000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`;
}
