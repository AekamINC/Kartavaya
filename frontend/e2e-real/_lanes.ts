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
    `${process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app'}/api/v1/org/profile`,
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
