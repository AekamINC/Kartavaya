/**
 * Vetana · वेतन — the three states, on every tab.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS DEFENDING
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A FAILED FETCH MUST NEVER RENDER AS AN EMPTY STATE.
 *
 * On payroll that is not a polish issue. "No payroll runs" and "the request for
 * your payroll runs failed" are rendered by the same branch the moment somebody
 * writes `catch {}` and then tests `list.length === 0` — and they mean opposite
 * things. One says nobody is owed anything. The other says you do not know what
 * anybody is owed.
 *
 * Every tab of this module used to do exactly that: six `catch {}` blocks, each
 * followed by a length check. The failure was invisible in every screenshot,
 * because a broken payroll page and a payroll page for a company with no
 * employees look identical.
 *
 * So each tab is asserted twice below — once with a server that answers, once
 * with a server that fails — and the failing case must show the failure and
 * must NOT show the empty state's copy.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import VetanaPage from '../../pages/VetanaPage';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork,
  makeHost, signIn, clearSession, users, httpError,
} from './_harness';

let host;

beforeEach(() => {
  clearSession();
  installNetworkKillSwitch();
  host = makeHost();
  signIn(users.orgAdmin({ module_grants: ['vetana'], module_levels: { vetana: 'admin' } }));
});

afterEach(() => {
  host.unmount();
  restoreNetwork();
  vi.restoreAllMocks();
  clearSession();
});

/* ── Fixtures ─────────────────────────────────────────────────────────────
   Shaped like the real router's responses. `dashboard` in particular has to
   carry `department_split` and `ytd`, because the tab reads both. */

const DASHBOARD = {
  headcount: 3,
  latest_run: {
    id: 'run_1', month: '2026-06', status: 'processed', employee_count: 3,
    total_gross: 840000, total_deductions: 118000, total_net: 722000,
    total_pf: 60000, total_esi: 9000, total_tds: 49000,
  },
  ytd: { ytd_gross: 5040000, ytd_net: 4300000, ytd_pf: 360000, ytd_esi: 54000, ytd_tds: 294000 },
  department_split: [
    { department: 'Finance', employees: 2, dept_gross: 500000, dept_net: 430000 },
    { department: 'Legal', employees: 1, dept_gross: 340000, dept_net: 292000 },
  ],
};

const STATUTORY = {
  month: '2026-06',
  totals: {
    total_pf_employee: 30000, total_pf_employer: 30000,
    total_esi_employee: 2000, total_esi_employer: 7000,
    total_pt: 600, total_tds: 49000,
  },
  employees: [{
    payslip_number: 'PS-1', employee_name: 'Aanya Mehta', employee_code: 'E-2',
    pan: '••••1234', uan: '••••9876', basic: 60000, gross: 145000,
    pf_employee: 1800, pf_employer: 1800, esi_employee: 0, esi_employer: 0,
    professional_tax: 200, tds: 12000, _pii_masked: true,
  }],
};

const OK_ROUTES = {
  'GET /v1/vetana/dashboard': DASHBOARD,
  'GET /v1/vetana/statutory-summary': STATUTORY,
  'GET /v1/vetana/salary-structures': {
    data: [{
      id: 's1', employee_id: 'e1', employee_name: 'Keval Shah', employee_code: 'E-1',
      effective_from: '2026-04-01', ctc_annual: 2160000,
    }],
  },
  'GET /v1/vetana/payroll/runs': { data: [DASHBOARD.latest_run] },
  'GET /v1/vetana/payslips': {
    data: [{
      id: 'p1', employee_name: 'Keval Shah', payslip_number: 'PS-1',
      month: '2026-06', net_pay: 154800, status: 'approved',
    }],
  },
  'GET /v1/vetana/loans': {
    data: [{
      id: 'l1', employee_name: 'Rohan Iyer', employee_code: 'E-3', status: 'active',
      principal_amount: 100000, balance_remaining: 60000, emi_amount: 10000,
      disbursed_date: '2026-01-10',
    }],
  },
};

/** Open the page and switch to `tab`. */
async function open(routes, tab) {
  const mock = installMockApi(routes);
  await host.mount(<VetanaPage />, { path: '/vetana' });
  if (tab) {
    const btn = host.$(`#mt-tab-${tab}`);
    expect(btn, `no ${tab} tab — the ModuleTabs id scheme changed`).toBeTruthy();
    await host.click(btn);
  }
  return mock;
}

/* ══════════════════════════════════════════════════════════════════════════
   1 · The module is split, and the route file stayed thin
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · vetana · the split', () => {
  it('every tab renders from its own file and the page still mounts', async () => {
    await open(OK_ROUTES, null);
    for (const id of ['dashboard', 'structures', 'payroll', 'payslips', 'loans', 'statutory']) {
      expect(host.$(`#mt-tab-${id}`), `${id} tab missing`).toBeTruthy();
    }
  });

  it('the figures sit above the tab strip, as the reference has them', async () => {
    await open(OK_ROUTES, null);
    // The four the rendered reference shows: gross, deductions, net payable and
    // the next statutory deadline.
    const strip = host.$('.mk');
    expect(strip, 'no KPI strip on the payroll module').toBeTruthy();
    expect(strip.textContent).toMatch(/Gross/i);
    expect(strip.textContent).toMatch(/Deductions/i);
    expect(strip.textContent).toMatch(/Net payable/i);
    expect(strip.textContent).toMatch(/Compliance due/i);
  });

  it('a dashboard failure blanks the figures WITH a reason, never silently', async () => {
    await open({ ...OK_ROUTES, 'GET /v1/vetana/dashboard': httpError(500) }, null);
    expect(host.$('.mk'), 'a failed KPI fetch still rendered a figure row').toBeFalsy();
    expect(host.text()).toMatch(/did not load/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · Each tab, answered
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · vetana · tabs render real data', () => {
  it('dashboard shows the year and the department split', async () => {
    await open(OK_ROUTES, 'dashboard');
    expect(host.text()).toMatch(/Year to date/i);
    expect(host.text()).toMatch(/Finance/);
    expect(host.text()).toMatch(/Legal/);
  });

  it('dashboard names the employees who have no salary structure', async () => {
    // Three active employees, one structure. Two people would be skipped by
    // every run, and nothing in the product said so before.
    await open(OK_ROUTES, 'dashboard');
    expect(host.text()).toMatch(/2 of 3 active employees have no salary structure/i);
  });

  it('structures lists a structure', async () => {
    await open(OK_ROUTES, 'structures');
    expect(host.text()).toMatch(/Keval Shah/);
  });

  it('payroll lists a run and opens its detail', async () => {
    await open({ ...OK_ROUTES, 'GET /v1/vetana/payroll/runs/:id': { ...DASHBOARD.latest_run, payslips: [] } }, 'payroll');
    const row = host.$$('.k-modcard').find(n => /June 2026/.test(n.textContent));
    expect(row, 'no payroll run row').toBeTruthy();
    await host.click(row);
    expect(host.text()).toMatch(/Employee Breakdown/i);
  });

  it('payslips lists a payslip', async () => {
    await open(OK_ROUTES, 'payslips');
    expect(host.text()).toMatch(/PS-1/);
  });

  it('loans lists a loan and computes the months left', async () => {
    await open(OK_ROUTES, 'loans');
    expect(host.text()).toMatch(/Rohan Iyer/);
    // 60,000 remaining at 10,000 a month.
    expect(host.text()).toMatch(/6 months left/i);
  });

  it('statutory derives the calendar from the month, and prints the rule', async () => {
    await open(OK_ROUTES, 'statutory');
    expect(host.text()).toMatch(/Compliance calendar/i);
    expect(host.text()).toMatch(/ECR/);
    expect(host.text()).toMatch(/24Q/);
    // The rule is printed so a reader can check the date rather than trust it.
    expect(host.text()).toMatch(/EPF Scheme 1952/);
    // June 2026 is Q1 of the Indian financial year — the 24Q return is due
    // 31 July, not "one month after the quarter".
    expect(host.text()).toMatch(/31 Jul 2026/);
  });

  it('statutory asserts no due date for professional tax', async () => {
    // PT is levied by state and has no national schedule. Inventing a date on a
    // compliance screen is the failure the payslip generator refuses to commit.
    await open(OK_ROUTES, 'statutory');
    expect(host.text()).toMatch(/no national due date/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · THE ONE THAT MATTERS — a failure is never an empty state
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · vetana · a failed fetch is not an empty state', () => {
  const CASES = [
    ['structures', 'GET /v1/vetana/salary-structures', /No salary structures/i],
    ['payroll', 'GET /v1/vetana/payroll/runs', /No payroll has been run/i],
    ['payslips', 'GET /v1/vetana/payslips', /No payslips yet/i],
    ['loans', 'GET /v1/vetana/loans', /No loans or advances/i],
  ];

  for (const [tab, route, emptyCopy] of CASES) {
    it(`${tab}: a 500 shows the failure and NOT the empty state`, async () => {
      await open({ ...OK_ROUTES, [route]: httpError(500) }, tab);
      expect(host.text(), `${tab} swallowed the failure`).toMatch(/did not load/i);
      expect(
        emptyCopy.test(host.text()),
        `${tab} rendered its empty state over a failed request — "nothing here" and `
        + '"this did not load" are opposite claims on a payroll screen',
      ).toBe(false);
    });

    it(`${tab}: the empty state IS shown when the server really returns nothing`, async () => {
      // The other half. A guard that never lets the empty state through is not a
      // fix, it is a second bug.
      await open({ ...OK_ROUTES, [route]: { data: [] } }, tab);
      expect(host.text(), `${tab} lost its empty state`).toMatch(emptyCopy);
    });
  }

  it('statutory: a failure is stated, not rendered as a zero register', async () => {
    await open({ ...OK_ROUTES, 'GET /v1/vetana/statutory-summary': httpError(500) }, 'statutory');
    expect(host.text()).toMatch(/did not load/i);
    expect(host.text()).not.toMatch(/Compliance calendar/i);
  });

  it('a 403 is answered in the server’s own words, not with "Failed"', async () => {
    const sentence = 'This action needs \'editor\' on Vetana. Without a grant you can see '
      + 'your own payroll records and nothing else.';
    await open({ ...OK_ROUTES, 'GET /v1/vetana/loans': httpError(403, sentence) }, 'loans');
    expect(host.text()).toContain('your own payroll records and nothing else');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4 · The payslip refusal — a statutory document is not issued incomplete
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · vetana · the payslip refusal is shown, not swallowed', () => {
  const PAYSLIP = {
    id: 'p1', payslip_number: 'PS-1', employee_name: 'Keval Shah', employee_code: 'E-1',
    month: '2026-06', status: 'approved', working_days: 26, present_days: 26,
    leaves_paid: 0, leaves_unpaid: 0, basic: 60000, hra: 30000, gross: 145000,
    pf_employee: 1800, esi_employee: 0, professional_tax: 200, tds: 12000,
    total_deductions: 14000, net_pay: 131000, pf_employer: 1800, esi_employer: 0,
    _pii_masked: true,
  };

  /**
   * The 422 body `services/doc_validation.py` produces. `detail` is an OBJECT,
   * not a string — the previous renderer took `.detail` as text and would have
   * shown "[object Object]".
   */
  const INCOMPLETE = {
    __reject: Object.assign(new Error('422'), {
      isAxiosError: true,
      response: {
        status: 422,
        data: {
          detail: {
            error: 'document_incomplete',
            document: 'payslip',
            message: 'This payslip cannot be issued — 1 mandatory field(s) are missing '
              + 'or inconsistent. Nothing has been invented to fill the gap.',
            blocking: [{
              field: 'employee.uan',
              label: 'Universal Account Number',
              reason: 'The payslip records a provident fund deduction but carries no UAN, '
                + 'so the employee cannot trace the contribution.',
              fix: 'Set the UAN on the employee record in Manav.',
            }],
            advisory: [],
          },
        },
      },
    }),
  };

  it('names the missing field, the reason and the fix', async () => {
    await open({
      ...OK_ROUTES,
      'GET /v1/vetana/payslips/:id': PAYSLIP,
      'GET /v1/vetana/payslips/:id/pdf': INCOMPLETE,
    }, 'payslips');

    await host.click(host.$$('.k-modcard').find(n => /PS-1/.test(n.textContent)));
    await host.click(host.$$('button').find(b => /download pdf/i.test(b.textContent)));

    expect(host.text()).toMatch(/was not issued/i);
    expect(host.text()).toMatch(/Universal Account Number/);
    expect(host.text()).toMatch(/cannot trace the contribution/);
    expect(host.text()).toMatch(/Set the UAN on the employee record in Manav/);
    // The failure mode being defended against.
    expect(host.text()).not.toMatch(/\[object Object\]/);
  });
});
