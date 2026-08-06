/**
 * The toast action slot — Interaction Catalogue 4.3.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT WAS BROKEN
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `pushToast` built `{id, type, title, message}` from its argument and dropped
 * every other key on the floor, and the card rendered exactly one hardcoded
 * button reading "Dismiss". So across 572 call sites in 117 files there was no
 * way to express Undo or Retry — the five interactions that need one (2.4, 3.5,
 * 7.3, 10.2, 12.4) had nowhere to put it. The prototype's own note on 4.3 says
 * it: the toast "has no close button and no action slot — so Undo and Retry are
 * impossible to express."
 *
 * Two call sites were already passing `body:` for the server's error detail and
 * getting silence, which is the same defect one layer down: an unread key is
 * indistinguishable from a key that works.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE THREE THINGS THAT ARE EASY TO GET WRONG
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 1. A toast must NOT take focus. It fires in response to something the user
 *    did elsewhere — usually while they are still typing. Autofocusing the card
 *    would be a worse bug than the one the slot fixes.
 * 2. It must still be REACHABLE by keyboard before it expires. The stack renders
 *    after every landmark on the page, so Tab arrives only after traversing the
 *    whole document; on a 4s timer that is not a route. F6 is the route.
 * 3. Its timer must not run out while the user is on it. Reaching an Undo and
 *    watching it vanish under the cursor is the failure the slot exists to
 *    prevent.
 *
 * Rendered with react-dom directly rather than @testing-library/react: that
 * package is installed but its @testing-library/dom peer is not, so importing
 * it throws. Same reason as useDismiss.test.jsx.
 */

import React, { useEffect } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToastProvider, useToast, TOAST_LIFE_MS } from '../components/ui/toast';
import TaskDrawer from '../components/TaskDrawer';
import { installMockApi, installNetworkKillSwitch, restoreNetwork, makeHost, signIn, clearSession, users }
  from './e2e/_harness';

let container = null;
let root = null;

/**
 * Registered per-describe rather than at file level, because §6 mounts a real
 * screen through the e2e harness and that half needs real timers and real
 * microtask flushing. One set of file-wide hooks would have forced the two
 * halves into whichever regime suited neither.
 */
function toastHost() {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    container = null;
    vi.useRealTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });
}

/** Captures the context so a test can push toasts imperatively. */
let api = null;
function Grab() {
  const ctx = useToast();
  useEffect(() => { api = ctx; }, [ctx]);
  return <button id="elsewhere" type="button">elsewhere</button>;
}

const mount = () => act(() => {
  root.render(<ToastProvider><Grab /></ToastProvider>);
});

const push = (t) => {
  let id;
  act(() => { id = api.pushToast(t); });
  return id;
};

const $  = (sel) => container.querySelector(sel);
const $$ = (sel) => [...container.querySelectorAll(sel)];
const card = () => $('.tst');
const actionBtn = () => $('[data-toast-action]');
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });

/** Dismiss animates out; `animationend` never fires in jsdom, so the provider's
 *  1s safety net is what actually unmounts the node here. */
const settle = () => tick(1200);

const pressKey = (key, opts = {}) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
});

/* ══════════════════════════════════════════════════════════════════════════
   1 · The 572 existing call sites are untouched
   ══════════════════════════════════════════════════════════════════════════ */

describe('toast · the action slot is additive', () => {
  toastHost();

  it('a toast with no action renders exactly what it always did', () => {
    mount();
    push({ type: 'success', title: 'Saved', message: 'All good' });

    expect($('.tst__t').textContent).toBe('Saved');
    expect($('.tst__s').textContent).toBe('All good');
    expect(actionBtn()).toBeNull();
    // The one button that was always there is still the only one.
    expect($$('.tst button').map(b => b.textContent)).toEqual(['Dismiss']);
  });

  it('the shorthand helpers still work and still take no action', () => {
    mount();
    act(() => { api.error('Boom'); });
    expect($('.tst__t').textContent).toBe('Boom');
    expect(actionBtn()).toBeNull();
  });

  it('a malformed action is no action, not a button that throws', () => {
    mount();
    // Every shape a call site could plausibly get wrong.
    push({ title: 'a', action: { label: 'Undo' } });                 // no handler
    push({ title: 'b', action: { onAction: () => {} } });            // no label
    push({ title: 'c', action: { label: '   ', onAction: () => {} } }); // blank label
    expect($$('[data-toast-action]')).toEqual([]);
    expect($$('.tst').length).toBe(3);
  });

  it('`body` is read as the message — the key two call sites were already passing', () => {
    mount();
    push({ type: 'error', title: 'Could not add field', body: 'Column already exists' });
    expect($('.tst__s').textContent).toBe('Column already exists');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · The action itself
   ══════════════════════════════════════════════════════════════════════════ */

describe('toast · the action renders and fires', () => {
  toastHost();

  it('renders the label, and BEFORE Dismiss', () => {
    mount();
    push({ title: 'Comment deleted', action: { label: 'Undo', onAction: () => {} } });

    const labels = $$('.tst button').map(b => b.textContent);
    // Order is the whole point: one Tab from the card must land on the button
    // that recovers the deletion, not on the one that throws the offer away.
    expect(labels).toEqual(['Undo', 'Dismiss']);
    expect(actionBtn().className).toContain('tst__act');
  });

  it('Dismiss is demoted only when it stands next to an action', () => {
    mount();
    push({ title: 'plain' });
    expect($('.tst__a').className).not.toContain('tst__a--quiet');

    act(() => root.unmount());
    root = createRoot(container);
    mount();
    push({ title: 'with action', action: { label: 'Undo', onAction: () => {} } });
    expect($('.tst__a').className).toContain('tst__a--quiet');
  });

  it('clicking it runs the handler and closes the toast', () => {
    mount();
    const onAction = vi.fn();
    push({ title: 'Comment deleted', action: { label: 'Undo', onAction } });

    act(() => { actionBtn().click(); });
    expect(onAction).toHaveBeenCalledTimes(1);
    settle();
    expect(card()).toBeNull();
  });

  it('dismissOnAction:false keeps the toast up — for a Retry that may fail again', () => {
    mount();
    const onAction = vi.fn();
    push({ type: 'error', title: 'Upload failed', action: { label: 'Retry', onAction, dismissOnAction: false } });

    act(() => { actionBtn().click(); });
    expect(onAction).toHaveBeenCalledTimes(1);
    settle();
    expect(card()).toBeTruthy();
  });

  it('an error toast with an action still never auto-dismisses (26 §9)', () => {
    mount();
    push({ type: 'error', title: 'Upload failed', action: { label: 'Retry', onAction: () => {} } });
    tick(30_000);
    expect(card()).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · Focus — the three things that are easy to get wrong
   ══════════════════════════════════════════════════════════════════════════ */

describe('toast · an actionable toast is reachable without being intrusive', () => {
  toastHost();

  it('does NOT steal focus when it appears', () => {
    mount();
    const elsewhere = $('#elsewhere');
    act(() => { elsewhere.focus(); });
    expect(document.activeElement).toBe(elsewhere);

    push({ title: 'Comment deleted', action: { label: 'Undo', onAction: () => {} } });

    // Still where the user left it. A toast fires while someone is typing.
    expect(document.activeElement).toBe(elsewhere);
  });

  it('F6 moves focus to the action', () => {
    mount();
    act(() => { $('#elsewhere').focus(); });
    push({ title: 'Comment deleted', action: { label: 'Undo', onAction: () => {} } });

    pressKey('F6');
    expect(document.activeElement).toBe(actionBtn());
  });

  it('F6 reaches the NEWEST actionable toast', () => {
    mount();
    push({ title: 'first',  action: { label: 'Undo first',  onAction: () => {} } });
    push({ title: 'second', action: { label: 'Undo second', onAction: () => {} } });

    pressKey('F6');
    expect(document.activeElement.textContent).toBe('Undo second');
  });

  it('F6 is left alone when nothing on screen has an action', () => {
    // The key stays free for whatever wants it next; the listener is only bound
    // while an actionable toast exists.
    mount();
    push({ title: 'Saved' });
    const before = document.activeElement;
    pressKey('F6');
    expect(document.activeElement).toBe(before);
  });

  it('a modified F6 is somebody else’s shortcut', () => {
    mount();
    act(() => { $('#elsewhere').focus(); });
    push({ title: 'x', action: { label: 'Undo', onAction: () => {} } });
    pressKey('F6', { ctrlKey: true });
    expect(document.activeElement).toBe($('#elsewhere'));
  });

  it('the timer does not expire while the action has focus', () => {
    mount();
    push({ title: 'Comment deleted', action: { label: 'Undo', onAction: () => {} } });

    tick(1000);
    pressKey('F6');                      // focus lands on Undo → timer pauses
    expect(document.activeElement).toBe(actionBtn());

    // Well past the 4s life. A user who has reached the Undo must not watch it
    // disappear out from under them.
    tick(TOAST_LIFE_MS.success * 3);
    expect(card()).toBeTruthy();
    expect(actionBtn()).toBeTruthy();
  });

  it('and it resumes — with the time that was left — once focus leaves', () => {
    mount();
    push({ title: 'Comment deleted', action: { label: 'Undo', onAction: () => {} } });

    tick(1000);                          // 3000ms left
    pressKey('F6');
    tick(60_000);                        // parked on it for a minute
    act(() => { $('#elsewhere').focus(); });

    tick(2000);                          // 2000 of the remaining 3000
    expect(card(), 'resumed with the wrong remaining time').toBeTruthy();
    tick(1500);
    settle();
    expect(card()).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4 · The drain bar — 4.3 "the dismissal is never a surprise"
   ══════════════════════════════════════════════════════════════════════════ */

describe('toast · the progress bar', () => {
  toastHost();

  it('carries the toast’s own life, so it cannot drift from the timer', () => {
    mount();
    push({ type: 'success', title: 'Saved' });
    const bar = $('.tst__bar');
    expect(bar).toBeTruthy();
    expect(bar.style.getPropertyValue('--tst-life')).toBe(`${TOAST_LIFE_MS.success}ms`);
  });

  it('warning drains over its own longer life, not the default', () => {
    mount();
    push({ type: 'warning', title: 'Careful' });
    expect($('.tst__bar').style.getPropertyValue('--tst-life')).toBe(`${TOAST_LIFE_MS.warning}ms`);
  });

  it('an error gets no bar at all — nothing is draining', () => {
    // A full bar that never moves is a worse lie than no bar.
    mount();
    push({ type: 'error', title: 'Boom' });
    expect($('.tst__bar')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5 · Screen readers get told the shortcut exists
   ══════════════════════════════════════════════════════════════════════════ */

describe('toast · the keyboard route is announced', () => {
  toastHost();

  it('an actionable toast announces how to reach the action', () => {
    mount();
    push({ title: 'Comment deleted', action: { label: 'Undo', onAction: () => {} } });
    // F6 is the only route in; a live region that does not mention it leaves a
    // screen-reader user with an announcement about an action they cannot get to.
    expect($('[aria-live="polite"]').textContent).toContain('Press F6 for Undo');
    expect(actionBtn().getAttribute('aria-keyshortcuts')).toBe('F6');
  });

  it('a plain toast says nothing about F6', () => {
    mount();
    push({ title: 'Saved' });
    expect($('[aria-live="polite"]').textContent).toBe('Saved');
  });

  it('errors are still assertive', () => {
    mount();
    push({ type: 'error', title: 'Boom', action: { label: 'Retry', onAction: () => {} } });
    expect($('[aria-live="assertive"]').textContent).toContain('Boom');
    expect($('[aria-live="polite"]').textContent).toBe('');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6 · A real user for the slot — TaskDrawer comment delete (3.5)
   ══════════════════════════════════════════════════════════════════════════
   A slot with no call site is the defect this run exists to stop repeating, so
   the first consumer is proved here against the real component and a real route
   table, not against a stub.

   3.5, verbatim: "Destructive-but-cheap actions get an undo, not a
   confirmation… DELETE is deferred until the toast expires, so undo is a
   client-side revert and costs no request." Before this, `deleteComment` was
   two lines — fire the DELETE, filter the row out — with no confirmation, no
   toast and no way back from a mis-click on an 11px icon.
   ══════════════════════════════════════════════════════════════════════════ */

const ME = users.staff();
const TASK = { task_id: 'task_x', title: 'File GSTR-3B', team_id: 'team_1', status: 'todo' };
const COMMENT = {
  comment_id: 'cm_1', body: 'Checked against the portal', user_id: ME.user_id,
  user_name: ME.full_name, created_at: '2026-08-01T09:00:00Z',
};

const drawerRoutes = (over = {}) => ({
  'GET /categories': [],
  'GET /tasks/:id': TASK,
  'GET /tasks/:id/comments': [COMMENT],
  'GET /activity/task/:id': [],
  'GET /time/task/:id': { entries: [], active_entry: null },
  'GET /projects/:teamId/columns': [],
  'GET /teams/:teamId': { members: [] },
  'GET /fields/team/:teamId': [],
  'GET /fields/task/:id/values': [],
  'DELETE /tasks/:id/comments/:cid': { ok: true },
  ...over,
});

describe('e2e · comment delete offers a real Undo (3.5)', () => {
  let host;

  beforeEach(async () => {
    installNetworkKillSwitch();
    clearSession();
    signIn(ME);
    host = makeHost();
  });

  afterEach(() => {
    host.unmount();
    clearSession();
    vi.restoreAllMocks();
    restoreNetwork();
  });

  /** Mount the drawer, reach the Comments tab, return the row's delete control. */
  async function openComments() {
    await host.mount(<TaskDrawer taskId="task_x" open onClose={() => {}} />);
    const tab = host.$$('button').find(b => /comments/i.test(b.textContent));
    if (tab) await host.click(tab);
    const del = host.$(`[aria-label="Delete comment by ${ME.full_name}"]`);
    expect(del, 'no delete control on the comment row').toBeTruthy();
    return del;
  }

  async function openCommentsAndDelete() {
    await host.click(await openComments());
  }

  it('removes the row, offers Undo, and sends NO request yet', async () => {
    const mock = installMockApi(drawerRoutes());
    await openCommentsAndDelete();

    // Gone from the list…
    expect(host.text()).not.toContain('Checked against the portal');
    // …and the toast carries the way back.
    const undo = host.$('[data-toast-action]');
    expect(undo, 'the delete pushed no actionable toast').toBeTruthy();
    expect(undo.textContent).toBe('Undo');
    // The whole point of 3.5: nothing has been sent. Undo costs no request
    // because the request has not left yet.
    expect(mock.calledWith('DELETE')).toHaveLength(0);
  });

  it('Undo puts the comment back and the DELETE is never sent', async () => {
    const mock = installMockApi(drawerRoutes());
    await openCommentsAndDelete();

    await host.click(host.$('[data-toast-action]'));

    expect(host.text()).toContain('Checked against the portal');
    expect(mock.calledWith('DELETE')).toHaveLength(0);
  });

  it('left alone, the delete commits when the toast expires', async () => {
    const mock = installMockApi(drawerRoutes());
    const del = await openComments();

    /**
     * Fake timers go in AFTER the mount and BEFORE the click.
     *
     * After, because the mount resolves a dozen route promises and needs real
     * microtask flushing. Before, because the commit timer is armed BY the
     * click — an earlier version installed them afterwards and advanced a clock
     * that governed nothing, then reported "the delete never committed" about
     * a component that was working. `toFake` is narrowed to the timer functions
     * so promises still settle normally.
     */
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      await host.click(del);
      expect(mock.calledWith('DELETE')).toHaveLength(0);

      await act(async () => {
        vi.advanceTimersByTime(TOAST_LIFE_MS.success + 50);
        await Promise.resolve();
      });
      expect(mock.calledWith('DELETE', '/tasks/task_x/comments/cm_1')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closing the drawer inside the window commits rather than cancels', async () => {
    // Otherwise the comment is gone from the screen and alive on the server —
    // it would reappear on the next open, which reads as the delete having been
    // ignored.
    const mock = installMockApi(drawerRoutes());
    await openCommentsAndDelete();
    expect(mock.calledWith('DELETE')).toHaveLength(0);

    host.unmount();
    host = makeHost();               // so afterEach has something to unmount

    expect(mock.calledWith('DELETE', '/tasks/task_x/comments/cm_1')).toHaveLength(1);
  });
});
