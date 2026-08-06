// Sahayak — the assistant surface. Three layouts, one answer contract.
//
//   cited   the answer runs as prose with numbered cites; a sources panel lists
//           every record read. Best for questions whose answer is a judgement.
//   answer  figures first, prose second, no panel. Best for questions whose
//           answer is a number, which is most of them in an accounting product.
//   split   the answer beside the actual rows it was computed from, so the
//           reader can check it rather than trust it.

function ShWork({ rows }) {
  return (
    <div className="sh__work">
      {rows.map((r, i) => (
        <div className={'sh__work-r ' + r.s} key={i}>
          <i />{r.t} <code>{r.k}</code>
        </div>
      ))}
    </div>
  );
}

function ShFigs({ figs }) {
  return (
    <div className="sh__figs">
      {figs.map(f => (
        <div className="sh__fig" key={f.l} title={f.k}>
          <span className="sh__fig-l">{f.l}</span>
          <span className="sh__fig-v">{f.v}</span>
          <span className="sh__fig-s">{f.s}</span>
        </div>
      ))}
    </div>
  );
}

function ShProse({ body }) {
  return (
    <>
      {body.map((p, i) => (
        <p className="sh__p" key={i}>
          {p.t}
          {p.c && p.c.map(([n, k]) => <cite key={n} title={k}>{n}</cite>)}
          {p.after ? ' ' + p.after : ''}
        </p>
      ))}
    </>
  );
}

function ShEvidence({ ev, srcs }) {
  return (
    <div className="sh__side">
      <div className="sh__side-hd">{M2I.file} The rows behind it</div>
      <div className="sh__side-b">
        <table className="sh-ev">
          <thead><tr>{ev.cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {ev.rows.map(r => (
              <tr key={r[0]}>
                {r.map((c, i) => (
                  <td key={i} className={i === 2 || i === 3 ? 'num' : ''}>
                    {i === 4 && c === 'never' ? <span className="sh-src__w">never</span> : c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sh__side-note" style={{ margin: '4px 0 0' }}>
          This is the query result, not a copy of it. Every figure above is computed from these six rows —
          change one in Ganit and ask again, and the answer moves.
        </p>
      </div>
    </div>
  );
}

function ShSources({ srcs }) {
  return (
    <div className="sh__side">
      <div className="sh__side-hd">{M2I.file} Sources</div>
      <div className="sh__side-b">
        {srcs.map(s => (
          <button className="sh-src" key={s.k}>
            <span className="sh-src__t">{s.t}<span className="sh-src__n">{s.n}</span></span>
            <span className="sh-src__k">{s.k}</span>
          </button>
        ))}
      </div>
      <p className="sh__side-note">
        Only records your own role can open. A question whose answer sits behind a permission you do not
        hold returns the refusal, not the answer — the assistant is not a way around access.
      </p>
    </div>
  );
}

function ShTurn({ turn, layout, thinking }) {
  const [fb, setFb] = React.useState(null);
  return (
    <div className="sh__turn">
      <div className="sh__you">{turn.q}</div>
      <span className="sh__me-l">{turn.at}</span>
      <div className="sh__a">
        {/* The lotus, at rest beside a finished reply and drawing while one is on
            its way. Same component as the boot gate — no second spinner. */}
        <span className="sh__a-av sh__a-av--mark">
          <BrandLoader size={30} label={thinking ? 'Thinking' : 'Sahayak'} />
        </span>
        <div className="sh__a-b">
          {thinking ? (
            <>
              <ShWork rows={turn.work.map((r, i) => ({ ...r, s: i === 0 ? 'done' : i === 1 ? 'now' : 'wait' }))} />
              <div className="sh__wait">Reading your follow-ups…</div>
            </>
          ) : (
            <>
              <ShWork rows={turn.work} />
          {layout === 'answer' && <ShFigs figs={turn.figs} />}
          <ShProse body={turn.body} />
          {layout !== 'answer' && <ShFigs figs={turn.figs} />}
          <div className="sh-none">
            <b>{turn.none.t}</b>
            <p>{turn.none.d}</p>
          </div>
          <div className="sh__acts">
            {turn.acts.map(a => <button className="btn btn--out btn--sm" key={a}>{a}</button>)}
          </div>
          <div className="sh__fb">
            <span className="sh__cost">{turn.cost}</span>
            <span style={{ flex: 1 }} />
            <button className={fb === 'up' ? 'on' : ''} onClick={() => setFb('up')} aria-label="Helpful">👍</button>
            <button className={fb === 'down' ? 'on' : ''} onClick={() => setFb('down')} aria-label="Not helpful">👎</button>
          </div>
              {fb === 'down' && (
                <div className="sh-none">
                  <b>What was wrong?</b>
                  <p>Wrong figure · Missed a record · Cited the wrong source · Should not have answered. Feedback is stored
                  against the skill, not the conversation, so it improves the next person’s answer too.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ShAsk({ layout, thinking }) {
  const [asked, setAsked] = React.useState(true);
  const [q, setQ] = React.useState('');
  const turn = SH_TURNS[0];
  const wide = layout === 'answer';
  return (
    <div className={'sh' + (wide ? ' sh--wide' : '')}>
      <div className="sh__main">
        <div className="sh__thread">
          {!asked ? (
            <div className="sh__hero" style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <BrandLoader size={104} label="Sahayak" />
              </div>
              <p className="sh__hero-hi" lang="hi">सहायक</p>
              <h1 className="sh__hero-t">Ask about your own books.</h1>
              <p className="sh__hero-d" style={{ margin: '0 auto' }}>
                Sahayak reads what is already in Kartavaya — invoices, tasks, attendance, messages, files —
                and answers with the records it used. It will not answer from general knowledge, and it will
                not answer at all where the data does not support one.
              </p>
              <div className="sh__seeds" style={{ textAlign: 'left' }}>
                {SH_SEEDS.map(([s, d]) => (
                  <button className="sh__seed" key={s} onClick={() => setAsked(true)}><b>{s}</b><span>{d}</span></button>
                ))}
              </div>
            </div>
          ) : (
            <div className="sh__wrap"><ShTurn turn={turn} layout={layout} thinking={thinking} /></div>
          )}
        </div>
        <div className="sh__cp">
          <div className="sh__cp-w">
            <div className="sh__cp-box">
              <textarea rows="1" value={q} onChange={e => setQ(e.target.value)}
                placeholder="Ask about invoices, tasks, people, attendance…" />
              <div className="sh__cp-foot">
                <span className="sh__scope">{M2I.users} Scope <b>Whole organisation</b></span>
                <span className="sp" />
                <span className="sh__cost">~2 credits</span>
                <button className="btn btn--fill btn--sm" disabled={!q.trim()}>{M2I.send} Ask</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {!wide && asked && !thinking && (layout === 'split' ? <ShEvidence ev={turn.ev} srcs={turn.srcs} /> : <ShSources srcs={turn.srcs} />)}
    </div>
  );
}

Object.assign(window, { ShAsk, ShTurn, ShSources, ShEvidence, ShWork, ShFigs, ShProse });
