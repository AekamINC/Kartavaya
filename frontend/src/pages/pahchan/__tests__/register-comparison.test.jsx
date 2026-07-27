/**
 * The register's photo comparison — the interaction that already failed.
 *
 * What happened: the reference photos never loaded, the three slots showed a
 * loading ellipsis indefinitely, and reviewers pressed ↵ anyway. Both halves of
 * that are bugs and both are asserted here.
 *
 *   1 · A loading state that cannot become a failed state is indistinguishable
 *       from a slow one. `lib/api.js` sets no axios `timeout` and retries
 *       network errors three times, so a request that is accepted and never
 *       answered has NO terminal state — 'load' was permanent. There is now a
 *       deadline, and the word at the end of it is "failed".
 *
 *   2 · Confirming is a claim that a human compared two faces. The approve path
 *       must therefore be unusable while there is nothing on screen to compare.
 *       Flagging must stay usable, or the queue strands on exactly the rows that
 *       most need a person.
 *
 * These are behavioural, so they are asserted by driving the real component
 * against the e2e harness's route table rather than by reading the source. The
 * harness resolves a handler's PENDING promise as a pending request, which is
 * what makes "still loading" a state a test can actually sit inside.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Register, { PHOTO_DEADLINE_MS } from '../Register';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork, makeHost, settle,
} from '../../../__tests__/e2e/_harness';

/** A punch with an approved reference pair — the ordinary, verifiable row. */
const ROW = {
  id: 'punch-1',
  employee_name: 'Priya Deshmukh',
  direction: 'in',
  captured_at: '2026-07-26T04:11:00Z',
  flags: ['accuracy'],
  accuracy_m: 184,
  site_name: 'Fort, Mumbai',
  has_photo: true,
  reference_ids: ['ref-a', 'ref-b'],
  review_verdict: null,
};

const PUNCH_PHOTO = 'GET /v1/pahchan/punches/:id/photo';
const REF_PHOTO   = 'GET /v1/pahchan/enrollment/photos/:id/url';
const REGISTER    = 'GET /v1/pahchan/register';
const REVIEW      = 'PATCH /v1/pahchan/punches/:id/review';

/** A request that is accepted and never answered. The original failure. */
const NEVER = () => new Promise(() => {});

let host;

/** Every keydown the register binds goes on `window`. */
async function press(key) {
  await settle(1);
  const { act } = await import('react');
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
  await settle();
}

/** The three comparison slots' visible text, in row order. */
const slotText = () => host.$$('.rv__slot').map(n => n.textContent.trim());

/** …and what a screen reader is told about each. */
const slotLabels = () => host.$$('.rv__slot').map(n => n.getAttribute('aria-label') || '');

beforeEach(() => {
  installNetworkKillSwitch();
  host = makeHost();
});

afterEach(() => {
  host.unmount();
  restoreNetwork();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the photo comparison must be able to fail', () => {
  it('a request that never answers stops saying "loading" and says "failed"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installMockApi({
      [REGISTER]:    { punches: [ROW] },
      [PUNCH_PHOTO]: NEVER,
      [REF_PHOTO]:   NEVER,
    });

    await host.mount(<Register />);

    // Before the deadline this is genuinely still loading, and says so.
    expect(host.$$('.rv__slot')).toHaveLength(3);
    expect(host.$$('.rv__slot .ix-skeleton')).toHaveLength(3);
    expect(slotLabels().every(l => l.includes('loading'))).toBe(true);
    expect(slotText().join(' ')).not.toContain('failed');

    const { act } = await import('react');
    await act(async () => { await vi.advanceTimersByTimeAsync(PHOTO_DEADLINE_MS + 50); });
    await settle();

    // After it, every slot has resolved to a failure the reviewer can read —
    // on screen AND to a screen reader, because neither audience may be left
    // with an indicator that only ever means "wait".
    expect(slotText()).toEqual(['failed', 'failed', 'failed']);
    expect(slotLabels().every(l => l.includes('failed to load'))).toBe(true);
    expect(host.$$('.rv__slot .ix-skeleton')).toHaveLength(0);
  });

  it('a 404 is retention, not a failure — those must not read alike', async () => {
    installMockApi({
      [REGISTER]:    { punches: [{ ...ROW, has_photo: false }] },
      [REF_PHOTO]:   { url: 'blob:ref' },
    });

    await host.mount(<Register />);
    await settle();

    // The punch photo is gone to retention; the references are on screen.
    expect(slotText()[0]).toBe('deleted');
    expect(host.$$('.rv__slot img')).toHaveLength(2);
  });
});

describe('confirming requires a comparison that is actually on screen', () => {
  it('↵ is refused while the photos are still in flight, and nothing is written', async () => {
    const mock = installMockApi({
      [REGISTER]:    { punches: [ROW] },
      [PUNCH_PHOTO]: NEVER,
      [REF_PHOTO]:   NEVER,
      [REVIEW]:      { ok: true },
    });

    await host.mount(<Register />);
    await press('Enter');

    expect(mock.calledWith('PATCH', '/review')).toHaveLength(0);
    // And the row is not left looking reviewed.
    expect(host.text()).not.toContain('Confirmed');
  });

  it('↵ is refused once the photos have failed, and says so', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mock = installMockApi({
      [REGISTER]:    { punches: [ROW] },
      [PUNCH_PHOTO]: NEVER,
      [REF_PHOTO]:   NEVER,
      [REVIEW]:      { ok: true },
    });

    await host.mount(<Register />);
    const { act } = await import('react');
    await act(async () => { await vi.advanceTimersByTimeAsync(PHOTO_DEADLINE_MS + 50); });
    await settle();

    await press('Enter');

    expect(mock.calledWith('PATCH', '/review')).toHaveLength(0);
    expect(host.text()).toContain('Cannot compare');
  });

  it('F still flags a row nobody can see — the queue must not strand', async () => {
    const mock = installMockApi({
      [REGISTER]:    { punches: [ROW] },
      [PUNCH_PHOTO]: NEVER,
      [REF_PHOTO]:   NEVER,
      [REVIEW]:      { ok: true },
    });

    await host.mount(<Register />);
    await press('f');

    const wrote = mock.calledWith('PATCH', '/review');
    expect(wrote).toHaveLength(1);
    expect(wrote[0].body).toEqual({ verdict: 'flagged' });
  });

  it('↵ writes the verdict once all three faces are on screen', async () => {
    const mock = installMockApi({
      [REGISTER]:    { punches: [ROW] },
      [PUNCH_PHOTO]: { url: 'blob:punch' },
      [REF_PHOTO]:   { url: 'blob:ref' },
      [REVIEW]:      { ok: true },
    });

    await host.mount(<Register />);
    // "All", not the default "Needs a look": a confirmed row leaves that queue
    // by design, so the verdict it just wrote would not be on screen to assert.
    await host.click(host.$$('.seg__b').find(b => b.textContent.startsWith('All')));
    await settle();
    expect(host.$$('.rv__slot img')).toHaveLength(3);

    await press('Enter');

    const wrote = mock.calledWith('PATCH', '/review');
    expect(wrote).toHaveLength(1);
    expect(wrote[0].body).toEqual({ verdict: 'ok' });
    expect(host.text()).toContain('Confirmed');

    // The confirmation is a static chip swap FIRST and a flash second. `.ix-flash`
    // collapses to ~0.5ms under `prefers-reduced-motion`, so if the chip were not
    // there the confirmation would vanish entirely for the user who asked for
    // less motion.
    expect(host.$('.ix-flash')).toBeTruthy();
    expect(host.$('.ix-flash').textContent).toContain('Confirmed');
  });

  it('a flag chip says why the punch was flagged, not what tone it borrowed', async () => {
    installMockApi({
      [REGISTER]:    { punches: [{ ...ROW, flags: ['accuracy', 'mock'] }] },
      [PUNCH_PHOTO]: { url: 'blob:punch' },
      [REF_PHOTO]:   { url: 'blob:ref' },
    });

    await host.mount(<Register />);
    await settle();

    // `accuracy` borrows the in_review tone and `mock` the rejected one, because
    // one implies circumstance and the other intent. The reviewer must read the
    // reason. "Rejected" in this row would also read as a verdict already cast.
    expect(host.text()).toContain('Weak GPS');
    expect(host.text()).toContain('Simulated location');
    expect(host.text()).not.toContain('In Review');
    expect(host.text()).not.toContain('Rejected');
  });

  it('the cursor does NOT advance past a row it refused to confirm', async () => {
    const two = [ROW, { ...ROW, id: 'punch-2', employee_name: 'Arjun Rao' }];
    const mock = installMockApi({
      [REGISTER]:    { punches: two },
      [PUNCH_PHOTO]: NEVER,
      [REF_PHOTO]:   NEVER,
      [REVIEW]:      { ok: true },
    });

    await host.mount(<Register />);
    await press('Enter');
    await press('Enter');
    await press('Enter');

    // Three refusals, nothing written, and the cursor never left row 1 — an
    // advance here is the silent skip the whole cursor design exists to stop.
    expect(mock.calledWith('PATCH', '/review')).toHaveLength(0);
    const cursorRow = host.$('tr[aria-current="true"]');
    expect(cursorRow?.textContent).toContain('Priya Deshmukh');
  });
});

describe('the per-row buttons, which are the only path on a touch device', () => {
  // The reference (`PahchanReview.jsx:184`) puts a confirm and a flag control on
  // every row. The build had ↵ and F only, so a reviewer on a tablet — or anyone
  // reaching for a mouse — could read the whole queue and decide nothing.
  //
  // The risk in adding them is that a second path re-implements the gate and
  // drifts from the first. These pin that it did not: the button obeys exactly
  // the rule ↵ obeys, because it calls the same function.
  const confirmBtn = () => host.$$('button').find(b => b.textContent.trim() === 'Confirm');
  const flagBtn    = () => host.$$('button').find(b => b.textContent.trim() === 'Flag');

  it('offers a Confirm and a Flag control on the row', async () => {
    installMockApi({
      [REGISTER]:    { punches: [ROW] },
      [PUNCH_PHOTO]: { url: 'blob:punch' },
      [REF_PHOTO]:   { url: 'blob:ref' },
      [REVIEW]:      { ok: true },
    });
    await host.mount(<Register />);
    await settle();
    expect(confirmBtn()).toBeTruthy();
    expect(flagBtn()).toBeTruthy();
  });

  it('Confirm is DISABLED while the photos are still in flight', async () => {
    installMockApi({
      [REGISTER]:    { punches: [ROW] },
      [PUNCH_PHOTO]: NEVER,
      [REF_PHOTO]:   NEVER,
      [REVIEW]:      { ok: true },
    });
    await host.mount(<Register />);
    await settle();
    // Disabled, not merely refusing on click: the reviewer should learn the row
    // is not theirs to judge before they commit to judging it.
    expect(confirmBtn().disabled).toBe(true);
  });

  it('clicking Confirm while unresolved writes nothing', async () => {
    const mock = installMockApi({
      [REGISTER]:    { punches: [ROW] },
      [PUNCH_PHOTO]: NEVER,
      [REF_PHOTO]:   NEVER,
      [REVIEW]:      { ok: true },
    });
    await host.mount(<Register />);
    await settle();
    await host.click(confirmBtn());
    expect(mock.calledWith('PATCH', '/review')).toHaveLength(0);
    expect(host.text()).not.toContain('Confirmed');
  });

  it('Flag stays live on a row nobody can see — the queue must not strand', async () => {
    const mock = installMockApi({
      [REGISTER]:    { punches: [ROW] },
      [PUNCH_PHOTO]: NEVER,
      [REF_PHOTO]:   NEVER,
      [REVIEW]:      { ok: true },
    });
    await host.mount(<Register />);
    await settle();
    expect(flagBtn().disabled).toBeFalsy();
    await host.click(flagBtn());
    const wrote = mock.calledWith('PATCH', '/review');
    expect(wrote).toHaveLength(1);
    expect(wrote[0].body).toEqual({ verdict: 'flagged' });
  });

  it('Confirm writes the verdict once all three faces are on screen', async () => {
    const mock = installMockApi({
      [REGISTER]:    { punches: [ROW] },
      [PUNCH_PHOTO]: { url: 'blob:punch' },
      [REF_PHOTO]:   { url: 'blob:ref' },
      [REVIEW]:      { ok: true },
    });
    await host.mount(<Register />);
    await host.click(host.$$('.seg__b').find(b => b.textContent.startsWith('All')));
    await settle();
    expect(confirmBtn().disabled).toBeFalsy();
    await host.click(confirmBtn());
    const wrote = mock.calledWith('PATCH', '/review');
    expect(wrote).toHaveLength(1);
    expect(wrote[0].body).toEqual({ verdict: 'ok' });
  });
});
