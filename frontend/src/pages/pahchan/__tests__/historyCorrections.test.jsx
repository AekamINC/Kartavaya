/**
 * Pahchan → My attendance: asking for a day to be corrected, on the web.
 *
 * ── WHAT THE SCREEN USED TO SAY ──────────────────────────────────────────────
 *
 * `History` is the one Pahchan tab that needs no reviewer role — it reads
 * `GET /v1/pahchan/me`, which returns no photo keys and no coordinates. An
 * employee opens a day with no punch on it and the empty state read:
 *
 *   "No punch on this day. If that is wrong, open this day on your own register
 *    in the Kartavaya app and ask for a correction…"
 *
 * That sentence was accurate and it is the wrong thing for a product to have to
 * say. A missing clock-out costs the employee that day's pay. Both endpoints
 * that fix it are SELF-SERVICE and need no grant —
 *
 *   · `POST /v1/pahchan/regularisations`      resolves the employee from the
 *     caller's own row and 403s on anybody else's
 *   · `GET  /v1/pahchan/regularisations/mine` joins the caller's user_id and
 *     takes no employee parameter at all
 *
 * — and `mobile/src/api/pahchan.ts` calls both. Neither had a caller anywhere in
 * `frontend/src`. So the web told a person whose pay was wrong to go and find a
 * phone, and `pahchan_attendance.py`'s own docstring names the outcome: "They
 * would ask a manager, which is the phone call the feature was built to remove."
 *
 * `decision_note` is asserted on purpose. A refusal with no reason is the thing
 * that generates that phone call, and the endpoint returns it specifically so a
 * screen can show it.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import History from '../History';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork, makeHost, settle, httpError,
} from '../../../__tests__/e2e/_harness';

const ME = 'GET /v1/pahchan/me';
const MINE = 'GET /v1/pahchan/regularisations/mine';
const ASK = 'POST /v1/pahchan/regularisations';

const EMPLOYEE = { id: 'emp-1', name: 'Priya Deshmukh' };
const RETENTION = {
  punch_photo_days: 30,
  reference_photo_grace_days: 45,
  record_retention_years: 3,
};

/** A day this month with a clock-in and no clock-out — the case that costs pay. */
function openDayPunch() {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), 1, 9, 41, 0);
  return {
    id: 'punch-1',
    direction: 'in',
    captured_at: day.toISOString(),
    received_at: day.toISOString(),
    source: 'live',
    flags: [],
    accuracy_m: 12,
    distance_m: 4,
    review_verdict: null,
  };
}

const DAY_NUMBER = 1;

const ME_BODY = {
  employee: EMPLOYEE,
  punches: [openDayPunch()],
  retention: RETENTION,
  notice: { version: '2026-08-06.1', acknowledged_at: null },
};

let host;
let mock;

beforeEach(() => {
  installNetworkKillSwitch();
  host = makeHost();
});

afterEach(async () => {
  await host.unmount();
  restoreNetwork();
});

const text = () => host.container.textContent;
const buttons = () => [...host.container.querySelectorAll('button')];
const byLabel = (label) =>
  buttons().find(b => b.textContent.trim().toLowerCase().startsWith(label.toLowerCase()));

/** Open the day-detail panel for the day the punch above sits on. */
async function openTheDay() {
  const cell = buttons().find(b => (b.getAttribute('aria-label') || '').startsWith(`${DAY_NUMBER} `));
  expect(cell).toBeTruthy();
  await act(async () => { cell.click(); });
  await settle();
}

describe('Pahchan history — an employee can ask for a correction here', () => {
  it('lists the corrections this person has already asked for', async () => {
    mock = installMockApi({
      [ME]: ME_BODY,
      [MINE]: [
        {
          id: 'reg-1', for_date: '2026-08-03', requested_direction: 'out',
          requested_at_time: '2026-08-03T12:30:00Z', reason: 'Phone battery died at the site.',
          status: 'declined', decided_at: '2026-08-04T05:00:00Z',
          decision_note: 'The gate log shows an exit at 10:20.',
          created_at: '2026-08-03T14:00:00Z',
        },
      ],
    });
    await host.mount(<History />);
    await settle();

    expect(mock.calledWith('GET', '/regularisations/mine').length).toBe(1);
    expect(text()).toContain('Phone battery died at the site.');
    // The reason for the refusal, which is the only thing the employee can act
    // on and the reason the endpoint returns it.
    expect(text()).toContain('The gate log shows an exit at 10:20.');
  });

  it('offers the form on a day, and posts what the endpoint requires', async () => {
    mock = installMockApi({
      [ME]: ME_BODY,
      [MINE]: [],
      [ASK]: { id: 'reg-2', status: 'pending' },
    });
    await host.mount(<History />);
    await settle();
    await openTheDay();

    const ask = byLabel('Ask for a correction');
    expect(ask).toBeTruthy();
    await act(async () => { ask.click(); });
    await settle();

    const form = host.container.querySelector('form.ph__askform');
    expect(form).toBeTruthy();

    const time = form.querySelector('input[type="time"]');
    const reason = form.querySelector('textarea');
    const direction = form.querySelector('select');
    await act(async () => {
      const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setV.call(time, '18:05');
      time.dispatchEvent(new window.Event('input', { bubbles: true }));

      const setT = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setT.call(reason, 'I clocked out at the gate but the app had no signal.');
      reason.dispatchEvent(new window.Event('input', { bubbles: true }));

      const setS = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setS.call(direction, 'out');
      direction.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await settle();

    await act(async () => {
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();

    const posted = mock.calledWith('POST', '/regularisations');
    expect(posted.length).toBe(1);
    const sent = posted[0].body;
    // Every field `RegularisationCreate` declares required, and the employee id
    // taken from `/me` rather than typed — the endpoint refuses anybody else's.
    expect(sent.employee_id).toBe('emp-1');
    expect(sent.requested_direction).toBe('out');
    expect(sent.reason).toContain('no signal');
    // `for_date` is a plain day and `requested_at_time` is a timestamp on it,
    // because the column is `timestamptz` and a bare "18:05" is not one.
    expect(sent.for_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(sent.requested_at_time).getHours()).toBe(18);
  });

  it('a failed request list is a failure, never "you have asked for none"', async () => {
    mock = installMockApi({
      [ME]: ME_BODY,
      [MINE]: httpError(500, ''),
    });
    await host.mount(<History />);
    await settle();

    expect(text()).toContain('did not load');
    expect(text()).not.toContain('You have not asked for any corrections');
  });

  it('a genuinely empty list still says so', async () => {
    mock = installMockApi({ [ME]: ME_BODY, [MINE]: [] });
    await host.mount(<History />);
    await settle();

    expect(text()).toContain('You have not asked for any corrections');
  });

  it('an unlinked account is not offered a form it cannot use', async () => {
    // `POST /regularisations` resolves the employee from `manav_employees.user_id`
    // and 403s when there is none. Every employee row on this database has a null
    // user_id today, so this is the branch most callers land in — offering the
    // form here would be a button that always fails.
    mock = installMockApi({
      [ME]: { employee: null, punches: [], retention: RETENTION, notice: {} },
      [MINE]: [],
    });
    await host.mount(<History />);
    await settle();

    expect(text()).toContain('No employee record');
    expect(byLabel('Ask for a correction')).toBeFalsy();
  });
});
