// Sections 11–12 — Sanvaad interactions and global patterns.
const CH_MSGS = [
  { id: 'c1', day: 'Today · आज' },
  { id: 'c2', who: 'Aanya Mehta', t: '09:12', txt: 'June ITC working is up. Two vendor invoices are missing HSN codes.', rx: [['👍', 2, false]], replies: 3 },
  { id: 'c3', who: 'Rohan Iyer', t: '09:31', txt: 'Chased Shreeji — they re-issue by Monday. Placeholder.' },
  { id: 'c4', who: 'Keval Shah', me: true, t: '09:38', txt: 'Placeholder reply from me.', seen: ['Aanya Mehta', 'Rohan Iyer'] },
];
const QUICK = ['👍', '❤️', '😂', '😮', '🙏'];
const EMOJI_CATS = [
  ['Recent', ['👍', '🙏', '✅', '🔥', '👀', '😂']],
  ['Smileys', ['😀', '😄', '😅', '😂', '🙂', '😉', '😍', '🤔', '😐', '😴', '😮', '😢']],
  ['Gestures', ['👍', '👎', '👏', '🙏', '💪', '👌', '✌️', '🤝', '👋', '☝️']],
  ['Objects', ['✅', '❌', '🔥', '⭐', '📌', '📎', '📈', '💰', '📄', '⏰']],
];

function ChatDemo({ hint, h, focus }) {
  const { mobile } = useIx();
  const [msgs, setMsgs] = React.useState(CH_MSGS);
  const [v, setV] = React.useState('');
  const [rx, setRx] = React.useState({ c2: [['👍', 2, false]] });
  const [bar, setBar] = React.useState(null);
  const [pick, setPick] = React.useState(null);
  const [cat, setCat] = React.useState('Recent');
  const [who, setWho] = React.useState(null);
  const [thread, setThread] = React.useState(null);
  const [quote, setQuote] = React.useState(null);
  const [edit, setEdit] = React.useState(null);
  const [etxt, setEtxt] = React.useState('');
  const [typing, setTyping] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [ch, setCh] = React.useState('gst');
  const [unread, setUnread] = React.useState(0);
  const [search, setSearch] = React.useState(null);
  const [hit, setHit] = React.useState(0);
  const s = useIxScale();
  const log = React.useRef(null);

  const tog = (id, e) => setRx(p => {
    const l = (p[id] || []).map(r => [...r]);
    const i = l.findIndex(r => r[0] === e);
    if (i < 0) l.push([e, 1, true]);
    else { l[i][2] = !l[i][2]; l[i][1] += l[i][2] ? 1 : -1; if (l[i][1] <= 0) l.splice(i, 1); }
    return { ...p, [id]: l };
  });
  const send = () => {
    if (!v.trim()) return;
    const id = 'n' + Date.now();
    setMsgs(m => [...m, { id, who: 'Keval Shah', me: true, t: 'now', txt: v.trim(), quote: quote ? { who: quote.who, txt: quote.txt } : null, sending: true }]);
    setV(''); setQuote(null);
    setTimeout(() => setMsgs(m => m.map(x => x.id === id ? { ...x, sending: false, seen: ['Aanya Mehta'] } : x)), 700 * s);
    setTimeout(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, 40);
  };
  const swap = k => { setCh(k); setLoading(true); setUnread(0); setTimeout(() => setLoading(false), 620 * s); };
  const matches = search ? msgs.filter(m => m.txt && m.txt.toLowerCase().includes(search.toLowerCase())) : [];

  return (
    <IxStage h={h || (mobile ? 400 : 348)} note={hint}>
      <div className={'cd' + (thread ? ' cd--thr' : '')}>
        <div className="cd__side">
          {[['gst', 'कर-विवरणी', 'gst-filing', 4], ['general', 'सामान्य', 'general', 0], ['mumbai', 'मुंबई', 'tata-mumbai', unread]].map(([k, hi, en, n]) => (
            <button key={k} className={'cd__ch' + (ch === k ? ' on' : '')} onClick={() => swap(k)}>
              <span style={{ opacity: .5 }}>{SI.hash}</span>
              <span className={'cd__ch-l' + (n ? ' bold' : '')}><span className="hi">{hi}</span><i>{en}</i></span>
              {n > 0 && <span className="cd__ch-n">{n}</span>}
            </button>
          ))}
          <button className="cd__ch cd__ch--mock" onClick={() => setUnread(u => u + 1)}>{I.plus} Simulate a new message</button>
        </div>
        <div className="cd__main">
          <div className="cd__head">
            {search == null ? (
              <>
                <b className="hi" style={{ fontSize: 14, color: 'var(--primary-text)' }}>{ch === 'gst' ? 'कर-विवरणी' : ch === 'general' ? 'सामान्य' : 'मुंबई'}</b>
                <span className="mute" style={{ fontSize: 11 }}>4 members</span>
                <span style={{ flex: 1 }} />
                <button className="icobtn" style={{ width: 26, height: 26 }} onClick={() => { setSearch(''); setHit(0); }}>{I.search}</button>
              </>
            ) : (
              <div className="cd__search">
                {I.search}
                <input autoFocus value={search} onChange={e => { setSearch(e.target.value); setHit(0); }} placeholder="Search this channel" />
                {search && <span className="mono" style={{ fontSize: 10.5 }}>{matches.length ? hit + 1 + '/' + matches.length : '0'}</span>}
                <button className="icobtn" style={{ width: 22, height: 22 }} onClick={() => setHit(x => Math.max(0, x - 1))}>{I.chevL}</button>
                <button className="icobtn" style={{ width: 22, height: 22 }} onClick={() => setHit(x => Math.min(matches.length - 1, x + 1))}>{I.chevR}</button>
                <button className="icobtn" style={{ width: 22, height: 22 }} onClick={() => setSearch(null)}>{I.x}</button>
              </div>
            )}
          </div>
          <div className="cd__log" ref={log}>
            {loading ? (
              <div className="cd__sk">
                {[0, 1, 2].map(i => (
                  <div key={i} className="cd__skr">
                    <Sk w={26} h={26} circle />
                    <span style={{ flex: 1 }}><Sk w={i === 1 ? '52%' : '38%'} h={9} /><span style={{ display: 'block', height: 5 }} /><Sk w={i === 1 ? '86%' : '68%'} h={9} /></span>
                  </div>
                ))}
              </div>
            ) : msgs.map(m => {
              if (m.day) return <div key={m.id} className="mdiv"><span>{m.day}</span></div>;
              const isHit = search && matches[hit] && matches[hit].id === m.id;
              return (
                <div key={m.id} className={'cd__m' + (m.me ? ' me' : '') + (m.sending ? ' sending' : '') + (isHit ? ' hit' : '')}
                  onMouseEnter={() => setBar(m.id)} onMouseLeave={() => setBar(null)}>
                  {!m.me && <Av n={m.who} s={26} />}
                  <div className="cd__b">
                    {!m.me && <div className="cd__mh"><b>{m.who}</b><span className="mono">{m.t}</span></div>}
                    {m.quote && <div className="cd__quote"><b>{m.quote.who}</b><span>{m.quote.txt}</span></div>}
                    {edit === m.id ? (
                      <div>
                        <textarea className="dm-ta on" rows="2" value={etxt} onChange={e => setEtxt(e.target.value)} autoFocus />
                        <div className="rowflex" style={{ gap: 6, marginTop: 6 }}>
                          <button className="btn btn--fill btn--sm" onClick={() => { setMsgs(x => x.map(y => y.id === m.id ? { ...y, txt: etxt, ed: true } : y)); setEdit(null); }}>Save</button>
                          <button className="btn btn--out btn--sm" onClick={() => setEdit(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="cd__txt">{m.txt}{m.ed && <span className="msg__ed">(edited)</span>}</div>
                    )}
                    {(rx[m.id] || []).length > 0 && (
                      <div className="rx">
                        {rx[m.id].map(([e, n, mine]) => (
                          <span key={e} style={{ position: 'relative' }} onMouseEnter={() => setWho(m.id + e)} onMouseLeave={() => setWho(null)}>
                            <button className={'rx__b' + (mine ? ' on' : '')} onClick={() => tog(m.id, e)}><span>{e}</span><span className="rx__n">{n}</span></button>
                            {who === m.id + e && <span className="cd__whotip">{mine ? 'You' : 'Aanya Mehta'}{n > 1 ? ' and ' + (n - 1) + ' more' : ''} reacted with {e}</span>}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.replies > 0 && (
                      <button className="thrl" onClick={() => setThread(m)}>
                        <Avs list={['Keval Shah', 'Rohan Iyer', 'Aanya Mehta']} max={3} s={17} />
                        <span className="thrl__n">{m.replies} replies</span>
                        <span className="thrl__t">Last 2h ago</span>
                      </button>
                    )}
                    {m.seen && <div className="seen">{SI.eye} Seen by {m.seen[0].split(' ')[0]}{m.seen.length > 1 ? ' +' + (m.seen.length - 1) : ''}</div>}
                    {m.sending && <div className="cd__sending">Sending…</div>}
                  </div>
                  {m.me && <Av n={m.who} s={26} />}
                  {bar === m.id && edit !== m.id && (
                    <div className="cd__bar">
                      {QUICK.map(e => <button key={e} className="msg__act" onClick={() => tog(m.id, e)}>{e}</button>)}
                      <button className="msg__act" title="More emoji" onClick={() => { setPick(m.id); setCat('Recent'); }}>{SI.smile}</button>
                      <span className="cd__bar-sep" />
                      <button className="msg__act" title="Reply in thread" onClick={() => setThread(m)}>{SI.thread}</button>
                      <button className="msg__act" title="Quote reply" onClick={() => setQuote(m)}>{I.chevL}</button>
                      {m.me && <button className="msg__act" title="Edit" onClick={() => { setEdit(m.id); setEtxt(m.txt); }}>
                        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M13.5 3.5l3 3-9 9H4.5v-3l9-9z" /></svg></button>}
                      {m.me && <button className="msg__act" style={{ color: 'var(--danger)' }} title="Delete"
                        onClick={() => setMsgs(x => x.map(y => y.id === m.id ? { id: y.id, deleted: true, who: y.who, t: y.t } : y))}>{I.x}</button>}
                    </div>
                  )}
                  {pick === m.id && (
                    <>
                      <div style={{ position: 'fixed', inset: 0, zIndex: 24 }} onClick={() => setPick(null)} />
                      <div className="cd__pick">
                        <div className="cd__pick-c">
                          {EMOJI_CATS.map(([c]) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
                        </div>
                        <div className="cd__pick-g">
                          {(EMOJI_CATS.find(c => c[0] === cat) || EMOJI_CATS[0])[1].map(e => (
                            <button key={e} onClick={() => { tog(m.id, e); setPick(null); }}>{e}</button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {!loading && msgs.some(m => m.deleted) && <div className="msg__tomb" style={{ paddingLeft: 2 }}>{SI.file} Message deleted</div>}
            {typing && !loading && <div className="cd__typing"><span className="typing"><i /><i /><i /></span> Rohan and Aanya are typing…</div>}
          </div>
          {unread > 0 && <button className="cd__jump" onClick={() => { setUnread(0); if (log.current) log.current.scrollTop = log.current.scrollHeight; }}>{unread} new message{unread > 1 ? 's' : ''} ↓</button>}
          <div className="cd__comp">
            {quote && (
              <div className="cd__qbar">
                <span style={{ minWidth: 0 }}><b>Replying to {quote.who}</b><span>{quote.txt}</span></span>
                <button className="icobtn" style={{ width: 22, height: 22 }} onClick={() => setQuote(null)}>{I.x}</button>
              </div>
            )}
            <div className="rowflex" style={{ gap: 7, padding: '7px 8px' }}>
              <button className="icobtn" style={{ width: 28, height: 28 }}>{SI.clip}</button>
              <textarea className="cd__in" rows="1" value={v} placeholder="Message #gst-filing"
                onChange={e => { setV(e.target.value); setTyping(false); }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <button className="icobtn" style={{ width: 28, height: 28 }}>{SI.smile}</button>
              <button className="btn btn--fill btn--sm" disabled={!v.trim()} onClick={send} style={{ padding: '6px 10px' }}>{I.send}</button>
            </div>
          </div>
        </div>
        {thread && (
          <div className="thr">
            <div className="thr__head"><b style={{ fontSize: 12.5 }}>Thread</b><span className="hi mute" style={{ fontSize: 11.5 }}>सूत्र</span>
              <button className="icobtn" style={{ marginLeft: 'auto', width: 24, height: 24 }} onClick={() => setThread(null)}>{I.x}</button></div>
            <div className="thr__body">
              <div className="cd__m"><Av n={thread.who} s={26} /><div className="cd__b"><div className="cd__mh"><b>{thread.who}</b></div><div className="cd__txt">{thread.txt}</div></div></div>
              <div className="thr__count">3 replies</div>
              {[['Keval Shah', 'Which two vendors?'], ['Rohan Iyer', 'Shreeji and Kohinoor. Placeholder.'], ['Aanya Mehta', 'Rows 14 and 27 on the sheet.']].map(([w, t2]) => (
                <div key={w + t2} className="cd__m"><Av n={w} s={26} /><div className="cd__b"><div className="cd__mh"><b>{w}</b></div><div className="cd__txt">{t2}</div></div></div>
              ))}
            </div>
            <div className="thr__foot">
              <textarea className="cd__in" rows="1" placeholder="Reply in thread…" />
              <label className="rowflex" style={{ gap: 6, fontSize: 11 }}><input type="checkbox" /> Also send to channel</label>
            </div>
          </div>
        )}
      </div>
    </IxStage>
  );
}

// ── Global ─────────────────────────────────────────────────────────────
const NOTIFS = [
  [true, 'Aanya Mehta approved the July payroll run', 'वेतन Vetana', '4 min', 'check'],
  [true, 'Rohan Iyer mentioned you in #gst-filing', 'संवाद Sanvaad', '18 min', 'chat'],
  [false, 'INV-2607 is 12 days overdue', 'गणित Ganit', '2 h', 'fin'],
  [false, '3 regularisation requests need a manager', 'पहचान Pahchan', 'Yesterday', 'clock'],
];
function GlobalDemo({ mode, hint }) {
  const { mobile } = useIx();
  const [view, setView] = React.useState('dash');
  const [busy, setBusy] = React.useState(false);
  const [bell, setBell] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  const [kbd, setKbd] = React.useState(false);
  const [err, setErr] = React.useState(mode === 'error' ? 'offline' : null);
  const [saving, setSaving] = React.useState(false);
  const s = useIxScale();
  const go = k => { if (k === view) return; setBusy(true); setView(k); setTimeout(() => setBusy(false), 520 * s); };
  const NAV = [['dash', 'मुख्य', 'dash'], ['tasks', 'कर्तव्य', 'task'], ['ganit', 'गणित', 'fin']];

  return (
    <IxStage h={mode === 'error' ? 330 : 356} note={hint}>
      <div className="gd">
        <div className="gd__side">
          {NAV.map(([k, hi, ic]) => (
            <button key={k} className={'gd__i' + (view === k ? ' on' : '')} onClick={() => go(k)}>{I[ic]}<span className="hi">{hi}</span></button>
          ))}
          <span style={{ flex: 1 }} />
          <div style={{ position: 'relative' }}>
            <button className={'gd__i' + (menu ? ' on' : '')} onClick={() => setMenu(!menu)}><Av n="Keval Shah" s={22} /></button>
            {menu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setMenu(false)} />
                <div className="ov-menu" style={{ bottom: 0, top: 'auto', left: 'calc(100% + 6px)', right: 'auto', minWidth: 196, transformOrigin: 'bottom left' }}>
                  <div className="gd__me"><Av n="Keval Shah" s={30} /><span><b>Keval Shah</b><i>Owner · Aekam Inc</i></span></div>
                  <div className="ov-menu__sep" />
                  {[['My profile', 'hr'], ['Customization', 'gear'], ['Organisation', 'hub'], ['Billing', 'fin']].map(([l, ic]) => (
                    <button key={l} className="ov-menu__i" onClick={() => setMenu(false)}><span className="ov-menu__ic">{I[ic]}</span>{l}</button>
                  ))}
                  <div className="ov-menu__sep" />
                  <button className="ov-menu__i danger"><span className="ov-menu__ic">{I.chevL}</span>Sign out</button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="gd__main">
          <div className="gd__bar">
            <span className="gd__crumb"><span className="hi">{NAV.find(n => n[0] === view)[1]}</span></span>
            <span style={{ flex: 1 }} />
            <button className="icobtn" style={{ width: 28, height: 28 }} onClick={() => setKbd(true)}><kbd className="kbd" style={{ background: 'none', padding: 0 }}>?</kbd></button>
            <div style={{ position: 'relative' }}>
              <button className={'icobtn' + (bell ? ' on' : '')} style={{ width: 28, height: 28 }} onClick={() => setBell(!bell)}>{I.bell}<span className="icobtn__dot" /></button>
              {bell && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setBell(false)} />
                  <div className={mobile ? 'gd__bellm' : 'gd__bell'}>
                    <div className="gd__bell-h"><b>Notifications</b><button className="btn btn--text btn--sm" style={{ padding: '2px 5px', fontSize: 11 }}>Mark all read</button></div>
                    <div className="gd__bell-l">
                      {NOTIFS.map(([un, t, mod, when, ic], i) => (
                        <button key={i} className={'gd__n' + (un ? ' un' : '')}>
                          <span className="gd__n-ic">{I[ic]}</span>
                          <span style={{ minWidth: 0, flex: 1 }}><b>{t}</b><span>{mod} · {when}</span></span>
                          {un && <span className="gd__n-d" />}
                        </button>
                      ))}
                    </div>
                    <div className="gd__bell-f"><button className="btn btn--text btn--sm">Open notification centre</button></div>
                  </div>
                </>
              )}
            </div>
            <button className="btn btn--fill btn--sm" disabled={saving} style={{ padding: '5px 11px' }}
              onClick={() => { setSaving(true); setTimeout(() => setSaving(false), 1100 * s); }}>
              {saving ? <><span className="au-spin" style={{ width: 12, height: 12 }} /> Saving</> : 'Save'}
            </button>
          </div>
          {err === 'offline' && <div className="gd__banner">{SI.alert}<span><b>You’re offline.</b> Changes are saved on this device and sync when you reconnect.</span><button className="btn btn--text btn--sm" style={{ padding: '2px 6px', fontSize: 11.5 }} onClick={() => setErr(null)}>Dismiss</button></div>}
          <div className="gd__body">
            {mode === 'error' ? (
              <div className="gd__errs">
                <div className="chips" style={{ marginBottom: 12 }}>
                  {[['offline', 'Offline'], ['expired', 'Session expired'], ['api', 'API error'], ['404', 'Not found'], [null, 'Clear']].map(([k, l]) => (
                    <button key={l} className={'chip' + (err === k ? ' on' : '')} style={{ fontSize: 11.5 }} onClick={() => setErr(k)}>{l}</button>
                  ))}
                </div>
                {err === 'expired' && (
                  <div className="gd__mid">
                    <span className="dnybox__ic">{SI.lock}</span>
                    <b style={{ fontSize: 14 }}>Your session expired</b>
                    <span className="mute" style={{ fontSize: 12.5, maxWidth: '38ch', textWrap: 'pretty' }}>You were idle for over an hour. Nothing you typed was lost — it is held on this device and re-submits after you sign in.</span>
                    <button className="btn btn--fill btn--sm" style={{ marginTop: 4 }}>Sign in again</button>
                  </div>
                )}
                {err === 'api' && (
                  <div className="ov-toasts" style={{ position: 'static', width: '100%' }}>
                    <div className="ov-toast" style={{ '--c': 'var(--danger)' }}>
                      <span className="ov-toast__ic">{SI.alert}</span>
                      <span style={{ minWidth: 0, flex: 1 }}><b style={{ fontSize: 12.5, display: 'block' }}>Couldn’t save the invoice</b><span className="mute" style={{ fontSize: 11 }}>Server returned 502 · your draft is intact</span></span>
                      <button className="btn btn--out btn--sm" style={{ padding: '2px 8px', fontSize: 11.5 }}>Retry</button>
                    </div>
                  </div>
                )}
                {err === '404' && (
                  <div className="gd__mid">
                    <span className="dnybox__ic mono" style={{ fontSize: 13 }}>404</span>
                    <b style={{ fontSize: 14 }}>That page doesn’t exist</b>
                    <span className="mute" style={{ fontSize: 12.5, maxWidth: '36ch' }}>The link may be old, or the record was deleted. Nothing is broken.</span>
                    <div className="rowflex" style={{ gap: 7, marginTop: 4 }}><button className="btn btn--fill btn--sm">Go to dashboard</button><button className="btn btn--out btn--sm">Search instead</button></div>
                  </div>
                )}
                {!err && <div className="gd__mid"><span className="mute" style={{ fontSize: 12.5 }}>Pick a state above.</span></div>}
              </div>
            ) : busy ? (
              <div className="gd__sk">
                {view === 'dash' && <><div className="gd__skrow">{[0, 1, 2, 3].map(i => <Sk key={i} w="100%" h={62} r="var(--r-md)" />)}</div><Sk w="100%" h={92} r="var(--r-md)" /><Sk w="72%" h={92} r="var(--r-md)" /></>}
                {view === 'tasks' && [0, 1, 2, 3, 4].map(i => <Sk key={i} w="100%" h={34} r="var(--r-sm)" />)}
                {view === 'ganit' && <><div className="gd__skrow">{[0, 1, 2].map(i => <Sk key={i} w="100%" h={54} r="var(--r-md)" />)}</div>{[0, 1, 2, 3].map(i => <Sk key={i} w="100%" h={30} r="var(--r-sm)" />)}</>}
              </div>
            ) : (
              <div className="gd__page" key={view}>
                {view === 'dash' && <div className="stats" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}><Stat lbl="Outstanding" v="₹18.4 L" kind="warn" /><Stat lbl="This month" v="₹42.1 L" trend={12} kind="ok" /></div>}
                {view === 'tasks' && TASKS.slice(0, 4).map(t => <div key={t.id} className="ixrow"><span className="pdot" style={{ background: PRIO[t.p] }} /><span className="ixrow__t">{t.t}</span></div>)}
                {view === 'ganit' && INVOICES.slice(0, 4).map(v => <div key={v.id} className="ixrow"><span className="tbl__id">{v.id}</span><span className="ixrow__t">{v.co}</span><span className="mono" style={{ marginLeft: 'auto', fontSize: 11.5 }}>{inr(v.amt)}</span></div>)}
              </div>
            )}
          </div>
        </div>
        {kbd && (
          <>
            <div className="ov-scrim" onClick={() => setKbd(false)} />
            <div className="ov-modal" style={{ width: 'min(430px, 92%)' }}>
              <div className="ov-modal__h"><b style={{ fontSize: 13.5 }}>Keyboard shortcuts</b><span className="hi mute" style={{ fontSize: 12 }}>कुंजी</span><button className="icobtn" style={{ marginLeft: 'auto', width: 26, height: 26 }} onClick={() => setKbd(false)}>{I.x}</button></div>
              <div className="ov-modal__b">
                {[['Anywhere', [['⌘K', 'Command palette'], ['?', 'This sheet'], ['Esc', 'Close, then step back']]],
                  ['Go to', [['G then D', 'Dashboard'], ['G then I', 'गणित Finance'], ['G then S', 'संवाद Messaging']]],
                  ['Create', [['N', 'New task'], ['⌥C', 'Inline create'], ['⌘⏎', 'Save and close']]]].map(([g, rows]) => (
                  <div key={g} style={{ marginBottom: 13 }}>
                    <div className="gd__kg">{g}</div>
                    {rows.map(([k, l]) => <div key={k} className="gd__kr"><kbd className="kbd">{k}</kbd><span>{l}</span></div>)}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </IxStage>
  );
}

function IxSecChat() {
  return (
    <>
      <IxCard n="11.1" t="Send, and reply with a quote" trig="⏎ · quote"
        lede="Two reply shapes, and they are not interchangeable: a quote keeps the answer in the channel, a thread moves it out. Offering only one is how channels either fragment or become unreadable."
        spec={{
          entry: <>Send button is <code>--s-container</code> while empty and <code>--primary</code> the moment there is non-whitespace. Message enters at <code>opacity .6</code> with <code>Sending…</code> beneath it.</>,
          active: <>On acknowledgement it goes solid {num('180ms')} and <code>Sending…</code> is replaced by the read receipt. Quote bar sits above the composer with the original author and a truncated line, dismissable with <code>×</code>.</>,
          dismiss: <><code>⏎</code> sends · <code>⇧⏎</code> newlines · <code>Esc</code> clears the quote</>,
          exit: <>Log scrolls with <code>scrollTop = scrollHeight</code>, never <code>scrollIntoView</code>.</>,
          mobile: <><code>⏎</code> newlines and the send button posts — the reverse of desktop, and correct on both.</>,
          tokens: <><code>--primary</code> send · <code>--s-container</code> disabled</>,
          handler: <><code>parent_message_id</code> for threads, <code>metadata.quote_of</code> for quotes. Two fields, two behaviours.</>,
        }}
        today="Sanvaad sends messages with no optimistic state, so a slow network looks like a lost message. There is no quote reply at all.">
        <ChatDemo hint="Type and press ⏎ · hover a message and use the quote arrow" />
      </IxCard>

      <IxCard n="11.2" t="Reactions" trig="hover · long-press"
        lede="Five quick emoji cover almost everything. The full picker is one more click for the rest, and a count tells you who without opening anything."
        spec={{
          entry: <>Hover bar appears above the message's top-right on a <code>--shadow-2</code>, no delay. Five quick emoji, then a picker button, a separator, and the message actions.</>,
          active: <>Adding a reaction pops the pill from <code>scale(.8)</code> over {num('220ms')} <code>--ease-spring</code>. Your own reactions are <code>--primary-container</code>; hovering a pill names the reactors.</>,
          dismiss: <>Clicking your own reaction removes it · picker closes on outside click or <code>Esc</code></>,
          exit: <>Removing the last reactor collapses the pill and the row reflows {num('180ms')}.</>,
          mobile: <>Long-press {num('420ms')} opens the quick set plus picker as a bottom sheet — there is no hover to reveal a bar.</>,
          tokens: <><code>--primary-container</code> own reaction · <code>--shadow-2</code> bar</>,
          handler: <><code>samvada_message_reactions</code> is unique on (message, user, emoji), so the toggle is an upsert/delete rather than a counter.</>,
        }}
        today="No reactions exist, so acknowledgement is a message saying “ok”, which is what makes channels noisy.">
        <ChatDemo hint="Hover a message · try the quick emoji and the picker" />
      </IxCard>

      <IxCard n="11.3" t="Threads" trig="click reply count"
        lede="The flexpane, per the Slack finding in the research. The reply count is the affordance — an inline thread makes the channel unreadable at any real volume."
        spec={{
          entry: <>Pane slides in from the right, <code>324px</code>, {num('300ms')} <code>--ease-emph</code>. The log narrows rather than being covered, so you keep your place in the channel.</>,
          active: <>Parent at the top, a reply count divider, then children. The composer carries <b>Also send to channel</b>, unticked by default.</>,
          dismiss: <><code>×</code> · <code>Esc</code> · opening another thread swaps the content without closing</>,
          exit: <>Slides out {num('220ms')} <code>--ease-exit</code> and the log widens back.</>,
          mobile: <>Full-screen push with a back arrow — a 324px pane on a phone leaves nothing for either side.</>,
          tokens: <><code>--s-lowest</code> pane · <code>--primary</code> reply count</>,
          handler: <>Reply count and last-reply time come from an aggregate on the parent, not by counting children client-side.</>,
        }}
        today="Threads exist in the schema via parent_message_id but there is no thread UI, so replies land inline and out of order.">
        <ChatDemo hint="Press “3 replies” on the first message" />
      </IxCard>

      <IxCard n="11.4" t="Channel switch and unread" trig="click a channel"
        lede="Skeletons, not a spinner — the shape of what is coming is more reassuring than a rotating circle, and it prevents the layout jumping when content lands."
        spec={{
          entry: <>Three skeleton rows at the log's natural metrics, shimmer {num('1.7s')}. Content replaces them with no fade — a crossfade between skeleton and text reads as a flicker.</>,
          active: <>Unread channels are bold with a count; mentions are <code>--danger</code>. Opening a channel clears its count immediately and optimistically.</>,
          dismiss: <>n/a</>,
          exit: <>New messages arriving while scrolled up raise a <b>n new messages ↓</b> pill above the composer rather than yanking the scroll.</>,
          mobile: <>Channel list is a sheet; switching returns to the log directly.</>,
          tokens: <><code>--danger</code> mention badge · <code>--s-container</code> skeleton</>,
          handler: <><code>last_read_at</code> per member drives the count. Mark read on render, debounced {num('600ms')}, so scrolling past does not clear a channel you did not read.</>,
        }}
        today="Channel switching shows an empty log until the fetch resolves, and unread counts only refresh on a full reload.">
        <ChatDemo hint="Switch channels · press “Simulate a new message” then the jump pill" />
      </IxCard>

      <IxCard n="11.5" t="Typing, editing, deleting, searching" trig="various"
        lede="The small mechanics. Each is cheap on its own and together they are the difference between a chat that feels alive and one that feels like a form."
        spec={{
          entry: <>Typing: animated dots plus names, appearing under the last message. Search expands in the header rather than opening a page.</>,
          active: <>Typing clears after {num('3s')} of silence and collapses when the person sends. Search highlights matches in place with a <code>--warn</code> tint and steps between them with the arrows and a counter. Editing swaps the bubble for a textarea in place.</>,
          dismiss: <><code>Esc</code> closes search and restores scroll · <code>Esc</code> cancels an edit</>,
          exit: <>An edited message keeps <code>(edited)</code> permanently. A deleted one leaves a tombstone in position — removing the row entirely makes the conversation above it stop making sense.</>,
          mobile: <>Search becomes a full-width field replacing the header; typing indicator truncates to a count past two people.</>,
          tokens: <><code>--warn</code> search hit · <code>--on-surface-faint</code> tombstone</>,
          handler: <>Typing is a throttled realtime broadcast, never persisted. <code>is_edited</code> and <code>is_deleted</code> already exist in migration 058.</>,
        }}
        today="No typing indicator, no in-channel search, and a deleted message disappears without a tombstone.">
        <ChatDemo hint="Press the search icon and type “HSN” · edit or delete your own message" h={378} />
      </IxCard>
    </>
  );
}

function IxSecGlobal() {
  return (
    <>
      <IxCard n="12.1" t="Page transitions and skeletons" trig="click nav"
        lede="Every page type has its own skeleton shaped like its real content. A generic three-bar skeleton on a kanban board tells you nothing and moves everything when the data lands."
        spec={{
          entry: <>Nav marks active immediately — never after the fetch. The skeleton for that page type renders within a frame, shimmer {num('1.7s')} <code>--ease-standard</code>.</>,
          active: <>Dashboard: four stat blocks then two panels. Table: five rows at <code>34px</code>. Finance: three stats then rows. Each matches its real geometry so nothing shifts on arrival.</>,
          dismiss: <>n/a</>,
          exit: <>Content replaces the skeleton with <code>opacity 0→1</code> + <code>translateY(4px)</code>, {num('220ms')}. No slide — a page that slides on every nav click gets tiring by the tenth.</>,
          mobile: <>Same, plus pull-to-refresh with the standard spinner at the top of scrollable lists.</>,
          tokens: <><code>--s-container</code> skeleton · <code>--dur-base</code></>,
          handler: <>Prefetch on nav hover. Keep the previous page mounted until the new one is ready if the fetch resolves under {num('120ms')} — a skeleton that flashes is worse than none.</>,
        }}
        today="PageLoader.jsx is one centred spinner for every route, so every navigation is a blank screen with a circle.">
        <GlobalDemo hint="Click between the three nav items" />
      </IxCard>

      <IxCard n="12.2" t="Notifications and the user menu" trig="click bell · avatar"
        lede="A panel, not a page. Unread first with a marker, read below at lower contrast, and every row goes straight to the thing it is about."
        spec={{
          entry: <>Panel anchors under the bell, <code>scale(.97)→1</code> + fade {num('140ms')} <code>--ease-spring</code>, width <code>316px</code>.</>,
          active: <>Unread rows carry a tonal fill and a <code>--primary</code> dot; each names its module in Hindi and English. Header has <b>Mark all read</b>, footer opens the full centre.</>,
          dismiss: <>Click outside · <code>Esc</code> · choosing a row</>,
          exit: <>Fade {num('120ms')}. The bell's dot clears with a {num('220ms')} fade, not instantly, so the change is legible.</>,
          mobile: <>Full-screen notification page; swipe a row left to mark read.</>,
          tokens: <><code>--primary</code> unread dot · <code>--s-low</code> unread row</>,
          handler: <>User menu opens from the sidebar footer with a bottom-left origin, and lists Profile, Customization, Organisation, Billing, then Sign out separated and in <code>--danger</code>.</>,
          a11y: <><code>role="menu"</code>, arrow keys, <code>Escape</code> closes one level.</>,
        }}
        today="NotificationsModal.jsx is a full modal for a list of four items, and the user menu is a plain link list with sign-out adjacent to Profile.">
        <GlobalDemo hint="Press the bell, then the avatar at the foot of the rail" />
      </IxCard>

      <IxCard n="12.3" t="Shortcuts sheet and inline loading" trig="? · click Save"
        lede="The cheat sheet is grouped by when you would want it, not alphabetically. A button that is saving says so on itself rather than throwing a toast."
        spec={{
          entry: <>Sheet is the 4.1 modal at <code>430px</code>. Groups: Anywhere · Go to · Create.</>,
          active: <>Keys in <code>--font-mono</code> on <code>--s-high</code>, left-aligned; descriptions right. Save button swaps its label for a spinner and disables itself — width is held so the row does not reflow.</>,
          dismiss: <><code>Esc</code> · <code>?</code> again · scrim</>,
          exit: <>Standard modal exit. The button returns with a {num('500ms')} <code>--ok</code> flash rather than a success toast.</>,
          mobile: <>Sheet becomes a bottom sheet; shortcuts are hidden entirely on touch since there is no keyboard.</>,
          tokens: <><code>--s-high</code> kbd · <code>--ok</code> flash</>,
          handler: <>One shortcut registry generates both the sheet and the handlers, so they can never drift apart.</>,
        }}
        today="KeyboardShortcuts.jsx registers the handlers but there is no sheet, so the shortcuts are undiscoverable.">
        <GlobalDemo hint="Press ? in the bar · press Save" />
      </IxCard>

      <IxCard n="12.4" t="Error states" trig="failure"
        lede="Four different failures, four different treatments. The distinction that matters: is the user's work at risk, and can they do anything about it?"
        spec={{
          entry: <><b>Offline</b> is a persistent banner under the bar — it must not be dismissable by accident while still offline. <b>Session expired</b> is a centred blocking state. <b>API error</b> is a toast with Retry. <b>404</b> is a full page.</>,
          active: <>Every one states what happened to the work in progress. Offline: saved on this device. Session: nothing lost, re-submits after sign-in. API: your draft is intact. 404: nothing is broken.</>,
          dismiss: <>Offline clears when connectivity returns · session needs a sign-in · toast auto-dismisses · 404 offers two exits</>,
          exit: <>Offline banner collapses {num('220ms')} and a <code>--ok</code> <b>Back online, synced</b> chip holds {num('3s')}.</>,
          mobile: <>Offline banner sits below the mobile top bar; the session state is full-screen.</>,
          tokens: <><code>--warn-container</code> offline · <code>--danger</code> API · <code>--s-container</code> 404</>,
          handler: <>Queue mutations while offline and replay in order on reconnect. Never discard silently, and never lie about sync state — the sync chip already follows this rule.</>,
        }}
        today="Errors are all pushToast with the raw server detail — a 502 shows “Request failed with status code 502”, and there is no offline handling at all.">
        <GlobalDemo mode="error" hint="Switch between the four states" />
      </IxCard>
    </>
  );
}

window.IX_SECTIONS.push(
  { id: 'ix-chat', n: '11', group: 'Messaging', title: 'Sanvaad', hi: 'संवाद', src: 'SanvaadPage.jsx · migration 058', count: 5, Comp: IxSecChat },
  { id: 'ix-global', n: '12', group: 'Global', title: 'Global patterns', hi: 'सर्वत्र', src: 'PageLoader · NotificationsModal · KeyboardShortcuts', count: 4, Comp: IxSecGlobal },
);
Object.assign(window, { ChatDemo, GlobalDemo, IxSecChat, IxSecGlobal });
