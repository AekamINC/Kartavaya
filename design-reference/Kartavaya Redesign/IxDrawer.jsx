// Section 1 — Task Drawer. Built against staging TaskDrawer.jsx + drawer/*.
// STATUS/PRIORITY values and colours are the real ones from drawer/constants.js.
function useIxScale() { return document.documentElement.dataset.slowmo === '1' ? 4 : 1; }

// Keeps a node mounted through its exit animation, then drops it.
function useExit(open, ms = 220) {
  const s = useIxScale();
  const [alive, setAlive] = React.useState(open);
  const [out, setOut] = React.useState(false);
  React.useEffect(() => {
    if (open) { setAlive(true); setOut(false); return; }
    if (!alive) return;
    setOut(true);
    const t = setTimeout(() => setAlive(false), ms * s);
    return () => clearTimeout(t);
  }, [open]);
  return [alive, out];
}

const ST = { todo: ['To do', '#64748b'], in_progress: ['In progress', '#0082c6'], in_review: ['In review', '#8b5cf6'], done: ['Done', '#16a34a'] };
const ST_ORDER = ['todo', 'in_progress', 'in_review', 'done'];
const PR = { urgent: ['Urgent', '#B42318'], high: ['High', '#A66207'], medium: ['Medium', '#0082c6'], low: ['Low', '#74786F'] };
const DEMO_TASKS = [
  { id: 'KAR-582', t: 'Tata Steel — Mumbai fit-out review', st: 'in_review', pr: 'urgent' },
  { id: 'KAR-184', t: 'Compile Q1 GSTR-3B working notes', st: 'in_progress', pr: 'high' },
  { id: 'KAR-411', t: 'Vendor agreement — clause update', st: 'todo', pr: 'low' },
];
const MEM = ['Keval Shah', 'Aanya Mehta', 'Rohan Iyer', 'Priya Nair', 'Arjun Desai', 'Fatima Sheikh'];

// ── 1.1 Open and close ─────────────────────────────────────────────────
function DemoDrawerOpen() {
  const { mobile } = useIx();
  const [sel, setSel] = React.useState(null);
  const [snap, setSnap] = React.useState(1);
  const [alive, out] = useExit(!!sel, mobile ? 260 : 220);
  const task = sel || DEMO_TASKS[0];
  return (
    <IxSurface h={mobile ? 210 : 196}>
      <div style={{ flex: 1, overflow: 'hidden', paddingTop: mobile ? 24 : 0 }}>
        {DEMO_TASKS.map(t => (
          <button key={t.id} className="ixrow" onClick={() => { setSel(t); setSnap(1); }}>
            <span className="pdot" style={{ background: PR[t.pr][1] }} />
            <span className="ixrow__t">{t.t}</span>
            <span className="tag" style={{ '--c': ST[t.st][1], marginLeft: 'auto' }}>{ST[t.st][0]}</span>
          </button>
        ))}
        {!alive && <div className="ixhint">Click a row</div>}
      </div>
      {alive && (
        <>
          <div className={'dm-scrim' + (out ? ' out' : '')} onClick={() => setSel(null)} />
          <div className={(mobile ? 'dm-sheet' : 'dm-drawer') + (out ? ' out' : '')} data-snap={mobile ? snap : undefined}>
            {mobile && <button className="dm-grab" onClick={() => setSnap(s => (s === 1 ? 2 : 1))} title="Drag or tap to change snap point"><i /></button>}
            <div className="dm-drawer__h">
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--on-surface-3)' }}>{task.id}</span>
              <b style={{ fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.t}</b>
              <button className="icobtn" style={{ marginLeft: 'auto', width: 26, height: 26 }} onClick={() => setSel(null)}>{I.x}</button>
            </div>
            <div className="dm-drawer__b">
              <div className="props" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="prop"><span className="prop__l">Status</span><span className="prop__v"><span className="tag" style={{ '--c': ST[task.st][1] }}>{ST[task.st][0]}</span></span></div>
                <div className="prop"><span className="prop__l">Priority</span><span className="prop__v"><span className="pdot" style={{ background: PR[task.pr][1] }} /> {PR[task.pr][0]}</span></div>
              </div>
              <div className="mute" style={{ fontSize: 11.5, marginTop: 10 }}>{mobile ? 'Tap the grab handle to move between snap points. Swipe down or tap the scrim to dismiss.' : 'Escape, the X, or the scrim closes it.'}</div>
            </div>
          </div>
        </>
      )}
    </IxSurface>
  );
}

// ── 1.2 Inline title edit ──────────────────────────────────────────────
function DemoTitleEdit() {
  const [edit, setEdit] = React.useState(false);
  const [val, setVal] = React.useState('Compile Q1 GSTR-3B working notes');
  const [state, setState] = React.useState('idle');
  const s = useIxScale();
  const ref = React.useRef(null);
  React.useEffect(() => { if (edit) ref.current?.focus(); }, [edit]);
  const save = () => {
    setEdit(false);
    if (val.trim() === '') { setState('err'); setTimeout(() => setState('idle'), 2200 * s); return; }
    setState('saving');
    setTimeout(() => { setState('saved'); setTimeout(() => setState('idle'), 1100 * s); }, 620 * s);
  };
  return (
    <IxStage>
      <div className="dm-titlewrap">
        {edit ? (
          <input ref={ref} className="dm-title dm-title--edit" value={val} onChange={e => setVal(e.target.value)}
            onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEdit(false); } }} />
        ) : (
          <button className="dm-title" onClick={() => setEdit(true)}>{val || <span className="mute">Untitled</span>}</button>
        )}
        <span className={'dm-save dm-save--' + state}>
          {state === 'saving' && <><span className="dm-spin" /> Saving</>}
          {state === 'saved' && <>{I.check} Saved</>}
          {state === 'err' && <>{SI.alert} Title can’t be empty — reverted</>}
        </span>
      </div>
      <div className="ixhint">Click the title · ⏎ saves · Esc reverts · empty title fails</div>
    </IxStage>
  );
}

// ── 1.3 Description autosave ───────────────────────────────────────────
function DemoDesc() {
  const [v, setV] = React.useState('Placeholder description. Pull the June ITC working and reconcile against GSTR-2B before filing.');
  const [foc, setFoc] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const s = useIxScale();
  const ref = React.useRef(null);
  const grow = el => { if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 150) + 'px'; };
  React.useEffect(() => { grow(ref.current); }, [v]);
  return (
    <IxStage>
      <div className="fld">
        <span className="fld__l">Description</span>
        <textarea ref={ref} className={'dm-ta' + (foc ? ' on' : '')} value={v} rows="2"
          onChange={e => { setV(e.target.value); setSaved(false); }}
          onFocus={() => setFoc(true)}
          onBlur={() => { setFoc(false); setSaved(true); setTimeout(() => setSaved(false), 1600 * s); }} />
        <div className="rowflex" style={{ gap: 8, minHeight: 18 }}>
          {foc && <span className="mute" style={{ fontSize: 10.5 }}>Auto-saves when you click away · ⌘⏎ saves now</span>}
          {saved && <span className="dm-save dm-save--saved">{I.check} Saved</span>}
        </div>
      </div>
    </IxStage>
  );
}

// ── 1.4 Status pipeline ────────────────────────────────────────────────
function DemoPipeline() {
  const [cur, setCur] = React.useState('in_progress');
  const [hov, setHov] = React.useState(null);
  const ci = ST_ORDER.indexOf(cur);
  return (
    <IxStage>
      <div className="dm-pipe">
        {ST_ORDER.map((k, i) => {
          const past = i < ci, active = i === ci;
          return (
            <button key={k} className={'dm-stage' + (active ? ' on' : past ? ' past' : '')}
              style={{ '--c': ST[k][1] }} onClick={() => setCur(k)}
              onMouseEnter={() => setHov(k)} onMouseLeave={() => setHov(null)}>
              {past && <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M3 8l4 4 6-7" /></svg>}
              {ST[k][0]}
              {hov === k && !active && <span className="dm-tip">Move to {ST[k][0]}</span>}
            </button>
          );
        })}
      </div>
      <div className="ixhint">Click any stage. Past stages keep a check; the arrow notch inherits each stage’s fill.</div>
    </IxStage>
  );
}

// ── 1.5 Assignee picker ────────────────────────────────────────────────
function DemoAssignee() {
  const [open, setOpen] = React.useState(false);
  const [on, setOn] = React.useState(['Aanya Mehta']);
  const [q, setQ] = React.useState('');
  const { mobile } = useIx();
  const [alive, out] = useExit(open, 160);
  const list = MEM.filter(m => m.toLowerCase().includes(q.toLowerCase()));
  const tog = m => setOn(v => v.includes(m) ? v.filter(x => x !== m) : [...v, m]);
  return (
    <IxStage h={330}>
      <div style={{ position: 'relative' }}>
        <span className="fld__l" style={{ display: 'block', marginBottom: 6 }}>Assignees</span>
        <button className={'dm-field' + (open ? ' on' : '')} onClick={() => setOpen(!open)}>
          {on.length ? <><Avs list={on} max={4} s={22} /><span style={{ fontSize: 12.5 }}>{on.length === 1 ? on[0] : on.length + ' people'}</span></> : <span className="mute" style={{ fontSize: 12.5 }}>Unassigned</span>}
          <span style={{ marginLeft: 'auto', opacity: .5 }}>{I.chevR}</span>
        </button>
        {alive && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setOpen(false)} />
            <div className={(mobile ? 'dm-bsheet' : 'dm-pop') + (out ? ' out' : '')} style={mobile ? undefined : { top: 'calc(100% + 6px)', left: 0, width: 246 }}>
              {mobile && <div className="bsheet__grab" />}
              <div className="dm-pop__srch">{I.search}<input autoFocus={!mobile} placeholder="Search members" value={q} onChange={e => setQ(e.target.value)} /></div>
              <div className="dm-pop__list">
                {list.map(m => (
                  <button key={m} className={'dm-opt' + (on.includes(m) ? ' on' : '')} onClick={() => tog(m)}>
                    <Av n={m} s={22} />
                    <span style={{ minWidth: 0, fontSize: 12.5 }}>{m}</span>
                    <span className="dm-opt__ck">{on.includes(m) ? I.check : null}</span>
                  </button>
                ))}
                {!list.length && <div className="ixhint" style={{ padding: 14 }}>No member matches “{q}”</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </IxStage>
  );
}

// ── 1.6 Priority picker ────────────────────────────────────────────────
function DemoPriority() {
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState('high');
  const [flash, setFlash] = React.useState(0);
  const [alive, out] = useExit(open, 160);
  return (
    <IxStage h={286}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <span className="fld__l" style={{ display: 'block', marginBottom: 6 }}>Priority</span>
        <button key={flash} className={'dm-badge' + (flash ? ' ixflash' : '')} style={{ '--c': PR[v][1] }} onClick={() => setOpen(!open)}>
          <span className="pdot" style={{ background: PR[v][1] }} />{PR[v][0]}
        </button>
        {alive && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setOpen(false)} />
            <div className={'dm-pop' + (out ? ' out' : '')} style={{ top: 'calc(100% + 6px)', left: 0, width: 176 }}>
              <div className="dm-pop__list">
                {Object.entries(PR).map(([k, [l, c]]) => (
                  <button key={k} className={'dm-opt' + (v === k ? ' on' : '')} onClick={() => { setV(k); setOpen(false); setFlash(f => f + 1); }}>
                    <span className="pdot" style={{ background: c }} />
                    <span style={{ fontSize: 12.5 }}>{l}</span>
                    <span className="dm-opt__ck">{v === k ? I.check : null}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      <div className="ixhint">Change it — the badge flashes once so the save is visible without a toast.</div>
    </IxStage>
  );
}

// ── 1.7 Due date + reminder ────────────────────────────────────────────
const JUL = { blanks: 2, days: 31, today: 25 };
function DemoDate() {
  const [open, setOpen] = React.useState(false);
  const [d, setD] = React.useState(28);
  const [rem, setRem] = React.useState(false);
  const { mobile } = useIx();
  const [alive, out] = useExit(open, 160);
  return (
    <IxStage h={430}>
      <div style={{ position: 'relative' }}>
        <span className="fld__l" style={{ display: 'block', marginBottom: 6 }}>Due date</span>
        <button className={'dm-field' + (open ? ' on' : '')} style={{ width: 200 }} onClick={() => setOpen(!open)}>
          {I.clock}<span style={{ fontSize: 12.5 }}>{d ? d + ' Jul 2026' : 'No date'}</span>
        </button>
        {alive && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setOpen(false)} />
            <div className={(mobile ? 'dm-bsheet' : 'dm-pop') + (out ? ' out' : '')} style={mobile ? undefined : { top: 'calc(100% + 6px)', left: 0, width: 268 }}>
              {mobile && <div className="bsheet__grab" />}
              <div className="dm-cal">
                <div className="dm-cal__h">
                  <button className="icobtn" style={{ width: 24, height: 24 }}>{I.chevL}</button>
                  <button className="dm-cal__m">July 2026</button>
                  <button className="icobtn" style={{ width: 24, height: 24 }}>{I.chevR}</button>
                </div>
                <div className="dm-cal__g">
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x, i) => <span key={i} className="dm-cal__dow">{x}</span>)}
                  {Array.from({ length: JUL.blanks }).map((_, i) => <span key={'b' + i} />)}
                  {Array.from({ length: JUL.days }).map((_, i) => {
                    const n = i + 1;
                    return <button key={n} className={'dm-cal__d' + (n === d ? ' on' : '') + (n === JUL.today ? ' today' : '')} onClick={() => setD(n)}>{n}</button>;
                  })}
                </div>
                <div className="dm-cal__q">
                  {[['Today', 25], ['Tomorrow', 26], ['Next week', 31], ['No date', null]].map(([l, v]) => (
                    <button key={l} className="chip" style={{ fontSize: 11.5, padding: '4px 9px' }} onClick={() => setD(v)}>{l}</button>
                  ))}
                </div>
                <div className="dm-cal__rem">
                  <button className="between" style={{ width: '100%', textAlign: 'left' }} onClick={() => setRem(!rem)}>
                    <span className="rowflex" style={{ gap: 7, fontSize: 12 }}>{I.bell} Reminder</span>
                    <span style={{ transform: rem ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease-emph)', display: 'inline-flex', opacity: .5 }}>{I.chevR}</span>
                  </button>
                  {rem && (
                    <div className="dm-cal__remb">
                      <select className="inp" style={{ padding: '6px 26px 6px 9px', fontSize: 12 }}><option>15 minutes before</option><option>1 hour before</option><option>1 day before</option><option>Custom…</option></select>
                      <div className="chips" style={{ gap: 6, marginTop: 7 }}>
                        <button className="chip on" style={{ fontSize: 11, padding: '3px 9px' }}>In-app</button>
                        <button className="chip" style={{ fontSize: 11, padding: '3px 9px' }}>Email</button>
                        <button className="chip" style={{ fontSize: 11, padding: '3px 9px' }}>WhatsApp</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </IxStage>
  );
}

// ── 1.8 Category picker with create ────────────────────────────────────
const CATS = [['Compliance', '#0082c6'], ['Client work', '#04837A'], ['Internal', '#74786F'], ['Marketing', '#A66207']];
function DemoCategory() {
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState('Compliance');
  const [q, setQ] = React.useState('');
  const [alive, out] = useExit(open, 160);
  const list = CATS.filter(([c]) => c.toLowerCase().includes(q.toLowerCase()));
  const cur = CATS.find(([c]) => c === v);
  return (
    <IxStage h={330}>
      <div style={{ position: 'relative' }}>
        <span className="fld__l" style={{ display: 'block', marginBottom: 6 }}>Category</span>
        <button className={'dm-field' + (open ? ' on' : '')} style={{ width: 210 }} onClick={() => setOpen(!open)}>
          <span className="chip__dot" style={{ background: cur ? cur[1] : 'var(--outline)' }} />
          <span style={{ fontSize: 12.5 }}>{v}</span>
          <span style={{ marginLeft: 'auto', opacity: .5 }}>{I.chevR}</span>
        </button>
        {alive && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setOpen(false)} />
            <div className={'dm-pop' + (out ? ' out' : '')} style={{ top: 'calc(100% + 6px)', left: 0, width: 216 }}>
              <div className="dm-pop__srch">{I.search}<input autoFocus placeholder="Search or create" value={q} onChange={e => setQ(e.target.value)} /></div>
              <div className="dm-pop__list">
                {list.map(([c, col]) => (
                  <button key={c} className={'dm-opt' + (v === c ? ' on' : '')} onClick={() => { setV(c); setOpen(false); }}>
                    <span className="chip__dot" style={{ background: col }} />
                    <span style={{ fontSize: 12.5 }}>{c}</span>
                    <span className="dm-opt__ck">{v === c ? I.check : null}</span>
                  </button>
                ))}
              </div>
              {q && !list.length && (
                <button className="dm-opt dm-opt--new" onClick={() => { setV(q); setOpen(false); }}>
                  {I.plus}<span style={{ fontSize: 12.5 }}>Create “<b>{q}</b>”</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <div className="ixhint">Type a name that doesn’t exist — create appears only then, never as dead weight.</div>
    </IxStage>
  );
}

// ── 1.9 Tab switching ──────────────────────────────────────────────────
const DTABS = [['details', 'Details', null], ['comments', 'Comments', 4], ['files', 'Files', 2], ['time', 'Time', null], ['activity', 'Activity', 9]];
function DemoTabs() {
  const [t, setT] = React.useState('comments');
  const [dir, setDir] = React.useState(1);
  const refs = React.useRef({});
  const [ind, setInd] = React.useState({ left: 0, width: 0 });
  React.useEffect(() => { const el = refs.current[t]; if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth }); }, [t]);
  const go = k => { setDir(DTABS.findIndex(x => x[0] === k) > DTABS.findIndex(x => x[0] === t) ? 1 : -1); setT(k); };
  const touch = React.useRef(0);
  return (
    <IxStage>
      <div className="dm-tabs"
        onTouchStart={e => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          const dx = e.changedTouches[0].clientX - touch.current;
          if (Math.abs(dx) < 42) return;
          const i = DTABS.findIndex(x => x[0] === t), n = dx < 0 ? i + 1 : i - 1;
          if (DTABS[n]) go(DTABS[n][0]);
        }}>
        <div className="dm-tabs__r">
          {DTABS.map(([k, l, n]) => (
            <button key={k} ref={el => { refs.current[k] = el; }} className={'dm-tab' + (t === k ? ' on' : '')} onClick={() => go(k)}>
              {l}{n != null && <span className="dm-tab__n">{n}</span>}
            </button>
          ))}
          <span className="dm-tabs__ind" style={{ left: ind.left, width: ind.width }} />
        </div>
        <div key={t} className="dm-tabs__p" style={{ '--dx': dir > 0 ? '10px' : '-10px' }}>
          <b style={{ fontSize: 12.5, textTransform: 'capitalize' }}>{t}</b>
          <div className="mute" style={{ fontSize: 11.5, marginTop: 5 }}>Panel content crossfades and slides {dir > 0 ? 'left' : 'right'} — the direction follows the tab you came from. Swipe horizontally on touch.</div>
        </div>
      </div>
    </IxStage>
  );
}

function IxSecDrawer() {
  return (
    <>
      <IxCard n="1.1" t="Open and close the drawer" trig="click row · ⏎"
        lede="The most-used interaction in the product, so it sets the vocabulary: right-anchored on desktop, bottom sheet with snap points on touch, and the same three dismissals everywhere."
        spec={{
          entry: <>Desktop: <code>translateX(28px)→0</code> + <code>opacity .3→1</code>, {num('360ms')} <code>--ease-emph</code>. Page content does not shift — the drawer floats above with a scrim.</>,
          active: <>Width <code>min(560px, 92vw)</code>, glass at <code>--glass-alpha + .1</code>, <code>--shadow-3</code>. Body scrolls; header and footer are fixed.</>,
          dismiss: <>X button · scrim click · <code>Escape</code> · swipe down past 40% on touch</>,
          exit: <><code>translateX(16px)</code> + <code>opacity→0</code>, {num('220ms')} <code>--ease-exit</code>. Faster out than in.</>,
          mobile: <>Bottom sheet, two snap points — <code>58%</code> peek and <code>94%</code> full. Grab handle taps or drags between them. Rises {num('300ms')} <code>--ease-emph-in</code>.</>,
          tokens: <><code>--r-xl</code> top corners · <code>--shadow-3</code> · <code>--scrim</code></>,
          handler: <><code>onOpenTask(id)</code> → <code>setDrawer(task)</code>; <code>onClose</code> restores focus to the triggering row.</>,
          a11y: <><code>role="dialog"</code> <code>aria-modal</code>, focus trapped, focus returns to the row on close.</>,
        }}
        today="Drawer mounts instantly with no transition, and the same right-anchored panel is used at 390px where it covers the whole screen with no handle and no snap points.">
        <DemoDrawerOpen />
      </IxCard>

      <IxCard n="1.2" t="Inline title edit" trig="click text"
        lede="Text becomes an input in place. The saved state is confirmed on the field itself rather than by a toast — a toast for every field edit is noise."
        spec={{
          entry: <>Text swaps to <code>input</code> with the same font metrics so nothing reflows. Border fades in {num('140ms')}, background lifts to <code>--s-lowest</code>, ring <code>0 0 0 3px primary/16%</code>.</>,
          active: <>Full-width input, caret at click position, text selected on <code>⌘A</code> only — not auto-selected, so a small correction does not risk the whole title.</>,
          dismiss: <><code>⏎</code> or blur saves · <code>Esc</code> reverts to the previous value</>,
          exit: <>Input→text {num('140ms')}, then the save chip: spinner → <code>✓ Saved</code> holds {num('1.1s')} → fades {num('220ms')}.</>,
          mobile: <>Same, but the keyboard's <b>Done</b> key saves. Field scrolls clear of the keyboard on focus.</>,
          tokens: <><code>--primary</code> ring · <code>--s-lowest</code> · <code>--r-sm</code></>,
          handler: <><code>onBlur/onKeyDown(Enter)</code> → <code>patchTask({'{title}'})</code>; optimistic, rolls back on 4xx.</>,
        }}
        today="Editing works but there is no visual save feedback at all — the user cannot tell whether the patch landed. An empty title is accepted and saved.">
        <DemoTitleEdit />
      </IxCard>

      <IxCard n="1.3" t="Description autosave" trig="focus · blur"
        lede="Grows with content up to a ceiling, then scrolls. Saves on blur, not on every keystroke — a debounced save on a long description means a save request every few words."
        spec={{
          entry: <>Focus: border <code>--outline-variant</code>→<code>--primary</code> {num('140ms')}, ring appears, background <code>--s-low</code>→<code>--s-lowest</code>.</>,
          active: <>Auto-height to <code>150px</code> ceiling then internal scroll. Hint line appears under the field on focus only.</>,
          dismiss: <>Blur saves · <code>⌘⏎</code> saves without leaving · <code>Esc</code> blurs and saves</>,
          exit: <>Ring fades {num('140ms')}; <code>✓ Saved</code> appears and holds {num('1.6s')}.</>,
          mobile: <>Ceiling drops to <code>96px</code> so the keyboard never covers the field.</>,
          tokens: <><code>--r-sm</code> · <code>--primary</code> · <code>--s-lowest</code></>,
          handler: <><code>onBlur</code> → <code>patchTask({'{description}'})</code>. Dirty flag blocks drawer close until resolved.</>,
        }}
        today="Fixed-height textarea with a scrollbar, saves on blur, no indicator. Closing the drawer mid-edit loses the change silently.">
        <DemoDesc />
      </IxCard>

      <IxCard n="1.4" t="Status pipeline" trig="hover · click"
        lede="The Odoo-style chevron bar already in staging, given hover intent and a real transition. Stage colour comes from the status, not from the accent, so a pipeline reads the same in every theme."
        spec={{
          entry: <>Renders with the run. On mount the completed segment sweeps left→right {num('520ms')} <code>--ease-emph</code> once, then never again.</>,
          active: <>Current stage: solid <code>STATUS_COLORS[k]</code>, white label, <code>z-index 10</code>. Past: <code>15%</code> tint plus a check. Future: <code>--s-container</code>. Arrow notch inherits its own segment's fill.</>,
          dismiss: <>n/a — always visible</>,
          exit: <>On change, the new segment fills {num('220ms')} <code>--ease-emph</code> while the old one drops to tint. No layout shift.</>,
          mobile: <>Horizontal scroll with the current stage scrolled into view; labels shorten to <code>12ch</code>.</>,
          tokens: <><code>STATUS_COLORS</code> from <code>drawer/constants.js</code> · <code>--r-pill</code> on the end caps</>,
          handler: <><code>onStageClick(value)</code> → <code>patchTask({'{status}'})</code>, optimistic with rollback.</>,
          a11y: <><code>role="group"</code>, <code>aria-current="step"</code> on the active stage.</>,
        }}
        today="Present and clickable with a 200ms transition-all, but no hover affordance, no tooltip, and no fill animation on change — the state just swaps.">
        <DemoPipeline />
      </IxCard>

      <IxCard n="1.5" t="Assignee picker" trig="click field"
        lede="Multi-select with search. Anchored to the field on desktop; a bottom sheet on touch, because a 240px popover next to a thumb is a miss-tap generator."
        spec={{
          entry: <>Popover <code>scale(.97)→1</code> + <code>opacity 0→1</code>, {num('140ms')} <code>--ease-spring</code>, origin at the anchor edge. Search auto-focused.</>,
          active: <>Width <code>246px</code>, max height <code>280px</code> then scrolls. Selected rows carry <code>--primary-container</code> and a check; hover is <code>--s-container</code>. Row height <code>36px</code> desktop, <code>48px</code> touch.</>,
          dismiss: <>Click outside · <code>Esc</code> · re-click the field. Stays open through multiple selections.</>,
          exit: <><code>scale(.98)</code> + fade, {num('120ms')} <code>--ease-exit</code>.</>,
          mobile: <>Bottom sheet with grab handle, <code>48px</code> rows, search does not auto-focus so the sheet is not covered by the keyboard on open.</>,
          tokens: <><code>--r-lg</code> · <code>--shadow-3</code> · <code>--primary-container</code></>,
          handler: <><code>onToggle(userId)</code> → <code>patchTask({'{assignee_ids}'})</code> debounced {num('400ms')} so five taps are one request.</>,
        }}
        today="staging PersonField.jsx opens a plain list with no search and no multi-select affordance; the same popover is used on mobile.">
        <DemoAssignee />
      </IxCard>

      <IxCard n="1.6" t="Priority picker" trig="click badge"
        lede="Four options, colour-dotted, instant save. The badge flashes once on change — the smallest possible confirmation, and enough."
        spec={{
          entry: <>Dropdown <code>scale(.97)→1</code> + fade {num('140ms')} <code>--ease-spring</code>.</>,
          active: <>Width <code>176px</code>. Selected row has a check and tonal fill.</>,
          dismiss: <>Selection closes it immediately · click outside · <code>Esc</code></>,
          exit: <>Fade {num('120ms')}, then the badge runs a one-shot flash: <code>primary/34%</code>→transparent over {num('500ms')} <code>--ease-exit</code>.</>,
          mobile: <>Action sheet at the bottom, <code>48px</code> rows.</>,
          tokens: <><code>PRIORITY</code> colours · <code>--r-pill</code> badge</>,
          handler: <><code>onChange(p)</code> → <code>patchTask({'{priority}'})</code>, no confirmation dialog.</>,
        }}
        today="A native select. It works, but it cannot show the colour dots that the rest of the product uses to mean priority.">
        <DemoPriority />
      </IxCard>

      <IxCard n="1.7" t="Due date and reminder" trig="click date"
        lede="One popover holds the calendar, the quick options, and the reminder. Splitting the reminder into a separate dialog is how reminders end up never being set."
        spec={{
          entry: <>Popover fades and scales {num('140ms')}; the calendar grid does not animate — a month grid that animates in is unreadable for the first frame.</>,
          active: <>Width <code>268px</code>. Today is ringed, selected is filled <code>--primary</code>. Month header is a button into a month grid; year likewise. Quick chips below the grid, reminder collapsed under a disclosure.</>,
          dismiss: <>Picking a date closes it · click outside · <code>Esc</code></>,
          exit: <>Fade + <code>scale(.98)</code>, {num('120ms')} <code>--ease-exit</code>.</>,
          mobile: <>Bottom sheet, <code>44px</code> day cells, chips wrap to two rows.</>,
          tokens: <><code>--primary</code> selection · <code>--r-sm</code> cells · <code>--s-container</code> hover</>,
          handler: <><code>onPick(iso)</code> → <code>patchTask({'{due_date}'})</code>; reminder writes <code>{'{offset, channels[]}'}</code> to the reminders table.</>,
          a11y: <>Arrow keys move by day, <code>PgUp/PgDn</code> by month, <code>aria-selected</code> on the chosen cell.</>,
        }}
        today="ReminderPicker.jsx exists as a separate component with offset and channel options; it is not reachable from the date field, so the two are set in different places.">
        <DemoDate />
      </IxCard>

      <IxCard n="1.8" t="Category picker" trig="click field"
        lede="Search doubles as create. The create row appears only when the query matches nothing, so it never competes with picking an existing category."
        spec={{
          entry: <>Same popover as 1.5 — one popover primitive, four uses.</>,
          active: <>Width <code>216px</code>. Colour dot per category. Create row is pinned at the bottom, <code>--primary</code> text, only when <code>query &amp;&amp; !matches.length</code>.</>,
          dismiss: <>Selection · click outside · <code>Esc</code></>,
          exit: <>Fade {num('120ms')}.</>,
          mobile: <>Bottom sheet; create row becomes a full-width button above the safe area.</>,
          tokens: <><code>--r-lg</code> · category colours from the org's tag palette</>,
          handler: <><code>onCreate(name)</code> → <code>POST /categories</code> then select the returned id in one step.</>,
        }}
        today="A dropdown of existing categories only. Creating one means leaving the task, going to settings, and coming back.">
        <DemoCategory />
      </IxCard>

      <IxCard n="1.9" t="Tab switching" trig="click · swipe"
        lede="The sliding indicator staging already has, plus a directional panel transition so the drawer feels like one surface rather than five stacked pages."
        spec={{
          entry: <>Indicator slides <code>left/width</code> {num('220ms')} <code>--ease-emph</code>. Panel: <code>opacity 0→1</code> + <code>translateX(±10px)→0</code> {num('220ms')}, direction follows travel.</>,
          active: <>Active label <code>--on-surface</code> with a <code>2px</code> <code>--primary</code> underline. Count badges tint to <code>--primary-container</code> when active; a badge that increments pulses once.</>,
          dismiss: <>n/a</>,
          exit: <>Outgoing panel is replaced, not cross-faded — two overlapping text blocks are worse than a clean swap at this size.</>,
          mobile: <>Horizontal swipe changes tab past a <code>42px</code> threshold. Tab strip scrolls and keeps the active tab in view.</>,
          tokens: <><code>--primary</code> indicator · <code>--primary-container</code> badge · <code>--dur-base</code></>,
          handler: <><code>onChange(tab)</code>; tab lives in the URL as <code>?tab=</code> so a link opens the right one.</>,
          a11y: <><code>role="tablist"</code>, arrow keys move between tabs, <code>aria-selected</code> tracked.</>,
        }}
        today="Tabs.jsx has the sliding indicator and count badges. Panels swap instantly with no transition and there is no swipe support.">
        <DemoTabs />
      </IxCard>
    </>
  );
}

window.IX_SECTIONS.push({ id: 'ix-drawer', n: '01', group: 'Task drawer', title: 'Drawer & fields', hi: 'कर्तव्य', src: 'TaskDrawer.jsx · drawer/*', count: 9, Comp: IxSecDrawer });
Object.assign(window, { useExit, useIxScale, IxSecDrawer, ST, ST_ORDER, PR, DEMO_TASKS, MEM });
