// Sections 6–8 — Files, time tracking, approvals.
// Against staging drawer/DrawerAttachments.jsx, DrawerTimeEntries.jsx, DrawerApproval.jsx.
const FILES0 = [
  { id: 1, n: 'GSTR-2B-recon-June-FY27.xlsx', s: '248 KB', k: 'xlsx', priv: false },
  { id: 2, n: 'Site-measurement-signed.pdf', s: '1.4 MB', k: 'pdf', priv: false },
  { id: 3, n: 'Mumbai-layout-v3.png', s: '820 KB', k: 'img', priv: true, who: ['Keval Shah', 'Rohan Iyer'] },
];
const F_ICON = { xlsx: '#16803F', pdf: '#B42318', img: '#0082c6', doc: '#5b6ee0', zip: '#74786F' };

function FileDemo({ hint, h, forceLimit }) {
  const { mobile } = useIx();
  const [list, setList] = React.useState(forceLimit
    ? Array.from({ length: 10 }, (_, i) => ({ id: i + 1, n: 'placeholder-document-' + (i + 1) + '.pdf', s: '412 KB', k: 'pdf' }))
    : FILES0);
  const [drag, setDrag] = React.useState(false);
  const [box, setBox] = React.useState(null);
  const [priv, setPriv] = React.useState(null);
  const s = useIxScale();
  const timers = React.useRef([]);
  React.useEffect(() => () => timers.current.forEach(clearInterval), []);

  const upload = (name, size, kind, fail) => {
    const id = Date.now() + Math.random();
    setList(l => [...l, { id, n: name, s: size, k: kind, pct: 0 }]);
    const iv = setInterval(() => setList(l => l.map(f => {
      if (f.id !== id) return f;
      const next = (f.pct || 0) + 9 + Math.random() * 11;
      if (fail && next > 62) { clearInterval(iv); return { ...f, pct: undefined, err: 'Upload failed — connection dropped at 62%' }; }
      if (next >= 100) { clearInterval(iv); return { ...f, pct: undefined, fresh: true }; }
      return { ...f, pct: next };
    })), 260 * s);
    timers.current.push(iv);
  };
  const full = list.length >= 10;

  return (
    <IxStage h={h || (mobile ? 380 : 320)} note={hint}>
      <div className="fz">
        <div className={'fz__drop' + (drag ? ' on' : '') + (full ? ' off' : '')}
          onDragOver={e => { e.preventDefault(); if (!full) setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); if (!full) upload('dropped-file.pdf', '620 KB', 'pdf'); }}>
          <span className="fz__ic">{SI.clip}</span>
          <span style={{ minWidth: 0 }}>
            <b>{full ? 'Maximum 10 files per task' : drag ? 'Drop to upload' : 'Drop files here'}</b>
            <span>{full ? 'Remove one to add another. The limit is per task, not per project.' : 'or choose from your device · 25 MB each'}</span>
          </span>
          <span className="fz__n mono">{list.length}/10</span>
        </div>
        {!full && (
          <div className="chips" style={{ gap: 6 }}>
            <button className="chip" style={{ fontSize: 11.5 }} onClick={() => upload('Tata-Steel-quotation.pdf', '1.1 MB', 'pdf')}>Upload a PDF</button>
            <button className="chip" style={{ fontSize: 11.5 }} onClick={() => upload('office-elevation.png', '2.3 MB', 'img')}>Upload an image</button>
            <button className="chip" style={{ fontSize: 11.5 }} onClick={() => upload('broken-upload.zip', '18 MB', 'zip', true)}>Upload that fails</button>
          </div>
        )}
        <div className="fz__list">
          {list.map(f => (
            <div key={f.id} className={'fcard' + (f.err ? ' err' : '') + (f.pct != null ? ' up' : '') + (f.fresh ? ' fresh' : '')}>
              <span className="fcard__ic" style={{ '--c': F_ICON[f.k] || '#74786F' }}>{f.k === 'img' ? SI.eye : SI.file}</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="fcard__n">{f.n}</span>
                <span className="fcard__s">
                  {f.err ? <span style={{ color: 'var(--danger)' }}>{f.err}</span>
                    : f.pct != null ? <>{Math.round(f.pct)}% · uploading</>
                      : <>{f.s} · {f.k.toUpperCase()}{f.priv && <> · <span style={{ color: 'var(--warn)' }}>private to {f.who.length}</span></>}</>}
                </span>
              </span>
              {f.pct != null ? (
                <button className="icobtn" style={{ width: 24, height: 24 }} title="Cancel" onClick={() => setList(l => l.filter(x => x.id !== f.id))}>{I.x}</button>
              ) : f.err ? (
                <>
                  <button className="btn btn--out btn--sm" onClick={() => { setList(l => l.filter(x => x.id !== f.id)); upload(f.n, f.s, f.k); }}>Retry</button>
                  <button className="icobtn" style={{ width: 24, height: 24 }} onClick={() => setList(l => l.filter(x => x.id !== f.id))}>{I.x}</button>
                </>
              ) : (
                <span className="fcard__acts">
                  <button className="icobtn" style={{ width: 24, height: 24 }} title="Privacy" onClick={() => setPriv(f)}>{f.priv ? SI.lock : SI.eye}</button>
                  {f.k === 'img' && <button className="icobtn" style={{ width: 24, height: 24 }} title="Preview" onClick={() => setBox(f)}>{SI.file}</button>}
                  <button className="icobtn" style={{ width: 24, height: 24 }} title="Delete" onClick={() => setList(l => l.filter(x => x.id !== f.id))}>{I.x}</button>
                </span>
              )}
              {f.pct != null && <span className="fcard__bar" style={{ width: f.pct + '%' }} />}
            </div>
          ))}
        </div>
      </div>
      {box && (
        <div className="lbox" onClick={() => setBox(null)}>
          <div className="lbox__bar">
            <span className="mono" style={{ fontSize: 11.5 }}>{box.n}</span>
            <span style={{ flex: 1 }} />
            <button className="lbox__b" title="Download">{SI.file}</button>
            <button className="lbox__b" onClick={() => setBox(null)} title="Close (Esc)">{I.x}</button>
          </div>
          <div className="lbox__img" onClick={e => e.stopPropagation()}>
            <span>{box.n}</span>
            <i>Placeholder — the real image renders here at natural size, click to zoom</i>
          </div>
          <div className="lbox__nav">
            <button className="lbox__b">{I.chevL}</button>
            <span className="mono" style={{ fontSize: 11 }}>1 of 2</span>
            <button className="lbox__b">{I.chevR}</button>
          </div>
        </div>
      )}
      {priv && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 24 }} onClick={() => setPriv(null)} />
          <div className={mobile ? 'dm-bsheet' : 'dm-pop'} style={mobile ? undefined : { top: 60, right: 18, left: 'auto', width: 254, transformOrigin: 'top right' }}>
            {mobile && <div className="bsheet__grab" />}
            <div className="fpriv">
              <div className="between">
                <b style={{ fontSize: 12.5 }}>Private file</b>
                <SSwitchLite on={!!priv.priv} />
              </div>
              <span className="fpriv__d">Off means everyone with access to this task can open it. On means only the people you pick.</span>
              {priv.priv && (
                <div className="fpriv__l">
                  {MEM.slice(0, 5).map(m => (
                    <button key={m} className={'dm-opt' + ((priv.who || []).includes(m) ? ' on' : '')}>
                      <Av n={m} s={20} /><span style={{ fontSize: 12 }}>{m}</span>
                      <span className="dm-opt__ck">{(priv.who || []).includes(m) ? I.check : null}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </IxStage>
  );
}
function SSwitchLite({ on }) { return <span className={'sw' + (on ? ' on' : '')} style={{ width: 36, height: 21 }} />; }

// ── Time tracking ──────────────────────────────────────────────────────
function TimeDemo({ hint }) {
  const { mobile } = useIx();
  const [run, setRun] = React.useState(false);
  const [sec, setSec] = React.useState(0);
  const [manual, setManual] = React.useState(false);
  const [entries, setEntries] = React.useState([
    { id: 1, d: '25 Jul', m: 95, t: 'Reconciled 2B against books', who: 'Keval Shah' },
    { id: 2, d: '24 Jul', m: 40, t: 'Call with Shreeji on HSN codes', who: 'Rohan Iyer' },
  ]);
  const [undo, setUndo] = React.useState(null);
  React.useEffect(() => {
    if (!run) return;
    const iv = setInterval(() => setSec(s2 => s2 + 1), 1000);
    return () => clearInterval(iv);
  }, [run]);
  const hhmmss = n => [Math.floor(n / 3600), Math.floor((n % 3600) / 60), n % 60].map(x => String(x).padStart(2, '0')).join(':');
  const fmt = m => (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm');
  const total = entries.reduce((a, e) => a + e.m, 0) + Math.floor(sec / 60);
  const stop = () => {
    if (sec >= 5) setEntries(e => [{ id: Date.now(), d: 'Today', m: Math.max(1, Math.round(sec / 60)), t: 'Timed session', who: 'Keval Shah', fresh: true }, ...e]);
    setRun(false); setSec(0);
  };
  return (
    <IxStage h={mobile ? 360 : 306} note={hint}>
      <div className="tt2">
        <div className="between">
          <span className="fld__l">Time logged</span>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{fmt(total)}</span>
        </div>
        {run ? (
          <div className="tt2__run">
            <span className="tt2__dot" />
            <span className="tt2__clock mono">{hhmmss(sec)}</span>
            <span className="mute" style={{ fontSize: 11.5, flex: 1 }}>Running · keeps counting if you switch tabs or close the drawer</span>
            <button className="btn btn--sm" style={{ background: 'var(--danger)', color: '#fff' }} onClick={stop}>Stop</button>
          </div>
        ) : (
          <div className="rowflex" style={{ gap: 8 }}>
            <button className="btn btn--fill btn--sm" onClick={() => { setSec(0); setRun(true); }}>{I.clock} Start timer</button>
            <button className="btn btn--out btn--sm" onClick={() => setManual(!manual)}>{I.plus} Add manually</button>
          </div>
        )}
        {manual && !run && (
          <div className="tt2__man">
            <input className="inp mono" style={{ width: 84 }} placeholder="90" />
            <input className="inp" style={{ flex: 1 }} placeholder="What did you work on?" autoFocus />
            <button className="btn btn--fill btn--sm" onClick={() => { setEntries(e => [{ id: Date.now(), d: 'Today', m: 90, t: 'Manual entry', who: 'Keval Shah', fresh: true }, ...e]); setManual(false); }}>Log</button>
          </div>
        )}
        <div className="tt2__list">
          {entries.map(e => (
            <div key={e.id} className={'tt2__e' + (e.fresh ? ' fresh' : '')}>
              <Av n={e.who} s={24} />
              <span style={{ minWidth: 0, flex: 1 }}><b>{e.t}</b><span>{e.d} · {e.who.split(' ')[0]}</span></span>
              <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{fmt(e.m)}</span>
              <button className="tt2__del" onClick={() => { setEntries(x => x.filter(y => y.id !== e.id)); setUndo(e); setTimeout(() => setUndo(null), 4000); }}>{I.x}</button>
            </div>
          ))}
        </div>
      </div>
      {undo && <div className="cm__undo">{I.check} Entry removed<button className="btn btn--text btn--sm" style={{ padding: '2px 6px' }} onClick={() => { setEntries(e => [undo, ...e]); setUndo(null); }}>Undo</button></div>}
    </IxStage>
  );
}

// ── Approvals ──────────────────────────────────────────────────────────
const AP_ST = { none: ['Not requested', '#8E8D87'], pending: ['Awaiting approval', '#d97706'], pending_client: ['Awaiting client', '#7c3aed'], approved: ['Approved', '#16a34a'], rejected: ['Declined', '#dc2626'] };
function ApprovalDemo({ hint, as }) {
  const [st, setSt] = React.useState('none');
  const [panel, setPanel] = React.useState(null);
  const [note, setNote] = React.useState('');
  const [fwd, setFwd] = React.useState(false);
  const role = as || 'approver';
  const [lbl, c] = AP_ST[st];
  return (
    <IxStage h={330} note={hint}>
      <div className="ap">
        <div className="ap__h">
          <span style={{ minWidth: 0 }}>
            <b>Mumbai fit-out — final layout</b>
            <span className="mono">KAR-582</span>
          </span>
          <span className={'ap__badge' + (st !== 'none' ? ' pop' : '')} style={{ '--c': c }}><i />{lbl}</span>
        </div>
        <div className="ap__pipe">
          {['todo', 'in_progress', 'in_review', 'done'].map((k, i) => {
            const ci = st === 'approved' ? 3 : st === 'none' ? 1 : 2;
            return <span key={k} className={'ap__seg' + (i === ci ? ' on' : i < ci ? ' past' : '')}>{ST[k][0]}</span>;
          })}
        </div>

        {st === 'none' && role !== 'viewer' && (
          <>
            <button className="btn btn--fill btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPanel('request')}>Request approval</button>
            {panel === 'request' && (
              <div className="ap__panel">
                <label className="fld"><span className="fld__l">Note for the approver — optional</span>
                  <textarea className="inp" rows="2" value={note} onChange={e => setNote(e.target.value)} placeholder="Layout v3 with the revised lift lobby. Client has seen it verbally." autoFocus /></label>
                <div className="rowflex" style={{ gap: 8 }}>
                  <button className="btn btn--fill btn--sm" onClick={() => { setSt('pending'); setPanel(null); setNote(''); }}>Send request</button>
                  <button className="btn btn--out btn--sm" onClick={() => setPanel(null)}>Cancel</button>
                  <span className="mute" style={{ fontSize: 11.5 }}>Goes to Aanya Mehta · Approver on कर्तव्य</span>
                </div>
              </div>
            )}
          </>
        )}

        {st === 'pending' && role === 'approver' && (
          <>
            <div className="rowflex" style={{ gap: 8 }}>
              <button className="btn btn--fill btn--sm" onClick={() => setPanel('approve')}>Approve</button>
              <button className="btn btn--danger btn--sm" onClick={() => setPanel('reject')}>Decline</button>
              <span className="mute" style={{ fontSize: 11.5 }}>Requested by Rohan Iyer · 12 min ago</span>
            </div>
            {panel === 'approve' && (
              <div className="ap__panel">
                <label className="fld"><span className="fld__l">Note — optional</span><textarea className="inp" rows="2" placeholder="Approved. Raise the milestone invoice." /></label>
                <label className="au-check"><input type="checkbox" checked={fwd} onChange={e => setFwd(e.target.checked)} /><span className="au-check__b">{I.check}</span>Also send to the client for sign-off</label>
                {fwd && (
                  <div className="ap__fwd">
                    <select className="inp" style={{ flex: 1 }}><option>Meera Joshi · Tata Steel</option><option>Anil Kapoor · Godrej Interio</option></select>
                    <span className="mute" style={{ fontSize: 11 }}>They see the task, not your internal notes</span>
                  </div>
                )}
                <div className="rowflex" style={{ gap: 8 }}>
                  <button className="btn btn--fill btn--sm" onClick={() => { setSt(fwd ? 'pending_client' : 'approved'); setPanel(null); }}>{fwd ? 'Approve and forward' : 'Approve'}</button>
                  <button className="btn btn--out btn--sm" onClick={() => setPanel(null)}>Cancel</button>
                </div>
              </div>
            )}
            {panel === 'reject' && (
              <div className="ap__panel ap__panel--bad">
                <label className="fld"><span className="fld__l">Why — required, the requester reads this</span>
                  <textarea className="inp" rows="2" value={note} onChange={e => setNote(e.target.value)} placeholder="Lift lobby dimension does not match the site measurement. Re-check against the signed sheet." autoFocus /></label>
                <div className="rowflex" style={{ gap: 8 }}>
                  <button className="btn btn--sm" style={{ background: 'var(--danger)', color: '#fff' }} disabled={!note.trim()} onClick={() => { setSt('rejected'); setPanel(null); }}>Decline</button>
                  <button className="btn btn--out btn--sm" onClick={() => setPanel(null)}>Cancel</button>
                  {!note.trim() && <span className="mute" style={{ fontSize: 11.5 }}>A reason is required — declining silently is how work stalls</span>}
                </div>
              </div>
            )}
          </>
        )}

        {st === 'pending' && role !== 'approver' && (
          <div className="ap__wait">{I.clock}<span>Waiting on <b>Aanya Mehta</b>. You will get a notification the moment she decides. <span className="mute">Nothing for you to do — and no button pretending otherwise.</span></span></div>
        )}
        {st === 'pending_client' && (
          <div className="ap__wait">{SI.wa}<span>Sent to <b>Meera Joshi</b> at Tata Steel. She approves from the client portal — a simplified two-button view with none of your internal notes.</span></div>
        )}
        {st === 'rejected' && (
          <div className="ap__panel ap__panel--bad" style={{ marginTop: 0 }}>
            <b style={{ fontSize: 12.5, color: 'var(--danger)' }}>Declined by Aanya Mehta · 2 min ago</b>
            <span style={{ fontSize: 12.5, lineHeight: 1.55 }}>“Lift lobby dimension does not match the site measurement. Re-check against the signed sheet.” Placeholder.</span>
          </div>
        )}
        {st === 'approved' && (
          <div className="ap__ok">{I.check}<span><b>Approved by Aanya Mehta.</b> Moved to Done, and the milestone invoice is now unblocked in गणित.</span></div>
        )}

        <div className="ap__reset">
          <span className="mute" style={{ fontSize: 11 }}>Jump to a state:</span>
          {Object.keys(AP_ST).map(k => <button key={k} className={'chip' + (st === k ? ' on' : '')} style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { setSt(k); setPanel(null); }}>{AP_ST[k][0]}</button>)}
        </div>
      </div>
    </IxStage>
  );
}

function IxSecFiles() {
  return (
    <>
      <IxCard n="6.1" t="Drop, upload, progress" trig="drag · click"
        lede="The card appears the instant the upload starts, with the progress drawn on the card itself rather than in a separate tray. You always see what is arriving and where it will land."
        spec={{
          entry: <>Drop zone border goes <code>--outline-variant</code>→<code>--primary</code> with an <code>8%</code> tint fill, {num('140ms')}. On drop the file card enters immediately at <code>opacity .7</code>.</>,
          active: <>A <code>2px</code> <code>--primary</code> bar drains left→right along the card's bottom edge, width bound to real percentage. Percent sits in the metadata line — a number, not a guess.</>,
          dismiss: <>Cancel <code>×</code> during upload aborts the request and removes the card</>,
          exit: <>At 100% the bar fades {num('180ms')}, the card goes to full opacity and the metadata swaps to size + type. No success toast — the card <em>is</em> the confirmation.</>,
          mobile: <>Drop zone becomes a tap target opening the native picker; camera and files are separate entries.</>,
          tokens: <><code>--primary</code> bar · <code>--r-sm</code> · type colours from the file kind</>,
          handler: <><code>onUpload(file)</code> with <code>XMLHttpRequest.upload.onprogress</code> — <code>fetch</code> cannot report progress.</>,
        }}
        today="DrawerAttachments.jsx uploads without any progress feedback; a 20 MB file looks identical to a stalled one until it appears.">
        <FileDemo hint="Drag a file onto the zone, or use the three buttons" />
      </IxCard>

      <IxCard n="6.2" t="Failure and retry" trig="network error"
        lede="Uploads fail on Indian mobile networks constantly. The card stays, holds the bytes it has, and offers one button — it is never silently dropped."
        spec={{
          entry: <>Card background to <code>--danger-container</code>, bar frozen at the last real percentage, {num('180ms')}.</>,
          active: <>Metadata line is replaced by the reason, naming the percentage reached. <b>Retry</b> and <b>Remove</b>, in that order.</>,
          dismiss: <>Retry restarts from zero · Remove discards</>,
          exit: <>On retry the card returns to uploading state in place; the row never re-sorts.</>,
          mobile: <>Identical. Retry is the larger target of the two.</>,
          tokens: <><code>--danger-container</code> · <code>--danger</code></>,
          handler: <>Keep the <code>File</code> handle in state so retry needs no re-pick. Chunked resume above 5 MB.</>,
        }}
        today="A failed upload shows an error toast and the file vanishes — the person has to find it on disk again.">
        <FileDemo hint="Press “Upload that fails” — it dies at 62%" />
      </IxCard>

      <IxCard n="6.3" t="Lightbox" trig="click a thumbnail"
        lede="Full-bleed on a dark scrim, chrome only at the edges. Nothing sits over the image itself."
        spec={{
          entry: <>Scrim fades {num('180ms')}; image scales <code>.94→1</code> with fade, {num('220ms')} <code>--ease-emph</code>, from the thumbnail's position where available.</>,
          active: <>Filename top-left, download and close top-right, counter and arrows bottom-centre. Click the image to zoom to 100%, scroll to zoom, drag to pan.</>,
          dismiss: <><code>Escape</code> · close button · click the scrim · swipe down on touch</>,
          exit: <>Reverse scale + fade {num('160ms')} <code>--ease-exit</code>.</>,
          mobile: <>Swipe left/right between images, pinch to zoom, swipe down to dismiss with the scrim tracking the drag.</>,
          tokens: <><code>--scrim</code> at full strength · fixed white chrome, not theme-dependent</>,
          handler: <><code>← →</code> move between images in the same task. PDFs open in a new tab; other types download.</>,
          a11y: <>Focus trapped, <code>aria-label</code> on every control, arrow keys announced.</>,
        }}
        today="Clicking an attachment downloads it. There is no preview of any kind, so checking a layout means leaving the task.">
        <FileDemo hint="Upload an image, then press its preview icon" />
      </IxCard>

      <IxCard n="6.4" t="Per-file privacy" trig="click the lock"
        lede="One file on a shared task sometimes cannot be shared. The control is on the file, not buried in task settings."
        spec={{
          entry: <>Popover from the icon, <code>scale(.97)→1</code> {num('140ms')} <code>--ease-spring</code>, right-anchored.</>,
          active: <>A switch, then — only when on — the member list with checkmarks. Off state does not render an empty list; there is nothing to choose yet.</>,
          dismiss: <>Click outside · <code>Esc</code></>,
          exit: <>Fade {num('120ms')}. The file card's metadata gains <code>private to n</code> in <code>--warn</code>.</>,
          mobile: <>Bottom sheet, <code>48px</code> rows.</>,
          tokens: <><code>--warn</code> for the private marker · <code>--primary-container</code> selected rows</>,
          handler: <><code>PATCH /files/:id {'{ is_private, visible_to[] }'}</code>. Enforced in the signed-URL issuer, not in the list query.</>,
        }}
        today="Files inherit task visibility with no per-file control, so a salary letter on a shared task is visible to the whole task.">
        <FileDemo hint="Press the eye or lock icon on any file" />
      </IxCard>

      <IxCard n="6.5" t="At the limit" trig="10 files"
        lede="The limit is stated before it is hit, and the zone explains itself rather than just refusing."
        spec={{
          entry: <>Zone goes to <code>opacity .55</code>, border solid, {num('180ms')}. Counter turns <code>--warn</code> at 8 and <code>--danger</code> at 10.</>,
          active: <>Copy changes to name the limit and its scope — per task, not per project. Upload buttons are removed rather than disabled.</>,
          dismiss: <>Deleting any file restores the zone immediately</>,
          exit: <>Fade back {num('180ms')}.</>,
          mobile: <>Same; counter moves under the heading where there is room.</>,
          tokens: <><code>--warn</code> · <code>--danger</code> · <code>--s-container</code></>,
          handler: <>Client blocks the picker; server rejects with <code>413</code> and the same wording.</>,
        }}
        today="The 11th upload fails with a generic error. The limit is never shown, so hitting it looks like a bug.">
        <FileDemo hint="Delete one to bring the zone back" forceLimit h={330} />
      </IxCard>
    </>
  );
}

function IxSecTime() {
  return (
    <>
      <IxCard n="7.1" t="Start and stop the timer" trig="click Start"
        lede="The button becomes the timer. No second surface, no floating widget to lose — and it keeps counting when the drawer closes."
        spec={{
          entry: <>Button is replaced in place by the running row, {num('220ms')} fade. Elapsed time ticks each second in <code>--font-mono</code> at <code>HH:MM:SS</code> with tabular figures so the width never jitters.</>,
          active: <>A <code>--ok</code> dot pulses on a {num('2s')} cycle. <b>Stop</b> is <code>--danger</code>. The timer is app-level state, not component state — closing the drawer or changing route does not stop it.</>,
          dismiss: <>Stop commits the entry · under 5 seconds is discarded silently as a misclick</>,
          exit: <>Row collapses, and the new entry enters the list from above with <code>translateY(-6px)</code> + fade {num('220ms')}. Total updates in the same frame.</>,
          mobile: <>A persistent bar docks above the bottom nav while running, showing the task name and elapsed time from anywhere in the app.</>,
          tokens: <><code>--ok</code> pulse · <code>--danger</code> stop · <code>--font-mono</code></>,
          handler: <><code>startTimer(taskId)</code> writes a server-side <code>started_at</code>, so elapsed survives a refresh and a dead battery.</>,
        }}
        today="DrawerTimeEntries.jsx has start/stop, but the timer lives in component state — closing the drawer loses it, and a refresh loses the session entirely.">
        <TimeDemo hint="Start it, wait a few seconds, stop it" />
      </IxCard>

      <IxCard n="7.2" t="Log time manually" trig="click Add manually"
        lede="Most time is logged after the fact. The manual path is one row, not a modal, and it takes minutes rather than making people compute a range."
        spec={{
          entry: <>Row expands <code>max-height 0→40px</code> + fade {num('220ms')} <code>--ease-emph</code>, minutes field focused.</>,
          active: <>Minutes accepts <code>90</code> or <code>1h30</code> or <code>1.5h</code> and normalises on blur. Description is optional but prompted.</>,
          dismiss: <><code>Esc</code> · blur while empty</>,
          exit: <>Collapses after logging; the entry enters the list as in 7.1.</>,
          mobile: <>Numeric keypad for the minutes field.</>,
          tokens: <><code>--r-sm</code> · <code>--primary</code> focus ring</>,
          handler: <><code>POST /time-entries {'{ task_id, minutes, note, date }'}</code>. Defaults to today; the date is editable.</>,
        }}
        today="A minutes-only input with no parsing, so “1h30” is stored as 1 minute.">
        <TimeDemo hint="Press Add manually" />
      </IxCard>

      <IxCard n="7.3" t="The entry list" trig="hover a row"
        lede="Who, when, how long, and what for. Deleting somebody else's entry is an audit event, so it gets an undo rather than a confirmation."
        spec={{
          entry: <>Rows render newest first, grouped by day when there are more than eight.</>,
          active: <>Avatar, note, date, duration right-aligned in mono. Delete <code>×</code> fades in on hover only.</>,
          dismiss: <>n/a</>,
          exit: <>Row collapses {num('220ms')} and an undo toast holds {num('4s')} — the same pattern as comments in 3.5.</>,
          mobile: <>Swipe-left to reveal delete, matching subtasks in 2.4.</>,
          tokens: <><code>--s-container</code> toast · <code>--primary</code> undo</>,
          handler: <>Only the entry's owner or a module admin may delete. Deletion of another person's entry writes to the audit log.</>,
        }}
        today="Entries list correctly, delete is instant with no undo and no ownership check in the UI.">
        <TimeDemo hint="Hover an entry and delete it, then undo" />
      </IxCard>
    </>
  );
}

function IxSecApprovals() {
  return (
    <>
      <IxCard n="8.1" t="Request approval" trig="click Request"
        lede="A panel below the button, not a dialog. The note is optional — forcing one on every request produces “pls check”."
        spec={{
          entry: <>Panel expands below the trigger, <code>max-height</code> + fade {num('220ms')} <code>--ease-emph</code>, textarea focused.</>,
          active: <>Names the approver and their level, resolved from the module grants, so nobody guesses who it went to.</>,
          dismiss: <>Cancel · <code>Esc</code></>,
          exit: <>Panel collapses; the status badge cross-fades to <code>Awaiting approval</code> in <code>#d97706</code> and the pipeline advances one segment.</>,
          mobile: <>Panel becomes a bottom sheet; the approver name stays visible above the keyboard.</>,
          tokens: <><code>APPROVAL_STATUS_COLOR</code> from <code>drawer/constants.js</code></>,
          handler: <><code>POST /tasks/:id/approval {'{ note }'}</code> → notification, email and a Sanvaad system message.</>,
        }}
        today="DrawerApproval.jsx requests approval but does not name the approver, so people ask in chat who is meant to look at it.">
        <ApprovalDemo hint="Request approval, then approve or decline it" />
      </IxCard>

      <IxCard n="8.2" t="Waiting, seen from both sides" trig="pending state"
        lede="The approver gets two buttons. Everybody else gets a sentence. A disabled Approve button on a non-approver's screen is worse than no button."
        spec={{
          entry: <>Badge pulses once on arrival, {num('360ms')} <code>--ease-spring</code>, then holds.</>,
          active: <>Approver: <b>Approve</b> filled, <b>Decline</b> danger-outlined, requester and elapsed time beside them. Everyone else: a read-only line naming who is deciding.</>,
          dismiss: <>n/a until decided</>,
          exit: <>On decision the badge cross-fades and the pipeline moves.</>,
          mobile: <>Buttons go full-width and stack, Approve on top.</>,
          tokens: <><code>#d97706</code> pending · <code>#7c3aed</code> pending client</>,
          handler: <>Render from the viewer's grant, never from a client-side role guess.</>,
        }}
        today="Both buttons render for everyone; a member clicking Approve gets a 403 toast.">
        <ApprovalDemo hint="Set state to Awaiting approval, then switch the viewer below" as="viewer" />
      </IxCard>

      <IxCard n="8.3" t="Approve, optionally via the client" trig="click Approve"
        lede="Internal approval and client sign-off are one flow with a checkbox, not two features. The client sees the task and nothing else."
        spec={{
          entry: <>Panel expands; ticking <b>Also send to the client</b> reveals the client picker with a <code>--dur-base</code> grow.</>,
          active: <>Primary button relabels to <b>Approve and forward</b> the moment the box is ticked, so the outcome is never ambiguous. A line states that internal notes are not shared.</>,
          dismiss: <>Cancel · <code>Esc</code></>,
          exit: <>Status goes to <code>Approved</code> <code>#16a34a</code>, or <code>Awaiting client</code> <code>#7c3aed</code> when forwarded. Approved unblocks any dependent invoice and says so.</>,
          mobile: <>Bottom sheet, picker as a full-width select.</>,
          tokens: <><code>#16a34a</code> approved · <code>--ok-container</code> confirmation</>,
          handler: <><code>POST /approve {'{ note, forward_to_client_id }'}</code>. Client approval reuses the same record with <code>pending_client</code>.</>,
        }}
        today="Client forwarding exists as a separate dropdown that is easy to miss, and the button label does not change when it is set.">
        <ApprovalDemo hint="Approve with “Also send to the client” ticked" />
      </IxCard>

      <IxCard n="8.4" t="Decline with a reason" trig="click Decline"
        lede="The only required field in the whole flow. A decline without a reason sends the work back to somebody who now has to guess."
        spec={{
          entry: <>Panel expands with a <code>--danger-container</code> tint so the branch is unmistakable.</>,
          active: <>Decline stays disabled until there is non-whitespace text, with the reason stated beside it rather than as a silent disabled state.</>,
          dismiss: <>Cancel · <code>Esc</code></>,
          exit: <>Badge to <code>Declined</code> <code>#dc2626</code>; the note renders permanently on the task for the requester, attributed and timestamped.</>,
          mobile: <>Sheet; the button sits above the keyboard so the gate is visible while typing.</>,
          tokens: <><code>#dc2626</code> · <code>--danger-container</code></>,
          handler: <><code>POST /reject {'{ note }'}</code> — reject server-side too if the note is empty.</>,
        }}
        today="Rejection notes are optional, and the note is only visible in the activity feed rather than on the task.">
        <ApprovalDemo hint="Decline — the button unlocks once you type a reason" />
      </IxCard>
    </>
  );
}

window.IX_SECTIONS.push(
  { id: 'ix-files', n: '06', group: 'Task drawer', title: 'Files', hi: 'संचिका', src: 'drawer/DrawerAttachments.jsx', count: 5, Comp: IxSecFiles },
  { id: 'ix-time', n: '07', group: 'Task drawer', title: 'Time tracking', hi: 'समय', src: 'drawer/DrawerTimeEntries.jsx', count: 3, Comp: IxSecTime },
  { id: 'ix-approvals', n: '08', group: 'Task drawer', title: 'Approvals', hi: 'सम्मति', src: 'drawer/DrawerApproval.jsx', count: 4, Comp: IxSecApprovals },
);
Object.assign(window, { FileDemo, TimeDemo, ApprovalDemo, IxSecFiles, IxSecTime, IxSecApprovals, AP_ST });
