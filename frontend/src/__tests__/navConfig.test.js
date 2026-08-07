import { describe, it, expect } from 'vitest';
import { navGroupsFor, navContext, canSeeNavItem, ROUTE_META, resolveRouteMeta } from '../components/layout/navConfig';
import { ADMIN_SURFACE_ROLES } from '../components/admin/adminNav';

/**
 * The Settings section, against `Chrome.jsx:36` — the NAV the runnable design
 * harness actually renders.
 *
 * These are here because the two things they pin are both things that were
 * wrong in a way no reader would notice: a console that was built, guarded and
 * unreachable, and a role predicate one notch too wide.
 */

const settingsOf = user => navGroupsFor(user).find(g => g.section === 'settings');
const labels = user => (settingsOf(user)?.items || []).map(i => i.en);

const orgAdmin = { org_roles: [{ role_code: 'org_admin' }] };
const plainMember = { org_roles: [{ role_code: 'org_member' }] };

describe('Settings nav section', () => {
  it('carries the four rows the design has, in order', () => {
    // Categories is build-only and sits between Organisation and the console;
    // the design's four are otherwise in the design's order.
    //
    // `Connectors` joined them 2026-08-07 and is also build-only: the app
    // credentials every network needs before anyone can connect an account had
    // nowhere to be entered at all. It sits beside Organisation because it is
    // the same kind of thing — an org-wide setting only an owner or admin may
    // touch — and `orgAdminOnly` on the row matches the API's
    // `require_org_role`, which the row below this one asserts.
    expect(labels({ ...orgAdmin, platform_roles: ['platform_owner'] })).toEqual([
      'Roles & access', 'Customization', 'Organisation', 'Connectors',
      'Categories', 'Aekam admin',
    ]);
  });

  it('hides Connectors from a member who is not an org admin', () => {
    // An app secret is what publishing rests on. A Marketing editor may
    // schedule posts and may not hold the key that makes posting possible —
    // the same line `routers/hub_connectors.py` draws with require_org_role.
    expect(labels(plainMember)).not.toContain('Connectors');
  });

  it('has no Billing row — it pointed at a tab of the row above it', () => {
    expect(labels({ ...orgAdmin, platform_roles: ['platform_owner'] })).not.toContain('Billing');
  });

  it('hides Roles & access and Organisation from a member who is not an org admin', () => {
    expect(labels(plainMember)).toEqual(['Customization', 'Categories']);
  });
});

describe('the Aekam admin row is gated exactly as /admin is', () => {
  it('shows for every role ADMIN_SURFACE_ROLES names', () => {
    for (const role of ADMIN_SURFACE_ROLES) {
      expect(labels({ ...orgAdmin, platform_roles: [role] })).toContain('Aekam admin');
    }
  });

  // The whole reason `consoleOnly` exists rather than reusing `adminOnly`.
  // Both of these hold A platform role, and `/admin` bounces both.
  it('hides for sahayak_admin and platform_support, who hold a platform role and reach nothing', () => {
    expect(labels({ ...orgAdmin, platform_roles: ['sahayak_admin'] })).not.toContain('Aekam admin');
    expect(labels({ ...orgAdmin, platform_roles: ['platform_support'] })).not.toContain('Aekam admin');
  });

  it('hides for a tenant with no platform role at all', () => {
    expect(labels(orgAdmin)).not.toContain('Aekam admin');
  });

  it('shows for the legacy role === "admin" operator, matching Protected.jsx', () => {
    expect(navContext({ role: 'admin' }).canOpenAdmin).toBe(true);
  });

  it('is absent from the CLIENT nav entirely', () => {
    const client = { role: 'client', org_roles: [] };
    expect(navGroupsFor(client).flatMap(g => g.items).map(i => i.to)).not.toContain('/admin');
  });
});

describe('route metadata', () => {
  it('names /admin from the nav row rather than the retired EXTRA_ROUTES entry', () => {
    expect(ROUTE_META['/admin'].en).toBe('Aekam admin');
  });

  it('resolves the new roles destination', () => {
    expect(resolveRouteMeta('/settings/roles').en).toBe('Roles & access');
  });

  // Longest-prefix, so the console's own sub-routes keep their own names.
  it('does not collapse /admin/orgs onto /admin', () => {
    expect(resolveRouteMeta('/admin/orgs').en).toBe('Organisations');
  });
});

describe('the module a route belongs to (F32 — what `ModuleAccess` publishes)', () => {
  it('gives every module route its grant code', () => {
    expect(resolveRouteMeta('/ganit').module).toBe('ganit');
    expect(resolveRouteMeta('/vetana').module).toBe('vetana');
    // Deep paths resolve through the same longest-prefix match.
    expect(resolveRouteMeta('/ganit/anything/deeper').module).toBe('ganit');
  });

  it('gives the WHOLE /hub/clients subtree the sahayak module', () => {
    // `/hub/clients` claims this subtree by longest prefix, beating `/hub`.
    // Without a module on it the client detail page — which renders the same
    // Sahayak tabs as `/hub` — resolved to nothing and every write control on
    // it failed open, so one Generate button gated itself at `/hub` and the
    // identical one did not two routes away.
    expect(resolveRouteMeta('/hub').module).toBe('sahayak');
    expect(resolveRouteMeta('/hub/org').module).toBe('sahayak');
    expect(resolveRouteMeta('/hub/clients').module).toBe('sahayak');
    expect(resolveRouteMeta('/hub/clients/abc-123').module).toBe('sahayak');
    expect(resolveRouteMeta('/hub/clients/abc-123/skills').module).toBe('sahayak');
  });

  it('leaves non-module routes with no module, so nothing is gated there', () => {
    // Today, Tasks and Settings are not module-gated. A module code here would
    // disable their controls for anyone holding a partial grant set.
    expect(resolveRouteMeta('/dashboard').module).toBeUndefined();
    expect(resolveRouteMeta('/tasks').module).toBeUndefined();
    expect(resolveRouteMeta('/settings').module).toBeUndefined();
    expect(resolveRouteMeta('/admin/orgs').module).toBeUndefined();
  });
});

describe('canSeeNavItem', () => {
  it('treats consoleOnly as narrower than adminOnly', () => {
    const ctx = navContext({ platform_roles: ['sahayak_admin'] });
    expect(canSeeNavItem({ adminOnly: true }, ctx)).toBe(true);
    expect(canSeeNavItem({ consoleOnly: true }, ctx)).toBe(false);
  });
});
