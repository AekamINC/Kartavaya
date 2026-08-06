/**
 * Manav → Shifts → Bids: the half that awards a shift.
 *
 * ── WHAT THIS SCREEN COULD NOT DO ────────────────────────────────────────────
 *
 * `ShiftBids` posted a bid and let an employee apply. It then rendered
 * "{n} responses" — an integer off `GET /v1/manav/shift-bids` — and stopped.
 * There was no control, and no endpoint, that would say WHICH n. `POST
 * /shift-bids/{bid}/accept/{employee}` existed on the server and could not be
 * called from anywhere in the product, because nothing ever showed you an
 * employee id to put in the URL.
 *
 * So the whole feature was: post a shift, watch a number go up, and roster
 * somebody by hand from a different tab. `ScheduleGrid`'s coverage panel ends
 * with "A shift covered by fewer than expected is a gap to fill — post it under
 * Bids", which pointed straight at that dead end.
 *
 * These tests pin the loop closing: the applicants are named, one can be
 * awarded, an award reaches the endpoint with that employee's id, and a bid that
 * fills stops being shown as open.
 *
 * Rendered with react-dom directly — `@testing-library/react`'s `dom` peer is
 * not installed in this repo, per `manavTabs.test.jsx`.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  rows: (r) => {
    const b = r?.data;
    if (Array.isArray(b)) return b;
    if (Array.isArray(b?.data)) return b.data;
    return [];
  },
  body: (r) => r?.data ?? {},
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import ShiftBids from '../ShiftBids';

const BID_ID = 'b0000000-0000-0000-0000-000000000001';
const EMP_A = 'e0000000-0000-0000-0000-00000000000a';

const OPEN_BID = {
  id: BID_ID,
  shift_name: 'Night',
  date: '2026-08-10',
  slots_needed: 2,
  responses: 2,
  status: 'open',
};

const APPLICANTS = {
  data: [
    {
      id: 'r1', employee_id: EMP_A, employee_name: 'Synthetic Applicant',
      employee_code: 'EMP001', status: 'applied', created_at: '2026-08-06T09:00:00Z',
    },
    {
      id: 'r2', employee_id: 'e0000000-0000-0000-0000-00000000000b',
      employee_name: 'Second Applicant', employee_code: 'EMP002',
      status: 'accepted', created_at: '2026-08-06T09:05:00Z',
    },
  ],
  slots_needed: 2,
  slots_awarded: 1,
  bid_status: 'open',
};

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const mount = (ui) => act(() => root.render(<ToastProvider>{ui}</ToastProvider>));
const settle = async (rounds = 5) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const text = () => container.textContent;
const buttons = () => [...container.querySelectorAll('button')];
const byLabel = (label) => buttons().find(b => b.textContent.trim().startsWith(label));

/** The two lists the tab loads on mount, plus the applicants for one bid. */
function wire({ bids = [OPEN_BID], applicants = APPLICANTS } = {}) {
  api.get.mockImplementation((url) => {
    if (url.includes('/responses')) return Promise.resolve({ data: applicants });
    if (url.includes('/shift-bids')) return Promise.resolve({ data: { data: bids } });
    if (url.includes('/shifts')) return Promise.resolve({ data: { data: [] } });
    return Promise.resolve({ data: { data: [] } });
  });
}

describe('Manav shift bids — a bid can be awarded', () => {
  it('names the applicants instead of only counting them', async () => {
    wire();
    mount(<ShiftBids pushToast={() => {}} />);
    await settle();

    // Nothing is fetched per bid until asked — a bid board with forty rows must
    // not issue forty requests naming forty employees on load.
    expect(text()).not.toContain('Synthetic Applicant');

    const open = byLabel('See applicants');
    expect(open).toBeTruthy();
    await act(async () => { open.click(); });
    await settle();

    expect(api.get).toHaveBeenCalledWith(`/v1/manav/shift-bids/${BID_ID}/responses`);
    expect(text()).toContain('Synthetic Applicant');
    expect(text()).toContain('Second Applicant');
  });

  it('awards a slot to the employee whose row was pressed', async () => {
    wire();
    api.post.mockResolvedValue({
      data: { status: 'accepted', slots_awarded: 2, slots_needed: 2, bid_status: 'filled' },
    });
    mount(<ShiftBids pushToast={() => {}} />);
    await settle();
    await act(async () => { byLabel('See applicants').click(); });
    await settle();

    const award = byLabel('Award');
    expect(award).toBeTruthy();
    await act(async () => { award.click(); });
    await settle();

    // The id comes off the row, which is the whole reason the list had to exist.
    expect(api.post).toHaveBeenCalledWith(
      `/v1/manav/shift-bids/${BID_ID}/accept/${EMP_A}`,
    );
  });

  it('does not offer to award somebody who already has the slot', async () => {
    wire();
    mount(<ShiftBids pushToast={() => {}} />);
    await settle();
    await act(async () => { byLabel('See applicants').click(); });
    await settle();

    // Two applicants, one already accepted — so exactly one Award button.
    expect(buttons().filter(b => b.textContent.trim().startsWith('Award')).length).toBe(1);
    expect(text()).toContain('Awarded');
  });

  it('shows how many slots are left, from the server’s own count', async () => {
    wire();
    mount(<ShiftBids pushToast={() => {}} />);
    await settle();
    await act(async () => { byLabel('See applicants').click(); });
    await settle();

    // 1 of 2 awarded. Stated rather than left to be worked out from two lists.
    expect(text()).toContain('1 of 2');
  });

  it('a filled bid is reachable, and says it is closed', async () => {
    // The list defaults to open. A bid that has been awarded leaves that list,
    // and until it could be viewed there was no way to see who got the shift.
    wire({ bids: [] });
    mount(<ShiftBids pushToast={() => {}} />);
    await settle();

    const filled = byLabel('Filled');
    expect(filled).toBeTruthy();

    wire({ bids: [{ ...OPEN_BID, status: 'filled' }] });
    await act(async () => { filled.click(); });
    await settle();

    expect(api.get).toHaveBeenCalledWith('/v1/manav/shift-bids?status=filled');
    expect(text()).toContain('Night');
  });

  it('a failed applicant fetch is a failure, never “nobody applied”', async () => {
    wire();
    api.get.mockImplementation((url) => {
      if (url.includes('/responses')) return Promise.reject({ response: { status: 500 } });
      if (url.includes('/shift-bids')) return Promise.resolve({ data: { data: [OPEN_BID] } });
      return Promise.resolve({ data: { data: [] } });
    });
    mount(<ShiftBids pushToast={() => {}} />);
    await settle();
    await act(async () => { byLabel('See applicants').click(); });
    await settle();

    expect(container.querySelector('[role="status"]')).toBeTruthy();
    expect(text()).not.toContain('Nobody has applied');
  });
});
