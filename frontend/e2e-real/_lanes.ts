/**
 * THE LANES — which account drives which org, and the guard that proves it.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * On 2026-08-28 Suite 02 renamed **Aekam Inc** — the one org proposal 93
 * guarantees is untouched — to "Unicode Group", and wrote a UPI row into it.
 * Nothing in the suite was wrong about *what* it typed. It was wrong about
 * *where*.
 *
 * The cause, from `audit_log`: the credential in use held `platform_admin`, and
 * every request logged `org_id=045b76ad` (Aekam Inc) via `platform_bypass`. A
 * platform token does not scope to an org — it resolves to whatever the session
 * says, and the product shows no on-screen indication of which org is being
 * edited. So "save the company profile" saved somebody else's company profile,
 * and the suite went GREEN because the save genuinely succeeded.
 *
 * A row count could not catch that. Only asserting the target could.
 *
 * ── The two rules this file enforces ────────────────────────────────────────
 *
 * 1. WRITE SUITES NEVER USE A PLATFORM CREDENTIAL. Each lane is driven by an
 *    ORG-SCOPED account, so `platform_bypass` never engages and the server
 *    itself refuses a cross-org write. Owner's decision, 2026-08-28: "god mode
 *    only for aekam admin testing" — i.e. Suite 19, whose subject IS the
 *    platform console.
 *
 * 2. EVERY WRITE SUITE ASSERTS ITS ORG BEFORE IT WRITES. `assertOrg()` reads
 *    the org the session actually resolves to and fails loudly if it is not the
 *    lane's target. Belt and braces: rule 1 makes the wrong write impossible,
 *    rule 2 makes it *visible* if rule 1 is ever weakened.
 */
import { expect, Page, APIRequestContext } from '@playwright/test';

export const ORG = {
  UNICODE: 'fae87907-2f99-4b35-a241-c94d9e1e4a17',
  E2E: '64e7bea6-6abe-490c-a2a4-27a60c6be916',
  UK: '4d7e9380-ff98-4c1d-bffd-a76df7e91f21',
  AEKAM: '045b76ad-654b-42dd-b4b1-731700efc6c3',
} as const;

export type Lane = {
  key: 'unicode' | 'e2e' | 'uk';
  org: string;
  orgId: string;
  /** Org-scoped token. NEVER a platform_admin one — see rule 1. */
  token?: string;
  email?: string;
  password?: string;
  reference: boolean;
};

/**
 * Owner's assignment, 2026-08-28:
 *   Unicode        kevalvshah03+1@gmail.com        (org_admin)
 *   UK AekamINC    keval.shah@unicodegroup.com     (org_owner)
 *   E2E            keval.shah@unicodegroup.com     (org_admin)
 * God mode is reserved for Aekam admin testing and appears in NO lane here.
 */
export function lane(key: Lane['key']): Lane {
  switch (key) {
    case 'unicode':
      return {
        key,
        org: 'Unicode Group',
        orgId: ORG.UNICODE,
        token: process.env.E2E_UNICODE_TOKEN,
        email: process.env.E2E_UNICODE_EMAIL || 'kevalvshah03+1@gmail.com',
        password: process.env.E2E_UNICODE_PASSWORD,
        reference: true,
      };
    case 'uk':
      return {
        key,
        org: 'UK AekamINC',
        orgId: ORG.UK,
        token: process.env.E2E_UK_OWNER_TOKEN,
        email: 'keval.shah@unicodegroup.com',
        reference: false,
      };
    case 'e2e':
      return {
        key,
        org: 'E2E Test & Associates [TEST ORG]',
        orgId: ORG.E2E,
        token: process.env.E2E_UK_OWNER_TOKEN, // same account, org_admin on E2E
        email: 'keval.shah@unicodegroup.com',
        reference: false,
      };
  }
}

/**
 * ⚠ THE STAGE 4 LANE SWITCH — added 2026-08-29, and its absence WAS the first
 * Stage 4 finding.
 *
 * §14 says the suites proven on Unicode are "then run against UK AekamINC
 * **without modification**". Measured on 2026-08-29, that was not possible:
 * nineteen suites opened with a literal `const LANE = lane('unicode')` at
 * module scope, and suites 01/02/02b carried a private `resolveLane()` whose
 * three branches were Unicode-by-password, Unicode-by-token and E2E-by-password
 * — no UK branch anywhere. `coldstart-nav-audit` (Suite 00) did not use a lane
 * at all; it logged in with `E2E_APPROVER_*`, which resolves to **E2E Test &
 * Associates**, not to the brand-new org Suite 00 exists to audit.
 *
 * That is §14's OWN first category — "the suite carried a hidden dependency on
 * Unicode's state" — in its strongest form: a dependency on Unicode's
 * IDENTITY, frozen at import time. So the replay could not have been run at
 * all, and a Stage 4 report saying "all suites pass on UK" would have been
 * describing runs that never left Unicode.
 *
 * THE FIX IS DELIBERATELY DEFAULT-PRESERVING. `E2E_LANE` unset resolves to
 * `unicode`, byte-for-byte the behaviour every banked Unicode result was
 * produced under — so this cannot retroactively invalidate Stage 3. Only
 * `E2E_LANE=uk` (or `=e2e`) moves anything, and it moves the LANE, never an
 * assertion. §14: "A suite quietly patched to pass on both orgs destroys the
 * only evidence this stage exists to produce."
 *
 *   E2E_LANE=uk npx playwright test --config e2e-real/wave1.config.ts
 *
 * `assertOrg()` still runs inside `signInAs()` and still proves the target from
 * the id the SERVER resolved, so a mis-set `E2E_LANE` fails loudly rather than
 * writing into the wrong org.
 */
export function activeLane(): Lane {
  const raw = (process.env.E2E_LANE || 'unicode').trim().toLowerCase();
  if (raw !== 'unicode' && raw !== 'uk' && raw !== 'e2e') {
    throw new Error(
      `E2E_LANE="${process.env.E2E_LANE}" is not a lane. Use unicode | uk | e2e.`,
    );
  }
  return lane(raw as Lane['key']);
}

/**
 * ⚠⚠ THE IDENTITY A SUITE IS ALLOWED TO TYPE INTO ITS LANE — added 2026-08-29.
 *
 * `assertOrg()` guards WHERE a suite writes. It cannot guard WHAT it writes,
 * and on 2026-08-29 that gap was measured as a live hazard in Stage 4.
 *
 * `suite02-org-settings` 02.1 filled `#org-name` with the LITERAL string
 * `'Unicode Group'`, `#org-city` with `'Ahmedabad'` and `#org-state` with
 * `'Gujarat'`, then saved. Pointed at the UK lane it would have passed
 * `assertOrg` — the session really is on UK AekamINC — and then RENAMED UK
 * AekamINC to "Unicode Group" and moved it to Gujarat. That is the content half
 * of the 2026-08-28 incident this file was written to prevent: the org guard
 * caught the wrong-org write and nothing at all caught the wrong-org DATA.
 *
 * ⚠ AND THE SECOND-ORDER EFFECT WAS THE WORSE ONE. `suite10-vikray` derives the
 * supplier's state from `billing_address.state`. The product does NOT —
 * `services/gstr1_json.supplier_state_code()` reads GSTIN, then `state_code`,
 * and only falls back to the billing address "for an org recorded before the
 * column existed". So a Gujarat billing address written onto UK would leave the
 * PRODUCT deriving Maharashtra (27) and the SUITE deriving Gujarat (24), and
 * every GST split in Stage 4 would have been computed against the wrong
 * supplier state while the run stayed green. §9's whole point — "identical
 * figures across the two orgs would mean the ladders are not being read at
 * all" — would have been inverted into a false pass.
 *
 * So identity payloads come from the LANE, never from a literal. A suite that
 * types a company name, address, state or statutory code reads it from here.
 *
 * ⚠ THE STATE PAIR IS LOAD-BEARING (§9) — Unicode Gujarat 24, UK Maharashtra
 * 27, deliberately, so identical suites must produce a DIFFERENT GST split and
 * a DIFFERENT professional tax. Nothing here may collapse the two onto one
 * state.
 */
export type LaneIdentity = {
  name: string;
  line1: string;
  city: string;
  state: string;
  stateCode: string;
  pin: string;
  country: string;
  /** ⚠ Both are CHECKSUM-INVALID on purpose — see the note below. */
  gstin: string;
  pan: string;
  tan: string;
  /** Two interchangeable invoice-series prefixes for THIS lane. 02.6 toggles
   *  between them because §6 requires a second run to CHANGE something; both
   *  must therefore belong to this org, not to the reference lane. */
  docPrefixA: string;
  docPrefixB: string;
};

/**
 * ⚠ Why the GSTINs here are deliberately checksum-INVALID.
 *
 * `24AAACU5678U1Z9` is what Suite 02 has always typed, and measured against the
 * product's own `services.gstin.is_valid()` on 2026-08-29 it is **not a valid
 * GSTIN** — the 15th character does not check out. That is not a defect in the
 * fixture: CLAUDE.md's standing rule is that **GSTIN/PAN/TAN block nothing**,
 * and a value the validator rejects is exactly what proves the form still
 * saves. The UK twin is built the same way, from the same body with a `27`
 * prefix, so the two lanes exercise identical shapes.
 *
 * It also means neither value can hijack `supplier_state_code()`, whose first
 * branch fires only for a VALID GSTIN — so the state each lane files under
 * still comes from `state_code`, which is where §9 put it. (A valid Maharashtra
 * twin, if one is ever wanted, is `27AAACU5678U1Z7`.)
 */
export function laneIdentity(l: Lane): LaneIdentity {
  switch (l.key) {
    case 'unicode':
      return {
        name: 'Unicode Group',
        line1: '4th Floor, Unicode House',
        city: 'Ahmedabad',
        state: 'Gujarat',
        stateCode: '24',
        pin: '380015',
        country: 'India',
        gstin: '24AAACU5678U1Z9',
        pan: 'AAACU5678U',
        tan: 'AHMA12345B',
        docPrefixA: 'UNI',
        docPrefixB: 'UNX',
      };
    case 'uk':
      return {
        name: 'UK AekamINC',
        line1: '2nd Floor, Aekam House',
        city: 'Mumbai',
        state: 'Maharashtra',
        stateCode: '27',
        pin: '400001',
        country: 'India',
        gstin: '27AAACU5678U1Z9',
        pan: 'AAACU5678U',
        tan: 'MUMA12345B',
        docPrefixA: 'UKA',
        docPrefixB: 'UKB',
      };
    case 'e2e':
      return {
        name: 'E2E Test & Associates [TEST ORG]',
        line1: '1st Floor, E2E Chambers',
        city: 'Pune',
        state: 'Maharashtra',
        stateCode: '27',
        pin: '411001',
        country: 'India',
        gstin: '27AAACE1234E1Z5',
        pan: 'AAACE1234E',
        tan: 'PNEA12345B',
        docPrefixA: 'E2A',
        docPrefixB: 'E2B',
      };
  }
}

/** Sign in: the real form when a password exists, the org-scoped token otherwise. */
export async function signInAs(page: Page, l: Lane) {
  if (l.password && l.email) {
    await page.goto('/login');
    await expect(page.locator('#au-email')).toBeVisible({ timeout: 30_000 });
    await page.locator('#au-email').fill(l.email);
    await page.locator('#au-password').fill(l.password);
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
    return;
  }
  if (!l.token) {
    throw new Error(
      `BLOCKED — no credential for the ${l.org} lane. Set E2E_${l.key.toUpperCase()}_TOKEN ` +
      `(or E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e. ⚠ It must be an ORG-SCOPED account: ` +
      `a platform_admin token resolves to Aekam Inc via platform_bypass and will write there.`,
    );
  }
  await page.goto('/login');
  await page.evaluate((t) => localStorage.setItem('auth_token', t), l.token);
  await page.goto('/dashboard');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });

  // ⚠ THE GUARD RUNS HERE, NOT IN EACH SPEC, AND THAT WAS THE WHOLE POINT.
  //
  // `ae7f0510` was titled "the org guard had never run" and named two faults:
  // `assertOrg` compared against an `id` the endpoint did not return, and NO
  // SPEC IMPORTED IT. The first was fixed. The second was recorded as fixed —
  // "now called inside `signInAs()`, the only way into the suite, so a test
  // cannot reach a form without passing it" — and **it was not**. Measured
  // 2026-08-29: `signInAs` returned here, and the guard was a line each spec
  // had to remember.
  //
  // Eight files do remember it today, which is why nothing went wrong. But a
  // rule every author must re-apply is the rule that renamed Aekam Inc, and a
  // NEW suite is exactly the case that forgets. So it is a property of getting
  // in, rather than a habit.
  //
  // `page.request` shares this context's cookies and storage, so it asks as
  // the session that was just established rather than as an anonymous client.
  await assertOrg(page.request, page, l);
}

/**
 * ⚠ CALL THIS BEFORE ANY SUITE WRITES ANYTHING.
 *
 * Asks the server which org this session actually resolves to and refuses to
 * continue unless it is the lane's target. This is the check whose absence
 * renamed Aekam Inc — and it is deliberately an assertion about the ORG ID, not
 * about a name on screen, because the name is exactly what got corrupted.
 */
export async function assertOrg(request: APIRequestContext, page: Page, l: Lane) {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  const res = await request.get(
    `${process.env.E2E_API_URL || 'https://api.kartavaya.com'}/api/v1/org/profile`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  expect(res.ok(), `org profile probe failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  const actual = body?.id || body?.org_id || body?.data?.id;

  expect(
    actual,
    `\n  ⚠ WRONG ORG — refusing to write.\n` +
    `     lane expects : ${l.org} (${l.orgId})\n` +
    `     session is on: ${actual}\n` +
    `     This is the check whose absence renamed Aekam Inc on 2026-08-28.\n` +
    `     A platform_admin credential resolves to Aekam via platform_bypass —\n` +
    `     use an ORG-SCOPED account for any suite that writes.\n`,
  ).toBe(l.orgId);
}
