/**
 * The seat figures two billing screens render — `org/seatFigures.js`.
 *
 * Pure, and tested directly rather than through either screen. `TabBilling` and
 * `AdminBillingPage` both fetch in `useEffect` and render a dozen components
 * between them, so a rendered assertion would prove that a tile appeared and
 * almost nothing about which number is in it. The decision worth pinning is
 * WHICH FIELD IS THE ENFORCED ONE, and that is arithmetic.
 *
 * The values below are the live database, measured read-only 2026-08-06:
 * Unicode Group is 5 joined of 15 with nothing pending; the E2E org is 6 joined
 * with 7 invitations outstanding, which is the case the old tile got wrong.
 */
import { describe, it, expect } from 'vitest';
import { orgSeats, pahchanSeats } from '../seatFigures';

describe('orgSeats', () => {
  it('shows the enforced figure, which counts pending invitations', () => {
    /* THE BUG THIS FILE EXISTS FOR. The E2E org: `user_count` 6, `seats_used`
       13. A tile rendering 6 tells an admin they have room for seven more when
       the refusal will admit none. */
    const s = orgSeats({ user_count: 6, seats_used: 13, seats_pending: 7, max_users: 13 });
    expect(s.used).toBe(13);
    expect(s.value).toBe('13 / 13');
    expect(s.full).toBe(true);
  });

  it('falls back to user_count when the API predates seats_used', () => {
    /* Deploy order, not preference — this bundle can reach an older backend. */
    const s = orgSeats({ user_count: 5, max_users: 15 });
    expect(s.value).toBe('5 / 15');
  });

  it('keeps a genuine zero rather than falling through it', () => {
    /* `??` and not `||`. A brand-new org really does have 0 seats used, and
       `||` would skip past it to `user_count` — which on a fresh org is also 0,
       so the bug hides until the two fields legitimately differ. */
    const s = orgSeats({ seats_used: 0, user_count: 6, max_users: 15 });
    expect(s.used).toBe(0);
  });

  it('reads the ceiling from usage before the subscription payload', () => {
    /* /usage sources it from `count_seats`, which is the counter the refusal
       uses. /current is a different query and was the one that disagreed. */
    const s = orgSeats({ seats_used: 5, max_users: 15 }, { max_users: 99 });
    expect(s.value).toBe('5 / 15');
  });

  it('still shows a count when no ceiling is set anywhere', () => {
    /* Two of the three live orgs have max_users NULL — unlimited. "5" and not
       "5 / null". */
    const s = orgSeats({ seats_used: 5 }, null);
    expect(s.value).toBe('5');
    expect(s.full).toBe(false);
  });

  it('treats a zero ceiling as a real cap and not as unlimited', () => {
    const s = orgSeats({ seats_used: 0, max_users: 0 });
    expect(s.full).toBe(true);
  });

  it('labels Full ahead of the pending count when both apply', () => {
    /* One sub-label slot. "Full" is the state that changes what the admin can
       do next. */
    expect(orgSeats({ seats_used: 15, seats_pending: 3, max_users: 15 }).note).toBe('Full');
    expect(orgSeats({ seats_used: 5, seats_pending: 3, max_users: 15 }).note).toBe('3 invited');
    expect(orgSeats({ seats_used: 5, max_users: 15 }).note).toBeUndefined();
  });

  it('survives a usage payload that never arrived', () => {
    const s = orgSeats(null, null);
    expect(s.used).toBe(0);
    expect(s.full).toBe(false);
  });
});

describe('pahchanSeats', () => {
  it('is null for an org that does not run attendance', () => {
    /* No tile at all. A tile reading 0 on a firm that never switched attendance
       on invites the question of what it is counting. */
    expect(pahchanSeats({ pahchan: { module_active: false, seats_used: 0 } })).toBeNull();
    expect(pahchanSeats({})).toBeNull();
    expect(pahchanSeats(null)).toBeNull();
  });

  it('shows used against the attendance cap', () => {
    const p = pahchanSeats({ pahchan: { module_active: true, seats_used: 200, max_seats: 200 } });
    expect(p.value).toBe('200 / 200');
    expect(p.full).toBe(true);
  });

  it('shows a bare count while no attendance cap is set', () => {
    /* Every live org today — the column does not exist until migration 109. */
    const p = pahchanSeats({ pahchan: { module_active: true, seats_used: 71 } });
    expect(p.value).toBe('71');
    expect(p.full).toBe(false);
  });

  it('names the exempt employees, who are the surprising number', () => {
    /* The owner's example. Roster 208, attendance seats 200, because 8 of them
       are org users already paid for under the other tile. */
    const p = pahchanSeats({
      pahchan: { module_active: true, seats_used: 200, max_seats: 250, exempt: 8 },
    });
    expect(p.note).toBe('8 also org users');
  });

  it('never adds the two counts together', () => {
    /* The whole point of the split. 8 org seats and 200 attendance seats must
       stay two numbers — a 208 anywhere on either screen is the failure. */
    const usage = {
      seats_used: 8, max_users: 8,
      pahchan: { module_active: true, seats_used: 200, max_seats: 200 },
    };
    const org = orgSeats(usage, null);
    const att = pahchanSeats(usage);
    expect(org.used).toBe(8);
    expect(att.used).toBe(200);
    expect(org.value).not.toContain('208');
    expect(att.value).not.toContain('208');
  });
});
