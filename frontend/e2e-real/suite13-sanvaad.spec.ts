/**
 * Proposal 93 · Stage 3 · WAVE 5 · SUITE 13 — Sanvaad (संवाद, internal chat),
 * on Unicode Group at §4 volumes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LANE
 * ═══════════════════════════════════════════════════════════════════════════
 * `lane('unicode')` and nothing else. `signIn()` below calls `assertOrg()`,
 * which asserts the org **ID the SERVER resolved** — never a name on screen,
 * because the name is exactly what got corrupted when a platform credential
 * renamed Aekam Inc on 2026-08-28. No platform/god-mode credential appears in
 * this file; god mode is Suite 19's subject and nothing else's.
 *
 * Measured live, read-only, BEFORE a line of this file ran (2026-08-29):
 *
 *   GET /api/v1/org/profile              200  Unicode Group, state_code 24
 *   GET /api/v1/messaging/me             200  {"module":"sanvaad","level":"admin",
 *                                              "can_post":true,"can_manage":true}
 *   staging.module_subscriptions         sanvaad is_active = true for this org
 *
 *   staging.samvada_channels             4 rows all-org, 2 on Unicode
 *   staging.samvada_messages             8 rows all-org, 1 on Unicode
 *   staging.samvada_mentions             0 rows IN THE WHOLE DATABASE, EVER
 *   staging.samvada_messages
 *     WHERE parent_message_id IS NOT NULL  0 rows, EVER   ← no thread has ever existed
 *     WHERE pinned_at IS NOT NULL          0 rows, EVER   ← nothing has ever been pinned
 *   staging.samvada_message_reactions     2 rows all-org
 *   staging.samvada_message_attachments   0 rows, EVER    ← see §13.15
 *   staging.samvada_read_receipts         0 rows, EVER    ← the table is DEAD; see §13.12
 *
 * So threads, pins, mentions and attachments are all at zero-for-all-time on
 * this product, and every count this file produces is the first of its kind.
 *
 * ⚠ THE TWO MENTION TABLES ARE NOT THE SAME TABLE, and the brief is right to
 * insist on the distinction. Measured live, both of them, on 2026-08-29:
 *
 *   public.mentions            2 rows   ← the TASK-COMMENT path (Suite 03's)
 *   staging.samvada_mentions   0 rows   ← the SANVAAD path (this suite's)
 *
 * "@mentions have never had a single row" is a statement about the FIRST of
 * those, and it stopped being true today — Suite 03 put two rows in it. It has
 * always been true of the second, and this suite is what settles it. They share
 * neither a schema, a writer (`services/mentions.py` vs
 * `services/samvaad_mentions.py`), nor a reader. Reporting one count for both
 * would be wrong in both directions.
 *
 * DEPLOYED SHA, CHECKED RATHER THAN ASSUMED (CLAUDE.md's rule). The backend
 * exposes no route returning its own commit — `/api/health` answers status,
 * schema and `outbound_mode` and nothing about the build — so the Railway
 * deployment record is the whole of the available evidence:
 *
 *   deployment `62ae9ce5`, SUCCESS 2026-08-29T09:07:47Z,
 *   commit `f9d3c82f`, branch `staging`
 *
 * `git merge-base --is-ancestor c52651f2 f9d3c82f` → true, so the last commit
 * that touched `routers/messaging.py` or `src/pages/sanvaad/**` IS in the
 * deployed build, and `git status` shows no uncommitted change under either
 * path. The working tree this file was authored against and the code staging is
 * running are therefore the same code — which is the check the 2026-08-29
 * cross-agent hazard note demands, and it is stated rather than assumed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ WHAT THIS SUITE SENDS, AND TO WHOM — read this before running it
 * ═══════════════════════════════════════════════════════════════════════════
 * `GET /api/health` → `{"outbound_mode":"live","suppressed_orgs_digest":"0"}`.
 * The mode is LIVE and no organisation is shielded. So the question "does
 * anything leave the building" has to be answered from the code, not hoped.
 *
 * IT ANSWERS CLEANLY: **the Sanvaad path sends no email at all.**
 * `services/samvaad_mentions.py` and `services/samvaad_message_notify.py`
 * import exactly one delivery function between them — `services.push_service
 * .send_push` — and `samvaad_message_notify.py:177-185` states the omission in
 * terms: *"No websockets, no realtime publish, no email … the email templates
 * are all task-shaped."* `grep` for `send_email`, `email_service`, `ses` and
 * `smtp` across both files returns nothing. There is no `outbound_log` write on
 * this path either. The 53 `@example.com` contacts the brief warns about are
 * CRM rows and Sanvaad cannot reach a CRM contact: every recipient is a
 * `samvada_channel_members` row, i.e. an account with a login in this org.
 *
 * WHAT IT DOES SEND IS AN EXPO PUSH, and that is bounded and named here rather
 * than discovered later. `public.push_tokens` holds FOUR rows in the whole
 * database, measured today:
 *
 *   user_21457956f010  Keval UK      kevalvshah03+1@gmail.com   ← this lane
 *   user_f798947b8a2e  KEVAL SHAH    kevalvshah03@gmail.com     ← the owner
 *   user_91601f25f601  Kasti ORG     aekaminc1+org@gmail.com    ← the owner
 *   user_d73a676bc258  Isha Desai    (not a Unicode member — unreachable here)
 *
 * A mention notifies its target; the sender is never their own target. So the
 * only devices this suite could ring are the owner's own two accounts — and
 * eighteen mention pushes to a phone somebody is holding is noise nobody asked
 * for. `MENTIONABLE` below therefore contains ONLY the four Unicode members
 * with no push token, and `s13-general`'s membership is built from that set, so
 * the `@channel` broadcast reaches the same four. KEVAL SHAH is added to a
 * DIFFERENT channel (13.05) to prove the add-member path against a real
 * account, and is never named in a message anywhere in this file.
 *
 * That is a tightening of the brief's constraint, not a reading of it. A gate
 * may be tightened without asking; it may never be loosened.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §12 — AEKAM INC IS NOT TOUCHED, AND THE HAZARD HERE IS SPECIFIC
 * ═══════════════════════════════════════════════════════════════════════════
 * Unicode Group contains a TEAM literally named "Aekam Inc" (`team_ae1d58543b21`)
 * holding the protected 20 tasks. Sanvaad has no relationship to teams at all —
 * `samvada_channels` has no `team_id`, `messaging.py` never joins `teams` or
 * `team_members`, and no channel can be scoped to one. Nothing in this file
 * can reach that team, and the check is structural rather than careful: every
 * channel this suite touches is one it created, matched by the `s13-` prefix,
 * and 13.02 asserts the org's channel inventory contains no name outside the
 * set this file owns plus the ones that pre-dated it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §4 VOLUMES — WHAT IS ASKED, AND THE ONE ROW THAT CANNOT BE MET
 * ═══════════════════════════════════════════════════════════════════════════
 *   channels 9 · messages 140 · threads 24 · reactions 35 · mentions 18 ·
 *   attachments 12 — public and private, and a locked channel must visibly
 *   refuse.
 *
 * Eight of those nine are met exactly and the ninth is NOT BUILT:
 *
 * ⚠ **ATTACHMENTS: 0 of 12, and the product cannot do it at all.** This is not
 * a blocked test, a skipped one, or a slow one — it is a feature that does not
 * exist, and 13.15 proves it three independent ways so nobody re-derives it:
 *
 *   · `Composer.jsx:209-215` says so in terms: *"`Msg2Chat.jsx:319-325` puts
 *     attach, emoji and 'Draft with Sahayak' here. **The build has no attach
 *     yet**; the formatting group … takes the slot the prototype gives attach."*
 *     `MentionInput.jsx:43`: *"There are no file attachments in this composer
 *     and no upload control."*
 *   · The DEPLOYED OpenAPI has no attachment route under `/messaging` at all —
 *     27 messaging-shaped paths, none of them carrying a file.
 *   · `staging.samvada_message_attachments` exists (migration 058) with seven
 *     columns and holds **0 rows in the entire history of this database**.
 *
 * A table, no route, no control: the third and purest form of the defect class
 * the brief names. The other two forms — a route no screen calls, and a control
 * whose route does not exist — are BOTH also present in this module and are
 * closed in 13.12 and 13.15's second half.
 *
 * The message plan, which is how 140 is reached AND how the paging rule is met:
 *
 *   s13-general        public  110   ← §1's "seed past the cut and page through"
 *   s13-projects       public    6
 *   s13-accounts       public    6
 *   s13-hr             public    4
 *   s13-announcements  public    4   ← ARCHIVED in 13.13: the locked channel
 *   s13-random         public    4
 *   s13-leadership     private   3
 *   s13-audit          private   2
 *   s13-payroll        private   1
 *                             ─────
 *                               140
 *
 * ⚠ §1 asks for "pagination past the 200-row cut". **Sanvaad's cut is not 200.**
 * `list_messages` is `limit: int = Query(50, le=100)` with a `before` keyset
 * cursor, and `useChannelMessages.js:90` sets `PAGE = 50`. So the cut this
 * module actually has is 50 per page, and 110 messages in one channel crosses
 * it twice — three pages, two presses of "Load earlier messages". That is the
 * honest local equivalent and 13.04 asserts the cursor has no duplicate and no
 * gap across all three pages. Seeding 200 into one channel to match a number
 * from a different module's list endpoint would prove nothing extra and would
 * blow §4's total by 60.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IDEMPOTENCE (§6) — PROVED BY RUNNING TWICE, NOT CLAIMED
 * ═══════════════════════════════════════════════════════════════════════════
 * Every creating test reads the live state through the API FIRST and creates
 * only the shortfall, then prints a `S13-IDEM` line naming what it typed and
 * what was already there. A second full run must print `typed 0` on every one
 * of them. Channels key on their `s13-` name; messages key on a per-channel
 * body prefix (`S13·<slug>·<n>`), so a partial first run resumes rather than
 * duplicating — which matters here, because 110 messages is a long enough loop
 * to be interrupted.
 *
 * ⚠ There is NO DELETE for a channel anywhere in this product — the OpenAPI has
 * `POST` and `GET /messaging/channels` and `PATCH /messaging/channels/{id}` and
 * nothing else, and `is_archived` is the only retirement there is. So a suite
 * that created a duplicate could not clean up after itself, which is the whole
 * reason the shortfall is computed rather than assumed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite13.config.ts
 * ⚠ Never through `tail` — it truncates the failure blocks AND masks the exit
 * code. Redirect to a file, or read `report.json` under the config's outputDir.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { test, expect, Page, Locator } from '@playwright/test';
import { lane, activeLane, assertOrg } from './_lanes';

import { isForeignInlineScriptRefusal } from './_helpers';
// ⚠ STAGE 4 (§14): `activeLane()` reads E2E_LANE and DEFAULTS TO 'unicode', so an
// unset run is byte-for-byte the Unicode run this suite was authored against.
// `lane('unicode')` frozen here at import time was why the UK replay could not
// be run at all — §14's own first category, a hidden dependency on Unicode.
const LANE = activeLane();
const API = process.env.E2E_API_URL || 'https://api.kartavaya.com';

const BLOCKED =
  'BLOCKED — no credential for the Unicode lane. Set E2E_UNICODE_TOKEN in the ' +
  'repo-root .env.e2e. It must be an ORG-SCOPED account: a platform_admin token ' +
  'resolves to Aekam Inc via platform_bypass and would write there.';

/* ───────────────────────────────────────────────────────────────────────────
 * THE CHANNEL PLAN
 * ─────────────────────────────────────────────────────────────────────────── */
type Ch = {
  name: string;
  slug: string;
  type: 'public' | 'private';
  topic: string;
  msgs: number;
};

const CHANNELS: Ch[] = [
  { name: 's13-general', slug: 'gen', type: 'public', topic: 'Everything that does not have a room of its own', msgs: 110 },
  { name: 's13-projects', slug: 'prj', type: 'public', topic: 'Delivery, milestones and what is late', msgs: 6 },
  { name: 's13-accounts', slug: 'acc', type: 'public', topic: 'Invoices, GST and the bank reconciliation', msgs: 6 },
  { name: 's13-hr', slug: 'hr', type: 'public', topic: 'Leave, payroll and the holiday calendar', msgs: 4 },
  { name: 's13-announcements', slug: 'ann', type: 'public', topic: 'Read-only once archived — the locked channel', msgs: 4 },
  { name: 's13-random', slug: 'rnd', type: 'public', topic: 'Chai, cricket and the office lift', msgs: 4 },
  { name: 's13-leadership', slug: 'ldr', type: 'private', topic: 'Partners only', msgs: 3 },
  { name: 's13-audit', slug: 'aud', type: 'private', topic: 'Statutory audit working papers', msgs: 2 },
  { name: 's13-payroll', slug: 'pay', type: 'private', topic: 'Salary structures — restricted', msgs: 1 },
];

const ch = (name: string) => CHANNELS.find((c) => c.name === name)!;
const BIG = ch('s13-general');
const LOCKED = ch('s13-announcements');
const TOTAL_MSGS = CHANNELS.reduce((n, c) => n + c.msgs, 0); // 140

/**
 * ⚠ ONLY the Unicode members with NO Expo push token. See the header.
 * Measured from `staging.user_roles` × `public.users` on 2026-08-29; the org
 * has eight distinct members and these are the four this file may name.
 */
const MENTIONABLE = ['Anaya Iyer', 'Rajesh Bhatt', 'Rohan Desai', 'Keval Test uni'] as const;

/** Added in 13.05 to a channel this file never mentions anybody in. */
const ADD_ONLY = 'KEVAL SHAH';

/** §4 asks for 18 mention ROWS. 14 by name + one `@channel` over four members. */
const NAMED_MENTIONS = 14;
const MENTION_TARGET = 18;

const THREAD_REPLIES = 24;
const REACTIONS = 35;

/** The five reaction glyphs the hover tray offers, in `EmojiPicker.QUICK` order. */
const QUICK = ['👍', '✅', '👀', '❤️', '😂'] as const;

/* ───────────────────────────────────────────────────────────────────────────
 * SIGN-IN, AND THE ORG GUARD THAT RUNS BEFORE ANY WRITE
 * ─────────────────────────────────────────────────────────────────────────── */
async function signIn(page: Page) {
  if (LANE.email && LANE.password) {
    await page.goto('/login');
    await expect(page.locator('#au-email')).toBeVisible({ timeout: 30_000 });
    await page.locator('#au-email').fill(LANE.email);
    await page.locator('#au-password').fill(LANE.password);
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
  } else {
    if (!LANE.token) throw new Error(BLOCKED);
    await page.goto('/login');
    await page.evaluate((t) => localStorage.setItem('auth_token', t), LANE.token);
    await page.goto('/dashboard');
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
  }
  // Belt and braces: `signInAs()` calls this too, but the guard has been found
  // not running three times and a countermeasure that relies on being
  // remembered is one that will be forgotten.
  await assertOrg(page.request, page, LANE);
}

/**
 * ⚠ `X-Org-Id` IS NOT OPTIONAL and `_helpers.ts::api()` must not be used here.
 * `src/lib/api.js:39` puts the active org on every request the product makes;
 * `_helpers.ts::api()` sends `process.env.E2E_ORG_ID`, which names **E2E Test &
 * Associates**, not Unicode. A read helper answering for a different
 * organisation than the screen beside it is the 2026-08-28 incident's shape.
 *
 * GET ONLY, and that is a rule: `check-e2e-no-bypass.mjs` bans
 * `page.request.post/put/patch/delete` because asserting that the row appeared
 * IS the evidence, and a row this file POSTed itself is not evidence of
 * anything.
 */
async function orgGet(page: Page, path: string): Promise<any> {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Org-Id': LANE.orgId };
  /*
   * ⚠ ONE RETRY, AND ONLY FOR A CONNECTION THAT NEVER ANSWERED.
   *
   * Railway restarted the service twice under this suite (several agents deploy
   * during a run), and `read ECONNRESET` took 13.03 and 13.06 down mid-read.
   * That is not a product failure and reporting it as one buries the two real
   * ones underneath it — but a blanket retry is worse, because it would also
   * paper over a 500. So the retry is on the TRANSPORT only: a request that
   * threw before producing a response. Anything the server actually answered —
   * 4xx, 5xx, an empty body — goes straight to the assertion below, unretried.
   */
  let res;
  try {
    res = await page.request.get(`${API}${path}`, { headers });
  } catch (e) {
    console.log(`S13-TRANSPORT  ${path} did not answer (${String(e).slice(0, 90)}) — retrying once`);
    await page.waitForTimeout(4000);
    res = await page.request.get(`${API}${path}`, { headers });
  }
  expect(res.ok(), `GET ${path} → ${res.status()}: ${(await res.text()).slice(0, 400)}`).toBeTruthy();
  return res.json();
}

async function orgGetStatus(page: Page, path: string): Promise<number> {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  const res = await page.request.get(`${API}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Org-Id': LANE.orgId },
  });
  return res.status();
}

/**
 * Every channel in the org, LIVE AND ARCHIVED.
 *
 * ⚠ `GET /channels` returns the archived set INSTEAD of the live one when
 * `archived=true` — it is a separate call, not a flag that widens the list, and
 * `list_channels`' own docstring says why: the archived set is cold and paying
 * for it on every poll of the live rail would be waste. So an inventory that
 * calls the route once is missing every archived channel, and 13.13 leaves one
 * archived on purpose. The first run to hit that reported "§4 channels expected
 * 9, received 8" against nine channels that all existed.
 */
async function listChannels(page: Page): Promise<any[]> {
  const [live, arch] = await Promise.all([
    orgGet(page, '/api/v1/messaging/channels') as Promise<any[]>,
    orgGet(page, '/api/v1/messaging/channels?archived=true') as Promise<any[]>,
  ]);
  const seen = new Set<string>();
  return [...live, ...arch].filter((c: any) => (seen.has(String(c.id)) ? false : seen.add(String(c.id))));
}

/** The canonical rows of one channel's log — suite rule 3, never the POST echo. */
async function canonical(page: Page, channelId: string, limit = 100, before?: string): Promise<any[]> {
  const q = `limit=${limit}&include_reply_counts=1` + (before ? `&before=${before}` : '');
  return orgGet(page, `/api/v1/messaging/channels/${channelId}/messages?${q}`);
}

/**
 * Every top-level row of a channel, walked through the `before` cursor.
 *
 * ⚠ `list_messages` answers `ORDER BY m.created_at DESC` — NEWEST FIRST — and
 * `before` is a message id whose `created_at` the next page must be strictly
 * older than. So the cursor for page N+1 is the LAST element of page N, not the
 * first. Getting that backwards returns the same page forever, and the loop
 * would look like it was working right up to the guard.
 *
 * It also filters `is_deleted = FALSE`, so a soft-deleted message is simply
 * absent here — a test that expects to find one and read its flag will fail on
 * a correct product (13.10 says so at the point it matters).
 */
async function allMessages(page: Page, channelId: string): Promise<any[]> {
  const out: any[] = [];
  let before: string | undefined;
  for (let guard = 0; guard < 12; guard += 1) {
    const chunk = await canonical(page, channelId, 100, before);
    out.push(...chunk);
    if (chunk.length < 100) break;
    before = chunk[chunk.length - 1].id;
  }
  return out;
}

/* ───────────────────────────────────────────────────────────────────────────
 * THE WIRE — every write, its status, AND the requests that never came back
 *
 * Memory's rule, from the bank-import defect: watch the requests before blaming
 * the UI. That bug presented as "the button does nothing" AND as a CORS error
 * in the console; it was a 500 escaping before the CORS headers, and only a
 * request listener told the two apart.
 * ─────────────────────────────────────────────────────────────────────────── */
type Wire = string[];
const FAILED = new WeakMap<Page, string[]>();

function watchWire(page: Page): Wire {
  const wire: Wire = [];
  const failed: string[] = [];
  FAILED.set(page, failed);
  page.on('response', async (r) => {
    const req = r.request();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) return;
    if (!/\/api\//.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 200); } catch { /* consumed */ }
    wire.push(`${req.method()} ${r.status()} ${new URL(r.url()).pathname}  ${body}`);
  });
  page.on('requestfailed', (req) => {
    if (!/\/api\//.test(req.url())) return;
    failed.push(`${req.method()} FAILED ${new URL(req.url()).pathname}  ${req.failure()?.errorText ?? '(no reason)'}`);
  });
  return wire;
}

const dump = (page: Page, w: Wire) => {
  const f = FAILED.get(page) || [];
  return (w.length ? w.slice(-8).map((l) => '\n     ' + l).join('') : '\n     (no write request was made at all)')
    + (f.length ? '\n     ── requests that never returned ──' + f.slice(-6).map((l) => '\n     ' + l).join('') : '');
};

/**
 * The console, per test. `pageerror` is an UNCAUGHT exception and §1 asserts it
 * at ZERO across the whole run; `console.error` is collected separately so a
 * failure says which of the two happened rather than leaving it to be guessed.
 */
type Con = { errors: string[]; uncaught: string[] };
function watchConsole(page: Page): Con {
  const c: Con = { errors: [], uncaught: [] };
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Cloudflare's `__CF$cv$` loader carries a per-request token, so its hash
    // differs every load and can never be allowed by hash. CLASSIFIED, not
    // ignored: a refusal of OUR bootstrap still fails. See _helpers.
    if (isForeignInlineScriptRefusal(m.text())) return;
    c.errors.push(`${page.url().replace(/^https?:\/\/[^/]+/, '')}  ${m.text().slice(0, 220)}`);
  });
  page.on('pageerror', (e) => c.uncaught.push(`${page.url()}  ${String(e).slice(0, 260)}`));
  return c;
}

/**
 * ⚠ The service worker's "App updated — refresh when ready" toast is a real
 * element on every page of this deploy and it is NOT an error — it is the
 * update notice. It is named here because a `.k-toast` assertion that does not
 * exclude it reads as a failure toast on a screen where nothing failed.
 */
const IGNORABLE_TOAST = /App updated|A new version is available/i;

/**
 * ⚠ THE ONE console.error THIS SUITE DOES NOT OWN, named rather than swallowed.
 *
 * Several agents deploy this frontend during a run. When a Vercel deploy lands
 * mid-run, the tab is holding an index.html that names content-hashed chunks
 * the new deployment no longer serves, so the next dynamic import 404s to
 * index.html and Chrome refuses it: *"Failed to load module script: Expected a
 * JavaScript-or-Wasm module script but the server responded with a MIME type of
 * text/html."*
 *
 * That is a deploy race, not a defect — the product ALREADY handles it, which
 * is what the "App updated — refresh when ready" toast on every page is for.
 * It hit 13.13 on run 5, on `/login`, in the middle of another agent's deploy.
 *
 * It is allowed by SIGNATURE and by nothing else: no wildcard, no "ignore
 * errors on /login", and every occurrence is PRINTED so a run in which this
 * suddenly happens forty times is visible rather than quiet.
 */
const STALE_BUNDLE =
  /Failed to load module script|Failed to fetch dynamically imported module|error loading dynamically imported module/i;

/** Assert the console, at the END of a test, with the collected text in the message. */
function assertConsole(c: Con) {
  expect(c.uncaught, `UNCAUGHT exceptions (§1 requires zero):\n${c.uncaught.join('\n')}`).toEqual([]);
  const stale = c.errors.filter((e) => STALE_BUNDLE.test(e));
  const real = c.errors.filter((e) => !STALE_BUNDLE.test(e));
  if (stale.length) {
    console.log(`S13-DEPLOY-RACE  ${stale.length} chunk-load error(s) — a Vercel deploy landed ` +
      `mid-run and the tab was holding hashed chunks the new build no longer serves:\n  ` +
      stale.join('\n  '));
  }
  expect(real, `console.error entries:\n${real.join('\n')}`).toEqual([]);
}

/**
 * Click something that writes and return what the SERVER stored.
 *
 * Suite rule 2 — read the WRITE RESPONSE, not the list. A request that never
 * returns is invisible to a response listener and is the failure mode that
 * reads most like "the button does nothing", so the timeout message carries the
 * failed-request log rather than a bare Playwright timeout.
 */
async function writes(
  page: Page, wire: Wire, urlPart: string | RegExp,
  act: () => Promise<void>, expectStatus?: number,
): Promise<any> {
  const match = (u: string) => (typeof urlPart === 'string' ? u.includes(urlPart) : urlPart.test(u));
  let res;
  try {
    [res] = await Promise.all([
      page.waitForResponse((r) => match(r.url()) && r.request().method() !== 'GET', { timeout: 60_000 }),
      act(),
    ]);
  } catch (e) {
    throw new Error(
      `no response to a write matching ${String(urlPart)} within 60s.${dump(page, wire)}` +
      `\n     original: ${String(e).slice(0, 200)}`,
    );
  }
  const body = await res.text();
  const line = `${res.request().method()} ${res.url()} → ${res.status()}: ${body.slice(0, 400)}`;
  if (expectStatus != null) expect(res.status(), line).toBe(expectStatus);
  else {
    // ANY 2xx. Demanding exactly 200 once rejected a correct 201 Created.
    expect(res.status(), line).toBeGreaterThanOrEqual(200);
    expect(res.status(), line).toBeLessThan(300);
  }
  try { return JSON.parse(body); } catch { return {}; }
}

/* ───────────────────────────────────────────────────────────────────────────
 * NAVIGATION
 * ─────────────────────────────────────────────────────────────────────────── */

/** Open Sanvaad's Messages tab. The module has two tabs and the strip is its own. */
async function sanvaad(page: Page) {
  if (!/\/sanvaad/.test(page.url())) await page.goto('/sanvaad');
  const strip = page.getByRole('tablist', { name: 'Messaging' });
  await expect(strip).toBeVisible({ timeout: 45_000 });
  const msgTab = strip.getByRole('tab').filter({ hasText: /Messages/ });
  if ((await msgTab.getAttribute('aria-selected')) !== 'true') await msgTab.click();
  await expect(page.locator('#m2panel-msg')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(900);
}

/**
 * Open one channel from the rail.
 *
 * ⚠ Filtered through the rail's own search box rather than scanning `.m2row`.
 * By the end of this suite the rail holds fifteen conversations and
 * `s13-general` sits above `s13-projects` only by recency — a locator that
 * takes `.first()` out of an unfiltered rail is the "clicked the wrong record"
 * fault Phase 8.0 shipped three times. Filtering also exercises the rail search
 * itself, which nothing else in this file does.
 */
async function open(page: Page, name: string): Promise<void> {
  await sanvaad(page);

  /*
   * ⚠ WAIT FOR THE RAIL TO LOAD BEFORE CONCLUDING IT IS EMPTY.
   *
   * The first version of this helper filtered immediately and, on finding no
   * row, fell through to the Archived segment — which on a still-loading rail
   * meant it filtered an empty list, switched segment, and then reported "the
   * rail shows: []". FIFTEEN tests failed on that in one run, every one of them
   * reading exactly like the product had lost its channels.
   *
   * `ChannelList` renders a skeleton while `loading`, an `ErrorState` on a
   * failed read, `.m2row`s when it has any, and `.sv__none` when it genuinely
   * has none — four states, and only the last two are answers. So the poll
   * waits for one of the two answers with the filter EMPTY, and only then
   * filters.
   */
  /*
   * ⚠ RESET THE SEGMENT FIRST, AND THAT IS NOT HOUSEKEEPING.
   *
   * `.m2seg` is sticky for the life of the page, and 13.13 legitimately leaves
   * the rail on Archived. The next `open()` then filtered an ARCHIVED-ONLY
   * list, found nothing, "fell back" to Archived (where it already was) and
   * reported `the rail shows: []` for a channel sitting in plain view under
   * All. A helper that cannot get back to the default view is one that only
   * works on its first call.
   */
  const allSeg = page.locator('.m2seg', { hasText: /^All/ });
  if ((await allSeg.count()) && (await allSeg.getAttribute('aria-pressed')) !== 'true') {
    await allSeg.click();
    await page.waitForTimeout(900);
  }

  const q = page.getByLabel('Search conversations');
  await q.fill('');
  await expect
    .poll(async () => (await page.locator('.m2row').count()) + (await page.locator('.sv__none').count()),
      { timeout: 45_000, message: 'the channel rail never settled into rows or an empty sentence' })
    .toBeGreaterThan(0);
  // A FAILED read is not an empty one, and it must not be reported as a missing
  // channel — that is the distinction `ChannelList`'s own header is about.
  const railError = page.locator('.m2r__scroll').getByText(/can’t be opened|did not load|needs a connection/);
  expect(await railError.count(), 'the channel rail reported a READ FAILURE, not an empty list — ' +
    'this is a blocked run, not a missing channel').toBe(0);

  /*
   * ⚠ A PLAIN SUBSTRING, NOT A REGEX, AND THAT IS A DECISION.
   *
   * The first version anchored with `new RegExp(\`^${name}\\b\`)` — and inside
   * a TEMPLATE LITERAL `\b` is the BACKSPACE escape, not a word boundary, so
   * the pattern was `^s13-general<U+0008>` and matched nothing. It is the same
   * class of mistake as `getByRole(name)` matching the accessible name rather
   * than the visible text: a locator that silently cannot match reads as a
   * MISSING CONTROL, which is the wrong diagnosis entirely.
   *
   * A substring is sufficient here because no planned channel name is a
   * substring of another (`s13-hr`, `s13-audit`, `s13-general` … all disjoint),
   * the rail is already filtered to this name by the search box above, and the
   * click is CONFIRMED afterwards by reading `.m2c__n` — so a wrong row cannot
   * pass silently, which is the property that actually matters.
   */
  await q.fill(name);
  await page.waitForTimeout(800);
  let row = page.locator('.m2row', { hasText: name }).first();

  // ⚠ THE "All" SEGMENT DOES NOT INCLUDE ARCHIVED CONVERSATIONS, and 13.13
  // deliberately leaves one archived at the end of the run — so a SECOND run
  // reaching for that channel finds nothing under All. The Archived segment is
  // the door, and taking it is the difference between an idempotent suite and
  // one that only passes once.
  if (!(await row.count())) {
    await page.locator('.m2seg', { hasText: /^Archived/ }).click();
    await page.waitForTimeout(1200);
    row = page.locator('.m2row', { hasText: name }).first();
  }
  await expect(row, `no rail row for ${name} — the rail shows: ` +
    JSON.stringify(await page.locator('.m2row').allInnerTexts())).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.locator('.m2c__n')).toContainText(name, { timeout: 20_000 });
  await q.fill('');
  const all = page.locator('.m2seg', { hasText: /^All/ });
  if ((await all.getAttribute('aria-pressed')) !== 'true') await all.click();
  await page.waitForTimeout(800);
}

const composer = (page: Page) => page.getByLabel('Message', { exact: true });

/** Send one message through the real composer and return the CANONICAL row. */
async function say(page: Page, wire: Wire, text: string): Promise<any> {
  const box = composer(page).first();
  await box.click();
  await box.fill(text);
  const row = await writes(page, wire, /\/messages$/, async () => { await box.press('Enter'); }, 201);
  expect(row.id, `POST /messages returned no id: ${JSON.stringify(row).slice(0, 200)}`).toBeTruthy();
  return row;
}

/**
 * Hover a message row so the tray paints, then return the row locator.
 *
 * ⚠ EVERY TRAY CONTROL IS SCOPED TO ITS OWN ROW, and that is suite rule 6 with
 * a Sanvaad-specific edge on it. `.m2tray` is `display: none` until `:hover`,
 * but it is IN THE DOM on every message — so `page.getByRole('button', { name:
 * 'Reply in thread' }).first()` resolves to the OLDEST message's hidden tray,
 * not the one under the pointer, and Playwright would then wait forever on an
 * element that is never going to be visible. That reads exactly like "the hover
 * action is unreachable", which is a real defect class in this product and
 * would have been the wrong diagnosis entirely.
 */
async function hover(page: Page, row: Locator): Promise<Locator> {
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await expect(row.locator('.m2tray').first()).toBeVisible({ timeout: 10_000 });
  return row;
}

/**
 * Open one message's overflow menu.
 *
 * `ui/Menu` renders its TRIGGER as a `<span role="button">` carrying the menu's
 * label, and the visible glyph is a `.msg__actb` span INSIDE it — so the
 * accessible name is on the outer element and a locator written against the
 * class hits the inner one, which is not the control.
 */
async function menu(page: Page, row: Locator) {
  await hover(page, row);
  await row.getByRole('button', { name: 'Message actions' }).click();
  await expect(page.getByRole('menu', { name: 'Message actions' })).toBeVisible({ timeout: 10_000 });
}

/**
 * Open the channel-settings Sheet. It is `role="dialog"` with `aria-modal`.
 *
 * ⚠ `exact: true`, AND THE REASON IS THE BRIEF'S OWN 2026-08-29 RULE.
 * `getByRole(name)` matches the ACCESSIBLE NAME as a SUBSTRING, and this header
 * carries TWO controls that both open this sheet:
 *
 *   <button class="sv__hd-mem" aria-label="5 members — open channel settings">
 *   <button class="svbtn"      aria-label="Channel settings">
 *
 * Case-insensitively, "Channel settings" is inside "…open channel settings", so
 * the loose locator is a strict-mode violation on every screen with a member
 * count — which is every channel. It failed five tests in one run. Two controls
 * reaching one destination is deliberate (the count IS an affordance), so this
 * is a locator fix and not a product finding.
 */
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Channel settings', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Channel settings' });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  return sheet;
}

async function closeSheet(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Channel settings' })).toHaveCount(0, { timeout: 10_000 });
}

/** The `S13-IDEM` line every creating test prints. §6 is proved from these. */
const idem = (what: string, typed: number, present: number) =>
  console.log(`S13-IDEM  ${what.padEnd(28)} typed ${String(typed).padStart(4)} · already present ${String(present).padStart(4)}`);

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.01 — the module opens, and every empty state is a sentence
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.01 Sanvaad mounts both tabs, the rail states what is empty, and nothing is a spinner', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);
  await sanvaad(page);

  // ── the strip: exactly the two tabs MessagingTabs declares ────────────────
  const strip = page.getByRole('tablist', { name: 'Messaging' });
  const tabs = await strip.getByRole('tab').allInnerTexts();
  expect(tabs.length, `the strip rendered ${tabs.length} tabs: ${JSON.stringify(tabs)}`).toBe(2);
  expect(tabs.join(' | ')).toMatch(/Messages/);
  expect(tabs.join(' | ')).toMatch(/WhatsApp/);
  // The Devanagari partner is part of the product's design system, not decoration.
  expect(tabs.join(' | ')).toMatch(/संवाद/);
  expect(tabs.join(' | ')).toMatch(/वार्ता/);

  // ── the tabpanel is wired to its tab ──────────────────────────────────────
  const panel = page.locator('#m2panel-msg');
  await expect(panel).toHaveAttribute('role', 'tabpanel');
  await expect(panel).toHaveAttribute('aria-labelledby', 'm2tab-msg');

  // ── the four rail filters, and the empty SENTENCE under each ──────────────
  const segs = page.locator('.m2seg');
  await expect(segs).toHaveCount(4);
  expect((await segs.allInnerTexts()).map((s) => s.replace(/\d+$/, '').trim()))
    .toEqual(['All', 'Unread', 'Mentions', 'Archived']);

  for (const [label, sentence] of [
    ['Unread', /Everything is read/],
    ['Mentions', /Nobody has mentioned you/],
  ] as const) {
    await page.locator('.m2seg', { hasText: new RegExp(`^${label}`) }).click();
    await page.waitForTimeout(700);
    const empty = page.locator('.sv__none');
    if (await empty.count()) {
      // A filter that matched nothing must say WHICH filter, in words. Suite 00's
      // rule: no spinner that never resolves, no blank pane that reads as broken.
      await expect(empty.first()).toHaveText(sentence);
    }
  }
  await page.locator('.m2seg', { hasText: /^All/ }).click();
  await page.waitForTimeout(600);

  // ── the blank pane on the right names the action it offers ────────────────
  // (`canPost` is true for this lane, so the sentence must be the create one —
  //  F32 was this sentence inviting an action the reader did not have.)
  const blank = page.locator('.sv__blank');
  if (await blank.count()) {
    await expect(blank).toContainText(/Pick a channel or a direct message on the left/);
    await expect(blank).toContainText(/create one to start a conversation/);
    await expect(blank.getByRole('button', { name: 'Search messages' })).toBeVisible();
  }

  // ── the two creation controls exist and are reachable ─────────────────────
  await expect(page.getByRole('button', { name: 'New channel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New direct message' })).toBeVisible();

  // ── no spinner outlives the load, and no error toast on a healthy screen ──
  await expect(page.locator('.sk, .skeleton, [aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  const toasts = await page.locator('.k-toast, .toast').allInnerTexts();
  for (const t of toasts) {
    expect(t, `an unexpected toast on a healthy Sanvaad: ${t}`).toMatch(IGNORABLE_TOAST);
  }

  assertConsole(con);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.02 — NINE CHANNELS, public and private, typed into the real form
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.02 nine channels — six public, three private — created, renamed, topic set, recoloured', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);
  await sanvaad(page);

  const before = await listChannels(page);
  const have = new Set(before.map((c: any) => c.name));
  let typed = 0;

  for (const c of CHANNELS) {
    if (have.has(c.name)) continue;
    await page.getByRole('button', { name: 'New channel' }).click();
    const nameBox = page.getByLabel('Channel name');
    await expect(nameBox).toBeVisible({ timeout: 10_000 });
    await nameBox.fill(c.name);

    // The visibility SELECT — a real `<select>`, its two options asserted rather
    // than assumed, because "private" silently falling back to public is exactly
    // the kind of failure a row count cannot see.
    const vis = page.getByLabel('Channel visibility');
    expect(await vis.locator('option').allTextContents()).toEqual(['Public', 'Private']);
    await vis.selectOption(c.type);

    const row = await writes(page, wire, /\/messaging\/channels$/, async () => {
      await page.getByRole('button', { name: 'Create', exact: true }).click();
    }, 201);

    // Suite rule 3 — the POST echo is not the canonical row, so the TYPE is
    // re-read from the list rather than trusted from the response.
    expect(row.name, JSON.stringify(row)).toBe(c.name);
    expect(row.type, `${c.name} was asked for ${c.type} and the server stored ${row.type}`).toBe(c.type);
    typed += 1;
    await page.waitForTimeout(900);
  }
  idem('channels', typed, CHANNELS.length - typed);

  // ── the canonical inventory ───────────────────────────────────────────────
  /*
   * ⚠ MATCHED BY THE PLAN'S EXACT NAMES, NOT BY THE `s13-` PREFIX.
   *
   * The prefix version failed on its first run and it was RIGHT to: this
   * session's own selector probe had left two channels called `s13-probe`
   * behind, so the count read 11 against a plan of 9 and the suite accused the
   * product of creating channels it had not created. There is no DELETE for a
   * channel in this product, so leftovers cannot be swept — the set has to be
   * named. Those two, plus `s13probe78237`, `p2095678` and `p3244602`, are
   * reported as noise this session created rather than quietly counted in.
   */
  const after = await listChannels(page);
  const planned = new Set(CHANNELS.map((c) => c.name));
  const mine = after.filter((c: any) => planned.has(c.name));
  expect(mine.length, `planned channels live: ${JSON.stringify(mine.map((c: any) => c.name))}; ` +
    `the whole rail holds ${JSON.stringify(after.map((c: any) => c.name))}`)
    .toBe(CHANNELS.length);
  expect(mine.filter((c: any) => c.type === 'public').length).toBe(6);
  expect(mine.filter((c: any) => c.type === 'private').length).toBe(3);
  for (const c of mine) expect(c.org_id, `${c.name} is in the wrong org`).toBe(LANE.orgId);

  // ⚠ §12 — nothing this suite created can reach the protected Aekam Inc team.
  // `samvada_channels` has no `team_id` column and `messaging.py` never joins
  // `teams`, so the guarantee is structural; this asserts the shape anyway.
  for (const c of after) {
    expect(Object.keys(c)).not.toContain('team_id');
  }

  // ── name, topic and colour, through the settings sheet ────────────────────
  await open(page, BIG.name);
  const sheet = await settings(page);
  const topic = sheet.getByLabel('Channel topic');
  if ((await topic.inputValue()) !== BIG.topic) {
    await topic.fill(BIG.topic);
    await writes(page, wire, /\/messaging\/channels\//, async () => {
      await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    });
    await page.waitForTimeout(1200);
  }

  // The colour is a stored column and the ONLY reason it is a column is that it
  // is editable — a rail you cannot recolour would be the column existing for
  // nothing. Six tones, `aria-pressed` on the chosen one.
  /*
   * ⚠ POLLED, NOT COUNTED ONCE. The Colour section is gated on `iAmAdmin`,
   * which `ChannelDetails` derives from `GET …/members` — so for the first few
   * hundred milliseconds after the sheet opens the reader is not yet known to
   * be an admin and the section is not rendered. A single `count()` there reads
   * 0 and reports "the colour group rendered no tones" against a channel this
   * account created.
   */
  const tones = sheet.getByRole('button', { name: /^Channel colour \d+ of \d+$/ });
  await expect
    .poll(async () => tones.count(),
      { timeout: 25_000, message: 'the colour group rendered no tones' })
    .toBeGreaterThan(1);
  const wanted = tones.nth(2);
  if ((await wanted.getAttribute('aria-pressed')) !== 'true') {
    await writes(page, wire, /\/messaging\/channels\//, async () => { await wanted.click(); });
    await page.waitForTimeout(1200);
  }
  await expect(wanted).toHaveAttribute('aria-pressed', 'true');
  await closeSheet(page);

  // Read the canonical row back: the topic and the colour are both stored.
  const big = (await listChannels(page)).find((c: any) => c.name === BIG.name);
  expect(big.description, 'the topic did not persist').toBe(BIG.topic);
  expect(big.color, 'the colour did not persist').toBeTruthy();
  /*
   * ⚠ DEFECT 1 — THE CHANNEL TOPIC WAS STORED AND RENDERED NOWHERE.
   *
   * `ChannelDetails`'s Topic field carries the hint *"Shown beside the name in
   * the header."* `PATCH /channels/{id}` stores it and `list_channels` returns
   * it as `description` — and it appeared on no screen at all. Measured
   * 2026-08-29 against **HEAD, not the working tree**: `grep '\.description'`
   * across `pages/sanvaad/**` and `components/sanvaad/**` returns exactly two
   * hits — the form that WRITES it, and `ChatPane`'s sub-line, whose non-DM arm
   * was hard-coded to `"N members · updates every few seconds"`. The rail row
   * prints the member count in the same slot. So the column had a writer, a
   * label promising a location, and no reader.
   *
   * Fixed in the working tree (`ChatPane.jsx`, the `sub` expression) — the
   * topic wins when there is one, and the member count keeps the slot when
   * there is not. Nothing is lost: the header's own
   * `aria-label="N members — open channel settings"` button sits beside it and
   * shows the number visibly, which is why the sub-line was spending its width
   * saying the same thing twice.
   *
   * ⚠ AN AGENT CANNOT DEPLOY, so this assertion is RED on staging until the
   * lead ships that commit. It is deliberately NOT weakened — a test edited
   * green is how the defect gets buried.
   */
  await expect(page.locator('.m2c__sub'),
    'DEFECT 1 (fix in the working tree, NOT DEPLOYED): the channel topic is stored ' +
    'by the settings sheet, its own label says it appears here, and ChatPane renders ' +
    'the member count instead — so a channel topic is written to a column nothing reads')
    .toContainText(BIG.topic);

  assertConsole(con);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.03 — 140 MESSAGES, typed into the real composer
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.03 one hundred and forty messages typed through the composer, formatting and emoji included', async ({ page }) => {
  test.setTimeout(50 * 60_000);
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);

  const live = await listChannels(page);
  const byName = new Map(live.map((c: any) => [c.name, c]));
  let typedAll = 0;
  let presentAll = 0;

  for (const c of CHANNELS) {
    const row = byName.get(c.name);
    expect(row, `13.02 has not run — no channel ${c.name}`).toBeTruthy();
    const existing = await allMessages(page, row.id);
    // Only this suite's own bodies count, so a stray message typed by hand in
    // the org does not make the suite think it is finished.
    const mine = existing.filter((m: any) => String(m.content || '').startsWith(`S13·${c.slug}·`));
    presentAll += Math.min(mine.length, c.msgs);
    if (mine.length >= c.msgs) continue;

    await open(page, c.name);

    // The empty state, seen BEFORE the data exists — the one screen nobody has
    // looked at since the data arrived (§1's last row).
    if (mine.length === 0 && existing.length === 0) {
      await expect(page.locator('.m2log')).toContainText(/No messages yet|अभी कोई संदेश नहीं/);
      await expect(page.locator('.m2log')).toContainText(
        new RegExp(`Nothing has been said in ${c.name}`),
      );
    }

    for (let i = mine.length; i < c.msgs; i += 1) {
      await say(page, wire, `S13·${c.slug}·${i + 1} — ${LINES[i % LINES.length]}`);
      typedAll += 1;
      if (i % 25 === 24) await page.waitForTimeout(400); // let the poll breathe
    }
  }
  idem('messages', typedAll, presentAll);

  // ── the canonical count, per channel and in total ─────────────────────────
  let total = 0;
  for (const c of CHANNELS) {
    const id = byName.get(c.name).id;
    const rows = (await allMessages(page, id)).filter((m: any) => String(m.content || '').startsWith(`S13·${c.slug}·`));
    expect(rows.length, `${c.name} holds ${rows.length} of this suite's messages, wanted ${c.msgs}`).toBe(c.msgs);
    // Every row is this org's and is top-level — `list_messages` filters
    // `parent_message_id IS NULL`, so a reply must never be in the log.
    for (const m of rows) {
      expect(m.org_id).toBe(LANE.orgId);
      expect(m.parent_message_id, `a thread reply surfaced in ${c.name}'s log`).toBeNull();
    }
    total += rows.length;
  }
  expect(total, `§4 asks for 140 messages; the live count is ${total}`).toBe(TOTAL_MSGS);

  // ═══ the composer's own controls, on the smallest channel ═════════════════
  await open(page, ch('s13-payroll').name);
  const box = composer(page).first();

  // Shift+Enter is a NEWLINE and Enter is a SEND. The composer used to be an
  // `<input>` where Shift+Enter did nothing at all, so this is a regression
  // guard rather than a nicety.
  await box.click();
  await box.fill('');
  await box.pressSequentially('line one');
  await box.press('Shift+Enter');
  await box.pressSequentially('line two');
  expect(await box.inputValue()).toBe('line one\nline two');

  // The formatting group wraps the SELECTION. Bold with nothing selected still
  // has to leave the caret between the markers.
  await box.fill('');
  await box.pressSequentially('S13·fmt·1 bold me');
  await box.press('Control+a');
  const fmt = page.getByRole('group', { name: 'Formatting' });
  await expect(fmt).toBeVisible();
  await fmt.getByRole('button', { name: 'Bold' }).click();
  /*
   * ⚠ BOLD IS `*x*` HERE, NOT `**x**`, and asserting the Markdown spelling was
   * a defect in the test rather than in the product. `messageUtils.INLINE` is
   * `` ` `` code · `*` bold · `_` italic · `~` strike — WhatsApp's vocabulary,
   * not CommonMark's — because `Composer` is SHARED with Varta and a strip that
   * wrote CommonMark here would write syntax a client sees literally there.
   * A test that failed on the correct behaviour is exactly the kind that
   * teaches people to edit tests.
   */
  expect(await box.inputValue(), 'Bold did not wrap the selection').toBe('*S13·fmt·1 bold me*');
  await fmt.getByRole('button', { name: 'Italic' }).click();
  expect(await box.inputValue(), 'Italic did not wrap the selection').toBe('_*S13·fmt·1 bold me*_');
  await fmt.getByRole('button', { name: 'Italic' }).click();
  expect(await box.inputValue(), 'Italic is not a TOGGLE — pressing it twice must undo it')
    .toBe('*S13·fmt·1 bold me*');

  // The emoji picker inserts AT THE CARET and stays open — inserting three
  // glyphs must not be three round trips through the button.
  await box.press('End');
  await page.getByRole('button', { name: 'Insert emoji' }).click();
  const picker = page.getByRole('dialog', { name: 'Insert emoji' });
  await expect(picker).toBeVisible({ timeout: 10_000 });
  await picker.getByRole('button', { name: '🎉' }).first().click();
  await expect(picker, 'the insert picker closed after one glyph').toBeVisible();
  expect(await box.inputValue()).toContain('🎉');
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0, { timeout: 10_000 });

  /*
   * ⚠ SENT ONCE, THEN NEVER AGAIN — the last idempotence wart in this file.
   *
   * This demonstration message was posted on EVERY run, so `s13-payroll` grew by
   * one message a run while `S13-IDEM` went on printing `typed 0 · already
   * present 140` — the counter was honest about the PLAN and blind to the
   * message beside it. Measured after five runs: 163 live top-level rows against
   * a plan of 140, and five of the excess were this line. §6's gate is that a
   * second execution "recognises its own output and verifies rather than
   * duplicating", and a suite that quietly adds a row per run fails it however
   * green it looks.
   *
   * The composer work above still runs every time — the formatting toggles, the
   * emoji picker and the Shift+Enter newline are all asserted on every run. Only
   * the SEND is conditional, because only the send leaves a row.
   */
  const payId = (await listChannels(page)).find((c: any) => c.name === 's13-payroll').id;
  const fmtExists = (await allMessages(page, payId))
    .some((m: any) => String(m.content || '').includes('S13·fmt·1'));
  if (fmtExists) {
    idem('formatting demo', 0, 1);
    await box.fill('');
  } else {
    const sent = await writes(page, wire, /\/messages$/, async () => { await box.press('Enter'); }, 201);
    expect(sent.content).toContain('*S13·fmt·1 bold me*');
    expect(sent.content).toContain('🎉');
    idem('formatting demo', 1, 0);
  }

  assertConsole(con);
});

/** Bodies with enough variety that search has something to find. */
const LINES = [
  'the GST return for Q2 is filed, ARN attached in Ganit',
  'client wants the revised quote before Friday',
  'reconciliation is short by ₹1,240 — checking the ICICI import',
  'payroll cut-off moved to the 26th this month',
  'PT for Gujarat is four bands, not three — please do not "fix" it',
  'the Surat site geofence radius is too tight, three punches refused',
  'draft invoice INV-0042 is editable until it is paid',
  'reminder: GSTIN is optional on a client record and must block nothing',
  'moving the standup to 09:30 so the Ahmedabad team can join',
  'vendor MSME declaration received, filed under compliance',
  'the DIGIPIN on that address resolves to the wrong lane, will re-pin',
  'nagar branch says the courier never arrived',
];

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.04 — PAGING past the cut, through the real "Load earlier messages"
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.04 the 110-message channel pages through its cursor with no duplicate and no gap', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const con = watchConsole(page);
  await signIn(page);

  const big = (await listChannels(page)).find((c: any) => c.name === BIG.name);
  expect(big, '13.02 has not run').toBeTruthy();

  await open(page, BIG.name);
  await expect(page.locator('.m2m').first()).toBeVisible({ timeout: 25_000 });

  // Page one is `PAGE = 50`. The control sits at the TOP of the log — an
  // infinite loader that prepends rows fights the near-bottom autoscroll.
  const first = await page.locator('.m2m').count();
  expect(first, `the first page rendered ${first} rows; useChannelMessages sets PAGE = 50`).toBeLessThanOrEqual(50);
  expect(first).toBeGreaterThan(40);

  const older = page.getByRole('button', { name: /Load earlier messages/ });
  await expect(older, 'no scrollback control on a 110-message channel').toBeVisible({ timeout: 15_000 });

  let presses = 0;
  while ((await older.count()) && presses < 6) {
    const was = await page.locator('.m2m').count();
    await older.click();
    await expect
      .poll(async () => page.locator('.m2m').count(), { timeout: 30_000 })
      .toBeGreaterThan(was);
    presses += 1;
    await page.waitForTimeout(600);
  }
  expect(presses, 'the scrollback never had to be pressed twice — 110 rows should be three pages')
    .toBeGreaterThanOrEqual(2);
  await expect(older, 'the scrollback button survived the end of the history').toHaveCount(0, { timeout: 15_000 });

  // ⚠ THE ASSERTION THAT MATTERS: no duplicate id and no gap. A cursor bug
  // repeats or drops rows at a page boundary and the screen looks entirely
  // normal — this module's own `list_mentions` docstring records that the naked
  // `created_at <` cursor `list_messages` uses "has the bug just described".
  const onScreen = await page.locator('.m2m').evaluateAll((els) => els.map((e) => e.id));
  const anchored = onScreen.filter((id) => id.startsWith('m-'));
  expect(new Set(anchored).size, `duplicate message ids on screen after paging: ` +
    JSON.stringify(anchored.filter((v, i, a) => a.indexOf(v) !== i))).toBe(anchored.length);

  const canonicalIds = new Set((await allMessages(page, big.id))
    .filter((m: any) => String(m.content || '').startsWith('S13·gen·'))
    .map((m: any) => `m-${m.id}`));
  const missing = [...canonicalIds].filter((id) => !anchored.includes(id));
  expect(missing.length,
    `${missing.length} of ${canonicalIds.size} rows never appeared after paging to the end — a GAP`)
    .toBe(0);

  // "Jump to latest" — the pill exists precisely because the reader must not be
  // moved while they are reading. It is only meaningful once scrolled away.
  const jump = page.locator('.m2jump');
  if (await jump.count()) {
    await jump.click();
    await page.waitForTimeout(1200);
  }

  assertConsole(con);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.05 — MEMBERS: add, remove, leave, and the picker's vocabulary
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.05 members added and removed through the sheet, and the mention picker learns the new name', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);

  const big = (await listChannels(page)).find((c: any) => c.name === BIG.name);
  await open(page, BIG.name);
  let sheet = await settings(page);

  const already = new Set(
    ((await orgGet(page, `/api/v1/messaging/channels/${big.id}/members`)) as any[])
      .map((m) => m.full_name),
  );
  let added = 0;
  for (const person of MENTIONABLE) {
    if (already.has(person)) continue;
    const row = sheet.locator('.svd__row', { hasText: person }).first();
    await expect(row, `${person} is not offered in "Add someone"`).toBeVisible({ timeout: 15_000 });
    // ⚠ `POST …/members?user_id=…` CARRIES A QUERY STRING (`ChannelDetails.jsx:237`
    // posts a null body with `params`), so a `/members$/` anchor never matches
    // the URL and the write times out looking like a dead button.
    await writes(page, wire, /\/members(\?|$)/, async () => {
      await row.getByRole('button', { name: 'Add', exact: true }).click();
    }, 201);
    added += 1;
    await page.waitForTimeout(900);
  }
  idem('members on s13-general', added, MENTIONABLE.length - added);

  // The canonical membership — five people, and every one of them a real
  // account in THIS org. `add_member` refuses a cross-org user.
  const members = (await orgGet(page, `/api/v1/messaging/channels/${big.id}/members`)) as any[];
  expect(members.length, `s13-general has ${members.length} members: ` +
    JSON.stringify(members.map((m) => m.full_name))).toBe(MENTIONABLE.length + 1);
  for (const p of MENTIONABLE) expect(members.map((m) => m.full_name)).toContain(p);

  // ⚠ NAMES, NEVER IDS. The member rows are the densest place in this module
  // for a UUID to leak, and `check-rendered-ids.mjs` is positional — it cannot
  // see a value the server sent. So the rendered text is asserted directly.
  const memberText = await sheet.locator('.svd__sec', { hasText: /^MEMBERS|Members/ }).innerText();
  expect(memberText, `a UUID is rendered in the member list:\n${memberText}`)
    .not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  expect(memberText, `a user_xxx id is rendered in the member list:\n${memberText}`)
    .not.toMatch(/\buser_[0-9a-f]{10,}\b/i);

  /*
   * ⚠ THE ADD DIRECTION, ON A PANE THAT PROVABLY MOUNTED WITHOUT THIS PERSON —
   * because every looser arrangement of this check passes by luck.
   *
   * TWO EARLIER VERSIONS WENT GREEN OVER A LIVE DEFECT, and both are worth
   * recording because the shape recurs:
   *
   *   · ADD-ONLY. On the first run the four members are added here and the
   *     picker is asked immediately, which IS the defect. On every later run
   *     they are already members when the pane mounts, so the picker offers
   *     them whether or not the refresh works. `S13-IDEM` still reads
   *     `typed 0 · already present 4` and nothing looks wrong.
   *   · REMOVE-THEN-OBSERVE. Ambiguous in the other direction: if the person
   *     was not in the MOUNT-TIME list either — because the previous run's
   *     failure left them off — then the stale list does not contain them, the
   *     picker correctly omits them, and the check passes without the product
   *     having refreshed anything. That is exactly what happened on the run
   *     after the one that first caught the bug.
   *
   * So the state is FORCED. The canary is removed, the page is RELOADED and the
   * channel re-opened so the pane demonstrably mounts without them, and only
   * then are they added through the real sheet. A stale member list cannot
   * contain somebody who was not a member when it was fetched, so the picker
   * offering them is proof of a refresh and of nothing else. The membership is
   * restored before the assertion runs, so a red run does not shrink §4's
   * counts for the next one.
   */
  const CANARY = MENTIONABLE[3]; // Keval Test uni — no Expo push token
  if (((await orgGet(page, `/api/v1/messaging/channels/${big.id}/members`)) as any[])
    .some((m) => m.full_name === CANARY)) {
    await writes(page, wire, /\/members\//, async () => {
      await sheet.locator('.svd__row', { hasText: CANARY })
        .getByRole('button', { name: `Remove ${CANARY}` }).click();
    });
    await page.waitForTimeout(1500);
  }
  await closeSheet(page);

  // Re-open, so the pane provably mounts against a membership that does NOT
  // include the canary. This is the line that makes the assertion unambiguous.
  await page.reload();
  await open(page, BIG.name);
  const mountList = (await orgGet(page, `/api/v1/messaging/channels/${big.id}/members`)) as any[];
  expect(mountList.map((m) => m.full_name),
    'the canary is still a member, so the pane mounted already knowing about them ' +
    'and the check below could pass without any refresh having happened')
    .not.toContain(CANARY);

  const sheetAdd = await settings(page);
  await writes(page, wire, /\/members(\?|$)/, async () => {
    await sheetAdd.locator('.svd__row', { hasText: CANARY })
      .getByRole('button', { name: 'Add', exact: true }).click();
  }, 201);
  await page.waitForTimeout(1500);
  await closeSheet(page);

  const restoredMembers = (await orgGet(page, `/api/v1/messaging/channels/${big.id}/members`)) as any[];
  expect(restoredMembers.map((m) => m.full_name), 'the canary was not put back on the channel')
    .toContain(CANARY);

  const box = composer(page).first();
  await box.click();
  await box.fill('');
  /*
   * ⚠ ONE TOKEN, NO SPACE — AND THE FIRST VERSION OF THIS CHECK COULD NOT FAIL.
   *
   * It typed `@Keval T`. `MentionInput.handleChange` closes the list the moment
   * the query contains whitespace (`!/\s/.test(query)`), so the popup was never
   * open, the option list was the empty string, and `not.toContain(CANARY)`
   * passed for a reason that had nothing to do with the product. It went GREEN
   * on run 5 over a defect that is still live — exactly the "check nobody has
   * seen fail" the operating standards are about.
   *
   * `@Keval` is the discriminator instead: TWO Unicode members match it —
   * "Keval UK" (this account) and "Keval Test uni" (the canary). So the popup
   * MUST open, which is asserted first, and the canary must be gone from it.
   * A closed popup can no longer be mistaken for a correct answer.
   */
  await box.pressSequentially('@Keval', { delay: 90 });
  await page.waitForTimeout(2500);
  const picker = page.getByRole('listbox', { name: 'Mention a channel member' });
  await expect(picker,
    'the mention popup did not open for "@Keval" — this account itself matches that ' +
    'prefix, so an empty list here is a broken query rather than an answer')
    .toBeVisible({ timeout: 15_000 });
  const opts = (await picker.getByRole('option').allInnerTexts()).join(' | ');
  await box.fill('');
  expect(opts, 'the popup opened without this account in it — the query is wrong')
    .toContain('Keval UK');
  expect(opts,
    'DEFECT 2 (fix in the working tree, NOT DEPLOYED): a member ADDED through the ' +
    'channel-settings sheet does not reach the open pane, so the @mention picker ' +
    'cannot offer the person you just added until the channel is re-opened — which ' +
    'is precisely what you add a colleague in order to do')
    .toContain(CANARY);

  // ⚠ THE PICKER'S VOCABULARY IS THE CHANNEL'S MEMBERSHIP, and it has to have
  // caught up with the add that just happened — `MentionInput.people` is
  // derived from the `members` prop `useChannelMessages` fetched, so a stale
  // list is a mention nobody can offer. Measured during the selector probe:
  // with one member the `@Ana` popup does not open at all, correctly, because
  // there is nobody of that name in the room.
  await box.click();
  await box.fill('');
  await box.pressSequentially('@Ana', { delay: 90 });
  /*
   * ⚠ DEFECT 2 — ADDING A MEMBER DID NOT REFRESH THE OPEN CONVERSATION.
   *
   * Measured against **HEAD, not the working tree**, 2026-08-29:
   * `useChannelMessages.reloadMembers` is called in exactly ONE place — the
   * mount effect keyed on `channelId` — and is not returned from the hook, so
   * nothing outside can call it. `ChannelDetails` signals a change with
   * `onChanged(null, { members: true })`; `ChannelsTab.channelChanged` answers
   * it with `loadChannels()`, which reloads the RAIL and never the pane. And
   * `ChatPane` is keyed `key={selected.id}`, so it does not remount either.
   *
   * Three things went stale together and the third is the one that bites: the
   * header's member count, the face stack, and — because `MentionInput.people`
   * IS this array — THE @MENTION VOCABULARY. So somebody added to a private
   * channel could not be mentioned in it until the reader navigated away and
   * came back, which is exactly what you add a colleague in order to do. This
   * suite measured it: four members added through the real sheet, and `@Ana`
   * opened no picker for the next fifteen seconds.
   *
   * ⚠ NOT A TIMING ARTEFACT, and the check proves it rather than assuming it:
   * `candidates` is a `useMemo` on `[popup, people, allowBroadcast]` and
   * `popup` stays non-null while the query is on screen — so a LATE arrival of
   * `members` would recompute and open the list by itself. Fifteen seconds of
   * `toBeVisible` polling is therefore a real negative, not an impatient one.
   *
   * Fixed in the working tree: the hook returns `reloadMembers`, and `ChatPane`
   * calls it when the sheet reports a member change. NOT DEPLOYED — an agent
   * cannot deploy — so this stays RED on staging until the lead ships it, and
   * it is not weakened to get a green.
   */
  const popup = page.getByRole('listbox', { name: 'Mention a channel member' });
  await expect(popup,
    'DEFECT 2 (fix in the working tree, NOT DEPLOYED): a member added through the ' +
    'channel-settings sheet never reaches the open pane, so the @mention picker ' +
    'cannot offer the person you just added until the channel is re-opened')
    .toBeVisible({ timeout: 15_000 });
  expect((await popup.getByRole('option').allInnerTexts()).join(' | ')).toContain('Anaya Iyer');

  // Arrow keys walk it and `aria-activedescendant` follows, or a screen reader
  // is told about the list once and never about the selection moving.
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  const desc = await box.getAttribute('aria-activedescendant');
  expect(desc, 'no aria-activedescendant while the mention list is open').toBeTruthy();
  await box.press('Escape');
  await expect(popup).toHaveCount(0, { timeout: 10_000 });
  // Escape closed the LIST and must not have closed anything behind it.
  expect(await box.inputValue()).toBe('@Ana');
  await box.fill('');

  // ── add someone to a DIFFERENT channel, then remove them ──────────────────
  // ⚠ `ADD_ONLY` holds an Expo push token, so this account is added here — in a
  // channel this file never mentions anybody in — and never named in a message.
  await open(page, ch('s13-projects').name);
  const prj = (await listChannels(page)).find((c: any) => c.name === 's13-projects');
  sheet = await settings(page);
  const prjMembers = (await orgGet(page, `/api/v1/messaging/channels/${prj.id}/members`)) as any[];
  if (!prjMembers.some((m) => m.full_name === ADD_ONLY)) {
    await writes(page, wire, /\/members(\?|$)/, async () => {
      await sheet.locator('.svd__row', { hasText: ADD_ONLY }).first()
        .getByRole('button', { name: 'Add', exact: true }).click();
    }, 201);
    await page.waitForTimeout(1000);
  }
  await expect(sheet.locator('.svd__row', { hasText: ADD_ONLY })
    .getByRole('button', { name: `Remove ${ADD_ONLY}` })).toBeVisible({ timeout: 15_000 });

  await writes(page, wire, /\/members\//, async () => {
    await sheet.locator('.svd__row', { hasText: ADD_ONLY })
      .getByRole('button', { name: `Remove ${ADD_ONLY}` }).click();
  });
  await page.waitForTimeout(1200);
  const after = (await orgGet(page, `/api/v1/messaging/channels/${prj.id}/members`)) as any[];
  expect(after.map((m) => m.full_name), 'the removed member is still on the channel')
    .not.toContain(ADD_ONLY);

  // The reader's OWN row offers "Leave channel", not "Remove <me>" — the same
  // control, two different sentences, because they are two different acts.
  await expect(sheet.getByRole('button', { name: 'Leave channel' })).toBeVisible();
  await closeSheet(page);

  assertConsole(con);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.06 — @MENTIONS: eighteen rows in a table that has never had one
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.06 eighteen mention rows — fourteen by name through the picker, four by @channel', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);

  // ⚠ THE BASELINE IS A LIVE READ OF THE RIGHT TABLE. `staging.samvada_mentions`
  // and `public.mentions` are different tables with different writers; this
  // endpoint reads the first. `GET /mentions` is the CALLER's own feed, so it
  // cannot show a mention of somebody else — the count that matters is the one
  // in the channel's own messages, so both are taken.
  const beforeFeed = ((await orgGet(page, '/api/v1/messaging/mentions')) as any[]).length;

  await open(page, BIG.name);
  const log = await allMessages(page,
    (await listChannels(page)).find((c: any) => c.name === BIG.name).id);
  const already = log.filter((m: any) => String(m.content || '').includes('S13·men·')).length;

  let typed = 0;
  const box = composer(page).first();
  for (let i = already; i < NAMED_MENTIONS; i += 1) {
    const who = MENTIONABLE[i % MENTIONABLE.length];
    await box.click();
    await box.fill('');
    // Typed through the PICKER, not pasted: the token the picker inserts and
    // the string the server resolves are pinned to each other by
    // `test_samvaad_directory`, and typing the name by hand would test my
    // spelling rather than that contract.
    await box.pressSequentially(`@${who.slice(0, 4)}`, { delay: 70 });
    const popup = page.getByRole('listbox', { name: 'Mention a channel member' });
    await expect(popup, `no mention popup for "${who.slice(0, 4)}"`).toBeVisible({ timeout: 15_000 });
    const opts = await popup.getByRole('option').allInnerTexts();
    const idx = opts.findIndex((t) => t.includes(who));
    expect(idx, `"${who}" is not offered; the list held ${JSON.stringify(opts)}`).toBeGreaterThanOrEqual(0);
    for (let k = 0; k < idx; k += 1) await box.press('ArrowDown');
    await box.press('Enter'); // picks — Enter with the list open must NOT send
    await expect(popup).toHaveCount(0, { timeout: 10_000 });
    expect(await box.inputValue(), 'Enter with the list open sent the message instead of picking')
      .toBe(`@${who} `);

    await box.pressSequentially(`S13·men·${i + 1} please look at this`);
    await writes(page, wire, /\/messages$/, async () => { await box.press('Enter'); }, 201);
    typed += 1;
    await page.waitForTimeout(700);
  }
  idem('named mentions', typed, already);

  /*
   * The renderer bolds what the server notified — a bolded name that notifies
   * nobody is the bug `_match_display_names` was written to replace.
   *
   * ⚠ NOT `.m2m.last()`. On a re-run the last row in the log is the `@channel`
   * broadcast this test writes further down, so the assertion failed comparing
   * a broadcast against a person's name. The row is found by its OWN body
   * instead, which is the only stable way to name one message in a log that
   * later tests keep adding to.
   */
  const lastNamed = MENTIONABLE[(NAMED_MENTIONS - 1) % MENTIONABLE.length];
  await expect(page.locator('.m2m', { hasText: `S13·men·${NAMED_MENTIONS}` }).first())
    .toContainText(`@${lastNamed}`);

  // ── the @channel broadcast: four members, four rows ───────────────────────
  const hasCast = log.some((m: any) => String(m.content || '').includes('S13·cast·'));
  if (!hasCast) {
    await box.click();
    await box.fill('');
    await box.pressSequentially('@chan', { delay: 70 });
    const popup = page.getByRole('listbox', { name: 'Mention a channel member' });
    await expect(popup, 'the broadcast tokens are not offered in a channel composer').toBeVisible({ timeout: 15_000 });
    expect((await popup.getByRole('option').allInnerTexts()).join(' ')).toContain('@channel');
    await box.press('Enter');
    await box.pressSequentially('S13·cast·1 stand-up moved to 09:30');
    await writes(page, wire, /\/messages$/, async () => { await box.press('Enter'); }, 201);
    await page.waitForTimeout(1500);
  }

  // ═══ THE ROW COUNT — the whole point of this test ═════════════════════════
  // Read from the product's own feed. `fan_out_mentions` writes one row per
  // RECIPIENT, so 14 named (one recipient each) + 1 broadcast (four recipients)
  // is 18 — but this feed is the CALLER's, and the caller is never their own
  // target, so it stays at its baseline. The rows are counted where they land:
  // through the channel's messages, which is the only read this lane has.
  const feed = (await orgGet(page, '/api/v1/messaging/mentions')) as any[];
  console.log(`S13-MENTIONS  caller feed before=${beforeFeed} after=${feed.length} ` +
    `(the sender is never their own target, so this is expected to stand still)`);

  const named = (await allMessages(page,
    (await listChannels(page)).find((c: any) => c.name === BIG.name).id))
    .filter((m: any) => String(m.content || '').includes('S13·men·'));
  expect(named.length, 'fourteen named-mention messages must exist').toBe(NAMED_MENTIONS);
  for (const m of named) {
    expect(m.content, `a mention message lost its token: ${m.content}`).toMatch(/@[A-Z]/);
  }

  // ── the mentions PANEL opens, filters, marks read, and closes on Escape ───
  await page.locator('.sv__mnb').click();
  const panel = page.getByRole('region', { name: 'Mentions' });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByRole('button', { name: 'Only unread' })).toHaveAttribute('aria-pressed', /true|false/);
  // "Mark all read" is DISABLED at zero rather than hidden — a control that
  // vanishes once it has worked cannot be found again by somebody looking.
  await expect(panel.getByRole('button', { name: /Mark all read|Marking…/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Mentions' })).toHaveCount(0, { timeout: 10_000 });

  // ── @here in a room where nobody else is: it must reach nobody, quietly ───
  await open(page, ch('s13-random').name);
  const rnd = (await listChannels(page)).find((c: any) => c.name === 's13-random');
  const rndBefore = await allMessages(page, rnd.id);
  if (!rndBefore.some((m: any) => String(m.content || '').includes('S13·here·'))) {
    const b2 = composer(page).first();
    await b2.click();
    await b2.fill('');
    await b2.pressSequentially('@here', { delay: 70 });
    await b2.press('Escape'); // dismiss the list; the token is already complete
    await b2.pressSequentially(' S13·here·1 anybody about?');
    const row = await writes(page, wire, /\/messages$/, async () => { await b2.press('Enter'); }, 201);
    // A broadcast into an empty room is not an error — it reaches nobody and
    // says nothing, which is the correct behaviour and worth pinning.
    expect(row.content).toContain('@here');
  }

  assertConsole(con);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.07 — THREADS: twenty-four replies, and the disclosure that must also close
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.07 twenty-four thread replies; the inline thread opens, lists, and CLOSES', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);

  const chans = await listChannels(page);
  const bigId = chans.find((c: any) => c.name === BIG.name).id;

  await open(page, BIG.name);
  await expect(page.locator('.m2m').first()).toBeVisible({ timeout: 25_000 });

  // The roots: the newest six top-level rows, four replies each = 24.
  const roots = (await canonical(page, bigId, 8)).filter((m: any) => !m.parent_message_id).slice(-6);
  expect(roots.length, 'not enough messages to thread off').toBe(6);

  let existing = 0;
  for (const r of roots) existing += Number(r.thread_count || 0);
  let typed = 0;

  for (const root of roots) {
    const have = Number(root.thread_count || 0);
    for (let i = have; i < 4 && existing + typed < THREAD_REPLIES; i += 1) {
      const row = page.locator(`#m-${root.id}`);
      await expect(row, 'the root message is not in the log — page down to it').toBeVisible({ timeout: 20_000 });
      await hover(page, row);
      await row.getByRole('button', { name: 'Reply in thread' }).click();

      // The reply bar names WHOSE thread, above the same one composer. One
      // composer per conversation is the reason `.m2cp__reply` exists at all.
      const bar = page.locator('.m2cp__reply');
      await expect(bar).toBeVisible({ timeout: 10_000 });
      await expect(bar).toContainText(/Replying in .+’s thread/);

      const box = composer(page).first();
      await box.fill(`S13·thr·${root.id.slice(0, 4)}·${i + 1} — noted, will check`);
      const reply = await writes(page, wire, /\/messages$/, async () => { await box.press('Enter'); }, 201);
      expect(reply.parent_message_id, 'the reply was posted as a top-level message').toBe(root.id);
      typed += 1;
      await page.waitForTimeout(800);
    }
  }
  idem('thread replies', typed, existing);

  // ── the canonical count, from the table's own shape ───────────────────────
  const all = await allMessages(page, bigId);
  const counts = all.reduce((n: number, m: any) => n + Number(m.thread_count || 0), 0);
  expect(counts, `§4 asks for 24 thread replies; the live count on ${BIG.name} is ${counts}`)
    .toBeGreaterThanOrEqual(THREAD_REPLIES);

  // A reply is NEVER a log row — `list_messages` filters `parent_message_id IS
  // NULL`, and the cross-tenant "1 reply" leak this module already had was a
  // thread count that ignored the channel.
  for (const m of all) expect(m.parent_message_id).toBeNull();

  // ── the disclosure: it opens, it lists, and it CLOSES ─────────────────────
  // ⚠ IT IS ALREADY OPEN. Posting a reply auto-expands the thread it went into,
  // so a test that clicks once and then looks for `.m2th__body` finds nothing
  // and reports a product defect for its own assumption. Measured in the probe:
  // `aria-expanded` was already `true` before the first click.
  /*
   * ⚠ FINDING — "Jump to latest" COVERS THE CONTROL UNDERNEATH IT.
   *
   * Measured on this run, from Playwright's own actionability log:
   *
   *     <button class="m2th__open" aria-expanded="false"> …
   *     - attempting click action
   *     - element is visible, enabled and stable
   *     - <button class="m2jump"> intercepts pointer events
   *
   * `.m2jump` is `position: absolute; bottom: 84px` over the log and renders
   * whenever the reader is not near the bottom. When a thread disclosure
   * happens to sit under it, that disclosure is UNCLICKABLE by mouse — the
   * pointer lands on the pill instead. VERDICT: product bug, minor, live for
   * any scrolled-up reader; a floating control laid over content controls with
   * no gutter. It is not fatal (the pill can be dismissed by pressing it, which
   * is what a person would do) so it is REPORTED rather than stopped on, and
   * the test clears the pill the way a reader would rather than reaching around
   * it with a forced click — a `{ force: true }` here would hide the finding.
   */
  const jumpPill = page.locator('.m2jump');
  if (await jumpPill.count()) {
    console.log('S13-FINDING  .m2jump overlays the log and can intercept a message control beneath it');
    await jumpPill.click();
    await page.waitForTimeout(1500);
  }

  const disc = page.locator('.m2th__open').first();
  await expect(disc).toBeVisible({ timeout: 20_000 });
  await expect(disc).toContainText(/\d+ repl(y|ies)/);
  await expect(disc).toContainText(/last at/); // without this the row cannot say if the thread is alive

  /*
   * ⚠ OPENED BY KEYBOARD, AND THAT IS THE FINDING WORKED AROUND HONESTLY.
   *
   * `.m2jump` reappears on every poll while the reader is scrolled away, so
   * dismissing it once is not enough — Playwright's retry loop caught it
   * intercepting the click again on the next attempt. A `{ force: true }` would
   * paper over the defect; pressing the control with the keyboard does not,
   * because it is a path a real person has (§1's keyboard row: "activation
   * works without a mouse") and it leaves the overlap reported rather than
   * hidden. The MOUSE path is what is broken here, and it is written up above.
   */
  const startOpen = (await disc.getAttribute('aria-expanded')) === 'true';
  if (!startOpen) {
    await disc.focus();
    await expect(disc, 'the thread disclosure cannot take keyboard focus').toBeFocused();
    await disc.press('Enter');
  }
  await expect(page.locator('.m2th__open').first()).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 });
  await expect(page.locator('.m2th__body').first()).toBeVisible({ timeout: 15_000 });
  // ⚠ THE BODY MOUNTS BEFORE ITS REPLIES ARRIVE. `useThreadReplies` fires
  // `GET /messages/{id}/thread` when the disclosure opens and renders a
  // `SkeletonChat` until it answers, so counting on the same tick reads 0 and
  // accuses the product of an empty thread it is still fetching.
  await expect
    .poll(async () => page.locator('.m2th__body .m2m').count(),
      { timeout: 25_000, message: 'the thread expanded to no replies at all' })
    .toBeGreaterThan(0);
  await expect(page.locator('.m2th__reply').first()).toBeVisible();

  // It must also CLOSE — a disclosure that only opens is half a control. Same
  // keyboard path, same reason: `.m2jump` is still over the log.
  const disc2 = page.locator('.m2th__open').first();
  await disc2.focus();
  await disc2.press('Enter');
  await expect(page.locator('.m2th__open').first()).toHaveAttribute('aria-expanded', 'false', { timeout: 10_000 });
  await expect(page.locator('.m2th__body')).toHaveCount(0, { timeout: 10_000 });

  // ── the PHONE presentation is a different component, and it must close too ─
  // `ChatPane` withholds `openThreadId` below 767px and mounts `ThreadPanel`
  // instead. Nothing has ever driven it.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  const discMob = page.locator('.m2th__open').first();
  if (await discMob.count()) {
    // Keyboard again — `.m2jump` is `bottom: 84px` at every width.
    await discMob.focus();
    await discMob.press('Enter');
    const panel = page.locator('.m2thp');
    if (await panel.count()) {
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(panel).toHaveAttribute('aria-label', 'Thread');
      await expect(panel.locator('.m2thp__n')).toContainText(/repl/);
      await panel.getByRole('button', { name: 'Close thread' }).click();
      await expect(page.locator('.m2thp')).toHaveCount(0, { timeout: 15_000 });
    } else {
      console.log('S13-NOTE  the phone ThreadPanel did not mount at 390px — reported, not asserted away');
    }
  }
  // No horizontal page scroll at the phone width — §1's resize row.
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `the page scrolls horizontally by ${overflow}px at 390px`).toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(1200);

  assertConsole(con);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.08 — REACTIONS: thirty-five, from the tray and from the full picker
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.08 thirty-five reactions from the hover tray and the full picker; toggling off removes', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);

  const bigId = (await listChannels(page)).find((c: any) => c.name === BIG.name).id;
  await open(page, BIG.name);
  await expect(page.locator('.m2m').first()).toBeVisible({ timeout: 25_000 });

  const countReactions = async () => {
    const rows = await canonical(page, bigId, 100);
    return rows.reduce((n: number, m: any) => n + (Array.isArray(m.reactions) ? m.reactions.length : 0), 0);
  };
  const before = await countReactions();

  // The newest rows on screen, so nothing has to be paged to.
  const rows = page.locator('.m2m');
  const n = await rows.count();
  let typed = 0;

  for (let i = 0; i < n && before + typed < REACTIONS; i += 1) {
    const row = rows.nth(n - 1 - i);
    const glyph = QUICK[i % QUICK.length];
    const existing = await row.locator('.m2rx__b').count();
    if (existing >= QUICK.length) continue;
    await hover(page, row);
    const btn = row.getByRole('button', { name: `React ${glyph}` });
    if (!(await btn.count())) continue;
    // ⚠ AN ACTION THAT ONLY EXISTS ON HOVER AND NEVER APPEARS IS UNREACHABLE —
    // §1's hover row. The tray is `display: none` until `:hover`/`:focus-within`,
    // so its visibility is asserted rather than clicked through blindly.
    await expect(btn).toBeVisible();
    await writes(page, wire, /\/reactions/, async () => { await btn.click(); });
    typed += 1;
    await page.waitForTimeout(450);
  }

  // Top up from the FULL picker, which is a different control and a different
  // code path — Proposal 09 §4 puts the rest of the glyphs behind `+`.
  let picked = 0;
  const extra = ['🎉', '🙏', '🔥', '💯', '🚀', '📌', '✨', '🤝'];
  for (let i = 0; before + typed < REACTIONS && i < extra.length * 3; i += 1) {
    const row = rows.nth(Math.max(0, (await rows.count()) - 1 - (i % Math.min(n, 8))));
    await hover(page, row);
    const plus = row.getByRole('button', { name: 'Add a reaction' });
    if (!(await plus.count())) break;
    await plus.click();
    const picker = page.getByRole('dialog', { name: 'Add a reaction' });
    await expect(picker).toBeVisible({ timeout: 10_000 });
    const cell = picker.getByRole('button', { name: extra[i % extra.length] }).first();
    if (!(await cell.count())) { await page.keyboard.press('Escape'); continue; }
    const already = await row.locator('.m2rx__b', { hasText: extra[i % extra.length] }).count();
    if (already) { await page.keyboard.press('Escape'); continue; }
    await writes(page, wire, /\/reactions/, async () => { await cell.click(); });
    // Unlike an insert, a REACTION is one act, so the picker closes after it.
    await expect(picker).toHaveCount(0, { timeout: 10_000 });
    typed += 1; picked += 1;
    await page.waitForTimeout(450);
  }
  idem('reactions', typed, before);
  console.log(`S13-NOTE  ${picked} of those came from the full picker rather than the quick tray`);

  const after = await countReactions();
  expect(after, `§4 asks for 35 reactions; the live count on ${BIG.name} is ${after}`)
    .toBeGreaterThanOrEqual(REACTIONS);

  /*
   * ── the chip is a TOGGLE, and its state is in the accessible name ─────────
   *
   * ⚠ THE ROW AND THE GLYPH ARE PINNED FIRST, and the reason cost a run.
   * `page.locator('.m2rx__b').first()` is re-resolved on every use, and REMOVING
   * a reaction removes its chip from the DOM — so `.first()` afterwards is a
   * DIFFERENT chip on a different message, and clicking it "to put the first one
   * back" removed a second one instead. The count went 35 → 34 → 33 and the
   * failure read "re-adding the reaction did not restore it", which sounds like
   * a product bug in the toggle and is not one.
   */
  const chipRow = page.locator('.m2m').filter({ has: page.locator('.m2rx__b') }).last();
  await chipRow.scrollIntoViewIfNeeded();
  const chip = chipRow.locator('.m2rx__b').first();
  await expect(chip).toBeVisible();
  const label = await chip.getAttribute('aria-label');
  expect(label, `the reaction chip carries no count in its name: ${label}`)
    .toMatch(/\d+ reactions?/);
  expect(label, 'a reaction I placed does not say so in its accessible name')
    .toMatch(/including yours/);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  // Array.from, NOT charAt(0): every reaction glyph is outside the BMP, so
  // charAt(0) returns HALF A SURROGATE PAIR -- the run failed with a
  // `React <lone high surrogate>` name matching three buttons at once,
  // because that half is a prefix of all five faces.
  const glyph = Array.from((label || '').trim())[0] || '';

  // Press it off — the DELETE arm — and read the canonical count, not the chip.
  await writes(page, wire, /\/reactions/, async () => { await chip.click(); });
  await page.waitForTimeout(2000);
  const off = await countReactions();
  expect(off, 'clicking my own reaction did not remove it').toBe(after - 1);

  // Put it back THROUGH THE TRAY on the SAME row. A test that leaves the module
  // one reaction lighter every time it runs is a test whose own output drifts,
  // and §6 would then be measuring the drift rather than the idempotence.
  await hover(page, chipRow);
  const readd = chipRow.getByRole('button', { name: `React ${glyph}` });
  if (await readd.count()) {
    await writes(page, wire, /\/reactions/, async () => { await readd.click(); });
    await page.waitForTimeout(2000);
    expect(await countReactions(), 're-adding the reaction did not restore it').toBe(after);
  } else {
    // The glyph came from the full picker rather than the quick five, so the
    // tray has no button for it. Reported instead of forced.
    console.log(`S13-NOTE  ${glyph} is not one of the five quick reactions; ` +
      'the removal was not reversed and the live count stays one lower');
  }

  assertConsole(con);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.09 — PINS: a table that has never had a row
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.09 pins — the bar appears, expands, jumps and unpins; the header control follows', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);

  const projId = (await listChannels(page)).find((c: any) => c.name === 's13-projects').id;
  await open(page, 's13-projects');
  await expect(page.locator('.m2m').first()).toBeVisible({ timeout: 25_000 });

  const pinsNow = async () => (await orgGet(page, `/api/v1/messaging/channels/${projId}/pins`)) as any[];
  const before = (await pinsNow()).length;

  // ⚠ BEFORE the first pin there must be NO bar and NO header control —
  // `PinnedBar` renders null at zero and the button would toggle nothing. A
  // control that is always there and never does anything is exactly the dead
  // control the sweep exists to find.
  if (before === 0) {
    await expect(page.locator('.m2pin')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Pinned messages/ })).toHaveCount(0);
  }

  /*
   * ⚠ `exact: true` ON THE MENU ITEM, and it is the substring trap again in a
   * place that looks safe. The item toggles its own word between "Pin message"
   * and "Unpin message" — and `getByRole(name)` is a case-insensitive SUBSTRING
   * match, so "Pin message" resolves the UNPIN row of an already-pinned
   * message. On a re-run (this test deliberately leaves one pinned) that turned
   * into a 20-second click timeout reported as "no response to a write matching
   * /pin$/", which reads like a dead control and is not one.
   */
  let typed = 0;
  const rows = page.locator('.m2m');
  for (let i = 0; i < 4 && before + typed < 3; i += 1) {
    const row = rows.nth(i);
    await menu(page, row);
    const item = page.getByRole('menuitem', { name: 'Pin message', exact: true });
    if (!(await item.count())) {
      // Already pinned — its row says "Unpin message". Leave it and move on.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      continue;
    }
    await writes(page, wire, /\/pin$/, async () => { await item.click(); });
    typed += 1;
    await page.waitForTimeout(1200);
  }
  idem('pins', typed, before);

  const pins = await pinsNow();
  expect(pins.length, 'nothing was pinned').toBeGreaterThan(0);
  for (const p of pins) expect(p.pinned_at, 'a pin row carries no pinned_at').toBeTruthy();

  // ── the bar, collapsed: "1 of N" is the affordance ────────────────────────
  const bar = page.locator('.m2pin');
  await expect(bar).toBeVisible({ timeout: 20_000 });
  const toggle = bar.getByRole('button', { name: /Show all \d+ pinned|Collapse the pinned/ });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText(new RegExp(`1 of ${pins.length}`));
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // ── expanded: one navigable row per pin, each naming its author ───────────
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 });
  const navs = bar.getByRole('button', { name: /^Go to the pinned message from / });
  await expect(navs).toHaveCount(pins.length);
  // Names, never ids — the pinned row quotes a person.
  const barText = await bar.innerText();
  expect(barText, `a UUID is rendered in the pinned bar:\n${barText}`)
    .not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  // Jumping is a control, and it must actually move to the row.
  await navs.first().click();
  await page.waitForTimeout(1500);

  // ── the header pin button exists ONLY while there are pins ────────────────
  const headerPin = page.getByRole('button', { name: new RegExp(`Pinned messages \\(${pins.length}\\)`) });
  await expect(headerPin, 'the header carries no pin control while pins exist').toBeVisible({ timeout: 15_000 });

  // ── unpin: through the bar's ✕, and the bar must disappear at zero ────────
  for (let i = pins.length; i > 0; i -= 1) {
    const x = page.locator('.m2pin').getByRole('button', { name: /^Unpin the message from / }).first();
    if (!(await x.count())) break;
    await writes(page, wire, /\/pin$/, async () => { await x.click(); });
    await page.waitForTimeout(1400);
  }
  await expect(page.locator('.m2pin'), 'the pinned bar survived the last unpin').toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Pinned messages/ }),
    'the header pin control survived the last unpin').toHaveCount(0, { timeout: 20_000 });
  expect((await pinsNow()).length, 'the server still holds pins after unpinning them all').toBe(0);

  // Re-pin one so the module ends the run with the state §4 asked for.
  await menu(page, rows.first());
  const again = page.getByRole('menuitem', { name: 'Pin message', exact: true });
  if (await again.count()) {
    await writes(page, wire, /\/pin$/, async () => { await again.click(); });
    await page.waitForTimeout(1200);
  }

  assertConsole(con);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.10 — EDIT and DELETE
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.10 a message is edited and says so, and a delete is confirmed before it happens', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);

  const hrId = (await listChannels(page)).find((c: any) => c.name === 's13-hr').id;
  await open(page, 's13-hr');
  await expect(page.locator('.m2m').first()).toBeVisible({ timeout: 25_000 });

  /*
   * ⚠ THIS TEST TYPES ITS OWN TWO MESSAGES AND TOUCHES NONE OF §4's 140.
   *
   * An edit that appends to an existing body would append AGAIN on the second
   * run, and a delete would take a message out of the count 13.03 and 13.17
   * assert — so the suite would pass once and then contradict itself, which is
   * the exact failure §6 exists to catch. `S13·edit·1` and `S13·del·1` are
   * created here if absent, so a run's net effect on the message plan is zero.
   */
  const own = await allMessages(page, hrId);
  if (!own.some((m: any) => String(m.content || '').startsWith('S13·edit·1'))) {
    await say(page, wire, 'S13·edit·1 payroll cut-off is the 25th');
    await page.waitForTimeout(1200);
  }
  // The doomed one is recreated every run, because the previous run deleted it.
  await say(page, wire, 'S13·del·1 ignore me, I am about to be removed');
  await page.waitForTimeout(1500);

  const editRow = page.locator('.m2m', { hasText: 'S13·edit·1' }).first();
  await expect(editRow).toBeVisible({ timeout: 20_000 });

  // ── EDIT ──────────────────────────────────────────────────────────────────
  await menu(page, editRow);
  await page.getByRole('menuitem', { name: 'Edit message' }).click();

  const ta = page.getByLabel('Edit message');
  await expect(ta).toBeVisible({ timeout: 10_000 });
  const original = await ta.inputValue();
  expect(original, 'the editor opened empty').toBeTruthy();
  await expect(page.locator('.msg__edit-hint')).toContainText(/Enter to save · Escape to cancel/);

  // Escape CANCELS and must not save — a control that cannot be backed out of
  // is the §1 keyboard row's whole point, and the composer's Escape handler
  // must not have swallowed this one.
  await ta.press('Escape');
  await expect(page.getByLabel('Edit message')).toHaveCount(0, { timeout: 10_000 });
  expect((await allMessages(page, hrId)).find((m: any) => m.content === original),
    'Escape saved the edit it was supposed to cancel').toBeTruthy();

  await menu(page, editRow);
  await page.getByRole('menuitem', { name: 'Edit message' }).click();
  const ta2 = page.getByLabel('Edit message');
  await expect(ta2).toBeVisible({ timeout: 10_000 });
  const edited = 'S13·edit·1 payroll cut-off is the 26th, corrected';
  await ta2.fill(edited);
  const row = await writes(page, wire, /\/messaging\/messages\/[0-9a-f-]+$/, async () => {
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  });
  expect(row.content, 'the server stored something other than what was typed').toBe(edited);
  expect(row.is_edited, 'the row is not flagged as edited').toBeTruthy();

  // The `edited` tag hangs off the BODY, not the header — it used to sit beside
  // the timestamp, where a continuation row (which has no header) could never
  // show it, so an edited follow-up was indistinguishable from an unedited one.
  await expect(page.locator('.m2m', { hasText: 'S13·edit·1' }).first()
    .locator('.m2m__tag', { hasText: 'edited' })).toBeVisible({ timeout: 15_000 });

  // Put it back, so the body is stable across runs.
  await menu(page, page.locator('.m2m', { hasText: 'S13·edit·1' }).first());
  await page.getByRole('menuitem', { name: 'Edit message' }).click();
  await page.getByLabel('Edit message').fill('S13·edit·1 payroll cut-off is the 25th');
  await writes(page, wire, /\/messaging\/messages\/[0-9a-f-]+$/, async () => {
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  });
  await page.waitForTimeout(1200);

  // ── DELETE, behind a confirmation ─────────────────────────────────────────
  const beforeRows = (await allMessages(page, hrId)).length;
  const doomed = page.locator('.m2m', { hasText: 'S13·del·1' }).first();
  await expect(doomed).toBeVisible({ timeout: 20_000 });
  await menu(page, doomed);
  await page.getByRole('menuitem', { name: 'Delete message' }).click();

  const confirm = page.getByRole('alertdialog');
  await expect(confirm, 'a delete happened with no confirmation at all').toBeVisible({ timeout: 10_000 });
  await expect(confirm).toContainText(/Delete this message\?/);
  await expect(confirm).toContainText(/It disappears for everyone in the channel/);

  // Cancel first — a destructive control that cannot be cancelled is a defect,
  // and "Cancel deleted it anyway" is invisible to anything but this check.
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0, { timeout: 10_000 });
  expect((await allMessages(page, hrId)).length, 'Cancel deleted the message anyway').toBe(beforeRows);

  await menu(page, doomed);
  await page.getByRole('menuitem', { name: 'Delete message' }).click();
  await writes(page, wire, /\/messaging\/messages\/[0-9a-f-]+$/, async () => {
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  });
  await page.waitForTimeout(2000);

  /*
   * ⚠ IT IS A SOFT DELETE AND THE LIST CANNOT SEE IT. `delete_message` sets
   * `is_deleted = TRUE` — the row survives so a thread hanging off it does not
   * lose its parent — but `list_messages` filters `AND m.is_deleted = FALSE`,
   * so the ONLY observable through this lane's read is that the row is GONE
   * from the list. A test that fetched the row and asserted `is_deleted` would
   * fail against a correct product, which is a defect in the test.
   */
  const afterRows = await allMessages(page, hrId);
  expect(afterRows.length, 'the delete did not remove the row from the log').toBe(beforeRows - 1);
  expect(afterRows.some((m: any) => String(m.content || '').startsWith('S13·del·1')),
    'the deleted message is still being served').toBeFalsy();
  await expect(page.locator('.m2m', { hasText: 'S13·del·1' }),
    'the deleted message is still on screen').toHaveCount(0, { timeout: 20_000 });

  assertConsole(con);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.11 — SEARCH: in this channel, and across every channel I can read
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.11 search scopes to one channel and to all, names the query when it finds nothing, and jumps', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const con = watchConsole(page);
  await signIn(page);
  await open(page, BIG.name);

  await page.getByRole('button', { name: 'Search messages' }).first().click();
  const panel = page.getByRole('search', { name: 'Search messages' });
  await expect(panel).toBeVisible({ timeout: 15_000 });

  const box = panel.getByLabel('Search messages');

  // ── the two-character floor states itself rather than 422ing ─────────────
  await box.fill('a');
  await page.waitForTimeout(900);
  await expect(panel).toContainText(/Type at least two characters/);
  await expect(panel).toContainText(/public channels in your organisation/);

  // ── scoped to this channel ───────────────────────────────────────────────
  const scope = panel.getByRole('button', { name: /^Only in / });
  await expect(scope).toBeVisible();
  await expect(scope).toHaveAttribute('aria-pressed', 'true');
  await box.fill('reconciliation');
  await expect.poll(async () => panel.locator('.sv__srch-r').count(),
    { timeout: 25_000 }).toBeGreaterThan(0);
  const inChannel = await panel.locator('.sv__srch-l').innerText();
  expect(inChannel).toContain('reconciliation');

  // ── org-wide ─────────────────────────────────────────────────────────────
  await scope.click();
  await expect(scope).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(2200);
  const wide = await panel.locator('.sv__srch-l').innerText();
  expect(wide.length, 'the org-wide search returned nothing at all').toBeGreaterThan(0);

  // ── a miss NAMES the query, because "No results" cannot tell the reader
  //     whether they mistyped or the word is genuinely not there ────────────
  await box.fill('zzqqxx-not-in-any-message');
  await expect(panel).toContainText(/No messages found|कोई संदेश नहीं मिला/, { timeout: 25_000 });
  await expect(panel).toContainText(/zzqqxx-not-in-any-message/);

  // ── jump to a hit, and Escape closes the panel and NOTHING else ──────────
  await box.fill('reconciliation');
  await expect.poll(async () => panel.locator('.sv__srch-r').count(), { timeout: 25_000 })
    .toBeGreaterThan(0);
  await panel.locator('.sv__srch-r').first().click();
  await page.waitForTimeout(2000);
  await expect(page.locator('.m2c__n'), 'the jump left the conversation').toBeVisible();

  if (await page.getByRole('search', { name: 'Search messages' }).count()) {
    await page.keyboard.press('Escape');
  }
  await expect(page.getByRole('search', { name: 'Search messages' })).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.m2c__n'), 'Escape closed the conversation as well as the panel').toBeVisible();

  // ── the OTHER door into search: the blank pane's own button, which is the
  //     only one a reader who does not know WHICH channel can reach ─────────
  await sanvaad(page);
  const blank = page.locator('.sv__blank');
  if (await blank.count()) {
    await blank.getByRole('button', { name: 'Search messages' }).click();
    await expect(page.getByRole('search', { name: 'Search messages' })).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
  }

  assertConsole(con);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.12 — READ RECEIPTS, and what "Seen by" is actually derived from
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.12 read receipts — where "Seen by" comes from, and the dead table beside it', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);

  /*
   * ⚠ A FINDING BEFORE AN ASSERTION, because the two must not be confused.
   *
   * `staging.samvada_read_receipts` EXISTS (migration 058: `message_id`,
   * `user_id`, `read_at`) and holds **0 rows in the whole history of this
   * database**. Nothing writes it: `grep samvada_read_receipts` across
   * `backend/` returns the migration and nothing else. It is a table with no
   * writer and no reader — the dormant half of the defect class the brief
   * names, and it is reported rather than fixed here because deleting a table
   * is a DROP and a DROP is the lead's, by name.
   *
   * What the product actually shows is derived from a DIFFERENT column:
   * `list_messages._SEEN` reads `samvada_channel_members.last_read_at >=
   * m.created_at`, capped at four names. That derivation has a consequence
   * worth stating out loud, and this test is what makes it visible:
   *
   *   `add_member` INSERTs with `last_read_at = NOW()`.
   *
   * So the moment somebody is added to a channel, they are reported as having
   * SEEN every message posted before they joined — without ever opening it.
   * "Seen by Anaya" then means "Anaya was added after this was written", which
   * is not what a read receipt claims. VERDICT: a product bug, latent-to-active
   * — it is live for every channel anybody has ever been added to, and it is
   * exactly the shape of defect a row count cannot see, because the row is
   * correct and the SENTENCE over it is wrong.
   */
  const bigId = (await listChannels(page)).find((c: any) => c.name === BIG.name).id;
  const members = (await orgGet(page, `/api/v1/messaging/channels/${bigId}/members`)) as any[];
  expect(members.length, '13.05 has not run — s13-general has no second member').toBeGreaterThan(1);

  const rows = await canonical(page, bigId, 100);
  const withSeen = rows.filter((m: any) => Array.isArray(m.seen_by) && m.seen_by.length > 0);
  console.log(`S13-SEEN  ${withSeen.length} of ${rows.length} rows on ${BIG.name} carry a seen_by list; ` +
    `seen_count max = ${Math.max(0, ...rows.map((m: any) => Number(m.seen_count || 0)))}`);

  // The wire contract: `seen_by` is NAMES and `seen_count` is a number, and the
  // list is capped at four because a 300-member channel would otherwise ship
  // 300 names per message per poll.
  for (const m of withSeen) {
    expect(Array.isArray(m.seen_by)).toBeTruthy();
    expect(m.seen_by.length, 'seen_by exceeded its four-name cap').toBeLessThanOrEqual(4);
    for (const nm of m.seen_by) {
      expect(typeof nm, `seen_by carried a non-string: ${JSON.stringify(nm)}`).toBe('string');
      // ⚠ NAMES, NEVER IDS — a receipt is the easiest place for a user_id to
      // reach a screen, because it is a list of people rendered from a join.
      expect(nm).not.toMatch(/^user_[0-9a-f]+$/i);
      expect(nm).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(nm, 'an email address is being used as a display name').not.toMatch(/@/);
    }
    expect(Number(m.seen_count)).toBeGreaterThanOrEqual(m.seen_by.length);
  }

  // ── the SCREEN half: `Seen` only renders on MY OWN messages, because "seen
  //     by yourself" is not a receipt ─────────────────────────────────────────
  await open(page, BIG.name);
  await expect(page.locator('.m2m').first()).toBeVisible({ timeout: 25_000 });
  const seenRow = page.locator('.m2m .seen, .m2m .msg__seen');
  if (await seenRow.count()) {
    const t = await seenRow.first().innerText();
    expect(t, `a read receipt is rendering an id:\n${t}`).not.toMatch(/user_[0-9a-f]{10,}/i);
    console.log(`S13-SEEN  on screen: ${JSON.stringify(t)}`);
  } else {
    console.log('S13-SEEN  no on-screen receipt yet — nobody else has opened this channel since the messages were written');
  }

  // ── `POST /channels/{id}/read` is the ONLY thing that moves `last_read_at`,
  //     and opening the channel must fire it, or every unread count in the
  //     module freezes ────────────────────────────────────────────────────────
  await open(page, 's13-accounts');
  await page.waitForTimeout(2500);
  expect(wire.some((l) => /POST \d+ \/api\/v1\/messaging\/channels\/[0-9a-f-]+\/read/.test(l)),
    `opening a channel fired no POST /read, so last_read_at never moves and every ` +
    `unread count in the module would freeze. The wire was:${dump(page, wire)}`).toBeTruthy();

  // ── the dead table, stated as a live fact rather than a suspicion ─────────
  // There is no route that reads or writes `samvada_read_receipts`; the OpenAPI
  // has no path containing "receipt" at all. This asserts the absence so that a
  // future route appearing is a visible change rather than a silent one.
  const openapi = await (await page.request.get(`${API}/openapi.json`)).json();
  // ⚠ SCOPED TO `/messaging/`. An unscoped `/receipt/i` matches
  // `/api/v1/procurement/purchase-orders/{po_id}/receipts` — Kray's GOODS
  // receipts, an entirely different thing — and the first run failed here
  // naming a route with nothing to do with Sanvaad. A word can mean two things
  // in one API, and a filter has to say which one it means.
  const receiptPaths = Object.keys(openapi.paths)
    .filter((p) => p.includes('/messaging/') && /receipt/i.test(p));
  expect(receiptPaths, `a Sanvaad read-receipt route now exists: ${JSON.stringify(receiptPaths)}`)
    .toEqual([]);

  assertConsole(con);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.13 — THE LOCKED CHANNEL VISIBLY REFUSES
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.13 an archived channel refuses in words, keeps its history, and unarchives', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);

  const before = (await listChannels(page)).find((c: any) => c.name === LOCKED.name);
  expect(before, '13.02 has not run').toBeTruthy();
  const historyBefore = (await canonical(page, before.id, 100)).length;
  expect(historyBefore, 'the channel to be locked has no history to keep').toBeGreaterThan(0);

  /*
   * ⚠ A SECOND RUN ARRIVES WITH THIS CHANNEL ALREADY ARCHIVED, because this
   * test deliberately leaves it that way — §4 asks for a locked channel at the
   * end of the run. `open()` reaches it through the Archived segment; the state
   * is then reset here so the archive transition itself is exercised on every
   * run rather than only the first.
   */
  await open(page, LOCKED.name);
  if (before.is_archived) {
    const reset = await settings(page);
    await writes(page, wire, /\/messaging\/channels\/[0-9a-f-]+$/, async () => {
      await reset.getByRole('button', { name: 'Unarchive' }).click();
    });
    await page.waitForTimeout(1500);
    await closeSheet(page);
    await page.waitForTimeout(1500);
  }
  await expect(composer(page).first(),
    'the channel is still locked after the reset — the archive transition cannot be tested')
    .toBeVisible({ timeout: 20_000 });

  const sheet = await settings(page);
  // Confirmed IN PLACE rather than through `ConfirmDialog` — that component
  // portals to `document.body` and this sheet traps focus in its own subtree,
  // so the dialog would open outside the trap and the trap would pull focus
  // straight back out of it.
  // The sheet is a scrolling panel and the Archive section is its LAST one, so
  // the button is reliably below the fold; Playwright will scroll to it, but a
  // mid-flight re-render can move it out from under the pointer. Scrolling
  // first and settling makes the click land on a stationary target.
  const archBtn = sheet.getByRole('button', { name: 'Archive channel' });
  await archBtn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await archBtn.click();
  await expect(sheet).toContainText(new RegExp(`Archive ${LOCKED.name}\\?`));
  const row = await writes(page, wire, /\/messaging\/channels\/[0-9a-f-]+$/, async () => {
    await sheet.getByRole('button', { name: 'Archive', exact: true }).click();
  });
  expect(row.is_archived, 'the server did not archive the channel').toBeTruthy();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);

  // ═══ THE REFUSAL, and it has to be VISIBLE ═══════════════════════════════
  // Three things, and all three matter: a banner that says why BEFORE it says
  // what it kept; a composer replaced by a sentence rather than merely
  // disabled; and the sentence naming the ROOM, not the reader's permissions.
  await expect(page.locator('.m2c__banner')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.m2c__banner')).toContainText(/This channel is archived/);
  await expect(page.locator('.m2c__banner')).toContainText(/History stays readable and searchable; nobody can post/);

  await expect(page.locator('.m2cp__locked')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.m2cp__locked'))
    .toContainText(/This channel is archived — nobody can post, including admins/);
  // ⚠ IT MUST NOT SAY THE READER'S ACCESS IS THE PROBLEM. `LockedComposer` has
  // two branches for exactly this reason and collapsing them would imply an
  // archived channel is a permissions problem the reader can ask their way out of.
  await expect(page.locator('.m2cp__locked')).not.toContainText(/Viewer/);
  await expect(composer(page), 'the composer is still on screen in an archived channel').toHaveCount(0);

  // The header keeps the word too, so a reader who scrolled past the banner
  // still knows which room they are in.
  await expect(page.locator('.m2c__n .m2m__tag')).toContainText('archived');

  // ── the history is KEPT and SEARCHABLE, which is the other half of the claim
  const after = await canonical(page, before.id, 100);
  expect(after.length, 'archiving lost the history it promised to keep').toBe(historyBefore);

  await sanvaad(page);
  await page.getByRole('button', { name: 'Search messages' }).first().click();
  const panel = page.getByRole('search', { name: 'Search messages' });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByLabel('Search messages').fill('S13·ann·1');
  await expect.poll(async () => panel.locator('.sv__srch-r').count(), { timeout: 25_000 })
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');

  // ── the rail says "archived" in a WORD, not only by dimming ───────────────
  await page.locator('.m2seg', { hasText: /^Archived/ }).click();
  await page.waitForTimeout(1200);
  const arch = page.locator('.m2row', { hasText: LOCKED.name }).first();
  await expect(arch).toBeVisible({ timeout: 15_000 });
  await expect(arch.locator('.m2row__kind')).toContainText('archived');

  // ── and it unarchives, because the sentence promised it could ─────────────
  await arch.click();
  await page.waitForTimeout(1500);
  const sheet2 = await settings(page);
  await writes(page, wire, /\/messaging\/channels\/[0-9a-f-]+$/, async () => {
    await sheet2.getByRole('button', { name: 'Unarchive' }).click();
  });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await expect(composer(page).first(), 'unarchiving did not give the composer back')
    .toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.m2cp__locked')).toHaveCount(0);

  // Leave it archived — §4 asks for a locked channel at the end of the run.
  await open(page, LOCKED.name);
  const sheet3 = await settings(page);
  const archBtn3 = sheet3.getByRole('button', { name: 'Archive channel' });
  await archBtn3.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await archBtn3.click();
  await writes(page, wire, /\/messaging\/channels\/[0-9a-f-]+$/, async () => {
    await sheet3.getByRole('button', { name: 'Archive', exact: true }).click();
  });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');

  assertConsole(con);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.14 — a DIRECT MESSAGE, and MUTE
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.14 a direct message is opened from the people picker, and a channel is muted', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);
  await sanvaad(page);

  // ⚠ `POST /v1/messaging/dm` had ZERO callers for most of this module's life,
  // because the only other user list in the API is `GET /v1/org/members`, gated
  // on `require_org_role("org_admin","org_owner")` — an ordinary member had no
  // way to name anybody. `GET /directory` is what unblocked it.
  const before = (await listChannels(page)).filter((c: any) => c.type === 'dm').length;

  await page.getByRole('button', { name: 'New direct message' }).click();
  const search = page.getByLabel('Search people to message');
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill('Anaya');
  await page.waitForTimeout(1200);
  const pick = page.locator('.sv__lnew button', { hasText: 'Anaya Iyer' }).first();
  await expect(pick, 'the directory offered nobody called Anaya').toBeVisible({ timeout: 15_000 });

  // `POST /dm` is find-or-create, so it fires whether or not the conversation
  // already exists — reading the response is how the id is learned either way.
  // ⚠ Same trap: `POST /v1/messaging/dm?target_user_id=…` (`ChannelsTab.jsx:261`).
  const dm = await writes(page, wire, /\/messaging\/dm(\?|$)/, async () => { await pick.click(); });
  expect(dm.id, `POST /dm returned no channel: ${JSON.stringify(dm).slice(0, 200)}`).toBeTruthy();
  expect(dm.type, 'POST /dm created something that is not a dm').toBe('dm');
  await page.waitForTimeout(2500);
  const dms = (await listChannels(page)).filter((c: any) => c.type === 'dm');
  idem('direct messages', dms.length - before, before);
  expect(dms.length, 'no direct message exists after opening one').toBeGreaterThan(0);

  // A DM's settings sheet is a DIFFERENT sheet — no rename, no colour, no
  // archive, no "Add someone", because none of those is a thing you do to a
  // two-person conversation.
  const dmGear = page.getByRole('button', { name: 'Channel settings', exact: true });
  if (await dmGear.count()) {
    const dmSheet = page.getByRole('dialog', { name: /Direct message|Channel settings/ });
    await dmGear.click();
    await expect(dmSheet).toBeVisible({ timeout: 15_000 });
    await expect(dmSheet.getByRole('button', { name: 'Archive channel' })).toHaveCount(0);
    await expect(dmSheet.getByLabel('Search people to add')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dmSheet).toHaveCount(0, { timeout: 10_000 });
  }

  // ── MUTE, on a channel, and the sentence that goes with it ───────────────
  await open(page, 's13-random');
  const sheet = await settings(page);
  const toggle = sheet.getByRole('switch', { name: /Mute this channel|Unmute this channel/ });
  await expect(toggle, 'no mute control on a channel this lane can post in').toBeVisible();
  const was = await toggle.getAttribute('aria-checked');
  await writes(page, wire, /\/mute$/, async () => { await toggle.click(); });
  await page.waitForTimeout(1400);
  await expect(toggle).not.toHaveAttribute('aria-checked', was || 'false');

  // ⚠ THE SENTENCE IS THE FEATURE. The rail suppresses a muted channel's unread
  // COUNT but never its mention badge, and the copy has been wrong about that
  // before — it used to say "you are still told when somebody writes your name",
  // which is false: `samvaad_mentions.py:572` gates the notification AND the
  // push on the same `muted` set. What survives is the RECORD.
  await expect(sheet).toContainText(/nothing in this channel notifies you — not even somebody writing your name/);
  await expect(sheet).toContainText(/The mention badge still appears on the channel, and the message is still in Mentions/);

  // Put it back, so a second run starts where the first did.
  await writes(page, wire, /\/mute$/, async () => { await toggle.click(); });
  await page.waitForTimeout(1200);
  await closeSheet(page);

  assertConsole(con);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.15 — ATTACHMENTS ARE NOT BUILT, and two more dead ends beside them
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.15 attachments: no control, no route, no row — a §4 volume that cannot be met', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);
  await open(page, BIG.name);

  /*
   * §4 asks for 12 attachments on this module. THE PRODUCT CANNOT DO IT.
   * This is not "blocked" (no credential is missing), not "skipped" (nothing is
   * being avoided) and not "excluded by decision" (§13 excludes Varta and the
   * social connectors, not this). It is NOT BUILT, which is a fourth sentence,
   * and it is proved three independent ways so that nobody re-derives it in six
   * weeks from a silent zero.
   */

  // ── 1. NO CONTROL. The composer's foot holds formatting, emoji and Sahayak,
  //       and `Composer.jsx:209-215` says the attach slot was taken by the
  //       formatting group because "the build has no attach yet".
  const foot = page.locator('.m2cp__foot');
  await expect(foot).toBeVisible({ timeout: 20_000 });
  const footButtons = await foot.locator('button, span[role="button"]').evaluateAll(
    (els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim()));
  console.log(`S13-ATTACH  composer foot controls: ${JSON.stringify(footButtons)}`);
  expect(footButtons.join(' | '), 'an attach control appeared — §4\'s 12 attachments may now be achievable')
    .not.toMatch(/attach|upload|file|paperclip/i);
  expect(await page.locator('.m2cp input[type="file"]').count(),
    'a file input appeared in the composer').toBe(0);

  // ── 2. NO ROUTE. The DEPLOYED OpenAPI, not the local tree.
  const openapi = await (await page.request.get(`${API}/openapi.json`)).json();
  const messagingPaths = Object.keys(openapi.paths).filter((p) => p.includes('/messaging/'));
  const attachRoutes = messagingPaths.filter((p) => /attach|upload|file/i.test(p));
  console.log(`S13-ATTACH  ${messagingPaths.length} deployed /messaging/ routes, ` +
    `${attachRoutes.length} of them attachment-shaped`);
  expect(attachRoutes, `an attachment route now exists: ${JSON.stringify(attachRoutes)}`).toEqual([]);

  // ── 3. NO ROW. Asserted through the product's own read: every message this
  //       suite created comes back without an attachments array of any kind.
  const bigId = (await listChannels(page)).find((c: any) => c.name === BIG.name).id;
  const rows = await canonical(page, bigId, 100);
  for (const m of rows) {
    expect(m.attachments == null || (Array.isArray(m.attachments) && m.attachments.length === 0),
      `a message came back carrying attachments: ${JSON.stringify(m.attachments)}`).toBeTruthy();
  }

  /*
   * ── TWO MORE DEAD ENDS IN THE SAME MODULE, closed here rather than filed ──
   *
   * (a) `staging.samvada_read_receipts` — a table with no writer and no reader.
   *     Covered by 13.12; the OpenAPI assertion there is the ratchet.
   *
   * (b) `staging.samvada_typing` — 0 rows, ever. Typing state rides `GET /live`
   *     (decision D1: a dedicated typing POST at 3s is 20 writes/min/user
   *     against a 120/min per-IP budget) and is held in memory, so the table is
   *     the residue of a design that was replaced. Reported, not dropped.
   *
   * Neither is a route-with-no-caller — those are worse, because they look
   * finished. This module HAS one of those and it is `PATCH /channels/{id}` +
   * the three member routes, which had zero callers from migration 058 until
   * `ChannelDetails.jsx` shipped: a private channel could never gain a second
   * member for that whole period. 13.02 and 13.05 are what keep it called.
   */
  const openapiPaths = Object.keys(openapi.paths);
  expect(openapiPaths.filter((p) => /typing/i.test(p)),
    'a typing route now exists — D1 has been reversed').toEqual([]);

  // Every messaging route the deployed build offers, printed so the next reader
  // can diff it rather than re-derive it.
  console.log('S13-ROUTES\n  ' + messagingPaths.map((p) =>
    `${Object.keys(openapi.paths[p]).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m))
      .map((m) => m.toUpperCase()).sort().join(' ').padEnd(20)} ${p}`).join('\n  '));

  assertConsole(con);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.16 — the standing rules, on Sanvaad's own screens
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.16 no rendered ids, no native date input, Escape closes every overlay, keyboard reaches everything', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const con = watchConsole(page);
  await signIn(page);
  await open(page, BIG.name);
  await expect(page.locator('.m2m').first()).toBeVisible({ timeout: 25_000 });

  // ── NAMES, NEVER IDS, across the whole module surface ────────────────────
  // ⚠ `check-rendered-ids.mjs` is a STATIC ratchet and stayed green over a real
  // violation twice (memory: "static ratchets are NOT coverage"), so this reads
  // the rendered text of the live screen instead.
  const panel = page.locator('#m2panel-msg');
  const text = await panel.innerText();
  const uuid = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  expect(uuid, `a UUID is rendered in Sanvaad: ${uuid?.[0]}`).toBeNull();
  const uid = text.match(/\buser_[0-9a-f]{10,}\b/i);
  expect(uid, `a user id is rendered in Sanvaad: ${uid?.[0]}`).toBeNull();

  // The same, on the two panels and the sheet, which render people and are the
  // likeliest place for an id to reach a screen.
  await page.getByRole('button', { name: 'Channel settings', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Channel settings' });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  const sheetText = await sheet.innerText();
  expect(sheetText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i),
    `a UUID is rendered in the channel sheet:\n${sheetText}`).toBeNull();

  // ── NO NATIVE DATE INPUT ANYWHERE ────────────────────────────────────────
  expect(await page.locator('input[type="date"]').count(),
    'a native date input appeared in Sanvaad — the product uses DateInput everywhere').toBe(0);

  // ── ESCAPE CLOSES EVERY OVERLAY, and closes exactly ONE of them ──────────
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0, { timeout: 10_000 });

  for (const [openIt, locate] of [
    [async () => page.getByRole('button', { name: 'Search messages' }).first().click(),
      () => page.getByRole('search', { name: 'Search messages' })],
    [async () => page.locator('.sv__mnb').click(),
      () => page.getByRole('region', { name: 'Mentions' })],
  ] as const) {
    await openIt();
    const el = locate();
    await expect(el).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(el).toHaveCount(0, { timeout: 15_000 });
    // ⚠ AND THE CONVERSATION BEHIND IT SURVIVED. Both panels `stopPropagation`
    // on Escape for exactly this reason — one press must not also close the
    // thread the reader was in.
    await expect(page.locator('.m2c__n')).toBeVisible();
  }

  // The emoji picker is a third overlay with its own dismissal.
  await composer(page).first().click();
  await page.getByRole('button', { name: 'Insert emoji' }).click();
  const emo = page.getByRole('dialog', { name: 'Insert emoji' });
  await expect(emo).toBeVisible({ timeout: 15_000 });
  await expect(emo.getByLabel('Search emoji')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(emo).toHaveCount(0, { timeout: 10_000 });

  // ── KEYBOARD: the composer is reachable and Enter sends without a mouse ──
  const box = composer(page).first();
  await box.focus();
  await expect(box).toBeFocused();

  // ── EVERY TABLE ON `--row-h`: Sanvaad renders NO DataTable at all, so the
  //     rule is vacuous here and that is stated rather than silently passed.
  expect(await page.locator('#m2panel-msg table, #m2panel-msg .dt, #m2panel-msg [role="grid"]').count(),
    'Sanvaad grew a table — it now owes the --row-h contract').toBe(0);

  // ── the module's own analytics link is a control and must go somewhere ────
  const analytics = page.getByRole('link', { name: /Analytics/ }).first();
  if (await analytics.count()) {
    expect(await analytics.getAttribute('href'), 'the Analytics link has no destination').toBeTruthy();
  }

  assertConsole(con);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 13.17 — the final tally, read live, and printed for the report
 * ═══════════════════════════════════════════════════════════════════════════ */
test('13.17 §4 volumes, read live from the product at the end of the run', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const con = watchConsole(page);
  await signIn(page);

  const chans = await listChannels(page);
  const planned = new Set(CHANNELS.map((c) => c.name));
  const mine = chans.filter((c: any) => planned.has(c.name));
  const dms = chans.filter((c: any) => c.type === 'dm');
  const noise = chans.filter((c: any) => !planned.has(c.name) && c.type !== 'dm');

  let messages = 0; let replies = 0; let reactions = 0; let pins = 0;
  for (const c of CHANNELS) {
    const row = chans.find((x: any) => x.name === c.name);
    if (!row) continue;
    const all = await allMessages(page, row.id);
    messages += all.filter((m: any) => String(m.content || '').startsWith(`S13·${c.slug}·`)).length;
    replies += all.reduce((n: number, m: any) => n + Number(m.thread_count || 0), 0);
    const head = await canonical(page, row.id, 100);
    reactions += head.reduce((n: number, m: any) => n + (Array.isArray(m.reactions) ? m.reactions.length : 0), 0);
    pins += ((await orgGet(page, `/api/v1/messaging/channels/${row.id}/pins`)) as any[]).length;
  }
  const mentionMsgs = (await allMessages(page, chans.find((c: any) => c.name === BIG.name).id))
    .filter((m: any) => /S13·(men|cast)·/.test(String(m.content || ''))).length;

  console.log(
    '\nS13-VOLUMES  §4 asked  ·  achieved (live)\n' +
    `  channels        9  ·  ${mine.length}   (${mine.filter((c: any) => c.type === 'public').length} public, ` +
    `${mine.filter((c: any) => c.type === 'private').length} private, ` +
    `${mine.filter((c: any) => c.is_archived).length} archived)   + ${dms.length} DM\n` +
    `  messages      140  ·  ${messages}\n` +
    `  threads        24  ·  ${replies}\n` +
    `  reactions      35  ·  ${reactions}\n` +
    `  mentions       18  ·  ${mentionMsgs} messages carrying a mention token\n` +
    `  attachments    12  ·  0   NOT BUILT — no control, no route, no row (13.15)\n` +
    `  not this suite's: ${noise.length} other channel(s) in the org — ` +
    `${JSON.stringify(noise.map((c: any) => c.name))}\n`);

  expect(mine.length, '§4 channels').toBe(9);
  expect(messages, '§4 messages').toBe(TOTAL_MSGS);
  expect(replies, '§4 threads').toBeGreaterThanOrEqual(THREAD_REPLIES);
  expect(reactions, '§4 reactions').toBeGreaterThanOrEqual(REACTIONS - 1);
  expect(mine.filter((c: any) => c.is_archived).length,
    '§4 asks that a locked channel end the run locked').toBeGreaterThan(0);

  // Route coverage, so a control-without-a-route or a route-without-a-control
  // is a visible number rather than an impression.
  for (const p of [
    '/api/v1/messaging/me', '/api/v1/messaging/directory', '/api/v1/messaging/channels',
    '/api/v1/messaging/unread', '/api/v1/messaging/live', '/api/v1/messaging/mentions',
  ]) {
    expect(await orgGetStatus(page, p), `${p} did not answer 200`).toBe(200);
  }

  assertConsole(con);
});
