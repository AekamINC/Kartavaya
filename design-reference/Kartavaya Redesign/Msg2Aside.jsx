// Messaging v2 — the Sahayak side panel.
// The same assistant as the module, scoped to the open conversation. Scope is
// stated at the top because "summarise this" is a different question in a
// channel of nine and a WhatsApp thread with a customer, and the reader has to
// know which one they are asking.

function M2Aside({ cv, onClose }) {
  const P = M2_PEOPLE;
  const name = cv.kind === 'dm' ? P[cv.who].name : cv.name;
  const wa = cv.kind === 'wa';
  const [answered, setAnswered] = React.useState(false);

  const asks = wa
    ? [['Summarise this customer’s thread', 'What they have asked for, and what we promised'],
       ['Draft a reply', 'In the window, so it can go as free text'],
       ['What do we owe them?', 'Open invoices, quotations and orders for this contact']]
    : [['Catch me up', 'Everything since you last read'],
       ['What was decided?', 'Decisions only, with who said them'],
       ['Turn this into tasks', 'Proposed — nothing is created until you confirm'],
       ['Draft a reply', 'From the last few messages and your files']];

  return (
    <div className="m2__col sh-aside">
      <div className="sh-aside__hd">
        <span className="sh-card__ic">{M2I.spark}</span>
        <span className="sh-aside__t">Sahayak<span lang="hi">सहायक</span></span>
        <span style={{ flex: 1 }} />
        <button className="icobtn" onClick={onClose} aria-label="Close the assistant panel">
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
        </button>
      </div>
      <div className="sh-aside__body">
        <div className="sh-aside__scope">
          {M2I.hash}
          <span>Reading <b>{wa ? name : '#' + name}</b> only — and the records you can already open yourself.</span>
        </div>

        {!answered ? (
          <div className="sh-ask">
            {asks.map(([q, d]) => (
              <button className="sh-ask__q" key={q} onClick={() => setAnswered(true)}>
                {M2I.spark}
                <span><b style={{ display: 'block', fontWeight: 600 }}>{q}</b><span style={{ fontSize: 'var(--t-label-sm)', color: 'var(--on-surface-3)' }}>{d}</span></span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="sh-card">
              <div className="sh-card__hd">
                <span className="sh-card__ic">{M2I.spark}</span><b>What was decided</b>
              </div>
              <ol className="sh-pts">
                <li>
                  <span className="sh-pts__t">HSN 7208 is correct for hot-rolled coil, and both invoices were patched.</span>
                  <span className="sh-pts__src"><cite title="#gst-filings · 4:41 pm">Anil, 4:41 pm</cite><cite title="GET /v1/ganit/invoices?ids=INV-2291,INV-2304">Ganit · 2 invoices</cite></span>
                </li>
                <li>
                  <span className="sh-pts__t">Filing is set for the 20th, conditional on your sign-off.</span>
                  <span className="sh-pts__src"><cite title="#gst-filings · 4:58 pm">Rohan, 4:58 pm</cite></span>
                </li>
                <li>
                  <span className="sh-pts__t">Tata working papers are frozen until partner review.</span>
                  <span className="sh-pts__src"><cite title="#gst-filings · 11:22 am">Rohan, 11:22 am</cite></span>
                </li>
              </ol>
              <div className="sh-card__foot">
                <span>3 messages and 2 records · 2 credits</span>
                <span style={{ flex: 1 }} />
                <button className="icobtn" title="Helpful">👍</button>
                <button className="icobtn" title="Not helpful">👎</button>
              </div>
            </div>
            <div className="sh-none">
              <b>One thing it would not answer</b>
              <p>You asked what the ITC mismatch total is. Nobody has stated it in this channel and the reconciliation has not been run since Friday, so there is no figure to quote. Open <b>Ganit → Bank</b> to run it.</p>
            </div>
            <button className="btn btn--out btn--sm" onClick={() => setAnswered(false)}>Ask something else</button>
          </>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { M2Aside });
