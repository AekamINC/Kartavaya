/**
 * Proposal 93 · Stage 3 · WAVE 1 · SUITE 02b — the two org-settings screens
 * §10 lists and `suite02-org-settings.spec.ts` does not yet cover:
 *
 *   02.16  Compliance — the firm ticks what applies to it, it PERSISTS, and it
 *          TAKES EFFECT on the document check that reads it.
 *   02.17  Support access — the platform-support session lifecycle, driven from
 *          the CUSTOMER's side: approve (with a shortened clock), then revoke.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A SEPARATE FILE FROM suite02-org-settings.spec.ts
 * ═══════════════════════════════════════════════════════════════════════════
 * Two other agents were appending to that file at the same time this was
 * written. The conventions below — `resolveLane`, `signIn`, `signInAs` +
 * `assertOrg`, `openTab`, `watchWire`, `dump`, `API_BASE` — are COPIED from it
 * deliberately rather than imported, because a spec file that imports another
 * spec file makes Playwright run the imported one's tests twice. Tests 02.8–
 * 02.11 there are the model these two imitate.
 *
 * ⚠ If the two files are ever merged, the duplicated helpers go and these two
 * tests keep their numbers. The numbers are how the report refers to them.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CREDENTIALS AND THE LANE — the same rules, not a reduced variant
 * ═══════════════════════════════════════════════════════════════════════════
 * The lane is **Unicode Group** (`fae87907-…`), opened with `E2E_UNICODE_TOKEN`.
 * `assertOrg()` from `./_lanes` is called inside `signInAs()`, which is the only
 * way into this file — a test cannot reach a control without passing it. That
 * guard exists because Suite 02 once renamed **Aekam Inc** while printing
 * "LANE: Unicode Group" to the run log, and it has twice been found not running.
 *
 * There is NO `E2E_GODMODE_TOKEN` fallback here, and its absence is deliberate:
 * `_lanes.ts` rule 1 is that a write suite never uses a platform credential.
 * That bites hardest in 02.17, where the OTHER half of the flow — an Aekam
 * `platform_support` account raising the request — is genuinely out of reach
 * from this lane. 02.17 drives the customer's half and BLOCKS loudly rather
 * than reaching for god mode to manufacture its own precondition.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHERE THESE TWO SCREENS ACTUALLY LIVE — and one of them is not where §10 says
 * ═══════════════════════════════════════════════════════════════════════════
 * · Compliance      `/settings/organisation?tab=compliance`
 *                   `OrgSettingsPage.jsx:150` registers it as a tab.
 * · Support access  `/settings/roles`  ← **NOT an org-settings tab.**
 *                   `TabSupportAccess` is mounted by `RolesAccessPage.jsx:85`,
 *                   under the roster, and `App.jsx:276` routes it. There is no
 *                   `?tab=support` and 02.7's ten-tab sweep does not touch it.
 *                   A test that looked for it on the Organisation page would
 *                   report the screen missing when it is merely elsewhere.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave1.config.ts --grep "Suite 02b"
 */
import { test, expect, Page } from '@playwright/test';
import { ORG as ORG_IDS, assertOrg, type Lane as OrgLane } from './_lanes';

const BLOCKED =
  'BLOCKED — no Unicode Group credential. Set E2E_UNICODE_TOKEN (or ' +
  'E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e at the repo root. ⚠ It must be an ' +
  'ORG-SCOPED account: a platform_admin token resolves to Aekam Inc via ' +
  'platform_bypass and will write there. ENVIRONMENT blocker, not a product ' +
  'or test defect.';

const API_BASE = process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app';

type Creds = { email: string; password: string };
type Lane = { creds: Creds; org: string; orgId: string; reference: boolean; token?: string };

/** Mirrors `suite02-org-settings.spec.ts::resolveLane` exactly. See its header. */
function resolveLane(): Lane {
  const uniEmail = process.env.E2E_UNICODE_EMAIL;
  const uniPassword = process.env.E2E_UNICODE_PASSWORD;
  if (uniEmail && uniPassword) {
    return {
      creds: { email: uniEmail, password: uniPassword },
      org: 'Unicode Group', orgId: ORG_IDS.UNICODE, reference: true,
    };
  }
  const uniToken = process.env.E2E_UNICODE_TOKEN;
  if (uniToken) {
    return {
      creds: { email: 'kevalvshah03+1@gmail.com', password: '' },
      org: 'Unicode Group', orgId: ORG_IDS.UNICODE, reference: true, token: uniToken,
    };
  }
  const email = process.env.E2E_APPROVER_EMAIL;
  const password = process.env.E2E_APPROVER_PASSWORD;
  if (!email || !password) throw new Error(BLOCKED);
  return {
    creds: { email, password },
    org: 'E2E Test & Associates', orgId: ORG_IDS.E2E, reference: false,
  };
}

const LANE = resolveLane();

test.beforeAll(() => {
  console.log(
    `\n  LANE: ${LANE.org}` +
    `${LANE.reference ? '  (reference lane, §14)' : '  ⚠ FALLBACK — NOT the reference lane'}` +
    `${LANE.token ? '  · door opened by TOKEN, rows still typed' : '  · real form login'}\n`,
  );
});

/**
 * The token gets the browser through the door; every row below is still typed
 * and clicked. See suite02's `signIn` header for exactly where that line sits —
 * §2 calls the bootstrap "the precondition for [driving as a user], not a
 * bypass of it", and `check-e2e-no-bypass.mjs` draws the same line.
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
  if (!LANE.token) throw new Error(BLOCKED);
  await page.goto('/login');
  await page.evaluate((t) => localStorage.setItem('auth_token', t), LANE.token);
  // ⚠ /dashboard, and it is load-bearing beyond "somewhere to land".
  // `components/layout/Protected.jsx:147` is what writes `Kartavaya_user` into
  // localStorage from `GET /auth/me`, and BOTH screens under test read it:
  // `RolesAccessPage.jsx:61` gates the whole page on `user.org_roles`, and
  // `TabSupportAccess.jsx:106` needs `me.user_id` to decide self-approval. A
  // token seeded without ever passing through a Protected route leaves
  // `currentUser()` null, and `/settings/roles` then renders the DENIED
  // ErrorState — which reads exactly like "this admin has lost their role".
  await page.goto('/dashboard');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
}

/** Sign in, then REFUSE TO CONTINUE unless the session resolved to this lane's org. */
async function signInAs(page: Page, creds: Creds) {
  await signIn(page, creds);
  await assertOrg(page.request, page, {
    key: LANE.reference ? 'unicode' : 'e2e',
    org: LANE.org,
    orgId: LANE.orgId,
    reference: LANE.reference,
  } as OrgLane);
}

/** THE WIRE — every write, with the status the server answered. See suite02. */
type Wire = { line: string }[];

function watchWire(page: Page): Wire {
  const wire: Wire = [];
  page.on('response', async (r) => {
    const req = r.request();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) return;
    if (!/\/api\//.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 300); } catch { /* body already consumed */ }
    wire.push({ line: `${req.method()} ${r.status()} ${new URL(r.url()).pathname}  ${body}` });
  });
  return wire;
}

const dump = (wire: Wire) =>
  wire.length
    ? wire.map((w) => '\n     ' + w.line).join('')
    : '\n     (no write request was made at all)';

/** The Organisation hub, on a named tab. Copied from suite02 — `level: 1` is why. */
async function openTab(page: Page, tab: string) {
  await page.goto(`/settings/organisation${tab === 'profile' ? '' : `?tab=${tab}`}`);
  await expect(page.getByRole('heading', { name: 'Organisation', exact: true, level: 1 }))
    .toBeVisible({ timeout: 30_000 });
}

/**
 * Click something and WAIT FOR THE WRITE TO ANSWER before reading anything back.
 *
 * Suite 02 lost three tests on 2026-08-28 to a `page.reload()` on the line after
 * a Save: the reload raced the request, the value read back empty, and the suite
 * reported "the product did not save it" when the product had. Returns the
 * response, so assertions are on the SERVER's status rather than on a toast —
 * a toast is the client's opinion.
 */
async function clickAndWait(
  page: Page,
  click: () => Promise<void>,
  match: (url: URL, method: string) => boolean,
) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => match(new URL(r.url()), r.request().method()), { timeout: 30_000 }),
    click(),
  ]);
  return res;
}

/** The bearer this browser is holding, for the read-back probes. */
async function bearer(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * A READ, never a write. The screen is the claim; the server's row is the fact.
 * `check-e2e-no-bypass.mjs` allows `page.request.get` for exactly this and bans
 * every write verb — a row this suite creates is created by a click or not at all.
 */
async function getJson(page: Page, path: string) {
  const res = await page.request.get(`${API_BASE}${path}`, { headers: await bearer(page) });
  return { ok: res.ok(), status: res.status(), body: await res.json().catch(() => null as any) };
}

/** A stamp, so a re-run writes something it can tell apart from the last one. */
const RUN = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

/**
 * Two id shapes that must never reach a screen, and they are NOT the same regex.
 *
 * `organisations.id` is a UUID. `public.users.user_id` is TEXT and looks like
 * `user_f1a0a472b98f` (`routers/compliance_settings.py:18`) — a UUID matcher
 * does not catch it, which is precisely how a member id can sit on a screen
 * while a UUID sweep reports clean. `check-rendered-ids.mjs` is the static
 * ratchet; these are the runtime half.
 */
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const USER_ID_RE = /\buser_[0-9a-f]{12}\b/i;

test.describe('Suite 02b — compliance & support access · Unicode Group', () => {
  /* ═══════════════════════════════════════════════════════════════════════
   * 02.16 · COMPLIANCE
   *
   * ── What this screen IS, in the product's own words ──────────────────────
   * `TabCompliance.jsx:26` states the rule the whole panel is built around:
   * never a control that makes a compliance CLAIM. It records the FIRM's
   * position — "we are a composition dealer, so GST does not apply" — with a
   * name and a date against it. It does not assess anything, because Kartavaya
   * cannot see a firm's registrations, filings or returns.
   *
   * So the three things worth asserting are, in order:
   *   1. the panel tells the truth about what it is (the honesty furniture);
   *   2. a decision PERSISTS — survives a reload and agrees with the server;
   *   3. a decision TAKES EFFECT where something reads it.
   *
   * ── (3) is the half a screen test usually cannot reach, and here it can ──
   * `services/compliance_settings.py:125,133` name the ONLY two rules any code
   * reads: `ganit.gstin_required` and `ganit.hsn_required`, both read by
   * `services/doc_validation.py:validate_tax_invoice`. Every other rule in the
   * registry — the four remaining Ganit ones and all five Vetana ones — is
   * `enforced_at=None`, i.e. RECORDED ONLY, and the screen says so in as many
   * words rather than implying a switch.
   *
   * `routers/ganit.py:960-968` runs that validator on `GET /ganit/invoices/{id}`
   * and returns the gaps as `document_check`, resolving the org's compliance
   * states first. That endpoint is a READ. So the effect of a setting a person
   * changed on this screen is observable, without writing an invoice, without
   * SQL, and without leaving rule 1 — which is why 02.16 asserts on a WIRED
   * rule rather than on one of the nine that change nothing.
   *
   * ── Idempotence (§6) ─────────────────────────────────────────────────────
   * The starting state is READ, never assumed, and the test drives
   * baseline → other → baseline. 02.10 learned this the hard way: a toggle that
   * assumes its starting point is idempotent from exactly one starting point,
   * and a run that dies mid-way leaves the next one facing a state its first
   * click is a no-op against (`Seg`'s `onChange` returns early when the value is
   * unchanged, so the PATCH never fires and the wait times out reading like a
   * broken product).
   *
   * The DECISION HISTORY is deliberately not restored and cannot be: the table
   * is an upsert and the audit log is append-only, which is the entire point of
   * proposal 80's rule 1. The reason strings this test writes name themselves.
   * ═══════════════════════════════════════════════════════════════════════ */

  /** The rule this test drives. WIRED, so "takes effect" is a real assertion. */
  const RULE = {
    module: 'ganit',
    key: 'hsn_required',
    /** `RULES['ganit']['hsn_required'].label` — asserted, never guessed. */
    label: 'HSN/SAC code on every line',
    /** `Gap.field` for it — `doc_validation.py:305`. */
    gapField: 'invoice.line_items.hsn_code',
  };

  /** A RECORDED-ONLY rule, for the two-state half. `vetana.pf_applicable`. */
  const RECORDED_ONLY_LABEL = 'Provident fund (EPF)';

  /** `STATE_META` labels, `TabCompliance.jsx:77-99`. Read off the source. */
  const STATE_LABEL: Record<string, string> = {
    not_applicable: 'Not applicable',
    applicable: 'Applicable',
    enforced: 'Enforced',
  };

  /** The compliance panel the SERVER holds, read fresh. */
  async function compliance(page: Page) {
    const r = await getJson(page, '/api/v1/org/compliance');
    expect(r.ok, `GET /org/compliance -> ${r.status}`).toBeTruthy();
    return r.body as {
      default_state: string;
      modules: { module: string; active: boolean; rules: Record<string, any> }[];
    };
  }

  /**
   * Which of this org's tax invoices are currently REPORTING the HSN gap.
   *
   * The gap appears on `document_check` only when a line has neither an HSN nor
   * a SAC code AND the rule is not `not_applicable` (`doc_validation.py:290`).
   * So the SET of invoices carrying it is a direct, read-only readout of the
   * setting — which is what makes "takes effect" assertable from here.
   *
   * Capped at eight, and the cap is REPORTED rather than silent: a quiet cap
   * reads as full coverage.
   */
  async function invoicesReportingGap(page: Page, field: string, cap = 8) {
    const list = await getJson(page, '/api/v1/ganit/invoices?invoice_type=tax_invoice');
    expect(list.ok, `GET /ganit/invoices -> ${list.status} (ganit must be active on this org)`)
      .toBeTruthy();
    const rows: any[] = Array.isArray(list.body) ? list.body : (list.body?.data ?? []);
    const looked = rows.slice(0, cap);
    const hit: string[] = [];
    for (const inv of looked) {
      const one = await getJson(page, `/api/v1/ganit/invoices/${inv.id}`);
      if (!one.ok) continue;
      const chk = one.body?.document_check || {};
      const gaps = [...(chk.blocking || []), ...(chk.advisory || [])];
      if (gaps.some((g: any) => g?.field === field)) hit.push(inv.invoice_number || inv.id);
    }
    return { hit, looked: looked.length, total: rows.length };
  }

  /**
   * Drive one rule from whatever it is now to `next`, through the real control
   * and the real dialog, and return the PATCH response.
   *
   * Every change on this screen goes through the dialog — including a change
   * BACK to the default, because "not applicable is a decision, not an absence"
   * and so is reversing one (`TabCompliance.jsx:55`).
   */
  async function recordState(page: Page, label: string, next: string, reason: string) {
    const row = page.locator('.cmpl__rule').filter({ hasText: label });
    await expect(row, `no compliance row is labelled "${label}"`).toBeVisible({ timeout: 30_000 });

    // ⚠ `exact: true` on the option, and it is not tidiness. `getByRole` matches
    // the accessible name case-insensitively AND as a SUBSTRING by default, so
    // a bare name of 'Applicable' also matches "Not applicable" and strict mode
    // fails the test on the ambiguity — or worse, resolves to the wrong option.
    const option = row.getByRole('radio', { name: STATE_LABEL[next], exact: true });
    await expect(option, `the "${STATE_LABEL[next]}" state is not offered on "${label}"`)
      .toBeVisible();
    await option.click();

    // `Modal` stamps `data-testid` from `dataTestId="compliance-confirm"`
    // (`TabCompliance.jsx:503`, `ui/modal.jsx:69`).
    const dialog = page.locator('[data-testid="compliance-confirm"]');
    await expect(dialog, 'every change must go through the confirmation dialog')
      .toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(STATE_LABEL[next], { exact: false }).first()).toBeVisible();

    // Real keystrokes. `fill()` sets a value without firing key events and a
    // controlled input can miss it entirely — the fault behind 02.2's false
    // accusation that "a firm cannot remove its GSTIN". The box is pre-filled
    // with the reason already on the row, so it is cleared first.
    const box = page.locator('#cmpl-reason');
    await expect(box).toBeVisible();
    await box.click();
    await box.press('ControlOrMeta+a');
    await box.press('Delete');
    await box.pressSequentially(reason, { delay: 8 });
    await expect(box).toHaveValue(reason);

    return clickAndWait(
      page,
      async () => {
        await dialog.getByRole('button', { name: `Record as ${STATE_LABEL[next]}` }).click();
      },
      (url, method) => method === 'PATCH' && url.pathname.endsWith('/org/compliance/ganit'),
    );
  }

  test('02.16 compliance — a firm records its position, it persists, and the document check obeys it', async ({
    page,
  }) => {
    const wire = watchWire(page);
    await signInAs(page, LANE.creds);

    // ── The server's view first, so the screen can be checked AGAINST it ────
    const before = await compliance(page);
    const baseline = before.modules
      .find((m) => m.module === RULE.module)?.rules?.[RULE.key];
    expect(
      baseline,
      `${RULE.module}.${RULE.key} is not in GET /org/compliance — the registry ` +
      `(services/compliance_settings.py:129) says it must be`,
    ).toBeTruthy();

    const START: string = baseline.state;
    // Away from the start, and BACK. Never a fixed direction: a run that died
    // half-way leaves the next one starting somewhere else (§6, and 02.10's scar).
    const OTHER = START === 'not_applicable' ? 'applicable' : 'not_applicable';

    await openTab(page, 'compliance');

    // ── 1 · THE HONESTY FURNITURE ──────────────────────────────────────────
    // This panel's whole subject is that the product does not judge compliance.
    // If these sentences ever go, the screen has started making a claim on the
    // customer's behalf — which is the one thing PHASE-4 §4.1 forbids it.
    await expect(page.getByRole('heading', { name: 'What applies to your firm' }))
      .toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText('These settings record your firm’s own position.'),
      'the disclaimer that this is a record and not an assessment is gone',
    ).toBeVisible();
    await expect(page.getByText('No government requirement is mandatory in Kartavaya')).toBeVisible();

    // The three-state legend, and the DEFAULT is named by the server rather
    // than hardcoded here — `get_all_settings` ships `default_state` precisely
    // so the screen does not become a second source of truth for it.
    for (const s of ['not_applicable', 'applicable', 'enforced']) {
      await expect(page.locator('.cmpl__leg').filter({ hasText: STATE_LABEL[s] }).first())
        .toBeVisible();
    }
    expect(before.default_state, 'the product default is `applicable` — nothing arrives enforced')
      .toBe('applicable');
    await expect(
      page.locator('.cmpl__leg').filter({ hasText: STATE_LABEL[before.default_state] })
        .getByText('Default'),
    ).toBeVisible();

    // ── 2 · THE GRID AGREES WITH THE SUBSCRIPTION ──────────────────────────
    // `active` ANNOTATES and never filters (`compliance_settings.py:96`): a firm
    // that recorded a position and later switched the module off must still be
    // able to reach and correct it. Modules were provisioned for Unicode on
    // 2026-08-28, so both sections should be un-tagged today — but this asserts
    // AGAINST THE SERVER rather than against that fact, because the fact will
    // change and the agreement must not.
    for (const m of before.modules) {
      const heading = page.locator('.st__gt').filter({ hasText: m.module === 'ganit' ? 'Ganit' : 'Vetana' });
      await expect(heading, `no section for module "${m.module}"`).toBeVisible();
      const tag = heading.getByText('Not switched on');
      if (m.active) {
        await expect(tag, `${m.module} is active on the server but the screen calls it off`)
          .toHaveCount(0);
      } else {
        await expect(tag, `${m.module} is INACTIVE on the server and the screen does not say so`)
          .toHaveCount(1);
      }
    }

    // ── 3 · A RECORDED-ONLY RULE OFFERS TWO STATES, AND SAYS WHY ───────────
    // "Enforced" means the firm asked to be STOPPED. Offering it where nothing
    // can stop anything is a guardrail that is not there, agreed to in writing
    // by the customer — `compliance_settings.py`'s docstring calls that the
    // promise the whole registry exists to prevent. The API refuses it too
    // (`set_rule`); this is the screen half.
    const recorded = page.locator('.cmpl__rule').filter({ hasText: RECORDED_ONLY_LABEL });
    await expect(recorded, `no row is labelled "${RECORDED_ONLY_LABEL}"`).toBeVisible();
    await expect(recorded.getByRole('radio')).toHaveCount(2);
    await expect(recorded.getByRole('radio', { name: 'Enforced', exact: true })).toHaveCount(0);
    await expect(recorded.getByText('Recorded only')).toBeVisible();
    await expect(
      recorded.getByText('Kartavaya does not read this yet'),
      'a rule nothing reads must say so beside the control, not only in a tooltip',
    ).toBeVisible();

    // ...and the WIRED rule offers all three, so the two cases are told apart
    // by the product rather than by this test's opinion of the registry.
    const wired = page.locator('.cmpl__rule').filter({ hasText: RULE.label });
    await expect(wired).toBeVisible();
    await expect(
      wired.getByRole('radio'),
      `${RULE.key} is wired to doc_validation and must offer all three states`,
    ).toHaveCount(3);
    await expect(wired.getByText('Recorded only')).toHaveCount(0);
    // The CONSEQUENCE is shown at every state, not only at the one it describes
    // — a firm choosing needs to know what riding on the default costs BEFORE
    // it chooses (`TabCompliance.jsx:170`).
    await expect(wired.locator('.cmpl__why')).not.toHaveText('');

    // ── 4 · THE BASELINE READOUT OF THE EFFECT, BEFORE ANYTHING CHANGES ────
    const gapBefore = await invoicesReportingGap(page, RULE.gapField);
    console.log(
      `\n[02.16] ${RULE.key} starts at "${START}". ` +
      `${gapBefore.hit.length} of the ${gapBefore.looked} tax invoice(s) examined ` +
      `(of ${gapBefore.total} on the org) report the ${RULE.gapField} gap: ` +
      `${gapBefore.hit.join(', ') || 'none'}\n`,
    );

    // ── 5 · RECORD THE DECISION, THROUGH THE REAL CONTROL AND DIALOG ───────
    const reason = `Suite 02.16 probe ${RUN} — recorded as ${STATE_LABEL[OTHER]}`;
    const res = await recordState(page, RULE.label, OTHER, reason);
    expect(
      res.status(),
      `recording ${RULE.key} as ${OTHER} answered ${res.status()}.${dump(wire)}`,
    ).toBeLessThan(400);

    // The consequence, where the customer sees it. `.tst__t` is the toast TITLE
    // and `.tst__s` is the MESSAGE (`ui/toast.jsx:328-329`) — 02.2b was a test
    // bug for reading that pair the wrong way round, and it failed reading as
    // "the product does not warn".
    await expect(page.locator('.tst__t').getByText(`${RULE.label} recorded as ${STATE_LABEL[OTHER]}`))
      .toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator('.tst__s').getByText('Your name and the date are stored with it'),
      'the product must say the decision is ATTRIBUTED — that attribution is the deliverable',
    ).toBeVisible();

    // ── 6 · PROVENANCE — three outcomes, not two ───────────────────────────
    // `has_setter` false is "nobody has touched this and it runs on the
    // default"; true with no name is "a person decided this and their account
    // is gone". Collapsing them throws away the difference between nothing
    // having been decided and us no longer being able to say who decided it.
    // Having just recorded it, this row must be in neither of those states.
    await expect(
      wired.locator('.cmpl__meta--none'),
      'the row still says nobody has set this, immediately after somebody did',
    ).toHaveCount(0);
    await expect(wired.locator('.cmpl__meta').getByText('Set by')).toBeVisible();
    await expect(wired.locator('.cmpl__reason')).toContainText(reason);
    // A name, never an id — the standing rule, asserted on the one line of this
    // screen that renders a person.
    const meta = (await wired.locator('.cmpl__meta').innerText()) || '';
    expect(meta, `a user id reached the provenance line: ${meta}`).not.toMatch(USER_ID_RE);
    expect(meta, `a UUID reached the provenance line: ${meta}`).not.toMatch(UUID_RE);

    // ── 7 · IT PERSISTS — the reload is the server's opinion, not the toast's ──
    await page.reload();
    const rowAfter = page.locator('.cmpl__rule').filter({ hasText: RULE.label });
    await expect(
      rowAfter.getByRole('radio', { name: STATE_LABEL[OTHER], exact: true }),
    ).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
    // A row away from the default is marked as such — `cmpl__rule--off` is how
    // a firm spots its own decisions in a long panel.
    if (OTHER !== before.default_state) {
      await expect(rowAfter).toHaveClass(/cmpl__rule--off/);
    }

    // ...and the row is the fact, not the screen's opinion of it.
    const mid = await compliance(page);
    const stored = mid.modules.find((m) => m.module === RULE.module)!.rules[RULE.key];
    expect(stored.state, `the screen shows ${OTHER}; the server must agree`).toBe(OTHER);
    expect(stored.has_setter, 'the stored row must carry a setter').toBe(true);
    expect(stored.reason, 'the reason typed into the dialog must be on the row').toBe(reason);
    expect(
      JSON.stringify(stored),
      'the payload still carries a raw `set_by` id — the router is supposed to ' +
      'REMOVE it, not ship it alongside the name (compliance_settings.py:77)',
    ).not.toMatch(USER_ID_RE);

    // ── 8 · IT TAKES EFFECT ────────────────────────────────────────────────
    // The whole difference between a stored setting and a working one. The gap
    // set is a read-only readout of the resolved state through
    // `validate_tax_invoice`, so the direction of the change is assertable both
    // ways round — which is what makes this idempotent from either start.
    const gapAfter = await invoicesReportingGap(page, RULE.gapField);
    const na = (s: string) => s === 'not_applicable';

    if (na(OTHER) && gapBefore.hit.length > 0) {
      // The firm said the rule does not apply. The gap must DISAPPEAR.
      expect(
        gapAfter.hit,
        `${RULE.key} is now "not_applicable" and ${gapAfter.hit.length} invoice(s) ` +
        `still report the ${RULE.gapField} gap: ${gapAfter.hit.join(', ')}. ` +
        `The setting was stored and nothing read it.${dump(wire)}`,
      ).toEqual([]);
      console.log(
        `\n[02.16] TAKES EFFECT: ${gapBefore.hit.length} invoice(s) reported the ` +
        `${RULE.gapField} gap at "${START}" and 0 at "not_applicable".\n`,
      );
    } else if (!na(OTHER) && na(START)) {
      // The mirror: the firm said it DOES apply, so the gap must APPEAR.
      // A zero here is only meaningful if some line actually lacks a code, so
      // it is reported rather than asserted when there is nothing to find.
      if (gapAfter.hit.length > 0) {
        expect(gapBefore.hit, 'the gap was already being reported while the rule was off')
          .toEqual([]);
        console.log(
          `\n[02.16] TAKES EFFECT: 0 invoice(s) reported the ${RULE.gapField} gap at ` +
          `"not_applicable" and ${gapAfter.hit.length} at "applicable".\n`,
        );
      } else {
        console.log(
          `\n[02.16] ⚠ PARTIAL — the effect half could not be exercised. None of the ` +
          `${gapAfter.looked} tax invoice(s) examined has a line missing an HSN/SAC ` +
          `code, so this rule has nothing to act on either way. The setting was ` +
          `still proved to PERSIST. Reported, not skipped.\n`,
        );
      }
    } else {
      console.log(
        `\n[02.16] ⚠ PARTIAL — the effect half could not be exercised. ${RULE.key} ` +
        `started at "${START}" and no examined invoice reported the ${RULE.gapField} ` +
        `gap at that state, so there is no observable difference to assert on. ` +
        `${gapBefore.looked} of ${gapBefore.total} invoice(s) examined. ` +
        `Reported, not skipped.\n`,
      );
    }

    // ── 9 · THE DECISION HISTORY ───────────────────────────────────────────
    // A setting is stored ONCE and overwritten, so the panel above can only ever
    // show the decision in force. The sequence is what tells "this genuinely
    // does not apply to us" apart from "somebody switched a warning off" six
    // months later — proposal 80's rule 1, and the reason this section exists at
    // all. It reads `staging.audit_log` through the audit router rather than
    // growing a second reader of its own.
    await expect(page.getByRole('heading', { name: 'Decision history' })).toBeVisible();
    const events = await clickAndWait(
      page,
      async () => { await page.getByRole('button', { name: 'Show history' }).click(); },
      (url, method) => method === 'GET' && url.pathname.endsWith('/audit/events'),
    );
    expect(events.status(), `GET /audit/events -> ${events.status()}`).toBeLessThan(400);

    const entry = page.locator('.cmpl__hev').filter({ hasText: RULE.label }).first();
    await expect(
      entry,
      'the change just made is not in the decision history — the trail is the ' +
      'feature, and a change missing from it is invisible six months later',
    ).toBeVisible({ timeout: 20_000 });
    // FROM → TO, both named. The router resolves the previous state before the
    // write precisely so a first decision and a reversal can be told apart
    // (`routers/compliance_settings.py:157`).
    await expect(entry.locator('.cmpl__hwhat')).toContainText(STATE_LABEL[OTHER]);
    await expect(entry.locator('.cmpl__hwhat')).toContainText(STATE_LABEL[START]);
    await expect(entry.locator('.cmpl__hwhy')).toContainText(reason);
    // `actor_name`, never `user_id` — audit.py ships both because its own filter
    // needs the key, and only the name may be drawn.
    const who = (await entry.locator('.cmpl__hwho').innerText()) || '';
    expect(who, 'the history line names nobody').not.toBe('');
    expect(who, `a user id reached the history line: ${who}`).not.toMatch(USER_ID_RE);

    // ── 10 · PUT IT BACK (§6) ──────────────────────────────────────────────
    // The STATE is restored so a second run starts exactly where the first did.
    // The reason string is not, and cannot be: the row is an upsert and the
    // audit log is append-only. The restore therefore writes a reason that names
    // itself, so a reader six months from now knows a test wrote it.
    const restoreReason = baseline.reason
      ? baseline.reason
      : `Suite 02.16 probe ${RUN} — restored to ${STATE_LABEL[START]} (no reason was on file before)`;
    const back = await recordState(page, RULE.label, START, restoreReason);
    expect(back.status(), `restoring ${RULE.key} to ${START} answered ${back.status()}.${dump(wire)}`)
      .toBeLessThan(400);

    const end = await compliance(page);
    expect(
      end.modules.find((m) => m.module === RULE.module)!.rules[RULE.key].state,
      `${RULE.key} would not go back to ${START} — the next run starts dirty`,
    ).toBe(START);
    console.log(`\n[02.16] ${RULE.key}: ${START} -> ${OTHER} -> ${START}, restored.\n`);
  });

  /* ═══════════════════════════════════════════════════════════════════════
   * 02.17 · SUPPORT ACCESS — the customer's half
   *
   * ── The flow, in the owner's words (`routers/support_sessions.py:5`) ─────
   *     org requests > aekam gets email and notification > aekam sends request
   *     > org approves
   *
   * FOUR ACTS, and only ONE of them grants anything:
   *   0  POST /support-sessions/requests   the org asks for help. GRANTS NOTHING.
   *   2  POST /support-sessions            an Aekam `platform_support` account
   *                                        proposes a SCOPE. GRANTS NOTHING.
   *   3  POST /support-sessions/{id}/approve   the org approves THAT SCOPE.
   *                                        ← the only place access is created.
   *      DELETE /support-sessions/{id}     any of the three parties ends it.
   *
   * ── WHAT THIS LANE CANNOT DO, STATED UP FRONT ───────────────────────────
   * Act 2 requires `platform_support` (`support_sessions.py:_may_request`, and
   * `_NOT_A_SUPPORT_ROLE` is the 403 anything else gets). An org_admin of
   * Unicode Group holds no platform role at all, so **this suite cannot create
   * the request it approves**, and it must not: `_lanes.ts` rule 1 is absolute,
   * and reaching for `E2E_GODMODE_TOKEN` to manufacture a precondition is the
   * exact credential class that renamed Aekam Inc.
   *
   * There is also no customer-side control that would help. `TabSupportAccess`
   * says so at line 35: "There is no Request control here at all, and no way for
   * a customer to invite support in… a grant that a customer can create without
   * being asked is a grant an operator can talk them into creating over the
   * phone." That is a DESIGN DECISION and this test asserts it holds.
   *
   * So the test branches on the state the server is actually in, drives the
   * furthest the customer's own hands can reach, and BLOCKS LOUDLY — never
   * `test.skip` — when there is no session to decide. A skip reads as coverage;
   * a named blocker reads as the truth.
   *
   * ── Idempotence (§6), and its honest limit ──────────────────────────────
   * A revoke is terminal and the customer cannot re-create what it consumed, so
   * the second run cannot repeat the first. Branch C is how this stays green
   * twice: a session this suite already revoked is RECOGNISED in the history and
   * verified there, rather than re-driven. That is §6's "recognise your own
   * output and verify rather than duplicate", applied to a one-way door.
   * ═══════════════════════════════════════════════════════════════════════ */

  /** `sessionState`, `pages/admin/supportSessions.js:118`. ORDER IS LOAD-BEARING. */
  function sessionState(s: any, now = Date.now()): string {
    if (s.revoked_at) return 'revoked';
    if (s.denied_at) return 'denied';
    if (!s.approved_at) return 'requested';
    // NULL expiry is UNTIL REVOKED, which is LIVE. A bare `> now` drops exactly
    // the open-ended sessions — the most permissive ones there are.
    if (s.expires_at && new Date(s.expires_at).getTime() <= now) return 'expired';
    return 'active';
  }

  /** `STATE_LABEL`, same file, line 186. The words actually on screen. */
  const SESSION_LABEL: Record<string, string> = {
    requested: 'Awaiting the customer',
    active: 'Active',
    denied: 'Declined',
    expired: 'Ended — time ran out',
    revoked: 'Revoked',
  };

  /**
   * `MODULE_LABEL`, from `pages/admin/supportSessions.js:118` — built out of
   * `SUPPORT_MODULES`, which is the nine a session may be requested for.
   *
   * ⚠ `vetana`, `manav` and `pahchan` are ABSENT here exactly as they are
   * absent there: salary, statutory identifiers and face templates are the
   * three sets of records a support ticket never needs and a customer cannot
   * un-see once an outsider has read them. If one of them ever appears in a
   * session's modules, `|| code` renders the bare code and the assertion below
   * still runs — a missing label must not silently pass.
   */
  const SUPPORT_MODULE_LABEL: Record<string, string> = {
    graha: 'Graha · CRM',
    vikray: 'Vikray · Sales',
    prachar: 'Prachar · Marketing',
    dristi: 'Dristi · Analytics',
    sanvaad: 'Sanvaad · Messaging',
    esign: 'e-Sign',
    varta: 'Varta · WhatsApp',
    ganit: 'Ganit · Accounts',
    sahayak: 'Sahayak · Hub',
  };

  /**
   * The sessions the server holds FOR THIS ORG, read fresh.
   *
   * ⚠ `org_id` IS PASSED EXPLICITLY, and that is the most important line in this
   * test. `list_sessions`'s `customer` scope with NO `org_id` returns every org
   * the caller manages (`support_sessions.py:458`), and the customer table
   * carries no org column — so a person who administers two organisations sees
   * both orgs' sessions on one screen with nothing to tell them apart. Approving
   * the wrong one from that list is the 2026-08-28 incident with a different
   * button on it. Everything this test decides or revokes is filtered to
   * `ORG_IDS.UNICODE` first.
   */
  async function sessions(page: Page) {
    const r = await getJson(page, `/api/v1/support-sessions?scope=customer&org_id=${ORG_IDS.UNICODE}`);
    expect(
      r.ok,
      `GET /support-sessions?scope=customer -> ${r.status}. 403/404/501 is "dormant" ` +
      `to the client (supportSessions.js:DORMANT) but it is NOT dormant to this ` +
      `test: a lane that cannot read its own sessions cannot assert anything.`,
    ).toBeTruthy();
    const rows: any[] = r.body?.data ?? [];
    return rows.filter((s) => String(s.org_id) === ORG_IDS.UNICODE);
  }

  /** The Roles & access destination, where `TabSupportAccess` is actually mounted. */
  async function openRolesAccess(page: Page) {
    await page.goto('/settings/roles');
    // ⚠ Assert the PAGE, not the panel. `RolesAccessPage.jsx:65` renders a
    // denied ErrorState for an account with no org_owner/org_admin row — and
    // because the support panel renders `null` when it has nothing to show, a
    // denial and an empty state are indistinguishable from the panel alone.
    // Landing on the denial and reading it as "no sessions" would report the
    // whole feature dormant on a permissions artefact.
    await expect(page.getByRole('heading', { name: 'Roles & access', level: 1 }))
      .toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText('org admin or org owner on this organisation'),
      'this lane no longer holds org_admin on Unicode Group — an ENVIRONMENT ' +
      'blocker, not a defect in the support-access screen',
    ).toHaveCount(0);
  }

  /** The support Card, once it is on screen. `CardHead` renders an h3. */
  function supportCard(page: Page) {
    return page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Support access', level: 3 }) });
  }

  test('02.17 support access — the customer decides a session and can end it immediately', async ({
    page,
  }) => {
    const wire = watchWire(page);
    await signInAs(page, LANE.creds);

    // ── The server's state first. The screen is the claim; these are the facts. ──
    const all = await sessions(page);
    const live = all.filter((s) => ['requested', 'active'].includes(sessionState(s)));
    const past = all.filter((s) => !['requested', 'active'].includes(sessionState(s)));

    // The cross-org readout, LOGGED not asserted: it is a fact about this
    // account's role rows, and turning it into a red test would invent a
    // requirement. It is in the report as an observation about the screen.
    const unscoped = await getJson(page, '/api/v1/support-sessions?scope=customer');
    const unscopedRows: any[] = unscoped.body?.data ?? [];
    const otherOrgs = new Set(
      unscopedRows.filter((s) => String(s.org_id) !== ORG_IDS.UNICODE).map((s) => String(s.org_name)),
    );
    console.log(
      `\n[02.17] Unicode Group: ${all.length} session(s) — ${live.length} live, ${past.length} past. ` +
      `The unscoped customer list this screen actually calls returns ` +
      `${unscopedRows.length} row(s)` +
      (otherOrgs.size
        ? `, including ${otherOrgs.size} from other organisation(s) this account manages: ` +
          `${[...otherOrgs].join(', ')} — and the customer table has no org column.`
        : ' — all of them this org\'s.') + '\n',
    );

    await openRolesAccess(page);

    // ── THE PANEL IS ABSENT WHEN THERE IS NOTHING, BY DESIGN ───────────────
    // `TabSupportAccess.jsx:147` returns null on dormant, error OR empty. "A
    // settings page that grew a 'Support access — none' panel because a
    // migration has not run is worse than the panel being absent."
    if (all.length === 0) {
      await expect(
        supportCard(page),
        'there are no sessions, so the panel must render NOTHING — not an empty ' +
        'state, not an error',
      ).toHaveCount(0);
      throw new Error(
        'BLOCKED — no support session exists for Unicode Group, so the customer ' +
        'half of the lifecycle has nothing to decide.\n' +
        '  · The panel correctly renders nothing, which is the assertion this test ' +
        'DID make and it passed.\n' +
        '  · Creating one requires `POST /api/v1/support-sessions` as an Aekam ' +
        '`platform_support` account (support_sessions.py:_may_request refuses every ' +
        'other role, platform or org). This lane holds org_admin on Unicode Group ' +
        'and nothing else, and _lanes.ts rule 1 forbids reaching for a platform ' +
        'credential to manufacture a precondition.\n' +
        '  · There is deliberately no customer-side control that would help: ' +
        'TabSupportAccess.jsx:35 states that a customer must not be able to invite ' +
        'support in.\n' +
        '  ENVIRONMENT/SEQUENCING blocker for Suite 19 (the platform console) to ' +
        'clear, NOT a defect in this screen.',
      );
    }

    const card = supportCard(page);
    await expect(
      card,
      `the server returns ${all.length} session(s) for this org and the panel is absent`,
    ).toBeVisible({ timeout: 30_000 });

    // ── WHAT THE PANEL PROMISES, ASSERTED EVERY RUN ────────────────────────
    // "Support access is never silent" is the rule that outranks everything else
    // in this feature (`supportSessions.js:11`). These sentences are where the
    // customer is told the terms; their absence is the feature quietly changing.
    await expect(card.getByText('Aekam staff have no standing access to your data')).toBeVisible();
    await expect(card.getByText('ends on a clock you set')).toBeVisible();
    await expect(
      card.getByText('your owner is emailed the moment one opens'),
      'the panel no longer promises the owner is emailed — and migration 111 ' +
      'makes that email part of the approval, not a follow-up',
    ).toBeVisible();

    // NO WAY IN FROM THIS SIDE. A customer-facing "request support" button would
    // be a control an operator can talk somebody into pressing over the phone,
    // and the record afterwards would show the customer's own hand on it.
    await expect(
      card.getByRole('button', { name: /request|ask|invite/i }),
      'a control that lets the CUSTOMER invite support in has appeared — ' +
      'TabSupportAccess.jsx:35 says there must be none',
    ).toHaveCount(0);

    // NAMES, NEVER IDS. `_LIST_NAMES` (support_session.py:1337) drops the raw
    // `requested_by` from the coalesce for exactly this reason, and the `who`
    // cell carries a comment saying its `|| s.requested_by` fallback "drew a
    // member id". Two OTHER places in this file kept that fallback — the decide
    // card's heading and the revoke confirmation — so this is checked on the
    // rendered text rather than trusted from one cell.
    const cardText = (await card.innerText()) || '';
    expect(cardText, 'a UUID reached the support panel').not.toMatch(UUID_RE);
    expect(cardText, 'a user id reached the support panel').not.toMatch(USER_ID_RE);

    /**
     * Revoke a live session the way the customer does, and assert what it costs.
     * Split out because two branches reach it from different starting points.
     */
    const revokeAndAssert = async (s: any) => {
      const ref: string = s.ref;
      const row = page.getByRole('row').filter({ hasText: ref });
      await expect(row, `${ref} is live on the server and not on the screen`)
        .toBeVisible({ timeout: 30_000 });
      await expect(row.getByText(SESSION_LABEL.active)).toBeVisible();

      await row.getByRole('button', { name: 'Revoke now' }).click();

      // ⚠ SCOPED TO THE DIALOG. `ConfirmDialog` renders `role="alertdialog"` and
      // its confirm button carries the SAME label as the row's button —
      // `confirmLabel: 'Revoke now'`. An unscoped name match resolves in DOM
      // order and would click the row again, leaving the dialog open and the
      // test waiting on a request nobody made.
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await expect(dialog.locator('.cd__t')).toContainText(`Revoke ${ref}?`);
      // A destructive confirmation must SAY WHAT IT DOES NOT UNDO. "Nothing they
      // have already seen is undone, and the session stays in your audit log" is
      // the sentence that stops a customer believing a revoke erases the visit.
      // Its absence would be the defect, not its wording.
      await expect(
        dialog.locator('.cd__m'),
        'the revoke confirmation no longer says what survives it',
      ).toContainText('Nothing they have already seen is undone');
      await expect(dialog.locator('.cd__m')).toContainText('stays in your audit log');

      const del = await clickAndWait(
        page,
        async () => { await dialog.getByRole('button', { name: 'Revoke now' }).click(); },
        (url, method) => method === 'DELETE' && url.pathname.includes('/support-sessions/'),
      );
      expect(del.status(), `revoking ${ref} answered ${del.status()}.${dump(wire)}`).toBeLessThan(400);
      await expect(page.locator('.tst__t').getByText(`${ref} revoked.`)).toBeVisible({ timeout: 20_000 });

      // ── The row is the fact ────────────────────────────────────────────
      const after = (await sessions(page)).find((x) => x.id === s.id);
      expect(after, `${ref} vanished from the list entirely after a revoke`).toBeTruthy();
      expect(after.revoked_at, `${ref} was not actually revoked${dump(wire)}`).toBeTruthy();
      // `revoked_by_party` is DERIVED from who the caller is; the `party` in the
      // request body is accepted and IGNORED (`support_sessions.py:579`). The
      // column exists to tell three otherwise-identical revocations apart, so
      // a customer revocation must be recorded as `customer` and not as
      // whatever the client asked to be called.
      expect(
        after.revoked_by_party,
        'the org_admin who pressed Revoke is not recorded as the `customer` party',
      ).toBe('customer');
      expect(sessionState(after), `${ref} is not in the revoked state`).toBe('revoked');

      // ...and it has moved out of the live list and into the record, because
      // "nobody is in here now" and "nobody has ever been in here" are different
      // facts the customer is entitled to tell apart.
      await expect(
        page.getByRole('row').filter({ hasText: ref }).getByRole('button', { name: 'Revoke now' }),
        `${ref} is revoked and the screen still offers to revoke it`,
      ).toHaveCount(0);
      await expect(
        page.getByRole('row').filter({ hasText: ref }).getByText(SESSION_LABEL.revoked),
      ).toBeVisible({ timeout: 20_000 });
      return ref;
    };

    // ── BRANCH A · a pending request this person may decide ────────────────
    // `can_approve` is the SERVER's answer (`support_session.py:_shape`), and it
    // is already false for a self-raised request. The screen's `mayApprove` is a
    // deliberately more restrictive second opinion. Trusting the server's field
    // here means this test cannot ask for a control the product would refuse.
    const pending = live.find((s) => sessionState(s) === 'requested' && s.can_approve);
    const activeNow = live.find((s) => sessionState(s) === 'active');

    if (pending) {
      const ref: string = pending.ref;
      const row = page.getByRole('row').filter({ hasText: ref });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row.getByText(SESSION_LABEL.requested)).toBeVisible();
      // The reason the operator gave is what the customer decides ON, and the
      // DDL will not accept a short one (`pss_reason_is_substantive`, ≥12 chars).
      await expect(row).toContainText(pending.reason);

      await row.getByRole('button', { name: 'Decide' }).click();

      /**
       * ⚠ SCOPED TO THE DECIDE PANEL, AND THAT IS THE WHOLE FIX.
       *
       * This assertion had NEVER RUN before 2026-08-29. The approve branch
       * needs a pending request that `can_approve` allows, and until Suite 19.3
       * existed there had never been one — `platform_support_sessions` held
       * zero rows for its entire life. So this locator met real markup for the
       * first time and resolved to TWO nodes:
       *
       *   1. `<span class="omt__e">— look at, without changing</span>`
       *      the reach cell in the sessions table (`TabSupportAccess.jsx:286`)
       *   2. `<p class="apg__lede">They asked to look at, without changing …`
       *      the decide panel's own lede (`:389`)
       *
       * BOTH ARE CORRECT. `levelPhrase()` is deliberately used in both places —
       * the row says what a session reaches, the panel says what is being asked
       * for. Nothing about the product is wrong; the locator was unscoped, which
       * is suite rule 6, and an unscoped `getByText` resolves in DOM order and
       * would happily have asserted against the TABLE while the panel behind it
       * said something else entirely.
       *
       * The panel is anchored on `#ssa-deny` — a control that exists nowhere
       * else on the screen — rather than on its heading text, because the
       * heading carries the operator's NAME and this suite must never assert the
       * name of a person it did not itself create (a human accepted one of this
       * programme's invitations from their phone on 28 Aug).
       */
      // ⚠ `.last()`, and it is not a shrug. `Card` renders `<section class="card">`
       // and the decide panel is NESTED INSIDE the outer "Support access" card,
       // so `has: #ssa-deny` matches BOTH — the ancestor and the panel itself.
       // Playwright returns matches in document order, so the innermost is last.
       // The outer card would have contained the sessions table too, which is
       // the exact node this scoping exists to exclude, so taking either one
       // "because it matched" would have put the bug straight back.
      const decideCards = page.locator('section.card').filter({ has: page.locator('#ssa-deny') });
      await expect(decideCards.first(), 'the Decide panel did not open').toBeVisible({
        timeout: 15_000,
      });
      const decidePanel = decideCards.last();

      // Proof we took the INNER card and not its ancestor: the panel holds the
      // decision controls and none of the table's per-row Decide buttons. An
      // assertion that cannot tell the two apart is the one that just failed.
      await expect(
        decidePanel.getByRole('button', { name: 'Decide' }),
        'this is the outer card, not the decide panel — it still holds the table',
      ).toHaveCount(0);

      // What is being asked for, in the customer's words rather than the
      // schema's — `levelPhrase` turns viewer/editor into "look at, without
      // changing" / "look at and change".
      const phrase = pending.access_level === 'editor'
        ? 'look at and change'
        : 'look at, without changing';
      await expect(decidePanel.getByText(phrase)).toBeVisible({ timeout: 15_000 });

      // And the panel names the MODULES asked for, not merely the level — the
      // customer is agreeing to a scope, and "look at, without changing" with
      // no subject is not a scope.
      for (const code of (pending.modules || [])) {
        await expect(
          decidePanel,
          `the decide panel does not name the ${code} module being asked for`,
        ).toContainText(SUPPORT_MODULE_LABEL[code] || code);
      }

      // The three sets of records a session can never ask for: payroll, HR and
      // attendance. `SUPPORT_MODULES` omits vetana, manav and pahchan, and the
      // screen says so before the customer decides, so nobody is ever put in the
      // position of having to refuse.
      await expect(
        decidePanel.getByText('Payroll, HR records and attendance cannot be asked for at all'),
        'the panel no longer states which records are out of scope entirely',
      ).toBeVisible();

      // ── THE DECLINE PATH IS ASSERTED, NOT DRIVEN ────────────────────────
      // Driving it would consume the one pending session the approve path
      // needs, and this lane cannot create another (see the section header).
      // What IS assertable for free is that the control exists and that the
      // product will not let a refusal go out unexplained: `Decline` is
      // disabled until a reason is typed, because "they see this" and a
      // declined request can be asked again with a better reason.
      await expect(page.locator('#ssa-deny')).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Decline' }),
        'the product would let a request be declined with no reason — the ' +
        'operator reads that text and re-asks on it',
      ).toBeDisabled();

      // ⚠ SHORTEN IT. "You may shorten what they asked for" is the control this
      // whole feature exists to give the customer, and 2 hours is the shortest
      // real window in `TTL_CHOICES`. Approving at the requested length would
      // leave the narrowing path — the interesting half — unexercised.
      await expect(page.getByText('There is no extension afterwards')).toBeVisible();
      await page.locator('#ssa-ttl').selectOption('2');

      const ok = await clickAndWait(
        page,
        async () => { await page.getByRole('button', { name: 'Approve', exact: true }).click(); },
        (url, method) => method === 'POST' && /\/support-sessions\/.+\/approve$/.test(url.pathname),
      );
      expect(ok.status(), `approving ${ref} answered ${ok.status()}.${dump(wire)}`).toBeLessThan(400);

      // The toast names all three consequences at once, and that is the product
      // being explicit rather than chatty: migration 111's
      // `pss_approval_and_owner_email_are_one_act` will not let the row commit
      // without the owner email and the audit row, so a success here means all
      // three happened.
      await expect(page.locator('.tst__t').getByText(`${ref} approved.`))
        .toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.tst__t').getByText('Your owner has been emailed'))
        .toBeVisible();

      const opened = (await sessions(page)).find((x) => x.id === pending.id);
      expect(opened?.approved_at, `${ref} shows approved on screen and not on the row`).toBeTruthy();
      expect(
        opened?.granted_ttl_hours,
        'the customer shortened the grant to 2 hours and the server stored ' +
        'something else — the narrowing control is the point of the screen',
      ).toBe(2);
      // Both numbers stay on the row. An approval that quietly narrowed a
      // request is the customer using this control, and losing the original
      // would erase that they did.
      expect(opened?.requested_ttl_hours, 'what was ASKED for was overwritten by what was granted')
        .toBe(pending.requested_ttl_hours);
      expect(sessionState(opened), `${ref} did not become active`).toBe('active');

      // The countdown is a real clock, and it must say something. `remaining()`
      // returns null for an open-ended session AND for a dead one, so the row
      // deliberately reads "until you revoke it" only in the former case.
      const liveRow = page.getByRole('row').filter({ hasText: ref });
      await expect(liveRow.getByText(SESSION_LABEL.active)).toBeVisible({ timeout: 20_000 });
      await expect(liveRow).toContainText('ends in');

      // ── ...and it ends the moment the customer says so ──────────────────
      await revokeAndAssert(opened);
      console.log(`\n[02.17] ${ref}: requested -> approved (shortened to 2h) -> revoked by the customer.\n`);
      return;
    }

    // ── BRANCH B · already live, so only the ending is left to prove ───────
    if (activeNow) {
      const ref = await revokeAndAssert(activeNow);
      console.log(
        `\n[02.17] ${ref} was already active, so this run proved the REVOKE half only. ` +
        `The approve half needs a fresh 'requested' session from an Aekam ` +
        `platform_support account.\n`,
      );
      return;
    }

    // ── BRANCH C · nothing live, but the record is here ────────────────────
    // This is how the suite stays green on its SECOND run: a revoke is a one-way
    // door and this lane cannot re-open it, so a session this suite already
    // ended is RECOGNISED and verified in the history rather than re-driven.
    // §6 asks a re-run to verify rather than duplicate; it does not ask for a
    // door the customer does not have.
    await expect(
      page.getByText('Nobody from Aekam is in your data right now'),
      'nothing is live and the panel does not say so — the sentence that ' +
      'separates "nobody is in here now" from "nobody has ever been" is missing',
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      card.getByRole('button', { name: 'Revoke now' }),
      'no session is live and the screen still offers to end one',
    ).toHaveCount(0);

    const record = past[0];
    const row = page.getByRole('row').filter({ hasText: record.ref });
    await expect(row, `${record.ref} is in the server's history and not on the screen`)
      .toBeVisible({ timeout: 20_000 });
    // The reference is what a customer reads out on the phone, and the one
    // handle on a session that is not a UUID. `SUP-` + 6 of Crockford's alphabet.
    expect(record.ref, 'the reference is not in the SUP- shape migration 111 pins')
      .toMatch(/^SUP-[0-9A-HJ-NP-Z]{6}$/);
    await expect(row).toContainText(record.requested_by_name);
    await expect(row).toContainText(record.reason);
    await expect(row.getByText(SESSION_LABEL[sessionState(record)])).toBeVisible();

    const ended = past.filter((s) => s.revoked_by_party === 'customer');
    console.log(
      `\n[02.17] Nothing live. Verified the record instead: ${past.length} past session(s), ` +
      `${ended.length} of them ended by the customer` +
      `${ended.length ? ` (${ended.map((s) => s.ref).join(', ')})` : ''}. ` +
      `A revoke cannot be undone from this lane, so a re-run verifies rather than ` +
      `duplicating — §6.\n`,
    );

    // A HISTORY-ONLY run has NOT proved the lifecycle, and it must not read as
    // though it had. If nothing here was ever ended by the customer, this lane
    // has never actually exercised the flow and that has to be a failure.
    expect(
      ended.length,
      'BLOCKED — this org has support-session history, but none of it was ended ' +
      'by the customer, so the grant -> revoke lifecycle has never been driven ' +
      'from this side. A fresh `requested` session must be raised by an Aekam ' +
      '`platform_support` account (POST /api/v1/support-sessions) before 02.17 ' +
      'can prove it. ENVIRONMENT/SEQUENCING blocker, not a product defect.',
    ).toBeGreaterThan(0);
  });
});
