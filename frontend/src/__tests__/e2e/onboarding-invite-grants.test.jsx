/**
 * Onboarding · the Team step · what an invitation actually grants.
 *
 * `InviteCreate.module_grants` — `[{code, role}]`, validated server-side against
 * the org's active subscriptions — has been on `POST /v1/org/invites` since the
 * endpoint was written, and no screen ever filled it. This step posted
 * `{email, org_role}` and nothing else, so:
 *
 *     accept_invite writes zero org_member_modules rows
 *       → _module_grants returns []
 *       → navConfig.js hides every nav item carrying `module:`
 *       → the guaranteed first-run experience of every invited colleague is
 *         core PM and nothing else
 *
 * — one step after the owner chose the organisation's modules, and with the
 * admin left to grant by hand afterwards what they could have said at the time.
 *
 * Three things are pinned, and the second and third are the ones that make this
 * safe rather than merely present:
 *
 *   1 · the grants reach the wire;
 *   2 · the SENSITIVE three are never in the default. Payroll, the books and
 *       personnel files are granted deliberately or not at all;
 *   3 · only modules the org actually holds a subscription row for are offered.
 *       `_validate_grants` REJECTS the whole invitation over one module the org
 *       does not have — it does not drop that module and send the rest — so an
 *       over-generous picker fails the invitation rather than trimming it. That
 *       is why `bundled` is excluded too: `get_modules` reports Sahayak and
 *       eSign active for every org whether or not a row exists, and the payload
 *       cannot tell the two cases apart.
 *
 * Nothing is sent anywhere: the kill switch is installed and the API is mocked.
 */
import React from 'react';
import { Route } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import OnboardingPage from '../../pages/onboarding/OnboardingPage';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork,
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

/**
 * `GET /v1/org/modules` as `get_modules` answers it: `active` is
 * `(row and is_active) or bundled`, which is why sahayak reads active with no
 * subscription behind it.
 */
const CATALOGUE = {
  modules: [
    { code: 'graha', active: true, entitled: true, toggleable: true, bundled: false },
    { code: 'sanvaad', active: true, entitled: true, toggleable: true, bundled: false },
    { code: 'vetana', active: true, entitled: true, toggleable: true, bundled: false },
    { code: 'prachar', active: false, entitled: true, toggleable: true, bundled: false },
    { code: 'sahayak', active: true, entitled: true, toggleable: false, bundled: true },
  ],
};

/**
 * The wizard is entered with the module step already settled — `modules` equals
 * what the catalogue says is on, so the delta is empty and Continue sends no
 * PATCH. The subject here is the invitation, not the module step.
 */
function primeWizard() {
  localStorage.setItem('kv_onboarding', JSON.stringify({
    modulesTouched: true,
    modules: ['graha', 'sanvaad', 'vetana', 'sahayak'],
    invites: [],
  }));
}

const routes = [
  <Route key="o" path="/onboarding" element={<OnboardingPage />} />,
  <Route key="d" path="/dashboard" element={<div data-landed="dashboard" />} />,
];

/** Walk the owner's rail to the Team step and queue one address. */
async function reachTeamStepWith(email) {
  await host.mount(null, { path: '/onboarding', routes });
  await settle();
  await host.click('Continue');            // Profile
  await host.click('Continue');            // Organisation
  await host.click(host.$('.ob__next'));   // Modules
  await host.fill('.ob__invite input', email);
  await host.click('Add');
}

async function send() {
  await host.click(host.$('.ob__next'));
}

const inviteBody = (mock) => mock.calledWith('POST', '/v1/org/invites')[0].body;

describe('onboarding · an invitation carries its module grants', () => {
  it('posts module_grants beside the email and the role', async () => {
    signIn(users.orgOwner());
    primeWizard();
    const mock = installMockApi({
      'GET /v1/org/modules': CATALOGUE,
      'POST /v1/org/invites': { invite_id: 'inv_1', email: 'rohan@aekam.co' },
    });

    await reachTeamStepWith('rohan@aekam.co');
    await send();

    const body = inviteBody(mock);
    expect(body.email).toBe('rohan@aekam.co');
    expect(body.org_role).toBe('org_member');
    expect(body.module_grants).toBeTruthy();
  });

  it('defaults to the active modules MINUS the sensitive three', async () => {
    signIn(users.orgOwner());
    primeWizard();
    const mock = installMockApi({
      'GET /v1/org/modules': CATALOGUE,
      'POST /v1/org/invites': { invite_id: 'inv_1' },
    });

    await reachTeamStepWith('rohan@aekam.co');
    await send();

    const codes = inviteBody(mock).module_grants.map((g) => g.code).sort();
    expect(codes).toEqual(['graha', 'sanvaad']);
    expect(codes).not.toContain('vetana');
  });

  it('sends each module at the level the server would have chosen', async () => {
    // Sanvaad is the one that differs from the ladder floor: a viewer there
    // cannot post, so `default_level_for` says editor and so does the picker.
    signIn(users.orgOwner());
    primeWizard();
    const mock = installMockApi({
      'GET /v1/org/modules': CATALOGUE,
      'POST /v1/org/invites': { invite_id: 'inv_1' },
    });

    await reachTeamStepWith('rohan@aekam.co');
    await send();

    expect(inviteBody(mock).module_grants).toEqual(
      expect.arrayContaining([
        { code: 'graha', role: 'viewer' },
        { code: 'sanvaad', role: 'editor' },
      ]),
    );
  });

  it('never offers a module the org has no subscription row for', async () => {
    signIn(users.orgOwner());
    primeWizard();
    installMockApi({
      'GET /v1/org/modules': CATALOGUE,
      'POST /v1/org/invites': { invite_id: 'inv_1' },
    });

    await reachTeamStepWith('rohan@aekam.co');
    await host.click(host.$('.ob__mods'));

    const offered = host.$$('.ob__grants .ogr__r').map((r) => r.textContent).join(' ');
    expect(offered).toContain('Graha');
    expect(offered).toContain('Vetana');      // subscribed, and tickable
    expect(offered).not.toContain('Prachar'); // no active row
    expect(offered).not.toContain('Sahayak'); // bundled: active is not a row
  });

  it('sends what the owner ticked, per person', async () => {
    signIn(users.orgOwner());
    primeWizard();
    const mock = installMockApi({
      'GET /v1/org/modules': CATALOGUE,
      'POST /v1/org/invites': { invite_id: 'inv_1' },
    });

    await reachTeamStepWith('rohan@aekam.co');
    await host.click(host.$('.ob__mods'));
    const vetana = host.$$('.ob__grants .ogr__r').find((r) => /Vetana/.test(r.textContent));
    await host.click(vetana.querySelector('[role="checkbox"]'));
    await send();

    const codes = inviteBody(mock).module_grants.map((g) => g.code).sort();
    expect(codes).toEqual(['graha', 'sanvaad', 'vetana']);
  });

  it('omits module_grants entirely for a projects-only invitation', async () => {
    // A colleague who reaches projects and tasks and nothing else is a real
    // choice. `[]` on the wire would imply the server has a default to fall
    // back to on this path, and it does not.
    signIn(users.orgOwner());
    primeWizard();
    const mock = installMockApi({
      'GET /v1/org/modules': CATALOGUE,
      'POST /v1/org/invites': { invite_id: 'inv_1' },
    });

    await reachTeamStepWith('rohan@aekam.co');
    await host.click(host.$('.ob__mods'));
    for (const label of ['Graha', 'Sanvaad']) {
      const row = host.$$('.ob__grants .ogr__r').find((r) => new RegExp(label).test(r.textContent));
      // eslint-disable-next-line no-await-in-loop
      await host.click(row.querySelector('[role="checkbox"]'));
    }
    await send();

    expect(inviteBody(mock)).not.toHaveProperty('module_grants');
  });

  it('grants one person without touching another', async () => {
    signIn(users.orgOwner());
    primeWizard();
    const mock = installMockApi({
      'GET /v1/org/modules': CATALOGUE,
      'POST /v1/org/invites': { invite_id: 'inv_1' },
    });

    await reachTeamStepWith('rohan@aekam.co');
    await host.fill('.ob__invite input', 'priya@aekam.co');
    await host.click('Add');

    // Open the SECOND person's picker and hand them payroll.
    await host.click(host.$$('.ob__mods')[1]);
    const vetana = host.$$('.ob__grants .ogr__r').find((r) => /Vetana/.test(r.textContent));
    await host.click(vetana.querySelector('[role="checkbox"]'));
    await send();

    const posts = mock.calledWith('POST', '/v1/org/invites');
    expect(posts).toHaveLength(2);
    const byEmail = Object.fromEntries(posts.map((p) => [p.body.email, p.body.module_grants || []]));
    expect(byEmail['rohan@aekam.co'].map((g) => g.code).sort()).toEqual(['graha', 'sanvaad']);
    expect(byEmail['priya@aekam.co'].map((g) => g.code).sort()).toEqual(['graha', 'sanvaad', 'vetana']);
  });

  it('survives a list saved before invitations carried grants', async () => {
    // `kv_onboarding` outlives a release, and the step reads `.length` on the
    // key. A part-filled list from yesterday must send, not throw.
    signIn(users.orgOwner());
    localStorage.setItem('kv_onboarding', JSON.stringify({
      modulesTouched: true,
      modules: ['graha', 'sanvaad', 'vetana', 'sahayak'],
      invites: [{ email: 'old@firm.in', role: 'org_member' }],
    }));
    const mock = installMockApi({
      'GET /v1/org/modules': CATALOGUE,
      'POST /v1/org/invites': { invite_id: 'inv_1' },
    });

    await host.mount(null, { path: '/onboarding', routes });
    await settle();
    await host.click('Continue');
    await host.click('Continue');
    await host.click(host.$('.ob__next'));
    await send();

    const posts = mock.calledWith('POST', '/v1/org/invites');
    expect(posts).toHaveLength(1);
    // No grants were ever chosen for this one, so none are claimed.
    expect(posts[0].body).not.toHaveProperty('module_grants');
  });
});
