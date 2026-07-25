// Ganit (Finance/GST) + Vikray (Sales) — keyboard-first finance per research rule 9
function ScreenGanit({ open, kbd }) {
  const [tab, setTab] = React.useState('invoices');
  const recv = INVOICES.filter(i => i.st !== 'paid' && i.st !== 'draft').reduce((a, i) => a + i.amt + i.gst, 0);
  const overdue = INVOICES.filter(i => i.st === 'overdue').reduce((a, i) => a + i.amt + i.gst, 0);
  const gstOut = INVOICES.filter(i => i.st !== 'draft').reduce((a, i) => a + i.gst, 0);

  return (
    <div className="screen">
      <PH kick="Revenue · राजस्व" hi="गणित" en="Finance & GST"
        lede="GSTR-3B due 20 Aug. Two invoices are missing HSN codes — they'd fail e-invoice validation."
        right={<>
          <button className="btn btn--out btn--sm" onClick={() => open('scan')}>{I.doc} Scan bill</button>
          <button className="btn btn--fill btn--sm" onClick={() => open('invoice')}>{I.plus} Invoice <kbd className="kbd" style={{ marginLeft: 2 }}>N</kbd></button>
        </>} />

      <div className="stats">
        <Stat kind="warn" lbl="Receivables" hi="प्राप्य" v={lakh(recv)} sub={lakh(overdue) + ' overdue'} />
        <Stat kind="danger" lbl="Overdue > 45d" hi="विलंब" v="1" sub="MSME rule 43B(h)" />
        <Stat kind="p" lbl="GST payable" hi="कर देय" v={lakh(gstOut)} sub="GSTR-3B · 20 Aug" />
        <Stat kind="ok" lbl="ITC available" hi="क्रेडिट" v={lakh(184000)} sub="2B reconciled" />
        <Stat lbl="Cash in bank" hi="बैंक" v={lakh(2870000)} sub="3 accounts" />
      </div>

      <div className="between">
        <div style={{ flex: 1, minWidth: 0 }}><TabBar tabs={MODULE_TABS.ganit} val={tab} set={setTab} counts={{ invoices: INVOICES.length, payables: 8 }} /></div>
        <button className="btn btn--text btn--sm" style={{ flexShrink: 0 }} onClick={kbd}>Shortcuts <kbd className="kbd">?</kbd></button>
      </div>

      {!['invoices', 'stats', 'expenses', 'payables', 'bank'].includes(tab) && <TabStub tab={tab} module="गणित Finance" />}

      {tab === 'invoices' && (
        <div className="tbl">
          <div className="tbl__scroll">
            <div className="tbl__head" style={{ gridTemplateColumns: '92px minmax(0,1.4fr) 120px 120px 110px 110px' }}>
              <span>No.</span><span>Party</span><span>Place of supply</span><span style={{ textAlign: 'right' }}>Taxable</span><span style={{ textAlign: 'right' }}>GST</span><span>Status</span>
            </div>
            {INVOICES.map(inv => {
              const [lbl, c] = INV_ST[inv.st];
              return (
                <button key={inv.id} className="tbl__row" style={{ gridTemplateColumns: '92px minmax(0,1.4fr) 120px 120px 110px 110px' }} onClick={() => open('invoice', inv)}>
                  <span className="tbl__c"><span className="tbl__id">{inv.id}</span></span>
                  <span className="tbl__c" style={{ minWidth: 0 }}>
                    <span style={{ minWidth: 0 }}>
                      <span className="tbl__t" style={{ display: 'block' }}>{inv.co}</span>
                      {inv.msme && <span className="tbl__s" style={{ color: 'var(--warn)' }}>MSME · 45-day rule</span>}
                    </span>
                  </span>
                  <span className="tbl__c"><span className="tbl__s">{inv.pos}</span>{inv.igst ? <Tag c="#7c5cbf">IGST</Tag> : <Tag c="#04837A">C+S</Tag>}</span>
                  <span className="tbl__c tbl__c--num">{inr(inv.amt)}</span>
                  <span className="tbl__c tbl__c--num mute">{inr(inv.gst)}</span>
                  <span className="tbl__c"><Tag c={c}>{lbl}</Tag></span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'stats' && (
        <div className="two">
          <div className="col">
            <div className="card" style={{ borderColor: 'color-mix(in srgb, var(--warn) 50%, var(--outline-variant))' }}>
              <div className="card__head"><div className="card__titles"><h3 className="card__title">Pre-filing validation</h3><span className="card__hi">जाँच</span></div><Tag c="#A66207">2 blockers</Tag></div>
              <div className="card__body col" style={{ gap: 10 }}>
                {[['HSN/SAC missing on INV-2604', 'Blocks e-invoice IRN generation', true],
                  ['GSTIN checksum invalid — Nirmal Exports', 'Recipient ITC will be blocked', true],
                  ['Place of supply derived from GSTIN prefix', '5 invoices auto-classified IGST', false]].map(([t, s, bad], i) => (
                  <div key={i} className="rowflex" style={{ gap: 10, padding: '10px 12px', background: bad ? 'var(--danger-container)' : 'var(--ok-container)', borderRadius: 'var(--r-sm)' }}>
                    <span style={{ color: bad ? 'var(--danger)' : 'var(--ok)', flexShrink: 0 }}>{bad ? I.clock : I.check}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{t}</span>
                      <span className="mute" style={{ fontSize: 11.5 }}>{s}</span>
                    </span>
                    {bad && <button className="btn btn--out btn--sm" style={{ marginLeft: 'auto', flexShrink: 0 }}>Fix</button>}
                  </div>
                ))}
              </div>
            </div>
            <Card title="GSTR-3B summary" hi="विवरणी" right={<span className="mute mono" style={{ fontSize: 11 }}>Jul 2026</span>}>
              <div className="col" style={{ gap: 0 }}>
                {[['Outward taxable supplies', 2450000, 441000], ['Inward supplies (reverse charge)', 120000, 21600], ['Eligible ITC', -1020000, -183600], ['Net tax payable', 1550000, 279000]].map(([l, tx, gst], i) => (
                  <div key={i} className="between" style={{ padding: '11px 0', borderBottom: i < 3 ? '1px solid var(--outline-variant)' : 0, fontWeight: i === 3 ? 600 : 400 }}>
                    <span style={{ fontSize: 13 }}>{l}</span>
                    <span className="rowflex" style={{ gap: 20 }}>
                      <span className="mono" style={{ fontSize: 13, color: 'var(--on-surface-3)' }}>{inr(Math.abs(tx))}</span>
                      <span className="mono" style={{ fontSize: 13, minWidth: 84, textAlign: 'right', color: i === 3 ? 'var(--primary)' : 'inherit' }}>{inr(Math.abs(gst))}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <div className="col">
            <Card title="File & share" hi="प्रेषण">
              <div className="col" style={{ gap: 9 }}>
                <button className="btn btn--fill" style={{ width: '100%' }}>{I.send} Share with CA</button>
                <button className="btn btn--tonal" style={{ width: '100%' }}>{I.doc} Export GSTR-1 JSON</button>
                <button className="btn btn--out" style={{ width: '100%' }}>{I.doc} Export GSTR-3B</button>
                <button className="btn btn--out" style={{ width: '100%' }}>Tally export (XML)</button>
                <div className="mute" style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 4 }}>Kartavaya is a registered GSP — invoices upload to the IRP directly. Last sync 14 min ago.</div>
              </div>
            </Card>
            <Card title="Reconciliation" hi="मेल">
              <div className="col" style={{ gap: 12 }}>
                <div>
                  <div className="between" style={{ fontSize: 12, marginBottom: 6 }}><span className="mute">GSTR-2B matched</span><b className="mono">42 / 47</b></div>
                  <div className="meter"><div className="meter__f" style={{ width: '89%' }} /></div>
                </div>
                <div className="rowflex" style={{ gap: 8, fontSize: 12 }}>
                  <Tag c="#B42318">3 mismatched</Tag><Tag c="#A66207">2 missing</Tag>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {(tab === 'expenses' || tab === 'payables') && (
        <Card flush>
          <Empty ic={I.doc} t="Scan a bill to start" s="Point your camera at a purchase invoice — HSN, GSTIN and tax split are read automatically. Manual entry is available too."
            action={<div className="rowflex" style={{ gap: 8, marginTop: 6 }}><button className="btn btn--fill btn--sm" onClick={() => open('scan')}>{I.doc} Scan</button><button className="btn btn--out btn--sm">Enter manually</button></div>} />
        </Card>
      )}

      {tab === 'bank' && (
        <div className="grid">
          {[['HDFC Bank', '••4821', 1840000, 'Current'], ['ICICI Bank', '••7735', 890000, 'Current'], ['Kotak', '••1192', 140000, 'Savings']].map(([n, no, bal, kind]) => (
            <div key={n} className="card" style={{ padding: 'var(--pad-card)' }}>
              <div className="between"><b style={{ fontSize: 13.5 }}>{n}</b><span className="mute mono" style={{ fontSize: 11 }}>{no}</span></div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, marginTop: 8 }}>{lakh(bal)}</div>
              <div className="between" style={{ marginTop: 6 }}><span className="mute" style={{ fontSize: 11.5 }}>{kind}</span><Tag c="#04837A">Reconciled</Tag></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Vikray (Sales) — quote → sign → invoice as one flow ────────────────
function ScreenVikray({ open }) {
  const [tab, setTab] = React.useState('pipeline');
  const QUOTES = [
    { id: 'QT-118', co: 'Wipro Consumer', v: 3400000, st: 'signed', stage: 3, own: 'Aanya Mehta' },
    { id: 'QT-117', co: 'Bharat Forge', v: 2100000, st: 'sent', stage: 2, own: 'Keval Shah' },
    { id: 'QT-116', co: 'Godrej Interio', v: 1240000, st: 'viewed', stage: 2, own: 'Rohan Iyer' },
    { id: 'QT-115', co: 'Kalyan Jewellers', v: 640000, st: 'draft', stage: 1, own: 'Aanya Mehta' },
    { id: 'QT-114', co: 'Asian Paints', v: 1560000, st: 'invoiced', stage: 4, own: 'Keval Shah' },
  ];
  const QST = { draft: ['Draft', '#8E8D87'], sent: ['Sent', '#0082c6'], viewed: ['Viewed', '#7c5cbf'], signed: ['Signed', '#04837A'], invoiced: ['Invoiced', '#04837A'] };
  const FLOW = ['Quote', 'Sent', 'Signed', 'Invoiced', 'Paid'];

  return (
    <div className="screen">
      <PH kick="Revenue · राजस्व" hi="विक्रय" en="Sales"
        lede="Quote, signature and invoice are one object — nothing is retyped between stages."
        right={<button className="btn btn--fill btn--sm" onClick={() => open('quote')}>{I.plus} New quote</button>} />

      <div className="stats">
        <Stat kind="p" lbl="Quoted (open)" hi="प्रस्तावित" v={lakh(5620000)} sub="4 quotes live" />
        <Stat kind="ok" lbl="Signed this month" hi="स्वीकृत" v={lakh(4960000)} trend={31} />
        <Stat lbl="Win rate" hi="सफलता" v="58%" sub="12 of 21 quotes" />
        <Stat kind="warn" lbl="Awaiting signature" hi="प्रतीक्षा" v="2" sub="oldest 6 days" />
      </div>

      <TabBar tabs={MODULE_TABS.vikray} val={tab} set={setTab} counts={{ orders: QUOTES.length }} />
      {!['pipeline', 'dashboard'].includes(tab) && <TabStub tab={tab} module="विक्रय Sales" />}

      <Card title="Quote to cash" hi="प्रस्ताव से भुगतान" flush>
        <div className="tbl__scroll">
          <div className="tbl__head" style={{ gridTemplateColumns: '86px minmax(0,1.2fr) 110px minmax(0,1.5fr) 100px' }}>
            <span>Quote</span><span>Party</span><span style={{ textAlign: 'right' }}>Value</span><span>Progress</span><span>Owner</span>
          </div>
          {QUOTES.map(q => {
            const [lbl, c] = QST[q.st];
            return (
              <button key={q.id} className="tbl__row" style={{ gridTemplateColumns: '86px minmax(0,1.2fr) 110px minmax(0,1.5fr) 100px' }} onClick={() => open('quote', q)}>
                <span className="tbl__c"><span className="tbl__id">{q.id}</span></span>
                <span className="tbl__c"><span className="tbl__t">{q.co}</span></span>
                <span className="tbl__c tbl__c--num">{lakh(q.v)}</span>
                <span className="tbl__c" style={{ gap: 4 }}>
                  {FLOW.map((f, i) => (
                    <span key={f} title={f} style={{ flex: 1, height: 5, borderRadius: 9, background: i < q.stage ? c : 'var(--s-highest)' }} />
                  ))}
                  <Tag c={c}>{lbl}</Tag>
                </span>
                <span className="tbl__c"><Av n={q.own} s={22} /><span className="tbl__s">{q.own.split(' ')[0]}</span></span>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="two">
        <Card title="Send via" hi="भेजें" right={<span className="mute" style={{ fontSize: 11.5 }}>WhatsApp first — how Indian SMEs actually transact</span>}>
          <div className="rowflex" style={{ gap: 9 }}>
            <button className="btn btn--fill btn--sm">WhatsApp</button>
            <button className="btn btn--out btn--sm">Email</button>
            <button className="btn btn--out btn--sm">SMS link</button>
            <button className="btn btn--out btn--sm">Copy link</button>
          </div>
          <div className="mute" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.55 }}>Recipient details are verified before sending. The signer sees a plain-language summary above the document.</div>
        </Card>
        <Card title="Stalled" hi="रुका हुआ">
          <div className="col" style={{ gap: 10 }}>
            {[['Bharat Forge', 'Sent 6 days ago, not opened'], ['Godrej Interio', 'Viewed twice, no reply']].map(([co, why], i) => (
              <div key={i} className="between" style={{ padding: '9px 11px', background: 'var(--warn-container)', borderRadius: 'var(--r-sm)' }}>
                <span style={{ minWidth: 0 }}><b style={{ fontSize: 13, display: 'block' }}>{co}</b><span className="mute" style={{ fontSize: 11.5 }}>{why}</span></span>
                <button className="btn btn--out btn--sm" style={{ flexShrink: 0 }}>Nudge</button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

Object.assign(window, { ScreenGanit, ScreenVikray });
