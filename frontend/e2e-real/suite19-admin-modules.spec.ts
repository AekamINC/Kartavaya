/**
 * Proposal 93 · SUITE 19 (slice) — module provisioning from the platform console.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS RUNS BEFORE WAVE 2, OUT OF §14's ORDER
 * ═══════════════════════════════════════════════════════════════════════════
 * Measured live 2026-08-28: **Unicode Group, UK AekamINC and E2E all hold ZERO
 * rows in `staging.module_subscriptions`.** Every module API therefore answers
 * `403 Module '<x>' is not active`, so Wave 2 (Manav, Graha) and everything
 * after it cannot run at all. §14 puts Suite 19 in wave 6; this one slice of it
 * has to come first or there is no wave 2.
 *
 * ⚠ AND IT CANNOT BE DONE BY THE CUSTOMER. Traced rather than assumed:
 *   · `TabModules.jsx` renders every card `disabled` — the grid reads, never writes.
 *   · `org_modules.patch_modules` only ever UPDATEs, so a code with no
 *     subscription row gets 403 "not part of this organisation's subscription".
 *   · The only INSERT is `admin_orgs.py:2630`, behind `require_platform_role`.
 * Provisioning is Aekam platform staff's job. That is not a defect — it is the
 * subscription model — but it does mean the only user who can do it is in god
 * mode, which is why this suite exists and why it is the ONLY place god mode
 * appears in the programme.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE GUARD — and it is NOT `assertOrg()`
 * ═══════════════════════════════════════════════════════════════════════════
 * Every other write suite calls `assertOrg()`, which asserts that the SESSION
 * resolves to the lane's org. That check is meaningless here and would fail by
 * design: a `platform_admin` session resolves to **Aekam Inc** via
 * `platform_bypass`. That is exactly what renamed Aekam Inc on 2026-08-28.
 *
 * So this suite guards the other end. A console write does not inherit its
 * target from the session — it NAMES the target in the URL
 * (`/v1/admin/orgs/<org_id>/modules/<code>`). The guard is therefore:
 *
 *   1. every write this suite makes must name the SUBJECT org, and
 *   2. no write may name Aekam Inc, ever.
 *
 * `assertNoAekamWrite()` enforces both from the wire, so a mis-click on the
 * wrong row in the org table fails the test instead of provisioning somebody
 * else's company. This is §12's SAFE tier expressed as a check rather than as
 * care: *"the console is fully exercised and Aekam is only the seat you sit in."*
 *
 * ⚠ The complete §12 fixture — every Aekam-scoped table counted before and
 * after, minus the five append-only telemetry tables — is a DATABASE
 * measurement and is taken around this run rather than inside it; a spec has no
 * business holding database credentials. Baseline 2026-08-28: **244 scoped
 * tables, 1,471 business rows, fingerprint `39c7d413219fe8593e83ba35abfb4785`.**
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave1.config.ts --grep "Suite 19"
 */
import { test, expect, Page } from '@playwright/test';
import { ORG as ORG_IDS } from './_lanes';

const API_BASE = process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app';

const GODMODE = process.env.E2E_GODMODE_TOKEN;

/**
 * The modules provisioned, and the one deliberately left off.
 *
 * `varta` (WhatsApp) is **excluded by decision**, not blocked — 93 §13. Leaving
 * it off is the honest expression of that: an org that has it switched on would
 * make `hub_publish_queue`'s emptiness look like a defect in six weeks' time.
 * §13 exists precisely so "we chose not to" and "we could not" never blur.
 */
const PROVISION = [
  'graha', 'vikray', 'prachar', 'sahayak', 'dristi',
  'sanvaad', 'esign', 'pahchan', 'ganit', 'manav', 'vetana', 'kray',
];
const EXCLUDED_BY_DECISION = ['varta'];

const SUBJECTS = [
  { name: 'Unicode Group', id: ORG_IDS.UNICODE },
  { name: 'UK AekamINC', id: ORG_IDS.UK },
];

type Wire = { method: string; status: number; path: string }[];

/**
 * Record every write, and refuse any that names Aekam Inc.
 *
 * This is the countermeasure the 2026-08-28 incident actually needed. A row
 * count could not catch that write — the save succeeded, so the suite went
 * green. Only asserting the TARGET could, and in god mode the target is in the
 * URL rather than in the session.
 */
function watchWrites(page: Page): Wire {
  const wire: Wire = [];
  page.on('response', (r) => {
    const req = r.request();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) return;
    if (!/\/api\//.test(r.url())) return;
    const path = new URL(r.url()).pathname;
    wire.push({ method: req.method(), status: r.status(), path });
    expect(
      path.includes(ORG_IDS.AEKAM),
      `\n  ⚠ REFUSING — this write names Aekam Inc:\n     ${req.method()} ${path}\n` +
        '     §12 guarantees that org is untouched. A platform session resolves\n' +
        '     to Aekam by default, so a console write must name its subject.\n',
    ).toBeFalsy();
  });
  return wire;
}

async function signInAsPlatform(page: Page) {
  expect(
    GODMODE,
    'BLOCKED — E2E_GODMODE_TOKEN is not set. Suite 19 is the ONE suite that ' +
      'uses a platform credential; every other suite is org-scoped by rule.',
  ).toBeTruthy();
  await page.goto('/login');
  await page.evaluate((t) => localStorage.setItem('auth_token', t!), GODMODE);
  await page.goto('/admin/orgs');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
}

/** What the platform console says an org has, read from the server. */
async function consoleModules(page: Page, orgId: string) {
  const res = await page.request.get(`${API_BASE}/api/v1/admin/orgs/${orgId}`, {
    headers: { Authorization: `Bearer ${GODMODE}` },
  });
  expect(res.ok(), `GET /admin/orgs/${orgId} -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  const mods = body?.modules ?? body?.data?.modules ?? [];
  return (Array.isArray(mods) ? mods : [])
    .filter((m: any) => m.is_active)
    .map((m: any) => m.module_code);
}

test.describe('Suite 19 — platform console · module provisioning', () => {
  /**
   * ⚠ A PLAN IS THE OTHER HALF, AND WITHOUT IT THE MODULES ARE INERT.
   *
   * Discovered after 19.2 had already switched 12 modules on for both orgs and
   * `GET /subscription/current` was happily reporting all twelve as
   * `active_modules` — while `GET /ganit/invoices` answered
   * **403 "Module 'ganit' is not active"**. Two paths disagreeing about one
   * fact, which is the shape this programme exists to catch.
   *
   * `middleware/subscription.py:699-712` settles it. `require_module` asks for
   * a `staging.subscriptions` row JOINed to `plans` FIRST, and refuses outright
   * when there is none — before it ever looks at `module_subscriptions`.
   * Measured live: Unicode, UK AekamINC and E2E all had **no subscription row
   * at all**. R4 deleted them with everything else, and nobody noticed because
   * until 19.2 ran there were no modules to reach either.
   *
   * So Wave 2 was still blocked after the modules went on. This runs first.
   *
   * ── WHY `scale`, AND NOT `growth` ──────────────────────────────────────────
   * Not a preference — `growth` would have broken Wave 2 at client sixteen.
   * Read out of `staging.plans.features` rather than guessed:
   *
   *     free      sahayak:false, no esign, no max_clients
   *     starter   sahayak:true,  no esign, max_clients 5
   *     growth    sahayak:true,  esign:true, max_clients 15
   *     scale     sahayak:true,  esign:true, max_clients 50
   *
   * §4 requires **25 clients per org**, so `growth`'s 15 is under the volume
   * this programme is sized for. And `BUNDLED_MODULES = {sahayak, esign}`
   * (`subscription.py:60`) are gated on the PLAN's `features`, never on
   * `module_subscriptions` — so on `free` or `starter` those two stay refused
   * however many times the console toggles them. `scale` is also what Aekam Inc
   * and Demo already run, which keeps the reference lane comparable.
   *
   * ⚠ **`free` is the one plan this must never pick.** The screen says why, in
   * its own words: *"Moving to Free deactivates every add-on module on this
   * organisation."* Selecting it would silently undo 19.2.
   */
  const PLAN = 'scale';

  for (const subject of SUBJECTS) {
    test(`19.0 ${subject.name} — a plan is set, because modules without one are inert`, async ({
      page,
    }) => {
      const wire = watchWrites(page);
      await signInAsPlatform(page);
      await page.goto('/admin/billing');

      // The console acts on ONE org at a time and says so in a sticky bar. Pick
      // the subject there — this is the same "which org am I acting on" question
      // that the 2026-08-28 incident got wrong, and here the product answers it
      // out loud rather than leaving it to the session.
      const scope = page.getByLabel('Organisation this page acts on');
      await expect(scope).toBeVisible({ timeout: 45_000 });
      await scope.selectOption(subject.id);
      await expect(page.locator('.osc__v')).toContainText(subject.name, { timeout: 30_000 });

      // ⚠ The plan card lives behind the **Plan** tab, and `Tabs` renders ONLY
      // the active tab's content — this file says so itself twice
      // (`AdminBillingPage.jsx:385`, `:717`), and it is why the first draft
      // failed on `#plan-code` "element(s) not found" while the scope bar above
      // resolved perfectly. A control that is not rendered is not a missing
      // control; it is a tab that was not opened.
      await page.getByRole('tab', { name: 'Plan', exact: true }).click();

      const planSelect = page.locator('#plan-code');
      await expect(planSelect).toBeVisible({ timeout: 30_000 });

      // Idempotent: the Apply button disables itself when the chosen plan is
      // already the current one, so a second run has nothing to press and the
      // read-back below still proves the state.
      await planSelect.selectOption(PLAN);
      const apply = page.getByRole('button', { name: /Apply to / });

      if (await apply.isEnabled()) {
        const [res] = await Promise.all([
          page.waitForResponse(
            (r) => r.url().includes('/subscription/admin/set-plan') &&
                   r.request().method() === 'POST',
            { timeout: 30_000 },
          ),
          apply.click(),
        ]);
        expect(res.status(), `POST set-plan -> ${res.status()}: ${await res.text()}`)
          .toBeLessThan(400);
        await expect(page.locator('.tst__t').getByText(`moved to ${PLAN}`)).toBeVisible({
          timeout: 20_000,
        });
      } else {
        console.log(`\n[19.0] ${subject.name} is already on ${PLAN} — nothing to apply\n`);
      }

      // ── The row is the evidence, and it is read from the ORG's OWN endpoint
      //    rather than from the console that just wrote it.
      //
      // ⚠ The first draft read `plan_code` off `GET /admin/orgs/{id}` and failed
      // with "is not on a plan after set-plan" — while the subscription row had
      // been written perfectly. That response carries NO plan field at all, so
      // the assertion was reading `undefined` and reporting it as the product's
      // fault. `GET /v1/subscription/current` is both correct and better: it is
      // what the CUSTOMER's own screens read, so it proves the thing that
      // actually matters — the org can now see its own subscription.
      const res = await page.request.get(`${API_BASE}/api/v1/subscription/current`, {
        headers: { Authorization: `Bearer ${GODMODE}`, 'X-Org-Id': subject.id },
      });
      expect(res.ok(), `GET /subscription/current -> ${res.status()}`).toBeTruthy();
      const body = await res.json();
      expect(
        body?.subscription?.status,
        `${subject.name} has no active subscription after set-plan — ` +
          'every module route will answer 403 at the SUBSCRIPTION stage, ' +
          'whatever module_subscriptions says (subscription.py:699-712)',
      ).toBe('active');

      // And the modules must still be there: `free` would have wiped them, and
      // this is the assertion that would catch a plan change that did.
      expect(
        (body?.active_modules ?? []).length,
        `${subject.name} lost its modules when the plan was applied — ` +
          'the screen warns that Free "deactivates every add-on module"',
      ).toBe(PROVISION.length);

      // Every write named the subject; none named Aekam.
      for (const w of wire.filter((x) => x.method !== 'GET')) {
        expect(
          w.path.includes(ORG_IDS.AEKAM),
          `a billing write named Aekam Inc: ${w.method} ${w.path}`,
        ).toBeFalsy();
      }
      console.log(
        `\n[19.0] ${subject.name}: subscription ${body?.subscription?.status}, ` +
          `${(body?.active_modules ?? []).length} modules still active\n`,
      );
    });
  }

  test('19.1 the customer genuinely cannot do this — the grid is inert by design', async ({
    page,
  }) => {
    // "Provisioning is Aekam's job" is the JUSTIFICATION for this whole suite
    // using god mode, so it is asserted rather than asserted-in-a-comment. If
    // the customer-facing grid ever becomes writable, this suite's premise is
    // void and it should be deleted rather than quietly kept.
    //
    // ⚠ THIS USED TO FIRE A REAL `PATCH /api/v1/org/modules` WITH AN ORG-SCOPED
    // TOKEN AND EXPECT A REFUSAL — and `check-e2e-no-bypass.mjs` flagged it,
    // rightly. Proposal 93 rule 1 is "nothing is posted straight to an API",
    // and the ratchet cannot tell a write that creates a row from one that is
    // expected to be refused. Teaching it that difference would be teaching it
    // to ignore things, and the gate was mine to break, not to weaken.
    //
    // So the assertion moved to the layer that owns it. Whether an endpoint
    // refuses a role is a property of the endpoint, not of a user journey:
    // `backend/tests/test_module_activation_is_owner_only.py` asserts that
    // `patch_modules` is gated on exactly `("org_owner",)` — proved to bite by
    // mutation, widening it to `ORG_SETTINGS_ROLES` turns it red naming the
    // escalation. What is left HERE is the half a browser can actually see.
    await page.goto('/login');
    await page.evaluate(
      (t) => localStorage.setItem('auth_token', t!),
      process.env.E2E_UNICODE_TOKEN,
    );
    await page.goto('/settings/organisation?tab=modules');

    const cards = page.locator('.omod__c');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });

    // ⚠ `role="switch"`, NOT `input[type=checkbox"]`. `ui/Toggle.jsx:22-26`
    // renders **a real `<button role="switch" aria-checked>`**, and its own
    // header explains why: "A real button that applies immediately, as distinct
    // from a checkbox committed by a Save."
    //
    // This matters more than a selector usually does. Suite 02's 02.3 asserted
    // `.omod__c input[type="checkbox"]` and looped `for (i < count)` asserting
    // each was disabled — against a locator that matches NOTHING. The loop ran
    // zero times and the test passed, every time, proving nothing. It was a
    // gate nobody had seen fail, which 93 §0 calls decoration; the count
    // assertion below is what turns it back into a check.
    const toggles = page.locator('.omod__c [role="switch"]');
    const n = await toggles.count();
    expect(n, 'the modules grid rendered no toggles at all').toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) {
      await expect(toggles.nth(i)).toBeDisabled();
    }

    // And it must say WHOSE decision it is, rather than leaving the customer to
    // guess why a control they can see does nothing.
    await expect(
      page.getByText(/switched on by your\s+account manager at Aekam/i),
    ).toBeVisible();
    console.log(`\n[19.1] ${n} module toggles, every one disabled, and the screen says why\n`);
  });

  for (const subject of SUBJECTS) {
    test(`19.2 ${subject.name} — modules switched on from the console, and Aekam untouched`, async ({
      page,
    }) => {
      const wire = watchWrites(page);
      await signInAsPlatform(page);

      // Open the org by NAME from the real table, the way platform staff do.
      // ⚠ Scoped to the table: the org name also appears in the page chrome,
      // and an unscoped match resolves in DOM order (suite rule 6).
      const row = page.locator('tbody tr').filter({ hasText: subject.name }).first();
      await expect(row, `${subject.name} is not in the console org table`).toBeVisible({
        timeout: 45_000,
      });
      await row.click();

      // The panel is open when its Modules section is on screen.
      await expect(page.getByRole('heading', { name: 'Modules', exact: true })).toBeVisible({
        timeout: 30_000,
      });

      const before = await consoleModules(page, subject.id);
      const turnedOn: string[] = [];

      for (const code of PROVISION) {
        // Located by the console's own LABEL, because the module code is not
        // rendered anywhere in the DOM. `aria-pressed` is then the product's
        // own statement of the toggle state — asserting on a CSS class would be
        // asserting on styling rather than on meaning.
        const label = MODULE_LABEL[code];
        const toggle = page.locator('.adm-mod').filter({ hasText: label }).first();
        await expect(toggle, `no console toggle for ${code} (${label})`).toBeVisible({
          timeout: 15_000,
        });

        if ((await toggle.getAttribute('aria-pressed')) === 'true') continue; // idempotent

        const [res] = await Promise.all([
          page.waitForResponse(
            (r) =>
              r.url().includes(`/modules/${code}`) && r.request().method() === 'POST',
            { timeout: 30_000 },
          ),
          toggle.click(),
        ]);
        expect(res.status(), `POST module ${code} -> ${res.status()}`).toBeLessThan(400);
        // The button must SAY it is on afterwards, not merely have been clicked.
        await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
        turnedOn.push(code);
      }

      // ── The row is the evidence, read back from the server ────────────────
      const after = await consoleModules(page, subject.id);
      for (const code of PROVISION) {
        expect(after, `${code} is not active on ${subject.name} after provisioning`).toContain(
          code,
        );
      }
      for (const code of EXCLUDED_BY_DECISION) {
        expect(
          after,
          `${code} is EXCLUDED BY DECISION (§13) and must not have been switched on`,
        ).not.toContain(code);
      }

      // Every write named the subject; none named Aekam (watchWrites asserts
      // the second continuously, this proves the first).
      const writes = wire.filter((w) => w.path.includes('/modules/'));
      for (const w of writes) {
        expect(w.path, `a module write did not name ${subject.name}`).toContain(subject.id);
      }

      console.log(
        `\n[19.2] ${subject.name}: ${before.length} active before -> ${after.length} after` +
          ` (${turnedOn.length} switched on this run: ${turnedOn.join(', ') || 'none'})` +
          `\n[19.2] ${writes.length} console writes, every one naming ${subject.id}, none naming Aekam\n`,
      );
    });
  }
});

/** The console's own labels — the module CODE is not rendered anywhere. */
const MODULE_LABEL: Record<string, string> = {
  graha: 'Graha · CRM',
  vikray: 'Vikray · Sales',
  prachar: 'Prachar · Marketing',
  sahayak: 'Sahayak · AI',
  dristi: 'Dristi · Analytics',
  sanvaad: 'Sanvaad · Messaging',
  varta: 'Varta · WhatsApp',
  esign: 'eSign',
  pahchan: 'Pahchan · Attendance',
  ganit: 'Ganit · Invoicing',
  manav: 'Manav · HRMS',
  vetana: 'Vetana · Payroll',
  kray: 'Kray · Procurement',
};
