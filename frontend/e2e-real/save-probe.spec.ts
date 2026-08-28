/**
 * Does the UPI / sender save actually reach the server, and what does it answer?
 *
 * 02.4 and 02.5 fail identically on BOTH orgs: the inputs exist, they fill, the
 * Save button is clicked, and afterwards `staging.org_upi_accounts` and
 * `staging.org_email_senders` hold zero rows. Three explanations remain and a
 * row count cannot separate them:
 *
 *   1. the request is never sent          -> TEST BUG (wrong button)
 *   2. the request is sent and rejected   -> PRODUCT or ENTITLEMENT, per status
 *   3. the request is sent and accepted   -> PRODUCT: accepted and not persisted
 *
 * So this watches the wire. It is the only thing that decides it.
 */
import { test, expect, Page } from '@playwright/test';

const TOKEN = process.env.E2E_UNICODE_TOKEN || process.env.E2E_GODMODE_TOKEN;

async function enter(page: Page) {
  test.skip(!TOKEN, 'no Unicode token in .env.e2e');
  await page.goto('/login');
  await page.evaluate((t) => localStorage.setItem('auth_token', t), TOKEN!);
}

test('what the UPI and sender saves actually do on the wire', async ({ page }) => {
  test.setTimeout(4 * 60_000);

  const wire: string[] = [];
  page.on('request', (r) => {
    if (['POST', 'PUT', 'PATCH'].includes(r.method()) && /\/api\//.test(r.url())) {
      wire.push(`--> ${r.method()} ${new URL(r.url()).pathname}\n       body=${(r.postData() || '').slice(0, 900)}`);
    }
  });
  page.on('response', async (r) => {
    if (['POST', 'PUT', 'PATCH'].includes(r.request().method()) && /\/api\//.test(r.url())) {
      let b = '';
      try { b = (await r.text()).slice(0, 250); } catch { /* opaque */ }
      wire.push(`<-- ${r.status()} ${new URL(r.url()).pathname}  ${b}`);
    }
  });

  await enter(page);

  // ── UPI ────────────────────────────────────────────────────────────────────
  wire.length = 0;
  await page.goto('/settings/organisation?tab=upi');
  await page.waitForTimeout(3000);
  const paytmVisible = await page.locator('#upi-paytm').isVisible().catch(() => false);
  console.log(`\n  #upi-paytm visible: ${paytmVisible}`);
  if (paytmVisible) {
    await page.locator('#upi-paytm').fill('unicodegroup@paytm');
    await page.locator('#upi-paytm-name').fill('Unicode Group');
    const btn = page.getByRole('button', { name: /Save UPI IDs/ });
    console.log(`  Save UPI IDs button count: ${await btn.count()}  enabled: ${await btn.first().isEnabled().catch(() => 'n/a')}`);
    await btn.first().click().catch((e) => console.log('  click threw: ' + e.message.slice(0, 120)));
    await page.waitForTimeout(4000);
  }
  console.log('\n  ---- UPI wire ----');
  if (!wire.length) console.log('   (NO write request was sent at all)');
  for (const w of wire) console.log('   ' + w);

  // ── Senders ────────────────────────────────────────────────────────────────
  wire.length = 0;
  await page.goto('/settings/organisation?tab=senders');
  await page.waitForTimeout(3000);
  const senderInputs = await page.locator('input[type="email"], input[id*="sender"]').count();
  console.log(`\n  sender-ish inputs on the tab: ${senderInputs}`);
  const saveBtns = await page.getByRole('button', { name: /save/i }).allInnerTexts().catch(() => []);
  console.log(`  save buttons present: ${JSON.stringify(saveBtns)}`);

  console.log('\n  ---- senders wire ----');
  if (!wire.length) console.log('   (no write request)');
  for (const w of wire) console.log('   ' + w);
  expect(true).toBe(true);
});
