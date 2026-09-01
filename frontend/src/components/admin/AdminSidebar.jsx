/**
 * AdminSidebar.jsx — the platform console's own nav. 01-navigation.md §3.
 *
 * The violet is not the user's accent and must not be derived from it: an
 * operator looking at another company's data should never see their own theme.
 * `.adm` re-points --primary / --primary-text to the fixed --pf-* literals
 * (00 §9), which is why nothing in here reads the accent tokens.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { adminNavFor } from './adminNav';
import { ICONS } from '../layout/navIcons';
import { Secondary } from '../Bilingual';

/**
 * @param {string[]} platformRoles  Tier-1 codes from `/auth/me`. Rows the holder
 *   cannot open are ABSENT, not disabled — RBAC-SPEC denied state 1.
 * @param {boolean}  legacyAdmin    `users.role === 'admin'`, the pre-user_roles
 *   fallback. Shows every row, as it did before there were role rows to read.
 */
export default function AdminSidebar({ open = false, orgCount = null, onNavigate, platformRoles, legacyAdmin = false }) {
  const location = useLocation();
  const items = React.useMemo(
    () => adminNavFor(platformRoles, legacyAdmin),
    [platformRoles, legacyAdmin],
  );

  const isActive = (to) =>
    location.pathname === to ||
    (to !== '/admin' && location.pathname.startsWith(to + '/'));

  /* Anchors, for the same reason as the staff sidebar — see Sidebar.jsx. A
     platform admin looking at one org's data while comparing another's is
     exactly the person who needs two tabs, and a <button onClick> gave them
     nothing to ctrl-click. */
  const closesDrawer = (e) =>
    !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);

  return (
    <aside className={'adm__side' + (open ? ' adm__side--open' : '')}>
      <Link
        to="/dashboard"
        className="adm__back"
        onClick={(e) => { if (closesDrawer(e)) onNavigate?.(); }}
      >
        <span aria-hidden="true" style={{ display: 'inline-flex' }}>{ICONS.chevL}</span>
        Back to Kartavaya
      </Link>

      {/* Support access is never silent. The pulse and the count say, on every
          screen, that this session is looking at other organisations' data. */}
      <div className="adm__badge">
        <span className="adm__badge-d" aria-hidden="true" />
        Aekam platform
        {orgCount != null && <span className="adm__badge-n">{orgCount} orgs</span>}
      </div>

      <nav className="adm__nav" aria-label="Platform admin">
        {items.map(({ to, icon, en, hi, count }) => (
          <Link
            key={to}
            to={to}
            className={'adm__item' + (isActive(to) ? ' on' : '')}
            onClick={(e) => { if (closesDrawer(e)) onNavigate?.(); }}
            aria-current={isActive(to) ? 'page' : undefined}
          >
            <span className="adm__ic" aria-hidden="true">{ICONS[icon]}</span>
            <span className="adm__l">
              <span>{en}</span>
              <Secondary className="adm__l-hi" value={hi} />
            </span>
            {count === 'orgs' && orgCount != null && (
              <span className="adm__count">{orgCount}</span>
            )}
          </Link>
        ))}
      </nav>

      <div className="adm__foot">Everything here is audited.</div>
    </aside>
  );
}
