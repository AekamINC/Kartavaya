/**
 * The onboarding gate — the four ways it becomes a trap instead of a redirect.
 *
 * `Protected.jsx` has carried 12-auth-onboarding.md §5's redirect since the
 * wizard was routed, and it read a field nothing supplied: `onboarding_complete`
 * existed nowhere in the backend and `/auth/me` returned no `org` object at all,
 * so the gate was dead code for its entire life. The server side of that is
 * `backend/tests/test_onboarding_gate.py`; this is the client side.
 *
 * Every case below fails against the version of `Protected.jsx` that shipped
 * before this change — the first because the field could not resolve, the other
 * three because the gate was one condition rather than four.
 *
 * Nothing is sent anywhere: the network kill switch is installed and the API is
 * mocked, so no request in this file can reach a server. Staging and production
 * share one Supabase project; see `e2e/_harness.jsx`.
 */
import React from 'react';
import { Route } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import Protected, { ONBOARDING_LATCH_KEY } from '../components/layout/Protected';
import OnboardingPage from '../pages/onboarding/OnboardingPage';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork, httpError,
  makeHost, clearSession, signIn, settle, users,
} from './e2e/_harness';

let host;

beforeEach(() => {
  clearSession();
  // `clearSession` clears LOCAL storage. The latch lives in SESSION storage
  // deliberately (see Protected.jsx), so it survives that and would leak the
  // "already finished" answer into the next test.
  try { sessionStorage.clear(); } catch { /* private mode */ }
  installNetworkKillSwitch();
  host = makeHost();
});

afterEach(() => {
  host.unmount();
  restoreNetwork();
  vi.restoreAllMocks();
  clearSession();
  try { sessionStorage.clear(); } catch { /* private mode */ }
});

const ORG = 'org_1';

/** `/auth/me`'s answer for a caller whose org has not finished setup. */
const incompleteOrg = { id: ORG, name: 'Sharma & Co', onboarding_complete: false };
const completeOrg = { id: ORG, name: 'Sharma & Co', onboarding_complete: true };

/** Protected around a marker, so the assertion is about the LOCATION. */
const guarded = (path, name) => (
  <Route key={path} path={path} element={<Protected><div data-landed={name} /></Protected>} />
);

async function visit(user, path = '/dashboard', extraRoutes = []) {
  signIn(user);
  installMockApi({ 'GET /auth/me': user });
  await host.mount(null, {
    path,
    routes: [
      guarded('/dashboard', 'dashboard'),
      guarded('/onboarding', 'onboarding'),
      ...extraRoutes,
    ],
  });
  await settle();
  return host.path();
}

describe('onboarding gate · who is redirected', () => {
  it('sends an org_admin whose org has not finished setup to /onboarding', async () => {
    // The case 12 §5 asks for, and the one that could never fire: `/auth/me`
    // returned no `org` object, so `user?.org?.onboarding_complete` was
    // permanently undefined and `=== false` was permanently false.
    const landed = await visit(users.orgAdmin({ org: incompleteOrg }));
    expect(landed).toBe('/onboarding');
  });

  it('sends an org_owner whose org has not finished setup to /onboarding', async () => {
    const landed = await visit(users.orgOwner({ org: incompleteOrg }));
    expect(landed).toBe('/onboarding');
  });

  it('leaves an ORG MEMBER of that same org alone', async () => {
    // THE TRAP. `POST /v1/org/profile/onboarding-complete` is
    // ORG_SETTINGS_ROLES — org_owner and org_admin — and so is every step of
    // the wizard that reaches the server. A member redirected here has no press
    // on any screen that can clear the flag, so they would be held on the
    // wizard for as long as their owner never finished it. It is also the
    // settled invite-only rule from the other side: somebody invited into an
    // existing org is not sent through that org's setup.
    const landed = await visit(users.staff({ org: incompleteOrg }));
    expect(landed).toBe('/dashboard');
  });

  it('leaves alone a caller whose org role is for a DIFFERENT org', async () => {
    // A payload where `org.id` and the org_roles disagree is not a licence to
    // redirect: the role that would let them finish is held somewhere else.
    const landed = await visit(users.orgOwner({
      org: { id: 'org_2', name: 'Other Ltd', onboarding_complete: false },
    }));
    expect(landed).toBe('/dashboard');
  });

  it('leaves alone a caller whose /auth/me carries no org at all', async () => {
    // THE PRODUCTION-SAFETY CASE. Absent means "no opinion" — a payload from an
    // older deploy, a caller with no org, or a request where the server could
    // not resolve one. `auth_router._org_for` returns None on any failure for
    // exactly this reason: a DB hiccup must never redirect the whole product.
    const landed = await visit(users.orgOwner());
    expect(landed).toBe('/dashboard');
  });

  it('leaves alone an org that has finished setup', async () => {
    const landed = await visit(users.orgOwner({ org: completeOrg }));
    expect(landed).toBe('/dashboard');
  });

  it('does not redirect a caller who is already on /onboarding', async () => {
    // Or the redirect points at itself.
    const landed = await visit(users.orgOwner({ org: incompleteOrg }), '/onboarding');
    expect(landed).toBe('/onboarding');
  });

  it('confines a client before it considers onboarding', async () => {
    // Rule 1 runs first and the ordering is load-bearing: `/onboarding` is a
    // staff surface outside `/client/*`, and the onboarding rule's own
    // `path !== '/onboarding'` test would then let the client STAY there — a
    // hole through the allow-list opened by a field rather than by a route.
    const landed = await visit(
      users.client({ org: incompleteOrg }),
      '/dashboard',
      [<Route key="c" path="/client" element={<Protected><div data-landed="client" /></Protected>} />],
    );
    expect(landed).toBe('/client');
  });
});

describe('onboarding gate · the wizard can always get out', () => {
  /** Sign in, mount the wizard under the gate, skip out, press the button. */
  async function finishWizard(completeRoute) {
    const user = users.orgOwner({ org: incompleteOrg });
    signIn(user);
    const mock = installMockApi({
      'GET /auth/me': user,
      'GET /v1/org/modules': { modules: [] },
      'POST /v1/org/profile/onboarding-complete': completeRoute,
    });
    await host.mount(null, {
      path: '/onboarding',
      routes: [
        guarded('/dashboard', 'dashboard'),
        <Route key="o" path="/onboarding" element={<Protected><OnboardingPage /></Protected>} />,
      ],
    });
    await settle();
    await host.click('Skip setup entirely');
    await host.click('Go to dashboard');
    return mock;
  }

  it('tells the server the wizard is done, and says it was skipped', async () => {
    const mock = await finishWizard({ onboarding_complete: true, recorded: true });
    const posts = mock.calledWith('POST', '/v1/org/profile/onboarding-complete');
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ skipped: true });
    expect(host.path()).toBe('/dashboard');
  });

  it('STILL reaches the dashboard when that write 500s, and stays there', async () => {
    // THE LOOP THIS TEST EXISTS FOR. Without the session latch, a completion
    // whose POST failed navigates to /dashboard, `Protected` re-reads
    // `/auth/me`, sees `onboarding_complete: false` — because the write never
    // landed — and bounces straight back to /onboarding. Every press of "Go to
    // dashboard" then does exactly the same thing, one `/auth/me` per lap, with
    // no product surface reachable at all.
    //
    // `/auth/me` deliberately keeps answering `false` here. The user gets out
    // because the latch says they finished, not because the server changed its
    // mind.
    await finishWizard(httpError(500, 'nope'));
    expect(host.path()).toBe('/dashboard');
    expect(sessionStorage.getItem(ONBOARDING_LATCH_KEY)).toBe('1');
  });

  it('the latch is session-scoped, so tomorrow re-offers the wizard', async () => {
    // Local storage would hide a genuinely unrecorded setup forever, on that
    // device, and the org would never be prompted again. Session storage costs
    // the user nothing for the rest of the sitting and asks again next time.
    await finishWizard(httpError(500, 'nope'));
    expect(localStorage.getItem(ONBOARDING_LATCH_KEY)).toBeNull();

    host.unmount();
    try { sessionStorage.clear(); } catch { /* private mode */ }   // a new session
    host = makeHost();
    const landed = await visit(users.orgOwner({ org: incompleteOrg }));
    expect(landed).toBe('/onboarding');
  });
});
