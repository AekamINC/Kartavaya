/**
 * Proposal 93 · Stage 3 · WAVE 1 · SUITE 02 — §10's DANGER-ZONE screen.
 * Test 02.18, on Unicode Group. Its own file: two other agents are editing
 * `suite02-org-settings.spec.ts` concurrently.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠  READ THIS BEFORE EDITING A SINGLE LINE  ⚠⚠
 * ═══════════════════════════════════════════════════════════════════════════
 * Unicode Group (`fae87907-2f99-4b35-a241-c94d9e1e4a17`) is a LIVE organisation
 * on the Supabase database that **staging and production share** (CLAUDE.md,
 * "The one dangerous fact"). Deleting it is irreversible.
 *
 * `staging.organisations` carries **152 CASCADE**s, one of which crosses the
 * schema boundary into `public.org_settings`. So a single successful DELETE of
 * that row is not "one row gone": it is a fan-out through every project, task,
 * invoice, payroll run, document, membership and audit trail this firm owns,
 * plus a table in the OTHER product schema — the one CLAUDE.md warns is
 * routinely forgotten because a `42P01` from a schema-qualified query is a fact
 * about that schema only. There is no undo, no soft-delete tombstone to read
 * back from, and the backup taken for R4 is by memory's own note "the only
 * copy". The blast radius is the company.
 *
 * This test therefore opens the most consequential screen the product has and
 * proves it is SAFE. It is not a deletion test. It must never become one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE SCREEN ACTUALLY IS — read from source, not assumed
 * ═══════════════════════════════════════════════════════════════════════════
 * The brief for this test described "opened and CANCELLED (never confirmed)",
 * which presumes a confirm control with a gate on it. **There is no such
 * control, and there is no such endpoint.** Measured 2026-08-28 by reading:
 *
 *   · `frontend/src/pages/org/TabDanger.jsx` renders THREE `<section>`s of prose
 *     and nothing else — no button, no input, no form. Its own header comment
 *     says so deliberately: the role model settled 2026-07-26 moved BOTH
 *     destructive actions (delete org, transfer ownership) to Aekam platform
 *     staff, and "a 'Delete organisation' control that ends in a 403 … is worse
 *     than a page that explains where the action lives".
 *   · `frontend/src/styles/org.css:333` records the same decision from the CSS
 *     side: `.odz__i`, the type-the-org-name confirmation input the design spec
 *     asked for, is deliberately absent "because there is no destructive
 *     control on this tab to confirm".
 *   · The backend has **no organisation-delete route at all**. Grepping every
 *     `@router.delete` in `backend/routers/` returns nine handlers; not one of
 *     them deletes an organisation, and there is no `DELETE FROM
 *     staging.organisations` anywhere in the Python. The nearest thing that
 *     exists is `admin_orgs.py:1614 PATCH /api/v1/admin/orgs/{org_id}/deactivate`
 *     — an UPDATE setting `is_active=FALSE` and cancelling the subscription,
 *     gated on `require_platform_role(*SUPERUSER_ONLY_ROLES)`. An org_admin or
 *     an org_owner cannot reach it; only god mode can, and god mode appears in
 *     NO lane in `_lanes.ts` by the owner's decision.
 *
 * So the honest assertion is not "the gate holds". It is the STRONGER one:
 * **there is nothing on this screen to gate, and this test is the ratchet that
 * makes a destructive control impossible to ship here unnoticed.** If a button
 * ever appears on this tab, 02.18 goes red and a human has to come back to this
 * file and think about it before the suite can be green again. That is the
 * whole design.
 *
 * A missing control is normally a FAILURE and never a `test.skip` (suite rule).
 * That rule is about a control the product is supposed to have. Here the
 * absence IS the specification, recorded in two source files and a dated
 * decision — so it is asserted as such, positively, rather than skipped.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW CONFIRMATION IS MADE STRUCTURALLY IMPOSSIBLE — three independent cages
 * ═══════════════════════════════════════════════════════════════════════════
 * "It doesn't click confirm" is a promise. A promise survives exactly until the
 * next well-meaning edit. These three do not depend on anybody remembering:
 *
 *  1 · THE NETWORK CAGE (`cageThePage`). A `page.route()` interceptor over
 *      EVERY url, installed BEFORE the first navigation. Every DELETE is aborted at the
 *      browser, whatever it is aimed at. Every non-GET to our own `/api/` is
 *      aborted too, because this spec reads and does nothing else. An abort is
 *      not a log line — the request never leaves the machine. So even if a
 *      future edit clicked a delete button that a future release put on this
 *      tab, the call could not reach the server.
 *
 *  2 · THE KEYBOARD CAGE. This file contains **no `click`, no typing, and no
 *      Enter or Space**. The only two keys it may press are `Escape` and
 *      `ArrowLeft`, and neither can activate a button — that is a property of
 *      the browser, not of this test's good intentions. Leaving the tab is done
 *      with the tablist's roving-tabindex arrow keys (`Tabs.jsx:36`), which
 *      also buys a real a11y assertion for free: the danger surface can be left
 *      by keyboard alone.
 *
 *  3 · THE SOURCE RATCHET (test `02.18·cage`). The spec reads ITS OWN SOURCE
 *      and fails if cage 2 has been weakened — if any interaction verb appears,
 *      or if any key other than Escape/ArrowLeft is pressed. `page.request`
 *      bypasses `page.route` entirely (a real hole in cage 1), so the ratchet
 *      also forbids `request.post/put/patch/delete/fetch`: the only API call
 *      this file may make is a GET. Cage 3 is what makes cages 1 and 2 survive
 *      an edit made in a hurry by someone who has not read this header. It runs
 *      FIRST, before a browser is even opened.
 *
 *      This is the same species as `frontend/scripts/check-rendered-ids.mjs` —
 *      a ratchet, in the vocabulary this repo already uses. Its forbidden
 *      tokens are assembled from two halves at runtime so the literals never
 *      appear verbatim in this file and the scan cannot flag itself.
 *
 * The three are independent on purpose. Removing any one leaves the other two
 * standing, and removing all three cannot be done by accident.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IDEMPOTENCE (§6)
 * ═══════════════════════════════════════════════════════════════════════════
 * Trivial, and verified rather than assumed: this spec creates nothing, writes
 * nothing and leaves no state. Its every side effect is a GET. The read-back at
 * the end compares the org profile against the snapshot taken at the start of
 * the SAME test, so a second run starts from wherever the first one left it and
 * still asserts the identical property.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave1.config.ts --grep "02.18"
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import { ORG as ORG_IDS, assertOrg, lane, activeLane, signInAs } from './_lanes';

const API_BASE = process.env.E2E_API_URL || 'https://kartavaya-staging.up.railway.app';

/**
 * THE LANE. Unicode Group, and asserted to be Unicode Group rather than
 * trusted: `lane()` reads env, and env is the thing that was wrong on
 * 2026-08-28 when this suite renamed Aekam Inc believing it was here.
 *
 * There is deliberately no fallback lane in this file. Every other Suite 02
 * test can honestly run against E2E if Unicode's credential is missing; this
 * one cannot, because "the danger zone of SOME organisation is safe" is not the
 * claim being made. No credential is a BLOCKED environment condition and
 * `_lanes.signInAs` already throws with that word in it.
 *
 * ⚠ NEVER a platform credential. `_lanes.ts` rule 1 is absolute, and it matters
 * more here than anywhere else in the programme: a `platform_admin` token
 * resolves through `platform_bypass` to whatever the session says, which is
 * exactly how a "safe, read-only look at the danger tab" would end up looking
 * at somebody else's company.
 */
// ⚠ STAGE 4 (§14): `activeLane()` reads E2E_LANE and DEFAULTS TO 'unicode', so an
// unset run is byte-for-byte the Unicode run this suite was authored against.
// `lane('unicode')` frozen here at import time was why the UK replay could not
// be run at all — §14's own first category, a hidden dependency on Unicode.
const LANE = activeLane();

// ⚠ EXCLUDED BY DECISION ON A NON-UNICODE LANE, not broken and not skipped for
// convenience. 02.18's subject is the danger tab READ-ONLY, behind three cages,
// and it is deliberately pinned to one org. Under `E2E_LANE=uk` the honest
// outcome is "not run, and here is why" — running it against Unicode inside a
// UK report would put the silent third org in the middle that §14 warns about.
test.skip(
  () => (process.env.E2E_LANE || 'unicode').trim().toLowerCase() !== 'unicode',
  'EXCLUDED BY DECISION on this lane — 02.18 is hard-wired to Unicode Group and ' +
  'must not be repointed. Re-run without E2E_LANE to exercise it.',
);

test.beforeAll(() => {
  expect(
    LANE.orgId,
    'this spec is hard-wired to the Unicode Group lane and must not be repointed',
  ).toBe(ORG_IDS.UNICODE);
  console.log(
    `\n  LANE: ${LANE.org} (${LANE.orgId})  ·  reference lane, §14` +
    `\n  02.18 is READ-ONLY BY CONSTRUCTION — network cage, keyboard cage, source ratchet.\n`,
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
 * CAGE 1 — THE NETWORK CAGE
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Paths that could destroy or suspend an organisation, in any verb but GET. */
const DESTRUCTIVE_PATHS = [
  '/org/delete',
  '/organisation/delete',
  '/organisations/delete',
  '/deactivate',
  '/transfer-ownership',
  '/admin/orgs/',
];

/** The only verbs this spec is allowed to put on the wire. */
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * The one legitimate exception. `_lanes.signInAs` uses the real login form when
 * a password exists, and that POSTs `/api/v1/auth/login`. Signing in is the
 * precondition for the test, not a write it is making — §2's own reasoning
 * about the bootstrap admin. Scoped to `/auth/`, so it cannot widen.
 */
const AUTH_ALLOW = ['/auth/'];

/**
 * Which hosts rule 3 governs — OURS, and only ours.
 *
 * ⚠ This is not tidiness, it is a flake that would have fired on the first run.
 * Sentry's ingest endpoint is a POST to a path of the form
 * `/api/<project>/envelope/`, and Sentry is wired and live on staging (memory:
 * "Sentry wired, verified live"). A rule 3 that keys on `/api/` alone would
 * abort the error reporter on every page load, record a cage violation, and
 * fail 02.18 with "SOMETHING IN THIS TEST TRIED" — pointing a very loud alarm
 * at a telemetry beacon. Third-party non-GETs are recorded and let through;
 * only requests to the app and its API are held to the read-only rule.
 */
const API_HOST = (() => { try { return new URL(API_BASE).host; } catch { return ''; } })();
const isOurs = (host: string) =>
  host === API_HOST || host.endsWith('kartavaya.com') || host.endsWith('railway.app');

type Cage = {
  /** Requests the cage REFUSED TO SEND. Any entry here fails the test. */
  violations: string[];
  /** Every non-GET that was allowed through, for the failure dump. */
  allowedWrites: string[];
};

/**
 * Install the cage. Must be called before the first navigation.
 *
 * ⚠ WHY ABORT AND NOT MERELY RECORD. A listener that watches and reports is a
 * post-mortem: it tells you afterwards that the organisation was deleted. An
 * abort is a control — the request is refused at the browser and never reaches
 * Railway. On a screen whose worst case is unrecoverable, only the second one
 * is worth having. The recorded violation then fails the test loudly, so the
 * refusal is never silent either.
 *
 * ⚠ ITS ONE HOLE, stated rather than hidden: `page.route` does not intercept
 * `page.request.*` (APIRequestContext) calls — those go out of the Node process,
 * not the browser. That hole is closed by cage 3, which forbids every
 * `request.<write verb>(` in this file by reading the file.
 *
 * ⚠ COST: routing every url intercepts the document and every asset, which
 * slows the page and disables the browser cache. Accepted deliberately — a cage
 * with a hole shaped like "we only watched the API calls" is not a cage, and
 * this spec loads ten small pages once.
 *
 * ⚠ The matcher is a PREDICATE, not the `**` glob that would be the obvious
 * spelling. The glob's own text contains a `/` immediately followed by a `*`,
 * and cage 3 strips block comments from this file before scanning it — that
 * sequence opens a comment the stripper then runs to the next closer, silently
 * blanking the body of this very function from the scan. A guard that hides the
 * cage it is guarding is worse than no guard. `() => true` reads the same and
 * cannot do that.
 */
async function cageThePage(page: Page): Promise<Cage> {
  const cage: Cage = { violations: [], allowedWrites: [] };

  await page.route(() => true, async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    let pathname = req.url();
    let host = '';
    try {
      const u = new URL(req.url());
      pathname = u.pathname;
      host = u.host;
    } catch { /* keep the raw url; an unparseable url is treated as third-party */ }

    // 1 · A DELETE is refused unconditionally, wherever it is aimed and whoever
    //     aimed it. There is no DELETE this spec could legitimately make.
    if (method === 'DELETE') {
      cage.violations.push(`DELETE ${pathname}  → ABORTED by the cage (rule 1)`);
      return route.abort('blockedbyclient');
    }

    // 2 · Anything shaped like org destruction or suspension, in any verb.
    //     Belt and braces with rule 3: the product could plausibly implement a
    //     queued deletion as a POST, and rule 1 would not have seen it.
    if (!SAFE_METHODS.includes(method) && DESTRUCTIVE_PATHS.some((p) => pathname.includes(p))) {
      cage.violations.push(`${method} ${pathname}  → ABORTED by the cage (rule 2, destructive path)`);
      return route.abort('blockedbyclient');
    }

    // 3 · This spec READS. Any other write to our own API is a bug in the test
    //     or an unexpected write on page load, and either way it is refused so
    //     that it is discovered here rather than in an audit log.
    if (
      !SAFE_METHODS.includes(method) &&
      isOurs(host) &&
      /\/api\//.test(pathname) &&
      !AUTH_ALLOW.some((a) => pathname.includes(a))
    ) {
      cage.violations.push(`${method} ${pathname}  → ABORTED by the cage (rule 3, this spec is read-only)`);
      return route.abort('blockedbyclient');
    }

    // Everything else that is not a plain read is recorded but allowed: a
    // third-party beacon, and the login POST. Recorded rather than ignored, so
    // the failure dump can show what was on the wire if anything goes wrong.
    if (!SAFE_METHODS.includes(method)) cage.allowedWrites.push(`${method} ${host}${pathname}`);
    return route.continue();
  });

  return cage;
}

/**
 * THE WIRE — the same instrument Suite 02 uses, kept even though the cage sits
 * upstream of it. Memory's rule from the bank-import bug: watch the requests
 * before blaming the UI. Here it answers a second question the cage cannot —
 * *what did the server ANSWER* — for any write that the cage let through, and
 * it is the thing that would notice if the cage were ever mis-wired.
 */
type Wire = { line: string }[];

function watchWire(page: Page): Wire {
  const wire: Wire = [];
  page.on('response', async (r) => {
    const req = r.request();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) return;
    if (!/\/api\//.test(r.url())) return;
    // ⚠ Same two exclusions the cage makes, and for the same reasons: Sentry's
    // ingest path also contains `/api/`, and signing in is the precondition for
    // the test rather than a write it is making. Without these the "no write
    // reached the wire" assertion below fails on a telemetry beacon or on the
    // login itself — a false alarm on the one screen where an alarm is
    // believed instantly.
    let host = '';
    try { host = new URL(r.url()).host; } catch { /* treated as third-party */ }
    if (!isOurs(host)) return;
    if (AUTH_ALLOW.some((a) => r.url().includes(a))) return;
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

/* ═══════════════════════════════════════════════════════════════════════════
 * NAVIGATION AND READ-BACK
 * ═══════════════════════════════════════════════════════════════════════════ */

async function openTab(page: Page, tab: string) {
  await page.goto(`/settings/organisation${tab === 'profile' ? '' : `?tab=${tab}`}`);
  // ⚠ `level: 1`, and it is not tidiness — this is the exact ambiguity the
  // danger tab caused in `suite02-org-settings.spec.ts`. The bare
  // `getByRole('heading', { name: 'Organisation' })` ALSO matches
  // `<h2 class="odz__t">Delete this organisation</h2>` by substring, and
  // Playwright's strict mode failed the whole test on it. The page title is the
  // `h1`. This file opens the danger tab more than any other, so it would have
  // met that fault first.
  await expect(page.getByRole('heading', { name: 'Organisation', exact: true, level: 1 }))
    .toBeVisible({ timeout: 30_000 });
}

/**
 * The bearer, read WITHOUT `page.evaluate` — cage 3 forbids `evaluate`, because
 * an arbitrary script in the page is a way around every other guarantee in this
 * file. `storageState()` returns the same `localStorage.auth_token` that
 * `api.js` sends, and it cannot execute anything.
 */
async function bearer(page: Page): Promise<string | undefined> {
  const state = await page.context().storageState();
  for (const origin of state.origins || []) {
    const hit = (origin.localStorage || []).find((e) => e.name === 'auth_token');
    if (hit?.value) return hit.value;
  }
  return undefined;
}

/**
 * The organisation as the SERVER holds it. The screen is the claim; this is the
 * fact — and "cancelling left it intact" is a claim about the row, not about
 * whether a dialog closed.
 *
 * ⚠ `logo_url` is stripped before comparison and this is NOT convenience.
 * `org_profile.py:349` re-signs the R2 key on every GET, so two identical reads
 * return two different presigned URLs. Comparing it would fail every single
 * run and read exactly like "something changed the organisation" — a false
 * accusation of the highest-consequence kind, on the one screen where a false
 * accusation would be believed.
 */
type Profile = Record<string, unknown>;

async function readOrg(page: Page): Promise<Profile> {
  const token = await bearer(page);
  const res = await page.request.get(`${API_BASE}/api/v1/org/profile`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  expect(res.ok(), `GET /org/profile -> ${res.status()}: ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as Profile;
  const stable: Record<string, unknown> = { ...body };
  delete stable.logo_url;
  return stable;
}

/** How many people still hold a seat. A deletion would take every one of them. */
async function memberCount(page: Page): Promise<number> {
  const token = await bearer(page);
  const res = await page.request.get(`${API_BASE}/api/v1/org/members`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  expect(res.ok(), `GET /org/members -> ${res.status()}: ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  return (Array.isArray(body) ? body : body.data ?? []).length;
}

/** innerText wraps and indents; the source's JSX does too. Compare on one line. */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/* ═══════════════════════════════════════════════════════════════════════════
 * CAGE 3 — THE SOURCE RATCHET
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Forbidden tokens, each assembled from two halves at runtime.
 *
 * ⚠ THE HALVES ARE THE POINT. If the deny-list held the literals whole, the
 * scan would match its own deny-list and this test could never be green — the
 * classic self-referential failure of a guard that reads its own file. Split
 * here, joined at runtime, never present verbatim in the source being scanned.
 */
const FORBIDDEN: [string, string, string][] = [
  ['.cl', 'ick(', 'a click can activate a confirm button'],
  ['.dblcl', 'ick(', 'so can a double click'],
  ['.t', 'ap(', 'and so can a tap'],
  ['.ch', 'eck(', 'a checkbox is how a delete gate is usually satisfied'],
  ['.setCh', 'ecked(', 'same gate, other spelling'],
  ['.selectOpt', 'ion(', 'a select can arm a destructive form'],
  ['.f', 'ill(', 'typing the org name is the classic delete gate'],
  ['.pressSequent', 'ially(', 'the same, one key at a time'],
  ['.ty', 'pe(', 'the deprecated spelling of the same thing'],
  ['.setInputF', 'iles(', 'no upload belongs in a read-only spec'],
  ['.dispatchEv', 'ent(', 'a synthetic click is still a click'],
  ['.eval', 'uate(', 'arbitrary page script routes around every cage above'],
  ['request.p', 'ost(', 'page.request bypasses the network cage entirely'],
  ['request.p', 'ut(', 'page.request bypasses the network cage entirely'],
  ['request.pa', 'tch(', 'page.request bypasses the network cage entirely'],
  ['request.del', 'ete(', 'page.request bypasses the network cage entirely'],
  ['request.f', 'etch(', 'page.request bypasses the network cage entirely'],
];

/**
 * The only two keys this spec may press. Neither activates a control: Escape
 * dismisses, ArrowLeft moves the roving tabindex. Enter and Space are absent
 * from this list deliberately and permanently — they are the two keys that
 * press a focused button.
 */
const ALLOWED_KEYS = ["'Escape'", "'ArrowLeft'"];

/**
 * Strip comments before scanning, so this file's own prose — which necessarily
 * discusses clicking, typing and deleting at length — cannot trip its own
 * ratchet.
 *
 * Known and accepted imprecision: the line-comment pass also truncates at a
 * `//` inside a string literal such as a URL. That can only ever hide code
 * further along the same line, i.e. it can produce a false NEGATIVE, never a
 * false positive. A guard that occasionally under-reports is a nuisance; one
 * that cries wolf gets deleted, and this one must survive.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE TESTS
 * ═══════════════════════════════════════════════════════════════════════════ */

test.describe('Suite 02 — danger zone · Unicode Group', () => {
  test('02.18·cage the spec is structurally incapable of confirming anything', async () => {
    // ⚠ FIRST, and with no browser. If cage 2 has been weakened, nothing else in
    // this file should be allowed to run against a live organisation at all.
    // Declaration order is execution order in Playwright, and `workers: 1` in
    // `wave1.config.ts` keeps it that way.
    const file = test.info().file;
    const src = stripComments(fs.readFileSync(file, 'utf8'));

    const breaches: string[] = [];

    for (const [a, b, why] of FORBIDDEN) {
      const token = a + b;
      if (src.includes(token)) {
        breaches.push(
          `  ✗ "${token}" appears in this spec — ${why}.\n` +
          `      02.18 opens the DELETE-THIS-ORGANISATION screen of a live org on a\n` +
          `      database shared with production. It is read-only by construction.\n` +
          `      If the product now has a control here that must be exercised, that is\n` +
          `      a decision for the owner, not an edit to this file.`,
        );
      }
    }

    // Every key press must be one of two harmless keys. `pressSequentially` is
    // already forbidden above, so this pattern only ever meets a real `press(`.
    const keys = [...src.matchAll(/press\(\s*([^)]*)\)/g)].map((m) => m[1].trim());
    for (const k of keys) {
      if (!ALLOWED_KEYS.includes(k)) {
        // ⚠ The key is reported WITHOUT re-spelling the call. Writing
        // "press(${k})" here put a literal match into this file's own failure
        // message, and the scan then found itself: measured, not theorised.
        breaches.push(
          `  ✗ a key press of ${k} — only ${ALLOWED_KEYS.join(' and ')} are permitted here.\n` +
          `      Enter and Space activate a focused button. That is the entire reason\n` +
          `      this spec navigates by arrow key and never by Enter.`,
        );
      }
    }
    expect(keys.length, 'the keyboard cage is not being exercised at all — has 02.18 been gutted?')
      .toBeGreaterThan(0);

    // Prove the ratchet can fail, rather than trusting a guard nobody has seen
    // fail (93 §0). A control sample containing a forbidden token must be caught
    // by the very same scan that just passed the real file.
    const control = stripComments(`const x = 1; await page.getByRole("button")` + `.cl` + `ick();`);
    expect(
      FORBIDDEN.some(([a, b]) => control.includes(a + b)),
      'THE RATCHET DOES NOT BITE. It passed the real file and also passed a control ' +
      'sample that contains a forbidden token — so its green means nothing. Fix the ' +
      'scan before trusting anything else in this file.',
    ).toBeTruthy();

    expect(breaches, `\n\nTHE 02.18 CAGE HAS BEEN BREACHED:\n${breaches.join('\n')}\n`).toEqual([]);
  });

  test('02.18 danger zone — opened, warned, and left with the organisation untouched', async ({ page }) => {
    // ── Cage 1 goes on before anything else, including the first navigation ──
    const cage = await cageThePage(page);
    const wire = watchWire(page);

    await signInAs(page, LANE);
    // ⚠ The org guard, before a single byte is read about "this organisation".
    // It exists because this suite once drove Aekam Inc while printing
    // "Unicode Group", and on THIS screen the equivalent mistake would be
    // reading somebody else's deletion warning and calling it evidence.
    await assertOrg(page.request, page, LANE);

    // ── The snapshot the whole test is judged against ──────────────────────
    const before = await readOrg(page);
    const membersBefore = await memberCount(page);
    expect(before.id, 'the profile echo must name the lane org').toBe(LANE.orgId);
    expect(
      membersBefore,
      'Unicode Group has no members at all — this lane is not seeded and 02.18 would be ' +
      'asserting the safety of an empty shell. ENVIRONMENT condition, not a product defect.',
    ).toBeGreaterThan(0);
    const serverName = String(before.name ?? '');

    /* ═══════════════════════════════════════════════════════════════════
     * 1 · THE SURFACE IS REACHABLE
     * ═══════════════════════════════════════════════════════════════════ */
    await openTab(page, 'danger');

    const panel = page.getByRole('tabpanel');
    await expect(panel).toBeVisible({ timeout: 30_000 });

    // Both `.odz` zones paint. TabDanger's own comment: the zone still paints
    // "because the reader arrives here looking for exactly these two things and
    // needs to find their answer, not an empty tab". Two of them, exactly.
    await expect(panel.locator('.odz')).toHaveCount(2);
    await expect(panel.getByRole('heading', { name: 'Transfer ownership', exact: true })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Delete this organisation', exact: true })).toBeVisible();

    /* ═══════════════════════════════════════════════════════════════════
     * 2 · IT SAYS, IN WORDS, WHAT WOULD BE DESTROYED
     *
     * Every string below is copied from `TabDanger.jsx`, not invented. Plain
     * substrings, never a RegExp built from data — the suite rule exists
     * because an org name or an address carrying a regex metacharacter turns a
     * generated pattern into something that matches the wrong thing or throws.
     * ═══════════════════════════════════════════════════════════════════ */
    const text = norm(await panel.innerText());

    const MUST_SAY: [string, string][] = [
      // The consequence, itemised. This is the sentence that stops an admin
      // believing a deletion is reversible or partial.
      ['Everything goes: projects, tasks, invoices, payroll history, documents',
        'the tab must itemise what is destroyed, not merely warn'],
      // The seven-day queue — the settled decision, and the reason a mistake is
      // recoverable for a week.
      ['queued for seven days',
        'the seven-day queue is the settled decision (START-HERE §Decisions already settled)'],
      ['any owner or admin can stop it during that window',
        'a queue nobody is told they can stop is not a safety net'],
      // Where the action actually lives. A danger tab with no control and no
      // forwarding address is just a dead end.
      ['contact your account manager at Aekam',
        'the reader must be told where the action lives, or the tab is a dead end'],
      ['Export what you need first',
        'the one action the customer can still take before a deletion'],
      // Transfer ownership: the same treatment, and the admin/owner distinction
      // that stops a firm asking for a transfer when it wants a second admin.
      ['to another person is done by Aekam, not from inside the organisation',
        'transfer ownership must say who performs it'],
      ['make them an org admin on the Members tab',
        'the alternative that answers most transfer requests'],
      ['neither can be taken on a phone call',
        'the anti-social-engineering line: a destructive request must be in writing'],
    ];

    const silent = MUST_SAY.filter(([phrase]) => !text.includes(phrase))
      .map(([phrase, why]) => `  ✗ missing: "${phrase}"\n      ${why}`);
    expect(
      silent,
      `\n\nTHE DANGER TAB DOES NOT SAY WHAT IT DESTROYS:\n${silent.join('\n')}\n\n` +
      `  rendered text was:\n     ${text.slice(0, 800)}\n`,
    ).toEqual([]);

    /* ═══════════════════════════════════════════════════════════════════
     * 3 · IT NAMES THE RIGHT COMPANY
     *
     * ⚠ This is the assertion most likely to fail, and if it does it is a
     * PRODUCT question, not a test to loosen. `OrgSettingsPage.jsx:169` passes
     * `orgName={orgRole?.org_name}` — the FIRST org role on the token — while
     * the page's own lede was changed on 2026-08-28 to use `resolvedOrgName`
     * from `GET /v1/org/profile`, with a long comment explaining that
     * `org_roles.find(...)` "is not the org a write lands in". TabDanger did not
     * get that fix. So the highest-consequence screen in the product may name
     * the company by the exact mechanism that was declared wrong.
     *
     * On a single-org account the two agree and this passes. Adjudication of
     * "latent or active" is the owner's, not this test's.
     * ═══════════════════════════════════════════════════════════════════ */
    expect(serverName.length, 'the server returned no org name to compare against').toBeGreaterThan(0);
    expect(
      text.includes(serverName),
      `\n  THE DANGER TAB NAMES A DIFFERENT COMPANY THAN THE SERVER RESOLVED.\n` +
      `     server (GET /v1/org/profile) : ${serverName}\n` +
      `     screen (TabDanger, via token): see the rendered text below\n` +
      `     Suspected source: OrgSettingsPage.jsx:169 passes orgRole?.org_name,\n` +
      `     the token's first org role — the mechanism the same file's own\n` +
      `     comment (lines 82-101) records as "not the org a write lands in".\n` +
      `     Do NOT loosen this assertion. Report it.\n` +
      `     rendered: ${text.slice(0, 400)}\n`,
    ).toBeTruthy();

    /* ═══════════════════════════════════════════════════════════════════
     * 4 · THERE IS NOTHING HERE TO CONFIRM — the ratchet
     *
     * This is the assertion that guards the future. `TabDanger.jsx` renders
     * prose and nothing else, and `org.css:333` records that the confirmation
     * input the design asked for is deliberately absent because there is no
     * destructive control to confirm. If any of these counts ever moves off
     * zero, a control has appeared on the delete-this-organisation screen and
     * this test goes red — which is precisely what should happen. It must not
     * be "fixed" by relaxing the count.
     * ═══════════════════════════════════════════════════════════════════ */
    const controls = {
      buttons: await panel.locator('button').count(),
      inputs: await panel.locator('input').count(),
      textareas: await panel.locator('textarea').count(),
      selects: await panel.locator('select').count(),
      forms: await panel.locator('form').count(),
      roleButtons: await panel.locator('[role="button"]').count(),
      // The design's type-the-org-name gate. Absent by decision, asserted so
      // that its ARRIVAL is what breaks the build.
      typedGate: await panel.locator('.odz__i').count(),
    };
    expect(
      controls,
      `\n\n  ⚠ A CONTROL HAS APPEARED ON THE DANGER TAB.\n` +
      `     Counted: ${JSON.stringify(controls)}\n` +
      `     As of 2026-08-28 this tab renders prose only: the role model settled\n` +
      `     2026-07-26 moved delete-org and transfer-ownership to Aekam platform\n` +
      `     staff, there is NO organisation-delete route in backend/routers/, and\n` +
      `     the nearest thing (PATCH /admin/orgs/{id}/deactivate) is gated on\n` +
      `     SUPERUSER_ONLY_ROLES which no org_admin or org_owner holds.\n` +
      `     If the product has genuinely grown a destructive control here, this\n` +
      `     test must be REWRITTEN BY A HUMAN who has read the 152-CASCADE note\n` +
      `     at the top of this file. Do not relax these counts to get green.\n`,
    ).toEqual({
      buttons: 0, inputs: 0, textareas: 0, selects: 0, forms: 0, roleButtons: 0, typedGate: 0,
    });

    // No confirm dialog was opened, because nothing could open one. Asserted
    // against the real component: `ConfirmDialog.jsx` renders
    // `role="alertdialog"` inside `.modal__scrim`, and its typed gate is
    // `#cd-type-*` with a disabled confirm until the text matches.
    await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
    await expect(page.locator('.modal__scrim')).toHaveCount(0);

    /* ═══════════════════════════════════════════════════════════════════
     * 5 · THE SURFACE CAN BE LEFT — Escape, then the keyboard
     *
     * The brief's concern is right even though there is no modal: a destructive
     * surface that traps focus or cannot be dismissed is a live bug. With no
     * dialog to dismiss, the two things that can still be wrong are (a) Escape
     * doing something unexpected, and (b) the tab being a keyboard dead end.
     * Both are checked, and both use keys that cannot activate a control.
     * ═══════════════════════════════════════════════════════════════════ */
    await page.keyboard.press('Escape');
    // Escape must be inert here — it must not navigate, not open anything, and
    // above all not submit anything. Still on the danger tab, still no dialog.
    await expect(panel.getByRole('heading', { name: 'Delete this organisation', exact: true }))
      .toBeVisible();
    await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);

    // Now leave, by keyboard alone. `Tabs.jsx` implements roving tabindex with
    // ←/→ on the tablist (only the active tab is in the tab order), so ArrowLeft
    // from Danger zone moves to Storage — the tab declared immediately before it
    // in `OrgSettingsPage.jsx`. A plain string in the name matcher: the label is
    // "Danger zone" plus the Hindi संकट, so an exact match would not hit.
    const dangerTab = page.getByRole('tab', { name: 'Danger zone' });
    await expect(dangerTab).toBeVisible();
    await expect(dangerTab).toHaveAttribute('aria-selected', 'true');
    await dangerTab.focus();
    await page.keyboard.press('ArrowLeft');

    // Left successfully: the danger copy is gone and another tab owns the panel.
    await expect(dangerTab).toHaveAttribute('aria-selected', 'false', { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Delete this organisation', exact: true }))
      .toHaveCount(0);
    // The page itself is still alive — leaving the danger tab is not a crash.
    await expect(page.getByRole('heading', { name: 'Organisation', exact: true, level: 1 }))
      .toBeVisible();

    /* ═══════════════════════════════════════════════════════════════════
     * 6 · NOTHING WAS SENT, AND THE ORGANISATION IS INTACT
     *
     * The dialog closing is not evidence. The row is.
     * ═══════════════════════════════════════════════════════════════════ */
    expect(
      cage.violations,
      `\n\n  ⚠⚠ THE CAGE STOPPED A DESTRUCTIVE REQUEST. Nothing reached the server —\n` +
      `     that is what the cage is for — but SOMETHING IN THIS TEST TRIED.\n` +
      `     Read every line of it before running it again.\n` +
      cage.violations.map((v) => `\n     ${v}`).join('') + '\n',
    ).toEqual([]);

    expect(
      wire.length,
      `02.18 is read-only and must put NO write on the wire.${dump(wire)}`,
    ).toBe(0);

    const after = await readOrg(page);
    expect(
      after,
      `\n\n  ⚠⚠ THE ORGANISATION CHANGED DURING A READ-ONLY TEST.\n` +
      `     before: ${JSON.stringify(before)}\n` +
      `     after : ${JSON.stringify(after)}\n` +
      `     (logo_url is excluded from this comparison — org_profile.py re-signs\n` +
      `      the R2 key on every GET, so it differs between two identical reads.)\n`,
    ).toEqual(before);

    // Read, then assert. `${membersBefore}/${membersBefore}` in the log below
    // would have printed "intact" from one variable regardless of what the
    // second read said — a log line that cannot report the failure it exists to
    // report. The measured value is what is asserted AND what is printed.
    const membersAfter = await memberCount(page);
    expect(
      membersAfter,
      'every member of this organisation must still hold their seat',
    ).toBe(membersBefore);

    console.log(
      `\n[02.18] ${serverName} (${LANE.orgId}) — danger zone opened and left.` +
      `\n        destructive controls on the tab: 0. writes on the wire: ${wire.length}.` +
      `\n        requests the cage had to abort: ${cage.violations.length}.` +
      `\n        non-GETs allowed through (login/telemetry): ${cage.allowedWrites.length}.` +
      `\n        members before/after: ${membersBefore}/${membersAfter}. Organisation intact.\n`,
    );
  });
});
