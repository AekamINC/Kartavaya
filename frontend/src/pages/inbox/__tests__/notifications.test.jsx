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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IST_OFFSET_MIN, inQuietHours, ingestNotifications, istMinutes,
  resetNotifications, useNotifications,
} from '../../../context/NotificationContext';
import {
  countForTab, filterByTab, groupKeyOf, kindKeyOf, kindOf, NEUTRAL_KIND,
} from '../notifKinds';

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
});

describe('nine kinds, not eight', () => {
  it.each(['status_changed', 'done', 'created'])(
    'leaves %s uncategorised rather than inventing a mapping', (type) => {
      expect(kindKeyOf({ type })).toBeNull();
      expect(kindOf({ type })).toBe(NEUTRAL_KIND);
    });

  it('does not let approval_request fall into approved', () => {
    expect(kindKeyOf({ type: 'approval_request' })).toBe('approval');
    expect(kindKeyOf({ type: 'approved' })).toBe('approved');
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
