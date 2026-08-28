/**
 * Proposal 93 · Stage 3 · WAVE 1 — THE DAY-ONE CAPTURE, taken before any
 * module is switched on.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS AND WHY IT HAD TO RUN FIRST
 * ═══════════════════════════════════════════════════════════════════════════
 * Measured 2026-08-28, `staging.module_subscriptions` holds rows for exactly
 * two orgs — Aekam Inc (13) and Demo (12). Unicode Group, E2E Test &
 * Associates and UK AekamINC have ZERO. So every module route in those three
 * orgs is refused by `middleware/subscription.require_module` with
 *
 *     403 "Module 'X' is not active. Contact your administrator to activate it."
 *
 * That is not a broken staging environment. **It is the genuine day-one state
 * of a brand-new customer**, and the moment anyone provisions a module it is
 * gone and cannot be recreated without wiping the subscription again.
 *
 * The question this spec answers is the one a first-week customer asks, and it
 * is NOT "did the request fail" — of course it did. It is:
 *
 *     Does the SCREEN tell them to activate the module, or does that sentence
 *     exist only inside a 403 body nobody reads?
 *
 * The product HAS the mechanism to say it: `ui/ErrorState.jsx` takes a `detail`
 * override precisely so a caller can pass the server's own sentence through,
 * and its comments record a live 2026-07-30 measurement on `/sanvaad` where the
 * headline and the detail contradicted each other. Whether every module route
 * uses that mechanism is a per-route fact, and this is the measurement.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT ASSERTS — DELIBERATELY, ALMOST NOTHING
 * ═══════════════════════════════════════════════════════════════════════════
 * This is a CAPTURE, not a gate. It prints a table and saves a screenshot per
 * route. Its only hard assertion is that it visited every route, because a
 * capture that half-ran and reported green would destroy the evidence it was
 * taken to preserve. The verdicts belong in the run report, written by a human
 * reading the screenshots — turning "the screen says nothing useful" into a
 * red test here would invite someone to make it green by editing the regex.
 *
 * READ-ONLY. It fills no form and clicks no control that writes, so it is safe
 * against any org.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave1.config.ts --grep "day-one"
 */
import { test, expect, Page, Request } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** The module-gated destinations. Params-only routes are excluded: they need an
 *  id, and inventing one measures the 404 path instead of the entitlement one. */
const MODULE_ROUTES: Array<[string, string]> = [
  ['graha (CRM)', '/graha'],
  ['ganit (books)', '/ganit'],
  ['kray (procurement)', '/kray'],
  ['manav (HR)', '/manav'],
  ['vetana (payroll)', '/vetana'],
  ['pahchan (attendance)', '/pahchan'],
  ['vikray (sales)', '/vikray'],
  ['prachar (marketing)', '/prachar'],
  ['dristi (reports)', '/dristi'],
  ['sanvaad (chat)', '/sanvaad'],
  ['esign', '/esign'],
];

const SHOTS = path.join(os.tmpdir(), 'kartavya-e2e-wave1', 'dayone-shots');

/**
 * Whichever account this environment can actually sign in as.
 *
 * Unicode Group first, because that is the lane under test. The approver is the
 * fallback and it holds a seat in E2E Test & Associates ONLY — which is in the
 * IDENTICAL zero-subscription state, so the product question this spec asks is
 * answered either way. The org that was actually observed is printed in the
 * table header, because an evidence capture that does not say what it looked at
 * is not evidence.
 */
function anyLogin(): { email: string; password: string; org: string } | null {
  if (process.env.E2E_UNICODE_EMAIL && process.env.E2E_UNICODE_PASSWORD) {
    return {
      email: process.env.E2E_UNICODE_EMAIL,
      password: process.env.E2E_UNICODE_PASSWORD,
      org: 'Unicode Group (fae87907)',
    };
  }
  if (process.env.E2E_APPROVER_EMAIL && process.env.E2E_APPROVER_PASSWORD) {
    return {
      email: process.env.E2E_APPROVER_EMAIL,
      password: process.env.E2E_APPROVER_PASSWORD,
      org: 'E2E Test & Associates (64e7bea6) — same zero-subscription state',
    };
  }
  return null;
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await expect(page.locator('#au-email')).toBeVisible({ timeout: 30_000 });
  await page.locator('#au-email').fill(email);
  await page.locator('#au-password').fill(password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
}

test('day-one · what a customer with no modules actually SEES', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const who = anyLogin();
  if (!who) throw new Error('No password login available in .env.e2e.');

  fs.mkdirSync(SHOTS, { recursive: true });

  // Count the refusals per route, straight off the wire.
  let refusals: Array<{ url: string; body: string }> = [];
  page.on('response', async (r) => {
    if (r.status() !== 403) return;
    const body = await r.text().catch(() => '');
    refusals.push({ url: new URL(r.url()).pathname, body: body.slice(0, 300) });
  });
  const failed: string[] = [];
  page.on('requestfailed', (r: Request) => failed.push(new URL(r.url()).pathname));

  await signIn(page, who.email, who.password);

  const rows: Array<Record<string, string>> = [];

  for (const [name, route] of MODULE_ROUTES) {
    refusals = [];
    failed.length = 0;

    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3000);

    const body = ((await page.locator('body').innerText().catch(() => '')) || '').trim();

    // ⚠ THREE DIFFERENT SENTENCES, and the first cut of this capture conflated
    // two of them. `/is not active/` matched BOTH "Module 'sanvaad' is not
    // active. Contact your administrator to activate it." and "Subscription is
    // not active" — and reported 4/11 routes as telling the customer what to
    // do when only some of them do. They are not the same message:
    //
    //   MODULE       names the module AND the remedy. This is the good one.
    //   SUBSCRIPTION names a state with no remedy and no module. True for these
    //                orgs (they have no `staging.subscriptions` row either) but
    //                it does not tell anyone what to press next.
    //
    // Measuring them apart is the whole point of the capture, so they are
    // measured apart.
    const saysModule = /Module '[^']+' is not active|Contact your administrator to activate/i.test(body);
    const saysSubscription = /Subscription is not active/i.test(body);
    // Or does the screen show the generic denial headline with nothing
    // actionable under it — the exact contradiction ErrorState's comments
    // record from 2026-07-30?
    const genericDenial = /You don’t have access to this|You don't have access to this/i.test(body);
    // Or does it show nothing at all about the cause?
    const errBlock = await page.locator('.k-err').count().catch(() => 0);
    // A grant-shaped sentence is the WORST outcome and needs its own column:
    // it sends the reader off to ask for access that would not have helped.
    const saysAccess = /You do not have access|You don’t have access|You don't have access/i.test(body);

    const shot = path.join(SHOTS, route.replace(/\W+/g, '_') + '.png');
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

    rows.push({
      route: name,
      path: route,
      http403s: String(refusals.length),
      errorBlock: String(errBlock),
      saysModule: saysModule ? 'YES' : 'no',
      saysSubscription: saysSubscription ? 'YES' : 'no',
      saysAccess: saysAccess ? 'YES' : 'no',
      genericDenialHeadline: genericDenial ? 'YES' : 'no',
      bodyChars: String(body.length),
    });
  }

  console.log('\n================ DAY-ONE · NO MODULES ACTIVE ================');
  console.log(`org observed: ${who.org}`);
  console.log(`signed in as: ${who.email}`);
  console.log(`screenshots:  ${SHOTS}\n`);
  console.log(
    'route'.padEnd(24) + '403s'.padEnd(6) + '.k-err'.padEnd(8) +
    'MODULE+remedy'.padEnd(15) + 'subscription'.padEnd(14) +
    'no-access'.padEnd(11) + 'generic'.padEnd(9) + 'body'
  );
  for (const r of rows) {
    console.log(
      r.route.padEnd(24) + r.http403s.padEnd(6) + r.errorBlock.padEnd(8) +
      r.saysModule.padEnd(15) + r.saysSubscription.padEnd(14) +
      r.saysAccess.padEnd(11) + r.genericDenialHeadline.padEnd(9) + r.bodyChars
    );
  }
  const told = rows.filter((r) => r.saysModule === 'YES').length;
  console.log(`\nroutes whose SCREEN names the module AND the remedy: ${told} / ${rows.length}`);
  console.log('=============================================================\n');

  // The only gate: it actually visited everything. See the header for why the
  // verdicts are not assertions.
  expect(rows).toHaveLength(MODULE_ROUTES.length);
});
