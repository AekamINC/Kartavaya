/**
 * Can a firm REMOVE a GSTIN it has already saved?
 *
 * CLAUDE.md: "GSTIN / PAN / TAN are non-mandatory and must block nothing. This
 * has drifted back more than once; do not 'fix' it."
 *
 * Suite 02.2 clears all three and saves. Measured on 2026-08-28, twice:
 *   · run 1 — no success toast appeared;
 *   · run 2 — `waitForResponse` timed out: NO REQUEST WAS MADE AT ALL;
 *   · and `GET /org/profile` still returns gstin=24AAACU5678U1Z9, so nothing
 *     was written either.
 *
 * Two candidate causes were eliminated by reading, not by assuming:
 *   · the save handler does NOT gate on gstin/pan/tan — only on IFSC;
 *   · the stored IFSC is `HDFC0001234`, which is valid (11 chars, matches the
 *     regex), so the IFSC early-return is not firing.
 *
 * That leaves the change-diff: `if (!Object.keys(changed).length) return`.
 * If clearing a field does not register as a change, a GSTIN can be added and
 * never removed — the customer types, saves, and the product silently does
 * nothing. Invisible to any row count.
 *
 * This probe reads the TOAST and the WIRE and reports what is actually there.
 * It restores whatever it changes.
 */
import { test, expect, Page } from '@playwright/test';

const TOKEN = process.env.E2E_UNICODE_TOKEN;

test('clearing a stored GSTIN registers as a change and reaches the server', async ({ page }) => {
  test.skip(!TOKEN, 'no Unicode token in .env.e2e');
  test.setTimeout(3 * 60_000);

  const wire: string[] = [];
  page.on('response', async (r) => {
    if (!['POST', 'PUT', 'PATCH'].includes(r.request().method())) return;
    if (!/\/api\//.test(r.url())) return;
    let b = '';
    try { b = (await r.text()).slice(0, 200); } catch { /* consumed */ }
    wire.push(`${r.request().method()} ${r.status()} ${new URL(r.url()).pathname} ${b}`);
  });

  await page.goto('/login');
  await page.evaluate((t) => localStorage.setItem('auth_token', t), TOKEN!);
  await page.goto('/settings/organisation');

  page.on('requestfailed', (r) => {
    if (/\/api\//.test(r.url())) {
      wire.push(`FAILED ${r.method()} ${new URL(r.url()).pathname} :: ${r.failure()?.errorText}`);
    }
  });

  const gstin = page.locator('#org-gstin');
  await expect(gstin).toBeVisible({ timeout: 30_000 });
  const before = await gstin.inputValue();
  console.log(`\n  GSTIN before: ${JSON.stringify(before)}`);
  expect(before, 'precondition: a GSTIN must be stored for this probe to mean anything').toBeTruthy();

  // Clear it the way a person does — select all, delete — rather than with a
  // programmatic fill(''), so a controlled input cannot be blamed for the
  // result. Both are exercised: fill first, then a real keystroke path.
  // ALL THREE, which is what 02.2 does. The single-field version of this probe
  // passed; 02.2 clears gstin, pan AND tan and its save answered
  // "Failed to save profile" with no HTTP response at all. That difference is
  // the whole question.
  const stored: Record<string, string> = {};
  for (const id of ['#org-gstin', '#org-pan', '#org-tan']) {
    const f = page.locator(id);
    stored[id] = await f.inputValue();
    await f.click();
    await f.press('ControlOrMeta+a');
    await f.press('Delete');
    await expect(f).toHaveValue('');
  }
  console.log(`  cleared: ${JSON.stringify(stored)}`);

  await page.getByRole('button', { name: /Save company profile/ }).click();
  await page.waitForTimeout(4000);

  const toasts = await page.locator('.tst__t').allInnerTexts().catch(() => []);
  console.log(`  TOAST(S): ${JSON.stringify(toasts)}`);
  console.log(`  WIRE: ${wire.length ? wire.join(' | ') : '(NO WRITE REQUEST)'}\n`);

  // Restore before asserting, so a red test never leaves the org altered.
  for (const [id, val] of Object.entries(stored)) {
    if (!val) continue;
    const f = page.locator(id);
    await f.click();
    await f.press('ControlOrMeta+a');
    await f.pressSequentially(val);
  }
  await page.getByRole('button', { name: /Save company profile/ }).click();
  await page.waitForTimeout(4000);
  console.log(`  restore wire: ${wire.join(' | ')}`);

  expect(
    wire.length,
    `CLEARING A STORED GSTIN SENT NOTHING TO THE SERVER.\n` +
    `  toast on screen: ${JSON.stringify(toasts)}\n` +
    `  A firm that is no longer GST-registered cannot remove its GSTIN: the\n` +
    `  field clears, Save is pressed, and the product does nothing at all.\n` +
    `  "GSTIN must block nothing" is satisfied on ADD and broken on REMOVE.`,
  ).toBeGreaterThan(0);
});
