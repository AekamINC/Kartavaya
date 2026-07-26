/**
 * AdminShell.jsx — the Aekam platform console. 01-navigation.md §2/§3.
 *
 * A different SURFACE, not a page: it replaces the app sidebar and owns the
 * window. Previously `/admin/*` rendered inside AppShell, so the operator kept
 * their own tenant chrome — their accent, their org's breadcrumb — while
 * looking at other companies' data.
 *
 * Access is guarded by <Protected> in App.jsx exactly as the app shell is;
 * this component adds the *visual* separation, and the backend remains the
 * authority on whether the data comes back at all.
 */
import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { currentUser } from '../../lib/auth';
import AdminSidebar from './AdminSidebar';
import { adminNavFor, resolveAdminMeta } from './adminNav';
import { ICONS } from '../layout/navIcons';
import SkipLink from '../ui/SkipLink';

export default function AdminShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = React.useState(false);
  const [orgCount, setOrgCount] = React.useState(null);

  // `currentUser()` JSON.parses localStorage, so it hands back a NEW object on
  // every render and is useless as a memo dependency. Keying on the joined
  // string instead makes `platformRoles` — and therefore `items`, and therefore
  // the redirect effect below — stable across renders that changed nothing.
  const user = currentUser();
  const roleKey = Array.isArray(user?.platform_roles) ? user.platform_roles.join(',') : '';
  const legacyAdmin = user?.role === 'admin';
  const platformRoles = React.useMemo(() => (roleKey ? roleKey.split(',') : []), [roleKey]);

  /**
   * Admittance is the union of the rows this operator can open, NOT "holds any
   * platform role".
   *
   * The old test let every Tier-1 code in. `srijan_admin` and `platform_support`
   * therefore reached a console whose every endpoint refuses them — and
   * `platform_support` is specified to hold zero access until an org admin
   * approves a time-boxed session, a flow whose table does not exist yet. An
   * operator who can open no row is sent back rather than shown a shell with an
   * empty rail.
   *
   * `Protected` in App.jsx applies the same test before this component mounts;
   * the two must agree or the route resolves and then renders nothing, which is
   * exactly the defect that put an org-role check on a platform surface.
   */
  const items = React.useMemo(
    () => adminNavFor(platformRoles, legacyAdmin),
    [platformRoles, legacyAdmin],
  );
  const isPlatform = items.length > 0;

  /**
   * Which console row this URL belongs to, and whether this operator holds it.
   *
   * Resolved through `resolveAdminMeta` — longest prefix over the FULL nav —
   * rather than by testing the permitted rows directly. A direct test would let
   * `/admin/costs` satisfy the `/admin` row's own prefix, so anyone who could
   * see Overview would count as allowed everywhere under it, which is every
   * admin page. Resolving first and checking membership second cannot do that.
   *
   * This matters for `account_finance`, whose rows are Billing and Cost
   * dashboard but NOT Overview: `/admin` is a real route for them and lands on a
   * page where every request 403s. They are moved to their first real row.
   */
  const meta = resolveAdminMeta(location.pathname);
  const pathAllowed = items.some(it => it.to === meta.to);

  // Route change closes the overlay nav, or the drawer stays over the page it
  // just navigated to.
  React.useEffect(() => { setNavOpen(false); }, [location.pathname]);

  React.useEffect(() => {
    if (!isPlatform) return undefined;
    let live = true;
    // count_only, so the badge does not pull every org row on every admin page.
    api.get('/v1/admin/orgs', { params: { count_only: 1 } })
      .then(r => {
        if (!live) return;
        const d = r.data;
        setOrgCount(typeof d?.count === 'number' ? d.count : (Array.isArray(d?.data) ? d.data.length : null));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [isPlatform]);

  // Not a platform operator: send them back rather than render an empty
  // console. The route is still <Protected>; this is the surface-level guard.
  React.useEffect(() => {
    if (!isPlatform) { navigate('/dashboard', { replace: true }); return; }
    if (!pathAllowed) navigate(items[0].to, { replace: true });
  }, [isPlatform, pathAllowed, items, navigate]);
  if (!isPlatform || !pathAllowed) return null;

  return (
    <div data-testid="admin-shell" className="adm" data-surface="platform">
      <SkipLink />

      {navOpen && <button type="button" className="adm__scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
      <AdminSidebar
        open={navOpen}
        orgCount={orgCount}
        onNavigate={() => setNavOpen(false)}
        platformRoles={platformRoles}
        legacyAdmin={legacyAdmin}
      />

      <div className="adm__main">
        <div className="adm__bar">
          <button type="button" className="adm__burger" aria-label="Open navigation" onClick={() => setNavOpen(true)}>
            {ICONS.burger}
          </button>
          <span className="adm__crumb">
            <b className="adm__crumb-b">Aekam platform</b>
            <span aria-hidden="true">/</span>
            <span lang="hi" aria-hidden="true">{meta.hi}</span>
            <span>{meta.en}</span>
          </span>
          {/* Support access is never silent — 08-rbac-screens.md. */}
          <span className="adm__warn">
            <span aria-hidden="true" style={{ display: 'inline-flex', verticalAlign: '-2px', marginRight: 5 }}>{ICONS.eye}</span>
            Everything here is audited
          </span>
        </div>

        <main className="adm__body" id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
