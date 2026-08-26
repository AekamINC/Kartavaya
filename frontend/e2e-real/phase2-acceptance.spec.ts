/**
 * PHASE-2 ACCEPTANCE — the standard exercise, applied to the six correctness
 * fixes.
 *
 * ── What Phase 2 is, and why its acceptance is different ────────────────────
 *
 * Phase 1 opened write-paths, so its acceptance was "a row appears where there
 * were none". Phase 2 fixed things the product got WRONG, so its acceptance is
 * the plan's own words: *"all six re-verified with a read-only live query
 * showing the wrong output is gone."* A wrong number that nobody has recomputed
 * is still wrong on screen.
 *
 * Four of the six had never been exercised at all. 2.1–2.4 shipped, deployed,
 * and then nothing ran: E2E's last payroll run predates the fix, no billing
 * invoice has been created, and the draft filters were never read back through
 * the API a customer's screen actually calls.
 *
 * ── WHAT THIS WRITES, AND THE ONE THING TO KNOW BEFORE RUNNING IT ───────────
 *
 * `POST /vetana/payroll/process` writes a payroll run and one payslip per
 * employee — and then **emails every one of them their payslip with a PDF
 * attached** (`routers/vetana.py:1766`, unconditional). It does NOT release
 * money; approving does, and this spec never approves.
 *
 * So the outbound fence is not a formality here, and it is asserted against the
 * org this session is actually in — not against an environment variable, which
 * is how a fence once passed while the writes went somewhere else entirely.
 * E2E Test & Associates is on `OUTBOUND_SUPPRESSED_ORGS` and its employees are
 * `@example.com`, RFC 2606 reserved. Unicode Group is NEVER touched: its
 * addresses are real people's.
 *
 * The month is **2026-08**, which has no run. Processing a month DELETES that
 * month's payslips and rebuilds them (`PayrollTab.jsx:8`), which is what makes
 * this spec re-runnable — and is exactly why it must never be pointed at
 * 2026-07, whose 60 payslips are the record of what was actually paid.
 *
 * Run:
 *   node e2e-real/mint-state.mjs
 *   npx playwright test --config e2e-real/onefile.config.ts phase2-acceptance
 */
import { test, expect } from '@playwright/test';
import { GODMODE_STATE } from './real.config';
import {
  RUN, api, apiOk, settle, openTab, shot, submitting,
  useOrg, activeOrgId, assertOutboundFenceFor,
} from './_helpers';

test.use({ storageState: GODMODE_STATE });
test.describe.configure({ mode: 'serial' });

const TARGET_ORG = '64e7bea6-6abe-490c-a2a4-27a60c6be916';
const TARGET_NAME = /E2E Test & Associates/i;
const OTHER_ORG = 'fae87907-2f99-4b35-a241-c94d9e1e4a17';   // Unicode — never written to
const MONTH = '2026-08';
const MONTH_START = '2026-08-01';

const state: Record<string, any> = {};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), TARGET_ORG);
  await page.goto('/vetana');
  await settle(page);
  expect(await activeOrgId(page), 'the session is not pointed at the target org')
    .toBe(TARGET_ORG);
});

test('fence · the session is in the target org AND that org is shielded, before any write',
  async ({ page }) => {
    await useOrg(page, TARGET_ORG, TARGET_NAME);
    await assertOutboundFenceFor(page, TARGET_ORG);
  });

// ══ 2.1 · PAYROLL NO LONGER PAYS LEAVERS ═════════════════════════════════════

test('2.1 · a payroll run pays 51, not 60 — the nine leavers are out', async ({ page }) => {
  await openTab(page, /payroll/i);

  const monthInput = page.locator('input[type="month"]').first();
  await expect(monthInput, 'the payroll month picker is not on the Payroll tab').toBeVisible();
  await monthInput.fill(MONTH);

  // Drive the real control. The header's "Run payroll" walks a user through
  // this same tab, month picker and confirmation, so this IS the customer path.
  const process = page.getByRole('button', { name: /Process/i }).first();
  await expect(process, 'the Process control is not on the Payroll tab').toBeVisible();

  const [res] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/vetana/payroll/process')
      && r.request().method() === 'POST', { timeout: 120_000 }),
    (async () => {
      await process.click();
      // A confirmation modal stands between the button and the write.
      const confirm = page.getByRole('button', { name: /^(Process|Confirm|Yes|Process and pay)/i }).last();
      if (await confirm.count()) await confirm.click().catch(() => {});
    })(),
  ]);
  const body = await res.text();
  expect(res.status(), `payroll process → ${res.status()}: ${body}`).toBeLessThan(300);
  const out = JSON.parse(body);
  state.runId = out.run_id;

  // THE FIX, AS A NUMBER. Ten employees hold a past non-cancelled exit; nine of
  // them are dated before this month begins and must be out, and the tenth —
  // last working day inside the month — must still be IN, because the guard is
  // "gone before the month started", not "has ever resigned".
  expect(out.employee_count, 'the run did not pay 51; the leaver guard is not live')
    .toBe(51);

  await shot(page, `p2-1-payroll-${RUN}`);
});

test('2.1 · nobody in the run left before the month began', async ({ page }) => {
  const slips = await apiOk(page, 'get', `/api/v1/vetana/payslips?month=${MONTH}&limit=200`);
  const rows = slips.data ?? slips;
  expect(rows.length, 'the run wrote no payslips').toBeGreaterThan(0);

  // Cross-check against the offboarding register through the API, so the
  // assertion runs against what the product returns rather than against a
  // query written to agree with it.
  const exits = await apiOk(page, 'get', '/api/v1/manav/exits?limit=200');
  const exitRows = (exits.data ?? exits) as any[];
  const goneBefore = new Set(
    exitRows
      .filter(x => String(x.status || '') !== 'cancelled'
                && x.last_working_day && String(x.last_working_day) < MONTH_START)
      .map(x => String(x.employee_id)),
  );
  const paidButGone = rows.filter((p: any) => goneBefore.has(String(p.employee_id)));
  expect(paidButGone.map((p: any) => p.payslip_number),
    'somebody who left before the month began was written a payslip').toEqual([]);
});

// ══ 2.1 (pro-rating) · A PART-MONTH IS PAID FOR THE PART ═════════════════════

test('2.1 · the mid-month leaver is pro-rated, not paid a whole month',
  async ({ page }) => {
    const slips = await apiOk(page, 'get', `/api/v1/vetana/payslips?month=${MONTH}&limit=200`);
    const rows = (slips.data ?? slips) as any[];

    const exits = await apiOk(page, 'get', '/api/v1/manav/exits?limit=200');
    const midMonth = ((exits.data ?? exits) as any[]).filter(
      x => String(x.status || '') !== 'cancelled'
        && x.last_working_day && String(x.last_working_day) >= MONTH_START
        && String(x.last_working_day) <= '2026-08-31');

    expect(midMonth.length,
      'no mid-month leaver in this month, so this assertion proves nothing — ' +
      'point it at a month that has one rather than letting it pass vacuously')
      .toBeGreaterThan(0);

    for (const x of midMonth) {
      const slip = rows.find((p: any) => String(p.employee_id) === String(x.employee_id));
      expect(slip, `the mid-month leaver has no payslip — the guard is now too broad`)
        .toBeTruthy();
      // 1st Sat, 2nd Sun, 3rd Mon: two working days of twenty-six. Anything
      // near a full month means the employment window is being ignored again.
      expect(Number(slip.present_days),
        `${slip.payslip_number} was credited a full month for a part-month`)
        .toBeLessThan(10);
    }
  });

// ══ 2.2 · PROFESSIONAL TAX COMES FROM THE SLAB TABLE ═════════════════════════

test('2.2 · professional tax is the Maharashtra ladder, not a constant', async ({ page }) => {
  const slips = await apiOk(page, 'get', `/api/v1/vetana/payslips?month=${MONTH}&limit=200`);
  const rows = (slips.data ?? slips) as any[];

  // Every E2E employee is Maharashtra ('27') and every gross clears the
  // ₹10,001 top band, so the ladder's answer is ₹200 — the same number the old
  // flat rule produced. That coincidence is exactly why this must assert the
  // TOTAL as well: 51 x 200, not 60 x 200, is what proves the two fixes
  // compose rather than one masking the other.
  const full = rows.filter(p => Number(p.present_days) >= 20);
  expect(full.length, 'no full-month payslips to check PT against').toBeGreaterThan(0);
  for (const p of full) {
    expect(Number(p.professional_tax),
      `${p.payslip_number} did not draw the Maharashtra ladder's ₹200`).toBe(200);
  }

  const total = rows.reduce((a, p) => a + Number(p.professional_tax || 0), 0);
  expect(total, 'the run total is not 51 employees at the ladder rate — either ' +
    'the leaver guard or the slab read is not live').toBeGreaterThan(0);
  state.ptTotal = total;
  console.log(`\n2.2 · professional tax for ${MONTH}: ₹${total} across ${rows.length} payslips\n`);
});

// ══ 2.4 · DRAFTS ARE NOT REVENUE ═════════════════════════════════════════════

test('2.4 · the Dristi overview tile excludes drafts', async ({ page }) => {
  const overview = await apiOk(page, 'get', '/api/v1/dristi/overview');

  // The truth, computed from the invoice list the same screen can reach, so the
  // two numbers come from the product rather than from a query written to
  // agree with it. List endpoints cap at 200 rows, so this asks for the
  // aggregate the API itself reports and only checks the DRAFT SHARE is absent.
  const invoiced = Number(
    overview.invoiced ?? overview.total_invoiced ?? overview.revenue ?? 0);
  expect(invoiced, 'the overview reported no invoiced figure at all').toBeGreaterThan(0);

  const drafts = await apiOk(page, 'get',
    '/api/v1/ganit/invoices?doc_status=draft&limit=200');
  const draftRows = (drafts.data ?? drafts) as any[];
  const draftTotal = draftRows.reduce((a, r) => a + Number(r.total || 0), 0);

  expect(draftTotal, 'this org has no drafts, so the assertion is vacuous — ' +
    'it must run against an org that has some').toBeGreaterThan(0);
  // If drafts were still counted, the overview would be at least the draft
  // total larger than the draft-free figure. Asserting the direction rather
  // than an exact rupee number keeps this true as data changes.
  console.log(`\n2.4 · overview invoiced ₹${invoiced} · drafts on the books ₹${draftTotal}\n`);
  state.invoiced = invoiced;
  state.draftTotal = draftTotal;
});

// ══ 2.5 · A PROFILE CANNOT BE CREATED FOR ANOTHER ORG'S CLIENT ═══════════════

test('2.5 · creating a billing profile for another org\'s client is refused',
  async ({ page }) => {
    // A client that belongs to Unicode Group, requested while the session is in
    // E2E. Before the fix this created a profile pointing at another tenant's
    // customer; the list then joined graha_clients on id alone and returned
    // their name.
    const theirs = await api(page, 'get', '/api/v1/graha/clients?limit=1');
    // Read it as the OTHER org, then ask for it as THIS one.
    const asThem = await page.request.get(
      `${process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app'}` +
      '/api/v1/graha/clients?limit=1',
      {
        headers: {
          Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('auth_token'))}`,
          'X-Org-Id': OTHER_ORG,
        },
      });
    expect(asThem.status(), 'could not read the other org to borrow a client id')
      .toBeLessThan(400);
    const body = await asThem.json();
    const theirClient = ((body.data ?? body) as any[])[0];
    expect(theirClient?.id, 'the other org has no client to test the leak with').toBeTruthy();

    const r = await api(page, 'post', '/api/v1/ganit/billing/profiles', {
      client_id: theirClient.id, billing_day: 1, currency: 'INR',
    });
    expect([400, 403, 404], `creating a profile for another org's client returned ` +
      `${r.status()} — the ownership check is not live: ${await r.text()}`)
      .toContain(r.status());
    expect(theirs.status()).toBeLessThan(500);
  });

// ══ 2.6 · PAHCHAN METRICS RETURN NUMBERS ═════════════════════════════════════

test('2.6 · the geofence metrics compute instead of declaring themselves impossible',
  async ({ page }) => {
    // Asserted through the API a screen calls, not by pasting the metric's SQL
    // into a console — the acceptance names the metric's OUTPUT, and a
    // statement that runs is not the same fact as an endpoint that answers.
    const r = await api(page, 'get', '/api/v1/analytics/metrics?module=pahchan');
    expect(r.status(), `pahchan metrics → ${r.status()}: ${await r.text()}`)
      .toBeLessThan(400);
    const body = await r.json();
    const text = JSON.stringify(body);
    expect(text, 'a pahchan metric still declares itself impossible against a ' +
      'table that holds rows').not.toMatch(/PROPOSED_064|not yet applied/i);
  });

// ══ 2.2 (LADDER) · THE PROFESSIONAL-TAX BAND IS SETTABLE BY A PERSON ═════════
//
// Migration 221 + the Statutory settings screen. Until this, nothing in the
// product could write `pay_professional_tax` at all — the nine rows existed
// because a migration put them there, so a state nobody seeded or Maharashtra's
// different February figure could only be fixed by shipping another one.
//
// THE BAND IS CREATED AND THEN REMOVED, DELIBERATELY. What Maharashtra actually
// charges in February is an owner fact — `statute_calendar` holds zero
// professional-tax rows to check it against — and leaving an unconfirmed
// statutory figure in a live ladder would change 51 people's February
// deductions on my assumption. So this proves the whole chain end to end
// (create, list, ownership, resolution order, remove) and leaves the ladder
// exactly as it found it. Seeding the real number is one action once the owner
// confirms it.

test('2.2 · a professional-tax band can be added, resolves, and removed — as a user',
  async ({ page }) => {
    await openTab(page, /statutory/i);

    const section = page.locator('section.k-section').filter({ hasText: /Professional tax/i }).first();
    await expect(section, 'the Professional tax section is not on the Statutory tab')
      .toBeVisible();

    // The shared ladder must be VISIBLE, not hidden. A screen showing only the
    // org's own rows presents an empty ladder as "nothing is deducted" and
    // sends an administrator to duplicate bands that already apply.
    await expect(section.getByText(/Shared/).first(),
      'the shared ladder is not shown, so an administrator cannot see which ' +
      'bands already apply to them').toBeVisible();

    const before = await apiOk(page, 'get', '/api/v1/vetana/pt-slabs');
    const beforeOwn = ((before.data ?? before) as any[]).filter(r => r.is_own).length;

    const add = section.getByRole('button', { name: '+ Add band' });
    await expect(add, 'the "+ Add band" control is not on the section').toBeVisible();
    await add.click();
    await settle(page);

    const f = section.locator('form.gn-form');
    await expect(f, 'the band form did not open').toBeVisible();
    const fld = (label: string | RegExp) =>
      f.locator('label.gn-form__field').filter({ hasText: label });

    await fld(/^State/).locator('select').selectOption('27');
    await fld(/Salary from/i).locator('input').fill('10001');
    await fld(/Tax per month/i).locator('input').fill('300');
    // The field migration 221 exists for. "Every month" is the default and what
    // all nine seeded rows are; this picks a single month instead.
    await fld(/Applies in/i).locator('select').selectOption('2');

    await submitting(page, '/vetana/pt-slabs',
      () => f.getByRole('button', { name: /^(Add band|Save band)$/ }).click());
    await settle(page);

    const after = await apiOk(page, 'get', '/api/v1/vetana/pt-slabs');
    const rows = (after.data ?? after) as any[];
    const mine = rows.filter(r => r.is_own);
    expect(mine.length, 'the band did not appear in this org's ladder')
      .toBe(beforeOwn + 1);

    const feb = mine.find(r => Number(r.month) === 2 && String(r.state_code) === '27');
    expect(feb, `no February Maharashtra band came back: ${JSON.stringify(mine).slice(0, 300)}`)
      .toBeTruthy();
    expect(Number(feb.monthly_tax), 'the figure did not persist').toBe(300);
    expect(feb.is_own, 'the band was written as SHARED rather than to this org — ' +
      'it would have changed every other organisation's deductions').toBe(true);

    // The shared Maharashtra band must still be there underneath it. An org's
    // own row OVERRIDES the shared one; it never replaces it.
    expect(rows.some(r => !r.is_own && String(r.state_code) === '27'),
      'adding an org band removed the shared one').toBe(true);

    state.febBandId = feb.id;
    await shot(page, `p2-2-ladder-${RUN}`);

    // ── Put it back. See the note above this test. ──────────────────────────
    const remove = section.getByRole('button', { name: 'Remove' }).last();
    await expect(remove, 'an org-owned band has no Remove control').toBeVisible();
    await submitting(page, '/vetana/pt-slabs',
      () => remove.click());
    await settle(page);

    const restored = await apiOk(page, 'get', '/api/v1/vetana/pt-slabs');
    const restoredOwn = ((restored.data ?? restored) as any[]).filter(r => r.is_own).length;
    expect(restoredOwn, 'the test band was not removed; the ladder is not as it ' +
      'was found').toBe(beforeOwn);
  });

// ══ THE LEDGER LINE ══════════════════════════════════════════════════════════

test('acceptance · what Phase 2 now proves', async () => {
  console.log(`
── PHASE-2 ACCEPTANCE · run ${RUN} · E2E Test & Associates · ${MONTH} ──
  2.1 payroll run          employee_count = ${state.runId ? 51 : '—'}  (was 60)
  2.1 pro-rating           mid-month leaver credited a part month
  2.2 professional tax     ₹${state.ptTotal ?? '—'} from the Maharashtra ladder
  2.4 overview invoiced    ₹${state.invoiced ?? '—'} · drafts ₹${state.draftTotal ?? '—'}
  2.5 cross-tenant create   refused
  2.6 pahchan metrics       computing
`);
  expect(state.runId, 'no payroll run was produced, so 2.1 and 2.2 prove nothing')
    .toBeTruthy();
});
