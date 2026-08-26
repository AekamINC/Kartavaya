/**
 * The Pahchan consent tab — what it must say, and what it must never say.
 *
 * `staging.pahchan_employee_consents` (migration 209), `POST /consent`,
 * `GET /consent` and the enrolment refusal that reads them shipped in August
 * with no caller. Measured read-only on the live database 2026-08-26: **24
 * reference photographs against 12 employees, 0 consent rows.** This is the
 * screen that closes that, and three of the assertions below are about it being
 * closed HONESTLY rather than merely closed.
 *
 * ── THE THREE THAT EARN THIS FILE ──────────────────────────────────────────
 *
 *   · NO CERTIFICATION CLAIM. `BANNED_CLAIMS` is checked against the rendered
 *     text of the whole tab, not against the copy module, so a claim arriving
 *     through a server string or a future component fails the same as a
 *     literal. Aekam holds no certification of any kind and a consent screen is
 *     where an unearned one does the most damage — the customer repeats it to
 *     their regulator as something their software told them.
 *
 *   · NO DELETION PROMISE. Nothing in the product deletes a stored reference
 *     photograph on withdrawal: `services/pahchan_retention.py::
 *     purge_reference_photos` only reaches a pair whose employee record is
 *     'terminated', 'resigned' or 'absconding'. A withdrawal screen saying
 *     "your photos are deleted" would be the one sentence no code keeps.
 *
 *   · THREE STATES, NOT TWO. Twelve enrolled faces with no consent row are not
 *     twelve refusals and not twelve agreements. "No answer yet" is a job;
 *     "Declined" is an answer. A screen that renders the first as the second
 *     would report the finding as solved.
 */
import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork, makeHost, httpError, settle,
} from './_harness';
import { ToastProvider } from '../../components/ui/toast';

import Consent from '../../pages/pahchan/Consent';
import History from '../../pages/pahchan/History';
import { BANNED_CLAIMS } from '../../pages/pahchan/consentCopy';

let host; let mock;

const RETENTION = {
  punch_photo_days: 30,
  reference_photo_grace_days: 45,
  record_retention_years: 3,
};

/** A uuid the screen is handed and must never draw. */
const ENROLLED_ID = 'f2b6a0de-4f0e-4d1a-9c1e-2f0f0d8c7b31';
const DECLINED_ID = '0c9a1e77-3b2d-4e55-8a6f-11d4c3b2a190';

function me(over = {}) {
  return {
    employee: { id: 'emp-1', name: 'A Person' },
    punches: [],
    retention: RETENTION,
    rules: null,
    notice: { version: 'v', acknowledged_at: '2026-08-01T00:00:00Z' },
    consent: null,
    ...over,
  };
}

const ROSTER = {
  notice_version: '2026-08-06.1',
  employees: [
    {
      employee_id: ENROLLED_ID, employee_name: 'Aarav Trivedi',
      employee_code: 'UNI-008', approved_refs: 2,
      notice_version: null, method: null, consented: null,
      recorded_at: null, note: null, recorded_by_name: null,
    },
    {
      employee_id: DECLINED_ID, employee_name: 'Meera Nair',
      employee_code: 'UNI-010', approved_refs: 0,
      notice_version: '2026-08-06.1', method: 'paper', consented: false,
      recorded_at: '2026-08-20T06:00:00Z', note: 'Form filed with HR',
      recorded_by_name: 'Keval Shah',
    },
  ],
};

function routes(over = {}) {
  return {
    'GET /v1/pahchan/me': me(),
    'GET /v1/pahchan/consent/roster': ROSTER,
    'GET /v1/pahchan/attendance/manual': [],
    'POST /v1/pahchan/consent/me': { consented: false, method: 'self_acknowledged' },
    'POST /v1/pahchan/consent': { consented: false },
    'POST /v1/pahchan/attendance/manual': { id: 'a1', date: '2026-08-26' },
    ...over,
  };
}

beforeEach(() => {
  installNetworkKillSwitch();
  mock = installMockApi(routes());
  host = makeHost();
});

afterEach(() => { host.unmount(); restoreNetwork(); vi.restoreAllMocks(); });

const wrap = node => <ToastProvider>{node}</ToastProvider>;

/** Every button on the mounted tab, by its trimmed text. */
function button(text) {
  return [...host.container.querySelectorAll('button')]
    .find(b => (b.textContent || '').trim().toLowerCase().includes(text.toLowerCase()));
}

async function click(el) {
  expect(el, 'the control was not rendered').toBeTruthy();
  await act(async () => { el.click(); });
  await settle();
}

describe('what the consent screen may never say', () => {
  it('claims no certification, anywhere on the tab', async () => {
    await host.render(wrap(<Consent />));
    const text = (host.container.textContent || '').toLowerCase();
    const claimed = BANNED_CLAIMS.filter(w => text.includes(w));
    expect(claimed, `the screen claims: ${claimed.join(', ')}`).toEqual([]);
  });

  it('does not promise that withdrawing deletes photographs already on file', async () => {
    await host.render(wrap(<Consent />));
    const text = host.container.textContent || '';
    // The true sentence is present…
    expect(text).toContain('Photographs already on file are not removed by this on their own');
    // …and the flattering one is not, in any of the shapes it would take.
    expect(text).not.toMatch(/photograph[s]? (are|will be) deleted (when|if) you withdraw/i);
    expect(text).not.toMatch(/withdraw.{0,40}\bdeleted\b/i);
  });

  it('never draws an employee id', async () => {
    await host.render(wrap(<Consent />));
    const text = host.container.textContent || '';
    expect(text).not.toContain(ENROLLED_ID);
    expect(text).not.toContain(DECLINED_ID);
    expect(text).toContain('Aarav Trivedi');
  });
});

describe('the four things a DPDP notice has to state', () => {
  it('states what is captured, why, how long, and how to withdraw', async () => {
    await host.render(wrap(<Consent />));
    const text = host.container.textContent || '';
    expect(text).toContain('A photo of your face each time you clock in or out');
    expect(text).toContain('To confirm that the person marking attendance is you');
    expect(text).toContain('You can change this answer whenever you like');
  });

  it('quotes the ORGANISATION’s retention window, not a constant', async () => {
    // `/me` says 30 days. A screen printing the hardcoded 90 would be making a
    // promise about a different system — `pahchanNotice.js`'s own rule.
    await host.render(wrap(<Consent />));
    const text = host.container.textContent || '';
    expect(text).toContain('Punch photos are deleted after 30 days');
    expect(text).not.toContain('deleted after 90 days');
  });

  it('separates the obligation from the choice', async () => {
    await host.render(wrap(<Consent />));
    const text = host.container.textContent || '';
    expect(text).toContain('being marked present is not optional');
    expect(text).toContain('that part is your choice');
  });
});

describe('the employee’s own answer', () => {
  it('offers both answers when nobody has recorded one', async () => {
    await host.render(wrap(<Consent />));
    expect(host.container.textContent).toContain('No answer yet');
    expect(button('I agree')).toBeTruthy();
    expect(button('I decline')).toBeTruthy();
  });

  it('declining posts the employee’s own answer', async () => {
    await host.render(wrap(<Consent />));
    await click(button('I decline'));
    const [post] = mock.calledWith('POST', '/v1/pahchan/consent/me');
    expect(post).toBeTruthy();
    expect(post.body.consented).toBe(false);
    // The route carries no employee_id — the server resolves the caller's own
    // row and that is the whole authorisation.
    expect(post.body.employee_id).toBeUndefined();
  });

  it('offers withdrawal, and withdrawal is the same route with the other boolean', async () => {
    mock.route({
      'GET /v1/pahchan/me': me({
        consent: {
          consented: true, method: 'self_acknowledged',
          recorded_at: '2026-08-20T06:00:00Z', notice_version: 'v', note: null,
        },
      }),
    });
    await host.render(wrap(<Consent />));
    expect(host.container.textContent).toContain('Agreed');
    await click(button('Withdraw my agreement'));
    const [post] = mock.calledWith('POST', '/v1/pahchan/consent/me');
    expect(post.body.consented).toBe(false);
  });

  it('says so plainly when the account has no employee record', async () => {
    // 107 of 109 employee rows carry no user_id, so `POST /consent/me` answers
    // 409 for almost every account. A button that always fails is worse than a
    // sentence — the same call `Clock.jsx` makes.
    mock.route({ 'GET /v1/pahchan/me': me({ employee: null }) });
    await host.render(wrap(<Consent />));
    expect(host.container.textContent).toContain('not linked to an employee record');
    expect(button('I agree')).toBeFalsy();
    expect(button('I decline')).toBeFalsy();
  });
});

describe('the roster, which is where the finding lives', () => {
  it('counts the people whose face is on file with no answer recorded', async () => {
    await host.render(wrap(<Consent />));
    const text = host.container.textContent || '';
    expect(text).toContain('One person has reference photographs on file and no recorded answer');
  });

  it('shows "no answer" as a job, not as a refusal', async () => {
    await host.render(wrap(<Consent />));
    const text = host.container.textContent || '';
    expect(text).toContain('No answer yet');
    expect(text).toContain('Declined');
    // Both states present and distinguishable — the row with two photos is not
    // the row that said no.
    expect(text).toContain('2 of 2');
  });

  it('offers the alternative attendance path only to somebody who declined', async () => {
    await host.render(wrap(<Consent />));
    const rows = [...host.container.querySelectorAll('tbody tr')];
    const declined = rows.find(r => (r.textContent || '').includes('Meera Nair'));
    const enrolled = rows.find(r => (r.textContent || '').includes('Aarav Trivedi'));
    expect([...declined.querySelectorAll('button')].map(b => b.textContent.trim()))
      .toContain('Record a day');
    expect([...enrolled.querySelectorAll('button')].map(b => b.textContent.trim()))
      .not.toContain('Record a day');
  });

  it('records a day on the manual path', async () => {
    await host.render(wrap(<Consent />));
    await click(button('Record a day'));
    await click(button('Record this day'));
    const [post] = mock.calledWith('POST', '/v1/pahchan/attendance/manual');
    expect(post).toBeTruthy();
    expect(post.body.employee_id).toBe(DECLINED_ID);
    expect(post.body.status).toBe('present');
    // An offset-bearing instant, not a naive wall clock the server would
    // resolve in its own time zone.
    expect(post.body.check_in).toMatch(/Z$/);
  });

  it('records somebody else’s answer with the method it was obtained by', async () => {
    await host.render(wrap(<Consent />));
    await click(button('Record answer'));
    await click(button('Record this answer'));
    const [post] = mock.calledWith('POST', '/v1/pahchan/consent');
    expect(post.body.employee_id).toBe(ENROLLED_ID);
    // `paper` or `verbal_witnessed` — never `self_acknowledged`, which is a
    // claim that the person tapped something themselves.
    expect(['paper', 'verbal_witnessed']).toContain(post.body.method);
  });
});

describe('a non-admin', () => {
  it('keeps their own card when the roster refuses them', async () => {
    mock.route({ 'GET /v1/pahchan/consent/roster': httpError(403, 'Only an org admin') });
    await host.render(wrap(<Consent />));
    const text = host.container.textContent || '';
    // The tab does not fall over: their own answer is the point of it.
    expect(text).toContain('Your choice about the photograph');
    expect(button('I decline')).toBeTruthy();
    expect(text).toContain('Only your organisation');
    expect(text).not.toContain('Aarav Trivedi');
  });

  it('is not told they are not an admin when the roster simply failed', async () => {
    // Collapsing 403 into "everything else" tells an admin whose request timed
    // out that they lack a permission they hold — a wrong answer somebody acts
    // on, by asking for access they already have.
    mock.route({ 'GET /v1/pahchan/consent/roster': httpError(500, 'boom') });
    await host.render(wrap(<Consent />));
    const text = host.container.textContent || '';
    expect(text).toContain('did not load');
    expect(text).not.toContain('Only your organisation');
  });
});

describe('the attendance history of somebody who declined', () => {
  /**
   * An empty month with no explanation reads as "your attendance is not being
   * recorded" — which is exactly the fear that makes somebody withdraw a
   * refusal they were entitled to make. Their days are in
   * `staging.manav_attendance` and this screen does not read that table, so it
   * says where they are rather than drawing a register that cannot hold them.
   */
  it('says where their hours are, instead of an unexplained empty calendar', async () => {
    mock.route({
      'GET /v1/pahchan/me': me({
        consent: {
          consented: false, method: 'paper', notice_version: 'v',
          recorded_at: '2026-08-20T06:00:00Z', note: null,
        },
      }),
      'GET /v1/pahchan/regularisations/mine': [],
    });
    await host.render(wrap(<History />));
    const text = host.container.textContent || '';
    expect(text).toContain('Your supervisor records your hours instead');
    expect(text).toContain('Consent tab');
  });

  it('says nothing of the kind to somebody who agreed', async () => {
    mock.route({ 'GET /v1/pahchan/regularisations/mine': [] });
    await host.render(wrap(<History />));
    expect(host.container.textContent).not.toContain('Your supervisor records your hours');
  });
});
