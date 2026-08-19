/**
 * Phase 3b — Vetana payroll, including the four-eyes refusal.
 *
 * ── Why this suite is careful about side effects ────────────────────────────
 * Processing payroll EMAILS every employee their payslip with the PDF attached,
 * and re-running a month deletes and rebuilds its payslips, which sends that
 * email a second time. Every employee in this org is `@example.com` — RFC 2606
 * reserved, deliverable to nobody — which STOPPED BEING A SAFETY ARGUMENT the
 * day staging went `OUTBOUND_MODE=live` (2026-08-18): an undeliverable address
 * is not a non-event any more, it is a hard bounce through Resend against the
 * verified sender domain, and ~60 of them per run is reputation damage. The
 * real guard is `OUTBOUND_SUPPRESSED_ORGS` on the staging service, which
 * carries this E2E org: `backend/outbound.py` stops every send from this org
 * at the same gate dry mode uses and logs it 'suppressed', so nothing leaves
 * however many times payroll runs. The `@example.com` check below stays as the
 * second fence — it proves nobody swapped a real person into the fixture org,
 * and it is all that stands between a run and 60 strangers if the Railway var
 * is ever cleared. A suite that mails 60 real people is not a test failure,
 * it is an incident.
 *
 * ── The separation of duty ──────────────────────────────────────────────────
 * Whoever processes a run must not be the one who approves it, WHEN the org has
 * a second approver to ask. Measured on this org: `revert` and `approve` both
 * require the **approver** grant — an admin grant is refused with "whoever
 * defines what people are paid does not release the money" — while `process`
 * requires **admin**. So the refusal path needs two real sessions, and this file
 * uses both.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { OWNER_STATE, APPROVER_STATE, DL_DIR } from './real.config';
import { api, apiOk, assertOutboundFence, settle, openTab, shot, submitting, RUN } from './_helpers';

test.describe.configure({ mode: 'serial' });

const HANDOFF = path.join(DL_DIR, `vetana-${RUN}.json`);
const keep = (k: string, v: any) => {
  const s = fs.existsSync(HANDOFF) ? JSON.parse(fs.readFileSync(HANDOFF, 'utf8')) : {};
  s[k] = v;
  fs.writeFileSync(HANDOFF, JSON.stringify(s, null, 2));
};
const recall = (k: string) => {
  const s = JSON.parse(fs.readFileSync(HANDOFF, 'utf8'));
  expect(s[k], `nothing handed over for "${k}" — an earlier test in this file failed`).toBeTruthy();
  return s[k];
};

async function vetana(page: Page, tab: string) {
  if (!page.url().includes('/vetana')) {
    await page.goto('/vetana');
    await settle(page);
  }
  await openTab(page, tab);
}

const panel = (page: Page) => page.getByRole('tabpanel');


// ══ RESET FIRST, AS THE APPROVER ═════════════════════════════════════════════
//
// The fixture this file needs is a 2026-07 run sitting at `processed`. It can
// arrive here in any of three states — and only an APPROVER can move it back:
// `revert` requires the approver grant, which is the same separation the rest
// of the file tests, seen from the other side. So the reset runs first and runs
// as the approver, rather than the owner block trying and failing to undo work
// it is deliberately not allowed to undo.

test.describe('reset', () => {
  test.use({ storageState: APPROVER_STATE });

  test('the 2026-07 run is put back to a state the owner can process', async ({ page }) => {
    await page.goto('/vetana');
    await settle(page);
    const runs = await apiOk(page, 'get', '/api/v1/vetana/payroll/runs');
    const jul = (runs.data ?? runs).find((r: any) => r.month === '2026-07');
    expect(jul, 'the 2026-07 run is missing entirely').toBeTruthy();

    if (jul.status === 'approved') {
      const r = await api(page, 'patch', `/api/v1/vetana/payroll/runs/${jul.id}/revert`);
      expect(r.status(), `the approver could not revert an approved run: ${await r.text()}`)
        .toBe(200);
    }
    const after = await apiOk(page, 'get', '/api/v1/vetana/payroll/runs');
    const now = (after.data ?? after).find((r: any) => r.month === '2026-07');
    expect(['draft', 'processed'], `the run is ${now.status}, which the owner cannot process`)
      .toContain(now.status);
  });
});


// ══ AS THE OWNER ═════════════════════════════════════════════════════════════

test.describe('owner', () => {
  test.use({ storageState: OWNER_STATE });

  test.beforeEach(async ({ page }) => {
    await page.goto('/vetana');
    await settle(page);
  });

  test('nobody outside the test domain can be emailed a payslip', async ({ page }) => {
    // Asserted BEFORE anything is processed. Processing mails every employee,
    // and this is the only thing standing between a test run and 60 strangers
    // receiving someone else's salary.
    const r = await apiOk(page, 'get', '/api/v1/manav/employees?limit=500');
    const rows = r.data ?? r;
    expect(rows.length, 'no employees to pay').toBeGreaterThan(0);
    const outside = rows
      .map((e: any) => String(e.email || ''))
      .filter((e: string) => e && !/@example\.(com|org|net)$/.test(e)
        && !/simulator\.amazonses\.com$/.test(e));
    expect(outside,
      'these employees would receive a real payslip email if payroll is processed')
      .toEqual([]);
  });

  test('structures · the salary structures behind the run exist', async ({ page }) => {
    await vetana(page, 'structures');
    const r = await apiOk(page, 'get', '/api/v1/vetana/salary-structures?limit=200');
    const rows = r.data ?? r;
    expect(rows.length, 'no salary structures — a run would pay nobody').toBeGreaterThan(0);
    await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);
  });

  test('payroll · the 2026-07 run is processed and awaiting approval', async ({ page }) => {
    // FIRST, the fence — verified against the DEPLOYED process, not this
    // file's comments. Everything below may re-process the month, which emails
    // every employee; the comments say OUTBOUND_SUPPRESSED_ORGS carries this
    // org, but a Railway variable can be cleared or typo'd with no signal a
    // spec would see. `/api/health` reports what the running process actually
    // holds, and this line refuses to reach the send if the shield is down.
    await assertOutboundFence(page);

    // The fixture the separated-duty test needs. If a previous run left it
    // elsewhere, drive it back through the product's own endpoint — never by
    // patching the row, because the fixture and the feature are the same code
    // path and patching it would hide whether processing still works.
    await vetana(page, 'payroll');
    const runs = await apiOk(page, 'get', '/api/v1/vetana/payroll/runs');
    const jul = (runs.data ?? runs).find((r: any) => r.month === '2026-07');
    expect(jul, 'the 2026-07 run is missing entirely').toBeTruthy();

    if (jul.status !== 'processed') {
      // Re-processing deletes and rebuilds the month's payslips and emails each
      // employee again. Safe because OUTBOUND_SUPPRESSED_ORGS carries this E2E
      // org on staging, so backend/outbound.py suppresses every one of these
      // sends at the gate and logs them 'suppressed' — @example.com addresses
      // are NOT safe on their own now that OUTBOUND_MODE=live: each would be a
      // hard bounce against the sender domain. The first test in this file
      // still asserts the domain, as the fence behind the fence.
      const done = await api(page, 'post', '/api/v1/vetana/payroll/process', { month: '2026-07' });
      expect(done.status(), await done.text()).toBe(200);
    }
    const again = await apiOk(page, 'get', '/api/v1/vetana/payroll/runs');
    const now = (again.data ?? again).find((r: any) => r.month === '2026-07');
    expect(now.status, 'the run is not in a state that can be approved').toBe('processed');
    expect(Number(now.employee_count), 'the run pays nobody').toBeGreaterThan(0);
    expect(Number(now.total_net), 'the run has no net pay').toBeGreaterThan(0);

    keep('runId', now.id);
    keep('runNet', now.total_net);
    keep('processedBy', now.created_by);
    await shot(page, `vetana-payroll-${RUN}`);
  });

  test('payroll · FOUR EYES — the owner who processed it cannot approve it',
    async ({ page }) => {
      // The rule, exercised against a real second approver. It is conditional
      // by design: an org with only one approver would be unable to pay anyone
      // at all, so there the release proceeds and writes
      // `vetana.payroll_self_approved` to the audit log instead. This org has
      // two, so the refusal must fire.
      const members = await apiOk(page, 'get', '/api/v1/org/members');
      const approvers = (members.data ?? members).filter((m: any) =>
        JSON.stringify(m).includes('approver'));
      expect(approvers.length,
        'this org has fewer than two Vetana approvers, so four eyes cannot be enforced ' +
        'and this test proves nothing — grant a second approver').toBeGreaterThanOrEqual(1);

      const r = await api(page, 'patch',
        `/api/v1/vetana/payroll/runs/${recall('runId')}/approve`);
      expect(r.status(),
        'the person who processed this run was allowed to approve it too').toBe(403);
      const detail = String((await r.json()).detail);
      expect(detail, 'the refusal does not say why').toMatch(/second pair of eyes|cannot also approve/i);

      // And it did not half-apply.
      const runs = await apiOk(page, 'get', '/api/v1/vetana/payroll/runs');
      const jul = (runs.data ?? runs).find((x: any) => x.id === recall('runId'));
      expect(jul.status, 'a refused approval changed the run anyway').toBe('processed');
    });

  test('payslips · one downloads as a clean PDF', async ({ page }) => {
    await vetana(page, 'payslips');
    const slips = await apiOk(page, 'get', '/api/v1/vetana/payslips?limit=20');
    const rows = slips.data ?? slips;
    expect(rows.length, 'no payslips to download').toBeGreaterThan(0);

    const res = await api(page, 'get', `/api/v1/vetana/payslips/${rows[0].id}/pdf`);
    expect(res.status(), `the payslip PDF was refused: ${await res.text()}`).toBe(200);
    const buf = await res.body();
    expect(buf.subarray(0, 5).toString('latin1'), 'the payslip is not a PDF').toBe('%PDF-');

    // The owner's ruling, asserted on the artefact: a missing UAN, ESI number
    // or PAN is advisory and must not appear on the employee's copy.
    const text = buf.toString('latin1');
    expect(text, 'the payslip carries a "not set" marker').not.toContain('not set');
    expect(text).not.toContain('This document is missing details');
    fs.writeFileSync(path.join(DL_DIR, `vetana-payslip-${RUN}.pdf`), buf);
  });

  test('loans · create one against an employee', async ({ page }) => {
    await vetana(page, 'loans');
    await panel(page).getByRole('button', { name: '+ New loan' }).click();
    await settle(page);

    const f = page.locator('form').filter({ hasText: 'EMI' });
    await expect(f, 'the loan form did not open').toBeVisible();
    const selects = f.locator('select');
    if (await selects.count()) await selects.first().selectOption({ index: 1 });
    const nums = f.locator('input[type="number"]');
    await nums.nth(0).fill('60000');   // principal
    await nums.nth(1).fill('5000');    // EMI

    const made = await submitting(page, /loan/i,
      () => f.getByRole('button', { name: 'Save loan' }).click());
    expect(made?.id || made?.loan?.id, 'the loan was not saved').toBeTruthy();
  });

  test('statutory · the filing calendar answers with real dues', async ({ page }) => {
    await vetana(page, 'statutory');
    await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);
    await shot(page, `vetana-statutory-${RUN}`);
  });

  test('dashboard · the figures come from the runs behind them', async ({ page }) => {
    await vetana(page, 'dashboard');
    const runs = await apiOk(page, 'get', '/api/v1/vetana/payroll/runs');
    expect((runs.data ?? runs).length, 'no runs to summarise').toBeGreaterThan(0);
    await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);
  });
});


// ══ AS THE SECOND APPROVER ═══════════════════════════════════════════════════

test.describe('approver', () => {
  test.use({ storageState: APPROVER_STATE });

  test('payroll · the second approver CAN approve what the owner processed',
    async ({ page }) => {
      // The other half of four eyes. The refusal above is only correct if a
      // different person can still get the run out of the door — otherwise the
      // rule is not a control, it is a deadlock.
      await page.goto('/vetana');
      await settle(page);

      const r = await api(page, 'patch',
        `/api/v1/vetana/payroll/runs/${recall('runId')}/approve`);
      expect(r.status(),
        `the second approver was refused too — payroll cannot be released at all: ${await r.text()}`)
        .toBe(200);

      const runs = await apiOk(page, 'get', '/api/v1/vetana/payroll/runs');
      const jul = (runs.data ?? runs).find((x: any) => x.id === recall('runId'));
      expect(jul.status, 'the approval did not stick').toBe('approved');
      expect(jul.approved_by, 'the run records no approver').toBeTruthy();
      expect(jul.approved_by, 'the approval was attributed to the person who processed it')
        .not.toBe(recall('processedBy'));
      await shot(page, `vetana-approved-${RUN}`);
    });

  test('payroll · revert puts it back so the suite can run again', async ({ page }) => {
    // Self-restoring, and it has to be: `process` refuses a month that is
    // already approved, so leaving the run approved makes the next run of this
    // file fail on its fixture. Revert requires the APPROVER grant — an admin
    // is refused, which is the same separation seen from the other side.
    await page.goto('/vetana');
    await settle(page);
    const r = await api(page, 'patch',
      `/api/v1/vetana/payroll/runs/${recall('runId')}/revert`);
    expect(r.status(), await r.text()).toBe(200);

    const runs = await apiOk(page, 'get', '/api/v1/vetana/payroll/runs');
    const jul = (runs.data ?? runs).find((x: any) => x.id === recall('runId'));
    // Revert drops an approved run to DRAFT, not back to processed — so the
    // fixture test at the top of this file processes it again next time.
    expect(['draft', 'processed'], `revert left the run ${jul.status}`).toContain(jul.status);
  });
});
