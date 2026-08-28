/**
 * Proposal 93 · Stage 3 · WAVE 1 · SUITE 02 — org settings, on Unicode Group.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CREDENTIALS
 * ═══════════════════════════════════════════════════════════════════════════
 * Same blocker as Suite 01, recorded in full in `suite01-auth.spec.ts`: no
 * password exists for any of the five Unicode Group seats, and both stored
 * tokens expired 2026-08-27 (verified live — `GET /api/v1/org/members` with
 * `E2E_ADMIN_TOKEN` answers `401 Invalid or expired token`). Put
 * `E2E_UNICODE_EMAIL` / `E2E_UNICODE_PASSWORD` in `.env.e2e` to unblock.
 *
 * ⚠ Several tests here additionally need **org_owner**, not org_admin — see
 * 02.3. Of the five Unicode seats only `kevalvshah03@gmail.com` is the owner.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PRODUCT RULES THIS SUITE IS GUARDING
 * ═══════════════════════════════════════════════════════════════════════════
 * · **GSTIN / PAN / TAN are non-mandatory and must block nothing.** This has
 *   drifted back more than once, so 02.2 asserts it as its own test rather than
 *   as a line inside the happy path: saving with all three BLANK must succeed.
 * · **No UUID may be rendered in any UI.** The ratchet is
 *   `frontend/scripts/check-rendered-ids.mjs`, which is static. 02.7 is the
 *   runtime half — it reads the rendered text of every org-settings tab.
 * · **No native `<input type="date">` anywhere** — the product uses
 *   `components/ui/DateInput.jsx`. 02.7 asserts the absence structurally.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave1.config.ts --grep "Suite 02"
 */
import { test, expect, Page } from '@playwright/test';

const BLOCKED =
  'BLOCKED — no Unicode Group credential. See suite01-auth.spec.ts for the ' +
  'measurement. ENVIRONMENT blocker, not a product or test defect.';

type Creds = { email: string; password: string };

/**
 * THE LANE — announced, never assumed. Mirrors suite01-auth.spec.ts.
 *
 * §14 makes Unicode the reference lane. There is no Unicode credential on this
 * machine, and waiting for one stops the programme, so this falls back to E2E
 * Test & Associates — also wiped, also empty, and the org the dummy logins
 * actually hold seats in.
 *
 * ⚠ An E2E run is NOT a Unicode run. §14 compares the Unicode pass against the
 * UK replay, and a silent third org in the middle corrupts that comparison — so
 * the lane is printed on every run.
 */
type Lane = { creds: Creds; org: string; reference: boolean; token?: string };

function resolveLane(): Lane {
  // 1. Unicode with a password — the ideal: reference lane, real form login.
  const uniEmail = process.env.E2E_UNICODE_EMAIL;
  const uniPassword = process.env.E2E_UNICODE_PASSWORD;
  if (uniEmail && uniPassword) {
    return { creds: { email: uniEmail, password: uniPassword }, org: 'Unicode Group', reference: true };
  }

  // 2. Unicode by TOKEN — what the owner supplied on 2026-08-28. Still the
  //    reference lane, and every row is still typed; only the door is opened
  //    differently. See signIn() for exactly where that line sits.
  const uniToken = process.env.E2E_UNICODE_TOKEN || process.env.E2E_GODMODE_TOKEN;
  if (uniToken) {
    return {
      creds: { email: 'kevalvshah03@gmail.com', password: '' },
      org: 'Unicode Group',
      reference: true,
      token: uniToken,
    };
  }

  // 3. E2E by password — a fallback lane, and it announces itself as one.
  const email = process.env.E2E_APPROVER_EMAIL;
  const password = process.env.E2E_APPROVER_PASSWORD;
  if (!email || !password) throw new Error(BLOCKED);
  return { creds: { email, password }, org: 'E2E Test & Associates', reference: false };
}

const LANE = resolveLane();

test.beforeAll(() => {
  console.log(
    `\n  LANE: ${LANE.org}` +
    `${LANE.reference ? '  (reference lane, §14)' : '  ⚠ FALLBACK — NOT the reference lane'}` +
    `${LANE.token ? '  · door opened by TOKEN, rows still typed' : '  · real form login'}\n`,
  );
});

function requireUnicode(): Creds {
  return LANE.creds;
}

/**
 * Sign in — by the real form when there is a password, by the minted token when
 * there is not.
 *
 * ⚠ WHERE THE LINE IS, because this is the one place rule 1 can be eroded
 * without anyone noticing.
 *
 * Rule 1 governs how ROWS ARE CREATED: every row in this programme is typed by a
 * person into a real form. It does not govern how the browser is authenticated
 * in the first place — §2 says so directly of the bootstrap admin it insists on
 * keeping: "This is not a bypass of the 'driven as a user' rule — it is the
 * precondition for it." `mint-state.mjs` exists for exactly this, and the
 * repository's own bypass gate exempts it on the same reasoning.
 *
 * So: the token gets the browser through the door on the reference lane, where
 * the owner supplied a token and no password. EVERY ROW THIS SUITE CREATES IS
 * STILL TYPED AND CLICKED.
 *
 * ⚠ What the token must NEVER be used for is a test whose SUBJECT is the login
 * form. Suite 01's 01.1 and 01.3 assert the form and the rate limiter, and
 * proving those with an injected token would be circular — it would assert the
 * thing it bypassed. Those stay on a password account and say so.
 */
async function signIn(page: Page, creds: Creds) {
  if (creds.password) {
    await page.goto('/login');
    await expect(page.locator('#au-email')).toBeVisible({ timeout: 30_000 });
    await page.locator('#au-email').fill(creds.email);
    await page.locator('#au-password').fill(creds.password);
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
    return;
  }

  // Token bootstrap. `api.js` reads `localStorage.auth_token` as the bearer on
  // every request, so seeding it before the app boots is what a restored
  // storage state does — done inline here so the suite needs no setup project
  // (the setup project always fails on this owner: a token-only Google account).
  if (!LANE.token) throw new Error(BLOCKED);
  await page.goto('/login');
  await page.evaluate((t) => localStorage.setItem('auth_token', t), LANE.token);
  await page.goto('/dashboard');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
}

async function openTab(page: Page, tab: string) {
  await page.goto(`/settings/organisation${tab === 'profile' ? '' : `?tab=${tab}`}`);
  // ⚠ `level: 1`, and it is not tidiness. The bare
  // `getByRole('heading', { name: 'Organisation' })` was a TEST BUG: on the
  // danger tab it also matches `<h2 class="odz__t">Delete this organisation</h2>`
  // — a substring match on a second heading — and Playwright's strict mode
  // failed the whole test on the ambiguity. The page title is the `h1`, so that
  // is what this waits for.
  await expect(page.getByRole('heading', { name: 'Organisation', exact: true, level: 1 }))
    .toBeVisible({ timeout: 30_000 });
}

/** A stamp, so a re-run writes a value it can tell apart from the last one. */
const RUN = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

test.describe('Suite 02 — org settings · Unicode Group', () => {
  test('02.1 the company profile saves name, address and state', async ({ page }) => {
    await signIn(page, requireUnicode());
    await openTab(page, 'profile');

    // ⚠ WHAT THIS DOES *NOT* ASSERT, and why.
    // §3 asks for "name, address, state code". There is no state-CODE field on
    // this form: `TabProfile.jsx` renders `org-state` as free text beside
    // `org-city`, `org-pin` and `org-country`, and a grep for
    // `state_code` / `place_of_supply` across `frontend/src` finds it on client,
    // vendor and invoice forms — never on the org's own profile. So the GST
    // state code an Indian firm files under is not captured here at all. That
    // is a FINDING for the report, not something to fake with a lookalike
    // selector: asserting on `org-state` and calling it the state code is
    // exactly how a gap gets papered over by a green test.
    await expect(page.locator('#org-name')).toBeVisible({ timeout: 30_000 });

    await page.locator('#org-name').fill('Unicode Group');
    await page.locator('#org-l1').fill('4th Floor, Unicode House');
    await page.locator('#org-l2').fill(`Suite ${RUN.slice(-4)}`);
    await page.locator('#org-city').fill('Ahmedabad');
    await page.locator('#org-state').fill('Gujarat');
    await page.locator('#org-pin').fill('380015');
    await page.locator('#org-country').fill('India');

    await page.getByRole('button', { name: /Save company profile/ }).click();
    // ⚠ TEST BUG, fixed. The bare text matched TWO nodes — the sr-only
    // aria-live region AND the visible toast — and strict mode rightly refused.
    // Both existing is the product doing accessibility CORRECTLY: the
    // announcement and the visible confirmation are deliberately separate
    // nodes. Scoped to the toast, with the sr-only twin asserted on its own so
    // the fix does not quietly drop the a11y coverage it was tripping over.
    await expect(page.locator('.tst__t').getByText(/Company profile saved/i))
      .toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[aria-live="polite"]').getByText(/Company profile saved/i))
      .toHaveCount(1);

    // Saved means it survives a reload, not that a toast appeared. A toast is
    // the client's opinion; a reload is the server's.
    await page.reload();
    await expect(page.locator('#org-city')).toHaveValue('Ahmedabad', { timeout: 30_000 });
    await expect(page.locator('#org-state')).toHaveValue('Gujarat');
    await expect(page.locator('#org-l2')).toHaveValue(`Suite ${RUN.slice(-4)}`);
  });

  test('02.2 GSTIN, PAN and TAN block nothing — a blank save succeeds', async ({ page }) => {
    // THE regression this product keeps re-growing. Asserted on its own so a
    // failure here names itself instead of being one line inside 02.1.
    await signIn(page, requireUnicode());
    await openTab(page, 'profile');

    await expect(page.locator('#org-gstin')).toBeVisible({ timeout: 30_000 });
    await page.locator('#org-gstin').fill('');
    await page.locator('#org-pan').fill('');
    await page.locator('#org-tan').fill('');

    // The button must not be disabled by an empty tax field.
    const save = page.getByRole('button', { name: /Save company profile/ });
    await expect(save).toBeEnabled();
    await save.click();

    // It must SAVE — not warn, not block.
    // ⚠ TEST BUG, fixed. The bare text matched TWO nodes — the sr-only
    // aria-live region AND the visible toast — and strict mode rightly refused.
    // Both existing is the product doing accessibility CORRECTLY: the
    // announcement and the visible confirmation are deliberately separate
    // nodes. Scoped to the toast, with the sr-only twin asserted on its own so
    // the fix does not quietly drop the a11y coverage it was tripping over.
    await expect(page.locator('.tst__t').getByText(/Company profile saved/i))
      .toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[aria-live="polite"]').getByText(/Company profile saved/i))
      .toHaveCount(1);
    // And no field may be marked invalid for being empty.
    await expect(page.locator('#org-gstin')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#org-pan')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#org-tan')).not.toHaveAttribute('aria-invalid', 'true');

    await page.reload();
    await expect(page.locator('#org-gstin')).toHaveValue('', { timeout: 30_000 });
    await expect(page.locator('#org-pan')).toHaveValue('');
    await expect(page.locator('#org-tan')).toHaveValue('');
  });

  test('02.3 modules — what an org can actually switch on', async ({ page }) => {
    await signIn(page, requireUnicode());
    await openTab(page, 'modules');

    // ═══════════════════════════════════════════════════════════════════════
    // ⚠ THIS TEST DOES NOT ENABLE ANYTHING, AND THAT IS THE FINDING.
    //
    // §3 says "enable modules (the org currently has NONE active)". Read
    // against the code, there is no user-driven path that can do it:
    //
    //  1. `TabModules.jsx` renders EVERY card as `<ModuleCard … disabled />`
    //     with no `onToggle` at all. The grid reads and never writes. Its own
    //     comment says why: "`GET/PATCH /v1/org/modules` … has not been built".
    //
    //  2. That comment is now STALE. `backend/routers/org_modules.py` defines
    //     `@router.patch("")` and `server.py:5860` mounts it. The endpoint
    //     exists; the UI still says it does not and stays disabled. That gap is
    //     a product defect in its own right — the customer-facing screen tells
    //     them a capability is absent that has since shipped behind it.
    //
    //  3. Even with the UI wired, it would not help Unicode. `patch_modules`
    //     only ever UPDATEs: a code with no `module_subscriptions` row gets
    //     403 "not part of this organisation's subscription. Ask your account
    //     manager at Aekam to add it." Measured 2026-08-28, Unicode has ZERO
    //     rows in that table. Provisioning is Aekam platform staff's, through
    //     `POST /v1/subscription/modules/activate` or `admin_orgs.py`.
    //
    //  4. And the toggle is `org_owner` ONLY, never org_admin — deliberately,
    //     because `middleware/subscription.py:120-126` lets any org_admin reach
    //     every ACTIVE module with no grant row, so an org_admin who could also
    //     activate could hand themselves payroll in one request.
    //
    // So this test asserts the HONEST state — the grid is read-only and says so
    // — and the report carries the finding. Driving activation through the
    // platform console is a different actor in a different seat; it is not
    // Suite 02 and it must not be smuggled in here as an API call.
    // ═══════════════════════════════════════════════════════════════════════

    const cards = page.locator('.omod__c');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });

    // The screen must TELL the customer why they cannot switch anything on.
    await expect(
      page.getByText(/switched on by your\s+account manager at Aekam/i)
    ).toBeVisible();

    // Day-one truth, captured before anything is provisioned: nothing is on.
    await expect(page.locator('.omod__s.on')).toHaveCount(0);
    const n = await cards.count();
    const notOnPlan = await page.locator('.omod__s', { hasText: 'Not on your plan' }).count();
    console.log(`\n[suite02] module cards: ${n}, "Not on your plan": ${notOnPlan}, active: 0\n`);
    expect(notOnPlan).toBe(n);

    // Every toggle is genuinely inert — not merely styled as such.
    const toggles = page.locator('.omod__c input[type="checkbox"]');
    const t = await toggles.count();
    for (let i = 0; i < t; i += 1) {
      await expect(toggles.nth(i)).toBeDisabled();
    }
  });

  test('02.4 email sender addresses save', async ({ page }) => {
    await signIn(page, requireUnicode());
    await openTab(page, 'senders');

    // `staging.org_email_senders` EXISTS (verified live, 2026-08-28), so the
    // "nothing here can be saved yet" notice must NOT be on screen. If it is,
    // the meta endpoint is lying about the table and that is the finding.
    await expect(page.getByText(/Nothing here can be saved yet/i)).toHaveCount(0);

    const first = page.locator('input[id^="snd-"][id$="-email"]').first();
    await expect(first).toBeVisible({ timeout: 30_000 });
    await expect(first).toBeEnabled();

    const id = (await first.getAttribute('id'))!;
    const purpose = id.replace(/^snd-/, '').replace(/-email$/, '');
    // `test@unicodegroup.com` is the ONE deliverable Unicode address (IONOS
    // rejects plus tags — proven by probe 2026-08-28). It is safe as a FROM
    // address: this stores a sender, it does not send anything.
    await first.fill('test@unicodegroup.com');
    await page.locator(`#snd-${purpose}-name`).fill('Unicode Group');

    await page.getByRole('button', { name: /Save sender addresses/ }).click();
    await page.reload();
    await expect(first).toHaveValue('test@unicodegroup.com', { timeout: 30_000 });

    // Stored is not the same as in use, and the product must say so rather than
    // implying mail already goes out from this address.
    await expect(page.getByText(/Saved — not in use yet|In use/)).toBeVisible();
  });

  test('02.5 UPI is one ID PER PLATFORM, not one VPA field', async ({ page }) => {
    await signIn(page, requireUnicode());
    await openTab(page, 'upi');

    // The decision on record: a firm holds a Paytm, a PhonePe and a Google Pay
    // account, so this is three rows. A single `upi_id` box would be the
    // regression — and one still exists on the Profile tab (`#org-upi`), which
    // is noted in the report rather than asserted away here.
    for (const p of ['paytm', 'phonepe', 'gpay']) {
      await expect(page.locator(`#upi-${p}`)).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(`#upi-${p}-name`)).toBeVisible();
    }

    await page.locator('#upi-paytm').fill('unicodegroup@paytm');
    await page.locator('#upi-paytm-name').fill('Unicode Group');
    await page.locator('#upi-phonepe').fill('unicodegroup@ybl');
    await page.locator('#upi-phonepe-name').fill('Unicode Group');
    await page.locator('#upi-gpay').fill('unicodegroup@okhdfcbank');
    await page.locator('#upi-gpay-name').fill('Unicode Group');

    await page.getByRole('button', { name: /Save UPI IDs/ }).click();
    await page.reload();
    await expect(page.locator('#upi-paytm')).toHaveValue('unicodegroup@paytm', { timeout: 30_000 });
    await expect(page.locator('#upi-phonepe')).toHaveValue('unicodegroup@ybl');
    await expect(page.locator('#upi-gpay')).toHaveValue('unicodegroup@okhdfcbank');
  });

  test('02.6 document number series', async ({ page }) => {
    await signIn(page, requireUnicode());

    // ⚠ NOT under /settings/organisation. `TabDocNumbers` is imported by
    // `GanitPage.jsx` and mounted at `/ganit?tab=settings` — it is a Ganit
    // screen, and the org-settings tab bar has no entry for it. So this test is
    // GATED BY THE GANIT MODULE, which Unicode does not have (zero
    // `module_subscriptions` rows). Until Aekam provisions ganit this cannot
    // pass, and the honest outcome is a failure naming that, not a skip.
    await page.goto('/ganit?tab=settings');
    await page.waitForTimeout(3000);

    const body = ((await page.locator('body').innerText().catch(() => '')) || '');
    if (/is not active|Contact your administrator to activate/i.test(body)) {
      throw new Error(
        'BLOCKED BY ENTITLEMENT — document numbering lives at /ganit?tab=settings ' +
        'and the ganit module is not active on this org. Aekam platform staff must ' +
        'provision it first (staging.module_subscriptions has no row). Not a defect ' +
        'in the numbering screen.'
      );
    }

    await expect(page.getByText(/Document numbering/i)).toBeVisible({ timeout: 30_000 });
    // The warning that a prefix change starts a new series is not decoration —
    // it is the GST rule, and it must be on screen before anyone edits.
    await expect(page.getByText(/starts a new series at 0001/i)).toBeVisible();

    const box = page.locator('.gn-form__grid input.inp').first();
    await expect(box).toBeVisible();
    await box.fill('UNI');
    await page.getByRole('button', { name: /^Save \d+ change/ }).click();
    await page.reload();
    await expect(page.locator('.gn-form__grid input.inp').first())
      .toHaveValue('UNI', { timeout: 30_000 });
  });

  test('02.7 no UUID is rendered, and no native date input exists', async ({ page }) => {
    await signIn(page, requireUnicode());

    // The static ratchet is `frontend/scripts/check-rendered-ids.mjs`. This is
    // the runtime half: what the browser actually painted, on every tab of the
    // org hub, with real data behind it.
    const TABS = ['profile', 'members', 'billing', 'modules', 'compliance',
      'senders', 'upi', 'security', 'storage', 'danger'];
    const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

    const offenders: string[] = [];
    for (const tab of TABS) {
      await openTab(page, tab);
      await page.waitForTimeout(2000);

      const text = ((await page.locator('body').innerText().catch(() => '')) || '');
      const hit = text.match(UUID);
      if (hit) offenders.push(`${tab}: rendered UUID ${hit[0]}`);

      // No native date picker anywhere — the product uses DateInput.jsx, and a
      // native one is both a different keyboard contract and unstyleable.
      const native = await page.locator('input[type="date"]').count();
      if (native) offenders.push(`${tab}: ${native} native <input type="date">`);
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
