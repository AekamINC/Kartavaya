/**
 * The three roles that existed, were migrated, were tested — and were reachable
 * only by curl.
 *
 * `hr_admin`, `org_client` and `aekam_team` shipped on 2026-08-06 with migration
 * 124 and 19 backend tests. A verification pass on 2026-08-07 found ZERO
 * references to `hr_admin` anywhere in `frontend/src`: the only member-adding
 * control posts to `POST /v1/admin/orgs/{id}/members`, which is deliberately
 * `org_admin`-only, so no screen could grant the other three.
 *
 * `states every role the server calls assignable` is the test that would have
 * caught it, and it is written against the SERVER'S list rather than a literal,
 * so a fifth role added on the server fails this file until a screen offers it.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../../lib/api', () => ({ api: { get: (...a) => get(...a), post: (...a) => post(...a) } }));

import OrgRoleGrant from '../OrgRoleGrant';

/** The catalogue, in the shape `role_catalogue` actually returns. */
const CATALOGUE = {
  org: [
    { code: 'org_owner',  tier: 'org', consumes_seat: true,  assignable: false, project_only: false, surfaces: [] },
    { code: 'org_admin',  tier: 'org', consumes_seat: true,  assignable: true,  project_only: false, surfaces: [] },
    { code: 'org_member', tier: 'org', consumes_seat: true,  assignable: false, project_only: false, surfaces: [] },
    { code: 'hr_admin',   tier: 'org', consumes_seat: true,  assignable: true,  project_only: false, surfaces: [] },
    { code: 'org_client', tier: 'org', consumes_seat: false, assignable: true,  project_only: true,
      surfaces: ['approvals', 'notifications', 'projects', 'tasks'] },
    { code: 'aekam_team', tier: 'org', consumes_seat: false, assignable: true,  project_only: true,
      surfaces: ['approvals', 'notifications', 'projects', 'tasks'] },
  ],
  platform: [],
  assignable_org_roles: ['org_admin', 'hr_admin', 'org_client', 'aekam_team'],
};

const MEMBERS = [
  { user_id: 'user_aaa', name: 'Asha Rao', email: 'asha@acme.in' },
  { user_id: 'user_bbb', name: '', email: 'bhavin@acme.in' },
];

function mockGets(cat = CATALOGUE, held = []) {
  get.mockImplementation(url => {
    if (url.includes('/roles/catalogue')) return Promise.resolve({ data: cat });
    if (url.includes('/roles/org')) return Promise.resolve({ data: held });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

const mount = (props = {}) => render(
  <OrgRoleGrant orgId="org-1" orgName="Unicode Group" members={MEMBERS} {...props} />
);

beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); mockGets(); });

describe('OrgRoleGrant · the roles nothing could grant', () => {
  it('states every role the server calls assignable', async () => {
    mount();
    // Driven off the fixture's own `assignable` flag, not a hand-written list:
    // a role the server starts offering must appear here without editing this
    // assertion, and one it stops offering must disappear.
    const expected = CATALOGUE.org.filter(r => r.assignable).map(r => r.code);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Org admin' })).toBeTruthy());
    for (const code of expected) {
      const label = code.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
      expect(screen.getByRole('option', { name: label }), `${code} is not offered`).toBeTruthy();
    }
  });

  it('never offers a role the server marks unassignable', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Org admin' })).toBeTruthy());
    // org_owner and org_member are real roles that this console may NOT hand
    // out — the endpoint answers 400 for both, and an option that always fails
    // is worse than no option.
    expect(screen.queryByRole('option', { name: 'Org owner' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Org member' })).toBeNull();
  });

  it('reads the seat consequence from the server, never from a local table', async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Hr admin' })).toBeTruthy());

    await user.selectOptions(screen.getByLabelText(/Role/i), 'hr_admin');
    expect(screen.getByTestId('role-consequence').textContent).toContain('Uses a seat');

    // The owner's decision: the two project-only roles consume NO seat, because
    // a client collaborating on their own project is not a licensed user.
    await user.selectOptions(screen.getByLabelText(/Role/i), 'org_client');
    const text = screen.getByTestId('role-consequence').textContent;
    expect(text).toContain('No seat');
    expect(text).toContain('Project work only');
    expect(text).toContain('tasks');
  });

  it('inverts the sentence when the server inverts the flag', async () => {
    // The claim that this is READ and not transcribed. Same role code, opposite
    // `consumes_seat`, opposite sentence — a local table could not do this.
    mockGets({
      ...CATALOGUE,
      org: CATALOGUE.org.map(r => r.code === 'hr_admin' ? { ...r, consumes_seat: false } : r),
    });
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Hr admin' })).toBeTruthy());
    await user.selectOptions(screen.getByLabelText(/Role/i), 'hr_admin');
    expect(screen.getByTestId('role-consequence').textContent).toContain('No seat');
  });

  it('posts the org id with the grant, so it cannot land on another org', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ data: { status: 'assigned' } });
    mount();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Hr admin' })).toBeTruthy());

    await user.selectOptions(screen.getByLabelText(/Person/i), 'user_aaa');
    await user.selectOptions(screen.getByLabelText(/Role/i), 'hr_admin');
    await user.click(screen.getByRole('button', { name: /Grant role/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/v1/admin/orgs/roles/assign', {
      user_id: 'user_aaa', role_code: 'hr_admin', org_id: 'org-1',
    });
  });

  it('shows the server refusal verbatim rather than a generic failure', async () => {
    // The endpoint's 400 names the rule AND the door that is open. Replacing it
    // with "something went wrong" throws away the only useful sentence.
    const pushToast = vi.fn();
    const user = userEvent.setup();
    post.mockRejectedValue({ response: { data: { detail: "'org_member' cannot be assigned from the platform console." } } });
    mount({ pushToast });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Hr admin' })).toBeTruthy());

    await user.selectOptions(screen.getByLabelText(/Person/i), 'user_aaa');
    await user.selectOptions(screen.getByLabelText(/Role/i), 'hr_admin');
    await user.click(screen.getByRole('button', { name: /Grant role/i }));

    await waitFor(() => expect(pushToast).toHaveBeenCalled());
    expect(pushToast.mock.calls[0][0].title).toContain('cannot be assigned from the platform console');
  });

  it('cannot grant when the caller may not act on this org', async () => {
    mount({ canAct: false, denyReason: 'God mode only' });
    await waitFor(() => expect(screen.getByTestId('org-role-grant')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Grant role/i }).disabled).toBe(true);
    expect(screen.getByLabelText(/Role/i).disabled).toBe(true);
  });

  it('survives a catalogue the server could not return', async () => {
    // A dead endpoint must leave a screen that explains itself, not a crash and
    // not a select full of nothing that looks grantable.
    mockGets(null);
    mount();
    await waitFor(() => expect(screen.getByTestId('org-role-grant')).toBeTruthy());
    expect(screen.getByLabelText(/Role/i).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Grant role/i }).disabled).toBe(true);
  });
});
