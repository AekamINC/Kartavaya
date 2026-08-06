// Skills marketplace — components.
// Three browse models over one catalogue, and a detail drawer that spends its
// space on permissions and cost rather than on marketing copy.

const MK_MOD = Object.fromEntries(MK_MODULES.map(m => [m[0], { id: m[0], en: m[1], hi: m[2], sub: m[3], c: m[4] }]));
const MK_TYPE_IC = { automation: 'task', detection: 'search', analysis: 'spark', content: 'file' };

/* ── Icons ─────────────────────────────────────────────────────────────────
   A saturated tile in the module's colour with a white pictorial mark on it.

   Two earlier attempts are worth recording, because both failed for the same
   reason and it was not colour:

     1. One line glyph per skill_type. Twelve different jobs looked like four,
        and the card's most scannable element carried the least information.
     2. Axonometric solids, one per skill. They had volume and no MEANING — a
        stack of cubes does not say "invoices", and attendance-to-payroll read
        as a mushroom. Abstract geometry is not iconography.

   So: front elevation, recognisable objects, one white pen. A document is a
   document, a clock is a clock, a diya is a diya. Depth comes from the TILE —
   a saturated ground, a highlight along the top edge, a coloured drop shadow —
   not from the drawing, which stays flat and legible at 34px.

   Every module colour clears 4.5:1 against white, so the mark is white in both
   themes and needs no per-theme variant. One stroke weight, one cap style, one
   24-unit grid: that uniformity is most of what makes a set look drawn by one
   hand.
   ──────────────────────────────────────────────────────────────────────────── */
const MK_TYPE_TONE = { automation: '#04837A', detection: '#955806', analysis: '#6B4FBF', content: '#A0426E' };

// [stroked paths, filled paths]. 24×24 grid, stroke 1.8, round caps.
const MK_SCENES = {
  // An invoice, leaving.
  chase: [['M4.6 3.4h5.6l3.2 3.2v9.6a1 1 0 01-1 1H5.6a1 1 0 01-1-1V4.4a1 1 0 011-1z',
           'M10.2 3.4v3.2h3.2', 'M7 9.4h4M7 12.2h2.6',
           'M15.4 15.4h5.6M18.4 12.6l2.8 2.8-2.8 2.8'], []],
  // A report — bars under a rule.
  brief: [['M4.4 4.4h15.2v15.2H4.4z', 'M8.6 15.6v-3.4M12 15.6V8.8M15.4 15.6v-5.2'], []],
  // A filing, looked at.
  watch: [['M5.2 3.4h5.4l3.2 3.2v4.2', 'M10.6 3.4v3.2h3.2',
           'M7.4 9.2h3.4', 'M5.2 3.4a1 1 0 00-1 1v14.2a1 1 0 001 1h4.4',
           'M17.9 17.9l2.7 2.7'], ['M15.2 10.4a4.2 4.2 0 100 8.4 4.2 4.2 0 000-8.4zm0 1.9a2.3 2.3 0 110 4.6 2.3 2.3 0 010-4.6z']],
  // A pipeline that has stopped moving.
  stale: [['M3.6 4.6h16.8l-6.4 7.2v4.4', 'M9.6 16.2v-4.4L3.6 4.6'],
          ['M16.6 14.4a3.6 3.6 0 100 7.2 3.6 3.6 0 000-7.2zm.7 1.9v2l1.4.9-.7 1.1-2.1-1.4v-2.6z']],
  // Hours becoming money.
  hours: [['M11 3.6a7.4 7.4 0 100 14.8 7.4 7.4 0 000-14.8z', 'M11 7.4V11l2.6 1.7'],
          ['M17.6 14.2a3.9 3.9 0 100 7.8 3.9 3.9 0 000-7.8zm-1.6 1.9h3.2v.9h-1l.9 1.3-.7.5-1.1-1.6h-.4v-1.1h.6a.5.5 0 000-1h-1.5z']],
  // A carton running low.
  stock: [['M3.6 7.8L11 4l7.4 3.8v7.4L11 19l-7.4-3.8z', 'M3.6 7.8L11 11.6l7.4-3.8M11 11.6V19'],
          ['M19.6 12.4h1.6l-.3 4.2h-1zM20.4 18a.9.9 0 100 1.8.9.9 0 000-1.8z']],
  // A joiner, with a list.
  hire: [['M8.4 4a3 3 0 100 6 3 3 0 000-6z', 'M3 19.6c0-3 2.4-5 5.4-5 1 0 1.9.2 2.7.6',
          'M13.4 12.6h6.8M13.4 15.8h6.8M13.4 19h4'], ['M11.6 12.2h.01']],
  // Past due, going up a level.
  escalate: [['M10.4 3.6a6.8 6.8 0 100 13.6 6.8 6.8 0 000-13.6z', 'M10.4 7v3.4l2.4 1.6'],
             ['M17.6 12.6l3.4 4h-2.2v4.4h-2.4V16.6H14z']],
  // A diya.
  festival: [['M4.4 14.6c0 2.4 3 4.2 6.9 4.2s6.9-1.8 6.9-4.2z', 'M11.3 21.2h5.4'],
             ['M11.3 12.9c1.9-2.3 2.8-3.9 2.8-5.3a2.8 2.8 0 00-5.6 0c0 1.4.9 3 2.8 5.3z']],
  // Filed under something.
  tags: [['M3.4 6.4h5.8l2 2.6h9.4v9.8a1 1 0 01-1 1H4.4a1 1 0 01-1-1V6.4z'],
         ['M15.4 11.4a1.4 1.4 0 100 2.8 1.4 1.4 0 000-2.8z']],
  // The same person, twice.
  dedupe: [['M7.6 4.6h8a1 1 0 011 1v8', 'M4.6 8h8a1 1 0 011 1v8a1 1 0 01-1 1h-8a1 1 0 01-1-1V9a1 1 0 011-1z',
            'M8.6 11a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6z', 'M6 16.4c0-1.4 1.2-2.3 2.6-2.3s2.6.9 2.6 2.3'],
           ['M17.4 15.6l1.6 1.6 3-3.4 1.2 1.1-4.2 4.8-2.8-2.7z']],
  // A week, rostered.
  shifts: [['M4.4 6.4h15.2v13.2H4.4z', 'M8.4 3.6v4M15.6 3.6v4M4.4 10.6h15.2'],
           ['M7.6 12.8h2.4v2.2H7.6zM14 12.8h2.4v2.2H14zM7.6 16.4h2.4v2.2H7.6zM14 16.4h2.4v2.2H14z']],
};

function MkGlyph({ s, size = 42 }) {
  const m = MK_MOD[s.mod];
  const [lines, fills] = MK_SCENES[s.icon] || MK_SCENES.brief;
  return (
    <span className="mk-g" style={{ '--mc': m.c, '--pip': MK_TYPE_TONE[s.type], width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} aria-hidden="true">
        <g fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {lines.map((d, i) => <path key={i} d={d} />)}
        </g>
        {fills.map((d, i) => <path key={i} d={d} fill="#fff" />)}
      </svg>
      <i className="mk-g__pip" title={s.type} />
    </span>
  );
}

function MkVerified() {
  return <span className="mk-v">{M2I.check} Reviewed</span>;
}

function MkStatus({ s }) {
  if (s === 'active') return <span className="mk-st mk-st--active">{M2I.check} Active</span>;
  if (s === 'requested') return <span className="mk-st mk-st--requested">Requested</span>;
  if (s === 'blocked') return <span className="mk-st mk-st--blocked">Unavailable</span>;
  return null;
}

function MkFlow({ steps }) {
  return (
    <div className="mk-flow">
      {steps.map(([k, n], i) => (
        <span className={'mk-flow__s mk-flow__s--' + k} key={i} title={k === 'data' ? 'Reads your data — free' : 'An AI call — costs credits'}>
          <i>{k === 'data' ? 'D' : 'AI'}</i>{n}
        </span>
      ))}
    </div>
  );
}

function MkPrice({ s }) {
  return (
    <span className="mk-price">
      <span className="mk-price__r">{s.run === 0 ? 'Free to run' : s.run + ' credits / run'}</span>
      <span className="mk-price__f">{s.fee ? '₹' + s.fee.toLocaleString('en-IN') + ' one-off' : 'No setup fee'}</span>
    </span>
  );
}

function MkCard({ s, onOpen }) {
  const m = MK_MOD[s.mod];
  return (
    <button className={'mk-c' + (s.status === 'blocked' ? ' mk-c--blocked' : '')} style={{ '--mc': m.c }} onClick={() => onOpen(s)}>
      <span className="mk-c__top">
        <MkGlyph s={s} />
        <span className="mk-c__id">
          <span className="mk-c__n">{s.name}<span lang="hi">{s.hi}</span></span>
          <span className="mk-c__mod"><i />{m.en} · {m.sub} · {s.type}</span>
        </span>
        <MkStatus s={s.status} />
      </span>
      <span className="mk-c__d mk-c__d--clamp">{s.d}</span>
      <MkFlow steps={s.steps} />
      {s.status === 'blocked' ? (
        <span className="mk-c__blk">{M2I.lock} {s.blocker}</span>
      ) : (
        <span className="mk-c__stats">
          <span><b>{s.orgs}</b> firms use it</span>
          <span><b>{s.rating}</b> ★</span>
          {s.sensitive && <span className="mk-sens">{M2I.lock} Sensitive</span>}
        </span>
      )}
      <span className="mk-c__foot">
        <MkPrice s={s} />
        <span style={{ flex: 1 }} />
        <MkVerified />
      </span>
    </button>
  );
}

function MkRow({ s, onOpen }) {
  const m = MK_MOD[s.mod];
  return (
    <button className="mk-row" style={{ '--mc': m.c }} onClick={() => onOpen(s)}>
      <MkGlyph s={s} size={34} />
      <span className="mk-row__b">
        <span className="mk-c__n" style={{ fontSize: 'var(--t-body-sm)' }}>{s.name}<span lang="hi">{s.hi}</span></span>
        <span className="mk-row__d">{s.d}</span>
      </span>
      <span className="mk-price__r" style={{ fontSize: 'var(--t-label)', color: 'var(--on-surface-3)' }}>
        {s.run === 0 ? 'free' : s.run + ' cr'}{s.fee ? ' · ₹' + (s.fee / 1000) + 'k' : ''}
      </span>
      <span className="mk-row__st"><MkStatus s={s.status} /></span>
    </button>
  );
}

// Outcome-first: people do not shop for "skills", they arrive with a problem.
const MK_OUTCOMES = [
  ['Customers pay us late.', ['s1', 's3', 's10']],
  ['Work slips and nobody notices.', ['s8', 's4', 's11']],
  ['Month-end takes three days.', ['s2', 's5', 's10']],
  ['We forget to post anything.', ['s9', 's6']],
];

function MkOutcomes({ onOpen }) {
  return (
    <div className="mk-out">
      {MK_OUTCOMES.map(([q, ids]) => (
        <div className="mk-out__c" key={q}>
          <p className="mk-out__q">{q}</p>
          <div className="mk-out__l">
            {ids.map(id => {
              const s = MK_SKILLS.find(x => x.id === id);
              const m = MK_MOD[s.mod];
              return (
                <button className="mk-out__i" key={id} onClick={() => onOpen(s)} style={{ '--mc': m.c }}>
                  <MkGlyph s={s} size={28} />
                  <b>{s.name}</b>
                  <MkStatus s={s.status} />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function MkDrawer({ s, onClose }) {
  const m = MK_MOD[s.mod];
  const [sent, setSent] = React.useState(s.status === 'requested');
  const [note, setNote] = React.useState('');
  const ai = s.steps.filter(x => x[0] === 'ai').length;
  const data = s.steps.filter(x => x[0] === 'data').length;
  const writes = s.writes.filter(w => !/^Nothing/.test(w));

  return (
    <>
      <div className="mk-dr__scrim" onClick={onClose} />
      <aside className="mk-dr" role="dialog" aria-label={s.name}>
        <div className="mk-dr__hd" style={{ '--mc': m.c }}>
          <MkGlyph s={s} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mk-c__n" style={{ fontSize: 'var(--t-title-lg)' }}>{s.name}<span lang="hi">{s.hi}</span></div>
            <div className="mk-c__mod"><i />{m.en} · {m.sub} · {s.type}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <MkVerified /><MkStatus s={s.status} />
              {s.sensitive && <span className="mk-sens">{M2I.lock} Sensitive data</span>}
            </div>
          </div>
          <button className="icobtn" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
          </button>
        </div>

        <div className="mk-dr__b">
          <p className="mk-c__d" style={{ margin: 0 }}>{s.d}</p>
          {s.every && (
            <div className="sh-aside__scope">{M2I.spark}<span>Runs <b>{s.every}</b>. You can change the schedule or run it by hand at any time.</span></div>
          )}

          <div>
            <div className="mk-sec__t">{M2I.file} What it reads</div>
            <div className="mk-perm">
              {s.reads.map(r => (
                <div className="mk-perm__r mk-perm__r--read" key={r}><i>{M2I.check}</i><span>{r}</span></div>
              ))}
            </div>
          </div>

          <div>
            <div className="mk-sec__t">{M2I.stamp} What it changes</div>
            {writes.length === 0 ? (
              <p className="mk-perm__none">Nothing. This skill only reads and reports.</p>
            ) : (
              <div className="mk-perm">
                {s.writes.map(w => (
                  <div className={'mk-perm__r mk-perm__r--' + (/^Nothing|^Never/.test(w) ? 'read' : 'write')} key={w}>
                    <i>{/^Nothing|^Never/.test(w) ? M2I.check : '!'}</i><span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mk-sec__t">{M2I.task} Steps</div>
            <div className="mk-steps">
              {s.steps.map(([k, n], i) => (
                <div className="mk-step" key={i}>
                  <span className="mk-step__n">{i + 1}</span>
                  <span>
                    <span className="mk-step__t">{k === 'data' ? 'Reads your data' : 'Writes with AI'}</span>
                    <code className="mk-step__k">{n}</code>
                  </span>
                  <span className="mk-step__c">{k === 'data' ? 'free' : 'metered'}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mk-sec__t">{M2I.rupee} What a run costs</div>
            <div className="mk-cost">
              <div className={'mk-cost__r' + (data ? ' mk-cost__r--free' : '')}>
                <span>{data} data {data === 1 ? 'step' : 'steps'}</span><span>{data ? 'free' : '—'}</span>
              </div>
              <div className="mk-cost__r">
                <span>{ai} AI {ai === 1 ? 'step' : 'steps'}</span><span>{ai ? s.run + ' credits' : '—'}</span>
              </div>
              <div className="mk-cost__r mk-cost__r--tot">
                <span>Per run</span><span>{s.run === 0 ? 'free' : s.run + ' credits'}</span>
              </div>
              <div className="mk-cost__r">
                <span>One-off setup</span><span>{s.fee ? '₹' + s.fee.toLocaleString('en-IN') : 'none'}</span>
              </div>
            </div>
            <p className="mk-ctx__foot" style={{ padding: '8px 0 0' }}>
              Credit costs come from the live cost table, not from this page. A figure printed here that
              disagreed with what you were charged would be worse than no figure.
            </p>
          </div>
        </div>

        <div className="mk-dr__foot">
          {s.status === 'active' ? (
            <>
              <button className="btn btn--fill btn--sm">Run now</button>
              <button className="btn btn--out btn--sm">Change schedule</button>
              <span style={{ flex: 1 }} />
              <span className="mk-price__f">{s.runs.toLocaleString('en-IN')} runs on your org</span>
            </>
          ) : s.status === 'blocked' ? (
            <span className="mk-c__blk" style={{ flex: 1 }}>{M2I.lock} {s.blocker}</span>
          ) : sent ? (
            <div className="mk-sent" style={{ flex: 1 }}>
              <span style={{ color: 'var(--warn)', display: 'grid' }}>{M2I.spark}</span>
              <span>
                <b>Requested — Aekam has it</b>
                <p>You will get an email when it is switched on, usually the same working day. Nothing is charged
                until it runs, and the first run is yours to trigger.</p>
              </span>
            </div>
          ) : (
            <div style={{ flex: 1 }}>
              <div className="mk-req">
                <div className="mk-req__t">{M2I.spark} Aekam turns this on for you</div>
                <div className="mk-req__d">
                  Adding a skill changes what everyone in your organisation can run and what it costs, so it is
                  switched on by your account contact rather than self-served. Say what you want it for and the
                  request goes with that context attached.
                </div>
                <textarea value={note} onChange={e => setNote(e.target.value)}
                  placeholder="Optional — what should it do for you, and how often?" />
              </div>
              <div style={{ display: 'flex', gap: 9, marginTop: 11, alignItems: 'center' }}>
                <button className="btn btn--fill btn--sm" onClick={() => setSent(true)}>Request this skill</button>
                <button className="btn btn--out btn--sm" onClick={onClose}>Not now</button>
                <span style={{ flex: 1 }} />
                <MkPrice s={s} />
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

Object.assign(window, { MK_MOD, MK_TYPE_IC, MK_TYPE_TONE, MK_SCENES, MK_OUTCOMES, MkGlyph, MkCard, MkRow, MkDrawer, MkFlow, MkPrice, MkStatus, MkVerified, MkOutcomes });
