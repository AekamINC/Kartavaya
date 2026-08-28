/**
 * What do the `.note--warn` blocks on /manav and /vetana actually SAY?
 *
 * The structural error check flagged one on each. `.note--warn` is shared —
 * `ErrorNote` uses it, but so may ordinary advisory banners — so a count alone
 * cannot tell a failure from a legitimate warning. Reading the text is the only
 * thing that decides it, and deciding it is the difference between a defect and
 * a false positive.
 *
 * Read-only.
 */
import { test } from '@playwright/test';

const TARGETS = ['/manav', '/vetana', '/hub/org', '/ganit', '/kray'];

test('what the warn notes say', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const email = process.env.E2E_APPROVER_EMAIL;
  const password = process.env.E2E_APPROVER_PASSWORD;
  test.skip(!email || !password, 'approver credentials not in .env.e2e');

  await page.goto('/login');
  await page.locator('#au-email, input[type="email"]').first().fill(email!);
  await page.locator('#au-password, input[type="password"]').first().fill(password!);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(dashboard|boards|tasks|projects)/, { timeout: 45_000 });

  console.log('\n================ WARN-NOTE PROBE ================');
  for (const path of TARGETS) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const warn = await page.locator('.note--warn').allInnerTexts().catch(() => []);
    const hbErr = await page.locator('.hb-err').count().catch(() => 0);
    console.log(`\n${path}   .note--warn=${warn.length}  .hb-err=${hbErr}`);
    for (const w of warn) console.log('   • ' + w.replace(/\s+/g, ' ').trim().slice(0, 240));
  }
  console.log('\n=================================================\n');
});
