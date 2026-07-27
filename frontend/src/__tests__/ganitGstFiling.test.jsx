/**
 * The GST filing screen must not state anything it cannot support.
 *
 * This is a tax screen. Two firms file returns from it, so the failure mode
 * that matters is not a broken layout — it is a confident figure with nothing
 * behind it. Three specific inventions are guarded here, all of which the
 * design reference (`ScreensBiz.jsx:60–117`) draws as filled-in mock data:
 *
 *   · GSTR-2B reconciliation ("42 / 47 matched", "3 mismatched"). Kartavaya has
 *     no 2B store — no table, no endpoint. A match rate here would be fiction.
 *   · Rows with no column behind them (reverse charge, nil/exempt, ITC
 *     reversals) rendered as ₹0. A zero asserts that no such liability arose,
 *     which is a different and much stronger claim than "not recorded".
 *   · "Kartavaya is a registered GSP — invoices upload to the IRP directly."
 *     Kartavaya holds no such registration.
 *
 * Rendered with react-dom directly: `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws. Same reason
 * and same shape as `ganitErrorStates.test.jsx`.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const get = vi.fn();

vi.mock('../lib/api', () => ({
  api: { get: (...a) => get(...a), request: vi.fn() },
  rows: r => (Array.isArray(r?.data) ? r.data : (r?.data?.data ?? [])),
  body: r => r?.data ?? {},
}));

const { ToastProvider } = await import('../components/ui');
const { default: StatsTab } = await import('../pages/ganit/StatsTab');

let container = null;
let root = null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  get.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

async function mount() {
  await act(async () => { root.render(<ToastProvider><StatsTab /></ToastProvider>); });
  await act(async () => {});
}

/** The JSON `GET /v1/documents/gst/gstr3b/{period}` answers. */
function summary(over = {}) {
  return {
    data: {
      period: '2026-07',
      due_date: '2026-08-20',
      state_label: 'Maharashtra',
      gstin: '27AAACA1234M1ZV',
      outward_count: 3,
      inward_count: 2,
      rows: [
        { key: 'outward_taxable', label: 'Outward taxable supplies', taxable: 245000, tax: 44100, recorded: true },
        { key: 'outward_zero_rated', label: 'Zero-rated supplies (exports)', taxable: 0, tax: 0, recorded: true },
        { key: 'inward_reverse_charge', label: 'Inward supplies (reverse charge)', taxable: 0, tax: 0, recorded: false },
        { key: 'net_itc', label: 'Eligible ITC', taxable: null, tax: 18360, recorded: true },
        { key: 'total_cash', label: 'Net tax payable in cash', taxable: null, tax: 25740, recorded: true },
      ],
      totals: { payable: 44100, via_itc: 18360, in_cash: 25740 },
      not_recorded: ['Inward supplies liable to reverse charge'],
      checks: [],
      ...over,
    },
  };
}

describe('GST filing screen — three states, and no invented figures', () => {
  it('renders an error rather than an empty return when the fetch fails', async () => {
    // The specific wrong answer: a summary of zeros reads as "you owe nothing".
    get.mockImplementation(() => Promise.reject({ response: { status: 500 } }));
    await mount();

    expect(container.querySelector('.k-err, [role="alert"]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Outward taxable supplies/i);
  });

  it('shows the computed figures and the statutory due date', async () => {
    get.mockImplementation(() => Promise.resolve(summary()));
    await mount();

    expect(container.textContent).toContain('Outward taxable supplies');
    // Rendered through `inr`, so assert on the grouped digits.
    expect(container.textContent).toMatch(/44,100/);
    expect(container.textContent).toMatch(/20 Aug 2026/);
  });

  it('never prints a bare zero for a row with no store behind it', async () => {
    get.mockImplementation(() => Promise.resolve(summary()));
    await mount();

    const row = [...container.querySelectorAll('.gn-gst__row')]
      .find(el => el.textContent.includes('reverse charge'));
    expect(row).toBeTruthy();
    expect(row.textContent).toMatch(/not recorded/i);
    // A zero would assert that no reverse-charge liability arose.
    expect(row.textContent).not.toMatch(/₹\s*0\b/);
  });

  it('names the parties behind a blocker rather than only counting them', async () => {
    get.mockImplementation(() => Promise.resolve(summary({
      checks: [{
        code: 'counterparty_gstin_invalid',
        severity: 'blocking',
        title: '1 counterparty GSTIN fails the check digit',
        detail: 'A GSTIN carries its own checksum.',
        fix: 'Graha → Contacts',
        items: ['Nirmal Exports Pvt Ltd — 27AAACA1234M1Z9'],
      }],
    })));
    await mount();

    expect(container.textContent).toContain('Nirmal Exports Pvt Ltd');
    expect(container.textContent).toContain('1 blocker');
    expect(container.textContent).toContain('Graha → Contacts');
  });

  it('reports no blockers as such rather than leaving the panel blank', async () => {
    get.mockImplementation(() => Promise.resolve(summary()));
    await mount();

    expect(container.textContent).toMatch(/No blockers/i);
  });

  it('states that GSTR-2B reconciliation is unavailable and invents no match rate', async () => {
    get.mockImplementation(() => Promise.resolve(summary()));
    await mount();

    expect(container.textContent).toMatch(/GSTR-2B/);
    expect(container.textContent).toMatch(/no 2B store|nowhere to put/i);
    // The reference's mock figures must not have survived into the build.
    expect(container.textContent).not.toMatch(/42\s*\/\s*47/);
    expect(container.textContent).not.toMatch(/3 mismatched/i);
  });

  it('makes no claim to be a GSP or to reach the IRP', async () => {
    get.mockImplementation(() => Promise.resolve(summary()));
    await mount();

    expect(container.textContent).not.toMatch(/registered GSP/i);
    expect(container.textContent).not.toMatch(/Last sync/i);
    // And it says the opposite, plainly.
    expect(container.textContent).toMatch(/not a GSP/i);
  });

  it('offers the working paper, and marks the unbuilt exports as unavailable', async () => {
    get.mockImplementation(() => Promise.resolve(summary()));
    await mount();

    const buttons = [...container.querySelectorAll('button')];
    const gstr3b = buttons.find(b => /Export GSTR-3B/i.test(b.textContent));
    const gstr1 = buttons.find(b => /GSTR-1 JSON/i.test(b.textContent));
    const tally = buttons.find(b => /Tally/i.test(b.textContent));

    expect(gstr3b?.disabled).toBe(false);
    // Not built — offering them as if they worked is the lie.
    expect(gstr1?.disabled).toBe(true);
    expect(tally?.disabled).toBe(true);
  });

  it('builds a share URL and never dispatches anything', async () => {
    get.mockImplementation(() => Promise.resolve(summary()));
    await mount();

    const share = [...container.querySelectorAll('a')]
      .find(a => /Share with your CA/i.test(a.textContent));
    expect(share).toBeTruthy();
    // A mailto with NO recipient: the user picks one and presses send.
    expect(share.getAttribute('href')).toMatch(/^mailto:\?/);
    // Only the summary was ever fetched — no send endpoint was called.
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toContain('/v1/documents/gst/gstr3b/');
  });

  it('will not submit a challan whose CIN is incomplete', async () => {
    get.mockImplementation(() => Promise.resolve(summary()));
    await mount();

    const open = [...container.querySelectorAll('button')]
      .find(b => /Prepare counterfoil/i.test(b.textContent));
    await act(async () => { open.click(); });

    const download = [...container.querySelectorAll('button')]
      .find(b => /Download challan/i.test(b.textContent));
    // BSR code, challan serial, major head and type of payment are all still
    // blank. An invented serial is worse than a missing one.
    expect(download.disabled).toBe(true);
  });
});
