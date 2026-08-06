// Messaging v2 — icons and the conversation rail.
// One row type for four kinds of conversation. Channels, DMs and WhatsApp
// threads sit in the same list because they are the same job: a conversation
// with unread weight, a last line and a time. What differs is the avatar shape
// and, for WhatsApp, the 24-hour window — which is the one fact that changes
// what you are allowed to send, so it is on the row.

const M2I = {
  search: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="8.6" cy="8.6" r="5.4" /><path d="M12.6 12.6L17 17" /></svg>,
  plus: <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M10 4.5v11M4.5 10h11" /></svg>,
  hash: <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M7.4 3.5L5.8 16.5M14.2 3.5l-1.6 13M3.6 7.6h13M2.9 12.4h13" /></svg>,
  lock: <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="4.6" y="8.8" width="10.8" height="7.6" rx="1.6" /><path d="M7.2 8.8V6.6a2.8 2.8 0 015.6 0v2.2" /></svg>,
  wa: <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2.6a7.3 7.3 0 00-6.2 11.2l-1 3.6 3.7-1a7.3 7.3 0 103.5-13.8zm0 1.5a5.8 5.8 0 012.9 10.8l-.4.2-2.2.6.6-2-.2-.4A5.8 5.8 0 0110 4.1zm-2 2.6c-.2 0-.5.1-.7.4-.2.3-.5.7-.5 1.3 0 .7.4 1.4.6 1.7.4.6 1.3 1.8 2.8 2.4 1.2.5 1.6.4 1.9.4.4 0 .9-.4 1-.7.1-.3.1-.6.1-.7l-.2-.2-1-.5c-.1-.1-.3-.1-.4.1l-.4.5c-.1.1-.2.1-.3.1-.2-.1-.7-.3-1.3-.8-.5-.5-.8-1-.9-1.1 0-.1 0-.2.1-.3l.3-.4v-.4l-.4-1c-.1-.2-.2-.3-.4-.3z" /></svg>,
  bellOff: <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6.2 6.4A4 4 0 0114 8v3l1.4 2.4H6M4.6 13.4L15.4 4.6M8.6 16a1.6 1.6 0 002.8 0" /></svg>,
  pin: <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M10 12.4V17M6.2 4.2h7.6l-1 5.4H7.2z" /></svg>,
  spark: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2.8l1.7 4.3 4.3 1.7-4.3 1.7L10 14.8l-1.7-4.3L4 8.8l4.3-1.7z" /><path d="M15.4 13.6l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z" /></svg>,
  users: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="7.4" cy="7" r="2.8" /><path d="M2.6 16c0-2.5 2.1-4.2 4.8-4.2S12.2 13.5 12.2 16" /><path d="M13 5.2a2.6 2.6 0 010 5M14.4 11.9c1.7.4 3 1.9 3 4.1" /></svg>,
  reply: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8 5.4L3.6 9.4 8 13.4" /><path d="M3.6 9.4h7.6a4.4 4.4 0 014.4 4.4v1" /></svg>,
  emoji: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="10" cy="10" r="7" /><path d="M7.3 11.6a3.4 3.4 0 005.4 0" /><path d="M7.6 7.8h.01M12.4 7.8h.01" strokeWidth="2" /></svg>,
  clip: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M13.4 9l-4.6 4.6a2.6 2.6 0 01-3.7-3.7l5.2-5.2a1.8 1.8 0 012.5 2.5l-5 5" /></svg>,
  dots: <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><circle cx="5" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="15" cy="10" r="1.5" /></svg>,
  down: <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 8L10 12.5 14.5 8" /></svg>,
  file: <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M11.4 2.8H6a1.6 1.6 0 00-1.6 1.6v11.2A1.6 1.6 0 006 17.2h8a1.6 1.6 0 001.6-1.6V7z" /><path d="M11.4 2.8V7h4.2" /></svg>,
  back: <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4.5L6.5 10l5.5 5.5" /></svg>,
  send: <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3.4 10h13M11 4.4l5.4 5.6-5.4 5.6" /></svg>,
  rupee: <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6.4 3.6h7.2M6.4 7h7.2M6.4 10.4h3.4a3.4 3.4 0 000-6.8M6.4 10.4l5.6 6" /></svg>,
  task: <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3.4" y="3.4" width="13.2" height="13.2" rx="2.6" /><path d="M6.8 10.2l2.4 2.4 4.2-5" /></svg>,
  stamp: <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2.8a2.6 2.6 0 00-2.4 3.6l1 2.4H5.2a2 2 0 00-2 2v1.6h13.6v-1.6a2 2 0 00-2-2h-3.4l1-2.4A2.6 2.6 0 0010 2.8z" /><path d="M4.6 15.4h10.8" /></svg>,
  play: <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path d="M6.8 4.4l8.4 5.6-8.4 5.6z" /></svg>,
  link: <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M8.4 11.6a3 3 0 000 4.2l.6.6a3 3 0 004.2 0l2.6-2.6a3 3 0 000-4.2l-.6-.6" /><path d="M11.6 8.4a3 3 0 000-4.2l-.6-.6a3 3 0 00-4.2 0L4.2 6.2a3 3 0 000 4.2l.6.6" /></svg>,
  check: <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.4l3.6 3.6L16 5.6" /></svg>,
};

// Delivered is one tick, read is two in --tick-read. They were the same '✓✓'
// string, so you could not tell whether a customer had seen your message.
function M2Tick({ state }) {
  if (!state) return null;
  const two = state === 'read' || state === 'delivered';
  return (
    <span className={'m2tick m2tick--' + state} title={state === 'read' ? 'Read' : state === 'delivered' ? 'Delivered, not read' : 'Sent'}>
      <svg width={two ? 16 : 11} height="11" viewBox={two ? '0 0 16 11' : '0 0 11 11'} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 6.2l3 3L9.4 2.4" />
        {two && <path d="M6.2 9.2L11.6 2.4" />}
      </svg>
    </span>
  );
}

function M2Win({ min }) {
  if (min <= 0) return <span className="m2win m2win--shut">closed</span>;
  const h = Math.floor(min / 60), m = min % 60;
  const label = h ? `${h}h ${m}m` : `${m}m`;
  return <span className={'m2win m2win--' + (min < 60 ? 'soon' : 'open')} title="Time left in the 24-hour reply window">{label} left</span>;
}

function M2Row({ cv, on, onSelect, icons }) {
  const P = M2_PEOPLE;
  const who = cv.kind === 'dm' ? P[cv.who] : null;
  const name = cv.kind === 'dm' ? who.name : cv.name;
  const showUnread = cv.unread > 0 && !cv.muted;
  const loud = cv.mentions > 0 || showUnread;
  return (
    <button className={'m2row' + (on ? ' on' : '') + (loud ? ' loud' : '') + (cv.archived ? ' m2row--arch' : '')}
      onClick={() => onSelect(cv.id)} aria-current={on ? 'true' : undefined} title={icons ? name : undefined}>
      {cv.kind === 'dm' ? (
        <span className="m2row__av m2row__av--dm" style={{ background: who.c }}>
          {who.init}
          <span className={'m2row__dot m2row__dot--' + who.p} />
        </span>
      ) : cv.kind === 'wa' ? (
        <span className="m2row__av m2row__av--wa">{M2I.wa}</span>
      ) : (
        <span className="m2row__av m2row__av--ch" style={{ '--ch-c': cv.c }}>{M2I.hash}</span>
      )}
      <span className="m2row__txt">
        <span className="m2row__n">
          <b>{name}</b>
          {cv.kind === 'wa' && <M2Win min={cv.win} />}
        </span>
        <span className="m2row__last">{cv.last}</span>
      </span>
      <span className="m2row__meta">
        {!loud && <span className="m2row__when">{cv.when}</span>}
        {cv.mentions > 0 && <span className="m2row__mn" aria-label={cv.mentions + ' mentions'}>{cv.mentions}</span>}
        {showUnread && <span className="m2row__badge" aria-label={cv.unread + ' unread'}>{cv.unread > 99 ? '99+' : cv.unread}</span>}
        {cv.muted && <span className="m2row__mute" role="img" aria-label="Muted">{M2I.bellOff}</span>}
      </span>
    </button>
  );
}

// Three structures, one rail. `layout` is the variation being explored:
//   rail     — one unified list, filtered by chips
//   sections — Channels / Direct as labelled groups
//   focus    — icons only; ⌘K is how you switch
//
// `tab` splits Sanvaad from Varta. WhatsApp is a separate tab, not a row type:
// an internal channel and a customer thread look alike in a list and are not
// alike at all — one is a colleague, the other is a person outside the firm on
// a metered, template-gated, 24-hour-windowed channel. Mixing them invites
// sending the wrong thing to the wrong audience.
function M2Rail({ layout, sel, onSelect, seg, setSeg, q, setQ, tab = 'msg' }) {
  const icons = layout === 'focus';
  const wa = tab === 'wa';
  const all = M2_CONVOS.filter(c => !c.archived && (wa ? c.kind === 'wa' : c.kind !== 'wa'));
  const needle = q.trim().toLowerCase();
  const match = c => {
    if (!needle) return true;
    const n = c.kind === 'dm' ? M2_PEOPLE[c.who].name : c.name;
    return n.toLowerCase().includes(needle);
  };
  const bySeg = c => seg === 'all' ? true
    : seg === 'unread' ? (c.unread > 0 && !c.muted)
    : seg === 'mentions' ? c.mentions > 0
    : seg === 'open' ? c.win > 0
    : seg === 'shut' ? c.win <= 0
    : true;
  const shown = all.filter(match).filter(bySeg);
  const counts = {
    unread: all.filter(c => c.unread > 0 && !c.muted).length,
    mentions: all.filter(c => c.mentions > 0).length,
    open: all.filter(c => c.win > 0).length,
    shut: all.filter(c => c.win <= 0).length,
  };
  const group = (kind) => shown.filter(c => c.kind === kind);
  const segs = wa
    ? [['all', 'All'], ['unread', 'Unread', counts.unread], ['open', 'Window open', counts.open], ['shut', 'Closed', counts.shut]]
    : [['all', 'All'], ['unread', 'Unread', counts.unread], ['mentions', 'Mentions', counts.mentions]];

  return (
    <div className={'m2__col m2r' + (icons ? ' m2r--icons' : '')}>
      {!icons && (
        <>
          <div className="m2r__hd">
            <span className="m2r__t">{wa ? 'WhatsApp' : 'Messages'}<span className="m2r__t-hi" lang="hi">{wa ? 'वार्ता' : 'संवाद'}</span></span>
            <span className="m2r__sp" />
            <button className="icobtn" title={wa ? 'New WhatsApp conversation' : 'New conversation'}>{M2I.plus}</button>
          </div>
          <label className="m2r__search">
            {M2I.search}
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={wa ? 'Search customers' : 'Search conversations'} aria-label="Search conversations" />
          </label>
        </>
      )}
      {!icons && (layout === 'rail' || wa) && (
        <div className="m2r__segs" role="group" aria-label="Filter conversations">
          {segs.map(([k, l, n]) => (
            <button key={k} className={'m2seg' + (seg === k ? ' on' : '') + (k === 'mentions' ? ' m2seg--alert' : '')}
              aria-pressed={seg === k} onClick={() => setSeg(k)}>
              {l}{n != null && <span className="m2seg__n">{n}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="m2r__scroll">
        {layout === 'sections' && !wa ? (
          <>
            {[['channel', 'Channels', 'चैनल'], ['dm', 'Direct', 'सीधा']].map(([k, l, hi]) => (
              <React.Fragment key={k}>
                <h3 className="m2r__sec">{l}<span className="m2r__sec-hi" lang="hi">{hi}</span><span className="m2r__sec-n">{group(k).length}</span></h3>
                {group(k).map(c => <M2Row key={c.id} cv={c} on={c.id === sel} onSelect={onSelect} />)}
                {group(k).length === 0 && <p className="m2r__sec-hi" style={{ padding: '2px 8px 4px', fontSize: 'var(--t-label-sm)', color: 'var(--on-surface-3)' }}>Nothing here.</p>}
              </React.Fragment>
            ))}
          </>
        ) : (
          <>
            {shown.map(c => <M2Row key={c.id} cv={c} on={c.id === sel} onSelect={onSelect} icons={icons} />)}
            {shown.length === 0 && (
              <p style={{ padding: '18px 10px', fontSize: 'var(--t-body-sm)', color: 'var(--on-surface-3)', textWrap: 'pretty' }}>
                {needle ? `Nothing matches “${q.trim()}”.` : seg === 'unread' ? 'Everything is read.' : seg === 'mentions' ? 'Nobody has mentioned you.' : seg === 'open' ? 'No window is open. Every customer needs a template to reach.' : seg === 'shut' ? 'Every window is open — free text works everywhere.' : 'No conversations.'}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { M2I, M2Tick, M2Win, M2Row, M2Rail });
