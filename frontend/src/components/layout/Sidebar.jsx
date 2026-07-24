/**
 * Sidebar.jsx — redesigned dark ink sidebar with bilingual grouped nav.
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { currentUser } from '../../lib/auth';
import { useCustomize } from '../CustomizePanel';

// ── Nav icons (inline SVG, stroke-based) ────────────────────────────────
const ICONS = {
  dashboard:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1.5"/></svg>,
  projects:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 5l1.5-2H7l1.5 2H14v8H2V5z"/></svg>,
  tasks:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 4h10M3 8h7M3 12h9"/><circle cx="13" cy="8" r="1.4" fill="currentColor" stroke="none"/></svg>,
  approvals:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6"/><path d="M5.5 8l1.8 1.8L10.5 6.5"/></svg>,
  activity:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1 8h3l2-5 4 10 2-5h3"/></svg>,
  automations: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M9 2L3 9h4l-1 5 6-7H8l1-5z"/></svg>,
  time:        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8.5" r="5.5"/><path d="M8 5.5v3l2 1.5"/><path d="M5.5 1.5h5"/></svg>,
  templates:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 2.5h7l3 3v8H3z"/><path d="M9.5 2.5V6H13"/><path d="M5.5 9h5M5.5 11h3"/></svg>,
  reports:     <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 9.5l2-2 2 2 2-3"/><path d="M5 6h2"/></svg>,
  teams:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="6" cy="6" r="2.4"/><path d="M1.5 13c0-2.6 2-4.2 4.5-4.2S10.5 10.4 10.5 13"/><circle cx="12" cy="6" r="1.6"/><path d="M11.5 9.2c1.7 0 3 1.1 3 2.6"/></svg>,
  categories:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 2h5.5l6.5 6.5-5.5 5.5L2 7.5V2z"/><circle cx="5.5" cy="5.5" r="1"/></svg>,
  notifications:<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M13 11l-2-2H5L3 11V4a1 1 0 011-1h8a1 1 0 011 1v7z"/><path d="M6.5 13.5a1.5 1.5 0 003 0"/></svg>,
  inbox:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 11h3l1 2h4l1-2h3V4a1 1 0 00-1-1H3a1 1 0 00-1 1v7z"/><path d="M5.5 7.5h5"/><path d="M5.5 5.5h3"/></svg>,
  admin:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 2l5 2v4.5c0 3-2.2 5.2-5 5.8C5.2 13.7 3 11.5 3 8.5V4l5-2z"/><path d="M6 8.2l1.3 1.3L10 6.8"/></svg>,
  billing:     <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6.5h12"/><path d="M5 10h3"/><path d="M10 10h1.5"/></svg>,
  hub:         <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="2"/><path d="M8 2v4M8 10v4M2 8h4M10 8h4M4 4l2.8 2.8M9.2 9.2L12 12M12 4l-2.8 2.8M6.8 9.2L4 12"/></svg>,
  org:         <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="4" y="2" width="8" height="12" rx="1"/><path d="M6 5h1.5M6 7.5h1.5M6 10h1.5M9 5h1M9 7.5h1"/></svg>,
  graha:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="5" r="3"/><path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/></svg>,
  ganit:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 6h12M6 6v8"/><path d="M9 9h2M9 11h2"/></svg>,
  manav:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="6" cy="4.5" r="2"/><circle cx="11" cy="4.5" r="2"/><path d="M1.5 12c0-2.2 2-3.5 4.5-3.5s4.5 1.3 4.5 3.5"/><path d="M10 8.5c1.8 0 3.5 1 3.5 3"/></svg>,
  vikray:      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 3h2l2 8h6l2-5H6"/><circle cx="7" cy="13.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="13.5" r="1" fill="currentColor" stroke="none"/></svg>,
  vetana:      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2.5" y="2" width="11" height="12" rx="1.5"/><path d="M5.5 5.5h5M5.5 8h3M5.5 10.5h4"/><path d="M10 9l1.5 1.5L10 12" strokeWidth="1.2"/></svg>,
  dristi:      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 10l3-5 3 3 4-6"/><path d="M11 2h3v3"/><circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="9" r="1.2" fill="currentColor" stroke="none"/></svg>,
  prachar:     <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 4h8v7H2z"/><path d="M10 6l4-2v9l-4-2"/><path d="M4 11v2.5"/><path d="M6 11v2.5"/></svg>,
  esign:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M9.5 2.5l4 4-8 8H1.5v-4z"/><path d="M8 4l4 4"/></svg>,
  customize:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/></svg>,
  logout:      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M11 11l3-3-3-3M14 8H6"/></svg>,
  chart:       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 13V7M7 13V4M11 13V9M15 13V2"/><path d="M1 14h14"/></svg>,
};

// ── Nav structure ────────────────────────────────────────────────────────
const NAV_FULL = [
  {
    section: 'workspace', sans: 'कार्यक्षेत्र', gu: 'કાર્યક્ષેત્ર',
    items: [
      { to: '/dashboard', icon: 'dashboard', en: 'Today',    hi: 'आज',      gu: 'આજ' },
      { to: '/tasks',     icon: 'tasks',     en: 'Tasks',    hi: 'कर्तव्य', gu: 'કાર્ય' },
      { to: '/boards',    icon: 'projects',  en: 'Boards',   hi: 'फ़लक',    gu: 'ફલક' },
      { to: '/projects',  icon: 'projects',  en: 'Projects', hi: 'योजना',   gu: 'યોજના' },
    ],
  },
  {
    section: 'operations', sans: 'प्रचालन', gu: 'સંચાલન',
    items: [
      { to: '/approvals',   icon: 'approvals',   en: 'Approvals',   hi: 'सम्मति',    gu: 'મંજૂરી', badge: 'approvals' },
      { to: '/activity',    icon: 'activity',    en: 'Activity',    hi: 'क्रिया',     gu: 'પ્રવૃત્તિ' },
      { to: '/automations', icon: 'automations', en: 'Automations', hi: 'स्वचालन',   gu: 'સ્વચાલન' },
      { to: '/time',        icon: 'time',        en: 'Time Report', hi: 'काल',       gu: 'સમય' },
      { to: '/reports',     icon: 'reports',     en: 'Reports',     hi: 'प्रतिवेदन', gu: 'અહેવાલ', ownerOnly: true },
      { to: '/templates',   icon: 'templates',   en: 'Templates',   hi: 'साँचा',     gu: 'નમૂનો' },
    ],
  },
  {
    section: 'team', sans: 'दल', gu: 'ટીમ',
    items: [
      { to: '/teams',  icon: 'teams', en: 'Team',  hi: 'सहयोगी', gu: 'સહયોગી' },
      { to: '/inbox',  icon: 'inbox', en: 'Inbox', hi: 'सन्देश', gu: 'સંદેશ', badge: 'unread' },
    ],
  },
  {
    section: 'srijan', sans: 'सृजन', gu: 'સર્જન',
    items: [
      { to: '/hub/org', icon: 'hub', en: 'Srijan', hi: 'सृजन', gu: 'સર્જન' },
      { to: '/hub', icon: 'settings', en: 'Srijan Admin', hi: 'सृजन व्यवस्था', gu: 'સર્જન વ્યવસ્થા', adminOnly: true },
    ],
  },
  {
    section: 'modules', sans: 'मॉड्यूल', gu: 'મૉડ્યુલ',
    items: [
      { to: '/graha',   icon: 'graha',   en: 'CRM',       hi: 'ग्राह',   gu: 'ગ્રાહ' },
      { to: '/ganit',   icon: 'ganit',   en: 'Invoicing',  hi: 'गणित',   gu: 'ગણિત' },
      { to: '/manav',   icon: 'manav',   en: 'HRMS',       hi: 'मानव',   gu: 'માનવ' },
      { to: '/vikray',  icon: 'vikray',  en: 'Sales',      hi: 'विक्रय', gu: 'વિક્રય' },
      { to: '/vetana',  icon: 'vetana',  en: 'Payroll',    hi: 'वेतन',   gu: 'વેતન' },
      { to: '/dristi',  icon: 'dristi',  en: 'Analytics',  hi: 'दृष्टि', gu: 'દૃષ્ટિ' },
      { to: '/prachar', icon: 'prachar', en: 'Marketing',  hi: 'प्रचार', gu: 'પ્રચાર' },
      { to: '/esign',   icon: 'esign',   en: 'E-Sign',     hi: 'प्रमाण', gu: 'પ્રમાણ' },
      { to: '/sanvaad', icon: 'inbox',   en: 'Messages',   hi: 'संवाद',  gu: 'સંવાદ' },
    ],
  },
  {
    section: 'settings', sans: 'व्यवस्था', gu: 'સેટિંગ્સ',
    items: [
      { to: '/settings/categories',    icon: 'categories',    en: 'Categories',    hi: 'वर्ग',   gu: 'વર્ગ' },
      { to: '/settings/notifications', icon: 'notifications', en: 'Notifications', hi: 'सूचना',  gu: 'સૂચના' },
      { to: '/settings/customize',     icon: 'customize',     en: 'Customize',     hi: 'सजावट',  gu: 'સજાવટ' },
      { to: '/billing',               icon: 'billing',       en: 'Billing',       hi: 'बिलिंग', gu: 'બિલિંગ' },
    ],
  },
];

const NAV_CLIENT = [
  {
    section: 'workspace', sans: 'कार्यक्षेत्र', gu: 'કાર્યક્ષેત્ર',
    items: [
      { to: '/dashboard',       icon: 'dashboard', en: 'Dashboard',     hi: 'अद्य',   gu: 'ડૅશબોર્ડ' },
      { to: '/client/projects', icon: 'projects',  en: 'My Projects',   hi: 'योजना',   gu: 'યોજના' },
      { to: '/tasks',           icon: 'tasks',     en: 'My Tasks',      hi: 'कर्तव्य', gu: 'કાર્ય' },
      { to: '/approvals',       icon: 'approvals', en: 'Approvals',     hi: 'सम्मति',  gu: 'મંજૂરી' },
      { to: '/inbox',           icon: 'inbox',     en: 'Inbox',         hi: 'सन्देश',  gu: 'સંદેશ', badge: 'unread' },
      { to: '/settings/notifications', icon: 'notifications', en: 'Notifications', hi: 'सूचना', gu: 'સૂચના' },
    ],
  },
];

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

export default function Sidebar({ inboxCount = 0 }) {
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

  const isActive = (to) =>
    location.pathname === to || location.pathname.startsWith(to + '/');

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
                style={{
                  maxHeight: expanded ? items.length * 44 + 'px' : '0px',
                  overflow: 'hidden',
                  transition: 'max-height .2s ease',
                }}
              >
                {items.filter(item => (!item.ownerOnly || !isMember) && (!item.adminOnly || isAdmin)).map(({ to, icon, en, hi, gu: guLabel, adminOnly, badge }) => {
                  const badgeCount = badge === 'unread' ? inboxCount : 0;
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
                      {!rail && <span className="k-sidebar__hi-mute">{secondaryLabel}</span>}
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
