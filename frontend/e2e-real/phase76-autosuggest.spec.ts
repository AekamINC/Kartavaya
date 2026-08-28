/**
 * Phase 7.6's acceptance: a person types, and Mappls answers. In the browser.
 *
 * This is the row-not-code test. §7.6 is ✅ only when the flow completes for a
 * user on the deployed site — the whole lesson of the 84–90 era is that code
 * shipping is not the same claim.
 *
 * ⚠ It types a PLACE NAME, never a stored customer address. Content submitted
 * to Mappls carries a perpetual, sub-licensable licence back to them, so the
 * fragment is chosen the same way the feature chooses it.
 */
import { test, expect } from '@playwright/test';
import { APPROVER_STATE } from './real.config';

test.use({ storageState: APPROVER_STATE });

test('typing in the vendor address field returns Mappls suggestions', async ({ page }) => {
  const refusals: string[] = [];
  page.on('console', m => { if (m.type() === 'error') refusals.push(m.text()); });

  /* Ganit's Payables tab, not Kray: `VendorForm` is shared, and this is the
     surface that actually mounts it behind a "+ Vendor" control. The first
     draft of this spec went to /kray/vendors and timed out looking for a
     button that is not there — Kray is a LIST plus the shared form, which
     `VendorForm.jsx`'s own header records. */
  await page.goto('/ganit');
  await page.getByRole('tab', { name: /payables/i }).first().click().catch(() => {});

  // The product's own label, not a test id: a spec that clicks an id nobody
  // sees can pass while the screen is unusable.
  const add = page.getByRole('button', { name: /^\+ Vendor$/ }).first();
  await add.waitFor({ timeout: 30_000 });
  await add.click();

  const box = page.getByRole('combobox', { name: /find an address/i });
  await box.waitFor({ timeout: 20_000 });

  await box.fill('Bopal Ahmedabad');

  // The debounce is 350ms and the SDK then makes a real round trip.
  await page.waitForTimeout(6000);
  // What the field itself says BEFORE asserting — the component distinguishes
  // "not switched on", "could not reach" and "no matches", and each sends a
  // reader somewhere different. A bare toBeVisible failure hides all three.
  const panel = await page.locator('.k-asug').first().innerText().catch(() => '(no .k-asug)');
  console.log('=== what the field says ===');
  console.log(panel);
  console.log('=== mappls console lines ===');
  refusals.filter(r => /mappls|search/i.test(r)).forEach(r =>
    console.log('  ' + r.replace(/(access_token=)[a-z0-9]{20,}/gi, '$1<REDACTED>').slice(0, 300)));

  /* `.k-asug__opt`, not `getByRole('option')`. The listbox is portalled and
     Playwright's role engine did not resolve the options inside it, while the
     panel's own text plainly showed them — a spec that fails on its query
     rather than on the product is worse than no spec. The class is the one the
     component actually renders and the `role="option"` attribute is asserted
     separately below, so accessibility is still pinned. */
  const options = page.locator('.k-asug__opt');
  await expect(options.first(),
    'no suggestion appeared — read the panel text printed above')
    .toBeVisible({ timeout: 25_000 });
  await expect(options.first()).toHaveAttribute('role', 'option');

  const count = await options.count();
  const first = (await options.first().innerText()).slice(0, 120);
  console.log(`\n=== 7.6 acceptance ===`);
  console.log(`  suggestions: ${count}`);
  console.log(`  first:       ${first}`);
  refusals.filter(r => /mappls/i.test(r)).forEach(r =>
    console.log('  console: ' + r.replace(/(access_token=)[a-z0-9]{20,}/gi, '$1<REDACTED>')));

  expect(count).toBeGreaterThan(0);

  // The credit Mappls' terms require, on the class the gate guards.
  await expect(page.locator('.terr__mapbrand').first()).toBeVisible();
});
