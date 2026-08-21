/**
 * The two things in this subtree worth a regression test: the identity purge,
 * because getting it wrong shows one user another user's mail, and the
 * quiet-hours arithmetic, because it has to agree with a Python function in
 * another process that nothing else compares it against.
 *
 * Rendered with react-dom directly rather than @testing-library/react, for the
 * reason `src/__tests__/useDismiss.test.jsx` already records: that package is
 * installed but its @testing-library/dom peer is not, so importing it throws.
 *
 * Nothing here touches the network or a timer.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IST_OFFSET_MIN, PAGE_SIZE, inQuietHours, ingestNotifications, istMinutes,
  loadMoreNotifications, markAllNotificationsRead, markNotificationsRead,
  refreshNotifications, resetNotifications, useNotifications,
} from '../../../context/NotificationContext';
import { api } from '../../../lib/api';
import {
  countForTab, filterByTab, groupKeyOf, kindKeyOf, kindOf, NEUTRAL_KIND,
} from '../notifKinds';

vi.mock('../../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

const signIn = (id) => localStorage.setItem('Kartavaya_user', JSON.stringify({ user_id: id }));
const signOut = () => localStorage.removeItem('Kartavaya_user');

const notif = (id, over = {}) => ({
  notification_id: id, type: 'assigned', title: `n${id}`, read_at: null,
  created_at: new Date().toISOString(), ...over,
});

/** A UTC instant that reads as `hh:mm` on an IST wall clock. */
const atIST = (h, m = 0) => {
  const total = (h * 60 + m - IST_OFFSET_MIN + 1440) % 1440;
  return new Date(Date.UTC(2026, 0, 15, Math.floor(total / 60), total % 60));
};

let bag = null;
let root = null;
let container = null;

function Probe() {
  bag = useNotifications({ autoLoad: false });
  return null;
}

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Probe />); });
}

function rerender() {
  act(() => { root.render(<Probe key={Math.random()} />); });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  resetNotifications();
  bag = null;
  api.get.mockReset();
  api.post.mockReset();
});

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  root = null;
  container = null;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('the cache belongs to exactly one signed-in user', () => {
  it("drops another user's notifications before they can be rendered", () => {
    signIn('user-a');
    mount();

    act(() => { ingestNotifications([notif('a1'), notif('a2')]); });
    expect(bag.items).toHaveLength(2);
    expect(bag.unread).toBe(2);

    // Sign out, sign in as somebody else — same tab, no reload. That is the
    // exact sequence that leaked: the store is module-level, and a module
    // outlives a session.
    signOut();
    signIn('user-b');
    rerender();

    expect(bag.items).toEqual([]);
    expect(bag.unread).toBe(0);
  });

  it('keeps them across a re-render for the SAME user', () => {
    signIn('user-a');
    mount();
    act(() => { ingestNotifications([notif('a1')]); });
    rerender();
    expect(bag.items).toHaveLength(1);
  });

  it('refuses to ingest into a cache that has changed hands', () => {
    signIn('user-a');
    ingestNotifications([notif('a1')]);
    signIn('user-b');
    ingestNotifications([notif('b1')]);
    mount();
    expect(bag.items.map((n) => n.notification_id)).toEqual(['b1']);
  });
});

describe('quiet hours match push_service._in_quiet_hours', () => {
  const overnight = { loaded: true, start: '22:00', end: '07:00', modes: {} };
  const daytime = { loaded: true, start: '09:00', end: '17:00', modes: {} };

  it('reads the clock in IST, not in the device zone', () => {
    expect(istMinutes(new Date(Date.UTC(2026, 0, 15, 18, 30)))).toBe(0);
    expect(istMinutes(new Date(Date.UTC(2026, 0, 15, 6, 30)))).toBe(12 * 60);
  });

  it('wraps midnight — the case the whole window exists for', () => {
    expect(inQuietHours(overnight, atIST(23, 0))).toBe(true);
    expect(inQuietHours(overnight, atIST(3, 0))).toBe(true);
    expect(inQuietHours(overnight, atIST(6, 59))).toBe(true);
    expect(inQuietHours(overnight, atIST(7, 0))).toBe(false);   // end exclusive
    expect(inQuietHours(overnight, atIST(21, 59))).toBe(false);
    expect(inQuietHours(overnight, atIST(22, 0))).toBe(true);   // start inclusive
  });

  it('handles a same-day window', () => {
    expect(inQuietHours(daytime, atIST(12, 0))).toBe(true);
    expect(inQuietHours(daytime, atIST(8, 59))).toBe(false);
    expect(inQuietHours(daytime, atIST(17, 0))).toBe(false);
  });

  it('silences nothing when the window is empty', () => {
    const empty = { loaded: true, start: '07:00', end: '07:00', modes: {} };
    expect(inQuietHours(empty, atIST(7, 0))).toBe(false);
    expect(inQuietHours(empty, atIST(3, 0))).toBe(false);
  });

  it('never claims quiet hours before the window has been read back', () => {
    signIn('user-a');
    mount();
    expect(bag.quiet.loaded).toBe(false);
    expect(bag.inQuiet).toBe(false);
  });

  /* PARITY WITH push_service._in_quiet_hours.
     The identical table is asserted in backend/tests/test_quiet_hours.py under
     `PARITY`. Two implementations of one rule in two languages in two
     processes; nothing but this pair compares them. Change one, both fail. */
  const PARITY = [
    ['22:00', '07:00', 23,  0, true],
    ['22:00', '07:00',  3,  0, true],
    ['22:00', '07:00',  6, 59, true],
    ['22:00', '07:00',  7,  0, false],
    ['22:00', '07:00', 21, 59, false],
    ['22:00', '07:00', 22,  0, true],
    ['22:00', '07:00',  0,  0, true],
    ['09:00', '17:00', 12,  0, true],
    ['09:00', '17:00',  8, 59, false],
    ['09:00', '17:00', 17,  0, false],
    ['09:00', '17:00',  0,  0, false],
    ['07:00', '07:00',  7,  0, false],
    ['07:00', '07:00',  3,  0, false],
    ['00:00', '23:59',  0,  0, true],
    ['00:00', '23:59', 23, 59, false],
    ['22:00', '22:01', 22,  0, true],
    ['22:00', '22:01', 22,  1, false],
  ];

  it.each(PARITY)(
    'agrees with the Python gate: %s-%s at %i:%i → %s',
    (start, end, h, m, quiet) => {
      expect(inQuietHours({ loaded: true, start, end, modes: {} }, atIST(h, m))).toBe(quiet);
    });

  it('an overnight window silences 540 of the 1440 minutes, not 0', () => {
    // The regression guard, mirrored from the Python side. A naive
    // `from <= m && m < to` returns false for every minute of 22:00–07:00 and
    // the schedule silences nothing at all.
    let silenced = 0;
    for (let t = 0; t < 1440; t += 1) {
      if (inQuietHours(overnight, atIST(Math.floor(t / 60), t % 60))) silenced += 1;
    }
    expect(silenced).toBe(540);   // 120 minutes before midnight + 420 after
  });
});

describe('nine kinds, not eight', () => {
  it.each(['status_changed', 'done', 'created', 'workload_warning', 'automation'])(
    'leaves %s uncategorised rather than inventing a mapping', (type) => {
      expect(kindKeyOf({ type })).toBeNull();
      expect(kindOf({ type })).toBe(NEUTRAL_KIND);
    });

  it('does not let approval_request fall into approved', () => {
    expect(kindKeyOf({ type: 'approval_request' })).toBe('approval');
    expect(kindKeyOf({ type: 'approved' })).toBe('approved');
  });

  /* EVERY TYPE THE BACKEND WRITES, enumerated from the writers rather than
     from this file. Each entry is an `INSERT INTO notifications` whose `type`
     column is the literal on the left. If a new emitter lands without a branch
     here, this is where it should fail. */
  it.each([
    // backend/server.py
    ['approval_request',    'approval'],
    ['approved',            'approved'],
    ['rejected',            'rejected'],
    ['comment',             'comment'],
    ['assigned',            'assigned'],
    ['reminder',            'due'],
    // backend/services/mentions.py
    ['mention',             'mention'],
    // backend/approvals_router.py — the string it wrote before normalisation.
    // Rows already in the table still carry it, so it must keep resolving.
    ['request',             'approval'],
    // backend/services/agents/deadline_agent.py
    ['deadline_warning',    'due'],
    ['deadline_escalation', 'due'],
    // backend/services/samvaad_message_notify.py
    ['message',             'message'],
  ])('maps the backend type %s to the %s kind', (type, key) => {
    expect(kindKeyOf({ type })).toBe(key);
  });

  it('puts an approval request in the Approvals tab whichever name it carries', () => {
    // The defect this fixes: `POST /tasks/{id}/request-approval` wrote
    // type='request', which matched nothing, so the notification asking for a
    // reviewer's decision was MISSING from the tab whose entire job is to list
    // pending decisions. It rendered — with a neutral dot, under All — which is
    // exactly why nobody noticed.
    const items = [notif('r', { type: 'request' }), notif('a', { type: 'approval_request' })];
    expect(filterByTab(items, 'approvals').map((n) => n.notification_id)).toEqual(['r', 'a']);
  });

  it('files deadline warnings under Due soon, not under a neutral dot', () => {
    expect(kindOf({ type: 'deadline_warning' }).en).toBe('Due soon');
    expect(kindOf({ type: 'deadline_escalation' }).en).toBe('Due soon');
  });

  it('counts and filters every tab off the one array', () => {
    const items = [
      notif('1', { type: 'mention' }),
      notif('2', { type: 'assigned', read_at: '2026-01-01T00:00:00Z' }),
      notif('3', { type: 'approval_request' }),
      notif('4', { type: 'status_changed' }),
    ];
    expect(countForTab(items, 'all')).toBe(4);
    expect(countForTab(items, 'unread')).toBe(3);
    expect(filterByTab(items, 'approvals').map((n) => n.notification_id)).toEqual(['3']);
    expect(filterByTab(items, 'mentions').map((n) => n.notification_id)).toEqual(['1']);
    expect(filterByTab(items, 'assigned').map((n) => n.notification_id)).toEqual(['2']);
  });
});

describe('grouping is by calendar day, not elapsed hours', () => {
  it('calls 23:50 "yesterday" at 00:10, not "20m ago, today"', () => {
    const now = new Date('2026-01-15T00:10:00');
    expect(groupKeyOf('2026-01-14T23:50:00', now)).toBe('yesterday');
    expect(groupKeyOf('2026-01-15T00:00:00', now)).toBe('today');
    expect(groupKeyOf('2026-01-11T12:00:00', now)).toBe('week');
    expect(groupKeyOf('2025-12-01T12:00:00', now)).toBe('earlier');
  });

  it('does not throw on an unparseable timestamp', () => {
    expect(groupKeyOf('not-a-date')).toBe('earlier');
  });
});

/* ── Paging ──────────────────────────────────────────────────────────────── */

/** `n` rows, oldest last, the order the endpoint returns them in. */
const page = (from, count) => Array.from({ length: count }, (_, i) => notif(`n${from + i}`, {
  created_at: new Date(Date.UTC(2026, 0, 15, 12, 0, 0) - (from + i) * 60_000).toISOString(),
}));

describe('pagination is keyset, and hits the real endpoint', () => {
  it('asks for one page, not the whole 200-row cap', async () => {
    signIn('user-a');
    api.get.mockResolvedValue({ data: page(0, PAGE_SIZE) });
    await refreshNotifications({ force: true });

    expect(api.get).toHaveBeenCalledWith('/notifications', { params: { limit: PAGE_SIZE } });
  });

  it('sends the oldest row it holds as the cursor — both halves of it', async () => {
    signIn('user-a');
    const first = page(0, PAGE_SIZE);
    api.get.mockResolvedValueOnce({ data: first });
    await refreshNotifications({ force: true });

    api.get.mockResolvedValueOnce({ data: page(PAGE_SIZE, 5) });
    await loadMoreNotifications();

    const last = first[first.length - 1];
    expect(api.get).toHaveBeenLastCalledWith('/notifications', {
      params: {
        limit: PAGE_SIZE,
        before: last.created_at,
        // `created_at` alone is not unique — a status change or a reminder
        // sweep inserts a row per recipient inside one loop, so a batch shares
        // a timestamp. Without the id the cursor can sit mid-batch and drop or
        // repeat its neighbours.
        before_id: last.notification_id,
      },
    });
  });

  it('appends the page rather than replacing the list', async () => {
    signIn('user-a');
    api.get.mockResolvedValueOnce({ data: page(0, PAGE_SIZE) });
    await refreshNotifications({ force: true });
    api.get.mockResolvedValueOnce({ data: page(PAGE_SIZE, 5) });
    await loadMoreNotifications();

    mount();
    expect(bag.items).toHaveLength(PAGE_SIZE + 5);
    expect(bag.items[0].notification_id).toBe('n0');
    expect(bag.items[bag.items.length - 1].notification_id).toBe(`n${PAGE_SIZE + 4}`);
  });

  it('a short page is the last page', async () => {
    signIn('user-a');
    api.get.mockResolvedValueOnce({ data: page(0, PAGE_SIZE) });
    await refreshNotifications({ force: true });
    mount();
    expect(bag.hasMore).toBe(true);

    api.get.mockResolvedValueOnce({ data: page(PAGE_SIZE, 3) });
    await act(async () => { await loadMoreNotifications(); });
    expect(bag.hasMore).toBe(false);
  });

  it('does not page past the end', async () => {
    signIn('user-a');
    api.get.mockResolvedValueOnce({ data: page(0, 3) });   // short first page
    await refreshNotifications({ force: true });
    api.get.mockClear();

    await loadMoreNotifications();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('drops a row the poll already delivered rather than rendering it twice', async () => {
    signIn('user-a');
    const first = page(0, PAGE_SIZE);
    api.get.mockResolvedValueOnce({ data: first });
    await refreshNotifications({ force: true });

    // The server's cursor is exclusive, but a row can arrive by the poll
    // between the two requests. A duplicate key is a React warning and a row
    // the user reads twice.
    const overlap = [first[first.length - 1], ...page(PAGE_SIZE, 2)];
    api.get.mockResolvedValueOnce({ data: overlap });
    await loadMoreNotifications();

    mount();
    const ids = bag.items.map((n) => n.notification_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(bag.items).toHaveLength(PAGE_SIZE + 2);
  });

  it('a failed page keeps the list and reports itself separately', async () => {
    signIn('user-a');
    api.get.mockResolvedValueOnce({ data: page(0, PAGE_SIZE) });
    await refreshNotifications({ force: true });
    mount();

    api.get.mockRejectedValueOnce(new Error('gateway'));
    await act(async () => { await loadMoreNotifications(); });

    // Nothing taken away, and NOT raised as the page-level error state.
    expect(bag.items).toHaveLength(PAGE_SIZE);
    expect(bag.pageError).toBeTruthy();
    expect(bag.error).toBeNull();
    expect(bag.loadingMore).toBe(false);
  });

  it('a refresh resets paging rather than splicing a fresh page one onto stale pages', async () => {
    signIn('user-a');
    api.get.mockResolvedValueOnce({ data: page(0, PAGE_SIZE) });
    await refreshNotifications({ force: true });
    api.get.mockResolvedValueOnce({ data: page(PAGE_SIZE, 5) });
    await loadMoreNotifications();

    api.get.mockResolvedValueOnce({ data: page(0, 4) });
    await refreshNotifications({ force: true });

    mount();
    expect(bag.items).toHaveLength(4);
    expect(bag.hasMore).toBe(false);
  });
});

/* ── Optimistic reads ────────────────────────────────────────────────────── */

describe('marking read is optimistic and does not lie', () => {
  const seed = async (items) => {
    api.get.mockResolvedValueOnce({ data: items });
    await refreshNotifications({ force: true });
  };

  it('sends one request shape, never both keys at once', async () => {
    signIn('user-a');
    await seed([notif('a'), notif('b')]);
    api.post.mockResolvedValue({ data: { ok: true } });

    await markNotificationsRead('a');
    expect(api.post).toHaveBeenLastCalledWith('/notifications/mark-read', { notification_ids: ['a'] });

    await markAllNotificationsRead();
    expect(api.post).toHaveBeenLastCalledWith('/notifications/mark-read', { mark_all: true });
  });

  it('moves the badge on the click, not on the response', async () => {
    signIn('user-a');
    await seed([notif('a'), notif('b')]);
    mount();
    expect(bag.unread).toBe(2);

    let resolve;
    api.post.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    let done;
    act(() => { done = markNotificationsRead('a'); });
    expect(bag.unread).toBe(1);            // before the response

    await act(async () => { resolve({ data: {} }); await done; });
    expect(bag.unread).toBe(1);
  });

  it('reverts when the write fails, and SAYS SO', async () => {
    signIn('user-a');
    await seed([notif('a'), notif('b')]);
    mount();

    api.post.mockRejectedValueOnce(new Error('500'));
    await act(async () => { await markNotificationsRead('a'); });

    expect(bag.unread).toBe(2);
    expect(bag.items.find((n) => n.notification_id === 'a').read_at).toBeNull();
    // A silent revert is its own untruth: rows the user just cleared quietly
    // reappear and the only conclusion available is that the product is broken.
    expect(bag.mutationError).toBeTruthy();
    // …and it is NOT the page-level fetch error, which would raise a failure
    // card over a list that is entirely fine.
    expect(bag.error).toBeNull();
  });

  it('mark-all reverts every row it set and no others', async () => {
    signIn('user-a');
    await seed([notif('a'), notif('b', { read_at: '2026-01-01T00:00:00Z' })]);
    mount();

    api.post.mockRejectedValueOnce(new Error('500'));
    await act(async () => { await markAllNotificationsRead(); });

    expect(bag.items.find((n) => n.notification_id === 'a').read_at).toBeNull();
    // `b` was already read before the click. The rollback must not un-read it.
    expect(bag.items.find((n) => n.notification_id === 'b').read_at).toBe('2026-01-01T00:00:00Z');
  });

  it('a rollback does not delete a notification that arrived mid-flight', async () => {
    // THE BUG THIS PINS. Both mutations used to revert with the array snapshot
    // taken before the request. The poll prepends to that same array every 60
    // seconds, so a notification arriving during the round trip was destroyed
    // by the rollback of an unrelated failed click — a notification silently
    // lost, by the list whose whole purpose is not to lose them.
    signIn('user-a');
    await seed([notif('a')]);
    mount();

    let reject;
    api.post.mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
    let done;
    act(() => { done = markNotificationsRead('a'); });

    act(() => { ingestNotifications([notif('arrived-mid-flight')]); });

    await act(async () => { reject(new Error('500')); await done; });

    expect(bag.items.map((n) => n.notification_id)).toContain('arrived-mid-flight');
    expect(bag.items.find((n) => n.notification_id === 'a').read_at).toBeNull();
  });

  it('does not fire a request when nothing is unread', async () => {
    signIn('user-a');
    await seed([notif('a', { read_at: '2026-01-01T00:00:00Z' })]);
    await markAllNotificationsRead();
    await markNotificationsRead('a');
    expect(api.post).not.toHaveBeenCalled();
  });
});
