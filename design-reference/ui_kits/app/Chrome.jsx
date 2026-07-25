
// Sidebar nav icons
const ICONS = {
  today: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1.5"/></svg>,
  tasks: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 4h10M3 8h7M3 12h9"/><circle cx="13" cy="8" r="1.4" fill="currentColor" stroke="none"/></svg>,
  boards: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="3" width="3" height="10" rx="1"/><rect x="6.5" y="3" width="3" height="7" rx="1"/><rect x="11" y="3" width="3" height="9" rx="1"/></svg>,
  projects: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 5l1.5-2H7l1.5 2H14v8H2V5z"/></svg>,
  team: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="6" cy="6" r="2.4"/><path d="M1.5 13c0-2.6 2-4.2 4.5-4.2S10.5 10.4 10.5 13"/><circle cx="12" cy="6" r="1.6"/><path d="M11.5 9.2c1.7 0 3 1.1 3 2.6"/></svg>,
  inbox: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 9l1.5-5h9L14 9v4H2V9z"/><path d="M2 9h3l1 2h4l1-2h3"/></svg>,
  approvals: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6"/><path d="M5.5 8l1.8 1.8L10.5 6.5"/></svg>,
  activity: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1 8h3l2-5 4 10 2-5h3"/></svg>,
  time: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8.5" r="5.5"/><path d="M8 5.5v3l2 1.5"/><path d="M5.5 1.5h5"/></svg>,
  templates: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 2.5h7l3 3v8H3z"/><path d="M9.5 2.5V6H13"/><path d="M5.5 9h5M5.5 11h3"/></svg>,
  tag: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 2h5.5l6.5 6.5-5.5 5.5L2 7.5V2z"/><circle cx="5.5" cy="5.5" r="1"/></svg>,
  admin: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 2l5 2v4.5c0 3-2.2 5.2-5 5.8C5.2 13.7 3 11.5 3 8.5V4l5-2z"/><path d="M6 8.2l1.3 1.3L10 6.8"/></svg>,
};

const NAV = [
  { section: 'workspace', sans: 'कार्यक्षेत्र', items: [
    { id: 'today', icon: 'today', en: 'Today', hi: 'अद्य' },
    { id: 'tasks', icon: 'tasks', en: 'Tasks', hi: 'कर्तव्य' },
    { id: 'boards', icon: 'boards', en: 'Boards', hi: 'फलक' },
    { id: 'projects', icon: 'projects', en: 'Projects', hi: 'योजना' },
  ]},
  { section: 'operations', sans: 'संचालन', items: [
    { id: 'approvals', icon: 'approvals', en: 'Approvals', hi: 'सम्मति', badge: 3 },
    { id: 'activity', icon: 'activity', en: 'Activity', hi: 'क्रिया' },
    { id: 'time', icon: 'time', en: 'Time Report', hi: 'काल' },
    { id: 'templates', icon: 'templates', en: 'Templates', hi: 'साँचा' },
  ]},
  { section: 'team', sans: 'दल', items: [
    { id: 'team', icon: 'team', en: 'Team', hi: 'सहयोगी' },
    { id: 'inbox', icon: 'inbox', en: 'Inbox', hi: 'सन्देश', badge: 3 },
  ]},
  { section: 'settings', sans: 'व्यवस्था', items: [
    { id: 'categories', icon: 'tag', en: 'Categories', hi: 'वर्ग' },
    { id: 'admin', icon: 'admin', en: 'Admin', hi: 'प्रशासन' },
  ]},
];

function KMark({ size = 32 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.26, background: 'linear-gradient(135deg,#0082c6,#03a1b6 55%,#05b7aa)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 1px 0 rgba(255,255,255,.22) inset, 0 4px 14px rgba(0,130,198,.35)' }}>
      <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 22 22" fill="none">
        <path d="M4 11L11 4L18 11L11 18L4 11Z" stroke="white" strokeWidth="1.8"/>
        <path d="M7.5 11L11 7.5L14.5 11L11 14.5L7.5 11Z" fill="white" opacity=".88"/>
      </svg>
    </div>
  );
}

function AppSidebar({ active, onNav }) {
  return (
    <aside className="k-sidebar">
      <div className="k-sidebar__brand">
        <KMark />
        <div className="k-wordmark">
          <div className="k-wordmark__main">Kartavya</div>
          <div className="k-wordmark__sans">कर्तव्य</div>
          <div className="k-wordmark__sub">by Aekam Inc</div>
        </div>
      </div>
      <nav className="k-sidebar__nav">
        {NAV.map(({ section, sans, items }) => (
          <div key={section} className="k-sidebar__group">
            <div className="k-sidebar__section">
              <span>{section}</span>
              <span className="k-sidebar__section-hi">{sans}</span>
            </div>
            {items.map(it => (
              <button key={it.id} className={'k-sidebar__item' + (active === it.id ? ' is-active' : '')} onClick={() => onNav(it.id)}>
                <span className="k-sidebar__icon">{ICONS[it.icon]}</span>
                <span>{it.en}</span>
                <span className="hi-mute"> · {it.hi}</span>
                {it.badge && <span className="k-sidebar__badge">{it.badge}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="k-sidebar__foot">
        <div className="k-avatar k-avatar--me" style={{ width: 28, height: 28, fontSize: 11, background: 'linear-gradient(135deg,#0082c6,#05b7aa)' }}>KS</div>
        <div className="k-sidebar__me">
          <div className="k-sidebar__me-name">Keval Shah</div>
          <div className="k-sidebar__me-role">Admin · Aekam Inc</div>
        </div>
      </div>
    </aside>
  );
}

const PAGE_META = {
  today: { en: 'Today', hi: 'आज' },
  tasks: { en: 'Tasks', hi: 'कर्तव्य' },
  boards: { en: 'Boards', hi: 'फलक' },
  projects: { en: 'Projects', hi: 'योजना' },
  team: { en: 'Team', hi: 'सहयोगी' },
  approvals: { en: 'Approvals', hi: 'सम्मति' },
  activity: { en: 'Activity', hi: 'क्रिया' },
  time: { en: 'Time Report', hi: 'काल' },
  templates: { en: 'Templates', hi: 'साँचा' },
  inbox: { en: 'Inbox', hi: 'सन्देश' },
  categories: { en: 'Categories', hi: 'वर्ग' },
  admin: { en: 'Admin', hi: 'प्रशासन' },
};

function AppTopbar({ screen, onNewTask }) {
  const meta = PAGE_META[screen] || { en: 'Kartavya', hi: 'कर्तव्य' };
  return (
    <header className="k-topbar">
      <div className="k-topbar__left">
        <div className="k-crumb">
          <span className="k-crumb__hi">कर्तव्य</span>
          <span className="k-crumb__sep">/</span>
          <span className="k-crumb__cur">{meta.en}</span>
        </div>
      </div>
      <div className="k-topbar__search">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
        <input placeholder="Search tasks, projects, people…" readOnly />
        <kbd className="k-kbd">⌘K</kbd>
      </div>
      <div className="k-topbar__right">
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

Object.assign(window, { AppSidebar, AppTopbar, KMark });
