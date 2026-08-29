/**
 * Proposal 93 · Stage 3 · WAVE 2 · SUITE 04 — Graha (CRM), on Unicode Group.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LANE, AND THE GUARD THAT PROVES IT
 * ═══════════════════════════════════════════════════════════════════════════
 * `lane('unicode')` + `signInAs()` from `_lanes.ts`. Read that file's header
 * before changing a line here: on 2026-08-28 a write suite renamed **Aekam
 * Inc** — the one org proposal 93 guarantees is untouched — because the
 * credential in use held `platform_admin` and every request resolved to Aekam
 * via `platform_bypass`. The save genuinely succeeded and the suite went GREEN.
 *
 * ⚠ `_lanes.ts::signInAs()` does **NOT** call `assertOrg()` itself — measured
 * 2026-08-29, the function body is `goto('/login')` → seed the token → `goto
 * ('/dashboard')` and nothing else. The brief for this suite said it did. So
 * `signIn()` below wraps the two together and is the ONLY door into this file:
 * a test cannot reach a form without having proved, from the SERVER, that the
 * session resolves to `ORG.UNICODE`. It asserts the org **ID**, never the name
 * on screen — the name is precisely what got corrupted in the incident.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 1 — EVERY ROW HERE IS TYPED BY A USER
 * ═══════════════════════════════════════════════════════════════════════════
 * No SQL. No `page.request.post/put/patch/delete`. Every client, contact, deal,
 * label, field, territory, activity, follow-up, document, rule and merge below
 * is created by opening the screen, filling the real inputs, choosing from the
 * real pickers and pressing the real button.
 *
 * `page.request.get` IS used — `apiRows()` / `apiOne()` below — and that is the
 * ratchet's own carve-out: "asserting the row appeared IS the required
 * evidence". Both helpers send **`X-Org-Id`**, because `frontend/src/lib/api.js`
 * sends it on every product request and a read helper that omits it makes the
 * server fall back to the caller's OLDEST membership and answer for a different
 * organisation than the screen beside it.
 *
 * ── THE TWELVE PUBLIC SUBMISSIONS ARE NOT MADE, AND THAT IS THE FINDING ─────
 * §4 asks for 12 submissions "from a logged-out context". `POST
 * /api/v1/graha/f/{slug}` is deliberately unauthenticated and **this product
 * ships no page that renders it** — `WebFormsTab.jsx` prints an instruction
 * instead: "POST your form data as JSON to /api/v1/graha/f/<slug> … No auth
 * required." There is no hosted form, no preview, no embed-snippet generator
 * and no public route in `App.jsx`. The customer is expected to write the
 * JavaScript themselves.
 *
 * A first draft of 04.14 built that page and clicked its Submit button.
 * `check-e2e-no-bypass.mjs` refused it — the `fetch(..., {method:'POST'})` in
 * the served page is a raw API write from a spec file, whatever wraps it — and
 * that refusal is correct rather than inconvenient. Rule 1 admits no bypass,
 * the ratchet's baseline "may go DOWN, never up", and quietly moving the write
 * into an unscanned `.html` fixture would be an exemption with nobody's name on
 * it. So the submissions are NOT made, 04.14 fails on the missing affordance
 * with the evidence, and 93 §14 keeps the verdict. **0 of 12.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 2 — STOP AND REPORT. NO VERDICT.
 * ═══════════════════════════════════════════════════════════════════════════
 * Where a control §4 requires does not exist, the test FAILS and says exactly
 * what it looked for and what the live wire returned. It is never skipped, and
 * no assertion is softened to make it pass. Proposal 93 §14 reserves the
 * product-bug-vs-test-bug judgement to the owner. Four of these are known
 * before the first run and are written as failures on purpose:
 *
 *   04.10  `lost_reason` has NO input anywhere in the module. The column is
 *          live, `DealUpdate.lost_reason` exists and `_DEAL_COLS` now writes it
 *          (routers/graha.py:242, :2037) — but a grep for the string across
 *          `frontend/src` returns the backend only. A person cannot type why a
 *          deal was lost.
 *   04.16  Scoring rules: `GET/PATCH /v1/graha/scoring-rules` exist, there is
 *          **no POST**, and no Graha tab renders them. §4's "4 scoring rules"
 *          has no door.
 *   04.17  Pipelines: `GET/POST /v1/graha/pipelines` exist and nothing in
 *          `frontend/src` calls either. §4's "2 pipelines" has no door; the
 *          first deal silently auto-creates "Default Pipeline" server-side.
 *   04.07  Territory PRIORITY: §4 asks for one; `TerritoriesTab.jsx` has name,
 *          description, assigned users and `rules.pincodes` and nothing else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §6 — RE-RUNNABLE, AND PROVED BY RUNNING IT TWICE
 * ═══════════════════════════════════════════════════════════════════════════
 * Every record this suite makes carries a DETERMINISTIC name built from `TAG`,
 * so a second execution finds its own output and verifies instead of
 * duplicating: `ensure()` reads the live list first and only types what is
 * missing. `RUN` — a per-run stamp — is used ONLY where a value must differ
 * from the last run to prove THIS run's write landed (the client note, the
 * activity description, the lost reason).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TRAPS THIS FILE IS WRITTEN AROUND
 * ═══════════════════════════════════════════════════════════════════════════
 * · `page.reload()` on the line after Save races the write. Everything goes
 *   through `saveAndWait()`, which returns the SERVER's status — a toast is the
 *   client's opinion.
 * · Contact search is SERVER-side and does not fire on typing (`ContactsTab`
 *   binds it to Enter and to the Filter button). 04.19 proves the request, then
 *   the filtered list — typing is not searching.
 * · There is no native `<input type="date">` in this product. Dates go through
 *   `ui/DateInput.jsx` and are driven by `setDate()` from `_helpers.ts`.
 * · `.or()` chains resolve in DOM order and will match the sidebar. Every
 *   locator here is scoped to the tab panel or to the form.
 * · A vacuous assertion passes for ever — 02.3 looped over
 *   `input[type=checkbox]` where the product renders `<button role="switch">`.
 *   EVERY loop below asserts its count BEFORE it iterates.
 * · No user/member/org UUID is ever rendered or asserted. Ids appear only in a
 *   read-back URL, which is the same distinction `_shared.jsx::dealPath` makes.
 * · No NAME of a person this suite did not create is asserted. Territory
 *   members are chosen positionally and counted, never named — a human accepted
 *   one of this programme's invitations mid-run once already.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/wave2.config.ts --grep "Suite 04"
 */
import { test, expect, Page, Locator } from '@playwright/test';
import { lane, signInAs as laneSignIn, assertOrg, ORG as ORG_IDS } from './_lanes';
import { setDate } from './_helpers';

const LANE = lane('unicode');
const API = process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app';
const BASE = process.env.E2E_BASE_URL || 'https://staging.kartavaya.com';

const BLOCKED =
  'BLOCKED — no Unicode Group credential. Set E2E_UNICODE_TOKEN (or ' +
  'E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e at the repo root. ⚠ It must be an ' +
  'ORG-SCOPED account: a platform_admin token resolves to Aekam Inc via ' +
  'platform_bypass and will write there. ENVIRONMENT blocker, not a product ' +
  'or test defect.';

/** The suite's own mark. Deterministic — §6 idempotence hangs off it. */
const TAG = 'S04';
/** A per-run stamp, for the handful of values that must differ run to run. */
const RUN = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Six real Indian places, two pincodes each — twelve in all.
 *
 * They are the spine of three §4 lines at once: every client and contact
 * carries a full address ending in one of these PINs, each territory claims one
 * place's pair, and `POST /contacts/route-all` then has something true to file
 * against. Made-up pincodes would route to nothing and the backfill report
 * would read "no territory claims that pincode" for all fifty.
 */
const PLACES = [
  { city: 'Surat', state: 'Gujarat', pins: ['395002', '395007'] },
  { city: 'Ahmedabad', state: 'Gujarat', pins: ['380015', '380009'] },
  { city: 'Mumbai', state: 'Maharashtra', pins: ['400001', '400058'] },
  { city: 'Pune', state: 'Maharashtra', pins: ['411001', '411045'] },
  { city: 'Bengaluru', state: 'Karnataka', pins: ['560001', '560103'] },
  { city: 'Chennai', state: 'Tamil Nadu', pins: ['600001', '600096'] },
];

// ── §4 VOLUMES, stated once ─────────────────────────────────────────────────
const N_CLIENTS = 25;
const N_CONTACTS = 50;
const N_DUPES = 3;          // three duplicate pairs → three merges
const N_DEALS = 30;         // 8 Won · 6 Lost · 16 open
const N_WON = 8;
const N_LOST = 6;
const N_MOVES = 40;         // kanban stage moves, every one a drag
const N_ACTIVITIES = 45;
const N_FOLLOWUPS = 18;
const N_TERRITORIES = 6;
const N_LABELS = 8;
const N_FIELDS = 6;
const N_DOCS = 12;
const N_APPROVAL_RULES = 3;
const N_FORMS = 2;
const N_SUBMISSIONS = 12;

// The four stages a deal may sit in while it is still open. Won and Lost are
// deliberately excluded from the drag set: 04.09 fixes the 8/6 split and a
// stray drag into Won would move a §4 count without saying so.
const OPEN_STAGES = ['New', 'Qualified', 'Proposal', 'Negotiation'];

const clientName = (n: number) => `${TAG} Client ${pad(n)} ${PLACES[(n - 1) % 6].city}`;
const contactName = (n: number) => `${TAG} Contact ${pad(n)}`;
const contactEmail = (n: number) => `s04.contact${pad(n)}@example.com`;
/** Ten digits, unique per contact — `idx_graha_contacts_org_phone` is UNIQUE. */
const contactPhone = (n: number) => `98${String(76000000 + n)}`;
const dupeName = (n: number) => `${TAG} Contact Dup ${n}`;
const dupePhone = (n: number) => `98${String(76009000 + n)}`;
const dealTitle = (n: number) => `${TAG} Deal ${pad(n)}`;
const labelName = (n: number) => `${TAG} Label ${pad(n)}`;
const territoryName = (n: number) => `${TAG} Territory ${PLACES[n - 1].city}`;
const activityTitle = (n: number) => `${TAG} Activity ${pad(n)}`;
const followUpTitle = (n: number) => `${TAG} Follow-up ${pad(n)}`;
const docName = (n: number) => `${TAG} Document ${pad(n)}`;
const formName = (n: number) => `${TAG} Web form ${pad(n)}`;
const formSlug = (n: number) => `s04-unicode-form-${pad(n)}`;

/** The stage a deal is CREATED in. 1-8 Won, 9-14 Lost, the rest open. */
function stageOf(n: number): string {
  if (n <= N_WON) return 'Won';
  if (n <= N_WON + N_LOST) return 'Lost';
  return OPEN_STAGES[(n - N_WON - N_LOST - 1) % OPEN_STAGES.length];
}

/** The six custom fields, one per input type §4 asks to see. */
const CUSTOM_FIELDS: { name: string; type: string; html: string }[] = [
  { name: `${TAG} CF text`, type: 'text', html: 'text' },
  { name: `${TAG} CF number`, type: 'number', html: 'number' },
  { name: `${TAG} CF date`, type: 'date', html: 'DateInput' },
  { name: `${TAG} CF url`, type: 'url', html: 'url' },
  { name: `${TAG} CF email`, type: 'email', html: 'email' },
  // ⚠ `phone`, not `tel`. `CustomFieldInputs.jsx` renders
  // `type={f.field_type === 'text' ? 'text' : f.field_type}`, so a phone field
  // ships `<input type="phone">` — which is not a valid input type, falls back
  // to text in every browser, and therefore does NOT get the numeric keypad the
  // file's own comment says it is there for. The attribute is asserted as it is
  // actually written; the mismatch is in the report.
  { name: `${TAG} CF phone`, type: 'phone', html: 'phone' },
];

test.beforeAll(() => {
  if (!LANE.token && !LANE.password) throw new Error(BLOCKED);
  console.log(
    `\n  LANE: ${LANE.org}  (reference lane, §14)` +
    `${LANE.token ? '  · door opened by TOKEN, every row still typed' : '  · real form login'}` +
    `\n  RUN STAMP: ${RUN}\n`,
  );
});

// ════════════════════════════════════════════════════════════════════════════
// THE DOOR
// ════════════════════════════════════════════════════════════════════════════

/**
 * Sign in, point the session at Unicode Group, and REFUSE TO CONTINUE unless
 * the server agrees that is where it is.
 *
 * The org key is the switcher's own (`lib/orgContext.js`), written before the
 * app boots so `api.js`'s request interceptor puts `X-Org-Id` on every product
 * call. Without it the server resolves to the caller's OLDEST membership.
 *
 * `assertOrg()` is called HERE rather than left for each test to remember,
 * because a countermeasure that depends on being remembered is one that will be
 * forgotten — it has already been found not running twice.
 */
async function signIn(page: Page) {
  await laneSignIn(page, LANE);
  await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), LANE.orgId);
  await assertOrg(page.request, page, LANE);
  expect(LANE.orgId, 'the lane must be Unicode Group and never Aekam Inc')
    .toBe(ORG_IDS.UNICODE);
}

// ════════════════════════════════════════════════════════════════════════════
// READ-BACK — GET only, and always with X-Org-Id
// ════════════════════════════════════════════════════════════════════════════

/**
 * A product GET, shaped exactly like `frontend/src/lib/api.js:39`.
 *
 * ⚠ `X-Org-Id` is not optional. A helper that omits it makes the server fall
 * back to the caller's oldest membership and answer for a different org than
 * the screen beside it — a hole that once existed INSIDE the suite written to
 * catch cross-org leaks.
 */
async function apiGet(page: Page, pathAndQuery: string) {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  return page.request.get(`${API}${pathAndQuery}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Org-Id': LANE.orgId,
    },
  });
}

/** The rows of a list endpoint, whichever envelope it answers with. */
async function apiRows(page: Page, pathAndQuery: string): Promise<any[]> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 300)}`)
    .toBeLessThan(400);
  const body = await res.json();
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.rules)) return body.rules;
  return [];
}

/** One object from an endpoint that answers a record rather than a list. */
async function apiOne(page: Page, pathAndQuery: string): Promise<any> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 300)}`)
    .toBeLessThan(400);
  const body = await res.json();
  return body?.data ?? body;
}

// ════════════════════════════════════════════════════════════════════════════
// THE WIRE, AND THE CONSOLE
// ════════════════════════════════════════════════════════════════════════════

type Wire = string[];

/**
 * Every write this suite makes, with the status the server answered.
 *
 * Memory's rule, learned from the bank-import bug: watch the requests before
 * blaming the UI. That defect presented as "the button does nothing"; it was a
 * 500, and only a request listener told the two apart.
 */
function watchWire(page: Page): Wire {
  const wire: Wire = [];
  page.on('response', async (r) => {
    const req = r.request();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) return;
    if (!/\/api\//.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 200); } catch { /* consumed */ }
    wire.push(`${req.method()} ${r.status()} ${new URL(r.url()).pathname}  ${body}`);
  });
  return wire;
}

const dumpWire = (w: Wire) =>
  w.length ? w.slice(-25).map((l) => '\n     ' + l).join('') : '\n     (no write request was made at all)';

type Watcher = { errors: { where: string; text: string }[]; at: (where: string) => void };

/** Console errors and uncaught exceptions, tagged with the screen they fell on. */
function watchConsole(page: Page): Watcher {
  const errors: { where: string; text: string }[] = [];
  let where = 'boot';
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    errors.push({ where, text: m.text().slice(0, 240) });
  });
  page.on('pageerror', (e) => {
    errors.push({ where, text: `UNCAUGHT ${String(e?.message ?? e).slice(0, 240)}` });
  });
  return { errors, at: (w: string) => { where = w; } };
}

const dumpConsole = (c: Watcher) =>
  c.errors.map((e) => `\n     [${e.where}] ${e.text}`).join('') || '\n     (none)';

// ════════════════════════════════════════════════════════════════════════════
// SCREEN MACHINERY
// ════════════════════════════════════════════════════════════════════════════

/** Settle, but never fail on it — the shell polls, so networkidle may not come. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
}

/**
 * Open one Graha tab, by URL.
 *
 * `GrahaPage` reads the open tab out of `?tab=` and renders the panel as
 * `#mt-panel-<id>`, so this is the product's own addressing rather than a click
 * on a tab strip whose overflow depends on the viewport. The panel assertion is
 * the gate: a tab that never paints fails here and not three lines later on a
 * button that was never served.
 */
async function gotoTab(page: Page, tab: string) {
  await page.goto(`/graha?tab=${tab}`);
  await expect(
    page.locator(`#mt-panel-${tab}`),
    `the Graha "${tab}" panel never rendered — the tab is unreachable, which is a ` +
    'product finding and not a selector problem',
  ).toBeVisible({ timeout: 60_000 });
  await settle(page);
}

/** The panel the active tab renders into — every locator below is scoped to it. */
const panel = (page: Page, tab: string) => page.locator(`#mt-panel-${tab}`);

/**
 * Press a control that writes, and WAIT FOR THE SERVER before going on.
 *
 * This is the fix for three of Suite 02's four failures on 2026-08-28: each
 * clicked Save and called `page.reload()` on the very next line, the reload tore
 * the page down with the request still in flight, the value read back empty, and
 * the suite reported "the product did not save it" about a product that had.
 *
 * Returns the response so a caller asserts on the STATUS. A toast is the
 * client's opinion; the status is the server's.
 */
async function saveAndWait(
  page: Page,
  act: () => Promise<void>,
  urlRe: RegExp,
  what: string,
) {
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => urlRe.test(r.url()) && ['POST', 'PUT', 'PATCH'].includes(r.request().method()),
      { timeout: 60_000 },
    ),
    act(),
  ]);
  const body = await res.text().catch(() => '');
  expect(
    res.status(),
    `${what}: ${res.request().method()} ${new URL(res.url()).pathname} → ${res.status()}\n     ${body.slice(0, 400)}`,
  ).toBeLessThan(400);
  return res;
}

/**
 * Type into a controlled React input the way a person does.
 *
 * `fill('')` does not register with a controlled input — React never sees the
 * change and the box repaints with its old value — so clearing is done by
 * selecting the existing text and typing over it. Setting a value from empty is
 * `fill()`, which dispatches the `input` event React listens for.
 */
async function typeInto(input: Locator, value: string) {
  await input.click();
  await input.press('ControlOrMeta+a');
  if (value === '') {
    await input.press('Backspace');
    return;
  }
  await input.fill(value);
}

/**
 * Choose an option by its VISIBLE TEXT from a `<select>` that a fetch fills in.
 *
 * Reading the options straight after `settle()` catches the empty mount and
 * reports "no clients to pick" against an org holding twenty-five — a false
 * product finding, which is worse than a flake. Polls, then selects by label so
 * no id is ever handled.
 */
async function pickByLabel(select: Locator, label: string, what: string) {
  await expect
    .poll(async () => (await select.locator('option').allTextContents()).filter((t) => t.includes(label)).length,
      { message: `the ${what} picker never offered "${label}"`, timeout: 30_000 })
    .toBeGreaterThan(0);
  // Matched on the visible TEXT and then selected by the option's `value`, not
  // by `{ label }`: option text carries the trailing whitespace of a JSX
  // fragment (`{c.name} {c.company && …}`) and an exact-label match misses it.
  // The value is an id and is never rendered or asserted — the same distinction
  // `_shared.jsx::dealPath` makes about an id in a URL.
  const texts = await select.locator('option').allTextContents();
  const idx = texts.findIndex((t) => t.includes(label));
  expect(idx, `no ${what} option matching "${label}"`).toBeGreaterThan(-1);
  const value = await select.locator('option').nth(idx).getAttribute('value');
  await select.selectOption(value!);
}

/**
 * Open a contact's record by NAME — through the product's own search.
 *
 * ⚠ NOT by clicking a row on page one. `useTableView` pages at 25
 * (`PAGE_SIZES[0]`) and `list_contacts` orders `created_at DESC`, so with fifty
 * contacts the first one typed is on page THREE and a naive click finds
 * nothing. The search is server-side and reaches every row, which is also the
 * path a person takes.
 */
async function openContactRecord(page: Page, name: string) {
  await gotoTab(page, 'contacts');
  const p = panel(page, 'contacts');
  const box = p.locator('input.gr__search');
  await box.fill(name);
  // Typing is not searching — `ContactsTab` fires `load()` on Enter only.
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => /\/graha\/contacts\?/.test(r.url()) && r.request().method() === 'GET' && /search=/.test(r.url()),
      { timeout: 40_000 },
    ),
    box.press('Enter'),
  ]);
  expect(res.status(), `searching for "${name}" answered ${res.status()}`).toBeLessThan(400);
  await settle(page);
  await p.getByRole('button', { name, exact: true }).click();
  await expect(p.locator('.gr__dname'), `the search for "${name}" opened a different record`)
    .toHaveText(name, { timeout: 30_000 });
  return p;
}

/** The same for a company. `ClientsTab` refetches on every keystroke, so the
 *  request follows the `fill()` without a commit key. */
async function openClientRecord(page: Page, name: string) {
  await gotoTab(page, 'clients');
  const p = panel(page, 'clients');
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => /\/graha\/clients\?/.test(r.url()) && r.request().method() === 'GET' && /search=/.test(r.url()),
      { timeout: 40_000 },
    ),
    p.locator('input.gr__search').fill(name),
  ]);
  expect(res.status(), `searching for "${name}" answered ${res.status()}`).toBeLessThan(400);
  await settle(page);
  await p.getByRole('button', { name, exact: true }).click();
  await expect(p.locator('.gr__dname'), `the search for "${name}" opened a different record`)
    .toHaveText(name, { timeout: 30_000 });
  return p;
}

/**
 * §6 — create only what is missing.
 *
 * Reads the live list first. A name already present is VERIFIED and not typed
 * again, which is what makes a second execution recognise its own output rather
 * than double it. Returns how many it actually had to type, so a test can say
 * which half of §6 it exercised.
 */
async function ensure(
  page: Page,
  wanted: number[],
  existing: Set<string>,
  nameOf: (n: number) => string,
  create: (n: number) => Promise<void>,
): Promise<{ typed: number; found: number }> {
  let typed = 0;
  let found = 0;
  for (const n of wanted) {
    if (existing.has(nameOf(n))) { found++; continue; }
    await create(n);
    typed++;
  }
  return { typed, found };
}

/** The set of names already on a list, for `ensure()`. */
const namesOf = (rows: any[], key = 'name') =>
  new Set(rows.map((r) => String(r?.[key] ?? '').trim()).filter(Boolean));

// ════════════════════════════════════════════════════════════════════════════
// THE SUITE
// ════════════════════════════════════════════════════════════════════════════

test.describe('Suite 04 — Graha (CRM) · Unicode Group', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 04.01 · the empty states, in words, BEFORE the data exists
  // ──────────────────────────────────────────────────────────────────────────
  test('04.01 every list says in words that it is empty — or that it is not', async ({ page }) => {
    const con = watchConsole(page);
    await signIn(page);

    /**
     * ⚠ THIS TEST HAS TWO BRANCHES AND NEITHER IS A SKIP.
     *
     * §6 says the suite must be re-runnable, and an empty-state assertion is
     * true exactly once. So each screen is checked against the LIVE count first,
     * and then asserted for the state it is genuinely in: the empty state's own
     * words when there are no rows, the populated surface when there are. Both
     * are specific and both can fail. The branch taken is printed, because "the
     * empty state was proved" is only a claim about the run that found zero.
     */
    const screens: {
      tab: string; endpoint: string; emptyTitle: RegExp; populated: (p: Locator) => Locator;
    }[] = [
      { tab: 'clients', endpoint: '/api/v1/graha/clients', emptyTitle: /No clients yet/i, populated: (p) => p.locator('table.tbl tbody tr') },
      { tab: 'contacts', endpoint: '/api/v1/graha/contacts', emptyTitle: /No contacts yet/i, populated: (p) => p.locator('table.tbl tbody tr') },
      { tab: 'deals', endpoint: '/api/v1/graha/deals', emptyTitle: /No deals yet|No open deals|No deals in/i, populated: (p) => p.locator('.gr__card') },
      { tab: 'labels', endpoint: '/api/v1/graha/labels', emptyTitle: /No labels yet/i, populated: (p) => p.locator('.gr__lcard') },
      { tab: 'activities', endpoint: '/api/v1/graha/activities', emptyTitle: /No activities logged/i, populated: (p) => p.locator('table.tbl tbody tr') },
      { tab: 'follow-ups', endpoint: '/api/v1/graha/follow-ups', emptyTitle: /No follow-ups/i, populated: (p) => p.locator('.gr__card') },
      { tab: 'territories', endpoint: '/api/v1/graha/territories', emptyTitle: /No territories yet/i, populated: (p) => p.locator('.gr__lrow') },
      { tab: 'fields', endpoint: '/api/v1/graha/custom-fields', emptyTitle: /No custom fields yet/i, populated: (p) => p.locator('.gr__lrow') },
      { tab: 'web-forms', endpoint: '/api/v1/graha/web-forms', emptyTitle: /No web forms yet/i, populated: (p) => p.locator('.gr__lrow') },
    ];

    expect(screens.length, 'the empty-state sweep must cover every list screen it claims to')
      .toBeGreaterThanOrEqual(9);

    const verdicts: string[] = [];
    for (const s of screens) {
      con.at(s.tab);
      const rows = await apiRows(page, s.endpoint);
      await gotoTab(page, s.tab);
      const p = panel(page, s.tab);

      if (rows.length === 0) {
        await expect(
          p.locator('.empty__title'),
          `${s.tab} holds 0 rows and the screen does not say so in words — an empty ` +
          'list that says nothing is indistinguishable from one that failed to load',
        ).toBeVisible({ timeout: 30_000 });
        await expect(p.locator('.empty__title')).toContainText(s.emptyTitle);
        await expect(
          p.locator('.empty__body'),
          `${s.tab}'s empty state has a heading and no sentence explaining what the ` +
          'thing IS — the heading alone tells a first-time reader nothing',
        ).toBeVisible();
        verdicts.push(`${s.tab}: EMPTY — asserted the words`);
      } else {
        await expect(
          s.populated(p).first(),
          `${s.tab} holds ${rows.length} row(s) and the screen rendered none of them`,
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          p.locator('.empty__title'),
          `${s.tab} holds ${rows.length} row(s) and is STILL painting its empty state — ` +
          'a confident wrong answer, which is the failure mode this screen family has had before',
        ).toHaveCount(0);
        verdicts.push(`${s.tab}: ${rows.length} row(s) — asserted the list, not the empty state`);
      }
    }

    console.log('\n  04.01 empty-state sweep:\n     ' + verdicts.join('\n     ') + '\n');

    expect(
      con.errors.filter((e) => e.text.startsWith('UNCAUGHT')),
      `uncaught errors while touring the empty screens:${dumpConsole(con)}`,
    ).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.02 · 25 clients, every one with a full Indian address and a PIN
  // ──────────────────────────────────────────────────────────────────────────
  test('04.02 twenty-five clients are typed in, each with a full Indian address', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    con.at('clients');
    await gotoTab(page, 'clients');

    const before = await apiRows(page, '/api/v1/graha/clients');
    const have = namesOf(before);
    const p = panel(page, 'clients');

    const createClient = async (n: number) => {
      const place = PLACES[(n - 1) % 6];
      const pin = place.pins[(n - 1) % 2];

      await p.getByRole('button', { name: '+ Add Client' }).click();
      const form = p.locator('.gr__panel').filter({ hasText: 'New Client' });
      await expect(form, 'the New Client panel did not open').toBeVisible({ timeout: 15_000 });

      await form.getByLabel('Company name').fill(clientName(n));
      await form.getByLabel('Reference number').fill(`${TAG}-C${pad(n)}`);
      // ⚠ GSTIN IS LEFT BLANK ON EVERY THIRD COMPANY, DELIBERATELY.
      // GSTIN/PAN/TAN are non-mandatory by owner rule and must block nothing.
      // This has drifted back more than once, so the suite exercises the blank
      // path at volume rather than asserting it once in a corner.
      if (n % 3 !== 0) await form.getByLabel('GSTIN').fill(`24AAACS${String(1000 + n)}A1Z${n % 10}`);
      await form.getByLabel('Website').fill(`https://example.com/${TAG.toLowerCase()}-${pad(n)}`);
      await form.getByLabel('Address line 1').fill(`${100 + n}, Kartavya Chambers`);
      await form.getByLabel('Address line 2').fill(`Ring Road, Sector ${((n - 1) % 9) + 1}`);
      await form.getByLabel('City').fill(place.city);
      await form.getByLabel('State').fill(place.state);
      await form.getByLabel('Pincode').fill(pin);
      await form.locator('textarea').fill(`Typed by Suite 04 · run ${RUN}`);

      await saveAndWait(
        page,
        () => form.getByRole('button', { name: 'Create' }).click(),
        /\/graha\/clients(\?|$)/,
        `creating ${clientName(n)}`,
      );
      await expect(form, 'the New Client panel stayed open after a successful create')
        .toBeHidden({ timeout: 20_000 });
    };

    const stat = await ensure(page, [...Array(N_CLIENTS)].map((_, i) => i + 1), have, clientName, createClient);
    console.log(`\n  04.02 clients — typed ${stat.typed}, already present ${stat.found}\n`);

    // ── The read-back. Every one, by NAME, with its address intact. ─────────
    const after = await apiRows(page, '/api/v1/graha/clients');
    const byName = new Map(after.map((c) => [String(c.name), c]));
    expect(
      after.length,
      `only ${after.length} client(s) exist after typing ${N_CLIENTS}. Wire:${dumpWire(wire)}`,
    ).toBeGreaterThanOrEqual(N_CLIENTS);

    let withPin = 0;
    for (let n = 1; n <= N_CLIENTS; n++) {
      const row = byName.get(clientName(n));
      expect(row, `${clientName(n)} is not in the list the server answers with`).toBeTruthy();
      const addr = row.address || {};
      expect(String(addr.city || ''), `${clientName(n)} lost its city`).toBe(PLACES[(n - 1) % 6].city);
      expect(String(addr.state || ''), `${clientName(n)} lost its state`).toBe(PLACES[(n - 1) % 6].state);
      expect(String(addr.pincode || ''), `${clientName(n)} lost its pincode`).toBe(PLACES[(n - 1) % 6].pins[(n - 1) % 2]);
      if (addr.pincode) withPin++;
    }
    expect(withPin, 'every client must carry a pincode — §4').toBe(N_CLIENTS);

    // ── GSTIN blank blocks nothing, proved from the stored rows ────────────
    const blanks = [...byName.entries()].filter(([k, v]) => k.startsWith(`${TAG} Client`) && !String(v.gstin || '').trim());
    expect(
      blanks.length,
      'not one company saved with a blank GSTIN. GSTIN/PAN/TAN are non-mandatory ' +
      'by owner rule and must block nothing — if the create refused them, that is ' +
      `the regression this assertion exists for. Wire:${dumpWire(wire)}`,
    ).toBeGreaterThanOrEqual(Math.floor(N_CLIENTS / 3));

    // ── The record opens, and it is the right company ──────────────────────
    await openClientRecord(page, clientName(1));
    await expect(p.getByText(PLACES[0].pins[0]).first(), 'the record does not show the pincode it was saved with')
      .toBeVisible();

    // ── And it edits. The note carries this run's stamp, so the read-back
    //    proves THIS execution's write and not the last one's. ─────────────
    await p.getByRole('button', { name: 'Edit', exact: true }).click();
    const editForm = p.locator('.gr__panel').filter({ hasText: 'Edit Client' });
    await expect(editForm).toBeVisible({ timeout: 15_000 });
    const note = `Edited by Suite 04 · run ${RUN}`;
    await typeInto(editForm.locator('textarea'), note);
    await saveAndWait(
      page,
      () => editForm.getByRole('button', { name: 'Update' }).click(),
      /\/graha\/clients\//,
      'updating the first client',
    );
    const reread = await apiRows(page, '/api/v1/graha/clients?search=' + encodeURIComponent(clientName(1)));
    const edited = reread.find((c) => c.name === clientName(1));
    expect(String(edited?.notes || ''), `the client note did not persist. Wire:${dumpWire(wire)}`).toBe(note);

    expect(con.errors.filter((e) => e.text.startsWith('UNCAUGHT')),
      `uncaught errors on the clients screen:${dumpConsole(con)}`).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.03 · six custom fields, one per input type
  // ──────────────────────────────────────────────────────────────────────────
  test('04.03 six custom fields are defined, one per input type, and they render', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    con.at('fields');
    await gotoTab(page, 'fields');
    const p = panel(page, 'fields');

    const before = await apiRows(page, '/api/v1/graha/custom-fields');
    const have = new Set(before.map((f) => String(f.field_name)));

    expect(CUSTOM_FIELDS.length, '§4 asks for one custom field per input type').toBe(N_FIELDS);

    for (const f of CUSTOM_FIELDS) {
      if (have.has(f.name)) continue;
      await p.getByRole('button', { name: '+ New Field' }).click();
      const form = p.locator('form.gr__panel');
      await expect(form, 'the New Field form did not open').toBeVisible({ timeout: 15_000 });
      await form.locator('select').first().selectOption({ label: 'Contact' });
      await form.locator('input.k-input').first().fill(f.name);
      await form.locator('select').nth(1).selectOption(f.type);
      await saveAndWait(
        page,
        () => form.getByRole('button', { name: 'Create', exact: true }).click(),
        /\/graha\/custom-fields(\?|$)/,
        `creating custom field ${f.name}`,
      );
      await expect(form).toBeHidden({ timeout: 20_000 });
    }

    const after = await apiRows(page, '/api/v1/graha/custom-fields');
    const byName = new Map(after.map((f) => [String(f.field_name), f]));
    for (const f of CUSTOM_FIELDS) {
      expect(byName.get(f.name), `custom field "${f.name}" is not stored. Wire:${dumpWire(wire)}`).toBeTruthy();
      expect(String(byName.get(f.name).field_type), `${f.name} stored the wrong type`).toBe(f.type);
    }

    // ── They must actually REACH a form. A field defined and rendered nowhere
    //    is exactly the defect `CustomFieldInputs.jsx` was written to end. ──
    con.at('contacts');
    await gotoTab(page, 'contacts');
    const cp = panel(page, 'contacts');
    await cp.getByRole('button', { name: '+ Add Contact' }).click();
    const cform = cp.locator('form.gr__panel');
    await expect(cform).toBeVisible({ timeout: 15_000 });

    // ⚠ COUNT FIRST. A loop over an empty set asserts nothing and passes for
    // ever — the exact shape of 02.3's vacuous checkbox sweep.
    const rendered = cform.locator('label.gr__f').filter({ hasText: `${TAG} CF` });
    await expect
      .poll(async () => await rendered.count(),
        { message: 'not one custom field reached the contact form', timeout: 20_000 })
      .toBeGreaterThanOrEqual(N_FIELDS);

    for (const f of CUSTOM_FIELDS) {
      const wrap = cform.locator('label.gr__f').filter({ hasText: f.name }).first();
      await expect(wrap, `the "${f.name}" field is defined and does not render on the contact form`)
        .toBeVisible();
      if (f.type === 'date') {
        // Never a native date input — the product's own picker or nothing.
        await expect(wrap.locator('.pk--dt button.pk__tr'),
          `the "${f.name}" custom field is a date and did not render DateInput`).toBeVisible();
        await expect(wrap.locator('input[type="date"]:not(.pk__native)'),
          'a native <input type="date"> reached a Graha form').toHaveCount(0);
      } else {
        await expect(wrap.locator(`input[type="${f.html}"]`),
          `the "${f.name}" custom field did not render an <input type="${f.html}">`).toBeVisible();
      }
    }
    await cform.getByRole('button', { name: 'Cancel' }).click();

    // ── AND THE GAP, said out loud rather than left as a silent cap ────────
    // `CustomFieldsTab.jsx` offers `select` in the type dropdown and the form
    // has NO control for its options; `CustomFieldInputs` then renders
    // `<option value="">— Select —</option>` and nothing else. A select field is
    // creatable and unusable. Not created here, and not glossed over: it is
    // reported. The six above are the six types a person can actually fill in.
    const selectable = ['text', 'number', 'date', 'select', 'checkbox', 'url', 'email', 'phone'];
    expect(selectable.length, 'the product offers eight custom-field types').toBe(8);
    console.log(
      `\n  04.03 — the product offers 8 custom-field types; §4 asks for 6 and 6 are ` +
      `created.\n     NOT created: "select" (the New Field form has no control for its ` +
      `options, so a select field can only ever offer "— Select —") and "checkbox".\n`,
    );

    expect(con.errors.filter((e) => e.text.startsWith('UNCAUGHT')),
      `uncaught errors on the fields/contacts screens:${dumpConsole(con)}`).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.04 · 50 contacts (+3 deliberate duplicates), all addressed
  // ──────────────────────────────────────────────────────────────────────────
  test('04.04 fifty contacts are typed in against the companies, with addresses', async ({ page }) => {
    test.setTimeout(45 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    con.at('contacts');
    await gotoTab(page, 'contacts');
    const p = panel(page, 'contacts');

    const clients = await apiRows(page, '/api/v1/graha/clients');
    expect(clients.length, '04.02 must run before 04.04 — there are no companies to file people under')
      .toBeGreaterThanOrEqual(N_CLIENTS);

    const before = await apiRows(page, '/api/v1/graha/contacts');
    const have = namesOf(before);

    const TYPES = ['lead', 'customer', 'vendor', 'partner'];
    const SOURCES = ['website', 'referral', 'indiamart', 'justdial', 'manual'];

    /** One contact, typed. `n` is 1..50; `dup` re-uses another contact's email. */
    const createContact = async (name: string, n: number, dupOf?: number) => {
      const place = PLACES[(n - 1) % 6];
      const pin = place.pins[(n - 1) % 2];
      await p.getByRole('button', { name: '+ Add Contact' }).click();
      const form = p.locator('form.gr__panel');
      await expect(form, 'the New Contact form did not open').toBeVisible({ timeout: 15_000 });

      const f = (label: string) => form.locator('label.gr__f').filter({ hasText: label }).first();
      await f('Name *').locator('input').fill(name);
      await f('Type').locator('select').selectOption(TYPES[(n - 1) % TYPES.length]);
      await f('Email').locator('input').fill(dupOf ? contactEmail(dupOf) : contactEmail(n));
      await f('Phone / Mobile').locator('input').fill(dupOf ? dupePhone(n) : contactPhone(n));
      await f('Designation').locator('input').fill(['Director', 'Partner', 'Manager', 'Proprietor'][(n - 1) % 4]);
      // Blank on every third person, for the same owner rule 04.02 exercises.
      if (n % 3 !== 0) await f('GSTIN').locator('input').fill(`27AAACS${String(2000 + n)}B1Z${n % 10}`);
      await f('Source').locator('input').fill(SOURCES[(n - 1) % SOURCES.length]);
      await pickByLabel(
        f('Client / Company').locator('select'),
        clientName(((n - 1) % N_CLIENTS) + 1),
        'client/company',
      );
      await f('Address line 1').locator('input').fill(`${200 + n}, Trade House`);
      await f('Address line 2').locator('input').fill(`Near ${place.city} Junction`);
      await f('City').locator('input').fill(place.city);
      await f('State').locator('input').fill(place.state);
      await f('Pincode').locator('input').fill(pin);

      await saveAndWait(
        page,
        () => form.getByRole('button', { name: /Create Contact|Saving/ }).click(),
        /\/graha\/contacts(\?|$)/,
        `creating ${name}`,
      );
      await expect(form, 'the New Contact form stayed open after a successful create')
        .toBeHidden({ timeout: 20_000 });
    };

    const stat = await ensure(
      page, [...Array(N_CONTACTS)].map((_, i) => i + 1), have, contactName,
      (n) => createContact(contactName(n), n),
    );

    // ── Three deliberate duplicates, so 04.18 has something real to merge ──
    // They share an EMAIL with contacts 1-3 and carry their own phone, because
    // `idx_graha_contacts_org_phone` is UNIQUE and a shared phone would be a
    // 500 rather than a duplicate group.
    let dupesTyped = 0;
    for (let d = 1; d <= N_DUPES; d++) {
      if (have.has(dupeName(d))) continue;
      await createContact(dupeName(d), 900 + d, d);
      dupesTyped++;
    }
    console.log(`\n  04.04 contacts — typed ${stat.typed}, already present ${stat.found}, duplicates typed ${dupesTyped}\n`);

    // ── The read-back ──────────────────────────────────────────────────────
    const after = await apiRows(page, '/api/v1/graha/contacts');
    const byName = new Map(after.map((c) => [String(c.name), c]));
    expect(after.length, `only ${after.length} contact(s) exist. Wire:${dumpWire(wire)}`)
      .toBeGreaterThanOrEqual(N_CONTACTS);

    let addressed = 0;
    let linked = 0;
    const typesSeen = new Set<string>();
    for (let n = 1; n <= N_CONTACTS; n++) {
      const row = byName.get(contactName(n));
      expect(row, `${contactName(n)} is not in the list the server answers with`).toBeTruthy();

      /**
       * ⚠ THE ADDRESS IS READ OFF THE RECORD, NOT OFF THE LIST — and this line
       * used to be wrong in a way worth recording.
       *
       * It read `row.billing_address` from `GET /v1/graha/contacts` and failed
       * all fifty with "lost its pincode". The addresses were fine. That list's
       * SELECT is explicit column by column (routers/graha.py:613) and
       * `billing_address` is simply not one of them — the list carries `gstin`
       * because the invoice form needs the state code, and nothing else from
       * the address. The detail route carries the whole object.
       *
       * So the assertion is unchanged in strictness and only repointed at the
       * endpoint that holds the column. It is the more expensive check and the
       * truer one: fifty separate records, each read back on its own.
       */
      const rec = await apiOne(page, `/api/v1/graha/contacts/${row.id}`);
      const addr = (rec?.contact ?? rec)?.billing_address || {};
      expect(String(addr.pincode || ''), `${contactName(n)} lost its pincode`).toBe(PLACES[(n - 1) % 6].pins[(n - 1) % 2]);
      expect(String(addr.city || ''), `${contactName(n)} lost its city`).toBe(PLACES[(n - 1) % 6].city);
      expect(String(addr.line1 || ''), `${contactName(n)} lost its street address`).toBe(`${200 + n}, Trade House`);
      if (addr.pincode) addressed++;
      // A CRM client is the COMPANY. The contact must be filed under one.
      if (row.client_id) linked++;
      typesSeen.add(String(row.contact_type));
    }
    expect(addressed, 'every contact must carry a full address and a PIN — §4').toBe(N_CONTACTS);
    expect(linked, 'every contact must be filed under the company it belongs to — a CRM client IS the company')
      .toBe(N_CONTACTS);
    expect([...typesSeen].sort(), 'all four contact types must be exercised')
      .toEqual(['customer', 'lead', 'partner', 'vendor']);

    // GSTIN blank blocked nothing here either.
    const blank = [...byName.entries()]
      .filter(([k, v]) => k.startsWith(`${TAG} Contact`) && !String(v.gstin || '').trim());
    expect(blank.length, 'not one contact saved with a blank GSTIN — the non-mandatory rule has drifted')
      .toBeGreaterThan(0);

    expect(con.errors.filter((e) => e.text.startsWith('UNCAUGHT')),
      `uncaught errors on the contacts screen:${dumpConsole(con)}`).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.05 · the contact record, and the custom fields being FILLED
  // ──────────────────────────────────────────────────────────────────────────
  test('04.05 a contact record opens, edits, and stores its custom fields', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    con.at('contacts');
    const p = await openContactRecord(page, contactName(1));

    // The record shows the address the person typed — `AddressBlock`, not a
    // guard at the call site. And it shows the company by NAME.
    await expect(p.getByText(PLACES[0].pins[0]).first(), 'the contact record does not show the stored pincode')
      .toBeVisible();
    await expect(p.locator('.gr__sub').first(), 'the contact record does not name the company')
      .toContainText(clientName(1));

    await p.getByRole('button', { name: 'Edit', exact: true }).click();
    const form = p.locator('.gr__panel').filter({ hasText: 'Edit Contact' });
    await expect(form).toBeVisible({ timeout: 15_000 });

    const f = (label: string) => form.locator('label.gr__f').filter({ hasText: label }).first();

    // ⚠ Count before looping.
    const cf = form.locator('label.gr__f').filter({ hasText: `${TAG} CF` });
    await expect.poll(async () => await cf.count(),
      { message: 'the edit panel renders no custom fields — 04.03 defined six', timeout: 20_000 })
      .toBeGreaterThanOrEqual(N_FIELDS);

    const values: Record<string, string> = {};
    values[`${TAG} CF text`] = `typed ${RUN}`;
    values[`${TAG} CF number`] = String((Number(RUN.slice(-4)) % 900) + 100);
    values[`${TAG} CF url`] = `https://example.com/s04/${RUN}`;
    values[`${TAG} CF email`] = `s04.custom.${RUN}@example.com`;
    values[`${TAG} CF phone`] = '9876500001';

    for (const [name, v] of Object.entries(values)) {
      const wrap = form.locator('label.gr__f').filter({ hasText: name }).first();
      await expect(wrap, `the "${name}" custom field is missing from the edit panel`).toBeVisible();
      await typeInto(wrap.locator('input'), v);
    }
    // The date one goes through the product's own picker, never a native input.
    const iso = `${new Date().getFullYear()}-09-15`;
    await setDate(form, `${TAG} CF date`, iso);

    await saveAndWait(
      page,
      () => form.getByRole('button', { name: /^Save$|^Saving/ }).click(),
      /\/graha\/contacts\//,
      'saving the contact edit',
    );

    // ── Stored, keyed by FIELD ID (a rename must not orphan the value) ─────
    const fields = await apiRows(page, '/api/v1/graha/custom-fields?entity_type=contact');
    const contacts = await apiRows(page, '/api/v1/graha/contacts?search=' + encodeURIComponent(contactName(1)));
    const rec = contacts.find((c) => c.name === contactName(1));
    expect(rec, 'the contact vanished from the list after being edited').toBeTruthy();
    const cd = rec.custom_data || {};
    for (const [name, v] of Object.entries(values)) {
      const def = fields.find((x) => String(x.field_name) === name);
      expect(def, `custom field "${name}" is no longer defined`).toBeTruthy();
      expect(String(cd[def.id] ?? ''), `"${name}" did not persist. Wire:${dumpWire(wire)}`).toBe(v);
    }
    const dateDef = fields.find((x) => String(x.field_name) === `${TAG} CF date`);
    expect(String(cd[dateDef.id] ?? ''), `the date custom field did not persist. Wire:${dumpWire(wire)}`).toBe(iso);

    expect(con.errors.filter((e) => e.text.startsWith('UNCAUGHT')),
      `uncaught errors on the contact record:${dumpConsole(con)}`).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.06 · eight labels, and assigning them
  // ──────────────────────────────────────────────────────────────────────────
  test('04.06 eight labels are created and assigned to contacts', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    con.at('labels');
    await gotoTab(page, 'labels');
    const p = panel(page, 'labels');

    const before = await apiRows(page, '/api/v1/graha/labels');
    const have = namesOf(before);
    const COLOURS = ['#6366f1', '#0ea5e9', '#16a34a', '#ca8a04', '#dc2626', '#7c3aed', '#0f766e', '#b45309'];

    const createLabel = async (n: number) => {
      await p.getByRole('button', { name: '+ New Label' }).click();
      const form = p.locator('form.gr__panel').first();
      await expect(form, 'the New Label form did not open').toBeVisible({ timeout: 15_000 });
      await form.locator('input.k-input').first().fill(labelName(n));
      // A colour input is user data, not a design token — the product feeds it
      // to `<input type="color">`, which only accepts #rrggbb.
      await form.locator('input[type="color"]').fill(COLOURS[(n - 1) % COLOURS.length]);
      await saveAndWait(
        page,
        () => form.getByRole('button', { name: /^Create$|^Creating/ }).click(),
        /\/graha\/labels(\?|$)/,
        `creating ${labelName(n)}`,
      );
      await expect(form).toBeHidden({ timeout: 20_000 });
    };

    const stat = await ensure(page, [...Array(N_LABELS)].map((_, i) => i + 1), have, labelName, createLabel);
    console.log(`\n  04.06 labels — typed ${stat.typed}, already present ${stat.found}\n`);

    const after = await apiRows(page, '/api/v1/graha/labels');
    const names = namesOf(after);
    for (let n = 1; n <= N_LABELS; n++) {
      expect(names.has(labelName(n)), `${labelName(n)} is not stored. Wire:${dumpWire(wire)}`).toBeTruthy();
    }

    // ── Assign each label to a contact, through the real Assign form ───────
    await gotoTab(page, 'labels');
    for (let n = 1; n <= N_LABELS; n++) {
      await p.getByRole('button', { name: 'Assign to Contact' }).click();
      const af = p.locator('form.gr__panel').filter({ hasText: 'Assign Label to Contact' });
      await expect(af, 'the Assign form did not open').toBeVisible({ timeout: 15_000 });
      await pickByLabel(af.locator('select').first(), contactName(n), 'contact');
      await pickByLabel(af.locator('select').nth(1), labelName(n), 'label');
      await saveAndWait(
        page,
        () => af.getByRole('button', { name: 'Assign' }).click(),
        /\/graha\/contacts\/.+\/labels\//,
        `assigning ${labelName(n)} to ${contactName(n)}`,
      );
      await expect(af).toBeHidden({ timeout: 20_000 });
    }

    // ── And the chip is on the RECORD ─────────────────────────────────────
    con.at('contacts');
    const cp = await openContactRecord(page, contactName(1));
    await expect(cp.locator('.gr__chip').filter({ hasText: labelName(1) }),
      `${labelName(1)} was assigned and does not appear on ${contactName(1)}'s record`)
      .toBeVisible({ timeout: 25_000 });

    expect(con.errors.filter((e) => e.text.startsWith('UNCAUGHT')),
      `uncaught errors on the labels screen:${dumpConsole(con)}`).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.07 · six territories, their PIN sets, their people — and routing
  // ──────────────────────────────────────────────────────────────────────────
  test('04.07 six territories claim PIN sets, carry members, and route the contacts', async ({ page }) => {
    test.setTimeout(25 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    con.at('territories');
    await gotoTab(page, 'territories');
    const p = panel(page, 'territories');

    const before = await apiRows(page, '/api/v1/graha/territories');
    const have = namesOf(before);

    const createTerritory = async (n: number) => {
      const place = PLACES[n - 1];
      await p.getByRole('button', { name: '+ New Territory' }).click();
      const form = p.locator('form.gr__panel');
      await expect(form, 'the New Territory form did not open').toBeVisible({ timeout: 15_000 });

      await form.locator('label.gr__f').filter({ hasText: 'Name' }).first().locator('input').fill(territoryName(n));
      await form.locator('label.gr__f').filter({ hasText: 'Description' }).first().locator('input')
        .fill(`${place.city} patch · ${place.state}`);

      // The pincodes, typed as a person types them and validated to six digits.
      await form.getByLabel('Pincodes').fill(place.pins.join(', '));
      await form.getByRole('button', { name: 'Add' }).last().click();
      const chips = form.locator('.gr__group').filter({ hasText: 'Pincodes covered' }).locator('.gr__tok');
      await expect(chips, `the pincode chips did not appear for ${territoryName(n)}`)
        .toHaveCount(place.pins.length, { timeout: 15_000 });

      // A REAL member, chosen from the real dropdown of real members.
      // ⚠ Positionally and never by name: this suite did not create these
      // people, and a human accepted one of this programme's invitations
      // mid-run once already. The assertion below counts chips.
      const memberSelect = form.getByLabel('Person to add');
      await expect
        .poll(async () => await memberSelect.locator('option').count(),
          { message: 'the member dropdown never loaded anybody', timeout: 25_000 })
        .toBeGreaterThan(1);
      const value = await memberSelect.locator('option').nth(1).getAttribute('value');
      await memberSelect.selectOption(value!);
      await form.getByRole('button', { name: 'Add' }).first().click();
      const people = form.locator('.gr__group').filter({ hasText: 'Assigned Users' }).locator('.gr__tok');
      await expect(people, 'the member chip did not appear').toHaveCount(1, { timeout: 15_000 });

      await saveAndWait(
        page,
        () => form.getByRole('button', { name: /^Create$/ }).click(),
        /\/graha\/territories(\?|$)/,
        `creating ${territoryName(n)}`,
      );
      await expect(form).toBeHidden({ timeout: 20_000 });
    };

    const stat = await ensure(page, [...Array(N_TERRITORIES)].map((_, i) => i + 1), have, territoryName, createTerritory);
    console.log(`\n  04.07 territories — typed ${stat.typed}, already present ${stat.found}\n`);

    const after = await apiRows(page, '/api/v1/graha/territories');
    const byName = new Map(after.map((t) => [String(t.name), t]));
    for (let n = 1; n <= N_TERRITORIES; n++) {
      const t = byName.get(territoryName(n));
      expect(t, `${territoryName(n)} is not stored. Wire:${dumpWire(wire)}`).toBeTruthy();
      expect((t.rules?.pincodes || []).sort(), `${territoryName(n)} lost its pincode rule`)
        .toEqual([...PLACES[n - 1].pins].sort());
      expect((t.assigned_users || []).length, `${territoryName(n)} has nobody covering it`)
        .toBeGreaterThanOrEqual(1);
    }

  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.07b · TERRITORY PRIORITY — §4 asks, and there is nowhere to put it
  // ──────────────────────────────────────────────────────────────────────────
  //
  // Its own test, deliberately. It was a closing assertion inside 04.07 and
  // that made one red result mean two different things — "the six territories
  // did not get made" and "the form has no priority box" read identically in a
  // run summary. Split, 04.07 answers only for the work it did.
  test('04.07b a territory carries a priority, so overlapping patches resolve predictably',
    async ({ page }) => {
      test.setTimeout(10 * 60_000);
      await signIn(page);
      await gotoTab(page, 'territories');
      const p = panel(page, 'territories');

      await p.getByRole('button', { name: '+ New Territory' }).click();
      const nf = p.locator('form.gr__panel');
      await expect(nf, 'the New Territory form did not open').toBeVisible({ timeout: 15_000 });
      const fields = (await nf.locator('label.gr__f .gr__fl, .gr__group > .gr__fl').allTextContents())
        .map((t) => t.trim()).filter(Boolean);
      const priority = await nf.locator('label.gr__f, .gr__group').filter({ hasText: /priorit/i }).count();
      await nf.getByRole('button', { name: 'Cancel' }).click();

      // Whether an OVERLAP is even detectable is the other half: the backfill
      // report has an `overlaps` array, so the product knows two patches can
      // claim one PIN — it simply gives the customer no way to say which wins.
      const territories = await apiRows(page, '/api/v1/graha/territories');
      const withPriority = territories.filter((t) => 'priority' in t || (t.rules || {}).priority != null);

      expect(
        priority,
        '\n  ⚠ A TERRITORY CANNOT BE GIVEN A PRIORITY.\n' +
        `     The New Territory form offers: ${fields.join(' | ') || '(no labelled fields)'}\n` +
        `     ${territories.length} live territor(ies) and ${withPriority.length} carry a priority of any kind.\n` +
        '\n' +
        '     `TerritoriesTab.jsx` renders Name, Description, Assigned Users and\n' +
        '     Pincodes covered — nothing else — and `TerritoryCreate` in\n' +
        '     routers/graha.py carries `name`, `description`, `assigned_users` and\n' +
        '     `rules` only. `rules` is free-form jsonb and the form writes exactly one\n' +
        '     key into it, `pincodes`; the tab\'s own comment says a save from this\n' +
        '     screen REPLACES the whole column, so a priority stored there by any\n' +
        '     other means would be deleted the next time somebody edits the patch.\n' +
        '\n' +
        '     It is not academic. `POST /contacts/route-all` returns an `overlaps`\n' +
        '     array and the tab prints "N pincode(s) claimed by more than one\n' +
        '     territory" — so the product detects the collision, resolves it inside\n' +
        '     `territory_routing` and tells the customer about it afterwards, with no\n' +
        '     control anywhere to decide the outcome in advance.\n' +
        '     REPORTED WITHOUT A VERDICT — 93 §14.\n',
      ).toBeGreaterThan(0);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.08 · two routing runs over the contacts
  // ──────────────────────────────────────────────────────────────────────────
  test('04.08 the pincode backfill runs twice and reports honestly both times', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    // `routeAll()` guards itself with `window.confirm` — it rewrites live rows
    // across the whole organisation, so the product asks first and so must this.
    page.on('dialog', (d) => d.accept().catch(() => {}));
    con.at('territories');
    await gotoTab(page, 'territories');
    const p = panel(page, 'territories');

    const contacts = await apiRows(page, '/api/v1/graha/contacts');
    expect(contacts.length, '04.04 must run before 04.08 — there is nothing to route')
      .toBeGreaterThanOrEqual(N_CONTACTS);

    const reports: any[] = [];
    for (const pass of [1, 2]) {
      const res = await saveAndWait(
        page,
        () => p.getByRole('button', { name: /File contacts by pincode|Filing/ }).click(),
        /\/graha\/contacts\/route-all/,
        `routing pass ${pass}`,
      );
      const body = await res.json();
      const report = body?.data ?? body;
      reports.push(report);

      // The panel must SAY what happened. A backfill that rewrites rows across
      // the org and reports nothing on screen is a button with no receipt.
      const panelReport = p.locator('.gr__panel').filter({ hasText: 'Filed by pincode' });
      await expect(panelReport, `routing pass ${pass} produced no report panel`)
        .toBeVisible({ timeout: 25_000 });
      await expect(panelReport).toContainText(/Newly filed:/);
      await expect(panelReport).toContainText(/No territory claims that pincode:/);
      await panelReport.getByRole('button', { name: 'Dismiss' }).click();
      await expect(panelReport).toBeHidden({ timeout: 15_000 });
    }

    expect(reports.length, 'two routing runs — §4').toBe(2);
    for (const [i, r] of reports.entries()) {
      expect(Number(r.considered ?? -1), `routing pass ${i + 1} considered nothing`)
        .toBeGreaterThanOrEqual(N_CONTACTS);
      /**
       * ⚠ `with_a_pin` COUNTS ONLY THE UNFILED, and this assertion used to
       * demand it of both passes.
       *
       * `route_all_contacts` (routers/graha.py:3374) `continue`s on
       * `already_filed` BEFORE it reads the PIN, so on the second pass — when
       * everything has a territory — `with_a_pin` is 0 by construction and
       * `already_filed` is 53. That is the endpoint behaving correctly and the
       * old assertion mis-reading it.
       *
       * The invariant that IS true of every pass, and of a re-run, is that
       * every contact is either already filed or was found to have a PIN. It is
       * the same claim — "the addresses 04.04 typed reach the router" — stated
       * so it survives the second pass.
       */
      expect(
        Number(r.with_a_pin ?? 0) + Number(r.already_filed ?? 0),
        `routing pass ${i + 1}: of ${r.considered} contacts, ${r.with_a_pin} carried a ` +
        `pincode and ${r.already_filed} were already filed. The addresses 04.04 typed ` +
        'are not reaching the router.',
      ).toBeGreaterThanOrEqual(N_CONTACTS);
    }
    // The second pass must not re-file what the first one filed. That is the
    // property that makes this button safe to press twice, and the sentence in
    // the confirm dialog claims it.
    expect(
      Number(reports[1].count),
      'the second routing pass filed contacts again. The confirm dialog promises ' +
      '"Contacts that already have a territory are left exactly as they are", so a ' +
      `non-zero second pass contradicts the product's own sentence. Wire:${dumpWire(wire)}`,
    ).toBe(0);
    expect(
      Number(reports[1].already_filed),
      'the second pass reports nothing already filed, which cannot be true after the first',
    ).toBeGreaterThanOrEqual(N_CONTACTS - Number(reports[0].no_territory_claims_it ?? 0));

    console.log(
      `\n  04.08 routing — pass 1 filed ${reports[0].count} of ${reports[0].considered}; ` +
      `pass 2 filed ${reports[1].count} (already filed ${reports[1].already_filed})\n`,
    );

    // ── And a contact now names its territory, by NAME ─────────────────────
    con.at('contacts');
    const cp = await openContactRecord(page, contactName(1));
    await expect(cp.getByText('Territory:').first(), 'the contact record does not carry a Territory line')
      .toBeVisible({ timeout: 25_000 });
    /**
     * ⚠ THE TERRITORY IS READ OFF THE RECORDS, NOT OFF THE LIST — the same
     * mistake 04.04 made about `billing_address`, in the same place.
     *
     * `list_contacts` selects its columns one by one (routers/graha.py:613) and
     * `territory_id` is not among them, so filtering the list for it counts zero
     * however well the routing worked. The screen above proves it for one
     * contact; this proves it for a spread of ten, by record.
     */
    const all = await apiRows(page, '/api/v1/graha/contacts');
    const sample = [...Array(10)].map((_, i) => all.find((c) => c.name === contactName(i * 5 + 1)))
      .filter(Boolean);
    expect(sample.length, 'the ten sampled contacts are not all in the list').toBe(10);
    const filed: string[] = [];
    for (const c of sample) {
      const rec = await apiOne(page, `/api/v1/graha/contacts/${c.id}`);
      const t = (rec?.contact ?? rec);
      if (t?.territory_id) filed.push(String(t.territory_name || ''));
    }
    expect(
      filed.length,
      `not one of ten sampled contacts carries a territory after two routing passes. ` +
      `Wire:${dumpWire(wire)}`,
    ).toBe(10);
    // And each one is filed under a patch this suite drew, by NAME.
    const mine = new Set([...Array(N_TERRITORIES)].map((_, i) => territoryName(i + 1)));
    expect(
      filed.every((n) => mine.has(n)),
      `a contact was filed under a territory this suite did not create: ${[...new Set(filed)].join(', ')}`,
    ).toBeTruthy();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.09 · thirty deals — 8 Won, 6 Lost, 16 open
  // ──────────────────────────────────────────────────────────────────────────
  test('04.09 thirty deals are raised — eight won, six lost, sixteen open', async ({ page }) => {
    test.setTimeout(40 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    con.at('deals');
    await gotoTab(page, 'deals');
    const p = panel(page, 'deals');

    const before = await apiRows(page, '/api/v1/graha/deals?include_archived=true');
    const have = namesOf(before, 'title');

    const year = new Date().getFullYear();
    const createDeal = async (n: number) => {
      await p.getByRole('button', { name: '+ New Deal' }).click();
      const form = p.locator('form.gr__panel');
      await expect(form, 'the New Deal form did not open').toBeVisible({ timeout: 15_000 });
      const f = (label: string) => form.locator('label.gr__f').filter({ hasText: label }).first();

      await f('Title *').locator('input').fill(dealTitle(n));
      await pickByLabel(f('Client / Company').locator('select'), clientName(((n - 1) % N_CLIENTS) + 1), 'client');
      await pickByLabel(f('Contact').locator('select'), contactName(((n - 1) % N_CONTACTS) + 1), 'contact');
      await f('Value (₹)').locator('input').fill(String(50_000 * n));
      await pickByLabel(f('Territory').locator('select'), territoryName(((n - 1) % N_TERRITORIES) + 1), 'territory');
      await f('Stage').locator('select').selectOption(stageOf(n));
      await f('Probability (%)').locator('input').fill(String(10 + ((n * 7) % 80)));
      // The product's own picker. There is no native <input type="date"> here.
      await setDate(form, 'Expected Close', `${year}-${pad(((n - 1) % 12) + 1)}-${pad(((n - 1) % 27) + 1)}`);
      /**
       * ⚠ NO NOTE IS TYPED HERE, BECAUSE THERE IS NOWHERE TO TYPE ONE.
       *
       * This line was `form.locator('textarea').fill(…)` and it timed out on the
       * first deal: the New Deal form has Title, Client/Company, Contact, Value,
       * Territory, Stage, Probability, Expected Close and the org's deal custom
       * fields — and no Notes box (`DealsTab.jsx:466-499`). `DealCreate.notes`
       * exists on the server and `DealRoute`'s edit form has a Notes textarea,
       * so a note can only be added AFTER the deal is raised, by opening the
       * record. Minor, and recorded rather than silently dropped.
       */

      await saveAndWait(
        page,
        () => form.getByRole('button', { name: /Create Deal|Creating/ }).click(),
        /\/graha\/deals(\?|$)/,
        `creating ${dealTitle(n)}`,
      );
      await expect(form, 'the New Deal form stayed open after a successful create')
        .toBeHidden({ timeout: 20_000 });
    };

    const stat = await ensure(page, [...Array(N_DEALS)].map((_, i) => i + 1), have, dealTitle, createDeal);
    console.log(`\n  04.09 deals — typed ${stat.typed}, already present ${stat.found}\n`);

    const after = await apiRows(page, '/api/v1/graha/deals?include_archived=true');
    const byTitle = new Map(after.map((d) => [String(d.title), d]));
    let won = 0, lost = 0, open = 0, withTerritory = 0, withClient = 0;
    for (let n = 1; n <= N_DEALS; n++) {
      const d = byTitle.get(dealTitle(n));
      expect(d, `${dealTitle(n)} is not stored. Wire:${dumpWire(wire)}`).toBeTruthy();
      expect(Number(d.value), `${dealTitle(n)} lost its value`).toBe(50_000 * n);
      if (d.stage === 'Won') won++;
      else if (d.stage === 'Lost') lost++;
      else open++;
      if (d.territory_id) withTerritory++;
      if (d.client_id) withClient++;
    }
    expect(won, '§4 asks for eight won deals').toBe(N_WON);
    expect(lost, '§4 asks for six lost deals').toBe(N_LOST);
    expect(open, '§4 asks for sixteen open deals').toBe(N_DEALS - N_WON - N_LOST);
    expect(withTerritory, 'every deal was given a territory from the picker and must have kept it')
      .toBe(N_DEALS);
    expect(withClient, 'every deal was filed against a company — a CRM client IS the company')
      .toBe(N_DEALS);

    // The record route opens as a URL, and it is the deal it says it is.
    con.at('deal record');
    await gotoTab(page, 'deals');
    await p.getByRole('button', { name: dealTitle(N_DEALS), exact: true }).click();
    const drawer = page.getByRole('dialog', { name: `Deal ${dealTitle(N_DEALS)}` });
    await expect(drawer, 'clicking a deal title did not open the record drawer')
      .toBeVisible({ timeout: 25_000 });
    await expect(drawer.locator('.gr__dname')).toHaveText(dealTitle(N_DEALS));
    await page.keyboard.press('Escape');

    expect(con.errors.filter((e) => e.text.startsWith('UNCAUGHT')),
      `uncaught errors on the deals screen:${dumpConsole(con)}`).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.10 · forty kanban stage moves, every one a DRAG that must PERSIST
  // ──────────────────────────────────────────────────────────────────────────
  test('04.10 forty deals are dragged across the kanban and every move persists', async ({ page }) => {
    test.setTimeout(40 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    // ⚠ A WIDE VIEWPORT, AND IT IS LOAD-BEARING.
    // `.gr__kb` is `display:flex; overflow-x:auto` and `.gr__kbcol` is
    // `flex: 1 0 220px`, so six stage columns need ~1,380px of content width. At
    // the 1280px `Desktop Chrome` default, minus the shell's sidebar, the board
    // scrolls horizontally and the far columns are off-screen — a drop onto a
    // column the pointer cannot reach is a test artefact, not a product failure.
    await page.setViewportSize({ width: 2000, height: 1100 });
    con.at('kanban');
    await gotoTab(page, 'kanban');
    const p = panel(page, 'kanban');

    await expect(p.locator('.gr__kbcol').first(), 'the kanban board never rendered a column')
      .toBeVisible({ timeout: 40_000 });
    const columns = p.locator('.gr__kbcol');
    await expect
      .poll(async () => await columns.count(), { message: 'the board has no stage columns', timeout: 30_000 })
      .toBeGreaterThanOrEqual(OPEN_STAGES.length);

    /** One column, by the stage badge in its head. */
    const column = (stage: string) => p.locator('.gr__kbcol').filter({
      has: page.locator('.gr__kbhead', { hasText: new RegExp(`^${stage}`) }),
    }).first();

    /** A card, by the deal title it draws. */
    const card = (title: string) => p.locator('.gr__kbcard').filter({ has: page.locator('.gr__kbt', { hasText: title }) }).first();

    /**
     * A real mouse drag, the way `@hello-pangea/dnd`'s mouse sensor expects it.
     *
     * The library arms on `mousedown` and only STARTS the drag once the pointer
     * has travelled its 5px threshold, so a straight `mouse.move` to the target
     * is swallowed and the card never leaves. The nudge below is what makes this
     * a drag rather than a click, and `steps` is what produces the intermediate
     * mousemove events its reducer reads.
     */
    const dragTo = async (title: string, toStage: string) => {
      await card(title).scrollIntoViewIfNeeded();
      const from = await card(title).boundingBox();
      expect(from, `the card for ${title} is not on the board`).toBeTruthy();
      const dest = await column(toStage).boundingBox();
      expect(dest, `there is no "${toStage}" column to drop into`).toBeTruthy();

      const sx = from!.x + from!.width / 2;
      const sy = from!.y + 14;
      // The drop point stays on the SOURCE CARD'S ROW BAND. Columns share a top
      // edge but not a height, so a fixed offset from the destination's own `y`
      // lands outside a shorter column once the page has been scrolled.
      const dx = dest!.x + dest!.width / 2;
      const dy = Math.min(Math.max(sy, dest!.y + 60), dest!.y + dest!.height - 16);

      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx, sy + 8, { steps: 4 });      // past the 5px threshold
      await page.mouse.move(dx, dy, { steps: 16 });
      await page.mouse.move(dx, dy + 3, { steps: 4 });
      await page.mouse.up();
    };

    // The sixteen open deals are the drag set. Won and Lost are left alone so
    // 04.09's 8/6 split is not moved by a test that is about dragging.
    const openDeals = [...Array(N_DEALS)].map((_, i) => i + 1)
      .filter((n) => OPEN_STAGES.includes(stageOf(n)));
    expect(openDeals.length, 'there must be sixteen open deals to drag').toBe(16);

    const all = await apiRows(page, '/api/v1/graha/deals');
    const idByTitle = new Map(all.map((d) => [String(d.title), String(d.id)]));
    const stageNow = new Map<number, string>();
    for (const n of openDeals) {
      const d = all.find((x) => x.title === dealTitle(n));
      expect(d, `${dealTitle(n)} is missing — 04.09 must run first`).toBeTruthy();
      stageNow.set(n, String(d.stage));
    }

    let moved = 0;
    const failures: string[] = [];
    for (let i = 0; i < N_MOVES; i++) {
      const n = openDeals[i % openDeals.length];
      const title = dealTitle(n);
      const current = stageNow.get(n)!;
      // Always a REAL move: never a drop back into the column it came from,
      // which the board short-circuits and which would prove nothing.
      const target = OPEN_STAGES[(OPEN_STAGES.indexOf(current) + 1 + Math.floor(i / openDeals.length)) % OPEN_STAGES.length];
      const to = target === current ? OPEN_STAGES[(OPEN_STAGES.indexOf(current) + 1) % OPEN_STAGES.length] : target;

      await expect(card(title), `${title} is not on the board before move ${i + 1}`)
        .toBeVisible({ timeout: 20_000 });

      let patched = false;
      try {
        const [res] = await Promise.all([
          page.waitForResponse(
            (r) => /\/graha\/deals\//.test(r.url()) && r.request().method() === 'PATCH',
            { timeout: 25_000 },
          ),
          dragTo(title, to),
        ]);
        patched = res.status() < 400;
        if (!patched) failures.push(`${title} → ${to}: PATCH ${res.status()} ${(await res.text()).slice(0, 120)}`);
      } catch (e) {
        failures.push(`${title} → ${to}: the drag produced NO PATCH at all (${String((e as Error).message).slice(0, 120)})`);
      }

      if (!patched) break;

      // ── (1) THE CARD IS IN THE NEW COLUMN ────────────────────────────────
      await expect(
        column(to).locator('.gr__kbcard').filter({ has: page.locator('.gr__kbt', { hasText: title }) }),
        `${title} was dragged to ${to} and the card is not in that column`,
      ).toHaveCount(1, { timeout: 20_000 });

      // ── (2) AND THE ROW PERSISTED IT ─────────────────────────────────────
      // A drag that animates and does not save is the exact defect a screenshot
      // cannot tell from success, so the stored stage is read back off the
      // record. `graha_deals` has no `column_id`/`sort_order` — the board is
      // built from `stage`, which `/deals/kanban` groups by — so `stage` is the
      // column and this is the honest equivalent of that assertion.
      const id = idByTitle.get(title)!;
      const rec = await apiOne(page, `/api/v1/graha/deals/${id}`);
      const stored = String(rec?.deal?.stage ?? rec?.stage ?? '');
      expect(
        stored,
        `${title} shows in the "${to}" column and the server still has it in ` +
        `"${stored}". The drag animated and did not save. Wire:${dumpWire(wire)}`,
      ).toBe(to);

      stageNow.set(n, to);
      moved++;
    }

    console.log(`\n  04.10 kanban — ${moved} of ${N_MOVES} stage moves completed by drag\n`);
    expect(
      failures,
      `the kanban drag did not reach the server. Every move must produce a PATCH and a ` +
      `stored stage change.${failures.length ? '\n     ' + failures.join('\n     ') : ''}` +
      `\n     Wire:${dumpWire(wire)}`,
    ).toEqual([]);
    expect(moved, `§4 asks for ${N_MOVES} stage moves on the kanban`).toBe(N_MOVES);

    expect(con.errors.filter((e) => e.text.startsWith('UNCAUGHT')),
      `uncaught errors on the kanban:${dumpConsole(con)}`).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.11 · SIX LOST DEALS, EACH WITH A REASON
  // ──────────────────────────────────────────────────────────────────────────
  test('04.11 a lost deal records WHY it was lost, and the reason persists', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    con.at('deal record');

    const lost = [...Array(N_DEALS)].map((_, i) => i + 1).filter((n) => stageOf(n) === 'Lost');
    expect(lost.length, '§4 asks for six deals lost with a reason').toBe(N_LOST);

    const all = await apiRows(page, '/api/v1/graha/deals?include_archived=true');
    const idByTitle = new Map(all.map((d) => [String(d.title), String(d.id)]));
    for (const n of lost) {
      expect(idByTitle.get(dealTitle(n)), `${dealTitle(n)} is missing — 04.09 must run first`).toBeTruthy();
    }

    const REASONS = [
      'Price — went with the incumbent',
      'Timing — budget deferred to the next financial year',
      'Scope — they needed on-premise deployment',
      'Lost to a competitor on GST filing depth',
      'No decision — the sponsor left the company',
      'Compliance — they required data residency we do not offer',
    ];

    // Open the FIRST lost deal's record and look for the control. Everything
    // else in this test hangs off whether one exists.
    const first = idByTitle.get(dealTitle(lost[0]))!;
    await page.goto(`/graha/deals/${first}`);
    const drawer = page.getByRole('dialog');
    await expect(drawer, 'the deal record drawer did not open').toBeVisible({ timeout: 40_000 });
    await expect(drawer.locator('.gr__dname')).toHaveText(dealTitle(lost[0]), { timeout: 25_000 });
    await drawer.getByRole('button', { name: 'Edit deal' }).click();
    const form = drawer.locator('form.dr__sec');
    await expect(form, 'the deal edit form did not open').toBeVisible({ timeout: 15_000 });

    // The stage select DOES carry Lost.
    await expect(form.locator('label.gr__f').filter({ hasText: 'Stage' }).locator('option[value="Lost"]'),
      'the deal edit form cannot even set the stage to Lost').toHaveCount(1);

    // ⚠ THE CONTROL §4 REQUIRES. Looked for by every name a person would give
    // it, scoped to the form so the sidebar cannot answer for it.
    const reasonField = form.locator('label.gr__f').filter({ hasText: /lost reason|reason lost|why lost|^reason$/i });
    const reasonCount = await reasonField.count();

    expect(
      reasonCount,
      '\n  ⚠ THERE IS NO CONTROL FOR THE LOST REASON, ANYWHERE IN GRAHA.\n' +
      '     Looked for on the deal record drawer\'s edit form (`DealRoute.jsx`), which\n' +
      '     is the ONE screen that changes a deal — its own header says the edit form\n' +
      '     "MOVED here rather than being copied, so there is exactly one place a deal\n' +
      '     can be changed". That form renders Title, Value, Stage, Probability,\n' +
      '     Expected Close, the org\'s custom fields and Notes. No reason.\n' +
      '     `DealsTab.jsx` has no such field either, and its row buttons filter Lost\n' +
      '     out of the stage list entirely (`s !== d.stage && s !== \'Lost\'`).\n' +
      '\n' +
      '     THE SERVER IS READY AND THE UI NEVER ASKS:\n' +
      '       · `staging.graha_deals.lost_reason` — text, nullable, migration 018:64\n' +
      '       · `DealUpdate.lost_reason` — routers/graha.py:242\n' +
      '       · `_DEAL_COLS` now writes it — routers/graha.py:2037, the fix for\n' +
      '         "the reason was being discarded silently for the entire life of\n' +
      '         the product"\n' +
      '       · `backend/tests/test_graha_deal_org_binding.py:256` pins the PATCH\n' +
      '     A grep for `lost_reason` across `frontend/` returns NOTHING.\n' +
      '\n' +
      '     So a person can move a deal to Lost and cannot say why. "Why are we\n' +
      '     losing?" is the question this module exists to answer.\n' +
      '     REPORTED WITHOUT A VERDICT — 93 §14 reserves the product-bug-vs-test-bug\n' +
      '     judgement to the owner, and this test will not be softened to pass.\n',
    ).toBeGreaterThan(0);

    // Reached only once a control exists. Six deals, six reasons, each read back
    // off the stored row — because a PATCH that answers 200 and drops the field
    // on the floor is exactly what this column did until 2026-08-27.
    for (const [i, n] of lost.entries()) {
      const id = idByTitle.get(dealTitle(n))!;
      await page.goto(`/graha/deals/${id}`);
      const d = page.getByRole('dialog');
      await expect(d).toBeVisible({ timeout: 30_000 });
      await d.getByRole('button', { name: 'Edit deal' }).click();
      const ef = d.locator('form.dr__sec');
      await expect(ef).toBeVisible({ timeout: 15_000 });
      await ef.locator('label.gr__f').filter({ hasText: 'Stage' }).locator('select').selectOption('Lost');
      const rf = ef.locator('label.gr__f').filter({ hasText: /lost reason|reason lost|why lost|^reason$/i }).first();
      const text = `${REASONS[i]} · run ${RUN}`;
      await typeInto(rf.locator('input, textarea').first(), text);
      await saveAndWait(
        page,
        () => ef.getByRole('button', { name: /^Save$|^Saving/ }).click(),
        /\/graha\/deals\//,
        `saving the lost reason on ${dealTitle(n)}`,
      );
      const rec = await apiOne(page, `/api/v1/graha/deals/${id}`);
      const stored = String(rec?.deal?.lost_reason ?? rec?.lost_reason ?? '');
      expect(stored, `the lost reason on ${dealTitle(n)} did not persist. Wire:${dumpWire(wire)}`).toBe(text);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.12 · forty-five activities
  // ──────────────────────────────────────────────────────────────────────────
  test('04.12 forty-five activities are logged against contacts and deals', async ({ page }) => {
    test.setTimeout(40 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    con.at('activities');
    await gotoTab(page, 'activities');
    const p = panel(page, 'activities');

    const before = await apiRows(page, '/api/v1/graha/activities');
    const have = namesOf(before, 'title');
    const TYPES = ['call', 'email', 'meeting', 'note', 'task'];

    const createActivity = async (n: number) => {
      await p.getByRole('button', { name: '+ Log Activity' }).click();
      const form = p.locator('form.gr__panel');
      await expect(form, 'the Log Activity form did not open').toBeVisible({ timeout: 15_000 });
      const f = (label: string) => form.locator('label.gr__f').filter({ hasText: label }).first();

      await f('Type').locator('select').selectOption(TYPES[(n - 1) % TYPES.length]);
      await f('Title *').locator('input').fill(activityTitle(n));
      // Every third one hangs off a DEAL, the rest off a PERSON — the two things
      // an activity can be about, and the join the list has to resolve to names.
      if (n % 3 === 0) {
        await pickByLabel(f('Deal').locator('select'), dealTitle(((n - 1) % N_DEALS) + 1), 'deal');
      } else {
        await pickByLabel(f('Contact').locator('select'), contactName(((n - 1) % N_CONTACTS) + 1), 'contact');
      }
      await f('Description').locator('textarea').fill(`${TAG} logged by run ${RUN}`);

      await saveAndWait(
        page,
        () => form.getByRole('button', { name: /Log Activity|Saving/ }).click(),
        /\/graha\/activities(\?|$)/,
        `logging ${activityTitle(n)}`,
      );
      await expect(form).toBeHidden({ timeout: 20_000 });
    };

    const stat = await ensure(page, [...Array(N_ACTIVITIES)].map((_, i) => i + 1), have, activityTitle, createActivity);
    console.log(`\n  04.12 activities — typed ${stat.typed}, already present ${stat.found}\n`);

    const after = await apiRows(page, '/api/v1/graha/activities');
    const byTitle = new Map(after.map((a) => [String(a.title), a]));
    const seen = new Set<string>();
    let linked = 0;
    for (let n = 1; n <= N_ACTIVITIES; n++) {
      const a = byTitle.get(activityTitle(n));
      expect(a, `${activityTitle(n)} is not stored. Wire:${dumpWire(wire)}`).toBeTruthy();
      seen.add(String(a.activity_type));
      if (a.contact_id || a.deal_id) linked++;
    }
    expect([...seen].sort(), 'all five activity types must be exercised')
      .toEqual(['call', 'email', 'meeting', 'note', 'task']);
    expect(linked, 'every activity must be logged against a contact or a deal').toBe(N_ACTIVITIES);

    // ── The log completes one, through the row's own verb ─────────────────
    // ⚠ The branch is guarded because a RE-RUN finds them already done — but
    // the assertion under it is NOT, so this can never pass vacuously: whichever
    // branch runs, at least one completed activity must exist afterwards.
    await gotoTab(page, 'activities');
    const openRow = p.locator('table.tbl tbody tr')
      .filter({ has: page.getByRole('button', { name: 'Complete' }) }).first();
    if (await openRow.count()) {
      await saveAndWait(page, () => openRow.getByRole('button', { name: 'Complete' }).click(),
        /\/graha\/activities\/.+\/complete/, 'completing an activity');
      await expect(p.locator('table.tbl tbody tr').filter({ hasText: 'Done' }).first(),
        'an activity was completed and no row on the log says Done').toBeVisible({ timeout: 20_000 });
    }
    const completed = (await apiRows(page, '/api/v1/graha/activities')).filter((a) => a.is_completed);
    expect(completed.length,
      `no activity is marked complete. ${await openRow.count()} row(s) offered a Complete ` +
      `button. Wire:${dumpWire(wire)}`).toBeGreaterThan(0);

    expect(con.errors.filter((e) => e.text.startsWith('UNCAUGHT')),
      `uncaught errors on the activities screen:${dumpConsole(con)}`).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.13 · eighteen follow-ups, with reminders
  // ──────────────────────────────────────────────────────────────────────────
  test('04.13 eighteen follow-ups are scheduled, each with a reminder', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    con.at('follow-ups');
    await gotoTab(page, 'follow-ups');
    const p = panel(page, 'follow-ups');

    const before = await apiRows(page, '/api/v1/graha/follow-ups?is_completed=false');
    const doneBefore = await apiRows(page, '/api/v1/graha/follow-ups?is_completed=true');
    const have = namesOf([...before, ...doneBefore], 'title');

    const year = new Date().getFullYear();
    const createFollowUp = async (n: number) => {
      await p.getByRole('button', { name: '+ New Follow-up' }).click();
      const form = p.locator('form.gr__panel');
      await expect(form, 'the New Follow-up form did not open').toBeVisible({ timeout: 15_000 });
      const f = (label: string) => form.locator('label.gr__f').filter({ hasText: label }).first();

      await f('Title *').locator('input').fill(followUpTitle(n));
      // ⚠ `datetime-local`, and STILL not a native input — the product replaced
      // every one of them. `setDate` drives the calendar and the picker fills
      // 09:00 in for the time half.
      await setDate(form, 'Due Date *', `${year}-${pad(((n - 1) % 12) + 1)}-${pad(((n * 2) % 27) + 1)}`);
      // The reminder — §4's "follow-ups fire reminders". It is a column and a
      // form field; whether a cron then sends anything is Suite 18's subject.
      await setDate(form, 'Remind At', `${year}-${pad(((n - 1) % 12) + 1)}-${pad(((n * 2) % 27) + 1)}`);
      if (n % 2 === 0) {
        await pickByLabel(f('Deal').locator('select'), dealTitle(((n - 1) % N_DEALS) + 1), 'deal');
      } else {
        await pickByLabel(f('Contact').locator('select'), contactName(((n - 1) % N_CONTACTS) + 1), 'contact');
      }
      await f('Description').locator('input').fill(`${TAG} follow-up · run ${RUN}`);

      await saveAndWait(
        page,
        () => form.getByRole('button', { name: /^Create$|^Creating/ }).click(),
        /\/graha\/follow-ups(\?|$)/,
        `scheduling ${followUpTitle(n)}`,
      );
      await expect(form).toBeHidden({ timeout: 20_000 });
    };

    const stat = await ensure(page, [...Array(N_FOLLOWUPS)].map((_, i) => i + 1), have, followUpTitle, createFollowUp);
    console.log(`\n  04.13 follow-ups — typed ${stat.typed}, already present ${stat.found}\n`);

    const open = await apiRows(page, '/api/v1/graha/follow-ups?is_completed=false');
    const done = await apiRows(page, '/api/v1/graha/follow-ups?is_completed=true');
    const byTitle = new Map([...open, ...done].map((f) => [String(f.title), f]));
    let reminders = 0;
    let attached = 0;
    for (let n = 1; n <= N_FOLLOWUPS; n++) {
      const f = byTitle.get(followUpTitle(n));
      expect(f, `${followUpTitle(n)} is not stored. Wire:${dumpWire(wire)}`).toBeTruthy();
      expect(String(f.due_at || ''), `${followUpTitle(n)} has no due date`).not.toBe('');
      if (f.remind_at) reminders++;
      if (f.contact_id || f.deal_id) attached++;
    }
    expect(
      reminders,
      '§4 says follow-ups fire reminders. Not one of the eighteen stored a `remind_at`, ' +
      `so nothing can ever fire. Wire:${dumpWire(wire)}`,
    ).toBe(N_FOLLOWUPS);
    expect(attached, 'every follow-up must hang off a contact or a deal').toBe(N_FOLLOWUPS);

    // ── Complete one, through the card's own button ───────────────────────
    // Guarded for the re-run, and backed by an unguarded read-back for the same
    // reason 04.12's is: a skipped click must not become a silent pass.
    await gotoTab(page, 'follow-ups');
    const openCard = p.locator('.gr__card')
      .filter({ has: page.getByRole('button', { name: 'Complete' }) }).first();
    if (await openCard.count()) {
      await saveAndWait(page, () => openCard.getByRole('button', { name: 'Complete' }).click(),
        /\/follow-ups\/.+\/complete/, 'completing a follow-up');
    }
    const closed = await apiRows(page, '/api/v1/graha/follow-ups?is_completed=true');
    expect(closed.length,
      `not one follow-up is marked complete after pressing Complete. Wire:${dumpWire(wire)}`)
      .toBeGreaterThan(0);

    // ── And the pipeline board must now agree about what is covered ───────
    con.at('pipeline');
    await gotoTab(page, 'pipeline');
    const pp = panel(page, 'pipeline');
    await expect(pp.locator('.gpipe__col').first(), 'the pipeline board never rendered a stage column')
      .toBeVisible({ timeout: 30_000 });
    const covered = pp.locator('.gdeal').filter({ has: page.locator('.gdeal__next') });
    await expect
      .poll(async () => await covered.count(),
        { message: 'eighteen follow-ups exist and the pipeline board marks not one deal as covered', timeout: 25_000 })
      .toBeGreaterThan(0);

    expect(con.errors.filter((e) => e.text.startsWith('UNCAUGHT')),
      `uncaught errors on the follow-ups/pipeline screens:${dumpConsole(con)}`).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.14 · two web forms — and the twelve public submissions that have no door
  // ──────────────────────────────────────────────────────────────────────────
  test('04.14 two web forms are published and a member of the public can fill one in',
    async ({ page }) => {
      test.setTimeout(25 * 60_000);
      const wire = watchWire(page);
      const con = watchConsole(page);
      await signIn(page);
      con.at('web-forms');
      await gotoTab(page, 'web-forms');
      const p = panel(page, 'web-forms');

      const before = await apiRows(page, '/api/v1/graha/web-forms');
      const have = namesOf(before);

      const createForm = async (n: number) => {
        await p.getByRole('button', { name: '+ New Form' }).click();
        const form = p.locator('form.gr__panel');
        await expect(form, 'the New Form panel did not open').toBeVisible({ timeout: 15_000 });
        await form.locator('label.gr__f').filter({ hasText: 'Form Name' }).locator('input').fill(formName(n));
        await form.locator('label.gr__f').filter({ hasText: 'Slug' }).locator('input').fill(formSlug(n));
        await form.locator('label.gr__f').filter({ hasText: 'Source Tag' }).locator('input')
          .fill(n === 1 ? 'website' : 'landing-page');
        await saveAndWait(
          page,
          () => form.getByRole('button', { name: 'Create', exact: true }).click(),
          /\/graha\/web-forms(\?|$)/,
          `creating ${formName(n)}`,
        );
        await expect(form).toBeHidden({ timeout: 20_000 });
      };

      const stat = await ensure(page, [1, 2], have, formName, createForm);
      console.log(`\n  04.14 web forms — typed ${stat.typed}, already present ${stat.found}\n`);

      // ── The two forms exist, published, with their slug and source tag ────
      const forms = await apiRows(page, '/api/v1/graha/web-forms');
      const byName = new Map(forms.map((f) => [String(f.name), f]));
      for (let n = 1; n <= N_FORMS; n++) {
        const f = byName.get(formName(n));
        expect(f, `${formName(n)} is not stored. Wire:${dumpWire(wire)}`).toBeTruthy();
        expect(String(f.slug), `${formName(n)} lost its slug`).toBe(formSlug(n));
        expect(String(f.auto_source), `${formName(n)} lost its source tag`)
          .toBe(n === 1 ? 'website' : 'landing-page');
        expect(f.is_active, `${formName(n)} was published inactive`).toBeTruthy();
      }

      // ── The screen shows them, and shows the submissions surface ─────────
      await gotoTab(page, 'web-forms');
      for (let n = 1; n <= N_FORMS; n++) {
        const row = p.locator('.gr__lrow').filter({ hasText: formName(n) }).first();
        await expect(row, `${formName(n)} is not on the web-forms list`).toBeVisible({ timeout: 25_000 });
        await expect(row, `${formName(n)} does not show the path it answers on`)
          .toContainText(`/api/v1/graha/f/${formSlug(n)}`);
        await row.getByRole('button', { name: 'Submissions' }).click();
        // Count first: an empty submissions panel and a panel that never opened
        // look identical, and only one of them is a real state.
        const subs = row.locator('.gr__stack');
        await expect(subs, `${formName(n)}'s submissions panel never opened`)
          .toBeVisible({ timeout: 25_000 });
        const rows = subs.locator('.gr__lrow');
        const n_subs = await rows.count();
        if (n_subs === 0) {
          await expect(subs.getByText('No submissions yet.'),
            'the submissions panel is empty and does not say so in words').toBeVisible();
        }
        await row.getByRole('button', { name: 'Hide' }).click();
      }

      // ══════════════════════════════════════════════════════════════════════
      // ⚠ THE TWELVE SUBMISSIONS. THERE IS NO DOOR, AND THIS IS THE EVIDENCE.
      // ══════════════════════════════════════════════════════════════════════
      //
      // §4 asks for 12 submissions made from a logged-out context. A submission
      // is only a submission if a PERSON can make one, so this looks for the
      // affordance that would let them: a link to a hosted form, a preview, or a
      // copyable embed snippet a customer could paste without writing code.
      //
      // What the tab actually offers is one `<code>` element naming the path and
      // a list of five field names. There is no anchor, no copy button, no
      // preview, and `App.jsx` declares no public route for a form. The only way
      // to submit is to write JavaScript that POSTs JSON — which is a raw API
      // write, which rule 1 forbids and `check-e2e-no-bypass.mjs` refuses.
      //
      // So NOTHING WAS SUBMITTED. 0 of 12. Recorded here rather than worked
      // around, because a silent cap reads as full coverage.
      expect(N_SUBMISSIONS, '§4 asks for twelve public submissions').toBe(12);
      const hint = p.locator('.gr__hint');
      await expect(hint, 'the web-forms tab gives no integration guidance at all').toBeVisible();
      const hintText = (await hint.innerText()).replace(/\s+/g, ' ').trim();

      const affordances = [
        ...(await p.getByRole('link').all()),
        ...(await p.getByRole('button', { name: /copy|preview|open form|embed|snippet|hosted/i }).all()),
      ];
      const labels: string[] = [];
      for (const a of affordances) labels.push((await a.innerText().catch(() => '')).replace(/\s+/g, ' ').trim());

      expect(
        affordances.length,
        '\n  ⚠ A WEB FORM CAN BE PUBLISHED AND NOBODY CAN FILL IT IN.\n' +
        `     Both forms exist and answer on /api/v1/graha/f/<slug>. The Web Forms tab\n` +
        `     offers no link, no preview, no copyable embed and no hosted page — the only\n` +
        `     guidance on screen is this sentence:\n` +
        `       "${hintText}"\n` +
        `     Affordances found on the tab: ${labels.length ? labels.join(' | ') : '(none)'}\n` +
        '\n' +
        '     `App.jsx` declares public routes for /login, /accept-invite, /approve,\n' +
        '     /sign/:token and /i/:token — and none for a lead form. A grep for\n' +
        '     `graha/f/` across `frontend/src` returns one hit: the comment at the top\n' +
        '     of `WebFormsTab.jsx`. So a customer must write and host the JavaScript\n' +
        '     themselves before a single lead can arrive.\n' +
        '\n' +
        '     CONSEQUENCE FOR §4: **0 of 12 public submissions were made.** Producing\n' +
        '     them requires a raw `fetch(..., {method:"POST"})` against the public\n' +
        '     endpoint, which is exactly what proposal 93 rule 1 bans and what\n' +
        '     `frontend/scripts/check-e2e-no-bypass.mjs` refused when this test first\n' +
        '     tried it. Moving that fetch into an unscanned .html fixture would slip\n' +
        '     past the ratchet without anybody deciding it should, so it was not done.\n' +
        '     REPORTED WITHOUT A VERDICT — 93 §14 reserves the judgement.\n',
      ).toBeGreaterThan(0);

      expect(con.errors.filter((e) => e.text.startsWith('UNCAUGHT')),
        `uncaught errors on the web-forms screen:${dumpConsole(con)}`).toEqual([]);
    });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.15 · twelve documents, uploaded through the real file picker
  // ──────────────────────────────────────────────────────────────────────────
  test('04.15 twelve documents are uploaded and filed against companies', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    con.at('documents');
    await gotoTab(page, 'documents');
    const p = panel(page, 'documents');

    const before = await apiRows(page, '/api/v1/graha/documents');
    const have = namesOf(before);

    /** A real, valid one-page PDF, built here so the test owns its own input. */
    const pdf = (n: number): Buffer => {
      const stream = `BT /F1 18 Tf 60 760 Td (${TAG} document ${pad(n)} - run ${RUN}) Tj ET`;
      const objs = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
        '/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>',
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      ];
      let out = '%PDF-1.4\n';
      const offs: number[] = [];
      objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
      const xref = out.length;
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
      for (const o of offs) out += `${String(o).padStart(10, '0')} 00000 n \n`;
      out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      return Buffer.from(out, 'latin1');
    };

    const upload = async (n: number) => {
      await p.getByRole('button', { name: '+ Add Document' }).click();
      const form = p.locator('form.gr__panel');
      await expect(form, 'the Add Document form did not open').toBeVisible({ timeout: 15_000 });
      // The real file picker, given real bytes.
      await form.locator('input[type="file"]').setInputFiles({
        name: `${TAG.toLowerCase()}-document-${pad(n)}.pdf`,
        mimeType: 'application/pdf',
        buffer: pdf(n),
      });
      await typeInto(form.locator('label.gr__f').filter({ hasText: 'Name *' }).locator('input'), docName(n));
      await pickByLabel(
        form.locator('label.gr__f').filter({ hasText: 'Client' }).locator('select'),
        clientName(((n - 1) % N_CLIENTS) + 1),
        'client',
      );
      await form.locator('label.gr__f').filter({ hasText: 'Description' }).locator('input')
        .fill(`Engagement letter · run ${RUN}`);
      await saveAndWait(
        page,
        () => form.getByRole('button', { name: /Add Document|Saving/ }).click(),
        /\/graha\/documents\/upload/,
        `uploading ${docName(n)}`,
      );
      await expect(form).toBeHidden({ timeout: 30_000 });
    };

    const stat = await ensure(page, [...Array(N_DOCS)].map((_, i) => i + 1), have, docName, upload);
    console.log(`\n  04.15 documents — uploaded ${stat.typed}, already present ${stat.found}\n`);

    const after = await apiRows(page, '/api/v1/graha/documents');
    const byName = new Map(after.map((d) => [String(d.name), d]));
    let stored = 0, foldered = 0;
    for (let n = 1; n <= N_DOCS; n++) {
      const d = byName.get(docName(n));
      expect(d, `${docName(n)} is not in the register. Wire:${dumpWire(wire)}`).toBeTruthy();
      expect(Number(d.file_size || 0), `${docName(n)} was stored with no bytes behind it`).toBeGreaterThan(100);
      if (d.file_url || d.file_key) stored++;
      if (d.folder) foldered++;
    }
    expect(stored, 'every uploaded document must have an object behind it').toBe(N_DOCS);
    expect(foldered, 'the server files a document under `crm/<client>/documents/` — none of them landed in a folder')
      .toBe(N_DOCS);

    // And the register renders it, with the uploader by NAME and never an id.
    await gotoTab(page, 'documents');
    const row = p.locator('table.tbl tbody tr').filter({ hasText: docName(1) }).first();
    await expect(row, `${docName(1)} is not on the register`).toBeVisible({ timeout: 25_000 });
    await expect(row.getByRole('link', { name: 'Open' }), 'a stored document has no way to open it').toBeVisible();

    expect(con.errors.filter((e) => e.text.startsWith('UNCAUGHT')),
      `uncaught errors on the documents screen:${dumpConsole(con)}`).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.16 · three approval rules
  // ──────────────────────────────────────────────────────────────────────────
  test('04.16 three approval rules are set, and the queue screen reads', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    con.at('approvals');
    await gotoTab(page, 'approvals');
    const p = panel(page, 'approvals');

    const RULES = [
      { entity: 'deal', threshold: 500000, role: 'org_admin' },
      { entity: 'vendor_bill', threshold: 250000, role: 'org_owner' },
      { entity: 'expense_claim', threshold: 100000, role: 'org_admin' },
    ];
    expect(RULES.length, '§4 asks for three approval rules').toBe(N_APPROVAL_RULES);

    const before = await apiRows(page, '/api/v1/graha/approval-rules');
    for (const r of RULES) {
      const exists = before.some(
        (x) => String(x.entity_type) === r.entity && Number(x.threshold_amount) === r.threshold,
      );
      if (exists) continue;
      await p.getByRole('button', { name: '+ New Rule' }).click();
      const form = p.locator('form.gr__panel');
      await expect(form, 'the New Rule form did not open').toBeVisible({ timeout: 15_000 });
      await form.locator('label.gr__f').filter({ hasText: 'Entity Type' }).locator('select')
        .selectOption(r.entity);
      await form.locator('label.gr__f').filter({ hasText: 'Threshold Amount' }).locator('input')
        .fill(String(r.threshold));
      await form.locator('label.gr__f').filter({ hasText: 'Approver Role' }).locator('input')
        .fill(r.role);
      await saveAndWait(
        page,
        () => form.getByRole('button', { name: 'Create Rule' }).click(),
        /\/graha\/approval-rules(\?|$)/,
        `creating the ${r.entity} approval rule`,
      );
      await expect(form).toBeHidden({ timeout: 20_000 });
    }

    const after = await apiRows(page, '/api/v1/graha/approval-rules');
    for (const r of RULES) {
      const row = after.find(
        (x) => String(x.entity_type) === r.entity && Number(x.threshold_amount) === r.threshold,
      );
      expect(row, `the ${r.entity} rule at ${r.threshold} is not stored. Wire:${dumpWire(wire)}`).toBeTruthy();
      expect(String(row.approver_role), `the ${r.entity} rule lost its approver role`).toBe(r.role);
      expect(row.is_active, `the ${r.entity} rule was created inactive`).toBeTruthy();
    }

    // The rules table renders them, and the requests table is a real surface —
    // not a blank the reader has to guess about.
    await gotoTab(page, 'approvals');
    await expect(p.getByRole('heading', { name: /Approval Rules \(\d+\)/ })).toBeVisible({ timeout: 25_000 });
    const ruleRows = p.locator('table.tbl').first().locator('tbody tr');
    await expect
      .poll(async () => await ruleRows.count(), { message: 'the rules table drew no rows', timeout: 20_000 })
      .toBeGreaterThanOrEqual(N_APPROVAL_RULES);
    await expect(p.getByRole('heading', { name: 'Approval Requests' })).toBeVisible();

    expect(con.errors.filter((e) => e.text.startsWith('UNCAUGHT')),
      `uncaught errors on the approvals screen:${dumpConsole(con)}`).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.17 · FOUR SCORING RULES — §4 asks, and there is no door
  // ──────────────────────────────────────────────────────────────────────────
  test('04.17 lead scoring rules can be set by a person', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await signIn(page);

    // The live state, so the report carries a measurement and not an opinion.
    const rules = await apiRows(page, '/api/v1/graha/scoring-rules');
    const tabs = await page.goto('/graha?tab=today').then(async () => {
      await expect(page.locator('#mt-panel-today')).toBeVisible({ timeout: 60_000 });
      // Every tab this module offers, inline or behind More.
      const inline = await page.getByRole('tab').allTextContents();
      const more = page.getByRole('button', { name: /^More/ });
      if (await more.count()) {
        await more.click();
        const hidden = await page.getByRole('menu').getByRole('menuitem').allTextContents();
        await page.keyboard.press('Escape');
        return [...inline, ...hidden];
      }
      return inline;
    });

    const scoringTab = tabs.filter((t) => /scor/i.test(t));
    expect(
      scoringTab.length,
      '\n  ⚠ NO SCREEN ANYWHERE LETS A PERSON SET A LEAD-SCORING RULE.\n' +
      `     Graha offers these tabs: ${tabs.map((t) => t.replace(/\s+/g, ' ').trim()).join(' | ')}\n` +
      '     None of them is scoring. A grep for `scoring-rules` across `frontend/src`\n' +
      '     returns nothing but a comment in `prachar/AudienceFilter.jsx` recording\n' +
      '     that `graha_scoring_rules` is empty and every `lead_score` is 0.\n' +
      '\n' +
      '     AND THE API COULD NOT SERVE ONE IF A SCREEN EXISTED:\n' +
      `       · GET  /v1/graha/scoring-rules  → 200, ${rules.length} row(s) for this org\n` +
      '       · PATCH /v1/graha/scoring-rules/{id}  — edits an existing rule\n' +
      '       · there is NO POST. routers/graha.py declares exactly those two\n' +
      '         (lines 3409 and 3429), so a rule cannot be CREATED through the API\n' +
      '         either — only an existing one amended, and there are none.\n' +
      '\n' +
      '     §4 asks Suite 04 to create four scoring rules. There is no route in and\n' +
      '     no screen to type into. `compute_lead_score` therefore has nothing to\n' +
      '     read, which is why every contact 04.04 typed carries a score of 0.\n' +
      '     REPORTED WITHOUT A VERDICT — 93 §14.\n',
    ).toBeGreaterThan(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.18 · TWO PIPELINES — §4 asks, and there is no door
  // ──────────────────────────────────────────────────────────────────────────
  test('04.18 a second pipeline can be created by a person', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await signIn(page);

    const pipelines = await apiRows(page, '/api/v1/graha/pipelines');
    await gotoTab(page, 'pipeline');
    const p = panel(page, 'pipeline');
    await expect(p, 'the pipeline tab did not render').toBeVisible();

    // Every control on the pipeline board, and on the deals tab beside it.
    const pipelineButtons = await p.getByRole('button').allTextContents();
    await gotoTab(page, 'deals');
    const dealButtons = await panel(page, 'deals').getByRole('button').allTextContents();
    const all = [...pipelineButtons, ...dealButtons].map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const creator = all.filter((t) => /pipeline/i.test(t) && /new|add|create/i.test(t));

    expect(
      creator.length,
      '\n  ⚠ NO CONTROL ANYWHERE CREATES A PIPELINE.\n' +
      `     Live: this org has ${pipelines.length} pipeline(s): ` +
      `${pipelines.map((x) => String(x.name)).join(', ') || '(none)'}\n` +
      '     `PipelineTab.jsx`\'s own empty state says "Create one from the Deals tab and\n' +
      '     your board appears here" — and the Deals tab has no such control. Buttons\n' +
      `     actually on those two screens: ${all.slice(0, 24).join(' | ')}\n` +
      '\n' +
      '     `POST /v1/graha/pipelines` exists (routers/graha.py:1603) and a grep for\n' +
      '     `pipelines` across `frontend/src` returns ONE hit — the word in a module\n' +
      '     catalogue blurb. Nothing calls it.\n' +
      '\n' +
      '     What actually happens instead: `create_deal` (routers/graha.py:1806-1815)\n' +
      '     silently INSERTs a pipeline called "Default Pipeline" the first time a deal\n' +
      '     is raised with none. So the org has a pipeline nobody typed, `/deals/kanban`\n' +
      '     serves that one board, and §4\'s "2 pipelines" cannot be reached by a user.\n' +
      '     REPORTED WITHOUT A VERDICT — 93 §14.\n',
    ).toBeGreaterThan(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.19 · dedupe — two review passes, three merges
  // ──────────────────────────────────────────────────────────────────────────
  test('04.19 duplicate contacts are found twice and merged three times', async ({ page }) => {
    test.setTimeout(25 * 60_000);
    const wire = watchWire(page);
    const con = watchConsole(page);
    await signIn(page);
    con.at('dedupe');

    // ── Two review passes. The screen recomputes the groups on every load, so
    //    a second visit IS a second run of the detector. ──────────────────────
    const passes: number[] = [];
    for (const pass of [1, 2]) {
      const [res] = await Promise.all([
        page.waitForResponse((r) => /\/graha\/contacts\/duplicates/.test(r.url()) && r.request().method() === 'GET',
          { timeout: 60_000 }),
        gotoTab(page, 'dedupe'),
      ]);
      expect(res.status(), `dedupe pass ${pass}: GET /contacts/duplicates → ${res.status()}`).toBeLessThan(400);
      const body = await res.json();
      passes.push((body?.data ?? body ?? []).length);
      await expect(panel(page, 'dedupe').getByRole('heading', { name: /Dedupe Review/ }),
        `the dedupe screen did not render on pass ${pass}`).toBeVisible({ timeout: 25_000 });
      await expect(panel(page, 'dedupe').getByRole('heading', { name: /Recent Merges/ }),
        'the merge ledger is not on the dedupe screen').toBeVisible();
    }
    expect(passes.length, 'two dedupe runs — §4').toBe(2);
    expect(passes[0], `the detector reported ${passes[0]} group(s) on the first pass and ${passes[1]} on the second — ` +
      'two reads of the same unchanged data disagree').toBe(passes[1]);
    console.log(`\n  04.19 dedupe — ${passes[0]} duplicate group(s) found on both passes\n`);

    const groupsBefore = await apiRows(page, '/api/v1/graha/contacts/duplicates');
    expect(
      groupsBefore.length,
      '04.04 typed three contacts that share an email with three others, and the ' +
      'detector found no duplicate group at all. `GET /contacts/duplicates` groups on ' +
      `email or phone. Wire:${dumpWire(wire)}`,
    ).toBeGreaterThanOrEqual(N_DUPES);

    // ── Three merges, each one driven as a person drives it ────────────────
    const p = panel(page, 'dedupe');
    let merged = 0;
    for (let i = 0; i < N_DUPES; i++) {
      await gotoTab(page, 'dedupe');
      const groups = p.locator('.gr__ddg');
      const n = await groups.count();
      if (n === 0) break;
      // Always the first group: merging removes it, so the list shortens under us.
      const g = groups.first();
      await g.locator('button.gr__ddhead').click();
      const rows = g.locator('table.tbl tbody tr');
      // ⚠ Count before choosing. A group with no candidate rows would otherwise
      // let the loop "merge" nothing and pass.
      await expect
        .poll(async () => await rows.count(),
          { message: 'the expanded duplicate group listed no candidates', timeout: 20_000 })
        .toBeGreaterThanOrEqual(2);

      // Keep the FIRST record. The radio is the whole point of the screen.
      await rows.first().locator('input[type="radio"]').check();
      const mergeBtn = g.getByRole('button', { name: /^Merge \d+ into survivor$/ });
      await expect(mergeBtn, 'the merge button never enabled after choosing a survivor').toBeEnabled({ timeout: 15_000 });
      /**
       * ⚠ IF THIS TIMES OUT, THE POST GOT NO RESPONSE AT ALL.
       *
       * That is what happened on 2026-08-29: the screen was perfect — three
       * email groups, a survivor chosen, the button enabled — and the request
       * came back `-1` in the trace with a red "Merge failed" toast. The wire is
       * dumped here so the next reader does not have to reconstruct it from a
       * screenshot; the server-side cause goes in the report, not in a verdict.
       */
      try {
        await saveAndWait(page, () => mergeBtn.click(), /\/graha\/contacts\/.+\/merge/, `merge ${i + 1}`);
      } catch (e) {
        const toast = await page.locator('.tst__t').allTextContents().catch(() => []);
        throw new Error(
          `merge ${i + 1} never came back.\n` +
          `     toast(s) on screen: ${toast.join(' | ') || '(none)'}\n` +
          `     wire:${dumpWire(wire)}\n` +
          `     original: ${String((e as Error).message).slice(0, 300)}`,
        );
      }
      merged++;
    }

    expect(merged, `§4 asks for three contact merges; ${merged} completed. Wire:${dumpWire(wire)}`)
      .toBeGreaterThanOrEqual(N_DUPES);

    // ── The ledger records them, by NAME, and offers the undo ──────────────
    await gotoTab(page, 'dedupe');
    const merges = await apiRows(page, '/api/v1/graha/contacts/merges');
    expect(merges.length, `the merge ledger is empty after ${merged} merges. Wire:${dumpWire(wire)}`)
      .toBeGreaterThanOrEqual(N_DUPES);
    const ledger = p.locator('table.tbl').last().locator('tbody tr');
    await expect
      .poll(async () => await ledger.count(), { message: 'the merge ledger drew no rows', timeout: 25_000 })
      .toBeGreaterThanOrEqual(N_DUPES);
    await expect(ledger.first().getByRole('button', { name: /Undo/ }),
      'a merge is described as reversible and the ledger offers no undo').toBeVisible();

    expect(con.errors.filter((e) => e.text.startsWith('UNCAUGHT')),
      `uncaught errors on the dedupe screen:${dumpConsole(con)}`).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.20 · typing is not searching — the contact search is SERVER-side
  // ──────────────────────────────────────────────────────────────────────────
  test('04.20 the contact search asks the server, and the list waits for the answer', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const con = watchConsole(page);
    await signIn(page);
    con.at('contacts');
    await gotoTab(page, 'contacts');
    const p = panel(page, 'contacts');

    const rows = p.locator('table.tbl tbody tr');
    await expect.poll(async () => await rows.count(),
      { message: 'the contacts table drew no rows to search over', timeout: 30_000 })
      .toBeGreaterThan(1);
    const unfiltered = await rows.count();

    /**
     * ⚠ TYPING IS NOT SEARCHING, and a Phase 8.0 fault clicked the unfiltered
     * table and opened the wrong record because of it.
     *
     * `ContactsTab.jsx` binds `search` to state and fires `load()` only on Enter
     * or on the Filter button — there is no debounce and no effect on `search`.
     * So this asserts, in order: keystrokes change nothing; the commit produces a
     * REQUEST carrying `?search=`; and only then does the list narrow.
     */
    const box = p.locator('input.gr__search');
    await box.fill(contactName(7));
    await page.waitForTimeout(1200);
    expect(
      await rows.count(),
      'the contact list narrowed on keystrokes alone. That would mean a client-side ' +
      'filter over the 200 rows the endpoint returns, which cannot reach the rest — ' +
      '`ContactsTab` deliberately sets `showSearch={false}` on its toolbar for that reason',
    ).toBe(unfiltered);

    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => /\/graha\/contacts\?/.test(r.url()) && r.request().method() === 'GET' && /search=/.test(r.url()),
        { timeout: 30_000 },
      ),
      box.press('Enter'),
    ]);
    expect(res.status(), `the search request answered ${res.status()}`).toBeLessThan(400);
    expect(decodeURIComponent(new URL(res.url()).search), 'the request did not carry what was typed')
      .toContain(contactName(7));

    await expect.poll(async () => await rows.count(),
      { message: 'the server answered the search and the list never narrowed', timeout: 25_000 })
      .toBeLessThan(unfiltered);
    await expect(rows.first(), 'the narrowed list is not showing the contact that was searched for')
      .toContainText(contactName(7));

    // And the row that is now first opens the record it names — the exact thing
    // the Phase 8.0 fault got wrong.
    await p.getByRole('button', { name: contactName(7), exact: true }).click();
    await expect(p.locator('.gr__dname'), 'the search result opened a different contact')
      .toHaveText(contactName(7), { timeout: 25_000 });

    expect(con.errors.filter((e) => e.text.startsWith('UNCAUGHT')),
      `uncaught errors while searching:${dumpConsole(con)}`).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 04.21 · every screen in the module, swept
  // ──────────────────────────────────────────────────────────────────────────
  test('04.21 all twenty Graha screens render, with no UUID, no native date input, no uncaught error',
    async ({ page }) => {
      test.setTimeout(30 * 60_000);
      const con = watchConsole(page);
      await signIn(page);

      // §10 puts Suite 04 at 22 screens. `GrahaPage.TABS` declares twenty tabs;
      // the deal record drawer and the client record are the other two, and both
      // are covered above. Named here rather than discovered, so a tab that
      // silently disappears fails this test instead of shrinking the sweep.
      const TABS = [
        'today', 'clients', 'contacts', 'deals', 'kanban', 'pipeline', 'follow-ups',
        'labels', 'activities', 'reports', 'territories', 'fields', 'web-forms',
        'approvals', 'documents', 'dedupe', 'analytics', 'client-report', 'billing',
        'metered-usage',
      ];
      expect(TABS.length, 'Graha declares twenty tabs in GrahaPage.jsx').toBe(20);

      /** A UUID drawn as TEXT. `check-rendered-ids.mjs` is the static half; this
       *  is the runtime one — it reads what the screen actually says. */
      const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
      /** And the product's own member-id shape, which is NOT a uuid. */
      const MEMBER_ID = /\buser_[0-9a-f]{12}\b/i;

      const broken: string[] = [];
      for (const tab of TABS) {
        con.at(tab);
        try {
          await gotoTab(page, tab);
        } catch (e) {
          broken.push(`${tab}: the panel never rendered — ${String((e as Error).message).slice(0, 160)}`);
          continue;
        }
        const p = panel(page, tab);

        // (1) Something is on screen. A tab that mounts empty is a tab that did
        //     not load, and it must not pass by rendering nothing.
        const text = (await p.innerText().catch(() => '')).trim();
        if (text.length < 10) { broken.push(`${tab}: the panel rendered ${text.length} characters of text`); continue; }

        // (2) No id is ever drawn.
        const uuid = text.match(UUID);
        if (uuid) broken.push(`${tab}: renders a UUID as text — "${uuid[0]}"`);
        const member = text.match(MEMBER_ID);
        if (member) broken.push(`${tab}: renders a member id as text — "${member[0]}"`);

        // (3) No native date control anywhere. `.pk__native` is DateInput's own
        //     hidden serialisation input and is the one legitimate exception.
        const native = await p.locator('input[type="date"]:not(.pk__native), input[type="datetime-local"]:not(.pk__native)').count();
        if (native) broken.push(`${tab}: has ${native} native date input(s) — the product uses ui/DateInput.jsx`);

        // (4) The tab is not sitting on an error state. `.k-err` is
        //     `ErrorState`'s own root (`ui/ErrorState.jsx:98`, role="alert").
        const errored = p.locator('.k-err');
        const n = await errored.count();
        if (n) {
          const kinds: string[] = [];
          for (let i = 0; i < n; i++) {
            kinds.push(((await errored.nth(i).getAttribute('data-kind')) || '?') + ' · ' +
              (await errored.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120));
          }
          broken.push(`${tab}: is showing ${n} error state(s) — ${kinds.join(' ; ')}`);
        }
      }

      // The console dump rides along with the sweep's own message: this
      // assertion throws first, and a reader who only sees "renders a UUID"
      // would otherwise never learn what the console said on the other screens.
      expect(
        broken,
        `Graha screen sweep found:${broken.length ? '\n     ' + broken.join('\n     ') : ''}` +
        `\n\n     console across all twenty screens:${dumpConsole(con)}`,
      ).toEqual([]);

      const uncaught = con.errors.filter((e) => e.text.startsWith('UNCAUGHT'));
      expect(uncaught, `uncaught errors across the twenty Graha screens:${dumpConsole(con)}`).toEqual([]);
      expect(
        con.errors,
        `console errors across the twenty Graha screens. Zero is the standard — every ` +
        `one of these is something a customer's browser is reporting:${dumpConsole(con)}`,
      ).toEqual([]);
    });
});
