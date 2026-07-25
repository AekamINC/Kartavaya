// Sidebar + Topbar — chrome shared across all screens.
// The sidebar honors the existing brand sidebar color (#050e1a) but goes
// editorial with a serif "Kartavya / कर्तव्य" wordmark and Sanskrit section
// names. Two layout variants drive off the `sidebarVariant` tweak.

function KMark({ size = 28 }) {
  // The diamond mark from brand.js — refined slightly with a teal stop
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.26,
      background: 'linear-gradient(135deg,#0082c6,#03a1b6 55%,#05b7aa)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      boxShadow: '0 1px 0 rgba(255,255,255,.22) inset, 0 4px 14px rgba(0,130,198,.35)',
    }}>
      <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 22 22" fill="none">
        <path d="M4 11L11 4L18 11L11 18L4 11Z" stroke="white" strokeWidth="1.8"/>
        <path d="M7.5 11L11 7.5L14.5 11L11 14.5L7.5 11Z" fill="white" opacity=".88"/>
      </svg>
    </div>
  );
}

// Inline SVG icons matching the existing Sidebar.js set
const NAV_ICONS = {
  today:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1.5"/></svg>,
  tasks:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 4h10M3 8h7M3 12h9"/><circle cx="13" cy="8" r="1.4" fill="currentColor" stroke="none"/></svg>,
  boards:   <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="3" width="3" height="10" rx="1"/><rect x="6.5" y="3" width="3" height="7" rx="1"/><rect x="11" y="3" width="3" height="9" rx="1"/></svg>,
  projects: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 5l1.5-2H7l1.5 2H14v8H2V5z"/></svg>,
  team:     <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="6" cy="6" r="2.4"/><path d="M1.5 13c0-2.6 2-4.2 4.5-4.2S10.5 10.4 10.5 13"/><circle cx="12" cy="6" r="1.6"/><path d="M11.5 9.2c1.7 0 3 1.1 3 2.6"/></svg>,
  inbox:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 9l1.5-5h9L14 9v4H2V9z"/><path d="M2 9h3l1 2h4l1-2h3"/></svg>,
  reports:  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 13V3M2 13h12"/><path d="M4 10l3-4 3 2 3-5"/></svg>,
  settings: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="2"/><path d="M8 2v1.5M8 12.5V14M14 8h-1.5M3.5 8H2M12.1 3.9l-1 1M4.9 11.1l-1 1M12.1 12.1l-1-1M4.9 4.9l-1-1"/></svg>,
  approvals:<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6"/><path d="M5.5 8l1.8 1.8L10.5 6.5"/></svg>,
  activity: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1 8h3l2-5 4 10 2-5h3"/></svg>,
  automation: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M9 2L3 9h4l-1 5 6-7H8l1-5z"/></svg>,
  time:     <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8.5" r="5.5"/><path d="M8 5.5v3l2 1.5"/><path d="M5.5 1.5h5"/></svg>,
  templates:<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 2.5h7l3 3v8H3z"/><path d="M9.5 2.5V6H13"/><path d="M5.5 9h5M5.5 11h3"/></svg>,
  tag:      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 2h5.5l6.5 6.5-5.5 5.5L2 7.5V2z"/><circle cx="5.5" cy="5.5" r="1"/></svg>,
  admin:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 2l5 2v4.5c0 3-2.2 5.2-5 5.8C5.2 13.7 3 11.5 3 8.5V4l5-2z"/><path d="M6 8.2l1.3 1.3L10 6.8"/></svg>,
};

// English ↔ Hindi labels for nav items. Keys are stable; labels swap with
// the `lang` tweak.
const NAV = [
  { section: 'workspace', sansSection: 'कार्यक्षेत्र',
    items: [
      { id: 'today',    icon: 'today',    en: 'Today',       hi: 'आज',          sans: 'अद्य' },
      { id: 'tasks',    icon: 'tasks',    en: 'Tasks',       hi: 'कार्य',        sans: 'कर्तव्य' },
      { id: 'boards',   icon: 'boards',   en: 'Boards',      hi: 'बोर्ड',        sans: 'फलक' },
      { id: 'projects', icon: 'projects', en: 'Projects',    hi: 'परियोजनाएँ',   sans: 'योजना' },
    ]
  },
  { section: 'operations', sansSection: 'संचालन',
    items: [
      { id: 'approvals',  icon: 'approvals',  en: 'Approvals',   hi: 'अनुमोदन',     sans: 'सम्मति', badge: 3 },
      { id: 'activity',   icon: 'activity',   en: 'Activity',    hi: 'गतिविधि',     sans: 'क्रिया' },
      { id: 'automations',icon: 'automation', en: 'Automations', hi: 'स्वचालन',      sans: 'स्वतंत्र' },
      { id: 'reports',    icon: 'time',       en: 'Time Report', hi: 'समय रिपोर्ट',  sans: 'काल' },
      { id: 'templates',  icon: 'templates',  en: 'Templates',   hi: 'टेम्पलेट',     sans: 'साँचा' },
    ]
  },
  { section: 'team', sansSection: 'दल',
    items: [
      { id: 'team',     icon: 'team',    en: 'Team',      hi: 'टीम',         sans: 'सहयोगी' },
      { id: 'inbox',    icon: 'inbox',   en: 'Inbox',     hi: 'इनबॉक्स',     sans: 'सन्देश', badge: 3 },
    ]
  },
  { section: 'settings', sansSection: 'व्यवस्था',
    items: [
      { id: 'categories', icon: 'tag',   en: 'Categories', hi: 'श्रेणियाँ',  sans: 'वर्ग' },
      { id: 'admin',      icon: 'admin', en: 'Admin',      hi: 'व्यवस्थापक', sans: 'प्रशासन', adminOnly: true },
    ]
  },
];

function NavLabel({ item, lang }) {
  if (lang === 'hi') return <span>{item.hi}</span>;
  if (lang === 'mix') return (
    <span>{item.en}<span className="hi-mute"> · {item.sans}</span></span>
  );
  return <span>{item.en}</span>;
}

function Sidebar({ active, onNav, variant, lang, density }) {
  const compact = variant === 'rail';
  return (
    <aside className={`k-sidebar k-sidebar--${variant} k-density-${density}`}>
      <div className="k-sidebar__brand">
        <KMark size={compact ? 30 : 32} />
        {!compact && (
          <div className="k-wordmark">
            <div className="k-wordmark__main">Kartavya</div>
            <div className="k-wordmark__sans">कर्तव्य</div>
            <div className="k-wordmark__sub">by Aekam Inc</div>
          </div>
        )}
      </div>

      <nav className="k-sidebar__nav">
        {NAV.map(({ section, sansSection, items }) => (
          <div key={section} className="k-sidebar__group">
            {!compact && (
              <div className="k-sidebar__section">
                <span>{section}</span>
                <span className="k-sidebar__section-hi">{sansSection}</span>
              </div>
            )}
            {items.map((it) => (
              <button
                key={it.id}
                className={'k-sidebar__item' + (active === it.id ? ' is-active' : '')}
                onClick={() => onNav(it.id)}
                title={compact ? it.en : ''}
              >
                <span className="k-sidebar__icon">{NAV_ICONS[it.icon]}</span>
                {!compact && (
                  <>
                    <NavLabel item={it} lang={lang} />
                    {it.badge && <span className="k-sidebar__badge">{it.badge}</span>}
                  </>
                )}
                {compact && it.badge && <span className="k-sidebar__badge k-sidebar__badge--dot" />}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {!compact && (
        <div className="k-sidebar__foot">
          <div className="k-avatar k-avatar--me">KS</div>
          <div className="k-sidebar__me">
            <div className="k-sidebar__me-name">Keval Shah</div>
            <div className="k-sidebar__me-role">Admin · Aekam Inc</div>
          </div>
          <button className="k-sidebar__foot-btn" title="Sign out" aria-label="Sign out">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M11 11l3-3-3-3M14 8H6"/></svg>
          </button>
        </div>
      )}
      {compact && (
        <div className="k-sidebar__foot k-sidebar__foot--rail">
          <div className="k-avatar k-avatar--me">KS</div>
        </div>
      )}
    </aside>
  );
}

function Topbar({ active, lang, onSearch, search, onNewTask }) {
  // Date stuff for the editorial date strip
  const todayLabel = active === 'today'
    ? (lang === 'hi' ? 'आज' : lang === 'mix' ? 'Today · अद्य' : 'Today')
    : null;
  return (
    <header className="k-topbar">
      <div className="k-topbar__left">
        <div className="k-crumb">
          <span className="k-crumb__hi">कर्तव्य</span>
          <span className="k-crumb__sep">/</span>
          <span className="k-crumb__cur">{NAV.flatMap(g => g.items).find(i => i.id === active)?.en}</span>
        </div>
      </div>

      <div className="k-topbar__search">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={lang === 'hi' ? 'कार्य खोजें…' : 'Search tasks, projects, people…'}
        />
        <kbd className="k-kbd">⌘ K</kbd>
      </div>

      <div className="k-topbar__right">
        <button className="k-iconbtn" title="Filters">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 4h12M4 8h8M6 12h4"/></svg>
        </button>
        <button className="k-iconbtn" title="Notifications">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M13 11l-2-2H5L3 11V4a1 1 0 011-1h8a1 1 0 011 1v7z"/><path d="M6.5 13.5a1.5 1.5 0 003 0"/></svg>
          <span className="k-iconbtn__dot" />
        </button>
        <button className="k-btn k-btn--primary k-btn--sm" onClick={onNewTask}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10"/></svg>
          New task
        </button>
      </div>
    </header>
  );
}

Object.assign(window, { Sidebar, Topbar, KMark, NAV_ICONS });
