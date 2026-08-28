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
import { test, expect, Page } from '@playwright/test';
import { ORG as ORG_IDS, assertOrg, type Lane as OrgLane } from './_lanes';

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
      ['#org-gstin', '24AAACU5678U1Z9'],
      ['#org-pan', 'AAACU5678U'],
      ['#org-tan', 'AHMA12345B'],
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
    const toggles = page.locator('.omod__c input[type="checkbox"]');
    const t = await toggles.count();
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
    await page.locator(`#snd-${purpose}-name`).fill('Unicode Group');

    const res = await saveAndWait(page, /Save sender addresses/, /senders/);
    expect(res.status(), `saving a sender answered ${res.status()}.${dump(wire)}`)
      .toBeLessThan(400);
    await page.reload();
    await expect(first).toHaveValue('test@unicodegroup.com', { timeout: 30_000 });

    // Stored is not the same as in use, and the product must say so rather than
    // implying mail already goes out from this address.
    await expect(page.getByText(/Saved — not in use yet|In use/)).toBeVisible();
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
    await page.locator('#upi-paytm-name').fill('Unicode Group');
    await page.locator('#upi-phonepe').fill('unicodegroup@ybl');
    await page.locator('#upi-phonepe-name').fill('Unicode Group');
    await page.locator('#upi-gpay').fill('unicodegroup@okhdfcbank');
    await page.locator('#upi-gpay-name').fill('Unicode Group');

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
    const current = await box.inputValue();
    const prefix = current === 'UNI' ? 'UNX' : 'UNI';

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

  const API_BASE = process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app';

  /** The member rows the SERVER holds, read fresh. The screen is the claim; this is the fact. */
  async function members(page: Page) {
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    const res = await page.request.get(`${API_BASE}/api/v1/org/members`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    expect(res.ok(), `GET /org/members -> ${res.status()}: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    return (Array.isArray(body) ? body : body.data ?? []) as any[];
  }

  /** The invitations still pending, same treatment. */
  async function pendingInvites(page: Page) {
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));
    const res = await page.request.get(`${API_BASE}/api/v1/org/invites`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
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

    await openTab(page, 'members');
    const row = page.locator('.omt tbody tr').filter({ hasText: email });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Suite rule 6: scope to the OPEN MENU. An unscoped name match resolves in
    // DOM order and will happily hit the sidebar instead of the row's action.
    const setRole = async (to: 'org_admin' | 'org_member') => {
      await row.getByRole('button', { name: /Actions for/ }).click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible({ timeout: 10_000 });
      const [res] = await Promise.all([
        page.waitForResponse(
          (r) => /\/org\/members\/.*\/role/.test(r.url()) && r.request().method() === 'PUT',
          { timeout: 30_000 },
        ),
        menu
          .getByRole('menuitem', { name: to === 'org_admin' ? /Make org admin/ : /Make org member/ })
          .click(),
      ]);
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
    await row.getByRole('button', { name: /Actions for/ }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await menu.getByRole('menuitem', { name: /Remove from organisation/ }).click();

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
});
