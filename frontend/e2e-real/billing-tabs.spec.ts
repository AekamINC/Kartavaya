/**
 * Proposal 87 billing tabs — verify every tab renders content (not blank).
 *
 * The intermittent blank-rendering issue showed the toolbar but no EmptyState
 * or table below it. This spec navigates to each billing tab across Ganit and
 * Vikray, and asserts that visible content appears below the toolbar.
 *
 * Read-only: no writes, safe against the shared DB.
 */
import { test, expect } from '@playwright/test';
import { OWNER_STATE } from './real.config';
import { openTab, settle } from './_helpers';

test.use({ storageState: OWNER_STATE });

const BILLING_TABS: Array<{ module: string; path: string; tabs: string[] }> = [
  {
    module: 'Ganit',
    path: '/ganit',
    tabs: ['Billing Profiles', 'Service lines', 'Metered usage', 'Rate cards', 'SLA credits', 'Ageing'],
  },
  {
    module: 'Vikray',
    path: '/vikray?tab=billing',
    tabs: ['Billing'],
  },
];

for (const { module, path: modulePath, tabs } of BILLING_TABS) {
  for (const tabLabel of tabs) {
    test(`${module} › ${tabLabel} tab renders content`, async ({ page }) => {
      await page.goto(modulePath);
      await settle(page);

      if (tabLabel !== 'Billing' || module !== 'Vikray') {
        await openTab(page, new RegExp(tabLabel, 'i'));
      }

      const panel = page.locator('[role="tabpanel"]');
      await expect(panel).toBeVisible({ timeout: 15_000 });

      // Wait for skeleton to disappear (loading complete)
      const skeleton = panel.locator('.k-skeleton-table');
      if (await skeleton.count() > 0) {
        await expect(skeleton).toBeHidden({ timeout: 30_000 });
      }

      // The tab must have content: an EmptyState, a table, a section label, or an error.
      // Use count-based assertion to avoid strict mode issues.
      const hasEmpty = await panel.locator('.empty').count();
      const hasTable = await panel.locator('.k-table').count();
      const hasSection = await panel.locator('.k-section-label').count();
      const hasError = await panel.locator('.k-err').count();

      const hasContent = hasEmpty > 0 || hasTable > 0 || hasSection > 0 || hasError > 0;
      expect(hasContent, `${module} › ${tabLabel}: tab rendered only toolbar with no content below it`).toBe(true);
    });
  }
}
