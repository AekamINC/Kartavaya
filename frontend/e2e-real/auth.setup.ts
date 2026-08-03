/**
 * Logs in both test users through the real login form once, then persists
 * storage state (localStorage token + httpOnly API cookie) for the journeys.
 */
import { test as setup, expect, Page } from '@playwright/test';
import { OWNER_STATE, APPROVER_STATE } from './real.config';

async function uiLogin(page: Page, email: string, password: string, statePath: string) {
  await page.goto('/login');
  const emailBox = page.locator('#au-email, input[type="email"], input[name="email"]').first();
  const passBox = page.locator('#au-password, input[type="password"], input[name="password"]').first();
  await expect(emailBox).toBeVisible();
  await emailBox.fill(email);
  await passBox.fill(password);
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")').first().click();
  await page.waitForURL(/\/(dashboard|boards|tasks|projects)/, { timeout: 45_000 });
  await page.context().storageState({ path: statePath });
}

setup('owner signs in', async ({ page }) => {
  await uiLogin(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!, OWNER_STATE);
});

setup('approver signs in', async ({ page }) => {
  await uiLogin(page, process.env.E2E_APPROVER_EMAIL!, process.env.E2E_APPROVER_PASSWORD!, APPROVER_STATE);
});
