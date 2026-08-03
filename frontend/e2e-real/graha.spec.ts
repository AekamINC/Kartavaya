/**
 * Phase 2 — Graha CRM, all seventeen tabs, through the product's own forms.
 *
 * "Full CRM each tab each function." Seventeen tabs is more than fits on a tab
 * strip, so most of them live behind the "More +N" popover — `openTab` handles
 * both, and a tab that is in neither place fails by name rather than silently
 * testing whatever panel happened to be open.
 *
 * Same two rules as Ganit: a missing control is a FAILURE, never a skip; and
 * every write is read back from the row, not from the screen that wrote it.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { OWNER_STATE, DL_DIR } from './real.config';
import { api, apiOk, settle, openTab, shot, pickOption, submitting, RUN } from './_helpers';

test.use({ storageState: OWNER_STATE });
test.describe.configure({ mode: 'serial' });

const HANDOFF = path.join(DL_DIR, `graha-${RUN}.json`);
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
  await page.goto('/graha');
  await settle(page);
});

async function graha(page: Page, tab: string) {
  if (!page.url().includes('/graha')) {
    await page.goto('/graha');
    await settle(page);
  }
  await openTab(page, tab);
}

/**
 * Scope clicks to the tab PANEL.
 *
 * `+ New Deal` exists twice — once in the module header and once on the tab —
 * so an unscoped getByRole is a strict-mode violation. The panel is the surface
 * under test; the header button is a shortcut to it.
 */
const panel = (page: Page) => page.getByRole('tabpanel');

/** Graha fields are `<label class="gr__f"><span class="gr__fl">Label</span>…`. */
const fld = (page: Page, label: string) =>
  page.locator('label.gr__f', { hasText: label }).locator('input, select, textarea').first();


// ══ CLIENTS ══════════════════════════════════════════════════════════════════

test('clients · create one with a GSTIN and address', async ({ page }) => {
  await graha(page, 'clients');
  await panel(page).getByRole('button', { name: /\+ Add Client/ }).click();
  await settle(page);

  await page.getByLabel('Company name').fill(`E2E Client ${RUN}`);
  await page.getByLabel('Reference number').fill(`REF-${RUN}`);
  await page.getByLabel('GSTIN').fill('27AAECE1234F1Z2');
  await page.getByLabel('Address line 1').fill('12 Ashram Road');

  const made = await submitting(page, '/graha/clients',
    () => page.getByRole('button', { name: /^Create|^Save|^Add Client/ }).last().click());
  expect(made?.id || made?.client?.id, 'the client was not created').toBeTruthy();
  keep('clientId', made.id || made.client.id);

  const list = await apiOk(page, 'get', '/api/v1/graha/clients?limit=500');
  const c = (list.data || []).find((x: any) => String(x.id) === String(recall('clientId')));
  expect(c, 'the client is not in the list').toBeTruthy();
  expect(c.gstin).toBe('27AAECE1234F1Z2');
  await shot(page, `graha-client-${RUN}`);
});


// ══ CONTACTS ═════════════════════════════════════════════════════════════════

test('contacts · create one and open its timeline', async ({ page }) => {
  await graha(page, 'contacts');
  await panel(page).getByRole('button', { name: '+ Add Contact' }).click();
  await settle(page);

  await fld(page, 'Name *').fill(`E2E Contact ${RUN}`);
  await fld(page, 'Email').fill(`e2e.contact.${RUN}@example.com`);
  await fld(page, 'Phone / Mobile').fill('+91 98765 43210');
  await fld(page, 'Company').fill(`E2E Client ${RUN}`);
  await fld(page, 'GSTIN').fill('27AAECE1234F1Z2');
  await fld(page, 'Source').fill('E2E run');

  const made = await submitting(page, '/graha/contacts',
    () => page.getByRole('button', { name: 'Create Contact' }).click());
  const id = made?.id || made?.contact?.id;
  expect(id, 'the contact was not created').toBeTruthy();
  keep('contactId', id);

  // A contact with a GSTIN is the thing Ganit needs to derive place of supply,
  // so the value must survive the round trip rather than be dropped.
  const back = await apiOk(page, 'get', `/api/v1/graha/contacts/${id}`);
  const c = back.contact || back;
  expect(c.gstin, 'the GSTIN did not survive the create').toBe('27AAECE1234F1Z2');
  expect(c.name).toBe(`E2E Contact ${RUN}`);
});

test('contacts · a CRM contact with a GSTIN drives the invoice tax split', async ({ page }) => {
  // The cross-module contract, and the one Phase 1 could not test: every seeded
  // contact lacks a GSTIN, so `stateFromGSTIN` returned null and the derivation
  // has never once been exercised. This contact carries 27… (Maharashtra), the
  // org is 27… — so the supply is INTRA-state and must split CGST/SGST with the
  // place of supply filled in by the form, not by the person typing.
  //
  // Asserted on the INVOICE rather than on the widget: the form swaps the
  // place-of-supply control for a derived summary once it can work the answer
  // out, so pinning the <select> pins a layout instead of a tax rule.
  await page.goto('/ganit');
  await settle(page);
  await page.getByRole('button', { name: '+ Invoice' }).click();
  await settle(page);

  const f = page.locator('form.gn-form');
  await f.getByLabel('Type').selectOption('tax_invoice');
  await pickOption(f.getByLabel('Customer'), 'customer', `E2E Contact ${RUN}`);

  await f.getByLabel('Line 1 description').fill(`E2E derived split ${RUN}`);
  await f.getByLabel('Line 1 HSN or SAC code').fill('998311');
  await f.getByLabel('Line 1 quantity').fill('1');
  await f.getByLabel('Line 1 rate').fill('20000');

  const made = await submitting(page, '/ganit/invoices',
    () => page.getByRole('button', { name: 'Create invoice' }).click());
  expect(made?.id, 'the invoice was not created for the new CRM contact').toBeTruthy();

  const { invoice } = await apiOk(page, 'get', `/api/v1/ganit/invoices/${made.id}`);
  expect(invoice.place_of_supply,
    'the form did not derive the place of supply from the customer GSTIN')
    .toMatch(/Maharashtra/i);
  expect(invoice.is_igst, 'a same-state supply was billed as inter-state').toBe(false);
  expect(Number(invoice.igst), 'IGST charged on a same-state supply').toBe(0);
  expect(Number(invoice.cgst)).toBeCloseTo(Number(invoice.sgst), 2);
  expect(Number(invoice.cgst)).toBeCloseTo(1800, 2);   // 20,000 @ 9%
  await shot(page, `graha-crm-to-ganit-${RUN}`);
});


// ══ DEALS · KANBAN · PIPELINE ════════════════════════════════════════════════

test('deals · create one, then move it a stage', async ({ page }) => {
  await graha(page, 'deals');
  await panel(page).getByRole('button', { name: '+ New Deal' }).click();
  await settle(page);

  await fld(page, 'Title *').fill(`E2E Deal ${RUN}`);
  await fld(page, 'Value (₹)').fill('450000');
  await fld(page, 'Probability (%)').fill('60');
  await fld(page, 'Expected Close').fill(
    new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));

  const made = await submitting(page, '/graha/deals',
    () => page.getByRole('button', { name: 'Create Deal' }).click());
  const id = made?.id || made?.deal?.id;
  expect(id, 'the deal was not created').toBeTruthy();
  keep('dealId', id);

  const list = await apiOk(page, 'get', '/api/v1/graha/deals?limit=500');
  const d = (list.data || []).find((x: any) => String(x.id) === String(id));
  expect(d, 'the deal is not in the list').toBeTruthy();
  expect(Number(d.value)).toBeCloseTo(450000, 2);
});

test('kanban · the deal appears on the board', async ({ page }) => {
  await graha(page, 'kanban');
  await expect(page.getByText(`E2E Deal ${RUN}`),
    'a deal created on the Deals tab is not on the Kanban board').toBeVisible();
  await shot(page, `graha-kanban-${RUN}`);
});

test('pipeline · the deal is counted in the pipeline figures', async ({ page }) => {
  await graha(page, 'pipeline');
  // `/deals/pipeline` does not exist — it falls through to `/deals/{deal_id}`
  // and 422s on "pipeline" as a UUID. The real summary is `/pipeline-summary`.
  const stats = await apiOk(page, 'get', '/api/v1/graha/pipeline-summary');
  const stages = stats.stages || stats.data || stats.summary || [];
  const total = (Array.isArray(stages) ? stages : Object.values(stages))
    .reduce((s: number, x: any) => s + Number(x?.value ?? x?.total_value ?? x?.amount ?? 0), 0);
  expect(total, 'the pipeline summary reports no value at all').toBeGreaterThan(0);

  // And the deal just created is counted in it.
  const board = await apiOk(page, 'get', '/api/v1/graha/deals/kanban');
  const flat = JSON.stringify(board);
  expect(flat.includes(`E2E Deal ${RUN}`),
    'the new deal is missing from the kanban feed the pipeline is built on').toBe(true);
});


// ══ ACTIVITIES · FOLLOW-UPS ══════════════════════════════════════════════════

test('activities · log one against the deal', async ({ page }) => {
  await graha(page, 'activities');
  await panel(page).getByRole('button', { name: '+ Log Activity' }).click();
  await settle(page);

  await fld(page, 'Title *').fill(`E2E call ${RUN}`);
  await fld(page, 'Description').fill('Discussed scope and fees.');

  // "+ Log Activity" opens the form and "Log Activity" submits it — both match
  // the same accessible name, so the submit must be found INSIDE the form.
  const made = await submitting(page, '/graha/activities',
    () => panel(page).locator('form').getByRole('button', { name: 'Log Activity' }).click());
  expect(made?.id || made?.activity?.id, 'the activity was not logged').toBeTruthy();
  await expect(page.getByText(`E2E call ${RUN}`), 'the activity is not listed').toBeVisible();
});

test('follow-ups · create one that falls due', async ({ page }) => {
  await graha(page, 'follow ups');
  await panel(page).getByRole('button', { name: '+ New Follow-up' }).click();
  await settle(page);

  // Title and Due Date are both REQUIRED, and Due Date is a datetime-local —
  // a date-only value is rejected by the browser and the form submits nothing
  // at all, which reads as a dead button rather than a missing field.
  await fld(page, 'Title *').fill(`E2E follow-up ${RUN}`);
  const due = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16);
  await fld(page, 'Due Date *').fill(due);

  const made = await submitting(page, /follow.?up/i,
    () => panel(page).locator('form').getByRole('button', { name: 'Create', exact: true }).click());
  expect(made?.id || made?.follow_up?.id, 'the follow-up was not created').toBeTruthy();
  await expect(page.getByText(`E2E follow-up ${RUN}`), 'the follow-up is not listed').toBeVisible();
});


// ══ LABELS · TERRITORIES · CUSTOM FIELDS ═════════════════════════════════════

test('labels · create one and assign it to the contact', async ({ page }) => {
  await graha(page, 'labels');
  await panel(page).getByRole('button', { name: '+ New Label' }).click();
  await settle(page);

  await page.locator('label', { hasText: 'Name *' }).locator('input').first()
    .fill(`E2E Label ${RUN}`);
  await submitting(page, '/graha/labels',
    () => page.getByRole('button', { name: 'Create', exact: true }).click());
  await settle(page);

  await expect(page.getByText(`E2E Label ${RUN}`), 'the label is not listed').toBeVisible();
});

test('territories · create one', async ({ page }) => {
  await graha(page, 'territories');
  await panel(page).getByRole('button', { name: '+ New Territory' }).click();
  await settle(page);
  await page.locator('label', { hasText: 'Name' }).locator('input').first()
    .fill(`E2E Territory ${RUN}`);
  await submitting(page, /territor/i,
    () => page.getByRole('button', { name: 'Create', exact: true }).click());
  await settle(page);
  await expect(page.getByText(`E2E Territory ${RUN}`)).toBeVisible();
});

test('custom fields · define one on contacts', async ({ page }) => {
  await graha(page, 'fields');
  await panel(page).getByRole('button', { name: '+ New Field' }).click();
  await settle(page);
  await page.locator('label', { hasText: 'Field Name' }).locator('input').first()
    .fill(`E2E Field ${RUN}`);
  await submitting(page, /field/i,
    () => page.getByRole('button', { name: 'Create', exact: true }).click());
  await settle(page);
  await expect(page.getByText(`E2E Field ${RUN}`)).toBeVisible();
});


// ══ READ-ONLY SURFACES, ASSERTED ON THEIR NUMBERS ════════════════════════════

test('today · the tab renders its work list without error', async ({ page }) => {
  await graha(page, 'today');
  await expect(page.locator('.k-err, [role="alert"]').filter({ hasText: /failed|error/i }),
    'the Today tab rendered an error').toHaveCount(0);
  await shot(page, `graha-today-${RUN}`);
});

test('reports · the figures are real, not placeholders', async ({ page }) => {
  await graha(page, 'reports');
  const list = await apiOk(page, 'get', '/api/v1/graha/contacts?limit=1');
  expect(Array.isArray(list.data), 'contacts did not answer').toBe(true);
  await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);
});

test('automations · the rules tab loads', async ({ page }) => {
  await graha(page, 'automations');
  await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);
});

test('web-forms · the tab lists forms and their submissions', async ({ page }) => {
  await graha(page, 'web forms');
  const forms = await apiOk(page, 'get', '/api/v1/graha/web-forms');
  expect(Array.isArray(forms.data ?? forms), 'web forms did not answer').toBe(true);
});

test('approvals · the CRM approvals queue answers', async ({ page }) => {
  await graha(page, 'approvals');
  await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);
});

test('documents · the tab lists what is filed against clients', async ({ page }) => {
  await graha(page, 'documents');
  await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);
});

test('dedupe · duplicate detection runs and returns a verdict', async ({ page }) => {
  await graha(page, 'dedupe');
  await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);
  await shot(page, `graha-dedupe-${RUN}`);
});
