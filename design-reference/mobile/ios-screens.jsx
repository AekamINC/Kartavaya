// iOS screens for Kartavya mobile companion.
// Renders inside <IOSDevice> from ios-frame.jsx. Each screen returns the
// chrome + content; status bar + home indicator come from the device frame.
//
// Theme contract: pass `dark` everywhere; colors derive from a small tokens
// object so light/dark stay 1:1.

const iosTokens = (dark) => ({
  bg:        dark ? '#000' : '#F2F2F7',
  surface:   dark ? '#1C1C1E' : '#fff',
  surface2:  dark ? '#2C2C2E' : '#fff',
  groupBg:   dark ? '#000' : '#F2F2F7',
  text:      dark ? '#fff' : '#000',
  text2:     dark ? 'rgba(235,235,245,0.78)' : 'rgba(60,60,67,0.78)',
  text3:     dark ? 'rgba(235,235,245,0.6)'  : 'rgba(60,60,67,0.6)',
  text4:     dark ? 'rgba(235,235,245,0.3)'  : 'rgba(60,60,67,0.3)',
  sep:       dark ? 'rgba(84,84,88,0.65)'    : 'rgba(60,60,67,0.18)',
  fill:      dark ? 'rgba(118,118,128,0.24)' : 'rgba(118,118,128,0.12)',
  fill2:     dark ? 'rgba(118,118,128,0.36)' : 'rgba(118,118,128,0.20)',
  tabBg:     dark ? 'rgba(28,28,30,0.78)'    : 'rgba(255,255,255,0.78)',
  tabBorder: dark ? 'rgba(84,84,88,0.5)'     : 'rgba(60,60,67,0.18)',
  // brand
  brand: KP.primary, brandDeep: KP.deep, grad: KP.grad, gradD: KP.gradD,
});

// ── tiny atoms ────────────────────────────────────────────────────────────
function IAvatar({ u, size = 28, ring = null }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size,
      background: u.color, color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 700, letterSpacing: 0.2,
      boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
      flexShrink: 0,
    }}>{u.initials}</div>
  );
}
function IAvStack({ ids, size = 24, ring }) {
  return (
    <div style={{ display: 'inline-flex' }}>
      {ids.map((id, i) => (
        <div key={id} style={{ marginLeft: i === 0 ? 0 : -size * 0.32 }}>
          <IAvatar u={M_USER(id)} size={size} ring={ring} />
        </div>
      ))}
    </div>
  );
}
function IProjectChip({ pid, t, big }) {
  const p = M_TASK_PROJECT(pid);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: big ? 13 : 11, color: t.text2, fontWeight: 500,
      letterSpacing: -0.1,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
      {p.name}
    </span>
  );
}
function IPrioDot({ p, size = 8 }) {
  return <span style={{
    width: size, height: size, borderRadius: '50%',
    background: M_PRIO_COLOR[p], display: 'inline-block', flexShrink: 0,
  }} />;
}
function IDueChip({ children, danger, warn, t }) {
  const c = danger ? '#FF453A' : warn ? '#FF9F0A' : t.text2;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 12, fontWeight: 600, color: c,
      padding: '2px 8px', borderRadius: 99,
      background: danger ? 'rgba(255,69,58,0.12)' : warn ? 'rgba(255,159,10,0.14)' : t.fill,
      letterSpacing: -0.08, fontVariantNumeric: 'tabular-nums',
    }}>{children}</span>
  );
}
function ISFIcon({ name, size = 17, color, weight = 'regular' }) {
  // Hand-built SF-symbol-flavored glyphs (since we can't use real SF Symbols).
  const sw = weight === 'bold' ? 2.4 : weight === 'medium' ? 2 : 1.7;
  const paths = {
    'tray':       <><path d="M4 14h16l-2 5H6l-2-5z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/><path d="M4 14V5h16v9" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/><path d="M8 9h8" stroke={color} strokeWidth={sw} strokeLinecap="round"/></>,
    'square-stack': <><rect x="4" y="9" width="14" height="11" rx="2" fill="none" stroke={color} strokeWidth={sw}/><path d="M7 6h14v11" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/></>,
    'bell':        <><path d="M5.5 16.5h13l-1.5-2v-4a5 5 0 00-10 0v4l-1.5 2z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/><path d="M10 19a2 2 0 004 0" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"/></>,
    'person':      <><circle cx="12" cy="8" r="3.5" fill="none" stroke={color} strokeWidth={sw}/><path d="M5 20c1-3.5 4-5 7-5s6 1.5 7 5" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"/></>,
    'plus':        <><path d="M12 5v14M5 12h14" stroke={color} strokeWidth={2.4} strokeLinecap="round"/></>,
    'check':       <><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"/></>,
    'chevron-down':<><path d="M6 9l6 6 6-6" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"/></>,
    'chevron-right':<><path d="M9 6l6 6-6 6" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"/></>,
    'chevron-left':<><path d="M15 6l-6 6 6 6" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"/></>,
    'paperclip':   <><path d="M16 7l-7 7a3 3 0 104 4l8-8a5 5 0 10-7-7l-8 8" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"/></>,
    'mic':         <><rect x="9" y="3" width="6" height="12" rx="3" fill="none" stroke={color} strokeWidth={sw}/><path d="M5.5 12a6.5 6.5 0 0013 0M12 18v3" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"/></>,
    'arrow-up':    <><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"/></>,
    'ellipsis':    <><circle cx="5" cy="12" r="1.7" fill={color}/><circle cx="12" cy="12" r="1.7" fill={color}/><circle cx="19" cy="12" r="1.7" fill={color}/></>,
    'wifi-slash':  <><path d="M3 5l18 18" stroke={color} strokeWidth={sw} strokeLinecap="round"/><path d="M5 10a14 14 0 0114-3M8 13a9 9 0 018-1" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"/><circle cx="12" cy="18" r="1.6" fill={color}/></>,
    'camera':      <><rect x="3" y="7" width="18" height="13" rx="3" fill="none" stroke={color} strokeWidth={sw}/><path d="M8 7l1.5-2.5h5L16 7" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/><circle cx="12" cy="13.5" r="3.2" fill="none" stroke={color} strokeWidth={sw}/></>,
    'flag':        <><path d="M6 21V4h11l-2 4 2 4H6" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/></>,
    'calendar':    <><rect x="4" y="6" width="16" height="14" rx="2.5" fill="none" stroke={color} strokeWidth={sw}/><path d="M4 10h16M8 4v4M16 4v4" stroke={color} strokeWidth={sw} strokeLinecap="round"/></>,
    'at':          <><circle cx="12" cy="12" r="4" fill="none" stroke={color} strokeWidth={sw}/><path d="M16 12v2a2 2 0 004 0v-2a8 8 0 10-3.2 6.4" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"/></>,
    'doc':         <><path d="M7 3h7l5 5v13H7z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/><path d="M14 3v5h5" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/></>,
    'sync':        <><path d="M4 12a8 8 0 0114-5.3L21 4M20 12a8 8 0 01-14 5.3L3 20" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"/><path d="M21 4v5h-5M3 20v-5h5" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/></>,
    'search':      <><circle cx="11" cy="11" r="6.5" fill="none" stroke={color} strokeWidth={sw}/><path d="M16 16l4.5 4.5" stroke={color} strokeWidth={sw} strokeLinecap="round"/></>,
    'filter':      <><path d="M4 5h16l-6 8v6l-4-1.5V13L4 5z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/></>,
    'sparkles':    <><path d="M12 4l1.5 4 4 1.5-4 1.5L12 15l-1.5-4-4-1.5 4-1.5z" fill={color}/><path d="M18 14l.8 2.2 2.2.8-2.2.8L18 20l-.8-2.2-2.2-.8 2.2-.8z" fill={color}/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      {paths[name]}
    </svg>
  );
}

// ── App-level chrome: bottom tab bar (translucent) ───────────────────────
function IOSTabBar({ active, t, dark }) {
  const items = [
    { id: 'today', label: 'Today',  icon: 'square-stack' },
    { id: 'board', label: 'Boards', icon: 'tray' },
    { id: 'plus',  label: '',       icon: 'plus', primary: true },
    { id: 'inbox', label: 'Inbox',  icon: 'bell',  badge: 3 },
    { id: 'me',    label: 'Me',     icon: 'person' },
  ];
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      paddingBottom: 28, paddingTop: 8,
      background: t.tabBg,
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      borderTop: `0.5px solid ${t.tabBorder}`,
      zIndex: 40,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '0 4px' }}>
        {items.map((it) => {
          if (it.primary) {
            return (
              <div key={it.id} style={{
                width: 48, height: 48, borderRadius: 16,
                background: KP.gradD, display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 6px 14px -4px rgba(0,130,198,0.5)',
                marginTop: -10,
              }}>
                <ISFIcon name="plus" size={22} color="#fff" weight="bold" />
              </div>
            );
          }
          const isActive = it.id === active;
          const c = isActive ? KP.primary : t.text3;
          return (
            <div key={it.id} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              minWidth: 48, padding: '4px 8px',
              position: 'relative',
            }}>
              <ISFIcon name={it.icon} size={22} color={c} weight={isActive ? 'medium' : 'regular'} />
              <span style={{
                fontSize: 10, fontWeight: 500, color: c,
                letterSpacing: -0.06, lineHeight: '12px',
              }}>{it.label}</span>
              {it.badge ? (
                <span style={{
                  position: 'absolute', top: 0, right: 6,
                  minWidth: 16, height: 16, borderRadius: 99,
                  background: '#FF3B30', color: '#fff',
                  fontSize: 10, fontWeight: 700, padding: '0 4px',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  border: `1.5px solid ${dark ? '#000' : '#fff'}`,
                }}>{it.badge}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Offline banner ───────────────────────────────────────────────────────
function IOSOfflineBanner({ t }) {
  return (
    <div style={{
      margin: '6px 16px 0',
      padding: '8px 12px',
      borderRadius: 12,
      background: 'rgba(255,159,10,0.14)',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <ISFIcon name="wifi-slash" size={16} color="#FF9F0A" weight="medium" />
      <div style={{ flex: 1, fontSize: 13, color: t.text, fontWeight: 500, letterSpacing: -0.1 }}>
        Offline
      </div>
      <div style={{ fontSize: 12, color: t.text2, fontWeight: 500 }}>
        3 changes queued
      </div>
    </div>
  );
}

// ── Top header used on Today / Inbox (large title + project switcher) ────
function IOSTopHeader({ kicker, kickerHi, title, dark, t, projectSwitcher = false, project, search = false }) {
  return (
    <div style={{ padding: '54px 16px 6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase',
            color: KP.primary, fontWeight: 700,
            display: 'flex', alignItems: 'baseline', gap: 8,
          }}>
            <span>{kicker}</span>
            {kickerHi && (
              <span style={{
                fontFamily: '"Tiro Devanagari Hindi", serif',
                textTransform: 'none', letterSpacing: 0,
                color: t.text3, fontWeight: 400, fontSize: 12,
              }}>{kickerHi}</span>
            )}
          </div>
          <h1 style={{
            fontFamily: '"Newsreader", Georgia, serif',
            fontSize: 34, fontWeight: 500, lineHeight: 1.05,
            margin: '4px 0 0',
            color: t.text, letterSpacing: -0.8,
          }}>{title}</h1>
        </div>
        <IOSGlassPill dark={dark}>
          <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ISFIcon name="ellipsis" size={20} color={t.text2} />
          </div>
        </IOSGlassPill>
      </div>
      {projectSwitcher && project && (
        <button style={{
          marginTop: 14, width: '100%', textAlign: 'left',
          padding: '10px 12px 10px 14px', border: 0,
          background: t.surface, borderRadius: 14,
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: dark ? 'none' : '0 1px 0 rgba(0,0,0,0.04)',
        }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: project.color }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: t.text, letterSpacing: -0.2 }}>{project.name}</span>
              <span style={{
                fontFamily: '"Tiro Devanagari Hindi", serif',
                fontSize: 13, color: t.text3,
              }}>{project.sans}</span>
            </div>
            <div style={{ fontSize: 11, color: t.text3, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>
              {project.client} · {project.open} open · {Math.round(project.progress * 100)}%
            </div>
          </div>
          <ISFIcon name="chevron-down" size={16} color={t.text3} weight="medium" />
        </button>
      )}
      {search && (
        <div style={{
          marginTop: 14, height: 36, borderRadius: 10,
          background: t.fill,
          display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
        }}>
          <ISFIcon name="search" size={16} color={t.text3} />
          <span style={{ fontSize: 15, color: t.text3, letterSpacing: -0.2 }}>Search tasks</span>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Screen 1 — TODAY
// ════════════════════════════════════════════════════════════════════════
function IOSToday({ dark, offline = false }) {
  const t = iosTokens(dark);
  const filterChips = ['All', 'Due today', 'Mentions', 'Approvals', 'Overdue'];
  return (
    <IOSDevice dark={dark} width={360} height={760}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: t.bg, position: 'relative' }}>
        {offline && (
          <div style={{ paddingTop: 50 }}><IOSOfflineBanner t={t} /></div>
        )}
        <div style={{ paddingTop: offline ? 0 : 0 }}>
          <IOSTopHeader
            kicker="Today · 14 May"
            kickerHi="वैशाख"
            title="Good morning, Keval"
            dark={dark} t={t}
          />
        </div>
        {/* Filter chips */}
        <div style={{
          display: 'flex', gap: 8, padding: '12px 16px 6px',
          overflowX: 'auto',
        }}>
          {filterChips.map((c, i) => (
            <span key={c} style={{
              padding: '6px 12px', borderRadius: 99,
              fontSize: 13, fontWeight: 600, letterSpacing: -0.1,
              background: i === 0 ? KP.primary : t.fill,
              color: i === 0 ? '#fff' : t.text2,
              flexShrink: 0,
            }}>{c}</span>
          ))}
        </div>
        {/* Task list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 16px 100px' }}>
          {/* Sticky-feel section header */}
          <div style={{
            fontSize: 12, color: t.text3, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: 1.2,
            padding: '8px 4px 6px',
            display: 'flex', alignItems: 'baseline', gap: 8,
          }}>
            <span>Due today</span>
            <span style={{
              fontFamily: '"Tiro Devanagari Hindi", serif',
              textTransform: 'none', letterSpacing: 0,
              color: t.text4, fontSize: 12, fontWeight: 400,
            }}>आज</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: t.text3, fontFamily: 'ui-monospace, monospace' }}>2</span>
          </div>
          {M_TODAY.slice(0, 2).map(task => <IOSTaskCard key={task.id} task={task} dark={dark} t={t} />)}

          <div style={{
            fontSize: 12, color: t.text3, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: 1.2,
            padding: '14px 4px 6px',
            display: 'flex', alignItems: 'baseline', gap: 8,
          }}>
            <span>This week</span>
            <span style={{
              fontFamily: '"Tiro Devanagari Hindi", serif',
              textTransform: 'none', letterSpacing: 0,
              color: t.text4, fontSize: 12, fontWeight: 400,
            }}>इस सप्ताह</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: t.text3, fontFamily: 'ui-monospace, monospace' }}>4</span>
          </div>
          {M_TODAY.slice(2).map(task => <IOSTaskCard key={task.id} task={task} dark={dark} t={t} />)}
        </div>
        <IOSTabBar active="today" t={t} dark={dark} />
      </div>
    </IOSDevice>
  );
}

function IOSTaskCard({ task, dark, t }) {
  const project = M_TASK_PROJECT(task.project);
  return (
    <div style={{
      background: t.surface, borderRadius: 16,
      padding: '12px 14px',
      marginBottom: 8,
      boxShadow: dark ? 'none' : '0 1px 0 rgba(0,0,0,0.04)',
      position: 'relative',
    }}>
      {/* top row: project + sync */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: project.color }} />
        <span style={{ fontSize: 12, color: t.text2, fontWeight: 500, letterSpacing: -0.1 }}>{project.name}</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: t.text3 }}>{task.id}</span>
        {task.syncing && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, color: '#FF9F0A', fontWeight: 600,
          }}>
            <ISFIcon name="sync" size={11} color="#FF9F0A" weight="bold" />
          </span>
        )}
      </div>
      {/* title */}
      <div style={{
        fontSize: 15, lineHeight: 1.35, color: t.text, fontWeight: 500,
        letterSpacing: -0.2, marginBottom: 10,
      }}>{task.title}</div>
      {/* footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IDueChip t={t} danger={task.priority === 'urgent'} warn={task.priority === 'high'}>
          {task.due}
        </IDueChip>
        {task.approval === 'requested' && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, fontWeight: 700, color: '#B06A00',
            padding: '2px 8px', borderRadius: 99,
            background: 'rgba(255,159,10,0.14)', letterSpacing: 0.4,
            textTransform: 'uppercase',
          }}>
            <ISFIcon name="check" size={11} color="#B06A00" weight="bold" />
            Approval
          </span>
        )}
        {task.mention && (
          <span style={{
            display: 'inline-flex', alignItems: 'center',
            width: 20, height: 20, borderRadius: 99,
            background: 'rgba(0,130,198,0.14)',
          }}>
            <ISFIcon name="at" size={13} color={KP.deep} weight="medium" />
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}><IAvStack ids={task.assignees} size={22} ring={t.surface} /></span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Screen 2 — BOARD (single column visible, swipe between)
// ════════════════════════════════════════════════════════════════════════
function IOSBoard({ dark }) {
  const t = iosTokens(dark);
  const project = M_PROJECTS.find(p => p.id === 'p3'); // Office fit-out
  const activeCol = M_COLUMNS[2]; // Approval — most interesting state to show
  const cards = M_BOARD[activeCol.id] || [];
  return (
    <IOSDevice dark={dark} width={360} height={760}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: t.bg }}>
        <IOSTopHeader
          kicker="Board"
          kickerHi="कार्यफलक"
          title={project.name}
          dark={dark} t={t}
          projectSwitcher
          project={project}
        />
        {/* View switcher — Board / List / Schedule / Tracker */}
        <div style={{ padding: '4px 16px 8px' }}>
          <div style={{
            display: 'flex', background: t.fill, borderRadius: 9, padding: 2,
          }}>
            {M_VIEWS.map((v, i) => (
              <button key={v.id} style={{
                flex: 1, padding: '6px 4px', border: 0,
                background: i === 0 ? t.surface2 : 'transparent',
                borderRadius: 7, color: t.text,
                fontSize: 12.5, fontWeight: i === 0 ? 600 : 500,
                boxShadow: i === 0 && !dark ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}>{v.label}</button>
            ))}
          </div>
        </div>
        {/* Column tabs (swipeable) */}
        <div style={{
          display: 'flex', gap: 6, padding: '0 16px 6px',
          overflowX: 'auto',
        }}>
          {M_COLUMNS.map(col => {
            const isActive = col.id === activeCol.id;
            const count = (M_BOARD[col.id] || []).length;
            return (
              <div key={col.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 11px', borderRadius: 99,
                background: isActive ? t.surface : 'transparent',
                border: isActive ? `1px solid ${t.sep}` : '1px solid transparent',
                flexShrink: 0,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: col.isApproval ? 2 : 99, background: col.color }} />
                <span style={{
                  fontSize: 12.5, fontWeight: 600,
                  color: isActive ? t.text : t.text3, letterSpacing: -0.1,
                }}>{col.title}</span>
                <span style={{
                  fontSize: 10.5, color: isActive ? t.text3 : t.text4,
                  fontFamily: 'ui-monospace, monospace',
                  background: isActive ? t.fill : 'transparent',
                  padding: '0 5px', borderRadius: 99,
                }}>{count}</span>
              </div>
            );
          })}
        </div>
        {/* Column header — Approval gets its own treatment */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px 8px',
        }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: activeCol.color }} />
          <span style={{
            fontSize: 11, color: t.text3, fontWeight: 700,
            letterSpacing: 1.4, textTransform: 'uppercase',
          }}>{activeCol.title}</span>
          <span style={{
            fontFamily: '"Tiro Devanagari Hindi", serif',
            fontSize: 12, color: t.text4,
          }}>{activeCol.hi}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: t.text3, fontFamily: 'ui-monospace, monospace' }}>{cards.length} cards</span>
        </div>
        {activeCol.isApproval && (
          <div style={{ padding: '0 16px 8px' }}>
            <div style={{
              fontSize: 12, color: t.text2, padding: '8px 12px',
              background: 'rgba(255,159,10,0.10)',
              borderRadius: 10, lineHeight: 1.4,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <ISFIcon name="sparkles" size={14} color="#B06A00" weight="medium" />
              Cards moved here notify the project owner for sign-off.
            </div>
          </div>
        )}
        {/* Cards */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 110px' }}>
          {cards.map(c => <IOSBoardCard key={c.id} card={c} dark={dark} t={t} />)}
          {/* Empty + add */}
          <button style={{
            width: '100%', padding: '14px 12px',
            border: `1.5px dashed ${t.sep}`,
            background: 'transparent', borderRadius: 14,
            color: t.text3, fontSize: 13.5, fontWeight: 500,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            marginTop: 4,
          }}>
            <ISFIcon name="plus" size={15} color={t.text3} weight="medium" />
            Add card to "{activeCol.title}"
          </button>
        </div>
        {/* Page dots — index of active column */}
        <div style={{
          position: 'absolute', bottom: 96, left: 0, right: 0,
          display: 'flex', justifyContent: 'center', gap: 6,
          pointerEvents: 'none',
        }}>
          {M_COLUMNS.map((c, i) => (
            <span key={c.id} style={{
              width: i === 2 ? 18 : 6, height: 6, borderRadius: 99,
              background: i === 2 ? KP.primary : t.fill2,
              transition: 'width 0.2s',
            }} />
          ))}
        </div>
        <IOSTabBar active="board" t={t} dark={dark} />
      </div>
    </IOSDevice>
  );
}

function IOSBoardCard({ card, dark, t }) {
  const approvalChip = card.approvalStatus && (
    <span style={{
      fontSize: 10, fontWeight: 700,
      padding: '2px 7px', borderRadius: 99, letterSpacing: 0.4, textTransform: 'uppercase',
      ...(card.approvalStatus === 'approved'
        ? { color: '#0A7A6E', background: 'rgba(5,183,170,0.16)' }
        : card.approvalStatus === 'pending_client'
        ? { color: '#6B46C1', background: 'rgba(167,139,250,0.16)' }
        : { color: '#B06A00', background: 'rgba(255,159,10,0.18)' }),
    }}>
      {card.approvalStatus === 'approved' ? 'Approved'
        : card.approvalStatus === 'pending_client' ? 'Client review'
        : 'Owner sign-off'}
    </span>
  );
  return (
    <div style={{
      background: t.surface, borderRadius: 16,
      padding: '14px 14px 12px',
      marginBottom: 10,
      boxShadow: dark ? 'none' : '0 1px 2px rgba(0,0,0,0.04), 0 6px 16px -8px rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <IPrioDot p={card.priority} />
        <span style={{ fontSize: 11.5, color: t.text3, fontWeight: 600 }}>{M_PRIO_LABEL[card.priority]}</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: t.text3 }}>{card.id}</span>
        {card.syncing && <ISFIcon name="sync" size={11} color="#FF9F0A" weight="bold" />}
      </div>
      <div style={{
        fontSize: 15, lineHeight: 1.35, color: t.text, fontWeight: 500,
        letterSpacing: -0.2, marginBottom: 10,
      }}>{card.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <IDueChip t={t} danger={card.priority === 'urgent'} warn={card.priority === 'high'}>{card.due}</IDueChip>
        {approvalChip}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, color: t.text3, fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>
          {card.comments > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><ISFIcon name="at" size={11} color={t.text3} />{card.comments}</span>}
          {card.files > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><ISFIcon name="paperclip" size={11} color={t.text3} />{card.files}</span>}
          <IAvStack ids={card.assignees} size={20} ring={t.surface} />
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Screen 3 — TASK DETAIL
// ════════════════════════════════════════════════════════════════════════
function IOSTaskDetail({ dark }) {
  const t = iosTokens(dark);
  const task = M_TASK_DETAIL;
  const project = M_TASK_PROJECT(task.project);
  return (
    <IOSDevice dark={dark} width={360} height={760}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: t.bg, position: 'relative' }}>
        {/* nav row */}
        <div style={{
          paddingTop: 56, paddingLeft: 12, paddingRight: 12, paddingBottom: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <IOSGlassPill dark={dark}>
            <div style={{ height: 36, padding: '0 14px 0 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ISFIcon name="chevron-left" size={16} color={KP.deep} weight="medium" />
              <span style={{ fontSize: 14, color: KP.deep, fontWeight: 500 }}>Board</span>
            </div>
          </IOSGlassPill>
          <div style={{ display: 'flex', gap: 8 }}>
            <IOSGlassPill dark={dark}>
              <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ISFIcon name="sparkles" size={18} color={KP.deep} weight="medium" />
              </div>
            </IOSGlassPill>
            <IOSGlassPill dark={dark}>
              <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ISFIcon name="ellipsis" size={20} color={t.text2} />
              </div>
            </IOSGlassPill>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 200 }}>
          <div style={{ padding: '6px 20px 4px' }}>
            {/* status chip + project chip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px 4px 8px',
                borderRadius: 99, background: 'rgba(255,159,10,0.16)',
                color: '#B06A00', fontSize: 12, fontWeight: 600, letterSpacing: -0.1,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: 2, background: '#f59e0b' }} />
                Approval
                <ISFIcon name="chevron-down" size={11} color="#B06A00" weight="medium" />
              </span>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12, color: t.text2, fontWeight: 500,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: project.color }} />
                {project.name}
              </span>
              <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 11, color: t.text3 }}>{task.id}</span>
            </div>
            <h1 style={{
              fontFamily: '"Newsreader", Georgia, serif',
              fontSize: 26, fontWeight: 500, lineHeight: 1.2,
              margin: '4px 0 12px', color: t.text, letterSpacing: -0.5,
            }}>{task.title}</h1>
          </div>

          {/* Approval banner — Owner POV: Vikram requested your approval */}
          <div style={{ padding: '0 16px' }}>
            <div style={{
              background: 'rgba(255,159,10,0.12)',
              border: `1px solid rgba(255,159,10,0.28)`,
              borderRadius: 16, padding: '12px 14px',
              marginBottom: 14,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#f59e0b' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#B06A00', textTransform: 'uppercase', letterSpacing: 1.2 }}>Awaiting your approval</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: t.text3 }}>{task.approval.requestedAt}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <IAvatar u={M_USER(task.approval.requestedBy)} size={22} />
                <span style={{ fontSize: 13, color: t.text2 }}>
                  <span style={{ fontWeight: 600, color: t.text }}>{M_USER(task.approval.requestedBy).name}</span> moved this to Approval
                </span>
              </div>
              <div style={{ fontSize: 13.5, color: t.text2, lineHeight: 1.45, marginBottom: 10, fontStyle: 'italic' }}>
                "{task.approval.note}"
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{
                  flex: 1, height: 36, borderRadius: 10, border: 0,
                  background: KP.gradD, color: '#fff',
                  fontSize: 14, fontWeight: 600, letterSpacing: -0.1,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  <ISFIcon name="check" size={15} color="#fff" weight="bold" />
                  Approve & advance
                </button>
                <button style={{
                  width: 36, height: 36, borderRadius: 10,
                  border: `1px solid ${t.sep}`, background: t.surface,
                  color: t.text, fontSize: 14, fontWeight: 600,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <ISFIcon name="ellipsis" size={18} color={t.text2} weight="medium" />
                </button>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, color: t.text3, marginTop: 8,
              }}>
                <ISFIcon name="person" size={11} color={t.text3} />
                <span>Or send to <span style={{ color: KP.deep, fontWeight: 600 }}>client</span> for review</span>
              </div>
            </div>
          </div>

          {/* Properties grid */}
          <div style={{ padding: '0 16px 12px' }}>
            <div style={{
              background: t.surface, borderRadius: 16,
              padding: '4px 16px',
            }}>
              <IOSDetailRow t={t} label="Due"        value={<span style={{ color: '#FF453A' }}>{task.due}</span>} sep />
              <IOSDetailRow t={t} label="Priority"   value={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <IPrioDot p={task.priority} />
                  {M_PRIO_LABEL[task.priority]}
                </span>
              } sep />
              <IOSDetailRow t={t} label="Assignees"  value={<IAvStack ids={task.assignees} size={22} ring={t.surface} />} sep />
              <IOSDetailRow t={t} label="Reporter"   value={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <IAvatar u={M_USER(task.reporter)} size={20} />
                  <span style={{ fontSize: 14, color: t.text }}>{M_USER(task.reporter).name}</span>
                </span>
              } sep />
              <IOSDetailRow t={t} label="Estimate" value={task.estimate} />
            </div>
          </div>

          {/* Description */}
          <div style={{ padding: '0 20px 14px' }}>
            <div style={{
              fontSize: 11, color: t.text3, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 1.4,
              marginBottom: 6,
            }}>Description</div>
            <div style={{
              fontSize: 14.5, lineHeight: 1.55, color: t.text2,
              fontFamily: 'system-ui',
            }}>{task.description}</div>
          </div>

          {/* Subtasks — list with toggle + add */}
          <div style={{ padding: '0 16px 14px' }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 8,
              padding: '0 4px 8px',
            }}>
              <span style={{
                fontSize: 11, color: t.text3, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: 1.4,
              }}>Subtasks</span>
              <span style={{
                fontFamily: '"Tiro Devanagari Hindi", serif',
                fontSize: 12, color: t.text4,
              }}>उपकार्य</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: t.text3, fontFamily: 'ui-monospace, monospace' }}>
                {task.subtasks.filter(s => s.is_done).length} / {task.subtasks.length}
              </span>
            </div>
            {/* Progress bar */}
            <div style={{
              height: 4, borderRadius: 99, background: t.fill, overflow: 'hidden',
              marginBottom: 10,
            }}>
              <div style={{
                height: '100%', width: `${(task.subtasks.filter(s => s.is_done).length / task.subtasks.length) * 100}%`,
                background: KP.grad, borderRadius: 99,
              }} />
            </div>
            {/* Subtask rows */}
            <div style={{ background: t.surface, borderRadius: 16, overflow: 'hidden' }}>
              {task.subtasks.map((s, i) => (
                <div key={s.subtask_id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px',
                  borderBottom: i < task.subtasks.length - 1 ? `0.5px solid ${t.sep}` : 0,
                }}>
                  {/* Checkbox */}
                  <div style={{
                    width: 22, height: 22, borderRadius: 99,
                    border: s.is_done ? 0 : `1.5px solid ${t.text4}`,
                    background: s.is_done ? KP.primary : 'transparent',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {s.is_done && <ISFIcon name="check" size={14} color="#fff" weight="bold" />}
                  </div>
                  <span style={{
                    flex: 1, fontSize: 14, color: s.is_done ? t.text3 : t.text,
                    textDecoration: s.is_done ? 'line-through' : 'none',
                    textDecorationColor: t.text4,
                    lineHeight: 1.4,
                  }}>{s.title}</span>
                  <button style={{
                    width: 26, height: 26, borderRadius: 99,
                    background: 'transparent', border: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    color: t.text4,
                  }}>
                    <ISFIcon name="ellipsis" size={16} color={t.text4} />
                  </button>
                </div>
              ))}
              {/* Add subtask row */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px',
                borderTop: `0.5px solid ${t.sep}`,
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 99,
                  border: `1.5px dashed ${t.text4}`,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <ISFIcon name="plus" size={12} color={t.text3} weight="medium" />
                </div>
                <span style={{ flex: 1, fontSize: 14, color: t.text3 }}>Add subtask…</span>
              </div>
            </div>
          </div>

          {/* Tab bar */}
          <div style={{
            display: 'flex', gap: 0, padding: '0 16px',
            borderBottom: `0.5px solid ${t.sep}`,
            marginBottom: 12,
          }}>
            {[
              { id: 'comments', label: 'Comments', count: task.comments.length, active: true },
              { id: 'files', label: 'Files', count: task.files.length },
              { id: 'activity', label: 'Activity', count: task.activity.length },
            ].map(tab => (
              <button key={tab.id} style={{
                padding: '10px 4px', marginRight: 18,
                background: 'transparent', border: 0,
                borderBottom: tab.active ? `2px solid ${KP.primary}` : '2px solid transparent',
                marginBottom: -0.5,
                fontSize: 14, fontWeight: 600,
                color: tab.active ? t.text : t.text3,
                letterSpacing: -0.1,
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
                {tab.label}
                <span style={{
                  fontSize: 11, padding: '1px 6px', borderRadius: 99,
                  background: t.fill, color: t.text3, fontFamily: 'ui-monospace, monospace',
                }}>{tab.count}</span>
              </button>
            ))}
          </div>

          {/* Comments */}
          <div style={{ padding: '0 16px' }}>
            {task.comments.map((c, i) => {
              const isMine = c.by === 'u1';
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 10, marginBottom: 14 }}>
                  <IAvatar u={M_USER(c.by)} size={28} />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>{M_USER(c.by).name}</span>
                      {isMine && <span style={{
                        fontSize: 9.5, fontWeight: 700, color: KP.primary,
                        padding: '0 6px', borderRadius: 4, letterSpacing: 0.6,
                        background: 'rgba(5,183,170,0.14)',
                      }}>YOU</span>}
                      <span style={{ fontSize: 11.5, color: t.text3 }}>{c.when}</span>
                      {isMine && (
                        <button style={{
                          marginLeft: 'auto', width: 24, height: 24, borderRadius: 99,
                          background: 'transparent', border: 0,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          color: t.text3,
                        }}>
                          <ISFIcon name="ellipsis" size={14} color={t.text3} />
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.45, color: t.text2 }}>
                      {c.mention ? (
                        <>
                          <span style={{ color: KP.deep, fontWeight: 600 }}>@{M_USER(c.mention).name}</span>
                          {c.text.replace(`@${M_USER(c.mention).name}`, '')}
                        </>
                      ) : c.text}
                    </div>
                    {isMine && (
                      <div style={{
                        display: 'flex', gap: 14, marginTop: 6,
                        fontSize: 11.5, color: t.text3, fontWeight: 600,
                      }}>
                        <button style={{ background: 'transparent', border: 0, padding: 0, color: KP.deep, fontWeight: 600, fontSize: 11.5 }}>Edit</button>
                        <button style={{ background: 'transparent', border: 0, padding: 0, color: t.text3, fontWeight: 600, fontSize: 11.5 }}>Delete</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Composer (above tab bar) */}
        <div style={{
          position: 'absolute', bottom: 76, left: 12, right: 12,
          background: t.surface, borderRadius: 22,
          border: `0.5px solid ${t.sep}`,
          padding: 6,
          display: 'flex', alignItems: 'center', gap: 6,
          boxShadow: dark ? '0 6px 16px rgba(0,0,0,0.4)' : '0 2px 12px rgba(0,0,0,0.08)',
        }}>
          <button style={{ width: 34, height: 34, borderRadius: 99, background: t.fill, border: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <ISFIcon name="plus" size={18} color={t.text2} weight="medium" />
          </button>
          <input placeholder="Add a comment, @ to mention…" style={{
            flex: 1, border: 0, background: 'transparent', outline: 'none',
            fontSize: 14, color: t.text, padding: '0 4px',
          }} />
          <button style={{ width: 34, height: 34, borderRadius: 99, background: KP.gradD, border: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <ISFIcon name="arrow-up" size={16} color="#fff" weight="bold" />
          </button>
        </div>

        <IOSTabBar active="board" t={t} dark={dark} />
      </div>
    </IOSDevice>
  );
}
function IOSDetailRow({ label, value, sep, t }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      minHeight: 38, padding: '8px 0',
      borderBottom: sep ? `0.5px solid ${t.sep}` : 0,
    }}>
      <span style={{ fontSize: 13, color: t.text3, fontWeight: 500, flex: 0.6 }}>{label}</span>
      <span style={{ fontSize: 14, color: t.text, fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Screen 4 — CREATE TASK (sheet with keyboard)
// ════════════════════════════════════════════════════════════════════════
function IOSCreateTask({ dark }) {
  const t = iosTokens(dark);
  const project = M_TASK_PROJECT('p3');
  return (
    <IOSDevice dark={dark} width={360} height={760}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: dark ? 'rgba(0,0,0,0.5)' : 'rgba(40,40,50,0.4)', position: 'relative' }}>
        {/* Background "Today" peeking */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.4, filter: 'blur(2px)' }} />
        {/* Sheet */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          background: t.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
          paddingTop: 6, paddingBottom: 0,
          boxShadow: '0 -20px 40px rgba(0,0,0,0.25)',
          maxHeight: '92%',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Grabber */}
          <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
            <div style={{ width: 36, height: 5, borderRadius: 3, background: t.fill2 }} />
          </div>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 16px 12px', borderBottom: `0.5px solid ${t.sep}`,
          }}>
            <button style={{ background: 'transparent', border: 0, color: KP.deep, fontSize: 16, fontWeight: 500 }}>Cancel</button>
            <span style={{ fontSize: 16, fontWeight: 600, color: t.text }}>New task</span>
            <button style={{
              padding: '6px 14px', borderRadius: 99, border: 0,
              background: KP.gradD, color: '#fff', fontSize: 14, fontWeight: 600,
            }}>Create</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0 8px' }}>
            {/* Title input */}
            <div style={{ padding: '0 20px 12px' }}>
              <div style={{
                fontFamily: '"Newsreader", Georgia, serif',
                fontSize: 22, lineHeight: 1.3, color: t.text, fontWeight: 500,
                letterSpacing: -0.3, minHeight: 28,
              }}>
                Reception signage — proof check
                <span style={{
                  display: 'inline-block', width: 2, height: 22,
                  background: KP.primary, verticalAlign: 'text-bottom',
                  marginLeft: 2, animation: 'none',
                }} />
              </div>
              <div style={{ fontSize: 12, color: t.text3, marginTop: 4 }}>Aa · Title</div>
            </div>

            {/* Properties */}
            <div style={{ padding: '0 16px 8px' }}>
              <div style={{ background: t.surface, borderRadius: 16, padding: '0 14px' }}>
                <ICreatePropRow t={t} icon="square-stack" label="Project" value={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: project.color }} />
                    <span style={{ fontSize: 14, color: t.text }}>{project.name}</span>
                  </span>
                } sep />
                <ICreatePropRow t={t} icon="square-stack" label="Column"     value={<span style={{ color: KP.deep }}>To do</span>} sep />
                <ICreatePropRow t={t} icon="calendar"     label="Due"        value={<span style={{ color: t.text }}>21 May</span>} sep />
                <ICreatePropRow t={t} icon="flag"         label="Priority"   value={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IPrioDot p="medium" /><span style={{ color: t.text }}>Medium</span></span>} sep />
                <ICreatePropRow t={t} icon="person"       label="Assignees"  value={<IAvStack ids={['u4']} size={20} ring={t.surface} />} />
              </div>
            </div>

            {/* Description + attachments hint */}
            <div style={{ padding: '0 16px' }}>
              <div style={{
                background: t.surface, borderRadius: 16,
                padding: 14, fontSize: 14, color: t.text3, lineHeight: 1.45,
                minHeight: 72,
              }}>
                Add a description, brief, or checklist…
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <ICreateChipButton t={t} icon="paperclip" label="Attach" />
                <ICreateChipButton t={t} icon="camera"    label="Camera" />
                <ICreateChipButton t={t} icon="mic"       label="Voice" />
              </div>
            </div>

            <div style={{ height: 12 }} />
          </div>
          <IOSKeyboard dark={dark} />
        </div>
      </div>
    </IOSDevice>
  );
}
function ICreatePropRow({ icon, label, value, sep, t }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      minHeight: 44, padding: '8px 0',
      borderBottom: sep ? `0.5px solid ${t.sep}` : 0,
      gap: 12,
    }}>
      <ISFIcon name={icon} size={18} color={t.text3} />
      <span style={{ fontSize: 14, color: t.text2, flex: 1 }}>{label}</span>
      {value}
      <ISFIcon name="chevron-right" size={14} color={t.text4} weight="medium" />
    </div>
  );
}
function ICreateChipButton({ icon, label, t }) {
  return (
    <button style={{
      flex: 1, height: 40, borderRadius: 12,
      background: t.surface, border: `0.5px solid ${t.sep}`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      color: t.text, fontSize: 13.5, fontWeight: 500,
    }}>
      <ISFIcon name={icon} size={16} color={t.text2} weight="medium" />
      {label}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Screen 5 — INBOX
// ════════════════════════════════════════════════════════════════════════
function IOSInbox({ dark }) {
  const t = iosTokens(dark);
  const segs = [
    { id: 'all',       label: 'All',       count: 12 },
    { id: 'mentions',  label: 'Mentions',  count: 2 },
    { id: 'approvals', label: 'Approvals', count: 3 },
    { id: 'status',    label: 'Status',    count: 3 },
    { id: 'comments',  label: 'Comments',  count: 2 },
  ];
  return (
    <IOSDevice dark={dark} width={360} height={760}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: t.bg, position: 'relative' }}>
        <IOSTopHeader
          kicker="Inbox"
          kickerHi="सूचना"
          title="4 unread"
          dark={dark} t={t}
        />
        {/* Segmented chips (horizontal scroll) */}
        <div style={{
          display: 'flex', gap: 6, padding: '4px 16px 10px',
          overflowX: 'auto',
        }}>
          {segs.map((s, i) => (
            <span key={s.id} style={{
              padding: '6px 12px', borderRadius: 99,
              fontSize: 13, fontWeight: 600, letterSpacing: -0.1,
              background: i === 0 ? KP.primary : t.fill,
              color: i === 0 ? '#fff' : t.text2,
              flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              {s.label}
              <span style={{
                fontSize: 10.5, fontFamily: 'ui-monospace, monospace',
                background: i === 0 ? 'rgba(255,255,255,0.2)' : t.surface,
                color: i === 0 ? '#fff' : t.text3,
                padding: '0 5px', borderRadius: 99,
              }}>{s.count}</span>
            </span>
          ))}
        </div>
        {/* Notifications */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 100px' }}>
          <IOSInboxDayHeader label="Today" hi="आज" count={6} t={t} />
          {M_INBOX.slice(0, 6).map(n => (
            <IOSInboxRow key={n.id} n={n} t={t} dark={dark} />
          ))}
          <IOSInboxDayHeader label="Yesterday" hi="कल" count={4} t={t} />
          {M_INBOX.slice(6, 11).map(n => (
            <IOSInboxRow key={n.id} n={n} t={t} dark={dark} />
          ))}
        </div>
        <IOSTabBar active="inbox" t={t} dark={dark} />
      </div>
    </IOSDevice>
  );
}
function IOSInboxDayHeader({ label, hi, count, t }) {
  return (
    <div style={{
      fontSize: 12, color: t.text3, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: 1.2,
      padding: '8px 4px 6px',
      display: 'flex', alignItems: 'baseline', gap: 8,
    }}>
      <span>{label}</span>
      <span style={{
        fontFamily: '"Tiro Devanagari Hindi", serif',
        textTransform: 'none', letterSpacing: 0,
        color: t.text4, fontSize: 12, fontWeight: 400,
      }}>{hi}</span>
      <span style={{ marginLeft: 'auto', fontSize: 12, color: t.text3, fontFamily: 'ui-monospace, monospace' }}>{count}</span>
    </div>
  );
}
function IOSInboxRow({ n, t, dark }) {
  const u = M_USER(n.who);
  const tone = M_NOTIF_KIND_TONE[n.kind] || 'neutral';
  const style = M_NOTIF_TONE_STYLES[tone];
  return (
    <div style={{
      background: t.surface, borderRadius: 14,
      padding: '12px 12px',
      marginBottom: 6,
      display: 'grid', gridTemplateColumns: '34px 1fr auto', gap: 10,
      alignItems: 'flex-start',
      boxShadow: dark ? 'none' : '0 1px 0 rgba(0,0,0,0.04)',
      position: 'relative',
      borderLeft: n.priority === 'urgent' ? `3px solid #FF453A` : '3px solid transparent',
      paddingLeft: n.priority === 'urgent' ? 9 : 12,
    }}>
      {n.unread && (
        <span style={{
          position: 'absolute', left: n.priority === 'urgent' ? -2 : 2, top: 18,
          width: 6, height: 6, borderRadius: 99, background: KP.deep,
        }} />
      )}
      <div style={{ position: 'relative' }}>
        <IAvatar u={u} size={34} />
        <span style={{
          position: 'absolute', bottom: -2, right: -2,
          width: 18, height: 18, borderRadius: 99,
          background: style.bg,
          border: `2px solid ${t.surface}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ISFIcon name={style.iconName} size={11} color={style.fg} weight="bold" />
        </span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: t.text, lineHeight: 1.4 }}>
          <span style={{ fontWeight: 600 }}>{u.name}</span>{' '}
          <span style={{ color: t.text2 }}>{n.text}</span>
        </div>
        <div style={{
          fontSize: 11.5, color: t.text3, marginTop: 4,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 2, background: M_TASK_PROJECT(n.project).color }} />
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200,
          }}>{n.task}</span>
        </div>
      </div>
      <div style={{ fontSize: 11, color: t.text3, fontFamily: 'ui-monospace, monospace', paddingTop: 2 }}>{n.when}</div>
    </div>
  );
}

Object.assign(window, {
  IOSToday, IOSBoard, IOSTaskDetail, IOSCreateTask, IOSInbox,
});
