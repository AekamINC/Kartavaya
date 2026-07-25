/* Light module surfaces — mobile gets the CHECKING view, not the doing view.
   Each is one screen answering the question you'd actually open your phone for.
   Full authoring stays on desktop; every screen says so where it matters. */
const { useState: uL } = React;

const MODS = {
  crm: { hi: 'ग्रह', en: 'CRM', full: 'Graha' },
  fin: { hi: 'गणित', en: 'Finance', full: 'Ganit' },
  hr: { hi: 'मानव', en: 'HRMS', full: 'Manav' },
  pay: { hi: 'वेतन', en: 'Payslips', full: 'Vetana' },
  rep: { hi: 'दृष्टि', en: 'Reports', full: 'Dristi' },
  ai: { hi: 'सृजन', en: 'Assistant', full: 'Srijan' },
  sign: { hi: 'हस्ताक्षर', en: 'eSign', full: 'Hastakshar' },
};

const inr = n => '₹' + n.toLocaleString('en-IN');

function MStat({ v, l, c }) { return <div className="mlm__stat"><b style={c ? { color: c } : null}>{v}</b><i>{l}</i></div>; }

function MModule({ m, back, os, go }) {
  const [tab, setTab] = uL(0);
  const [ask, setAsk] = uL('');
  const [sent, setSent] = uL(null);
  const M = MODS[m] || MODS.crm;

  const head = (
    <div className="mtop mtd__top" style={{ paddingTop: os === 'ios' ? 56 : 36 }}>
      <button className="micon" onClick={back}>{TI.chevL}</button>
      <span className="mtd__topt">{M.en} <i className="hi">{M.hi}</i></span>
      <span style={{ width: 28 }} />
    </div>
  );

  let body = null;

  if (m === 'crm') {
    const DEALS = [
      { n: 'Nirmal Exports — FY27 retainer', v: 840000, s: 'Proposal', c: 'var(--warn)', d: 'Follow up today', hot: true },
      { n: 'Tata Steel — audit support', v: 1250000, s: 'Negotiation', c: 'var(--primary)', d: 'Call Thu 11:00' },
      { n: 'Sharma & Co — GST advisory', v: 320000, s: 'Qualified', c: 'var(--on-surface-3)', d: 'Awaiting docs' },
      { n: 'Vora Textiles — payroll', v: 480000, s: 'Won', c: 'var(--ok)', d: 'Closed 21 Jul' },
    ];
    body = <>
      <div className="mlm__stats"><MStat v={inr(2890000)} l="Open pipeline" /><MStat v="4" l="Deals" /><MStat v="1" l="Overdue" c="var(--danger)" /></div>
      <div className="msec" style={{ padding: '0 2px 2px' }}><span>Deals</span><span>this quarter</span></div>
      {DEALS.map(d => (
        <div className="mlm__deal" key={d.n}>
          <span className="mlm__dealh"><b>{d.n}</b>{d.hot && <em className="mlm__hot">Due</em>}</span>
          <span className="mlm__dealm"><i className="mlm__stage" style={{ '--c': d.c }}>{d.s}</i><span className="mono">{inr(d.v)}</span></span>
          <span className="mlm__dealn">{d.d}</span>
        </div>
      ))}
      <p className="mst__note" style={{ margin: '6px 2px 0' }}>Logging a call or moving a stage happens on desktop — the phone is for knowing what's due.</p>
    </>;
  }

  if (m === 'fin') {
    const INV = [
      { n: 'INV-2026-118', c: 'Nirmal Exports', v: 248000, s: 'Overdue 9d', k: 'od' },
      { n: 'INV-2026-121', c: 'Tata Steel', v: 590000, s: 'Sent', k: 'sent' },
      { n: 'INV-2026-115', c: 'Sharma & Co', v: 84000, s: 'Paid 21 Jul', k: 'paid' },
      { n: 'INV-2026-112', c: 'Vora Textiles', v: 162000, s: 'Paid 14 Jul', k: 'paid' },
    ];
    body = <>
      <div className="mlm__stats"><MStat v={inr(838000)} l="Outstanding" c="var(--danger)" /><MStat v={inr(246000)} l="Collected, Jul" c="var(--ok)" /><MStat v="9d" l="Oldest overdue" /></div>
      <div className="msec" style={{ padding: '0 2px 2px' }}><span>Invoices</span><span>4</span></div>
      {INV.map(i => (
        <div className="mlm__row" key={i.n}>
          <span className="mlm__rowb"><b>{i.c}</b><i className="mono">{i.n}</i></span>
          <span className="mlm__rowr"><b className="mono">{inr(i.v)}</b><em className={'mlm__tag ' + i.k}>{i.s}</em></span>
        </div>
      ))}
      <p className="mst__note" style={{ margin: '6px 2px 0' }}>GST filing, ledgers and invoice creation are desktop work. Sending a payment reminder is not — that button belongs here.</p>
      <button className="mbtn" style={{ marginTop: 4 }}>Send reminder for INV-2026-118</button>
    </>;
  }

  if (m === 'hr') {
    const LEAVE = [
      { n: 'Priya Nair', t: 'Casual leave · 2 days', d: '28–29 Jul', note: 'Family function' },
      { n: 'Vikram Desai', t: 'Sick leave · 1 day', d: '26 Jul', note: 'Fever' },
    ];
    body = <>
      <div className="mlm__stats"><MStat v="19" l="Present" c="var(--ok)" /><MStat v="2" l="Late" c="var(--warn)" /><MStat v="1" l="On leave" /><MStat v="2" l="To approve" c="var(--warn)" /></div>
      <div className="msec" style={{ padding: '0 2px 2px' }}><span>Leave requests</span><span>2</span></div>
      {LEAVE.map(l => (
        <div className="mlm__leave" key={l.n}>
          <AvT n={l.n} s={34} />
          <span className="mlm__rowb"><b>{l.n}</b><i>{l.t} · {l.d}</i><em className="mlm__note">{l.note}</em></span>
          <span className="mlm__act"><button className="mlm__ok">{TI.ok}</button><button className="mlm__no">{TI.no}</button></span>
        </div>
      ))}
      <p className="mst__note" style={{ margin: '6px 2px 0' }}>Approving here posts to the same leave ledger as desktop. Rejecting asks for a reason first.</p>
    </>;
  }

  if (m === 'pay') {
    const SLIPS = [['July 2026', 94820, 'Processing'], ['June 2026', 94820, 'Paid 30 Jun'], ['May 2026', 91400, 'Paid 31 May'], ['April 2026', 91400, 'Paid 30 Apr']];
    body = <>
      <div className="mlm__pay">
        <span className="mlm__payk">LATEST NET PAY · JUNE 2026</span>
        <b className="mono">{inr(94820)}</b>
        <i>Credited 30 Jun to HDFC ••4412</i>
      </div>
      <div className="msec" style={{ padding: '0 2px 2px' }}><span>Payslips</span><span>FY 2026–27</span></div>
      {SLIPS.map(([mo, v, s]) => (
        <div className="mlm__row" key={mo}>
          <span className="mlm__rowb"><b>{mo}</b><i>{s}</i></span>
          <span className="mlm__rowr"><b className="mono">{inr(v)}</b><em className="mlm__dl">{TI.doc} PDF</em></span>
        </div>
      ))}
      <p className="mst__note" style={{ margin: '6px 2px 0' }}>You only ever see your own payslips here. Vetana is a sensitive module — nobody's grants leak onto this screen.</p>
    </>;
  }

  if (m === 'rep') {
    const BARS = [['Apr', 62], ['May', 71], ['Jun', 58], ['Jul', 84]];
    body = <>
      <div className="mlm__stats"><MStat v="84%" l="On-time filing" c="var(--ok)" /><MStat v="11" l="Open tasks" /><MStat v="2.4d" l="Avg approval" /></div>
      <div className="msec" style={{ padding: '0 2px 2px' }}><span>Tasks completed</span><span>last 4 months</span></div>
      <div className="mlm__chart">
        {BARS.map(([l, v]) => <span key={l} className="mlm__bar"><i style={{ height: v + '%' }} /><em>{l}</em><b>{v}</b></span>)}
      </div>
      <div className="msec" style={{ padding: '8px 2px 2px' }}><span>By project</span></div>
      {[['Quarterly GST', 84, 'var(--primary)'], ['Mumbai fit-out', 61, 'var(--danger)'], ['Diwali campaign', 44, 'var(--warn)']].map(([n, p, c]) => (
        <div className="mlm__pr" key={n}><span>{n}</span><span className="mlm__prbar"><i style={{ width: p + '%', background: c }} /></span><b className="mono">{p}%</b></div>
      ))}
      <p className="mst__note" style={{ margin: '6px 2px 0' }}>Report builders, filters and exports are desktop. This is the glance version.</p>
    </>;
  }

  if (m === 'ai') {
    const SUGG = ['What is due this week?', 'Summarise the GST board', 'Who is waiting on me?', 'Draft a reminder to Nirmal'];
    body = <>
      {!sent ? (
        <div className="mlm__ai">
          <span className="mlm__aik">सृजन</span>
          <b>Ask about your work</b>
          <i>Srijan reads only what you already have access to. It cannot see other people's tasks, payroll, or another org's data.</i>
        </div>
      ) : (
        <div className="mlm__thread">
          <div className="mlm__q">{sent}</div>
          <div className="mlm__a">
            <span className="mlm__ak">सृजन</span>
            <p>Three things are due this week: <b>GSTR-3B for July</b> (20 Aug, 3 of 5 subtasks done), <b>Reconcile 2B mismatches</b> (18 Aug), and <b>TDS challan for Q1</b> — that last one is waiting on your approval, not your work.</p>
            <p className="mlm__acite">Drawn from 3 tasks on Quarterly GST. Nothing outside your grants was read.</p>
          </div>
        </div>
      )}
      <div className="mlm__sugg">
        {SUGG.map(s => <button key={s} className="mlm__suggb" onClick={() => { setSent(s); setAsk(''); }}>{s}</button>)}
      </div>
      <div className="mtd__comprow" style={{ marginTop: 'auto', paddingTop: 10 }}>
        <input className="mtd__compi" placeholder="Ask Srijan…" value={ask} onChange={e => setAsk(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && ask.trim()) { setSent(ask.trim()); setAsk(''); } }} />
        <button className="mtd__send" disabled={!ask.trim()} onClick={() => { setSent(ask.trim()); setAsk(''); }}>{TI.send}</button>
      </div>
    </>;
  }

  if (m === 'sign') {
    const DOCS = [
      { n: 'Service agreement — Tata Steel', w: 'Waiting on you', k: 'me', d: 'Sent 24 Jul by Rohit Shah' },
      { n: 'NDA — Sharma & Co', w: 'Waiting on client', k: 'them', d: 'Sent 22 Jul · reminder sent' },
      { n: 'Engagement letter — Vora', w: 'Signed', k: 'done', d: 'Completed 19 Jul · 2 signatories' },
    ];
    body = <>
      <div className="mlm__stats"><MStat v="1" l="Awaiting you" c="var(--warn)" /><MStat v="1" l="Awaiting others" /><MStat v="1" l="Completed" c="var(--ok)" /></div>
      {DOCS.map(d => (
        <div className={'mlm__doc' + (d.k === 'me' ? ' me' : '')} key={d.n}>
          <span className="mlm__docic">{TI.doc}</span>
          <span className="mlm__rowb"><b>{d.n}</b><i>{d.d}</i></span>
          {d.k === 'me' ? <button className="mlm__signb">Review &amp; sign</button> : <em className={'mlm__tag ' + (d.k === 'done' ? 'paid' : 'sent')}>{d.w}</em>}
        </div>
      ))}
      <p className="mst__note" style={{ margin: '6px 2px 0' }}>Signing on a phone needs the full document readable first — tapping opens the paged view, not a signature box.</p>
    </>;
  }

  return <>{head}<div className="mbody mlm">{body}</div></>;
}

Object.assign(window, { MModule, MODS });
