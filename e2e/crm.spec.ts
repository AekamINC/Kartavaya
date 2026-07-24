/**
 * E2E tests — Graha CRM module
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

test.describe('Graha CRM (authenticated)', () => {
  test.skip(!HAS_CREDS, 'E2E credentials not set — skipping');

  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test('navigate to /graha from sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    // Click the CRM / Graha link in the sidebar
    const sidebarLink = page.getByRole('link', { name: /graha|crm/i })
      .or(page.locator('nav, [class*="sidebar"]').getByText(/graha|crm/i));
    await sidebarLink.first().click();
    await expect(page).toHaveURL(/graha/i, { timeout: 8_000 });
  });

  test('contact list renders', async ({ page }) => {
    await page.goto('/graha');
    await expect(
      page.locator('table, [class*="contact"], [data-testid="contact-list"]')
        .or(page.getByText(/contacts/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('can open contact creation form', async ({ page }) => {
    await page.goto('/graha');
    await page.waitForLoadState('networkidle');

    const addBtn = page.getByRole('button', { name: /add contact|new contact|\+/i })
      .or(page.locator('[data-testid="add-contact-btn"]'));
    await expect(addBtn.first()).toBeVisible({ timeout: 8_000 });
    await addBtn.first().click();

    // Expect a modal/drawer/form to appear
    await expect(
      page.locator('[role="dialog"], .k-drawer, .modal, [data-testid="contact-form"]')
        .or(page.getByText(/create contact|new contact|contact name/i))
    ).toBeVisible({ timeout: 6_000 });
  });

  test('search/filter works on contacts', async ({ page }) => {
    await page.goto('/graha');
    await page.waitForLoadState('networkidle');

    const searchInput = page.getByRole('searchbox')
      .or(page.locator('input[placeholder*="search" i], input[type="search"]'))
      .or(page.locator('[data-testid="contact-search"]'));
    await expect(searchInput.first()).toBeVisible({ timeout: 8_000 });

    // Type a search query — just verify no crash
    await searchInput.first().fill('test');
    // Wait briefly for filtering to apply
    await page.waitForTimeout(1_000);
    // Page should still be stable (no JS errors from the search)
    await expect(page.locator('body')).not.toHaveText(/error|500|crash/i);
  });
});
