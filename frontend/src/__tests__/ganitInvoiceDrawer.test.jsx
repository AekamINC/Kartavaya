/**
 * The invoice opens as a POPUP OVER the ledger, with both send routes.
 *
 * This is the owner's stated requirement, so it gets a guard rather than a
 * comment. Two things are asserted and neither is cosmetic:
 *
 *   1. The record is a `role="dialog"` overlay and THE LIST IS STILL THERE
 *      behind it. The build replaced the whole tab with the record and offered
 *      a "← Back to list" button, which is a second navigation model for "open
 *      this row" — everywhere else in the product it is a drawer. A refactor
 *      that quietly restores the takeover passes every other test in the suite.
 *
 *   2. Both "Download PDF" and "Send on WhatsApp" are present. The WhatsApp
 *      button is DISABLED when the contact has no phone number, rather than
 *      opening a broken chat on press.
 *
 * No network and no `window.open`: the PDF blob route and the wa.me link are
 * never exercised here. This module emails invoices to real customers.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const get = vi.fn();

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

const LIST_ROW = {
  id: 'inv-1', invoice_number: 'INV-2607', invoice_type: 'tax_invoice',
  invoice_date: '2026-07-08', total: 548652, amount_paid: 0,
  balance_due: 548652, payment_status: 'unpaid', contact_name: 'Tata Steel Limited',
};

/** The detail payload, with the phone number switchable. */
const detailFor = (phone) => ({
  invoice: {
    ...LIST_ROW,
    subtotal: 464960, cgst: 41846, sgst: 41846, igst: 0, is_igst: false,
    discount: 0, doc_status: 'final', contact_phone: phone,
    contact_company: 'Tata Steel', line_items: [
      { description: 'Office fit-out', hsn_code: '995461', quantity: 1, unit: 'NOS', rate: 325000, gst_rate: 18, line_total: 325000 },
    ],
  },
  payments: [],
});

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

/**
 * Mount the tab, then open the first invoice.
 * The drawer portals to document.body, so it is queried there, not in container.
 */
async function openInvoice(phone) {
  get.mockImplementation((url) => {
    if (url.includes('/invoices/inv-1')) return Promise.resolve({ data: detailFor(phone) });
    if (url.includes('/org/profile')) return Promise.resolve({ data: {} });
    return Promise.resolve({ data: { data: [LIST_ROW] } });
  });

  await act(async () => { root.render(<ToastProvider><InvoicesTab /></ToastProvider>); });
  await act(async () => {});

  const trigger = [...container.querySelectorAll('button')]
    .find(b => b.textContent.trim() === 'INV-2607');
  expect(trigger, 'the invoice number should be a button that opens the record').toBeTruthy();

  await act(async () => { trigger.click(); });
  await act(async () => {});

  return document.body.querySelector('[role="dialog"]');
}

const buttonNamed = (scope, label) =>
  [...scope.querySelectorAll('button')].find(b => b.textContent.trim() === label);

describe('the invoice record is a popup, not a page', () => {
  it('opens a modal dialog', async () => {
    const dialog = await openInvoice('9820041120');

    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toContain('INV-2607');
  });

  it('leaves the ledger mounted underneath', async () => {
    await openInvoice('9820041120');

    // The takeover this replaces unmounted the table entirely. If the list is
    // gone, the record is a page again whatever it is styled like.
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.textContent).toContain('Tata Steel Limited');
  });

  it('has no "back to list" affordance — the scrim and Escape are the way out', async () => {
    const dialog = await openInvoice('9820041120');

    expect(dialog.textContent).not.toMatch(/back to list/i);
    expect(document.body.querySelector('.dr__scrim')).toBeTruthy();
    expect(buttonNamed(dialog, '×')).toBeTruthy();
  });
});

describe('the invoice offers both send routes', () => {
  it('renders Download PDF and Send on WhatsApp together', async () => {
    const dialog = await openInvoice('9820041120');

    expect(buttonNamed(dialog, 'Download PDF')).toBeTruthy();
    expect(buttonNamed(dialog, 'Send on WhatsApp')).toBeTruthy();
  });

  it('enables WhatsApp when the contact carries a phone number', async () => {
    const dialog = await openInvoice('9820041120');
    const wa = buttonNamed(dialog, 'Send on WhatsApp');

    expect(wa.disabled).toBe(false);
    expect(wa.getAttribute('title')).toMatch(/you choose the chat/i);
  });

  it('disables WhatsApp and says why when the contact has no number', async () => {
    // A dead button that fails on press is the failure mode this avoids.
    const dialog = await openInvoice(null);
    const wa = buttonNamed(dialog, 'Send on WhatsApp');

    expect(wa.disabled).toBe(true);
    expect(wa.getAttribute('title')).toMatch(/no phone number/i);
  });
});

describe('the invoice drawer shows server figures', () => {
  it('splits CGST and SGST rather than showing IGST on an intra-state invoice', async () => {
    const dialog = await openInvoice('9820041120');

    expect(dialog.textContent).toContain('CGST');
    expect(dialog.textContent).toContain('SGST');
    expect(dialog.textContent).not.toContain('IGST');
  });

  it('renders the total with Indian digit grouping', async () => {
    const dialog = await openInvoice('9820041120');

    // ₹5,48,652 — not ₹548,652.
    expect(dialog.textContent).toContain('₹5,48,652');
  });
});
