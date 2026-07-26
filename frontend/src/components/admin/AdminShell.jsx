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
import { resolveAdminMeta } from './adminNav';
import { ICONS } from '../layout/navIcons';
import SkipLink from '../ui/SkipLink';

export default function AdminShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = React.useState(false);
  const [orgCount, setOrgCount] = React.useState(null);

  const user = currentUser();
  const hasPlatformRole = Array.isArray(user?.platform_roles) && user.platform_roles.length > 0;
  const isPlatform = hasPlatformRole || user?.role === 'admin';

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
    if (!isPlatform) navigate('/dashboard', { replace: true });
  }, [isPlatform, navigate]);
  if (!isPlatform) return null;

  const meta = resolveAdminMeta(location.pathname);

  return (
    <div data-testid="admin-shell" className="adm" data-surface="platform">
      <SkipLink />

      {navOpen && <button type="button" className="adm__scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
      <AdminSidebar open={navOpen} orgCount={orgCount} onNavigate={() => setNavOpen(false)} />

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
