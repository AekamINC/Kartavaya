/**
 * E2E tests — Authentication flows
 *
 * These tests run against the deployed/local Kartavaya web app.
 * Set environment variables for credentials:
 *   E2E_ADMIN_EMAIL    (default: admin@aekaminc.com)
 *   E2E_ADMIN_PASSWORD (required for login tests to pass)
 */

import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@aekaminc.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

// ── Login page renders ────────────────────────────────────────────────────────

test('login page loads and shows email/password fields', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test('login page shows the Kartavaya brand', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveTitle(/Kartavaya/i);
});

// ── Invalid login ─────────────────────────────────────────────────────────────

test('login with wrong password shows error', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[type="email"], input[name="email"]', 'nobody@example.com');
  await page.fill('input[type="password"]', 'wrongpassword');
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
  // Expect some error feedback — could be a toast, alert, or inline message
  await expect(
    page.locator('[role="alert"], .error, .toast, [data-testid="error"]')
      .or(page.getByText(/invalid|incorrect|wrong|not found/i))
  ).toBeVisible({ timeout: 8_000 });
});

test('unauthenticated access to /dashboard redirects to login', async ({ page }) => {
  // Clear any stored session
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/login/i, { timeout: 8_000 });
});

// ── Successful login (requires credentials) ───────────────────────────────────

test.describe('authenticated flows', () => {
  test.skip(!ADMIN_PASSWORD, 'E2E_ADMIN_PASSWORD not set — skipping authenticated tests');

  test('login with valid credentials reaches dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"], input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();
    await expect(page).toHaveURL(/dashboard|boards|tasks/i, { timeout: 10_000 });
  });

  test('auth token is stored in localStorage after login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"], input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();
    await page.waitForURL(/dashboard|boards|tasks/i, { timeout: 10_000 });
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
  });

  test('logout clears session and redirects to login', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('input[type="email"], input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();
    await page.waitForURL(/dashboard|boards|tasks/i, { timeout: 10_000 });

    // Logout via sidebar or user menu
    const logoutBtn = page
      .getByRole('button', { name: /logout|sign out/i })
      .or(page.getByText(/logout|sign out/i));
    await logoutBtn.first().click();

    await expect(page).toHaveURL(/login/i, { timeout: 8_000 });
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(token).toBeNull();
  });

  test('session_token cookie is set after login (httpOnly cookie)', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"], input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();
    await page.waitForURL(/dashboard|boards|tasks/i, { timeout: 10_000 });

    // httpOnly cookies are not accessible via document.cookie / JS,
    // so we check via the Playwright browser context API
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(c => c.name === 'session_token');
    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie!.httpOnly).toBe(true);
  });

  test('session persists after clearing localStorage (cookie-based auth)', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"], input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();
    await page.waitForURL(/dashboard|boards|tasks/i, { timeout: 10_000 });

    // Clear localStorage but keep cookies
    await page.evaluate(() => localStorage.clear());

    // Navigate to a protected page — should still be authenticated via cookie
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/dashboard/i, { timeout: 8_000 });
  });

  test('after logout, accessing protected page redirects to login', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.fill('input[type="email"], input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();
    await page.waitForURL(/dashboard|boards|tasks/i, { timeout: 10_000 });

    // Logout
    const logoutBtn = page
      .getByRole('button', { name: /logout|sign out/i })
      .or(page.getByText(/logout|sign out/i));
    await logoutBtn.first().click();
    await expect(page).toHaveURL(/login/i, { timeout: 8_000 });

    // Try accessing a protected page directly
    await page.goto('/tasks');
    await expect(page).toHaveURL(/login/i, { timeout: 8_000 });
  });
});
