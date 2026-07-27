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
const request = vi.fn();

vi.mock('../lib/api', () => ({
  api: { get: (...a) => get(...a), request: (...a) => request(...a) },
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
  request.mockReset();
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

/** The manifest `GET /v1/documents/gst/gstr1/{period}/preview` answers. */
function gstr1Preview(over = {}) {
  return {
    data: {
      period: '2026-07',
      fp: '072026',
      gstin: '27AAACA1234M1ZV',
      sections_emitted: ['b2b', 'hsn', 'doc_issue'],
      sections_omitted: [
        { section: 'cdnr', reason: 'no link to the document the note amends' },
        { section: 'exp', reason: 'no shipping bill store' },
      ],
      invoice_count: 3,
      held_back: [],
      excluded: [],
      credit_debit_notes_not_in_file: [],
      reconciliation: {
        reported_taxable_value: 245000,
        source_taxable_value: 245000,
        taxable_value_difference: 0,
        reported_tax: 44100,
        source_tax: 44100,
        tax_difference: 0,
      },
      ...over,
    },
  };
}

/** The manifest `GET /v1/documents/tally/{period}/preview` answers. */
function tallyPreview(over = {}) {
  return {
    data: {
      sales_count: 3, credit_note_count: 0, debit_note_count: 0,
      purchase_count: 2, voucher_count: 5, held_back: [],
      period_from: '2026-07-01', period_to: '2026-08-01',
      ...over,
    },
  };
}

/**
 * Route the three GETs this screen now makes.
 *
 * A single blanket `mockImplementation` would answer the two export previews
 * with the GSTR-3B summary, and the panel would then render counts out of a
 * body that has none — a green test over a screen printing "undefined
 * vouchers". Each route answers its own shape, and a value that is an `Error`
 * is REJECTED so a test can fail one route without failing the others.
 */
function mockRoutes({ gstr3b = summary(), gstr1 = gstr1Preview(), tally = tallyPreview() } = {}) {
  const answer = v => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v));
  get.mockImplementation((url) => {
    if (url.includes('/gstr3b/')) return answer(gstr3b);
    if (url.includes('/gstr1/')) return answer(gstr1);
    if (url.includes('/tally/')) return answer(tally);
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
}

/** An axios-shaped rejection, which is what the real client throws. */
function httpError(status, detail) {
  const err = new Error(`HTTP ${status}`);
  err.response = { status, data: { detail } };
  return err;
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
    mockRoutes();
    await mount();

    expect(container.textContent).toContain('Outward taxable supplies');
    // Rendered through `inr`, so assert on the grouped digits.
    expect(container.textContent).toMatch(/44,100/);
    expect(container.textContent).toMatch(/20 Aug 2026/);
  });

  it('never prints a bare zero for a row with no store behind it', async () => {
    mockRoutes();
    await mount();

    const row = [...container.querySelectorAll('.gn-gst__row')]
      .find(el => el.textContent.includes('reverse charge'));
    expect(row).toBeTruthy();
    expect(row.textContent).toMatch(/not recorded/i);
    // A zero would assert that no reverse-charge liability arose.
    expect(row.textContent).not.toMatch(/₹\s*0\b/);
  });

  it('names the parties behind a blocker rather than only counting them', async () => {
    mockRoutes({
      gstr3b: summary({
        checks: [{
          code: 'counterparty_gstin_invalid',
          severity: 'blocking',
          title: '1 counterparty GSTIN fails the check digit',
          detail: 'A GSTIN carries its own checksum.',
          fix: 'Graha → Contacts',
          items: ['Nirmal Exports Pvt Ltd — 27AAACA1234M1Z9'],
        }],
      }),
    });
    await mount();

    expect(container.textContent).toContain('Nirmal Exports Pvt Ltd');
    expect(container.textContent).toContain('1 blocker');
    expect(container.textContent).toContain('Graha → Contacts');
  });

  it('reports no blockers as such rather than leaving the panel blank', async () => {
    mockRoutes();
    await mount();

    expect(container.textContent).toMatch(/No blockers/i);
  });

  it('states that GSTR-2B reconciliation is unavailable and invents no match rate', async () => {
    mockRoutes();
    await mount();

    expect(container.textContent).toMatch(/GSTR-2B/);
    expect(container.textContent).toMatch(/no 2B store|nowhere to put/i);
    // The reference's mock figures must not have survived into the build.
    expect(container.textContent).not.toMatch(/42\s*\/\s*47/);
    expect(container.textContent).not.toMatch(/3 mismatched/i);
  });

  it('makes no claim to be a GSP or to reach the IRP', async () => {
    mockRoutes();
    await mount();

    expect(container.textContent).not.toMatch(/registered GSP/i);
    expect(container.textContent).not.toMatch(/Last sync/i);
    // And it says the opposite, plainly.
    expect(container.textContent).toMatch(/not a GSP/i);
  });

  it('offers the working paper and both data exports', async () => {
    mockRoutes();
    await mount();

    const buttons = [...container.querySelectorAll('button')];
    const gstr3b = buttons.find(b => /Export GSTR-3B/i.test(b.textContent));
    const gstr1 = buttons.find(b => /GSTR-1 JSON/i.test(b.textContent));
    const tally = buttons.find(b => /Tally export/i.test(b.textContent));

    expect(gstr3b?.disabled).toBe(false);
    expect(gstr1?.disabled).toBe(false);
    expect(tally?.disabled).toBe(false);
  });

  it('builds a share URL and never dispatches anything', async () => {
    mockRoutes();
    await mount();

    const share = [...container.querySelectorAll('a')]
      .find(a => /Share with your CA/i.test(a.textContent));
    expect(share).toBeTruthy();
    // A mailto with NO recipient: the user picks one and presses send.
    expect(share.getAttribute('href')).toMatch(/^mailto:\?/);
    // Three READS and nothing else — the summary plus the two export previews.
    // No send endpoint, and no export was built merely by opening the screen.
    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls.map(c => c[0]).join(' ')).toContain('/v1/documents/gst/gstr3b/');
    expect(request).not.toHaveBeenCalled();
  });

  it('will not submit a challan whose CIN is incomplete', async () => {
    mockRoutes();
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


/**
 * The exports panel.
 *
 * These two files go to accounting firms who file from them. The failure that
 * matters is not a broken button — it is a file that silently drops four
 * invoices, or an export that answers "done" having produced nothing.
 */
describe('Data exports — what is in the file, and what is not', () => {
  const exportButtons = () => [...container.querySelectorAll('button')];
  const gstr1Button = () => exportButtons().find(b => /GSTR-1 JSON/i.test(b.textContent));
  const tallyButton = () => exportButtons().find(b => /Tally export/i.test(b.textContent));

  it('says plainly that neither file is a return or a filing', async () => {
    mockRoutes();
    await mount();

    expect(container.textContent).toMatch(/your own data, for your own software/i);
    expect(container.textContent).toMatch(/Neither is a return/i);
    expect(container.textContent).toMatch(/neither states a tax liability/i);
  });

  it('reports the voucher counts and the sections the GSTR-1 file carries', async () => {
    mockRoutes();
    await mount();

    expect(container.textContent).toMatch(/5 vouchers/);
    expect(container.textContent).toMatch(/3 sales/);
    expect(container.textContent).toContain('b2b, hsn, doc_issue');
  });

  it('names every held-back document and its reason rather than only counting', async () => {
    mockRoutes({
      tally: tallyPreview({
        voucher_count: 1, sales_count: 1,
        held_back: [{ document: 'INV-2026-0004', reason: 'no customer name' }],
      }),
      gstr1: gstr1Preview({
        held_back: [{ document: 'INV-2026-0007', reason: 'a line has no HSN or SAC code' }],
      }),
    });
    await mount();

    expect(container.textContent).toMatch(/2 documents are held back/i);
    expect(container.textContent).toContain('INV-2026-0004');
    expect(container.textContent).toContain('no customer name');
    expect(container.textContent).toContain('INV-2026-0007');
    expect(container.textContent).toContain('a line has no HSN or SAC code');
  });

  it('states which GSTR-1 sections are never carried, so a gap is not read as a nil', async () => {
    mockRoutes();
    await mount();

    expect(container.textContent).toMatch(/sections this file never carries/i);
    expect(container.textContent).toMatch(/cdnr/);
    // The precise wrong reading this copy exists to prevent.
    expect(container.textContent).toMatch(/there were none/i);
  });

  it('warns that credit notes are absent from the GSTR-1 file', async () => {
    mockRoutes({
      gstr1: gstr1Preview({ credit_debit_notes_not_in_file: ['CN-2026-0001 (credit note)'] }),
    });
    await mount();

    expect(container.textContent).toMatch(/Not in the GSTR-1 file/i);
    expect(container.textContent).toContain('CN-2026-0001');
    expect(container.textContent).toMatch(/Enter these on the portal yourself/i);
  });

  it('shows the reconciliation against the invoices themselves', async () => {
    mockRoutes();
    await mount();

    expect(container.textContent).toMatch(/Reported taxable value/i);
    expect(container.textContent).toMatch(/2,45,000/);
  });

  it('keeps the GSTR-3B panel alive when only the GSTR-1 preview refuses', async () => {
    // A missing org GSTIN refuses GSTR-1 and nothing else. Blanking the filing
    // summary for it would report the wrong problem.
    mockRoutes({ gstr1: httpError(422, { error: 'supplier_gstin_missing' }) });
    await mount();

    expect(container.textContent).toContain('Outward taxable supplies');
    expect(container.textContent).toMatch(/GSTR-1:\s*unavailable/i);
    // Tally still reports its real figures.
    expect(container.textContent).toMatch(/5 vouchers/);
  });

  it('shows an error with a retry when both previews fail, and no counts', async () => {
    mockRoutes({
      gstr1: httpError(500, 'boom'),
      tally: httpError(500, 'boom'),
    });
    await mount();

    // Loading, empty and ERROR are three states; a count of zero would be a
    // claim about the period rather than a report of a failed fetch.
    expect(container.textContent).not.toMatch(/0 vouchers/);
    expect(container.querySelector('.k-err, [role="alert"]')).toBeTruthy();
  });

  it('a zero-voucher period reports zero rather than hiding the panel', async () => {
    mockRoutes({
      tally: tallyPreview({ voucher_count: 0, sales_count: 0, purchase_count: 0 }),
    });
    await mount();

    // Not the empty state: it is the answer, and the button will refuse with a
    // 422 saying the same thing.
    expect(container.textContent).toMatch(/0 vouchers/);
  });

  it('a failed export says so and never leaves the button stuck', async () => {
    mockRoutes();
    request.mockRejectedValue(httpError(422, {
      error: 'export_empty',
      message: 'Nothing to export for 2026-07.',
    }));
    await mount();

    await act(async () => { tallyButton().click(); });

    // The refusal is on screen, in its own alert, with the reason the backend
    // gave — not a toast that has faded, and not a downloaded empty file.
    const alert = [...container.querySelectorAll('[role="alert"]')]
      .find(el => /Nothing to export/i.test(el.textContent));
    expect(alert).toBeTruthy();
    expect(alert.textContent).toMatch(/Could not build the Tally export/i);
    expect(tallyButton().disabled).toBe(false);
  });

  it('requests the export routes as GETs, which is what makes them readable by a viewer', async () => {
    mockRoutes();
    request.mockResolvedValue({ data: new Blob(['<ENVELOPE/>']), headers: {} });
    // jsdom has no object-URL implementation.
    const created = [];
    globalThis.URL.createObjectURL = vi.fn(() => { created.push(1); return 'blob:x'; });
    globalThis.URL.revokeObjectURL = vi.fn();

    await mount();
    await act(async () => { gstr1Button().click(); });
    await act(async () => { tallyButton().click(); });

    const calls = request.mock.calls.map(c => c[0]);
    // GET, not POST. `_is_write` treats every POST as a write unless its suffix
    // is allow-listed, so a POST here would refuse a viewer who is entitled to
    // the data.
    expect(calls.map(c => c.method)).toEqual(['get', 'get']);
    expect(calls[0].url).toMatch(/^\/v1\/documents\/gst\/gstr1\/\d{4}-\d{2}\/json$/);
    expect(calls[1].url).toMatch(/^\/v1\/documents\/tally\/\d{4}-\d{2}$/);
    // Every object URL that was created was released.
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledTimes(created.length);
  });
});
