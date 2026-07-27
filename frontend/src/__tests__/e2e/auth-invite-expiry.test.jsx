/**
 * Accept-invite context · decline · session-expiry signalling.
 *
 * The three structural gaps this suite pins, all of which shipped as part of
 * the same change:
 *
 *   · **The accept-invite screen said nothing about what was being accepted.**
 *     Org, inviter, role and module grants were all stored on the invite row by
 *     `routers/org_invites.py` and applied by `accept_invite`, and the person
 *     accepting was the only party who could not see them. There was no
 *     endpoint to read them with until `GET /auth/invite/:token`.
 *   · **Decline had no route at all.** The reference offers it on every invite
 *     screen; someone who did not want an invitation could only close the tab
 *     and leave a live token in their inbox for a week.
 *   · **An expired session and a wrong password were the same event.**
 *     `lib/api.js` had no 401 branch, so nothing told them apart and nothing
 *     redirected on expiry.
 *
 * Only the network is fake. The real page, the real `lib/auth.js` helpers.
 */
import React from 'react';
import { Route } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { api, _resetSessionLatch } from '../../lib/api';
import { AcceptInvitePage, LoginPage, ResetPasswordPage } from '../../pages/LoginPage';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork, httpError,
  makeHost, clearSession, settle,
} from './_harness';

let host;

beforeEach(() => {
  clearSession();
  installNetworkKillSwitch();
  _resetSessionLatch();
  host = makeHost();
});

afterEach(() => {
  host.unmount();
  restoreNetwork();
  vi.restoreAllMocks();
  clearSession();
});

/** An org-scoped invite as `GET /auth/invite/:token` returns one. */
const ORG_INVITE = {
  email: 'rohan@aekam.co',
  full_name: null,
  account_type: 'member',
  org_id: 'org_1',
  org_name: 'Aekam Inc',
  org_members: 6,
  org_role: 'org_admin',
  invited_by_name: 'Keval Shah',
  module_grants: [
    { code: 'graha', role: 'editor' },
    { code: 'ganit', role: 'viewer' },
  ],
  expires_at: new Date(Date.now() + 6 * 86_400_000).toISOString(),
  account_exists: false,
};

const inviteRoutes = [
  <Route key="i" path="/accept-invite" element={<AcceptInvitePage />} />,
  <Route key="l" path="/login" element={<div data-landed="login" />} />,
  <Route key="d" path="/dashboard" element={<div data-landed="dashboard" />} />,
];

async function openInvite(preview, token = 'tok-abc') {
  const mock = installMockApi({ 'GET /auth/invite/:token': preview });
  await host.mount(null, { path: `/accept-invite?token=${token}`, routes: inviteRoutes });
  await settle();
  return mock;
}

// ── The context panel ────────────────────────────────────────────────────────

describe('accept-invite · what you are being asked to accept', () => {
  it('names the organisation, the inviter, the role AND the module grants', async () => {
    await openInvite(ORG_INVITE);
    const text = host.text();

    expect(text).toContain('Aekam Inc');
    expect(text).toContain('Keval Shah');
    expect(text).toContain('Admin');          // org_admin, in the reader's words
    expect(text).toContain('rohan@aekam.co');
    // Grants by their product names, not their codes — `moduleColors.js` is the
    // one registry and this screen reads it rather than restating labels.
    expect(text).toContain('CRM');
    expect(text).toContain('Editor');
    expect(text).toContain('Invoicing');
    expect(text).toContain('Viewer');
    expect(host.$('.auinv')).toBeTruthy();
  });

  it('reads the invitation BEFORE drawing a form for it', async () => {
    const mock = await openInvite(ORG_INVITE);
    expect(mock.calledWith('GET', '/auth/invite/tok-abc')).toHaveLength(1);
  });

  it('says so out loud when an invitation carries no module access yet', async () => {
    await openInvite({ ...ORG_INVITE, module_grants: [] });
    // "you will get access later" and "you have access to nothing yet" are
    // different things to walk into, and an empty list is a real answer.
    expect(host.text()).toContain('No module access yet');
  });

  it('does not invent an organisation for a platform-console invite', async () => {
    // `POST /api/admin/invites` writes org_id NULL. The link creates an account
    // and joins nothing, and the screen has to describe that, not a workspace.
    //
    // Scoped to `.auinv` rather than the whole page: AuthShell's footer says
    // "Powered by Aekam Inc" on every auth screen, so a page-wide assertion
    // would pass for the wrong reason on a real org invite too.
    await openInvite({
      ...ORG_INVITE, org_id: null, org_name: null, org_members: null,
      org_role: null, module_grants: [],
    });
    const panel = host.$('.auinv').textContent;
    expect(panel).not.toContain('Aekam Inc');
    expect(panel).toContain('Kartavaya');
    // No grant line at all, rather than "no access yet" — there is no org to
    // grant anything in.
    expect(host.$('.auinv__grants')).toBeNull();
  });

  it('states the expiry and that the address is the only one that can accept', async () => {
    await openInvite(ORG_INVITE);
    expect(host.text()).toMatch(/expires in 6 days/);
    expect(host.text()).toContain('Only rohan@aekam.co can accept it');
  });
});

// ── Dead links, and the one thing that is not one ────────────────────────────

describe('accept-invite · a dead token is a screen, not a banner over a form', () => {
  it('a 404 becomes a dead end with no password field on it', async () => {
    await openInvite(httpError(404, 'This invitation link is not valid.'));
    expect(host.text()).toContain('no longer valid');
    expect(host.$('#inv-password')).toBeNull();
  });

  it('a server that cannot be reached is NOT reported as an expired invitation', async () => {
    // Otherwise the user goes and asks their admin to reissue a link that was
    // fine, and the admin cannot reproduce anything.
    await openInvite(httpError(503, 'gateway'));
    expect(host.text()).toContain('Could not reach');
    expect(host.text()).not.toContain('no longer valid');
  });

  it('an address that has since gained an account is sent to sign in, not to a form', async () => {
    // The only reachable half of AUTH-SPEC's existing-user branch: both invite
    // creators refuse an address that already has an account, so this can only
    // be someone who signed up during their invitation's seven days.
    await openInvite({ ...ORG_INVITE, account_exists: true });
    expect(host.text()).toContain('You already have an');
    expect(host.$('#inv-password')).toBeNull();
    expect(host.control('Sign in')).toBeTruthy();
    // Still says what the invitation was for.
    expect(host.text()).toContain('Aekam Inc');
  });
});

// ── Decline ──────────────────────────────────────────────────────────────────

describe('accept-invite · decline', () => {
  it('is offered on the form, and posts to the real endpoint', async () => {
    const mock = await openInvite(ORG_INVITE);
    mock.route({ 'POST /auth/invite/:token/decline': { ok: true } });

    await host.click('Decline this invitation');

    expect(mock.calledWith('POST', '/auth/invite/tok-abc/decline')).toHaveLength(1);
    expect(host.text()).toContain('declined');
    // Nothing was created, and the screen says which — a decline that leaves a
    // person wondering whether an account now exists has not finished the job.
    expect(host.text()).toContain('no account exists for this link');
  });

  it('reports the decline even when the request fails', async () => {
    // The server call is idempotent and the person is not going to accept
    // either way. Demanding a retry to say "no" is the wrong ask.
    const mock = await openInvite(ORG_INVITE);
    mock.route({ 'POST /auth/invite/:token/decline': httpError(500, 'boom') });

    await host.click('Decline this invitation');
    expect(host.text()).toContain('declined');
  });
});

// ── Session expiry, told apart from a bad password ───────────────────────────

describe('login · an expired session says so', () => {
  const loginRoutes = [
    <Route key="l" path="/login" element={<LoginPage />} />,
    <Route key="d" path="/dashboard" element={<div data-landed="dashboard" />} />,
  ];

  it('explains the empty form when it arrives from an expiry', async () => {
    installMockApi({});
    await host.mount(null, { path: '/login?expired=1', routes: loginRoutes });
    expect(host.text()).toContain('Session ended');
    expect(host.text()).toContain('Your session expired');
  });

  it('says nothing about expiry on an ordinary visit', async () => {
    installMockApi({});
    await host.mount(null, { path: '/login', routes: loginRoutes });
    expect(host.text()).not.toContain('Your session expired');
    expect(host.text()).toContain('Welcome back');
  });

  /** Fill the sign-in form the way React notices, then submit it. */
  async function signInWith(password = 'correct-horse') {
    await host.fill('#au-email', 'aanya@firm.in');
    await host.fill('#au-password', password);
    await host.submit();
  }

  it('a rejected credential replaces the expiry notice — the newer fact wins', async () => {
    installMockApi({ 'POST /auth/login': httpError(401, 'Invalid email or password') });
    await host.mount(null, { path: '/login?expired=1', routes: loginRoutes });

    await signInWith('wrong-password');

    expect(host.text()).not.toContain('Your session expired');
    expect(host.text()).toContain('do not match an account');
  });

  it('returns the user to where the expiry interrupted them', async () => {
    installMockApi({ 'POST /auth/login': { token: 't', user: { role: 'member' } } });
    await host.mount(null, {
      path: '/login?expired=1&from=%2Fboards',
      routes: [...loginRoutes, <Route key="b" path="/boards" element={<div data-landed="boards" />} />],
    });

    await signInWith();

    expect(host.path()).toBe('/boards');
  });

  it('refuses a `from` that is not a same-origin path', async () => {
    // `//evil.example` is a pathname-shaped string the browser reads as a
    // protocol-relative URL. It lands on the default instead.
    installMockApi({ 'POST /auth/login': { token: 't', user: { role: 'member' } } });
    await host.mount(null, {
      path: '/login?from=%2F%2Fevil.example',
      routes: loginRoutes,
    });

    await signInWith();

    expect(host.path()).toBe('/dashboard');
  });
});

// ── Reset link: expired is a screen, per AU_SCREENS ──────────────────────────

describe('reset-password · an expired link is a dead end with a way out', () => {
  const resetRoutes = [
    <Route key="r" path="/reset-password" element={<ResetPasswordPage />} />,
    <Route key="f" path="/forgot-password" element={<div data-landed="forgot" />} />,
    <Route key="l" path="/login" element={<div data-landed="login" />} />,
  ];

  it('a rejected token replaces the form rather than banner-ing over it', async () => {
    const mock = installMockApi({
      'POST /auth/reset-password': httpError(400, 'Reset link is invalid or has expired.'),
    });
    await host.mount(null, { path: '/reset-password?token=stale', routes: resetRoutes });

    await host.fill('#rp-password', 'Correct-Horse-9!');
    await host.fill('#rp-confirm', 'Correct-Horse-9!');
    await host.submit();

    expect(mock.calledWith('POST', '/auth/reset-password')).toHaveLength(1);
    expect(host.text()).toContain('This link has');
    expect(host.text()).toContain('expired');
    // The form the user cannot make work is gone, and the route out is there.
    expect(host.$('#rp-password')).toBeNull();
    expect(host.control('Request a new link')).toBeTruthy();
  });
});
