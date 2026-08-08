/**
 * P4 — the preview card a crawler gets for `/i/{token}`.
 *
 * WhatsApp runs no JavaScript, so without this the card for a shared invoice is
 * the app's generic description. What matters here is not that the happy path
 * renders — it is that the card CANNOT become an oracle. `routers/pay.py` goes
 * to some trouble to make an unknown token and a settled invoice
 * indistinguishable; giving that away in a meta tag would undo it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../../api/og.js';

function res() {
  const r = { headers: {}, code: 0, body: '' };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
}

const TOKEN = 'dntsbrOISlW76ldv';

const PAYABLE = {
  invoice: { number: 'INV-2026-0088', due_date: '2026-08-22' },
  payee: { name: 'Unicode Group' },
  totals: { amount_due: 14160 },
};

beforeEach(() => { process.env.VITE_BACKEND_URL = 'https://api.example'; });
afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(ok, body) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));
}

describe('the invoice preview card', () => {
  it('names who it is from and how much', async () => {
    stubFetch(true, PAYABLE);
    const r = res();
    await handler({ query: { token: TOKEN } }, r);
    expect(r.body).toContain('og:title');
    expect(r.body).toContain('Unicode Group');
    expect(r.body).toContain('₹14,160');
    expect(r.body).toContain('INV-2026-0088');
  });

  it('shows no line items — a forwarded chat must not spill an order book', async () => {
    stubFetch(true, { ...PAYABLE, lines: [{ description: 'Office fit-out' }] });
    const r = res();
    await handler({ query: { token: TOKEN } }, r);
    expect(r.body).not.toContain('Office fit-out');
  });

  it('gives a REFUSED invoice the same card as an unknown token', async () => {
    // THE ONE THAT MATTERS. A card reading "this invoice is settled" confirms a
    // real token to somebody holding a guess — the single bit the public route
    // is written to withhold.
    stubFetch(false, null);
    const refused = res();
    await handler({ query: { token: TOKEN } }, refused);

    const unknown = res();
    await handler({ query: { token: 'ZZZZZZZZZZZZZZZZ' } }, unknown);

    expect(refused.body).toBe(unknown.body);
    expect(refused.body).toContain('Invoice — Kartavaya');
  });

  it('falls back rather than failing when the backend is unreachable', async () => {
    // A backend hiccup must not 500 a link somebody just shared. A worse
    // preview is not a broken one.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = res();
    await handler({ query: { token: TOKEN } }, r);
    expect(r.code).toBe(200);
    expect(r.body).toContain('Invoice — Kartavaya');
  });

  it('escapes the payee name — it lands inside a quoted attribute', async () => {
    stubFetch(true, { ...PAYABLE, payee: { name: 'A" onload="x' } });
    const r = res();
    await handler({ query: { token: TOKEN } }, r);
    expect(r.body).not.toContain('onload="x');
    expect(r.body).toContain('&quot;');
  });

  it('is never cached by a shared cache — the card carries an amount', async () => {
    stubFetch(true, PAYABLE);
    const r = res();
    await handler({ query: { token: TOKEN } }, r);
    expect(r.headers['cache-control']).toContain('private');
  });

  it('asks not to be indexed', async () => {
    // A payment link in a search index is a payment link handed to strangers.
    stubFetch(true, PAYABLE);
    const r = res();
    await handler({ query: { token: TOKEN } }, r);
    expect(r.body).toContain('noindex');
  });
});
