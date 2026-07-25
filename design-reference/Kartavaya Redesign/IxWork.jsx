// Sections 2–3 — Subtasks and Comments. Against staging drawer/DrawerSubtasks.jsx,
// drawer/DrawerComments.jsx and MentionTextarea.jsx.
const SUB0 = [
  { id: 1, t: 'Pull June ITC working from Ganit', done: true, a: 'Aanya Mehta' },
  { id: 2, t: 'Chase Shreeji Traders for HSN codes', done: false, a: 'Rohan Iyer' },
  { id: 3, t: 'Reconcile 2B against books', done: false, a: null },
];

function SubtaskDemo({ hint }) {
  const { mobile } = useIx();
  const [list, setList] = React.useState(SUB0);
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [pick, setPick] = React.useState(null);
  const [drag, setDrag] = React.useState(null);
  const [over, setOver] = React.useState(null);
  const [swipe, setSwipe] = React.useState({});
  const [gone, setGone] = React.useState([]);
  const s = useIxScale();
  const ref = React.useRef(null);
  React.useEffect(() => { if (adding) ref.current?.focus(); }, [adding]);

  const add = () => {
    if (!draft.trim()) { setAdding(false); return; }
    setList(l => [...l, { id: Date.now(), t: draft.trim(), done: false, a: null, fresh: true }]);
    setDraft('');
  };
  const del = id => { setGone(g => [...g, id]); setTimeout(() => { setList(l => l.filter(x => x.id !== id)); setGone(g => g.filter(x => x !== id)); }, 220 * s); };
  const drop = i => {
    if (drag == null || drag === i) { setDrag(null); setOver(null); return; }
    setList(l => { const c = [...l], [m] = c.splice(drag, 1); c.splice(i, 0, m); return c; });
    setDrag(null); setOver(null);
  };
  const touch = React.useRef({});

  return (
    <IxStage h={mobile ? 330 : 264} note={hint}>
      <div className="sb">
        <div className="sb__h">
          <span className="fld__l">Subtasks</span>
          <span className="sb__n mono">{list.filter(x => x.done).length}/{list.length}</span>
          <div className="meter" style={{ flex: 1, maxWidth: 90 }}><span className="meter__f" style={{ width: (list.filter(x => x.done).length / Math.max(list.length, 1)) * 100 + '%' }} /></div>
        </div>
        <div>
          {list.map((x, i) => (
            <div key={x.id} className={'sb__wrap' + (gone.includes(x.id) ? ' gone' : '') + (over === i ? ' over' : '')}
              onDragOver={e => { e.preventDefault(); setOver(i); }} onDrop={() => drop(i)}>
              <button className="sb__swdel" onClick={() => del(x.id)}>Delete</button>
              <div className={'sb__r' + (x.fresh ? ' fresh' : '') + (drag === i ? ' dragging' : '')}
                style={{ transform: swipe[x.id] ? `translateX(${swipe[x.id]}px)` : undefined }}
                draggable={!mobile} onDragStart={() => setDrag(i)} onDragEnd={() => { setDrag(null); setOver(null); }}
                onTouchStart={e => { touch.current[x.id] = e.touches[0].clientX; }}
                onTouchMove={e => { const dx = Math.min(0, e.touches[0].clientX - (touch.current[x.id] || 0)); setSwipe(p => ({ ...p, [x.id]: Math.max(dx, -84) })); }}
                onTouchEnd={() => setSwipe(p => ({ ...p, [x.id]: (p[x.id] || 0) < -46 ? -76 : 0 }))}>
                <span className="sb__grip" title="Drag to reorder">
                  <svg width="11" height="13" viewBox="0 0 12 14" fill="currentColor"><circle cx="3" cy="3" r="1.2" /><circle cx="9" cy="3" r="1.2" /><circle cx="3" cy="7" r="1.2" /><circle cx="9" cy="7" r="1.2" /><circle cx="3" cy="11" r="1.2" /><circle cx="9" cy="11" r="1.2" /></svg>
                </span>
                <button className={'sb__ck' + (x.done ? ' on' : '')} onClick={() => setList(l => l.map(y => y.id === x.id ? { ...y, done: !y.done } : y))}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M3.5 8.4l3 3 6-6.6" /></svg>
                </button>
                <span className={'sb__t' + (x.done ? ' done' : '')}>{x.t}</span>
                <span style={{ position: 'relative', marginLeft: 'auto', flexShrink: 0 }}>
                  <button className="sb__av" onClick={() => setPick(pick === x.id ? null : x.id)}>
                    {x.a ? <Av n={x.a} s={20} /> : <span className="sb__av-e">{I.plus}</span>}
                  </button>
                  {pick === x.id && (
                    <>
                      <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setPick(null)} />
                      <div className="dm-pop" style={{ top: 'calc(100% + 5px)', right: 0, left: 'auto', width: 178, transformOrigin: 'top right' }}>
                        <div className="dm-pop__list" style={{ maxHeight: 152 }}>
                          {MEM.slice(0, 4).map(m => (
                            <button key={m} className={'dm-opt' + (x.a === m ? ' on' : '')} onClick={() => { setList(l => l.map(y => y.id === x.id ? { ...y, a: y.a === m ? null : m } : y)); setPick(null); }}>
                              <Av n={m} s={19} /><span style={{ fontSize: 12 }}>{m.split(' ')[0]}</span>
                              <span className="dm-opt__ck">{x.a === m ? I.check : null}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </span>
                {!mobile && <button className="sb__del" onClick={() => del(x.id)} title="Delete subtask">{I.x}</button>}
              </div>
            </div>
          ))}
        </div>
        {adding ? (
          <div className="sb__add">
            <input ref={ref} className="sb__in" value={draft} placeholder="Subtask title, ⏎ to add"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setDraft(''); setAdding(false); } }} />
            <button className="btn btn--fill btn--sm" onClick={add}>Add</button>
          </div>
        ) : (
          <button className="sb__addb" onClick={() => setAdding(true)}>{I.plus} Add subtask</button>
        )}
      </div>
    </IxStage>
  );
}

// ── Comments ───────────────────────────────────────────────────────────
const CM0 = [
  { id: 1, who: 'Aanya Mehta', t: '2 min ago', abs: '25 Jul 2026, 09:41', txt: 'Placeholder. Both vendor invoices are missing HSN codes — flagged in Ganit.' },
  { id: 2, who: 'Rohan Iyer', t: '1 min ago', abs: '25 Jul 2026, 09:44', txt: 'Placeholder reply. @Keval Shah we can invoice on milestone completion.' },
];
function CommentDemo({ hint, h }) {
  const { mobile } = useIx();
  const [list, setList] = React.useState(CM0);
  const [v, setV] = React.useState('');
  const [foc, setFoc] = React.useState(false);
  const [men, setMen] = React.useState(null);
  const [mi, setMi] = React.useState(0);
  const [edit, setEdit] = React.useState(null);
  const [etxt, setEtxt] = React.useState('');
  const [undo, setUndo] = React.useState(null);
  const [hov, setHov] = React.useState(null);
  const [abs, setAbs] = React.useState(null);
  const s = useIxScale();
  const cand = men ? MEM.filter(m => m.toLowerCase().includes(men.toLowerCase())) : [];

  const onChange = e => {
    const val = e.target.value;
    setV(val);
    const m = val.match(/@([A-Za-z ]*)$/);
    setMen(m ? m[1] : null);
    setMi(0);
  };
  const insert = name => { setV(x => x.replace(/@([A-Za-z ]*)$/, '@' + name + ' ')); setMen(null); };
  const post = () => {
    if (!v.trim()) return;
    setList(l => [...l, { id: Date.now(), who: 'Keval Shah', t: 'now', abs: 'just now', txt: v.trim(), fresh: true }]);
    setV(''); setMen(null);
  };
  const del = id => {
    const row = list.find(x => x.id === id);
    setList(l => l.filter(x => x.id !== id));
    setUndo(row);
    setTimeout(() => setUndo(u => (u && u.id === id ? null : u)), 4000 * s);
  };

  return (
    <IxStage h={h || (mobile ? 380 : 330)} note={hint}>
      <div className="cm">
        <div className="cm__list">
          {list.map(c => (
            <div key={c.id} className={'cm__i' + (c.fresh ? ' fresh' : '')} onMouseEnter={() => setHov(c.id)} onMouseLeave={() => setHov(null)}>
              <Av n={c.who} s={26} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="cm__h">
                  <b style={{ fontSize: 12.5 }}>{c.who}</b>
                  <span className="cm__t" onMouseEnter={() => setAbs(c.id)} onMouseLeave={() => setAbs(null)}>{abs === c.id ? c.abs : c.t}</span>
                </div>
                {edit === c.id ? (
                  <div className="cm__edit">
                    <textarea className="dm-ta on" rows="2" value={etxt} onChange={e => setEtxt(e.target.value)} autoFocus />
                    <div className="rowflex" style={{ gap: 6, marginTop: 6 }}>
                      <button className="btn btn--fill btn--sm" onClick={() => { setList(l => l.map(x => x.id === c.id ? { ...x, txt: etxt, ed: true } : x)); setEdit(null); }}>Save</button>
                      <button className="btn btn--out btn--sm" onClick={() => setEdit(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="cm__b"><MTxt t={c.txt} />{c.ed && <span className="msg__ed">(edited)</span>}</div>
                )}
              </div>
              {hov === c.id && edit !== c.id && (
                <div className="cm__acts">
                  <button className="msg__act" title="React">😊</button>
                  <button className="msg__act" title="Edit" onClick={() => { setEdit(c.id); setEtxt(c.txt); }}>
                    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M13.5 3.5l3 3-9 9H4.5v-3l9-9z" /></svg>
                  </button>
                  <button className="msg__act" title="Delete" onClick={() => del(c.id)} style={{ color: 'var(--danger)' }}>{I.x}</button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className={'cm__c' + (foc ? ' on' : '')}>
          {men != null && cand.length > 0 && (
            <div className="cm__men">
              <div className="cm__men-h">People</div>
              {cand.slice(0, 4).map((m, i) => (
                <button key={m} className={'dm-opt' + (i === mi ? ' on' : '')} onClick={() => insert(m)}>
                  <Av n={m} s={19} /><span style={{ fontSize: 12 }}>{m}</span>
                </button>
              ))}
            </div>
          )}
          <textarea className="cm__in" rows={foc ? 2 : 1} placeholder="Add a comment — @ to mention" value={v}
            onChange={onChange} onFocus={() => setFoc(true)} onBlur={() => setTimeout(() => setFoc(false), 120)}
            onKeyDown={e => {
              if (men != null && cand.length) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setMi(i => Math.min(i + 1, cand.length - 1)); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setMi(i => Math.max(i - 1, 0)); return; }
                if (e.key === 'Enter') { e.preventDefault(); insert(cand[mi]); return; }
                if (e.key === 'Escape') { setMen(null); return; }
              }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(); }
            }} />
          <div className="cm__foot">
            <button className="icobtn" style={{ width: 26, height: 26 }} title="Attach">{SI.clip}</button>
            <button className="icobtn" style={{ width: 26, height: 26 }} title="Emoji">{SI.smile}</button>
            <span style={{ flex: 1 }} />
            <span className="mute" style={{ fontSize: 10 }}>⏎ send · ⇧⏎ newline</span>
            <button className="btn btn--fill btn--sm" disabled={!v.trim()} onClick={post}>{I.send}</button>
          </div>
        </div>
      </div>
      {undo && (
        <div className="cm__undo">
          {I.check} Comment deleted
          <button className="btn btn--text btn--sm" style={{ padding: '2px 6px' }} onClick={() => { setList(l => [...l, undo].sort((a, b) => a.id - b.id)); setUndo(null); }}>Undo</button>
        </div>
      )}
    </IxStage>
  );
}

function IxSecSubtasks() {
  return (
    <>
      <IxCard n="2.1" t="Add a subtask" trig="click Add · ⏎"
        lede="An inline input, not a modal. Adding five subtasks in a row should be five keystrokes of typing and five returns, with the input never losing focus."
        spec={{
          entry: <>Button is replaced by the input row: <code>max-height 0→38px</code> + fade, {num('220ms')} <code>--ease-emph</code>. Autofocus on mount.</>,
          active: <>Input stays open after each <code>⏎</code> and clears — the list grows above it. New row enters with <code>translateY(-6px)</code> + fade {num('220ms')}.</>,
          dismiss: <><code>Esc</code> · blur while empty · click elsewhere</>,
          exit: <>Row collapses <code>max-height→0</code> {num('180ms')} <code>--ease-exit</code>.</>,
          mobile: <>Same, but the row sticks above the keyboard and the <b>Add</b> button is a <code>44px</code> target.</>,
          tokens: <><code>--r-sm</code> · <code>--primary</code> focus ring · <code>--dur-base</code></>,
          handler: <><code>onAdd(title)</code> → <code>POST /tasks/:id/subtasks</code>, optimistic row with a temporary id.</>,
        }}
        today="An input that appears inline and closes after one add, so adding three subtasks means clicking Add three times.">
        <SubtaskDemo hint="Click Add subtask · type · ⏎ repeatedly — the input stays open" />
      </IxCard>

      <IxCard n="2.2" t="Complete a subtask" trig="click checkbox"
        lede="The check draws itself and the box springs. It is a 300ms detail on the most-repeated action in the drawer, which is exactly where the budget for delight belongs."
        spec={{
          entry: <>Box fills <code>--primary</code> {num('140ms')}; the tick path draws via <code>stroke-dashoffset</code> {num('220ms')} <code>--ease-emph</code>; box overshoots to <code>scale(1.18)</code> and settles, {num('300ms')} <code>--ease-spring</code>.</>,
          active: <>Title takes <code>--on-surface-3</code> and a strikethrough that wipes left→right {num('220ms')}. Counter and meter update in the same frame.</>,
          dismiss: <>n/a — it is a toggle</>,
          exit: <>Unchecking reverses in {num('140ms')} with no spring. Undo should feel plainer than do.</>,
          mobile: <>Checkbox target grows to <code>44px</code>; a light haptic fires on complete only, never on uncheck.</>,
          tokens: <><code>--primary</code> · <code>--ok</code> for the meter · <code>--ease-spring</code></>,
          handler: <><code>onToggle(subtaskId)</code> → <code>PATCH</code>; parent progress recomputed client-side first.</>,
        }}
        today="A native checkbox with an instant strikethrough. No animation, and the progress meter only updates after a refetch.">
        <SubtaskDemo hint="Tick a box — watch the tick draw and the meter move" />
      </IxCard>

      <IxCard n="2.3" t="Assign a subtask" trig="click avatar slot"
        lede="A mini picker, right-anchored, four recent people first. Subtask assignment is a glance-and-tap action, so it does not get the full search popover from 1.5."
        spec={{
          entry: <>Popover <code>scale(.97)→1</code> from <code>top right</code>, {num('140ms')} <code>--ease-spring</code>. Width <code>178px</code>, no search field.</>,
          active: <>Shows the 4 most recent collaborators on this task, then <b>Search all</b>. Selected row carries a check; clicking it again unassigns.</>,
          dismiss: <>Selection closes it · click outside · <code>Esc</code></>,
          exit: <>Fade {num('120ms')}. The avatar then cross-fades in place {num('180ms')}.</>,
          mobile: <>Bottom sheet with <code>48px</code> rows — a <code>178px</code> popover anchored to a <code>20px</code> avatar is untappable.</>,
          tokens: <><code>--r-lg</code> · <code>--shadow-3</code> · <code>--primary-container</code></>,
          handler: <><code>onAssign(subtaskId, userId | null)</code></>,
        }}
        today="Subtasks carry no assignee at all in staging — the field does not exist on the row.">
        <SubtaskDemo hint="Click an avatar slot on any row" />
      </IxCard>

      <IxCard n="2.4" t="Delete a subtask" trig="hover · swipe left"
        lede="No confirmation dialog. A subtask is cheap to retype and a dialog on every delete trains people to click through dialogs — the undo toast in 3.6 is the safety net."
        spec={{
          entry: <>Desktop: an <code>X</code> fades in at the row's right edge on hover, {num('140ms')}. Mobile: swipe reveals a <code>76px</code> danger panel underneath, tracking the finger 1:1.</>,
          active: <>Panel is <code>--danger-container</code> with <code>--danger</code> label. Release past <code>46px</code> latches it open; short of that it springs back {num('220ms')} <code>--ease-spring</code>.</>,
          dismiss: <>Tap elsewhere closes the swipe panel</>,
          exit: <>Row fades and collapses <code>max-height→0</code> together, {num('220ms')} <code>--ease-exit</code>, so the list closes the gap in one motion.</>,
          mobile: <>Swipe-left only; no hover state exists to reveal an X.</>,
          tokens: <><code>--danger</code> · <code>--danger-container</code></>,
          handler: <><code>onDelete(id)</code> → optimistic removal, <code>DELETE</code>, restore the row on failure.</>,
        }}
        today="A permanent visible X on every row, and window.confirm() before the delete.">
        <SubtaskDemo hint="Hover a row for the X — on the mobile surface, swipe a row left" />
      </IxCard>

      <IxCard n="2.5" t="Reorder subtasks" trig="drag handle"
        lede="Order is meaning in a checklist, so it has to be draggable. The lifted row keeps its full opacity — a ghosted row makes you lose track of what you are moving."
        spec={{
          entry: <>On grab the row lifts: <code>scale(1.015)</code>, <code>--shadow-2</code>, {num('140ms')}. Handle is a 6-dot grip, <code>--on-surface-faint</code>, full opacity on row hover.</>,
          active: <>A <code>2px</code> <code>--primary</code> insertion line marks the drop index. Other rows shift by the dragged row's height {num('180ms')} <code>--ease-emph</code>.</>,
          dismiss: <>Release to drop · <code>Esc</code> cancels and returns the row</>,
          exit: <>Row settles into its slot with <code>--ease-spring</code> over {num('300ms')}, then the shadow fades {num('140ms')}.</>,
          mobile: <>Long-press {num('420ms')} to pick up, with a haptic tick. Auto-scrolls when held near an edge.</>,
          tokens: <><code>--shadow-2</code> · <code>--primary</code> insertion line</>,
          handler: <><code>onReorder(fromIdx, toIdx)</code> → <code>PATCH</code> with a fractional <code>position</code> so only one row is written.</>,
          a11y: <>Handle is focusable; <code>Space</code> lifts, arrows move, <code>Space</code> drops, with a live-region announcement.</>,
        }}
        today="Subtasks render in creation order with no way to reorder them.">
        <SubtaskDemo hint="Drag a row by its grip (desktop surface)" />
      </IxCard>
    </>
  );
}

function IxSecComments() {
  return (
    <>
      <IxCard n="3.1" t="Compose and send" trig="focus · ⏎"
        lede="One line at rest, two on focus, with the toolbar only present while you are writing. A permanently expanded composer with a permanent toolbar eats the comment list it belongs to."
        spec={{
          entry: <>Focus: <code>rows 1→2</code>, border to <code>--primary</code> with a <code>3px</code> ring, toolbar row fades in {num('140ms')}.</>,
          active: <>Send button is disabled and <code>--s-container</code> while empty; it becomes <code>--primary</code> the moment there is non-whitespace text. Keyboard hint sits beside it.</>,
          dismiss: <>Blur with an empty value collapses back to one row</>,
          exit: <>On send the field clears, keeps focus, and collapses only on blur — so a second comment starts immediately.</>,
          mobile: <>Composer docks above the keyboard; <code>⏎</code> inserts a newline and an explicit send button posts, which is the opposite of desktop and correct on both.</>,
          tokens: <><code>--primary</code> · <code>--s-container</code> disabled · <code>--r-md</code></>,
          handler: <><code>onSubmit(body)</code> → <code>POST /comments</code>, optimistic append.</>,
        }}
        today="A fixed textarea with an always-enabled Send button; posting an empty comment is possible and the field does not keep focus afterwards.">
        <CommentDemo hint="Type — the send button activates. ⏎ posts, ⇧⏎ newlines." />
      </IxCard>

      <IxCard n="3.2" t="@mention" trig="type @"
        lede="The list appears above the composer, not below, because the composer sits at the bottom of a scrolling panel and a dropdown below it would open off-screen."
        spec={{
          entry: <>Panel appears above the input on the first character after <code>@</code>: <code>translateY(4px)</code> + fade {num('140ms')} <code>--ease-enter</code>.</>,
          active: <>Filters as you type on both first and last name. First row is preselected; <code>↑↓</code> moves, <code>⏎</code> or click inserts, and the row highlight is <code>--primary-container</code>.</>,
          dismiss: <><code>Esc</code> · a space with no match · deleting the <code>@</code></>,
          exit: <>Fade {num('120ms')}. The inserted mention renders as a <code>--primary</code> chip with a <code>15%</code> tint.</>,
          mobile: <>Same panel above the input, <code>44px</code> rows, positioned clear of the keyboard.</>,
          tokens: <><code>--primary</code> chip · <code>--primary-container</code> row · <code>--r-lg</code></>,
          handler: <>Stored as <code>@[Display Name](userId)</code> and rendered as a chip, so a renamed user does not break old comments. Mention fires a notification and a Sanvaad DM if the person is offline.</>,
          a11y: <><code>role="listbox"</code> with <code>aria-activedescendant</code> on the input.</>,
        }}
        today="MentionTextarea.jsx does the detection and filtering, but the dropdown is positioned below the caret and clips outside the drawer on the last comment.">
        <CommentDemo hint="Type @ then a letter — ↑↓ to move, ⏎ to insert" />
      </IxCard>

      <IxCard n="3.3" t="Comment posted" trig="after send"
        lede="It arrives from below, where the composer is, so the eye follows the motion instead of hunting for what changed."
        spec={{
          entry: <><code>translateY(8px)</code> + <code>opacity 0→1</code>, {num('300ms')} <code>--ease-emph</code>. List scrolls to the new comment in the same frame using <code>scrollTop</code>, never <code>scrollIntoView</code>.</>,
          active: <>Optimistic comment renders at <code>opacity .6</code> until the server id returns, then goes solid {num('180ms')}. Timestamp shows relative time; hovering swaps it to absolute.</>,
          dismiss: <>n/a</>,
          exit: <>A failed post keeps the bubble, tints it <code>--danger-container</code>, and offers <b>Retry</b> — it is never silently dropped.</>,
          mobile: <>Identical; the list keeps the composer pinned and scrolls under it.</>,
          tokens: <><code>--danger-container</code> failure · <code>--dur-slow</code></>,
          handler: <><code>onSuccess(serverComment)</code> replaces the temp row by temp id.</>,
        }}
        today="The list refetches after posting and re-renders from scratch, so the new comment appears with no animation and the scroll position jumps to the top.">
        <CommentDemo hint="Post one and watch it arrive · hover a timestamp for the absolute time" />
      </IxCard>

      <IxCard n="3.4" t="Hover actions, edit, delete" trig="hover · click"
        lede="Actions float over the comment's top-right rather than sitting in the row, so they never reserve space and never push the text around."
        spec={{
          entry: <>Action bar fades in on hover after {num('0ms')} — no delay, because a delay on a bar you are already reaching for reads as lag. <code>--s-lowest</code> on a <code>--shadow-2</code>, <code>1px</code> border.</>,
          active: <>Three targets at <code>26×24</code>: react, edit, delete. Delete is <code>--danger</code>. Edit swaps the body for a textarea pre-filled and focused, with Save and Cancel beneath.</>,
          dismiss: <>Mouse leaves · <code>Esc</code> cancels an edit and restores the original text</>,
          exit: <>Bar fades {num('120ms')}. Saving cross-fades textarea→text {num('180ms')} and appends <code>(edited)</code>.</>,
          mobile: <>Long-press {num('420ms')} opens an action sheet — hover does not exist, and permanently visible icons on every comment is clutter.</>,
          tokens: <><code>--shadow-2</code> · <code>--danger</code> · <code>--s-lowest</code></>,
          handler: <><code>onEdit(id, body)</code> → <code>PATCH</code>; <code>is_edited</code> drives the label.</>,
        }}
        today="Edit and delete are always-visible text links under every comment, and delete goes through window.confirm().">
        <CommentDemo hint="Hover a comment · edit it · delete one to see 3.6" h={360} />
      </IxCard>

      <IxCard n="3.5" t="Delete with undo" trig="click delete"
        lede="Destructive-but-cheap actions get an undo, not a confirmation. The dialog interrupts everyone to protect the rare mistake; the toast interrupts no one and still fixes it."
        spec={{
          entry: <>Comment collapses and fades {num('220ms')} <code>--ease-exit</code>; the toast rises from the bottom of the panel <code>translateY(10px)</code> + fade {num('220ms')}.</>,
          active: <>Toast holds {num('4s')}, pauses on hover, and carries a single <b>Undo</b> action. Only one delete toast exists at a time — a second delete replaces the first and commits it.</>,
          dismiss: <>Undo restores in place · timeout commits the delete · explicit close commits</>,
          exit: <>Toast fades {num('180ms')}. Undo re-inserts the comment at its original index with a {num('220ms')} highlight sweep.</>,
          mobile: <>Toast is full-width above the bottom nav, inside the safe area.</>,
          tokens: <><code>--s-container</code> toast · <code>--primary</code> undo · <code>--shadow-3</code></>,
          handler: <><code>DELETE</code> is deferred until the toast expires, so undo is a client-side revert and costs no request.</>,
        }}
        today="No undo anywhere in the product. Every destructive action is guarded by a confirm dialog instead, including ones as small as removing a comment.">
        <CommentDemo hint="Hover a comment, delete it, then hit Undo" h={360} />
      </IxCard>
    </>
  );
}

window.IX_SECTIONS.push(
  { id: 'ix-subtasks', n: '02', group: 'Task drawer', title: 'Subtasks', hi: 'उपकार्य', src: 'drawer/DrawerSubtasks.jsx', count: 5, Comp: IxSecSubtasks },
  { id: 'ix-comments', n: '03', group: 'Task drawer', title: 'Comments', hi: 'टिप्पणी', src: 'drawer/DrawerComments.jsx · MentionTextarea.jsx', count: 5, Comp: IxSecComments },
);
Object.assign(window, { SubtaskDemo, CommentDemo, IxSecSubtasks, IxSecComments });
