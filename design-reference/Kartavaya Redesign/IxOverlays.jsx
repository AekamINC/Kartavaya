// Sections 4–5 — Overlays and menus. Against staging ui/modal.jsx,
// ui/ConfirmDialog.jsx, ui/toast.jsx, ui/CommandPalette.jsx, ui/Tooltip.jsx.

// ── 4.1 Modal ──────────────────────────────────────────────────────────
function DemoModal() {
  const { mobile } = useIx();
  const [open, setOpen] = React.useState(false);
  const [stack, setStack] = React.useState(false);
  const [a, oa] = useExit(open, 180);
  const [b, ob] = useExit(stack, 180);
  return (
    <IxStage h={300}>
      <div className="ixframe" style={{ minHeight: 250, alignItems: 'center', justifyContent: 'center' }}>
        <button className="btn btn--fill btn--sm" onClick={() => setOpen(true)}>Open modal</button>
        {a && (
          <>
            <div className={'ov-scrim' + (oa ? ' out' : '')} onClick={() => setOpen(false)} />
            <div className={(mobile ? 'ov-sheet' : 'ov-modal') + (oa ? ' out' : '') + (stack ? ' behind' : '')}>
              {mobile && <div className="bsheet__grab" />}
              <div className="ov-modal__h"><b style={{ fontSize: 13.5 }}>New invoice</b><button className="icobtn" style={{ width: 26, height: 26, marginLeft: 'auto' }} onClick={() => setOpen(false)}>{I.x}</button></div>
              <div className="ov-modal__b">
                <label className="fld"><span className="fld__l">Client</span><input className="inp" defaultValue="Tata Steel" /></label>
                <div className="mute" style={{ fontSize: 11.5, marginTop: 10 }}>Body scrolls; header and footer stay put.</div>
              </div>
              <div className="ov-modal__f">
                <button className="btn btn--out btn--sm" onClick={() => setStack(true)}>Open a second modal</button>
                <span style={{ flex: 1 }} />
                <button className="btn btn--fill btn--sm" onClick={() => setOpen(false)}>Save</button>
              </div>
            </div>
          </>
        )}
        {b && (
          <>
            <div className={'ov-scrim' + (ob ? ' out' : '')} style={{ zIndex: 14 }} onClick={() => setStack(false)} />
            <div className={(mobile ? 'ov-sheet' : 'ov-modal') + (ob ? ' out' : '')} style={{ zIndex: 15, width: mobile ? undefined : '72%' }}>
              {mobile && <div className="bsheet__grab" />}
              <div className="ov-modal__h"><b style={{ fontSize: 13 }}>Add a line item</b><button className="icobtn" style={{ width: 26, height: 26, marginLeft: 'auto' }} onClick={() => setStack(false)}>{I.x}</button></div>
              <div className="ov-modal__b"><div className="mute" style={{ fontSize: 11.5 }}>The modal underneath dims and scales to 98% rather than being covered — you keep your place.</div></div>
              <div className="ov-modal__f"><span style={{ flex: 1 }} /><button className="btn btn--fill btn--sm" onClick={() => setStack(false)}>Add</button></div>
            </div>
          </>
        )}
      </div>
    </IxStage>
  );
}

// ── 4.2 Confirm dialog ─────────────────────────────────────────────────
function DemoConfirm() {
  const [k, setK] = React.useState(null);
  const [alive, out] = useExit(!!k, 160);
  const danger = k === 'danger';
  return (
    <IxStage h={286}>
      <div className="ixframe" style={{ minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: 8, flexDirection: 'row' }}>
        <button className="btn btn--danger btn--sm" onClick={() => setK('danger')}>Delete project</button>
        <button className="btn btn--out btn--sm" onClick={() => setK('info')}>Publish</button>
        {alive && (
          <>
            <div className={'ov-scrim' + (out ? ' out' : '')} onClick={() => setK(null)} />
            <div className={'ov-cd' + (out ? ' out' : '')} role="alertdialog">
              <span className={'ov-cd__ic' + (danger ? ' danger' : '')}>{danger ? SI.alert : I.check}</span>
              <b style={{ fontSize: 14.5 }}>{danger ? 'Delete “Quarterly GST filing”?' : 'Publish the Diwali campaign?'}</b>
              <p className="ov-cd__m">{danger
                ? '18 tasks, 42 comments and 6 files are deleted with it. This cannot be undone.'
                : 'It goes live on all four channels immediately. You can pause it afterwards.'}</p>
              {danger && <label className="ov-cd__ack"><input type="checkbox" /> I understand this deletes 18 tasks</label>}
              <div className="ov-cd__f">
                <button className="btn btn--out btn--sm" autoFocus onClick={() => setK(null)}>Cancel</button>
                <button className={'btn btn--sm ' + (danger ? 'btn--fill' : 'btn--fill')} style={danger ? { background: 'var(--danger)' } : undefined} onClick={() => setK(null)}>{danger ? 'Delete project' : 'Publish'}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </IxStage>
  );
}

// ── 4.3 Toasts ─────────────────────────────────────────────────────────
const TOASTS = {
  success: ['Invoice INV-2607 sent', 'Delivered to meera@tatasteel.com', 'var(--ok)'],
  error: ['Payroll run failed', 'PF challan for 2 employees is missing', 'var(--danger)'],
  warning: ['GSTR-3B due in 3 days', 'Two invoices still have no HSN code', 'var(--warn)'],
  info: ['Aanya approved the July run', null, '#0082c6'],
  undo: ['Comment deleted', null, 'var(--on-surface-3)'],
};
function DemoToast() {
  const { mobile } = useIx();
  const [list, setList] = React.useState([]);
  const s = useIxScale();
  const timers = React.useRef({});
  const push = kind => {
    const id = Date.now() + Math.random();
    setList(l => [...l.slice(-2), { id, kind }]);
    timers.current[id] = setTimeout(() => setList(l => l.filter(x => x.id !== id)), 4000 * s);
  };
  const pause = id => clearTimeout(timers.current[id]);
  const resume = id => { timers.current[id] = setTimeout(() => setList(l => l.filter(x => x.id !== id)), 2000 * s); };
  React.useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  return (
    <IxStage h={300}>
      <div className="ixframe" style={{ minHeight: 250 }}>
        <div className="chips" style={{ padding: 14 }}>
          {Object.keys(TOASTS).map(k => <button key={k} className="chip" style={{ textTransform: 'capitalize', fontSize: 11.5 }} onClick={() => push(k)}>{k}</button>)}
        </div>
        <div className={'ov-toasts' + (mobile ? ' mob' : '')}>
          {list.map(t => {
            const [title, msg, c] = TOASTS[t.kind];
            return (
              <div key={t.id} className="ov-toast" style={{ '--c': c }} onMouseEnter={() => pause(t.id)} onMouseLeave={() => resume(t.id)}>
                <span className="ov-toast__ic">{t.kind === 'error' ? SI.alert : t.kind === 'warning' ? I.clock : I.check}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <b style={{ fontSize: 12.5, display: 'block' }}>{title}</b>
                  {msg && <span className="mute" style={{ fontSize: 11 }}>{msg}</span>}
                </span>
                {t.kind === 'undo' && <button className="btn btn--text btn--sm" style={{ padding: '2px 7px', fontSize: 11.5 }} onClick={() => setList(l => l.filter(x => x.id !== t.id))}>Undo</button>}
                {t.kind === 'error' && <button className="btn btn--out btn--sm" style={{ padding: '2px 7px', fontSize: 11.5 }}>Retry</button>}
                <button className="icobtn" style={{ width: 20, height: 20 }} onClick={() => setList(l => l.filter(x => x.id !== t.id))}>{I.x}</button>
                <span className="ov-toast__bar" style={{ animationDuration: `calc(4s * var(--ix))` }} />
              </div>
            );
          })}
        </div>
      </div>
    </IxStage>
  );
}

// ── 4.4 Command palette ────────────────────────────────────────────────
const CMDS = [
  { s: 'Recent', l: 'Tata Steel — Mumbai fit-out review', ic: 'task' },
  { s: 'Recent', l: 'GSTR-3B working notes', ic: 'doc' },
  { s: 'Actions', l: 'New invoice', ic: 'fin', k: 'N' },
  { s: 'Actions', l: 'New task', ic: 'task', k: '⌥N' },
  { s: 'Actions', l: 'Start timer on current task', ic: 'clock' },
  { s: 'Go to', l: 'गणित Finance', ic: 'fin', k: 'G I' },
  { s: 'Go to', l: 'ग्रह CRM', ic: 'crm', k: 'G C' },
  { s: 'Go to', l: 'संवाद Messaging', ic: 'chat', k: 'G S' },
  { s: 'Go to', l: 'अधिकार Roles & access', ic: 'gear' },
];
function DemoPalette() {
  const { mobile } = useIx();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [i, setI] = React.useState(0);
  const [alive, out] = useExit(open, 160);
  const f = CMDS.filter(c => (c.l + ' ' + c.s).toLowerCase().includes(q.toLowerCase()));
  const groups = [];
  f.forEach(c => { const g = groups.find(x => x.s === c.s); if (g) g.items.push(c); else groups.push({ s: c.s, items: [c] }); });
  React.useEffect(() => {
    const h = e => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(o => !o); setQ(''); setI(0); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  let n = -1;
  return (
    <IxStage h={352}>
      <div className="ixframe" style={{ minHeight: 306, alignItems: 'center', justifyContent: 'center' }}>
        <button className="btn btn--out btn--sm" onClick={() => { setOpen(true); setQ(''); setI(0); }}>Open with <kbd className="kbd">⌘K</kbd></button>
        {alive && (
          <>
            <div className={'ov-scrim ov-scrim--blur' + (out ? ' out' : '')} onClick={() => setOpen(false)} />
            <div className={(mobile ? 'ov-pal ov-pal--mob' : 'ov-pal') + (out ? ' out' : '')}>
              <div className="ov-pal__s">
                {I.search}
                <input autoFocus value={q} placeholder="Type a command or search…" onChange={e => { setQ(e.target.value); setI(0); }}
                  onKeyDown={e => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(x + 1, f.length - 1)); }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(x - 1, 0)); }
                    if (e.key === 'Enter') { e.preventDefault(); setOpen(false); }
                    if (e.key === 'Escape') setOpen(false);
                  }} />
                <kbd className="kbd">esc</kbd>
              </div>
              <div className="ov-pal__l">
                {groups.map(g => (
                  <div key={g.s}>
                    <div className="ov-pal__g">{g.s}</div>
                    {g.items.map(c => {
                      n++; const idx = n;
                      return (
                        <button key={c.l} className={'ov-pal__r' + (idx === i ? ' on' : '')} onMouseEnter={() => setI(idx)} onClick={() => setOpen(false)}>
                          <span className="ov-pal__ic">{I[c.ic]}</span>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>{c.l}</span>
                          {c.k && <kbd className="kbd">{c.k}</kbd>}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {!f.length && <div className="ixhint" style={{ padding: 26 }}>Nothing matches “{q}”. <b style={{ color: 'var(--primary)' }}>Create a task called “{q}”</b></div>}
              </div>
              <div className="ov-pal__f">
                <span><kbd className="kbd">↑↓</kbd> navigate</span><span><kbd className="kbd">↵</kbd> select</span><span><kbd className="kbd">esc</kbd> close</span>
                <span style={{ marginLeft: 'auto' }}>{f.length} result{f.length === 1 ? '' : 's'}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </IxStage>
  );
}

// ── 5.1 More-actions menu ──────────────────────────────────────────────
function DemoMenu() {
  const { mobile } = useIx();
  const [open, setOpen] = React.useState(false);
  const [sub, setSub] = React.useState(false);
  const [alive, out] = useExit(open, 150);
  const ITEMS = [['Open in new tab', 'doc'], ['Duplicate', 'plus'], ['Move to', 'board', true], ['Copy link', 'hub']];
  return (
    <IxStage h={296}>
      <div className="ixframe" style={{ minHeight: 250 }}>
        <div className="ixrow" style={{ marginTop: 60 }}>
          <span className="pdot" style={{ background: PR.high[1] }} />
          <span className="ixrow__t">Compile Q1 GSTR-3B working notes</span>
          <span style={{ marginLeft: 'auto', position: 'relative' }}>
            <button className={'icobtn' + (open ? ' on' : '')} onClick={() => setOpen(!open)}>{I.dots}</button>
            {alive && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => { setOpen(false); setSub(false); }} />
                <div className={(mobile ? 'ov-sheet ov-sheet--menu' : 'ov-menu') + (out ? ' out' : '')}>
                  {mobile && <div className="bsheet__grab" />}
                  {ITEMS.map(([l, ic, hasSub]) => (
                    <span key={l} style={{ position: 'relative', display: 'block' }} onMouseEnter={() => setSub(!!hasSub)} onMouseLeave={() => hasSub && setSub(false)}>
                      <button className="ov-menu__i">
                        <span className="ov-menu__ic">{I[ic]}</span>{l}
                        {hasSub && <span style={{ marginLeft: 'auto', opacity: .45 }}>{I.chevR}</span>}
                      </button>
                      {hasSub && sub && !mobile && (
                        <div className="ov-menu ov-menu--sub">
                          {['Quarterly GST', 'Diwali campaign', 'Mumbai fit-out'].map(p => <button key={p} className="ov-menu__i">{p}</button>)}
                        </div>
                      )}
                    </span>
                  ))}
                  <div className="ov-menu__sep" />
                  <button className="ov-menu__i danger"><span className="ov-menu__ic">{I.x}</span>Delete task</button>
                </div>
              </>
            )}
          </span>
        </div>
        <div className="ixhint">Click ⋯ · hover “Move to” for the submenu</div>
      </div>
    </IxStage>
  );
}

// ── 5.2 Tooltip ────────────────────────────────────────────────────────
function DemoTooltip() {
  const [on, setOn] = React.useState(null);
  const t = React.useRef(null);
  const show = k => { clearTimeout(t.current); t.current = setTimeout(() => setOn(k), 300 * useIxScaleRef()); };
  const hide = () => { clearTimeout(t.current); setOn(null); };
  return (
    <IxStage h={230}>
      <div className="ixframe" style={{ minHeight: 184, alignItems: 'center', justifyContent: 'space-between', flexDirection: 'row', padding: '0 12px' }}>
        {[['left', 'Pinned to the left edge — flips right'], ['mid', 'Notifications'], ['right', 'Right edge — flips left']].map(([k, txt]) => (
          <span key={k} className="tt" onMouseEnter={() => show(k)} onMouseLeave={hide} onFocus={() => show(k)} onBlur={hide}>
            <button className="icobtn">{k === 'mid' ? I.bell : I.gear}</button>
            {on === k && <span className={'tt__b tt__b--' + k}>{txt}</span>}
          </span>
        ))}
      </div>
      <div className="ixhint">Hover and hold — 300ms before it appears, instant once one is already open</div>
    </IxStage>
  );
}
function useIxScaleRef() { return document.documentElement.dataset.slowmo === '1' ? 4 : 1; }

function IxSecOverlays() {
  return (
    <>
      <IxCard n="4.1" t="Modal" trig="click · ⌘⏎"
        lede="One primitive behind every dialog in the product. It scales up from 96% rather than sliding, because a centred surface that slides has no clear origin."
        spec={{
          entry: <>Scrim fades {num('180ms')}. Panel <code>scale(.96)→1</code> + <code>translateY(8px)→0</code> + fade, {num('220ms')} <code>--ease-emph</code>, {num('40ms')} after the scrim so the two are legibly ordered.</>,
          active: <>Max width <code>620px</code>, <code>--r-xl</code>, glass at <code>--glass-alpha + .08</code>. Body caps at <code>70vh</code> and scrolls; header and footer are fixed. Focus trapped, first field focused.</>,
          dismiss: <>Close button · scrim click · <code>Escape</code> · <code>⌘⏎</code> submits</>,
          exit: <><code>scale(.98)</code> + fade {num('180ms')} <code>--ease-exit</code>; scrim follows {num('140ms')} later so the panel does not appear to fall through it.</>,
          mobile: <>Full-width bottom sheet with a grab handle, <code>--r-xl</code> top corners only, rises {num('300ms')} <code>--ease-emph-in</code>. Swipe down to dismiss.</>,
          tokens: <><code>--r-xl</code> · <code>--shadow-3</code> · <code>--scrim</code> · <code>--glass-blur</code></>,
          handler: <><code>onOpenChange(false)</code>; focus returns to the trigger captured at open time.</>,
          a11y: <><code>role="dialog"</code> <code>aria-modal</code> <code>aria-labelledby</code>. Stacked modals dim the one beneath to <code>scale(.98)</code> and <code>opacity .5</code> and move focus up.</>,
        }}
        today="modal.jsx mounts and unmounts with no animation. Escape and scrim-click work and focus returns to the trigger, but focus is not trapped inside, the close control is a text button reading “Close”, and there is no mobile variant.">
        <DemoModal />
      </IxCard>

      <IxCard n="4.2" t="Confirm dialog" trig="destructive click"
        lede="Reserved for what cannot be undone. Everything reversible gets an undo toast instead — see 3.5. The consequence is stated in numbers, not adjectives."
        spec={{
          entry: <><code>scale(.96)→1</code> + fade {num('220ms')} <code>--ease-emph</code>; on a danger variant the icon runs one <code>--ease-spring</code> pulse.</>,
          active: <>Width <code>400px</code>. Title names the object. Body states the count of what dies with it. Danger variants add an acknowledgement checkbox that gates the confirm button.</>,
          dismiss: <>Cancel · scrim · <code>Escape</code></>,
          exit: <>Fade + <code>scale(.98)</code>, {num('160ms')} <code>--ease-exit</code>.</>,
          mobile: <>Stays a centred dialog, not a sheet — a destructive confirm should not look like the routine sheets that get dismissed by reflex.</>,
          tokens: <><code>--danger</code> · <code>--danger-container</code> · <code>--r-lg</code></>,
          handler: <><code>{'{message, onConfirm, confirmLabel, confirmStyle}'}</code>, as in staging.</>,
          a11y: <><code>role="alertdialog"</code>. Focus lands on <b>Cancel</b>. <code>Enter</code> does <b>not</b> confirm a destructive action — it would make muscle memory dangerous. <code>Tab</code> is trapped.</>,
        }}
        today="ConfirmDialog.jsx gets the important parts right — focus on Cancel, a Tab trap, no Enter-to-confirm. What it lacks: any animation, an icon, a named object in the title, and a consequence count. The title is always the literal string “Are you sure?”.">
        <DemoConfirm />
      </IxCard>

      <IxCard n="4.3" t="Toasts" trig="after an action"
        lede="Bottom-right, newest at the bottom, three at most. Newest-at-the-bottom matters: a stack that grows upward from the corner never moves the toast you are already reading."
        spec={{
          entry: <><code>translateX(16px)</code> + fade {num('220ms')} <code>--ease-emph</code> on desktop; <code>translateY(12px)</code> on mobile.</>,
          active: <>Width <code>328px</code>. <code>3px</code> left border in the type colour. A hairline progress bar drains over the life of the toast, so the dismissal is never a surprise. <b>Hover pauses the timer.</b> Cap of 3 — a fourth commits and removes the oldest.</>,
          dismiss: <>Auto after {num('4s')} · explicit <code>×</code> · hover holds it open indefinitely</>,
          exit: <><code>translateX(12px)</code> + fade {num('180ms')} <code>--ease-exit</code>; the ones below slide up {num('220ms')} to close the gap.</>,
          mobile: <>Full width minus <code>16px</code> gutters, docked above the bottom nav inside the safe area.</>,
          tokens: <><code>--ok</code> <code>--danger</code> <code>--warn</code> <code>#0082c6</code> info · <code>--shadow-3</code></>,
          handler: <><code>pushToast({'{type, title, message, action}'})</code>. <code>action</code> is what enables Undo and Retry.</>,
          a11y: <><code>role="status"</code> for success and info, <code>role="alert"</code> for errors so they interrupt a screen reader.</>,
        }}
        today="toast.jsx is top-right, newest prepended to the top, capped at 3, 3200ms. It has no animation, no hover pause, no progress indication, no close button and no action slot — so Undo and Retry are impossible to express.">
        <DemoToast />
      </IxCard>

      <IxCard n="4.4" t="Command palette" trig="⌘K"
        lede="The fastest path to anything, so it opens at 15vh where the eye already is, and it leads with what you touched last rather than an alphabetical list of features."
        spec={{
          entry: <>Scrim fades with a <code>4px</code> backdrop blur {num('180ms')}; panel <code>scale(.97)→1</code> + <code>translateY(-6px)→0</code> {num('220ms')} <code>--ease-emph</code>.</>,
          active: <>Width <code>560px</code> at <code>15vh</code> from the top. Sections in fixed order — <b>Recent</b>, <b>Actions</b>, <b>Go to</b>. Selected row is <code>--primary-container</code>. Shortcuts right-aligned in <code>--font-mono</code>. Empty query shows recents; a query with no match offers to create.</>,
          dismiss: <><code>Escape</code> · scrim · selecting a result</>,
          exit: <>Fade + <code>scale(.98)</code> {num('160ms')} <code>--ease-exit</code>, then the chosen action runs — never before, or the palette appears to hang.</>,
          mobile: <>Full-screen sheet from the top, search focused, <code>48px</code> rows, footer hints dropped.</>,
          tokens: <><code>--primary-container</code> · <code>--shadow-3</code> · <code>--glass-blur</code></>,
          handler: <><code>onSelect(cmd)</code>. Ranking: exact prefix, then word-boundary, then substring, then fuzzy — recency breaks ties.</>,
          a11y: <><code>role="combobox"</code> + <code>listbox</code>, <code>aria-activedescendant</code>. Keep the list scrolled with <code>scrollTop</code> arithmetic, not <code>scrollIntoView</code>.</>,
        }}
        today="CommandPalette.jsx has ⌘K, grouped sections, arrow navigation and footer hints. Missing: any animation, a Recent section, and real ranking — it is a plain substring includes(), so “inv” ranks a Go-to above New invoice. It also calls scrollIntoView, which fights the page scroll.">
        <DemoPalette />
      </IxCard>
    </>
  );
}

function IxSecMenus() {
  return (
    <>
      <IxCard n="5.1" t="More-actions menu" trig="click ⋯"
        lede="The same ⋯ menu serves task rows, file cards, channels and member cards. Destructive items are last, separated, and red — never adjacent to a routine action."
        spec={{
          entry: <><code>scale(.97)→1</code> + fade {num('140ms')} <code>--ease-spring</code>, transform origin at the corner nearest the button so it appears to come out of it.</>,
          active: <>Min width <code>194px</code>. Rows are <code>icon + label</code>, <code>34px</code> tall, hover <code>--s-container</code>. Submenu opens on hover after {num('180ms')} intent delay, flush to the parent's right edge, and flips left near the viewport edge.</>,
          dismiss: <>Click outside · <code>Escape</code> · choosing an item</>,
          exit: <>Fade {num('120ms')} <code>--ease-exit</code>. The submenu closes with its parent, not before.</>,
          mobile: <>Bottom action sheet, <code>48px</code> rows, submenu becomes a second sheet that slides in from the right with a back affordance.</>,
          tokens: <><code>--r-lg</code> · <code>--shadow-3</code> · <code>--danger</code> for destructive rows</>,
          handler: <>One <code>&lt;Menu items={'{[]}'} /&gt;</code> primitive; items declare <code>{'{label, icon, danger, submenu, onSelect}'}</code>.</>,
          a11y: <><code>role="menu"</code>, arrows move, <code>Home/End</code> jump, typing a letter jumps to that item, <code>Escape</code> closes one level at a time.</>,
        }}
        today="Each surface builds its own ⋯ dropdown inline, so hover colour, width and item order differ between task rows and file cards. No keyboard support and no submenu pattern.">
        <DemoMenu />
      </IxCard>

      <IxCard n="5.2" t="Tooltip" trig="hover 300ms"
        lede="Icon-only buttons need names. The delay stops tooltips firing as the cursor crosses a toolbar, and the flip keeps them on screen at the edges."
        spec={{
          entry: <>After a {num('300ms')} dwell: fade + <code>scale(.94)→1</code> {num('120ms')} <code>--ease-enter</code>. No movement — a tooltip that slides is harder to read than one that just appears.</>,
          active: <><code>#23262B</code> on light, inverted on dark. <code>10.5px</code> medium, <code>--r-xs</code>, <code>pointer-events: none</code> so it can never block the button it names. Auto-flips when within <code>8px</code> of a viewport edge.</>,
          dismiss: <>Mouse out · blur · any click · <code>Escape</code></>,
          exit: <>Fade {num('90ms')}. Once one tooltip is open, moving to a sibling swaps instantly with no new delay.</>,
          mobile: <>Not shown. A tooltip needs hover; on touch the label goes into the control or into a sheet. Long-press is a context menu, not a tooltip.</>,
          tokens: <><code>--r-xs</code> · <code>--shadow-2</code> · fixed ink, not a theme token, so it stays legible on any surface</>,
          handler: <><code>&lt;Tooltip content position delay&gt;</code> as in staging, plus a shared timer so the swap is instant.</>,
          a11y: <>Content mirrored into <code>aria-label</code> on the trigger; <code>role="tooltip"</code> is supplementary, never the only source of the name.</>,
        }}
        today="Tooltip.jsx has the 300ms delay, four positions and a fade-zoom. What is missing: edge auto-flip, so tooltips on the rightmost toolbar buttons render off-screen, and there is no shared timer, so crossing a toolbar fires each one in turn.">
        <DemoTooltip />
      </IxCard>
    </>
  );
}

window.IX_SECTIONS.push(
  { id: 'ix-overlays', n: '04', group: 'Overlays', title: 'Modals, toasts, palette', hi: 'परत', src: 'ui/modal.jsx · ConfirmDialog · toast · CommandPalette', count: 4, Comp: IxSecOverlays },
  { id: 'ix-menus', n: '05', group: 'Overlays', title: 'Menus & tooltips', hi: 'सूची', src: 'ui/Tooltip.jsx', count: 2, Comp: IxSecMenus },
);
Object.assign(window, { DemoModal, DemoConfirm, DemoToast, DemoPalette, DemoMenu, DemoTooltip, IxSecOverlays, IxSecMenus });
