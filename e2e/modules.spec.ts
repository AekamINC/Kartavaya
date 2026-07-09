/**
 * E2E tests — Add-on modules (Graha CRM, Ganit Invoicing, Manav HRMS)
 *
 * Requires:
 *   E2E_ADMIN_EMAIL    — admin account email
 *   E2E_ADMIN_PASSWORD — admin account password
 *
 * Tests are skipped when credentials are not set.
 */

import { test, expect, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const HAS_CREDS = !!(ADMIN_EMAIL && ADMIN_PASSWORD);

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
  await page.waitForURL(/dashboard|boards|tasks/i, { timeout: 12_000 });
}

// ── Page load smoke tests (no auth required) ─────────────────────────────────

test('graha page returns 200', async ({ page }) => {
  const resp = await page.goto('/graha');
  expect(resp?.status()).toBe(200);
});

test('ganit page returns 200', async ({ page }) => {
  const resp = await page.goto('/ganit');
  expect(resp?.status()).toBe(200);
});

test('manav page returns 200', async ({ page }) => {
  const resp = await page.goto('/manav');
  expect(resp?.status()).toBe(200);
});

// ── Graha (CRM) ─────────────────────────────────────────────────────────────

test.describe('Graha CRM (authenticated)', () => {
  test.skip(!HAS_CREDS, 'E2E credentials not set');

  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test('CRM page loads with tabs', async ({ page }) => {
    await page.goto('/graha');
    await expect(
      page.getByText(/contacts/i).or(page.getByRole('tab', { name: /contacts/i }))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('contacts tab shows list or empty state', async ({ page }) => {
    await page.goto('/graha');
    await expect(
      page.getByText(/no contacts|add contact/i)
        .or(page.locator('table, [class*="contact"]'))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('deals tab renders', async ({ page }) => {
    await page.goto('/graha');
    const dealsTab = page.getByRole('tab', { name: /deals/i })
      .or(page.getByText(/deals/i).first());
    await dealsTab.click();
    await expect(
      page.getByText(/no deals|pipeline/i)
        .or(page.locator('[class*="deal"], [class*="card"]'))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('pipeline summary tab renders', async ({ page }) => {
    await page.goto('/graha');
    const pipeTab = page.getByRole('tab', { name: /pipeline/i })
      .or(page.getByText(/pipeline/i).first());
    await pipeTab.click();
    await page.waitForTimeout(2_000);
    // Pipeline view should show at least the page structure
    await expect(page.locator('body')).not.toHaveText(/error|500|crash/i);
  });

  test('no JS errors on CRM page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/graha');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });
});

// ── Ganit (Invoicing) ────────────────────────────────────────────────────────

test.describe('Ganit Invoicing (authenticated)', () => {
  test.skip(!HAS_CREDS, 'E2E credentials not set');

  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test('invoicing page loads with tabs', async ({ page }) => {
    await page.goto('/ganit');
    await expect(
      page.getByText(/invoices/i).or(page.getByRole('tab', { name: /invoices/i }))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('products tab renders', async ({ page }) => {
    await page.goto('/ganit');
    const prodTab = page.getByRole('tab', { name: /products/i })
      .or(page.getByText(/products/i).first());
    await prodTab.click();
    await expect(
      page.getByText(/no products|add product/i)
        .or(page.locator('table, [class*="product"]'))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('stats tab shows dashboard tiles', async ({ page }) => {
    await page.goto('/ganit');
    const statsTab = page.getByRole('tab', { name: /stats|dashboard/i })
      .or(page.getByText(/stats|dashboard/i).first());
    await statsTab.click();
    await expect(
      page.locator('[class*="stat"], [class*="tile"], [class*="card"]')
        .or(page.getByText(/outstanding|collected|invoices/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('no JS errors on invoicing page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/ganit');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });
});

// ── Manav (HRMS) ─────────────────────────────────────────────────────────────

test.describe('Manav HRMS (authenticated)', () => {
  test.skip(!HAS_CREDS, 'E2E credentials not set');

  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test('HRMS page loads with tabs', async ({ page }) => {
    await page.goto('/manav');
    await expect(
      page.getByText(/employees/i).or(page.getByRole('tab', { name: /employees/i }))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('attendance tab renders', async ({ page }) => {
    await page.goto('/manav');
    const attTab = page.getByRole('tab', { name: /attendance/i })
      .or(page.getByText(/attendance/i).first());
    await attTab.click();
    await expect(
      page.getByText(/mark|today|summary/i)
        .or(page.locator('table, [class*="attendance"]'))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('leaves tab renders', async ({ page }) => {
    await page.goto('/manav');
    const leaveTab = page.getByRole('tab', { name: /leaves/i })
      .or(page.getByText(/leaves/i).first());
    await leaveTab.click();
    await expect(
      page.getByText(/no leave|request|pending/i)
        .or(page.locator('table, [class*="leave"]'))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('departments tab renders', async ({ page }) => {
    await page.goto('/manav');
    const deptTab = page.getByRole('tab', { name: /departments/i })
      .or(page.getByText(/departments/i).first());
    await deptTab.click();
    await expect(
      page.getByText(/no departments|add department/i)
        .or(page.locator('[class*="card"], [class*="department"]'))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('holidays tab renders', async ({ page }) => {
    await page.goto('/manav');
    const holTab = page.getByRole('tab', { name: /holidays/i })
      .or(page.getByText(/holidays/i).first());
    await holTab.click();
    await expect(
      page.getByText(/no holidays|add holiday/i)
        .or(page.locator('table, [class*="holiday"]'))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('no JS errors on HRMS page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/manav');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });
});
