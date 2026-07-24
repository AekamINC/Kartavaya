/**
 * E2E tests — Prachar Marketing module
 *
 * Requires:
 *   E2E_ADMIN_EMAIL    — admin account email
 *   E2E_ADMIN_PASSWORD — admin account password
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

// ── Page load smoke test (no auth required) ─────────────────────────────────

test('prachar page returns 200', async ({ page }) => {
  const resp = await page.goto('/prachar');
  expect(resp?.status()).toBe(200);
});

// ── Authenticated tests ─────────────────────────────────────────────────────

test.describe('Prachar Marketing (authenticated)', () => {
  test.skip(!HAS_CREDS, 'E2E credentials not set — skipping');

  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test('navigate to /prachar from sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebarLink = page.getByRole('link', { name: /prachar|marketing/i })
      .or(page.locator('nav, [class*="sidebar"]').getByText(/prachar|marketing/i));
    await sidebarLink.first().click();
    await expect(page).toHaveURL(/prachar/i, { timeout: 8_000 });
  });

  test('campaign list renders', async ({ page }) => {
    await page.goto('/prachar');
    await expect(
      page.getByText(/campaign/i)
        .or(page.locator('table, [class*="campaign"], [data-testid="campaign-list"]'))
        .or(page.getByText(/no campaigns/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('can open campaign creation form', async ({ page }) => {
    await page.goto('/prachar');
    await page.waitForLoadState('networkidle');

    const addBtn = page.getByRole('button', { name: /new campaign|add campaign|create campaign|\+/i })
      .or(page.locator('[data-testid="add-campaign-btn"]'));
    await expect(addBtn.first()).toBeVisible({ timeout: 8_000 });
    await addBtn.first().click();

    await expect(
      page.locator('[role="dialog"], .k-drawer, .modal, [data-testid="campaign-form"]')
        .or(page.getByText(/create campaign|new campaign|campaign name/i))
    ).toBeVisible({ timeout: 6_000 });
  });

  test('no JS errors on marketing page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/prachar');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });
});
