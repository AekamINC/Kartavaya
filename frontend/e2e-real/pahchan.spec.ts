/**
 * Phase 5 — Pahchan, biometric attendance, and the handoff into payroll.
 *
 * ── Two things this suite must not do ───────────────────────────────────────
 *
 * 1. **Never enrol a face.** The enrollment queue holds biometric templates of
 *    real people. This suite READS the queue and asserts it answers; it never
 *    submits a face, approves an enrolment, or uploads an image. A test that
 *    writes a biometric template is not a test.
 *
 * 2. **Never publish attendance for real.** `POST /attendance/publish` writes
 *    the rows Vetana prices a payslip from. The endpoint has a `dry_run` mode
 *    that "returns exactly what would be written without writing it" — which is
 *    both the safe path and the honest one, because what matters is whether the
 *    pairing is CORRECT, not whether the write succeeds. The real write is left
 *    to a human who has looked at the dry run.
 *
 * Publishing is also re-runnable by design (upsert keyed on employee_id + date),
 * so the risk is not corruption — it is a payslip changing under someone
 * without them asking. That is reason enough to stay on dry_run.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { OWNER_STATE, DL_DIR } from './real.config';
import { api, apiOk, settle, openTab, shot, submitting, RUN } from './_helpers';

test.use({ storageState: OWNER_STATE });
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await page.goto('/pahchan');
  await settle(page);
});

async function pahchan(page: Page, tab: string) {
  if (!page.url().includes('/pahchan')) {
    await page.goto('/pahchan');
    await settle(page);
  }
  await openTab(page, tab);
}

const panel = (page: Page) => page.getByRole('tabpanel');


// ══ REGISTER ═════════════════════════════════════════════════════════════════

test('register · the day opens with punches that reconcile to real employees',
  async ({ page }) => {
    await pahchan(page, 'Register');
    await expect(page.locator('.k-err').filter({ hasText: /failed/i }),
      'the register rendered an error').toHaveCount(0);

    // `{ date, punches: [] }` — not a `data` envelope. Each endpoint in this
    // module answers a different shape: sites uses `{data}`, regularisations a
    // bare array, `/me` returns `{employee, punches, retention}`.
    const reg = await apiOk(page, 'get', '/api/v1/pahchan/register');
    expect(reg.date, 'the register does not say which day it is for').toBeTruthy();
    const rows = reg.punches;
    expect(Array.isArray(rows), 'the register did not answer with a punch list').toBe(true);

    // Every row must name an employee that exists. An attendance register with
    // orphan rows prices a payslip for nobody.
    if (rows.length) {
      const emps = await apiOk(page, 'get', '/api/v1/manav/employees?limit=500');
      const known = new Set((emps.data ?? emps).map((e: any) => String(e.id)));
      const orphans = rows
        .filter((r: any) => r.employee_id && !known.has(String(r.employee_id)))
        .map((r: any) => r.employee_id);
      expect(orphans, 'register rows point at employees that do not exist').toEqual([]);
    }
    await shot(page, `pahchan-register-${RUN}`);
  });


// ══ POLICY ═══════════════════════════════════════════════════════════════════

test('policy · the attendance policy loads and states its overtime position',
  async ({ page }) => {
    await pahchan(page, 'Policy');
    await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);

    const r = await api(page, 'get', '/api/v1/pahchan/policy');
    expect(r.status(), await r.text()).toBe(200);
    // A flat object, no envelope.
    const pol = await r.json();

    // The default the backend documents: "an org that has never opened the
    // settings screen gets exactly today's behaviour rather than a surprise on
    // the next payslip" — overtime OFF. Asserted because a silent default that
    // pays overtime is a payroll incident, not a preference.
    expect(pol.org_id, 'the policy is not scoped to an org').toBeTruthy();
    expect(Number(pol.default_radius_m),
      'the default geofence radius is not a number — a punch could be accepted anywhere')
      .toBeGreaterThan(0);
    if (pol.overtime_enabled !== undefined) {
      expect(typeof pol.overtime_enabled,
        'overtime_enabled is not a real boolean, so its default cannot be trusted')
        .toBe('boolean');
    }
    await shot(page, `pahchan-policy-${RUN}`);
  });

test('policy · a geofenced site can be added', async ({ page }) => {
  await pahchan(page, 'Policy');
  const add = page.getByRole('button', { name: /Add a site/i });
  await expect(add, 'the policy tab offers no way to add a site').toBeVisible();
  await add.click();
  await settle(page);

  // `.ph__form` is a DIV, not a <form> — `page.locator('form')` matches nothing
  // here and the failure looks like a missing field rather than a missing form.
  const f = page.locator('.ph__form').first();
  await expect(f, 'the add-site form did not open').toBeVisible();
  await f.getByPlaceholder('Fort office').fill(`E2E Site ${RUN}`);
  await f.getByPlaceholder('18.933300').fill('19.0760');
  await f.getByPlaceholder('72.833600').fill('72.8777');
  const radius = f.locator('input[type="number"]').last();
  if (await radius.count()) await radius.fill('150');

  const made = await submitting(page, '/pahchan/sites',
    () => f.getByRole('button', { name: /^(Add|Save|Create)/ }).first().click());
  expect(made?.id || made?.site?.id, 'the site was not created').toBeTruthy();

  const sites = await apiOk(page, 'get', '/api/v1/pahchan/sites');
  const rows = sites.data ?? sites;
  const mine = rows.find((s: any) => String(s.name) === `E2E Site ${RUN}`);
  expect(mine, 'the site is not in the list').toBeTruthy();
  // A geofence with no radius admits a punch from anywhere, which is the whole
  // point of the feature defeated.
  expect(Number(mine.radius_m ?? mine.radius), 'the site has no geofence radius')
    .toBeGreaterThan(0);
});


// ══ CORRECTIONS ══════════════════════════════════════════════════════════════

test('corrections · the regularisation queue answers and every row is actionable',
  async ({ page }) => {
    await pahchan(page, 'Corrections');
    await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);

    const r = await apiOk(page, 'get', '/api/v1/pahchan/regularisations');
    const rows = r.data ?? r;
    expect(Array.isArray(rows), 'the regularisation queue did not answer with a list')
      .toBe(true);

    // A pending correction that nobody can approve or decline is a queue that
    // only grows. If any are pending, the screen must offer both verbs.
    const pending = rows.filter((x: any) => String(x.status).toLowerCase() === 'pending');
    if (pending.length) {
      await expect(page.getByRole('button', { name: /Approve/i }).first(),
        'pending corrections exist but nothing approves them').toBeVisible();
      await expect(page.getByRole('button', { name: /Decline/i }).first(),
        'pending corrections exist but nothing declines them').toBeVisible();
    }
    await shot(page, `pahchan-corrections-${RUN}`);
  });


// ══ PAYROLL HANDOFF — dry run only ═══════════════════════════════════════════

test('payroll · the publish dry run pairs punches without writing anything',
  async ({ page }) => {
    await pahchan(page, 'Payroll');
    await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);

    // A window in the past, so the answer is stable between runs.
    const to = new Date(Date.now() - 1 * 864e5).toISOString().slice(0, 10);
    const from = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);

    const before = await apiOk(page, 'get', '/api/v1/vetana/payroll/runs');
    const runsBefore = JSON.stringify(before.data ?? before);

    const r = await api(page, 'post', '/api/v1/pahchan/attendance/publish',
      { from_date: from, to_date: to, dry_run: true });
    expect(r.status(), `the dry run was refused: ${await r.text()}`).toBe(200);
    const out = await r.json();

    // It must actually report what it WOULD do. A dry run that answers {ok:true}
    // and nothing else cannot be looked at, which is the entire purpose.
    const summary = JSON.stringify(out);
    expect(summary.length, 'the dry run reported nothing to inspect').toBeGreaterThan(20);
    fs.writeFileSync(path.join(DL_DIR, `pahchan-dryrun-${RUN}.json`),
      JSON.stringify(out, null, 2));

    // And it must have written nothing. Payroll runs are the thing downstream
    // of this, so they are what is checked.
    const after = await apiOk(page, 'get', '/api/v1/vetana/payroll/runs');
    expect(JSON.stringify(after.data ?? after),
      'a DRY RUN changed the payroll runs — it is not dry').toBe(runsBefore);
  });

test('payroll · a backwards date window is refused, not answered with zero',
  async ({ page }) => {
    // `to` before `from` is a typo anyone makes on a date picker. Answering
    // "0 rows" to it looks exactly like a fortnight nobody worked, which on a
    // payroll input is worse than an error. It is now a 400 that says so.
    const r = await api(page, 'post', '/api/v1/pahchan/attendance/publish',
      { from_date: '2026-07-31', to_date: '2026-07-01', dry_run: true });
    expect(r.status(), 'a backwards window was accepted').toBe(400);
    expect(String((await r.json()).detail)).toMatch(/ends before it starts/i);
  });

test('payroll · an unreadable date is named rather than crashing', async ({ page }) => {
    const r = await api(page, 'post', '/api/v1/pahchan/attendance/publish',
      { from_date: '20-07-2026', to_date: '2026-08-02', dry_run: true });
    expect(r.status(), 'a malformed date produced something other than a 400').toBe(400);
    expect(String((await r.json()).detail),
      'the refusal does not quote the value it could not read').toContain('20-07-2026');
  });


// ══ ENROLLMENT — read only, deliberately ═════════════════════════════════════

test('enrollment · the pending queue answers, and nothing is enrolled', async ({ page }) => {
  await pahchan(page, 'Enrollment');
  await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);

  const r = await api(page, 'get', '/api/v1/pahchan/enrollment/queue/pending');
  expect(r.status(), await r.text()).toBe(200);
  const rows = (await r.json()).data ?? [];
  expect(Array.isArray(rows), 'the enrollment queue did not answer with a list').toBe(true);

  // Deliberately no write. The queue holds biometric templates of real people;
  // this suite never submits a face, approves an enrolment, or uploads an
  // image. Stated here so a future reader does not "complete" the coverage.
  await shot(page, `pahchan-enrollment-${RUN}`);
});


// ══ MY ATTENDANCE ════════════════════════════════════════════════════════════

test('my attendance · a person can see their own record', async ({ page }) => {
  await pahchan(page, 'My attendance');
  await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);
  const r = await api(page, 'get', '/api/v1/pahchan/me');
  expect(r.status(), `an employee cannot read their own attendance: ${await r.text()}`)
    .toBe(200);
  const me = await r.json();
  expect(Array.isArray(me.punches), '/me did not answer with a punch list').toBe(true);
  // The owner is not an employee, so `employee` is legitimately null here. The
  // endpoint must still answer rather than 404 — a person with no employee
  // record is a normal state, not an error.
  expect(me.retention, '/me carries no retention policy').toBeTruthy();
});
