/**
 * The invoice form's Rule 46 gate, in a real browser.
 *
 * Found live 2026-08-02 by the real-user staging suite: `InvoiceForm` created a
 * doc_status='final' tax invoice with no customer and no HSN, which its own
 * PDF endpoint then refused under Rule 46(e)/(g) — the user learns at download
 * time what the form knew at save time. The fix surfaces the same gap list in
 * the form (banner, not toast), blocks the FINAL create locally, and offers
 * "Save as draft instead" because an incomplete draft is a workflow the
 * product deliberately supports.
 *
 * Stubbed, per this suite's pattern: the local gate is decided entirely on the
 * client, so a stubbed backend answers the question honestly. What this file
 * does NOT prove — that the server refuses a crafted FINAL payload — is the
 * server-side half of the same fix (`_refuse_final_if_incomplete`) and is
 * asserted against staging by the real-user suite.
 */
import { test, expect, Page } from '@playwright/test';

const EMPTY = { data: [], total: 0, limit: 0, truncated: false };

/** POST bodies the stub saw for /v1/ganit/invoices, newest last. */
type Captured = { posts: any[] };

async function stubApi(page: Page, captured: Captured) {
  await page.route('**/api/**', route => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes('/auth/me')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          user_id: 'user_e2e', name: 'E2E User', email: 'e2e@example.com', role: 'member',
          module_levels: { ganit: 'admin' }, module_grants: ['ganit'],
        }),
      });
    }
    if (url.includes('/v1/graha/contacts')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: [
          { id: 'c1', name: 'Sharma Textiles Pvt Ltd', company: '', gstin: '24AAACS1234E1Z5' },
        ] }),
      });
    }
    if (url.includes('/v1/ganit/products')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: [
          { id: 'p1', name: 'GST Return Filing', hsn_code: '', sac_code: '998231', price: 15000, gst_rate: 18, unit: 'NOS' },
        ] }),
      });
    }
    if (url.includes('/v1/org/profile')) {
      // The form reads exactly one field off this: our own GSTIN.
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ gstin: '27AAACE1234E1Z5' }),
      });
    }
    if (url.includes('/v1/ganit/invoices') && method === 'POST') {
      captured.posts.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'created', id: 'inv_e2e', invoice_number: 'INV-TEST-001' }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY) });
  });
}

async function signIn(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('Kartavaya_user', JSON.stringify({
      user_id: 'user_e2e', name: 'E2E User', email: 'e2e@example.com', role: 'member',
      module_levels: { ganit: 'admin' }, module_grants: ['ganit'],
    }));
    localStorage.setItem('auth_token', 'e2e-stub-token');
  });
}

/** /ganit → the invoices tab's "+ Invoice" → the form. */
async function openForm(page: Page) {
  await page.goto('/ganit');
  await page.waitForSelector('.mh', { timeout: 30_000 });
  await page.locator('button:has-text("+ Invoice"), button:has-text("New Invoice")').first().click();
  await expect(page.locator('.gn-form')).toBeVisible();
}

test.describe('invoice form — Rule 46 gate', () => {
  let captured: Captured;

  test.beforeEach(async ({ page }) => {
    captured = { posts: [] };
    await signIn(page);
    await stubApi(page, captured);
  });

  test('a FINAL create with no customer and no HSN is stopped in the form, and nothing is sent', async ({ page }) => {
    await openForm(page);
    // Give the single default line a description and a rate — the historical
    // failure case was a line with substance but no HSN, invoiced to nobody.
    await page.getByLabel('Line 1 description').fill('Consulting work');
    await page.getByLabel('Line 1 rate').fill('15000');
    await page.locator('.gn-form button[type="submit"]').click();

    const banner = page.locator('.gn-gaps');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Rule 46(e)');
    await expect(banner).toContainText('Rule 46(g)');
    // The refusal happened before any request: a blocked create burns nothing.
    expect(captured.posts, 'no POST reached the API').toHaveLength(0);
    // The fields carry the mark where they are fixed.
    await expect(page.locator('select[aria-invalid="true"]')).toHaveCount(1);
    await expect(page.getByLabel('Line 1 HSN or SAC code')).toHaveAttribute('aria-invalid', 'true');
  });

  test('"Save as draft instead" posts the same form with doc_status=draft', async ({ page }) => {
    await openForm(page);
    await page.getByLabel('Line 1 description').fill('Consulting work');
    await page.getByLabel('Line 1 rate').fill('15000');
    await page.locator('.gn-form button[type="submit"]').click();
    await expect(page.locator('.gn-gaps')).toBeVisible();

    await page.locator('.gn-gaps button:has-text("Save as draft instead")').click();
    await expect(page.locator('.gn-gaps')).toBeHidden();
    expect(captured.posts).toHaveLength(1);
    expect(captured.posts[0].doc_status).toBe('draft');
  });

  test('closing the gaps clears the gate and the create goes through as final', async ({ page }) => {
    await openForm(page);
    await page.getByLabel('Line 1 description').fill('Consulting work');
    await page.getByLabel('Line 1 rate').fill('15000');
    await page.locator('.gn-form button[type="submit"]').click();
    await expect(page.locator('.gn-gaps')).toBeVisible();

    // Fix both gaps the banner named.
    await page.locator('label:has-text("Customer") select').selectOption({ label: 'Sharma Textiles Pvt Ltd' });
    await page.getByLabel('Line 1 HSN or SAC code').fill('998231');
    // Fixing a field sheds its mark immediately, before the banner is dismissed.
    await expect(page.getByLabel('Line 1 HSN or SAC code')).not.toHaveAttribute('aria-invalid', 'true');

    await page.locator('.gn-form button[type="submit"]').click();
    await expect(page.locator('.gn-gaps')).toBeHidden();
    expect(captured.posts).toHaveLength(1);
    expect(captured.posts[0].doc_status ?? '').not.toBe('draft');
    expect(captured.posts[0].contact_id).toBe('c1');
    expect(captured.posts[0].line_items[0].hsn_code).toBe('998231');
  });
});
