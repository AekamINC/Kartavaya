/**
 * Unit tests for the Ganit WhatsApp deep link.
 *
 * The owner asked for "Send on WhatsApp" beside "Download PDF" on the invoice.
 * This asserts the URL the button would open and NEVER opens it — no network,
 * no `window.open`, no message to anybody. That is deliberate: the module under
 * test sends invoices to real customers, and a test that exercised the send
 * path would be indistinguishable from a real one at the far end.
 *
 * `waLink` lives in `pages/ganit/_shared.jsx` rather than nested inside the
 * component precisely so it can be checked here.
 */

import { describe, it, expect } from 'vitest';
import { waLink, waInvoiceText, payLink } from '../pages/ganit/_shared';

describe('waLink()', () => {
  it('assumes +91 for a bare ten-digit Indian number', () => {
    const url = waLink('9820041120', 'hi');
    expect(url.startsWith('https://wa.me/919820041120?')).toBe(true);
  });

  it('leaves a number that already carries a country code alone', () => {
    // 12 digits — 91 + 10. Prefixing again would produce 9191…
    expect(waLink('919820041120', 'hi')).toContain('wa.me/919820041120?');
  });

  it('strips punctuation, spaces and the leading plus', () => {
    // wa.me accepts digits only; a `+` in the path yields a 404 page.
    for (const raw of ['+91 98200 41120', '+91-98200-41120', '(91) 9820041120']) {
      expect(waLink(raw, 'hi')).toContain('wa.me/919820041120?');
    }
  });

  it('returns null when there is no usable number', () => {
    // The button is disabled on null rather than opening a broken chat.
    expect(waLink('', 'hi')).toBeNull();
    expect(waLink(null, 'hi')).toBeNull();
    expect(waLink(undefined, 'hi')).toBeNull();
    expect(waLink('not a phone', 'hi')).toBeNull();
  });

  it('percent-encodes the message so ₹, # and & survive the query string', () => {
    const url = waLink('9820041120', 'Invoice INV-1 & #2 for ₹1,000');
    // A raw & would split the query and truncate the message at "Invoice INV-1".
    expect(url).not.toContain('& #2');
    expect(url).toContain('%26');
    expect(url).toContain('%23');
    expect(url).toContain('%E2%82%B9');
    expect(decodeURIComponent(url.split('?text=')[1])).toBe('Invoice INV-1 & #2 for ₹1,000');
  });

  it('always targets wa.me over https', () => {
    // The deep link is opened with noopener/noreferrer; the scheme is the other
    // half of that — an http:// link here would be a downgrade on every send.
    expect(waLink('9820041120', 'x')).toMatch(/^https:\/\/wa\.me\//);
  });
});

describe('waInvoiceText()', () => {
  it('names the document type, number, date and amount', () => {
    const text = waInvoiceText({
      invoice_type: 'tax_invoice',
      invoice_number: 'INV-2607',
      invoice_date: '2026-07-08',
      total: 548652,
    });
    expect(text).toContain('Tax Invoice');
    expect(text).toContain('INV-2607');
    expect(text).toContain('2026-07-08');
    // Indian grouping, not 548,652 — the recipient is Indian by construction.
    expect(text).toContain('₹5,48,652');
  });

  it('falls back to a generic label for an unknown document type', () => {
    expect(waInvoiceText({ invoice_number: 'X-1' })).toContain('Invoice');
  });

  it('omits the amount rather than printing ₹0 when there is no total', () => {
    // "for ₹0" on an invoice is a wrong figure sent to a customer.
    const text = waInvoiceText({ invoice_number: 'X-1', invoice_date: '2026-07-08' });
    expect(text).not.toContain('₹');
  });

  it('reads the quotation label for a quotation', () => {
    expect(waInvoiceText({ invoice_type: 'quotation', invoice_number: 'Q-9' })).toContain('Quotation');
  });
});

/* ── P5: the message leads with the LINK ────────────────────────────────────
   The owner sent a real invoice on 2026-08-08 and it arrived as "Tax Invoice
   INV-2026-0088 dated 2026-08-08 for ₹14,160." — a description of a document,
   with the document nowhere in it. P1-P4 built the page that fixes that; until
   this text carries the URL, none of it is reachable from the send button. */
const PAYABLE = {
  invoice_type: 'tax_invoice',
  invoice_number: 'INV-2026-0088',
  invoice_date: '2026-08-08',
  due_date: '2026-08-22',
  total: 14160,
  balance_due: 14160,
  doc_status: 'final',
  payment_status: 'unpaid',
  pay_token: 'dntsbrOISlW76ldv',
};

describe('payLink()', () => {
  it('builds /i/{token} for an issued, unpaid invoice', () => {
    expect(payLink(PAYABLE)).toBe(`${window.location.origin}/i/dntsbrOISlW76ldv`);
  });

  it('refuses a DRAFT — the firm has not finished the document', () => {
    // `routers/pay.py` 404s a draft, so a link here would be a dead URL sent to
    // a customer. Worse than no link, because it looks like the product failed.
    expect(payLink({ ...PAYABLE, doc_status: 'draft' })).toBeNull();
  });

  it('refuses a settled invoice', () => {
    // The public route refuses it, and asking someone to pay twice is the one
    // mistake in this flow that costs the org its customer.
    expect(payLink({ ...PAYABLE, payment_status: 'paid' })).toBeNull();
  });

  it('returns null when the row predates migration 128', () => {
    const { pay_token, ...noToken } = PAYABLE;
    expect(payLink(noToken)).toBeNull();
  });
});

describe('waInvoiceText() with a pay link', () => {
  it('carries the link, on its own line', () => {
    const text = waInvoiceText(PAYABLE);
    const link = payLink(PAYABLE);
    expect(text).toContain(link);
    // WhatsApp builds its preview card from a URL it can find. A URL with a
    // full stop pushed against it is a URL that gets mis-detected, and the
    // preview card is most of why the link is worth sending at all.
    expect(text.split('\n')).toContain(link);
  });

  it('leads with what is owed, not with the document type and a date', () => {
    const text = waInvoiceText(PAYABLE);
    expect(text.split('\n')[0]).toContain('₹14,160');
    expect(text.split('\n')[0]).toContain('INV-2026-0088');
  });

  it('quotes the BALANCE on a part-paid invoice, never the original total', () => {
    // Asking for ₹14,160 when ₹4,160 is owed is a demand for money that is not
    // due, sent to a customer who has already paid most of the bill.
    const text = waInvoiceText({ ...PAYABLE, payment_status: 'partial', balance_due: 4160 });
    expect(text).toContain('₹4,160');
    expect(text).not.toContain('₹14,160');
  });

  it('says what the link is, because an unexplained URL does not get tapped', () => {
    expect(waInvoiceText(PAYABLE).toLowerCase()).toContain('browser');
  });

  it('falls back to the old sentence when there is no shareable link', () => {
    const text = waInvoiceText({ ...PAYABLE, doc_status: 'draft' });
    expect(text).toBe('Tax Invoice INV-2026-0088 dated 2026-08-08 for ₹14,160.');
  });
});
