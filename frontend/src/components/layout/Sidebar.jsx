/**
 * Sidebar.jsx — the ink sidebar, restyled to 01-navigation.md §1.
 *
 * Class vocabulary is `.side*`; the `.k-sidebar*` set it replaced was defined
 * twice (kartavaya-design.css and editorial.css) with the second copy
 * shadowing the first, which is how the light sidebar variant shipped without
 * an active-item override.
 *
 * English is the primary label, Devanagari the sub-label — the same hierarchy
 * staging already had, restyled rather than inverted, so DOM order matches
 * visual weight.
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { currentUser } from '../../lib/auth';
import { ICONS } from './navIcons';
import { navGroupsFor } from './navConfig';
import { useCustomize } from '../CustomizePanel';
import SideBrand from './SideBrand';

// Keys are kept VERBATIM. Renaming either silently resets every existing
// user's sidebar to defaults, which reads as data loss rather than a restyle.
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

/**
 * @param {boolean} forceWide  MobileDrawer renders the sidebar at full width
 *   regardless of the rail preference — a rail inside a 280px overlay is a
 *   column of unlabelled icons with no reason to be narrow.
 */
export default function Sidebar({ inboxCount = 0, approvalsCount = 0, forceWide = false, onNavigate }) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const user      = currentUser();

  const { prefs } = useCustomize();
  const lang  = prefs.language || 'en+sa';
  const showGu = lang === 'gu' || lang === 'en+gu';

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

  const isRail = prefs.sidebar === 'rail';
  const rail = !forceWide && (isRail || collapsed);

  // Role predicates moved to navConfig.js and expressed against org_roles.
  // The old `isMember` boolean folded platform roles into the owner test, so
  // Reports was visible to any platform user regardless of org membership.
  const groups = React.useMemo(() => navGroupsFor(user), [user]);

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

  const go = (to) => { navigate(to); onNavigate?.(); };

  const initials = ((user?.full_name || user?.name || 'U')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase());

  return (
    <aside className={'side' + (rail ? ' side--rail' : '')}>
      <SideBrand rail={rail} />

      <nav className="side__nav">
        {groups.map(({ section, sans, gu: guSec, items }) => {
          const expanded = rail ? true : isSectionExpanded(section);
          return (
            <div key={section}>
              {!rail && (
                <button
                  type="button"
                  className="side__sec"
                  aria-expanded={expanded}
                  onClick={() => toggleSection(section)}
                >
                  <span className="side__sec-chev" aria-hidden="true">{ICONS.chevR}</span>
                  <span className="side__sec-name">{section}</span>
                  <span className="side__sec-hi" lang={showGu ? 'gu' : 'hi'} aria-hidden="true">
                    {showGu ? guSec : sans}
                  </span>
                </button>
              )}
              {rail && <div className="side__sec" aria-hidden="true" />}

              {/* grid-template-rows 0fr → 1fr, not a maxHeight computed from
                  items.length * 44. The literal broke the moment density or
                  font size changed, and 09-customization.md makes both
                  user-settable. The duration is a token, so Animations =
                  Reduced/None reaches it. */}
              <div className="side__sec-items" data-open={expanded ? '1' : '0'}>
                <div>
                  {items.map(({ to, icon, en, hi, gu: guLabel, adminOnly, badge }) => {
                    const badgeCount = badge === 'unread' ? inboxCount
                                     : badge === 'approvals' ? approvalsCount
                                     : 0;
                    const secondaryLabel = showGu ? guLabel : hi;
                    return (
                      <button
                        key={en}
                        type="button"
                        className={'side__item' + (isActive(to) ? ' on' : '')}
                        onClick={() => go(to)}
                        title={rail ? en : undefined}
                        aria-current={isActive(to) ? 'page' : undefined}
                      >
                        <span className="side__ic" aria-hidden="true">{ICONS[icon]}</span>
                        {!rail && (
                          <span className="side__label">
                            <span className="side__en">{en}</span>
                            {/* lang so a screen reader that does read this uses
                                the right voice. aria-hidden because this is the
                                SAME label in a second script, not additional
                                information: announcing both gives
                                "Tasks कर्तव्य Tasks कर्तव्य" as focus moves. */}
                            <span className="side__hi" lang={showGu ? 'gu' : 'hi'} aria-hidden="true">
                              {secondaryLabel}
                            </span>
                          </span>
                        )}
                        {!rail && adminOnly && (
                          <span className="side__badge side__badge--admin">ADMIN</span>
                        )}
                        {!rail && badgeCount > 0 && (
                          <span className="side__badge side__badge--count">
                            {badgeCount > 9 ? '9+' : badgeCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* The rail toggle is hidden when the rail is the stored preference —
          there is nothing to toggle back to, and a control that appears to do
          nothing is worse than no control. */}
      {!isRail && !forceWide && (
        <button
          type="button"
          className="side__toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={toggleCollapsed}
        >
          <span className="side__toggle-chev" aria-hidden="true">{ICONS.chevL}</span>
          {!collapsed && <span>Collapse</span>}
        </button>
      )}

      <div className="side__foot">
        <div className="k-avatar k-avatar--me">{initials}</div>
        {!rail && (
          <>
            <div className="side__me">
              <div className="side__me-n">{user?.full_name || user?.name || 'User'}</div>
              <div className="side__me-r">{user?.role || 'member'}</div>
            </div>
            <button
              type="button"
              className="side__foot-btn"
              title="Sign out"
              aria-label="Sign out"
              onClick={async () => {
                const { apiLogout } = await import('../../lib/auth');
                await apiLogout();
                window.location.href = '/login';
              }}
            >
              {ICONS.logout}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
