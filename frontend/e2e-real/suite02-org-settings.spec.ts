/**
 * Proposal 93 · Stage 3 · WAVE 1 · SUITE 02 — org settings, on Unicode Group.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CREDENTIALS
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ This header used to say both stored tokens expired 2026-08-27. **That was
 * stale, and it cost a whole session**: reading it as true is why Wave 1 first
 * ran on an E2E fallback lane instead of the reference lane §14 requires.
 * Re-measured 2026-08-28: `E2E_UNICODE_TOKEN` and `E2E_UK_OWNER_TOKEN` both
 * answer `200` on `GET /api/v1/org/profile` and resolve to their own orgs.
 * Tokens expire ~2026-09-04 — to mint longer ones the owner signs in with
 * **"Keep me signed in"** ticked (`JWT_REMEMBERED_DAYS=365` against
 * `JWT_TTL_DAYS=7`). Do NOT change that constant; it is a product security
 * setting.
 *
 * ⚠ Several tests here additionally need **org_owner**, not org_admin — see
 * 02.3. Of the five Unicode seats only `kevalvshah03@gmail.com` is the owner.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LANE GUARD — and why it is in this file rather than trusted elsewhere
 * ═══════════════════════════════════════════════════════════════════════════
 * On 2026-08-28 THIS SUITE renamed **Aekam Inc** — the one org proposal 93
 * guarantees is untouched — to "Unicode Group" and wrote a UPI row into it. The
 * credential held `platform_admin`, so every request resolved to Aekam via
 * `platform_bypass`, the save genuinely succeeded, and the suite went GREEN.
 *
 * `_lanes.ts::assertOrg()` was written that day as the countermeasure. It has
 * been found not running **twice since**: once on 2026-08-28 (commit ae7f0510,
 * "the org guard had never run"), which repaired the backend echo it compares
 * against but left its own first finding — *no spec imported it* — standing;
 * and again today, where a grep for `assertOrg` across every spec still
 * returned only the file that defines it.
 *
 * *A gate nobody has seen fail is decoration* — 93 §0. So it is now imported
 * here and called inside `signInAs()`, which is the ONLY way into this suite —
 * a test cannot reach a form without passing it. It is **proved to bite by
 * mutation**: pointing the lane at another org id turns the suite red with the
 * WRONG ORG message, and restoring it turns it green.
 *
 * The `E2E_GODMODE_TOKEN` fallback that used to sit in `resolveLane()` is gone
 * with it. That was the same credential class that caused the incident, one
 * expired token away from silently driving Aekam Inc while printing
 * "LANE: Unicode Group (reference lane)". Rule 1 of `_lanes.ts` is absolute:
 * **write suites never use a platform credential.** God mode is Suite 19.
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
import { test, expect, Page, Locator } from '@playwright/test';
import { readFileSync } from 'fs';
import * as path from 'path';
import { ORG as ORG_IDS, assertOrg, laneIdentity, lane as laneOf, type Lane as OrgLane } from './_lanes';

const BLOCKED =
  'BLOCKED — no Unicode Group credential. Set E2E_UNICODE_TOKEN (or ' +
  'E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e at the repo root. ⚠ It must be an ' +
  'ORG-SCOPED account: a platform_admin token resolves to Aekam Inc via ' +
  'platform_bypass and will write there. ENVIRONMENT blocker, not a product ' +
  'or test defect.';

type Creds = { email: string; password: string };

/**
 * THE LANE — announced, never assumed. Mirrors suite01-auth.spec.ts.
 *
 * §14 makes Unicode the reference lane, and `E2E_UNICODE_TOKEN` reaches it
 * (re-measured 2026-08-28), so branch 2 is what runs today. Branch 3 exists
 * only so that a missing credential does not stop the programme dead.
 *
 * ⚠ An E2E run is NOT a Unicode run. §14 compares the Unicode pass against the
 * UK replay, and a silent third org in the middle corrupts that comparison — so
 * the lane is printed on every run, and `assertOrg()` proves it against the org
 * id the SERVER resolved rather than against the label printed here.
 */
type Lane = { creds: Creds; org: string; orgId: string; reference: boolean; token?: string };

function resolveLane(): Lane {
  // 0. ⚠ STAGE 4 — the UK replay (§14), and it is opt-in by env var so that a
  //    run with `E2E_LANE` unset is byte-for-byte the Unicode run every banked
  //    Stage 3 result came from. Without this branch the suite could not be
  //    pointed at UK AekamINC at all, which is §14's own first category — "the
  //    suite carried a hidden dependency on Unicode's state" — in its strongest
  //    form: a dependency on Unicode's IDENTITY, frozen at import time.
  //
  //    `E2E_UK_OWNER_TOKEN` is an ORG-SCOPED org_owner on UK, not a platform
  //    credential, so rule 1 of `_lanes.ts` holds and `assertOrg()` still proves
  //    the target from the id the SERVER resolved.
  const laneKey = (process.env.E2E_LANE || '').trim().toLowerCase();
  if (laneKey === 'uk') {
    const ukToken = process.env.E2E_UK_OWNER_TOKEN;
    if (!ukToken) {
      throw new Error(
        'BLOCKED — E2E_LANE=uk but E2E_UK_OWNER_TOKEN is not in .env.e2e. ' +
        'ENVIRONMENT blocker, not a product or test defect.',
      );
    }
    return {
      creds: { email: 'keval.shah@unicodegroup.com', password: '' },
      org: 'UK AekamINC',
      orgId: ORG_IDS.UK,
      reference: false,
      token: ukToken,
    };
  }

  // 1. Unicode with a password — the ideal: reference lane, real form login.
  const uniEmail = process.env.E2E_UNICODE_EMAIL;
  const uniPassword = process.env.E2E_UNICODE_PASSWORD;
  if (uniEmail && uniPassword) {
    return {
      creds: { email: uniEmail, password: uniPassword },
      org: 'Unicode Group', orgId: ORG_IDS.UNICODE, reference: true,
    };
  }

  // 2. Unicode by TOKEN — what the owner supplied on 2026-08-28. Still the
  //    reference lane, and every row is still typed; only the door is opened
  //    differently. See signIn() for exactly where that line sits.
  //
  // ⚠ THERE IS NO `E2E_GODMODE_TOKEN` FALLBACK HERE, and its absence is the
  // point. It used to be the second half of this `||`, which meant one expired
  // Unicode token stood between this suite and driving **Aekam Inc** — the
  // thing that actually happened on 2026-08-28 — while still printing
  // "LANE: Unicode Group (reference lane)" to the run log. A write suite that
  // can silently fall back to a platform credential has no lane at all.
  const uniToken = process.env.E2E_UNICODE_TOKEN;
  if (uniToken) {
    return {
      creds: { email: 'kevalvshah03+1@gmail.com', password: '' },
      org: 'Unicode Group',
      orgId: ORG_IDS.UNICODE,
      reference: true,
      token: uniToken,
    };
  }

  // 3. E2E by password — a fallback lane, and it announces itself as one.
  const email = process.env.E2E_APPROVER_EMAIL;
  const password = process.env.E2E_APPROVER_PASSWORD;
  if (!email || !password) throw new Error(BLOCKED);
  return {
    creds: { email, password },
    org: 'E2E Test & Associates', orgId: ORG_IDS.E2E, reference: false,
  };
}

const LANE = resolveLane();

/** ⚠ The identity this lane is allowed to type. See `_lanes.ts::laneIdentity` —
 *  it exists because `assertOrg()` guards WHERE a suite writes, never WHAT. */
const ID = laneIdentity(
  laneOf(LANE.orgId === ORG_IDS.UK ? 'uk' : LANE.orgId === ORG_IDS.E2E ? 'e2e' : 'unicode'),
);

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

/**
 * Sign in, then REFUSE TO CONTINUE unless the session resolved to this lane's
 * organisation.
 *
 * ⚠ The guard lives inside the sign-in helper deliberately, rather than being
 * a line each test remembers to write. `assertOrg()` has now been found not
 * running twice — it was written on 2026-08-28 and no spec had ever imported
 * it, on that day or since. A countermeasure that depends on being remembered
 * is a countermeasure that will be forgotten; one that a test cannot get past
 * the door without is not.
 *
 * It asserts the org **ID**, never the name on screen — the name is precisely
 * what got corrupted in the incident, so a name check would have passed while
 * Aekam Inc was called "Unicode Group".
 */
async function signInAs(page: Page, creds: Creds) {
  await signIn(page, creds);
  await assertOrg(page.request, page, {
    key: LANE.reference ? 'unicode' : 'e2e',
    org: LANE.org,
    orgId: LANE.orgId,
    reference: LANE.reference,
  } as OrgLane);
}

/**
 * THE WIRE — every write this suite makes, with the status the server answered.
 *
 * Memory's rule, learned from the bank-import bug: *watch the requests before
 * blaming the UI*. That defect presented as "the button does nothing" and as a
 * CORS error in the console; it was a 500, and only a request listener told the
 * two apart. A failure here therefore reports what the server actually said
 * instead of leaving the next reader to guess from an empty input box.
 */
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

/**
 * Click a Save button and WAIT FOR THE WRITE TO ANSWER before going on.
 *
 * ⚠ This is the fix for three of Suite 02's four failures on 2026-08-28.
 * 02.2, 02.4 and 02.5 each clicked Save and then called `page.reload()` on the
 * very next line. The reload raced the request — the browser tore down the
 * page while the PATCH/PUT was still in flight — so the value read back empty
 * and the suite reported "the product did not save it". It had: `save-probe`
 * watched the same click and recorded `PUT /upi-accounts -> 200`, and
 * `GET /upi-accounts` then returned the stored row, and a read-back probe
 * showed the screen rendering it. The product was right and the test was wrong,
 * which is suite rule 5 — wait for the write, and for the refetch after it.
 *
 * Returns the response so the caller can assert on the STATUS, not on a toast.
 * A toast is the client's opinion; the status is the server's.
 */
async function saveAndWait(page: Page, button: RegExp, urlRe: RegExp) {
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => urlRe.test(r.url()) && ['POST', 'PUT', 'PATCH'].includes(r.request().method()),
      { timeout: 30_000 },
    ),
    page.getByRole('button', { name: button }).click(),
  ]);
  return res;
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
    await signInAs(page, requireUnicode());
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

    // ⚠ THE IDENTITY COMES FROM THE LANE, NEVER FROM A LITERAL — Stage 4, §14.
    // These seven lines used to type 'Unicode Group' / 'Ahmedabad' / 'Gujarat'
    // as constants. `assertOrg()` guards WHERE this suite writes and cannot
    // guard WHAT it writes, so on the UK lane that would have passed the org
    // guard and then RENAMED UK AekamINC to "Unicode Group" and moved it to
    // Gujarat — the content half of the 2026-08-28 incident. `laneIdentity()`
    // carries the reasoning and the §9 state-pair constraint in full.
    await page.locator('#org-name').fill(ID.name);
    await page.locator('#org-l1').fill(ID.line1);
    await page.locator('#org-l2').fill(`Suite ${RUN.slice(-4)}`);
    await page.locator('#org-city').fill(ID.city);
    await page.locator('#org-state').fill(ID.state);
    await page.locator('#org-pin').fill(ID.pin);
    await page.locator('#org-country').fill(ID.country);

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
    await expect(page.locator('#org-city')).toHaveValue(ID.city, { timeout: 30_000 });
    await expect(page.locator('#org-state')).toHaveValue(ID.state);
    await expect(page.locator('#org-l2')).toHaveValue(`Suite ${RUN.slice(-4)}`);
  });

  test('02.2 GSTIN, PAN and TAN block nothing — a blank save succeeds', async ({ page }) => {
    // THE regression this product keeps re-growing. Asserted on its own so a
    // failure here names itself instead of being one line inside 02.1.
    const wire = watchWire(page);
    await signInAs(page, requireUnicode());
    await openTab(page, 'profile');

    await expect(page.locator('#org-gstin')).toBeVisible({ timeout: 30_000 });

    // ⚠ CLEARED BY KEYSTROKE, NOT BY `fill('')` — and this was a TEST BUG that
    // very nearly became a product bug report.
    //
    // On 2026-08-28 this test cleared the three fields with `fill('')`, clicked
    // Save, and NOTHING reached the server: no request, no toast, and
    // `GET /org/profile` still returned the original GSTIN. Read cold, that is
    // "a firm cannot remove its GSTIN", which is the regression CLAUDE.md warns
    // about and would have been filed as one.
    //
    // `gstin-blank-probe.spec.ts` cleared the SAME field on the SAME screen with
    // a real select-all and Delete, and got `PATCH 200` with
    // "Company profile saved". The product removes a GSTIN perfectly well.
    // `fill('')` simply did not register with the controlled input, so
    // TabProfile's change-diff found nothing changed and correctly declined to
    // send an empty PATCH.
    //
    // This is §1's rule arriving with a bill attached: drive real key events,
    // because `fill()` is not typing.
    // ⚠ SET THEM FIRST, THEN CLEAR THEM — idempotence, and it was a real defect
    // in this test. §6 requires "a second execution recognises its own output
    // and verifies rather than duplicating". This test cleared three fields and
    // left them cleared, so its NEXT run had nothing to change: the diff found
    // no change, no PATCH was sent, and `waitForResponse` timed out. It passed
    // alone and failed in the suite, which is the signature of a test that
    // depends on state it did not create.
    //
    // Setting them first also buys the coverage that matters. The product bug
    // found on 2026-08-28 was on REMOVE, not on add — a blank TAN was written
    // as "" against a column whose CHECK accepts only NULL or a well-formed TAN,
    // and the 500 took the whole form with it. Add-then-remove exercises both
    // directions in one pass.
    const CODES: [string, string][] = [
      ['#org-gstin', ID.gstin],
      ['#org-pan', ID.pan],
      ['#org-tan', ID.tan],
    ];

    for (const [id, value] of CODES) {
      const field = page.locator(id);
      await field.click();
      await field.press('ControlOrMeta+a');
      await field.pressSequentially(value);
      await expect(field).toHaveValue(value);
    }
    const set = await saveAndWait(page, /Save company profile/, /\/org\/profile/);
    expect(set.status(), `SETTING the statutory codes answered ${set.status()}.${dump(wire)}`)
      .toBeLessThan(400);

    // Now remove all three. This is the direction that was broken.
    for (const [id] of CODES) {
      const field = page.locator(id);
      await field.click();
      await field.press('ControlOrMeta+a');
      await field.press('Delete');
      await expect(field).toHaveValue('');
    }

    // The button must not be disabled by an empty tax field.
    const save = page.getByRole('button', { name: /Save company profile/ });
    await expect(save).toBeEnabled();

    // ⚠ ASSERT THE STATUS FIRST, then the toast. On 2026-08-28 this test failed
    // waiting for a toast that never came, and a missing toast cannot tell
    // "the save was refused" from "the confirmation is not shown". Only the
    // response separates them — and if a blank statutory field is being
    // REFUSED, that is the regression CLAUDE.md says has drifted back more than
    // once, so it must name itself rather than read as a UI nicety.
    const res = await saveAndWait(page, /Save company profile/, /\/org\/profile/);
    expect(
      res.status(),
      `GSTIN / PAN / TAN MUST BLOCK NOTHING — a blank save was answered ` +
      `${res.status()}.${dump(wire)}`,
    ).toBeLessThan(400);

    // It must SAVE — not warn, not block.
    // ⚠ TEST BUG, fixed. The bare text matched TWO nodes — the sr-only
    // aria-live region AND the visible toast — and strict mode rightly refused.
    // Both existing is the product doing accessibility CORRECTLY: the
    // announcement and the visible confirmation are deliberately separate
    // nodes. Scoped to the toast, with the sr-only twin asserted on its own so
    // the fix does not quietly drop the a11y coverage it was tripping over.
    // ⚠ `.last()`, and `not.toHaveCount(0)` rather than `toHaveCount(1)`.
    // This test now saves TWICE by design — set the codes, then clear them —
    // so two confirmations are on screen and strict mode rightly refused the
    // ambiguous locator. Two toasts is the product behaving correctly: it
    // confirmed both saves. The assertion that matters is that the LAST save,
    // the one that cleared the fields, was confirmed.
    await expect(page.locator('.tst__t').getByText(/Company profile saved/i).last())
      .toBeVisible({ timeout: 30_000 });
    // The sr-only announcement is a separate node from the visible toast — that
    // separation is the product doing accessibility correctly, and it must not
    // be lost while fixing the count.
    await expect(page.locator('[aria-live="polite"]').getByText(/Company profile saved/i))
      .not.toHaveCount(0);
    // And no field may be marked invalid for being empty.
    await expect(page.locator('#org-gstin')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#org-pan')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#org-tan')).not.toHaveAttribute('aria-invalid', 'true');

    await page.reload();
    await expect(page.locator('#org-gstin')).toHaveValue('', { timeout: 30_000 });
    await expect(page.locator('#org-pan')).toHaveValue('');
    await expect(page.locator('#org-tan')).toHaveValue('');
  });

  test('02.2b a mistyped TAN is kept and warned about — it does not eat the form', async ({ page }) => {
    // ═══════════════════════════════════════════════════════════════════════
    // THE SECOND HALF OF THE TAN DEFECT, and the one that only a browser finds.
    //
    // The router has always told the customer, in these words:
    //   "A TAN is four letters, five digits and one letter — for example
    //    AHMA12345B. 'AHMA123' does not look like one. It has been saved as
    //    typed."
    // and `organisations_tan_format` then refused the write. So it was NOT
    // saved as typed: CheckViolationError -> a 500 that escaped before the CORS
    // headers -> `net::ERR_FAILED` in the browser -> "Failed to save profile"
    // on screen, naming no field.
    //
    // ⚠ AND THE PATCH CARRIES THE WHOLE FORM. The assertion that matters here
    // is therefore NOT about the TAN. It is that the LEGAL NAME typed in the
    // same sitting survives. A firm reading one character wrong off a TDS
    // certificate lost its name, address, state, email, phone and bank details
    // in the same click. That is invisible to every row count — the row is
    // simply unchanged — and indistinguishable, to the person looking at it,
    // from "the Save button does not work".
    //
    // Migration 238 dropped the constraint. Validation did not vanish; it moved
    // to where a wrong TAN actually costs something — `doc_validation.py`
    // refuses to build a TDS challan against one. The settings page records
    // what the customer says about their own firm; the statutory document is
    // where the statute is enforced.
    // ═══════════════════════════════════════════════════════════════════════
    const wire = watchWire(page);
    await signInAs(page, requireUnicode());
    await openTab(page, 'profile');

    const name = page.locator('#org-name');
    const tan = page.locator('#org-tan');
    await expect(tan).toBeVisible({ timeout: 30_000 });

    // The name as it stands, so this test restores exactly what it found and a
    // second run starts where the first did. §6.
    const nameBefore = await name.inputValue();
    expect(nameBefore, 'precondition: the org must have a legal name').toBeTruthy();

    // A DIFFERENT name each direction, so "it survived" cannot be satisfied by
    // the field simply never having changed.
    const nameTyped = `${LANE.org} (TAN probe)`;
    for (const [field, value] of [[name, nameTyped], [tan, 'AHMA123']] as const) {
      await field.click();
      await field.press('ControlOrMeta+a');
      await field.pressSequentially(value);
      await expect(field).toHaveValue(value);
    }

    const res = await saveAndWait(page, /Save company profile/, /\/org\/profile/);
    expect(
      res.status(),
      `A MISTYPED TAN WAS REFUSED — answered ${res.status()}. GSTIN/PAN/TAN ` +
      `must block nothing, and this save also carried the legal name.${dump(wire)}`,
    ).toBeLessThan(400);

    // Warned, because accepted is not the same as unremarked — the TAN is the
    // one of the three a document depends on.
    //
    // ⚠ TEST BUG, found and fixed on this test's first run and worth recording:
    // this asserted `.tst__t` — the toast TITLE — for the message text.
    // `components/ui/toast.jsx:328-329` renders the title in `.tst__t` and the
    // message in `.tst__s`, so the locator could never match and the failure
    // read as "the product does not warn". The page context from that run shows
    // it warned in BOTH places. Copying 02.2's locator without reading what it
    // selected is exactly the shortcut suite rule 6 exists to stop.
    //
    // The field-level alert is asserted FIRST because it is the one the
    // customer reads: it sits beside the TAN box, and it is where the promise
    // "It has been saved as typed" is actually made.
    await expect(page.getByRole('alert').getByText(/has been saved as typed/i))
      .not.toHaveCount(0);
    await expect(page.locator('.tst__s').getByText(/do not look right/i).last())
      .toBeVisible({ timeout: 30_000 });

    // THE ASSERTION THIS TEST EXISTS FOR. Read back from the server, not from
    // the DOM the save left behind.
    await page.reload();
    await expect(name).toHaveValue(nameTyped, { timeout: 30_000 });
    await expect(tan).toHaveValue('AHMA123');

    // Put it back — the name to what it was, the TAN to empty, which the blank
    // path (02.2) has already proved is legal.
    await name.click();
    await name.press('ControlOrMeta+a');
    await name.pressSequentially(nameBefore);
    await tan.click();
    await tan.press('ControlOrMeta+a');
    await tan.press('Delete');
    const restored = await saveAndWait(page, /Save company profile/, /\/org\/profile/);
    expect(restored.status(), `restore failed: ${restored.status()}${dump(wire)}`).toBeLessThan(400);
    await page.reload();
    await expect(name).toHaveValue(nameBefore, { timeout: 30_000 });
    await expect(tan).toHaveValue('');
  });

  test('02.3 modules — the grid reflects the subscription, and stays read-only', async ({ page }) => {
    await signInAs(page, requireUnicode());
    await openTab(page, 'modules');

    // ═══════════════════════════════════════════════════════════════════════
    // ⚠ THIS TEST USED TO ASSERT THE OPPOSITE, AND THE CHANGE IS DELIBERATE.
    //
    // Until 2026-08-28 it asserted `active: 0` and "every card says Not on your
    // plan", because Unicode genuinely held ZERO `module_subscriptions` rows —
    // the true day-one state of a brand-new customer. Suite 19 has since
    // provisioned 12 modules from the platform console, so that state is gone
    // and cannot be recreated without wiping the subscription again.
    //
    // The day-one evidence is NOT lost by rewriting this: it was captured while
    // it existed, by `dayone-module-403.spec.ts` and `dayone-capture.spec.ts`,
    // and the finding it produced is recorded in STATUS.md — with no module
    // active, `/graha` says "You do not have access to CRM reports" (a
    // PERMISSION framing) while the API says "Module not active, contact your
    // administrator" (the ACTIONABLE one). 4 screens right, 4 wrong. That
    // remains open and is not closed by this rewrite.
    //
    // What this test asserts now is the thing worth guarding going forward:
    // the customer-facing grid TELLS THE TRUTH about the subscription, and is
    // still not a control the customer can operate.
    // ═══════════════════════════════════════════════════════════════════════

    const cards = page.locator('.omod__c');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    const total = await cards.count();

    // `ModuleCard` renders `.omod__s.on` with the word "Active", and a bare
    // `.omod__s` reading "Not on your plan". Asserting on the STATE CLASS the
    // component sets, not on the styling around it.
    const active = await page.locator('.omod__s.on').count();
    const notOnPlan = await page.locator('.omod__s', { hasText: 'Not on your plan' }).count();
    console.log(`\n[suite02] module cards: ${total}, active: ${active}, "Not on your plan": ${notOnPlan}\n`);

    // Every card is in exactly one of the two states — no card is blank, which
    // is what a missing `is_active` would look like.
    expect(active + notOnPlan, 'a module card rendered neither state').toBe(total);

    // The grid must agree with the server rather than with itself.
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    const res = await page.request.get(`${API_BASE}/api/v1/subscription/current`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    expect(res.ok(), `GET /subscription/current -> ${res.status()}`).toBeTruthy();
    const body = await res.json();
    const serverActive: string[] = body?.active_modules ?? body?.data?.active_modules ?? [];
    expect(
      active,
      `the grid shows ${active} active module(s); the server reports ` +
        `${serverActive.length} (${serverActive.join(', ')})`,
    ).toBe(serverActive.length);

    // ⚠ Varta is EXCLUDED BY DECISION (§13), not blocked. It must be off, and
    // the report must be able to say that it is off by choice — two silent
    // zeroes in `hub_publish_queue` read as a defect in six weeks' time.
    expect(serverActive, 'varta is excluded by decision (§13) and must not be active')
      .not.toContain('varta');

    // ── AND IT IS STILL NOT THE CUSTOMER'S CONTROL ─────────────────────────
    // `TabModules.jsx` passes `disabled` to every card and offers no `onToggle`
    // at all. That is deliberate: `middleware/subscription.py:120-126` lets any
    // org_admin reach every ACTIVE module without a grant row, so an org_admin
    // who could also ACTIVATE could hand themselves payroll in one request.
    // Activation is a term of the subscription and belongs to Aekam — 19.1
    // proves the API refuses an org-scoped credential; this proves the screen
    // does not offer it either.
    // ⚠ `role="switch"`, NOT `input[type="checkbox"]`. `ui/Toggle.jsx:22-26`
    // renders a real `<button role="switch" aria-checked>` — its header says
    // why: "A real button that applies immediately, as distinct from a checkbox
    // committed by a Save."
    //
    // This assertion was VACUOUS from the day it was written. The old locator
    // matched nothing, so `t` was 0, the loop ran zero times, and the test
    // passed while proving nothing at all — a gate nobody has seen fail is
    // decoration (93 §0). Found on 2026-08-28 only because Suite 19 made the
    // same claim WITH a count assertion and went red. The count is the fix.
    const toggles = page.locator('.omod__c [role="switch"]');
    const t = await toggles.count();
    expect(t, 'the modules grid rendered no toggles at all').toBe(total);
    for (let i = 0; i < t; i += 1) {
      await expect(toggles.nth(i)).toBeDisabled();
    }

    // And it says WHO can, rather than leaving the customer to guess why an
    // inert control is inert.
    await expect(
      page.getByText(/switched on by your\s+account manager at Aekam/i),
    ).toBeVisible();
  });

  test('02.4 email sender addresses save', async ({ page }) => {
    const wire = watchWire(page);
    await signInAs(page, requireUnicode());
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
    await page.locator(`#snd-${purpose}-name`).fill(ID.name);

    const res = await saveAndWait(page, /Save sender addresses/, /senders/);
    expect(res.status(), `saving a sender answered ${res.status()}.${dump(wire)}`)
      .toBeLessThan(400);
    await page.reload();
    await expect(first).toHaveValue('test@unicodegroup.com', { timeout: 30_000 });

    // Stored is not the same as in use, and the product must say so rather than
    // implying mail already goes out from this address.
    //
    // ⚠ SCOPED TO THE ROW THIS TEST JUST SAVED. It was `page.getByText(…)`
    // against the whole page, which resolved to NINE tags once the org had nine
    // saved senders and died on strict mode. Widening it with `.first()` would
    // have been worse than the crash: it would pass on any row's tag, including
    // one saved months ago, and say nothing about the address written here.
    const row = page.locator('section').filter({ has: page.locator(`#snd-${purpose}-email`) });
    await expect(row.getByText(/Saved — not in use yet|In use/),
      `the ${purpose} sender was stored and its row does not say whether mail actually ` +
      'goes out from it. Stored is not in use, and a screen that does not distinguish ' +
      'them tells a firm its address is live when nothing is sending from it')
      .toBeVisible();
  });

  test('02.5 UPI is one ID PER PLATFORM, not one VPA field', async ({ page }) => {
    const wire = watchWire(page);
    await signInAs(page, requireUnicode());
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
    await page.locator('#upi-paytm-name').fill(ID.name);
    await page.locator('#upi-phonepe').fill('unicodegroup@ybl');
    await page.locator('#upi-phonepe-name').fill(ID.name);
    await page.locator('#upi-gpay').fill('unicodegroup@okhdfcbank');
    await page.locator('#upi-gpay-name').fill(ID.name);

    const res = await saveAndWait(page, /Save UPI IDs/, /upi-accounts/);
    expect(res.status(), `saving UPI ids answered ${res.status()}.${dump(wire)}`)
      .toBeLessThan(400);
    await page.reload();
    await expect(page.locator('#upi-paytm')).toHaveValue('unicodegroup@paytm', { timeout: 30_000 });
    await expect(page.locator('#upi-phonepe')).toHaveValue('unicodegroup@ybl');
    await expect(page.locator('#upi-gpay')).toHaveValue('unicodegroup@okhdfcbank');
  });

  test('02.6 document number series', async ({ page }) => {
    const wire = watchWire(page);
    await signInAs(page, requireUnicode());

    // ⚠ NOT under /settings/organisation. `TabDocNumbers` is imported by
    // `GanitPage.jsx` and registered as `['settings', TabDocNumbers]` — it is a
    // Ganit screen, and the org-settings tab bar has no entry for it.
    //
    // ⚠⚠ AND IT CANNOT BE REACHED BY URL. Fixed 2026-08-28 after this test
    // failed on a stale assumption. `GanitPage` says so in its own words:
    // "This page reads its tab from nowhere deeper than local state — no URL
    // param, no route state", so `/ganit?tab=settings` renders whatever the
    // user's starred default is (invoices) and silently ignores the query. The
    // suite was asserting against Finance's invoice list and calling the
    // numbering screen missing.
    //
    // A USER GETS THERE BY CLICKING. Ganit shows seven tabs and a `More +14`
    // button, and `settings` is one of the fourteen behind it — which is also
    // why this is driven as a click rather than a navigation: the overflow menu
    // IS the only route, so if it ever stops opening, this screen becomes
    // unreachable and that must fail here.
    await page.goto('/ganit');
    await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 30_000 });

    const more = page.getByRole('button', { name: /^More/ });
    await expect(
      more,
      'Ganit hides 14 tabs behind a More button; without it the numbering ' +
      'screen has no route at all',
    ).toBeVisible({ timeout: 30_000 });
    await more.click();

    // ⚠ SCOPED TO THE POPOVER. A previous attempt used an `.or()` chain that
    // included a bare `button` named /settings/, and `.first()` resolves in DOM
    // order — so it matched the SIDEBAR, clicked that, and left Ganit sitting on
    // its invoice list. The suite then reported the numbering screen missing.
    // Suite rule 6: scope lookups to the surface you opened.
    //
    // `ModuleTabs` renders the overflow as `role="menu"` with `role="menuitem"`
    // rows — a keyboard contract, not decoration — and the label is the tab id
    // with hyphens spaced (`GanitPage.jsx:164`), so this one is literally
    // "settings".
    const menu = page.getByRole('menu');
    await expect(menu, 'the More button must open a menu').toBeVisible({ timeout: 15_000 });
    const settingsItem = menu.getByRole('menuitem', { name: /^settings$/i });
    await expect(
      settingsItem,
      'document numbering has no other route — if this row is gone the screen ' +
      'is unreachable, which is a product defect and not a selector problem',
    ).toBeVisible({ timeout: 15_000 });
    await settingsItem.click();

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

    // Real keystrokes, not `fill()` — 02.2 proved a controlled input can ignore
    // a programmatic fill entirely, and a save that sends nothing looks exactly
    // like a save the server refused.
    //
    // ⚠ AND THE VALUE MUST DIFFER FROM WHAT IS ALREADY THERE. §6: a second
    // execution has to verify rather than duplicate. Writing the same prefix
    // twice is not a save at all — the form diffs, finds nothing changed, sends
    // nothing, and the test reports a timeout that reads like a broken product.
    // This test failed exactly that way on its second run.
    // ⚠ AND THE PAIR COMES FROM THE LANE. These were the literals 'UNI'/'UNX'
    // — Unicode's own invoice series — so on any other org this test stamped a
    // Unicode-branded series onto somebody else's documents. Same defect class
    // as 02.1's hardcoded company name, and `assertOrg()` cannot catch either:
    // it guards WHERE this suite writes, never WHAT.
    const current = await box.inputValue();
    const prefix = current === ID.docPrefixA ? ID.docPrefixB : ID.docPrefixA;

    await box.click();
    await box.press('ControlOrMeta+a');
    await box.pressSequentially(prefix);
    await expect(box).toHaveValue(prefix);

    const saved = await saveAndWait(page, /^Save \d+ change/, /doc-prefixes|ganit/);
    expect(saved.status(), `saving a document prefix answered ${saved.status()}.${dump(wire)}`)
      .toBeLessThan(400);

    // ⚠ RE-NAVIGATED, NOT RELOADED — and the reason is a product fact worth
    // recording. `GanitPage` holds its open tab in local state with no URL
    // param, so `page.reload()` does not return to Numbering: it lands on the
    // starred default (invoices), where `.gn-form__grid` does not exist. The
    // suite read that as "the prefix did not persist".
    //
    // The consequence for a customer is real if minor: this screen cannot be
    // linked to, bookmarked, or recovered by refreshing. Recorded rather than
    // asserted — it is a design choice (tab prefs own the opening tab), not a
    // defect, and turning it into a red test would be inventing a requirement.
    await page.goto('/ganit');
    await page.getByRole('button', { name: /^More/ }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: /^settings$/i }).click();
    await expect(page.locator('.gn-form__grid input.inp').first())
      .toHaveValue(prefix, { timeout: 30_000 });
  });

  test('02.7 no UUID is rendered, and no native date input exists', async ({ page }) => {
    await signInAs(page, requireUnicode());

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

  /* ═══════════════════════════════════════════════════════════════════════
   * MEMBERS — §10's first missing screen, and the one every later wave needs.
   *
   * §10 lists 18 screens for Suite 02 and eight had tests. This is the first of
   * the ten that did not, and it goes first on purpose: waves 2-8 need PEOPLE —
   * somebody to put on payroll, assign a task to, approve leave for, route a
   * territory to. Those accounts are produced here, by invitation, or they are
   * not produced at all.
   *
   * ── The 409 that made this urgent ──────────────────────────────────────────
   * `org_invites.py:455` refuses an address that already has an account:
   *   409 "Someone with this email already has an account. Add them from the
   *        Members tab instead of inviting them."
   * R4 removed the member SEATS and left 25 accounts standing in the global
   * `public.users`, so every seeded address answered 409 and this lane could
   * not run at all. R4b deleted those 25 — see
   * `docs/plans/93-R4B-ACCOUNT-PURGE-RISK-REPORT.md`. 02.9 below is the live
   * proof that the addresses came back.
   *
   * ── How the invitation is carried, and why this is still rule 1 ────────────
   * `TabMembers.jsx` deliberately does NOT print the invite link on screen —
   * "it carries a working token, and a token on a settings page is a credential
   * anyone behind the operator can read". It offers a **Copy invite link**
   * button instead. So this suite does what the admin does: clicks that button
   * and reads the clipboard. Nothing is fabricated and no API is short-cut; the
   * link is the one the product minted and handed over.
   *
   * ── Idempotence (§6), which is proved by running twice, never claimed ──────
   * Every test here recognises its own output. 02.8 holds a fixed roster of
   * member SLOTS with deterministic addresses: a slot already seated is
   * verified and left alone, a slot with an invitation pending is re-issued,
   * and only a slot that is neither is invited afresh. A second run therefore
   * adds nobody and still asserts everything.
   * ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The persistent roster. Addresses are gmail plus-tags on the owner's own
   * mailbox — §3's scheme, and the half of the seeded population that is
   * genuinely checkable, because a person can open it and look.
   *
   * ⚠ Not `test+<tag>@unicodegroup.com`. That was measured on 2026-08-28 and it
   * BOUNCES: IONOS rejects the plus-tag, exactly as was doubted on 18 Aug.
   * `test@unicodegroup.com` with no tag delivers, but `public.users_email_key`
   * is UNIQUE table-wide, so that address can back exactly ONE login.
   */
  const SLOTS = [
    { tag: 'ops', name: 'Priya Nair', role: 'org_member' },
    { tag: 'adm', name: 'Rohan Desai', role: 'org_admin' },
  ];
  const slotEmail = (tag: string) => `kevalvshah03+u${tag}@gmail.com`;

  const API_BASE = process.env.E2E_API_URL || 'https://api.kartavaya.com';

  /** The member rows the SERVER holds, read fresh. The screen is the claim; this is the fact. */
  /**
   * ⚠ `X-Org-Id` IS NOT OPTIONAL HERE, and its absence was a real hole.
   *
   * `src/lib/api.js:39-40` puts the active org on EVERY request the product
   * makes. These helpers did not, so the server fell back to resolving the org
   * itself — and that fallback is *oldest membership*, not "the org this lane
   * is testing". A read helper that can silently answer for a different
   * organisation than the screen beside it is the same class of fault as the
   * 2026-08-28 cross-org incident, and it sat inside the suite written to catch
   * that. Sending the header is not a workaround: it is doing what the client
   * does, which is the only thing a test of the client may do.
   */
  const orgHeaders = (token: string | null) => ({
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'X-Org-Id': LANE.orgId,
  });

  async function members(page: Page) {
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    const res = await page.request.get(`${API_BASE}/api/v1/org/members`, {
      headers: orgHeaders(token),
    });
    expect(res.ok(), `GET /org/members -> ${res.status()}: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    return (Array.isArray(body) ? body : body.data ?? []) as any[];
  }

  /** The invitations still pending, same treatment. */
  async function pendingInvites(page: Page) {
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    const res = await page.request.get(`${API_BASE}/api/v1/org/invites`, {
      headers: orgHeaders(token),
    });
    if (!res.ok()) return [] as any[];
    const body = await res.json();
    return (Array.isArray(body) ? body : body.data ?? []) as any[];
  }

  const lower = (s: unknown) => String(s ?? '').toLowerCase();

  /**
   * Type an address into the real form, pick the role from the real select and
   * click the real button. Returns what the PRODUCT said happened — 'invited'
   * for a person with no account, 'added' for one who already had one.
   *
   * The two are told apart by the response's own `status` field, because that
   * is what `addMember()` itself branches on. Reading the toast would be
   * reading the client's opinion of the server's answer.
   */
  async function addOrInvite(page: Page, email: string, role: string) {
    await openTab(page, 'members');
    const box = page.locator('#add-email');
    await expect(box).toBeVisible({ timeout: 30_000 });

    // Real keystrokes, never fill(). `fill()` sets a value without firing key
    // events, and a controlled input can miss it — the fault behind 02.2's
    // false accusation that "a firm cannot remove its GSTIN".
    await box.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await box.pressSequentially(email, { delay: 12 });
    await page.locator('#add-role').selectOption(role);

    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => /\/org\/members$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      page.getByRole('button', { name: /Add or invite/ }).click(),
    ]);
    const body = await res.json().catch(() => ({}) as any);
    expect(
      res.status(),
      `POST /org/members -> ${res.status()}: ${JSON.stringify(body).slice(0, 300)}`,
    ).toBeLessThan(400);
    return { outcome: body?.status === 'invited' ? 'invited' : 'added', body, status: res.status() };
  }

  /** Take the link the way the admin takes it: click Copy, read the clipboard. */
  async function copyInviteLink(page: Page) {
    await page.getByRole('button', { name: /Copy invite link/ }).click();
    await expect(page.getByRole('button', { name: /^Copied$/ })).toBeVisible({ timeout: 10_000 });
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link, 'the Copy invite link button put nothing on the clipboard').toMatch(
      /accept-invite\?token=/,
    );
    return link;
  }

  /**
   * Accept an invitation the way the invited person does: in a CLEAN browser
   * context with no session, at the link the product minted.
   *
   * The fresh context is not fastidiousness. Accepting while the admin's token
   * is still in `localStorage` would prove only that the ADMIN's browser can
   * open the page — and the invited person's browser has never seen this site.
   */
  async function acceptInvite(browser: any, link: string, name: string, password: string) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    try {
      await p.goto(link);
      await expect(p.locator('#inv-name')).toBeVisible({ timeout: 30_000 });
      await p.locator('#inv-name').pressSequentially(name, { delay: 10 });
      await p.locator('#inv-password').pressSequentially(password, { delay: 10 });
      await p.locator('#inv-confirm').pressSequentially(password, { delay: 10 });
      await p.getByRole('button', { name: /Accept & create account/ }).click();
      // The account is live when the app lets them off /accept-invite.
      await p.waitForURL((u) => !/accept-invite/.test(u.pathname), { timeout: 45_000 });
      return p.url();
    } finally {
      await ctx.close();
    }
  }

  test('02.8 members — invite, accept in a clean browser, and the person is seated', async ({
    page,
    browser,
  }) => {
    const wire = watchWire(page);
    await signInAs(page, requireUnicode());
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    const report: string[] = [];

    for (const slot of SLOTS) {
      const email = slotEmail(slot.tag);
      const seated = (await members(page)).find((m) => lower(m.email) === email);

      // ── Idempotent branch: already seated. Verify, never duplicate. ───────
      //
      // ⚠ AND DO NOT ASSERT THE NAME HERE. These addresses are the owner's real
      // gmail plus-tags, so the invitation genuinely lands in a real inbox — and
      // on 2026-08-28 the owner opened one **on their phone and accepted it**
      // (`audit_log` 5707: `auth.invite_accepted`, iPhone Safari, a different
      // IP) while this suite was still running. The seat is correct; the person
      // simply typed their own name rather than the roster's. That is not a
      // defect in either the product or the test — it is what §3 signed up for
      // by choosing deliverable addresses over fake ones, and a suite that
      // asserts the name would go red because a human answered their own mail.
      if (seated) {
        report.push(`${email}: already seated as ${seated.role_code} — verified, not re-created`);
        await openTab(page, 'members');
        await expect(page.locator('.omt__e').filter({ hasText: email })).toBeVisible({
          timeout: 30_000,
        });
        continue;
      }

      // ── A pending invitation cannot have its link re-read: the product
      //    shows it once, to the operator who made it. Revoking and re-issuing
      //    is what an admin does when the link is lost, so that is what
      //    happens here.
      const pending = (await pendingInvites(page)).find((i) => lower(i.email) === email);
      if (pending) {
        await openTab(page, 'members');
        await page
          .locator('.of__f--row')
          .filter({ hasText: email })
          .getByRole('button', { name: /Revoke/ })
          .click();
        await expect(page.locator('.tst__t').getByText(/revoked/i)).toBeVisible({ timeout: 20_000 });
        report.push(`${email}: a stale invitation was revoked before re-inviting`);
      }

      const { outcome } = await addOrInvite(page, email, slot.role);
      expect(
        outcome,
        `${email} has no account, so the product must INVITE rather than add`,
      ).toBe('invited');

      // The product says so on screen, in the toast TITLE — `.tst__t` carries
      // the verb, `.tst__s` the message. 02.2b was a test bug for reading the
      // pair the wrong way round, so the distinction is named here too.
      //
      // ⚠ A PLAIN STRING, not a RegExp, and that is this test's own first
      // near-miss. It was written as ``new RegExp(`Invitation sent to ${email}`)``
      // — and `+` is a quantifier, so `kevalvshah03+uadm@…` compiled to
      // "kevalvshah03 then one-or-more u then adm@…" and could never match a
      // literal address. It failed reading exactly like a product defect: *the
      // product does not confirm an invitation was sent*. The captured page
      // context showed it confirming in two places at once — this toast and the
      // "Invited ·" section below. **Never build a matcher out of data that can
      // contain regex metacharacters**; Playwright substring-matches a string.
      await expect(page.locator('.tst__t').getByText(`Invitation sent to ${email}`)).toBeVisible({
        timeout: 20_000,
      });

      // ⚠ It must also appear under "Invited · N". That section exists because
      // a pending invitation OCCUPIES A SEAT, and an admin at the seat limit
      // has to be able to see what is holding the places.
      await expect(page.locator('.oinv__e').filter({ hasText: email })).toBeVisible({
        timeout: 20_000,
      });

      const link = await copyInviteLink(page);
      const landed = await acceptInvite(browser, link, slot.name, `Kt-${slot.tag}-93-Aug!`);
      report.push(`${email}: invited -> accepted -> landed on ${new URL(landed).pathname}`);

      // ── The consequence, asserted where the customer sees it ─────────────
      await openTab(page, 'members');
      await expect(page.locator('.omt__n').filter({ hasText: slot.name })).toBeVisible({
        timeout: 30_000,
      });
      // A NAME on screen, never an id — the standing rule.
      await expect(page.locator('.omt__e').filter({ hasText: email })).toBeVisible();
      // ...and the invitation has stopped holding a seat.
      await expect(page.locator('.oinv__e').filter({ hasText: email })).toHaveCount(0);
    }

    // ── The roster declares the intended state, so this CONVERGES on it ────
    //
    // The first draft simply asserted the role, and that was wrong in a way
    // worth recording: a slot the run did not create is a slot whose role this
    // run never set, so asserting it accuses the product of somebody else's
    // choice. `+uops` was seated `org_admin` by an earlier broken revision of
    // 02.10 that failed AFTER its PUT landed and so never restored it — and the
    // assertion then reported that as "seated with the wrong role".
    //
    // Declaring the intended state and steering to it is both idempotent and
    // self-healing, and it drives the real control to get there rather than
    // asserting from the outside.
    await openTab(page, 'members');
    for (const slot of SLOTS) {
      const email = slotEmail(slot.tag);
      const m = (await members(page)).find((x) => lower(x.email) === email);
      expect(m, `${email} is not in GET /org/members${dump(wire)}`).toBeTruthy();

      if (m.role_code === slot.role) continue;

      report.push(`${email}: role drifted to ${m.role_code} — steering back to ${slot.role}`);
      const row = page.locator('.omt tbody tr').filter({ hasText: email });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.getByRole('button', { name: /Actions for/ }).click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible({ timeout: 10_000 });
      const [res] = await Promise.all([
        page.waitForResponse(
          (r) => /\/org\/members\/.*\/role/.test(r.url()) && r.request().method() === 'PUT',
          { timeout: 30_000 },
        ),
        menu
          .getByRole('menuitem', {
            name: slot.role === 'org_admin' ? /Make org admin/ : /Make org member/,
          })
          .click(),
      ]);
      expect(res.status(), `PUT role -> ${res.status()}`).toBeLessThan(400);

      // The row is the evidence, not the screen's opinion of it.
      expect(
        (await members(page)).find((x) => lower(x.email) === email)?.role_code,
        `${email} would not move to ${slot.role}`,
      ).toBe(slot.role);
    }
    console.log('\n[02.8] ' + report.join('\n[02.8] ') + '\n');
  });

  test('02.9 members — an address whose account was purged can be invited again', async ({
    page,
  }) => {
    await signInAs(page, requireUnicode());

    // ⚠ A REGRESSION TEST FOR A DATA STATE, NOT FOR CODE — and it is here
    // because the failure it guards was invisible from the product side. R4
    // left 25 accounts standing in the global `public.users` after removing
    // their seats, so `org_invites.py:455` answered 409 for every seeded
    // address and the entire members lane was unreachable. R4b removed them.
    //
    // The assertion is deliberately written as "the product does not say the
    // address is taken", because that sentence IS the symptom.
    const freed = 'kevalvshah03+qaadmin@gmail.com'; // one of the 25 purged
    const { outcome, body } = await addOrInvite(page, freed, 'org_member');

    expect(
      JSON.stringify(body),
      'the product still believes this address has an account — the R4b purge ' +
        'did not free it, and the members lane is blocked again',
    ).not.toMatch(/already has an account/i);
    expect(outcome, 'a purged address must take the INVITE path, not the add path').toBe('invited');

    // Leave nothing behind: this test only needed to learn that the door opens.
    await expect(page.locator('.oinv__e').filter({ hasText: freed })).toBeVisible({
      timeout: 20_000,
    });
    await page
      .locator('.of__f--row')
      .filter({ hasText: freed })
      .getByRole('button', { name: /Revoke/ })
      .click();
    await expect(page.locator('.tst__t').getByText(/revoked/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.oinv__e').filter({ hasText: freed })).toHaveCount(0);
  });

  test('02.10 members — the role changes, and the badge and the row agree', async ({ page }) => {
    const wire = watchWire(page);
    await signInAs(page, requireUnicode());

    const email = slotEmail('ops');

    // ⚠ THE TAB IS OPENED BEFORE THE ROSTER IS READ, and the order is the fix.
    // This read used to happen straight after `signInAs`, while the app was
    // still bootstrapping — which is how 02.10 failed at 6.0s in the wave1 run
    // of 2026-08-28 saying "02.8 must run first" about a member 02.8 had just
    // seated, and then passed when run alone. Opening the members screen first
    // puts the session in the same state a customer's would be in before any
    // assertion is made about what it holds.
    await openTab(page, 'members');
    const before = (await members(page)).find((m) => lower(m.email) === email);
    expect(before, `02.8 must run first — ${email} is not a member${dump(wire)}`).toBeTruthy();

    // ⚠ THIS TEST READS THE STARTING ROLE RATHER THAN ASSUMING ONE, and the
    // first draft did assume, which broke it twice over. The row's menu offers
    // only the transition that applies — `admin ? 'Make org member' : 'Make org
    // admin'` (MemberTable.jsx) — so a test that always looks for "Make org
    // admin" cannot run against a member who is already one. And because the
    // first draft failed AFTER its PUT landed, it left this person promoted,
    // which is the state the next run then met. A toggle that reads first is
    // idempotent from any starting point; one that assumes is idempotent from
    // exactly one.
    const START = before.role_code === 'org_admin' ? 'org_admin' : 'org_member';
    const OTHER = START === 'org_admin' ? 'org_member' : 'org_admin';

    // ⚠ The BADGE and the SELECT do not use the same words. `ROLE_OPTIONS` in
    // the add form says "Org admin"; the row badge (`ROLE_META`,
    // MemberTable.jsx:55) says plain "Admin". The first draft asserted the
    // form's wording against the badge, and it read exactly like a product
    // defect: *the role changed and the badge did not follow*. It had followed
    // — the server showed `org_admin` at the same second — and the label being
    // looked for was one the product never renders anywhere.
    const badge = (role: string) => (role === 'org_admin' ? 'Admin' : 'Member');

    const row = page.locator('.omt tbody tr').filter({ hasText: email });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Suite rule 6: scope to the OPEN MENU. An unscoped name match resolves in
    // DOM order and will happily hit the sidebar instead of the row's action.
    const setRole = async (to: 'org_admin' | 'org_member') => {
      // The response is armed BEFORE the click so nothing is missed, and the
      // click goes through `rowMenuItem` so a refetch landing under the open
      // menu is retried rather than reported as a missing control.
      const pending = page.waitForResponse(
        (r) => /\/org\/members\/.*\/role/.test(r.url()) && r.request().method() === 'PUT',
        { timeout: 30_000 },
      );
      await rowMenuItem(
        page,
        row,
        to === 'org_admin' ? /Make org admin/ : /Make org member/,
        `the row offers no "${to === 'org_admin' ? 'Make org admin' : 'Make org member'}" ` +
        'action — MemberTable.jsx offers exactly the transition that applies',
      );
      const res = await pending;
      expect(res.status(), `PUT role -> ${res.status()}`).toBeLessThan(400);
      // The screen is the claim; the row is the fact. Both are asserted, and
      // the failure message says which of the two disagreed.
      await expect(row.locator('.rb').getByText(badge(to), { exact: false })).toBeVisible({
        timeout: 20_000,
      });
      expect(
        (await members(page)).find((m) => lower(m.email) === email)?.role_code,
        `the badge reads "${badge(to)}" — the server must agree`,
      ).toBe(to);
    };

    await setRole(OTHER);
    // Put it back, so a second run starts exactly where the first one did (§6).
    await setRole(START);
    console.log(`\n[02.10] ${email}: ${START} -> ${OTHER} -> ${START}, badge and row agreed at each step\n`);
  });

  test('02.11 members — remove takes the seat, and warns what it does not take', async ({
    page,
    browser,
  }) => {
    const wire = watchWire(page);
    await signInAs(page, requireUnicode());
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // A member of this test's own making, so it never removes one another test
    // depends on.
    //
    // ⚠ Removing a member takes the SEAT and leaves the ACCOUNT, so on a second
    // run the product legitimately takes the "added straight away" path instead
    // of the invite path. BOTH are correct, so the outcome is REPORTED rather
    // than asserted — asserting either one would make this test fail on its
    // second run, and a test that fails on correct behaviour is a defect in the
    // test (93 §0).
    const email = 'kevalvshah03+utemp@gmail.com';
    let seated = (await members(page)).find((m) => lower(m.email) === email);

    if (!seated) {
      const { outcome } = await addOrInvite(page, email, 'org_member');
      console.log(`\n[02.11] ${email} entered by the "${outcome}" path\n`);
      if (outcome === 'invited') {
        const link = await copyInviteLink(page);
        await acceptInvite(browser, link, 'Temp Removable', 'Kt-temp-93-Aug!');
      }
      seated = (await members(page)).find((m) => lower(m.email) === email);
      expect(seated, `${email} did not become a member${dump(wire)}`).toBeTruthy();
    }

    // ⚠ OUTSIDE the branch, and that is this test's own third near-miss. The
    // `openTab` used to sit INSIDE `if (!seated)`, so on the run where the
    // member already existed the branch was skipped and the row locator ran
    // against **the dashboard** — `signInAs` lands on /dashboard. It failed
    // reading like a product defect: *a member the API returns is not shown on
    // the members screen*. The captured page snapshot showed Today, Approvals
    // and Team pulse: the members table was not missing, it was never opened.
    await openTab(page, 'members');
    const row = page.locator('.omt tbody tr').filter({ hasText: email });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await rowMenuItem(
      page,
      row,
      /Remove from organisation/,
      'the row offers no "Remove from organisation" action',
    );

    // ⚠ A destructive confirmation must SAY WHAT SURVIVES. "Their work stays;
    // only their access is removed" is the sentence that stops an admin
    // believing a removal deletes the person's tasks. Its absence would be the
    // defect — not its wording.
    await expect(page.getByText(/Remove from organisation\?/)).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/Their work stays; only their access is removed/i),
    ).toBeVisible();

    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => /\/org\/members\//.test(r.url()) && r.request().method() === 'DELETE',
        { timeout: 30_000 },
      ),
      page.getByRole('button', { name: /^Remove$/ }).click(),
    ]);
    expect(res.status(), `DELETE member -> ${res.status()}`).toBeLessThan(400);

    await expect(page.locator('.omt__e').filter({ hasText: email })).toHaveCount(0, {
      timeout: 20_000,
    });
    expect(
      (await members(page)).find((m) => lower(m.email) === email),
      `${email} is gone from the screen but still in GET /org/members${dump(wire)}`,
    ).toBeFalsy();
  });

  /* ═══════════════════════════════════════════════════════════════════════
   * STORAGE AND THE LOGO — §10's last two org-settings screens, and the only
   * place in Suite 02 where the thing written is an OBJECT rather than a row.
   *
   * §4 budgets four "Logo / storage uploads" per org and annotates them
   * "R2 round trip incl. delete"; §10 spells the screen out as
   * "storage browse/upload/download/delete". Two tests cover it: 02.12 drives
   * the Storage tab, 02.13 drives the logo.
   *
   * ── WHAT A ROUND TRIP HAS TO PROVE HERE, AND WHY IT IS NOT "IT DID NOT
   *    THROW" ────────────────────────────────────────────────────────────────
   * An upload that answers 200 proves the request was accepted, not that an
   * object exists. This product has already shipped both halves of that gap:
   * five executed e-sign PDFs whose rows pointed at objects the bucket did not
   * have (`storage_browser.py:519-522`), and a logo column that held a presigned
   * URL and nothing to re-sign it from, so the letterhead was a broken image by
   * the evening (`org_profile.py:180-186`). A 200 with an empty body is the same
   * class of lie one layer down.
   *
   * So every upload below is followed by a GET of the bytes, and the bytes are
   * compared to the fixture on disk. Equal buffers is the only evidence that
   * survives all three failure modes.
   *
   * ── READING BY API IS VERIFICATION, NOT A BYPASS ───────────────────────────
   * `check-e2e-no-bypass.mjs` bans `page.request.post/put/patch/delete` and
   * permits `page.request.get`, in those words: "reading, and the login
   * bootstrap" are allowed because "asserting the row appeared IS the required
   * evidence". Everything created below is created by `setInputFiles` on the
   * product's own file input and by clicking the product's own Save button.
   * ═══════════════════════════════════════════════════════════════════════ */

  /** GET the org profile the server holds. The screen is the claim; this is the fact. */
  async function orgProfile(page: Page) {
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    const res = await page.request.get(`${API_BASE}/api/v1/org/profile`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    expect(res.ok(), `GET /org/profile -> ${res.status()}: ${await res.text()}`).toBeTruthy();
    return (await res.json()) as any;
  }

  /** Any GET under the API, with this session's bearer. Reads only — see the header. */
  async function apiGet(page: Page, pathAndQuery: string) {
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    const res = await page.request.get(`${API_BASE}${pathAndQuery}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    expect(res.ok(), `GET ${pathAndQuery} -> ${res.status()}: ${await res.text()}`).toBeTruthy();
    return (await res.json()) as any;
  }

  /**
   * The logo fixture, as bytes.
   *
   * `test.info().file` is the absolute path of THIS spec, so the fixture is
   * found however the run was launched. `process.cwd()` would not be: the
   * documented invocation is `cd frontend && npx playwright test --config
   * e2e-real/wave1.config.ts`, but the config sets `testDir` from its own
   * location and nothing pins the working directory, and `import.meta.url` is
   * the other option only while the loader stays ESM.
   *
   * ⚠ AN SVG, ON PURPOSE, AND IT IS NOT ONLY ABOUT KEEPING A BINARY OUT OF THE
   * REPOSITORY. It is TEXT, so "the bytes that came back are the bytes that went
   * up" is a byte-for-byte buffer comparison rather than a size check — and it
   * takes the upload through `uploads.py:_svg_is_safe` (`:109`), the one content
   * gate on this path. That gate refuses `<script`, `javascript:`,
   * `<foreignobject`, `<!entity`, `<iframe`, `<embed`, `<object` and any
   * `on…=` handler, because an SVG opened at its own storage URL is a document
   * the browser will run. This fixture carries none of them — checked against
   * the constants in `uploads.py:98-122` when it was written — and if somebody
   * later edits it into something with a handler on it, the upload will answer
   * 415 and this test will say so rather than going quietly green.
   */
  const logoFixturePath = () =>
    path.join(path.dirname(test.info().file), 'fixtures', 'logo-unicode-e2e.svg');

  test('02.12 storage — the R2 round trip: browse, upload, download, delete', async ({ page }) => {
    // ═════════════════════════════════════════════════════════════════════════
    // READ `TabStorage.jsx` BEFORE READING THIS TEST'S RESULT.
    //
    // Its docstring, at `frontend/src/pages/org/TabStorage.jsx:40-45`, says in
    // the product's own words: "WHAT IS DELIBERATELY ABSENT — There is no delete
    // and no upload. A file in this product is a POINTER held in a column …
    // deleting the object without the row produces exactly the failure this tab
    // exists to diagnose. Both belong to the module that owns the row."
    //
    // The router agrees. `backend/routers/storage_browser.py` mounts exactly
    // three routes under `/api/v1/org/storage` — `GET ""` (`:319`),
    // `GET /browse` (`:390`) and `POST /resolve` (`:501`). There is no PUT, no
    // DELETE and no download. `services/storage.py` does carry `delete_file`
    // (`:832`), so the capability exists one layer down; nothing on this screen
    // reaches it.
    //
    // §10 nevertheless lists this screen as "storage browse/upload/download/
    // delete" and §4 budgets four uploads "R2 round trip incl. delete". Those
    // two statements cannot both be satisfied today, and THE SUITE DOES NOT GET
    // TO PICK. Suite rule: a missing control is a FAILURE, never a `test.skip` —
    // a skip is how a gap becomes invisible, and "excluded by decision" versus
    // "not built" is the owner's judgement to make, not this file's.
    //
    // So the test does three things, in this order:
    //   A. drives BROWSE for real and asserts it against the server;
    //   B. drives IDENTIFY for real — which is the one control on this screen
    //      that asks R2 whether an object is actually there, and is therefore
    //      the closest thing the tab has to proving a round trip;
    //   C. MEASURES the page for an upload control, a download control and a
    //      delete control, and fails naming precisely which are absent.
    //
    // C is measured, not assumed. If somebody adds the controls, this test goes
    // green by itself; it does not encode my reading of the JSX as a constant.
    //
    // ── Idempotence (§6) ─────────────────────────────────────────────────────
    // This test writes NOTHING. Browse and identify are both reads, so a second
    // execution starts in exactly the state the first one did, and part C's
    // verdict is a function of the code alone.
    // ═════════════════════════════════════════════════════════════════════════
    await signInAs(page, requireUnicode());
    await openTab(page, 'storage');

    const panel = page.getByRole('tabpanel');
    const notes: string[] = [];

    // ── A1. WHERE THE FILES LIVE ─────────────────────────────────────────────
    // The overview must have loaded. `TabStorage` renders "Storage could not be
    // read just now." instead of the tiles when `GET /v1/org/storage` fails
    // (`TabStorage.jsx:140-142`), and three tiles over a failed read would be a
    // screen that looks fine and says nothing.
    await expect(panel.getByText('Storage could not be read just now.')).toHaveCount(0);

    const overview = await apiGet(page, '/api/v1/org/storage');

    // Asserting the LITERAL strings the component renders, read off the JSX
    // rather than guessed: `StatTile` puts the label in `.k-stat__lbl` and the
    // value in `.k-stat__val` (`components/ui/StatTile.jsx:58-69`), and
    // TabStorage's three labels are "Account", "Recorded as used" and
    // "Allowance" (`TabStorage.jsx:146-160`).
    const tile = (label: string) =>
      panel.locator('.k-stat').filter({ hasText: label }).locator('.k-stat__val');

    // "Recorded as used", never "Used" — the figure is a running total that two
    // upload paths keep and four do not, and the server says so in `used_note`.
    // The tab is asserted to keep that wording because a tile labelled "Used"
    // over a number known to be short is a confident wrong answer, and it is the
    // sort of honesty that gets "tidied" away.
    await expect(tile('Recorded as used')).toHaveText(String(overview.used_label), {
      timeout: 30_000,
    });
    await expect(tile('Account')).toHaveText(
      overview.own_account ? 'Your own Cloudflare' : "Aekam's storage",
    );
    await expect(tile('Allowance')).toHaveText(overview.limit_label || 'No limit set');
    notes.push(
      `overview: own_account=${overview.own_account}, recorded ${overview.used_label}` +
        ` of ${overview.limit_label || 'no limit'}`,
    );

    // ── A2. THE BROWSER LISTS THE ROOT, AND AGREES WITH THE BUCKET ───────────
    const root = await apiGet(page, '/api/v1/org/storage/browse?prefix=');
    expect(
      root.configured,
      'GET /v1/org/storage/browse reports configured=false — this organisation has ' +
        'no R2 credentials and no platform fallback, so nothing below can be ' +
        'exercised. ENVIRONMENT blocker, not a defect in the screen.',
    ).toBe(true);
    await expect(panel.getByText('No storage is set up for this organisation')).toHaveCount(0);

    // One `.sto__nm` per entry: folders render it as a `<button>`, files as a
    // `<span>` (`TabStorage.jsx:240` and `:264`). Counting the class rather than
    // `tbody tr` keeps this an assertion about what the component draws instead
    // of about DataTable's internals.
    const rows = panel.locator('.sto__nm');
    const rootCount = root.folders.length + root.files.length;
    if (rootCount === 0) {
      // A legitimate state, not a failure — the bucket is empty. Say so loudly:
      // a silent zero here would read as full coverage of a control that was
      // never exercised.
      await expect(panel.getByText('Nothing here')).toBeVisible({ timeout: 30_000 });
      notes.push(
        '⚠ PARTIAL — the bucket root is EMPTY, so folder navigation could not be ' +
          'exercised. The empty state was asserted instead. This is a data ' +
          'precondition, not a product fault.',
      );
    } else {
      await expect(rows).toHaveCount(rootCount, { timeout: 30_000 });
    }

    // ── A3. WALK INTO A FOLDER, AND WALK BACK OUT ────────────────────────────
    if (root.folders.length) {
      const folder = root.folders[0];
      // What the crumb will say, from `TabStorage.jsx:243-246`:
      // `nameOf(folder) || folder.kind || 'Folder'`, where `nameOf` is
      // `label ?? (is_id ? null : name)`. The raw `name` is never drawn for an
      // id segment — that is this screen's whole reason for existing, because
      // the live folder names are `personal/user_…`, `pahchan/{employee uuid}`
      // and `projects/team_…`.
      const crumbLabel: string = folder.label || folder.kind || 'Folder';
      const crumbs = panel.locator('nav[aria-label="Storage folders"] .sto__crumb');
      await expect(crumbs).toHaveCount(1);
      await expect(crumbs.first()).toHaveText('All files');

      const inner = await apiGet(
        page,
        `/api/v1/org/storage/browse?prefix=${encodeURIComponent(folder.prefix)}`,
      );

      await panel.locator('.sto__nm').filter({ hasText: crumbLabel }).first().click();

      // THE OBSERVABLE CONSEQUENCE, and all three halves of it: the trail grew,
      // the new crumb is the current one, and the LISTING followed. A crumb that
      // moves over an unchanged table is the failure this asserts against.
      await expect(crumbs).toHaveCount(2, { timeout: 30_000 });
      await expect(crumbs.nth(1)).toHaveText(crumbLabel);
      await expect(crumbs.nth(1)).toHaveAttribute('aria-current', 'page');
      await expect(panel.locator('.sto__nm')).toHaveCount(
        inner.folders.length + inner.files.length,
        { timeout: 30_000 },
      );

      // And back. `setTrail(t => t.slice(0, i + 1))` (`TabStorage.jsx:202`) means
      // the root crumb truncates the trail; the listing must return with it.
      await crumbs.first().click();
      await expect(crumbs).toHaveCount(1, { timeout: 30_000 });
      await expect(panel.locator('.sto__nm')).toHaveCount(rootCount, { timeout: 30_000 });
      notes.push(
        `browse: root (${rootCount} entries) -> "${crumbLabel}" ` +
          `(${inner.folders.length + inner.files.length} entries) -> root, ` +
          'crumbs and listing agreed at every step',
      );
    } else {
      notes.push(
        '⚠ PARTIAL — the bucket root holds no FOLDERS, so the crumb trail could ' +
          'not be walked. Only the root listing was asserted.',
      );
    }

    // ── B. IDENTIFY — the only control here that asks R2 for an object ───────
    //
    // Typed into the real form and submitted with the real button. This is the
    // nearest thing the tab has to the round trip §4 asks for: `resolve_key`
    // does a `head_object` against the bucket the KEY selects
    // (`storage_browser.py:600-616`), so `object_present` is the bucket's own
    // answer rather than a row's opinion of it.
    //
    // The key it is given is the organisation's OWN logo key, when there is one.
    // That is deliberate and it is not a shortcut: 02.13 puts that object in R2
    // through the product's upload control, and this proves — from a different
    // screen, through a different endpoint — that the object is really there.
    // Where no logo has ever been uploaded there is nothing to point at, so a
    // key that certainly does not exist is used instead and the OTHER answer is
    // asserted. Both are real sentences the product must produce correctly; the
    // one that must never be wrong is "nothing at this key".
    const profile = await orgProfile(page);
    const logoKey: string = profile.logo_key || '';
    const probeKey = logoKey || `personal/e2e-no-such-object-${Date.now()}.bin`;
    const expectPresent = Boolean(logoKey);

    const keyBox = panel.getByLabel('File key');
    await expect(keyBox).toBeVisible({ timeout: 30_000 });
    await keyBox.click();
    await keyBox.press('ControlOrMeta+a');
    await keyBox.pressSequentially(probeKey);
    await expect(keyBox).toHaveValue(probeKey);

    // Enabled only once there is something to look up (`disabled={asking ||
    // !paste.trim()}`, `TabStorage.jsx:326`) — so an enabled button is itself
    // the evidence the keystrokes registered, which `fill()` would not give.
    const identify = panel.getByRole('button', { name: /^Identify$/ });
    await expect(identify).toBeEnabled();
    const [resolved] = await Promise.all([
      page.waitForResponse(
        (r) => /\/org\/storage\/resolve$/.test(new URL(r.url()).pathname), { timeout: 30_000 },
      ),
      identify.click(),
    ]);
    expect(
      resolved.status(),
      `POST /v1/org/storage/resolve -> ${resolved.status()}: ${(await resolved.text()).slice(0, 300)}`,
    ).toBeLessThan(400);

    // `Sheet` gives the panel `role="dialog"` with `aria-label` taken from the
    // title (`components/ui/Sheet.jsx:84`), and TabStorage's title is literally
    // "What this file is" (`TabStorage.jsx:335`).
    const sheet = page.getByRole('dialog', { name: 'What this file is' });
    await expect(sheet).toBeVisible({ timeout: 20_000 });

    if (expectPresent) {
      // No table in `_KEY_COLUMNS` (`storage_browser.py:492-498`) holds
      // `organisations.logo_key`, so the logo is correctly an object that no
      // RECORD in this org names — `_summarise` (`:682`) says exactly that.
      await expect(sheet.locator('.sto__sum')).toHaveText(
        /An object is present at this key, but no record in this organisation names it/i,
      );
      // The bucket's answer, drawn as "Yes — <size>" (`TabStorage.jsx:348-350`).
      // THIS is the assertion that the object reached R2: it is a `head_object`
      // against the live bucket, not a row and not a return value.
      await expect(sheet.locator('.sto__v').first()).toHaveText(/^Yes — /);
    } else {
      await expect(sheet.locator('.sto__sum')).toHaveText(
        /Nothing at this key, and no record in this organisation names it/i,
      );
      await expect(sheet.locator('.sto__v').first()).toHaveText('No');
      notes.push(
        '⚠ PARTIAL — this organisation holds no logo_key, so identify was ' +
          'exercised against a deliberately absent key. Run 02.13 first for the ' +
          'present-object branch.',
      );
    }

    // The parsed path is drawn as `.sto__path`, and `_display_path`
    // (`storage_browser.py:278`) exists precisely because the grammar puts a
    // member's user id and an employee's uuid INSIDE the key. 02.7 scans every
    // tab in its resting state and can never reach this sheet, so the runtime
    // half of the no-ids ratchet is extended to it here.
    const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
    const sheetText = (await sheet.innerText()) || '';
    expect(
      sheetText.match(UUID_RE)?.[0],
      `the "What this file is" sheet rendered a UUID: ${sheetText.slice(0, 400)}`,
    ).toBeUndefined();
    notes.push(`identify: key resolved, object_present=${expectPresent}, no UUID drawn`);

    // Close it before part C. This is an assertion in its own right — a sheet
    // that opens and will not close is a screen a customer is stuck on, and it
    // sets `document.body.style.overflow = 'hidden'` while open
    // (`components/ui/Sheet.jsx:69`), so a sheet that never finishes closing
    // leaves the page unscrollable.
    //
    // ⚠ It is NOT closed to keep it out of part C's locators, which was this
    // comment's first (wrong) reason: `Sheet` renders through `createPortal` to
    // `document.body` (`Sheet.jsx:77`), so it has never been inside the tab
    // panel and part C's counts were never affected by it. Recorded because
    // "scope to the surface you opened" only works if you know where the
    // surface actually is.
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0, { timeout: 10_000 });

    // ── C. THE STORAGE TAB IS READ-ONLY, AND THAT IS NOW A DECISION ─────────
    //
    // ⚠ THIS ASSERTION USED TO BE ITS OWN OPPOSITE, and the change is the
    // owner answering a question rather than a standard slipping.
    //
    // It used to MEASURE the tab for upload, download and delete controls and
    // FAIL naming the ones that were absent, because §10 lists this screen as
    // "storage browse/upload/download/delete" while `TabStorage.jsx:40-45`
    // said the absence was deliberate. Those two could not both be right, and
    // the suite deliberately did not get to pick — "not built" against
    // "excluded by decision" is the owner's call, and a `test.skip` would have
    // made the question disappear.
    //
    // ANSWERED 2026-08-29: the tab stays read-only, and delete is built on the
    // surfaces that OWN the row — task attachments and CRM documents — behind
    // a two-stage recycle bin. `TabStorage.jsx`'s reasoning survives intact: a
    // file here is a POINTER held in a column, and deleting the object without
    // the row produces exactly the failure this tab exists to diagnose.
    //
    // So the three controls must STAY absent, and this now fails if somebody
    // adds one. The measurement is the same; the expected answer flipped.
    /**
     * ⚠ FOLDER NAMES ARE BUTTONS ON THIS TAB, AND ONE OF THEM IS CALLED
     * "Personal uploads".
     *
     * `TabStorage` renders a folder as a `<button>` so it can be walked into
     * and a file as a `<span>` (`:240` and `:264`) — both carry `.sto__nm`. So
     * an unscoped `getByRole('button', { name: /upload/i })` matches the
     * FOLDER `personal/`, whose label is "Personal uploads", and reports an
     * upload control on a tab that has none.
     *
     * Measured on staging 2026-08-29: zero `input[type=file]` on the entire
     * page, nine buttons in the panel, and exactly one of them matching —
     * "Personal uploads". The bucket's own contents were deciding the verdict.
     *
     * That is the worse half of it. A check whose answer depends on what
     * happens to be in R2 is one that passes or fails for reasons nothing in
     * this suite created — §7's "a suite written against a populated org can
     * silently depend on rows it did not create", arriving through a locator
     * rather than through a fixture.
     *
     * It was invisible before because the assertion ran the other way: the old
     * test asked whether the control was MISSING, so a false positive here
     * quietly suppressed one line of a failure that was failing anyway.
     */
    const controls = panel.locator('button').locator(':not(.sto__nm)');
    const named = (rx: RegExp) => controls.filter({ hasText: rx });

    const uploadControls =
      (await panel.locator('input[type="file"]').count()) +
      (await named(/upload|add file|choose file|attach/i).count());
    const downloadControls =
      (await named(/download|open file|get a link|save a copy/i).count()) +
      (await panel.locator('a[download], a[href^="http"]').count());
    const deleteControls = await named(/delete|remove|discard/i).count();

    const wrongly: string[] = [];
    if (uploadControls) wrongly.push(`UPLOAD — ${uploadControls} control(s) on a tab that must not write`);
    if (downloadControls) wrongly.push(`DOWNLOAD — ${downloadControls} control(s)`);
    if (deleteControls) wrongly.push(`DELETE — ${deleteControls} control(s). Delete belongs on the surface that owns the row`);

    expect(
      wrongly,
      '\n  The Storage tab has gained a file operation. It is a DIAGNOSTIC\n' +
        '  surface and read-only by decision (TabStorage.jsx:40-45): a file here\n' +
        '  is a pointer held in a column, and removing the object without its\n' +
        '  row produces the exact failure this tab exists to diagnose.\n' +
        '  Delete lives on the surfaces that own the row, behind the recycle\n' +
        '  bin. If that decision has genuinely changed, change this test\n' +
        '  deliberately — do not widen it to let the control through.\n' +
        wrongly.map((m) => `     · ${m}`).join('\n'),
    ).toEqual([]);

    // And the reader must be TOLD where recovery lives, or somebody landing
    // here looking for a deleted file concludes the product has no bin.
    await expect(
      panel.getByText(/recycle bin/i),
      'the Storage tab does not mention the Recycle bin, so a reader looking ' +
        'for a deleted file is left thinking nothing can be recovered',
    ).toBeVisible();

    console.log('\n[02.12] ' + notes.join('\n[02.12] ') + '\n');
  });

  /**
   * 02.12b · THE R2 ROUND TRIP, INCLUDING DELETE — §4's "R2 round trip incl.
   * delete", driven end to end for the first time.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * WHAT THIS PROVES THAT NOTHING ELSE DOES
   * ═══════════════════════════════════════════════════════════════════════
   * Before the recycle bin there was no delete anywhere in this product that
   * KEPT the file. `TaskDrawer.jsx` and `graha.py`'s document route both
   * dropped the pointer and left the R2 object in the bucket — billed forever,
   * unreachable by anyone including Aekam, with no confirmation and no undo.
   *
   * A row count could not see any of that. Only walking the object through
   * upload → delete → bin → restore → bin → second stage → destroyed, and
   * asking the BUCKET at each step, can.
   *
   * ── SELF-SUFFICIENT, WHICH THE FROM-ZERO DECISION REQUIRES ──────────────
   * It creates its own document rather than borrowing one. §7: a suite written
   * against a populated org can silently depend on rows it did not create, and
   * "it passed because the code works" becomes indistinguishable from "it
   * passed because a document happened to exist". `client_id` is optional on
   * `/documents/upload` (Form("")), so this needs no client and does not wait
   * on Suite 04.
   *
   * ⚠ IT DESTROYS ITS OWN FIXTURE AT THE END, on purpose. The permanent delete
   * IS the last step of the round trip, so the org is left exactly as it was
   * found — which is also what makes the test re-runnable (§6).
   *
   * ⚠ THE PROTECTED 20 ARE NEVER TOUCHED. This drives a CRM document it
   * created seconds earlier; `team_ae1d58543b21`'s tasks are not reachable
   * from any control it clicks.
   */
  test('02.12b recycle bin — upload, delete, restore, second stage, and the object is gone', async ({
    page,
  }) => {
    await signInAs(page, requireUnicode());

    const stamp = `93-bin-${RUN}`;
    const fixture = logoFixturePath();
    const bytes = readFileSync(fixture);

    /** The org's bin, from the server. A read — verification, not a bypass. */
    const readBin = async () => {
      const r = await apiGet(page, '/api/v1/recycle-bin');
      return (r?.data ?? []) as any[];
    };
    /** The CRM documents this org can see. Soft-deleted ones are filtered out
     *  by the router, so absence here IS the delete having landed. */
    const readDocs = async () => {
      const r = await apiGet(page, '/api/v1/graha/documents');
      return (r?.data ?? r ?? []) as any[];
    };

    // ── 1. UPLOAD, through the real form ──────────────────────────────────
    await page.goto('/graha?tab=documents');
    await page.getByRole('button', { name: /Add Document|Add document/i }).first().click();
    await page.locator('input[type="file"]').first().setInputFiles(fixture);
    // The file's own name is the default, so this overwrites it with something
    // this run can find again. `RUN` makes a second execution its own fixture
    // rather than colliding with the first (§6).
    const nameField = page.getByLabel(/^Name/).first();
    await nameField.fill(stamp);
    const [up] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/graha/documents/upload') && r.request().method() === 'POST',
        { timeout: 60_000 },
      ),
      // `DocumentsTab.jsx`'s own label, read off the JSX rather than guessed:
      // `{saving ? 'Saving…' : 'Add Document'}`. An earlier `/^Add$/` matched
      // nothing — an anchored guess at a label is the same mistake as guessing
      // a column name, and it fails as "element not found", which reads as a
      // missing control rather than as a wrong selector.
      page.getByRole('button', { name: 'Add Document', exact: true }).click(),
    ]);
    expect(up.status(), `document upload -> ${up.status()}: ${await up.text()}`).toBeLessThan(400);

    const docs = await readDocs();
    const doc = docs.find((d: any) => d.name === stamp);
    expect(doc, `the uploaded document ${stamp} is not in GET /graha/documents`).toBeTruthy();
    expect(doc.file_key, 'the document row carries no R2 key, so nothing can be binned').toBeTruthy();

    // ⚠ THE OBJECT, NOT THE ROW. A 200 on the upload proves the request was
    // accepted; this proves bytes exist. Five executed e-sign PDFs once had
    // rows pointing at objects the bucket did not have.
    const fetched = await page.request.get(doc.file_url);
    expect(fetched.ok(), `the uploaded object is not readable: ${fetched.status()}`).toBeTruthy();
    expect(
      Buffer.from(await fetched.body()).length,
      'the object in the bucket is a different size from the file on disk',
    ).toBe(bytes.length);

    // ── 2. DELETE IT — the control asks first ─────────────────────────────
    const row = page.locator('tbody tr').filter({ hasText: stamp }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole('button', { name: /Delete|Remove/i }).first().click();

    // The dialog must SAY it is recoverable, because it now is. A warning that
    // overstates the consequence teaches people to click through it.
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(/recycle bin/i);
    await Promise.all([
      page.waitForResponse(
        (r) => /\/graha\/documents\//.test(r.url()) && r.request().method() === 'DELETE',
        { timeout: 30_000 },
      ),
      dialog.getByRole('button', { name: /Move to bin/i }).click(),
    ]);

    expect(
      (await readDocs()).some((d: any) => d.name === stamp),
      'the document is still listed after being deleted',
    ).toBeFalsy();

    // ── 3. IT IS IN THE BIN, IN STAGE 1 ──────────────────────────────────
    let binned = (await readBin()).find((b: any) => b.file_name === stamp);
    expect(binned, `${stamp} is not in the recycle bin — the object has orphaned`).toBeTruthy();
    expect(binned.stage, 'a freshly deleted file must be in stage 1').toBe(1);
    expect(binned.source_kind).toBe('graha_document');
    // No user id, ever. The server sends a NAME and does not send the id.
    expect(Object.keys(binned)).not.toContain('deleted_by');
    expect(binned.deleted_by_name, 'the bin row names nobody').toBeTruthy();

    // ⚠ THE OBJECT IS STILL THERE. That is the whole feature: a delete that
    // destroys the file immediately is not a bin.
    expect(
      (await page.request.get(doc.file_url)).ok(),
      'the R2 object was destroyed by a stage-1 delete — nothing should be ' +
        'destroyed until somebody destroys it deliberately',
    ).toBeTruthy();

    // ── 4. RESTORE IT, from the customer's own tab ───────────────────────
    await openTab(page, 'recycle');
    const binRow = page.locator('tbody tr').filter({ hasText: stamp }).first();
    await expect(binRow).toBeVisible({ timeout: 30_000 });
    await Promise.all([
      page.waitForResponse(
        (r) => /\/recycle-bin\/.*\/restore/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      binRow.getByRole('button', { name: /Restore/i }).click(),
    ]);

    expect(
      (await readDocs()).some((d: any) => d.name === stamp),
      'the document did not come back after Restore',
    ).toBeTruthy();
    expect(
      (await readBin()).some((b: any) => b.file_name === stamp),
      'a restored file is still listed in the bin',
    ).toBeFalsy();

    // ── 5. DELETE AGAIN, THEN CLEAR IT OUT OF STAGE 1 ────────────────────
    await page.goto('/graha?tab=documents');
    const row2 = page.locator('tbody tr').filter({ hasText: stamp }).first();
    await expect(row2).toBeVisible({ timeout: 30_000 });
    await row2.getByRole('button', { name: /Delete|Remove/i }).first().click();
    const dialog2 = page.getByRole('alertdialog');
    await expect(dialog2).toBeVisible({ timeout: 15_000 });
    await Promise.all([
      page.waitForResponse(
        (r) => /\/graha\/documents\//.test(r.url()) && r.request().method() === 'DELETE',
        { timeout: 30_000 },
      ),
      dialog2.getByRole('button', { name: /Move to bin/i }).click(),
    ]);

    await openTab(page, 'recycle');
    const binRow2 = page.locator('tbody tr').filter({ hasText: stamp }).first();
    await expect(binRow2).toBeVisible({ timeout: 30_000 });
    // ⚠ THE ACCESSIBLE NAME IS THE `aria-label`, NOT THE VISIBLE TEXT.
    // The row's button READS "Delete" and is labelled
    // `Move <file name> to the second-stage bin` — deliberately, so a screen
    // reader is not read twelve identical "Delete"s
    // (`TabRecycleBin.jsx`). `getByRole` matches the accessible name, so a
    // locator written against the visible text finds nothing and fails as a
    // MISSING CONTROL, which is the wrong diagnosis entirely.
    await binRow2.getByRole('button', { name: /second-stage/i }).click();
    const dialog3 = page.getByRole('alertdialog');
    await expect(dialog3).toBeVisible({ timeout: 15_000 });
    // Nothing is destroyed by this step, so it must not be dressed as danger.
    await expect(dialog3).toContainText(/still be recovered|second-stage/i);
    await Promise.all([
      page.waitForResponse(
        (r) => /\/recycle-bin\//.test(r.url()) && r.request().method() === 'DELETE',
        { timeout: 30_000 },
      ),
      dialog3.getByRole('button', { name: /Move to second-stage/i }).click(),
    ]);

    binned = (await readBin()).find((b: any) => b.file_name === stamp);
    expect(binned, 'the file left the bin entirely when it should have moved to stage 2').toBeTruthy();
    expect(binned.stage, 'clearing stage 1 must PROMOTE, never destroy').toBe(2);
    expect(
      (await page.request.get(doc.file_url)).ok(),
      'the R2 object was destroyed by moving to the second-stage bin',
    ).toBeTruthy();

    // ── 6. DESTROY IT — the only irreversible control on the screen ──────
    await page.reload();
    const binRow3 = page.locator('tbody tr').filter({ hasText: stamp }).first();
    await expect(binRow3).toBeVisible({ timeout: 30_000 });
    // Same reason as above: the label is `Delete <file name> permanently`.
    await binRow3.getByRole('button', { name: /permanently/i }).click();
    const dialog4 = page.getByRole('alertdialog');
    await expect(dialog4).toBeVisible({ timeout: 15_000 });
    await expect(dialog4).toContainText(/cannot be (undone|recovered)/i);

    // ⚠ THE TYPED GUARD. `ConfirmDialog` disables Confirm until the text
    // matches, and that guard is the difference between this control and the
    // one a click reaches by accident. Asserted DISABLED first, or "it was
    // enabled all along" would pass silently.
    // The DIALOG's button is `confirmLabel`, a fixed string with no file name
    // in it, so this one is exact — the two are different controls and the
    // distinction is what stops the row button satisfying the dialog check.
    const destroy = dialog4.getByRole('button', { name: 'Delete permanently', exact: true });
    await expect(destroy, 'the permanent delete was enabled before the name was typed').toBeDisabled();
    await dialog4.locator('input[type="text"], .cd__type input').first().fill(stamp);
    await expect(destroy).toBeEnabled();
    await Promise.all([
      page.waitForResponse(
        (r) => /\/recycle-bin\//.test(r.url()) && r.request().method() === 'DELETE',
        { timeout: 45_000 },
      ),
      destroy.click(),
    ]);

    // ── 7. THE OBJECT IS GONE FROM THE BUCKET ────────────────────────────
    // The assertion the whole feature exists for, and the only one that could
    // not be faked by a row count.
    expect(
      (await readBin()).some((b: any) => b.file_name === stamp),
      'a permanently deleted file is still in the bin',
    ).toBeFalsy();
    const afterPurge = await page.request.get(doc.file_url);
    expect(
      afterPurge.ok(),
      `the R2 object is STILL READABLE after a permanent delete (${afterPurge.status()}). ` +
        'The row went and the object stayed — which is the exact orphan this ' +
        'whole feature was built to stop.',
    ).toBeFalsy();

    console.log(
      `\n[02.12b] ${stamp}: uploaded (${bytes.length} bytes) -> deleted -> stage 1 -> ` +
        'restored -> deleted -> stage 2 -> destroyed. Object unreadable at the end.\n',
    );
  });

  test('02.13 the company logo uploads to R2, downloads back byte-for-byte, and survives a reload', async ({
    page,
  }) => {
    // ═════════════════════════════════════════════════════════════════════════
    // THE ONE R2 ROUND TRIP A CUSTOMER CAN ACTUALLY DRIVE TODAY.
    //
    // 02.12 measures the Storage tab and finds no upload on it. The logo is the
    // other half of §10's "Profile + logo" and §4's "Logo / storage uploads",
    // and it is a genuine round trip: `LogoUpload` picks the file,
    // `TabProfile.uploadLogo` posts it to `/api/upload` (`TabProfile.jsx:147`),
    // the bytes go to Cloudflare R2, and a presigned URL comes back.
    //
    // ── THE THREE THINGS THIS ASSERTS, AND THE BUG BEHIND EACH ───────────────
    //
    // 1. THE BYTES ARRIVED. Downloaded from the presigned URL and compared to
    //    the fixture with `Buffer.equals`. "200" is not evidence: this file's
    //    own brief names an empty 200 as a known failure mode here, and
    //    `verify_r2_credentials` carries a distinct verdict for exactly that
    //    state — "Credentials are valid and can write to {bucket}, but the test
    //    object did not read back" (`services/storage.py:516-521`).
    //
    // 2. `logo_key` WAS STORED, not just `logo_url`. This is the difference
    //    between a letterhead that works and one that works until this evening.
    //    `org_profile.py:180-186`: nothing had ever written `logo_key` since
    //    migration 057 backfilled it, so an org stored only the presigned URL,
    //    that URL expires in 32,400 seconds — nine hours, `storage.py:642` —
    //    and by the evening `GET` and `pay.py:_logo_url` had nothing to re-sign
    //    from. `_logo_key_from_url` (`:177`) recovers the key from the URL and
    //    verifies it by RE-SIGNING and comparing paths, because a wrong key is
    //    worse than none: `GET` prefers `logo_key`, so it would swap a URL that
    //    works for nine hours for one that never works at all.
    //
    // 3. THE COLUMN HOLDS A URL, NOT THE IMAGE. `logo_url` carried no validator
    //    at all while the three fields beside it each had one, so a PATCH could
    //    put `data:image/png;base64,…` — the whole file — into
    //    `staging.organisations` (`org_profile.py:124-131`). Files live in R2,
    //    never in the database.
    //
    // ── IDEMPOTENCE (§6), STATED PLAINLY INCLUDING WHAT IT DOES NOT DO ───────
    // A second run uploads the same fixture again, stores a new key, and ends
    // with the same logo on screen: the ORG'S STATE CONVERGES and every
    // assertion holds on both runs. What it does not do is clean up — each run
    // leaves one ~449-byte object behind in R2, because `LogoUpload.jsx` offers
    // NO control to remove a logo (the backend supports it: PATCH `logo_url:""`
    // clears both halves, `org_profile.py:526-529`). Deleting it any other way
    // would be a direct API write, which rule 1 bans. Recorded here rather than
    // hidden, and carried into the report.
    // ═════════════════════════════════════════════════════════════════════════
    //
    // The 11 MB buffer below plus a real upload plus two downloads is more wall
    // clock than a form test. `test.slow()` rather than a bare number so it
    // tracks the config's own timeout.
    test.slow();

    const wire = watchWire(page);
    await signInAs(page, requireUnicode());
    await openTab(page, 'profile');

    // `LogoUpload` renders the input inside its `<label className="olg__z">`
    // and hides it with `k-sr-only` (`LogoUpload.jsx:71-84`) so the label keeps
    // the file input's own keyboard behaviour and accessible name. That is the
    // correct construction and it is why the input is addressed directly:
    // `setInputFiles` does not require visibility, and clicking the label would
    // open a native picker Playwright cannot drive.
    const input = page.locator('.olg__z input[type="file"]');
    await expect(input).toHaveCount(1, { timeout: 30_000 });

    // The picker offers exactly what the server accepts. A format advertised and
    // then refused is a real bug this product has already had once: the accept
    // list offered `image/svg+xml` while `uploads.py` answered 415, until SVG
    // was allowed on 2026-08-08 (`uploads.py:32-37`).
    await expect(input).toHaveAttribute('accept', /image\/svg\+xml/);

    // ── 1. THE SIZE GUARD, FIRST, BECAUSE IT WRITES NOTHING ──────────────────
    //
    // 10 MB is the product's own constant twice over: `MAX_MB` in
    // `frontend/src/lib/uploadLimits.js:30`, which is `MAX_BYTES` in
    // `backend/routers/uploads.py:25`. The number is not repeated here — the
    // assertion reads it out of the message the product composes, so a change to
    // the constant that forgets the message fails this test.
    //
    // The buffer is built in memory rather than committed: an 11 MB file in the
    // repository to prove a 10 MB limit is a poor trade, and `setInputFiles`
    // takes a buffer with a name and a MIME type just as happily as a path.
    await input.setInputFiles({
      name: 'oversize-logo.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(11 * 1024 * 1024, 0x7a),
    });
    // `.tst__t` is the TITLE, `.tst__s` is the MESSAGE — 02.2b was a test bug for
    // reading that pair the wrong way round, and `TabProfile.jsx:140` puts the
    // verdict in the title and the arithmetic in the message.
    await expect(page.locator('.tst__t').getByText('That logo is too large')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('.tst__s').getByText('the limit is 10 MB')).toBeVisible();

    // THE CONSEQUENCE THAT MATTERS: nothing was sent. The point of a client-side
    // check is that the user does not pay for the whole transfer to be told no —
    // `uploadLimits.js` says so in those words — so a toast beside a request
    // that went anyway would be the guard failing while looking like it worked.
    expect(
      wire.filter((w) => /\/api\/upload/.test(w.line)).map((w) => w.line),
      'an oversized logo was still sent to the server — the client-side cap did ' +
        'not stop it, so the user pays the whole transfer to be refused',
    ).toEqual([]);

    // ── 2. THE REAL UPLOAD ───────────────────────────────────────────────────
    const fixture = readFileSync(logoFixturePath());
    expect(fixture.length, 'the logo fixture is missing or empty').toBeGreaterThan(0);

    const [uploaded] = await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/upload$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
        { timeout: 60_000 },
      ),
      input.setInputFiles(logoFixturePath()),
    ]);
    expect(
      uploaded.status(),
      `POST /api/upload -> ${uploaded.status()}: ${(await uploaded.text()).slice(0, 300)}` +
        dump(wire),
    ).toBeLessThan(400);

    const up = await uploaded.json();
    const uploadedKey: string = up.key || '';
    const uploadedUrl: string = up.url || '';

    // `upload_file` returns `{url, name, key, size, bucket}` (`storage.py:645`).
    // The KEY is the durable half and the client stores it beside the url
    // (`TabProfile.jsx:152`); an upload that answered 200 with no key is the
    // state note 2 above describes, and it must not pass silently.
    expect(uploadedKey, `POST /api/upload returned no key: ${JSON.stringify(up).slice(0, 300)}`)
      .toBeTruthy();
    expect(up.size, 'the server counted a different number of bytes than were sent')
      .toBe(fixture.length);

    // The key is in the ONE grammar (`services/storage_keys.py`): module / what
    // it belongs to / who did it / year / month / a time-sortable id and the
    // original filename. `personal` is the one module where the user segment
    // appears once, because there the user IS what the file belongs to. The
    // original filename surviving is the whole point of the `--` half — before
    // the grammar the key was a bare uuid, so "I uploaded Invoice-Mar.pdf" could
    // not be answered from storage at all.
    //
    // ⚠ IF THIS FAILS, CHECK THE ESCAPE HATCH BEFORE THE CODE.
    // `KARTAVYA_LEGACY_STORAGE_KEYS=1` (`services/storage_keys.py:213`) mints
    // the OLD shape — `personal/{user_id}/{uuid}{ext}`, with no date and no
    // original filename — and would fail this assertion for a reason that is a
    // deployment setting rather than a defect. It exists so the grammar can be
    // turned off in ninety seconds; it is not meant to be left on.
    expect(uploadedKey, `the key is not in the storage grammar: ${uploadedKey}`).toMatch(
      /(^|\/)personal\/[^/]+\/\d{4}\/\d{2}\/[^/]+--logo-unicode-e2e\.svg$/,
    );

    // ⚠ A FACT WORTH RECORDING RATHER THAN ASSERTING, and it is logged with the
    // user segment cut out because a key carries an id and a log is read by
    // people. `POST /api/upload` only resolves an org when a `team_id` is passed
    // (`uploads.py:213-226`), and the logo upload passes none — so `org_id` is
    // None, `_resolve_r2(None)` falls to the platform bucket, and the key is
    // prefixed `shared/` (`storage.py:143-147`). The read path agrees, because
    // `_client_for_key` routes `shared/` back to the platform bucket
    // (`storage.py:672`), which is why the round trip below works. Two knock-on
    // effects belong in the report, not in an assertion: the org's own Storage
    // tab is rooted at its own bucket and will never list this object, and
    // `update_org_storage` is skipped, so the logo never counts against the
    // allowance.
    console.log(
      `\n[02.13] key prefix: ${uploadedKey.split('/personal/')[0]}/personal/…` +
        `  (bucket: ${up.bucket})\n`,
    );

    // The screen says what happened, and says the truth: attached, NOT yet
    // applied. `TabProfile.jsx:153` — the object is in R2, the column is not
    // written until Save, and a toast claiming "saved" here would be a lie the
    // next reload exposes.
    await expect(page.locator('.tst__t').getByText('Logo attached')).toBeVisible({
      timeout: 20_000,
    });

    // The preview is `<img alt="Company logo">` (`LogoUpload.jsx:86`), and it
    // replaces the "Drop a logo here" prompt.
    const preview = page.locator('.olg__z img[alt="Company logo"]');
    await expect(preview).toBeVisible({ timeout: 20_000 });
    await expect(preview).toHaveAttribute('src', uploadedUrl);

    // ── 3. THE DOWNLOAD — the assertion this test exists for ─────────────────
    //
    // Fetched from the presigned URL, unauthenticated as far as our API is
    // concerned: the signature is in the query string, so this is R2 answering,
    // not Kartavya. A GET, which the bypass ratchet allows by name because
    // "asserting the row appeared IS the required evidence".
    const first = await page.request.get(uploadedUrl);
    expect(first.status(), `GET the presigned logo URL -> ${first.status()}`).toBe(200);
    const firstBytes = await first.body();
    expect(
      firstBytes.length,
      'the presigned URL answered 200 with an EMPTY body — the object was not ' +
        'written, or was written to a bucket the signature does not address',
    ).toBeGreaterThan(0);
    expect(
      firstBytes.equals(fixture),
      `the bytes that came back are not the bytes that went up ` +
        `(${firstBytes.length} received, ${fixture.length} sent)`,
    ).toBe(true);

    // ── 4. SAVE, AND THE DURABLE HALF ────────────────────────────────────────
    const saved = await saveAndWait(page, /Save company profile/, /\/org\/profile/);
    expect(saved.status(), `saving the logo answered ${saved.status()}.${dump(wire)}`)
      .toBeLessThan(400);
    await expect(page.locator('.tst__t').getByText(/Company profile saved/i).last())
      .toBeVisible({ timeout: 30_000 });

    // `logo_key` is NOT declared on `ProfileUpdate` (`org_profile.py:218-229`)
    // — deliberately, so an org admin cannot aim the profile at an arbitrary
    // object and have the API sign it for them. The server derives it from the
    // url instead. So this reads the server's own copy: if the derivation
    // failed, `logo_key` is empty, the column holds a URL that dies in nine
    // hours, and every invoice printed tomorrow has a broken letterhead.
    const stored = await orgProfile(page);
    expect(
      stored.logo_key,
      'the profile saved a logo_url but NO logo_key — `_logo_key_from_url` did ' +
        'not recover the key, so the letterhead will break when the signature ' +
        'expires nine hours from now (services/storage.py:642)',
    ).toBe(uploadedKey);
    expect(
      String(stored.logo_url || '').startsWith('data:'),
      'the logo was stored as a data: URI — the image is in the database column, ' +
        'not in R2 (files live in R2, never in the database)',
    ).toBe(false);

    // ── 5. THE RELOAD — a FRESH signature, over the SAME object ──────────────
    //
    // `GET /v1/org/profile` re-signs from `logo_key` and overwrites `logo_url`
    // in the response (`org_profile.py:349-351`). That is the whole mechanism
    // note 2 describes, so it is asserted end to end: the reloaded `src` must
    // address the key just stored, and must still download to the same bytes.
    //
    // The URL is NOT compared to the upload's URL for equality or inequality.
    // A presigned URL's `X-Amz-Date` has one-second granularity, so two
    // signatures made in the same second are identical and an inequality
    // assertion would be flaky for a reason that has nothing to do with the
    // product. The key and the bytes are the facts; the signature is not.
    await page.reload();
    await expect(preview).toBeVisible({ timeout: 30_000 });
    const reloadedUrl = (await preview.getAttribute('src')) || '';
    expect(reloadedUrl.startsWith('data:'), 'the logo rendered as a data: URI').toBe(false);
    expect(
      decodeURIComponent(new URL(reloadedUrl).pathname).endsWith(uploadedKey),
      `after a reload the logo points at a different object.\n` +
        `     stored key : ${uploadedKey}\n` +
        `     signed path: ${decodeURIComponent(new URL(reloadedUrl).pathname)}`,
    ).toBe(true);

    const second = await page.request.get(reloadedUrl);
    expect(second.status(), `GET the RE-SIGNED logo URL -> ${second.status()}`).toBe(200);
    const secondBytes = await second.body();
    expect(
      secondBytes.equals(fixture),
      'the re-signed URL did not return the logo. The object is in one bucket ' +
        'and the signature addresses another — which is exactly what ' +
        '`_client_for_key` (services/storage.py:670) exists to prevent, and what ' +
        'made every object in the platform bucket write-only before it did.',
    ).toBe(true);

    console.log(
      `\n[02.13] round trip OK: ${fixture.length} bytes up, ${firstBytes.length} back ` +
        `from the upload URL, ${secondBytes.length} back from the re-signed URL; ` +
        `logo_key stored.\n` +
        `[02.13] ⚠ NOT CLEANED UP — this run left one object in R2. LogoUpload.jsx ` +
        `offers no control to remove a logo, and removing it any other way would ` +
        `be a direct API write (rule 1).\n`,
    );
  });

  /* ═══════════════════════════════════════════════════════════════════════
   * MODULE GRANTS AND THE ACCESS MATRIX — §10's last two members screens, and
   * the two that COULD NOT HAVE EXISTED BEFORE TODAY.
   *
   * ── Why not before ────────────────────────────────────────────────────────
   * Until 2026-08-28 Unicode Group held ZERO `module_subscriptions` rows —
   * `dayone-module-403.spec.ts` is the capture of that state, and 02.3's own
   * rewrite note records it. A grant NAMES a module, and `_validate_grants`
   * REJECTS a grant naming a module the org does not subscribe to (it does not
   * drop the module and keep the rest), so on a zero-subscription org there was
   * nothing a grant could legally say. Suite 19 provisioned twelve from the
   * platform console today, so these two tests became writable this afternoon
   * and not before.
   *
   * The twelve, asserted below through `GET /v1/subscription/current` rather
   * than trusted from this comment: graha, vikray, prachar, sahayak, dristi,
   * sanvaad, esign, pahchan, ganit, manav, vetana, kray. **`varta` is EXCLUDED
   * BY DECISION (§13), not blocked** — it must stay off, and both tests say so
   * out loud so a future reader finding that column dark does not file it as a
   * provisioning miss.
   *
   * ── THE ONE FACT THAT DECIDES WHO THESE TESTS MAY USE ─────────────────────
   * `middleware/subscription.py` gate 2 SHORT-CIRCUITS FOR BOTH ORG ROLES:
   *
   *     :636   any(r in ORG_MANAGEMENT_ROLES for r in org_roles)   # owner|admin
   *     :642   if not org_role:
   *     :643       # org_member needs explicit grant.
   *     :663       "You don't have access to the {module_code} module. "
   *     :664       "Ask your org admin to grant it."          (stage="no_grant")
   *
   * `ORG_MANAGEMENT_ROLES` is `("org_owner", "org_admin")` —
   * `middleware/role_tiers.py:108` — and `auth_router._module_grants` mirrors
   * the same gate, returning `None` ("no opinion") for owner and admin, which is
   * why `navConfig.js:296` leaves every module in their sidebar.
   *
   * So **a grants test driven against an org_admin proves nothing**: the module
   * is reachable with the grant, without the grant, and with the grant row
   * deleted. 02.14 therefore drives an `org_member`, asserts through the
   * member's OWN `/api/auth/me` that they really are one at the moment of the
   * probe, and steers the role back if a previous run left it drifted.
   *
   * ── The member these two tests own ────────────────────────────────────────
   * `SLOTS` above is 02.8's roster, and 02.10 deliberately toggles `+uops`'s
   * role back and forth; a grants test that also drove `+uops` would be two
   * tests steering one row. So these two seat their OWN slot through the SAME
   * mechanism — `addOrInvite` → `Copy invite link` → `acceptInvite` in a clean
   * browser — rather than inventing a parallel one. Nothing here is created by
   * SQL or by an API write; `page.request.get` is verification, which is what
   * `frontend/scripts/check-e2e-no-bypass.mjs` permits in those words.
   * ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The slot 02.14 and 02.15 own. Same address scheme as `SLOTS` (`slotEmail`),
   * same password scheme as 02.8's `acceptInvite` call — `Kt-<tag>-93-Aug!` —
   * because 02.14 has to sign in AS this person, and the only run that can set a
   * password is the run that accepts the invitation.
   *
   * ⚠ THE STANDING HAZARD, recorded rather than papered over: these are the
   * owner's real gmail plus-tags and the invitation genuinely lands in a real
   * inbox. On 2026-08-28 the owner opened one on their phone and accepted it
   * themselves (02.8's note: `audit_log` 5707, iPhone Safari). If that happens
   * to THIS address the password below is not the account's password and the
   * member login fails. That is an ENVIRONMENT condition, not a product or test
   * defect, and the throw in 02.14 says so in those words rather than letting a
   * 45-second `waitForURL` timeout read like a broken login form.
   */
  const GRANT_SLOT = { tag: 'grn', name: 'Anaya Iyer', role: 'org_member' as const };
  const GRANT_SLOT_PASSWORD = `Kt-${GRANT_SLOT.tag}-93-Aug!`;

  /**
   * The module 02.14 grants and revokes — PINNED, not picked from whatever the
   * subscription happens to hold, because the reachability probe has to be an
   * endpoint gated by THIS module and nothing else.
   *
   * · `graha` is active on Unicode — asserted, not assumed.
   * · It is NOT in `catalogue.js`'s `sensitive` set (vetana, ganit, manav), so
   *   `sensitiveGrantRaises` finds no raise and `saveGrants` commits without the
   *   ConfirmDialog (`TabMembers.jsx:414-439`). A sensitive module at approver
   *   would additionally hit `role_tiers.refuse_grant`'s owner-only rule, and
   *   this lane is an org_admin.
   * · `GET /api/v1/graha/pipelines` hangs on the BARE `_gate`
   *   (`routers/graha.py:1586-1591`; `_gate = require_module("graha")` at :46).
   *   `/graha/clients` is NOT usable here — it hangs on `_crm_entity_gate`,
   *   which is `require_any_module("graha", "ganit", "vikray")` (:69), so a
   *   member holding Ganit would pass it without holding Graha at all. That
   *   distinction is the difference between a probe and a coincidence.
   * · `viewer` is what the picker sends: `defaultLevelFor('graha')` falls to
   *   `DEFAULT_GRANT_LEVEL` (`levels.js`). A GET is not a write, so
   *   `level_satisfies(viewer, EDITOR, …)` is never consulted on this probe.
   * · The sidebar row is `en: 'CRM'` (`navConfig.js:75`) — the ENGLISH label,
   *   not the module's own name. It is what the customer actually reads.
   */
  const GRANT_MODULE = {
    code: 'graha',
    label: 'Graha',
    levelLabel: 'Viewer',
    navEn: 'CRM',
    probe: '/api/v1/graha/pipelines',
  };

  /**
   * Level code → the word the product paints. Transcribed from
   * `frontend/src/pages/org/levels.js` (`LEVEL_LABELS`) rather than imported:
   * `catalogue.js` pulls in `lib/moduleColors`, and a spec that imports the
   * app's module graph starts caring about the bundler. Four literals a failure
   * message will name is the cheaper coupling.
   */
  const LEVEL_LABEL: Record<string, string> = {
    viewer: 'Viewer', editor: 'Editor', approver: 'Approver', admin: 'Admin',
  };

  /**
   * The catalogue, in `catalogue.js`'s own order — THIRTEEN, not twelve.
   * `AccessMatrix` draws a column for every entry whether or not the org
   * subscribes to it ("the column still paints, because a grant that outlived
   * its subscription is exactly the row worth finding"), so thirteen columns
   * with exactly one marked `· off` is the shape 02.15 asserts.
   *
   * Codes and labels are kept as two parallel lists rather than one object so
   * the column-order assertion can compare labels directly against what the
   * header row rendered. `kartavya` is deliberately in NEITHER: core PM is
   * reached by org membership and a grant naming it is a 400 (`catalogue.js:20`).
   */
  const CATALOGUE_LABELS = [
    'Graha', 'Vikray', 'Ganit', 'Kray', 'Vetana', 'Manav', 'Prachar',
    'Dristi', 'Sahayak', 'Sanvaad', 'E-Sign', 'Varta', 'Pahchan',
  ];
  const CATALOGUE_CODES = [
    'graha', 'vikray', 'ganit', 'kray', 'vetana', 'manav', 'prachar',
    'dristi', 'sahayak', 'sanvaad', 'esign', 'varta', 'pahchan',
  ];

  /** The org's ACTIVE module codes, from the server. The same read 02.3 makes. */
  async function activeModuleCodes(page: Page): Promise<string[]> {
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    const res = await page.request.get(`${API_BASE}/api/v1/subscription/current`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    expect(res.ok(), `GET /subscription/current -> ${res.status()}`).toBeTruthy();
    const body = await res.json();
    return (body?.active_modules ?? body?.data?.active_modules ?? []) as string[];
  }

  /**
   * This session's Tier-2 role IN THIS LANE'S ORG.
   *
   * Read, never assumed. `_lanes.ts` records the Unicode credential as an
   * `org_admin`, and `MemberTable.jsx:117` makes the grants control a function
   * of exactly that — `canEditGrants = !owner && (isOwner || !admin)` — so
   * whether "Edit module grants" is offered on an ADMIN row depends on who is
   * looking. 02.15 asserts the rule the caller is actually subject to rather
   * than the one a lane file says they should be.
   *
   * Matched on `org_id`, which `/api/auth/me` returns as text (`auth_router.py`
   * selects `ur.org_id::text`), against `LANE.orgId` — the id `assertOrg`
   * already proved this session resolves to.
   */
  async function callerOrgRole(page: Page): Promise<string | null> {
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    const res = await page.request.get(`${API_BASE}/api/auth/me`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    expect(res.ok(), `GET /api/auth/me -> ${res.status()}`).toBeTruthy();
    const body = await res.json();
    const rows = Array.isArray(body?.org_roles) ? body.org_roles : [];
    return rows.find((r: any) => String(r.org_id) === LANE.orgId)?.role_code ?? null;
  }

  /** One member row as the SERVER holds it, by address. */
  async function memberByEmail(page: Page, email: string) {
    return (await members(page)).find((m) => lower(m.email) === email);
  }

  /**
   * The grants on a member row, as `{code, level}`.
   *
   * `GET /v1/org/members` returns BOTH shapes — `modules` (bare codes, kept for
   * clients that predate levels) and `module_grants` (`[{code, role}]`) — from
   * the same rows (`org_members.py:225-234`). `module_grants` is read first,
   * because a grant without its level is half the fact; the bare list is the
   * fallback, and a bare code reads as `viewer` for the reason `GrantChips.jsx`
   * gives: `org_member_modules.role` is `NOT NULL DEFAULT 'viewer'`.
   */
  function grantsOf(m: any): { code: string; level: string }[] {
    const raw = (m?.module_grants ?? m?.modules ?? []) as any[];
    return raw.map((g) => (typeof g === 'string'
      ? { code: g, level: 'viewer' }
      : { code: g.code || g.module_code, level: g.role || g.level || 'viewer' }));
  }

  /**
   * Seat this test's own member, idempotently — 02.8's mechanism, not a second
   * one. A slot already seated is verified and left alone; a stale invitation is
   * revoked and re-issued, because the product shows an invite link ONCE and an
   * admin who lost it revokes and re-invites.
   *
   * The password is only ever set on the run that ACCEPTS. Later runs meet an
   * account that already exists, so `addOrInvite` legitimately takes the "added
   * straight away" path — which is why the outcome is NOT asserted here. 02.11
   * records the same reasoning: both paths are correct, and a test that fails on
   * correct behaviour is a defect in the test (93 §0).
   */
  async function seatOwnMember(page: Page, browser: any) {
    const email = slotEmail(GRANT_SLOT.tag);
    let seated = await memberByEmail(page, email);
    if (seated) return seated;

    const pending = (await pendingInvites(page)).find((i) => lower(i.email) === email);
    if (pending) {
      await openTab(page, 'members');
      await page
        .locator('.of__f--row')
        .filter({ hasText: email })
        .getByRole('button', { name: /Revoke/ })
        .click();
      await expect(page.locator('.tst__t').getByText(/revoked/i)).toBeVisible({ timeout: 20_000 });
    }

    const { outcome } = await addOrInvite(page, email, GRANT_SLOT.role);
    if (outcome === 'invited') {
      const link = await copyInviteLink(page);
      await acceptInvite(browser, link, GRANT_SLOT.name, GRANT_SLOT_PASSWORD);
    }
    seated = await memberByEmail(page, email);
    expect(seated, `${email} did not become a member of ${LANE.org}`).toBeTruthy();
    return seated;
  }

  /**
   * The two halves of the Members tab. `TabMembers.jsx:454` renders them as a
   * `role="group"` labelled "Member view" with `aria-pressed` on each button —
   * so the switch is asserted through the same contract a keyboard user gets,
   * and the lookup is scoped to the group because "List" is a common word.
   */
  async function memberView(page: Page, which: 'List' | 'Access matrix') {
    const seg = page.getByRole('group', { name: 'Member view' });
    await expect(
      seg,
      'the List / Access matrix switch is the only route to the matrix from ' +
      'Organisation ▸ Members; without it the grid is unreachable here',
    ).toBeVisible({ timeout: 30_000 });
    const btn = seg.getByRole('button', { name: which, exact: true });
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }

  /**
   * Steer a member's Tier-2 role to `want` through the real row menu, and do
   * nothing if it is already there.
   *
   * 02.8's converge pattern, for 02.8's reason: a run that fails AFTER its PUT
   * lands leaves the row drifted, and the next run has to start from wherever it
   * was left rather than from one assumed state. The menu offers only the
   * transition that applies — `admin ? 'Make org member' : 'Make org admin'`,
   * `MemberTable.jsx:123` — so reading first is also the only way this lookup
   * can be written once instead of twice.
   */
  async function steerOrgRole(page: Page, email: string, want: 'org_admin' | 'org_member') {
    const m = await memberByEmail(page, email);
    expect(m, `${email} is not in GET /org/members`).toBeTruthy();
    if (m.role_code === want) return m;

    await openTab(page, 'members');
    await memberView(page, 'List');
    const row = page.locator('.omt tbody tr').filter({ hasText: email });
    await expect(row).toBeVisible({ timeout: 30_000 });

    /**
     * ⚠ THROUGH `rowMenuItem`, AND IT USED NOT TO BE.
     *
     * This function opened the menu and clicked the item directly, because it
     * was written BEFORE `rowMenuItem` existed and was never migrated to it.
     * The wave1 run of 2026-08-29 caught up with that: 02.15 failed with
     *
     *     locator.click: element is not stable
     *       ... element was detached from the DOM, retrying
     *
     * on `Make org admin` — the identical signature, the identical cause and
     * the identical table as 02.14 on 28 Aug. `openTab`/`memberView` refetch
     * `/org/members` and the response replaces `.omt tbody` while the menu
     * opened over it is still animating, so the item the click resolved is a
     * node in a discarded tree.
     *
     * TEST BUG, not a product one, and the same proof as last time: a human
     * clicking a settled screen never meets this. It went unnoticed because the
     * race only bites when the refetch lands inside the click's actionability
     * window — 02.15 had passed on every prior run.
     *
     * ── THE `waitForResponse` IS ARMED BEFORE THE CLICK, NOT AROUND IT ──────
     * `rowMenuItem` owns the click, so the old `Promise.all([...])` shape
     * cannot wrap it. Creating the response promise FIRST is equivalent and is
     * the reason this is safe: `waitForResponse` begins listening the moment it
     * is constructed, so a PUT that lands during the click is still caught.
     *
     * A retry cannot double-fire the PUT: both signatures `rowMenuItem` retries
     * on are raised by Playwright's actionability wait, which is BEFORE the
     * click is dispatched. And the menu offers only the transition that applies
     * (`MemberTable.jsx:123`), so a retry after a PUT that had somehow landed
     * would fail to find its item and fail loudly rather than flip the role
     * back.
     */
    const rolePut = page.waitForResponse(
      (r) => /\/org\/members\/.*\/role/.test(r.url()) && r.request().method() === 'PUT',
      { timeout: 30_000 },
    );
    await rowMenuItem(
      page,
      row,
      want === 'org_admin' ? /Make org admin/ : /Make org member/,
      `the row menu for ${email} offers no "Make ${want === 'org_admin' ? 'org admin' : 'org member'}"`,
    );
    const res = await rolePut;
    expect(res.status(), `PUT role -> ${res.status()}`).toBeLessThan(400);

    const after = await memberByEmail(page, email);
    expect(after?.role_code, `${email} would not move to ${want}`).toBe(want);
    return after;
  }

  /**
   * Open a member row's Actions menu and click one item, surviving the list
   * refetch that lands underneath it.
   *
   * ⚠ THIS IS A TEST BUG'S FIX, AND IT IS WRITTEN DOWN SO IT IS NOT LATER READ
   * AS A PRODUCT ONE. 02.14 failed in the wave1 run of 2026-08-28 with:
   *
   *     locator.click: waiting for menuitem "Edit module grants"
   *       - element is not stable ... element was detached from the DOM
   *
   * The members table refetches after `openTab`/`memberView`, and the refetch
   * replaces `.omt tbody` while the menu opened over it is still animating. The
   * item the click had already resolved is then a node in a discarded tree.
   * Nothing about the product is wrong: a human clicking a settled screen never
   * meets it, which is exactly why the test met it and the customer does not.
   *
   * TWO MEASURES, and the order matters:
   *   1. SETTLE FIRST. Any `/org/members` GET already in flight is awaited, so
   *      the common case never races at all. This is the real fix.
   *   2. RE-RESOLVE, at most three times, and ONLY on the detach/instability
   *      signature. A blind retry would paper over a genuinely missing or
   *      genuinely disabled control, which is the one thing this suite exists
   *      to catch — so any other failure is rethrown on the first attempt, and
   *      the last detach failure is rethrown too rather than swallowed.
   */
  async function rowMenuItem(
    page: Page,
    row: Locator,
    name: RegExp,
    why: string,
  ): Promise<void> {
    // (1) Let the list settle. `waitForResponse` with a short timeout that is
    //     allowed to lapse: "no members request was in flight" is a perfectly
    //     good outcome and must not fail the test.
    await page
      .waitForResponse(
        (r) => r.url().includes('/org/members') && r.request().method() === 'GET',
        { timeout: 2_000 },
      )
      .catch(() => {});

    let last: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await row.getByRole('button', { name: /Actions for/ }).click();
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 10_000 });
        const item = menu.getByRole('menuitem', { name });
        await expect(item, why).toBeVisible({ timeout: 10_000 });
        await item.click({ timeout: 10_000 });
        return;
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        const isRace = /detached from the DOM|not stable|element is not attached/i.test(msg);
        if (!isRace || attempt === 3) throw e;
        last = e;
        console.log(`
[rowMenuItem] the list moved under the menu — retry ${attempt}
`);
        // Close whatever survived, then let the tree settle before re-resolving.
        await page.keyboard.press('Escape').catch(() => {});
        await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 5_000 }).catch(() => {});
      }
    }
    throw last;
  }

  /**
   * Open the grant sheet on a member's row and return the dialog.
   *
   * ⚠ The menu row is "Edit module grants" (`MemberTable.jsx:120`) and it is
   * CONDITIONAL: `canEditGrants = !owner && (isOwner || !admin)` (:117). An
   * owner's grants are editable by nobody in the org — the owner reaches
   * everything by role, and an admin editing them would be privilege escalation
   * by way of a settings screen — and an admin's grants belong to the OWNER. So
   * this helper is only ever called on a MEMBER row; 02.15 asserts the absence
   * on an admin row rather than this helper asserting the presence everywhere.
   *
   * Scoped to `getByRole('menu')`, suite rule 6: an unscoped name match resolves
   * in DOM order and will happily hit the sidebar instead of the row's action.
   */
  async function openGrantSheet(page: Page, email: string, display: string) {
    await openTab(page, 'members');
    await memberView(page, 'List');
    const row = page.locator('.omt tbody tr').filter({ hasText: email });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await rowMenuItem(
      page,
      row,
      /Edit module grants/,
      'there is no other route to a member’s module grants — if this row is ' +
      'gone the screen is unreachable, which is a product defect and not a ' +
      'selector problem',
    );

    // `Sheet.jsx:84` — `role="dialog"`, `aria-modal`, and the title rendered in
    // `.sheet__title` as well as carried on `aria-label`.
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    // Opened on the RIGHT PERSON. A sheet that opened one row up would save
    // perfectly well, against somebody else, and nothing downstream would tell.
    await expect(sheet.locator('.sheet__title')).toContainText(display, { timeout: 10_000 });
    return sheet;
  }

  /**
   * Turn one module on or off for a member, through the real control, and wait
   * for the server's answer before going on.
   *
   * ⚠ The toggle is `role="checkbox"`, NOT `<input type="checkbox">`.
   * `ui/Checkbox.jsx:14-22` renders `<button role="checkbox" aria-checked>` on
   * purpose — "the DOM checkbox's `indeterminate` is a JS-only property with no
   * attribute" — so `toBeChecked()` does not apply and `aria-checked` is the
   * state to read. The accessible name is `${mod.label} access`, from the
   * `label` prop `GrantRow` passes in `ModuleGrantEditor.jsx`.
   *
   * The save is `PUT /v1/org/members/{id}/modules` with REPLACE semantics, and
   * `commitGrants` sends the member's WHOLE draft every time — so toggling one
   * module preserves the rest. That is not incidental: the endpoint's INSERT
   * once omitted `role`, so re-saving to change one checkbox silently demoted
   * every other grant to viewer (`org_members.py:657-661`).
   */
  async function setModuleGrant(
    page: Page, wire: Wire, email: string, display: string, label: string, on: boolean,
  ) {
    const sheet = await openGrantSheet(page, email, display);
    const box = sheet.getByRole('checkbox', { name: `${label} access` });
    await expect(
      box,
      `the grant editor offers no row for ${label}. For an EXISTING member the ` +
      'sheet renders the WHOLE catalogue regardless of the subscription — ' +
      '`TabMembers.jsx` passes `codes={null}` deliberately, so that a grant which ' +
      'outlived its subscription can be found and turned off — so a missing row ' +
      'here is a missing control, not a missing entitlement.',
    ).toBeVisible({ timeout: 15_000 });

    if ((await box.getAttribute('aria-checked')) !== String(on)) await box.click();
    await expect(box).toHaveAttribute('aria-checked', String(on));

    // The status is the server's answer; the toast is the client's opinion of
    // it. Both are asserted, and the failure message says which one disagreed.
    const res = await saveAndWait(page, /Save access/, /\/org\/members\/.*\/modules/);
    expect(
      res.status(),
      `${on ? 'granting' : 'revoking'} ${label} for ${email} answered ` +
      `${res.status()}.${dump(wire)}`,
    ).toBeLessThan(400);
    await expect(page.locator('.tst__t').getByText(/Module access updated/i).last())
      .toBeVisible({ timeout: 20_000 });
    // `commitGrants` closes the sheet and refetches the list on success. A sheet
    // still open is a save that did not complete, whatever the status said.
    await expect(sheet).toHaveCount(0, { timeout: 15_000 });
  }

  /**
   * The module-rail row for one module, in the SIGNED-IN MEMBER'S browser.
   *
   * ⚠ COUNTED, never `toBeVisible()`, and the reason is in `Sidebar.jsx`'s own
   * words at :202-217: "A COLLAPSED SECTION STILL HOLDS ITS ROWS… the row is not
   * `display: none`". Every section except `workspace` starts collapsed
   * (`CORE_SECTION`, :26) and Graha is not in `workspace`, so on a first visit
   * the row is in the DOM and clipped. Visibility would answer the wrong
   * question: this asks whether the nav OFFERS the module at all, which is what
   * `navConfig.js:283-296` decides from `module_grants[]`.
   *
   * Two locators, because the label only renders when the rail is WIDE
   * (`{!rail && <span className="side__label">…`, :338-350). In rail mode the
   * button carries `title={en}` instead, and the rail is a stored user
   * preference this test does not control.
   */
  const moduleNavRow = (p: Page, en: string) =>
    p.locator('aside.side .side__item').filter({ hasText: en })
      .or(p.locator(`aside.side .side__item[title="${en}"]`));

  /**
   * What this member can actually reach, asked of the server with the MEMBER'S
   * own bearer — three answers in one round trip, so a failure can tell them
   * apart:
   *
   *   role    their Tier-2 role. If this is not `org_member` the probe proves
   *           nothing: gate 2 short-circuits for owner and admin.
   *   grants  `/api/auth/me`'s `module_grants[]`, which `_module_grants`
   *           computes by mirroring `require_module` "gate for gate", and which
   *           is the exact feed the sidebar reads.
   *   probe   a real module-gated GET. The nav is a promise; this is the door.
   */
  async function memberReach(p: Page) {
    const token = await p.evaluate(() => localStorage.getItem('auth_token'));
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const meRes = await p.request.get(`${API_BASE}/api/auth/me`, { headers });
    expect(meRes.ok(), `GET /api/auth/me as the member -> ${meRes.status()}`).toBeTruthy();
    const me = await meRes.json();
    const probe = await p.request.get(`${API_BASE}${GRANT_MODULE.probe}`, { headers });
    return {
      role: (Array.isArray(me?.org_roles) ? me.org_roles : [])
        .find((r: any) => String(r.org_id) === LANE.orgId)?.role_code ?? null,
      // `Array.isArray`, not `|| []`. ABSENT means NO OPINION (an owner or an
      // admin, whose reach is the subscription); an EMPTY ARRAY means "nothing".
      // navConfig.js:283-296 turns on exactly that difference and so does this.
      grants: Array.isArray(me?.module_grants) ? (me.module_grants as string[]) : null,
      status: probe.status(),
      body: (await probe.text()).slice(0, 300),
    };
  }

  test('02.14 members — a module grant is granted and revoked, and it changes what that member can reach', async ({
    page,
    browser,
  }) => {
    // Two browsers, four grant saves, a form login and three reloads.
    test.setTimeout(8 * 60_000);
    const wire = watchWire(page);
    await signInAs(page, requireUnicode());
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // ── 0 · The precondition, ASSERTED ──────────────────────────────────────
    // Provisioned today. If it is ever rolled back this test must say so in one
    // line, rather than failing forty lines later on an empty grant sheet.
    const active = await activeModuleCodes(page);
    expect(
      active,
      `${GRANT_MODULE.code} is not active on ${LANE.org}, so no grant may legally ` +
      'name it — `_validate_grants` rejects the whole request over one ' +
      'unsubscribed module. Aekam platform staff provision modules (Suite 19). ' +
      'ENVIRONMENT precondition, not a defect in the grants screen.',
    ).toContain(GRANT_MODULE.code);
    expect(
      active,
      'varta is EXCLUDED BY DECISION (§13), not blocked, and must stay off',
    ).not.toContain('varta');

    // ── 1 · The subject, and the one thing that makes this test mean anything ─
    const email = slotEmail(GRANT_SLOT.tag);
    await seatOwnMember(page, browser);
    const subject = await steerOrgRole(page, email, 'org_member');
    const display = subject.full_name || subject.email;
    expect(
      subject.role_code,
      'this test MUST drive an org_member. subscription.py:636-642 short-circuits ' +
      'for org_owner and org_admin, so against either of those the module is ' +
      'reachable with the grant, without it, and with the row deleted — and the ' +
      'test would go green having proved nothing.',
    ).toBe('org_member');

    // ── 2 · The REVOKED baseline, DRIVEN rather than assumed ────────────────
    // A member seated on the "added" path arrives holding every active
    // non-sensitive module (`add_member`'s default branch, mirrored by
    // `defaultGrantsFor`); one seated on the "invite" path arrives holding
    // NOTHING, because `add_member` hands `issue_invite` an empty grant list and
    // the add form says so on screen in as many words. Both are correct, so
    // neither may be assumed, so the baseline is established by the control.
    await setModuleGrant(page, wire, email, display, GRANT_MODULE.label, false);
    expect(
      grantsOf(await memberByEmail(page, email)).map((g) => g.code),
      `${email} still holds ${GRANT_MODULE.code} after the revoke${dump(wire)}`,
    ).not.toContain(GRANT_MODULE.code);

    // ── 3 · The member's own browser ────────────────────────────────────────
    // A clean context with no session. Reading this from the admin's browser
    // would prove only that the ADMIN can reach Graha, which nobody doubts.
    const ctx = await browser.newContext();
    const mp = await ctx.newPage();
    const log: string[] = [];
    try {
      try {
        // The same door the rest of this suite uses, so the member's session is
        // proved to resolve to THIS org before anything is read from it.
        await signInAs(mp, { email, password: GRANT_SLOT_PASSWORD });
      } catch (err) {
        throw new Error(
          `BLOCKED — could not sign in as ${email}. This suite sets that ` +
          'account’s password only on the run that ACCEPTS its invitation ' +
          '(see GRANT_SLOT_PASSWORD). These are the owner’s real gmail ' +
          'plus-tags, so if a human accepted this invitation from their own ' +
          'inbox they chose their own password — which is exactly what happened ' +
          'to `+uops` on 2026-08-28 (audit_log 5707). Remove the seat and the ' +
          'account, or reset the password, to re-open this lane. ENVIRONMENT ' +
          `blocker, not a product or test defect.\n  underlying: ${String(err).slice(0, 300)}`,
        );
      }

      const before = await memberReach(mp);
      expect(
        before.role,
        'the member’s own session must resolve to org_member in this org, or ' +
        'gate 2 short-circuits and the probe below proves nothing',
      ).toBe('org_member');
      expect(
        before.grants,
        'an org_member must get a LIST from `_module_grants`, never `null`. Null ' +
        'is "no opinion" and leaves every module in their sidebar — the exact ' +
        'three-state contract navConfig.js:283-296 depends on.',
      ).not.toBeNull();
      expect(before.grants, `${email} still holds ${GRANT_MODULE.code}`)
        .not.toContain(GRANT_MODULE.code);

      // THE DOOR, not the promise. `require_module` refuses at stage `no_grant`
      // with a sentence that names the remedy; that sentence is the product
      // being RIGHT, and asserting it keeps a refactor from replacing it with
      // "Forbidden" — the day-one capture found four screens already framing a
      // module refusal as a permission problem instead of an actionable one.
      expect(
        before.status,
        `${GRANT_MODULE.probe} answered ${before.status} for a member with no ` +
        `grant. Expected 403. Body: ${before.body}`,
      ).toBe(403);
      expect(before.body).toMatch(/have access to the graha module/i);
      expect(before.body).toMatch(/Ask your org admin to grant it/i);

      // And the rail does not advertise a door it cannot open — RBAC-SPEC denied
      // state 1, quoted inside `auth_router._module_grants`: "No access →
      // absent from the sidebar, never a greyed-out row that advertises what is
      // missing."
      await expect(mp.locator('aside.side')).toBeVisible({ timeout: 30_000 });
      await expect(
        moduleNavRow(mp, GRANT_MODULE.navEn),
        `the sidebar still offers ${GRANT_MODULE.navEn} to a member the API ` +
        'refuses — a row that advertises what is missing',
      ).toHaveCount(0);
      log.push(
        `revoked → /auth/me grants=[${before.grants!.join(', ')}], ` +
        `${GRANT_MODULE.probe} ${before.status}, nav row absent`,
      );

      // ── 4 · GRANT IT, from the admin's browser ────────────────────────────
      await setModuleGrant(page, wire, email, display, GRANT_MODULE.label, true);

      // The row is the evidence. The LEVEL matters as much as the code: the
      // picker is supposed to SEND a level rather than let the column default
      // decide it, and `org_member_modules.role` is `NOT NULL DEFAULT 'viewer'`,
      // so a picker sending nothing would look identical here and differ only on
      // Sanvaad. Asserted where the difference can still be seen.
      const held = grantsOf(await memberByEmail(page, email))
        .find((g) => g.code === GRANT_MODULE.code);
      expect(
        held,
        `${GRANT_MODULE.code} is not in GET /org/members after the grant${dump(wire)}`,
      ).toBeTruthy();
      expect(
        held!.level,
        `the picker stored level "${held!.level}"; defaultLevelFor(` +
        `'${GRANT_MODULE.code}') is viewer`,
      ).toBe('viewer');

      // The SCREEN agrees with the server: reopen the sheet and read it back. A
      // 200 with a box still unticked is the same class of lie one layer up.
      const reopened = await openGrantSheet(page, email, display);
      await expect(reopened.getByRole('checkbox', { name: `${GRANT_MODULE.label} access` }))
        .toHaveAttribute('aria-checked', 'true');
      // Names, never ids — the standing rule, on a surface 02.7's tab sweep
      // cannot reach because it only exists while a sheet is open.
      expect(
        ((await reopened.innerText()) || '')
          .match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i),
        'the module-grant sheet rendered a UUID',
      ).toBeNull();
      await reopened.getByRole('button', { name: /^Cancel$/ }).click();
      await expect(reopened).toHaveCount(0, { timeout: 10_000 });

      // ── 5 · THE CONSEQUENCE, in the member's browser ──────────────────────
      // Reloaded, because `Protected.jsx:144` fetches `/auth/me` on mount and
      // the sidebar is rendered from that record. Nothing is re-minted: grants
      // are read per request, so the SAME session sees the change.
      await mp.reload();
      await expect(mp.locator('aside.side')).toBeVisible({ timeout: 30_000 });
      const granted = await memberReach(mp);
      expect(granted.role, 'still an org_member — the grant must be what changed')
        .toBe('org_member');
      expect(granted.grants, '/auth/me did not report the new grant')
        .toContain(GRANT_MODULE.code);
      expect(
        granted.status,
        `${GRANT_MODULE.probe} answered ${granted.status} for a member who HOLDS ` +
        `${GRANT_MODULE.code} at viewer. A GET is not a write, so the level rung ` +
        `is never consulted. Body: ${granted.body}`,
      ).toBeLessThan(400);
      await expect(
        moduleNavRow(mp, GRANT_MODULE.navEn),
        `the grant landed on the server and the sidebar still hides ` +
        `${GRANT_MODULE.navEn}`,
      ).not.toHaveCount(0);
      log.push(
        `granted → /auth/me grants=[${granted.grants!.join(', ')}], ` +
        `${GRANT_MODULE.probe} ${granted.status}, nav row present`,
      );

      // ── 6 · REVOKE, which is also the restore (§6) ────────────────────────
      // A grant left standing is a grant the next run cannot tell from its own
      // baseline — and 02.15 reads this member's cells expecting to find them
      // exactly where this test left them.
      await setModuleGrant(page, wire, email, display, GRANT_MODULE.label, false);
      await mp.reload();
      await expect(mp.locator('aside.side')).toBeVisible({ timeout: 30_000 });
      const revoked = await memberReach(mp);
      expect(revoked.grants, 'the revoke did not reach /auth/me')
        .not.toContain(GRANT_MODULE.code);
      expect(
        revoked.status,
        `${GRANT_MODULE.probe} answered ${revoked.status} AFTER the grant was ` +
        `revoked — a revoked module is still reachable, which is the direction ` +
        `that costs something. Body: ${revoked.body}`,
      ).toBe(403);
      await expect(
        moduleNavRow(mp, GRANT_MODULE.navEn),
        'the revoke did not take the sidebar row away',
      ).toHaveCount(0);
      log.push(
        `revoked → /auth/me grants=[${revoked.grants!.join(', ')}], ` +
        `${GRANT_MODULE.probe} ${revoked.status}, nav row absent`,
      );
    } finally {
      await ctx.close();
      console.log(
        `\n[02.14] ${email} · org_member · ${GRANT_MODULE.code}\n[02.14] `
        + log.join('\n[02.14] ') + '\n',
      );
    }
  });

  test('02.15 members — the access matrix tells the truth about every role tier', async ({
    page,
    browser,
  }) => {
    test.setTimeout(6 * 60_000);
    const wire = watchWire(page);
    await signInAs(page, requireUnicode());
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // ═════════════════════════════════════════════════════════════════════════
    // WHAT "EVERY ROLE TIER" CAN MEAN ON THIS SCREEN, MEASURED FROM SOURCE.
    //
    // `GET /v1/org/members` returns rows whose `role_code` is in `SEAT_ROLES`
    // (`org_invites.py:91` → `role_tiers.SEAT_CONSUMING_ORG_ROLES` = `ORG_ROLES
    // + HR_ADMIN_ROLES`), which is exactly FOUR codes:
    //
    //     org_owner   org_admin   org_member   hr_admin
    //
    // The two project-only codes — `org_client` and `aekam_team`
    // (`role_tiers.py:168`) — are deliberately NOT seat roles, so they never
    // appear in this list and cannot appear in this grid. That is the design
    // ("a client seeing their own project… costs the customer nothing"), not a
    // gap in the matrix, and asserting their absence here would be inventing a
    // requirement.
    //
    // ⚠ AND ONLY TWO OF THE FOUR CAN BE PRODUCED BY THE PRODUCT AT ALL:
    //   · `update_member_role` accepts `{"org_admin", "org_member"}` and nothing
    //     else (`org_members.py:557`), and its UPDATE is additionally scoped
    //     `AND role_code IN ('org_admin','org_member')` (:578).
    //   · `org_invites._assert_may_grant_role` lets only an OWNER invite an
    //     owner, and `admin_orgs.assign_role` narrows to
    //     `INVITABLE_ORG_ROLE = "org_admin"`.
    //   · Nothing anywhere writes an `hr_admin` row through a form.
    // `role_tiers.py:876-884` states the consequence in its own words, measured
    // live: "Unicode Group (fae87907) holds FOUR `org_admin` rows, one
    // `org_member` and ZERO `org_owner` … nothing in this backend writes an
    // `org_owner` row into an existing org."
    //
    // Rule 1 forbids manufacturing the missing two by SQL or by an API write. So
    // this test does the honest thing instead: it checks the grid CELL FOR CELL
    // against the server for every tier the org actually holds, DRIVES the one
    // tier transition the product offers (member ⇄ admin) and proves the grid
    // follows it, and PRINTS a census naming which tiers were exercised and
    // which could not be. A census is evidence; a `test.skip` is a hole.
    // ═════════════════════════════════════════════════════════════════════════

    const email = slotEmail(GRANT_SLOT.tag);
    await seatOwnMember(page, browser);
    await steerOrgRole(page, email, 'org_member');
    const lanesRole = await callerOrgRole(page);

    await openTab(page, 'members');
    await memberView(page, 'Access matrix');

    // `role="region"` with `tabIndex={0}` so the grid can be reached and panned
    // from the keyboard — `AccessMatrix.jsx:70-73`. A horizontally scrolling
    // region that answers only to a trackpad is unreachable for anyone not
    // using one, which is why the region is asserted by ROLE and not by class.
    const grid = page.getByRole('region', { name: 'Module access by member' });
    await expect(grid).toBeVisible({ timeout: 30_000 });
    // `AccessMatrix` returns `null` outright when there are no members, so a
    // rendered row is the signal that the list has actually landed.
    await expect(page.locator('.amx tbody tr').first()).toBeVisible({ timeout: 30_000 });

    // ── The columns ─────────────────────────────────────────────────────────
    // Waited on with a RETRYING count, because `activeModules` starts `null` —
    // "not looked up" — and while it is null `isOn()` answers true for every
    // column, so an eager read sees no `· off` at all and would report the
    // opposite of what it measured.
    await expect(
      page.locator('.amx__off'),
      'exactly one column must be marked off: Unicode holds twelve of the ' +
      'thirteen catalogue modules and varta is EXCLUDED BY DECISION (§13). Zero ' +
      'here means either the subscription read never landed or the grid is ' +
      'painting every column at full strength — and a grid that cannot say ' +
      'which modules the org does not have is the one thing this screen must ' +
      `not be.${dump(wire)}`,
    ).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator('.amx__off')).toContainText('Varta');
    await expect(page.locator('.amx__off'))
      .toHaveAttribute('title', 'Not active on this subscription');

    // ── One read of the whole grid ──────────────────────────────────────────
    // Members × 13 cells is ~90 locator round trips against a deployed
    // environment. One `evaluate` reads the SAME rendered DOM in one go, and the
    // comparison then happens where a failure message can name the member, the
    // module, what was drawn and what the server said.
    type Shot = {
      headers: string[];
      rows: { who: string; cells: { text: string; set: boolean }[] }[];
    };
    const readMatrix = (): Promise<Shot> => page.evaluate(() => {
      const tidy = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
      const tbl = document.querySelector('.amx table');
      if (!tbl) return { headers: [], rows: [] };
      return {
        headers: Array.from(tbl.querySelectorAll('thead th')).map((th) => tidy(th.textContent)),
        rows: Array.from(tbl.querySelectorAll('tbody tr')).map((tr) => ({
          who: tidy(tr.querySelector('th')?.textContent),
          cells: Array.from(tr.querySelectorAll('td')).map((td) => {
            const span = td.querySelector('.amx__cell');
            return {
              // The screen-reader twin is dropped here: `<span aria-hidden>—</span>`
              // plus `<span class="k-sr-only">No access</span>` is ONE cell
              // saying one thing twice, deliberately — an em dash announces as
              // "em dash", which is not the information.
              text: tidy(span?.textContent).replace(/No access/i, '').trim(),
              set: Boolean(span?.classList.contains('set')),
            };
          }),
        })),
      };
    });

    const tidy = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
    /** A header without its markers — `Ganit · sep`, `Varta · off` → the label. */
    const bare = (h: string) => h.replace(/ · (sep|off)/g, '').trim();

    let shot = await readMatrix();
    expect(shot.headers[0], 'the first column names the member').toBe('Member');
    expect(
      shot.headers.slice(1).map(bare),
      'the grid must draw one column per catalogue module, in catalogue order ' +
      '(`catalogue.js` ORG_MODULES). A column that vanished is a module nobody ' +
      'can audit; a new one means the list transcribed above is stale — fix the ' +
      'list, do not narrow the assertion.',
    ).toEqual(CATALOGUE_LABELS);

    // `· sep` is the separated-duty marker, and it lives on the HEADER rather
    // than only in the footnote because the qualification belongs to the cells
    // it governs: a cell reading `Admin` in one of those two columns configures
    // the module and CANNOT release money against it.
    expect(
      shot.headers.filter((h) => / · sep/.test(h)).map(bare).sort(),
      'exactly Vetana and Ganit carry the separated-duty marker — ' +
      '`levels.js` SEPARATED_DUTY_MODULES',
    ).toEqual(['Ganit', 'Vetana']);

    // The legends, which are the only place this grid explains its own
    // vocabulary. Scoped to the footnote paragraph: `of__h` alone is on half the
    // settings hub, and an unscoped text match would resolve somewhere else.
    await expect(page.locator('.of__h--foot'))
      .toContainText('Admin does not include Approver');
    await expect(
      page.getByText(/reaching a module through their\s+organisation role rather than a grant row/i),
      'the grid must explain what "by role" means, or a cell that is not a grant ' +
      'reads as one',
    ).toBeVisible();

    // ── Cell for cell, against the server ───────────────────────────────────
    /**
     * What `AccessMatrix.cellFor` must draw, restated from its source:
     *   · a grant row wins, at its level;
     *   · otherwise org_owner AND org_admin read "by role" — gate 2
     *     short-circuits for BOTH, so an empty admin row is TOTAL access and
     *     drawing it blank "would be the most misleading thing on this screen";
     *   · otherwise an em dash.
     */
    const expectedCell = (m: any, label: string) => {
      const code = CATALOGUE_CODES[CATALOGUE_LABELS.indexOf(label)];
      const g = grantsOf(m).find((x) => x.code === code);
      if (g) return LEVEL_LABEL[g.level] || g.level;
      return m.role_code === 'org_owner' || m.role_code === 'org_admin' ? 'by role' : '—';
    };

    const compare = async (why: string) => {
      // ⚠ WAIT FOR THE GRID BEFORE READING IT. `openTab` remounts `TabMembers`,
      // which renders a `SkeletonTable` until `GET /v1/org/members` lands — so
      // an `evaluate` fired on the next line finds no `.amx table` at all and
      // returns zero rows. That reads as "the matrix drew 0 rows and the server
      // returned 6", i.e. as a product defect, when nothing has rendered yet.
      // The same shape of mistake as 02.2's `page.reload()` racing its PATCH.
      await expect(page.locator('.amx tbody tr').first())
        .toBeVisible({ timeout: 30_000 });
      shot = await readMatrix();
      const roster = await members(page);
      expect(
        shot.rows.length,
        `${why}: the grid drew ${shot.rows.length} rows and the server returned ` +
        `${roster.length} members${dump(wire)}`,
      ).toBe(roster.length);

      const wrong: string[] = [];
      (roster as any[]).forEach((m, i) => {
        // Row order IS the API's order — `TabMembers` keeps `r.data` as it came
        // and `AccessMatrix` maps it straight through — so the index is the
        // join, and the displayed name is ASSERTED rather than used as the key.
        // Two members may share a display name; none share a position.
        const row = shot.rows[i];
        const who = tidy(m.full_name || m.email);
        if (row.who !== who) {
          wrong.push(`row ${i}: the grid says "${row.who}", the server says "${who}"`);
        }
        CATALOGUE_LABELS.forEach((label, c) => {
          const want = expectedCell(m, label);
          const got = row.cells[c]?.text;
          if (got !== want) {
            wrong.push(
              `${who} × ${label}: the grid says "${got}", the server says "${want}" ` +
              `(role_code ${m.role_code})`,
            );
          }
          // `set` carries the colour and the weight; an unset cell is the
          // "nothing here" style. It has to track the same decision the text
          // does, or the grid reads one way and scans another.
          if (Boolean(row.cells[c]?.set) !== (want !== '—')) {
            wrong.push(`${who} × ${label}: text "${got}" but .set=${row.cells[c]?.set}`);
          }
        });
      });
      expect(wrong, `${why}\n  ${wrong.join('\n  ')}`).toEqual([]);
      return roster as any[];
    };

    const roster = await compare('the matrix as found');

    // ── The census, and the guard against a vacuous pass ────────────────────
    const census: Record<string, number> = {};
    for (const m of roster) census[m.role_code] = (census[m.role_code] || 0) + 1;
    expect(
      census.org_member,
      'this test must see at least one org_member row, or the "—" and level half ' +
      'of the vocabulary is never drawn and the comparison above is trivially ' +
      'satisfied by a grid of "by role". 02.8 seats one; 02.14 seats another.',
    ).toBeGreaterThan(0);
    expect(
      census.org_admin,
      'and at least one org_admin row, or "by role" is never drawn at all. ' +
      `02.8 seats ${slotEmail('adm')} as one.`,
    ).toBeGreaterThan(0);

    // ── The one tier transition the product offers, DRIVEN ──────────────────
    // Everything above is observation, and observation can only prove the grid
    // agrees today. This is the part that proves it FOLLOWS the tier.
    const subject = tidy((await memberByEmail(page, email)).full_name || email);
    const beforeRow = shot.rows.find((r) => r.who === subject);
    expect(beforeRow, `${subject} has no row in the grid`).toBeTruthy();
    const dashesBefore = beforeRow!.cells
      .map((c, i) => (c.text === '—' ? CATALOGUE_LABELS[i] : null))
      .filter(Boolean) as string[];
    expect(
      dashesBefore.length,
      'an org_member with no grant on at least one module is what makes the ' +
      'promotion visible. 02.14 leaves this member without Graha, so this is ' +
      'never zero unless an earlier run left them holding the whole catalogue.',
    ).toBeGreaterThan(0);

    await steerOrgRole(page, email, 'org_admin');
    await openTab(page, 'members');
    await memberView(page, 'Access matrix');
    await compare('after promoting the member to org_admin');

    shot = await readMatrix();
    const adminRow = shot.rows.find((r) => r.who === subject)!;
    expect(
      adminRow.cells
        .map((c, i) => (c.text === '—' ? CATALOGUE_LABELS[i] : null))
        .filter(Boolean),
      'an org_admin reaches every ACTIVE module with NO grant row — ' +
      'subscription.py:636 puts org_admin in the same short-circuit as ' +
      'org_owner — so no cell on an admin row may read "no access". Drawing one ' +
      'blank is the exact lie AccessMatrix.jsx:18-27 exists to prevent.',
    ).toEqual([]);
    for (const label of dashesBefore) {
      expect(
        adminRow.cells[CATALOGUE_LABELS.indexOf(label)].text,
        `${subject} × ${label} read "—" as a member and must read "by role" as ` +
        'an admin',
      ).toBe('by role');
    }

    // The list view's badge agrees. `ROLE_META` (MemberTable.jsx:55) renders
    // plain "Admin", NOT "Org admin" — the add form's `ROLE_OPTIONS` says the
    // latter, and they are two vocabularies for one fact. 02.10 records the
    // near-miss that came of asserting one against the other.
    await memberView(page, 'List');
    await expect(page.locator('.omt tbody tr').filter({ hasText: email }).locator('.rb'))
      .toContainText('Admin');

    // ── And the escalation guard, on the row that is now an admin ────────────
    // `canEditGrants = !owner && (isOwner || !admin)` — MemberTable.jsx:117.
    // What an OWNER decides alone is which modules an org_admin may reach, so an
    // org_admin must not be offered the control on another admin's row. The
    // caller's role is READ rather than assumed, because the rule is a function
    // of who is looking and `_lanes.ts` is a claim about that, not a measurement.
    {
      const row = page.locator('.omt tbody tr').filter({ hasText: email });
      await row.getByRole('button', { name: /Actions for/ }).click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible({ timeout: 10_000 });
      const item = menu.getByRole('menuitem', { name: /Edit module grants/ });
      if (lanesRole === 'org_owner') {
        await expect(
          item,
          'an org_owner MAY set an admin’s grants — that is the whole of the ' +
          '`isOwner ||` in canEditGrants',
        ).toHaveCount(1);
      } else {
        await expect(
          item,
          `this session is ${lanesRole}. An org_admin editing another ` +
          'org_admin’s grants is privilege escalation by way of a settings ' +
          'screen, and MemberTable.jsx:114-117 says exactly that.',
        ).toHaveCount(0);
      }
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0, { timeout: 10_000 });
    }

    // ── Put it back (§6), and prove the grid followed that way too ───────────
    await steerOrgRole(page, email, 'org_member');
    await openTab(page, 'members');
    await memberView(page, 'Access matrix');
    await compare('after demoting the member back to org_member');

    shot = await readMatrix();
    const restoredRow = shot.rows.find((r) => r.who === subject)!;
    for (const label of dashesBefore) {
      expect(
        restoredRow.cells[CATALOGUE_LABELS.indexOf(label)].text,
        `${subject} × ${label} did not return to "—" after the demotion — this ` +
        'run has left the roster changed, which is what §6 forbids',
      ).toBe('—');
    }

    // Names, never ids — the standing rule, on a grid whose row headers are the
    // only place a member is named outside the table 02.7 already sweeps.
    expect(
      ((await grid.innerText()) || '')
        .match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i),
      'the access matrix rendered a UUID',
    ).toBeNull();

    console.log(
      `\n[02.15] tier census on ${LANE.org}: `
      + Object.entries(census).map(([r, n]) => `${r}×${n}`).join(', ')
      + `\n[02.15] this session is ${lanesRole}`
      + '\n[02.15] EXERCISED — org_admin and org_member: both observed cell-for-cell against'
      + `\n[02.15]   the server, and both DRIVEN (${subject}: member → admin → member).`
      + '\n[02.15] NOT EXERCISED — org_owner and hr_admin: both are SEAT_ROLES this grid can'
      + '\n[02.15]   render, and NEITHER can be created through any product control.'
      + '\n[02.15]   update_member_role accepts only org_admin/org_member (org_members.py:557,'
      + '\n[02.15]   :578); nothing writes an org_owner or hr_admin row into an existing org.'
      + '\n[02.15]   Manufacturing one would be an API write — rule 1. Reported, not skipped.'
      + '\n[02.15] OUT OF SCOPE BY DESIGN — org_client and aekam_team are project-only roles,'
      + '\n[02.15]   absent from SEAT_CONSUMING_ORG_ROLES, so they never reach GET /org/members'
      + '\n[02.15]   and cannot appear in this grid at all.\n',
    );
  });
});
