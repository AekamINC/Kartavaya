/**
 * seatFigures.js — which seat numbers a screen shows, decided once.
 *
 * TWO screens render seats from `GET /v1/subscription/usage`: the customer's own
 * Billing tab (`org/TabBilling.jsx`) and Aekam's console (`AdminBillingPage.jsx`).
 * They were about to hold two copies of the same arithmetic, which is the exact
 * shape `routers/org_invites.py` spends forty lines regretting on the server —
 * five seat counters that disagreed in three separate ways, and the one that
 * disagreed most quietly was the one that only DISPLAYED a number.
 *
 * ── THE DECISION THIS FILE CARRIES ──────────────────────────────────────────
 *
 * `seats_used`, not `user_count`. They are different populations:
 *
 *     user_count   joined members.
 *     seats_used   joined members PLUS invitations sent and not yet accepted.
 *
 * A pending invite HOLDS a seat — settled by the owner, and `SeatCount.used` on
 * the server says so, so `seats_used` is what the refusal counts. The tiles used
 * to render `user_count`, so an organisation with invitations outstanding was
 * shown room it did not have and then refused when it tried to use it. Measured
 * read-only on the live database 2026-08-06: the E2E org is 6 joined and 7
 * pending, so the old tile said 6 where the refusal counted 13.
 *
 * ── ATTENDANCE SEATS ARE NEVER ADDED TO ORG SEATS ───────────────────────────
 *
 * The owner's decision of 2026-08-04: a firm with 8 office staff and 200 site
 * workers pays 8 org seats and 200 attendance seats, NOT 208 of one kind. They
 * are returned here as two separate shapes and no function in this file sums
 * them — a single "seats" total would misstate the bill in the direction of the
 * more expensive seat, which is the failure the split exists to prevent.
 *
 * ── THE `??` CHAINS ARE DEPLOY ORDER, NOT PREFERENCE ────────────────────────
 *
 * The frontend ships independently of the API. A browser holding this bundle
 * against a backend that predates `seats_used` would otherwise render "0 / 15",
 * and a seat tile reading zero is a support call. `??` and not `||` throughout:
 * zero is a legitimate seat count and must not fall through to the next branch.
 */

/** Org seats — the count the invitation refusal enforces. */
export function orgSeats(usage, sub) {
  const limit = usage?.max_users ?? sub?.max_users ?? null;
  const used = usage?.seats_used ?? usage?.user_count ?? 0;
  const pending = usage?.seats_pending ?? 0;

  /* `limit != null` deliberately — a limit of 0 is a real allowance meaning the
     org may seat nobody, and `!limit` would read it as unlimited. That is the
     same confusion `PahchanSeatCount.is_full` avoids with `limit is None` on the
     server, and it must not be reintroduced by the screen. */
  const full = limit != null && used >= limit;

  return {
    limit,
    used,
    pending,
    full,
    value: limit != null ? `${used} / ${limit}` : String(used),
    /* "Full" wins the one sub-label slot when both apply: it is the state that
       changes what the admin can do next. The pending count shows otherwise,
       because "5 / 15" with three invitations outstanding is really 5 of 12 that
       can still be handed to somebody new. */
    note: full ? 'Full' : pending ? `${pending} invited` : undefined,
  };
}

/** Attendance seats, or null for an org that does not run Pahchan.
 *
 *  NULL RATHER THAN A ZEROED SHAPE, so the caller renders no tile at all. A tile
 *  reading "0" on a firm that has never switched attendance on invites the
 *  question of what it is counting, and the honest answer is "nothing here". */
export function pahchanSeats(usage) {
  const p = usage?.pahchan;
  if (!p?.module_active) return null;

  const limit = p.max_seats ?? null;
  const used = p.seats_used ?? 0;
  const exempt = p.exempt ?? 0;
  const full = limit != null && used >= limit;

  return {
    limit,
    used,
    exempt,
    full,
    value: limit != null ? `${used} / ${limit}` : String(used),
    /* The exempt figure is worth a label because it is the number that surprises
       somebody: an org whose roster is 208 and whose attendance seats are 200
       will ask why 200 is "all of them". */
    note: full ? 'Full' : exempt ? `${exempt} also org users` : undefined,
  };
}
