/**
 * The analytics door on every module page — the owner's rule, checked
 * against the DEPLOYED staging app for three representative modules.
 *
 * Each page must show an Analytics tab (inline or behind More), and opening
 * it must draw REAL widgets from the module's own catalogue slice — never
 * the finance cards, never an error card. Read-only throughout.
 */
import { test, expect, Page } from '@playwright/test';
import { OWNER_STATE } from './real.config';

test.use({ storageState: OWNER_STATE });

async function openAnalytics(page: Page, path: string) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(path);
  const tab = page.getByRole('tab', { name: /analytics/i });
  const overflow = page.getByRole('button', { name: /More \+\d/ });
  await expect(tab.or(overflow).first()).toBeVisible({ timeout: 20_000 });
  if (await tab.isVisible()) {
    await tab.click();
  } else {
    await overflow.click();
    await page.getByRole('menuitem', { name: /analytics/i }).click();
  }
}

for (const [path, label] of [
  ['/graha', 'CRM'],
  ['/vikray', 'Sales'],
  ['/manav', 'HR'],
] as const) {
  test(`${label} (${path}) opens its own analytics arrangement`, async ({ page }) => {
    await openAnalytics(page, path);
    // widgets arrive from the module's catalogue — at least one card renders
    // a real figure or an honest empty line, never the red error note
    await expect(page.locator('.vgw').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.anx .note--warn')).toHaveCount(0);
    // the ganit-only finance cards must not leak onto other modules
    await expect(page.getByText('Top debtors')).toHaveCount(0);
  });
}
