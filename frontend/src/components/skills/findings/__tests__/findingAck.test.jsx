/**
 * The control that stops a skill repeating the same list for ever.
 *
 * ── What is being guarded ────────────────────────────────────────────────────
 *
 * `staging.skill_finding_ack` held ZERO rows on 2026-08-27, against a mechanism
 * that had been complete on the server since proposal 70: the identity/material
 * split, 32 wired skills, two endpoints and a filter in the dispatcher.
 * `grep "findings/ack" frontend/src` returned nothing. The whole feature was
 * one missing button, and every check skill repeated the same findings on every
 * run because of it.
 *
 * So the assertions here are on the things that would put the zero back, not on
 * markup:
 *
 *   §1  THE KEY IS HANDED BACK, NEVER DERIVED. The POST body must carry the
 *       `_ack_key`, `_ack_state` and `_ack_label` the server attached, byte for
 *       byte. A client that computed its own would file the acknowledgement
 *       under a key the server's filter never looks up — an ack that appears to
 *       work and suppresses nothing, for ever, with a healthy-looking table.
 *   §2  A NULL STATE IS SENT AS NULL. It is a real value — an unconditional
 *       acknowledgement — and dropping the field would be the same request.
 *   §3  THE MACHINERY IS NOT A COLUMN. `_ack_key` is a 32-character digest and
 *       `columnsOf` takes whatever keys a row has.
 *   §4  A FAILED ACKNOWLEDGEMENT SAYS SO. The row is marked only after the
 *       server answers; a user who believes a finding is closed and meets it
 *       again next month is this module's whole failure mode.
 *   §5  THE ROW STAYS. Struck, not removed: the totals beside it were computed
 *       over the whole list and only the next run rebuilds them.
 *   §6  AN UNWIRED SKILL GETS NO CONTROL. 61 of the 93 registered skill
 *       functions are unwired and their rows carry no handle; a disabled
 *       button would read as "you are not allowed to", which is untrue.
 *   §7  THE ACKNOWLEDGED BLOCK IS RENDERED AND NAMES NO USER. A list that
 *       silently shrinks is indistinguishable from a query that broke — and
 *       `items[].by` is a user handle, which is never drawn.
 *
 * `createRoot` + `act` rather than @testing-library/react: it is installed and
 * its @testing-library/dom peer is not, so importing it throws. Same constraint
 * `skillFindings.test.jsx` records.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const posts = [];
const deletes = [];
let nextResult = () => Promise.resolve({ data: { ok: true } });

vi.mock('../../../../lib/api', () => ({
  api: {
    post: (...args) => { posts.push(args); return nextResult(); },
    delete: (...args) => { deletes.push(args); return nextResult(); },
  },
}));

const Findings = (await import('../Findings')).default;
const { columnsOf, ackHandle, acknowledgedOf, splitFinding } = await import('../shape');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;

beforeEach(() => {
  posts.length = 0;
  deletes.length = 0;
  nextResult = () => Promise.resolve({ data: { ok: true } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const draw = el => { act(() => root.render(el)); return host; };
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
/** Let the awaited api call and the state update it causes both settle. */
const settle = async () => { await act(async () => { await Promise.resolve(); }); };

const STEPS = [{ order: 1, skill_function: 'propose_payment_run' }];

/** One wired finding, shaped as `routers/hub.py:_with_ack_keys` sends it. */
const bill = (over = {}) => ({
  bill: 'INV-2291',
  vendor: 'Sharma Traders',
  balance_due: 42000,
  days_past_due: 63,
  _ack_key: 'a33abe232980ce8683bb6576883b174f',
  _ack_state: '8ac69484ecbfa10884f50263e0240d6e',
  _ack_label: 'INV-2291 — Sharma Traders',
  ...over,
});

const run = (data, fn = 'propose_payment_run') => (
  <Findings steps={STEPS} outputs={[{ step: 1, skill_function: fn, status: 'ok', data }]} />
);

const dismissButton = el => [...el.querySelectorAll('button')]
  .find(b => b.textContent.trim() === 'Dismiss');
const undoButton = el => [...el.querySelectorAll('button')]
  .find(b => b.textContent.trim() === 'Undo');

/* ── §1 · The key is handed back, never derived ──────────────────────────── */

describe('the acknowledgement is filed under the SERVER’s key', () => {
  it('posts the key, state and label exactly as they arrived', async () => {
    const el = draw(run({ bills: [bill()] }));
    click(dismissButton(el));
    await settle();

    expect(posts).toHaveLength(1);
    const [path, body] = posts[0];
    expect(path).toBe('/v1/hub/org/skills/findings/ack');
    expect(body).toEqual({
      skill: 'propose_payment_run',
      key: 'a33abe232980ce8683bb6576883b174f',
      state: '8ac69484ecbfa10884f50263e0240d6e',
      label: 'INV-2291 — Sharma Traders',
    });
  });

  it('names the skill_function of the step, not the template', async () => {
    const el = draw(run({ rows: [bill()] }, 'check_msme_payment_clock'));
    click(dismissButton(el));
    await settle();
    expect(posts[0][1].skill).toBe('check_msme_payment_clock');
  });

  /* §2. `null` is an UNCONDITIONAL acknowledgement — the deliberate choice for
     a wiring with no material fields — and omitting the field would send the
     same request as sending null, so this is asserted on the key's presence. */
  it('sends a null state as null rather than dropping it', async () => {
    const el = draw(run({ bills: [bill({ _ack_state: null })] }));
    click(dismissButton(el));
    await settle();
    expect(Object.keys(posts[0][1])).toContain('state');
    expect(posts[0][1].state).toBeNull();
  });

  it('withdraws with the same skill and key on the query string', async () => {
    const el = draw(run({ bills: [bill()] }));
    click(dismissButton(el));
    await settle();
    click(undoButton(el));
    await settle();

    expect(deletes).toHaveLength(1);
    const [path, config] = deletes[0];
    expect(path).toBe('/v1/hub/org/skills/findings/ack');
    expect(config.params).toEqual({
      skill: 'propose_payment_run',
      key: 'a33abe232980ce8683bb6576883b174f',
    });
    // And the row is offered for dismissal again.
    expect(dismissButton(el)).toBeTruthy();
  });
});

/* ── §3 · The machinery is not content ───────────────────────────────────── */

describe('the ack fields are machinery, not columns', () => {
  it('keeps the digests out of the column list', () => {
    expect(columnsOf([bill()])).toEqual(['bill', 'vendor', 'balance_due', 'days_past_due']);
  });

  it('never renders a digest', () => {
    const el = draw(run({ bills: [bill()] }));
    expect(el.textContent).toContain('INV-2291');
    expect(el.textContent).not.toContain('a33abe232980ce8683bb6576883b174f');
    expect(el.textContent).not.toContain('8ac69484ecbfa10884f50263e0240d6e');
  });

  it('reads the handle off a row and refuses one that has none', () => {
    expect(ackHandle(bill())).toEqual({
      key: 'a33abe232980ce8683bb6576883b174f',
      state: '8ac69484ecbfa10884f50263e0240d6e',
      label: 'INV-2291 — Sharma Traders',
    });
    expect(ackHandle({ bill: 'INV-1' })).toBeNull();
    expect(ackHandle({ _ack_key: '' })).toBeNull();
    expect(ackHandle('not a row')).toBeNull();
  });
});

/* ── §4 · A failure is said out loud ─────────────────────────────────────── */

describe('an acknowledgement that did not record', () => {
  it('says so on the row and leaves it listed', async () => {
    nextResult = () => Promise.reject(new Error('boom'));
    const el = draw(run({ bills: [bill()] }));
    click(dismissButton(el));
    await settle();

    // The CONSEQUENCE, in the product's own words — `errText` only says what
    // went wrong ("No response from the server"), which leaves the reader to
    // work out whether the acknowledgement landed.
    expect(el.querySelector('.sk-fx__ack-err')).toBeTruthy();
    expect(el.textContent).toContain('Not acknowledged');
    // Not marked. The whole failure mode of this module is a finding the user
    // believes is closed and meets again next month.
    expect(el.querySelector('.sk-fx__row--ack')).toBeNull();
    expect(dismissButton(el)).toBeTruthy();
  });

  it('does not mark the row before the server has answered', async () => {
    let release;
    nextResult = () => new Promise(res => { release = res; });
    const el = draw(run({ bills: [bill()] }));
    click(dismissButton(el));
    await settle();

    expect(el.querySelector('.sk-fx__row--ack')).toBeNull();
    expect(el.textContent).toContain('Saving…');

    await act(async () => { release({ data: { ok: true } }); });
    expect(el.querySelector('.sk-fx__row--ack')).toBeTruthy();
  });
});

/* ── §5 · The row stays, struck ──────────────────────────────────────────── */

describe('a dismissed row is marked, not removed', () => {
  it('keeps the row and its figures on screen', async () => {
    const el = draw(run({ bills: [bill()], total_due: 42000 }));
    click(dismissButton(el));
    await settle();

    // Removing it would leave the total beside a list it no longer describes.
    // Only the next run's `recompute` rebuilds the aggregates.
    expect(el.querySelectorAll('.sk-fx__tbl tbody tr')).toHaveLength(1);
    expect(el.textContent).toContain('INV-2291');
    expect(el.querySelector('.sk-fx__row--ack')).toBeTruthy();
    expect(el.textContent).toContain('Acknowledged');
  });

  it('acknowledges only the row that was clicked', async () => {
    const el = draw(run({ bills: [bill(), bill({ bill: 'INV-9', _ack_key: 'b'.repeat(32) })] }));
    click(dismissButton(el));
    await settle();
    expect(el.querySelectorAll('.sk-fx__row--ack')).toHaveLength(1);
    expect(posts).toHaveLength(1);
  });
});

/* ── §6 · An unwired skill offers nothing ────────────────────────────────── */

describe('the 61 skill functions that are not wired', () => {
  it('draws no control at all on a row with no handle', () => {
    const el = draw(run({ rows: [{ client: 'Trilok', amount: 42000 }] }, 'aggregate_kpis'));
    expect(el.textContent).toContain('Trilok');
    // Not a disabled button: "you are not allowed to" is a different and
    // untrue statement from "this skill has no acknowledgement wiring".
    expect(el.querySelector('.sk-fx__ack-c')).toBeNull();
    expect(dismissButton(el)).toBeFalsy();
  });
});

/* ── §7 · What the run is not showing ────────────────────────────────────── */

describe('the acknowledged block', () => {
  const block = {
    count: 2,
    items: [
      { label: 'INV-2291 — Sharma Traders', by: 'user_f798947b8a2e', at: '2026-08-27T09:00:00Z', note: '' },
      { label: 'INV-2292 — Trilok', by: 'user_f798947b8a2e', at: null, note: 'paid by cheque' },
    ],
  };

  it('says the list was shortened, and by how much', () => {
    const el = draw(run({ bills: [], acknowledged: block }));
    expect(el.textContent).toContain('Acknowledged, and not listed above');
    expect(el.querySelector('.sk-fx__ackd .sk-fx__n').textContent).toBe('2');
    expect(el.textContent).toContain('INV-2291 — Sharma Traders');
    expect(el.textContent).toContain('paid by cheque');
  });

  it('never draws the user handle that recorded it', () => {
    const el = draw(run({ bills: [], acknowledged: block }));
    expect(el.textContent).not.toContain('user_f798947b8a2e');
  });

  it('is lifted out of the body rather than rendered as a note', () => {
    // Left to shape classification it is an object of a number and a list,
    // which lands in `notes` and prints as one run-on `cellText` line.
    const f = splitFinding({ bills: [], acknowledged: block });
    expect(f.acknowledged.count).toBe(2);
    expect(f.notes.map(n => n.key)).not.toContain('acknowledged');
    expect(f.counts.map(c => c.key)).not.toContain('acknowledged');
  });

  it('is absent when nothing was acknowledged', () => {
    expect(acknowledgedOf({ bills: [] })).toBeNull();
    expect(acknowledgedOf({ acknowledged: { count: 0, items: [] } })).toBeNull();
    const el = draw(run({ bills: [bill()] }));
    expect(el.textContent).not.toContain('not listed above');
  });
});
