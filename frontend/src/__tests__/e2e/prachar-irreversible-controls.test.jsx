/**
 * Prachar's two irreversible controls must not lie about what they will do.
 *
 * TWO FINDINGS, ONE FILE, because both are the same failure: a button that is
 * offered before — or instead of — the thing it claims to do.
 *
 * ── 1 · Send now, offered before the number it confirms against ───────────
 *
 * `CampaignDetail.send()` builds its confirmation from `audience.data`, and the
 * button was live from the moment the drawer mounted, while that fetch was
 * still in flight. Press it in that window and `n` is undefined, so the confirm
 * takes its `n == null` branch and reads
 *
 *     Send "S11-C7" to this campaign's audience? … This cannot be undone.
 *
 * with NO NUMBER AT ALL. Captured verbatim by proposal 93 Suite 11 on
 * 2026-08-29 — the run's own report holds that string — while the send itself
 * went correctly to 18 of 24.
 *
 * That is the same defect this screen already fixed one step earlier: the
 * comment in `send()` records a marketer agreeing to 128 while 116 were sent.
 * Quoting NO number is not safer than quoting the wrong one.
 *
 * ⚠ The gate is on `loading`, never on `data`, and the third test below is the
 * one that matters: if the audience fetch FAILS, the button must stay pressable
 * — the Panel already shows that error with a Retry, and locking an operator
 * out of their own send would be a worse bug than the one being fixed.
 *
 * ── 2 · Resume, and the button that looked like it ────────────────────────
 *
 * `POST /sequences/{id}/resume` makes TWO writes: the sequence back to
 * `active`, AND every enrolment the pause froze back from `paused` to
 * `active`. `PATCH /sequences/{id} {status:'active'}` — what `Activate` calls —
 * makes only the first, and the drip cron requires BOTH
 * (`marketing_skills.py`: `WHERE e.status = 'active' AND s.status = 'active'`).
 *
 * `93-E-ORPHANED-CAPABILITY-SWEEP.md` filed this as "pause is a one-way door;
 * there is no Resume button". Half right: no control called the resume route.
 * The other half is worse than a dead end — `Activate` DID render on a paused
 * sequence, so the door looked open, and pressing it turned the badge green
 * while leaving every contact frozen for ever.
 *
 * ⚠ MEASURED on live rows, not argued. Suite 11 drove Pause and then the only
 * control offered, and the database read:
 *
 *     S11-SEQ-1   sequence 'active'   ·   8 of 8 enrolments 'paused'
 *
 * So the assertion that carries this file is not "a Resume button exists" — it
 * is WHICH ROUTE the control on a paused sequence calls, because a Resume
 * button wired to the PATCH would pass a by-label test and still strand
 * everybody.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork, makeHost, settle, httpError,
} from './_harness';

import CampaignsTab from '../../pages/prachar/CampaignsTab';
import SequencesTab from '../../pages/prachar/SequencesTab';

let host; let mock;

beforeEach(() => {
  installNetworkKillSwitch();
  host = makeHost();
});

afterEach(() => {
  host.unmount();
  restoreNetwork();
});

/** One campaign, in the only state that offers Send. */
const CAMPAIGN = {
  id: 'c-7', name: 'S11-C7', status: 'draft', channel: 'email',
  subject: 'After the opt-outs', body_html: 'Hello {{name}}',
  scheduled_at: '2026-09-05T09:00:00Z', total_recipients: 0,
  audience_filter: { company: 'S11 Prachar Reach' },
};

/** The audience as the server sends it: 24 matched, 6 opted out, 18 reached. */
const AUDIENCE = {
  count: 24, matched: 24, unsubscribed: 6, will_receive: 18,
  contacts: [], truncated: false,
  filter: CAMPAIGN.audience_filter,
  summary: 'contacts who are linked to an existing client and whose company matches “S11 Prachar Reach”',
  client_only: true, client_recipients: 18, non_client_recipients: 0, icai_block: false,
  icai_citation: 'Clause (6), Part I, First Schedule, Chartered Accountants Act 1949',
};

const STATS = { total: 0, sent: 0, opened: null, clicked: null, bounced: null, failed: 0 };

/** A promise nothing ever settles — the in-flight audience fetch, held open. */
const NEVER = () => new Promise(() => {});

function campaignRoutes(audience) {
  return {
    'GET /v1/prachar/campaigns': { data: [CAMPAIGN] },
    'GET /v1/prachar/templates': { data: [] },
    'GET /v1/prachar/campaigns/c-7/stats': STATS,
    'GET /v1/prachar/campaigns/c-7/audience': audience,
    'GET /v1/prachar/audience/options': { types: [], sources: [], companies: [] },
    'POST /v1/prachar/audience/preview': AUDIENCE,
  };
}

/** Open the one campaign in the list, from the List view, as a person does. */
async function openCampaign() {
  const list = [...host.container.querySelectorAll('button')]
    .find(b => b.textContent.trim() === 'List');
  await host.click(list);
  const name = [...host.container.querySelectorAll('button')]
    .find(b => b.textContent.trim() === 'S11-C7');
  await host.click(name);
}

const sendButton = () => [...host.container.querySelectorAll('button')]
  .find(b => /^(Send now|Sending…)$/.test(b.textContent.trim()));

describe('Send now is not offered before the number it confirms against', () => {
  it('is DISABLED while the audience is still being counted', async () => {
    mock = installMockApi(campaignRoutes(NEVER));
    await host.mount(<CampaignsTab onChanged={() => {}} />);
    await openCampaign();

    const btn = sendButton();
    expect(btn, 'the campaign detail offers no Send control at all').toBeTruthy();
    expect(btn.disabled,
      'Send now is pressable while the audience count is still in flight — press it ' +
      'there and the confirmation reads "to this campaign\'s audience" with no ' +
      'number, on an action the same sentence calls irreversible').toBe(true);
    expect(btn.getAttribute('title') || '',
      'a disabled irreversible control must say WHY it is disabled')
      .toMatch(/who this reaches/i);
  });

  it('is ENABLED once the count has arrived', async () => {
    mock = installMockApi(campaignRoutes(AUDIENCE));
    await host.mount(<CampaignsTab onChanged={() => {}} />);
    await openCampaign();
    await settle();

    expect(sendButton().disabled,
      'Send now stayed disabled after the audience resolved — the operator can no ' +
      'longer send at all').toBe(false);
    // And the figure the confirm will quote is on the screen beside it, so the
    // number in the dialog is one the person has already seen.
    expect(host.container.textContent,
      'the detail does not state how many people will receive this')
      .toMatch(/18 people will receive this/);
  });

  it('⚠ is ENABLED when the audience fetch FAILS, and that is the point', async () => {
    // The gate is `loading`, never `data`. On an error `loading` is false and
    // `data` stays null, so the button must come back — the Panel above already
    // shows the failure with a Retry, and a permanently dead Send would be a
    // worse bug than the one this file fixes. The honest `n == null` wording is
    // deliberately kept for exactly this case.
    // `httpError` returns the REJECT MARKER the harness understands; it is a
    // route value, never something a handler throws.
    mock = installMockApi(campaignRoutes(httpError(500, 'audience blew up')));
    await host.mount(<CampaignsTab onChanged={() => {}} />);
    await openCampaign();
    await settle();

    expect(sendButton().disabled,
      'the audience fetch failed and Send is now permanently disabled — the operator ' +
      'is locked out of their own campaign by an error on a panel beside it').toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

const SEQ = {
  id: 's-1', name: 'S11-SEQ-1', description: 'Onboarding drip',
  status: 'paused', exit_on_reply: true, step_count: 4, active_enrollments: 0,
};

const SEQ_FULL = {
  sequence: SEQ,
  steps: [{ id: 'st1', step_order: 1, channel: 'email', delay_days: 0, subject: 'Welcome' }],
  enrollments: [
    { id: 'e1', contact_name: 'S11 Reach 01', contact_email: 'success+s11r01@simulator.amazonses.com', current_step: 1, status: 'paused', next_step_at: null },
  ],
};

const SEQ_STATS = { totals: { total: 8, active: 0, completed: 0, replied: 0, bounced: 0, unsubscribed: 0 }, steps: [] };

function sequenceRoutes() {
  return {
    'GET /v1/prachar/sequences': { data: [SEQ] },
    'GET /v1/prachar/sequences/s-1': SEQ_FULL,
    'GET /v1/prachar/sequences/s-1/stats': SEQ_STATS,
    'GET /v1/graha/contacts': { data: [] },
    'POST /v1/prachar/sequences/s-1/resume': { status: 'active', enrollments_resumed: 8 },
    'PATCH /v1/prachar/sequences/s-1': { status: 'updated' },
  };
}

async function openSequence() {
  const open = [...host.container.querySelectorAll('button')]
    .find(b => b.textContent.trim() === 'Open');
  await host.click(open);
}

describe('a paused sequence is resumed, not re-activated', () => {
  it('offers Resume and NOT Activate', async () => {
    mock = installMockApi(sequenceRoutes());
    await host.mount(<SequencesTab onChanged={() => {}} />);
    await openSequence();

    const labels = [...host.container.querySelectorAll('.k-detail__actions button')]
      .map(b => b.textContent.trim());
    expect(labels, 'a paused sequence offers no way back at all').toContain('Resume');
    expect(labels,
      'a paused sequence still offers Activate. That PATCHes the sequence to ' +
      "'active' and leaves every enrolment 'paused' — the cron requires both, so " +
      'the badge goes green and nobody is ever sent anything').not.toContain('Activate');
  });

  it('⚠ Resume calls the RESUME ROUTE, not the status PATCH', async () => {
    // The assertion that carries this file. A Resume button wired to
    // `PATCH {status:'active'}` would satisfy the label test above and strand
    // every enrolled contact exactly as before.
    mock = installMockApi(sequenceRoutes());
    await host.mount(<SequencesTab onChanged={() => {}} />);
    await openSequence();

    const resume = [...host.container.querySelectorAll('.k-detail__actions button')]
      .find(b => b.textContent.trim() === 'Resume');
    await host.click(resume);
    await settle();

    expect(mock.calledWith('POST', '/sequences/s-1/resume').length,
      'Resume did not call POST /sequences/{id}/resume — only that route puts the ' +
      "enrolments back to 'active'").toBe(1);
    expect(mock.calledWith('PATCH', '/sequences/s-1').length,
      "Resume PATCHed the sequence status instead of resuming it, which leaves every " +
      'frozen contact frozen').toBe(0);
  });

  it('says how many people it put back on the ladder', async () => {
    mock = installMockApi(sequenceRoutes());
    await host.mount(<SequencesTab onChanged={() => {}} />);
    await openSequence();

    const resume = [...host.container.querySelectorAll('.k-detail__actions button')]
      .find(b => b.textContent.trim() === 'Resume');
    await host.click(resume);
    await settle();

    // The route returns `enrollments_resumed` precisely so the operator learns
    // what actually restarted. A toast that only said "resumed" would leave the
    // one number that matters on the floor.
    expect(document.body.textContent, 'the Resume toast does not report how many ' +
      'contacts came back').toMatch(/8 contacts/);
  });

  it('a DRAFT sequence still offers Activate', async () => {
    // The other half of the branch, so narrowing it cannot have broken the
    // ordinary path. A draft has no paused enrolments for the PATCH to leave
    // behind, which is why it is the correct control there.
    mock = installMockApi({
      ...sequenceRoutes(),
      'GET /v1/prachar/sequences': { data: [{ ...SEQ, status: 'draft' }] },
      'GET /v1/prachar/sequences/s-1': { ...SEQ_FULL, sequence: { ...SEQ, status: 'draft' } },
    });
    await host.mount(<SequencesTab onChanged={() => {}} />);
    await openSequence();

    const labels = [...host.container.querySelectorAll('.k-detail__actions button')]
      .map(b => b.textContent.trim());
    expect(labels, 'a draft sequence with steps can no longer be activated').toContain('Activate');
    expect(labels, 'a draft sequence offers Resume, which would resume nothing')
      .not.toContain('Resume');
  });
});
