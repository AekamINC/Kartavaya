/**
 * Bank reconciliation — the screen could show you an unmatched line and give
 * you no way to match it.
 *
 * `POST /bank-statements/{id}/match` existed and was reachable only by someone
 * hand-writing a payment UUID into a URL: the table rendered "Unmatch" on
 * reconciled rows and NOTHING on unreconciled ones, and there was no endpoint
 * listing the payments a line could be. (The endpoint also wrote a value the
 * database's CHECK constraint rejected, so even that hand-written call 500'd —
 * that half is covered by backend/tests/test_bank_reconciliation_match.py.)
 *
 * What is guarded here is the half the user can see:
 *   · an unmatched line offers a control, and a matched one offers Unmatch
 *   · the control asks the server which payments are plausible
 *   · choosing one sends `payment_id` as a QUERY parameter — the server reads
 *     it off the query string, and a body would arrive as a 422 the user reads
 *     as "matching is broken"
 *   · an empty candidate list names WHICH ledger is empty, because "no
 *     payments" on a debit line sends the reader to look at receipts
 *
 * Rendered with react-dom directly: `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws. Same shape as
 * `ganitGstFiling.test.jsx`.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();

vi.mock('../lib/api', () => ({
  api: { get: (...a) => get(...a), post: (...a) => post(...a) },
  rows: r => (Array.isArray(r?.data) ? r.data : (r?.data?.data ?? [])),
  body: r => r?.data ?? {},
}));

const { ToastProvider } = await import('../components/ui');
const { default: BankTab } = await import('../pages/ganit/BankTab');

const CREDIT = {
  id: 'line-credit', statement_date: '2026-08-01', description: 'Client receipt',
  reference: 'UTR1', amount: 59000, is_reconciled: false,
};
const DEBIT = {
  id: 'line-debit', statement_date: '2026-08-02', description: 'Office rent',
  reference: 'NEFT9', amount: -25000, is_reconciled: false,
};
const MATCHED = {
  id: 'line-done', statement_date: '2026-08-03', description: 'Settled',
  reference: 'UTR7', amount: 12000, is_reconciled: true,
};

let container = null;
let root = null;

/** What `api.get` answers, per screen. Set inside each test before mounting. */
let lines = [];
let candidates = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  get.mockReset();
  post.mockReset();
  lines = [];
  candidates = [];
  get.mockImplementation((url) => {
    if (url.endsWith('/candidates')) return Promise.resolve({ data: { data: candidates } });
    if (url.endsWith('/stats')) return Promise.resolve({ data: { total_lines: lines.length } });
    return Promise.resolve({ data: { data: lines } });
  });
  post.mockResolvedValue({ data: { ok: true, matched_type: 'invoice_payment' } });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

async function mount() {
  await act(async () => { root.render(<ToastProvider><BankTab /></ToastProvider>); });
  await act(async () => {});
}

const buttons = () => Array.from(container.querySelectorAll('button'));
const byText = (t) => buttons().find(b => b.textContent.trim() === t);

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {});
}

describe('BankTab — manual matching has a control', () => {
  it('offers a Match control on an unmatched line', async () => {
    lines = [CREDIT];
    await mount();
    // The whole first fault: this button did not exist in any state.
    expect(byText('Match')).toBeTruthy();
  });

  it('offers Unmatch, not Match, on a reconciled line', async () => {
    lines = [MATCHED];
    await mount();
    expect(byText('Unmatch')).toBeTruthy();
    expect(byText('Match')).toBeFalsy();
  });

  it('asks the server which payments the line could be', async () => {
    lines = [CREDIT];
    await mount();
    await click(byText('Match'));
    const asked = get.mock.calls.map(c => c[0]);
    expect(asked).toContain('/v1/ganit/bank-statements/line-credit/candidates');
  });

  it('shows each candidate and flags the exact amount', async () => {
    lines = [CREDIT];
    candidates = [
      { id: 'pay-1', amount: 59000, payment_date: '2026-08-01', reference: 'UTR1',
        document: 'INV-00042', party: 'Bharat Textiles', amount_matches: true },
      { id: 'pay-2', amount: 41000, payment_date: '2026-07-28', reference: 'UTR2',
        document: 'INV-00039', party: 'Nagpur Steel', amount_matches: false },
    ];
    await mount();
    await click(byText('Match'));
    const text = container.textContent;
    expect(text).toContain('INV-00042');
    expect(text).toContain('Bharat Textiles');
    expect(text).toContain('INV-00039');
    // The exact tag is the reason this candidate is offered first.
    expect(container.querySelectorAll('.gn-match__exact')).toHaveLength(1);
  });

  it('sends payment_id as a query parameter, not a body field', async () => {
    lines = [CREDIT];
    candidates = [{ id: 'pay-1', amount: 59000, payment_date: '2026-08-01', amount_matches: true }];
    await mount();
    await click(byText('Match'));
    await click(byText('Match this'));

    expect(post).toHaveBeenCalledTimes(1);
    const [url, payload, config] = post.mock.calls[0];
    expect(url).toBe('/v1/ganit/bank-statements/line-credit/match');
    // The server declares `payment_id` as a query parameter. Sent in the body
    // it never arrives and FastAPI answers 422.
    expect(config?.params).toEqual({ payment_id: 'pay-1' });
    expect(payload).toBeNull();
  });

  it('reloads the lines and the totals after a match', async () => {
    lines = [CREDIT];
    candidates = [{ id: 'pay-1', amount: 59000, payment_date: '2026-08-01', amount_matches: true }];
    await mount();
    const before = get.mock.calls.length;
    await click(byText('Match'));
    await click(byText('Match this'));
    const after = get.mock.calls.map(c => c[0]).slice(before);
    // A stale "Unmatched" badge on a line you just reconciled reads as a failure.
    expect(after).toContain('/v1/ganit/bank-statements');
    expect(after).toContain('/v1/ganit/bank-statements/stats');
  });

  it('names the vendor ledger when a debit has nothing to offer', async () => {
    lines = [DEBIT];
    candidates = [];
    await mount();
    await click(byText('Match'));
    // "No payments" on a debit line sends the reader to check receipts.
    expect(container.textContent).toContain('vendor payments');
  });

  it('names the receipts ledger when a credit has nothing to offer', async () => {
    lines = [CREDIT];
    candidates = [];
    await mount();
    await click(byText('Match'));
    expect(container.textContent).toContain('receipts');
  });

  it('closes the picker when the control is pressed again', async () => {
    lines = [CREDIT];
    candidates = [{ id: 'pay-1', amount: 59000, payment_date: '2026-08-01', amount_matches: true }];
    await mount();
    await click(byText('Match'));
    expect(container.querySelector('.gn-match')).toBeTruthy();
    await click(byText('Close'));
    expect(container.querySelector('.gn-match')).toBeFalsy();
  });
});
