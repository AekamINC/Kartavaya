/**
 * Proposal 93 · Stage 3 · WAVE 7 · SUITE 20 — CROSS-CUTTING, on Unicode Group.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS SUITE IS FOR — and why a row count cannot do its job
 * ═══════════════════════════════════════════════════════════════════════════
 * §1 of proposal 93, and it is evidenced rather than asserted: *"Every defect
 * this product has shipped in the classes above was invisible to the
 * database."* A component that rendered a map and drew nothing for eighteen
 * days. A territory map reachable only while creating a territory. A button
 * whose only write path answered 422 for its entire life. A screen that
 * displayed six wrong numbers. On 2026-08-29 alone: no kanban card could be
 * dragged with a mouse AT ALL — 24 drags over two runs, zero
 * `PATCH /tasks/{id}/move`, the board text-selecting instead.
 *
 * Not one of those fails a row-count check. They fail an interaction check,
 * which is what every test below is.
 *
 * §10 defines Suite 20 over ALL SCREENS:
 *   no UUID rendered anywhere · every date input is DateInput · every table on
 *   `--row-h` · full keyboard traversal, Enter/Space/Escape · empty states seen
 *   before data exists · loading and error states under a throttled and cut
 *   network · pagination past 200 · the nine `?since=` delta lists · zero
 *   uncaught console errors.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LANE, AND THE GUARD THAT PROVES IT
 * ═══════════════════════════════════════════════════════════════════════════
 * `lane('unicode')` + `signInAs()` from `_lanes.ts`. Read that file's header
 * before changing a line here: on 2026-08-28 a write suite renamed **Aekam
 * Inc** — the one org proposal 93 guarantees is untouched — because the
 * credential in use held `platform_admin` and every request resolved to Aekam
 * via `platform_bypass`. The save genuinely succeeded and the suite went GREEN.
 * `signIn()` below re-asserts AFTER pinning the active-org key, because that
 * key is written after the door opens and it is the key that decides which org
 * `X-Org-Id` names.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS SUITE WRITES — the whole list, because "almost nothing" is not a
 * measurement
 * ═══════════════════════════════════════════════════════════════════════════
 * Rule 1 says every row is typed by a user. This suite is a READING suite and
 * creates no rows at all. It makes exactly TWO mutating requests, both by
 * dragging with the mouse, and both reverted inside the same test:
 *
 *   20.12  one `PATCH /api/tasks/{id}/move` that reorders a card WITHIN its own
 *          column, and a second that puts it back. 20.15 re-reads the card's
 *          `sort_order` and fails if the board did not come back to where it
 *          started.
 *
 * ⚠ WITHIN its own column, and that is a safety decision, not a convenience.
 * `server.move_task` calls `_notify_status_changed` — which EMAILS every
 * assignee and the creator — only `if doc["status"] != new_status`. A move
 * between two columns changes the status; a reorder inside one does not. The
 * fence is off: `GET /api/health` reports `outbound_mode=live` with
 * `suppressed_orgs_digest="0"`, so NOTHING is shielded, and every Unicode
 * member address is a real deliverable inbox. A cross-column drag here would
 * mail real people to prove a mouse gesture. 20.12 asserts the fence's own
 * precondition — that the card it picked has no assignee but the actor —
 * before it presses, so the reasoning is checked and not merely written down.
 *
 * Nothing else here submits a form, presses a send, or opens a destructive
 * control. The Danger zone tab is RENDERED and never touched.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LEDGER IS A FILE, AND THAT IS THE POINT
 * ═══════════════════════════════════════════════════════════════════════════
 * 20.01 sweeps every screen once and records what it saw. 20.02–20.05 each
 * assert ONE dimension of that record, so a UUID finding cannot hide a
 * row-height finding behind it — the failure mode `suite05` names, where the
 * first version of its billing test died on a 422 and took metered usage and
 * SLA credits down with it, reporting two §4 lines as untested when they had
 * simply never been reached.
 *
 * The ledger is written to a FILE because **Playwright starts a new worker
 * after a failed test** and module-level state does not survive it. In memory,
 * every test after the first red one would read an empty ledger and report
 * "nothing was swept" — a cascade of false findings on top of the real one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SCREEN LIST IS DISCOVERED, NOT TYPED
 * ═══════════════════════════════════════════════════════════════════════════
 * Module tabs are read off the DOM at run time — the inline `[role=tab]`
 * labels plus whatever `ModuleTabs` has pushed behind "More +N" — and each is
 * then opened by LABEL. Three reasons, all of them scars:
 *
 *   · Which tabs are inline is MEASURED at run time from the strip's own
 *     client width (`ModuleTabs.jsx:110-137`) and cannot be known from source.
 *   · Selecting a tail tab MOVES it into the head (`:141-146`), so the
 *     composition changes as the sweep walks it. A snapshot of ids taken once
 *     would drift; a snapshot of the full ORDERED LABEL LIST does not.
 *   · A hand-typed list is a silent cap. §10's own warning is that on a suite
 *     whose scope is "all screens", a cap reads as full coverage more easily
 *     than anywhere else in this programme. A discovered list grows when the
 *     product grows.
 *
 * ⚠ `getByRole(name)` matches the ACCESSIBLE NAME, not the visible text. That
 * mistake produced three false "missing control" findings in one day. Every
 * tab here is reached by its own `#mt-tab-{id}` button or by its menu row's
 * text, never by a role-name guess.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS NOT SWEPT, SAID OUT LOUD
 * ═══════════════════════════════════════════════════════════════════════════
 *   · `/admin/**` — the platform console. Suite 19's, and it needs god mode;
 *     this lane is deliberately org-scoped (`_lanes.ts` rule 1).
 *   · `/client/**` — the portal. Suite 18's, and it needs a portal account.
 *   · `/sign/:token`, `/i/:token`, `/accept-invite`, `/reset-password` —
 *     token routes. Inventing a token tests the 404 path, not the screen.
 *   · `/settings/social-accounts` and Prachar's `ads` tab are EXCLUDED BY
 *     DECISION (§13) from functional coverage. They are still rendered and
 *     scanned here, because "does this screen throw" is not the work §13
 *     excluded — that was the OAuth plumbing and the publish step. Marked in
 *     the ledger so the distinction survives into the report.
 *   · Record drawers, modals and forms below the tab level, except the four
 *     that 20.13 needs. A drawer per screen is Suite 22's dead-control sweep
 *     and each module suite's own job; claiming it here would be the cap §10
 *     warns about.
 *   · The genuinely-new-org empty state. Unicode is a WAVE 7 org and is full.
 *     20.09 drives each list's empty BRANCH by emptying its response, which is
 *     the component's day-one render — it is not a new org, and Suite 00 on
 *     UK AekamINC is what covers that. Stated, not blurred.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MEASUREMENTS THIS FILE RESTS ON — every one re-run 2026-08-29
 * ═══════════════════════════════════════════════════════════════════════════
 *   schemas                        15 (`staging` + `public` are the product's)
 *   Unicode activity events        519 reachable through `/api/activity/feed`
 *   Unicode module subscriptions   12, all active
 *   protected `team_ae1d58543b21`  20 tasks
 *   `/api/activity/feed?limit=250` 422 — the cap is DECLARED, `le=200`
 *   `?since=` 2020-01-01           400 "more than 365 days old" — REJECTS,
 *                                  never clamps, and that refusal is CORRECT
 *
 * ⚠ Counts drift. Everything below asserts a DELTA, a shape or a threshold —
 * never a live total copied into a constant.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite20.config.ts
 */
import { test, expect, Page, Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { lane, signInAs as laneSignIn, assertOrg, ORG as ORG_IDS } from './_lanes';

const LANE = lane('unicode');
const API = process.env.E2E_API_URL || 'https://api.kartavaya.com';

const OUT = path.join(os.tmpdir(), 'kartavya-e2e-suite20');
const LEDGER = path.join(OUT, 'ledger.json');
fs.mkdirSync(OUT, { recursive: true });

const BLOCKED =
  'BLOCKED — no Unicode Group credential. Set E2E_UNICODE_TOKEN (or ' +
  'E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e at the repo root. ⚠ It must be an ' +
  'ORG-SCOPED account: a platform_admin token resolves to Aekam Inc via ' +
  'platform_bypass and will write there. ENVIRONMENT blocker, not a product ' +
  'or test defect.';

/* ═══════════════════════════════════════════════════════════════════════════
   THE SCREEN INVENTORY
   ═══════════════════════════════════════════════════════════════════════════
   Top-level destinations in nav order, verified against `src/App.jsx` at HEAD
   on 2026-08-29. `tabs` says how the screens BELOW a route are reached:

     'module'  — <ModuleTabs>: `#mt-tab-{id}` in a strip, overflow behind
                 "More +N", panel at `#mt-panel-{id}`.
     'url'     — <Tabs> driven by `?tab=`, panel at `.tabs__panel`.
     null      — one screen, no tabs.
   ═══════════════════════════════════════════════════════════════════════════ */
type TabKind = 'module' | 'url' | null;
type Route = { id: string; path: string; tabs: TabKind; note?: string };

const ROUTES: Route[] = [
  { id: 'dashboard', path: '/dashboard', tabs: null },
  { id: 'boards', path: '/boards', tabs: null },
  { id: 'projects', path: '/projects', tabs: null },
  { id: 'tasks', path: '/tasks', tabs: null },
  { id: 'teams', path: '/teams', tabs: null },
  { id: 'inbox', path: '/inbox', tabs: null },
  { id: 'approvals', path: '/approvals', tabs: null },
  { id: 'templates', path: '/templates', tabs: null },
  { id: 'activity', path: '/activity', tabs: null },
  { id: 'time', path: '/time', tabs: null },
  { id: 'reports', path: '/reports', tabs: null },
  { id: 'graha', path: '/graha', tabs: 'module' },
  { id: 'ganit', path: '/ganit', tabs: 'module' },
  { id: 'kray', path: '/kray', tabs: 'module' },
  { id: 'manav', path: '/manav', tabs: 'module' },
  { id: 'vetana', path: '/vetana', tabs: 'module' },
  { id: 'pahchan', path: '/pahchan', tabs: 'module' },
  { id: 'vikray', path: '/vikray', tabs: 'module' },
  { id: 'prachar', path: '/prachar', tabs: 'module', note: 'the `ads` tab is §13-excluded from functional coverage; rendered here only' },
  { id: 'dristi', path: '/dristi', tabs: 'module' },
  { id: 'sanvaad', path: '/sanvaad', tabs: null },
  { id: 'esign', path: '/esign', tabs: 'module' },
  { id: 'hub', path: '/hub', tabs: 'module', note: 'the `publish` tab is §13-excluded from functional coverage; rendered here only' },
  { id: 'hub-clients', path: '/hub/clients', tabs: null },
  { id: 'hub-org', path: '/hub/org', tabs: 'module' },
  { id: 'settings-org', path: '/settings/organisation', tabs: 'url' },
  { id: 'settings-roles', path: '/settings/roles', tabs: null },
  { id: 'settings-categories', path: '/settings/categories', tabs: null },
  { id: 'settings-customize', path: '/settings/customize', tabs: 'url' },
  { id: 'settings-connectors', path: '/settings/connectors', tabs: null, note: '§13-excluded from functional coverage; rendered here only' },
  { id: 'settings-automations', path: '/settings/automations', tabs: null },
];

/**
 * `?tab=` values for the two `<Tabs>` routes, read from the source at HEAD.
 * These cannot be discovered the way module tabs are — `<Tabs>` renders only
 * the ACTIVE panel and the strip carries no id per value — so they are typed,
 * and 20.01 asserts the count it found matches the count it asked for. A tab
 * that has been added and not listed here shows up as a discrepancy rather
 * than as silence.
 */
const URL_TABS: Record<string, string[]> = {
  '/settings/organisation': [
    'profile', 'members', 'billing', 'modules', 'compliance',
    'senders', 'upi', 'security', 'storage', 'recycle', 'danger',
  ],
  '/settings/customize': [
    'appearance', 'typography', 'layout', 'language',
    'notifications', 'security', 'data',
  ],
};

/* ═══════════════════════════════════════════════════════════════════════════
   THE LEDGER
   ═══════════════════════════════════════════════════════════════════════════ */
type Row = {
  height: number;
  token: number | null;
  sel: string;
};
type Screen = {
  id: string;
  path: string;
  /**
   * The tab's VISIBLE LABEL, recorded because it is the only handle later
   * tests have on it.
   *
   * ⚠ RUN 1, 2026-08-29: four tests failed with "neither a tab labelled
   * `rate-cards` nor `#mt-tab-rate-cards` exists on /ganit". Both halves of
   * that were true and neither was a product fault. `GanitPage` declares the
   * tab as the ID `rate-cards`; `ModuleTabs` renders the LABEL; and the id
   * attribute `#mt-tab-rate-cards` exists only while the tab is INLINE — with
   * 21 tabs and a `max` of 8, most of Ganit lives behind "More +13", where the
   * menu rows carry no id at all.
   *
   * So the id→label map cannot be derived from the source and cannot be typed
   * without going stale. 20.01 already opens every tab; it records the pair as
   * it goes, and `openTabById()` looks it up. A tab that has been renamed
   * therefore keeps working, and one that has been REMOVED fails by name.
   */
  label?: string;
  family: 'route' | 'moduletab' | 'urltab' | 'chrome';
  excluded?: string;
  verdict: string;
  detail: string;
  chars: number;
  console: string[];
  uncaught: string[];
  uuids: string[];
  nativeDates: string[];
  rowToken: number | null;
  badRows: string[];
  rowsSeen: number;
  hScroll: boolean;
};
type Ledger = {
  startedAt: string;
  finishedAt: string | null;
  viewport: { w: number; h: number };
  band: string;
  screens: Screen[];
  intended: number;
  writes: string[];
};

function readLedger(): Ledger {
  expect(
    fs.existsSync(LEDGER),
    `no ledger at ${LEDGER} — 20.01 did not run, or it threw before writing one. ` +
    'Every assertion in 20.02-20.05 reads that file; run 20.01 first. This is a ' +
    'RUN-ORDER fact, not a product finding.',
  ).toBeTruthy();
  return JSON.parse(fs.readFileSync(LEDGER, 'utf8')) as Ledger;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE DOOR
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Sign in, point the session at Unicode Group, and REFUSE TO CONTINUE unless
 * the server agrees that is where it is.
 *
 * The org key is the switcher's own (`lib/orgContext.js`), written before the
 * app boots so `api.js`'s interceptor puts `X-Org-Id` on every product call.
 * Without it the server resolves to the caller's OLDEST membership — and this
 * account holds more than one.
 */
async function signIn(page: Page) {
  await laneSignIn(page, LANE);
  await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), LANE.orgId);
  await assertOrg(page.request, page, LANE);
  expect(LANE.orgId, 'the lane must be Unicode Group').toBe(ORG_IDS.UNICODE);
  expect(LANE.orgId, 'the lane must never be Aekam Inc').not.toBe(ORG_IDS.AEKAM);
}

/* ═══════════════════════════════════════════════════════════════════════════
   READ-BACK — GET only, and always with X-Org-Id
   ═══════════════════════════════════════════════════════════════════════════
   `page.request.get` is the ratchet's own carve-out (`check-e2e-no-bypass.mjs`):
   asserting the row appeared IS the required evidence. Both helpers send
   `X-Org-Id` (`frontend/src/lib/api.js:39`), because a read that omits it makes
   the server fall back to the caller's oldest membership and answer for a
   different organisation than the screen beside it.
   ═══════════════════════════════════════════════════════════════════════════ */
async function apiGet(page: Page, pathAndQuery: string) {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  return page.request.get(`${API}${pathAndQuery}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Org-Id': LANE.orgId,
    },
  });
}

async function apiJson(page: Page, pathAndQuery: string): Promise<any> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 300)}`)
    .toBeLessThan(400);
  return await res.json();
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE CONSOLE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Console lines that are not defects.
 *
 * Kept deliberately short — every entry is a thing this suite will never catch
 * again, so each one is a decision rather than a convenience. Copied from
 * `coldstart-nav-audit.spec.ts`, which argues each of them, plus one:
 * a 403 from a module the org has not subscribed to is the product refusing
 * correctly, and this org subscribes to all twelve, so it should not fire at
 * all — it is here so that if it ever does, the reason is legible.
 */
const IGNORE = [
  /favicon/i,
  /Download the React DevTools/i,
  /\[vite\]/i,
  /Failed to load resource.*401/i,
];

type Watcher = {
  errors: { where: string; text: string }[];
  uncaught: { where: string; text: string }[];
  at: (where: string) => void;
};

/**
 * Console errors and uncaught exceptions, TAGGED WITH THE SCREEN they fell on.
 *
 * §1: "the console is watched throughout — zero uncaught errors across the
 * whole run, collected PER SCREEN. An exception that does not visibly break
 * anything today is a defect that will."
 *
 * ⚠ React error #31 ("Objects are not valid as a React child") has shipped
 * here twice — once from a 422 `detail` array, once from a jsonb — and both
 * times the screen went blank rather than saying anything. `lib/apiError.js`
 * is the choke point that now returns a STRING for all three FastAPI detail
 * shapes. An uncaught #31 anywhere in this sweep means a call site that has
 * not been routed through it.
 */
function watchConsole(page: Page): Watcher {
  const errors: { where: string; text: string }[] = [];
  const uncaught: { where: string; text: string }[] = [];
  let where = 'boot';
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (IGNORE.some((r) => r.test(text))) return;
    errors.push({ where, text: text.slice(0, 240) });
  });
  page.on('pageerror', (e) => {
    uncaught.push({ where, text: String(e?.message ?? e).slice(0, 300) });
  });
  return { errors, uncaught, at: (w: string) => { where = w; } };
}

/** Settle, but never fail on it — the shell polls, so networkidle may not come. */
async function settle(page: Page, ms = 12_000) {
  await page.waitForLoadState('networkidle', { timeout: ms }).catch(() => {});
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE PER-SCREEN SCAN — one traversal, every collector
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything §10 asks about one screen, measured in a single `evaluate`.
 *
 * One pass rather than one pass per dimension, because ~145 screens × six
 * traversals is an hour of wall clock that measures nothing extra, and because
 * a second traversal is a second chance for the app's state to differ from the
 * one the first traversal judged.
 *
 * ── SCOPED TO `#main`, AND THAT IS DELIBERATE ───────────────────────────────
 * `AppShell` renders `<main className="kv__content" id="main">`. Scanning the
 * whole body would report the sidebar's contents once per screen — 145 copies
 * of one finding, which is how a real defect gets lost in its own noise. The
 * shell chrome is scanned ONCE, separately, and recorded as its own row.
 *
 * ── WHAT COUNTS AS A DATE INPUT ─────────────────────────────────────────────
 * `DateInput` keeps ONE native control per field — `.pk__native`, `tabIndex=-1`,
 * `aria-hidden` — because form serialisation by `name` depends on it and the
 * file says so at `:166`. That one is correct and is excluded. Anything else
 * with `type` in the date family is a native date control in a product whose
 * standing rule is that there are none.
 *
 * ── WHAT COUNTS AS A ROW ON `--row-h` ───────────────────────────────────────
 * The expected height is READ OFF EACH ROW with
 * `getComputedStyle(row).getPropertyValue('--row-h')`, never named as a number.
 * Three reasons and each is a live fact:
 *   · 66px is the `cozy` default but `viewport-fit.css` band V2 (≤780px tall)
 *     makes it **50px**, which is CORRECT and was nearly filed as a defect on
 *     2026-08-29;
 *   · `[data-density]` moves it to 48 / 66 / 76;
 *   · `.vgw` and `.sk-fx__wrap` set a local 48px on purpose.
 * Reading the token off the row itself satisfies all three without a table of
 * exceptions that would go stale.
 *
 * `.lgl__table`, `.pay__tbl`, `.sh-ev` and `.amx` are the four documented
 * opt-outs in `check-table-rows.mjs` and are excluded here for the same
 * reasons that script gives.
 */
async function scan(page: Page): Promise<Omit<Screen, 'id' | 'path' | 'family' | 'verdict' | 'detail' | 'console' | 'uncaught'>> {
  return await page.evaluate(() => {
    const scope: HTMLElement =
      (document.querySelector('#main') as HTMLElement) ||
      (document.querySelector('main') as HTMLElement) ||
      document.body;

    const text = (scope.innerText || '').trim();

    // ── UUIDs in PAINTED TEXT ────────────────────────────────────────────
    // `check-rendered-ids.mjs` is static and positional: it reads JSX and
    // cannot see an id the SERVER pre-formatted into a string, nor one passed
    // as a prop and drawn in a child. Two blind spots of exactly that shape
    // have already been found. So this reads what a person can actually see.
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const hits = [...new Set(text.match(UUID) || [])].slice(0, 3);
    const uuids = hits.map((h) => {
      const at = text.indexOf(h);
      return `${h}  ←  …${text.slice(Math.max(0, at - 60), at + h.length + 25).replace(/\s+/g, ' ')}…`;
    });

    // ── NATIVE DATE-FAMILY CONTROLS ──────────────────────────────────────
    const nativeDates = [...scope.querySelectorAll<HTMLInputElement>(
      'input[type="date"],input[type="datetime-local"],input[type="month"],input[type="time"]',
    )]
      .filter((el) => !el.classList.contains('pk__native'))
      .map((el) => `<input type="${el.type}" class="${el.className || '(none)'}" name="${el.name || '-'}">`);

    // ── ROW HEIGHTS AGAINST THE TOKEN ────────────────────────────────────
    const SELECTORS = [
      '.tbl__wrap table.tbl tbody tr',
      'table.omt tbody tr',
      'table.gn-coll tbody tr',
    ];
    const EXCLUDE = ['.lgl__table', '.pay__tbl', '.sh-ev', '.amx'];
    const badRows: string[] = [];
    let rowsSeen = 0;
    for (const sel of SELECTORS) {
      const rows = [...scope.querySelectorAll<HTMLElement>(sel)];
      for (const r of rows) {
        if (EXCLUDE.some((x) => r.closest(x))) continue;
        // ── AN EXPANSION ROW IS NOT A DATA ROW ───────────────────────────
        //
        // Several tables render an inline editor as one full-width row —
        // `<tr><td colspan={COLUMNS.length}><form class="k-formpanel">…`.
        // `manav#notices` puts an entire status form in one, which measures
        // 254px, and holding a form to a 50px row token is asking the wrong
        // question. `--row-h` is the ONE ROW CONTRACT for rows that carry a
        // record; an expanded editor is a panel that happens to live in a
        // `<tbody>`.
        //
        // ⚠ THIS WAS EATING THE REAL SIGNAL. On 2026-08-31 this test named ten
        // screens; FOUR of them (manav#notices, manav#udin, manav#dsc,
        // graha#documents) were only their expansion forms, and the six
        // genuine ones — contacts, products and stock sitting 6–9px over the
        // token — read as the small print at the bottom of a long list. A
        // check that reports four false rows for every six true ones is one
        // people learn to skim.
        //
        // Detected by SHAPE — a single cell spanning the table — rather than
        // by a class list, which would need a new entry for every table that
        // grows an inline editor and would silently under-report until it got
        // one.
        const cells = r.children;
        if (cells.length === 1 && (cells[0] as HTMLTableCellElement).colSpan > 1) continue;
        const box = r.getBoundingClientRect();
        // A row scrolled out of layout has no box; measuring it says nothing.
        if (box.height === 0) continue;
        rowsSeen++;
        const raw = getComputedStyle(r).getPropertyValue('--row-h').trim();
        const token = raw ? parseFloat(raw) : NaN;
        if (!Number.isFinite(token)) {
          badRows.push(`${sel}: row has NO --row-h in scope at all`);
          continue;
        }
        // ±1.5px: the 1px rule between rows lands on either side of the box
        // depending on `box-sizing` and the browser's own rounding.
        if (Math.abs(box.height - token) > 1.5) {
          badRows.push(`${sel}: ${Math.round(box.height * 10) / 10}px against a --row-h of ${token}px`);
        }
      }
      if (badRows.length > 6) break;
    }

    const rootToken = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--row-h').trim(),
    );

    return {
      chars: text.length,
      uuids,
      nativeDates: [...new Set(nativeDates)],
      rowToken: Number.isFinite(rootToken) ? rootToken : null,
      badRows: [...new Set(badRows)].slice(0, 6),
      rowsSeen,
      hScroll:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  });
}

/**
 * Did this screen BREAK? — the same four verdicts `coldstart-nav-audit`
 * settled on, with its two corrections kept.
 *
 * ⚠ Its first version matched the free text /try again/i and flagged
 * `/hub/org` as broken; "Try again" is the REGENERATE button on a SUCCESSFUL
 * Sahayak answer. Its second counted `.note--warn` and flagged `/manav` and
 * `/vetana`, whose notes are correct advisories ("61 of the 73 employees shown
 * have no login linked…"). `.hb-err` is the only precise marker, and the three
 * phrases below never appear as legitimate UI copy.
 */
async function verdictFor(page: Page, wantPath: string, chars: number): Promise<[string, string]> {
  const landed = new URL(page.url()).pathname;
  if (landed !== wantPath && !landed.startsWith(wantPath)) return ['REDIRECTED', `→ ${landed}`];

  const spinners = await page
    .locator('[role="progressbar"], .k-spinner, .spinner, [aria-busy="true"]')
    .count()
    .catch(() => 0);
  if (chars < 40 && spinners === 0) return ['BLANK', `body text ${chars} chars`];
  if (spinners > 0 && chars < 200) return ['SPINNER-STUCK', `${spinners} spinner(s), ${chars} chars`];

  const errNotes = await page.locator('.hb-err').count().catch(() => 0);
  const body = await page.locator('body').innerText().catch(() => '');
  const errText = /something went wrong|unexpected error|an error occurred/i;
  if (errNotes > 0 || errText.test(body)) {
    return ['ERROR-STATE', errNotes ? `${errNotes} error note(s)` : (body.match(errText)?.[0] ?? '')];
  }
  return ['ok', ''];
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB MACHINERY
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The full ORDERED tab label list for a `<ModuleTabs>` page: the inline strip
 * plus whatever is behind "More +N". Read from the DOM, for the three reasons
 * the file header gives.
 */
async function moduleTabLabels(page: Page): Promise<string[]> {
  const strip = page.locator('.mt__wrap');
  await expect(strip, 'the module tab strip never rendered').toBeVisible({ timeout: 60_000 });

  const inline = await page.locator('.mt [role="tab"] .mt__en').allInnerTexts();
  let tail: string[] = [];
  const more = strip.locator('button.mt__more');
  if (await more.count()) {
    await more.click();
    const pop = page.locator('.mt__pop');
    await expect(pop, 'the More menu did not open').toBeVisible({ timeout: 10_000 });
    tail = await pop.locator('[role="menuitem"] .mt__pop-en').allInnerTexts();
    await page.keyboard.press('Escape');
    await expect(pop, 'Escape did not close the More menu').toBeHidden({ timeout: 5_000 });
  }
  return [...inline, ...tail].map((s) => s.trim()).filter(Boolean);
}

/**
 * Open one tab by its LABEL, inline or out of the More popover, and hand back
 * the panel it rendered into plus the panel's own id.
 *
 * A tab that is in neither place is a FAILURE and not a skip — `_helpers.ts`'s
 * standing rule, learned when `full-journey.spec.ts` used
 * `test.skip(!opened, 'no affordance')` and the e-sign journey reported green
 * for weeks while the whole module answered 403.
 */
/**
 * Open a tab by its ID, using the label 20.01 recorded for it.
 *
 * This is the fix for run 1's four "neither a tab labelled X nor #mt-tab-X
 * exists" failures — see the note on `Screen.label`. The lookup is a hard
 * failure when the ledger has no such tab: a tab named here and absent from
 * the sweep is a missing screen, which is a finding, not a skip.
 */
async function openTabById(page: Page, L: Ledger, route: string, id: string) {
  // The ledger keys a tab as `<route id>#<panel id>`, and the route id is not
  // always the path with its slash removed (`/hub/org` is `hub-org`), so it is
  // resolved through the inventory rather than guessed.
  const routeId = ROUTES.find((r) => r.path === route)?.id ?? route.replace(/^\//, '');
  const want = `${routeId}#${id}`;
  const hit = L.screens.find((s) => s.family === 'moduletab' && s.id === want && s.label);
  expect(
    hit,
    `no tab "${id}" was found on ${route} during the sweep. Either the tab has been ` +
    'removed from the product, or 20.01 did not reach it — both are findings and ' +
    'neither is a reason to carry on against whichever screen happens to be open.',
  ).toBeTruthy();
  return await openTabByLabel(page, hit!.label!);
}

async function openTabByLabel(page: Page, label: string): Promise<{ panel: Locator; id: string }> {
  /**
   * ⚠ WAIT FOR THE STRIP BEFORE DECIDING WHERE THE TAB IS.
   *
   * Run 2 failed 20.07 and 20.09 with `tab "Invoices" is not in the More menu
   * either` — and Invoices is the FIRST tab on the strip, inline, never in the
   * menu. The module page is a lazy chunk: on the line after
   * `goto(waitUntil:'domcontentloaded')` nothing is mounted, so `inline.count()`
   * was 0, the code fell through to the overflow branch, and `expect(more)`
   * then WAITED long enough for the strip to appear — by which time it clicked
   * a real More button and looked for an inline tab inside it.
   *
   * A count read before the thing exists is the false-negative that produces a
   * "missing control" report about a control that is on screen. One `waitFor`
   * removes the whole class.
   */
  await page.locator('.mt__wrap').waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('.mt [role="tab"]').first().waitFor({ state: 'visible', timeout: 30_000 });

  const inline = page.locator('.mt [role="tab"]').filter({ hasText: label }).first();
  if (await inline.count()) {
    await inline.click();
  } else {
    const more = page.locator('.mt__wrap button.mt__more');
    await expect(more, `tab "${label}" is neither inline nor behind a More menu`).toBeVisible();
    await more.click();
    const item = page.locator('.mt__pop [role="menuitem"]').filter({ hasText: label }).first();
    await expect(item, `tab "${label}" is not in the More menu either`).toBeVisible({ timeout: 10_000 });
    await item.click();
  }
  await settle(page);
  const panel = page.locator('[role="tabpanel"]').first();
  await expect(panel, `the "${label}" tab selected but rendered no panel`).toBeVisible({ timeout: 30_000 });
  const id = (await panel.getAttribute('id')) || `mt-panel-?(${label})`;
  return { panel, id };
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESPONSE SHAPING — how loading, empty and error states are reached
   ═══════════════════════════════════════════════════════════════════════════
   Unicode is a wave 7 org and is FULL, so its day-one states are not reachable
   by navigating to them. They are reached by shaping the RESPONSE the screen
   receives, which is the same screen the component renders on day one and is
   the only honest way to see it without wiping an org that five other suites
   are still using.

   Every shaper intercepts GET ONLY and never writes. `emptied` re-issues the
   real request and rewrites the body, so the envelope the screen expects is
   preserved whatever shape it is — an array, `{data:[]}`, or `{items:[]}`.
   Guessing the envelope is how a shaper produces a crash the product does not
   have.
   ═══════════════════════════════════════════════════════════════════════════ */
type Shaper = 'empty' | 'slow' | 'cut' | 'error';

async function shape(page: Page, pattern: RegExp, kind: Shaper, delayMs = 6_000) {
  await page.route(pattern, async (route) => {
    /**
     * ⚠ EVERY ROUTE ACTION IS FAILURE-TOLERANT, AND RUN 2 IS WHY.
     *
     * 20.06 died on `route.continue: Route is already handled!`. The `slow`
     * shaper sleeps for seven seconds; if the page navigates, reloads or the
     * component unmounts in that window, Playwright has already disposed of
     * the request and `continue()` throws — taking a test that was measuring
     * the product down with it, and reporting an infrastructure artefact as a
     * failure. A shaper that cannot complete has measured nothing; it must not
     * also break the run.
     */
    const safe = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* request already gone */ } };

    if (route.request().method() !== 'GET') return safe(() => route.fallback());
    if (kind === 'cut') return safe(() => route.abort('failed'));
    if (kind === 'error') {
      return safe(() => route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Service unavailable (simulated by suite 20)' }),
      }));
    }
    if (kind === 'slow') {
      await new Promise((r) => setTimeout(r, delayMs));
      return safe(() => route.continue());
    }
    try {
      const res = await route.fetch();
      const txt = await res.text();
      let body = txt;
      try {
        const j = JSON.parse(txt);
        if (Array.isArray(j)) body = '[]';
        else if (j && Array.isArray(j.data)) body = JSON.stringify({ ...j, data: [] });
        else if (j && Array.isArray(j.items)) body = JSON.stringify({ ...j, items: [] });
      } catch { /* not JSON — pass it through untouched */ }
      await route.fulfill({ response: res, body });
    } catch {
      await safe(() => route.continue());
    }
  });
}

const unshape = async (page: Page, pattern: RegExp) => {
  // The page can be gone by the time a test unwinds; failing to REMOVE an
  // interceptor must never be the reason a run reports red.
  try { await page.unroute(pattern); } catch { /* context closed */ }
};

/* ═══════════════════════════════════════════════════════════════════════════ */

test.beforeAll(() => {
  if (!LANE.token && !LANE.password) throw new Error(BLOCKED);
  console.log(
    `\n  LANE: ${LANE.org}  (reference lane, §14)` +
    `${LANE.token ? '  · door opened by TOKEN, every assertion still driven on screen' : '  · real form login'}` +
    `\n  LEDGER: ${LEDGER}\n`,
  );
});

test.describe('Suite 20 — Cross-cutting · Unicode Group', () => {

  /* ══════════════════════════════════════════════════════════════════════
     20.01 — THE SWEEP
     ══════════════════════════════════════════════════════════════════════ */
  test('20.01 every screen in the product is opened once, and the ledger records what it painted', async ({ page }) => {
    test.setTimeout(55 * 60_000);
    const con = watchConsole(page);
    await signIn(page);

    const vp = page.viewportSize() || { width: 1280, height: 720 };
    const band =
      vp.height <= 780 ? 'V2 (≤780px tall — --row-h 50px at cozy)'
        : vp.height <= 900 ? 'V1 (≤900px tall — --row-h 56px at cozy)'
          : 'none (--row-h 66px at cozy)';

    const ledger: Ledger = {
      startedAt: new Date().toISOString(),
      finishedAt: null,
      viewport: { w: vp.width, h: vp.height },
      band,
      screens: [],
      intended: 0,
      writes: [],
    };

    /** One screen: tag the console, scan, judge, record. */
    const record = async (id: string, wantPath: string, family: Screen['family'], excluded?: string, label?: string) => {
      const before = { e: con.errors.length, u: con.uncaught.length };
      con.at(id);
      let s: Awaited<ReturnType<typeof scan>>;
      let verdict = 'ok';
      let detail = '';
      try {
        s = await scan(page);
        [verdict, detail] = await verdictFor(page, wantPath, s.chars);
      } catch (e: any) {
        s = { chars: 0, uuids: [], nativeDates: [], rowToken: null, badRows: [], rowsSeen: 0, hScroll: false };
        verdict = 'THREW';
        detail = String(e?.message ?? e).slice(0, 200);
      }
      ledger.screens.push({
        id, path: wantPath, label, family, excluded, verdict, detail,
        console: con.errors.slice(before.e).map((x) => x.text),
        uncaught: con.uncaught.slice(before.u).map((x) => x.text),
        ...s,
      });
    };

    // ── The shell chrome, once ────────────────────────────────────────────
    // Scanned on its own so a finding in the sidebar is ONE row rather than
    // 145 copies of itself. `#main` is excluded here, which is exactly the
    // inverse of every other scan below.
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await settle(page);
    con.at('shell chrome');
    const chrome = await page.evaluate(() => {
      const main = document.querySelector('#main');
      const clone = document.body.cloneNode(true) as HTMLElement;
      if (main) clone.querySelector('#main')?.remove();
      const text = (clone.innerText || clone.textContent || '').trim();
      const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
      const hits = [...new Set(text.match(UUID) || [])].slice(0, 3);
      return { chars: text.length, uuids: hits };
    });
    ledger.screens.push({
      id: 'shell chrome (sidebar, topbar, dock)', path: '/dashboard', family: 'chrome',
      verdict: 'ok', detail: 'scanned once, deliberately — see the header',
      chars: chrome.chars, console: [], uncaught: [], uuids: chrome.uuids,
      nativeDates: [], rowToken: null, badRows: [], rowsSeen: 0, hScroll: false,
    });

    // ── Every route, and every screen beneath it ──────────────────────────
    for (const r of ROUTES) {
      try {
        await page.goto(r.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        // A fair chance at the first paint of data before anything is judged.
        await settle(page);
        await page.waitForTimeout(1200);
      } catch (e: any) {
        ledger.intended++;
        ledger.screens.push({
          id: r.id, path: r.path, family: 'route', excluded: r.note,
          verdict: 'THREW', detail: String(e?.message ?? e).slice(0, 200),
          chars: 0, console: [], uncaught: [], uuids: [], nativeDates: [],
          rowToken: null, badRows: [], rowsSeen: 0, hScroll: false,
        });
        continue;
      }

      ledger.intended++;
      await record(r.id, r.path, 'route', r.note);

      if (r.tabs === 'module') {
        let labels: string[] = [];
        try {
          labels = await moduleTabLabels(page);
        } catch (e: any) {
          ledger.screens.push({
            id: `${r.id}#(tab strip)`, path: r.path, family: 'moduletab',
            verdict: 'TABS-UNREADABLE', detail: String(e?.message ?? e).slice(0, 200),
            chars: 0, console: [], uncaught: [], uuids: [], nativeDates: [],
            rowToken: null, badRows: [], rowsSeen: 0, hScroll: false,
          });
        }
        for (const label of labels) {
          ledger.intended++;
          try {
            const { id } = await openTabByLabel(page, label);
            await page.waitForTimeout(900);
            await record(`${r.id}#${id.replace(/^mt-panel-/, '')}`, r.path, 'moduletab', r.note, label);
          } catch (e: any) {
            ledger.screens.push({
              id: `${r.id}#${label}`, path: r.path, family: 'moduletab', excluded: r.note,
              verdict: 'TAB-UNREACHABLE', detail: String(e?.message ?? e).slice(0, 200),
              chars: 0, console: [], uncaught: [], uuids: [], nativeDates: [],
              rowToken: null, badRows: [], rowsSeen: 0, hScroll: false,
            });
          }
        }
      }

      if (r.tabs === 'url') {
        for (const t of URL_TABS[r.path] || []) {
          ledger.intended++;
          try {
            await page.goto(`${r.path}?tab=${t}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
            await settle(page);
            await page.waitForTimeout(900);
            await record(`${r.id}#${t}`, r.path, 'urltab', r.note);
          } catch (e: any) {
            ledger.screens.push({
              id: `${r.id}#${t}`, path: r.path, family: 'urltab', excluded: r.note,
              verdict: 'THREW', detail: String(e?.message ?? e).slice(0, 200),
              chars: 0, console: [], uncaught: [], uuids: [], nativeDates: [],
              rowToken: null, badRows: [], rowsSeen: 0, hScroll: false,
            });
          }
        }
      }
    }

    ledger.finishedAt = new Date().toISOString();
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));

    // ── The report is the deliverable, printed whole ──────────────────────
    const broken = ledger.screens.filter((s) => s.verdict !== 'ok');
    console.log('\n══════════════ SUITE 20 · THE SWEEP ══════════════');
    console.log(`  viewport ${vp.width}x${vp.height}   viewport-fit band: ${band}`);
    console.log(`  screens opened : ${ledger.screens.length}  (routes ${ROUTES.length}, ` +
      `module tabs ${ledger.screens.filter((s) => s.family === 'moduletab').length}, ` +
      `url tabs ${ledger.screens.filter((s) => s.family === 'urltab').length})`);
    console.log(`  table rows measured : ${ledger.screens.reduce((n, s) => n + s.rowsSeen, 0)}`);
    for (const s of ledger.screens) {
      const clean = s.verdict === 'ok' && !s.console.length && !s.uncaught.length;
      console.log(`${clean ? '   ' : ' !!'} ${s.id.padEnd(38)} ${s.verdict.padEnd(16)} ` +
        `chars=${String(s.chars).padEnd(6)} rows=${String(s.rowsSeen).padEnd(4)} ` +
        `console=${s.console.length + s.uncaught.length} ${s.detail}`);
    }
    console.log('══════════════════════════════════════════════════\n');

    // ── The only assertion this test makes ────────────────────────────────
    // Deliberately narrow: "did the screen break". Every other dimension is
    // its own test below, reading the file just written, so one finding cannot
    // hide the next.
    expect(
      broken.map((s) => `${s.id} [${s.verdict}] ${s.detail}`),
      'screen(s) did not render. A first-week customer meets these as a blank page, a ' +
      'spinner that never resolves, or a redirect they did not ask for:\n     ' +
      broken.map((s) => `${s.id} [${s.verdict}] ${s.detail}`).join('\n     '),
    ).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════
     20.02 — ZERO UNCAUGHT CONSOLE ERRORS
     ══════════════════════════════════════════════════════════════════════ */
  test('20.02 no screen raises an uncaught exception, and none logs a console error', async () => {
    const L = readLedger();

    const uncaught = L.screens.flatMap((s) => s.uncaught.map((t) => `${s.id}: ${t}`));
    const errors = L.screens.flatMap((s) => s.console.map((t) => `${s.id}: ${t}`));

    console.log(`\n  20.02 — ${L.screens.length} screens · ${uncaught.length} uncaught · ${errors.length} console errors\n`);
    for (const e of [...uncaught, ...errors].slice(0, 60)) console.log('     ' + e);

    // An UNCAUGHT exception is a broken screen and is the harder half of §1's
    // "zero uncaught errors across the whole run".
    //
    // ⚠ React error #31 — "Objects are not valid as a React child" — has
    // shipped here twice, from a 422 `detail` array and from a jsonb, and both
    // times the screen went blank. `lib/apiError.js` is the choke point; a #31
    // in this list names a call site that has not been routed through it.
    expect(
      uncaught,
      `uncaught exception(s) on screen:\n     ${uncaught.join('\n     ')}`,
    ).toEqual([]);

    // A plain console.error is the softer half and is asserted too, because
    // this is a READ-ONLY sweep: there are no form submissions here whose
    // noise could mask a data finding, which is the only reason the module
    // suites report console errors rather than asserting them.
    expect(
      errors,
      `console error(s) on screen — §1: "an exception that does not visibly break ` +
      `anything today is a defect that will":\n     ${errors.join('\n     ')}`,
    ).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════
     20.03 — NO UUID RENDERED ANYWHERE
     ══════════════════════════════════════════════════════════════════════ */
  test('20.03 no screen paints a user, member or org UUID', async () => {
    const L = readLedger();

    // Deduplicated BY VALUE, with every screen it appeared on, because one id
    // rendered by a shared component is one defect and not forty.
    const byId = new Map<string, string[]>();
    for (const s of L.screens) {
      for (const u of s.uuids) {
        const key = u.split('  ←  ')[0];
        byId.set(key, [...(byId.get(key) || []), s.id]);
      }
    }
    const found = [...byId.entries()].map(([id, screens]) => {
      const sample = L.screens.find((s) => s.uuids.some((u) => u.startsWith(id)))!
        .uuids.find((u) => u.startsWith(id))!;
      return `${sample}\n         on ${screens.length} screen(s): ${screens.slice(0, 6).join(', ')}`;
    });

    console.log(`\n  20.03 — ${L.screens.length} screens scanned for a painted UUID · ${found.length} distinct id(s)\n`);

    expect(
      found,
      'a UUID is painted where a NAME belongs. ⚠ `check-rendered-ids.mjs` cannot catch ' +
      'this one: it is static and positional, it reads names and never values, and it ' +
      'cannot see an id the server formatted into a string or one passed as a prop and ' +
      `drawn in a child.\n     ${found.join('\n     ')}`,
    ).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════
     20.04 — EVERY DATE INPUT IS A DateInput
     ══════════════════════════════════════════════════════════════════════ */
  test('20.04 no screen renders a native date control', async () => {
    const L = readLedger();

    const found = L.screens
      .filter((s) => s.nativeDates.length)
      .map((s) => `${s.id}: ${s.nativeDates.join(' | ')}`);

    console.log(`\n  20.04 — ${found.length} screen(s) carry a native date-family control\n`);
    for (const f of found) console.log('     ' + f);

    /**
     * ⚠ THIS FAILS ON PURPOSE WHERE IT FAILS, AND THE REASON MATTERS.
     *
     * CLAUDE.md: "no native `<input type="date">` anywhere — use
     * `frontend/src/components/ui/DateInput.jsx`. Playwright must use
     * `setDate()`." The rule exists because Playwright cannot `fill()` a native
     * date control this product has clipped out of the tab order, and because
     * the native picker is the one control in the product with no design.
     *
     * `DateInput`'s own hidden `.pk__native` is excluded by the scan — form
     * serialisation by `name` depends on it (`DateInput.jsx:166`).
     *
     * ✅ RESOLVED 2026-08-31 — and HOW it resolved is the point of keeping it.
     *
     * This test used to fail here deliberately. `Field.jsx` routed `Input`
     * through `DateInput` for `date | datetime-local | time` and NOT for
     * `month`, so five screens still emitted a native control. That was
     * reported as a FAILURE with the decision named — "closing it means giving
     * `DateInput` a month mode, which is a feature" — rather than excused into
     * a green, because a suite that quietly drops the line it cannot meet is
     * the silent cap §10 warns about.
     *
     * The feature was then built: `MonthGrid.jsx`, `month` added to `DATEY`,
     * and all five screens migrated — three Vetana (where `BonusTab.jsx:56`
     * had already written down what a wrong month costs), `ganit/StatsTab` and
     * `manav/PerformanceTab`. `_helpers.ts::setMonth()` drives it, addressing
     * the control by ACCESSIBLE NAME rather than by `<label>`, because
     * DateInput renders a button and a label cannot label a button.
     *
     * The failing test is what made that happen. It stayed visible, with the
     * decision written down, until somebody took it — which is the argument
     * for reporting a finding as a failure instead of a skip.
     */
    expect(
      found,
      'a NATIVE date-family control is on screen. The product\'s standing rule is that ' +
      'there are none — every date goes through `DateInput`, and `setDate()`/`setMonth()` ' +
      'are the only ways a test can drive one.\n\n' +
      'THE `month` HOLE THIS TEST NAMED IS CLOSED (2026-08-31). The decision it asked for ' +
      'was taken: `DateInput` gained a month mode (`MonthGrid.jsx`), `Field.jsx` forwards ' +
      '`month` with the other three, and all five screens that carried the native widget ' +
      'were migrated — three Vetana, plus ganit/StatsTab and manav/PerformanceTab. So a ' +
      'failure here is a NEW native control, not the known remainder.\n     '
      + found.join('\n     '),
    ).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════
     20.05 — EVERY TABLE ON --row-h
     ══════════════════════════════════════════════════════════════════════ */
  test('20.05 every table row sits on the --row-h token for the measured band', async () => {
    const L = readLedger();

    const rows = L.screens.reduce((n, s) => n + s.rowsSeen, 0);
    const bad = L.screens.filter((s) => s.badRows.length)
      .map((s) => `${s.id}: ${s.badRows.join(' | ')}`);

    // A loop that iterates nothing passes for ever — the 02.3 failure, where a
    // loop over `input[type=checkbox]` found none because the product renders
    // `<button role="switch">`, and the test was green about nothing. So the
    // COUNT is asserted before the heights are.
    expect(
      rows,
      'not one table row was measured across the whole sweep. Either the selectors in ' +
      '`scan()` no longer match the DataTable barrel (`.tbl__wrap table.tbl tbody tr`, ' +
      '`table.omt`, `table.gn-coll`), or every list screen rendered empty. Both are ' +
      'findings; neither is a pass.',
    ).toBeGreaterThan(50);

    console.log(`\n  20.05 — ${rows} rows measured across ${L.screens.length} screens · ` +
      `band ${L.band} · :root --row-h ${L.screens.find((s) => s.rowToken)?.rowToken ?? '?'}px · ` +
      `${bad.length} screen(s) off the token\n`);
    for (const b of bad) console.log('     ' + b);

    /**
     * ⚠ THE EXPECTED HEIGHT IS READ OFF EACH ROW, NEVER NAMED.
     *
     * 66px is the `cozy` default, but `viewport-fit.css` band V2 (≥1024 wide,
     * ≤780 tall — a 1366x768 or 1280x720 panel) makes it **50px** and that is
     * CORRECT; an agent nearly filed it as a defect on 2026-08-29. Density
     * moves it to 48/66/76, and `.vgw` and `.sk-fx__wrap` set a deliberate
     * local 48. Reading `--row-h` off the row satisfies all of that with no
     * table of exceptions to go stale.
     *
     * `check-table-rows.mjs` cannot make this check: it reads `height:`
     * DECLARATIONS out of CSS text and never a computed box, so padding, a
     * taller child, `box-sizing` or a wrapping cell all pass it. `ganit.css:508`
     * records exactly that miss — `--row-h` 50px, rendered `<tr>` 60px.
     */
    expect(
      bad,
      'table row(s) are off the --row-h token. Every table in this product sits on one ' +
      'row contract, and a row taller than the token is what a wrapping cell looks like ' +
      `— the shape \`ganit.css:508\` records the static check could not see.\n     ${bad.join('\n     ')}`,
    ).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════
     20.06 — LOADING STATES
     ══════════════════════════════════════════════════════════════════════ */
  test('20.06 a screen waiting for data SAYS it is waiting, to a screen reader as well as an eye', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const L = readLedger();
    await signIn(page);

    /**
     * The screens driven, and why these.
     *
     * Three are the tabs already filed as rendering a bare `<SkeletonList/>`
     * (93 §F item 12 — `RateCardsTab`, `SLACreditsTab`, `AgeingTab`); the rest
     * are chosen one per skeleton PRIMITIVE and one per module family, so the
     * result says whether the fault is three components or the shared
     * contract. `Skeleton.jsx` has exactly one accessible wrapper —
     * `SkeletonRegion` at :208, `role="status" aria-busy="true"` with a
     * `.k-sr-only` label — and every other export is `aria-hidden="true"`,
     * which does not weaken the announcement: it removes the element from the
     * accessibility tree entirely. A screen reader gets silence.
     */
    const CASES: Array<[string, string, RegExp]> = [
      ['/ganit', 'rate-cards', /\/api\/v1\/(ganit|client_billing|billing)\//],
      ['/ganit', 'sla-credits', /\/api\/v1\/(ganit|client_billing|billing)\//],
      ['/ganit', 'ageing', /\/api\/v1\/ganit\//],
      ['/ganit', 'invoices', /\/api\/v1\/ganit\//],
      ['/graha', 'contacts', /\/api\/v1\/graha\//],
      ['/manav', 'employees', /\/api\/v1\/manav\//],
      ['/vetana', 'payslips', /\/api\/v1\/vetana\//],
      ['/kray', 'vendors', /\/api\/v1\/(kray|procurement|ganit)\//],
      ['/dristi', 'overview', /\/api\/v1\/(dristi|analytics|reports)\//],
      ['/prachar', 'campaigns', /\/api\/v1\/prachar\//],
    ];

    const silent: string[] = [];
    const announced: string[] = [];

    for (const [route, tab, pattern] of CASES) {
      await shape(page, pattern, 'slow', 7_000);
      try {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await openTabById(page, L, route, tab);

        // While the request is still in flight — the whole point.
        await page.waitForTimeout(1500);
        const busy = await page.evaluate(() => {
          const main = document.querySelector('#main') || document.body;
          const status = main.querySelectorAll('[role="status"]').length;
          const aria = main.querySelectorAll('[aria-busy="true"]').length;
          const skeleton = main.querySelectorAll(
            '.k-skeleton-table, .k-skeleton, .k-shimmer, .k-skeleton-card',
          ).length;
          return { status, aria, skeleton };
        });

        const line = `${route}#${tab}: role=status ${busy.status}, aria-busy ${busy.aria}, ` +
          `visible skeleton ${busy.skeleton}`;
        if (busy.status + busy.aria > 0) announced.push(line);
        else silent.push(line + (busy.skeleton ? '  ← a skeleton IS drawn; nothing announces it' : '  ← nothing at all'));
      } finally {
        await unshape(page, pattern);
      }
    }

    console.log(`\n  20.06 — ${announced.length} of ${CASES.length} screens announce that they are loading\n`);
    for (const a of announced) console.log('   ok ' + a);
    for (const s of silent) console.log('   !! ' + s);

    /**
     * ⚠ WHY THIS IS ASSERTED AND NOT MERELY REPORTED.
     *
     * "To a screen reader, and to anything automated, LOADING and EMPTY are
     * the same screen." That is not a theoretical harm: 20.09 below has to
     * distinguish them to test empty states at all, and a first-week customer
     * using a screen reader is told nothing at all while the page fetches.
     *
     * Keyboard and screen-reader behaviour here was fixed BY HAND and React
     * Aria was deliberately REJECTED, so nothing keeps it correct and it
     * regresses silently. This check is the thing that keeps it.
     */
    expect(
      silent,
      'screen(s) fetch data with no accessible busy state. `Skeleton.jsx` has exactly one ' +
      'accessible wrapper — `SkeletonRegion` (role="status", aria-busy) — and every other ' +
      'export is `aria-hidden="true"`, so an unwrapped skeleton is not a weak announcement ' +
      'but NO announcement: the element is removed from the accessibility tree. ' +
      `${silent.length} of ${CASES.length} screens driven here are silent while they ` +
      `load:\n     ${silent.join('\n     ')}`,
    ).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════
     20.07 — ERROR STATES UNDER A CUT NETWORK
     ══════════════════════════════════════════════════════════════════════ */
  test('20.07 a failed fetch says WHAT failed, and never renders as "no data"', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const L = readLedger();
    await signIn(page);

    /**
     * §1: "a failure states WHAT failed rather than rendering an empty table
     * that reads as 'no data'." That distinction is the entire test. An empty
     * table after a 503 is the worst outcome in the product: the customer
     * concludes their records are gone.
     *
     * Two failure modes, because they are different code paths: `cut` aborts
     * the request the way a dropped connection does, `error` answers 503 the
     * way a backend under load does. `ActivityFeedPage`'s own comment argues
     * the same case — "null until a load succeeds, never []" — because a
     * rejected request used to land on "No activity recorded yet", a claim
     * about the team's week that was not true.
     */
    const CASES: Array<[string, string | null, RegExp, Shaper]> = [
      ['/ganit', 'invoices', /\/api\/v1\/ganit\//, 'error'],
      ['/ganit', 'invoices', /\/api\/v1\/ganit\//, 'cut'],
      ['/graha', 'clients', /\/api\/v1\/graha\//, 'error'],
      ['/manav', 'employees', /\/api\/v1\/manav\//, 'cut'],
      ['/vikray', 'orders', /\/api\/v1\/vikray\//, 'error'],
      ['/activity', null, /\/api\/activity\//, 'cut'],
      ['/tasks', null, /\/api\/tasks/, 'error'],
    ];

    const mute: string[] = [];
    const spoke: string[] = [];

    /**
     * ⚠ THE PHRASE LIST IS THE PRODUCT'S OWN COPY, READ OUT OF `ErrorState`.
     *
     * Run 1 flagged `/activity` under a CUT network as saying nothing. It was
     * a test bug: `errorKind()` maps a response-less error to `offline`, whose
     * headline is *"You're offline"* — a perfectly good statement of what
     * failed that matched none of the words the first version looked for.
     * Guessing at error copy is how a suite manufactures a finding, so the
     * five `COPY` headlines from `ui/ErrorState.jsx` are used verbatim, and
     * the STRUCTURAL marker (`ErrorState` renders `role="alert"`) is what the
     * verdict actually rests on.
     */
    const SAYS_FAILURE = new RegExp([
      "you.{0,3}re offline",                        // COPY.offline
      'something broke on our side',                // COPY.server
      "you don.{0,3}t have access",                 // COPY.denied
      "this doesn.{0,3}t exist",                    // COPY.missing
      "that request wasn.{0,3}t accepted",          // COPY.request
      'could not', "couldn.t", 'failed to', 'unavailable', 'went wrong', 'try again',
    ].join('|'), 'i');

    for (const [route, tab, pattern, kind] of CASES) {
      await shape(page, pattern, kind);
      try {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        if (tab) await openTabById(page, L, route, tab);
        await settle(page, 8_000);

        /**
         * Poll for a SETTLED screen rather than sampling after a fixed wait.
         * Run 1 sampled `/tasks` while its own text still read "Loading", and
         * a screen judged mid-flight is a finding manufactured by the clock.
         * Gives up after 15s and judges whatever is there, because a screen
         * that never leaves "Loading" after a 503 is itself the defect §1
         * describes.
         */
        const read = async () => await page.evaluate((rx: string) => {
          const main = (document.querySelector('#main') || document.body) as HTMLElement;
          const text = (main.innerText || '').replace(/\s+/g, ' ').trim();
          return {
            errNotes: main.querySelectorAll('.hb-err, .k-err, [role="alert"]').length,
            saysFailure: new RegExp(rx, 'i').test(text),
            // The words that would be a LIE after a failed fetch.
            saysEmpty: /no [a-z-]+ (yet|found|recorded)|nothing (yet|here|to show)|0 results/i.test(text),
            /**
             * ⚠ A SKELETON COUNTS AS "STILL LOADING", AND IT HAS TO.
             *
             * Runs 3 and 4 both read `/manav#employees` under a cut network as
             * saying nothing — and its panel renders `<Shim count={6}/>`,
             * which is `Shimmer`: divs with NO TEXT AT ALL. So the word
             * "Loading" never appears, the poll stopped immediately, and a
             * screen that may simply not have finished was judged silent.
             *
             * That the wait cannot be detected from the text is itself finding
             * 20.06 — but a suite must not convert one finding into a second,
             * different one. The skeleton is counted structurally so the poll
             * waits for a real end state, and `skeletons` is printed so a
             * screen still shimmering at the end says so out loud.
             */
            skeletons: main.querySelectorAll(
              '.k-skeleton-table, .k-skeleton, .k-shimmer, .k-skeleton-card, [aria-busy="true"]',
            ).length,
            stillLoading: /\bloading\b/i.test(text),
            sample: text.slice(0, 220),
          };
        }, SAYS_FAILURE.source);

        let seen = await read();
        for (let i = 0; i < 20; i++) {
          if (seen.errNotes || seen.saysFailure) break;
          if (!seen.stillLoading && !seen.skeletons) break;
          await page.waitForTimeout(1000);
          seen = await read();
        }

        const line = `${route}${tab ? '#' + tab : ''} [${kind}]: notes=${seen.errNotes} ` +
          `saysFailure=${seen.saysFailure} saysEmpty=${seen.saysEmpty} ` +
          `stillLoading=${seen.stillLoading} skeletons=${seen.skeletons} — "${seen.sample.slice(0, 130)}"`;
        if (seen.errNotes > 0 || seen.saysFailure) spoke.push(line);
        else mute.push(line);
      } finally {
        await unshape(page, pattern);
      }
    }

    console.log(`\n  20.07 — ${spoke.length} of ${CASES.length} screens name the failure\n`);
    for (const s of spoke) console.log('   ok ' + s);
    for (const m of mute) console.log('   !! ' + m);

    expect(
      mute,
      'screen(s) survive a cut or failed fetch WITHOUT saying anything failed. A person ' +
      'reads that as "I have no records", which is the one wrong conclusion available. ' +
      `\n     ${mute.join('\n     ')}`,
    ).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════
     20.08 — KEYBOARD TRAVERSAL
     ══════════════════════════════════════════════════════════════════════ */
  test('20.08 every screen is reachable by keyboard, and Escape closes what opens', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const con = watchConsole(page);
    await signIn(page);

    /**
     * ⚠ THIS IS THE ONLY THING STANDING BETWEEN THIS PRODUCT AND A SILENT
     * KEYBOARD REGRESSION.
     *
     * Keyboard and screen-reader behaviour here was fixed BY HAND and React
     * Aria was deliberately REJECTED (`ui_keyboard_a11y`), so no library keeps
     * it correct: it regresses without anything going red. §1 names the
     * contract — "focus order is sane, activation works without a mouse,
     * Escape closes every modal and drawer."
     */
    const ROUTES_K = ['/dashboard', '/tasks', '/projects', '/graha', '/ganit', '/manav',
      '/vetana', '/vikray', '/dristi', '/settings/organisation'];

    const findings: string[] = [];

    for (const route of ROUTES_K) {
      con.at(`keyboard ${route}`);
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await settle(page);
      await page.waitForTimeout(1200);

      // ── Tab moves focus, and the focus is VISIBLE ──────────────────────
      // A focus ring can be an outline OR a box-shadow; treating only outline
      // as valid reports a false defect against this design system.
      await page.locator('body').click({ position: { x: 3, y: 3 } }).catch(() => {});
      const seen: string[] = [];
      let stuck = 0;
      let ringless = '';
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press('Tab');
        const f = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          /**
           * ⚠ THE KEY MUST IDENTIFY THE CONTROL, NOT ITS CLASS LIST.
           *
           * Run 1 reported "25 Tab presses reached only 4 distinct controls"
           * on ALL TEN routes with ZERO landing on `<body>` — a focus trap
           * that would be an enormous finding, and it was a defect in this
           * test. The key was tag + first 30 characters of className + id, and
           * every sidebar link is `<a class="…">` with the same class and no
           * id, so eight different destinations collapsed into ONE key.
           *
           * A test that fails on a correct product is a defect in the test.
           * The key now carries what a person uses to tell two controls apart:
           * the accessible name, and failing that the visible text.
           */
          const name = (el.getAttribute('aria-label') || el.getAttribute('title')
            || (el as HTMLInputElement).name || (el.innerText || '').trim().slice(0, 40)
            || el.getAttribute('href') || '').replace(/\s+/g, ' ');
          return {
            key: `${el.tagName}[${name}]#${el.id || ''}`,
            ring: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none',
            hidden: cs.visibility === 'hidden' || cs.display === 'none',
          };
        });
        if (!f) { stuck++; continue; }
        if (!f.ring && !ringless) ringless = f.key;
        if (f.hidden) findings.push(`${route}: Tab focused a HIDDEN element — ${f.key}`);
        seen.push(f.key);
      }
      const distinct = new Set(seen).size;
      if (distinct < 5) {
        findings.push(`${route}: 25 Tab presses reached only ${distinct} distinct control(s) ` +
          `(${stuck} landed on <body>) — keyboard traversal does not cross this screen`);
      }
      if (ringless) findings.push(`${route}: focused ${ringless} shows NO visible focus ring`);

      // ── Escape closes what opens ───────────────────────────────────────
      // The opener is found by its ACCESSIBLE NAME, which is the mistake that
      // produced three false "missing control" findings in one day: a control
      // whose visible text is "New" may be named something else entirely.
      // Both are tried, and a route with neither is simply not tested here
      // rather than reported as a defect.
      const opener = page
        .locator('#main button')
        .filter({ hasText: /^(New|Add|Create|Raise)\b/i })
        .first();
      if (await opener.count() && await opener.isVisible().catch(() => false)) {
        await opener.click({ timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const dialog = page.locator('[role="dialog"], .k-drawer, .modal__panel, [aria-modal="true"]');
        if (await dialog.count() && await dialog.first().isVisible().catch(() => false)) {
          // Focus must be INSIDE what opened — a dialog that opens behind the
          // keyboard leaves the user tabbing the page underneath it.
          const inside = await page.evaluate(() => {
            const d = document.querySelector('[role="dialog"], .k-drawer, .modal__panel, [aria-modal="true"]');
            return !!(d && document.activeElement && d.contains(document.activeElement));
          });
          if (!inside) findings.push(`${route}: a dialog opened and focus stayed OUTSIDE it`);

          await page.keyboard.press('Escape');
          await page.waitForTimeout(1000);
          if (await dialog.first().isVisible().catch(() => false)) {
            findings.push(`${route}: a dialog/drawer opened and ESCAPE DID NOT CLOSE IT`);
          }
        }
      }
      await page.keyboard.press('Escape').catch(() => {});

      // ── The tablist keyboard contract ──────────────────────────────────
      // `ModuleTabs.onKeyDown` binds Arrow/Home/End on the tablist, and its
      // More menu binds Escape to close AND to hand focus back to the trigger
      // — "the trigger sits inside a tablist, so a keyboard user who opens the
      // menu has no other way back to the strip".
      const tablist = page.locator('.mt[role="tablist"]');
      if (await tablist.count()) {
        const before = await page.locator('[role="tabpanel"]').first().getAttribute('id');
        await page.locator('.mt [role="tab"][aria-selected="true"]').first().focus().catch(() => {});
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(900);
        const after = await page.locator('[role="tabpanel"]').first().getAttribute('id');
        if (before && after && before === after) {
          findings.push(`${route}: ArrowRight on the module tablist changed nothing — ` +
            `the panel stayed ${after}. ModuleTabs.onKeyDown binds Arrow keys and it is ` +
            `the only way a keyboard user moves along the strip`);
        }

        const more = page.locator('.mt__wrap button.mt__more');
        if (await more.count()) {
          await more.click();
          const pop = page.locator('.mt__pop');
          if (await pop.isVisible().catch(() => false)) {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(600);
            if (await pop.isVisible().catch(() => false)) {
              findings.push(`${route}: Escape did not close the More menu`);
            } else {
              const back = await page.evaluate(() =>
                (document.activeElement as HTMLElement | null)?.className || '');
              if (!/mt__more/.test(back)) {
                findings.push(`${route}: Escape closed the More menu but focus went to ` +
                  `"${back || '<body>'}" instead of back to the trigger — the file's own ` +
                  `contract, because the menuitem that held focus has just unmounted`);
              }
            }
          }
        }
      }
    }

    console.log(`\n  20.08 — ${ROUTES_K.length} screens traversed by keyboard · ${findings.length} finding(s)\n`);
    for (const f of findings) console.log('     ' + f);

    expect(
      findings,
      'keyboard finding(s). Nothing in this repo keeps keyboard behaviour correct — it was ' +
      'fixed by hand and React Aria was deliberately rejected — so this traversal is the ' +
      `whole of the guard:\n     ${findings.join('\n     ')}`,
    ).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════
     20.09 — EMPTY STATES, IN WORDS
     ══════════════════════════════════════════════════════════════════════ */
  test('20.09 a list with nothing in it says so in words, and is not a blank rectangle', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const L = readLedger();
    await signIn(page);

    /**
     * ⚠ WHAT THIS IS, STATED PRECISELY — because the loose version is not
     * deliverable.
     *
     * §10 asks for "empty states seen BEFORE data exists". Unicode is a WAVE 7
     * org: every module behind it is full, and the day-one screen is not
     * reachable by navigating to it. Wiping it to see one would destroy the
     * evidence five other suites just produced.
     *
     * So this drives the component's EMPTY BRANCH by emptying the response —
     * which is the same render a new customer gets on their first morning, and
     * is NOT the same thing as a new organisation. Suite 00 on UK AekamINC is
     * what covers a genuinely new org, and this suite does not claim it.
     *
     * The assertion is the one §1 makes: "it says there is nothing yet, IN
     * WORDS." A blank rectangle is indistinguishable from a broken screen, and
     * that is exactly the sentence a first-week customer cannot tell apart.
     */
    const CASES: Array<[string, string | null, RegExp]> = [
      ['/ganit', 'invoices', /\/api\/v1\/ganit\//],
      ['/ganit', 'expenses', /\/api\/v1\/ganit\//],
      ['/graha', 'clients', /\/api\/v1\/graha\//],
      ['/graha', 'deals', /\/api\/v1\/graha\//],
      ['/manav', 'employees', /\/api\/v1\/manav\//],
      ['/vetana', 'payslips', /\/api\/v1\/vetana\//],
      ['/vikray', 'orders', /\/api\/v1\/vikray\//],
      ['/kray', 'vendors', /\/api\/v1\/(kray|procurement|ganit)\//],
      ['/prachar', 'campaigns', /\/api\/v1\/prachar\//],
      ['/tasks', null, /\/api\/tasks/],
    ];

    const wordless: string[] = [];
    const spoke: string[] = [];
    /**
     * ⚠ A CASE WHERE THE EMPTYING DID NOT TAKE IS INCONCLUSIVE, NOT A FINDING.
     *
     * Run 1 reported `/vetana#payslips` as "renders nothing when its list is
     * empty" while the screen still showed SEVEN rows — so the list had not
     * been emptied at all and the screen was behaving correctly with data. A
     * response shaper whose pattern misses the request under test measures
     * nothing, and reporting that as a product defect is exactly the false
     * finding the stop-and-fix rule exists to prevent.
     *
     * These are counted, named, and kept out of the verdict — and the test
     * then asserts that enough cases WERE conclusive, so a run where every
     * shaper missed cannot pass as a green.
     */
    const inconclusive: string[] = [];

    for (const [route, tab, pattern] of CASES) {
      await shape(page, pattern, 'empty');
      try {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        if (tab) await openTabById(page, L, route, tab);
        await settle(page, 8_000);
        await page.waitForTimeout(2000);

        const seen = await page.evaluate(() => {
          const main = (document.querySelector('#main') || document.body) as HTMLElement;
          const text = (main.innerText || '').replace(/\s+/g, ' ').trim();
          const panel = main.querySelector('[role="tabpanel"]') as HTMLElement | null;
          const panelText = ((panel?.innerText) || text).replace(/\s+/g, ' ').trim();
          return {
            rows: main.querySelectorAll('.tbl__wrap table.tbl tbody tr').length,
            // The product's own empty copy, plus the shared `EmptyState`.
            hasEmptyEl: main.querySelectorAll('.k-empty, .empty, [data-empty]').length,
            saysNothing: /no [a-z-]+ (yet|found|recorded|here)|nothing (yet|here|to show)|none yet|get started|add your first|create your first/i
              .test(panelText),
            panelChars: panelText.length,
            sample: panelText.slice(0, 200),
          };
        });

        const line = `${route}${tab ? '#' + tab : ''}: rows=${seen.rows} emptyEl=${seen.hasEmptyEl} ` +
          `chars=${seen.panelChars} — "${seen.sample.slice(0, 120)}"`;
        if (seen.rows > 0) inconclusive.push(line + '  ← the list still has rows: the shaper missed this request');
        else if (seen.saysNothing || seen.hasEmptyEl > 0) spoke.push(line);
        else wordless.push(line);
      } finally {
        await unshape(page, pattern);
      }
    }

    console.log(`\n  20.09 — ${spoke.length} say so in words · ${wordless.length} silent · ` +
      `${inconclusive.length} inconclusive, of ${CASES.length} cases\n`);
    for (const s of spoke) console.log('   ok ' + s);
    for (const w of wordless) console.log('   !! ' + w);
    for (const i of inconclusive) console.log('   ?? ' + i);

    // Never green by accident: if the shapers missed everything there is no
    // measurement here, and a suite that reports coverage it does not have is
    // the failure §10 singles out for this suite in particular.
    expect(
      spoke.length + wordless.length,
      `only ${spoke.length + wordless.length} of ${CASES.length} cases were actually emptied, ` +
      'so this test measured almost nothing. That is a defect in the response shapers, not in ' +
      `the product:\n     ${inconclusive.join('\n     ')}`,
    ).toBeGreaterThanOrEqual(6);

    expect(
      wordless,
      'screen(s) render nothing at all when their list is empty. This is the state a new ' +
      'customer meets on their first morning, and a blank rectangle is indistinguishable ' +
      `from a broken screen:\n     ${wordless.join('\n     ')}`,
    ).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════
     20.10 — PAGINATION PAST 200
     ══════════════════════════════════════════════════════════════════════ */
  test('20.10 a list holding more than 200 rows can be paged past the 200th', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    await signIn(page);

    /**
     * ⚠ WHICH LIST, AND WHY THIS ONE.
     *
     * §10 says "seed ONE list past 200 and page through it". Nothing had to be
     * seeded: measured live on 2026-08-29, **Unicode's activity feed serves
     * 519 rows** — 200 at offset 0, 200 at offset 200, 119 at offset 400 —
     * because waves 1-6 generated them by working in the product. That makes
     * it a better subject than a seeded one on three counts:
     *
     *   · Nothing is written into a database production shares to run it.
     *   · The rows are the genuine output of a customer using the product, not
     *     200 fixtures shaped to make a pager move.
     *   · `/activity` is the only org-scoped list screen in the product with a
     *     real offset pager on it (`ActivityFeedPage.jsx:193`, LIMIT 50), so it
     *     is the only place the UI half of this can be tested at all.
     *
     * What is therefore NOT proven, said rather than left to read as covered:
     * the six delta lists (`graha/clients`, `graha/contacts`, `ganit/invoices`
     * …) take NO offset or cursor parameter and hard-cap at `LIMIT 200` in
     * their own SQL (`graha.py:389-395`, `:664-670`). Unicode holds 77 contacts
     * and 65 invoices, so the cap is not reachable on them today — but if any
     * of those lists ever passes 200, row 201 is unreachable from the product
     * BY CONSTRUCTION, and no test here would fail. That is a design fact
     * worth writing down now rather than discovering later.
     */

    // ── The wire: the cap is DECLARED, and the offset actually moves ──────
    const over = await apiGet(page, '/api/activity/feed?limit=250');
    expect(
      over.status(),
      `GET /api/activity/feed?limit=250 → ${over.status()}. The cap is declared as ` +
      '`limit: int = Query(50, le=200)`, so asking for more must be REFUSED rather than ' +
      'silently served fewer — a client that is quietly given 200 when it asked for 250 ' +
      'believes it has the whole list.',
    ).toBe(422);

    const p1: any[] = await apiJson(page, '/api/activity/feed?limit=200&offset=0');
    const p2: any[] = await apiJson(page, '/api/activity/feed?limit=200&offset=200');

    expect(
      p1.length,
      'the first page did not fill. This test needs a list holding more than 200 rows to ' +
      `mean anything, and the feed returned ${p1.length}. Not a product finding — the ` +
      'subject has shrunk, and a different one is needed.',
    ).toBe(200);
    expect(
      p2.length,
      'offset=200 returned nothing. Everything past the 200th row is unreachable, which is ' +
      'the whole defect this check exists for.',
    ).toBeGreaterThan(0);

    // Disjoint, not merely non-empty. A server that ignores `offset` answers a
    // full second page of the SAME rows, and a length check calls that a pass.
    const idOf = (r: any) => String(r?.event_id ?? r?.id ?? r?.activity_id ?? JSON.stringify(r).slice(0, 60));
    const set1 = new Set(p1.map(idOf));
    const overlap = p2.map(idOf).filter((i) => set1.has(i));
    expect(
      overlap.length,
      `${overlap.length} of the ${p2.length} rows at offset=200 are the SAME rows as page 1. ` +
      'The offset is being ignored, so paging walks the first 200 rows for ever.',
    ).toBe(0);

    // ── The screen: a person can actually get there ──────────────────────
    await page.goto('/activity', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await settle(page);
    const feed = page.locator('#main');
    await expect(feed, 'the activity screen never rendered').toBeVisible({ timeout: 30_000 });

    const countRows = async () =>
      await page.evaluate(() => {
        const main = (document.querySelector('#main') || document.body) as HTMLElement;
        // `.k-activity__row` — `ActivityFeedPage.jsx:172`, read from the file
        // rather than guessed. ⚠ Run 1 guessed at `li, .af__row, .act__row`,
        // counted ZERO, and reported "Load more grew the feed from 0 to 0
        // rows — a dead control". The control was working; the selector was
        // not. That is the vacuous-assertion failure inverted, and it is the
        // reason the count is asserted non-zero BEFORE the pager is pressed.
        return main.querySelectorAll('.k-activity__row').length;
      });

    const first = await countRows();
    expect(
      first,
      'the activity feed drew no `.k-activity__row` at all, on a feed the wire has just ' +
      'proved holds more than 200 events. Either the row class has moved (a TEST fault — ' +
      '`ActivityFeedPage.jsx:172` is where it is declared) or the screen failed to render ' +
      'its own data. Both must be looked at; neither may be counted as a pass.',
    ).toBeGreaterThan(0);

    let clicks = 0;
    for (let i = 0; i < 6; i++) {
      const more = page.getByRole('button', { name: /load more/i }).first();
      if (!(await more.count()) || !(await more.isVisible().catch(() => false))) break;
      await more.click();
      await page.waitForTimeout(2500);
      clicks++;
      if ((await countRows()) > 210) break;
    }
    const after = await countRows();

    console.log(`\n  20.10 — wire: page1 ${p1.length}, page2 ${p2.length}, overlap ${overlap.length}\n` +
      `          screen: ${first} rows on arrival, ${after} after ${clicks} "Load more" press(es)\n`);

    expect(
      clicks,
      'the activity screen offers no "Load more" control at all, on a feed holding more ' +
      `than 200 rows. \`ActivityFeedPage.jsx:193\` renders one when \`hasMore\` is set, and ` +
      '`hasMore` is a full last page — so either the pager is gone or the first page did ' +
      'not fill.',
    ).toBeGreaterThan(0);
    expect(
      after,
      `pressing "Load more" ${clicks} time(s) grew the feed from ${first} to ${after} rows. ` +
      'A pager that does not add rows is a dead control — the class §1 says a screenshot ' +
      'cannot distinguish from success.',
    ).toBeGreaterThan(first);
    expect(
      after,
      `the feed reached ${after} rows and stopped. §10 asks for pagination PAST 200, and ` +
      'the wire proves 519 rows exist behind this screen.',
    ).toBeGreaterThan(200);
  });

  /* ══════════════════════════════════════════════════════════════════════
     20.11 — THE NINE ?since= DELTA LISTS
     ══════════════════════════════════════════════════════════════════════ */
  test('20.11 all nine delta lists answer the same ?since= contract, boundaries included', async ({ page }) => {
    test.setTimeout(12 * 60_000);
    await signIn(page);

    /**
     * The nine, from `delta_sync_complete`: tasks, teams, deals, invoices,
     * contacts, clients, activities, follow-ups and orders. The contract lives
     * in `backend/services/delta_sync.py` and the whole point of it being one
     * file is that nine endpoints cannot disagree — so this asks all nine the
     * same four questions rather than spot-checking one.
     *
     * ⚠ `MAX_SINCE_DAYS` is 365 and REJECTS OUTRIGHT rather than clamping.
     * A sentinel like `since=2020-01-01` therefore answers 400, which cost
     * another suite eight failures on 2026-08-29. That refusal is CORRECT —
     * the module's own comment says a `since` far in the past "means the client
     * believes it is doing a delta while actually asking for everything, which
     * is the most expensive query in the product dressed as the cheapest" — so
     * it is asserted AS the right answer, not worked around.
     */
    const LISTS: Array<[string, string]> = [
      ['tasks', '/api/tasks'],
      ['teams', '/api/teams'],
      ['clients', '/api/v1/graha/clients'],
      ['contacts', '/api/v1/graha/contacts'],
      ['deals', '/api/v1/graha/deals'],
      ['activities', '/api/v1/graha/activities'],
      ['follow-ups', '/api/v1/graha/follow-ups'],
      ['invoices', '/api/v1/ganit/invoices'],
      ['orders', '/api/v1/vikray/orders'],
    ];

    const iso = (d: Date) => d.toISOString().replace('+00:00', 'Z');
    const now = Date.now();
    const recent = iso(new Date(now - 2 * 24 * 3600 * 1000));
    const future = iso(new Date(now + 2 * 3600 * 1000));
    const ancient = '2020-01-01T00:00:00Z';

    const findings: string[] = [];
    const table: string[] = [];

    for (const [name, p] of LISTS) {
      // 1 — the envelope
      const body = await apiJson(page, `${p}?since=${encodeURIComponent(recent)}`);
      for (const key of ['data', 'synced_at', 'delta', 'tombstone_horizon']) {
        if (!(key in body)) findings.push(`${name}: the delta envelope has no \`${key}\` — ` +
          `\`delta_sync.envelope()\` puts all four on every response, so this endpoint is ` +
          `not going through it`);
      }
      if (body.delta !== true) findings.push(`${name}: \`delta\` is ${JSON.stringify(body.delta)} on a request that sent \`since\``);
      if (!Array.isArray(body.data)) findings.push(`${name}: \`data\` is not an array`);

      // 2 — `synced_at` is the SERVER's clock, and it is what the client sends
      //     back. A device clock is wrong by minutes usually and by hours when
      //     a timezone is mishandled; that is the whole reason the field exists.
      const stamp = Date.parse(body.synced_at);
      if (!Number.isFinite(stamp) || Math.abs(stamp - Date.now()) > 10 * 60_000) {
        findings.push(`${name}: \`synced_at\` is "${body.synced_at}" — not this server's own NOW()`);
      }

      // 3 — the boundary is STRICTLY greater. Sending back the stamp just
      //     issued must not re-deliver the rows that landed in its final
      //     microsecond; with `>=` every sync repeats them for ever.
      const again = await apiJson(page, `${p}?since=${encodeURIComponent(body.synced_at)}`);
      const n1 = (body.data || []).length;
      const n2 = (again.data || []).length;
      if (n2 > n1) {
        findings.push(`${name}: replaying the server's own \`synced_at\` returned MORE rows ` +
          `(${n2}) than the window before it (${n1}) — the boundary is not strictly greater`);
      }

      // 4 — the three refusals
      const fut = await apiGet(page, `${p}?since=${encodeURIComponent(future)}`);
      if (fut.status() !== 400) findings.push(`${name}: a \`since\` two hours in the FUTURE → ${fut.status()}, not 400`);
      const old = await apiGet(page, `${p}?since=${ancient}`);
      if (old.status() !== 400) findings.push(`${name}: a \`since\` older than MAX_SINCE_DAYS (365) → ${old.status()}, not 400`);
      const junk = await apiGet(page, `${p}?since=notatimestamp`);
      if (junk.status() !== 400) findings.push(`${name}: a malformed \`since\` → ${junk.status()}, not 400`);

      table.push(`${name.padEnd(12)} rows=${String(n1).padEnd(4)} replay=${String(n2).padEnd(4)} ` +
        `future=${fut.status()} ancient=${old.status()} junk=${junk.status()} ` +
        `limit=${'limit' in body ? body.limit : '—'} truncated=${'truncated' in body ? body.truncated : '—'}`);
    }

    // The tombstone half of the same contract: a delta that returns only
    // changed rows never tells a device about a row that was REMOVED, so the
    // device keeps it for ever and the user taps a task that does not exist.
    const tomb = await apiJson(page, `/api/v1/sync/tombstones?since=${encodeURIComponent(recent)}`);
    for (const key of ['data', 'synced_at', 'tombstone_horizon', 'resync_required']) {
      if (!(key in tomb)) findings.push(`sync/tombstones: no \`${key}\``);
    }
    const state = await apiJson(page, '/api/v1/sync/state');
    if (state.tombstone_days !== 30) {
      findings.push(`sync/state: tombstone_days is ${state.tombstone_days}, not the 30 ` +
        `\`delta_sync.TOMBSTONE_DAYS\` declares — a device offline longer cannot be brought ` +
        `up to date by a delta and must resync in full, and this is how it is told`);
    }

    console.log(`\n  20.11 — the nine ?since= lists\n`);
    for (const t of table) console.log('     ' + t);
    console.log(`     tombstones: ${(tomb.data || []).length} row(s), horizon ${tomb.tombstone_horizon}`);

    expect(
      findings,
      `delta-sync finding(s). One contract in \`services/delta_sync.py\` exists precisely so ` +
      `these nine cannot disagree:\n     ${findings.join('\n     ')}`,
    ).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════
     20.12 — MOTION: THE DRAG THAT COULD NOT BEGIN, AND ITS SIBLINGS
     ══════════════════════════════════════════════════════════════════════ */
  test('20.12 a kanban card can be dragged with a mouse and the move persists', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    await signIn(page);

    /**
     * ⚠ REGRESSION GUARD FOR A DEFECT FIXED THE SAME DAY THIS WAS WRITTEN.
     *
     * `TaskCard`'s root is a `<button>`, and `@hello-pangea/dnd` reads its own
     * `interactiveTagNames` — `['input','button','textarea','select','option',
     * 'optgroup','video','audio']` — walking from the pointer event's target UP
     * to the draggable. Every pointerdown on a card found that `<button>`
     * first, `tryStart` returned null, the lock was never claimed, and the
     * press fell through to the browser as a text selection. MEASURED by Suite
     * 03: 24 mouse drags across two runs, ZERO `PATCH /tasks/{id}/move`.
     * `disableInteractiveElementBlocking` on the `<Draggable>` is the fix, and
     * nothing but a real mouse drag proves it is still there.
     *
     * ── WITHIN THE COLUMN, AND THAT IS A SAFETY DECISION ──────────────────
     * `server.move_task` calls `_notify_status_changed` — which emails every
     * assignee and the creator — only `if doc["status"] != new_status`. A move
     * between columns changes the status; a reorder inside one does not, and
     * `handleDragEnd` still sends the same `PATCH` with a new `order`
     * (`KanbanView.jsx:407` returns early ONLY when the index is unchanged
     * too). `GET /api/health` reports `outbound_mode=live` with
     * `suppressed_orgs_digest="0"` — nothing is shielded — and every Unicode
     * member address is a real deliverable inbox. This suite mails nothing.
     *
     * The card is put back where it came from before the test ends, so the
     * board is byte-identical afterwards and a second run has nothing to undo.
     */

    // ── The fence, restated as an assertion rather than as a comment ──────
    const health = await (await page.request.get(`${API}/api/health`)).json();
    console.log(`\n  20.12 — outbound_mode=${health.outbound_mode} ` +
      `suppressed_orgs_digest=${health.suppressed_orgs_digest}\n`);

    // ── Find a board with a column holding three or more cards ────────────
    // Read from the DOM, not from a hardcoded id: the boards are Suite 03's
    // and their ids are not this suite's to know.
    const teams: any[] = await apiJson(page, '/api/teams');
    expect(teams.length, 'this org has no projects, so there is no board to drag on').toBeGreaterThan(0);

    let chosen: { team: string; teamName: string; column: string; titles: string[] } | null = null;
    for (const t of teams) {
      const teamId = String(t.team_id ?? t.id ?? '');
      if (!teamId) continue;
      // ⚠ NEVER the protected team. §12: `team_ae1d58543b21` holds the 20 tasks
      // proposal 93 guarantees are untouched, and it lives inside Unicode.
      if (teamId === 'team_ae1d58543b21') continue;
      await page.goto(`/projects/${teamId}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      /**
       * ⚠ WAIT FOR THE BOARD. Run 1 asked `.bd` for its visibility on the line
       * after `goto` and got `false` for every one of the eight projects, then
       * reported "no board in this organisation has a column holding three or
       * more cards" — against an org where a live query showed four columns of
       * five cards. `ProjectBoardPage` is a lazy chunk that then fetches its
       * columns and tasks; nothing is on screen yet at that moment.
       *
       * `.catch` keeps a project that genuinely has no board from ending the
       * hunt, which is the reason this is a loop.
       */
      await page.locator('.bd').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
      if (!(await page.locator('.bd').isVisible().catch(() => false))) continue;
      await settle(page);
      await page.waitForTimeout(1200);
      const found = await page.evaluate(() => {
        for (const col of [...document.querySelectorAll('.bd__col')]) {
          const cards = [...col.querySelectorAll('button.bc .bc__t')].map((e) => (e as HTMLElement).innerText.trim());
          if (cards.length >= 3) {
            return { column: (col.querySelector('.bd__cn') as HTMLElement)?.innerText.trim() || '', titles: cards };
          }
        }
        return null;
      });
      if (found && found.column) {
        chosen = { team: teamId, teamName: String(t.name ?? ''), ...found };
        break;
      }
    }

    expect(
      chosen,
      'no board in this organisation has a column holding three or more cards, so a ' +
      'WITHIN-COLUMN reorder cannot be driven. A cross-column drag is deliberately not ' +
      'substituted: it changes the task status, and `_notify_status_changed` would mail ' +
      'every assignee from a service whose outbound suppression list is empty. This is a ' +
      'TEST precondition, not a product finding.',
    ).toBeTruthy();

    const { team, column, titles } = chosen!;
    console.log(`     board ${chosen!.teamName} · column "${column}" · ${titles.length} cards`);

    // ── The card must have no audience, so the reasoning above is CHECKED ──
    // `_notify_status_changed` excludes the actor, so a card whose only
    // stakeholder is this account cannot mail anybody even if the status did
    // move. Belt and braces on top of the same-column rule.
    const tasks: any[] = await apiJson(page, `/api/tasks?team_id=${team}&limit=500`);
    const subject = tasks.find((t) => String(t.title || '').trim() === titles[0]);
    expect(subject, `could not read back the card "${titles[0]}" from the task list`).toBeTruthy();
    const before = Number(subject.sort_order ?? subject.order ?? 0);
    const beforeCol = String(subject.column_id ?? '');

    // ── THE DRAG ──────────────────────────────────────────────────────────
    // `@hello-pangea/dnd` listens on POINTER events and will not lift until the
    // pointer has passed its ~5px sloppy-click threshold. `dragTo()` moves in
    // one jump, which the library reads as a click and discards — a drag that
    // animates nothing and saves nothing, the exact defect §1 says a
    // screenshot cannot distinguish from success. So: press, exceed the
    // threshold, travel in steps, settle, release.
    const drag = async (fromTitle: string, pastTitle: string) => {
      const src = page.locator('button.bc').filter({ has: page.locator('.bc__t', { hasText: fromTitle }) }).first();
      const dst = page.locator('button.bc').filter({ has: page.locator('.bc__t', { hasText: pastTitle }) }).first();
      await expect(src, `no card "${fromTitle}" to drag`).toBeVisible({ timeout: 20_000 });
      await expect(dst, `no card "${pastTitle}" to drag past`).toBeVisible({ timeout: 20_000 });
      await src.scrollIntoViewIfNeeded();
      const a = await src.boundingBox();
      const b = await dst.boundingBox();
      expect(a && b, 'one of the two cards has no box to drag between').toBeTruthy();

      const [res] = await Promise.all([
        page.waitForResponse(
          (r) => /\/api\/tasks\/[^/]+\/move/.test(r.url()) && r.request().method() === 'PATCH',
          { timeout: 30_000 },
        ),
        (async () => {
          await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
          await page.mouse.down();
          await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2 + 10, { steps: 4 });
          await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2 + 6, { steps: 24 });
          await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2 + 10, { steps: 6 });
          await page.mouse.up();
        })(),
      ]);
      const body = await res.text();
      expect(
        res.status(),
        `PATCH ${res.url()} → ${res.status()}: ${body.slice(0, 300)}`,
      ).toBeLessThan(300);
      await page.waitForTimeout(1500);
      return body;
    };

    await page.goto(`/projects/${team}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.locator('.bd'), 'the kanban never rendered').toBeVisible({ timeout: 60_000 });
    await settle(page);

    // Down past the third card, then back to the top. Two presses, net zero.
    await drag(titles[0], titles[2]);

    // ── THE ROW IS THE EVIDENCE, not the animation and not the toast ──────
    const moved: any[] = await apiJson(page, `/api/tasks?team_id=${team}&limit=500`);
    const after = moved.find((t) => String(t.title || '').trim() === titles[0]);
    expect(after, 'the dragged card vanished from the task list').toBeTruthy();
    const afterOrder = Number(after.sort_order ?? after.order ?? 0);

    console.log(`     "${titles[0]}"  sort_order ${before} → ${afterOrder}  (column unchanged: ` +
      `${String(after.column_id) === beforeCol})`);

    expect(
      afterOrder,
      `the drag fired a PATCH and the card's \`sort_order\` did not move (${before} → ` +
      `${afterOrder}). §1: "a drag that animates and does not save is the exact defect a ` +
      'screenshot cannot distinguish from success."',
    ).not.toBe(before);
    expect(
      String(after.column_id),
      'the reorder changed the COLUMN, which changes the status, which mails every ' +
      'assignee from a service with an empty suppression list. The drop landed in the ' +
      'wrong place — stop and check before re-running.',
    ).toBe(beforeCol);

    // ── PUT IT BACK ───────────────────────────────────────────────────────
    // The card now sits below its old neighbours, so the reverse gesture is an
    // UPWARD drag onto the card that was second — which puts it back at the
    // head of the column it started at the head of.
    const restored = await (async () => {
      await page.goto(`/projects/${team}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(page.locator('.bd')).toBeVisible({ timeout: 60_000 });
      await settle(page);
      const src = page.locator('button.bc').filter({ has: page.locator('.bc__t', { hasText: titles[0] }) }).first();
      const dst = page.locator('button.bc').filter({ has: page.locator('.bc__t', { hasText: titles[1] }) }).first();
      if (!(await src.count()) || !(await dst.count())) return null;
      await src.scrollIntoViewIfNeeded();
      const a = await src.boundingBox();
      const b = await dst.boundingBox();
      if (!a || !b) return null;
      const [res] = await Promise.all([
        page.waitForResponse(
          (r) => /\/api\/tasks\/[^/]+\/move/.test(r.url()) && r.request().method() === 'PATCH',
          { timeout: 30_000 },
        ).catch(() => null),
        (async () => {
          await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
          await page.mouse.down();
          await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 - 10, { steps: 4 });
          await page.mouse.move(b.x + b.width / 2, b.y + 4, { steps: 24 });
          await page.mouse.move(b.x + b.width / 2, b.y + 2, { steps: 6 });
          await page.mouse.up();
        })(),
      ]);
      await page.waitForTimeout(1500);
      return res;
    })();

    const final: any[] = await apiJson(page, `/api/tasks?team_id=${team}&limit=500`);
    const back = final.find((t) => String(t.title || '').trim() === titles[0]);
    console.log(`     restore: PATCH ${restored ? restored.status() : 'not observed'} · ` +
      `sort_order now ${back ? (back.sort_order ?? back.order) : '?'} (started at ${before})`);

    // The restore is REPORTED rather than asserted equal. `handleDragEnd`
    // resolves the index through the card it lands above, so a board whose
    // orders were not contiguous to begin with can settle on a different
    // integer for the same visible position. What must hold is the column, and
    // that the card is back at the top of it — which is what 20.15 re-reads.
    expect(
      String(back?.column_id ?? ''),
      'the restore drag moved the card out of its column',
    ).toBe(beforeCol);
  });

  /* ══════════════════════════════════════════════════════════════════════
     20.12b — THE DRAG SIBLINGS
     ══════════════════════════════════════════════════════════════════════ */
  test('20.12b every other drag handle in the product can also start a drag', async ({ page }) => {
    test.setTimeout(12 * 60_000);
    const L = readLedger();
    await signIn(page);

    /**
     * ⚠ LOOK FOR SIBLINGS — the brief's instruction, and the shape is exact.
     *
     * The kanban bug was not "TaskCard is a button". It was that
     * `@hello-pangea/dnd` refuses to start a drag when the pointer event's
     * target, or ANY element between it and the draggable, is one of
     * `input · button · textarea · select · option · optgroup · video · audio`
     * — and `disableInteractiveElementBlocking` is the only escape hatch.
     * Read from the shipped library, `@hello-pangea/dnd/dist/dnd.cjs.js`:
     *
     *     if (sourceEvent && !entry.options.canDragInteractiveElements
     *         && isEventInInteractiveElement(el, sourceEvent)) return null;
     *
     * `isAnInteractiveElement` checks the tag BEFORE it checks whether it has
     * reached the draggable root, so a drag HANDLE that is itself a `<button>`
     * trips the same guard as a card that is one. `useKeyboardSensor` passes
     * its keydown as `sourceEvent` too, so a `<button>` handle blocks the
     * SPACE-to-lift path as well.
     *
     * Four other `<Draggable>` sites exist in `frontend/src`:
     *
     *   `pages/graha/KanbanTab.jsx:193`      root is a <div>            — not the shape
     *   `components/module/CustomizeTabs.jsx:176`   handle is a <button> — the shape
     *   `components/ui/CustomizeColumns.jsx:212`    handle is a <button> — the shape
     *   `components/ui/BottomSheet.jsx`             mobile sheet, not a Draggable list
     *
     * The two `⠿` grips advertise "Space picks it up, arrows move it, Space
     * drops it" in their own `aria-label`. This test presses that key and
     * looks for the library's live-region announcement, because a control that
     * promises a keyboard gesture and does not perform one is worse than a
     * control that promises nothing.
     *
     * ⚠ SOURCE READING IS NOT EVIDENCE. Everything above is the theory; this
     * test is the measurement, and the two are reported separately below.
     */
    const findings: string[] = [];
    const notes: string[] = [];

    // ── Graha's deal kanban — a <div> root, so it should just work ────────
    await page.goto('/graha', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await openTabById(page, L, '/graha', 'kanban');
    await page.keyboard.press('Escape').catch(() => {});
    await settle(page);
    await page.waitForTimeout(1200);
    const kbCards = page.locator('.gr__kbcard');
    if (await kbCards.count()) {
      const first = kbCards.first();
      const box = await first.boundingBox();
      if (box) {
        // Lift ONLY — pressed, moved past the threshold, then ESCAPE to cancel.
        // A deal stage move writes `graha_deal_stage_history` and can fire an
        // automation; this suite proves the drag STARTS and cancels it, which
        // is precisely what the kanban bug prevented.
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 14, { steps: 6 });
        await page.waitForTimeout(400);
        /**
         * ⚠ NOT `[data-rfd-drag-handle-context-id]`. That attribute is on
         * EVERY drag handle at all times, so a check for its presence is true
         * before anything is touched — a vacuous assertion that would report
         * this board healthy whatever it did. The placeholder and the
         * announcement exist ONLY during a drag, which is the difference.
         */
        const lifted = await page.evaluate(() => {
          const live = [...document.querySelectorAll('[aria-live], [role="log"]')]
            .map((e) => (e as HTMLElement).innerText || e.textContent || '').join(' ');
          return document.querySelectorAll('[data-rfd-placeholder-context-id]').length > 0
            || /lifted|position \d/i.test(live);
        });
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await page.waitForTimeout(500);
        if (!lifted) {
          findings.push('graha#kanban: pressing and moving a deal card past the drag ' +
            'threshold lifted nothing — the same shape as the TaskCard defect, on a card ' +
            'whose root is a <div>');
        } else {
          notes.push('graha#kanban: a deal card lifts under the mouse (cancelled with Escape, nothing written)');
        }
      }
    } else {
      findings.push('graha#kanban: no `.gr__kbcard` on the deal board at all, on an org ' +
        'holding 30 deals — the kanban is the module\'s primary screen and it drew nothing');
    }

    // ── The two ⠿ grips ───────────────────────────────────────────────────
    /**
     * Both are behind a door of their own and neither door is on a fixed
     * route, so each is HUNTED rather than assumed:
     *
     *   `.ktabs__grip`  `CustomizeTabs`   — behind "Customise tabs…", the last
     *                                       row of any `ModuleTabs` More menu
     *                                       (`ModuleTabs.jsx:297-315`).
     *   `.kcols__grip`  `CustomizeColumns` — behind `ColumnsButton`'s
     *                                       `.kcols__btn` ("Columns"), which a
     *                                       table opts into via
     *                                       `<TableToolbar>`.
     *
     * A door that cannot be found anywhere on the routes tried is recorded as
     * a NOTE naming those routes, not as a finding: this is a sibling probe,
     * and claiming "the control is missing" from a search that may simply have
     * looked in the wrong place is exactly the false "missing control" report
     * that `getByRole(name)` produced three times in one day.
     */
    /**
     * TWO independent signals that a drag is genuinely in progress, so the
     * verdict does not rest on one string.
     *
     *   announcement  `@hello-pangea/dnd@18` appends its own
     *                 `<div id="rfd-announcement-…" aria-live="assertive">` to
     *                 `document.body` and writes "You have lifted an item in
     *                 position N" into it on a successful lift (read from
     *                 `dnd.cjs.js`, `useAnnouncer`).
     *   placeholder   `[data-rfd-placeholder-context-id]` exists ONLY while a
     *                 drag is active — it is the gap the list holds open.
     */
    const dragState = async () =>
      await page.evaluate(() => {
        const live = [...document.querySelectorAll('[aria-live], [role="status"], [role="log"]')]
          .map((e) => (e as HTMLElement).innerText || e.textContent || '')
          .join(' ')
          .trim();
        return {
          announced: /lifted|picked up|position \d/i.test(live),
          placeholder: document.querySelectorAll('[data-rfd-placeholder-context-id]').length,
          live: live.slice(0, 120),
        };
      });

    const pressSpaceOn = async (what: string, sel: string, reopen: () => Promise<void>) => {
      const grip = page.locator(sel).first();
      if (!(await grip.count())) return false;
      const label = (await grip.getAttribute('aria-label')) || '';

      /**
       * ⚠ THE MOUSE PROBE RUNS FIRST, AND THAT ORDERING IS THE FIX.
       *
       * Run 2 timed out on `grip.boundingBox()` after 20 seconds: the Escape
       * that cancels the keyboard drag also CLOSES the Customize sheet the
       * grip lives in, so by the time the mouse probe ran the element was
       * gone. Measuring the mouse path before pressing any key keeps both
       * probes on the same open sheet.
       *
       * Pressed, moved past the ~5px threshold, cancelled with Escape BEFORE
       * release — so the lift is proved and no reorder is persisted.
       */
      let mouse: { announced: boolean; placeholder: number; live: string } | null = null;
      const box = await grip.boundingBox().catch(() => null);
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 18, { steps: 8 });
        await page.waitForTimeout(500);
        mouse = await dragState();
        await page.keyboard.press('Escape').catch(() => {});
        await page.mouse.up();
        await page.waitForTimeout(400);
      }

      /**
       * ⚠ RE-OPEN THE SHEET BEFORE THE KEYBOARD PROBE.
       *
       * The Escape that cancels a dnd drag is bound on `window` with
       * `capture: true` and calls `preventDefault()` — it does NOT stop
       * propagation, so the `Modal` behind it closes too. Run 3 therefore
       * measured the mouse path and reported the keyboard path as
       * inconclusive on both grips.
       *
       * The keyboard promise is the one PRINTED ON THE CONTROL — "Space picks
       * it up, arrows move it, Space drops it" — so it is the half that most
       * needs measuring, and leaving it untested twice would be the silent cap
       * this suite exists to avoid. Re-opening costs one click.
       */
      if (!(await grip.count())) await reopen().catch(() => {});

      // ⚠ Focus must actually be ON the grip, or the Space key goes somewhere
      // else entirely and "nothing lifted" would be a finding about this test
      // rather than about the product.
      let focused = false;
      if (await grip.count()) {
        await grip.focus().catch(() => {});
        focused = await page.evaluate((s: string) => {
          const el = document.activeElement as HTMLElement | null;
          return !!el && el.matches(s);
        }, sel);
      }

      let st = { announced: false, placeholder: 0, live: '' };
      if (focused) {
        await page.keyboard.press(' ');
        await page.waitForTimeout(800);
        st = await dragState();
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
      } else {
        notes.push(`${what} (${sel}): the grip was gone or would not take focus after the ` +
          'mouse probe, so the Space contract was not tested on this pass — reported as ' +
          'inconclusive rather than counted either way');
      }

      if (mouse) {
        if (mouse.announced || mouse.placeholder > 0) {
          notes.push(`${what} (${sel}): the MOUSE path lifts (announced=${mouse.announced}, placeholder=${mouse.placeholder})`);
        } else {
          findings.push(`${what} (${sel}): a MOUSE press-and-drag past the threshold lifted ` +
            'NOTHING — no `[data-rfd-placeholder-context-id]` and no live-region announcement. ' +
            'The handle is a <button>, which is in `@hello-pangea/dnd`\'s own ' +
            '`interactiveTagNames`, so `tryStart` returns null before a lock is ever claimed ' +
            '— the identical guard that stopped every kanban card until 2026-08-29.');
        }
      }

      // ⚠ Only judged when the key actually went to the grip. An untested
      // keyboard path must read as untested, never as a failure — a finding
      // manufactured by the harness is worse than no finding.
      if (!focused) { /* already reported as inconclusive above */ }
      else if (st.announced || st.placeholder > 0) {
        notes.push(`${what} (${sel}): Space lifts the row — announced=${st.announced}, ` +
          `placeholder=${st.placeholder}, live region said "${st.live}"`);
      } else {
        findings.push(`${what} (${sel}): the grip is labelled "${label.slice(0, 74)}" and ` +
          'pressing Space lifted NOTHING — no live-region announcement AND no ' +
          `\`[data-rfd-placeholder-context-id]\` in the DOM (live region: "${st.live || 'empty'}"). ` +
          '`@hello-pangea/dnd` refuses to start a drag when the source event\'s target is ' +
          'one of its `interactiveTagNames`, and this handle is a <button>; ' +
          '`useKeyboardSensor` passes its keydown as that source event, so the promise in ' +
          'the label is unkeepable without `disableInteractiveElementBlocking`. FILED, NOT ' +
          'FIXED: two shared components with product-wide blast radius, and not a ' +
          'mid-session change while five suites run.');
      }
      return true;
    };

    // Door 1 — "Customise tabs…" at the foot of a module More menu.
    {
      let opened = false;
      for (const route of ['/ganit', '/graha', '/manav']) {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await settle(page);
        const more = page.locator('.mt__wrap button.mt__more');
        if (!(await more.count())) continue;
        await more.click();
        const openSheet = async () => {
          if (!(await page.locator('.mt__pop').isVisible().catch(() => false))) await more.click();
          const r = page.locator('.mt__pop [role="menuitem"]').filter({ hasText: /customi[sz]e/i }).first();
          await r.click();
          await page.waitForTimeout(1500);
        };
        const row = page.locator('.mt__pop [role="menuitem"]').filter({ hasText: /customi[sz]e/i }).first();
        if (!(await row.count())) { await page.keyboard.press('Escape'); continue; }
        await row.click();
        await page.waitForTimeout(1500);
        if (await pressSpaceOn('module tab order', '.ktabs__grip', openSheet)) { opened = true; break; }
        await page.keyboard.press('Escape').catch(() => {});
      }
      if (!opened) notes.push('module tab order: no `.ktabs__grip` reachable via "Customise tabs…" on /ganit, /graha or /manav');
    }

    // Door 2 — `ColumnsButton` on a table that opts into it.
    {
      let opened = false;
      for (const route of ['/boards', '/tasks', '/settings/organisation?tab=billing']) {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await settle(page);
        await page.waitForTimeout(1200);
        const btn = page.locator('button.kcols__btn').first();
        if (!(await btn.count()) || !(await btn.isVisible().catch(() => false))) continue;
        const openSheet = async () => { await btn.click(); await page.waitForTimeout(1500); };
        await btn.click();
        await page.waitForTimeout(1500);
        if (await pressSpaceOn('table column order', '.kcols__grip', openSheet)) { opened = true; break; }
        await page.keyboard.press('Escape').catch(() => {});
      }
      if (!opened) notes.push('table column order: no `.kcols__btn` ("Columns") visible on /boards, /tasks or settings→billing');
    }

    console.log(`\n  20.12b — drag siblings\n`);
    for (const n of notes) console.log('   ok ' + n);
    for (const f of findings) console.log('   !! ' + f);

    expect(
      findings,
      'drag handle(s) cannot start a drag. The kanban fix on 2026-08-29 was one instance of ' +
      `a library-wide guard, and these are the others:\n     ${findings.join('\n     ')}`,
    ).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════
     20.13 — A DATE PICKER INSIDE A MODAL
     ══════════════════════════════════════════════════════════════════════ */
  test('20.13 a DateInput inside a Modal is clickable where it is drawn', async ({ page }) => {
    test.setTimeout(12 * 60_000);
    const L = readLedger();
    await signIn(page);

    /**
     * ⚠ THIS FAILS ON PURPOSE. IT IS 93 §F ITEM 5, FILED AND DELIBERATELY NOT
     * FIXED, AND IT IS HERE SO THE FIX HAS SOMETHING TO TURN GREEN.
     *
     *     MEASURED at 1280x720 on 2026-08-29:
     *       modal panel      y 203 - 517
     *       popover (316px)  flips UP to y 65 - 381
     *       Clear button     y 106 - 133   ← outside BOTH clipping ancestors
     *       document.elementFromPoint(Clear centre) → div.modal__scrim
     *
     * A person aiming at Clear CLOSES THE DIALOG. `DateInput` never portals its
     * popover: its flip logic (`DateInput.jsx:111-119`) is viewport-aware and
     * not container-aware, so inside `.modal__body` it can flip out of its own
     * clipping ancestor and land under the scrim.
     *
     * Exactly four files pair `<Modal>` with `<DateInput>` today, all in
     * `pages/ganit/` — RateCardsTab, SLACreditsTab, ServiceLinesTab,
     * MeteredUsageTab — so the blast radius LOOKS small. It is not: the fault
     * is in a shared component with ~64 call sites, and native date inputs are
     * banned repo-wide, so every future modal with a date in it inherits it.
     *
     * NOT FIXED HERE, on purpose: a `DateInput` change is product-wide and this
     * is not a mid-session change to make while five suites are running. It is
     * reported to the lead, which is the brief's instruction for a defect in
     * another owner's component.
     *
     * The test asserts what a PERSON can do — `elementFromPoint` over the
     * control's own centre — because that is the only definition of "clickable"
     * that matters and the only one a screenshot cannot fake.
     */
    const findings: string[] = [];
    const measured: string[] = [];

    const CASES: Array<[string, string, RegExp]> = [
      ['ganit#rate-cards', 'rate-cards', /rate card/i],
      ['ganit#service-lines', 'service-lines', /service line/i],
      ['ganit#metered-usage', 'metered-usage', /usage/i],
      ['ganit#sla-credits', 'sla-credits', /credit/i],
    ];

    for (const [id, tab, opener] of CASES) {
      await page.goto('/ganit', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const { panel } = await openTabById(page, L, '/ganit', tab);

      /**
       * ⚠ CLOSE THE TAB POPOVER BEFORE AIMING AT ANYTHING.
       *
       * Run 1 timed out here for twenty seconds against
       * `<button role="menuitem" class="mt__pop-row"> … intercepts pointer
       * events`. Most Ganit tabs live behind "More +13", so reaching one leaves
       * the popover mounted over the panel; the click then lands on the menu.
       *
       * And the opener is scoped to THE TAB PANEL and matched on a phrase
       * specific to the tab. Run 1's `/new|add/i` over all of `#main` resolved
       * to "+ New invoice" — the header control of a different tab entirely,
       * which is the false-target half of the same mistake.
       */
      await page.keyboard.press('Escape').catch(() => {});
      await expect(page.locator('.mt__pop'), 'the tab overflow menu stayed open over the panel')
        .toBeHidden({ timeout: 10_000 });
      await settle(page);

      // ⚠ Wait for the panel to have drawn ITS OWN controls before looking for
      // one. Pass 4 reported "no control opens the create modal" on
      // `metered-usage` — the same tab it had measured a pass earlier — because
      // the panel had not finished rendering when the search ran. A control
      // read for before it exists is the false "missing control" report this
      // programme keeps producing.
      await panel.locator('button').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
      const btn = panel.locator('button').filter({ hasText: opener }).first();
      if (!(await btn.count())) {
        findings.push(`${id}: no control matching ${opener} opens a create modal on this panel`);
        continue;
      }
      await btn.click();
      await page.waitForTimeout(1200);

      const modal = page.locator('.modal__panel, [role="dialog"]').first();
      if (!(await modal.isVisible().catch(() => false))) { findings.push(`${id}: the create modal did not open`); continue; }

      const trigger = modal.locator('.pk--dt button.pk__tr').first();
      if (!(await trigger.count())) { measured.push(`${id}: this modal renders no DateInput`); await page.keyboard.press('Escape'); continue; }
      await trigger.click();
      await page.waitForTimeout(700);

      const geo = await page.evaluate(() => {
        const pop = document.querySelector('.pk__pop') as HTMLElement | null;
        if (!pop) return null;
        const panel = document.querySelector('.modal__panel') as HTMLElement | null;
        const r = pop.getBoundingClientRect();
        const pr = panel?.getBoundingClientRect();
        // Every control a person might aim at inside the popover.
        const targets = [...pop.querySelectorAll<HTMLElement>('button')].map((b) => {
          const box = b.getBoundingClientRect();
          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;
          const hit = document.elementFromPoint(cx, cy) as HTMLElement | null;
          return {
            label: (b.innerText || b.getAttribute('aria-label') || '?').trim().slice(0, 18),
            y: Math.round(box.y),
            reachable: !!hit && (hit === b || b.contains(hit)),
            hitBy: hit ? `${hit.tagName.toLowerCase()}.${(hit.className || '').toString().split(' ')[0]}` : 'nothing',
          };
        });
        return {
          flippedUp: pop.classList.contains('pk__pop--up'),
          pop: { y: Math.round(r.y), h: Math.round(r.height) },
          panel: pr ? { y: Math.round(pr.y), h: Math.round(pr.height) } : null,
          blocked: targets.filter((t) => !t.reachable),
          total: targets.length,
        };
      });

      if (!geo) { findings.push(`${id}: the DateInput popover never opened`); continue; }

      measured.push(`${id}: popover y=${geo.pop.y} h=${geo.pop.h}` +
        `${geo.flippedUp ? ' (FLIPPED UP)' : ''} · modal y=${geo.panel?.y} h=${geo.panel?.h} · ` +
        `${geo.total - geo.blocked.length}/${geo.total} controls reachable`);
      for (const b of geo.blocked) {
        findings.push(`${id}: the "${b.label}" control at y=${b.y} inside the date popover is ` +
          `NOT clickable — the point where it is drawn belongs to ${b.hitBy}. A person aiming ` +
          `at it hits that instead. \`DateInput\` never portals its popover and its flip is ` +
          `viewport-aware, not container-aware (DateInput.jsx:111-119).`);
      }

      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }

    console.log(`\n  20.13 — DateInput inside Modal, at ${JSON.stringify(page.viewportSize())}\n`);
    for (const m of measured) console.log('     ' + m);
    for (const f of findings) console.log('   !! ' + f);

    expect(
      findings,
      '93 §F item 5 — a control inside the date popover is drawn where a person cannot ' +
      'click it. FILED AND NOT FIXED: `DateInput` is a shared component with ~64 call sites ' +
      'and the fix (portalling the popover) is not a mid-session change while five suites ' +
      `are running. Reported to the lead.\n     ${findings.join('\n     ')}`,
    ).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════
     20.14 — RESIZE AND THEME
     ══════════════════════════════════════════════════════════════════════ */
  test('20.14 no breakpoint scrolls the page sideways, and both themes render', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    await signIn(page);

    /**
     * §1: "no horizontal page scroll, nothing clipped, nothing overlapping"
     * and "wide tables scroll INSIDE their container rather than the page".
     * The distinction is the whole test — a wide table is fine, a wide PAGE is
     * a layout that has escaped its container, and on a phone it is the
     * difference between a usable screen and one that slides away under the
     * thumb.
     */
    const SIZES: Array<[string, number, number]> = [
      ['mobile', 390, 844],
      ['tablet', 768, 1024],
      ['laptop 1366x768 (band V2)', 1366, 768],
      ['desktop', 1440, 900],
    ];
    const ROUTES_R = ['/dashboard', '/tasks', '/ganit', '/graha', '/manav', '/settings/organisation'];

    const findings: string[] = [];
    const tokens: string[] = [];

    for (const [label, w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      for (const route of ROUTES_R) {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await settle(page, 8_000);
        await page.waitForTimeout(1200);
        const m = await page.evaluate(() => ({
          hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
          over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          token: getComputedStyle(document.documentElement).getPropertyValue('--row-h').trim(),
        }));
        if (m.hScroll) {
          findings.push(`${route} @ ${label} (${w}x${h}): the PAGE scrolls horizontally by ` +
            `${m.over}px — a wide child is not inside its own overflow container`);
        }
        if (route === '/ganit') tokens.push(`${label.padEnd(28)} --row-h ${m.token}`);
      }
    }

    // ── Both themes ───────────────────────────────────────────────────────
    // Dark must RENDER, not merely exist as a token file. A screen whose text
    // and background resolve to the same colour is invisible and no row count
    // would show it.
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/ganit', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await settle(page, 8_000);
      const c = await page.evaluate(() => {
        const el = (document.querySelector('#main') || document.body) as HTMLElement;
        const cs = getComputedStyle(el);
        const body = getComputedStyle(document.body);
        return { fg: cs.color, bg: body.backgroundColor };
      });
      if (c.fg === c.bg) {
        findings.push(`${scheme} theme: text and background resolve to the same colour ` +
          `(${c.fg}) — the screen is invisible`);
      }
    }
    await page.emulateMedia({ colorScheme: null });

    console.log(`\n  20.14 — ${SIZES.length} breakpoints × ${ROUTES_R.length} screens, plus both themes\n`);
    for (const t of tokens) console.log('     /ganit  ' + t);
    for (const f of findings) console.log('   !! ' + f);

    expect(
      findings,
      `layout finding(s) across the breakpoints:\n     ${findings.join('\n     ')}`,
    ).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════
     20.15 — THE COVERAGE SHEET
     ══════════════════════════════════════════════════════════════════════ */
  test('20.15 the coverage sheet is exact, and Aekam Inc is untouched', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await signIn(page);
    const L = readLedger();

    /**
     * §12 — Aekam Inc is NO-TOUCH, and Unicode CONTAINS a team named "Aekam
     * Inc" (`team_ae1d58543b21`) holding the protected 20 tasks. This suite's
     * only mutating requests are the two board drags in 20.12, which
     * deliberately skip that team; this re-reads it so the guarantee is a
     * FIXTURE and not a promise. §12's own words: "the loose version is not
     * deliverable."
     */
    /**
     * ⚠ BOTH HALVES, AND RUN 1 IS WHY.
     *
     * The first version asked `GET /api/tasks?team_id=…` and got **19**, and
     * reported the protected set as short by one — the single most alarming
     * thing this suite could say. It was a TEST BUG. `server.list_tasks`
     * declares `archived: Optional[bool] = False`, so the default call HIDES
     * archived tasks, and exactly one of the twenty is archived. Verified
     * independently against the live catalogue on 2026-08-29:
     *
     *     public.tasks WHERE team_id='team_ae1d58543b21'
     *       total 20 · archived_at NOT NULL 1 · max(updated_at) 2026-08-28 14:40
     *
     * — an update stamp from BEFORE this session, so nothing here touched them.
     * Asking for both halves is what makes the fixture say what it means.
     */
    const openTasks: any[] = await apiJson(page, '/api/tasks?team_id=team_ae1d58543b21&limit=500&archived=false');
    const archived: any[] = await apiJson(page, '/api/tasks?team_id=team_ae1d58543b21&limit=500&archived=true');
    const ids = new Set([...openTasks, ...archived].map((t: any) => String(t.task_id ?? t.id)));
    console.log(`\n  §12 protected set: ${openTasks.length} open + ${archived.length} archived ` +
      `= ${ids.size} distinct tasks on team_ae1d58543b21\n`);
    expect(
      ids.size,
      `the protected team \`team_ae1d58543b21\` holds ${ids.size} tasks (${openTasks.length} ` +
      `open, ${archived.length} archived). Proposal 93 §12 guarantees exactly 20 and this ` +
      'suite touches none of them — 20.12 skips that team by id.',
    ).toBe(20);

    // ── The sheet ─────────────────────────────────────────────────────────
    const byFamily = (f: Screen['family']) => L.screens.filter((s) => s.family === f).length;
    const clean = L.screens.filter((s) => s.verdict === 'ok' && !s.console.length && !s.uncaught.length).length;

    console.log('\n══════════════ SUITE 20 · COVERAGE ══════════════');
    console.log(`  swept ${L.startedAt} → ${L.finishedAt}`);
    console.log(`  viewport ${L.viewport.w}x${L.viewport.h}  ·  viewport-fit band ${L.band}`);
    console.log(`  routes           ${byFamily('route')} of ${ROUTES.length} intended`);
    console.log(`  module tabs      ${byFamily('moduletab')}   (discovered from the DOM, not typed)`);
    console.log(`  url tabs         ${byFamily('urltab')} of ${Object.values(URL_TABS).flat().length} intended`);
    console.log(`  shell chrome     ${byFamily('chrome')}`);
    console.log(`  ── total screens ${L.screens.length}, of which ${clean} clean`);
    console.log(`  table rows measured    ${L.screens.reduce((n, s) => n + s.rowsSeen, 0)}`);
    console.log(`  painted UUIDs          ${L.screens.reduce((n, s) => n + s.uuids.length, 0)}`);
    console.log(`  native date controls   ${L.screens.reduce((n, s) => n + s.nativeDates.length, 0)}`);
    console.log(`  uncaught exceptions    ${L.screens.reduce((n, s) => n + s.uncaught.length, 0)}`);
    console.log(`  console errors         ${L.screens.reduce((n, s) => n + s.console.length, 0)}`);
    console.log('');
    console.log('  WROTE, in total:');
    console.log('    2 × PATCH /api/tasks/{id}/move  — one reorder inside a column and its');
    console.log('        reverse, in 20.12. No row created, none deleted, nothing mailed:');
    console.log('        `_notify_status_changed` runs only when the STATUS moves, and a');
    console.log('        same-column reorder does not move it.');
    console.log('');
    console.log('  NOT SWEPT, deliberately:');
    console.log('    /admin/**      Suite 19 · needs god mode; this lane is org-scoped');
    console.log('    /client/**     Suite 18 · needs a portal account');
    console.log('    token routes   /sign/:token, /i/:token, /accept-invite, /reset-password');
    console.log('    record drawers and forms below the tab level, except 20.13\'s two');
    console.log('    a genuinely NEW org — 20.09 drives the empty BRANCH, not a new org.');
    console.log('        Suite 00 on UK AekamINC is what covers that.');
    console.log('═════════════════════════════════════════════════\n');

    // The sweep must have covered what it set out to cover. A run that opened
    // half the product and reported the half it opened is the silent cap §10
    // names as the failure most available to this suite.
    const missing = L.intended - (byFamily('route') + byFamily('moduletab') + byFamily('urltab'));
    expect(
      missing,
      `${missing} screen(s) were intended and never recorded. On a suite whose scope is ` +
      '"all screens", a partial sweep reported as a total is the one failure mode §10 ' +
      'singles out.',
    ).toBe(0);

    expect(
      byFamily('moduletab'),
      'the sweep found fewer than a hundred module tabs. Ganit alone declares 21, Graha 20 ' +
      'and Manav 20 — a count this low means the strip was not read, and every per-screen ' +
      'assertion above is then quietly about a fraction of the product.',
    ).toBeGreaterThan(100);
  });
});
