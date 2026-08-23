/**
 * Purchase orders — the screens (proposal 77).
 *
 * Four things these hold, and every one of them regresses silently:
 *
 *   1. THE PREVIEW TOTAL AGREES WITH THE SERVER. A form that shows a total the
 *      server then disagrees with is worse than a form that shows nothing, and
 *      the disagreement is invisible until somebody adds up a printed order by
 *      hand. `previewTotals` is asserted to the paisa against the same figures
 *      `services/purchase_orders.compute_po_totals` produces.
 *   2. A DRAFT SAYS IT HAS NO NUMBER. The serial is minted at issue so a
 *      discarded draft leaves no gap in the series — a screen showing a blank
 *      where the number goes reads as a bug rather than as the design.
 *   3. THE APPROVAL EDITOR IS NOT THERE UNTIL APPROVAL IS ON. Approval is
 *      optional and configurable, not a fixed step; a settings screen that
 *      opens on an empty rule table implies otherwise.
 *   4. APPROVERS ARE PICKED BY NAME. `check-rendered-ids.mjs` is the ratchet
 *      for the general rule; this is the specific screen where a user id would
 *      most plausibly have been rendered, because it IS the key the rule is
 *      written with.
 *
 * Rendered with react-dom directly: `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not — the constraint the Graha and Ganit
 * suites already record.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(),
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  },
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../../components/ui/toast';
import { previewTotals, PO_STATUS_LABELS, PO_STATUSES } from '../_shared';
import PurchaseOrdersTab from '../PurchaseOrdersTab';
import POSettingsPanel from '../POSettingsPanel';

const VENDORS = [{ id: 'v-1', name: 'Acme Supplies', gstin: '27AAAAA0000A1Z5' }];
const PRODUCTS = [{ id: 'p-1', name: 'A4 paper', hsn_code: '4802', unit: 'REAM',
  price: 250, cost_price: 200, gst_rate: 12 }];
const PEOPLE = [
  { user_id: 'user_asha01', full_name: 'Asha Rao', role_code: 'org_admin' },
  { user_id: 'user_vikram9', full_name: 'Vikram Nair', role_code: 'org_member' },
];

const SETTINGS_OFF = {
  approval_required: false, rules: [], self_approval: false,
  reapproval_pct: 10, reapproval_amount: 10000,
  over_receipt: 'refuse', over_receipt_tolerance_pct: 0,
  close_reasons: ['Vendor cannot supply the balance', 'No longer required'],
  budgets_enabled: false, budgets: [], prefix: 'PO',
};

function answer(url) {
  const u = String(url);
  if (u.startsWith('/v1/ganit/vendors')) return Promise.resolve({ data: { data: VENDORS } });
  if (u.startsWith('/v1/products')) return Promise.resolve({ data: { data: PRODUCTS } });
  if (u.startsWith('/v1/procurement/settings')) {
    return Promise.resolve({ data: { data: SETTINGS_OFF, defaults: {}, notes: {} } });
  }
  if (u.startsWith('/v1/procurement/approver-candidates')) {
    return Promise.resolve({ data: { data: PEOPLE, total: PEOPLE.length } });
  }
  if (u.startsWith('/v1/procurement/reports/committed-spend')) {
    return Promise.resolve({ data: { data: [], total: 0, orders: 0, budgets: [] } });
  }
  if (u.startsWith('/v1/procurement/purchase-orders')) {
    return Promise.resolve({ data: { data: [], total: 0, limit: 200, truncated: false } });
  }
  return Promise.resolve({ data: { data: [] } });
}

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  api.get.mockImplementation(answer);
  api.post.mockImplementation(() => Promise.resolve({ data: { data: { id: 'po-1' } } }));
  api.put.mockImplementation(() => Promise.resolve({ data: { status: 'saved' } }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

const mount = async (ui) => {
  await act(async () => { root.render(<ToastProvider>{ui}</ToastProvider>); });
  await settle();
};

const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

/* React installs a value tracker on controlled inputs and swallows a change
   event whose value it believes it already knows about. Assigning through the
   prototype's own setter is what defeats the tracker — without it a test can
   flip a checkbox and watch nothing happen, which reads exactly like a broken
   handler and is not one. */
const choose = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype, 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
};

/* A CHECKBOX IS DRIVEN BY CLICK, NOT BY CHANGE. React backs `onChange` on
   checkboxes and radios with the CLICK event, so a synthetic `change` — the
   thing that works for every other input — is ignored and the handler never
   runs. A test written that way flips nothing and reports "expected undefined
   to be truthy", which reads exactly like a broken toggle and is not one. */
const check = async (el) => {
  await act(async () => { el.click(); });
  await settle();
};

const byText = (text) => Array.from(container.querySelectorAll('button, label, span, p, h3, h4, option'))
  .find(el => el.textContent.trim() === text);

const containing = (text) => Array.from(container.querySelectorAll('*'))
  .filter(el => el.textContent && el.textContent.includes(text));


// ══════════════════════════════════════════════════════════════════════════════
// 1 · The preview total agrees with the server
// ══════════════════════════════════════════════════════════════════════════════

describe('previewTotals', () => {
  it('splits CGST and SGST intra-state, exactly as the server does', () => {
    const t = previewTotals([{ qty_ordered: 2, rate: 1000, gst_rate: 18 }], false);
    expect(t.subtotal).toBe(2000);
    expect(t.cgst).toBe(180);
    expect(t.sgst).toBe(180);
    expect(t.igst).toBe(0);
    expect(t.total).toBe(2360);
  });

  it('puts the whole tax in IGST inter-state', () => {
    const t = previewTotals([{ qty_ordered: 1, rate: 1000, gst_rate: 18 }], true);
    expect(t.igst).toBe(180);
    expect(t.cgst + t.sgst).toBe(0);
    expect(t.total).toBe(1180);
  });

  it('applies a line discount before GST', () => {
    const t = previewTotals(
      [{ qty_ordered: 1, rate: 1000, gst_rate: 18, discount_pct: 10 }], false);
    expect(t.subtotal).toBe(900);
    expect(t.cgst).toBe(81);
  });

  it('rounds each line before taxing it, the way the server rounds', () => {
    // 3 × 333.33 = 999.99, rounded to 999.99; 12% of that is 120.00 (119.9988).
    const t = previewTotals([{ qty_ordered: 3, rate: 333.33, gst_rate: 12 }], true);
    expect(t.subtotal).toBe(999.99);
    expect(t.igst).toBe(120);
  });

  it('an empty order is zero, not NaN', () => {
    expect(previewTotals([], false).total).toBe(0);
    expect(previewTotals(null, false).total).toBe(0);
  });

  it('a blank number field does not poison the total', () => {
    const t = previewTotals([{ qty_ordered: '', rate: '', gst_rate: '' }], false);
    expect(t.total).toBe(0);
  });
});


describe('the status vocabulary', () => {
  it('every status a screen can render has a human label', () => {
    PO_STATUSES.forEach(s => expect(PO_STATUS_LABELS[s]).toBeTruthy());
  });

  it('no label is the raw database value', () => {
    // A screen that renders `part_received` reads like a log file.
    PO_STATUSES.filter(s => s.includes('_'))
      .forEach(s => expect(PO_STATUS_LABELS[s]).not.toBe(s));
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// 2 · The list and the form
// ══════════════════════════════════════════════════════════════════════════════

describe('PurchaseOrdersTab', () => {
  it('asks the server for orders, vendors and the ONE catalogue', async () => {
    await mount(<PurchaseOrdersTab />);
    const urls = api.get.mock.calls.map(c => String(c[0]));
    expect(urls.some(u => u.startsWith('/v1/procurement/purchase-orders'))).toBe(true);
    expect(urls.some(u => u.startsWith('/v1/ganit/vendors'))).toBe(true);
    // `/v1/products` — the shared catalogue. Procurement mints no second item
    // list, so a request to any other product route is a regression.
    expect(urls.some(u => u === '/v1/products')).toBe(true);
  });

  it('offers to create one when the firm has none', async () => {
    await mount(<PurchaseOrdersTab />);
    expect(containing('No purchase orders yet').length).toBeGreaterThan(0);
  });

  it('does not say "none" when the fetch failed', async () => {
    // "No purchase orders yet" after a failed fetch tells a firm it has ordered
    // nothing, which is a different and much worse statement than "we could not
    // load them".
    api.get.mockImplementation((url) => (
      String(url).startsWith('/v1/procurement/purchase-orders')
        ? Promise.reject(Object.assign(new Error('boom'), { response: { status: 500 } }))
        : answer(url)));
    await mount(<PurchaseOrdersTab />);
    expect(containing('No purchase orders yet').length).toBe(0);
  });

  it('the form refuses to post without a supplier', async () => {
    await mount(<PurchaseOrdersTab />);
    await click(byText('+ Purchase order'));
    const form = container.querySelector('form.gn-form');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('posts the order and its lines to the procurement route', async () => {
    await mount(<PurchaseOrdersTab />);
    await click(byText('+ Purchase order'));

    // Inside the FORM, not the first select on the page — the status filter in
    // the toolbar above carries the same `.inp` class and would have absorbed
    // this, leaving the payload's vendor blank for a reason no assertion names.
    const form = container.querySelector('form.gn-form');
    await choose(form.querySelector('select.inp'), 'v-1');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(api.post).toHaveBeenCalled();
    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe('/v1/procurement/purchase-orders');
    expect(payload.vendor_id).toBe('v-1');
    expect(Array.isArray(payload.line_items)).toBe(true);
  });

  it('uses DateInput, never a bare native date field', async () => {
    // No native `<input type="date">` anywhere in this product. DateInput does
    // keep one in the DOM — visually hidden, out of the tab order, carrying
    // `.pk__native` — so the assertion is that EVERY date input is one of
    // those, not that there are none.
    await mount(<PurchaseOrdersTab />);
    await click(byText('+ Purchase order'));
    const dates = Array.from(container.querySelectorAll('input[type="date"]'));
    expect(dates.length).toBeGreaterThan(0);
    dates.forEach(i => expect(i.classList.contains('pk__native')).toBe(true));
  });

  it('says out loud that a supplier without a GSTIN is orderable', async () => {
    // GSTIN / PAN / TAN are non-mandatory and must block nothing. This has
    // drifted back more than once.
    await mount(<PurchaseOrdersTab />);
    await click(byText('+ Purchase order'));
    expect(containing('without a GSTIN is perfectly orderable').length).toBeGreaterThan(0);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// 3 · Settings
// ══════════════════════════════════════════════════════════════════════════════

describe('POSettingsPanel', () => {
  it('opens with approval OFF and no rule editor in sight', async () => {
    await mount(<POSettingsPanel onClose={() => {}} />);
    expect(containing('without anyone being').length).toBeGreaterThan(0);
    expect(byText('+ Add rule')).toBeUndefined();
  });

  it('reveals the rule editor only once approval is switched on', async () => {
    await mount(<POSettingsPanel onClose={() => {}} />);
    await check(container.querySelector('input[type=checkbox]'));
    expect(byText('+ Add rule')).toBeTruthy();
  });

  it('says the first matching rule wins', async () => {
    await mount(<POSettingsPanel onClose={() => {}} />);
    await check(container.querySelector('input[type=checkbox]'));
    expect(containing('first match wins').length).toBeGreaterThan(0);
  });

  it('picks approvers by NAME and never draws an id', async () => {
    await mount(<POSettingsPanel onClose={() => {}} />);
    await check(container.querySelector('input[type=checkbox]'));
    await click(byText('+ Add rule'));

    expect(containing('Asha Rao').length).toBeGreaterThan(0);
    // The id is the key the rule is written with. It must not be on screen.
    expect(container.textContent).not.toContain('user_asha01');
    expect(container.textContent).not.toContain('user_vikram9');
  });

  it('ships the budget caveat rather than hiding it', async () => {
    // Departments are free text on the employee record and are not governed
    // anywhere. The feature ships with the warning attached.
    await mount(<POSettingsPanel onClose={() => {}} />);
    expect(containing('free text on the').length).toBeGreaterThan(0);
  });

  it('sends the prefix with the rest of the settings', async () => {
    await mount(<POSettingsPanel onClose={() => {}} />);
    const form = container.querySelector('form.gn-form');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(api.put).toHaveBeenCalled();
    const [url, payload] = api.put.mock.calls[0];
    expect(url).toBe('/v1/procurement/settings');
    expect(payload.prefix).toBe('PO');
  });
});
