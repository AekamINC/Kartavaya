// A — Customization hub. Merges CustomizeSettingsPage + NotificationsSettingsPage
// into six tabs. Preference keys and the accent-derivation contract are the real
// ones from components/CustomizePanel.jsx (localStorage 'k_prefs').

// Ported verbatim so added presets derive mid/deep exactly as the app does.
function hexToHsl(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
function derive(hex) {
  const [h, s, l] = hexToHsl(hex);
  return { color: hex, mid: hslToHex(h, Math.min(s + 5, 100), Math.max(l - 10, 10)), deep: hslToHex(h, Math.min(s + 10, 100), Math.max(l - 20, 10)) };
}

// 4 shipped + 8 new. Order is the 3×4 grid reading order.
const ACC12 = [
  ['teal', 'Teal', '#05b7aa'], ['blue', 'Blue', '#3b82f6'], ['saffro', 'Saffron', '#f59e0b'], ['indigo', 'Indigo', '#6366f1'],
  ['rose', 'Rose', '#e11d63'], ['emerald', 'Emerald', '#059669'], ['amber', 'Amber', '#d97706'], ['violet', 'Violet', '#7c3aed'],
  ['coral', 'Coral', '#f2643c'], ['slate', 'Slate', '#64748b'], ['crimson', 'Crimson', '#be123c'], ['forest', 'Forest', '#3f6212'],
].map(([id, label, color]) => ({ id, label, shipped: ['teal', 'blue', 'saffro', 'indigo'].includes(id), ...derive(color) }));

const DISPLAY_FONTS = [
  ['newsreader', 'Newsreader', 'editorial', "'Newsreader', Georgia, serif"],
  ['spectral', 'Spectral', 'literary', "'Spectral', Georgia, serif"],
  ['instrument-serif', 'Instrument Serif', 'modern', "'Instrument Serif', Georgia, serif"],
  ['playfair', 'Playfair Display', 'elegant', "'Playfair Display', Georgia, serif"],
  ['lora', 'Lora', 'readable', "'Lora', Georgia, serif"],
  ['inter', 'Inter', 'clean', "'Inter', system-ui, sans-serif"],
  ['dm-sans', 'DM Sans', 'geometric', "'DM Sans', system-ui, sans-serif"],
  ['poppins', 'Poppins', 'friendly', "'Poppins', system-ui, sans-serif"],
  ['source-sans', 'Source Sans 3', 'technical', "'Source Sans 3', system-ui, sans-serif"],
];
const UI_FONTS = [
  ['inter', 'Inter', "'Inter', system-ui, sans-serif"],
  ['dm-sans', 'DM Sans', "'DM Sans', system-ui, sans-serif"],
  ['poppins', 'Poppins', "'Poppins', system-ui, sans-serif"],
  ['source-sans', 'Source Sans 3', "'Source Sans 3', system-ui, sans-serif"],
  ['nunito', 'Nunito Sans', "'Nunito Sans', system-ui, sans-serif"],
  ['jakarta', 'Plus Jakarta Sans', "'Plus Jakarta Sans', system-ui, sans-serif"],
];
const LANGS = [
  ['en', 'English', 'English only'],
  ['en+sa', 'EN + संस्कृत', 'English with Sanskrit module names'],
  ['en+hi', 'EN + हिन्दी', 'English with Hindi throughout'],
  ['en+gu', 'EN + ગુજરાતી', 'English with Gujarati throughout'],
  ['hi', 'हिन्दी', 'Hindi interface'],
  ['gu', 'ગુજરાતી', 'Gujarati interface'],
];
const SOUNDS = [
  { g: 'Soft', hi: 'कोमल', items: [['drop', 'Drop', 660, 'sine'], ['bell', 'Bell', 880, 'sine'], ['chime', 'Chime', 1046, 'triangle']] },
  { g: 'Crisp', hi: 'तीक्ष्ण', items: [['tick', 'Tick', 1400, 'square'], ['pop', 'Pop', 520, 'triangle'], ['tap', 'Tap', 300, 'sine']] },
  { g: 'Indian', hi: 'भारतीय', items: [['tabla', 'Tabla', 196, 'triangle'], ['sitar', 'Sitar', 294, 'sawtooth'], ['ghanti', 'Ghanti · घंटी', 1318, 'sine']] },
];
const EMAIL_NOTIFS = [
  ['assigned', 'Task assigned to me', 'Immediate', true],
  ['mention', 'Someone @mentions me', 'Immediate', true],
  ['approval', 'Approval waiting on me', 'Immediate', true],
  ['due', 'Due date reminder', '1 day before', true],
  ['digest', 'Weekly digest', 'Monday 09:00', false],
  ['support', 'Platform support requests access', 'Immediate · cannot be turned off', 'locked'],
];

let AC;
function playTone(freq, type) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, AC.currentTime);
    g.gain.linearRampToValueAtTime(.16, AC.currentTime + .012);
    g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + .42);
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime + .45);
  } catch (_) { /* no audio in this context */ }
}

function SRow({ t, hi, d, children, stack }) {
  return (
    <div className={'srow' + (stack ? ' srow--stack' : '')}>
      <div className="srow__l">
        <b>{t}{hi && <span className="hi">{hi}</span>}</b>
        {d && <span>{d}</span>}
      </div>
      <div className="srow__c">{children}</div>
    </div>
  );
}
function SSeg({ opts, val, set, full }) {
  return (
    <div className={'sseg' + (full ? ' sseg--full' : '')}>
      {opts.map(([v, l, sub]) => (
        <button key={v} className={'sseg__b' + (val === v ? ' on' : '')} onClick={() => set(v)}>
          {l}{sub && <i>{sub}</i>}
        </button>
      ))}
    </div>
  );
}
function SSwitch({ on, set, locked }) {
  return <button className={'sw' + (on ? ' on' : '')} style={locked ? { opacity: .5, pointerEvents: 'none' } : undefined} onClick={() => set(!on)} role="switch" aria-checked={on} />;
}

// ── Tab 1 · Appearance ─────────────────────────────────────────────────
function TabAppearance({ p, set }) {
  const [pick, setPick] = React.useState(false);
  const acc = p.customAccent ? derive(p.customAccent) : ACC12.find(a => a.id === p.accent);
  return (
    <div className="scol">
      <Card title="Theme" hi="रंगरूप">
        <SRow t="Mode" d="System follows your operating system and switches at sunset if you have that set.">
          <SSeg val={p.mode} set={v => set({ mode: v })} opts={[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']]} />
        </SRow>
        {p.mode === 'system' && <div className="snote">{I.check} Following your OS — currently <b>light</b>. Kartavaya re-renders the moment the system flips; nothing is cached.</div>}
      </Card>

      <Card title="Accent colour" hi="वर्ण" right={<span className="mute mono" style={{ fontSize: 11 }}>{acc.color}</span>}>
        <div className="sacc">
          {ACC12.map(a => (
            <button key={a.id} className={'sacc__b' + (!p.customAccent && p.accent === a.id ? ' on' : '')}
              onClick={() => set({ accent: a.id, customAccent: null })} title={a.label + (a.shipped ? '' : ' · new')}>
              <span className="sacc__sw" style={{ background: `linear-gradient(135deg, ${a.deep}, ${a.mid} 55%, ${a.color})` }} />
              <span className="sacc__l">{a.label}</span>
              {!a.shipped && <span className="sacc__new" />}
            </button>
          ))}
          <button className={'sacc__b sacc__b--custom' + (p.customAccent ? ' on' : '')} onClick={() => setPick(true)}>
            <span className="sacc__sw sacc__sw--rainbow" style={p.customAccent ? { background: p.customAccent } : undefined} />
            <span className="sacc__l">Custom</span>
          </button>
        </div>
        {pick && (
          <div className="spick">
            <input type="color" value={p.customAccent || acc.color} onChange={e => set({ customAccent: e.target.value })} />
            <div style={{ minWidth: 0 }}>
              <b style={{ fontSize: 12.5, display: 'block' }}>Any hex you like</b>
              <span className="mute" style={{ fontSize: 11.5 }}>Mid and deep shades are derived automatically — <span className="mono">L−10</span> and <span className="mono">L−20</span> — so gradients stay consistent.</span>
            </div>
            <button className="btn btn--out btn--sm" onClick={() => { set({ customAccent: null }); setPick(false); }}>Clear</button>
          </div>
        )}
        <div className="sprev">
          <div className="sprev__k">Live preview</div>
          <div className="sprev__r">
            <button className="btn btn--fill btn--sm">Primary</button>
            <button className="btn btn--tonal btn--sm">Tonal</button>
            <button className="btn btn--out btn--sm">Outline</button>
            <a href="#pv" onClick={e => e.preventDefault()}>A link</a>
            <span className="tag" style={{ '--c': 'var(--primary)' }}><span className="tag__dot" />Active</span>
            <span className="chip on">Selected chip</span>
            <span className="meter" style={{ width: 76 }}><span className="meter__f" style={{ width: '64%' }} /></span>
          </div>
        </div>
      </Card>

      <Card title="Sidebar background" hi="पार्श्व" >
        <div className="mute" style={{ fontSize: 12.5, marginBottom: 13, lineHeight: 1.55 }}>
          Today the sidebar is always deep ink. Two more options, because a cream sidebar reads better in bright offices and an accent sidebar is what people ask for first.
        </div>
        <div className="ssides">
          {[['dark', 'Dark ink', 'Current default'], ['light', 'Light cream', 'High-glare rooms'], ['accent', 'Accent', 'Brand-forward']].map(([v, l, d]) => (
            <button key={v} className={'sside' + (p.sideBg === v ? ' on' : '')} onClick={() => set({ sideBg: v })}>
              <span className={'sside__art sside__art--' + v}>
                <span className="sside__brand"><i /><b /></span>
                {[0, 1, 2].map(n => <span key={n} className={'sside__row' + (n === 1 ? ' act' : '')} />)}
              </span>
              <span className="sside__t">{l}</span>
              <span className="sside__d">{d}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Tab 2 · Typography ─────────────────────────────────────────────────
function TabType({ p, set }) {
  const df = DISPLAY_FONTS.find(f => f[0] === p.font) || DISPLAY_FONTS[0];
  const uf = UI_FONTS.find(f => f[0] === p.uiFont) || UI_FONTS[0];
  return (
    <div className="scol">
      <div className="two">
        <div className="scol">
          <Card title="Display font" hi="शीर्षक" right={<span className="mute" style={{ fontSize: 11.5 }}>headings, numbers, page titles</span>}>
            <div className="sfonts">
              {DISPLAY_FONTS.map(([id, label, sub, value]) => (
                <button key={id} className={'sfont' + (p.font === id ? ' on' : '')} onClick={() => set({ font: id })}>
                  <span className="sfont__spec" style={{ fontFamily: value }}>Aa</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="sfont__n" style={{ fontFamily: value }}>{label}</span>
                    <span className="sfont__s">{sub}</span>
                  </span>
                  {p.font === id && <span className="sfont__ck">{I.check}</span>}
                </button>
              ))}
            </div>
          </Card>
          <Card title="UI font" hi="मूल" right={<span className="tag" style={{ '--c': 'var(--ok)' }}>new</span>}>
            <div className="snote snote--warn">
              {SI.alert}
              <span>Today <span className="mono">applyPrefs</span> sets <span className="mono">--font-ui</span> to the display font in both branches of its own <span className="mono">SANS_IDS</span> check — so choosing Newsreader turns every label, table cell and button serif. Splitting the two fixes it.</span>
            </div>
            <div className="sfonts sfonts--2" style={{ marginTop: 13 }}>
              {UI_FONTS.map(([id, label, value]) => (
                <button key={id} className={'sfont' + (p.uiFont === id ? ' on' : '')} onClick={() => set({ uiFont: id })}>
                  <span className="sfont__spec" style={{ fontFamily: value, fontSize: 17 }}>Ag</span>
                  <span className="sfont__n" style={{ fontFamily: value, fontSize: 13 }}>{label}</span>
                  {p.uiFont === id && <span className="sfont__ck">{I.check}</span>}
                </button>
              ))}
            </div>
          </Card>
        </div>
        <div className="scol">
          <Card title="Size and rhythm" hi="माप">
            <SRow t="Base size" d="Everything scales from this. Tables and chips have their own floor so they never go unreadable." stack>
              <div className="rowflex" style={{ gap: 11, width: '100%' }}>
                <input className="sld" type="range" min="12" max="20" step="1" value={p.fontSize} onChange={e => set({ fontSize: +e.target.value })} />
                <span className="mono" style={{ fontSize: 12.5, width: 38, textAlign: 'right', color: 'var(--primary)', fontWeight: 600 }}>{p.fontSize}px</span>
              </div>
            </SRow>
            <div className="divider" style={{ margin: '13px 0' }} />
            <SRow t="Line height" hi="पंक्ति" d="Relaxed helps Devanagari, which has taller ascenders than Latin.">
              <SSeg val={p.lineHeight} set={v => set({ lineHeight: v })} opts={[['1.3', 'Compact'], ['1.5', 'Normal'], ['1.7', 'Relaxed']]} />
            </SRow>
          </Card>
          <div className="sprevcard" style={{ '--pv-d': df[3], '--pv-u': uf[2], '--pv-fs': p.fontSize + 'px', '--pv-lh': p.lineHeight }}>
            <div className="sprevcard__k">Live preview</div>
            <h3>Tata Steel — Mumbai fit-out</h3>
            <p>The June ITC working is reconciled against GSTR-2B. Two vendor invoices are missing HSN codes and are flagged in गणित Ganit. Placeholder body copy set in the UI font at your chosen size and line height.</p>
            <div className="sprevcard__r">
              <button className="btn btn--fill btn--sm">Approve</button>
              <span className="sprevcard__n">₹5,01,500</span>
            </div>
            <div className="sprevcard__f">Heading in <b>{df[1]}</b> · body and controls in <b>{uf[1]}</b></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab 3 · Layout ─────────────────────────────────────────────────────
function TabLayout({ p, set }) {
  return (
    <div className="scol">
      <Card title="Structure" hi="ढाँचा">
        <SRow t="Sidebar" hi="पार्श्व" d="Rail keeps the icons and drops the labels — worth it below 1280px.">
          <SSeg val={p.sidebar} set={v => set({ sidebar: v })} opts={[['wide', 'Wide'], ['rail', 'Rail']]} />
        </SRow>
        <div className="divider" style={{ margin: '13px 0' }} />
        <SRow t="Density" hi="घनत्व" d="Compact drops row height to 38px and page padding to 16px.">
          <SSeg val={p.density} set={v => set({ density: v })} opts={[['compact', 'Compact'], ['comfy', 'Comfy']]} />
        </SRow>
        <div className="divider" style={{ margin: '13px 0' }} />
        <SRow t="Corner radius" hi="कोना" d="Drives --radius-base; every other radius token is derived from it.">
          <SSeg val={p.radius} set={v => set({ radius: v })} opts={[['4', 'Sharp'], ['10', 'Rounded'], ['20', 'Pill']]} />
        </SRow>
      </Card>
      <Card title="Motion" hi="गति">
        <SRow t="Animations" d="Reduced keeps state changes but drops movement. None is instant — and is also what prefers-reduced-motion forces, regardless of this setting.">
          <SSeg val={p.anim} set={v => set({ anim: v })} opts={[['full', 'Full'], ['reduced', 'Reduced'], ['none', 'None']]} />
        </SRow>
        <div className="sradius">
          {['4', '10', '20'].map(r => (
            <span key={r} className={'sradius__d' + (p.radius === r ? ' on' : '')} style={{ borderRadius: r + 'px' }}>{r}px</span>
          ))}
          <span className="mute" style={{ fontSize: 11.5, marginLeft: 6 }}>Cards, buttons, inputs and sheets all follow.</span>
        </div>
      </Card>
    </div>
  );
}

// ── Tab 4 · Language ───────────────────────────────────────────────────
function TabLang({ p, set }) {
  return (
    <Card title="Language" hi="भाषा" right={<span className="mute" style={{ fontSize: 11.5 }}>interface, invoices and notifications</span>}>
      <div className="slangs">
        {LANGS.map(([v, l, d]) => (
          <button key={v} className={'slang' + (p.language === v ? ' on' : '')} onClick={() => set({ language: v })}>
            <span className="slang__l">{l}</span>
            <span className="slang__d">{d}</span>
            {p.language === v && <span className="slang__ck">{I.check}</span>}
          </button>
        ))}
      </div>
      <div className="snote" style={{ marginTop: 14 }}>
        {I.check} Gujarati switches <span className="mono">--font-indic</span> to Noto Sans Gujarati. Hindi and Sanskrit share Tiro Devanagari Hindi.
      </div>
    </Card>
  );
}

// ── Tab 5 · Notifications & sounds ─────────────────────────────────────
function TabNotif({ p, set }) {
  const [perm, setPerm] = React.useState('granted');
  const [emails, setEmails] = React.useState(() => Object.fromEntries(EMAIL_NOTIFS.map(([k, , , v]) => [k, v === 'locked' ? true : v])));
  const st = perm === 'denied' ? ['Blocked in browser', 'var(--danger)'] : p.push ? ['Enabled', 'var(--ok)'] : ['Disabled', 'var(--on-surface-3)'];
  return (
    <div className="scol">
      <Card title="Browser push" hi="सूचना" right={<span className="tag" style={{ '--c': st[1] }}><span className="tag__dot" />{st[0]}</span>}>
        <SRow t="Push notifications" d="Works on desktop and on Android. iOS needs Kartavaya added to the home screen first.">
          <SSwitch on={p.push && perm !== 'denied'} set={v => set({ push: v })} />
        </SRow>
        {perm === 'denied' && (
          <div className="snote snote--err">{SI.alert}<span>Your browser is blocking notifications for this site. We cannot re-ask — it has to be changed in browser settings. <button className="btn btn--text btn--sm" style={{ padding: 0 }} onClick={() => setPerm('granted')}>Simulate fixed</button></span></div>
        )}
        <div className="rowflex" style={{ gap: 8, marginTop: 11 }}>
          <span className="mute" style={{ fontSize: 11.5 }}>Permission state:</span>
          <SSeg val={perm} set={setPerm} opts={[['default', 'default'], ['granted', 'granted'], ['denied', 'denied']]} />
        </div>
      </Card>

      <Card title="Notification sound" hi="ध्वनि" right={<span className="mute" style={{ fontSize: 11.5 }}>tap any card to hear it</span>}>
        {SOUNDS.map(g => (
          <div key={g.g} style={{ marginBottom: 15 }}>
            <div className="sgroup">{g.g}<span className="hi">{g.hi}</span></div>
            <div className="ssounds">
              {g.items.map(([id, label, f, type]) => (
                <button key={id} className={'ssound' + (p.sound === id ? ' on' : '')} onClick={() => { set({ sound: id }); playTone(f, type); }}>
                  <span className="ssound__play">{p.sound === id ? I.check : PLAY}</span>
                  <span className="ssound__l">{label}</span>
                  <span className="ssound__w">{[3, 7, 5, 9, 4, 8, 3].map((h, i) => <i key={i} style={{ height: h + 'px' }} />)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <button className={'ssound ssound--none' + (p.sound === 'none' ? ' on' : '')} onClick={() => set({ sound: 'none' })}>
          <span className="ssound__play">{p.sound === 'none' ? I.check : SI.bellOff}</span>
          <span className="ssound__l">Silent</span>
        </button>
      </Card>

      <div className="two">
        <Card title="Email notifications" hi="ईमेल">
          <div className="scol" style={{ gap: 0 }}>
            {EMAIL_NOTIFS.map(([k, l, when, v]) => (
              <div key={k} className="semail">
                <span style={{ minWidth: 0 }}>
                  <b>{l}</b>
                  <span className="mono">{when}</span>
                </span>
                {v === 'locked'
                  ? <span className="tag" style={{ '--c': 'var(--on-surface-3)' }}>{SI.lock} required</span>
                  : <SSwitch on={emails[k]} set={x => setEmails(e => ({ ...e, [k]: x }))} />}
              </div>
            ))}
          </div>
        </Card>
        <div className="scol">
          <Card title="In-app position" hi="स्थान">
            <div className="spos">
              {[['tr', 'Top right'], ['br', 'Bottom right'], ['bc', 'Bottom centre']].map(([v, l]) => (
                <button key={v} className={'spos__b' + (p.toastPos === v ? ' on' : '')} onClick={() => set({ toastPos: v })}>
                  <span className="spos__art"><i className={'spos__t spos__t--' + v} /></span>
                  <span>{l}</span>
                </button>
              ))}
            </div>
            <div className="snote" style={{ marginTop: 12 }}>{I.check} Bottom right is the default — a stack that grows upward never moves the toast you are reading.</div>
          </Card>
          <Card title="Do not disturb" hi="शांत">
            <SRow t="Quiet hours" d="Push and sound are held. Anything urgent still lands in the inbox.">
              <SSwitch on={p.dnd} set={v => set({ dnd: v })} />
            </SRow>
            {p.dnd && (
              <div className="sdnd">
                <label className="fld"><span className="fld__l">From</span><input className="inp" type="time" defaultValue="20:00" /></label>
                <label className="fld"><span className="fld__l">Until</span><input className="inp" type="time" defaultValue="09:00" /></label>
                <div className="chips" style={{ gridColumn: '1 / -1', marginTop: 4 }}>
                  {['Weekends too', 'Follow public holidays'].map(c => <button key={c} className="chip" style={{ fontSize: 11.5 }}>{c}</button>)}
                </div>
              </div>
            )}
          </Card>
          <Card title="Time format" hi="समय">
            <SSeg full val={p.timeFmt} set={v => set({ timeFmt: v })} opts={[['12h', '12-hour', '5:00 PM'], ['24h', '24-hour', '17:00']]} />
          </Card>
        </div>
      </div>
    </div>
  );
}
const PLAY = <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.8l8 5.2-8 5.2z" /></svg>;

// ── Tab 6 · Data & privacy ─────────────────────────────────────────────
const SESSIONS = [
  ['MacBook Pro · Chrome', 'Mumbai, IN · 103.21.x.x', 'This device', true],
  ['iPhone 15 · Kartavaya app', 'Mumbai, IN · 49.36.x.x', '2 hours ago', false],
  ['Windows 11 · Edge', 'Pune, IN · 152.58.x.x', 'Yesterday', false],
  ['Unknown · Firefox', 'Singapore · 165.21.x.x', '6 days ago', false],
];
function TabData({ p }) {
  const [confirm, setConfirm] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  return (
    <div className="scol">
      <Card title="Active sessions" hi="सत्र" right={<button className="btn btn--out btn--sm">Sign out everywhere</button>}>
        <div className="scol" style={{ gap: 0 }}>
          {SESSIONS.map(([d, loc, when, cur]) => (
            <div key={d} className="ssess">
              <span className={'ssess__ic' + (cur ? ' cur' : '')}>{d.includes('iPhone') ? PHONE : DESK}</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <b>{d}{cur && <span className="tag" style={{ '--c': 'var(--ok)', marginLeft: 8 }}>This device</span>}</b>
                <span>{loc} · {when}</span>
              </span>
              {!cur && <button className="btn btn--out btn--sm">Sign out</button>}
            </div>
          ))}
        </div>
        <div className="snote snote--warn" style={{ marginTop: 13 }}>{SI.alert}<span>A session in Singapore that you don’t recognise is worth ending, then changing your password. Placeholder example.</span></div>
      </Card>

      <div className="two">
        <Card title="Export my data" hi="निर्यात">
          <div className="mute" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            Everything attributable to you — tasks, comments, time entries, files you uploaded, attendance records — as JSON plus original files in a zip. Ready within 24 hours, download link valid for 7 days.
          </div>
          <div className="rowflex" style={{ gap: 8, marginTop: 13 }}>
            <button className="btn btn--fill btn--sm">{I.doc} Request export</button>
            <span className="mute" style={{ fontSize: 11.5 }}>Last export: never</span>
          </div>
        </Card>
        <Card title="Danger zone" hi="संकट">
          <div className="sdanger">
            <b>Delete my account</b>
            <span>You are the <b>owner</b> of Aekam Inc. Transfer ownership before you can delete — otherwise six people lose their workspace with you.</span>
            {!confirm ? (
              <button className="btn btn--danger btn--sm" onClick={() => setConfirm(true)} style={{ alignSelf: 'flex-start' }}>Delete account…</button>
            ) : (
              <>
                <label className="fld" style={{ marginTop: 4 }}>
                  <span className="fld__l">Type “Keval Shah” to confirm</span>
                  <input className="inp" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Keval Shah" autoFocus />
                </label>
                <div className="rowflex" style={{ gap: 8 }}>
                  <button className="btn btn--danger btn--sm" disabled={typed !== 'Keval Shah'}>Delete permanently</button>
                  <button className="btn btn--out btn--sm" onClick={() => { setConfirm(false); setTyped(''); }}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
const PHONE = <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="6" y="2.5" width="8" height="15" rx="2" /><path d="M9 15h2" /></svg>;
const DESK = <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2.5" y="4" width="15" height="9.5" rx="1.6" /><path d="M7 16.5h6" /></svg>;

// ── Hub ────────────────────────────────────────────────────────────────
const CUST_TABS = [['appearance', 'Appearance', 'रूप'], ['typography', 'Typography', 'अक्षर'], ['layout', 'Layout', 'ढाँचा'], ['language', 'Language', 'भाषा'], ['notifications', 'Notifications', 'सूचना'], ['data', 'Data & privacy', 'गोपनीयता']];
const CUST_DEFAULTS = { mode: 'light', accent: 'teal', customAccent: null, sideBg: 'dark', sidebar: 'wide', density: 'comfy', font: 'newsreader', uiFont: 'inter', fontSize: 14, lineHeight: '1.5', radius: '10', anim: 'full', language: 'en+sa', push: true, sound: 'bell', toastPos: 'br', dnd: false, timeFmt: '12h' };

function CustomizeHub() {
  const [tab, setTab] = React.useState('appearance');
  const [p, setP] = React.useState(CUST_DEFAULTS);
  const set = patch => setP(x => ({ ...x, ...patch }));
  React.useEffect(() => { document.documentElement.dataset.theme = p.mode === 'dark' ? 'dark' : 'light'; }, [p.mode]);
  const acc = p.customAccent ? derive(p.customAccent) : ACC12.find(a => a.id === p.accent);
  const df = DISPLAY_FONTS.find(f => f[0] === p.font) || DISPLAY_FONTS[0];
  const uf = UI_FONTS.find(f => f[0] === p.uiFont) || UI_FONTS[0];

  // Preferences apply to this whole surface, exactly as applyPrefs does on <html>.
  const vars = {
    '--primary': acc.mid, '--primary-hover': acc.color, '--primary-vivid': acc.color,
    '--primary-container': hslToHex(hexToHsl(acc.color)[0], 62, 88), '--on-primary-container': hslToHex(hexToHsl(acc.color)[0], 70, 16),
    '--font-display': df[3], '--font-ui': uf[2],
    '--radius-base': p.radius + 'px', '--ix': p.anim === 'none' ? 0.001 : p.anim === 'reduced' ? 0.5 : 1,
    fontSize: p.fontSize + 'px', lineHeight: p.lineHeight,
  };

  return (
    <div className="setwrap" style={vars} data-theme-pref={p.mode} data-density={p.density === 'compact' ? 'compact' : 'cozy'}>
      <PH kick="Settings · व्यवस्था" hi="रूपांकन" en="Customization"
        lede="Two pages merged into one hub. Every control below writes to the same k_prefs object and applies live — this page is re-rendering with your choices as you make them."
        right={<><button className="btn btn--out btn--sm" onClick={() => setP(CUST_DEFAULTS)}>Reset to defaults</button><button className="btn btn--fill btn--sm">Done</button></>} />
      <TabBar tabs={CUST_TABS.map(t => t[0])} val={tab} set={setTab} max={6} />
      <div className="setbody">
        {tab === 'appearance' && <TabAppearance p={p} set={set} />}
        {tab === 'typography' && <TabType p={p} set={set} />}
        {tab === 'layout' && <TabLayout p={p} set={set} />}
        {tab === 'language' && <TabLang p={p} set={set} />}
        {tab === 'notifications' && <TabNotif p={p} set={set} />}
        {tab === 'data' && <TabData p={p} />}
      </div>
    </div>
  );
}

Object.assign(window, { CustomizeHub, ACC12, DISPLAY_FONTS, UI_FONTS, LANGS, SOUNDS, derive, hexToHsl, hslToHex, SRow, SSeg, SSwitch, CUST_DEFAULTS, PLAY });
