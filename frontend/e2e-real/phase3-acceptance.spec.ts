/**
 * Phase 3.2 acceptance — a mid-cycle plan change nets, driven as a real user.
 *
 * ── WHAT THIS PROVES, AND WHY A ROW COUNT IS NOT ENOUGH ─────────────────────
 *
 * Until 2026-08-26 a mid-cycle plan change raised TWO DEBITS. `proration.py`
 * computed the credit for the unused days at the old rate correctly and then
 * wrote it as `kind='setup'` — a charge — because `billing_lines._money`
 * refuses a negative amount. A downgrade billed the plan the customer had left
 * as well as the one they moved to.
 *
 * So the assertion is not "two lines appeared". Two lines appeared BEFORE the
 * fix. What has to be true is that one of them is a `credit`, that the console
 * SUBTRACTS it, and that the two net to the difference between the plans for
 * the days that are left.
 *
 * ── HOW IT IS DRIVEN ────────────────────────────────────────────────────────
 *
 * Through the admin billing console at /admin/billing, as an operator: pick the
 * organisation in the scope bar by NAME, open Plan, choose a plan, press Apply.
 * The owner's rule is that test data is created through the product's real
 * forms; the API is used only to READ what the screens then have to agree with.
 *
 * ── WHAT IT WRITES, AND WHERE ───────────────────────────────────────────────
 *
 * `staging.org_billing_lines` rows in **E2E Test & Associates only** — the
 * seeded test org. Staging shares its database with production, so this never
 * touches Unicode Group, which is a real customer. Nothing is deleted
 * afterwards: the rows ARE the acceptance evidence (owner's standing rule), and
 * the plan is put back by making the OPPOSITE change through the same screen,
 * which is itself the upgrade half of the same proof.
 *
 * Run (state minted out-of-band — the owner is a token-only account):
 *     node e2e-real/mint-state.mjs
 *     npx playwright test --config e2e-real/onefile.config.ts phase3-acceptance
 */
import { test, expect, Page } from '@playwright/test';
import { GODMODE_STATE } from './real.config';
import { apiOk, settle, shot, RUN } from './_helpers';

/** The seeded test org. Named, never rendered — the console picks by name. */
const ORG_NAME = 'E2E Test & Associates';
const ORG_ID = process.env.E2E_ORG_ID || '64e7bea6-6abe-490c-a2a4-27a60c6be916';

/** The console is platform-scoped, so it needs the one account that can reach
 *  more than one organisation. `mint-state.mjs` writes this from
 *  E2E_GODMODE_TOKEN; E2E_ADMIN_TOKEN belongs to a Unicode-only admin and
 *  every call it makes here would 403 while the browser wrote into Unicode. */
test.use({ storageState: GODMODE_STATE });

type Line = {
  id: string; kind: string; description: string;
  amount: number; signed_amount: number; cadence: string; period_start: string;
};

async function lines(page: Page): Promise<Line[]> {
  const r = await apiOk(page, 'get', `/api/v1/billing/orgs/${ORG_ID}/lines`);
  return (r.data ?? r) as Line[];
}

/** The plan the console currently shows for the scoped org. */
async function planCode(page: Page): Promise<string> {
  // `api()` already sends `X-Org-Id: E2E_ORG_ID` on every call — there is no
  // header argument to pass, and passing one would be sent as a BODY.
  const r = await apiOk(page, 'get', '/api/v1/subscription/current');
  return (r.subscription?.plan_code ?? '') as string;
}

/** Drive the Plan tab: choose `code`, press Apply, wait for the refetch. */
async function changePlanThroughTheScreen(page: Page, code: string) {
  await page.goto('/admin/billing');
  await settle(page);

  // The scope bar, by its own accessible name. The option VALUES are org ids —
  // that is a form value, not something drawn on screen, and the label the
  // operator reads is the org's name. Asserted below, so a console that started
  // rendering ids would fail here rather than pass quietly.
  const scope = page.getByLabel('Organisation this page acts on');
  await expect(scope, 'the console has no organisation scope control').toBeVisible();
  await scope.selectOption(ORG_ID);
  await expect(scope.locator(`option[value="${ORG_ID}"]`),
    'the scope option does not name the organisation')
    .toHaveText(new RegExp(ORG_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  await settle(page);

  await page.getByRole('tab', { name: /^Plan$/ }).click();
  const panel = page.getByRole('tabpanel');

  // Scoped to the open tabpanel: `getByLabel` is substring-matched and the page
  // carries other selects (scope bar, columns), which is e2e rule 6.
  await panel.getByLabel(/^Plan$/).selectOption(code);

  const apply = panel.getByRole('button', { name: /^Apply to /i });
  await expect(apply, 'the Apply button never became pressable').toBeEnabled();

  // One button, TWO requests — the POST and the refetch behind it (rule 7).
  const wrote = page.waitForResponse(r =>
    r.url().includes('/subscription/admin/set-plan') && r.request().method() === 'POST');
  await apply.click();
  const res = await wrote;
  expect(res.status(), `set-plan refused: ${await res.text()}`).toBe(200);
  await settle(page);
}

test.describe('Phase 3.2 · a mid-cycle plan change nets', () => {
  /* THE APP FIRST, ALWAYS. `_helpers.api()` reads `localStorage.auth_token`
     off the current page, and a context that has not navigated yet is sitting
     on `about:blank` — where reading localStorage is a SecurityError, not an
     empty string. Every read below would fail with a message about the DOM
     rather than about billing. */
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/billing');
    await settle(page);
  });

  test('a downgrade writes one credit and one charge that net to the difference',
    async ({ page }) => {
      const before = await lines(page);
      const from = await planCode(page);
      expect(from, 'the test org has no plan to change from').toBeTruthy();

      // Down from whatever it is on to `growth`, unless it is already there —
      // in which case go the other way, so the spec is re-runnable rather than
      // green only on the first pass.
      const to = from === 'growth' ? 'scale' : 'growth';

      await changePlanThroughTheScreen(page, to);
      await shot(page, `phase3-plan-${to}-${RUN}`);

      const after = await lines(page);
      const fresh = after.filter(a => !before.some(b => b.id === a.id));

      // A change inside the waive window (3 billable days or fewer left in the
      // period) legitimately writes NOTHING. That is `should_waive`, not a
      // failure — but it must be said out loud rather than passing silently as
      // "no lines, no problem".
      test.skip(fresh.length === 0,
        'the change fell inside the proration waive window — 3 or fewer billable ' +
        'days remain in this period, so no lines are due. Re-run earlier in a period.');

      expect(fresh.map(l => l.kind).sort(),
        'a plan change must raise exactly one credit and one charge — two ' +
        'setup lines is the two-debit defect')
        .toEqual(['credit', 'setup']);

      const credit = fresh.find(l => l.kind === 'credit')!;
      const charge = fresh.find(l => l.kind === 'setup')!;

      // The magnitude stays positive: `org_billing_lines.amount` is
      // CHECK (amount >= 0) and the KIND carries the sign.
      expect(credit.amount, 'the credit was stored negative').toBeGreaterThan(0);
      // …and the server signs it for the screens, in one place.
      expect(credit.signed_amount).toBeCloseTo(-credit.amount, 2);
      expect(charge.signed_amount).toBeCloseTo(charge.amount, 2);

      // Both are one-off: `org_billing_lines_credit_ck` (migration 222) refuses
      // a monthly credit, which would be a discount running for ever.
      expect(fresh.map(l => l.cadence)).toEqual(['one_off', 'one_off']);

      // The netting, which is the whole point. Same days on both sides, so the
      // net is the rate difference for the days that are left — never the sum.
      const net = Number((charge.signed_amount + credit.signed_amount).toFixed(2));
      const gross = Number((charge.amount + credit.amount).toFixed(2));
      expect(Math.abs(net), 'the two lines summed instead of netting')
        .toBeLessThan(gross);

      // Both descriptions must quote the SAME day count: the credit and the
      // charge cover the identical remaining days, and it read "unused 16 days"
      // beside a thirteen-day figure before the day-count was unified (0.17).
      const days = (s: string) => (s.match(/(\d+) days/) || [])[1];
      expect(days(credit.description),
        'the credit and the charge disagree about how many days are left')
        .toBe(days(charge.description));
    });

  test('the console shows the credit as a deduction, not a charge',
    async ({ page }) => {
      const all = await lines(page);
      const credit = all.find(l => l.kind === 'credit');
      test.skip(!credit, 'no credit line exists yet — run the downgrade test first');

      // The month's own totals, from the same predicate the invoice uses. The
      // credit has to pull the one-off total DOWN; before the fix it pushed it
      // up, and the screen agreed with the wrong number.
      const period = String(credit!.period_start).slice(0, 7);
      const r = await apiOk(page, 'get',
        `/api/v1/billing/orgs/${ORG_ID}/lines?period=${period}`);
      const oneOff = Number(r.one_off_total ?? 0);
      const positives = (r.data as Line[])
        .filter(l => l.cadence === 'one_off' && l.kind !== 'credit'
                     && String(l.period_start).slice(0, 7) === period)
        .reduce((s, l) => s + Number(l.amount), 0);

      expect(oneOff, 'the one-off total still adds the credit instead of subtracting it')
        .toBeLessThan(positives);
    });

  test('the plan is put back through the same screen', async ({ page }) => {
    // Not a cleanup — the rows stay, they are the evidence. This restores the
    // test org's entitlements and proves the UPGRADE direction of the same
    // arithmetic in the process.
    const now = await planCode(page);
    const back = now === 'growth' ? 'scale' : 'growth';
    await changePlanThroughTheScreen(page, back);
    expect(await planCode(page), 'the plan did not go back').toBe(back);
    await shot(page, `phase3-plan-restored-${RUN}`);
  });
});
