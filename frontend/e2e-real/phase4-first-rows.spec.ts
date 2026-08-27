/**
 * PHASE 4.1 + 4.2 — THE FIRST ROW, THROUGH THE REAL SCREEN.
 *
 * ── What this spec is for ───────────────────────────────────────────────────
 *
 * Both features are built, deployed and unit-tested, and both tables were
 * EMPTY. Measured read-only against Supabase `toacecaewujfxjfrjwco`,
 * 2026-08-27, before this spec first ran:
 *
 *   staging.module_compliance_settings   0 rows — across ALL FIVE orgs
 *   staging.pahchan_employee_consents    0 rows — against 12 enrolled faces
 *
 * `CLAUDE.md`'s rule is that ✅ means a customer can complete the flow end to
 * end, "proven by a row appearing where there were zero — not the code
 * shipped". Code-without-data is 🟡, and 🟡 is what both of these were. This
 * file is what moves them, and it moves them the only way the owner's standing
 * rule allows: **through the product's own forms.** There is not one INSERT
 * here, and there is no direct POST that stands in for a control a person
 * presses — every row below is created by clicking the thing a customer clicks.
 *
 * ── TWO SCREENS, TWO DIFFERENT PEOPLE ───────────────────────────────────────
 *
 * 4.1 · Settings ▸ Organisation ▸ Compliance   (`pages/org/TabCompliance.jsx`
 *       → `PATCH /api/v1/org/compliance/{module}`). Driven as the god-mode
 *       account, which holds `org_admin` in this org — `ORG_SETTINGS_ROLES`
 *       is ('org_admin', 'org_owner') and nothing narrower reaches the panel.
 *
 * 4.2 · Pahchan ▸ Consent                      (`pages/pahchan/Consent.jsx`
 *       → `POST /api/v1/pahchan/consent/me`). Driven as **EMP-003, Tara
 *       Mehta** — an `org_member` holding `pahchan:editor` and nothing else,
 *       signed in through the real login form with her own password.
 *
 *       That second account is not a convenience. `POST /consent/me` resolves
 *       the caller's OWN employee row through `pahchan._employee_for` and
 *       answers 409 to everybody else, so the god-mode account — which carries
 *       no `manav_employees` row — physically cannot record this. Phase 0.23
 *       linked twelve E2E employees to logins on 26 August; this is the first
 *       thing that link makes possible that nothing else could do.
 *
 *       It also proves the endpoint is NOT admin-gated, which is the DPDP
 *       point of having it at all: an employee must be able to decline without
 *       asking the person whose decision they are declining to accept.
 *
 * ── E2E TEST & ASSOCIATES, AND NOTHING ELSE ─────────────────────────────────
 *
 * Every test asserts the session's own org before it writes, and asserts it is
 * not Unicode Group — a real customer whose mail really sends. The fence is
 * `assertOutboundFenceFor`, which derives the digest from the org the SESSION
 * is in rather than from an environment variable, because a fence that attests
 * about an org the session is not in is not a fence (`_helpers.ts`).
 *
 * Neither write sends mail. Both are recorded here anyway: the fence is the
 * cheapest possible proof that the session is where it claims to be, and it
 * caught a wrong-org write once already.
 *
 * ── NOTHING FALSE IS EVER RECORDED, AND THAT SHAPES THE RE-RUN ──────────────
 *
 * Both of these screens store a POSITION — one a firm's, one a person's — with
 * a name and a date against it. So a re-run may not toggle a value back and
 * forth to keep exercising a write:
 *
 *   4.1  the composition scheme genuinely does not apply to this firm (its
 *        invoices carry a CGST/SGST split, which a composition dealer may not
 *        charge). Recording `not_applicable` is a true statement. Recording
 *        `applicable` on the next run to "keep the write warm" would be a
 *        false one, on a compliance record, and the screen exists precisely to
 *        keep such a record legible six months later.
 *
 *   4.2  the opposite state of `consented: true` is `false`, and a decline
 *        STOPS every future enrolment and clock-in photograph for that person
 *        from any source (`enroll_photo`, `_employee_opted_out`). Recording
 *        one nobody gave is the single thing `Consent.jsx` warns against in as
 *        many words: "do not record an answer nobody gave".
 *
 * So each write is CONDITIONAL on the current state and each test asserts the
 * end state either way. A first run writes; a second run reads the row back
 * and writes nothing. That is the same idempotency `manav-dummy-logins.spec.ts`
 * uses, for the same reason: this database is shared with production.
 *
 * It is NOT a skip. Every control is asserted present on every run — a missing
 * control is a failure here, per the seven rules — and the canonical row is
 * re-read from the server whether or not this run is what created it.
 *
 * ── THE ADMIN CONSENT ROUTE IS DELIBERATELY NOT USED TO CREATE A ROW ────────
 *
 * `POST /v1/pahchan/consent` takes `method` ∈ (paper | verbal_witnessed), and
 * both assert that evidence exists off-system — a filed form, a witnessed
 * conversation. Neither is true here, and typing one would be fabricating the
 * exact record this feature exists to make trustworthy. The admin surface is
 * therefore exercised READ-ONLY below (`GET /consent/roster`, and the roster
 * table on screen), which is what it is for on this data: showing that twelve
 * faces are on file with no answer against them.
 *
 * ── RUN IT ──────────────────────────────────────────────────────────────────
 *
 *     cd frontend
 *     node e2e-real/mint-state.mjs
 *     npx playwright test --config e2e-real/onefile.config.ts phase4-first-rows
 */
import { test, expect } from '@playwright/test';
import {
  RUN, apiOk, settle, openTab, shot, submitting,
  useOrg, activeOrgId, assertOutboundFenceFor,
} from './_helpers';
import { GODMODE_STATE } from './real.config';

// Same trade `manav-dummy-logins.spec.ts` makes and for the same measured
// reason: several agents run `playwright test` against this tree at once,
// Playwright EMPTIES `outputDir` when any run starts, and a live trace is a
// file inside it — so a concurrent run deletes this one's recording mid-test
// and `context.close()` throws ENOENT on a journey that already succeeded.
// What is lost is the trace viewer. What is kept is the failure message, a
// screenshot on failure, and the ROWS — which every test below reads back from
// the server and which outlive any run.
test.use({
  storageState: GODMODE_STATE,
  trace: 'off',
  video: 'off',
  screenshot: 'only-on-failure',
});
test.describe.configure({ mode: 'serial', timeout: 300_000 });

/** E2E Test & Associates [TEST ORG]. The ONLY org this file may touch. */
const TARGET_ORG = '64e7bea6-6abe-490c-a2a4-27a60c6be916';
const TARGET_NAME = /E2E Test & Associates/i;
/** Unicode Group — a real customer. Asserted against, never written to. */
const FORBIDDEN_ORG = 'fae87907-2f99-4b35-a241-c94d9e1e4a17';

const BASE = process.env.E2E_BASE_URL || 'https://staging.kartavaya.com';

// ── 4.1 · which rule, and why THIS one ───────────────────────────────────────
//
// `services/compliance_settings.py` splits its registry in two. A WIRED rule
// (`enforced_at` names real code) is read by the product: ganit's
// `gstin_required` and `hsn_required` both feed
// `services/doc_validation.py:validate_tax_invoice`. A RECORDED-ONLY rule
// (`enforced_at=None`) is read by nothing — the firm's position is stored,
// attributed and dated, and the screen says in as many words that no behaviour
// changes.
//
// This spec writes to a RECORDED-ONLY rule, and that is a safety decision
// rather than a convenience. E2E Test & Associates is a live organisation on a
// database shared with production, and the two states a wired rule could be
// moved to both change what the product does to it:
//
//   not_applicable on gstin_required  hides the GSTIN field and stops counting
//                                     it as missing on every future invoice
//   enforced on either                REFUSES to issue a document that is short
//                                     of it — a self-inflicted block on an org
//                                     other suites issue invoices in
//
// `composition_scheme` changes nothing, and the sentence it stores is TRUE:
// this firm's invoices carry a CGST/SGST split, and a composition dealer may
// not charge GST at all. A first row that states a fact is worth more than one
// that states whatever was easiest to click.
const CMPL_MODULE = 'ganit';
const CMPL_RULE = 'composition_scheme';
const CMPL_LABEL = 'Composition scheme';
const CMPL_TARGET = { state: 'not_applicable', label: 'Not applicable' };

/** The label the segmented control shows for each state (`TabCompliance.jsx`). */
const STATE_LABEL: Record<string, string> = {
  not_applicable: 'Not applicable',
  applicable: 'Applicable',
  enforced: 'Enforced',
};
const STATE_OF_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_LABEL).map(([k, v]) => [v, k]));

/**
 * Stable across runs, deliberately. The reason is a compliance record, not a
 * test artefact — six months from now it is what tells "this genuinely does
 * not apply to our firm" apart from "somebody switched a warning off", which
 * is the whole reason the field exists. A run tag in it would make a real
 * decision read as machine noise; the provenance is instead stated in words.
 */
const CMPL_REASON =
  'Not a composition dealer — this firm issues tax invoices carrying a '
  + 'CGST/SGST split, which the composition scheme does not permit. Recorded '
  + 'from Settings ▸ Organisation ▸ Compliance during the Phase 4.1 acceptance '
  + 'run.';

// ── 4.2 · who answers, and with what ─────────────────────────────────────────
//
// EMP-003 rather than EMP-001. Both are linked, but EMP-001 is an `org_admin`
// and would have reached this screen by role alone; EMP-003 is an `org_member`
// whose only module grant is `pahchan:editor`, which is the narrowest seat that
// can answer at all. Driving the narrow one proves the gate is `_employee_for`
// and not an admin check.
const CONSENT_EMPLOYEE = { n: '03', code: 'EMP-003', name: 'Tara Mehta' };
/** `lib/pahchanNotice.js` — the wording the screen actually renders. */
const NOTICE_VERSION = '2026-08-06.1';

/** Credentials, or a FAILURE naming the missing line. Never invented. */
function creds(n: string): { email: string; password: string } {
  const email = process.env[`E2E_DUMMY_${n}_EMAIL`];
  const password = process.env[`E2E_DUMMY_${n}_PASSWORD`];
  expect(email, `E2E_DUMMY_${n}_EMAIL is not in .env.e2e — this spec never invents an `
    + 'address').toBeTruthy();
  expect(password, `E2E_DUMMY_${n}_PASSWORD is not in .env.e2e`).toBeTruthy();
  expect(email!, `E2E_DUMMY_${n}_EMAIL must be @example.com (RFC 2606)`)
    .toMatch(/@example\.com$/);
  return { email: email!, password: password! };
}

/**
 * A rendered attribution must be a NAME. `check-rendered-ids.mjs` is the static
 * ratchet; this is the same rule asserted against a live surface, which is the
 * only place it can catch a server that started shipping the id again.
 */
function expectIsAName(value: string, what: string) {
  expect(value, `${what} is empty`).toBeTruthy();
  expect(value, `${what} renders a user id (user_xxxx…), not a name: ${value}`)
    .not.toMatch(/user_[0-9a-f]{6}/i);
  expect(value, `${what} renders a UUID, not a name: ${value}`)
    .not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
}

/** How many rules across every module carry a stored decision, right now. */
function setterCount(payload: any): number {
  return (payload.modules ?? []).reduce(
    (n: number, m: any) => n + Object.values(m.rules ?? {})
      .filter((r: any) => r.has_setter).length,
    0);
}

/** How many people on the roster carry a recorded answer, right now. */
function answeredCount(roster: any): number {
  return (roster.employees ?? []).filter((e: any) => e.consented !== null).length;
}

const state: {
  cmplSettersBefore?: number;
  cmplStateBefore?: string;
  cmplWrote?: boolean;
  consentAnsweredBefore?: number;
  consentStanceBefore?: boolean | null;
  consentWrote?: boolean;
} = {};

// ══ THE FENCE ════════════════════════════════════════════════════════════════

test('fence · the session is in E2E Test & Associates, and E2E is shielded',
  async ({ page }) => {
    await useOrg(page, TARGET_ORG, TARGET_NAME);
    const org = await activeOrgId(page);
    expect(org, 'the session is pointed at Unicode Group — a real customer. Nothing in '
      + 'this file may run there.').not.toBe(FORBIDDEN_ORG);
    await assertOutboundFenceFor(page, TARGET_ORG);
  });

// ══ 4.1 · COMPLIANCE SETTINGS ════════════════════════════════════════════════

test('4.1 baseline · what the compliance panel says before anything is recorded',
  async ({ page }) => {
    await page.goto('/');
    await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), TARGET_ORG);

    const all = await apiOk(page, 'get', '/api/v1/org/compliance');
    expect(all.default_state, 'the server no longer states its own default state')
      .toBe('applicable');

    const mod = (all.modules ?? []).find((m: any) => m.module === CMPL_MODULE);
    expect(mod, `GET /v1/org/compliance returned no "${CMPL_MODULE}" module — the registry `
      + `in services/compliance_settings.py no longer carries it`).toBeTruthy();
    const rule = mod.rules?.[CMPL_RULE];
    expect(rule, `${CMPL_MODULE}.${CMPL_RULE} is not in the registry any more; this spec `
      + 'pins that rule because nothing reads its state, so recording it changes no '
      + 'behaviour on a database shared with production').toBeTruthy();

    // The refusal that keeps the registry honest: a rule nothing reads may not
    // be "enforced", so the screen must offer exactly two states for it.
    expect(rule.wired, `${CMPL_RULE} has been WIRED to real code. Re-read the note above `
      + 'before writing to it — a state change on a wired rule changes what the product '
      + 'does to this organisation.').toBe(false);
    expect(rule.states, 'a recorded-only rule is offering the "enforced" state, which '
      + 'would promise a guardrail nothing can apply').toEqual(['not_applicable', 'applicable']);

    state.cmplStateBefore = rule.state;
    state.cmplSettersBefore = setterCount(all);
    // eslint-disable-next-line no-console
    console.log(`4.1 baseline · ${state.cmplSettersBefore} rule(s) carry a stored decision `
      + `in this org; ${CMPL_MODULE}.${CMPL_RULE} is "${rule.state}" `
      + `(has_setter=${rule.has_setter})`);
  });

test('4.1 · the firm records a position from Settings ▸ Organisation ▸ Compliance',
  async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), TARGET_ORG);

    await page.goto('/settings/organisation?tab=compliance');
    await settle(page);
    expect(await activeOrgId(page), 'the session drifted off E2E before the write')
      .toBe(TARGET_ORG);

    // Scoped to the open tabpanel: the legend at the top of this panel carries
    // the words "Not applicable" and "Applicable" too, and every one of the
    // eleven rules has a radio with each label.
    const panel = page.locator('[role="tabpanel"]').first();
    const group = panel.getByRole('radiogroup', { name: new RegExp(`^${CMPL_LABEL} —`) });
    await expect(group, `Settings ▸ Organisation ▸ Compliance has no control for `
      + `"${CMPL_LABEL}". Either the panel did not load (a denied state renders instead `
      + 'for anyone who is not org_admin/org_owner), or the registry changed.')
      .toBeVisible({ timeout: 40_000 });

    // The row this rule lives in, for the attribution line underneath it.
    const row = panel.locator('.cmpl__rule').filter({ hasText: CMPL_LABEL }).first();
    await expect(row, `the "${CMPL_LABEL}" rule row is not on the panel`).toBeVisible();
    await expect(row.getByText('Recorded only'),
      'the panel no longer marks this rule as one the product does not read')
      .toBeVisible();
    await expect(row.locator('.cmpl__why'),
      'the rule states no consequence — the sentence that tells a firm what a gap costs '
      + 'comes from the server registry and is the reason this is a settings screen and '
      + 'not a checkbox').not.toBeEmpty();

    // Exactly the two declared states, drawn. A third radio here would be the
    // API refusal and the UI disagreeing.
    const radios = group.getByRole('radio');
    await expect(radios, 'a recorded-only rule is drawing a third state').toHaveCount(2);

    // What is on the screen NOW, read from the control rather than from the API,
    // because the control is what a person acts on.
    const labels = await radios.allTextContents();
    const checked = await radios.evaluateAll((els) =>
      els.filter((e) => e.getAttribute('aria-checked') === 'true')
        .map((e) => (e.textContent || '').trim()));
    expect(checked.length, `exactly one state must be selected; the control shows `
      + `${checked.length} of [${labels.join(', ')}]`).toBe(1);
    const before = STATE_OF_LABEL[checked[0]];
    expect(before, `the control shows an unrecognised state "${checked[0]}"`).toBeTruthy();

    if (before === CMPL_TARGET.state) {
      // Already recorded by an earlier run. Nothing is toggled to manufacture a
      // write — see the header. The row is verified below either way.
      state.cmplWrote = false;
      // eslint-disable-next-line no-console
      console.log(`4.1 · "${CMPL_LABEL}" already stands at ${CMPL_TARGET.label}; this run `
        + 'records nothing and verifies the stored row instead');
      await expect(row.locator('.cmpl__meta'),
        'the rule is at a non-default state with no attribution line — a stored decision '
        + 'with nobody against it').toBeVisible();
      return;
    }

    // ── The control ──────────────────────────────────────────────────────────
    await group.getByRole('radio', { name: CMPL_TARGET.label, exact: true }).click();

    const dialog = page.getByTestId('compliance-confirm');
    await expect(dialog, 'choosing a state did not raise the confirmation dialog. Every '
      + 'change goes through it, including a change back to the default — proposal 80\'s '
      + 'rule 1 is that "not applicable is a decision, not an absence", and so is '
      + 'reversing one.').toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('compliance-confirm-title'),
      'the dialog does not name the rule being changed').toHaveText(CMPL_LABEL);

    const reason = dialog.locator('#cmpl-reason');
    await expect(reason, 'the dialog offers nowhere to say WHY, which is the field that '
      + 'makes the decision legible later').toBeVisible();
    await reason.fill(CMPL_REASON);

    // ── The write, read from the RESPONSE ────────────────────────────────────
    // Never from the panel afterwards: `commit()` patches the one rule in place
    // from this same body, so reading the screen would be reading our own echo.
    const saved = await submitting(page, '/v1/org/compliance', async () => {
      await dialog.getByRole('button', { name: `Record as ${CMPL_TARGET.label}` }).click();
    });

    expect(saved.status, 'the server did not report the setting as updated').toBe('updated');
    expect(saved.module, 'the write landed on the wrong module').toBe(CMPL_MODULE);
    expect(saved.rule_key, 'the write landed on the wrong rule').toBe(CMPL_RULE);
    expect(saved.state, 'the stored state is not what was recorded').toBe(CMPL_TARGET.state);
    expect(saved.previous_state, 'the audit row would say it changed from the wrong state; '
      + `the control showed "${checked[0]}" before the click`).toBe(before);
    expect(saved.reason, 'the reason was not stored with the decision').toBe(CMPL_REASON);
    expect(saved.has_setter, 'the row came back with no setter, so nothing is attributable')
      .toBe(true);
    expectIsAName(String(saved.set_by_name ?? ''), 'the compliance row\'s set_by_name');
    expect(saved.set_at, 'the row carries no timestamp').toBeTruthy();
    // The id is REMOVED from the payload, not merely unrendered: a field that is
    // present is a field a screen can draw.
    expect('set_by' in saved, 'the API is shipping the raw set_by user id again '
      + '(compliance_settings.py::_named drops it deliberately)').toBe(false);

    state.cmplWrote = true;

    // ── And the screen says so, without a reload ─────────────────────────────
    await expect(group.getByRole('radio', { name: CMPL_TARGET.label, exact: true }),
      'the control did not move to the recorded state after saving')
      .toHaveAttribute('aria-checked', 'true');
    const meta = row.locator('.cmpl__meta');
    await expect(meta, 'the rule shows no "Set by …" line after being recorded')
      .toBeVisible({ timeout: 15_000 });
    const metaText = (await meta.innerText()).trim();
    expect(metaText, 'the attribution line does not say who set it').toMatch(/^Set by /);
    expectIsAName(metaText, 'the rendered attribution line');
    expect(metaText, 'the stored reason is not shown beside the decision')
      .toContain('Not a composition dealer');

    await shot(page, `phase4-compliance-recorded-${RUN}`);
  });

test('4.1 canonical · the row is there when the server is asked again',
  async ({ page }) => {
    await page.goto('/');
    await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), TARGET_ORG);

    // The per-module read, which is a different query from the one the panel
    // uses — `resolve` rather than `resolve_all`. A row only the screen's own
    // endpoint can see would not be a row.
    const one = await apiOk(page, 'get', `/api/v1/org/compliance/${CMPL_MODULE}`);
    const rule = one.rules?.[CMPL_RULE];
    expect(rule, `GET /v1/org/compliance/${CMPL_MODULE} does not carry ${CMPL_RULE}`)
      .toBeTruthy();
    expect(rule.state, `${CMPL_MODULE}.${CMPL_RULE} is not stored at the recorded state`)
      .toBe(CMPL_TARGET.state);
    expect(rule.has_setter, 'the stored row has no setter — module_compliance_settings is '
      + 'still empty for this org and the write did not land').toBe(true);
    expectIsAName(String(rule.set_by_name ?? ''), 'the canonical row\'s set_by_name');
    expect(rule.reason, 'the stored reason is not what was typed').toBe(CMPL_REASON);
    expect(rule.set_at, 'the stored row carries no timestamp').toBeTruthy();

    // A DELTA, never an absolute: another agent recording a different rule
    // between two runs is legitimate and must not fail this spec.
    const all = await apiOk(page, 'get', '/api/v1/org/compliance');
    const after = setterCount(all);
    const expected = (state.cmplSettersBefore ?? 0) + (state.cmplWrote ? 1 : 0);
    expect(after, `stored decisions went ${state.cmplSettersBefore} → ${after}; this run `
      + `${state.cmplWrote ? 'recorded one' : 'recorded none'}, so it must be at least `
      + `${expected}`).toBeGreaterThanOrEqual(expected);
    expect(after, 'module_compliance_settings still holds no decision for this org')
      .toBeGreaterThanOrEqual(1);

    // The audit trail is a second record and a separate table. The panel's
    // "Decision history" reads it, so a decision the trail cannot see is a
    // decision the screen will lose the moment it is reversed.
    const events = await apiOk(page, 'get',
      '/api/v1/audit/events?action=compliance.setting_updated&limit=50');
    const mine = (events.data ?? []).filter(
      (e: any) => e.detail?.module === CMPL_MODULE && e.detail?.rule_key === CMPL_RULE);
    expect(mine.length, 'no audit event was written for this compliance decision, so the '
      + 'panel\'s Decision history cannot tell a reversal from a first answer')
      .toBeGreaterThanOrEqual(1);
    expectIsAName(String(mine[0].actor_name ?? ''), 'the audit event\'s actor_name');

    // ── And the panel's own "Decision history" reads it ─────────────────────
    // Not a duplicate of the assertion above. `module_compliance_settings` is
    // an UPSERT — one row per (org, module, rule) — so the controls can only
    // ever show the LATEST decision, and the trail is the only thing that will
    // still hold this reason after somebody reverses it. It is fetched on FIRST
    // OPEN rather than on mount, so it has to be opened.
    await page.goto('/settings/organisation?tab=compliance');
    await settle(page);
    const panel = page.locator('[role="tabpanel"]').first();
    const show = panel.getByRole('button', { name: /^Show history$/ });
    await expect(show, 'the compliance panel offers no decision history')
      .toBeVisible({ timeout: 40_000 });
    await show.click();
    const entry = panel.locator('.cmpl__hev').filter({ hasText: CMPL_LABEL }).first();
    await expect(entry, `no history entry for "${CMPL_LABEL}" — the decision is stored but `
      + 'the trail cannot show it, so a later reversal would take this reason off every '
      + 'screen with it').toBeVisible({ timeout: 25_000 });
    const entryText = (await entry.innerText()).replace(/\s+/g, ' ').trim();
    expect(entryText, 'the history entry does not say what the decision changed FROM, '
      + 'which is what tells a first answer apart from a reversal')
      .toContain(`${STATE_LABEL.applicable} → ${STATE_LABEL[CMPL_TARGET.state]}`);
    expectIsAName(entryText, 'the rendered history entry');

    // eslint-disable-next-line no-console
    console.log(`4.1 delta · stored decisions ${state.cmplSettersBefore} → ${after}; `
      + `${CMPL_MODULE}.${CMPL_RULE} = ${rule.state}, set by ${rule.set_by_name}`);
  });

// ══ 4.2 · PAHCHAN CONSENT ════════════════════════════════════════════════════

test('4.2 baseline · twelve faces, and what the roster says before anybody answers',
  async ({ page }) => {
    await page.goto('/');
    await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), TARGET_ORG);

    const roster = await apiOk(page, 'get', '/api/v1/pahchan/consent/roster');
    const people = roster.employees ?? [];
    expect(people.length, 'the consent roster is empty — this org has no employees on the '
      + 'rolls, so nobody can be asked').toBeGreaterThan(0);

    const person = people.find((p: any) => p.employee_code === CONSENT_EMPLOYEE.code);
    expect(person, `${CONSENT_EMPLOYEE.code} is not on the consent roster. That roster is `
      + '`still_on_the_rolls`, so either the employee left or the seed changed.')
      .toBeTruthy();

    state.consentStanceBefore = person.consented;
    state.consentAnsweredBefore = answeredCount(roster);
    // eslint-disable-next-line no-console
    console.log(`4.2 baseline · ${state.consentAnsweredBefore} of ${people.length} people `
      + `on the rolls carry a recorded answer; ${CONSENT_EMPLOYEE.code} is `
      + `${JSON.stringify(person.consented)}`);
  });

test('4.2 · the employee answers for herself, from Pahchan ▸ Consent',
  async ({ browser }) => {
    test.setTimeout(240_000);
    const { email, password } = creds(CONSENT_EMPLOYEE.n);

    // A context of her own, with NO storage state: this is the one write in
    // this file that god mode cannot make, and borrowing its token would be
    // testing a different person.
    const ctx = await browser.newContext({ baseURL: BASE });
    const p = await ctx.newPage();
    try {
      // Signed in through the real form. `login` is rate limited at 5/min,
      // which is why exactly one account signs in here.
      await p.goto('/login');
      const emailBox = p.locator('#au-email, input[type="email"]').first();
      const passBox = p.locator('#au-password, input[type="password"]').first();
      await expect(emailBox, 'the sign-in form has no email field').toBeVisible();
      await emailBox.fill(email);
      await passBox.fill(password);
      await p.getByRole('button', { name: /Sign in|Log ?in/i }).first().click();
      await p.waitForURL(/\/(dashboard|boards|tasks|projects)/, { timeout: 45_000 });

      // She belongs to exactly one organisation, but the header is pinned
      // anyway — an unset key resolves to the OLDEST membership server-side,
      // and "it happens to be the only one" is not an assertion.
      await p.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), TARGET_ORG);
      await p.goto('/pahchan');
      await settle(p);
      const org = await activeOrgId(p);
      expect(org, 'the employee session is not in E2E Test & Associates').toBe(TARGET_ORG);
      expect(org, 'the employee session is in Unicode Group').not.toBe(FORBIDDEN_ORG);

      // ── The screen ───────────────────────────────────────────────────────
      await openTab(p, /^Consent$/);
      const panel = p.locator('[role="tabpanel"]').first();

      // WAIT FOR THE PANEL TO SETTLE BEFORE READING IT. `Consent` renders a
      // skeleton until `GET /pahchan/me` lands; asking "are the buttons there?"
      // the instant the tab opens asks an empty panel and gets 0, which is not
      // "already answered" — it is "not drawn yet", and the two are opposite
      // instructions.
      const notLinked = panel.getByText(/not linked to an employee record/i);
      const agreeBtn = panel.getByRole('button', { name: /^I agree to the photograph$/ });
      const withdrawBtn = panel.getByRole('button', { name: /^Withdraw my agreement$/ });
      const declineBtn = panel.getByRole('button', { name: /^I decline$/ });
      await expect(agreeBtn.or(withdrawBtn).or(notLinked),
        'the Consent panel never resolved into any of its states — /pahchan/me did not '
        + 'answer, or the tab that opened is not the consent screen')
        .toBeVisible({ timeout: 40_000 });

      // THE ASSERTION PHASE 0.23 EXISTS FOR. Before the employee↔login link,
      // this panel could only ever say "your account is not linked", and
      // `POST /consent/me` answered 409 for every account on the database.
      await expect(notLinked,
        'the consent screen still says this account is not linked to an employee record — '
        + 'manav_employees.user_id is NULL for it, so POST /consent/me will 409')
        .toHaveCount(0);

      // The six DPDP disclosure lines have to be ON SCREEN. A consent screen
      // that asks before it tells is the thing this module refuses elsewhere,
      // and an empty notice block would make the answer below worthless.
      await expect(panel.locator('.ph__consent-fact'),
        'the consent screen renders no disclosure lines, so nothing is being consented TO')
        .not.toHaveCount(0);

      const already = await withdrawBtn.count();
      if (already) {
        // She has already agreed. The opposite control is "Withdraw my
        // agreement", which records `consented: false` — a decline nobody gave,
        // which stops every future enrolment and clock-in photograph for her
        // from any source. It is not pressed. See the header.
        state.consentWrote = false;
        // eslint-disable-next-line no-console
        console.log(`4.2 · ${CONSENT_EMPLOYEE.name} has already agreed; this run records `
          + 'nothing and verifies the stored row instead');
      } else {
        await expect(agreeBtn, 'the consent screen offers no way to agree').toBeVisible();
        await expect(declineBtn, 'the consent screen offers no way to decline — a consent '
          + 'control with only one answer is not a consent control').toBeVisible();

        const saved = await submitting(p, '/v1/pahchan/consent/me', async () => {
          await agreeBtn.click();
        });

        expect(saved.consented, 'the server did not store an agreement').toBe(true);
        // `self_acknowledged` is the value migration 209's CHECK describes as the
        // strongest evidence and that NO route could write until `/consent/me`
        // shipped: the admin endpoint's own validator refuses it
        // (`^(paper|verbal_witnessed)$`). It is produced here by the employee's
        // own login pressing the button, which is the only way it can be.
        expect(saved.method, 'the answer was not recorded as the employee\'s own')
          .toBe('self_acknowledged');
        expect(saved.notice_version, 'the answer is not pinned to the wording that was on '
          + 'screen, so what she agreed to is unknowable').toBe(NOTICE_VERSION);
        expect(saved.recorded_at, 'the answer carries no timestamp').toBeTruthy();
        state.consentWrote = true;
      }

      // ── And the screen says where she stands ─────────────────────────────
      await expect(panel.getByText('Agreed', { exact: true }).first(),
        'the consent screen does not show her as agreed after the answer was recorded')
        .toBeVisible({ timeout: 20_000 });
      await expect(panel.getByText(/No answer yet/),
        'the screen still says no answer is recorded').toHaveCount(0);

      // ── The canonical row, from the endpoint the screen reads on load ────
      const me = await apiOk(p, 'get',
        `/api/v1/pahchan/me?days=1&notice_version=${encodeURIComponent(NOTICE_VERSION)}`);
      expect(me.employee, 'GET /pahchan/me resolves no employee for this account')
        .toBeTruthy();
      expect(me.consent, 'GET /pahchan/me carries no consent — pahchan_employee_consents '
        + 'is still empty for her and the write did not land').toBeTruthy();
      expect(me.consent.consented, 'the stored answer is not an agreement').toBe(true);
      expect(me.consent.method, 'the stored answer is not self_acknowledged')
        .toBe('self_acknowledged');
      expect(me.consent.notice_version, 'the stored answer names the wrong notice version')
        .toBe(NOTICE_VERSION);

      await shot(p, `phase4-consent-recorded-${RUN}`);
    } finally {
      await ctx.close();
    }
  });

test('4.2 canonical · the admin roster shows her answer, and only hers moved',
  async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), TARGET_ORG);

    const roster = await apiOk(page, 'get', '/api/v1/pahchan/consent/roster');
    const person = (roster.employees ?? []).find(
      (r: any) => r.employee_code === CONSENT_EMPLOYEE.code);
    expect(person, `${CONSENT_EMPLOYEE.code} left the consent roster between the write and `
      + 'the read-back').toBeTruthy();
    expect(person.consented, 'the roster does not show her agreement, so the row the '
      + 'employee wrote is not the row the admin surface reads').toBe(true);
    expect(person.method, 'the roster reports the wrong method').toBe('self_acknowledged');
    expect(person.recorded_at, 'the roster row carries no timestamp').toBeTruthy();
    // `recorded_by_name`, never `recorded_by` — the column is a user id.
    expectIsAName(String(person.recorded_by_name ?? ''), 'the roster\'s recorded_by_name');
    expect(person.recorded_by_name, 'somebody else is recorded as having given her answer')
      .toBe(CONSENT_EMPLOYEE.name);

    // A DELTA, never an absolute — see 4.1's read-back for why.
    const after = answeredCount(roster);
    const expected = (state.consentAnsweredBefore ?? 0) + (state.consentWrote ? 1 : 0);
    expect(after, `recorded answers went ${state.consentAnsweredBefore} → ${after}; this `
      + `run ${state.consentWrote ? 'recorded one' : 'recorded none'}, so it must be at `
      + `least ${expected}`).toBeGreaterThanOrEqual(expected);
    expect(after, 'pahchan_employee_consents still holds no answer for this org')
      .toBeGreaterThanOrEqual(1);

    // ── And an admin sees it on the screen, not only in the payload ─────────
    await page.goto('/pahchan');
    await settle(page);
    await openTab(page, /^Consent$/);
    const panel = page.locator('[role="tabpanel"]').first();
    const row = panel.locator('tr').filter({ hasText: CONSENT_EMPLOYEE.code }).first();
    await expect(row, `the admin roster table has no row for ${CONSENT_EMPLOYEE.code}. `
      + 'This section 403s for anyone who is not org_owner/org_admin, so an absent table '
      + 'means the session is not an admin of this org.').toBeVisible({ timeout: 40_000 });
    await expect(row.getByText('Agreed', { exact: true }),
      'the roster row does not show her as agreed').toBeVisible();
    // `.ph__name`, not a loose text match. Her name appears TWICE in this row —
    // once as the employee and once inside "· by Tara Mehta", because she
    // recorded her own answer — and a bare `getByText` is a strict-mode
    // violation rather than an assertion. The two cells say different things
    // and both are worth pinning.
    await expect(row.locator('.ph__name'),
      'the roster row does not name the employee').toHaveText(CONSENT_EMPLOYEE.name);
    await expect(row.locator('.ph__consent-when'),
      'the roster row does not say how the answer was obtained, or who recorded it')
      .toHaveText(new RegExp(`answered themselves.*by ${CONSENT_EMPLOYEE.name}`));

    await shot(page, `phase4-consent-roster-${RUN}`);

    // eslint-disable-next-line no-console
    console.log(`4.2 delta · recorded answers ${state.consentAnsweredBefore} → ${after}; `
      + `${CONSENT_EMPLOYEE.code} = agreed, ${person.method}, by ${person.recorded_by_name}`);
  });
