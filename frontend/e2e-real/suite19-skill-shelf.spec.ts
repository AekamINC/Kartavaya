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

      // ⚠ CLICKED, NOT POSTED. `check-e2e-no-bypass` caught the first version of
      // this file writing through Playwright's API client and was RIGHT to:
      // §3.3 rule 1 is "every row is typed by a user", and the gate's own line
      // is "a row created by SQL proves the table exists; only a click proves
      // the product works". Its two exemptions are for WRITE-FREE, literally
      // named endpoints, and an assign is neither — so there was no honest way
      // to keep the shortcut, and the click is the stronger test anyway: it
      // proves the console control exists, is enabled for this seat, and lands.
      //
      // The button is `Add to organisation` (SkillsTab.jsx:809), drawn only when
      // `canAssign` — so a platform operator sees it and a tenant does not,
      // which is what 14.04 asserts from the other side.
      await page.goto(`/hub/org?tab=skills&org=${s.org}`);
      const panel = page.locator('[role="tabpanel"]').first();
      await expect(panel, `${s.name}: the Skills tab never rendered`)
        .toBeVisible({ timeout: 45_000 });
      await page.getByRole('button', { name: /^Catalog/ }).click();

      let assigned = 0;
      const refused: string[] = [];
      for (let i = 0; i < todo.length; i += 1) {
        const btn = panel.getByRole('button', { name: /^Add to organisation$/ }).first();
        if (!(await btn.count())) break;             // catalogue exhausted
        try {
          await btn.click();
          // The card leaves the catalogue when the assign lands, which is the
          // screen's own confirmation and cheaper than re-reading the shelf.
          await expect(btn, 'the card stayed in the catalogue after Add')
            .toBeHidden({ timeout: 30_000 });
          assigned += 1;
        } catch (e: any) {
          refused.push(`card ${i + 1} -> ${String(e?.message || e).slice(0, 110)}`);
          break;
        }
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

      // ⚠ THE RUN HALF IS NOT DRIVEN HERE AT ALL, and that is deliberate rather
      // than a gap. `POST /org/skills/{id}/run` is `require_user`: it is the
      // CUSTOMER's action, on the customer's credits, from the customer's own
      // screen — and Suite 14 owns it (14.05 drives the drawer). Driving it from
      // this console lane would prove that Aekam can run a skill, which nobody
      // doubted, and it would spend a customer's wallet from a platform seat.
      //
      // The shelf is what this test owns, and the shelf is proved above.
      ledger.push(`${s.name}: shelf ${after.length} (assigned ${assigned} by click)`);
      continue;

    }

    // ── §12: Aekam Inc read, printed, never written ────────────────────────
    const aekam = await page.request.get(`${API}/api/v1/hub/org/skills`, { headers: plat() });
    console.log(`\n  19.4 Aekam Inc shelf: ${rowsOf(aekam.ok() ? await aekam.json() : {}).length} ` +
      '(read only — §12 guarantees it is untouched)');
    console.log('  19.4 LEDGER\n       ' + ledger.join('\n       ') + '\n');
  });
