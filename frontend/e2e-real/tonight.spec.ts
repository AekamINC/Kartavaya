/**
 * Everything built on 20–21 August, driven against the DEPLOYED staging app.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The owner asked for e2e on the night's work and the honest answer was that
 * there was none: unit tests pinned the source, and nothing had ever driven
 * the real service. A ratchet that reads a file cannot tell you the endpoint
 * is registered, the migration landed, the grant exists, or the JSON a screen
 * consumes has the key it reads.
 *
 * READ-ONLY, AND THAT IS A DESIGN CONSTRAINT NOT A CONVENIENCE.
 * `staging` and production share ONE Supabase database and `outbound_mode` is
 * `live`. So every request below is a GET or a run of a handler already proved
 * to touch nothing — no POST that creates a record, no campaign send, no
 * skill in WRITE_SKILL_FUNCTIONS. The one write-shaped call is a REFUSAL that
 * must 4xx, which leaves no row behind by definition.
 *
 * Auth comes from `e2e-real/mint-state.mjs` (token-minted storage state), not
 * from `auth.setup.ts` — the owner account signs in with Google and has no
 * password to type into the form.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { OWNER_STATE } from './real.config';

test.use({ storageState: OWNER_STATE });

const API = process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app';
const ORG = process.env.E2E_ORG_ID!;

/** The bearer the app itself sends. Read from the same storage state the UI
 *  restores, so a token that stops working fails these tests for the same
 *  reason it would fail a person. */
async function auth(request: APIRequestContext) {
  const fs = await import('fs');
  const state = JSON.parse(fs.readFileSync(OWNER_STATE, 'utf8'));
  const token = state.origins?.[0]?.localStorage
    ?.find((e: any) => e.name === 'auth_token')?.value;
  expect(token, 'no auth_token in the minted state — run mint-state.mjs').toBeTruthy();
  // No `X-Org-Id`. The header is a CROSS-ORG override and the server refuses
  // it for a caller who is not a member of the named org — "You do not belong
  // to this organisation". Letting the token resolve its own active org is
  // both what the browser does and what these assertions are about.
  return { Authorization: `Bearer ${token}` };
}

// ── Skills: assigned, described, and returning findings ─────────────────────

test('every active skill is assigned to this org', async ({ request }) => {
  const r = await request.get(`${API}/api/v1/hub/org/skills`, { headers: await auth(request) });
  expect(r.ok(), await r.text()).toBeTruthy();
  const body = await r.json();
  const items = body.data ?? body;
  // 78 live templates. The whole shelf, not the 0 this org had before.
  expect(items.length).toBeGreaterThan(50);
});

test('the assigned list carries the taxonomy the shelf is grouped by', async ({ request }) => {
  const r = await request.get(`${API}/api/v1/hub/org/skills`, { headers: await auth(request) });
  const items = (await r.json()).data ?? [];
  const one = items[0];
  // `module` and `skill_type` were built by migration 166 and this endpoint —
  // the one a customer reads — returned neither, so 61 cards rendered flat.
  expect(one, JSON.stringify(one)).toHaveProperty('module');
  expect(one).toHaveProperty('skill_type');
  // And `description`, which every card read and was always undefined, so each
  // silently printed a step count where its description belonged.
  expect(one).toHaveProperty('description');
});

test('a check skill RETURNS ITS FINDINGS, not just a count', async ({ request }) => {
  const headers = await auth(request);
  const list = await request.get(`${API}/api/v1/hub/org/skills`, { headers });
  const items = (await list.json()).data ?? [];

  // A free, read-only check with no runtime parameters. Free matters: this
  // must not spend a real wallet. Read-only matters more.
  const skill = items.find((s: any) =>
    s.skill_type === 'check' && Number(s.estimated_credits) === 0);
  expect(skill, 'no free check skill is assigned').toBeTruthy();

  const run = await request.post(
    `${API}/api/v1/hub/org/skills/${skill.id}/run`,
    { headers, data: { generate_images: false }, timeout: 120_000 });
  expect(run.ok(), await run.text()).toBeTruthy();
  const body = await run.json();

  // THE DEFECT THIS PINS. `outputs` used to carry {step, skill_function,
  // status, credits_used} and nothing else — the handler's actual return went
  // into a variable used to ground a later model step's prompt and was then
  // garbage-collected. A run that listed a firm's whole overdue book reported
  // "0 items are waiting in the Content tab".
  expect(body).toHaveProperty('outputs');
  const dataStep = (body.outputs ?? []).find((o: any) => o.skill_function);
  expect(dataStep, JSON.stringify(body.outputs)).toBeTruthy();
  expect(dataStep).toHaveProperty('label');
  expect(dataStep).toHaveProperty('truncated');
  expect(Object.keys(dataStep)).toContain('data');
  expect(Number(body.credits_used)).toBe(0);
});

// ── Reports: the spine is plugged in at both ends ───────────────────────────

test('the section catalogue is reachable', async ({ request }) => {
  const r = await request.get(`${API}/api/v1/analytics/report-sections`,
    { headers: await auth(request) });
  expect(r.ok(), await r.text()).toBeTruthy();
  const body = await r.json();
  const keys = (body.data ?? body.sections ?? []).map((s: any) => s.key);
  // Five registers landed tonight plus receivables ageing, which existed and
  // was unreachable by any route.
  expect(keys).toContain('ganit.sales_register');
  expect(keys.length).toBeGreaterThanOrEqual(5);
});

// ── Statute: 45 rows of law that no router served ──────────────────────────

test('statute is served, and the answer is dated', async ({ request }) => {
  const headers = await auth(request);
  const r = await request.get(
    `${API}/api/v1/statute/obligations?as_of=2026-08-20`, { headers });
  expect(r.ok(), await r.text()).toBeTruthy();
  const body = await r.json();
  expect(body.as_of).toBe('2026-08-20');
  expect(body.count).toBeGreaterThan(0);
});

test('a different as_of returns different law', async ({ request }) => {
  const headers = await auth(request);
  const [before, after] = await Promise.all([
    request.get(`${API}/api/v1/statute/obligations?as_of=2026-03-01`, { headers }),
    request.get(`${API}/api/v1/statute/obligations?as_of=2026-08-20`, { headers }),
  ]);
  const a = await before.json(), b = await after.json();
  // Six TDS/TCS form numbers change on 2026-04-01. If these matched, `as_of`
  // would be decorative and every form number the product prints a coin flip.
  expect(a.count).not.toBe(b.count);
});

test('a malformed date is refused rather than read as today', async ({ request }) => {
  const r = await request.get(`${API}/api/v1/statute/obligations?as_of=31-03-2026`,
    { headers: await auth(request) });
  expect(r.status()).toBe(422);
});

// ── Privacy: Aekam cannot see a customer's contact details ─────────────────

test('the Aekam-side outbound log returns a domain, never an address', async ({ request }) => {
  const headers = await auth(request);
  const r = await request.get(
    `${API}/api/v1/billing/orgs/${ORG}/outbound/messages?limit=5`, { headers });
  // 403 is a pass: it means this account holds no finance-console role, and
  // the surface is closed to it. What must never happen is a 200 with an
  // address in it.
  if (r.status() === 403) return;
  expect(r.ok(), await r.text()).toBeTruthy();
  const rows = (await r.json()).data ?? [];
  for (const row of rows) {
    expect(row).not.toHaveProperty('recipient');
    if (row.target) expect(String(row.target)).not.toContain('@');
  }
});

test('searching the Aekam-side log BY ADDRESS is refused', async ({ request }) => {
  const r = await request.get(
    `${API}/api/v1/billing/orgs/${ORG}/outbound/messages?recipient=a@b.com`,
    { headers: await auth(request) });
  // 400 (refused by name) or 403 (no console role). Never 200.
  expect([400, 403]).toContain(r.status());
});

// ── Prachar: the one-click unsubscribe the header promises ─────────────────

test('the RFC 8058 POST route exists, so the header is not a lie', async ({ request }) => {
  // No token: the route must REFUSE it, which proves it is routed rather than
  // 405-ing. A 405 would mean Gmail's Unsubscribe button posts into nothing.
  const r = await request.post(`${API}/api/v1/prachar/unsubscribe?token=`, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: 'List-Unsubscribe=One-Click',
  });
  expect(r.status(), 'a 405 means the List-Unsubscribe header promises a route that does not exist')
    .not.toBe(405);
  expect(r.status()).toBe(400);
});

// ── Approvals: the badge counts what the queue lists ───────────────────────

test('the approvals badge and the queue agree', async ({ request }) => {
  const headers = await auth(request);
  const [poll, pending] = await Promise.all([
    request.get(`${API}/api/notifications/poll`, { headers }),
    request.get(`${API}/api/approvals/pending`, { headers }),
  ]);
  expect(poll.ok(), await poll.text()).toBeTruthy();
  expect(pending.ok(), await pending.text()).toBeTruthy();
  const badge = (await poll.json()).approvals;
  const queue = (await pending.json()).length;
  // The reported bug: the sidebar said 3 and the page listed nothing. They read
  // different tables under different membership rules.
  expect(badge).toBe(queue);
});
