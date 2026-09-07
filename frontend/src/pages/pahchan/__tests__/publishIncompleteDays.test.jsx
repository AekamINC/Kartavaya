/**
 * Pahchan → Payroll: a day with a punch but no pair has to be visible HERE.
 *
 * ── WHY THIS SCREEN, AND WHY ITS OWN TABLE ───────────────────────────────────
 *
 * `services/attendance_bridge.py` answers `incomplete` for a day it cannot
 * price — clocked in and never out, or an out before an in. That is not a value
 * `manav_attendance.status` accepts, so until 2026-09-07 the publish route
 * inserted it anyway and the CHECK refused it: one forgotten clock-out 500'd
 * the entire publish. It had never fired because `pahchan_punches` holds zero
 * rows, which is the whole reason nobody had seen it.
 *
 * The fix withholds those days and returns them as `incomplete_days`. This
 * screen is where an operator finds out, so a list arriving in the response and
 * rendering nowhere would leave the defect half-fixed: no 500, and no way to
 * learn that somebody's month is short.
 *
 * ⚠ THE DISTINCTION THESE TESTS EXIST TO PROTECT is that `incomplete_days` and
 * `withheld_days` have DIFFERENT REMEDIES. A withheld day has flagged punches
 * nobody has reviewed — the fix is a review, on the Register. An incomplete day
 * has evidence and a gap — the fix is a REGULARISATION, on Corrections. Folding
 * them into one list would send half the operators to the wrong screen.
 *
 * ── EVERY ASSERTION IS SCOPED TO AN ELEMENT, AND THAT IS NOT STYLE ───────────
 *
 * The first draft of this file asserted against `container.textContent`, and
 * three mutations proved it hollow: deleting the whole table still passed four
 * of six tests, because the FIGURE's label ("Incomplete — no pair") and its
 * hint ("…a regularisation on Corrections") satisfied the section's assertions
 * on their own — and deleting the figure passed all six, because the section
 * heading "Incomplete — no pair to price" contains the figure's label as a
 * substring. Each half was standing in for the other. Scoping to
 * `section.k-section` and `.ph__fig` is what makes the two independently
 * falsifiable.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import PublishPayroll from '../PublishPayroll';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork, makeHost, settle,
} from '../../../__tests__/e2e/_harness';

const POLICY = 'GET /v1/pahchan/policy';
const PUBLISH = 'POST /v1/pahchan/attendance/publish';

/** The shape the fixed route returns: two withheld kinds, counted apart. */
function publishResult(over = {}) {
  return {
    dry_run: true,
    days_built: 18,
    days_withheld_pending_review: 1,
    rows_written: 0,
    skipped_manual_rows: 0,
    skipped_manual: [],
    withheld_days: [
      { employee_id: 'emp-9', date: '2026-09-04', employee_name: 'Anjali Desai' },
    ],
    incomplete_rows: 2,
    incomplete_days: [
      { employee_id: 'emp-1', date: '2026-09-02', employee_name: 'Priya Deshmukh' },
      { employee_id: 'emp-2', date: '2026-09-03', employee_name: 'Ravi Menon' },
    ],
    overtime: {
      computed: false,
      reason: 'overtime_enabled is off for this organisation.',
      daily_threshold_hours: 9,
      weekly_threshold_hours: 48,
      multiplier: 2,
    },
    ...over,
  };
}

let host;

beforeEach(() => {
  installNetworkKillSwitch();
  host = makeHost();
});

afterEach(async () => {
  await host.unmount();
  restoreNetwork();
});

const buttons = () => [...host.container.querySelectorAll('button')];

/** The `<section>` whose OWN heading contains `title`. */
function sectionByTitle(title) {
  return [...host.container.querySelectorAll('section.k-section')]
    .find(s => (s.querySelector('.k-section__title')?.textContent || '').includes(title));
}

/** The figure whose OWN label contains `label`. */
function figureByLabel(label) {
  return [...host.container.querySelectorAll('.ph__fig')]
    .find(f => (f.querySelector('.ph__fig-l')?.textContent || '').includes(label));
}

const INCOMPLETE = 'Incomplete — no pair to price';
const WITHHELD = 'Withheld, pending review';

async function preview(result) {
  installMockApi({ [POLICY]: {}, [PUBLISH]: result });
  await host.mount(<PublishPayroll />);
  const btn = buttons().find(b => /preview/i.test(b.textContent));
  expect(btn, 'the preview button must exist or this test proves nothing').toBeTruthy();
  await act(async () => { btn.click(); });
  await settle();
}

describe('Pahchan publish — an incomplete day is shown, not swallowed', () => {
  it('lists each incomplete day by employee NAME and date, in its own table', async () => {
    await preview(publishResult());

    const sec = sectionByTitle(INCOMPLETE);
    expect(sec, 'the incomplete section must render').toBeTruthy();

    const rows = [...sec.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Priya Deshmukh');
    expect(rows[0].textContent).toContain('2026-09-02');
    expect(rows[1].textContent).toContain('Ravi Menon');
    expect(rows[1].textContent).toContain('2026-09-03');
  });

  it('never renders an employee id in that table', async () => {
    await preview(publishResult());
    const sec = sectionByTitle(INCOMPLETE);
    // The ids are in the payload; a column headed "Employee" must not draw one.
    expect(sec.textContent).not.toContain('emp-1');
    expect(sec.textContent).not.toContain('emp-2');
  });

  it('keeps incomplete and withheld in SEPARATE tables', async () => {
    await preview(publishResult());

    const incomplete = sectionByTitle(INCOMPLETE);
    const withheld = sectionByTitle(WITHHELD);
    expect(withheld, 'the withheld section must still render').toBeTruthy();
    expect(incomplete).not.toBe(withheld);

    // Neither list has absorbed the other's rows.
    expect(incomplete.textContent).not.toContain('Anjali Desai');
    expect(withheld.textContent).not.toContain('Priya Deshmukh');
  });

  it('names the remedy IN THAT SECTION, and it is a regularisation', async () => {
    await preview(publishResult());
    const sec = sectionByTitle(INCOMPLETE);
    expect(sec.textContent).toMatch(/regularisation/i);
    expect(sec.textContent).toMatch(/Corrections/);
    // The other section sends people somewhere else, and must keep doing so.
    expect(sectionByTitle(WITHHELD).textContent).toMatch(/Register/);
  });

  it('shows the incomplete COUNT as its own figure', async () => {
    await preview(publishResult({ incomplete_rows: 7 }));

    const fig = figureByLabel('Incomplete — no pair');
    expect(fig, 'the incomplete figure must render').toBeTruthy();
    expect(fig.querySelector('.ph__fig-v').textContent.trim()).toBe('7');
  });

  it('renders no incomplete SECTION when there are none, and still shows the figure', async () => {
    // The negative control. A section that is always present would make every
    // assertion above pass without the data ever arriving.
    await preview(publishResult({ incomplete_rows: 0, incomplete_days: [] }));

    expect(sectionByTitle(INCOMPLETE)).toBeFalsy();
    expect(figureByLabel('Incomplete — no pair').querySelector('.ph__fig-v').textContent.trim())
      .toBe('0');
    // …while the withheld list, which still has a row, is untouched.
    expect(sectionByTitle(WITHHELD).textContent).toContain('Anjali Desai');
  });
});
