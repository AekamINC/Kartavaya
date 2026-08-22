/**
 * Ganit's money panels must never report a failed fetch as an empty ledger.
 *
 * This is the specific defect these tests exist to stop coming back. Every tab
 * in this module was written as:
 *
 *     try { setRows(r.data.data || []) } catch { pushToast(…) }
 *     …
 *     rows.length === 0 ? <Empty title="No invoices yet" /> : <table/>
 *
 * A failed request leaves the list at `[]`, so the panel paints "No invoices
 * yet", "No vendor bills yet", "No bank statements imported". On a finance
 * module that is not a visibly broken page — it is a FALSE STATEMENT ABOUT THE
 * BUSINESS, indistinguishable from a real empty ledger, and a receivables list
 * that reads empty is a number somebody may act on.
 *
 * Loading, empty and error are three states. A toast is not the third one: it
 * is transient, it is off to the side, and the wrong answer stays on screen
 * after it fades.
 *
 * Rendered with react-dom directly: `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws. Same reason
 * and same shape as `sanvaadChatPane.test.jsx`.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const get = vi.fn();

// `rows` and `body` are re-implemented here exactly as `lib/api` defines them.
// The components under test unwrap through them, and a mock that returned the
// raw body would test a different unwrapping than production uses.
vi.mock('../lib/api', () => ({
  api: {
    get: (...a) => get(...a),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
  rows: (r) => {
    const b = r?.data;
    if (Array.isArray(b)) return b;
    if (Array.isArray(b?.data)) return b.data;
    return [];
  },
  body: (r) => r?.data ?? {},
}));

const { ToastProvider } = await import('../components/ui');
const { default: InvoicesTab } = await import('../pages/ganit/InvoicesTab');
const { default: PayablesTab } = await import('../pages/ganit/PayablesTab');
const { default: BankTab } = await import('../pages/ganit/BankTab');
const { default: ProductsTab } = await import('../pages/catalogue/ProductsTab');
const { default: StatsTab } = await import('../pages/ganit/StatsTab');

let container = null;
let root = null;

beforeEach(() => {
  // Without this React logs "not configured to support act(...)" on every
  // render and the real assertions get lost in the noise.
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

/** Mount a tab and let its effects settle. */
async function mount(Tab) {
  await act(async () => {
    root.render(<ToastProvider><Tab /></ToastProvider>);
  });
  // A second tick so state set inside a resolved promise has flushed.
  await act(async () => {});
}

const serverError = () => Promise.reject({ response: { status: 500 } });

/** The alert ErrorState renders. Its presence is the assertion. */
const hasErrorState = () => !!container.querySelector('.k-err, [role="alert"]');

describe('Ganit money panels — a failed fetch is an error, not an empty ledger', () => {
  it('InvoicesTab shows an error and never claims there are no invoices', async () => {
    get.mockImplementation(serverError);
    await mount(InvoicesTab);

    expect(hasErrorState()).toBe(true);
    // The exact wrong answer this guards against.
    expect(container.textContent).not.toMatch(/No invoices yet/i);
    expect(container.textContent).not.toMatch(/Create your first invoice/i);
  });

  it('PayablesTab shows an error and never claims there are no bills', async () => {
    get.mockImplementation(serverError);
    await mount(PayablesTab);

    expect(hasErrorState()).toBe(true);
    expect(container.textContent).not.toMatch(/No vendor bills yet/i);
  });

  it('BankTab shows an error and never claims nothing was imported', async () => {
    get.mockImplementation(serverError);
    await mount(BankTab);

    expect(hasErrorState()).toBe(true);
    expect(container.textContent).not.toMatch(/No bank statements imported/i);
  });

  it('ProductsTab shows an error and never invites re-entry of an existing catalogue', async () => {
    get.mockImplementation(serverError);
    await mount(ProductsTab);

    expect(hasErrorState()).toBe(true);
    expect(container.textContent).not.toMatch(/No products yet/i);
  });

  it('StatsTab renders an error rather than nothing at all', async () => {
    // This tab used to `return null` when the fetch failed, so the panel was
    // blank: no figures, no error, nothing to retry.
    get.mockImplementation(serverError);
    await mount(StatsTab);

    expect(hasErrorState()).toBe(true);
    expect(container.textContent.trim()).not.toBe('');
  });
});

describe('Ganit money panels — a genuinely empty result still reads as empty', () => {
  it('InvoicesTab shows the empty state when the ledger really is empty', async () => {
    // The counterpart assertion: the error state must not swallow the real
    // empty case, or the module never invites a first invoice.
    get.mockImplementation(() => Promise.resolve({ data: { data: [] } }));
    await mount(InvoicesTab);

    expect(container.textContent).toMatch(/No invoices yet/i);
    expect(hasErrorState()).toBe(false);
  });

  it('InvoicesTab renders rows when the envelope carries them', async () => {
    get.mockImplementation(() => Promise.resolve({
      data: {
        data: [{
          id: 'i1', invoice_number: 'INV-1', invoice_type: 'tax_invoice',
          invoice_date: '2026-07-08', total: 1000, amount_paid: 0,
          balance_due: 1000, payment_status: 'unpaid', contact_name: 'Acme',
        }],
      },
    }));
    await mount(InvoicesTab);

    expect(container.textContent).toContain('INV-1');
    expect(container.textContent).toContain('Acme');
    expect(container.textContent).not.toMatch(/No invoices yet/i);
  });

  it('InvoicesTab unwraps a bare array too', async () => {
    // 28 backend GET routes answer a bare array and 99 answer an envelope, with
    // no rule. `rows()` is what makes the call site indifferent; this asserts
    // the tab actually goes through it.
    get.mockImplementation(() => Promise.resolve({
      data: [{
        id: 'i2', invoice_number: 'INV-2', invoice_type: 'tax_invoice',
        invoice_date: '2026-07-09', total: 500, amount_paid: 0,
        balance_due: 500, payment_status: 'unpaid', contact_name: 'Beta',
      }],
    }));
    await mount(InvoicesTab);

    expect(container.textContent).toContain('INV-2');
    expect(container.textContent).not.toMatch(/No invoices yet/i);
  });
});
