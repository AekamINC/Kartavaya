/**
 * The Created column is on the tables it was added to, and it sorts.
 *
 * The owner asked for a created date on every table, sortable. This checks the
 * DEPLOYED build rather than the source, because the page chunks are
 * code-split — `tbl__created` does not appear in `index.js` at all, so grepping
 * the main bundle proves nothing either way.
 *
 * It asserts the header exists, that it is a real sort control (a button with
 * aria-sort, not a plain <th> wearing the label), and that clicking it changes
 * the reported direction. A column that says it sorts and does not is worse
 * than one that never claimed to.
 */
import { test, expect } from '@playwright/test';
import { OWNER_STATE } from './real.config';

test.use({ storageState: OWNER_STATE });

/** Tables the column was wired onto, with the route that shows each. */
const CASES: Array<{ name: string; url: string; tab?: string }> = [
  { name: 'graha · clients', url: '/graha?tab=clients' },
  { name: 'ganit · invoices', url: '/ganit?tab=invoices' },
];

for (const c of CASES) {
  test(`${c.name} shows a sortable Created column`, async ({ page }) => {
    await page.goto(c.url);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);

    const head = page.locator('th.tbl__created');
    await expect(head, 'no Created header on this table').toHaveCount(1);

    // It must be a real sort control, not a label that looks like one.
    const button = head.locator('button.tbl__sort');
    await expect(button, 'the Created header is not sortable').toHaveCount(1);
    await expect(head).toHaveAttribute('aria-sort', 'none');

    await button.click();
    await expect(head, 'clicking Created did not change the sort direction')
      .toHaveAttribute('aria-sort', 'ascending');
    await button.click();
    await expect(head).toHaveAttribute('aria-sort', 'descending');

    // And the cells carry real dates, not a column of dashes — which is what a
    // missing `created_at` on the endpoint would look like.
    const cells = page.locator('td.tbl__created');
    const n = await cells.count();
    expect(n, 'Created header with no Created cells').toBeGreaterThan(0);
    const withDate = await page.locator('td.tbl__created time').count();
    console.log(`${c.name}: ${n} cells, ${withDate} carrying a date`);
    expect(withDate,
      'every Created cell is empty — the endpoint is not returning created_at')
      .toBeGreaterThan(0);
  });
}
