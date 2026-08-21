/**
 * THE SKILL SHELF, DRIVEN AS A PERSON DRIVES IT.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Seventy-eight skills are assigned to this organisation and until now not one
 * of them had ever been run from a browser by anything but a human hand. The
 * unit suite pins `summariseOutput` and `splitFinding` against fixtures; the
 * fixtures were written from the handler source, not from the wire. `tonight.
 * spec.ts` proves the ENDPOINTS answer. Neither can tell you what a chartered
 * accountant sees after pressing Run, and that — "not giving the data is
 * useless" — is the whole complaint this shelf was rebuilt to answer.
 *
 * So every assertion below is on RENDERED TEXT. Where a test needs to know
 * what the truth was, it reads the run's own HTTP response and then requires
 * the screen to agree with it. A test that only asserted "some text appeared"
 * would have passed on `Result: 2`.
 *
 * SAFETY — the fence, stated before the first line of test code
 * -------------------------------------------------------------
 * · `staging` and production share ONE Supabase database, and `/api/health`
 *   reports `outbound_mode: live`. Anything caused here is real.
 * · NOTHING IN `WRITE_SKILL_FUNCTIONS` IS EVER RUN. The five names are copied
 *   from `backend/services/skill_dispatcher.py` into `WRITE_SKILL_FUNCTIONS`
 *   below and every skill this file touches is checked against them BY
 *   FUNCTION NAME before it is run — never by a card's label, which is
 *   authored text and can say anything.
 * · Every skill run by this file is `skill_type == 'check'` AND
 *   `estimated_credits == 0`. A check with no AI step calls no model, sends
 *   nothing, and writes nothing; the only record it leaves is its own row in
 *   `staging.hub_skill_runs`, which is what running a read-only skill does by
 *   itself and cannot be avoided by any means short of not running it.
 * · NO PAID SKILL IS RUN. The findings-render case is proved on a free check
 *   whose handler returns rows, so the "run exactly one cheap paid skill"
 *   allowance was not needed and was not taken. See `FINDINGS_FN`.
 * · No credential is ever typed. Auth is the storage state minted by
 *   `e2e-real/mint-state.mjs` from `E2E_ADMIN_TOKEN`.
 *
 * WHICH ORGANISATION THIS DRIVES
 * ------------------------------
 * The one the token resolves to on its own, exactly as the browser does: the
 * minted state carries `auth_token` and nothing else, so `lib/api.js` finds no
 * `active_org` and sends no `X-Org-Id`, and the server answers for the user's
 * own organisation. That is NOT the seeded `E2E_ORG_ID`, and it must not be —
 * `X-Org-Id` is a cross-org override the server refuses for a caller who is
 * not a member. `tonight.spec.ts` makes the same choice for the same reason.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { OWNER_STATE } from './real.config';
import { settle } from './_helpers';

test.use({ storageState: OWNER_STATE });

const API = process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app';

/**
 * `WRITE_SKILL_FUNCTIONS`, verbatim from `backend/services/skill_dispatcher.py`.
 * Copied rather than imported because this is a fence and a fence that can be
 * silently emptied by a refactor on the other side of the repo is not one.
 * `backend/tests` pins the Python half; this is the browser half.
 */
const WRITE_SKILL_FUNCTIONS = new Set([
  'generate_due_invoices',
  'mark_holidays_weekends',
  'execute_onboarding',
  'send_campaign',
  'execute_sequence_step',
]);

/**
 * The two handlers this file runs, chosen by NAME and not by label.
 *
 * `check_chase_ladder` — "What we are waiting on", module `kartavya`, free,
 *   `skill_type == 'check'`, one data step and no AI step. It returns lists of
 *   ROWS (overdue tasks and unsigned documents, each with what it is, who it
 *   escalates to and how many days late), which is precisely the shape that
 *   was being reduced to a number. It is the free equivalent of the paid
 *   "Overdue follow-up chase" the owner ran by hand, so the regression can be
 *   pinned without spending a credit or drafting an email.
 *
 * `check_unmatched_receipts` — "Money in, invoice unpaid", module `ganit`,
 *   free, a check. On a healthy book every one of its lists comes back empty,
 *   which is the case the empty-state test needs: a check that LOOKED and
 *   found nothing must say so.
 */
const FINDINGS_FN = 'check_chase_ladder';
const CLEAN_FN = 'check_unmatched_receipts';

/** The page whose dock carries `kartavya` skills — `lib/routeModules.js`. */
const DOCK_PAGE = '/dashboard';
const SHELF = '/hub/org?tab=skills';

/* ── ids, and the shapes that must never reach a screen ────────────────────── */

/** A canonical UUID, in any casing. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * This product's own opaque identifiers for PEOPLE and the groups they belong
 * to — `user_f798947b8a2e`, `team_1682e055fd21`. They are not UUIDs and a
 * UUID-only scan reads clean while one is on screen, which is how a chase list
 * came to print `user_91601f25f601` in the column headed "Owner".
 *
 * Deliberately NOT here: `task_…`, `INV-…`, a GSTIN, a PAN, a UDIN. Those are
 * record references the reader uses at a portal or in conversation, and
 * `check-rendered-ids.mjs` keeps its own allow-list for the same reason. The
 * owner's rule is about a user, a member or an org.
 */
const PERSON_ID = /\b(?:user|team|member|org)_[0-9a-f]{8,}\b/i;

/* ── plumbing ──────────────────────────────────────────────────────────────── */

/** The bearer the app itself sends, read from the state the UI restores. */
async function token(): Promise<string> {
  const fs = await import('fs');
  const state = JSON.parse(fs.readFileSync(OWNER_STATE, 'utf8'));
  const t = state.origins?.[0]?.localStorage
    ?.find((e: any) => e.name === 'auth_token')?.value;
  expect(t, `no auth_token in ${OWNER_STATE} — run \`node e2e-real/mint-state.mjs\``)
    .toBeTruthy();
  return t;
}

/** No `X-Org-Id`: see the header. */
async function auth(_r: APIRequestContext) {
  return { Authorization: `Bearer ${await token()}` };
}

/** `steps` is jsonb and arrives as text from some routes, an array from others. */
function stepsOf(row: any): any[] {
  const raw = typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps;
  return Array.isArray(raw) ? raw : [];
}

function functionsOf(row: any): string[] {
  return stepsOf(row).map(s => s.skill_function).filter(Boolean);
}

/** Every skill this organisation actually holds. */
async function orgSkills(request: APIRequestContext): Promise<any[]> {
  const r = await request.get(`${API}/api/v1/hub/org/skills`, { headers: await auth(request) });
  expect(r.ok(), `GET /v1/hub/org/skills → ${r.status()}: ${await r.text()}`).toBeTruthy();
  const body = await r.json();
  const items = body.data ?? body;
  expect(Array.isArray(items), `the shelf endpoint did not answer a list: ${JSON.stringify(body).slice(0, 200)}`)
    .toBeTruthy();
  return items;
}

/**
 * The assigned skill whose only data step is `fn` — and THE SAFETY GATE.
 *
 * Refuses, loudly, if the row it found carries any function in
 * `WRITE_SKILL_FUNCTIONS`, if it is not a `check`, or if it is not free. All
 * three are re-checked here rather than trusted from the constant above,
 * because the constant names a HANDLER and the shelf is what decides which
 * template that handler ended up inside.
 */
async function freeCheck(request: APIRequestContext, fn: string) {
  const items = await orgSkills(request);
  const row = items.find(s => functionsOf(s).includes(fn));
  expect(row, `no assigned skill runs \`${fn}\`; the shelf holds ${items.length} skills. ` +
    'Either the template was unassigned or the handler was renamed — pick another free ' +
    'check rather than weakening this test.').toBeTruthy();

  const fns = functionsOf(row);
  const writers = fns.filter(f => WRITE_SKILL_FUNCTIONS.has(f));
  expect(writers,
    `REFUSING TO RUN "${row.template_name || row.name}": it calls ${writers.join(', ')}, ` +
    'which is in WRITE_SKILL_FUNCTIONS. Staging writes to the production database and ' +
    'outbound_mode is live.').toEqual([]);
  expect(row.skill_type,
    `"${row.template_name || row.name}" is a ${row.skill_type}, not a check — this suite runs checks only`)
    .toBe('check');
  expect(Number(row.estimated_credits),
    `"${row.template_name || row.name}" is priced at ${row.estimated_credits} credits; ` +
    'this suite spends nothing').toBe(0);
  expect(stepsOf(row).filter(s => !s.skill_function),
    `"${row.template_name || row.name}" carries an AI step, so running it would call a model ` +
    'and draft outward text').toEqual([]);

  return { row, name: String(row.template_name || row.name) };
}

/** The data step of a finished run, as the server reported it. */
function finding(body: any) {
  const outputs = Array.isArray(body?.outputs) ? body.outputs : [];
  const step = outputs.find((o: any) => o?.skill_function);
  expect(step, 'the run response carried no data step at all — `outputs` is ' +
    `${JSON.stringify(body?.outputs)}. Everything below would be asserting against a hole.`)
    .toBeTruthy();
  expect(step.truncated,
    'the finding was clipped by the server, so the screen is legitimately showing a ' +
    'warning instead of rows and this test cannot say anything about rendering. Narrow ' +
    "the skill's limit or pick a quieter check.").toBeFalsy();
  return step;
}

/** Every non-empty list of row-objects in a finding, largest first. */
function rowLists(data: any): Array<{ key: string; rows: any[] }> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  return Object.entries(data)
    .filter(([, v]) => Array.isArray(v) && v.length > 0
      && v.every(x => x && typeof x === 'object' && !Array.isArray(x)))
    .map(([key, v]) => ({ key, rows: v as any[] }))
    .sort((a, b) => b.rows.length - a.rows.length);
}

/** Keys of every list that came back empty — the "we looked and it is clean" case. */
function emptyListKeys(data: any): string[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  return Object.entries(data)
    .filter(([, v]) => Array.isArray(v) && v.length === 0)
    .map(([k]) => k);
}

/** What a person can actually read on the page right now. */
async function screenText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).replace(/ /g, ' ');
}

/* ── the shelf, on screen ──────────────────────────────────────────────────── */

/**
 * Open Sahayak → Skills and wait for the shelf itself, never for a timer. The
 * tab mounts inside `Resource`, which draws a loading state first; asserting
 * on text before the list lands is how a suite reports "no skills" against an
 * org with seventy-eight.
 */
async function openShelf(page: Page) {
  await page.goto(SHELF);
  await expect(page.getByRole('group', { name: 'Skill view' }),
    'the Sahayak Skills tab never mounted — check the route and that the account holds Sahayak')
    .toBeVisible();
  await expect(page.locator('.sk-card').first(),
    'no skill card ever rendered on the Active shelf').toBeVisible({ timeout: 30_000 });
  await settle(page);
}

/**
 * Narrow the shelf to one skill by typing its name, the way a person does,
 * then take the card whose TITLE is that name.
 *
 * Not `.sk-card` alone, and not a count of one: the shelf deliberately
 * searches the names of the records a skill reads as well as its title — "the
 * word 'overdue' should find the skill whose step is `find_overdue_invoices`
 * even though the word is in no title" — so a query legitimately matches
 * neighbours. Demanding one result would have made a working feature look like
 * a bug. Matching the heading is what the reader does with their eye.
 */
async function searchShelf(page: Page, name: string) {
  const box = page.getByPlaceholder('Search skills…');
  await expect(box, 'the shelf has no search box — sixty-one cards in a flat grid is the ' +
    'defect this control was added to fix').toBeVisible();
  await box.fill(name);
  await expect(page.locator('.sk-card').first(),
    `searching for “${name}” emptied the shelf`).toBeVisible({ timeout: 15_000 });

  const card = page.locator('.sk-card').filter({
    has: page.locator('.sk-card__t', { hasText: new RegExp(`^${escapeRe(name)}$`) }),
  });
  await expect(card, `searching for “${name}” did not surface a card with that exact title`)
    .toHaveCount(1, { timeout: 15_000 });
  return card.first();
}

/** A skill name is authored text and may carry regex metacharacters. */
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Press Run on an open card and hand back the run's own HTTP response.
 *
 * The response is the second half of every assertion in this file: the screen
 * has to agree with what the server said it found, and only reading both can
 * tell "the skill found nothing" apart from "the page dropped it".
 */
async function runFromShelf(page: Page, card: any) {
  const [res] = await Promise.all([
    page.waitForResponse(r => /\/skills\/[^/]+\/run$/.test(r.url())
      && r.request().method() === 'POST', { timeout: 120_000 }),
    card.getByRole('button', { name: 'Run now' }).click(),
  ]);
  const text = await res.text();
  expect(res.status(), `POST ${res.url()} → ${res.status()}: ${text}`).toBe(200);
  return JSON.parse(text);
}

/* ══ 1 · THE SHELF RENDERS ═════════════════════════════════════════════════ */

test('the shelf lists every assigned skill, grouped by module', async ({ page, request }) => {
  const assigned = await orgSkills(request);
  await openShelf(page);

  // The count on the Active chip is the org's own number, not a page size.
  await expect(page.getByRole('button', { name: /^Active/ }),
    `the Active chip does not report the ${assigned.length} skills GET /v1/hub/org/skills returns`)
    .toContainText(String(assigned.length));

  // GROUPED. Sixty-one cards in one flat grid is a list, not a shelf — the
  // module headings are the fix and their absence is invisible to any check
  // that only counts cards.
  const sections = page.locator('section.sk-shelf');
  const groups = await sections.count();
  const modules = new Set(assigned.map(s => s.module).filter(Boolean));
  expect(groups, `the shelf drew ${groups} module sections for ${modules.size} distinct ` +
    'modules — an ungrouped shelf is the defect').toBe(modules.size);

  // Every card carries its kind. `sk-kind` is the pill that says check / brief
  // / pack / content, which is what decides how much attention the output wants.
  const cards = page.locator('.sk-card');
  const n = await cards.count();
  expect(n, `the shelf drew ${n} cards for ${assigned.length} assigned skills`)
    .toBe(assigned.length);
  const kinds = await page.locator('.sk-card .sk-kind').count();
  expect(kinds, `${n - kinds} of ${n} cards do not say what kind of skill they are`).toBe(n);

  // And what it does, in words. The fallback when a template has no
  // description is a step count — true, and not a description; the API now
  // carries `description`, so a card reading "1 step" means the field was
  // dropped on the way to the screen.
  const blurbs = await page.locator('.sk-card .sk-card__d').allInnerTexts();
  const stepCounts = blurbs.filter(b => /^\d+ steps?$/.test(b.trim()));
  expect(stepCounts.length,
    `${stepCounts.length} cards print a step count where their description belongs — ` +
    '`description` is on /v1/hub/org/skills and is not reaching the card').toBe(0);
});

test('a card says what a run costs before it is run', async ({ page, request }) => {
  const { name } = await freeCheck(request, FINDINGS_FN);
  await openShelf(page);
  const card = await searchShelf(page, name);

  await card.getByRole('button', { name: 'Run', exact: true }).click();
  const form = card.locator('form.sk-run');
  await expect(form, `pressing Run on “${name}” opened no run form`).toBeVisible();

  // THE PRICE, AND NOT A DEFAULT. `estimated_credits` of 0 is falsy, and the
  // old cost line fell through it into a helper that answers null while the
  // price table is in flight — so a skill that costs nothing captioned itself
  // "Cost table unavailable".
  await expect(form.locator('.hb-form__foot .hb-cap'),
    `“${name}” costs 0 credits and its card does not say it is free`)
    .toContainText(/Free — this skill reads your records and calls no model/);

  // What it touches, before it touches it.
  await expect(form.locator('.sk-run__perm'),
    'the run form does not say what the skill reads and what it changes').toBeVisible();
  await expect(form.locator('.sk-run__perm'),
    `“${name}” is a read-only check and the form does not say it changes nothing`)
    .toContainText(/Nothing\. This skill only reads and reports\./);
});

/* ══ 2 · A FREE CHECK RUNS AND SHOWS ITS FINDINGS ══════════════════════════ */

/**
 * THE POINT OF THIS FILE.
 *
 * The owner ran a chase skill, the dock said `Result: 2`, and the two overdue
 * follow-ups it had found never reached the screen. This asserts the opposite
 * on the shelf: whatever rows the server reports, the ROWS are on screen — the
 * thing, who it is on, and how late — and the count alone is not an answer.
 */
test('a free check shows the findings themselves, not a count of them', async ({ page, request }) => {
  const { name } = await freeCheck(request, FINDINGS_FN);
  await openShelf(page);
  const card = await searchShelf(page, name);
  await card.getByRole('button', { name: 'Run', exact: true }).click();

  const body = await runFromShelf(page, card);
  const step = finding(body);
  const lists = rowLists(step.data);
  expect(lists.length, `“${name}” returned no list of rows this time ` +
    `(keys: ${Object.keys(step.data || {}).join(', ')}), so there is nothing on the wire ` +
    'for the screen to have dropped. This test needs a check with findings — it is not ' +
    'evidence that the rendering works.').toBeGreaterThan(0);

  const results = card.locator('.sr-done');
  await expect(results, 'the run finished and the card drew no result block at all')
    .toBeVisible({ timeout: 30_000 });
  const shown = await results.innerText();

  // The caveat, FIRST and WHOLE. `test_every_skill_states_its_limits.py` exists
  // because these outputs go to chartered accountants; a limitation the reader
  // does not see is the failure mode, so it is asserted here as text and not as
  // the presence of a container.
  const caveat: string | undefined = (step.data?.limitations
    ?? step.data?.caveats ?? step.data?.caveat)?.[0];
  if (caveat) {
    expect(shown, `the skill stated a limitation the screen does not show:\n  “${caveat}”`)
      .toContain(caveat.slice(0, 60));
  }

  // THE ROWS. Every non-empty list must appear under its own heading with its
  // own count — and then the FIRST ROW OF THE LARGEST LIST must be readable in
  // full: what it is, who it escalates to, how late it is. That triple is what
  // "Result: 2" withheld.
  // Case-insensitively: `.sk-fx__h` is `text-transform: uppercase`, and
  // `innerText` reports what is PAINTED, so the heading arrives as "NUDGES
  // DUE". Matching the exact casing would have failed on a stylesheet rule.
  const flat = shown.toLowerCase();
  for (const { key, rows } of lists) {
    const heading = key.replace(/_/g, ' ');
    expect(flat, `the finding carries ${rows.length} rows under “${key}” and the screen ` +
      `has no “${heading}” section — a list that is not drawn is a list that was thrown away`)
      .toContain(heading.toLowerCase());
  }

  const top = lists[0].rows[0];
  const what = top.what ?? top.label ?? top.entity?.label ?? top.title ?? top.name;
  expect(what, `the first row of “${lists[0].key}” has nothing nameable on it ` +
    `(${Object.keys(top).join(', ')}) — a finding a person cannot read is not a finding`)
    .toBeTruthy();
  expect(shown, `the run found “${what}” and the screen does not say so. This is the ` +
    '“Result: 2” defect: the count reached the page and the finding did not.')
    .toContain(String(what));

  const who = top.escalate_to ?? top.owner_name ?? top.assignee ?? top.vendor ?? top.client;
  if (who) {
    expect(shown, `the row for “${what}” names ${who} and the screen does not — WHO is the ` +
      'one question a chase list exists to answer').toContain(String(who));
  }

  const late = top.days_past_due ?? top.days_past;
  if (late != null) {
    expect(shown, `the row for “${what}” is ${late} days past due and no such figure is on ` +
      'screen — how late a thing is decides whether anyone acts on it')
      .toMatch(new RegExp(`\\b${late}\\b`));
  }
});

/* ══ 3 · AN EMPTY RESULT SAYS SO ══════════════════════════════════════════ */

/**
 * A check that LOOKED and found nothing is the most valuable answer it can
 * give, and it is the one a falsy check silently deletes: `"invoices": []`
 * means every invoice in the period is filable, and dropping the key because
 * it is empty renders a clean month as a blank page.
 */
test('a check that found nothing says it found nothing', async ({ page, request }) => {
  const { name } = await freeCheck(request, CLEAN_FN);
  await openShelf(page);
  const card = await searchShelf(page, name);
  await card.getByRole('button', { name: 'Run', exact: true }).click();

  const body = await runFromShelf(page, card);
  const step = finding(body);
  const empties = emptyListKeys(step.data);
  expect(empties.length, `“${name}” returned no empty list this time ` +
    `(keys: ${Object.keys(step.data || {}).join(', ')}), so the clean-result case cannot be ` +
    'exercised. The org has findings under every heading — pick a quieter check rather ' +
    'than dropping this case.').toBeGreaterThan(0);

  const results = card.locator('.sr-done');
  await expect(results, 'the run finished and drew no result block').toBeVisible({ timeout: 30_000 });
  const shown = await results.innerText();

  for (const key of empties) {
    const label = key.replace(/_/g, ' ').toLowerCase();
    expect(shown.toLowerCase(), `the check looked under “${key}” and found nothing, and the ` +
      'screen does not name it — an empty block reads as a page that failed to load')
      .toContain(label);
  }
  // And it must say that the emptiness is an ANSWER, not a skipped check.
  expect(shown, 'the empty result is drawn without saying it is a result — a reader cannot ' +
    'tell "we looked and it is clean" from "this did not run"')
    .toContain('That is a result');
});

/* ══ 4 · NO ID IS EVER DRAWN ══════════════════════════════════════════════ */

/**
 * `check-rendered-ids.mjs` is a POSITIONAL check over JSX source. It can see
 * `<span>{row.user_id}</span>`; it cannot see a table whose COLUMNS are
 * computed at runtime from a dict no one wrote in JSX. A findings table is
 * exactly that blind spot, and it is the one surface where a raw id would
 * genuinely be read by a customer — so the rule is asserted here against the
 * pixels, on a page that has just rendered a real handler's real output.
 */
test('a finished run draws no user, member or org id', async ({ page, request }) => {
  const { name } = await freeCheck(request, FINDINGS_FN);
  await openShelf(page);
  const card = await searchShelf(page, name);
  await card.getByRole('button', { name: 'Run', exact: true }).click();
  await runFromShelf(page, card);
  await expect(card.locator('.sr-done')).toBeVisible({ timeout: 30_000 });

  const text = await screenText(page);

  const uuid = text.match(UUID);
  expect(uuid, `a UUID is on screen after running “${name}”: ${uuid?.[0]}. Names, not ids — ` +
    'the finding renderer drops keys matching /(^|_)(id|ids|uid|uuid|guid)$/, so this ' +
    'arrived under a key it does not recognise.').toBeNull();

  const person = text.match(PERSON_ID);
  expect(person, `an identifier for a person or a team is on screen after running “${name}”: ` +
    `${person?.[0]}. A handler carries \`owner_name\` beside \`owner\` for exactly this; ` +
    'the id column must be dropped and the name drawn.').toBeNull();
});

/* ══ 5 · THE COST IS HONEST ═══════════════════════════════════════════════ */

/**
 * A skill that says 0 spends 0 — checked against the WALLET, not against the
 * number the same page printed. Migration 166 fixed thirteen cards that read
 * "0 credits" and charged 2; the only assertion that would have caught it is
 * the balance before and the balance after.
 */
test('a skill that says it is free spends nothing', async ({ page, request }) => {
  const { name } = await freeCheck(request, FINDINGS_FN);
  const headers = await auth(request);

  const before = await request.get(`${API}/api/v1/hub/org/credits`, { headers });
  expect(before.ok(), `GET /v1/hub/org/credits → ${before.status()}`).toBeTruthy();
  const start = (await before.json()).org_balance?.balance;
  expect(typeof start, 'the wallet did not report a numeric balance, so "it spent nothing" ' +
    'cannot be proved either way').toBe('number');

  await openShelf(page);
  const card = await searchShelf(page, name);
  await card.getByRole('button', { name: 'Run', exact: true }).click();
  const body = await runFromShelf(page, card);

  expect(Number(body.credits_used),
    `“${name}” is listed free and the run reported ${body.credits_used} credits`).toBe(0);
  await expect(card.locator('.sr-done'), `the result line for “${name}” does not say 0 credits`)
    .toContainText('0 credits', { timeout: 30_000 });

  const after = await request.get(`${API}/api/v1/hub/org/credits`, { headers });
  const end = (await after.json()).org_balance?.balance;
  expect(end, `the wallet went ${start} → ${end} across a run the card priced at 0 credits. ` +
    'The screen and the ledger disagree, and the ledger is what the customer pays.')
    .toBe(start);
});

/* ══ 6 · THE CORNER DOCK — the surface the regression was reported on ═════ */

/**
 * The dock is where the owner saw `Result: 2`, so it gets its own run.
 *
 * It is a different renderer from the shelf: `dock/dockItems.js`
 * `summariseOutput` builds at most six lines for a 360px panel, where
 * `components/skills/findings` builds tables. The shelf passing says nothing
 * about the dock — they share no code below `parseSteps`.
 */
test('the dock offers the page its skills, priced and described', async ({ page, request }) => {
  const assigned = await orgSkills(request);
  const here = assigned.filter(s => s.module === 'kartavya');
  expect(here.length, 'this organisation holds no `kartavya` skills, so the dock on ' +
    `${DOCK_PAGE} has nothing to show and this test cannot say whether it would`)
    .toBeGreaterThan(0);

  await page.goto(DOCK_PAGE);
  const pill = page.getByRole('button', { name: /Quick actions/ });
  await expect(pill, 'the corner dock never mounted on ' + DOCK_PAGE).toBeVisible({ timeout: 30_000 });
  await pill.click();

  const panel = page.getByRole('dialog', { name: /Quick actions for/ });
  await expect(panel, 'pressing the dock pill opened no panel').toBeVisible();

  const rows = panel.locator('[data-dockrow]');
  await expect(rows.first(), `the Skills tab of the dock is empty on ${DOCK_PAGE}, which holds ` +
    `${here.length} skills`).toBeVisible({ timeout: 30_000 });

  // EVERY ROW SAYS WHAT IT COSTS AND WHAT IT WILL DO, on the row, before it is
  // opened. `runIntent` derives the second from the capability list, so a
  // `brief` whose step writes reads "CHANGES DATA" rather than "reads only" —
  // a row that says neither is a row somebody presses blind.
  const metas = await panel.locator('.k-dock__rowmeta').allInnerTexts();
  expect(metas.length, 'no dock row carries a meta line').toBeGreaterThan(0);
  for (const m of metas) {
    expect(m, `a dock row reads “${m}” and does not say what a run costs`)
      .toMatch(/\d+ credits?|cost not stated/);
    expect(m, `a dock row reads “${m}” and does not say what a run does`)
      .toMatch(/reads only|drafts, sends nothing|writes new content|CHANGES DATA|effect not checked/);
  }

  // The pill's number is the sum of the four tabs and nothing cleverer — the
  // condition the badge was accepted on is that anyone can add the tabs up and
  // get it. So add them up.
  const tabCounts = await panel.locator('.k-dock__tab-n').allInnerTexts();
  const summed = tabCounts.reduce((a, t) => a + Number(t.trim() || 0), 0);
  const badge = Number((await page.locator('.k-dock__pill-n').innerText()).trim());
  expect(badge, `the pill says ${badge} and its own four tabs add up to ${summed}. A number ` +
    'nobody can check is a number nobody should trust.').toBe(summed);
});

/**
 * AND THE DOCK MUST SHOW THE FINDINGS TOO.
 *
 * This is the exact journey the owner walked: open the dock on the page you
 * are already on, press Run, read what came back. `Result: 2` for two overdue
 * follow-ups is the regression, and a count in place of a list is the same
 * defect whatever the label on it happens to be.
 */
test('the dock shows what the skill found, not how many things it found', async ({ page, request }) => {
  const { name } = await freeCheck(request, FINDINGS_FN);

  await page.goto(DOCK_PAGE);
  const pill = page.getByRole('button', { name: /Quick actions/ });
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  const panel = page.getByRole('dialog', { name: /Quick actions for/ });

  const row = panel.locator('[data-dockrow]', { hasText: name });
  await expect(row, `“${name}” is not on the dock for ${DOCK_PAGE}, though it is a ` +
    '`kartavya` skill and that is what this page maps to').toBeVisible({ timeout: 30_000 });
  await row.click();

  const run = panel.getByRole('button', { name: 'Run now' });
  await expect(run, `the dock offers no Run for “${name}”. If a reason is shown instead, ` +
    'that reason is the finding.').toBeVisible();

  const [res] = await Promise.all([
    page.waitForResponse(r => /\/skills\/[^/]+\/run$/.test(r.url())
      && r.request().method() === 'POST', { timeout: 120_000 }),
    run.click(),
  ]);
  const body = JSON.parse(await res.text());
  const step = finding(body);
  const lists = rowLists(step.data);
  expect(lists.length, `“${name}” returned no rows this time, so the dock has nothing it ` +
    'could have withheld').toBeGreaterThan(0);

  const out = panel.locator('.k-dock__out');
  await expect(out, 'the dock run finished and printed no result block')
    .toBeVisible({ timeout: 30_000 });
  const shown = await out.innerText();

  expect(Number(body.credits_used),
    'the dock ran a skill that charged credits — it posts generate_images:false and only ' +
    'ever offers free rows').toBe(0);

  const top = lists[0].rows[0];
  const what = top.what ?? top.label ?? top.entity?.label ?? top.title ?? top.name;
  expect(shown, `THE REGRESSION IS BACK. The dock ran “${name}”, the server returned ` +
    `${lists[0].rows.length} findings under \`${lists[0].key}\` — the first is “${what}” — ` +
    `and the panel shows:\n\n${shown}\n\n` +
    '`summariseOutput` renders rows only when `data` IS an array. It is not: ' +
    '`skill_dispatcher._run_function_step` wraps a handler that returns a list as ' +
    '`{"result": [...]}`, and every check handler returns a dict of named lists, so the ' +
    'object branch runs instead and `push()` turns each list into its LENGTH. That is ' +
    'literally the "Result: 2" line. The array branch is unreachable against this server.')
    .toContain(String(what));

  // A finding that had to be cut short must say it was cut short, rather than
  // showing six rows as though they were all of them.
  const total = lists[0].rows.length;
  if (total > 6) {
    expect(shown, `the dock shows part of ${total} findings and does not say how many are ` +
      'missing — a silent slice is worse than a count').toMatch(/and \d+ more/);
  }
});
