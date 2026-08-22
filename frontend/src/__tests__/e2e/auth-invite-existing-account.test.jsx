/**
 * Accept-invite · the branch where the address already has an account.
 *
 * The screen said: "Sign in with it and this invitation is applied to the
 * account you already have."
 *
 * NOTHING APPLIES IT. `accept_invite` is the only reader of the `invites` table
 * and it 409s on this branch before it writes anything; `POST /auth/login` never
 * looks at `invites` at all. So the person signed in, found no sign of the
 * organisation they had just been invited to, and had nothing to do next —
 * having been told, by the product, that it was handled.
 *
 * This suite pins the two halves of the correction, and the first is the one
 * that matters most: a screen that says nothing is better than a screen that
 * says something false, so the PROMISE is asserted absent by shape — any
 * "applied / added / joined automatically" phrasing — rather than by matching
 * the one sentence that used to be there and would let its paraphrase back in.
 *
 * The second half is the route that does work today: `POST /v1/org/members`
 * adds an address that already has an account, immediately, and the person who
 * sent the invitation is exactly who can press it. Naming the inviter and the
 * screen is what makes it an instruction instead of a shrug.
 *
 * Carrying an invitation onto an existing account is being built server-side.
 * When it lands this branch stops being reachable and these words go with it —
 * until then they describe what a person can actually do this afternoon.
 */
import React from 'react';
import { Route } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { _resetSessionLatch } from '../../lib/api';
import { AcceptInvitePage } from '../../pages/LoginPage';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork,
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

const EXISTING = {
  email: 'rohan@aekam.co',
  org_id: 'org_1',
  org_name: 'Aekam Inc',
  org_members: 6,
  org_role: 'org_member',
  invited_by_name: 'Keval Shah',
  module_grants: [{ code: 'graha', role: 'editor' }],
  expires_at: new Date(Date.now() + 6 * 86_400_000).toISOString(),
  account_exists: true,
};

const routes = [
  <Route key="i" path="/accept-invite" element={<AcceptInvitePage />} />,
  <Route key="l" path="/login" element={<div data-landed="login" />} />,
];

async function openInvite(preview = EXISTING) {
  const mock = installMockApi({
    'GET /auth/invite/:token': preview,
    'POST /auth/decline-invite': {},
  });
  await host.mount(null, { path: '/accept-invite?token=tok-abc', routes });
  await settle();
  return mock;
}

describe('accept-invite · you already have an account', () => {
  it('does not promise that signing in applies the invitation', async () => {
    await openInvite();
    const text = host.text();

    expect(text).not.toMatch(/invitation is applied/i);
    expect(text).not.toMatch(/applied to the account/i);
    // Any nearby paraphrase of the same claim.
    expect(text).not.toMatch(/(added|joined|applied)\s+(you\s+)?automatically/i);
  });

  it('names who can act and what they press', async () => {
    await openInvite();
    const text = host.text();

    expect(text).toContain('Keval Shah');
    expect(text).toContain('Aekam Inc');
    expect(text).toContain('Members');
    expect(text).toContain('Add or invite a member');
  });

  it('still offers sign-in and decline, unchanged', async () => {
    await openInvite();

    expect(host.control('Sign in')).toBeTruthy();
    expect(host.control('Decline this invitation')).toBeTruthy();

    await host.click('Sign in');
    expect(host.path()).toBe('/login');
  });

  it('falls back to "whoever invited you" when the inviter is not named', async () => {
    // `invited_by_name` is nullable on the preview. An instruction that reads
    // "undefined can add you" is worse than the generic one.
    await openInvite({ ...EXISTING, invited_by_name: null });
    const text = host.text();

    expect(text).toContain('Whoever invited you can');
    expect(text).not.toMatch(/undefined|null/);
  });

  it('draws no password form — this branch cannot be accepted here', async () => {
    const mock = await openInvite();

    expect(host.$('input[type="password"]')).toBeNull();
    expect(mock.calledWith('POST', '/auth/accept-invite')).toHaveLength(0);
  });
});
