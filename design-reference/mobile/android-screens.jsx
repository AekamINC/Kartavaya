// Android screens for Kartavya mobile companion.
// Material 3 Expressive treatment — varied shapes, surface containers,
// pill buttons, extended FAB, active-pill bottom nav.
//
// We re-implement the device chrome instead of relying on AndroidDevice's
// built-in app bar — Kartavya's mobile chrome is custom per screen.

const aTokens = (dark) => ({
  // Neutral cool gray surfaces (matches iOS light) — M3 tonal containers derived from gray, not teal.
  bg:                dark ? '#0f1411' : '#F2F2F7',
  surface:           dark ? '#0f1411' : '#F2F2F7',
  // M3 "surface containers" — different elevations get different tints
  surfaceLow:        dark ? '#171d1b' : '#ECECF1',
  surface1:          dark ? '#1b211f' : '#E6E6EB',
  surface2:          dark ? '#1f2624' : '#DFDFE4',
  surface3:          dark ? '#242b29' : '#D9D9DE',
  surface4:          dark ? '#272e2c' : '#D3D3D8',
  surface5:          dark ? '#2c3331' : '#CECED3',
  onSurface:         dark ? '#dee4e1' : '#1A1A1F',
  onSurfaceVar:      dark ? '#bec9c5' : '#3F4042',
  onSurfaceVar2:     dark ? '#889390' : '#73757A',
  outline:           dark ? '#889390' : '#73757A',
  outlineVar:        dark ? '#3F4946' : '#C6C6CB',
  // Primary mapped to Kartavya teal
  primary:           dark ? '#83D5C6' : '#006A60',
  onPrimary:         dark ? '#00382F' : '#FFFFFF',
  primaryContainer:  dark ? '#005048' : '#A0F0E4',
  onPrimaryContainer:dark ? '#A0F0E4' : '#00201C',
  // Secondary (deep blue)
  secondary:         dark ? '#9CCAEC' : '#00538E',
  secondaryContainer:dark ? '#003A65' : '#CCE5FA',
  onSecondaryContainer: dark ? '#CCE5FA' : '#001D33',
  // Tertiary (warning / approval amber)
  tertiary:          dark ? '#FFB868' : '#8A5300',
  tertiaryContainer: dark ? '#6C3F00' : '#FFDDB6',
  onTertiaryContainer: dark ? '#FFDDB6' : '#2C1600',
  // Error
  error:             dark ? '#FFB4AB' : '#BA1A1A',
  errorContainer:    dark ? '#93000A' : '#FFDAD6',
  onErrorContainer:  dark ? '#FFDAD6' : '#410002',
  // Approval purple (client review)
  purple:            dark ? '#D0BCFF' : '#6750A4',
  purpleContainer:   dark ? '#4F378B' : '#EADDFF',
  // Brand pure (for accents)
  brandGrad:         KP.gradD,
});

// ── Atoms ────────────────────────────────────────────────────────────────
function AAvatar({ u, size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size,
      background: u.color, color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 600, letterSpacing: 0.2,
      flexShrink: 0, fontFamily: 'Roboto, system-ui',
    }}>{u.initials}</div>
  );
}
function AAvStack({ ids, size = 24, ring }) {
  return (
    <div style={{ display: 'inline-flex' }}>
      {ids.map((id, i) => (
        <div key={id} style={{
          marginLeft: i === 0 ? 0 : -size * 0.32,
          boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
          borderRadius: '50%',
        }}>
          <AAvatar u={M_USER(id)} size={size} />
        </div>
      ))}
    </div>
  );
}
function APrioDot({ p }) {
  return <span style={{
    width: 8, height: 8, borderRadius: '50%',
    background: M_PRIO_COLOR[p], display: 'inline-block', flexShrink: 0,
  }} />;
}

// Material icons — flat outline style
function AMIcon({ name, size = 24, color, filled = false }) {
  const sw = filled ? 0 : 1.8;
  const paths = {
    'home':         filled
      ? <path d="M4 11L12 4l8 7v9h-6v-6h-4v6H4z" fill={color}/>
      : <path d="M4 11L12 4l8 7v9h-6v-6h-4v6H4z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/>,
    'dashboard':    filled
      ? <path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" fill={color}/>
      : <><rect x="4" y="4" width="7" height="7" rx="1" fill="none" stroke={color} strokeWidth={sw}/><rect x="13" y="4" width="7" height="4" rx="1" fill="none" stroke={color} strokeWidth={sw}/><rect x="13" y="10" width="7" height="10" rx="1" fill="none" stroke={color} strokeWidth={sw}/><rect x="4" y="13" width="7" height="7" rx="1" fill="none" stroke={color} strokeWidth={sw}/></>,
    'inbox':        filled
      ? <path d="M4 5h16v8h-4l-2 3h-4l-2-3H4z" fill={color}/>
      : <><path d="M4 5h16v14H4z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/><path d="M4 13h4l2 3h4l2-3h4" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/></>,
    'person':       filled
      ? <><circle cx="12" cy="8" r="3.5" fill={color}/><path d="M5 20c1-3.5 4-5 7-5s6 1.5 7 5" fill={color}/></>
      : <><circle cx="12" cy="8" r="3.5" fill="none" stroke={color} strokeWidth={sw}/><path d="M5 20c1-3.5 4-5 7-5s6 1.5 7 5" fill="none" stroke={color} strokeWidth={sw}/></>,
    'add':          <path d="M12 5v14M5 12h14" stroke={color} strokeWidth={2.4} strokeLinecap="round"/>,
    'check':        <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"/>,
    'arrow-back':   <path d="M20 12H4M10 6l-6 6 6 6" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"/>,
    'more-vert':    <><circle cx="12" cy="5" r="2" fill={color}/><circle cx="12" cy="12" r="2" fill={color}/><circle cx="12" cy="19" r="2" fill={color}/></>,
    'expand-more':  <path d="M6 9l6 6 6-6" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"/>,
    'expand-less':  <path d="M6 15l6-6 6 6" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"/>,
    'chevron-right':<path d="M9 6l6 6-6 6" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"/>,
    'attach':       <path d="M16 7l-7 7a3 3 0 104 4l8-8a5 5 0 10-7-7l-8 8" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"/>,
    'mic':          <><rect x="9" y="3" width="6" height="12" rx="3" fill="none" stroke={color} strokeWidth={sw}/><path d="M5.5 12a6.5 6.5 0 0013 0M12 18v3" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"/></>,
    'send':         filled
      ? <path d="M3 11L21 4l-7 18-3-7-8-4z" fill={color}/>
      : <path d="M3 11L21 4l-7 18-3-7-8-4z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/>,
    'wifi-off':     <><path d="M2 5l20 18" stroke={color} strokeWidth={sw} strokeLinecap="round"/><path d="M5 9a14 14 0 0114-2.5M8 12.5a9 9 0 018-1" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"/><circle cx="12" cy="17.5" r="1.5" fill={color}/></>,
    'sync':         <><path d="M4 12a8 8 0 0114-5.3L21 4M20 12a8 8 0 01-14 5.3L3 20" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"/><path d="M21 4v5h-5M3 20v-5h5" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/></>,
    'camera':       <><rect x="3" y="7" width="18" height="13" rx="3" fill="none" stroke={color} strokeWidth={sw}/><path d="M8 7l1.5-2.5h5L16 7" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/><circle cx="12" cy="13.5" r="3.2" fill="none" stroke={color} strokeWidth={sw}/></>,
    'flag':         <path d="M6 21V4h11l-2 4 2 4H6" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/>,
    'calendar':     <><rect x="4" y="6" width="16" height="14" rx="2.5" fill="none" stroke={color} strokeWidth={sw}/><path d="M4 10h16M8 4v4M16 4v4" stroke={color} strokeWidth={sw} strokeLinecap="round"/></>,
    'at':           <><circle cx="12" cy="12" r="4" fill="none" stroke={color} strokeWidth={sw}/><path d="M16 12v2a2 2 0 004 0v-2a8 8 0 10-3.2 6.4" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"/></>,
    'doc':          <><path d="M7 3h7l5 5v13H7z" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/><path d="M14 3v5h5" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round"/></>,
    'tune':         <><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h14M18 18h2" stroke={color} strokeWidth={sw} strokeLinecap="round"/><circle cx="16" cy="6" r="2" fill="none" stroke={color} strokeWidth={sw}/><circle cx="8"  cy="12" r="2" fill="none" stroke={color} strokeWidth={sw}/><circle cx="16" cy="18" r="2" fill="none" stroke={color} strokeWidth={sw}/></>,
    'search':       <><circle cx="11" cy="11" r="6.5" fill="none" stroke={color} strokeWidth={sw}/><path d="M16 16l4.5 4.5" stroke={color} strokeWidth={sw} strokeLinecap="round"/></>,
    'spark':        <><path d="M12 4l1.5 4 4 1.5-4 1.5L12 15l-1.5-4-4-1.5 4-1.5z" fill={color}/></>,
    'list':         <path d="M4 6h16M4 12h16M4 18h16" stroke={color} strokeWidth={sw} strokeLinecap="round"/>,
    'schedule':     <><circle cx="12" cy="12" r="8" fill="none" stroke={color} strokeWidth={sw}/><path d="M12 7v5l3.5 2" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"/></>,
    'view-kanban':  <><rect x="4" y="4" width="5" height="14" rx="1" fill="none" stroke={color} strokeWidth={sw}/><rect x="10" y="4" width="5" height="10" rx="1" fill="none" stroke={color} strokeWidth={sw}/><rect x="16" y="4" width="5" height="7"  rx="1" fill="none" stroke={color} strokeWidth={sw}/></>,
    'chart':        <path d="M4 19V5M4 19h16M8 16V11M12 16V7M16 16v-7" stroke={color} strokeWidth={sw} strokeLinecap="round"/>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      {paths[name]}
    </svg>
  );
}

// Custom Android device frame (more control over chrome than the starter).
function AndroidShell({ children, dark }) {
  const t = aTokens(dark);
  return (
    <div style={{
      width: 360, height: 760, borderRadius: 18, overflow: 'hidden',
      background: t.bg,
      border: `7px solid rgba(116,119,117,0.5)`,
      boxShadow: '0 30px 80px rgba(0,0,0,0.25)',
      display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
      fontFamily: 'Roboto, system-ui, sans-serif',
      WebkitFontSmoothing: 'antialiased',
      position: 'relative',
    }}>
      {/* Status bar */}
      <div style={{
        height: 36, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '0 20px',
        flexShrink: 0, position: 'relative',
        background: t.bg,
      }}>
        <span style={{ fontSize: 14, color: t.onSurface, fontWeight: 500, letterSpacing: 0.25 }}>9:30</span>
        <div style={{
          position: 'absolute', left: '50%', top: 8, transform: 'translateX(-50%)',
          width: 20, height: 20, borderRadius: 100, background: '#2e2e2e',
        }} />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24"><path d="M2 9a14 14 0 0120 0L12 19 2 9z" fill={t.onSurface}/></svg>
          <svg width="14" height="14" viewBox="0 0 24 24"><path d="M22 21V3L3 21h19z" fill={t.onSurface}/></svg>
          <svg width="14" height="14" viewBox="0 0 24 24"><rect x="5" y="3" width="13" height="19" rx="2" fill={t.onSurface}/><rect x="8" y="1" width="7" height="3" rx="0.5" fill={t.onSurface}/></svg>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
      {/* Gesture nav handle */}
      <div style={{
        height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: t.bg, flexShrink: 0,
      }}>
        <div style={{
          width: 100, height: 4, borderRadius: 2,
          background: dark ? '#fff' : t.onSurface, opacity: 0.4,
        }} />
      </div>
    </div>
  );
}

// ── Unified bottom nav (matches iOS) ─ 5 tabs with center gradient "+" ──
function ABottomNav({ active, t, dark }) {
  const items = [
    { id: 'home',  label: 'Today',  icon: 'home' },
    { id: 'board', label: 'Boards', icon: 'view-kanban' },
    { id: 'plus',  label: '',       icon: 'add', primary: true },
    { id: 'inbox', label: 'Inbox',  icon: 'inbox', badge: 3 },
    { id: 'me',    label: 'Me',     icon: 'person' },
  ];
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      background: t.surfaceLow,
      borderTop: `1px solid ${t.outlineVar}`,
      paddingTop: 8, paddingBottom: 12,
      display: 'flex', alignItems: 'center', justifyContent: 'space-around',
      zIndex: 30,
    }}>
      {items.map(it => {
        if (it.primary) {
          return (
            <div key={it.id} style={{
              width: 48, height: 48, borderRadius: 16,
              background: KP.gradD,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 6px 14px -4px rgba(0,130,198,0.5)',
              marginTop: -10,
            }}>
              <AMIcon name="add" size={24} color="#fff" />
            </div>
          );
        }
        const isActive = it.id === active;
        const c = isActive ? t.primary : t.onSurfaceVar;
        return (
          <div key={it.id} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            minWidth: 48, padding: '4px 8px', position: 'relative',
          }}>
            <AMIcon name={it.icon} size={22} color={c} filled={isActive} />
            <span style={{
              fontSize: 10.5, fontWeight: 500, color: c,
              letterSpacing: 0.2, lineHeight: '12px',
              fontFamily: 'Roboto, system-ui',
            }}>{it.label}</span>
            {it.badge ? (
              <span style={{
                position: 'absolute', top: 0, right: 6,
                minWidth: 16, height: 16, borderRadius: 99,
                background: t.error, color: '#fff',
                fontSize: 10, fontWeight: 700, padding: '0 4px',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                border: `1.5px solid ${t.surfaceLow}`,
              }}>{it.badge}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ── Extended FAB (M3 Expressive: pill with icon + label) ─────────────
function AFAB({ label, icon = 'add', t, bottom = 100, right = 16 }) {
  return (
    <button style={{
      position: 'absolute', right, bottom,
      height: 56, padding: '0 20px 0 18px', borderRadius: 16,
      background: t.primaryContainer, color: t.onPrimaryContainer,
      border: 0, display: 'inline-flex', alignItems: 'center', gap: 10,
      fontSize: 14, fontWeight: 600, letterSpacing: 0.1,
      boxShadow: '0 3px 1px rgba(0,0,0,0.04), 0 3px 8px rgba(0,0,0,0.12)',
      fontFamily: 'Roboto, system-ui',
      zIndex: 20,
    }}>
      <AMIcon name={icon} size={20} color={t.onPrimaryContainer} />
      {label}
    </button>
  );
}

// ── Top header used on multiple screens ──────────────────────────────
function ATopHeader({ kicker, kickerHi, title, dark, t, projectSwitcher, project, scrolled = false }) {
  return (
    <div style={{
      padding: '8px 16px 4px',
      background: scrolled ? t.surface1 : t.surface,
    }}>
      {kicker && (
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4,
        }}>
          <span style={{
            fontSize: 11, color: t.primary, fontWeight: 700,
            letterSpacing: 1.4, textTransform: 'uppercase',
          }}>{kicker}</span>
          {kickerHi && (
            <span style={{
              fontFamily: '"Tiro Devanagari Hindi", serif',
              fontSize: 12, color: t.onSurfaceVar2, fontWeight: 400,
            }}>{kickerHi}</span>
          )}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <h1 style={{
          fontFamily: '"Newsreader", Roboto, serif',
          fontSize: 30, fontWeight: 500, lineHeight: 1.1,
          margin: '2px 0 8px', color: t.onSurface, letterSpacing: -0.5,
          flex: 1,
        }}>{title}</h1>
        <button style={{
          width: 40, height: 40, borderRadius: 20,
          background: 'transparent', border: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <AMIcon name="search" size={22} color={t.onSurfaceVar} />
        </button>
      </div>
      {projectSwitcher && project && (
        <button style={{
          width: '100%', textAlign: 'left',
          padding: '12px 16px', border: 0, marginTop: 2, marginBottom: 8,
          background: t.surface1, borderRadius: 20,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: project.color }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: t.onSurface }}>{project.name}</span>
              <span style={{
                fontFamily: '"Tiro Devanagari Hindi", serif',
                fontSize: 13, color: t.onSurfaceVar2,
              }}>{project.sans}</span>
            </div>
            <div style={{ fontSize: 12, color: t.onSurfaceVar, marginTop: 2 }}>
              {project.client} · {project.open} open · {Math.round(project.progress * 100)}%
            </div>
          </div>
          <AMIcon name="expand-more" size={22} color={t.onSurfaceVar} />
        </button>
      )}
    </div>
  );
}

// ── Offline strip ─────────────────────────────────────────────────────
function AOfflineStrip({ t }) {
  return (
    <div style={{
      margin: '0 16px',
      padding: '10px 14px',
      borderRadius: 16,
      background: t.tertiaryContainer,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <AMIcon name="wifi-off" size={18} color={t.onTertiaryContainer} />
      <div style={{ flex: 1, fontSize: 14, color: t.onTertiaryContainer, fontWeight: 500 }}>
        Offline · 3 changes queued
      </div>
      <span style={{
        fontSize: 12, color: t.onTertiaryContainer, fontWeight: 600,
        padding: '4px 10px', borderRadius: 99,
        background: 'rgba(0,0,0,0.06)',
      }}>Retry</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Screen 1 — TODAY (Android)
// ════════════════════════════════════════════════════════════════════════
function AndToday({ dark, offline = false }) {
  const t = aTokens(dark);
  const filterChips = ['All', 'Due today', 'Mentions', 'Approvals', 'Overdue'];
  return (
    <AndroidShell dark={dark}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 110 }}>
        <ATopHeader
          kicker="Today · 14 May"
          kickerHi="वैशाख"
          title="Good morning, Keval"
          dark={dark} t={t}
        />
        {offline && <AOfflineStrip t={t} />}
        {/* Filter chips */}
        <div style={{
          display: 'flex', gap: 8, padding: '12px 16px 4px',
          overflowX: 'auto',
        }}>
          {filterChips.map((c, i) => (
            <span key={c} style={{
              padding: '7px 16px', borderRadius: 99,
              fontSize: 13.5, fontWeight: 500, letterSpacing: 0.1,
              background: i === 0 ? t.secondaryContainer : 'transparent',
              border: i === 0 ? 0 : `1px solid ${t.outlineVar}`,
              color: i === 0 ? t.onSecondaryContainer : t.onSurfaceVar,
              flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              {i === 0 && <AMIcon name="check" size={14} color={t.onSecondaryContainer} />}
              {c}
            </span>
          ))}
        </div>
        {/* Sections */}
        <div style={{ padding: '12px 16px 0' }}>
          <ASectionHeader t={t} label="Due today" hi="आज" count={2} />
          {M_TODAY.slice(0, 2).map(task => <AndTaskCard key={task.id} task={task} t={t} />)}

          <div style={{ height: 4 }} />
          <ASectionHeader t={t} label="This week" hi="इस सप्ताह" count={4} />
          {M_TODAY.slice(2).map(task => <AndTaskCard key={task.id} task={task} t={t} />)}
        </div>
      </div>
      <ABottomNav active="home" t={t} dark={dark} />
    </AndroidShell>
  );
}
function ASectionHeader({ label, hi, count, t }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 8,
      padding: '8px 4px 10px',
    }}>
      <span style={{
        fontSize: 11, color: t.onSurfaceVar, fontWeight: 700,
        letterSpacing: 1.4, textTransform: 'uppercase',
      }}>{label}</span>
      <span style={{
        fontFamily: '"Tiro Devanagari Hindi", serif',
        fontSize: 12, color: t.onSurfaceVar2,
      }}>{hi}</span>
      <span style={{ marginLeft: 'auto', fontSize: 12, color: t.onSurfaceVar, fontFamily: 'ui-monospace, monospace' }}>{count}</span>
    </div>
  );
}
function AndTaskCard({ task, t }) {
  const project = M_TASK_PROJECT(task.project);
  return (
    <div style={{
      background: t.surfaceLow, borderRadius: 24,
      padding: '14px 16px',
      marginBottom: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: project.color }} />
        <span style={{ fontSize: 12.5, color: t.onSurfaceVar, fontWeight: 500 }}>{project.name}</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 11, color: t.onSurfaceVar2 }}>{task.id}</span>
        {task.syncing && <AMIcon name="sync" size={13} color={t.tertiary} />}
      </div>
      <div style={{
        fontSize: 15.5, lineHeight: 1.35, color: t.onSurface, fontWeight: 500,
        marginBottom: 12,
      }}>{task.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '4px 10px', borderRadius: 99,
          fontSize: 12, fontWeight: 600,
          background: task.priority === 'urgent' ? t.errorContainer
            : task.priority === 'high' ? t.tertiaryContainer
            : t.surface2,
          color: task.priority === 'urgent' ? t.onErrorContainer
            : task.priority === 'high' ? t.onTertiaryContainer
            : t.onSurface,
        }}>
          <AMIcon name="schedule" size={13} color="currentColor" />
          {task.due}
        </span>
        {task.approval === 'requested' && (
          <span style={{
            fontSize: 11, fontWeight: 700, color: t.onTertiaryContainer,
            padding: '4px 10px', borderRadius: 99, background: t.tertiaryContainer,
            letterSpacing: 0.4, textTransform: 'uppercase',
          }}>Approval</span>
        )}
        {task.mention && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, fontWeight: 600, color: t.onSecondaryContainer,
            padding: '4px 10px', borderRadius: 99, background: t.secondaryContainer,
          }}>
            <AMIcon name="at" size={12} color={t.onSecondaryContainer} />
            Mention
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}><AAvStack ids={task.assignees} size={24} ring={t.surfaceLow} /></span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Screen 2 — BOARD (Android)
// ════════════════════════════════════════════════════════════════════════
function AndBoard({ dark }) {
  const t = aTokens(dark);
  const project = M_PROJECTS.find(p => p.id === 'p3');
  const activeCol = M_COLUMNS[2]; // Approval column
  const cards = M_BOARD[activeCol.id] || [];
  return (
    <AndroidShell dark={dark}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 110 }}>
        <ATopHeader
          kicker="Board"
          kickerHi="कार्यफलक"
          title={project.name}
          dark={dark} t={t}
          projectSwitcher
          project={project}
        />
        {/* View switcher */}
        <div style={{ padding: '0 16px 8px', display: 'flex', gap: 6 }}>
          {M_VIEWS.map((v, i) => (
            <button key={v.id} style={{
              flex: 1, padding: '8px 4px',
              border: i === 0 ? 0 : `1px solid ${t.outlineVar}`,
              borderRadius: 99,
              background: i === 0 ? t.secondaryContainer : 'transparent',
              color: i === 0 ? t.onSecondaryContainer : t.onSurfaceVar,
              fontSize: 13, fontWeight: 600, letterSpacing: 0.1,
              fontFamily: 'Roboto, system-ui',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <AMIcon name={
                v.id === 'board' ? 'view-kanban' :
                v.id === 'list' ? 'list' :
                v.id === 'schedule' ? 'schedule' :
                'chart'
              } size={15} color="currentColor" />
              {v.label}
            </button>
          ))}
        </div>
        {/* Column tabs */}
        <div style={{ display: 'flex', gap: 6, padding: '4px 16px 8px', overflowX: 'auto' }}>
          {M_COLUMNS.map(col => {
            const isActive = col.id === activeCol.id;
            const count = (M_BOARD[col.id] || []).length;
            return (
              <div key={col.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 11px', borderRadius: 99,
                background: isActive ? t.surface3 : 'transparent',
                border: `1px solid ${isActive ? 'transparent' : t.outlineVar}`,
                flexShrink: 0,
              }}>
                <span style={{ width: 7, height: 7, borderRadius: col.isApproval ? 2 : 99, background: col.color }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: isActive ? t.onSurface : t.onSurfaceVar }}>{col.title}</span>
                <span style={{ fontSize: 11, color: t.onSurfaceVar2, fontFamily: 'ui-monospace, monospace' }}>{count}</span>
              </div>
            );
          })}
        </div>
        {/* Approval column hint */}
        {activeCol.isApproval && (
          <div style={{ padding: '0 16px 10px' }}>
            <div style={{
              padding: '12px 14px',
              borderRadius: 20,
              background: t.tertiaryContainer,
              color: t.onTertiaryContainer,
              display: 'flex', gap: 10, alignItems: 'center',
              fontSize: 13, lineHeight: 1.4,
            }}>
              <AMIcon name="spark" size={18} color={t.onTertiaryContainer} />
              <span>Cards moved here notify the project owner for sign-off.</span>
            </div>
          </div>
        )}
        {/* Cards */}
        <div style={{ padding: '0 16px' }}>
          {cards.map(c => <AndBoardCard key={c.id} card={c} t={t} />)}
        </div>
      </div>
      <ABottomNav active="board" t={t} dark={dark} />
    </AndroidShell>
  );
}
function AndBoardCard({ card, t }) {
  const approvalChip = card.approvalStatus && (
    <span style={{
      fontSize: 11, fontWeight: 700,
      padding: '3px 10px', borderRadius: 99, letterSpacing: 0.3, textTransform: 'uppercase',
      ...(card.approvalStatus === 'approved'
        ? { color: t.onPrimaryContainer, background: t.primaryContainer }
        : card.approvalStatus === 'pending_client'
        ? { color: t.purple, background: t.purpleContainer }
        : { color: t.onTertiaryContainer, background: t.tertiaryContainer }),
    }}>
      {card.approvalStatus === 'approved' ? 'Approved'
        : card.approvalStatus === 'pending_client' ? 'Client review'
        : 'Owner sign-off'}
    </span>
  );
  return (
    <div style={{
      background: t.surfaceLow, borderRadius: 24,
      padding: '14px 16px',
      marginBottom: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <APrioDot p={card.priority} />
        <span style={{ fontSize: 11.5, color: t.onSurfaceVar, fontWeight: 600 }}>{M_PRIO_LABEL[card.priority]}</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 11, color: t.onSurfaceVar2 }}>{card.id}</span>
        {card.syncing && <AMIcon name="sync" size={13} color={t.tertiary} />}
      </div>
      <div style={{
        fontSize: 15.5, lineHeight: 1.35, color: t.onSurface, fontWeight: 500,
        marginBottom: 12,
      }}>{card.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '3px 10px', borderRadius: 99,
          fontSize: 12, fontWeight: 600,
          background: card.priority === 'urgent' ? t.errorContainer : t.surface2,
          color: card.priority === 'urgent' ? t.onErrorContainer : t.onSurface,
        }}>{card.due}</span>
        {approvalChip}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, color: t.onSurfaceVar2, fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>
          {card.comments > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><AMIcon name="at" size={12} color={t.onSurfaceVar2} />{card.comments}</span>}
          {card.files > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><AMIcon name="attach" size={12} color={t.onSurfaceVar2} />{card.files}</span>}
          <AAvStack ids={card.assignees} size={22} ring={t.surfaceLow} />
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Screen 3 — TASK DETAIL (Android)
// ════════════════════════════════════════════════════════════════════════
function AndTaskDetail({ dark }) {
  const t = aTokens(dark);
  const task = M_TASK_DETAIL;
  const project = M_TASK_PROJECT(task.project);
  return (
    <AndroidShell dark={dark}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 200 }}>
        {/* Top app bar */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '6px 4px',
          background: t.surface,
        }}>
          <button style={{ width: 48, height: 48, borderRadius: 24, background: 'transparent', border: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <AMIcon name="arrow-back" size={22} color={t.onSurface} />
          </button>
          <span style={{ flex: 1, fontSize: 14, color: t.onSurfaceVar, fontFamily: 'ui-monospace, monospace', marginLeft: 4 }}>{task.id}</span>
          <button style={{ width: 48, height: 48, borderRadius: 24, background: 'transparent', border: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <AMIcon name="spark" size={22} color={t.primary} />
          </button>
          <button style={{ width: 48, height: 48, borderRadius: 24, background: 'transparent', border: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <AMIcon name="more-vert" size={22} color={t.onSurface} />
          </button>
        </div>

        <div style={{ padding: '4px 20px 12px' }}>
          {/* Status + project chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px 6px 10px',
              borderRadius: 8, background: t.tertiaryContainer,
              color: t.onTertiaryContainer, fontSize: 12.5, fontWeight: 600,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: '#f59e0b' }} />
              Approval
              <AMIcon name="expand-more" size={14} color={t.onTertiaryContainer} />
            </span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12.5, color: t.onSurfaceVar, fontWeight: 500,
            }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: project.color }} />
              {project.name}
            </span>
          </div>
          {/* Title */}
          <h1 style={{
            fontFamily: '"Newsreader", Roboto, serif',
            fontSize: 26, fontWeight: 500, lineHeight: 1.2,
            margin: '4px 0 8px', color: t.onSurface, letterSpacing: -0.4,
          }}>{task.title}</h1>
        </div>

        {/* Approval card */}
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{
            background: t.tertiaryContainer,
            borderRadius: 28,
            padding: '16px 18px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: '#f59e0b' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: t.onTertiaryContainer, letterSpacing: 1.4, textTransform: 'uppercase' }}>Awaiting your approval</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: t.onTertiaryContainer, opacity: 0.7 }}>{task.approval.requestedAt}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <AAvatar u={M_USER(task.approval.requestedBy)} size={28} />
              <span style={{ fontSize: 13.5, color: t.onTertiaryContainer }}>
                <span style={{ fontWeight: 600 }}>{M_USER(task.approval.requestedBy).name}</span> moved this to Approval
              </span>
            </div>
            <div style={{
              padding: '10px 12px', borderRadius: 16,
              background: 'rgba(255,255,255,0.4)',
              fontSize: 13.5, color: t.onTertiaryContainer, lineHeight: 1.45,
              fontStyle: 'italic', marginBottom: 12,
            }}>"{task.approval.note}"</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{
                flex: 1, height: 40, borderRadius: 99, border: 0,
                background: t.onTertiaryContainer, color: t.tertiaryContainer,
                fontSize: 14, fontWeight: 600, letterSpacing: 0.1,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <AMIcon name="check" size={16} color={t.tertiaryContainer} />
                Approve & advance
              </button>
              <button style={{
                width: 40, height: 40, borderRadius: 20, border: `1px solid ${t.onTertiaryContainer}`,
                background: 'transparent', color: t.onTertiaryContainer,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <AMIcon name="more-vert" size={18} color={t.onTertiaryContainer} />
              </button>
            </div>
            <button style={{
              marginTop: 10, padding: '6px 0', background: 'transparent', border: 0,
              fontSize: 12, color: t.onTertiaryContainer, fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <AMIcon name="person" size={14} color={t.onTertiaryContainer} />
              Or send to client for review
            </button>
          </div>
        </div>

        {/* Properties — M3 expressive: each row is its own pill row */}
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{
            background: t.surfaceLow, borderRadius: 28,
            padding: '4px 16px',
          }}>
            <ADetailRow t={t} icon="schedule" label="Due"        value={<span style={{ color: t.error, fontWeight: 600 }}>{task.due}</span>} sep />
            <ADetailRow t={t} icon="flag"     label="Priority"   value={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><APrioDot p={task.priority} />{M_PRIO_LABEL[task.priority]}</span>} sep />
            <ADetailRow t={t} icon="person"   label="Assignees"  value={<AAvStack ids={task.assignees} size={22} ring={t.surfaceLow} />} sep />
            <ADetailRow t={t} icon="person"   label="Reporter"   value={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <AAvatar u={M_USER(task.reporter)} size={22} />
                <span style={{ fontSize: 14, color: t.onSurface }}>{M_USER(task.reporter).name}</span>
              </span>
            } sep />
            <ADetailRow t={t} icon="schedule" label="Estimate" value={task.estimate} />
          </div>
        </div>

        {/* Subtasks — M3 list with toggle + add */}
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 8,
            padding: '0 4px 8px',
          }}>
            <span style={{
              fontSize: 11, color: t.primary, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 1.4,
            }}>Subtasks</span>
            <span style={{
              fontFamily: '"Tiro Devanagari Hindi", serif',
              fontSize: 12, color: t.onSurfaceVar2,
            }}>उपकार्य</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: t.onSurfaceVar, fontFamily: 'ui-monospace, monospace' }}>
              {task.subtasks.filter(s => s.is_done).length} / {task.subtasks.length}
            </span>
          </div>
          <div style={{
            height: 6, borderRadius: 99, background: t.surface2, overflow: 'hidden',
            marginBottom: 12,
          }}>
            <div style={{
              height: '100%', width: `${(task.subtasks.filter(s => s.is_done).length / task.subtasks.length) * 100}%`,
              background: t.primary, borderRadius: 99,
            }} />
          </div>
          <div style={{ background: t.surfaceLow, borderRadius: 28, padding: 8 }}>
            {task.subtasks.map((s) => (
              <div key={s.subtask_id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 12px', borderRadius: 20,
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 4,
                  border: s.is_done ? 0 : `2px solid ${t.onSurfaceVar}`,
                  background: s.is_done ? t.primary : 'transparent',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {s.is_done && <AMIcon name="check" size={16} color={t.onPrimary} />}
                </div>
                <span style={{
                  flex: 1, fontSize: 14.5, color: s.is_done ? t.onSurfaceVar : t.onSurface,
                  textDecoration: s.is_done ? 'line-through' : 'none',
                  textDecorationColor: t.onSurfaceVar2,
                  lineHeight: 1.4,
                }}>{s.title}</span>
                <button style={{
                  width: 32, height: 32, borderRadius: 99,
                  background: 'transparent', border: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <AMIcon name="more-vert" size={18} color={t.onSurfaceVar} />
                </button>
              </div>
            ))}
            <button style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
              padding: '8px 12px', borderRadius: 20,
              background: 'transparent', border: 0,
              color: t.onSurfaceVar, textAlign: 'left',
              fontFamily: 'Roboto, system-ui',
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: 4,
                border: `2px dashed ${t.onSurfaceVar}`,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <AMIcon name="add" size={14} color={t.onSurfaceVar} />
              </div>
              <span style={{ fontSize: 14, color: t.onSurfaceVar }}>Add subtask…</span>
            </button>
          </div>
        </div>

        {/* Description */}
        <div style={{ padding: '0 24px 18px' }}>
          <div style={{
            fontSize: 11, color: t.primary, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 1.4,
            marginBottom: 8,
          }}>Description</div>
          <div style={{
            fontSize: 14.5, lineHeight: 1.55, color: t.onSurfaceVar,
          }}>{task.description}</div>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', padding: '0 16px',
          borderBottom: `1px solid ${t.outlineVar}`,
        }}>
          {[
            { id: 'comments', label: 'Comments', count: task.comments.length, active: true },
            { id: 'files', label: 'Files', count: task.files.length },
            { id: 'activity', label: 'Activity', count: task.activity.length },
          ].map(tab => (
            <button key={tab.id} style={{
              flex: 1, padding: '14px 4px',
              background: 'transparent', border: 0,
              borderBottom: tab.active ? `3px solid ${t.primary}` : '3px solid transparent',
              marginBottom: -1,
              fontSize: 13.5, fontWeight: 600,
              color: tab.active ? t.primary : t.onSurfaceVar,
              letterSpacing: 0.1, fontFamily: 'Roboto, system-ui',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              {tab.label}
              <span style={{
                fontSize: 11, padding: '1px 7px', borderRadius: 99,
                background: tab.active ? t.primaryContainer : t.surface2,
                color: tab.active ? t.onPrimaryContainer : t.onSurfaceVar,
                fontFamily: 'ui-monospace, monospace',
              }}>{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Comments thread */}
        <div style={{ padding: '14px 16px' }}>
          {task.comments.map((c, i) => {
            const isMine = c.by === 'u1';
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '32px 1fr', gap: 12, marginBottom: 14 }}>
                <AAvatar u={M_USER(c.by)} size={32} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: t.onSurface }}>{M_USER(c.by).name}</span>
                    {isMine && <span style={{
                      fontSize: 9.5, fontWeight: 700, color: t.onPrimaryContainer,
                      padding: '0 6px', borderRadius: 4, letterSpacing: 0.6,
                      background: t.primaryContainer,
                    }}>YOU</span>}
                    <span style={{ fontSize: 11.5, color: t.onSurfaceVar2 }}>{c.when}</span>
                    {isMine && (
                      <button style={{
                        marginLeft: 'auto', width: 28, height: 28, borderRadius: 99,
                        background: 'transparent', border: 0,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <AMIcon name="more-vert" size={16} color={t.onSurfaceVar} />
                      </button>
                    )}
                  </div>
                  <div style={{
                    fontSize: 14, lineHeight: 1.45, color: t.onSurface,
                    padding: '10px 14px', borderRadius: 16,
                    borderTopLeftRadius: 4,
                    background: isMine ? t.primaryContainer : t.surfaceLow,
                  }}>
                    {c.mention ? (
                      <>
                        <span style={{ color: t.primary, fontWeight: 600 }}>@{M_USER(c.mention).name}</span>
                        {c.text.replace(`@${M_USER(c.mention).name}`, '')}
                      </>
                    ) : c.text}
                  </div>
                  {isMine && (
                    <div style={{
                      display: 'flex', gap: 16, marginTop: 6, paddingLeft: 4,
                      fontSize: 12, color: t.onSurfaceVar, fontWeight: 600,
                    }}>
                      <button style={{ background: 'transparent', border: 0, padding: 0, color: t.primary, fontWeight: 600, fontSize: 12 }}>Edit</button>
                      <button style={{ background: 'transparent', border: 0, padding: 0, color: t.onSurfaceVar, fontWeight: 600, fontSize: 12 }}>Delete</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Composer */}
      <div style={{
        position: 'absolute', bottom: 38, left: 12, right: 12,
        background: t.surface3, borderRadius: 28,
        padding: 6,
        display: 'flex', alignItems: 'center', gap: 4,
        zIndex: 10,
      }}>
        <button style={{ width: 40, height: 40, borderRadius: 20, background: 'transparent', border: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <AMIcon name="add" size={22} color={t.onSurfaceVar} />
        </button>
        <input placeholder="Comment, @ to mention…" style={{
          flex: 1, border: 0, background: 'transparent', outline: 'none',
          fontSize: 14, color: t.onSurface, padding: '0 4px',
          fontFamily: 'Roboto, system-ui',
        }} />
        <button style={{ width: 40, height: 40, borderRadius: 20, background: t.primary, border: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <AMIcon name="send" size={18} color={t.onPrimary} filled />
        </button>
      </div>
    </AndroidShell>
  );
}
function ADetailRow({ icon, label, value, sep, t }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      minHeight: 48, padding: '12px 0',
      borderBottom: sep ? `1px solid ${t.outlineVar}` : 0,
    }}>
      <AMIcon name={icon} size={18} color={t.onSurfaceVar} />
      <span style={{ fontSize: 13.5, color: t.onSurfaceVar, flex: 0.7 }}>{label}</span>
      <span style={{ fontSize: 14, color: t.onSurface, fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Screen 4 — CREATE TASK (Android — full screen + IME)
// ════════════════════════════════════════════════════════════════════════
function AndCreateTask({ dark }) {
  const t = aTokens(dark);
  const project = M_TASK_PROJECT('p3');
  return (
    <AndroidShell dark={dark}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Top app bar */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '6px 4px',
          background: t.surface, flexShrink: 0,
        }}>
          <button style={{ width: 48, height: 48, borderRadius: 24, background: 'transparent', border: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <AMIcon name="arrow-back" size={22} color={t.onSurface} />
          </button>
          <span style={{ flex: 1, fontSize: 18, color: t.onSurface, fontWeight: 500, marginLeft: 8 }}>New task</span>
          <button style={{
            padding: '0 20px', height: 40, borderRadius: 20, border: 0,
            background: t.primary, color: t.onPrimary,
            fontSize: 14, fontWeight: 600, letterSpacing: 0.1,
            marginRight: 12,
          }}>Create</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0 8px' }}>
          {/* Title field — M3 filled text field */}
          <div style={{ padding: '0 16px 12px' }}>
            <div style={{
              background: t.surface2, borderRadius: 12, padding: '8px 16px 12px',
              borderBottom: `2px solid ${t.primary}`,
            }}>
              <div style={{
                fontSize: 12, color: t.primary, fontWeight: 500,
                letterSpacing: 0.4, marginBottom: 4,
              }}>Title</div>
              <div style={{
                fontFamily: '"Newsreader", Roboto, serif',
                fontSize: 22, lineHeight: 1.3, color: t.onSurface, fontWeight: 500,
              }}>
                Reception signage — proof check
                <span style={{
                  display: 'inline-block', width: 2, height: 22,
                  background: t.primary, verticalAlign: 'text-bottom', marginLeft: 1,
                }} />
              </div>
            </div>
          </div>

          {/* Properties as outlined chips */}
          <div style={{ padding: '0 16px 14px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <ACreateChip t={t} icon="view-kanban" leading={<span style={{ width: 8, height: 8, borderRadius: 2, background: project.color }} />}>{project.name}</ACreateChip>
              <ACreateChip t={t} icon="view-kanban">To do</ACreateChip>
              <ACreateChip t={t} icon="calendar">21 May</ACreateChip>
              <ACreateChip t={t} icon="flag" leading={<APrioDot p="medium" />}>Medium</ACreateChip>
              <ACreateChip t={t} icon="person" leading={<AAvatar u={M_USER('u4')} size={18} />}>Priya</ACreateChip>
            </div>
          </div>

          {/* Description */}
          <div style={{ padding: '0 16px 14px' }}>
            <div style={{
              background: t.surface2, borderRadius: 12, padding: '14px 16px',
              fontSize: 14, color: t.onSurfaceVar, lineHeight: 1.45, minHeight: 72,
            }}>Description, brief, or checklist…</div>
          </div>

          {/* Attach buttons */}
          <div style={{ padding: '0 16px', display: 'flex', gap: 8 }}>
            <ACreateAttach t={t} icon="attach" label="Attach" />
            <ACreateAttach t={t} icon="camera" label="Camera" />
            <ACreateAttach t={t} icon="mic"    label="Voice" />
          </div>
        </div>
        {/* Gboard */}
        <AndroidKeyboard />
      </div>
    </AndroidShell>
  );
}
function ACreateChip({ icon, leading, children, t }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '8px 14px 8px 10px', borderRadius: 99,
      border: `1px solid ${t.outlineVar}`,
      background: 'transparent', color: t.onSurface,
      fontSize: 13.5, fontWeight: 500, fontFamily: 'Roboto, system-ui',
    }}>
      {leading || <AMIcon name={icon} size={16} color={t.onSurfaceVar} />}
      {children}
    </span>
  );
}
function ACreateAttach({ icon, label, t }) {
  return (
    <button style={{
      flex: 1, height: 42, borderRadius: 99,
      background: t.surface2, border: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      color: t.onSurface, fontSize: 13.5, fontWeight: 500, fontFamily: 'Roboto, system-ui',
    }}>
      <AMIcon name={icon} size={16} color={t.onSurfaceVar} />
      {label}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Screen 5 — INBOX (Android)
// ════════════════════════════════════════════════════════════════════════
function AndInbox({ dark }) {
  const t = aTokens(dark);
  const segs = [
    { id: 'all',       label: 'All',       count: 12 },
    { id: 'mentions',  label: 'Mentions',  count: 2 },
    { id: 'approvals', label: 'Approvals', count: 3 },
    { id: 'status',    label: 'Status',    count: 3 },
    { id: 'comments',  label: 'Comments',  count: 2 },
  ];
  return (
    <AndroidShell dark={dark}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 110 }}>
        <ATopHeader
          kicker="Inbox"
          kickerHi="सूचना"
          title="4 unread"
          dark={dark} t={t}
        />
        {/* Filter chips */}
        <div style={{
          display: 'flex', gap: 8, padding: '4px 16px 10px',
          overflowX: 'auto',
        }}>
          {segs.map((s, i) => (
            <span key={s.id} style={{
              padding: '6px 12px', borderRadius: 99,
              fontSize: 13, fontWeight: 500, letterSpacing: 0.1,
              background: i === 0 ? t.secondaryContainer : 'transparent',
              border: i === 0 ? 0 : `1px solid ${t.outlineVar}`,
              color: i === 0 ? t.onSecondaryContainer : t.onSurfaceVar,
              flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              {s.label}
              <span style={{
                fontSize: 10.5, fontFamily: 'ui-monospace, monospace',
                background: i === 0 ? 'rgba(0,0,0,0.08)' : t.surface2,
                color: i === 0 ? t.onSecondaryContainer : t.onSurfaceVar2,
                padding: '0 6px', borderRadius: 99,
              }}>{s.count}</span>
            </span>
          ))}
        </div>
        {/* Today section */}
        <div style={{ padding: '4px 16px 4px' }}>
          <ASectionHeader t={t} label="Today" hi="आज" count={6} />
        </div>
        {M_INBOX.slice(0, 6).map(n => (
          <AndInboxRow key={n.id} n={n} t={t} />
        ))}
        <div style={{ padding: '12px 16px 4px' }}>
          <ASectionHeader t={t} label="Yesterday" hi="कल" count={4} />
        </div>
        {M_INBOX.slice(6, 11).map(n => (
          <AndInboxRow key={n.id} n={n} t={t} />
        ))}
      </div>
      <ABottomNav active="inbox" t={t} dark={dark} />
    </AndroidShell>
  );
}
function AndInboxRow({ n, t }) {
  const u = M_USER(n.who);
  const tone = M_NOTIF_KIND_TONE[n.kind] || 'neutral';
  // Map to M3 colour container for Android
  const aStyle = {
    mention:  { bg: t.secondaryContainer, fg: t.onSecondaryContainer, icon: 'at' },
    approval: { bg: t.tertiaryContainer,  fg: t.onTertiaryContainer,  icon: 'check' },
    assigned: { bg: t.purpleContainer,    fg: t.purple,               icon: 'person' },
    comment:  { bg: t.primaryContainer,   fg: t.onPrimaryContainer,   icon: 'inbox' },
    status:   { bg: t.secondaryContainer, fg: t.onSecondaryContainer, icon: 'view-kanban' },
    success:  { bg: t.primaryContainer,   fg: t.onPrimaryContainer,   icon: 'check' },
    danger:   { bg: t.errorContainer,     fg: t.onErrorContainer,     icon: 'flag' },
    neutral:  { bg: t.surface2,           fg: t.onSurfaceVar,         icon: 'view-kanban' },
  }[tone];
  return (
    <div style={{
      padding: '12px 16px',
      display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 12,
      alignItems: 'flex-start',
      background: n.unread ? t.surfaceLow : 'transparent',
      position: 'relative',
      borderLeft: n.priority === 'urgent' ? `3px solid ${t.error}` : '3px solid transparent',
    }}>
      <div style={{ position: 'relative' }}>
        <AAvatar u={u} size={40} />
        <span style={{
          position: 'absolute', bottom: -2, right: -2,
          width: 20, height: 20, borderRadius: 99,
          background: aStyle.bg,
          border: `2px solid ${n.unread ? t.surfaceLow : t.surface}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <AMIcon name={aStyle.icon} size={12} color={aStyle.fg} />
        </span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, color: t.onSurface, lineHeight: 1.4 }}>
          <span style={{ fontWeight: 600 }}>{u.name}</span>{' '}
          <span style={{ color: t.onSurfaceVar }}>{n.text}</span>
        </div>
        <div style={{
          fontSize: 12, color: t.onSurfaceVar2, marginTop: 4,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 2, background: M_TASK_PROJECT(n.project).color }} />
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200,
          }}>{n.task}</span>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: t.onSurfaceVar2, paddingTop: 4 }}>{n.when}</div>
      {n.unread && (
        <span style={{
          position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
          width: 4, height: 28, borderRadius: 2, background: t.primary,
        }} />
      )}
    </div>
  );
}

Object.assign(window, {
  AndToday, AndBoard, AndTaskDetail, AndCreateTask, AndInbox,
});
