// Top-level app for the Kartavya Mobile design canvas.
// Lays out iOS + Android, light + dark, with a rationale post-it card.

function MobileApp() {
  return (
    <DesignCanvas
      title="Kartavya — Mobile companion"
      subtitle="iOS 18+ (Liquid Glass) · Android 14+ (Material 3 Expressive) · light + dark"
    >
      {/* ── Rationale ──────────────────────────────────────────────── */}
      <DCSection id="rationale" title="What's in & what's out" subtitle="Mobile = work on the go, not setup.">
        <DCArtboard id="r-1" label="Design rationale" width={680} height={760}>
          <RationaleCard />
        </DCArtboard>
        <DCArtboard id="r-2" label="Information architecture" width={520} height={760}>
          <IACard />
        </DCArtboard>
      </DCSection>

      {/* ── App Icon ─────────────────────────────────────────────────── */}
      <DCSection id="app-icon" title="App icon" subtitle="क — the first letter of कर्तव्य">
        <DCArtboard id="icon-showcase" label="Icon system" width={1040} height={1240}>
          <AppIconShowcase />
        </DCArtboard>
      </DCSection>

      {/* ── iOS ──────────────────────────────────────────────────────── */}
      <DCSection id="ios-light" title="iOS · Light" subtitle="Liquid Glass · SF system · Newsreader for editorial moments">
        <DCArtboard id="ios-light-login"    label="Login"        width={360} height={760}><IOSLogin dark={false} /></DCArtboard>
        <DCArtboard id="ios-light-today"   label="Today"        width={360} height={760}><IOSToday dark={false} /></DCArtboard>
        <DCArtboard id="ios-light-offline" label="Today · offline" width={360} height={760}><IOSToday dark={false} offline /></DCArtboard>
        <DCArtboard id="ios-light-board"   label="Board · Approval column" width={360} height={760}><IOSBoard dark={false} /></DCArtboard>
        <DCArtboard id="ios-light-detail"  label="Task detail · owner approval" width={360} height={760}><IOSTaskDetail dark={false} /></DCArtboard>
        <DCArtboard id="ios-light-create"  label="Create task"  width={360} height={760}><IOSCreateTask dark={false} /></DCArtboard>
        <DCArtboard id="ios-light-inbox"   label="Inbox"        width={360} height={760}><IOSInbox dark={false} /></DCArtboard>
        <DCArtboard id="ios-light-settings" label="Settings"    width={360} height={760}><IOSSettings dark={false} /></DCArtboard>
      </DCSection>

      <DCSection id="ios-dark" title="iOS · Dark" subtitle="Same surfaces, system dark, brand accents preserved">
        <DCArtboard id="ios-dark-login"   label="Login"       width={360} height={760}><IOSLogin dark /></DCArtboard>
        <DCArtboard id="ios-dark-today"  label="Today"       width={360} height={760}><IOSToday dark /></DCArtboard>
        <DCArtboard id="ios-dark-board"  label="Board"       width={360} height={760}><IOSBoard dark /></DCArtboard>
        <DCArtboard id="ios-dark-detail" label="Task detail" width={360} height={760}><IOSTaskDetail dark /></DCArtboard>
        <DCArtboard id="ios-dark-create" label="Create task" width={360} height={760}><IOSCreateTask dark /></DCArtboard>
        <DCArtboard id="ios-dark-inbox"  label="Inbox"       width={360} height={760}><IOSInbox dark /></DCArtboard>
        <DCArtboard id="ios-dark-settings" label="Settings"  width={360} height={760}><IOSSettings dark /></DCArtboard>
      </DCSection>

      {/* ── Android ──────────────────────────────────────────────────── */}
      <DCSection id="and-light" title="Android · Light" subtitle="Material 3 Expressive · neutral surfaces · Kartavya teal as M3 primary">
        <DCArtboard id="and-light-login"   label="Login"       width={360} height={760}><AndLogin dark={false} /></DCArtboard>
        <DCArtboard id="and-light-today"   label="Today"       width={360} height={760}><AndToday dark={false} /></DCArtboard>
        <DCArtboard id="and-light-offline" label="Today · offline" width={360} height={760}><AndToday dark={false} offline /></DCArtboard>
        <DCArtboard id="and-light-board"   label="Board · Approval column" width={360} height={760}><AndBoard dark={false} /></DCArtboard>
        <DCArtboard id="and-light-detail"  label="Task detail · owner approval" width={360} height={760}><AndTaskDetail dark={false} /></DCArtboard>
        <DCArtboard id="and-light-create"  label="Create task" width={360} height={760}><AndCreateTask dark={false} /></DCArtboard>
        <DCArtboard id="and-light-inbox"   label="Inbox"       width={360} height={760}><AndInbox dark={false} /></DCArtboard>
        <DCArtboard id="and-light-settings" label="Settings"   width={360} height={760}><AndSettings dark={false} /></DCArtboard>
      </DCSection>

      <DCSection id="and-dark" title="Android · Dark" subtitle="M3 dark color roles, same shape language">
        <DCArtboard id="and-dark-login"  label="Login"       width={360} height={760}><AndLogin dark /></DCArtboard>
        <DCArtboard id="and-dark-today"  label="Today"       width={360} height={760}><AndToday dark /></DCArtboard>
        <DCArtboard id="and-dark-board"  label="Board"       width={360} height={760}><AndBoard dark /></DCArtboard>
        <DCArtboard id="and-dark-detail" label="Task detail" width={360} height={760}><AndTaskDetail dark /></DCArtboard>
        <DCArtboard id="and-dark-create" label="Create task" width={360} height={760}><AndCreateTask dark /></DCArtboard>
        <DCArtboard id="and-dark-inbox"  label="Inbox"       width={360} height={760}><AndInbox dark /></DCArtboard>
        <DCArtboard id="and-dark-settings" label="Settings"  width={360} height={760}><AndSettings dark /></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

// ── Rationale card ─────────────────────────────────────────────────────
function RationaleCard() {
  const sections = [
    {
      title: 'In',
      hi: 'सम्मिलित',
      tone: 'in',
      items: [
        ['Boards', 'Kanban, list, schedule, tracker — same 4 views as desktop.'],
        ['Project switcher', 'One tap on the project name → sheet with recents pinned.'],
        ['Task: full cycle', 'Create → assign → comment → attach → approve → done.'],
        ['Subtasks (CRUD)', 'Toggle, add, delete inline — matches backend `subtasks` schema. Progress bar reflects completion.'],
        ['Comments (edit/delete own)', 'Three-dot on your own comments → Edit / Delete. Anyone else\'s is read-only.'],
        ['Approval workflow', 'Move card to "Approval" column → owner gets sign-off card. Owner can also send to client.'],
        ['Notifications', 'Mentions · comments · approval requests + outcomes.'],
        ['File upload', 'Sheet from + button — Files / Camera / Voice.'],
        ['Offline-first', 'Read everything cached. Edits queued, sync banner shows count + Retry.'],
      ],
    },
    {
      title: 'Out (desktop-only)',
      hi: 'बाह्य',
      tone: 'out',
      items: [
        ['Invite users · create teams · admin', 'Sensitive setup belongs on desktop.'],
        ['Create / archive projects', 'Project lifecycle is a desktop action.'],
        ['Templates · automations', 'Configuration too granular for thumb.'],
        ['Reports · time reports · dashboards', 'Skim on phone, build on laptop.'],
      ],
    },
    {
      title: 'Mobile-only adds',
      hi: 'मोबाइल',
      tone: 'add',
      items: [
        ['One-tap status change', 'Status chip on task detail opens an inline picker — fastest path to "done".'],
        ['Camera attachment', 'Capture receipts / site photos straight into a task. (Major for the GST + site-visit workflows.)'],
        ['Voice → comment', 'Hold mic for site-walk dictation, especially Hindi/Marathi.'],
        ['Swipe gestures', 'Right-swipe → next column · left-swipe → snooze.'],
        ['Push: approvals only', 'Owners get pinged the moment a card lands in Approval — the one notification that\'s urgent.'],
      ],
    },
  ];
  return (
    <div style={{
      width: '100%', height: '100%', overflow: 'hidden',
      background: '#F6F3EC',
      fontFamily: 'Inter, system-ui, sans-serif',
      padding: '28px 32px',
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      <div>
        <div style={{
          fontSize: 11, color: '#0082c6', letterSpacing: 2, textTransform: 'uppercase',
          fontWeight: 700, marginBottom: 6,
        }}>Kartavya · Mobile companion</div>
        <h2 style={{
          fontFamily: '"Newsreader", Georgia, serif',
          fontSize: 32, fontWeight: 500, color: '#1A2230',
          margin: 0, letterSpacing: -0.4, lineHeight: 1.1,
        }}>
          A focused phone app for <em style={{ color: '#0082c6', fontStyle: 'italic' }}>finishing tasks</em>
          <span style={{
            fontFamily: '"Tiro Devanagari Hindi", serif',
            fontSize: 0.6 + 'em', marginLeft: 12, color: '#03a1b6',
          }}> कर्तव्य</span>
        </h2>
        <p style={{ fontSize: 13.5, color: '#4A5468', lineHeight: 1.55, margin: '10px 0 0', maxWidth: 580 }}>
          Phones are for the part of the workflow that happens between locations — a site visit, a client call, an evening review. Setup, configuration, and reporting stay on desktop. The companion exposes the actions that genuinely benefit from being one tap away.
        </p>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16,
        flex: 1, minHeight: 0,
      }}>
        {sections.map(sec => (
          <div key={sec.title} style={{
            background: '#FCFAF5', border: '1px solid #E2DCC9', borderRadius: 18,
            padding: '14px 16px',
            display: 'flex', flexDirection: 'column', gap: 8,
            minHeight: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, color: '#fff',
                padding: '2px 8px', borderRadius: 99,
                background: sec.tone === 'in' ? '#0A7A6E'
                  : sec.tone === 'out' ? '#A5B0C2'
                  : '#0082c6',
                letterSpacing: 1, textTransform: 'uppercase',
              }}>{sec.title}</span>
              <span style={{
                fontFamily: '"Tiro Devanagari Hindi", serif',
                fontSize: 12, color: '#6E7B91',
              }}>{sec.hi}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', minHeight: 0 }}>
              {sec.items.map(([t, d], i) => (
                <div key={i} style={{
                  borderBottom: i < sec.items.length - 1 ? '1px dashed #EFE9D8' : 0,
                  paddingBottom: i < sec.items.length - 1 ? 8 : 0,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1A2230', marginBottom: 2 }}>{t}</div>
                  <div style={{ fontSize: 11.5, color: '#4A5468', lineHeight: 1.45 }}>{d}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Information architecture card ──────────────────────────────────────
function IACard() {
  const tabs = [
    { id: 'today', label: 'Today',  hi: 'आज',     desc: 'What needs you now — due, mentions, approvals.' },
    { id: 'board', label: 'Boards', hi: 'फलक',    desc: '4 views: Board · List · Schedule · Tracker.' },
    { id: 'add',   label: 'Add',    hi: '+',      desc: 'Quick-create — title, project, due, attach.' },
    { id: 'inbox', label: 'Inbox',  hi: 'सूचना',  desc: 'Mentions, comments, approval requests, outcomes.' },
    { id: 'me',    label: 'Me',     hi: 'मैं',    desc: 'Profile, theme, offline status, sign out.' },
  ];
  return (
    <div style={{
      width: '100%', height: '100%', overflow: 'hidden',
      background: '#FCFAF5',
      fontFamily: 'Inter, system-ui, sans-serif',
      padding: '28px 28px',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      <div>
        <div style={{
          fontSize: 11, color: '#03a1b6', letterSpacing: 2, textTransform: 'uppercase',
          fontWeight: 700, marginBottom: 6,
        }}>IA · 4 tabs + center action</div>
        <h2 style={{
          fontFamily: '"Newsreader", Georgia, serif',
          fontSize: 26, fontWeight: 500, color: '#1A2230',
          margin: 0, letterSpacing: -0.3, lineHeight: 1.15,
        }}>Where everything lives</h2>
      </div>

      {/* Tab map */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tabs.map(tab => (
          <div key={tab.id} style={{
            display: 'grid', gridTemplateColumns: '40px 1fr',
            gap: 12, alignItems: 'center',
            padding: '10px 14px', borderRadius: 14,
            background: '#F0ECDF',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: tab.id === 'add' ? 'linear-gradient(135deg,#0082c6,#05b7aa)' : '#FFF',
              border: tab.id === 'add' ? 0 : '1px solid #E2DCC9',
              color: tab.id === 'add' ? '#fff' : '#0082c6',
              fontSize: 18, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: '"Newsreader", Georgia, serif',
            }}>{tab.label[0]}</div>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#1A2230' }}>{tab.label}</span>
                <span style={{ fontFamily: '"Tiro Devanagari Hindi", serif', fontSize: 13, color: '#6E7B91' }}>{tab.hi}</span>
              </div>
              <div style={{ fontSize: 11.5, color: '#4A5468', marginTop: 2, lineHeight: 1.4 }}>{tab.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Approval flow */}
      <div style={{
        marginTop: 4,
        padding: 14, borderRadius: 14, border: '1px dashed #C8C0AA',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#B06A00', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8 }}>Approval flow on mobile</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11.5, color: '#4A5468', lineHeight: 1.5 }}>
          <span style={{ padding: '3px 8px', borderRadius: 99, background: '#FCFAF5', border: '1px solid #E2DCC9', fontWeight: 600, color: '#1A2230' }}>Member moves to <em style={{ fontStyle: 'normal', color: '#B06A00' }}>Approval</em></span>
          <span style={{ color: '#A5B0C2' }}>→</span>
          <span style={{ padding: '3px 8px', borderRadius: 99, background: '#FCFAF5', border: '1px solid #E2DCC9', fontWeight: 600, color: '#1A2230' }}>Owner push + Inbox</span>
          <span style={{ color: '#A5B0C2' }}>→</span>
          <span style={{ padding: '3px 8px', borderRadius: 99, background: 'rgba(5,183,170,0.15)', color: '#0A7A6E', fontWeight: 600 }}>Approve &amp; advance</span>
          <span style={{ color: '#A5B0C2' }}>or</span>
          <span style={{ padding: '3px 8px', borderRadius: 99, background: 'rgba(167,139,250,0.18)', color: '#6B46C1', fontWeight: 600 }}>Send to client</span>
        </div>
      </div>
    </div>
  );
}

// ── Mount ──────────────────────────────────────────────────────────────
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<MobileApp />);
