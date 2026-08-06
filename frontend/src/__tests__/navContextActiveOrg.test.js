import { describe, it, expect } from 'vitest';
import { navContext, navGroupsFor } from '../components/layout/navConfig';

/**
 * THE ACTIVE ORG WINS — on the client too.
 *
 * The backend fix threaded `X-Org-Id` through `_module_grants`, `_module_levels`
 * and `_org_for` (auth_router.py::_active_org_role), so `/auth/me` now returns
 * the ACTIVE org under `user.org` and the active org's entitlements under
 * `module_grants`. Two readers in `navConfig.js` never got the message and kept
 * answering from the whole `org_roles` list:
 *
 *   line 253  `orgRoles[0]?.org_name`  — the EARLIEST-GRANTED org's name, which
 *             is the owner's actual screenshot: the switcher three inches above
 *             reads "E2E Test & Associates" (OrgSwitcher.jsx uses `current.name`)
 *             and the footer under it reads "admin · Aekam Inc".
 *
 *   line 222  `orgRoles.some(r => r.role_code === 'org_owner')` — a predicate
 *             over EVERY org at once, so someone who is org_admin of one company
 *             and a plain member of another gets the administrator nav drawn
 *             over the second company's data.
 *
 * `org_roles` arrives `ORDER BY ur.granted_at` (auth_router.py:1195) and
 * `_safe_user` passes it through untouched, so `[0]` is a join date, never a
 * choice. `user.org.id` is the choice — it is what `_active_org_role` resolved
 * from the header, and `Protected.jsx:289` already reads it.
 */

// The owner's shape: org_admin in three, in granted_at order, switched to the
// third. Names matter here — this test is about which one renders.
const OWNER_ROLES = [
  { org_id: 'org_aekam',   org_name: 'Aekam Inc',              role_code: 'org_admin' },
  { org_id: 'org_unicode', org_name: 'Unicode Group',          role_code: 'org_admin' },
  { org_id: 'org_e2e',     org_name: 'E2E Test & Associates',  role_code: 'org_admin' },
];

describe('navContext resolves the ACTIVE org, not the earliest-joined one', () => {
  it('names the org the switcher is on', () => {
    const ctx = navContext({
      role: 'admin',
      org_roles: OWNER_ROLES,
      org: { id: 'org_e2e', name: 'E2E Test & Associates' },
    });
    expect(ctx.orgName).toBe('E2E Test & Associates');
  });

  it('renders the footer line the owner expected, not the one they got', () => {
    // Sidebar.jsx:165 composes exactly this. Pinned here because the string is
    // the artefact in the screenshot.
    const ctx = navContext({
      role: 'admin',
      org_roles: OWNER_ROLES,
      org: { id: 'org_e2e', name: 'E2E Test & Associates' },
    });
    expect(`${'admin'} · ${ctx.orgName}`).toBe('admin · E2E Test & Associates');
  });

  it('switches back, so it is a switch and not a different pin', () => {
    const on = id => navContext({ org_roles: OWNER_ROLES, org: { id } }).orgName;
    expect(on('org_aekam')).toBe('Aekam Inc');
    expect(on('org_unicode')).toBe('Unicode Group');
    expect(on('org_e2e')).toBe('E2E Test & Associates');
  });

  it('prefers user.org.name when org_roles carries no name for the active org', () => {
    // `_org_for` selects `name` straight from `staging.organisations`; the
    // `org_roles` rows are a join that can lag it.
    const ctx = navContext({
      org_roles: [{ org_id: 'org_aekam', org_name: 'Aekam Inc', role_code: 'org_admin' }],
      org: { id: 'org_new', name: 'Freshly Created LLP' },
    });
    expect(ctx.orgName).toBe('Freshly Created LLP');
  });

  it('falls back to the first row when the server sent no `org` key', () => {
    // `_org_for` returns None — "no opinion" — on any failure, and a legacy
    // account predating user_roles has no org at all. Neither may blank the
    // footer that used to render.
    expect(navContext({ org_roles: OWNER_ROLES }).orgName).toBe('Aekam Inc');
    expect(navContext({ platform_roles: ['platform_owner'] }).orgName).toBe(null);
    expect(navContext(null).orgName).toBe(null);
  });
});

describe('navContext resolves the role from the ACTIVE org row', () => {
  const mixed = {
    org_roles: [
      { org_id: 'org_aekam', org_name: 'Aekam Inc', role_code: 'org_admin' },
      { org_id: 'org_e2e',   org_name: 'E2E Test',  role_code: 'org_member' },
    ],
  };

  it('is not an admin in the org where they are only a member', () => {
    const ctx = navContext({ ...mixed, org: { id: 'org_e2e', name: 'E2E Test' } });
    expect(ctx.isOrgAdmin).toBe(false);
    expect(ctx.isOrgOwner).toBe(false);
  });

  it('is still an admin in the org where they are one', () => {
    const ctx = navContext({ ...mixed, org: { id: 'org_aekam', name: 'Aekam Inc' } });
    expect(ctx.isOrgAdmin).toBe(true);
  });

  it('does not lend org_owner from one org to another', () => {
    const owner = {
      org_roles: [
        { org_id: 'org_aekam', org_name: 'Aekam Inc', role_code: 'org_owner' },
        { org_id: 'org_e2e',   org_name: 'E2E Test',  role_code: 'org_member' },
      ],
      org: { id: 'org_e2e', name: 'E2E Test' },
    };
    expect(navContext(owner).isOrgOwner).toBe(false);
    expect(navContext(owner).isOrgAdmin).toBe(false);
  });

  it('withholds the admin-only nav rows in the org they only belong to', () => {
    // The predicate is not decorative: `Roles & access` and `Organisation` hang
    // off `isOrgAdmin`, and they are the console for a company this caller has
    // no authority over.
    const groups = navGroupsFor({ ...mixed, org: { id: 'org_e2e', name: 'E2E Test' } });
    const settings = groups.find(g => g.section === 'settings');
    const en = (settings?.items || []).map(i => i.en);
    expect(en).not.toContain('Roles & access');
    expect(en).not.toContain('Organisation');
  });
});
