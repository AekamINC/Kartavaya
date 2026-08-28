/**
 * What ARE the console errors that appeared the moment the org went empty?
 *
 * Before the R4 wipe the cold-start audit was clean: 31 routes, 0 console
 * errors. Immediately after, every one of the 31 routes reports 3-7. That is
 * the empty-state path, and §1 of proposal 93 says it precisely: "the state
 * nobody has looked at since the data arrived".
 *
 * This captures the actual messages and the failing requests behind them.
 * Read-only.
 */
import { test } from '@playwright/test';

const TARGETS = ['/dashboard', '/graha', '/sanvaad', '/hub/org'];

test('what the empty-org console errors are', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const email = process.env.E2E_APPROVER_EMAIL;
  const password = process.env.E2E_APPROVER_PASSWORD;
  test.skip(!email || !password, 'approver credentials not in .env.e2e');

  const seen: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') seen.push(`CONSOLE ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => seen.push(`PAGEERROR ${e.message.slice(0, 300)}`));
  page.on('response', async (r) => {
    if (r.status() >= 400) {
      let b = '';
      try { b = (await r.text()).slice(0, 200); } catch { /* opaque */ }
      seen.push(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname} :: ${b}`);
    }
  });

  await page.goto('/login');
  await page.locator('#au-email, input[type="email"]').first().fill(email!);
  await page.locator('#au-password, input[type="password"]').first().fill(password!);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(dashboard|boards|tasks|projects)/, { timeout: 45_000 });

  console.log('\n================ EMPTY-ORG CONSOLE PROBE ================');
  for (const path of TARGETS) {
    seen.length = 0;
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    console.log(`\n--- ${path}  (${seen.length} events) ---`);
    for (const s of [...new Set(seen)].slice(0, 12)) console.log('   ' + s);
  }
  console.log('\n=========================================================\n');
});
