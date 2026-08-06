// Messaging v2 — the conversation: header, log, inline threads, composer.
//
// The structural change: a thread reply is rendered INSIDE the log, under the
// message it belongs to. Staging filters `parent_message_id IS NULL` in
// list_messages and puts replies in a third column that is a sibling of this
// pane, which is why threads read as write-only — you can reply into one and
// never see the replies. Expanding in place means the log is the whole record.

function M2Body({ m }) {
  if (!m.t) return null;
  const parts = m.t.split(/(@channel|@here|@You|@\w+)/g);
  return (
    <p className="m2m__t">
      {parts.map((p, i) => {
        if (p === '@You') return <span key={i} className="men men--me">@You</span>;
        if (/^@(channel|here)$/.test(p)) return <span key={i} className="men men--me">{p}</span>;
        if (/^@\w+$/.test(p)) return <span key={i} className="men">{p}</span>;
        return p;
      })}
    </p>
  );
}

const M2_REC_IC = { invoice: 'rupee', task: 'task', ask: 'stamp' };

function M2Rec({ r }) {
  return (
    <button className={'m2rec' + (r.kind === 'ask' ? ' m2rec--ask' : '')} style={{ '--rc': r.c }}>
      <span className="m2rec__top">
        <span className="m2rec__ic">{M2I[M2_REC_IC[r.kind]]}</span>
        <span className="m2rec__mod">{r.mod}<span lang="hi">{r.hi}</span></span>
        <span className="m2rec__ref">{r.ref}</span>
      </span>
      <span className="m2rec__body">
        <span className="m2rec__ln">
          <span className="m2rec__t">{r.t}</span>
          {r.amt && <span className="m2rec__amt">{r.amt}</span>}
        </span>
        <span className="m2rec__meta">
          {r.fields.map(([l, v]) => (
            <span className="m2rec__f" key={l}>
              <span className="m2rec__f-l">{l}</span>
              <span className="m2rec__f-v">{v}</span>
            </span>
          ))}
        </span>
        {r.pct != null && <span className="m2rec__bar"><i style={{ width: r.pct + '%' }} /></span>}
      </span>
      {r.acts && r.acts.length > 0 && (
        <span className="m2rec__act">
          {r.acts.map((a, i) => <span className={'btn btn--sm ' + (i === 0 ? 'btn--fill' : 'btn--out')} key={a}>{a}</span>)}
        </span>
      )}
      {r.done && <span className="m2rec__done">{M2I.check} {r.done}</span>}
    </button>
  );
}

function M2Msg({ m, onReply, onToggleThread, open, small }) {
  const P = M2_PEOPLE;
  const who = P[m.who] || P.me;
  const mine = m.who === 'me';
  return (
    <div className={'m2m' + (mine ? ' m2m--mine' : '') + (m.run ? ' m2m--run' : '') + (m.hl ? ' m2m--hl' : '')} id={'m-' + m.id}>
      <span className="m2m__av" style={{ background: who.c }}>{who.init}</span>
      <div className="m2m__b">
        <div className="m2m__hd">
          <span className="m2m__who">{mine ? 'You' : who.name}</span>
          <span className="m2m__at">{m.at}</span>
          {m.edited && <span className="m2m__tag">edited</span>}
        </div>
        {m.quote && (
          <div className="m2q">
            <span className="m2q__bar" />
            <span className="m2q__b">
              <span className="m2q__who">{(P[m.quote.who] || P.me).name}</span>
              <span className="m2q__t">{m.quote.t}</span>
            </span>
          </div>
        )}
        <M2Body m={m} />
        {m.file && (
          <span className="m2m__file">
            <span className="m2m__file-ic">{M2I.file}</span>
            <span className="m2m__file-x"><b>{m.file.name}</b><span>{m.file.meta}</span></span>
          </span>
        )}
        {m.rec && <M2Rec r={m.rec} />}
        {m.ph && (
          <div className={'m2ph' + (m.ph.n === 1 ? ' m2ph--one' : '')}>
            {Array.from({ length: m.ph.n }).map((_, i) => (
              <image-slot key={i} id={'m2-' + m.id + '-' + i} shape="rect" placeholder="Drop a photo"></image-slot>
            ))}
            <span className="m2ph__cap">{m.ph.cap}</span>
          </div>
        )}
        {m.voice && (
          <div className="m2voice">
            <span className="m2voice__p">{M2I.play}</span>
            <span className="m2voice__w">
              {m.voice.bars.map((b, i) => <i key={i} className={i < 9 ? 'on' : ''} style={{ height: b + 'px' }} />)}
            </span>
            <span className="m2voice__d">{m.voice.d}</span>
          </div>
        )}
        {m.link && (
          <a className="m2link" href="#" onClick={e => e.preventDefault()}>
            <span className="m2rec__ic" style={{ color: 'var(--primary)' }}>{M2I.link}</span>
            <span className="m2link__b">
              <span className="m2link__h">{m.link.host}</span>
              <span className="m2link__t">{m.link.t}</span>
              <span className="m2link__d">{m.link.d}</span>
            </span>
          </a>
        )}
        {mine && m.tick && (
          <span className="m2m__at" style={{ display: 'block', marginTop: 4, textAlign: 'right' }}>
            {m.tick === 'read' ? 'Read' : m.tick === 'delivered' ? 'Delivered' : 'Sent'}
            <M2Tick state={m.tick} />
          </span>
        )}
        {m.rx && (
          <div className="m2rx">
            {m.rx.map((r, i) => (
              <button key={i} className={'m2rx__b' + (r.mine ? ' mine' : '')}>
                {r.e}<span className="m2rx__n">{r.n}</span>
              </button>
            ))}
            <button className="m2rx__b" aria-label="Add a reaction">{M2I.emoji}</button>
          </div>
        )}
        {m.thread && !small && (
          <div className="m2th">
            <button className="m2th__open" aria-expanded={open} onClick={() => onToggleThread(m.id)}>
              <span className="m2th__faces">
                {m.thread.faces.map(f => <i key={f} style={{ background: P[f].c }}>{P[f].init[0]}</i>)}
              </span>
              {m.thread.n} {m.thread.n === 1 ? 'reply' : 'replies'}
              <span className="m2th__when">· last at {m.thread.at}</span>
              <span style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-fast)', display: 'grid' }}>{M2I.down}</span>
            </button>
            {open && (
              <div className="m2th__body">
                {m.thread.replies.map((r, i) => <M2Msg key={i} m={{ ...r, id: m.id + '-r' + i }} small />)}
                <button className="m2th__reply" onClick={() => onReply(m)}>{M2I.reply} Reply in this thread</button>
              </div>
            )}
          </div>
        )}
      </div>
      {!small && (
        <div className="m2tray">
          <button title="React">{M2I.emoji}</button>
          <button title="Reply in thread" onClick={() => onReply(m)}>{M2I.reply}</button>
          <button title="Pin">{M2I.pin}</button>
          <button title="More">{M2I.dots}</button>
        </div>
      )}
    </div>
  );
}

// The assistant, inline in the log at the point the reader left off. It is the
// same Sahayak — every line cites where it came from, and it never asserts
// anything it cannot point at.
function M2Catchup({ onClose }) {
  const c = M2_CATCHUP;
  return (
    <div className="sh-card sh-card--inline">
      <div className="sh-card__hd">
        <span className="sh-card__ic">{M2I.spark}</span>
        <b>Caught up — {c.n} messages since {c.since}</b>
        <span style={{ flex: 1 }} />
        <button className="icobtn" onClick={onClose} aria-label="Dismiss">
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
        </button>
      </div>
      <ol className="sh-pts">
        {c.points.map((p, i) => (
          <li key={i}>
            <span className="sh-pts__t">{p.t}</span>
            <span className="sh-pts__src">
              {p.src.map((s, j) => <cite key={j} title={s.k}>{s.l}</cite>)}
            </span>
          </li>
        ))}
      </ol>
      <div className="sh-card__act">
        {c.actions.map(a => <button key={a} className="btn btn--out btn--sm">{a}</button>)}
      </div>
    </div>
  );
}

function M2Chat({ cv, onBack, aside, setAside, onAsk }) {
  const P = M2_PEOPLE;
  const [openThread, setOpenThread] = React.useState(null);
  const [replyTo, setReplyTo] = React.useState(null);
  const [catchup, setCatchup] = React.useState(true);
  const [draft, setDraft] = React.useState('');
  const [pinned, setPinned] = React.useState(true);
  const logRef = React.useRef(null);
  const wa = cv.kind === 'wa';
  const dm = cv.kind === 'dm';
  const who = dm ? P[cv.who] : null;
  const name = dm ? who.name : cv.name;
  const shut = wa && cv.win <= 0;

  const onScroll = () => {
    const el = logRef.current;
    if (el) setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  };
  const jump = () => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div className="m2__col m2c" style={{ position: 'relative' }}>
      <header className="m2c__hd">
        {onBack && <button className="icobtn" onClick={onBack} aria-label="Back to conversations">{M2I.back}</button>}
        {dm ? <span className="m2c__ic" style={{ background: who.c, color: '#fff', borderRadius: '50%' }}>{who.init}</span>
          : wa ? <span className="m2c__ic" style={{ background: 'color-mix(in srgb,#25D366 22%,var(--surface))', color: '#0B6B33' }}>{M2I.wa}</span>
          : <span className="m2c__ic" style={{ '--ch-c': cv.c }}>{M2I.hash}</span>}
        <div className="m2c__id">
          <span className="m2c__n">
            {name}
            {wa && <M2Win min={cv.win} />}
            {cv.archived && <span className="m2m__tag">archived</span>}
          </span>
          <span className="m2c__sub">
            {dm ? (who.p === 'on' ? 'Online' : who.p === 'away' ? 'Away' : 'Offline — replies when they are back')
              : wa ? `${cv.person} · ${cv.phone}`
              : `${cv.members} members · updates every few seconds`}
          </span>
        </div>
        {!dm && !wa && (
          <span className="m2c__faces" title={cv.members + ' members'}>
            {['divya', 'rohan', 'priya', 'anil'].map(k => (
              <i key={k} style={{ background: P[k].c }}>{P[k].init[0]}</i>
            ))}
            <i className="more">+{cv.members - 4}</i>
          </span>
        )}
        <div className="m2c__acts">
          <button className="m2cp__ai" onClick={() => { setCatchup(true); onAsk?.(); }}>{M2I.spark} Catch me up</button>
          <button className="icobtn" title="Search in conversation">{M2I.search}</button>
          {!dm && !wa && <button className="icobtn" title="Members">{M2I.users}</button>}
          <button className={'icobtn' + (aside ? ' on' : '')} title="Sahayak panel" onClick={() => setAside(!aside)}>{M2I.spark}</button>
          <button className="icobtn" title="More">{M2I.dots}</button>
        </div>
      </header>

      {shut && (
        <div className="m2c__banner m2c__banner--warn">
          {M2I.lock}
          <span><b>The 24-hour window has closed.</b> Only an approved template can start the conversation again — a free-text reply would be rejected by WhatsApp, not by us.</span>
        </div>
      )}
      {cv.muted && (
        <div className="m2c__banner m2c__banner--mute">
          {M2I.bellOff}<span>Muted. You still get mentions — nobody mutes their own name.</span>
        </div>
      )}

      {!wa && (
        <div className="m2pin">
          <span style={{ color: 'var(--on-surface-3)', display: 'grid' }}>{M2I.pin}</span>
          <span className="m2pin__c">Filing calendar Jul–Sep — GSTR-1 on the 11th, 3B on the 20th</span>
          <span className="m2pin__n">1 of 3</span>
          <button className="icobtn" aria-label="Show pinned messages">{M2I.down}</button>
        </div>
      )}
      <div className="m2log" ref={logRef} onScroll={onScroll}>
        {M2_LOG.map((m, i) => {
          if (m.day) return <div className="m2div" key={m.id}><span className="m2div__p">{m.day}</span></div>;
          if (m.newLine) return (
            <React.Fragment key={m.id}>
              <div className="m2div m2div--new"><span className="m2div__p">New messages</span></div>
              {catchup && <M2Catchup onClose={() => setCatchup(false)} />}
            </React.Fragment>
          );
          return <M2Msg key={m.id} m={m} open={openThread === m.id}
            onToggleThread={id => setOpenThread(openThread === id ? null : id)}
            onReply={setReplyTo} />;
        })}
      </div>

      {!pinned && <button className="m2jump" onClick={jump}>{M2I.down} Jump to latest</button>}

      <div aria-live="polite" aria-atomic="true">
        <div className="m2typing"><span className="m2dots" aria-hidden="true"><i /><i /><i /></span>Divya Nair is typing…</div>
      </div>

      <div className="m2cp">
        {shut ? (
          <div className="m2tpl">
            <p className="m2tpl__t">Start with a template</p>
            <p className="m2tpl__d">Approved templates only, until {cv.person} replies. Their reply reopens the window for 24 hours and free text works again.</p>
            <div className="m2tpl__list">
              {[['invoice_share', '2 variables'], ['payment_reminder', '3 variables'], ['doc_request', '1 variable']].map(([t, v]) => (
                <button className="m2tpl__c" key={t}><b>{t}</b><span>{v}</span></button>
              ))}
            </div>
          </div>
        ) : (
          <div className="m2cp__box">
            {replyTo && (
              <div className="m2cp__reply">
                {M2I.reply}<span>Replying in <b>{(M2_PEOPLE[replyTo.who] || M2_PEOPLE.me).name}’s thread</b></span>
                <span style={{ flex: 1 }} />
                <button className="icobtn" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
                </button>
              </div>
            )}
            <textarea rows="1" value={draft} onChange={e => setDraft(e.target.value)}
              placeholder={replyTo ? 'Reply in the thread…' : wa ? `Message ${cv.person} on WhatsApp…` : `Message ${dm ? who.name : '#' + cv.name}…`} />
            <div className="m2cp__foot">
              <button className="icobtn" title="Attach">{M2I.clip}</button>
              <button className="icobtn" title="Emoji">{M2I.emoji}</button>
              <button className="m2cp__ai" onClick={onAsk}>{M2I.spark} Draft with Sahayak</button>
              <span className="m2cp__sp" />
              <span className="m2cp__hint"><kbd>⏎</kbd> send · <kbd>⇧⏎</kbd> new line</span>
              <button className="btn btn--fill btn--sm" disabled={!draft.trim()}>{M2I.send} Send</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { M2Msg, M2Chat, M2Catchup, M2Body, M2Rec });
