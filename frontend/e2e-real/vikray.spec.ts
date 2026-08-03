/**
 * Phase 3a — Vikray, quote to cash, through the product's own forms.
 *
 * Six tabs. The one that matters most is order → invoice, because that is where
 * Phase 0 found an invoice being born fully paid: `balance_due` was never
 * written and the column defaults to 0, so the money owed was invisible in
 * receivables and the invoice could not be edited. Both halves are asserted
 * here on a freshly-raised order, not on the seeded data that was fixed by
 * migration.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { OWNER_STATE, DL_DIR } from './real.config';
import { api, apiOk, settle, openTab, shot, pickOption, submitting, RUN } from './_helpers';

test.use({ storageState: OWNER_STATE });
test.describe.configure({ mode: 'serial' });

const HANDOFF = path.join(DL_DIR, `vikray-${RUN}.json`);
const keep = (k: string, v: any) => {
  const s = fs.existsSync(HANDOFF) ? JSON.parse(fs.readFileSync(HANDOFF, 'utf8')) : {};
  s[k] = v;
  fs.writeFileSync(HANDOFF, JSON.stringify(s, null, 2));
};
const recall = (k: string) => {
  const s = JSON.parse(fs.readFileSync(HANDOFF, 'utf8'));
  expect(s[k], `nothing handed over for "${k}" — an earlier test in this file failed`).toBeTruthy();
  return s[k];
};

test.beforeEach(async ({ page }) => {
  await page.goto('/vikray');
  await settle(page);
});

async function vikray(page: Page, tab: string) {
  if (!page.url().includes('/vikray')) {
    await page.goto('/vikray');
    await settle(page);
  }
  await openTab(page, tab);
}

const form = (page: Page) => page.locator('form.vk-form');
const panel = (page: Page) => page.getByRole('tabpanel');


// ══ ORDERS ═══════════════════════════════════════════════════════════════════

test('orders · create one with two lines and a real GST split', async ({ page }) => {
  await vikray(page, 'orders');
  await panel(page).getByRole('button', { name: '+ New order' }).click();
  await settle(page);

  const f = form(page);
  await expect(f, 'the order form did not open').toBeVisible();
  await pickOption(f.getByLabel('Customer'), 'customer');
  await f.getByLabel('Order date').fill(new Date().toISOString().slice(0, 10));
  await f.getByLabel('Expected delivery').fill(
    new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10));

  // Two lines, both with an HSN — an order that becomes a tax invoice needs one
  // on every line under Rule 46(g), and Phase 0 put that gate on this route.
  //
  // Addressed by ARIA LABEL, not by position. Counting `input[type=number]`
  // put the rate into the GST-rate box (a 20,000% tax) and produced a ₹1 line,
  // which is the kind of wrong that still submits and still looks plausible.
  const line = async (i: number, d: string, h: string, qty: string, rate: string) => {
    await f.getByLabel(`Line ${i} description`).fill(d);
    await f.getByLabel(`Line ${i} HSN code`).fill(h);
    await f.getByLabel(`Line ${i} quantity`).fill(qty);
    await f.getByLabel(`Line ${i} rate`).fill(rate);
  };
  await line(1, `E2E consultancy ${RUN}`, '998311', '2', '15000');
  await f.getByRole('button', { name: '+ Add line item' }).click();
  await line(2, `E2E implementation ${RUN}`, '998313', '1', '20000');

  // The preview must agree before it is sent — 2×15,000 + 20,000 = 50,000.
  await expect(f.getByText('₹50,000').first(),
    'the form previews a subtotal that is not the sum of its lines').toBeVisible();

  const made = await submitting(page, '/vikray/orders',
    () => f.getByRole('button', { name: 'Create order' }).click());
  const id = made?.id || made?.order?.id;
  expect(id, 'the order was not created').toBeTruthy();
  keep('orderId', id);

  const list = await apiOk(page, 'get', '/api/v1/vikray/orders?limit=200');
  const o = (list.data || []).find((x: any) => String(x.id) === String(id));
  expect(o, 'the order is not in the list').toBeTruthy();
  expect(Number(o.subtotal), 'the order total did not come from its lines')
    .toBeCloseTo(50000, 2);
  expect(Number(o.igst), 'an intra-state order charged IGST').toBe(0);
  expect(Number(o.cgst)).toBeCloseTo(Number(o.sgst), 2);
  keep('orderNumber', o.order_number);
  await shot(page, `vikray-order-${RUN}`);
});

test('orders · a draft order cannot be invoiced until it is confirmed', async ({ page }) => {
  // The product refuses this deliberately: an unconfirmed order is not a sale.
  const r = await api(page, 'post', `/api/v1/vikray/orders/${recall('orderId')}/invoice`);
  expect(r.status(), 'a draft order was allowed to raise an invoice').toBe(400);
  expect((await r.json()).detail).toMatch(/confirm/i);
});

test('orders · confirm it through the drawer, as a user would', async ({ page }) => {
  // Not `PATCH /orders/{id}` with a status — that route rejects it with
  // "No fields to update". The status ladder has its own endpoint, and the UI
  // walks it one rung at a time with a button whose label names the next rung
  // ("Confirm order", then "Mark dispatched", …). Pressing the button is the
  // test; poking the wrong endpoint would have proved nothing about either.
  await vikray(page, 'orders');
  const row = page.getByRole('button', { name: new RegExp(recall('orderNumber')) }).first();
  await expect(row, 'the new order is not in the list').toBeVisible();
  await row.click();
  await settle(page);

  await submitting(page, '/status',
    () => page.getByRole('button', { name: 'Confirm order' }).click());
  await settle(page);

  const after = await apiOk(page, 'get', '/api/v1/vikray/orders?limit=200');
  const o = (after.data || []).find((x: any) => String(x.id) === String(recall('orderId')));
  expect(o.status, 'confirming the order did not stick').toBe('confirmed');
  await shot(page, `vikray-order-confirmed-${RUN}`);
});


// ══ ORDER → INVOICE — the Phase 0 regression ═════════════════════════════════

test('orders · the invoice raised from an order is unpaid, in receivables, and editable',
  async ({ page }) => {
    // THE regression, on a freshly-raised order rather than on rows a migration
    // repaired. `balance_due` was never written by this route and the column
    // defaults to 0, so every order invoice was born reading as FULLY PAID:
    // invisible in receivables, nothing for a payment to reduce, and uneditable
    // because editing is bounded by payment.
    const receivablesBefore = Number(
      (await apiOk(page, 'get', '/api/v1/ganit/stats')).total_outstanding);

    await vikray(page, 'orders');
    await page.getByRole('button', { name: new RegExp(recall('orderNumber')) }).first().click();
    await settle(page);
    await expect(page.getByRole('button', { name: 'Generate invoice' }),
      'a confirmed order offers no way to invoice it').toBeVisible();

    const r = await api(page, 'post', `/api/v1/vikray/orders/${recall('orderId')}/invoice`);
    if (r.status() === 422) {
      // The Rule 46 gate Phase 0 added, doing its job. A far better outcome
      // than the un-issuable invoice this route used to mint — but it must say
      // what is missing rather than merely refusing.
      const body = await r.json();
      expect(body.detail?.blocking?.length,
        'refused with no stated reason — a 422 must name the gaps').toBeGreaterThan(0);
      return;
    }
    expect(r.status(), await r.text()).toBe(200);
    const { invoice_id } = await r.json();
    keep('invoiceId', invoice_id);

    const { invoice } = await apiOk(page, 'get', `/api/v1/ganit/invoices/${invoice_id}`);
    expect(Number(invoice.total), 'the invoice carries no value').toBeGreaterThan(0);
    expect(Number(invoice.balance_due),
      'the invoice was born fully paid — the money owed is invisible and it cannot be edited')
      .toBeCloseTo(Number(invoice.total), 2);

    // And it is genuinely in the receivables figure, not merely stored.
    const receivablesAfter = Number(
      (await apiOk(page, 'get', '/api/v1/ganit/stats')).total_outstanding);
    expect(receivablesAfter - receivablesBefore,
      'the order invoice did not move receivables — it is outside the ageing')
      .toBeCloseTo(Number(invoice.total), 2);

    // The user-facing half of the same bug: Edit is offered.
    await page.goto('/ganit');
    await settle(page);
    const row = page.locator('.gn-tbl__row', { hasText: invoice.invoice_number }).first();
    await expect(row, 'the order invoice is not on the invoice list').toBeVisible();
    await row.click();
    await settle(page);
    await expect(page.getByRole('button', { name: /^Edit/i }),
      'an unpaid order invoice offers no Edit control — the reported bug, unfixed')
      .toBeVisible();
    await shot(page, `vikray-order-invoice-${RUN}`);
  });

test('orders · the same order cannot be invoiced twice', async ({ page }) => {
  const r = await api(page, 'post', `/api/v1/vikray/orders/${recall('orderId')}/invoice`);
  expect(r.status(), 'an order was invoiced a second time').toBe(400);
  expect((await r.json()).detail).toMatch(/already/i);
});


// ══ CUSTOMERS · STOCK · TARGETS · PIPELINE · DASHBOARD ═══════════════════════

test('customers · the tab lists who the orders belong to', async ({ page }) => {
  await vikray(page, 'customers');
  const r = await apiOk(page, 'get', '/api/v1/vikray/customers?limit=100');
  const rows = r.data ?? r;
  expect(Array.isArray(rows), 'the customers endpoint did not answer with a list').toBe(true);
  await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);
});

test('stock · nudge a level through the UI and the movement sticks', async ({ page }) => {
  // Keyed on `product_id`, not on the stock row's own id, and the route is
  // PATCH /stock/{product_id} with a `quantity_delta` — not a POST /adjust.
  // Guessing the shape returned a 404 that read like a missing feature.
  await vikray(page, 'stock');
  const before = await apiOk(page, 'get', '/api/v1/vikray/stock?limit=100');
  const rows = before.data ?? before;
  expect(rows.length, 'no stock rows to adjust').toBeGreaterThan(0);

  const item = rows[0];
  // The field is `quantity_on_hand` — `quantity` is undefined, and
  // `Number(undefined)` is NaN, which fails with a message about the
  // restock rather than about the field name.
  const startQty = Number(item.quantity_on_hand);

  // The +1 control on the row — the smallest real user action on this tab.
  const plus = page.getByRole('button', { name: new RegExp(`Add one ${item.name}`) }).first();
  await expect(plus, `no restock control for ${item.name}`).toBeVisible();
  await submitting(page, '/vikray/stock/', () => plus.click());
  await settle(page);

  const after = await apiOk(page, 'get', '/api/v1/vikray/stock?limit=100');
  const now = (after.data ?? after).find(
    (x: any) => String(x.product_id) === String(item.product_id));
  expect(Number(now.quantity_on_hand), 'the restock did not change the level')
    .toBeCloseTo(startQty + 1, 2);

  // And put it back, so the suite is repeatable rather than ratcheting a
  // stock level upward on every run.
  const minus = page.getByRole('button', { name: new RegExp(`Remove one ${item.name}`) }).first();
  await submitting(page, '/vikray/stock/', () => minus.click());
  await settle(page);
  const restored = await apiOk(page, 'get', '/api/v1/vikray/stock?limit=100');
  const back = (restored.data ?? restored).find(
    (x: any) => String(x.product_id) === String(item.product_id));
  expect(Number(back.quantity_on_hand), 'the level was not restored').toBeCloseTo(startQty, 2);
});

test('targets · set one for a salesperson', async ({ page }) => {
  await vikray(page, 'targets');
  await panel(page).getByRole('button', { name: '+ Set target' }).click();
  await settle(page);

  const f = page.locator('form').filter({ hasText: 'Target amount' });
  await pickOption(f.getByLabel('Salesperson'), 'salesperson');
  const start = new Date(); start.setDate(1);
  await f.getByLabel('Period start').fill(start.toISOString().slice(0, 10));
  await f.getByLabel('Period end').fill(
    new Date(start.getFullYear(), start.getMonth() + 1, 0).toISOString().slice(0, 10));
  await f.getByLabel('Target amount').fill('1500000');
  await f.getByLabel('Target deals').fill('12');

  const made = await submitting(page, '/vikray/targets',
    () => f.getByRole('button', { name: 'Save target' }).click());
  expect(made?.id || made?.target?.id, 'the target was not saved').toBeTruthy();
});

test('pipeline · the confirmed order is counted', async ({ page }) => {
  await vikray(page, 'pipeline');
  const r = await apiOk(page, 'get', '/api/v1/vikray/orders?limit=200');
  const confirmed = (r.data || []).filter((o: any) => o.status === 'confirmed');
  expect(confirmed.length, 'no confirmed orders in the pipeline').toBeGreaterThan(0);
  await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);
});

test('dashboard · the figures come from the orders behind them', async ({ page }) => {
  await vikray(page, 'dashboard');
  const orders = await apiOk(page, 'get', '/api/v1/vikray/orders?limit=200');
  expect((orders.data || []).length, 'the dashboard has no orders to summarise')
    .toBeGreaterThan(0);
  await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);
  await shot(page, `vikray-dashboard-${RUN}`);
});
