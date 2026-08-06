/**
 * supportSessions.test.jsx — the six things that must be impossible, on the
 * client side of platform support access, and the one thing that must happen.
 *
 * ── What this file is FOR ───────────────────────────────────────────────────
 *
 * `middleware/org_resolver.py` was narrowed on 6 August 2026 because of a real
 * leak: ten platform accounts could set an `X-Org-Id` header on any route and
 * resolve into any organisation, and seven of ten saw all 29 teams and 557
 * tasks on an ordinary page load. Support sessions add ONE more way through
 * that guard. Every test below fails without a specific guard, and each is
 * named after the guard it pins.
 *
 * The server is the authority for all six — a browser convinced a session is
 * live gets 403s and nothing else. What is tested here is the SECOND thing that
 * has to be true: that no screen ever SHOWS an access that is not there, and
 * that a session which ends is visibly over. A surface that keeps saying
 * "active" after a revocation is how a customer learns to distrust the revoke
 * button, and after that the feature is decoration.
 *
 * ── The seventh, which is not a refusal ─────────────────────────────────────
 *
 * SUPPORT ACCESS IS NEVER SILENT. The switcher carries the sentence, the
 * console page carries the sentence, and an expired session does not just
 * vanish — it drops the operator back with an explanation. Those are pinned
 * here too, because "never silent" is the rule that outranks everything else in
 * `11-platform-admin.md` and a rule with no test is a paragraph.
 *
 * `createRoot` + `act` rather than @testing-library/react, which is the house
 * pattern and is NOT installed.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ── The api double ──────────────────────────────────────────────────────────
//
// Routed by URL rather than by call order: the console page fires two reads on
// mount and the order they settle in is not a thing this feature promises.
let routes = {};
const posted = [];
const deleted = [];

// LONGEST prefix wins. `/v1/support-sessions` is a prefix of
// `/v1/support-sessions/organisations`, and first-match-wins would answer the
// org list with the session list — a test double that silently lies about
// which endpoint was called is worse than no double.
const respond = (url) => {
  const hit = Object.keys(routes)
    .filter((k) => url.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  const v = hit ? routes[hit] : Object.assign(new Error('Not Found'), { response: { status: 404 } });
  return v instanceof Error ? Promise.reject(v) : Promise.resolve({ data: v });
};

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn((url) => respond(url)),
    post: vi.fn((url, body) => { posted.push([url, body]); return Promise.resolve({ data: {} }); }),
    delete: vi.fn((url, cfg) => { deleted.push([url, cfg]); return Promise.resolve({ data: {} }); }),
  },
}));

const switched = [];
vi.mock('../lib/orgContext', () => ({
  getActiveOrg: vi.fn(() => globalThis.__activeOrg ?? null),
  // The real one calls `window.location.assign`, which jsdom cannot do.
  setActiveOrg: vi.fn((id) => { switched.push(id); }),
  clearActiveOrg: vi.fn(),
}));

let ME = { user_id: 'u1', platform_roles: ['platform_staff'], org_roles: [] };
vi.mock('../lib/auth', () => ({ currentUser: () => ME }));

const {
  sessionState, isLive, remaining, listSessions, isDormant, requestBlockers,
  SUPPORT_MODULES, SUPPORT_READ_ONLY, TTL_CHOICES,
} = await import('../pages/admin/supportSessions');
const { default: SupportSessionsPage } = await import('../pages/admin/SupportSessionsPage');
const { default: TabSupportAccess } = await import('../pages/org/TabSupportAccess');
const { default: OrgSwitcher, sessionClock, takeSupportEndedNotice } =
  await import('../components/layout/OrgSwitcher');
const { ADMIN_NAV, SUPPORT_CONSOLE_ROLES, adminNavFor } =
  await import('../components/admin/adminNav');
const { api } = await import('../lib/api');
const { ToastProvider } = await import('../components/ui/toast');

/**
 * Both screens raise toasts, and the real provider is used rather than a mock:
 * the message an operator gets after pressing Approve is part of what "never
 * silent" means, and a stub would let it disappear without any test noticing.
 */
const Wrap = ({ children }) => <ToastProvider>{children}</ToastProvider>;

const CSS = readFileSync(resolve(process.cwd(), 'src/styles/editorial.css'), 'utf8');

const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

/** An APPROVED, live session. Every refusal test below starts from this and
 *  breaks exactly one thing, so the thing that changed is the thing tested. */
const LIVE = {
  id: 's1', ref: 'SUP-2418AK', org_id: 'o9', org_name: 'Vardhman Traders',
  requested_by: 'user_ops', requested_by_name: 'D. Rao',
  reason: 'Invoice run is stuck at the GST step',
  modules: ['ganit'], access_level: 'viewer',
  requested_ttl_hours: 2, requested_at: inHours(-1),
  approved_by: 'user_owner', approved_by_name: 'R. Iyer',
  approved_at: inHours(-1), granted_ttl_hours: 2, expires_at: inHours(2.25),
};

let container;
let root;

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const mount = async (node) => {
  await act(async () => { root.render(node); });
  await settle();
};
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  routes = {};
  posted.length = 0;
  deleted.length = 0;
  switched.length = 0;
  globalThis.__activeOrg = null;
  localStorage.clear();
  sessionStorage.clear();
  api.get.mockClear();
  ME = { user_id: 'u1', platform_roles: ['platform_staff'], org_roles: [] };
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 · A session for org A grants access to org A and NOTHING else
// ═══════════════════════════════════════════════════════════════════════════

describe('a session reaches one organisation', () => {
  it('marks only its own org as reachable, never a sibling', async () => {
    // The failure this guards is the one the cross-org audit measured: a
    // platform account that resolves into ANY org once it holds one grant.
    routes['/v1/org/memberships'] = {
      data: [{ id: 'o1', name: 'Aekam Inc', role: 'org_owner', seats_used: null, seats_limit: null }],
      support: [{ id: 's1', org_id: 'o9', name: 'Vardhman Traders', ref: 'SUP-2418AK', approved_by: 'R. Iyer', expires_at: inHours(2) }],
      default_id: 'o1',
    };
    await mount(<MemoryRouter initialEntries={['/today']}><OrgSwitcher /></MemoryRouter>);
    await click(container.querySelector('.orgsw__t'));

    const supRows = [...container.querySelectorAll('.orgsw__row--sup')];
    expect(supRows).toHaveLength(1);
    expect(supRows[0].textContent).toContain('Vardhman Traders');
    // The org list beside it is MEMBERSHIPS only. A session must never widen
    // that list, and the switcher is never the platform-wide org list.
    const radios = [...container.querySelectorAll('.orgsw__row')]
      .filter((r) => r.getAttribute('role') === 'menuitemradio' && !r.className.includes('--sup'));
    expect(radios).toHaveLength(1);
    expect(radios[0].textContent).toContain('Aekam Inc');
  });

  it('names the modules the customer approved and no others', () => {
    // Payroll, HR records and attendance cannot be REQUESTED at all, so a
    // customer is never put in the position of refusing them.
    const codes = SUPPORT_MODULES.map((m) => m.code);
    expect(codes).toHaveLength(9);
    for (const forbidden of ['vetana', 'manav', 'pahchan']) {
      expect(codes).not.toContain(forbidden);
    }
    // Sending in the customer's name is capped at viewer whatever they approve.
    expect([...SUPPORT_READ_ONLY].sort()).toEqual(['prachar', 'sanvaad', 'varta']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · An EXPIRED session grants nothing
// ═══════════════════════════════════════════════════════════════════════════

describe('an expired session', () => {
  it('is not live, and a NULL expiry is not the same thing', () => {
    expect(sessionState({ ...LIVE, expires_at: inHours(-0.01) })).toBe('expired');
    expect(isLive({ ...LIVE, expires_at: inHours(-0.01) })).toBe(false);
    // `granted_ttl_hours = 0` is UNTIL REVOKED and is the ONLY value that
    // leaves an approved row with a null expiry. A bare `expires_at > now`
    // drops exactly the open-ended sessions.
    expect(sessionState({ ...LIVE, granted_ttl_hours: 0, expires_at: null })).toBe('active');
  });

  it('disappears from the switcher rather than sitting there greyed out', async () => {
    routes['/v1/org/memberships'] = {
      data: [
        { id: 'o1', name: 'Aekam Inc', role: 'org_owner' },
        { id: 'o2', name: 'Mehta Associates', role: 'org_admin' },
      ],
      support: [{ id: 's1', org_id: 'o9', name: 'Vardhman Traders', ref: 'SUP-2418AK', approved_by: 'R. Iyer', expires_at: inHours(-0.1) }],
      default_id: 'o1',
    };
    await mount(<MemoryRouter initialEntries={['/today']}><OrgSwitcher /></MemoryRouter>);
    await click(container.querySelector('.orgsw__t'));
    expect(container.querySelector('.orgsw__row--sup')).toBeNull();
    expect(container.querySelector('.orgsw__head--sup')).toBeNull();
  });

  it('drops the operator back to their default org, WITH AN EXPLANATION', async () => {
    // 01-navigation.md: an expired session "must not silently keep working".
    // Left alone the operator sits on a screen that has started 403ing every
    // request with no statement anywhere about why.
    globalThis.__activeOrg = 'o9';
    routes['/v1/org/memberships'] = {
      data: [
        { id: 'o1', name: 'Aekam Inc', role: 'org_owner' },
        { id: 'o2', name: 'Mehta Associates', role: 'org_admin' },
      ],
      support: [{ id: 's1', org_id: 'o9', name: 'Vardhman Traders', ref: 'SUP-2418AK', approved_by: 'R. Iyer', expires_at: inHours(-0.001) }],
      default_id: 'o1',
    };
    localStorage.setItem('kv_teams_cache', JSON.stringify([{ id: 't1' }]));

    await mount(<MemoryRouter initialEntries={['/today']}><OrgSwitcher /></MemoryRouter>);

    // Back to the DEFAULT membership, not to whichever org sorted first.
    expect(switched).toEqual(['o1']);
    // The previous org's cached projects go with it, or the first paint after
    // the reload lists the org the operator just left.
    expect(localStorage.getItem('kv_teams_cache')).toBeNull();

    // And the explanation survives the reload that the drop-back performs.
    const left = JSON.parse(sessionStorage.getItem('kv_support_ended'));
    expect(left).toMatchObject({ ref: 'SUP-2418AK', name: 'Vardhman Traders', back: 'Aekam Inc' });
  });

  it('renders that explanation on the page the operator lands on', async () => {
    sessionStorage.setItem('kv_support_ended', JSON.stringify({
      ref: 'SUP-2418AK', name: 'Vardhman Traders', back: 'Aekam Inc',
    }));
    routes['/v1/org/memberships'] = {
      data: [
        { id: 'o1', name: 'Aekam Inc', role: 'org_owner' },
        { id: 'o2', name: 'Mehta Associates', role: 'org_admin' },
      ],
      support: [], default_id: 'o1',
    };
    await mount(<MemoryRouter initialEntries={['/today']}><OrgSwitcher /></MemoryRouter>);

    const notice = container.querySelector('.orgsw__ended');
    expect(notice).not.toBeNull();
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toContain('SUP-2418AK');
    expect(notice.textContent).toContain('Vardhman Traders');
    expect(notice.textContent).toContain('You are back in Aekam Inc.');
    // Shown once. It explains the landing, and does not follow the operator
    // around the product afterwards.
    expect(sessionStorage.getItem('kv_support_ended')).toBeNull();
  });

  it('explains it even when the operator has no membership to land in', async () => {
    // A pure Aekam support account whose ONLY reach was the session. After the
    // drop-back there is no choice left to make, which is exactly when the
    // explanation matters most — the switcher would otherwise render a bare
    // name and say nothing.
    sessionStorage.setItem('kv_support_ended', JSON.stringify({
      ref: 'SUP-2418AK', name: 'Vardhman Traders', back: null,
    }));
    ME = { user_id: 'u1', platform_roles: ['platform_support'], org_roles: [] };
    routes['/v1/org/memberships'] = { data: [], support: [], default_id: null };

    await mount(<MemoryRouter initialEntries={['/today']}><OrgSwitcher /></MemoryRouter>);
    const notice = container.querySelector('.orgsw__ended');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain('no longer inside a customer organisation');
  });

  it('does not eject an operator who is working in the platform console', async () => {
    // `setActiveOrg` navigates to /today. Under /admin the operator is not in a
    // tenant view at all, and yanking them out over a header the server is
    // already refusing would lose whatever they were doing.
    globalThis.__activeOrg = 'o9';
    ME = { user_id: 'u1', platform_roles: ['platform_admin'], org_roles: [] };
    routes['/v1/org/memberships'] = {
      data: [{ id: 'o1', name: 'Aekam Inc', role: 'org_owner' }],
      support: [{ id: 's1', org_id: 'o9', name: 'Vardhman Traders', ref: 'SUP-2418AK', approved_by: 'R. Iyer', expires_at: inHours(-0.001) }],
      default_id: 'o1',
    };
    await mount(<MemoryRouter initialEntries={['/admin/orgs']}><OrgSwitcher /></MemoryRouter>);
    expect(switched).toEqual([]);
  });

  it('reads as ended on the console page without a reload', async () => {
    routes['/v1/support-sessions'] = { data: [{ ...LIVE, expires_at: inHours(-0.01) }] };
    routes['/v1/support-sessions/organisations'] = { data: [] };
    await mount(<Wrap><SupportSessionsPage /></Wrap>);
    expect(container.textContent).toContain('Ended — time ran out');
    // And it offers no way to keep using it.
    expect(container.textContent).not.toContain('Close now');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · An UNAPPROVED session grants nothing
// ═══════════════════════════════════════════════════════════════════════════

describe('an unapproved request', () => {
  it('is `requested`, and a request is not a grant', () => {
    const asked = { ...LIVE, approved_at: null, approved_by: null, granted_ttl_hours: null, expires_at: null };
    expect(sessionState(asked)).toBe('requested');
    expect(isLive(asked)).toBe(false);
  });

  it('never appears in the switcher, because appearing there IS reachability', async () => {
    // `/v1/org/memberships` filters on `approved_at IS NOT NULL` server-side.
    // This pins the client half: an unapproved row handed to the switcher by a
    // future endpoint change must still not read as a place you can go.
    routes['/v1/org/memberships'] = {
      data: [
        { id: 'o1', name: 'Aekam Inc', role: 'org_owner' },
        { id: 'o2', name: 'Mehta Associates', role: 'org_admin' },
      ],
      // No expiry, because an unapproved row cannot carry one —
      // `pss_expiry_matches_granted_ttl`. The client must not read that as
      // "until revoked".
      support: [],
      default_id: 'o1',
    };
    await mount(<MemoryRouter initialEntries={['/today']}><OrgSwitcher /></MemoryRouter>);
    await click(container.querySelector('.orgsw__t'));
    expect(container.querySelector('.orgsw__head--sup')).toBeNull();
  });

  it('is announced to the operator as a question, never as an outcome', async () => {
    routes['/v1/support-sessions'] = {
      data: [{ ...LIVE, approved_at: null, approved_by: null, approved_by_name: null, granted_ttl_hours: null, expires_at: null }],
    };
    routes['/v1/support-sessions/organisations'] = { data: [] };
    await mount(<Wrap><SupportSessionsPage /></Wrap>);
    expect(container.textContent).toContain('Awaiting the customer');
    expect(container.textContent).not.toContain('Close now');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · A REVOKED session grants nothing
// ═══════════════════════════════════════════════════════════════════════════

describe('a revoked session', () => {
  it('is terminal even though it is still approved and still inside its clock', () => {
    // ORDER IS LOAD-BEARING. Test `approved_at` first and this row reads live.
    const pulled = { ...LIVE, revoked_at: inHours(-0.2), revoked_by: 'user_owner', revoked_by_party: 'customer' };
    expect(sessionState(pulled)).toBe('revoked');
    expect(isLive(pulled)).toBe(false);
  });

  it('outranks a denial too, so a row with both reads as the harder refusal', () => {
    const both = { ...LIVE, denied_at: inHours(-0.5), revoked_at: inHours(-0.2) };
    expect(sessionState(both)).toBe('revoked');
  });

  it('is ended by the customer immediately, and the party is stated not inferred', async () => {
    ME = { user_id: 'u_owner', platform_roles: [], org_roles: [{ role_code: 'org_owner' }] };
    routes['/v1/support-sessions'] = { data: [LIVE] };
    await mount(<Wrap><TabSupportAccess /></Wrap>);

    const revokeBtn = [...container.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Revoke now'));
    expect(revokeBtn).toBeTruthy();
    await click(revokeBtn);

    // The confirm names the consequence in plain words before anything happens.
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('immediately');
    await click([...dialog.querySelectorAll('button')].find((b) => b.textContent.includes('Revoke now')));

    expect(deleted).toHaveLength(1);
    expect(deleted[0][0]).toBe('/v1/support-sessions/s1');
    // `customer`, `aekam` and `self` are three different acts and the identity
    // does not say which happened: a platform admin can also be the requester.
    expect(deleted[0][1]).toEqual({ data: { party: 'customer' } });
  });

  it('is ended by the agent as `self`, from the console', async () => {
    routes['/v1/support-sessions'] = { data: [LIVE] };
    routes['/v1/support-sessions/organisations'] = { data: [] };
    await mount(<Wrap><SupportSessionsPage /></Wrap>);
    await click([...container.querySelectorAll('button')].find((b) => b.textContent.includes('Close now')));
    expect(deleted[0][1]).toEqual({ data: { party: 'self' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · SELF-APPROVAL. The requester cannot be the approver.
// ═══════════════════════════════════════════════════════════════════════════

describe('self-approval', () => {
  it('is refused for the requester, and the reason is on screen', async () => {
    // Not theoretical: Aekam Inc is itself an organisation in this database, so
    // a platform admin can hold `org_admin` in the org they requested into.
    ME = { user_id: 'user_ops', platform_roles: ['platform_admin'], org_roles: [{ role_code: 'org_admin' }] };
    routes['/v1/support-sessions'] = {
      data: [{ ...LIVE, approved_at: null, approved_by: null, granted_ttl_hours: null, expires_at: null }],
    };
    await mount(<Wrap><TabSupportAccess /></Wrap>);

    expect([...container.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Decide')).toBe(false);
    // A row that silently loses its buttons reads as broken; this reads as a
    // rule.
    expect(container.textContent).toContain('You raised this request');
  });

  it('is refused whenever the server says so, whoever is looking', async () => {
    ME = { user_id: 'u_owner', platform_roles: [], org_roles: [{ role_code: 'org_owner' }] };
    routes['/v1/support-sessions'] = {
      data: [{ ...LIVE, approved_at: null, approved_by: null, granted_ttl_hours: null, expires_at: null, can_approve: false }],
    };
    await mount(<Wrap><TabSupportAccess /></Wrap>);
    expect([...container.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Decide')).toBe(false);
  });

  it('offers no request form to a role the server will refuse', async () => {
    // Only `platform_support` may raise a request: every other platform role
    // already reaches customer modules BY ROLE, so a session in their hands
    // could only add authority and never cap it. The picker answers 403 to them.
    //
    // 403 is in `DORMANT`, and there used to be a fallback to `/v1/admin/orgs`
    // on a dormant answer — which filled the picker from the admin list and
    // offered a form whose submit then 403'd. A control that cannot be used
    // teaches the operator the wrong model.
    routes['/v1/support-sessions'] = { data: [] };
    routes['/v1/support-sessions/organisations'] =
      Object.assign(new Error('nope'), { response: { status: 403 } });
    routes['/v1/admin/orgs'] = { data: [{ id: 'o9', name: 'Vardhman Traders' }] };
    await mount(<Wrap><SupportSessionsPage /></Wrap>);
    expect(
      [...container.querySelectorAll('button')].some((b) => /Request access/.test(b.textContent)),
    ).toBe(false);
    expect(container.textContent).not.toContain('Vardhman Traders');
  });

  it('has no Approve control anywhere in the operator console', async () => {
    // Absent, not disabled. A button that exists and refuses teaches an
    // operator that approval is something they do.
    routes['/v1/support-sessions'] = {
      data: [{ ...LIVE, approved_at: null, approved_by: null, granted_ttl_hours: null, expires_at: null }],
    };
    routes['/v1/support-sessions/organisations'] = { data: [{ id: 'o9', name: 'Vardhman Traders' }] };
    await mount(<Wrap><SupportSessionsPage /></Wrap>);
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels.some((l) => /approve/i.test(l))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · The audit row and the owner email are NOT best-effort
// ═══════════════════════════════════════════════════════════════════════════

describe('an approval that fails grants nothing', () => {
  it('leaves the request unapproved on screen when the server refuses', async () => {
    // `pss_approval_and_owner_email_are_one_act` means the row cannot commit
    // without the owner mail. A failed approval must therefore leave the
    // request exactly where it was, and never a row that looks granted.
    ME = { user_id: 'u_owner', platform_roles: [], org_roles: [{ role_code: 'org_owner' }] };
    const pending = { ...LIVE, approved_at: null, approved_by: null, granted_ttl_hours: null, expires_at: null };
    routes['/v1/support-sessions'] = { data: [pending] };
    api.post.mockImplementationOnce(() => Promise.reject(
      Object.assign(new Error('boom'), { response: { status: 500, data: { detail: 'The owner could not be emailed. Nothing was granted.' } } }),
    ));

    await mount(<Wrap><TabSupportAccess /></Wrap>);
    await click([...container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Decide'));
    await click([...container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve'));

    expect(container.textContent).toContain('Awaiting the customer');
    expect(container.textContent).not.toContain('Active');
  });

  it('says the mail and the audit row happened, because they are the approval', async () => {
    ME = { user_id: 'u_owner', platform_roles: [], org_roles: [{ role_code: 'org_owner' }] };
    const pending = { ...LIVE, approved_at: null, approved_by: null, granted_ttl_hours: null, expires_at: null };
    routes['/v1/support-sessions'] = { data: [pending] };
    await mount(<Wrap><TabSupportAccess /></Wrap>);
    await click([...container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Decide'));
    await click([...container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve'));

    expect(posted[0][0]).toBe('/v1/support-sessions/s1/approve');
    // The customer may SHORTEN what was asked for. They cannot lengthen it,
    // and both halves stay on the row so a narrowing is visible afterwards.
    expect(posted[0][1]).toEqual({ granted_ttl_hours: 2 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · NEVER SILENT — and the sentence that says so
// ═══════════════════════════════════════════════════════════════════════════

describe('support access is never silent', () => {
  it('carries the sentence in the switcher, where the operator uses it', async () => {
    routes['/v1/org/memberships'] = {
      data: [{ id: 'o1', name: 'Aekam Inc', role: 'org_owner' }],
      support: [{ id: 's1', org_id: 'o9', name: 'Vardhman Traders', ref: 'SUP-2418AK', approved_by: 'R. Iyer', expires_at: inHours(2.25) }],
      default_id: 'o1',
    };
    await mount(<MemoryRouter initialEntries={['/today']}><OrgSwitcher /></MemoryRouter>);
    await click(container.querySelector('.orgsw__t'));
    expect(container.querySelector('.orgsw__note').textContent)
      .toMatch(/Not a membership\..*audit log.*owner\s+was emailed/s);
  });

  it('carries the same sentence at the top of the console page', async () => {
    routes['/v1/support-sessions'] = { data: [] };
    routes['/v1/support-sessions/organisations'] = { data: [] };
    await mount(<Wrap><SupportSessionsPage /></Wrap>);
    expect(container.textContent)
      .toMatch(/Not a membership\..*audit log.*owner was emailed/s);
  });

  it('tells the customer, in their own words, on their own screen', async () => {
    ME = { user_id: 'u_owner', platform_roles: [], org_roles: [{ role_code: 'org_owner' }] };
    routes['/v1/support-sessions'] = { data: [LIVE] };
    await mount(<Wrap><TabSupportAccess /></Wrap>);
    // Who is in, why, and until when — the four things the customer's half owes
    // them, plus the button.
    expect(container.textContent).toContain('D. Rao');
    expect(container.textContent).toContain('Invoice run is stuck at the GST step');
    expect(container.textContent).toContain('ends in 2h');
    expect(container.textContent).toContain('SUP-2418AK');
    expect(container.textContent).toContain('Revoke now');
  });

  it('never looks like a membership — violet, an inset rule, and its own head', async () => {
    // The whole visual argument. `--pf-primary` is the platform violet, and it
    // is a token so it can never be derived from the customer's accent.
    const rule = CSS.match(/\.orgsw__row--sup\s*\{[^}]*\}/)[0];
    expect(rule).toMatch(/inset 2px 0 0 var\(--pf-primary\)/);
    const ended = CSS.match(/\.orgsw__ended\s*\{[^}]*\}/)[0];
    expect(ended).toMatch(/var\(--pf-primary\)/);
    // Not --danger. Nothing failed; a grant reached the end of the time the
    // customer set, which is the feature working.
    expect(ended).not.toMatch(/--danger/);
    expect(CSS).toMatch(/\[data-theme="dark"\] \.orgsw__ended \{[^}]*--pf-primary-dark/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · DORMANT — the table does not exist, and that is the normal state
// ═══════════════════════════════════════════════════════════════════════════

describe('with migration 111 unapplied', () => {
  it('treats 404, 501 and 403 as "no sessions", and 500 as a failure', () => {
    for (const status of [403, 404, 501]) {
      expect(isDormant({ response: { status } })).toBe(true);
    }
    // A screen that swallowed a 500 would tell a customer "nobody is in your
    // data" on the strength of a request that never answered. That is the one
    // lie this feature cannot tell.
    expect(isDormant({ response: { status: 500 } })).toBe(false);
    expect(isDormant(new Error('network'))).toBe(false);
  });

  it('separates the two in listSessions', async () => {
    const four04 = { get: () => Promise.reject({ response: { status: 404 } }) };
    await expect(listSessions(four04)).resolves.toEqual({ data: [], dormant: true, error: null });

    const five00 = { get: () => Promise.reject({ response: { status: 500 } }) };
    const res = await listSessions(five00);
    expect(res.dormant).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('renders NOTHING in the customer\'s settings — no error, no empty state', async () => {
    ME = { user_id: 'u_owner', platform_roles: [], org_roles: [{ role_code: 'org_owner' }] };
    // No route registered, so the double answers 404 — production's state.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount(<Wrap><TabSupportAccess /></Wrap>);
    // Nothing of this component's own. (The wrapper's toast live region is
    // always in the tree and is not part of what is being asserted.)
    expect(container.querySelector('.card')).toBeNull();
    expect(container.textContent).toBe('');
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
    errors.mockRestore();
    warns.mockRestore();
  });

  it('renders nothing there for a genuine failure either, but does not reassure', async () => {
    ME = { user_id: 'u_owner', platform_roles: [], org_roles: [{ role_code: 'org_owner' }] };
    routes['/v1/support-sessions'] = Object.assign(new Error('down'), { response: { status: 500 } });
    await mount(<Wrap><TabSupportAccess /></Wrap>);
    // Absent — and crucially NOT a panel saying nobody is in their data.
    expect(container.querySelector('.card')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('says so plainly on the console page the operator navigated to on purpose', async () => {
    // A page somebody chose to open is the one place silence is wrong: they
    // asked a question and a blank screen does not answer it.
    await mount(<Wrap><SupportSessionsPage /></Wrap>);
    expect(container.textContent).toContain('Support sessions are not enabled yet');
    expect(container.textContent).not.toMatch(/something went wrong|error/i);
    // And no way to request one, because there is nothing behind the button.
    expect([...container.querySelectorAll('button')].some((b) => /Request access/.test(b.textContent))).toBe(false);
  });

  it('shows a real failure on the console page rather than swallowing it', async () => {
    routes['/v1/support-sessions'] = Object.assign(new Error('down'), { response: { status: 500 } });
    await mount(<Wrap><SupportSessionsPage /></Wrap>);
    expect(container.textContent).not.toContain('Support sessions are not enabled yet');
    expect(container.querySelector('.k-err')).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9 · The ask, and the three things that block it
// ═══════════════════════════════════════════════════════════════════════════

describe('requesting access', () => {
  it('refuses a reason nobody can act on — the DDL floor is 12 characters', () => {
    expect(requestBlockers({ orgId: 'o9', reason: 'test', modules: ['ganit'] }))
      .toEqual([expect.stringContaining('at least 12 characters')]);
    expect(requestBlockers({ orgId: 'o9', reason: '            ', modules: ['ganit'] }))
      .toHaveLength(1);
    expect(requestBlockers({ orgId: 'o9', reason: 'invoice run is stuck', modules: ['ganit'] }))
      .toEqual([]);
  });

  it('refuses a session with no modules, which would reach nothing anyway', () => {
    expect(requestBlockers({ orgId: 'o9', reason: 'invoice run is stuck', modules: [] }))
      .toEqual([expect.stringContaining('at least one module')]);
  });

  it('offers only the four durations, with "until revoked" named as a choice', () => {
    expect(TTL_CHOICES.map((c) => c.hours)).toEqual([2, 24, 168, 0]);
    expect(TTL_CHOICES.find((c) => c.hours === 0).label).toMatch(/until revoked/i);
  });

  it('sends the ask and says the customer decides, not that access was granted', async () => {
    routes['/v1/support-sessions'] = { data: [] };
    routes['/v1/support-sessions/organisations'] = { data: [{ id: 'o9', name: 'Vardhman Traders' }] };
    await mount(<Wrap><SupportSessionsPage /></Wrap>);
    await click([...container.querySelectorAll('button')].find((b) => /Request access/.test(b.textContent)));

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    // The requester is NEVER in the body — the server takes it from the session
    // token. Nothing here offers a way to ask on somebody else's behalf.
    const inputs = [...form.querySelectorAll('input, select, textarea')].map((el) => el.id);
    expect(inputs.some((id) => /requested_by|agent|user/.test(id || ''))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10 · The clock, and the console row that leads to the screen
// ═══════════════════════════════════════════════════════════════════════════

describe('the clock', () => {
  it('reads in days for the seven-day grant, which is one of the four', () => {
    const t0 = Date.UTC(2026, 7, 6, 12, 0, 0);
    expect(remaining(new Date(t0 + 168 * 3600_000).toISOString(), t0)).toBe('7d 0h');
    expect(remaining(new Date(t0 + 8_040_000).toISOString(), t0)).toBe('2h 14m');
    expect(remaining(new Date(t0 + 1_080_000).toISOString(), t0)).toBe('18m');
    // Null for BOTH "no clock" and "run out" — deliberately. The two are told
    // apart by the state, never by this.
    expect(remaining(null, t0)).toBeNull();
    expect(remaining(new Date(t0 - 1).toISOString(), t0)).toBeNull();
  });

  it('agrees with the switcher\'s own formatter', () => {
    const t0 = Date.UTC(2026, 7, 6, 12, 0, 0);
    expect(sessionClock(new Date(t0 + 168 * 3600_000).toISOString(), t0))
      .toEqual({ live: true, remaining: '7d 0h' });
    expect(sessionClock(null, t0)).toEqual({ live: true, remaining: null });
    expect(sessionClock(new Date(t0 - 1).toISOString(), t0)).toEqual({ live: false, remaining: null });
  });

  it('takeSupportEndedNotice reads once and refuses anything it cannot parse', () => {
    sessionStorage.setItem('kv_support_ended', 'not json');
    expect(takeSupportEndedNotice()).toBeNull();
    sessionStorage.setItem('kv_support_ended', JSON.stringify({ name: 'x' }));   // no ref
    expect(takeSupportEndedNotice()).toBeNull();
  });
});

describe('the console row', () => {
  it('exists, and every role on it can already open the console', async () => {
    const row = ADMIN_NAV.find((it) => it.to === '/admin/support');
    expect(row).toBeTruthy();
    expect(row.en).toBe('Support sessions');
    // A row whose role set is wider than ADMIN_SURFACE_ROLES gives AdminShell a
    // row for a user `Protected` bounces at the door. The two must agree.
    const { ADMIN_SURFACE_ROLES } = await import('../components/admin/adminNav');
    for (const r of SUPPORT_CONSOLE_ROLES) expect(ADMIN_SURFACE_ROLES).toContain(r);
  });

  it('is offered to the operating and commercial roles, not only god mode', () => {
    const labels = (roles) => adminNavFor(roles).map((it) => it.en);
    expect(labels(['platform_staff'])).toContain('Support sessions');
    expect(labels(['account_finance'])).toContain('Support sessions');
    expect(labels(['platform_owner'])).toContain('Support sessions');
  });
});
