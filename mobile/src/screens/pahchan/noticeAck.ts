import { storeGet, storeSet } from '../../lib/storage';
import { PAHCHAN_NOTICE_VERSION } from './noticeCopy';

/**
 * The local record that the DPDP notice was read.
 *
 * ── WHY THERE IS A LOCAL RECORD AT ALL ───────────────────────────────────────
 *
 * The gate on `ClockScreen` sits ABOVE the camera-permission screen: you tell
 * somebody why you want their camera before you ask for it. That places it in
 * front of the punch, and 07 §2 is the rule this whole module is built around —
 * NOTHING BLOCKS A PUNCH. "A blocked punch at a client site becomes a payroll
 * dispute a week later, and the employee is right."
 *
 * So the gate MUST clear on the tap, not on the server's answer.
 * `migrations/113_pahchan_notice_acknowledgements.sql` says the same thing from
 * the other side: "the server row is the ORG'S EVIDENCE, not the device's
 * permission slip." Three things would otherwise trap a person on the notice
 * screen with a camera behind it:
 *
 *   · no signal — the common case, and the case this module exists for;
 *   · `staging.pahchan_notice_acknowledgements` absent, because 113 is
 *     UNAPPLIED (the server answers `{"stored": false}` with a 200, by design);
 *   · any 5xx at all.
 *
 * `ackNotice` on `ClockScreen` writes here FIRST and synchronously — MMKV is a
 * synchronous JSI store — and only then fires the POST. If the POST never lands,
 * the punch still happens and the acknowledgement is retried the next time this
 * screen mounts.
 *
 * ── THE SUBJECT IS THE ACCOUNT, NOT THE EMPLOYEE ─────────────────────────────
 *
 * Keyed on `user_id`, matching the server's unique index
 * `(org_id, user_id, notice_version)`. 113 records the measurement that decided
 * it: 81 employee rows, 0 of them carrying a `user_id`, on 6 August 2026 — so
 * `_employee_for` resolves nobody and `GET /v1/pahchan/me` answers
 * `{"employee": null}` to every caller on this database. A gate keyed on the
 * employee id would never fire for anyone, which is the notice not existing.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
 *
 * It is not the record of service. The row in
 * `staging.pahchan_notice_acknowledgements` is. This is a per-device latch that
 * stops one person being asked twice a day by their own phone, and it is keyed
 * BY VERSION, so a wording change asks again even on a device that has already
 * latched the old one.
 *
 * It is deliberately NOT cleared on sign-out. Two people sharing one handset is
 * the case where that matters, and it is why the key carries the account id: a
 * latch keyed only on version would let the second person's punch skip a notice
 * they were never shown.
 */

/** `pahchan.notice.<account>.<version>` → the ISO instant of the tap. */
function key(userId: string, version: string): string {
  return `pahchan.notice.${userId}.${version}`;
}

/** When this account acknowledged this wording ON THIS DEVICE, or null. */
export function localAck(
  userId: string | undefined | null,
  version: string = PAHCHAN_NOTICE_VERSION,
): string | null {
  if (!userId) return null;
  return storeGet<string>(key(userId, version)) ?? null;
}

/**
 * Latch the acknowledgement locally. Returns the instant recorded.
 *
 * Idempotent: a second tap keeps the FIRST timestamp, for the same reason the
 * table's unique index does — the first time somebody was told is the fact, and
 * it is the one that actually preceded the photograph.
 */
export function setLocalAck(
  userId: string,
  version: string = PAHCHAN_NOTICE_VERSION,
  at: string = new Date().toISOString(),
): string {
  const existing = localAck(userId, version);
  if (existing) return existing;
  storeSet(key(userId, version), at);
  return at;
}

/**
 * Does this person still need to be shown the notice?
 *
 * The SERVER'S answer wins when it says yes-acknowledged, because the row is
 * keyed on the account and not on the handset — acknowledging on the web means
 * this never fires, and a new phone does not ask again. The local latch is the
 * fallback for everything that keeps the server from answering.
 *
 * Returns false when there is no signed-in account: there is nothing to key an
 * acknowledgement on and nobody to show it to.
 */
export function needsNotice(args: {
  userId?: string | null;
  serverAcknowledgedAt?: string | null;
  version?: string;
}): boolean {
  const { userId, serverAcknowledgedAt, version = PAHCHAN_NOTICE_VERSION } = args;
  if (!userId) return false;
  if (serverAcknowledgedAt) return false;
  return localAck(userId, version) === null;
}
