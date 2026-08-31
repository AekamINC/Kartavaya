/**
 * Proposal 93 · Stage 3 · WAVE 1 · SUITE 01 — auth & account, on Unicode Group.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE RULE THIS SUITE IS BUILT ON
 * ═══════════════════════════════════════════════════════════════════════════
 * Every row is typed by a user. Nothing here is inserted by SQL and nothing is
 * POSTed straight at the API: the browser opens the page, fills the form, picks
 * from the real picker and clicks the real button. A row created by SQL proves
 * the table exists; only a row created by a click proves the product works.
 * SQL is used AFTERWARDS, read-only, to verify — and that verification lives in
 * the run report rather than in this file, because a spec that can reach the
 * database can also be tempted to seed with it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CREDENTIALS — WHY THIS SUITE CAN REFUSE TO RUN
 * ═══════════════════════════════════════════════════════════════════════════
 * The target org is Unicode Group `fae87907-2f99-4b35-a241-c94d9e1e4a17`.
 * Measured 2026-08-28 against `staging.user_roles`, its six seats belong to
 * five accounts:
 *
 *   org_owner  KEVAL SHAH        kevalvshah03@gmail.com
 *   org_admin  KEVAL SHAH, Kasti Pranami (aekaminc1@), Rohan Kasti
 *              (aekaminc1+org@), Devang Bhatt (kevalvshah03+1@),
 *              Rajesh Bhatt (kevalvshah03+rajesh-bhatt@)
 *
 * `.env.e2e` carries a PASSWORD for exactly two kinds of account, and neither
 * is one of those five:
 *
 *   E2E_APPROVER_*   — a seat in E2E Test & Associates ONLY (64e7bea6)
 *   E2E_DUMMY_01..12 — E2E Test & Associates ONLY, and `.env.e2e` says in as
 *                      many words: "NONE of these may ever be pointed at
 *                      Unicode Group — that org is NOT suppressed and its
 *                      addresses are real people's."
 *
 * The two Unicode-capable credentials are TOKENS and both are dead. Not
 * assumed — measured twice:
 *
 *   E2E_ADMIN_TOKEN    sub user_21457956f010  exp 2026-08-27T21:38:06Z
 *   E2E_GODMODE_TOKEN  sub user_f798947b8a2e  exp 2026-08-27T14:51:20Z
 *
 *   $ curl -H "Authorization: Bearer $E2E_ADMIN_TOKEN" \
 *          -H "X-Org-Id: fae87907-…" \
 *          https://api.kartavaya.com/api/v1/org/members
 *   401 {"detail":"Invalid or expired token"}
 *
 * So the tests that need to BE a Unicode member fail with one precise sentence
 * rather than skipping. A skip is how a blocked suite gets read as a passing
 * one; §1 of the proposal is explicit that a suite must never be quietly green.
 *
 * To unblock, put a Unicode Group login in `.env.e2e`:
 *
 *   E2E_UNICODE_EMAIL=…
 *   E2E_UNICODE_PASSWORD=…
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT RUNS WITHOUT THAT CREDENTIAL, AND WHY IT IS STILL ABOUT UNICODE
 * ═══════════════════════════════════════════════════════════════════════════
 * 01.2 (forgot password) and 01.3 (login rate limit) are UNAUTHENTICATED
 * flows. They are driven against a real Unicode address, because that is whose
 * day-one experience is under test, and neither writes a business row:
 *
 *   · forgot-password mints a reset token on the user row and mails it. That
 *     mail goes to `kevalvshah03+1@gmail.com`, the owner's own inbox. It is ONE
 *     message. Unicode is NOT in OUTBOUND_SUPPRESSED_ORGS and OUTBOUND_MODE is
 *     `live` (read off `/api/health`, 2026-08-28), so this really sends —
 *     deliberately, because "forgot-password requested" is what §3 asks for and
 *     a suppressed send would prove nothing.
 *   · the reset is NOT completed. Completing it would change the password of an
 *     account the programme still needs, which is the one thing §3 forbids here.
 *   · six bad passwords create nothing at all. `POST /auth/login` reads; a miss
 *     returns 401 after a constant-time decoy hash and writes no row.
 *
 * ⚠ 01.3 exhausts the login limiter for a minute on this egress IP. It runs
 * last in file order for that reason, and the suite is `workers: 1`.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave1.config.ts --grep "Suite 01"
 */
import { test, expect, Page } from '@playwright/test';

const UNICODE_ORG_ID = 'fae87907-2f99-4b35-a241-c94d9e1e4a17';
const E2E_ORG_ID     = '64e7bea6-6abe-490c-a2a4-27a60c6be916';
const UK_ORG_ID      = '4d7e9380-ff98-4c1d-bffd-a76df7e91f21';

/** A real Unicode Group seat — used as the SUBJECT of the unauthenticated
 *  flows. Not a login: there is no password for it (see the header). */
const UNICODE_KNOWN_ADDRESS = 'kevalvshah03+1@gmail.com';

/**
 * The colleague Suite 01 invites.
 *
 * `test+<tag>@unicodegroup.com` BOUNCES — IONOS rejects plus tags, proven by
 * probe on 2026-08-28 (the tagged probe bounced, the untagged control arrived).
 * And `public.users_email_key` is UNIQUE TABLE-WIDE, so the one untagged
 * address `test@unicodegroup.com` can back exactly ONE account and must be
 * spent on the persona that needs it, not on an invite this suite raises and
 * revokes. Gmail plus-addressing IS proven to work, so an invited colleague
 * gets a gmail tag.
 *
 * Tagged with the run so a re-run does not collide with its own leftovers on
 * `public.invites`.
 */
const INVITEE = `kevalvshah03+w1-invite-${Date.now().toString(36)}@gmail.com`;

// ── Credentials ───────────────────────────────────────────────────────────────

type Creds = { email: string; password: string };

function unicodeCreds(): Creds | null {
  const email = process.env.E2E_UNICODE_EMAIL;
  const password = process.env.E2E_UNICODE_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

const BLOCKED =
  'BLOCKED — no Unicode Group credential. E2E_UNICODE_EMAIL / E2E_UNICODE_PASSWORD ' +
  'are not in .env.e2e, the approver and the twelve dummies hold seats in E2E Test ' +
  '& Associates only, and both stored Unicode tokens expired 2026-08-27 (verified: ' +
  'GET /api/v1/org/members returned 401 "Invalid or expired token"). This is an ' +
  'ENVIRONMENT blocker, not a product defect and not a test defect.';

/**
 * THE LANE — and it is announced, never assumed.
 *
 * §14 makes Unicode Group the reference lane: every suite is authored there,
 * against screens that begin genuinely blank. There is currently no Unicode
 * credential on this machine (see BLOCKED above), and waiting for one stops the
 * programme dead.
 *
 * So the suite falls back to E2E Test & Associates — also wiped, also empty, and
 * the org the twelve dummy logins actually hold seats in.
 *
 * ⚠ THE FALLBACK IS LOUD ON PURPOSE. An E2E run is NOT a Unicode run, and a
 * result filed under the wrong lane is worse than no result: §14's whole point
 * is that the Unicode pass and the UK replay are compared, and a silent third
 * org in the middle would corrupt that comparison. Every run prints its lane.
 *
 * ⚠ AND E2E IS OUTBOUND-SUPPRESSED. `OUTBOUND_SUPPRESSED_ORGS` holds E2E's org
 * id and the deployed process really enforces it, so `send_email` returns True
 * while nothing leaves the building — the 1,562-row trap in §0 exactly. Any
 * assertion about mail ARRIVING must skip on this lane rather than pass.
 */
type Lane = { creds: Creds; org: string; orgId: string; reference: boolean; outboundSuppressed: boolean;
              /** Set only when the lane cannot be driven at all — see UK_BLOCKED. */
              blocked?: string };

/** ⚠ STAGE 4 (§14) — Suite 01 CANNOT be replayed on the UK lane, and the reason
 *  is an ENVIRONMENT one that should be stated rather than worked around.
 *
 *  Every branch of `resolveLane()` resolves to Unicode or to E2E. Asked for UK
 *  it would fall through to `E2E_APPROVER_*` and run the whole suite against
 *  **E2E Test & Associates** while the run was filed as a UK replay — the
 *  "silent third org in the middle" this file's own header says would corrupt
 *  the §14 comparison.
 *
 *  A UK branch cannot fix it either, and that is the finding rather than an
 *  omission: Suite 01's SUBJECT is the login form — six bad passwords to trip
 *  the 5/min limiter, TOTP enrolment, login by recovery code — and the UK lane
 *  holds a TOKEN, not a password (`_lanes.ts`: `E2E_UK_OWNER_TOKEN`, and there
 *  is no `E2E_UK_PASSWORD` in `.env.e2e`). A token login skips the very control
 *  the suite exists to exercise, so a "UK pass" would prove nothing.
 *
 *  Unblocked by an owner action: add a password for keval.shah@unicodegroup.com. */
const UK_LANE = (process.env.E2E_LANE || '').trim().toLowerCase() === 'uk';
const UK_BLOCKED =
  'BLOCKED — Suite 01 drives the LOGIN FORM and the UK lane has only a token, no ' +
  'password. Running it would fall through to E2E Test & Associates and file an ' +
  'E2E run as a UK replay. ENVIRONMENT blocker — not a product defect and not a ' +
  'test defect. Unblocked by adding E2E_UK_PASSWORD (owner action).';

function resolveLane(): Lane {
  // ⚠ STAGE 4 (§14) — REFUSE, do not silently substitute.
  //
  // Every branch below resolves to Unicode or to E2E. Asked for the UK lane
  // this function would have fallen through to `E2E_APPROVER_*` and run the
  // whole suite against **E2E Test & Associates** while the run was filed as a
  // UK replay — the "silent third org in the middle" this file's own header
  // says would corrupt the §14 comparison.
  //
  // It cannot be fixed by adding a UK branch either, and that is a finding
  // rather than an omission: Suite 01's subject IS the login form — six bad
  // passwords to trip the 5/min limiter, TOTP enrolment, login by recovery
  // code — and the UK lane holds a TOKEN, not a password (`_lanes.ts`:
  // `E2E_UK_OWNER_TOKEN`, no `E2E_UK_PASSWORD`). A token login would skip the
  // very control this suite exists to exercise.
  //
  // So: BLOCKED on the UK lane, for an ENVIRONMENT reason, stated out loud.
  // ⚠ It must NOT throw here. `resolveLane()` runs at MODULE scope, and a throw
  // at module scope fails the whole RUN — every sibling spec Playwright loaded
  // alongside this one — even under a `--grep` that excludes this file. Measured
  // 2026-08-29: it took wave 1's entire UK replay down with it. So the refusal
  // is carried on the lane and enforced by `test.skip` below.
  if (UK_LANE) return { creds: { email: '', password: '' }, org: 'UK AekamINC',
    orgId: UK_ORG_ID, reference: false, outboundSuppressed: false, blocked: UK_BLOCKED };

  const uni = unicodeCreds();
  if (uni) {
    return { creds: uni, org: 'Unicode Group', orgId: UNICODE_ORG_ID, reference: true, outboundSuppressed: false };
  }
  const email = process.env.E2E_APPROVER_EMAIL;
  const password = process.env.E2E_APPROVER_PASSWORD;
  if (!email || !password) throw new Error(BLOCKED);
  return {
    creds: { email, password },
    org: 'E2E Test & Associates',
    orgId: E2E_ORG_ID,
    reference: false,
    outboundSuppressed: true,
  };
}

const LANE = resolveLane();

test.skip(() => Boolean(LANE.blocked), UK_BLOCKED);

test.beforeAll(() => {
  console.log(`\n  LANE: ${LANE.org}${LANE.reference ? '  (reference lane, §14)' : '  ⚠ FALLBACK — NOT the reference lane'}`);
  if (!LANE.reference) {
    console.log('  ⚠ Unicode has no credential on this machine, so these results are');
    console.log('    E2E results and must not be filed as the Unicode reference pass.');
  }
  if (LANE.outboundSuppressed) {
    console.log('  ⚠ This org is in OUTBOUND_SUPPRESSED_ORGS — send_email returns True while');
    console.log('    nothing leaves. Mail-ARRIVAL assertions skip here rather than pass.\n');
  }
});

/** The credential for whichever lane resolved. */
function requireUnicode(): Creds {
  return LANE.creds;
}

// ── The real login form ───────────────────────────────────────────────────────

async function fillLogin(page: Page, email: string, password: string) {
  await expect(page.locator('#au-email')).toBeVisible({ timeout: 30_000 });
  await page.locator('#au-email').fill(email);
  await page.locator('#au-password').fill(password);
  await page.locator('form button[type="submit"]').first().click();
}

async function signIn(page: Page, { email, password }: Creds) {
  await page.goto('/login');
  await fillLogin(page, email, password);
  // The app lands on whichever destination the account's role resolves to, so
  // the assertion is "no longer on /login", not a named route.
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
}

async function signOut(page: Page) {
  // The real control, in the sidebar, by its accessible name — not a call to
  // `localStorage.clear()`, which would prove nothing about the product.
  const btn = page.getByRole('button', { name: 'Sign out' });
  await expect(btn).toBeVisible({ timeout: 20_000 });
  await btn.click();
  await page.waitForURL(/\/login/, { timeout: 30_000 });
}

// ═════════════════════════════════════════════════════════════════════════════

test.describe('Suite 01 — auth & account · Unicode Group', () => {
  test('01.1 sign in through the real form, sign out, sign back in', async ({ page }) => {
    const creds = requireUnicode();

    await signIn(page, creds);
    // Signed in means the app shell is there, not merely that the URL moved.
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 30_000 });

    await signOut(page);
    // And signed out means the session is actually gone: a protected route must
    // bounce back to the form rather than render from a warm cache.
    await page.goto('/settings/organisation');
    await page.waitForURL(/\/login/, { timeout: 30_000 });

    await signIn(page, creds);
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 30_000 });
  });

  test('01.4 invite a colleague from Members, and the invite row appears', async ({ page }) => {
    const creds = requireUnicode();
    await signIn(page, creds);

    await page.goto('/settings/organisation?tab=members');
    await expect(page.getByRole('heading', { name: /^Members ·/ })).toBeVisible({ timeout: 30_000 });

    // Typed into the real form, on the real screen.
    await page.locator('#add-email').fill(INVITEE);
    await page.locator('#add-role').selectOption('org_member');

    // The picker, not a payload. §3's "picks from the real picker" — the module
    // access sheet is opened and its summary is read back, so the invite that
    // goes out carries what the screen says it carries.
    // ⚠ THIS ASSERTED `No modules`, WHICH WAS A FACT ABOUT THE ORG, NOT THE
    // PRODUCT. `defaultGrantsFor(activeModules)` pre-fills every non-sensitive
    // module the org actually holds (TabMembers.jsx:242). Unicode held zero
    // when this was written; once twelve were provisioned the summary correctly
    // named eight and the test failed against the right behaviour.
    //
    // What is worth checking is the property that survives any org's
    // configuration: A NEW COLLEAGUE IS NEVER HANDED THE SENSITIVE MODULES BY
    // DEFAULT. Finance, Procurement, Payroll and HRMS are `sensitive: true` in
    // `org/catalogue.js`, and `defaultGrantsFor` filters exactly those out —
    // so an invitation that arrives carrying payroll is the defect, and it is
    // the one that cannot be undone by noticing later.
    const summary = page.getByTestId('add-grants-summary');
    await expect(summary).toBeVisible({ timeout: 30_000 });
    const said = (await summary.innerText()).trim();
    for (const s of ['Ganit', 'Kray', 'Vetana', 'Manav']) {
      expect(said, `the invitation form offers ${s} to a brand-new colleague by default. ` +
        'It is `sensitive: true` in org/catalogue.js precisely so it is chosen deliberately ' +
        `and never inherited: the summary reads "${said}"`).not.toContain(s);
    }
    // And it must SAY what it is handing over, in words. "No modules …" is the
    // legitimate empty case; a blank is not.
    expect(said.length, 'the module-access summary is blank, so the operator cannot see what '
      + 'this invitation carries before sending it').toBeGreaterThan(8);

    await page.getByRole('button', { name: /^Add or invite$/ }).click();

    // The row must APPEAR — §3 is explicit that the assertion is the row, not
    // the toast. The "Invited · n" section only renders when there is at least
    // one live invitation, so its presence with this address in it is the proof.
    const invited = page.getByRole('heading', { name: /^Invited ·/ });
    await expect(invited).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.oinv__e', { hasText: INVITEE })).toBeVisible({ timeout: 30_000 });

    // Recorded for the run report's SQL check against public.invites.
    console.log(`\n[suite01] invited address: ${INVITEE}`);
    // ⚠ THE RESOLVED LANE'S ORG, NOT `UNICODE_ORG_ID`. This printed the hardcoded
    // Unicode id whatever lane ran — and it exists specifically so a verifier can
    // SQL `public.invites`. On a fallback run it therefore sent them to Unicode
    // Group, where the row is NOT: 0 rows found, the invite filed as failed, when
    // it had in fact succeeded in E2E Test & Associates. It also flatly
    // contradicted the `⚠ FALLBACK — NOT the reference lane` banner printed three
    // lines earlier in beforeAll. Found 2026-08-30 by a wave-1 agent.
    console.log(`[suite01] org: ${LANE.orgId}  (${LANE.org})\n`);
  });

  test('01.2 forgot-password is requested and confirmed on screen', async ({ page }) => {
    // Unauthenticated — runs with or without a Unicode login.
    //
    // ⚠ This SENDS. One message, to the owner's own inbox. The reset is not
    // completed: §3 forbids locking an account the programme still needs.
    await page.goto('/forgot-password');
    await expect(page.locator('#fp-email')).toBeVisible({ timeout: 30_000 });
    await page.locator('#fp-email').fill(UNICODE_KNOWN_ADDRESS);
    await page.getByRole('button', { name: /Send reset link/ }).click();

    // The product answers 200 whether or not the account exists, by design
    // (anti-enumeration). So the assertion is the CONFIRMATION SCREEN, which is
    // the only thing a user sees — and it must name the address back to them.
    await expect(page.getByText(/a reset link is on its way/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(UNICODE_KNOWN_ADDRESS, { exact: false })).toBeVisible();

    // The 60s resend countdown is part of the specified behaviour, and it is
    // also the product refusing to let a user hammer a 3/minute endpoint.
    await expect(page.getByRole('button', { name: /Resend in \d+s/ })).toBeVisible();
  });

  test('01.3 the login rate limit refuses the sixth bad password', async ({ page }) => {
    // Runs LAST in this file on purpose: it exhausts `POST /auth/login`
    // (5/minute) for this egress IP, and any sign-in after it would be refused
    // by this test's own doing.
    test.setTimeout(180_000);

    const results: string[] = [];
    let refusedAt = 0;

    // ⚠ ONE PAGE LOAD, NOT SIX, AND THE STATUS IS WHAT IS READ.
    //
    // This loop called `page.goto('/login')` on every attempt — a full SPA
    // reload against a Cloudflare-served bundle, 8-15s each. Six of those is
    // 60-90 seconds, so the attempts STRADDLED THE 1-MINUTE WINDOW and the
    // counter reset before the sixth. It then reported "no attempt was
    // rate-limited" against a limiter that was working. Measured directly the
    // same minute, through the same host:
    //
    //     401 401 401 401 401 429 429 429      six POSTs, about two seconds
    //
    // and `/api/health` answers `rate_limit_store: "redis"`, so the counters
    // are shared across workers — the split-bucket defect described at length
    // below was fixed, and this test could no longer see it either way.
    //
    // The form is now submitted repeatedly WITHOUT a reload, which is also what
    // somebody hammering a login actually does, and each attempt is classified
    // by its RESPONSE STATUS rather than by the banner's text. Reading the
    // banner needed a fresh render to tell attempt N from N-1; a status cannot
    // be stale. The banner's WORDS are still asserted, on the refusal itself,
    // because the whole point of `authErrorMessage` is that slowapi's own
    // string never reaches a person.
    const t0 = Date.now();
    await page.goto('/login');
    await expect(page.locator('#au-email')).toBeVisible({ timeout: 30_000 });
    await page.locator('#au-email').fill(UNICODE_KNOWN_ADDRESS);

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await page.locator('#au-password').fill(`definitely-not-the-password-${attempt}`);
      const [res] = await Promise.all([
        page.waitForResponse((r) => /\/auth\/login$/.test(new URL(r.url()).pathname)
          && r.request().method() === 'POST', { timeout: 30_000 }),
        page.locator('form button[type="submit"]').first().click(),
      ]);
      const status = res.status();

      // ⚠ THIS ASSERTION WAS A TEST BUG ON ITS FIRST RUN, and it is worth
      // leaving the scar visible because it is the exact failure the programme
      // exists to catch. It matched the free text `/email or password/`, and
      // every one of the six attempts "failed to find an element". The product
      // was correct throughout: the captured page snapshot shows
      //
      //     alert: "That email and password do not match an account."
      //
      // — email AND password, which is the sentence `LoginPage.jsx:508` has
      // always set. Had that been read as a product defect, a working error
      // banner would have been reworded to please a broken regex.
      //
      // So the wait is on the BANNER — the structural thing the product renders
      // for any rejected sign-in (`role="alert"`, `.au__banner--err`) — and the
      // classification is done by reading what it says. There is no prose match
      // for the credentials case at all now; the only phrase matched is the
      // rate-limit one, and that phrase is a specified string rather than
      // incidental copy: `authErrorMessage` rewrites every 429 to "Too many
      // attempts. Wait a minute and try again." precisely so slowapi's own
      // "Rate limit exceeded: 5 per 1 minute" never reaches a user.
      const banner = page.locator('.au__banner--err');
      await expect(banner.first()).toBeVisible({ timeout: 30_000 });
      const said = ((await banner.first().innerText()) || '').trim();

      if (status === 429) {
        results.push(`${attempt}: REFUSED 429 — "${said}"`);
        if (!refusedAt) refusedAt = attempt;
        // Asserted on the refusal itself, which is the only place it can be
        // wrong: slowapi answers "Rate limit exceeded: 5 per 1 minute" and no
        // user may ever read it.
        expect(said, 'a rate-limited sign-in showed the limiter\'s own machine string '
          + 'instead of the sentence `authErrorMessage` rewrites it to')
          .toMatch(/Too many attempts/i);
      } else {
        results.push(`${attempt}: ${status} — "${said}"`);
      }

      // Still on the form, every time. A rate-limited attempt that let the user
      // through would be the defect this test exists to catch.
      expect(new URL(page.url()).pathname).toBe('/login');
    }

    console.log('\n[suite01] login attempts:\n  ' + results.join('\n  ') + '\n');

    // The contract is "6 bad passwords must be refused". Five are allowed
    // through as ordinary 401s; the sixth must be refused by the limiter.
    // Asserted as "refused by the sixth" rather than "exactly at the sixth",
    // because the limiter is keyed on the forwarded IP and an earlier request
    // from the same egress address legitimately moves the boundary EARLIER.
    // It can never move it later, so `<= 6` is the real invariant.
    //
    // ═══════════════════════════════════════════════════════════════════════
    // ⚠ THE SPLIT-BUCKET DEFECT BELOW IS FIXED. THE HISTORY STAYS.
    //   Raised 2026-08-28 · closed and re-measured 2026-08-31.
    // ═══════════════════════════════════════════════════════════════════════
    // `/api/health` now answers `rate_limit_store: "redis"`, and six POSTs
    // through `api.kartavaya.com` in one window read 401 401 401 401 401 429 —
    // one counter, refusing exactly at the sixth. The account of the defect is
    // kept because it is the reasoning that found it, and because the shape
    // ("an INTERMITTENT limit is the signature of a split bucket") is the part
    // worth having the next time a limit half-works.
    //
    // ⚠ IT FAILED AGAIN ON 2026-08-31 AND THE PRODUCT WAS INNOCENT. The loop
    // reloaded the page for every attempt and took 60-90s, straddling the
    // 1-minute window; see the note above the loop. The elapsed time is now
    // printed in the failure message so nobody re-opens this from the same
    // evidence a third time.
    // Six bad passwords through the form: all six answered 401, none refused.
    // Before accusing the product, the endpoint was measured directly —
    //
    //   8 rapid POSTs to /api/auth/login   ->  401 ×8, no 429
    //   20 rapid POSTs to the same         ->  429 at attempts 7,10,13,15,16,
    //                                          17,18 — and 401 at 8,9,11,12,
    //                                          14,19,20
    //
    // An intermittent limit is the signature of a SPLIT BUCKET, and the split
    // is in the deploy, not in the key function. Railway staging (service
    // `Kartavya`, env `staging`, `numReplicas: 1`) starts:
    //
    //   gunicorn server:app -k uvicorn.workers.UvicornWorker --workers 2 …
    //
    // slowapi's default storage is IN-MEMORY AND PER-PROCESS. Two worker
    // processes hold two independent counters, so `@limiter.limit("5/minute")`
    // is really "5 per minute per worker" — up to 10, landing wherever gunicorn
    // happens to route the connection. The documented control ("login is
    // 5/min") is therefore not enforced, and worse, it is NON-DETERMINISTIC: an
    // attacker gets roughly double the budget and a legitimate user cannot
    // predict when they will be refused.
    //
    // `limiter.py`'s key function is NOT at fault — its whole header is about
    // getting the caller's address right, and it does. The bucket is the fault.
    //
    // The same defect is one screen down in `server.py`: `_write_rate_buckets`
    // is a plain module-level `dict`, so the global "120 writes per minute per
    // IP" is likewise 240 across two workers.
    //
    // Fix is a shared store (`Limiter(..., storage_uri=…)`) or one worker —
    // not a weaker assertion here.
    const secs = Math.round((Date.now() - t0) / 1000);
    expect(refusedAt, `no attempt was rate-limited in ${secs}s:\n  `
      + results.join('\n  ')
      + (secs >= 55
        ? `\n\n  ⚠ THE SIX ATTEMPTS TOOK ${secs}s, SO THEY STRADDLED THE `
          + '1-minute window and the counter reset mid-run. That is this test being '
          + 'slow, not the limiter being absent — measure the endpoint directly '
          + 'before reporting a product defect.'
        : '')).toBeGreaterThan(0);
    expect(refusedAt).toBeLessThanOrEqual(6);

    // And the machine string must never reach the first screen of the product.
    await expect(page.getByText(/Rate limit exceeded/i)).toHaveCount(0);
  });
});
