/**
 * Suite 19.4 — THE ORG SKILL SHELF: AEKAM ASSIGNS, THE ORG RUNS.
 *
 * ── Why this file exists ──────────────────────────────────────────────────────
 *
 * Measured live 2026-08-31, before this ran:
 *
 *     hub_skill_templates          78
 *     hub_org_skills               78   ALL of them on Aekam Inc, 0 on Unicode
 *     hub_skill_runs                1   in the product's entire lifetime
 *
 * Suite 14.00 names the consequence in its own failure text: "NOTHING IS ON THIS
 * ORGANISATION'S SKILL SHELF, AND A CUSTOMER CANNOT PUT IT THERE… the chain that
 * follows: no assignment → no run → no finding → no acknowledgement." That chain
 * blocked §4's `skill runs 24 · findings acknowledged 12`, and it is why nine of
 * Suite 14's tests could not be answered.
 *
 * ── The two halves, and why they need different seats ────────────────────────
 *
 * ASSIGN — `POST /v1/hub/org/skills/{template_id}` is
 * `require_platform_role(*OPERATIONS_CONSOLE_ROLES)` AND takes `get_org_id`
 * (backend/routers/hub.py:3080), so the write is an Aekam operator acting INSIDE
 * the subject org. A console action, which is why it is in Suite 19 — the one
 * suite 93 permits a platform credential.
 *
 * RUN — `POST /v1/hub/org/skills/{skill_id}/run` is `require_user`
 * (hub.py:3208). Once the shelf is stocked the CUSTOMER runs its own skills, on
 * its own credits. So the run half here uses each org's OWN token, never the
 * platform one: running from a platform seat would prove that Aekam can run a
 * skill, which nobody doubted.
 *
 * ── Scope: the whole catalogue, on both working orgs ─────────────────────────
 *
 * Owner instruction 2026-08-31: "assign all skill to uk aekam and unicode and
 * run all skills". So this assigns EVERY active template to both, and then runs
 * every assigned skill from the org's own seat.
 *
 * ⚠ CREDITS ARE REAL AND FINITE, AND A RUN SPENDS THEM. `execute_org_skill`
 * charges the org wallet. Unicode Group held 982 and UK AekamINC 2000 when this
 * was written. If the wallet empties mid-way the remaining runs are REFUSED with
 * 402, and that is reported as a number rather than swallowed — a partial sweep
 * that reads as a full one is the failure this programme exists to stop.
 *
 * ⚠ AEKAM INC IS NEVER A SUBJECT. §12. Its shelf is read at the end and printed,
 * never written, and every write here names its org explicitly via `X-Org-Id`
 * because a platform session resolves to Aekam by default.
 */
import { test, expect, type Page } from '@playwright/test';

const API = process.env.E2E_API_URL || 'https://api.kartavaya.com';
const GODMODE = process.env.E2E_GODMODE_TOKEN;

/** The orgs this stocks, each with the token IT will run under. */
const SUBJECTS = [
  { name: 'Unicode Group', org: process.env.E2E_UNICODE_ORG_ID, token: process.env.E2E_UNICODE_TOKEN },
  { name: 'UK AekamINC',   org: process.env.E2E_UK_ORG_ID,      token: process.env.E2E_UKAEKAM_OWNER_TOKEN
                                                                     || process.env.E2E_UKAEKAM_TOKEN },
];

const plat = (org?: string) => ({
  Authorization: `Bearer ${GODMODE}`,
  ...(org ? { 'X-Org-Id': org } : {}),
  'Content-Type': 'application/json',
});

/**
 * POST, backing off when the product says slow down.
 *
 * ⚠ 429 IS THE RATE LIMITER WORKING, NOT A DEFECT. This spec fires 152 writes
 * in a row — 78 templates on to one org and 74 on to another — and on the first
 * execution four of UK AekamINC's assignments came back
 * `429 {"detail":"Too many requests"}`. Nothing was wrong with them: they were
 * simply the tail of a burst no human produces.
 *
 * Reporting that as "the console could not assign these skills" would have been
 * a false red against a control this codebase deliberately puts on anything
 * auth- or write-shaped. So the burst is paced instead, and a 429 is retried
 * with a widening gap rather than counted as a refusal.
 *
 * It is NOT retried forever, and it is NOT silent: after `tries` attempts the
 * status is returned and the caller records it, because a limiter that never
 * lets a legitimate write through IS worth failing on.
 */
async function postWithBackoff(
  page: Page, url: string, headers: Record<string, string>, data: any,
  tries = 4, timeout = 20_000,
) {
  let r = await page.request.post(url, { headers, data, timeout });
  for (let i = 0; i < tries && r.status() === 429; i += 1) {
    await page.waitForTimeout(1500 * (i + 1));
    r = await page.request.post(url, { headers, data, timeout });
  }
  return r;
}

/** Rows out of whatever envelope this endpoint chose. */
function rowsOf(body: any): any[] {
  const r = body?.items ?? body?.data?.items ?? body?.data ?? body;
  return Array.isArray(r) ? r : [];
}

async function shelfOf(page: Page, org: string): Promise<any[]> {
  const r = await page.request.get(`${API}/api/v1/hub/org/skills`, { headers: plat(org) });
  expect(r.ok(), `GET /v1/hub/org/skills -> ${r.status()}: ${(await r.text()).slice(0, 200)}`)
    .toBeTruthy();
  return rowsOf(await r.json());
}

test('19.4 every skill is assigned to both orgs from the console, and each org runs its own',
  async ({ page }) => {
    test.setTimeout(45 * 60_000);
    expect(GODMODE,
      'BLOCKED — E2E_GODMODE_TOKEN is not set. Suite 19 is the ONE suite that uses ' +
      'a platform credential; every other suite is org-scoped by rule.').toBeTruthy();

    await page.goto('/login');
    await page.evaluate((t) => localStorage.setItem('auth_token', t!), GODMODE);

    // ── THE CATALOGUE, read once ───────────────────────────────────────────
    const cat = await page.request.get(`${API}/api/v1/hub/skills/templates`, { headers: plat() });
    expect(cat.ok(), `GET /v1/hub/skills/templates -> ${cat.status()}`).toBeTruthy();
    const templates = rowsOf(await cat.json()).filter((t: any) => t.is_active !== false);
    expect(templates.length,
      'the skill catalogue is empty, so there is nothing to assign and this test ' +
      'could report a green sweep over nothing').toBeGreaterThan(0);
    console.log(`\n  19.4 catalogue: ${templates.length} active template(s)\n`);

    const ledger: string[] = [];

    for (const s of SUBJECTS) {
      expect(s.org, `BLOCKED — no org id for ${s.name}; a console write must NAME ` +
        'its subject, because a platform session resolves to Aekam Inc by default.')
        .toBeTruthy();

      // ── ASSIGN, from the console, naming the org on every call ───────────
      //
      // ⚠ IDEMPOTENT BY READING. The shelf is read first and templates already
      // present are skipped, so a second execution reports "0 assigned, N
      // already present" rather than stacking duplicates — §7.3's requirement.
      const before = await shelfOf(page, s.org!);
      const have = new Set(before.map((r: any) => String(r.template_id ?? r.id)));
      const todo = templates.filter((t: any) => !have.has(String(t.id)));

      let assigned = 0;
      const refused: string[] = [];
      for (const t of todo) {
        const r = await postWithBackoff(page, `${API}/api/v1/hub/org/skills/${t.id}`,
          plat(s.org!), { custom_config: {} });
        if (r.ok()) { assigned += 1; continue; }
        refused.push(`${String(t.name ?? t.id).slice(0, 46)} -> ${r.status()} ` +
          `${(await r.text()).slice(0, 110)}`);
      }

      const after = await shelfOf(page, s.org!);
      console.log(`  19.4 ${s.name}: shelf ${before.length} -> ${after.length} ` +
        `(assigned ${assigned}, already present ${before.length}` +
        (refused.length ? `, REFUSED ${refused.length}` : '') + ')');
      if (refused.length) console.log('       ' + refused.join('\n       '));

      expect(refused,
        `the console could not assign these skill(s) to ${s.name}. This route is ` +
        'the ONLY way an org shelf is stocked, so a refusal here is what leaves ' +
        '14.00 blocked:\n     ' + refused.join('\n     ')).toEqual([]);
      expect(after.length,
        `${s.name}'s shelf holds ${after.length} after assigning ${assigned}. A 2xx ` +
        'that leaves no row is the silent-success class this programme exists to ' +
        'catch — read the response, then read the canonical row.')
        .toBeGreaterThanOrEqual(templates.length);

      // ── RUN, from the ORG'S OWN SEAT ────────────────────────────────────
      if (!s.token) {
        ledger.push(`${s.name}: shelf ${after.length}, runs NOT ATTEMPTED (no org token)`);
        console.log(`  19.4 ${s.name}: no org token, so the RUN half is not attempted. ` +
          'Reported, not skipped — the shelf is proved, the run is not.');
        continue;
      }
      const orgHdr = { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' };

      let ok = 0, noCredit = 0;
      const failed: string[] = [];
      for (const row of after) {
        const id = String(row.id ?? row.skill_id);
        // ⚠ A RUN CALLS A MODEL, SO IT IS NOT A 20-SECOND REQUEST. The first
        // sweep timed out on UK AekamINC at Playwright's 20s default after
        // Unicode Group had already completed 59 runs — the difference was the
        // template that happened to come first, not the org. A timeout here
        // reads as "the run path is broken" when it means "the model took
        // longer than an assignment does".
        const r = await postWithBackoff(page, `${API}/api/v1/hub/org/skills/${id}/run`,
          orgHdr, {}, 4, 180_000);
        if (r.ok()) { ok += 1; continue; }
        if (r.status() === 402) { noCredit += 1; continue; }
        failed.push(`${String(row.name ?? id).slice(0, 40)} -> ${r.status()} ` +
          `${(await r.text()).slice(0, 110)}`);
      }

      // ⚠ 402 IS NOT A DEFECT AND IS NOT A PASS. An empty wallet is the product
      // refusing correctly; it is counted and printed so a half-finished sweep
      // can never read as a complete one.
      console.log(`  19.4 ${s.name}: ran ${ok}, refused for credit ${noCredit}, ` +
        `errored ${failed.length}`);
      if (failed.length) console.log('       ' + failed.slice(0, 8).join('\n       '));
      ledger.push(`${s.name}: shelf ${after.length}, ran ${ok}, out-of-credit ` +
        `${noCredit}, errored ${failed.length}`);

      expect(failed.length,
        `${s.name}: ${failed.length} skill run(s) failed for a reason that is NOT ` +
        'an empty wallet:\n     ' + failed.slice(0, 10).join('\n     ')).toBe(0);
      expect(ok + noCredit,
        `${s.name} ran nothing at all — neither a success nor an honest 402. The ` +
        'shelf is stocked, so this is the run path, not the assignment.')
        .toBeGreaterThan(0);
    }

    // ── §12: Aekam Inc read, printed, never written ────────────────────────
    const aekam = await page.request.get(`${API}/api/v1/hub/org/skills`, { headers: plat() });
    console.log(`\n  19.4 Aekam Inc shelf: ${rowsOf(aekam.ok() ? await aekam.json() : {}).length} ` +
      '(read only — §12 guarantees it is untouched)');
    console.log('  19.4 LEDGER\n       ' + ledger.join('\n       ') + '\n');
  });
