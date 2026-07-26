/**
 * Sidebar.jsx — redesigned dark ink sidebar with bilingual grouped nav.
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { currentUser } from '../../lib/auth';
import { ICONS } from './navIcons';
import { NAV_FULL, NAV_CLIENT } from './navConfig';
import { useCustomize } from '../CustomizePanel';

// ── Nav icons (inline SVG, stroke-based) ────────────────────────────────
// ICONS extracted to navIcons.jsx (01-navigation.md §3).

// ── Nav structure ────────────────────────────────────────────────────────
// NAV_FULL / NAV_CLIENT moved to navConfig.js — the topbar derives its
// breadcrumb from the same list, so the two can no longer disagree.

function KMark({ size = 30 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.26,
      background: 'linear-gradient(135deg,#0082c6,#03a1b6 55%,#05b7aa)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      boxShadow: '0 1px 0 rgba(255,255,255,.22) inset, 0 4px 14px rgba(0,130,198,.28)',
    }}>
      <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 22 22" fill="none">
        <path d="M4 11L11 4L18 11L11 18L4 11Z" stroke="white" strokeWidth="1.8"/>
        <path d="M7.5 11L11 7.5L14.5 11L11 14.5L7.5 11Z" fill="white" opacity=".88"/>
      </svg>
    </div>
  );
}

const SECTIONS_KEY = 'kartavya_sidebar_sections';
const COLLAPSED_KEY = 'kartavya_sidebar_collapsed';
const CORE_SECTION = 'workspace'; // expanded by default on first visit — everything else starts collapsed

function loadSectionState() {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* ignore */ }
  return null; // signals "no saved prefs yet" so callers can apply defaults per-section
}

function loadCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch (_) { return false; }
}

export default function Sidebar({ inboxCount = 0, approvalsCount = 0 }) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const user      = currentUser();
  const hasPlatformRole = Array.isArray(user?.platform_roles) && user.platform_roles.length > 0;
  const isAdmin   = user?.role === 'admin' || hasPlatformRole;
  const isOrgAdmin = Array.isArray(user?.org_roles) && user.org_roles.some(r => r.role_code === 'org_admin' || r.role_code === 'org_owner');
  const isOrgMember = Array.isArray(user?.org_roles) && user.org_roles.length > 0;
  const isClient  = user?.role === 'client' && !isOrgMember;
  const isMember  = !isAdmin && !isClient && user?.role !== 'owner';

  const { prefs } = useCustomize();
  const lang = prefs.language || 'en+sa';
  const isRail = prefs.sidebar === 'rail';
  const showGu = lang === 'gu' || lang === 'en+gu';
  const showHi = lang === 'en+sa' || lang === 'en+hi' || lang === 'hi';

  // ── Collapsible sections + collapsed rail state (persisted) ──────────────
  const [sectionState, setSectionState] = React.useState(loadSectionState);
  const [collapsed, setCollapsed] = React.useState(loadCollapsed);

  const isSectionExpanded = (section) => {
    if (sectionState && Object.prototype.hasOwnProperty.call(sectionState, section)) return sectionState[section];
    return section === CORE_SECTION; // default: only Core expanded on first visit
  };

  const toggleSection = (section) => {
    setSectionState(prev => {
      const base = prev || {};
      const next = { ...base, [section]: !isSectionExpanded(section) };
      try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)); } catch (_) { /* ignore */ }
      return next;
    });
  };

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0'); } catch (_) { /* ignore */ }
      return next;
    });
  };

  const effectiveRail = isRail || collapsed;

  const groups = isClient ? NAV_CLIENT : NAV_FULL;
  let allGroups = groups;
  if (isAdmin) {
    allGroups = groups.map(g =>
      g.section === 'settings'
        ? { ...g, items: [...g.items,
            { to: '/admin', icon: 'admin', en: 'Admin', hi: 'प्रशासन', gu: 'પ્રશાસન', adminOnly: true },
            { to: '/admin/billing', icon: 'billing', en: 'Admin Billing', hi: 'बिलिंग प्रशासन', gu: 'બિલિંગ પ્રશાસન', adminOnly: true },
            { to: '/admin/orgs', icon: 'org', en: 'Organisations', hi: 'संगठन', gu: 'સંગઠન', adminOnly: true },
            { to: '/admin/costs', icon: 'chart', en: 'Cost Dashboard', hi: 'लागत', gu: 'ખર્ચ', adminOnly: true },
          ] }
        : g
    );
  } else if (isOrgAdmin) {
    allGroups = groups.map(g =>
      g.section === 'settings'
        ? { ...g, items: [...g.items,
            { to: '/settings/organisation', icon: 'org', en: 'Organisation', hi: 'संगठन', gu: 'સંગઠન' },
          ] }
        : g
    );
  }

  // An entry may carry a query string (the client nav points at a specific tab
  // of the customize hub). Entries without one match on path alone, so
  // Customize stays lit on every tab; entries with one must also match the
  // param, so a tab-specific link doesn't light up on its siblings.
  const isActive = (to) => {
    const [path, query] = to.split('?');
    if (location.pathname !== path && !location.pathname.startsWith(path + '/')) return false;
    if (!query) return true;
    const want = new URLSearchParams(query);
    const have = new URLSearchParams(location.search);
    return [...want].every(([k, v]) => have.get(k) === v);
  };

  const initials = ((user?.full_name || user?.name || 'U')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase());

  const chevron = (expanded) => (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"
      style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s', flexShrink: 0 }}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  );

  const rail = effectiveRail;
  return (
    <aside className={`k-sidebar${rail ? ' k-sidebar--rail' : ''}${collapsed ? ' k-sidebar--collapsed' : ''}`}>
      {/* Brand */}
      <div className="k-sidebar__brand">
        <KMark size={rail ? 28 : 32} />
        {!rail && (
          <div className="k-wordmark">
            <div className="k-wordmark__main">Kartavaya</div>
            <div className="k-wordmark__sans">कर्तव्य</div>
            <div className="k-wordmark__sub">by Aekam Inc</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="k-sidebar__nav">
        {allGroups.map(({ section, sans, gu: guSec, items }) => {
          const expanded = rail ? true : isSectionExpanded(section);
          return (
            <div key={section} className="k-sidebar__group">
              {!rail && (
                <button
                  type="button"
                  className="k-sidebar__section"
                  aria-expanded={expanded}
                  onClick={() => toggleSection(section)}
                  style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit' }}
                >
                  {chevron(expanded)}
                  <span style={{ marginRight: 'auto' }}>{section}</span>
                  <span className="k-sidebar__section-hi">{showGu ? guSec : sans}</span>
                </button>
              )}
              <div
                className="k-sidebar__section-items"
                /* Only maxHeight is per-section. overflow and the transition
                   moved to .k-sidebar__section-items so the reduced-motion
                   scale can reach them — an inline transition cannot be
                   overridden by --ix. */
                style={{ maxHeight: expanded ? items.length * 44 + 'px' : '0px' }}
              >
                {items.filter(item => (!item.ownerOnly || !isMember) && (!item.adminOnly || isAdmin)).map(({ to, icon, en, hi, gu: guLabel, adminOnly, badge }) => {
                  // navConfig declares badge:'approvals' on /approvals, but this
                  // only ever handled 'unread' — so the count was hardcoded 0 and
                  // the element below (gated on > 0) never mounted at all.
                  const badgeCount = badge === 'unread' ? inboxCount
                                   : badge === 'approvals' ? approvalsCount
                                   : 0;
                  const secondaryLabel = showGu ? guLabel : hi;
                  return (
                    <button
                      key={en}
                      className={'k-sidebar__item' + (isActive(to) ? ' is-active' : '')}
                      onClick={() => navigate(to)}
                      title={rail ? en : undefined}
                    >
                      <span className="k-sidebar__icon">{ICONS[icon]}</span>
                      {!rail && <span>{en}</span>}
                      {/* lang so a screen reader that does read this uses the right
                          voice — without it Devanagari is read with the English one
                          and produces noise. aria-hidden because this is the SAME
                          label in a second script, not additional information:
                          announcing both gives "Tasks कर्तव्य Tasks कर्तव्य" as
                          focus moves. Visual affordance only. */}
                      {!rail && (
                        <span
                          className="k-sidebar__hi-mute"
                          lang={showGu ? 'gu' : 'hi'}
                          aria-hidden="true"
                        >
                          {secondaryLabel}
                        </span>
                      )}
                      {!rail && adminOnly && (
                        <span className="k-sidebar__badge" style={{ fontSize: 9, letterSpacing: '0.1em' }}>
                          ADMIN
                        </span>
                      )}
                      {!rail && badgeCount > 0 && (
                        <span style={{ marginLeft: 'auto', minWidth: 18, height: 18, padding: '0 4px', borderRadius: 99, background: '#dc2626', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {badgeCount > 9 ? '9+' : badgeCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="k-sidebar__foot" style={rail ? { justifyContent: 'center', padding: '12px 0', flexWrap: 'wrap' } : undefined}>
        <div className="k-avatar k-avatar--me">{initials}</div>
        {!rail && (
          <div className="k-sidebar__me">
            <div className="k-sidebar__me-name">{user?.full_name || user?.name || 'User'}</div>
            <div className="k-sidebar__me-role" style={{ textTransform: 'capitalize' }}>
              {user?.role || 'member'}
            </div>
          </div>
        )}
        {!rail && (
          <button
            className="k-sidebar__foot-btn"
            title="Sign out"
            onClick={async () => {
              const { apiLogout } = await import('../../lib/auth');
              await apiLogout();
              window.location.href = '/login';
            }}
          >
            {ICONS.logout}
          </button>
        )}
      </div>

      {/* Global collapse toggle */}
      {!isRail && (
        <button
          type="button"
          className="k-sidebar__toggle"
          aria-expanded={!collapsed}
          aria-label="Toggle sidebar"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={toggleCollapsed}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
            style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
            <path d="M10 3L5 8l5 5" />
          </svg>
          {!collapsed && <span>Collapse</span>}
        </button>
      )}
    </aside>
  );
}
