/**
 * Onboarding · the Team step, and the endpoint it actually reaches.
 *
 * This step posted to `/admin/invites` — `invite_router.py`, behind
 * `require_platform_role(*CONSOLE_ROLES)`. That dependency reads
 * `staging.user_roles WHERE org_id IS NULL`, and a customer's org_owner has no
 * such row, so **the invite step 403'd for exactly the people who run
 * onboarding**. Aekam staff were the only ones it worked for, and for them it
 * wrote `org_id NULL` — an account belonging to no organisation.
 *
 * The two things pinned here are therefore the endpoint and the role
 * vocabulary. `POST /v1/org/invites` validates `org_role` against
 * `INVITABLE_ROLES` (`org_owner` · `org_admin` · `org_member`), so the old
 * `member` / `admin` account types would have come back "Invalid role: member"
 * even once the path was right.
 *
 * Nothing is sent anywhere: the network kill switch is installed and the API is
 * mocked, so no invitation email can leave this suite.
 */
import React from 'react';
import { Route } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import OnboardingPage from '../../pages/onboarding/OnboardingPage';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork, httpError,
  makeHost, clearSession, signIn, settle, users,
} from './_harness';

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

const routes = [
  <Route key="o" path="/onboarding" element={<OnboardingPage />} />,
  <Route key="d" path="/dashboard" element={<div data-landed="dashboard" />} />,
];

/** Walk the owner's rail to the Team step and queue one address. */
async function reachTeamStepWith(email) {
  await host.mount(null, { path: '/onboarding', routes });
  await settle();

  // Profile → Organisation → Modules → Team.
  await host.click('Continue');
  await host.click('Continue');
  await host.click(host.$('.ob__next'));

  await host.fill('.ob__invite input', email);
  await host.click('Add');
}

describe('onboarding · Team step', () => {
  it('invites through the ORGANISATION endpoint, with an org role', async () => {
    signIn(users.orgOwner());
    const mock = installMockApi({
      'POST /v1/org/invites': { invite_id: 'inv_1', email: 'rohan@aekam.co' },
    });

    await reachTeamStepWith('rohan@aekam.co');
    await host.click(host.$('.ob__next'));

    const posts = mock.calledWith('POST', '/v1/org/invites');
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ email: 'rohan@aekam.co', org_role: 'org_member' });

    // The platform console is not touched. Reaching it at all would mean an
    // org_owner getting a 403 on the one step of the wizard that sends mail.
    expect(mock.calledWith('POST', '/admin/invites')).toHaveLength(0);
  });

  it('sends exactly one request per invitee even when the gateway 503s', async () => {
    // api.js retries 502/503/504 three times, and this endpoint SENDS AN EMAIL.
    // A 503 in the Railway restart window arrives after the invite was created
    // and the person mailed, so each retry mails them again.
    signIn(users.orgOwner());
    const mock = installMockApi({ 'POST /v1/org/invites': httpError(503, 'gateway') });

    await reachTeamStepWith('rohan@aekam.co');
    await host.click(host.$('.ob__next'));

    expect(mock.calledWith('POST', '/v1/org/invites')).toHaveLength(1);
  });

  it('offers the roles the endpoint accepts, not account types', async () => {
    signIn(users.orgOwner());
    installMockApi({});

    await reachTeamStepWith('rohan@aekam.co');

    const values = host.$$('.ob__row select option').map((o) => o.value);
    expect(values).toEqual(['org_member', 'org_admin']);
  });

  it('upgrades an invite list saved under the old role vocabulary', async () => {
    // `kv_onboarding` outlives a release. A part-filled list from before the
    // change would otherwise be sent as "Invalid role: member", once per person.
    signIn(users.orgOwner());
    localStorage.setItem('kv_onboarding', JSON.stringify({
      invites: [{ email: 'a@firm.in', role: 'member' }, { email: 'b@firm.in', role: 'admin' }],
    }));
    const mock = installMockApi({ 'POST /v1/org/invites': { invite_id: 'inv_1' } });

    await host.mount(null, { path: '/onboarding', routes });
    await settle();
    await host.click('Continue');
    await host.click('Continue');
    await host.click(host.$('.ob__next'));
    await host.click(host.$('.ob__next'));

    const roles = mock.calledWith('POST', '/v1/org/invites').map((c) => c.body.org_role);
    expect(roles).toEqual(['org_member', 'org_admin']);
  });
});
