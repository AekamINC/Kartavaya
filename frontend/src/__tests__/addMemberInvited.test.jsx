/**
 * Organisation ▸ Members ▸ Add or invite — the toast, and the grants.
 *
 * ── 1 · The toast said "added" for somebody who was only invited ─────────────
 * `POST /v1/org/members` answered **404** for an address with no account, and
 * TabMembers read that 404 as "new person, send an invitation instead". That
 * 404 no longer exists: `org_members.add_member` calls `issue_invite` itself and
 * answers **200** with `{status: "invited", email, role, invite_id, invite_link,
 * expires_at, message}`.
 *
 * Two defects fell out of that, and both are pinned here:
 *   · the invite fallback was unreachable code, so the screen kept a second
 *     `POST /v1/org/invites` path that could never run; and
 *   · the success line above it said "{email} added as org member" for a person
 *     who had NOT been added, would not appear in the member list the toast had
 *     just sent them to look at, and could not sign in for days. The server
 *     returns a distinct `status` and a written `message` precisely so this
 *     screen would not say that.
 *
 * ── 2 · Nothing ever sent module_grants ─────────────────────────────────────
 * `AddMemberBody.module_grants` has existed the whole time and no screen filled
 * it, so every colleague arrived with an empty module rail and an admin went
 * back afterwards to grant by hand what could have been said at the time.
 *
 * The sensitive three are asserted ABSENT from the default rather than the
 * default merely asserted non-empty. Payroll, the books and personnel files are
 * granted on purpose or not at all — a default that included them would be a
 * worse defect than the one being fixed.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn(() => Promise.resolve({ data: {} }));

vi.mock('../lib/api', () => ({
  api: {
    get: (...a) => get(...a),
    post: (...a) => post(...a),
    put: (...a) => put(...a),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
  rows: (r) => (Array.isArray(r?.data) ? r.data : []),
  body: (r) => r?.data ?? {},
}));

const { ToastProvider } = await import('../components/ui');
const { default: TabMembers } = await import('../pages/org/TabMembers');

/** Everything this org is subscribed to, sensitive and not. */
const ACTIVE = ['graha', 'sanvaad', 'vetana', 'ganit', 'manav'];

/** What `add_member` answers now for an address with no account. */
const INVITED = {
  status: 'invited',
  email: 'rohan@aekam.co',
  role: 'org_member',
  invite_id: 'inv_9f2',
  invite_link: 'https://app.kartavaya.com/accept-invite?token=tok-abc',
  expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  message: 'rohan@aekam.co has no account yet, so an invitation was sent. '
         + 'They join this organisation when they accept it.',
};

let host;
let root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  get.mockImplementation((url) => {
    if (url.includes('/org/members')) return Promise.resolve({ data: [] });
    if (url.includes('/org/invites')) return Promise.resolve({ data: [] });
    if (url.includes('/subscription/current')) {
      return Promise.resolve({ data: { active_modules: ACTIVE } });
    }
    return Promise.resolve({ data: {} });
  });
  post.mockImplementation(() => Promise.resolve({ data: INVITED }));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<ToastProvider><TabMembers /></ToastProvider>);
  });
}

/** The Sheet and the toasts portal out of the mount point. */
const byText = (re, sel = 'button') =>
  [...document.querySelectorAll(sel)].find((n) => re.test(n.textContent || ''));

const click = async (node, what = 'element') => {
  if (!node) throw new Error(`${what} not found`);
  await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

async function typeEmail(value) {
  const field = document.getElementById('add-email');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const addPosts = () => post.mock.calls.filter((c) => c[0] === '/v1/org/members');
const invitePosts = () => post.mock.calls.filter((c) => c[0] === '/v1/org/invites');

// ─────────────────────────────────────────────────────────────────────────────
// 1 · An invitation is reported as an invitation
// ─────────────────────────────────────────────────────────────────────────────

describe('add or invite · the toast tells the truth', () => {
  it('says INVITED, not "added", when the server answers status=invited', async () => {
    await mount();
    await typeEmail('rohan@aekam.co');
    await click(byText(/Add or invite/), 'the Add or invite button');

    const said = document.body.textContent;
    expect(said).toContain('Invitation sent to rohan@aekam.co');
    // The exact sentence the old code produced, which was false.
    expect(said).not.toMatch(/added as org.?member/i);
  });

  it('surfaces the server\'s own message rather than a paraphrase', async () => {
    await mount();
    await typeEmail('rohan@aekam.co');
    await click(byText(/Add or invite/), 'the Add or invite button');

    expect(document.body.textContent).toContain('They join this organisation when they accept it.');
  });

  it('offers the invite link once, and never prints the token on screen', async () => {
    await mount();
    await typeEmail('rohan@aekam.co');
    await click(byText(/Add or invite/), 'the Add or invite button');

    expect(byText(/Copy invite link/)).toBeTruthy();
    // The link is a working credential. A button that copies it is fine; the
    // string itself on a settings page is readable over a shoulder.
    expect(document.body.textContent).not.toContain('tok-abc');
  });

  it('says "added" — with the modules — when the person already had an account', async () => {
    post.mockImplementation(() => Promise.resolve({
      data: { status: 'added', email: 'priya@aekam.co', role: 'org_member' },
    }));
    await mount();
    await typeEmail('priya@aekam.co');
    await click(byText(/Add or invite/), 'the Add or invite button');

    expect(document.body.textContent).toContain('priya@aekam.co added as org member');
    expect(document.body.textContent).not.toContain('Invitation sent');
  });

  it('makes ONE request — the dead invite fallback is gone', async () => {
    await mount();
    await typeEmail('rohan@aekam.co');
    await click(byText(/Add or invite/), 'the Add or invite button');

    expect(addPosts()).toHaveLength(1);
    expect(invitePosts()).toHaveLength(0);
  });

  it('reports a 404 as a failure instead of inventing a second request', async () => {
    // The branch that used to read 404 as "new person". If the endpoint ever
    // 404s again it is an error, and swallowing it would hide the outage behind
    // an invitation that was never sent.
    const err = new Error('nope');
    err.response = { status: 404, data: { detail: 'Organisation not found' } };
    post.mockImplementation(() => Promise.reject(err));

    await mount();
    await typeEmail('rohan@aekam.co');
    await click(byText(/Add or invite/), 'the Add or invite button');

    expect(invitePosts()).toHaveLength(0);
    expect(document.body.textContent).toContain('Organisation not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · The invitation carries module grants
// ─────────────────────────────────────────────────────────────────────────────

describe('add or invite · module_grants', () => {
  it('posts the org\'s active modules, minus the sensitive three', async () => {
    await mount();
    await typeEmail('rohan@aekam.co');
    await click(byText(/Add or invite/), 'the Add or invite button');

    const [, body] = addPosts()[0];
    const codes = body.module_grants.map((g) => g.code).sort();
    expect(codes).toEqual(['graha', 'sanvaad']);
    expect(codes).not.toContain('vetana');
    expect(codes).not.toContain('ganit');
    expect(codes).not.toContain('manav');
  });

  it('sends each module at the level the SERVER would have chosen for it', async () => {
    // Sanvaad is the one that differs: `default_level_for` says editor, because
    // a Sanvaad viewer cannot post and an invitation to a conversation you
    // cannot speak in is a broken invitation.
    await mount();
    await typeEmail('rohan@aekam.co');
    await click(byText(/Add or invite/), 'the Add or invite button');

    const [, body] = addPosts()[0];
    expect(body.module_grants).toEqual(
      expect.arrayContaining([
        { code: 'graha', role: 'viewer' },
        { code: 'sanvaad', role: 'editor' },
      ]),
    );
  });

  it('offers only modules the org is subscribed to', async () => {
    // `_validate_grants` rejects the WHOLE request over one module the org does
    // not have, so an unsubscribed row here would fail the add rather than trim
    // it. Prachar is in the catalogue and not in this org's subscription.
    await mount();
    await click(byText(/Choose modules/), 'the Choose modules button');

    const rows = [...document.querySelectorAll('.ogr__r')].map((r) => r.textContent);
    expect(rows).toHaveLength(ACTIVE.length);
    expect(rows.join(' ')).not.toContain('Prachar');
  });

  it('sends what the admin picked, not the default, once the picker is used', async () => {
    await mount();
    await typeEmail('rohan@aekam.co');
    await click(byText(/Choose modules/), 'the Choose modules button');

    // Turn Graha off, leaving Sanvaad alone.
    const graha = [...document.querySelectorAll('.ogr__r')]
      .find((r) => /Graha/.test(r.textContent || ''));
    await click(graha.querySelector('[role="checkbox"]'), 'the Graha checkbox');
    await click(byText(/Use these modules/), 'the confirm button');
    await click(byText(/Add or invite/), 'the Add or invite button');

    const [, body] = addPosts()[0];
    expect(body.module_grants.map((g) => g.code)).toEqual(['sanvaad']);
  });

  it('omits the key entirely when the admin clears every module', async () => {
    // An empty list and a missing one mean the same thing to the server, and the
    // shorter request is the one the existing suite already pins.
    await mount();
    await typeEmail('rohan@aekam.co');
    await click(byText(/Choose modules/), 'the Choose modules button');
    for (const label of ['Graha', 'Sanvaad']) {
      const row = [...document.querySelectorAll('.ogr__r')]
        .find((r) => new RegExp(label).test(r.textContent || ''));
      // eslint-disable-next-line no-await-in-loop
      await click(row.querySelector('[role="checkbox"]'), `${label} checkbox`);
    }
    await click(byText(/Use these modules/), 'the confirm button');
    await click(byText(/Add or invite/), 'the Add or invite button');

    const [, body] = addPosts()[0];
    expect(body).not.toHaveProperty('module_grants');
  });

  it('does not claim the modules were attached to an INVITATION', async () => {
    // `add_member` hands `issue_invite` an empty grant list on the invited
    // branch, so the picked modules genuinely do not travel with the invitation.
    // Saying "invited with 2 modules" would be the same lie in a new place.
    await mount();
    await typeEmail('rohan@aekam.co');
    await click(byText(/Add or invite/), 'the Add or invite button');

    expect(document.body.textContent)
      .toContain('Module access was not attached to the invitation');
  });

  it('confirms a sensitive grant before it is attached to a new person', async () => {
    // Somebody who does not exist yet holds nothing, so every sensitive module
    // in the draft is a raise. An invitation that hands over payroll is the same
    // act as a grant that does.
    await mount();
    await typeEmail('rohan@aekam.co');
    await click(byText(/Choose modules/), 'the Choose modules button');

    const vetana = [...document.querySelectorAll('.ogr__r')]
      .find((r) => /Vetana/.test(r.textContent || ''));
    await click(vetana.querySelector('[role="checkbox"]'), 'the Vetana checkbox');
    await click(vetana.querySelector('.ogr__b:last-child'), 'the Vetana admin level');
    await click(byText(/Use these modules/), 'the confirm button');

    expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();
    expect(document.body.textContent).toContain('rohan@aekam.co');
  });
});
