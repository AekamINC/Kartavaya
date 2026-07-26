/**
 * AdminSidebar.jsx — the platform console's own nav. 01-navigation.md §3.
 *
 * The violet is not the user's accent and must not be derived from it: an
 * operator looking at another company's data should never see their own theme.
 * `.adm` re-points --primary / --primary-text to the fixed --pf-* literals
 * (00 §9), which is why nothing in here reads the accent tokens.
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ADMIN_NAV } from './adminNav';
import { ICONS } from '../layout/navIcons';

export default function AdminSidebar({ open = false, orgCount = null, onNavigate }) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (to) =>
    location.pathname === to ||
    (to !== '/admin' && location.pathname.startsWith(to + '/'));

  const go = (to) => { navigate(to); onNavigate?.(); };

  return (
    <aside className={'adm__side' + (open ? ' adm__side--open' : '')}>
      <button type="button" className="adm__back" onClick={() => go('/dashboard')}>
        <span aria-hidden="true" style={{ display: 'inline-flex' }}>{ICONS.chevL}</span>
        Back to Kartavaya
      </button>

      {/* Support access is never silent. The pulse and the count say, on every
          screen, that this session is looking at other organisations' data. */}
      <div className="adm__badge">
        <span className="adm__badge-d" aria-hidden="true" />
        Aekam platform
        {orgCount != null && <span className="adm__badge-n">{orgCount} orgs</span>}
      </div>

      <nav className="adm__nav" aria-label="Platform admin">
        {ADMIN_NAV.map(({ to, icon, en, hi, count }) => (
          <button
            key={to}
            type="button"
            className={'adm__item' + (isActive(to) ? ' on' : '')}
            onClick={() => go(to)}
            aria-current={isActive(to) ? 'page' : undefined}
          >
            <span className="adm__ic" aria-hidden="true">{ICONS[icon]}</span>
            <span className="adm__l">
              <span>{en}</span>
              <span className="adm__l-hi" lang="hi" aria-hidden="true">{hi}</span>
            </span>
            {count === 'orgs' && orgCount != null && (
              <span className="adm__count">{orgCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="adm__foot">Everything here is audited.</div>
    </aside>
  );
}
