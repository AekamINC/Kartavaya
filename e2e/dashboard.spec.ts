/**
 * E2E tests — Dashboard smoke tests
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

test.describe('Dashboard (authenticated)', () => {
  test.skip(!HAS_CREDS, 'E2E credentials not set — skipping');

  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test('dashboard loads without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test('shows stat tiles (open tasks, due today, etc.)', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(
      page.locator('.k-stats, [data-testid="stat-tile"], .stat-tile, [class*="stat"]')
        .or(page.getByText(/open tasks|due today|overdue|tasks/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('shows "On your plate" section', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(
      page.getByText(/on your plate/i)
        .or(page.locator('[data-testid="on-your-plate"]'))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('activity feed renders', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(
      page.getByText(/activity|recent/i)
        .or(page.locator('[data-testid="activity-feed"], [class*="activity"], [class*="feed"]'))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('quick action buttons are visible', async ({ page }) => {
    await page.goto('/dashboard');
    // Quick actions like "New Task", "New Project", etc.
    await expect(
      page.getByRole('button', { name: /new task|add task|quick/i })
        .or(page.locator('[data-testid="quick-actions"], [class*="quick-action"]'))
        .or(page.getByText(/quick action/i))
    ).toBeVisible({ timeout: 10_000 });
  });
});
