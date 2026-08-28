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
  test('19.1 the customer genuinely cannot do this — the grid is inert by design', async ({
    page,
  }) => {
    // Recorded here rather than only in a comment, because "provisioning is
    // Aekam's job" is the JUSTIFICATION for this whole suite using god mode.
    // If the customer-facing grid ever becomes writable, this suite's premise
    // is void and it should be deleted rather than quietly kept.
    const res = await page.request.patch(`${API_BASE}/api/v1/org/modules`, {
      headers: { Authorization: `Bearer ${process.env.E2E_UNICODE_TOKEN ?? ''}` },
      data: { modules: [{ module_code: 'graha', is_active: true }] },
    });
    expect(
      res.status(),
      'an ORG-SCOPED credential must not be able to activate a module — if this ' +
        'starts succeeding, an org_admin can hand themselves payroll in one request',
    ).toBeGreaterThanOrEqual(400);
    console.log(`\n[19.1] org-scoped PATCH /org/modules -> ${res.status()} (refused, as designed)\n`);
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
