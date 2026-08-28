/**
 * Diagnostic probe for the one break the cold-start audit found: /hub/org
 * renders the shared `ErrorNote` ("… did not load. Try again").
 *
 * The audit says WHAT broke. This says WHY, because the stop-and-fix rule turns
 * on product-bug-or-test-bug and "Try again" is not enough to decide.
 *
 * Read-only: navigates and records. Writes nothing.
 */
import { test } from '@playwright/test';

test('why does /hub/org show ErrorNote', async ({ page }) => {
  test.setTimeout(3 * 60_000);

  const email = process.env.E2E_APPROVER_EMAIL;
  const password = process.env.E2E_APPROVER_PASSWORD;
  test.skip(!email || !password, 'approver credentials not in .env.e2e');

  const failed: string[] = [];
  page.on('response', async (r) => {
    if (r.status() >= 400) {
      let body = '';
      try { body = (await r.text()).slice(0, 300); } catch { /* opaque */ }
      failed.push(`${r.status()} ${r.request().method()} ${r.url()}\n      ${body}`);
    }
  });
  page.on('console', (m) => { if (m.type() === 'error') failed.push(`console: ${m.text()}`); });

  await page.goto('/login');
  await page.locator('#au-email, input[type="email"]').first().fill(email!);
  await page.locator('#au-password, input[type="password"]').first().fill(password!);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(dashboard|boards|tasks|projects)/, { timeout: 45_000 });

  failed.length = 0; // only care about what /hub/org itself does
  await page.goto('/hub/org', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const notes = await page.locator('.hb-err, .note--warn, [role="status"]').allInnerTexts();

  // Where does the literal "Try again" actually come from? The audit flagged the
  // string; that is not the same as an error having occurred.
  const body = (await page.locator('body').innerText().catch(() => '')) || '';
  const idx = body.toLowerCase().indexOf('try again');
  console.log('\n---- context around "Try again" ----');
  console.log(idx < 0 ? '   (string absent on this visit)' : JSON.stringify(body.slice(Math.max(0, idx - 220), idx + 80)));
  const errNotes = await page.locator('.hb-err').count();
  const tryAgainBtns = await page.locator('button:has-text("Try again")').count();
  console.log(`   .hb-err elements: ${errNotes}   "Try again" buttons: ${tryAgainBtns}`);
  console.log(`   body length: ${body.length}`);

  console.log('\n================ /hub/org PROBE ================');
  console.log('error notes on screen:');
  for (const n of notes) console.log('   • ' + n.replace(/\s+/g, ' ').trim());
  console.log('\nfailing requests / console errors:');
  if (!failed.length) console.log('   (none — the note is rendered without any HTTP failure)');
  for (const f of failed) console.log('   ' + f);
  console.log('===============================================\n');
});
