/**
 * Login · session verification · expiry · logout.
 *
 * The real `LoginPage`, the real `Protected` gate and the real `lib/auth.js`
 * helpers, driven through a form the way a person drives them. Only the network
 * is fake.
 *
 * What each block is for is stated on the block. The two that carry the most
 * weight:
 *
 *   · A FAILED sign-in must leave NO session behind. A half-written session —
 *     token stored, user not, or either stored after a rejection — is how a
 *     browser ends up in a state where `Protected` lets someone in and every
 *     subsequent request 401s.
 *   · Sign-out must clear EVERY key, not just the token. `lib/auth.js` names
 *     six, and the reason is in its own comment: the notification store is
 *     module-level, so on a shared machine the next person to sign in on the
 *     same tab saw the previous user's notification titles and message bodies.
 */
import React, { act } from 'react';
import { Route } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { api } from '../../lib/api';
import { apiLogin, apiLogout, currentUser } from '../../lib/auth';
import Protected from '../../components/layout/Protected';
import { LoginPage } from '../../pages/LoginPage';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork, httpError,
  makeHost, routesWith, signIn, clearSession, users, settle, TOKEN_KEY, USER_KEY,
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

const GUARDED = <div data-landed="guarded-page">Guarded staff page</div>;

/** `Protected` wrapping a staff page, with the redirect destinations declared. */
const protectedAt = (path) => host.mount(null, {
  path,
  routes: routesWith(
    <Route key="g" path="/dashboard" element={<Protected>{GUARDED}</Protected>} />,
    <Route key="t" path="/tasks" element={<Protected>{GUARDED}</Protected>} />,
  ),
});

/* ══════════════════════════════════════════════════════════════════════════
   1 · Signing in
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · sign in', () => {
  it('a valid sign-in stores the session and lands staff on /dashboard', async () => {
    const mock = installMockApi({
      'POST /auth/login': { token: 'jwt-abc', user: users.staff() },
    });

    await host.mount(<LoginPage />, { path: '/login', routes: routesWith(
      <Route key="l" path="/login" element={<LoginPage />} />,
    ) });

    await host.fill('#au-email', 'aanya@firm.in');
    await host.fill('#au-password', 'a-password-that-is-not-real');
    await host.submit();

    // What the app sent — nothing received it.
    expect(mock.calledWith('POST', '/auth/login')).toHaveLength(1);
    expect(mock.calls[0].body).toEqual({
      email: 'aanya@firm.in', password: 'a-password-that-is-not-real',
    });

    expect(localStorage.getItem(TOKEN_KEY)).toBe('jwt-abc');
    expect(currentUser().email).toBe('aanya@firm.in');
    expect(host.path()).toBe('/dashboard');
  });

  it('a CLIENT lands on /client, not /dashboard', async () => {
    // The client never sees the staff shell, not even for the frame it would
    // take `Protected` to bounce them back out of it.
    installMockApi({ 'POST /auth/login': { token: 'jwt-c', user: users.client() } });

    await host.mount(null, { path: '/login', routes: routesWith(
      <Route key="l" path="/login" element={<LoginPage />} />,
    ) });

    await host.fill('#au-email', 'riya@acme.in');
    await host.fill('#au-password', 'x');
    await host.submit();

    expect(host.path()).toBe('/client');
  });

  it('a rejected sign-in shows an alert and leaves NO session behind', async () => {
    installMockApi({ 'POST /auth/login': httpError(401, 'Invalid credentials') });

    await host.mount(null, { path: '/login', routes: routesWith(
      <Route key="l" path="/login" element={<LoginPage />} />,
    ) });

    await host.fill('#au-email', 'nobody@example.test');
    await host.fill('#au-password', 'wrong');
    await host.submit();

    const alert = host.$('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert.textContent.length).toBeGreaterThan(0);

    // The part that matters: nothing half-written.
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(USER_KEY)).toBeNull();
    expect(host.path()).toBe('/login');
  });

  it('a network failure is reported as a network failure, not as bad credentials', async () => {
    // Telling someone their password is wrong when the server is down sends
    // them to reset a password that was fine.
    const netErr = new Error('Network Error');
    netErr.isAxiosError = true; // no `.response` — that is what makes it a network error
    installMockApi({ 'POST /auth/login': { __reject: netErr } });

    await host.mount(null, { path: '/login', routes: routesWith(
      <Route key="l" path="/login" element={<LoginPage />} />,
    ) });

    await host.fill('#au-email', 'aanya@firm.in');
    await host.fill('#au-password', 'x');
    await host.submit();

    expect(host.text()).toMatch(/could not reach the server/i);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('apiLogin persists token and user together, or neither', async () => {
    // Direct on the helper, because every auth screen shares it: login,
    // accept-invite and reset-password all write the same two keys.
    installMockApi({ 'POST /auth/login': httpError(401, 'nope') });
    await expect(apiLogin('a@b.test', 'x')).rejects.toBeTruthy();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(USER_KEY)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · Session verification — what `Protected` does on every guarded load
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · session verification', () => {
  it('no token at all goes straight to /login without asking the server', async () => {
    const mock = installMockApi({ 'GET /auth/me': users.staff() });
    await protectedAt('/dashboard');

    expect(host.path()).toBe('/login');
    expect(mock.calledWith('GET', '/auth/me')).toHaveLength(0);
  });

  it('a token is re-verified against /auth/me on every guarded load', async () => {
    signIn(users.staff());
    const mock = installMockApi({ 'GET /auth/me': users.staff() });

    await protectedAt('/dashboard');

    expect(mock.calledWith('GET', '/auth/me')).toHaveLength(1);
    expect(host.$('[data-landed="guarded-page"]')).toBeTruthy();
  });

  it('the verified response REFRESHES the cached user — a stale role must not persist', async () => {
    // Someone promoted between page loads has to get the new role without
    // signing out. The cached copy in localStorage is a convenience; /auth/me
    // is the truth, and Protected writes it back.
    signIn(users.staff({ role: 'member' }));
    installMockApi({ 'GET /auth/me': users.orgOwner() });

    await protectedAt('/dashboard');

    expect(currentUser().role).toBe('owner');
    expect(currentUser().org_roles[0].role_code).toBe('org_owner');
  });

  it('an EXPIRED session evicts the token and bounces to /login', async () => {
    // The refresh path. A 401 from /auth/me means the stored token is no longer
    // good; leaving it in place means every later request 401s while the app
    // still believes it is signed in.
    signIn(users.staff(), 'stale-token');
    installMockApi({ 'GET /auth/me': httpError(401, 'Token expired') });

    await protectedAt('/dashboard');

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(host.path()).toBe('/login');
    expect(host.$('[data-landed="guarded-page"]')).toBeNull();
  });

  it('a guarded page renders NOTHING while verification is in flight', async () => {
    // A screen that paints before the gate resolves is a screen that shows
    // somebody else's data for a frame.
    signIn(users.staff());
    let release;
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(r => { release = r; }));

    await host.mount(null, { path: '/dashboard', routes: routesWith(
      <Route key="g" path="/dashboard" element={<Protected>{GUARDED}</Protected>} />,
    ) });

    expect(host.$('[data-landed="guarded-page"]')).toBeNull();
    // The boot gate is the lotus now, not a 40px logo over "Loading Kartavaya…"
    // — see Protected.jsx. What this asserts is unchanged: SOMETHING owns the
    // screen while the gate is open, and it is not the guarded page.
    expect(host.$('.bl')).toBeTruthy();

    // Let it finish inside act, or the resolution lands after the test and
    // React warns about an update outside act on a tree that is being torn down.
    await act(async () => { release({ data: users.staff() }); });
    await settle();
    expect(host.$('[data-landed="guarded-page"]')).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · Signing out
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · sign out', () => {
  /** Every key `lib/auth.js` is responsible for clearing. */
  const OWNED_KEYS = [
    'auth_token', 'Kartavaya_user', 'kv_teams_cache',
    'kv_onboarding', 'kv_notif_ask_reason',
  ];

  it('clears every key it owns, not just the token', async () => {
    installMockApi({ 'POST /auth/logout': { ok: true } });
    for (const k of OWNED_KEYS) localStorage.setItem(k, 'value-from-the-previous-user');

    await apiLogout();

    for (const k of OWNED_KEYS) {
      expect(localStorage.getItem(k), `${k} survived sign-out`).toBeNull();
    }
  });

  it('completes even when the server refuses the logout call', async () => {
    // Fire-and-forget by design: a user who clicks sign out on a shared machine
    // must end up signed out locally whatever the network says.
    installMockApi({ 'POST /auth/logout': httpError(500, 'boom') });
    signIn(users.staff());

    await apiLogout();

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(currentUser()).toBeNull();
  });

  it('after sign-out a guarded route no longer resolves', async () => {
    installMockApi({ 'POST /auth/logout': { ok: true }, 'GET /auth/me': users.staff() });
    signIn(users.staff());
    await apiLogout();

    await protectedAt('/dashboard');

    expect(host.path()).toBe('/login');
  });

  it('currentUser() survives a corrupted cache instead of throwing', async () => {
    // A half-written JSON blob in localStorage must not take the whole app
    // down on boot — every screen calls this.
    localStorage.setItem(USER_KEY, '{not json');
    expect(currentUser()).toBeNull();
  });
});
