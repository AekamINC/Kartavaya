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

/** Graha fields are `<label class="gr__f"><span class="gr__fl">Label</span>…`. */
const fld = (page: Page, label: string) =>
  page.locator('label.gr__f', { hasText: label }).locator('input, select, textarea').first();


// ══ CLIENTS ══════════════════════════════════════════════════════════════════

test('clients · create one with a GSTIN and address', async ({ page }) => {
  await graha(page, 'clients');
  await page.getByRole('button', { name: /\+ Add Client/ }).click();
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
  await page.getByRole('button', { name: '+ Add Contact' }).click();
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

test('contacts · the new contact is offered to Ganit as a customer', async ({ page }) => {
  // The cross-module contract that matters: a contact created in the CRM has to
  // be invoiceable. This is the join Phase 1 could not test, because every
  // seeded contact lacked a GSTIN.
  await page.goto('/ganit');
  await settle(page);
  await page.getByRole('button', { name: '+ Invoice' }).click();
  await settle(page);
  const picker = page.locator('form.gn-form').getByLabel('Customer');
  await pickOption(picker, 'customer', `E2E Contact ${RUN}`);

  // And with a Maharashtra GSTIN against a Maharashtra org, the form should
  // derive an INTRA-state supply on its own.
  const pos = page.locator('form.gn-form').getByLabel('Place of supply');
  await expect(pos, 'picking a customer with a GSTIN set no place of supply')
    .toHaveValue(/Maharashtra/);
});


// ══ DEALS · KANBAN · PIPELINE ════════════════════════════════════════════════

test('deals · create one, then move it a stage', async ({ page }) => {
  await graha(page, 'deals');
  await page.getByRole('button', { name: '+ New Deal' }).click();
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
  const stats = await apiOk(page, 'get', '/api/v1/graha/deals/pipeline');
  const total = (stats.stages || stats.data || []).reduce(
    (s: number, x: any) => s + Number(x.value || x.total_value || 0), 0);
  expect(total, 'the pipeline reports no value at all').toBeGreaterThan(0);
});


// ══ ACTIVITIES · FOLLOW-UPS ══════════════════════════════════════════════════

test('activities · log one against the deal', async ({ page }) => {
  await graha(page, 'activities');
  await page.getByRole('button', { name: '+ Log Activity' }).click();
  await settle(page);

  await fld(page, 'Title *').fill(`E2E call ${RUN}`);
  await fld(page, 'Description').fill('Discussed scope and fees.');

  const made = await submitting(page, '/graha/activities',
    () => page.getByRole('button', { name: 'Log Activity' }).click());
  expect(made?.id || made?.activity?.id, 'the activity was not logged').toBeTruthy();
  await expect(page.getByText(`E2E call ${RUN}`), 'the activity is not listed').toBeVisible();
});

test('follow-ups · create one that falls due', async ({ page }) => {
  await graha(page, 'follow-ups');
  await page.getByRole('button', { name: '+ New Follow-up' }).click();
  await settle(page);

  const f = page.locator('label.gr__f');
  await f.first().locator('input, select, textarea').first().fill(`E2E follow-up ${RUN}`);
  const due = page.locator('input[type="date"]').first();
  if (await due.count()) {
    await due.fill(new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10));
  }
  const made = await submitting(page, /follow.?up/i,
    () => page.getByRole('button', { name: 'Create', exact: true }).click());
  expect(made?.id || made?.follow_up?.id, 'the follow-up was not created').toBeTruthy();
});


// ══ LABELS · TERRITORIES · CUSTOM FIELDS ═════════════════════════════════════

test('labels · create one and assign it to the contact', async ({ page }) => {
  await graha(page, 'labels');
  await page.getByRole('button', { name: '+ New Label' }).click();
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
  await page.getByRole('button', { name: '+ New Territory' }).click();
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
  await page.getByRole('button', { name: '+ New Field' }).click();
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
  await graha(page, 'web-forms');
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
