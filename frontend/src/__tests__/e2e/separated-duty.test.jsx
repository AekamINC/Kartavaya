/**
 * Separated duty — on Vetana and Ganit, `admin` does NOT satisfy `approver`.
 *
 * Admin is breadth: salary structures, chart of accounts. Approver is depth:
 * release payments, close periods. Whoever defines what people are paid must
 * not also be the one who releases the money. One person may hold both — in a
 * small firm often must — but it has to be a second, visible, audited grant
 * rather than something admin quietly includes.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * READ THIS BEFORE "FIXING" A FAILURE IN THE LAST BLOCK
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The rule is CORRECTLY ENCODED and ENFORCED NOWHERE.
 *
 * `backend/middleware/role_tiers.py:252 level_satisfies()` implements it
 * exactly. It has zero production call sites — the only callers in the repo are
 * its own unit tests. There is no `require_module_level` dependency, and
 * `require_module` checks only that a grant ROW EXISTS, never its level. So
 * today an `org_admin` can approve a payroll run, and the browser offers them
 * the button to do it.
 *
 * The last block below pins that gap with `it.fails`, which passes only while
 * the gap is open and turns red the moment somebody closes it. That is
 * deliberate: a plain assertion of today's behaviour would LOCK IN the bug, and
 * deleting the test would lose the record. When enforcement lands, change
 * `it.fails` to `it` — the assertions inside are already written the right way
 * round.
 *
 * DO NOT close the gap by guessing. There is an unresolved contradiction that
 * needs the owner, recorded in `swarm-reports/_COORDINATION.md` §5:
 *
 *   · `RBAC-SPEC.md:65` — "Sensitive modules are role-derived, not granted.
 *     Vetana, Ganit and Manav have no per-member grant row at all." Under this,
 *     a grant row naming a sensitive module is invalid input.
 *   · The Tier-4 level model assumes a grant row CARRYING A LEVEL is exactly
 *     how approver is held.
 *
 * Both cannot be true. Enforcement built against the wrong one is worse than
 * the present gap, because it would look enforced.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  LEVELS, VIEWER, EDITOR, APPROVER, ADMIN,
  SEPARATED_DUTY_MODULES, NO_APPROVER_MODULES, NO_VIEWER_MODULES,
  levelSatisfies, validLevels, isSeparatedDuty,
} from '../../pages/org/levels';
import VetanaPage from '../../pages/VetanaPage';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork,
  makeHost, signIn, clearSession, users, SRC_DIR,
} from './_harness';

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

let host;

beforeEach(() => {
  clearSession();
  installNetworkKillSwitch();
  host = makeHost();
});

afterEach(() => {
  host.unmount();
  restoreNetwork();
  vi.restoreAllMocks();
  clearSession();
});

/* ══════════════════════════════════════════════════════════════════════════
   1 · The rule itself
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · separated duty · the ladder', () => {
  for (const module of SEPARATED_DUTY_MODULES) {
    it(`${module}: admin does NOT satisfy approver`, () => {
      expect(levelSatisfies(ADMIN, APPROVER, module)).toBe(false);
    });

    it(`${module}: only an explicit approver grant approves`, () => {
      expect(levelSatisfies(APPROVER, APPROVER, module)).toBe(true);
      for (const held of [VIEWER, EDITOR, ADMIN]) {
        expect(levelSatisfies(held, APPROVER, module), `${held} reached approver`).toBe(false);
      }
    });

    it(`${module}: admin still satisfies everything BELOW approver`, () => {
      // The rule carves out one rung. It does not demote admin generally — an
      // admin who could not even view the module they configure is a different
      // bug, and a plausible over-correction.
      expect(levelSatisfies(ADMIN, ADMIN, module)).toBe(true);
      expect(levelSatisfies(ADMIN, EDITOR, module)).toBe(true);
      expect(levelSatisfies(ADMIN, VIEWER, module)).toBe(true);
    });

    it(`${module} is reported as separated duty, so the UI can mark it`, () => {
      expect(isSeparatedDuty(module)).toBe(true);
    });
  }

  it('everywhere else the ladder IS a plain hierarchy', () => {
    for (const module of ['graha', 'vikray', 'prachar', 'manav', 'pahchan']) {
      expect(levelSatisfies(ADMIN, APPROVER, module), `${module} unexpectedly separated`).toBe(true);
      expect(isSeparatedDuty(module)).toBe(false);
    }
  });

  it('an unknown or absent level never satisfies anything', () => {
    expect(levelSatisfies(null, VIEWER, 'graha')).toBe(false);
    expect(levelSatisfies(undefined, VIEWER, 'graha')).toBe(false);
    expect(levelSatisfies('superuser', APPROVER, 'vetana')).toBe(false);
    expect(levelSatisfies(ADMIN, 'god', 'vetana')).toBe(false);
  });

  it('a picker never offers a level the module has no use for', () => {
    // The database refuses it outright (`org_member_modules_level_is_meaningful`),
    // so the picker and the CHECK constraint have to agree or the save 500s.
    for (const module of NO_APPROVER_MODULES) {
      expect(validLevels(module), `${module} offered approver`).not.toContain(APPROVER);
    }
    for (const module of NO_VIEWER_MODULES) {
      expect(validLevels(module), `${module} offered viewer`).not.toContain(VIEWER);
    }
    expect(validLevels('vetana')).toEqual(LEVELS);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · The mirror must not drift from its source
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · separated duty · frontend mirrors the backend', () => {
  /**
   * `levels.js` says of itself: "mirrored from backend/middleware/role_tiers.py,
   * which is the source of truth". A mirror nobody compares is a second source
   * of truth wearing a comment.
   *
   * This caught nothing today only because a sibling had already renamed
   * `samvada` → `sanvaad` on BOTH sides in the same change. Had they renamed one,
   * `validLevels('sanvaad')` would have offered an approver rung the database
   * rejects, and the picker would have saved a 500.
   */
  const ROLE_TIERS = (() => {
    const p = [
      path.resolve(SRC_DIR, '../../backend/middleware/role_tiers.py'),
      path.resolve(process.cwd(), '../backend/middleware/role_tiers.py'),
      path.resolve(process.cwd(), 'backend/middleware/role_tiers.py'),
    ].find(existsSync);
    return p ? readFileSync(p, 'utf8') : null;
  })();

  /** `NAME: frozenset[str] = frozenset({ "a", "b" })` → ['a','b'] */
  function pySet(name) {
    const m = ROLE_TIERS.match(
      new RegExp(`${name}\\s*:\\s*frozenset\\[str\\]\\s*=\\s*frozenset\\(\\{([^}]*)\\}\\)`),
    );
    if (!m) throw new Error(`role_tiers.py: could not read ${name}`);
    return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]).sort();
  }

  it('found the backend file — otherwise every check below is vacuous', () => {
    expect(ROLE_TIERS, 'backend/middleware/role_tiers.py not found from ' + process.cwd())
      .toBeTruthy();
    expect(ROLE_TIERS).toContain('def level_satisfies');
  });

  it('SEPARATED_DUTY_MODULES agree', () => {
    expect([...SEPARATED_DUTY_MODULES].sort()).toEqual(pySet('SEPARATED_DUTY_MODULES'));
  });

  it('NO_APPROVER_MODULES agree', () => {
    expect([...NO_APPROVER_MODULES].sort()).toEqual(pySet('NO_APPROVER_MODULES'));
  });

  it('NO_VIEWER_MODULES agree', () => {
    expect([...NO_VIEWER_MODULES].sort()).toEqual(pySet('NO_VIEWER_MODULES'));
  });

  it('the two module vocabularies do not overlap where they must not', () => {
    // A module cannot be both "has no approver rung" and "approver is special
    // here". That combination would make validLevels() and levelSatisfies()
    // describe different products.
    for (const m of SEPARATED_DUTY_MODULES) {
      expect(NO_APPROVER_MODULES, `${m} is separated-duty AND approver-less`).not.toContain(m);
    }
  });

  it('the backend still encodes the rule the frontend mirrors', () => {
    // Line-quote the invariant, not the line number. If someone deletes the
    // carve-out from level_satisfies, the mirror above becomes a lie.
    expect(ROLE_TIERS).toMatch(/module_code\s+in\s+SEPARATED_DUTY_MODULES\s+and\s+required\s*==\s*APPROVER/);
    expect(ROLE_TIERS).toMatch(/return\s+held\s*==\s*APPROVER/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · The browser level — where the gap actually shows
   ══════════════════════════════════════════════════════════════════════════ */

const RUN = {
  id: 'run_1', month: '2026-06', status: 'processed', employee_count: 3,
  total_gross: 0, total_deductions: 0, total_net: 0, total_pf: 0,
  total_esi: 0, total_tds: 0, payslips: [],
};

/**
 * Stub every endpoint the page touches, then open the payroll run detail.
 *
 * `/v1/vetana/dashboard` must return a REALISTIC shape, not `{}`. The dashboard
 * tab reads `data.department_split.length` unguarded, so an empty object throws
 * during mount, the page never renders, and the two pins below would then pass
 * because there is no Approve button ANYWHERE — the right answer for entirely
 * the wrong reason. The "module surface still exists" test above is what
 * catches that, and it caught exactly this while the file was being written.
 */
async function openPayrollRun(user) {
  signIn(user);
  const mock = installMockApi({
    'GET /v1/vetana/dashboard': {
      headcount: 3, latest_run: null, ytd: {}, department_split: [],
    },
    'GET /v1/vetana/payroll/runs': { data: [RUN] },
    'GET /v1/vetana/payroll/runs/:id': RUN,
    'PATCH /v1/vetana/payroll/runs/:id/approve': { ok: true },
  });

  await host.mount(<VetanaPage />, { path: '/vetana' });

  // `#mt-tab-<id>` is generated by ModuleTabs from the page's own TABS array,
  // so it tracks a rename of the tab's visible label. Matching the label text
  // would not.
  const payrollTab = host.$('#mt-tab-payroll');
  expect(payrollTab, 'no Payroll tab — ModuleTabs id scheme changed').toBeTruthy();
  await host.click(payrollTab);

  // The run row. `ModCard` renders a plain div with an onClick and carries no
  // role, so there is no semantic handle to grab — matched by its own text
  // (the month) within the card container. Noted rather than silently relied
  // on: if this ever gets a `role="button"`, prefer that.
  const row = host.$$('.k-modcard').find(n => /2026-06/.test(n.textContent));
  expect(row, 'no payroll run row').toBeTruthy();
  await host.click(row);

  return mock;
}

describe('e2e · separated duty · the payroll approve control', () => {
  it('the module surface and the control both still exist', async () => {
    // Guards the test, not the app. If the Payroll tab or the run detail stops
    // rendering, the pinned assertion below would pass for the wrong reason —
    // "no Approve button" because there is no page.
    const approverHoldsIt = users.orgAdmin({
      module_grants: ['vetana'],
      module_levels: { vetana: APPROVER },
    });
    await openPayrollRun(approverHoldsIt);
    // The run detail is open and the control is on screen. Without this, "no
    // Approve button" below could mean "no page".
    expect(host.text()).toMatch(/Employee Breakdown/i);
    const approve = host.$$('button').find(b => /approve payroll/i.test(b.textContent));
    expect(approve, 'the approve control has moved or been renamed').toBeTruthy();
  });

  /**
   * ── PINNED KNOWN-OPEN GAP ─────────────────────────────────────────────
   *
   * `it.fails` passes ONLY while this is broken. When enforcement lands it
   * turns red — change it to `it` and the assertion is already correct.
   *
   * See the header of this file for why the fix must not be guessed at.
   */
  it.fails(
    'KNOWN-OPEN GAP: an org_admin with no approver grant is still offered "Approve Payroll"',
    async () => {
      // Breadth, not depth: configures Vetana, must not release money from it.
      const adminOnly = users.orgAdmin({
        module_grants: ['vetana'],
        module_levels: { vetana: ADMIN },
      });
      await openPayrollRun(adminOnly);

      const approve = host.$$('button').find(b => /approve payroll/i.test(b.textContent));
      expect(approve, 'org_admin was offered the payroll approve control').toBeFalsy();
    },
  );

  /**
   * ── PINNED KNOWN-OPEN GAP ─────────────────────────────────────────────
   * The stronger form: even if the control were merely hidden, clicking
   * through must not reach the endpoint. Nothing checks the level, so it does.
   */
  it.fails(
    'KNOWN-OPEN GAP: nothing stops the approve request reaching the API',
    async () => {
      const adminOnly = users.orgAdmin({
        module_grants: ['vetana'],
        module_levels: { vetana: ADMIN },
      });
      const mock = await openPayrollRun(adminOnly);

      const approve = host.$$('button').find(b => /approve payroll/i.test(b.textContent));
      if (approve) await host.click(approve);

      expect(
        mock.calledWith('PATCH', '/approve'),
        'an admin-only grant reached the payroll approve endpoint',
      ).toHaveLength(0);
    },
  );

  it('the frontend has no level gate around the approve control — recorded, not asserted away', () => {
    // A statement of fact with a citation, so the report and the code agree.
    // When enforcement lands this test is the second one to update.
    //
    // Reads the WHOLE Vetana module, not one file. Vetana has since been split
    // per 13-module-pages.md into a route file plus `pages/vetana/*` — the
    // approve control now lives in `vetana/PayrollTab.jsx`. Pinned to a single
    // path, this check went red on a pure file move (which is noise) and would
    // have gone GREEN and silent had the control merely been moved to a file
    // the path no longer named (which is the failure that matters). Scanning
    // the directory is immune to both.
    const files = [
      path.join(SRC_DIR, 'pages/VetanaPage.jsx'),
      ...readdirSync(path.join(SRC_DIR, 'pages/vetana'))
        .filter(f => /\.jsx?$/.test(f))
        .map(f => path.join(SRC_DIR, 'pages/vetana', f)),
    ];
    const vetana = files.map(f => readFileSync(f, 'utf8')).join('\n');

    expect(vetana, 'the approve control has left the Vetana module').toMatch(/Approve Payroll/);
    expect(
      /levelSatisfies|APPROVER|require_module_level/.test(vetana),
      'Vetana now references a level check — flip the two it.fails pins above to it()',
    ).toBe(false);
  });
});
