/**
 * Does the UPI tab SHOW a UPI id that is definitely stored?
 *
 * Settled facts before this runs, so the probe only has one question left:
 *   · `save-probe.spec.ts` watched the wire — the PUT is sent and answers 200.
 *   · `GET /api/v1/org/profile/upi-accounts` returns
 *       paytm | vpa='unicodegroup@paytm' | payee='Unicode Group'
 *     so the row EXISTS. Read live, not inferred from the migration.
 *
 * 02.5 nevertheless read `#upi-paytm` as "" after a reload. Two explanations
 * remain and only the browser separates them:
 *
 *   1. the field renders the stored value and 02.5 raced it -> TEST BUG
 *   2. the field renders EMPTY over a stored row            -> PRODUCT BUG
 *
 * (2) is the defect class proposal 93 exists to find: invisible to any row
 * count, and indistinguishable from "nothing was ever saved" to the person
 * looking at it — who then types it again.
 *
 * READ-ONLY. This probe fills nothing and clicks no Save.
 */
import { test, expect } from '@playwright/test';

const TOKEN = process.env.E2E_UNICODE_TOKEN;

test('the UPI tab shows the paytm id that is stored on the server', async ({ page, request }) => {
  test.skip(!TOKEN, 'no Unicode token in .env.e2e');

  // What the server holds, read at the moment of the check rather than trusted
  // from a previous run.
  const api = process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app';
  const res = await request.get(`${api}/api/v1/org/profile/upi-accounts`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  expect(res.ok()).toBeTruthy();
  const stored = (await res.json()).accounts.find((a: any) => a.platform === 'paytm');
  console.log(`\n  SERVER holds: paytm vpa=${JSON.stringify(stored?.vpa)} payee=${JSON.stringify(stored?.payee_name)}`);
  expect(stored?.vpa, 'precondition: the row must exist for this probe to mean anything').toBeTruthy();

  await page.goto('/login');
  await page.evaluate((t) => localStorage.setItem('auth_token', t), TOKEN!);
  await page.goto('/settings/organisation?tab=upi');

  const field = page.locator('#upi-paytm');
  await expect(field).toBeVisible({ timeout: 30_000 });

  // Give every fetch on the page time to land, so "empty" cannot be "not yet".
  await page.waitForLoadState('networkidle').catch(() => {});
  const shown = await field.inputValue();
  console.log(`  SCREEN shows: ${JSON.stringify(shown)}\n`);

  expect(
    shown,
    `THE SCREEN DOES NOT SHOW A STORED VALUE.\n` +
    `  server: ${JSON.stringify(stored?.vpa)}\n` +
    `  screen: ${JSON.stringify(shown)}\n` +
    `  A customer sees an empty field over a saved row, types it again, and\n` +
    `  cannot tell that from "it never saved". No row count can see this.`,
  ).toBe(stored.vpa);
});
