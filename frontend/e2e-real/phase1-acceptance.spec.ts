/**
 * PHASE-1 ACCEPTANCE — the standard exercise.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * Owner, 2026-08-26: *"every phase you run an e2e add data via playwright with
 * actual manual add as user, and check all things. that will be standard
 * exercise when you check frontend and backend."*
 *
 * Phase 1 opened six write-paths. Every one of them was reported as "coded and
 * deployed" and every one sat at ZERO ROWS, because the plan's acceptance
 * criterion is not "the code shipped" — it is **a row appears where there were
 * none**, created the way a customer creates it. `docs/STATUS.md` exists
 * because that distinction was lost once already; this file is how it stops
 * being lost. A backfilled column does NOT satisfy it: an UPDATE proves the
 * column and its CHECK, never the form, the router, the serialiser and the
 * refetch that a person actually goes through.
 *
 * So each test below drives the real screen on the deployed site — opens the
 * form, fills the Phase-1 field, presses the button — and then reads the
 * CANONICAL row back and asserts that specific column landed non-null.
 *
 * ── What it writes, and where ───────────────────────────────────────────────
 *
 * Real rows, in the shared Supabase database that production also writes to,
 * in **E2E Test & Associates only** — the designated test org, whose ~5,600
 * rows were themselves created by driving this product. Unicode Group is never
 * touched: its contacts are real addresses and real people.
 *
 * Every record is tagged with `RUN`, so everything one run made is findable
 * and nothing collides with a previous one.
 *
 * Nothing here sends. `assertOutboundFence` proves at runtime that the
 * deployed process has this org on `OUTBOUND_SUPPRESSED_ORGS` before a single
 * row is written, and no test presses a Send control.
 *
 * ── The rules this file obeys (see e2e-real/_helpers.ts) ────────────────────
 *
 *  · A missing control is a FAILURE, never a skip.
 *  · Read the WRITE RESPONSE, then fetch the CANONICAL row — the POST echoes
 *    a handful of fields and asserting on the rest turns them into NaN.
 *  · Never reconcile against a list: list endpoints cap at 200 rows.
 *  · Poll selects that a fetch populates; wait for the REFETCH after a write.
 *  · Scope every lookup to the open form — getByLabel is substring-matched and
 *    the list stays mounted underneath.
 *
 * Run:
 *   node e2e-real/mint-state.mjs
 *   npx playwright test --config e2e-real/onefile.config.ts phase1-acceptance
 */
import { test, expect, Page } from '@playwright/test';
import { GODMODE_STATE } from './real.config';
import {
  RUN, api, apiOk, settle, openTab, pickOption, submitting, shot,
  useOrg, activeOrgId, assertOutboundFenceFor, pickFromPicker,
} from './_helpers';

/**
 * GODMODE, not OWNER, and the reason is a bug this file already caught.
 *
 * `.env.e2e`'s `E2E_ADMIN_TOKEN` belongs to an admin of Unicode Group who is
 * NOT a member of E2E Test & Associates, while `E2E_ORG_ID` names E2E. The
 * first run of this file therefore created a vendor in Unicode. The god-mode
 * account is the only one that can reach both, so it is the only one that can
 * be TOLD which org to write to — and `useOrg` below makes that explicit and
 * provable instead of implicit and wrong.
 */
test.use({ storageState: GODMODE_STATE });
test.describe.configure({ mode: 'serial' });

/**
 * The org every row in this file is written to: E2E Test & Associates, the
 * designated test org. Its ~5,600 rows were themselves made by driving this
 * product and its contacts are @example.com throughout.
 *
 * NOT Unicode Group. Unicode is in scope for the plan, but its contacts are
 * real addresses and real people, and — decisively — the deployed process's
 * `OUTBOUND_SUPPRESSED_ORGS` digest attests E2E ONLY. An acceptance row is
 * never worth writing into an org the outbound fence does not cover.
 */
const TARGET_ORG = '64e7bea6-6abe-490c-a2a4-27a60c6be916';
const TARGET_NAME = /E2E Test & Associates/i;

/**
 * Every test re-points the session, because Playwright builds a fresh context
 * per test from `storageState` and the active-org key does not survive that.
 * A test that assumed the previous test's org would silently write wherever
 * the account happens to default to — which is the exact failure this file
 * exists to have caught once and never again.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), TARGET_ORG);
  await page.goto('/ganit');
  await settle(page);
  expect(await activeOrgId(page), 'the session is not pointed at the target org')
    .toBe(TARGET_ORG);
});

/** Carried between tests in this file; serial mode makes this safe. */
const state: Record<string, any> = {};
const keep = (k: string, v: any) => { state[k] = v; };
const got = (k: string) => {
  expect(state[k], `nothing handed over for "${k}" — an earlier test in this file failed`)
    .toBeTruthy();
  return state[k];
};

/**
 * The fence, once, before anything is written.
 *
 * Not `beforeEach`: it is a property of the deployed process, not of a test,
 * and re-proving it twelve times only adds twelve chances to flake. But it
 * must be proven BEFORE the first write, so it is the first test in a serial
 * file rather than a comment asserting somebody checked.
 */
test('fence · the session is in the target org AND that org is shielded, before any write',
  async ({ page }) => {
    // Server-side proof of membership and a visible confirmation in the shell.
    // This must fail here, loudly, rather than on a read-back after the write.
    await useOrg(page, TARGET_ORG, TARGET_NAME);
    // The fence, bound to the org the SESSION is in — not to an env var, which
    // is how a passing fence once coexisted with a write into another org.
    await assertOutboundFenceFor(page, TARGET_ORG);
  });

// ══ 1.2 · VENDOR MSME + TDS ══════════════════════════════════════════════════
// Five columns the 43B(h) skill reads, plus vendor_kind, which is the one the
// skill uses to exclude traders — the plan lists five, the live schema has six,
// and a test that fills five would leave the trader exclusion unproven.

test('1.2 · a vendor carries MSME, enterprise class, kind, Udyam, TDS section and terms',
  async ({ page }) => {
    await page.goto('/kray');
    await settle(page);
    await openTab(page, /vendors/i);

    const add = page.getByRole('button', { name: '+ Vendor', exact: true });
    await expect(add, 'the "+ Vendor" control is not on the Vendors tab').toBeVisible();
    await add.click();
    await settle(page);

    const f = page.locator('form.gn-form');
    await expect(f, 'the vendor form did not open').toBeVisible();

    const field = (label: string | RegExp) =>
      f.locator('label.gn-form__field').filter({ hasText: label });

    await field(/^Name/).locator('input').first().fill(`E2E MSME Vendor ${RUN}`);

    // MSME registered / Enterprise class / Vendor kind are selects; Udyam, TDS
    // section and Payment terms are free text. Each is set explicitly rather
    // than left to a default, because a default that happens to be non-null
    // would satisfy the assertion without proving the field is wired.
    await field(/MSME registered/i).locator('select').selectOption({ index: 1 });
    const cls = field(/Enterprise class/i).locator('select');
    if (await cls.count()) await cls.selectOption({ index: 1 });
    await field(/Vendor kind/i).locator('select').selectOption({ index: 1 });
    await field(/Udyam number/i).locator('input').first().fill(`UDYAM-MH-03-${RUN}0001`);
    await field(/TDS section/i).locator('input').first().fill('194C');
    await field(/Payment terms/i).locator('input').first().fill('45');

    const made = await submitting(page, '/ganit/vendors',
      () => f.getByRole('button', { name: /^(Save vendor|Add vendor|Create|Save)$/ }).click());
    await settle(page);

    const id = made?.id || made?.vendor?.id;
    expect(id, 'the vendor create returned no id').toBeTruthy();
    keep('vendorId', id);

    // Canonical row, not the echo.
    const back = await apiOk(page, 'get', '/api/v1/ganit/vendors?limit=200');
    const v = (back.data ?? back).find((x: any) => String(x.id) === String(id));
    expect(v, 'the new vendor is not in the vendor list').toBeTruthy();

    expect(v.is_msme, 'is_msme did not persist').not.toBeNull();
    expect(v.udyam_number, 'udyam_number did not persist').toBeTruthy();
    expect(v.tds_section, 'tds_section did not persist').toBe('194C');
    expect(Number(v.payment_terms_days), 'payment_terms_days did not persist').toBe(45);
    expect(v.vendor_kind, 'vendor_kind did not persist — the 43B(h) trader exclusion ' +
      'cannot fire without it').toBeTruthy();

    await shot(page, `p1-2-vendor-${RUN}`);
  });

// ══ 1.5 · EMPLOYEE WORK STATE ════════════════════════════════════════════════
// The column that decides which professional-tax ladder a person is charged on.
// 96 of 98 rows carry a state only because I backfilled them; this proves the
// FORM writes it.

test('1.5 · a new hire is created with a work state, through the form', async ({ page }) => {
  await page.goto('/manav');
  await settle(page);
  await openTab(page, /employees/i);

  const add = page.getByRole('button', { name: /\+\s*Add employee/i });
  await expect(add, 'the "+ Add employee" control is not on the Employees tab').toBeVisible();
  await add.click();
  await settle(page);

  const f = page.locator('form').filter({ hasText: /New employee/i }).first();
  await expect(f, 'the new-employee form did not open').toBeVisible();

  const byLabel = (label: string | RegExp) =>
    f.locator('label').filter({ hasText: label }).first();

  await byLabel(/^Name/).locator('input').first().fill(`E2E PT Hire ${RUN}`);
  const code = byLabel(/Employee code/i).locator('input').first();
  if (await code.count()) await code.fill(`EMP-PT-${RUN}`);
  // RFC 2606 reserved. Payroll mails every employee their payslip; an address
  // that could reach a real person must never enter this org.
  const email = byLabel(/^Email/).locator('input').first();
  if (await email.count()) await email.fill(`e2e.pt.${RUN}@example.com`);

  // The field this test exists for. Maharashtra = 27, which is also the org's
  // own state_code, so the row is consistent with the other 71.
  const workState = byLabel(/Work state/i).locator('select').first();
  await expect(workState, 'the "Work state" select is not on the new-employee form — ' +
    'Phase 1.5 is not reachable by a user').toBeVisible();
  await workState.selectOption('27');

  const made = await submitting(page, '/manav/employees',
    () => f.getByRole('button', { name: /^(Add employee|Create|Save)/ }).last().click());
  const id = made?.id || made?.employee?.id;
  expect(id, 'the employee was not created').toBeTruthy();
  keep('employeeId', id);

  // THE CANONICAL ROW, not the list. Rule 3 of this suite, and it earned its
  // place again here: the first version of this test read the list and got
  // `undefined` from an employee whose row holds '27'. `list_employees` wraps
  // its inner query in an outer projection that had not re-listed `e.state`,
  // so the column was selected and dropped one layer later. That was a real
  // defect — fixed, and pinned by
  // `test_the_directory_reads_the_state_back` — but the lesson is that a list
  // is the wrong thing to assert a write against in the first place.
  const { employee: e } = await apiOk(page, 'get', `/api/v1/manav/employees/${id}`);
  expect(e, 'the new hire cannot be read back').toBeTruthy();
  expect(String(e.state), 'the work state did not persist — 1.5 writes nothing').toBe('27');

  // And the DIRECTORY must be able to show it too, or nobody can see which
  // employees still have no state — which is the whole reason the column is on
  // the list query.
  const list = await apiOk(page, 'get', '/api/v1/manav/employees');
  const listed = (list.data ?? list).find((x: any) => String(x.id) === String(id));
  expect(listed, 'the new hire is not in the employee directory').toBeTruthy();
  expect(String(listed.state), 'the directory drops the work state, so an admin ' +
    'cannot see who is missing one').toBe('27');

  await shot(page, `p1-5-employee-${RUN}`);
});

// ══ 1.6 · REGIONAL HOLIDAY ═══════════════════════════════════════════════════
// The form calls it "Applies to", not "State" — a check looking for the word
// "State" on this screen fails against a correct product.

test('1.6 · a holiday is created that applies to one state, not the whole country',
  async ({ page }) => {
    await page.goto('/manav');
    await settle(page);
    await openTab(page, /holidays/i);

    const add = page.getByRole('button', { name: /\+\s*Add holiday/i });
    await expect(add, 'the "+ Add holiday" control is not on the Holidays tab').toBeVisible();
    await add.click();
    await settle(page);

    const f = page.locator('form.k-formpanel').filter({ hasText: /Date/ }).first();
    await expect(f, 'the add-holiday form did not open').toBeVisible();

    await f.locator('label').filter({ hasText: /^Name/ }).locator('input').first()
      .fill(`E2E Maharashtra Day ${RUN}`);
    await f.locator('label').filter({ hasText: /^Date/ }).locator('input').first()
      .fill(new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10));

    const applies = f.locator('select').first();
    await expect(applies, 'the "Applies to" picker is not on the add-holiday form — ' +
      'Phase 1.6 is not reachable by a user').toBeVisible();
    await applies.selectOption('27');

    await submitting(page, /holiday/i,
      () => f.getByRole('button', { name: /^(Add holiday|Create|Save)$/ }).click());
    await settle(page);

    const back = await apiOk(page, 'get', '/api/v1/manav/holidays?limit=200');
    const h = (back.data ?? back).find((x: any) =>
      String(x.name || '').includes(`E2E Maharashtra Day ${RUN}`));
    expect(h, 'the new holiday is not in the holiday list').toBeTruthy();
    expect(String(h.state_code), 'state_code did not persist — the holiday applies ' +
      'everywhere, so attendance_auto_mark cannot scope it').toBe('27');
    keep('holidayName', `E2E Maharashtra Day ${RUN}`);

    await shot(page, `p1-6-holiday-${RUN}`);
  });

// ══ 1.4 · EXPENSE → CLIENT CONTACT ═══════════════════════════════════════════
// Labelled "Client contact" and not "Client" on purpose: the column points at
// graha_contacts — a PERSON — and a heading saying "Client" would promise a
// company link the table cannot make.

test('1.4 · an expense is recorded against a client contact', async ({ page }) => {
  await page.goto('/ganit');
  await settle(page);
  await openTab(page, /expenses/i);

  const add = page.getByRole('button', { name: '+ Add expense' });
  await expect(add, 'the "+ Add expense" control is not on the Expenses tab').toBeVisible();
  await add.click();
  await settle(page);

  const f = page.locator('form.gn-form').filter({ hasText: 'Record an expense' });
  await expect(f, 'the expense form did not open').toBeVisible();
  await expect(f.getByText(/Client contact/i),
    'the expense form has no "Client contact" field — 1.4 is not reachable by a user')
    .toBeVisible();

  await f.getByLabel(/^Title/).fill(`E2E client-billable travel ${RUN}`);
  // The date is REQUIRED and the form does NOT default it, so submitting with
  // it empty is blocked by the browser and no request is ever made — which
  // reads as a dead button rather than a missing field.
  await f.getByLabel(/^Date/).fill(new Date().toISOString().slice(0, 10));
  await f.getByLabel(/^Amount/).fill('4250');

  // The field this test exists for. `pickOption` polls, because the contacts
  // arrive by fetch and reading the options too early reported "no contacts to
  // invoice" against an org holding hundreds.
  const contactName = await pickFromPicker(f, 'Client contact', 'client contact');
  expect(contactName, 'the client-contact picker offered a blank row').toBeTruthy();

  const made = await submitting(page, '/ganit/expenses',
    () => f.getByRole('button', { name: 'Record', exact: true }).click());
  const id = made?.id || made?.expense?.id;
  expect(id, 'the expense was not created').toBeTruthy();
  keep('expenseId', id);

  const back = await apiOk(page, 'get', '/api/v1/ganit/expenses?limit=200');
  const x = (back.data ?? back).find((r: any) => String(r.id) === String(id));
  expect(x, 'the new expense is not in the expense list').toBeTruthy();
  expect(x.contact_id, 'contact_id did not persist — the expense is tagged to nobody')
    .toBeTruthy();
  // The list has resolved contact_id -> contact_name since it was written; if
  // the join were broken the column would render blank for a tagged row.
  expect(x.contact_name, 'contact_id persisted but the list cannot name the contact')
    .toBeTruthy();

  await shot(page, `p1-4-expense-${RUN}`);
});

// ══ 1.3 · COST SNAPSHOT ON A LINE ════════════════════════════════════════════
// Lines are JSONB array elements, not rows. The cost is COPIED onto the line at
// write time, never joined at read time, or an old order would silently
// re-price at today's cost. The key must be OMITTED when unresolvable — a 0
// would read as a 100% margin.

test('1.3 · a product carries a cost, and an invoice line snapshots it', async ({ page }) => {
  // ── A product with a KNOWN cost, so the snapshot has something to copy ────
  // Products are mounted by both Ganit and Vikray from the same
  // `pages/catalogue/ProductsTab.jsx`; there is no /catalogue route.
  await page.goto('/vikray');
  await settle(page);
  await openTab(page, /products/i);

  const addProd = page.getByRole('button', { name: '+ Add product or service' });
  await expect(addProd, 'the add-product control is not on the Products tab').toBeVisible();
  await addProd.click();
  await settle(page);

  const pf = page.locator('form.gn-form').filter({ hasText: 'New product or service' });
  await expect(pf, 'the product form did not open').toBeVisible();
  const pfld = (l: string | RegExp) => pf.locator('label').filter({ hasText: l }).first();
  await pfld(/^Name/).locator('input').first().fill(`E2E Costed Widget ${RUN}`);
  await pfld(/Sale price/i).locator('input').first().fill('1000');
  // The field 1.3 turns on. `costOrNull` (ProductsTab.jsx:199) sends NULL for a
  // blank, so a cost of 0 and "no cost recorded" stay different answers — which
  // is the same distinction `apply_line_costs` keeps by OMITTING the key rather
  // than writing 0, since a 0 cost reads as a 100% margin.
  await pfld(/Cost price/i).locator('input').first().fill('640');
  const hsn = pfld(/^HSN/i).locator('input').first();
  if (await hsn.count()) await hsn.fill('998311');

  const prod = await submitting(page, /product/i,
    () => pf.getByRole('button', { name: /^(Create|Save|Add)/ }).last().click());
  const productId = prod?.id || prod?.product?.id;
  expect(productId, 'the product was not created').toBeTruthy();
  keep('productId', productId);
  keep('productName', `E2E Costed Widget ${RUN}`);

  // ── An INVOICE that uses it ──────────────────────────────────────────────
  // `InvoiceForm.jsx:490-506` is the path that was fixed — it used to copy a
  // product's name, HSN, rate and unit and throw away the one field that said
  // where they came from. The order screen carries the same capability through
  // the shared `LineItemEditor` (`components/LineItemEditor.jsx:78-80`, a
  // per-line "From catalogue…" select bound to `li.product_id`); the order half
  // is covered by the next test.
  await page.goto('/ganit');
  await settle(page);
  await openTab(page, /invoices/i);
  await page.getByRole('button', { name: '+ Invoice' }).click();
  await settle(page);

  const f = page.locator('form.gn-form');
  await expect(f, 'the invoice form did not open').toBeVisible();
  await f.getByLabel('Type').selectOption('tax_invoice');
  // Customer is a ServerPicker, NOT a <select> — it was converted and the
  // comment at InvoiceForm.jsx:670 ("the red edge the <select> carried") is the
  // trace of that change. `ganit.spec.ts:97` still calls pickOption on it and is
  // stale against the live UI for the same reason this line was.
  await pickFromPicker(f, 'Customer', 'customer');
  const pos = f.getByLabel('Place of supply');
  if (await pos.count()) await pos.selectOption('Maharashtra');

  // "From product" is a real <select> — it prefills a line AND keeps product_id.
  // By ACCESSIBLE NAME. Scoping to the wrapping <label> and reaching for a
  // `select` inside it matched nothing here — the accessibility tree renders
  // that wrapper as a plain generic — while the control itself is named
  // "From product" and is trivially addressable.
  const fromProduct = f.getByRole('combobox', { name: 'From product' });
  await expect(fromProduct, 'the invoice form offers no "From product" picker, so a ' +
    'cost snapshot can never be taken').toBeVisible();
  await pickOption(fromProduct, 'invoice product', `E2E Costed Widget ${RUN}`);
  await settle(page);

  await f.getByLabel('Line 1 quantity').fill('3');

  const created = await submitting(page, '/ganit/invoices',
    () => page.getByRole('button', { name: 'Create invoice' }).click());
  expect(created?.id, 'the invoice was not created').toBeTruthy();
  keep('costedInvoiceId', created.id);

  const { invoice: inv } = await apiOk(page, 'get', `/api/v1/ganit/invoices/${created.id}`);
  const lines = inv.line_items || [];
  expect(lines.length, 'the created invoice has no lines').toBeGreaterThan(0);
  const costed = lines.find((l: any) => l.cost_price != null);
  expect(costed, 'no invoice line carries cost_price — the snapshot never happened. ' +
    `lines: ${JSON.stringify(lines).slice(0, 400)}`).toBeTruthy();
  expect(Number(costed.cost_price), 'the line snapshotted the wrong cost').toBeCloseTo(640, 2);

  await shot(page, `p1-3-invoice-cost-${RUN}`);
});

// ══ 1.1 · SALESPERSON ON AN INVOICE ══════════════════════════════════════════
// Names only on screen; the id lives in the form state and is never rendered
// (check-rendered-ids enforces that). This asserts the ID landed on the row.

test('1.1 · an invoice is created with a salesperson', async ({ page }) => {
  await page.goto('/ganit');
  await settle(page);
  await openTab(page, /invoices/i);

  await page.getByRole('button', { name: '+ Invoice' }).click();
  await settle(page);
  const f = page.locator('form.gn-form');
  await expect(f, 'the invoice form did not open').toBeVisible();

  await f.getByLabel('Type').selectOption('tax_invoice');
  // Customer is a ServerPicker, NOT a <select> — it was converted and the
  // comment at InvoiceForm.jsx:670 ("the red edge the <select> carried") is the
  // trace of that change. `ganit.spec.ts:97` still calls pickOption on it and is
  // stale against the live UI for the same reason this line was.
  await pickFromPicker(f, 'Customer', 'customer');
  const pos = f.getByLabel('Place of supply');
  if (await pos.count()) await pos.selectOption('Maharashtra');

  // A Picker, not a select — see pickFromPicker's note. Names only on screen;
  // the id lives in form state and check-rendered-ids keeps it off the DOM.
  const spName = await pickFromPicker(f, 'Salesperson', 'salesperson');
  expect(spName, 'the salesperson picker offered a blank row').toBeTruthy();

  await f.getByLabel('Line 1 description').fill(`E2E commissioned advisory ${RUN}`);
  await f.getByLabel('Line 1 HSN or SAC code').fill('998311');
  await f.getByLabel('Line 1 quantity').fill('1');
  await f.getByLabel('Line 1 rate').fill('30000');

  const created = await submitting(page, '/ganit/invoices',
    () => page.getByRole('button', { name: 'Create invoice' }).click());
  expect(created?.id, 'the invoice was not created').toBeTruthy();
  keep('invoiceId', created.id);

  const { invoice: inv } = await apiOk(page, 'get', `/api/v1/ganit/invoices/${created.id}`);
  expect(inv.salesperson_id, 'salesperson_id did not persist — commission can never ' +
    'be attributed').toBeTruthy();
  // The Phase 0 bug, asserted on every path that makes an invoice.
  expect(Number(inv.balance_due), 'a new invoice must be fully outstanding')
    .toBeCloseTo(Number(inv.total), 2);

  await shot(page, `p1-1-invoice-${RUN}`);
});

// ══ 1.1 (ORDER HALF) + 1.3 (ORDER HALF) ═════════════════════════════════════
// `salesperson_id` is a separate counter on `vikray_orders`, and the order
// screen reaches products through the SHARED `LineItemEditor`, so one order
// closes both order-side acceptances at once.

test('1.1/1.3 · an order carries a salesperson and a costed line', async ({ page }) => {
  await page.goto('/vikray');
  await settle(page);
  await openTab(page, /orders/i);

  // SCOPED TO THE TABPANEL. The module header duplicates the tab's own button
  // (two "+ New order" nodes on this page), which is Rule 6 of this suite —
  // module headers duplicate the tab's controls, so an unscoped lookup is a
  // strict-mode failure that reads as "the control is missing".
  const add = page.getByRole('tabpanel').getByRole('button', { name: '+ New order' });
  await expect(add, 'the "+ New order" control is not on the Orders tab').toBeVisible();
  await add.click();
  await settle(page);

  const f = page.locator('form.vk-form');
  await expect(f, 'the order form did not open').toBeVisible();

  await pickFromPicker(f, 'Customer', 'order customer');

  const spName = await pickFromPicker(f, 'Salesperson', 'order salesperson');
  expect(spName, 'the order salesperson picker offered a blank row').toBeTruthy();

  // The per-line catalogue select — a real <select>, unlike the header pickers.
  const cat = f.getByRole('combobox', { name: 'Line 1 — pick from catalogue' });
  await expect(cat, 'the order form offers no per-line catalogue picker, so an ' +
    'order line can never name a product and its cost can never resolve').toBeVisible();
  await pickOption(cat, 'order product', got('productName'));
  await f.getByLabel('Line 1 quantity').fill('2');

  const made = await submitting(page, '/vikray/orders',
    () => f.getByRole('button', { name: 'Create order' }).click());
  const orderId = made?.id || made?.order?.id;
  expect(orderId, 'the order was not created').toBeTruthy();
  keep('orderId', orderId);

  // TOP LEVEL, not wrapped. `GET /ganit/invoices/{id}` answers `{invoice: …}`
  // and `GET /vikray/orders/{id}` answers the order itself — two sibling detail
  // endpoints with different envelopes. Destructuring `{order}` here silently
  // yielded undefined and read as "salesperson_id did not persist" against a
  // row that carries it.
  const res = await apiOk(page, 'get', `/api/v1/vikray/orders/${orderId}`);
  const o = res.order ?? res;
  expect(o.salesperson_id, 'salesperson_id did not persist on the order').toBeTruthy();

  const lines = o.line_items || [];
  expect(lines.length, 'the created order has no lines').toBeGreaterThan(0);
  const costed = lines.find((l: any) => l.cost_price != null);
  expect(costed, 'no order line carries cost_price — the snapshot never happened. ' +
    `lines: ${JSON.stringify(lines).slice(0, 400)}`).toBeTruthy();
  expect(Number(costed.cost_price), 'the order line snapshotted the wrong cost')
    .toBeCloseTo(640, 2);

  await shot(page, `p1-1-3-order-${RUN}`);
});

// ══ THE LEDGER LINE ══════════════════════════════════════════════════════════
// Not decoration. The whole point of the exercise is that the counters move off
// zero, so the run states what it moved and names the row it made.

test('acceptance · every Phase-1 counter moved off zero', async ({ page }) => {
  await page.goto('/ganit');
  await settle(page);

  const rows: Array<[string, any]> = [
    ['1.1 invoice.salesperson_id', state.invoiceId],
    ['1.1 order.salesperson_id', state.orderId],
    ['1.2 vendor MSME/TDS (6 cols)', state.vendorId],
    ['1.3 line cost_price (invoice)', state.costedInvoiceId],
    ['1.3 line cost_price (order)', state.orderId],
    ['1.4 expense.contact_id', state.expenseId],
    ['1.5 employee.state', state.employeeId],
    ['1.6 holiday.state_code', state.holidayName],
  ];
  const missing = rows.filter(([, v]) => !v).map(([k]) => k);
  console.log(`
── PHASE-1 ACCEPTANCE · run ${RUN} · E2E Test & Associates ──`);
  for (const [k, v] of rows) console.log(`${v ? 'MOVED    ' : 'NOT MOVED'}  ${k}`);
  console.log('');

  expect(missing, `these Phase-1 acceptances did not move off zero: ${missing.join(', ')}`)
    .toEqual([]);
});
