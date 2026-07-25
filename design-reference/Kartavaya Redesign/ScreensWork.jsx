// Boards, Tasks, Approvals + shared overlays (sheet, drawer, keyboard sheet)
function ScreenBoards({ open }) {
  const [view, setView] = React.useState('kanban');
  const cols = ['todo', 'doing', 'review', 'done'];
  return (
    <div className="screen">
      <PH kick="Workspace · कार्यक्षेत्र" hi="फलक" en="Boards"
        lede="Quarterly GST filing — Aekam Inc."
        right={<><button className="btn btn--out btn--sm">{I.gear} Fields</button><button className="btn btn--out btn--sm">{I.ai} Automations</button><button className="btn btn--fill btn--sm" onClick={() => open('task')}>{I.plus} Task</button></>} />
      <div className="chips">
        {[['Quarterly GST', '#0082c6'], ['Diwali campaign', '#c2703c'], ['Mumbai fit-out', '#B42318'], ['Vendor onboarding', '#5b6ee0']].map(([n, c], i) => (
          <button key={n} className={'chip' + (i === 0 ? ' on' : '')}><span className="chip__dot" style={{ background: c }} />{n}</button>
        ))}
      </div>
      <TabBar tabs={MODULE_TABS.boards} val={view} set={setView} max={7} />
      {view !== 'kanban' && <TabStub tab={view} module="फलक Boards" />}
      {view === 'kanban' && <div className="board">
        {cols.map(k => {
          const [lbl, hi, c] = STATUS[k];
          const items = TASKS.filter(t => t.st === k);
          return (
            <div key={k} className="bcol">
              <div className="bcol__head">
                <span className="bcol__bar" style={{ background: c }} />
                <span className="bcol__t">{lbl}</span>
                <span className="bcol__hi">{hi}</span>
                <span className="bcol__n">{items.length}</span>
              </div>
              {items.map(t => (
                <button key={t.id} className="bcard" onClick={() => open('task', t)}>
                  <div className="bcard__top">
                    <i className="pdot" style={{ background: PRIO[t.p] }} />
                    <span className="bcard__id">{t.id}</span>
                    <span className="mute" style={{ fontSize: 10.5, marginLeft: 'auto', textTransform: 'capitalize' }}>{t.p}</span>
                  </div>
                  <div className="bcard__t">{t.t}</div>
                  <div className="bcard__foot">
                    <Tag c={t.dv === 'danger' ? '#B42318' : t.dv === 'warn' ? '#A66207' : '#74786F'}>{t.due}</Tag>
                    {t.cm > 0 && <span className="mute mono" style={{ fontSize: 11 }}>{t.cm} ▪</span>}
                    <span style={{ marginLeft: 'auto' }}><Avs list={t.a} max={2} s={22} /></span>
                  </div>
                </button>
              ))}
              {!items.length && <div className="bcol__empty">Nothing here</div>}
            </div>
          );
        })}
      </div>}
    </div>
  );
}

function ScreenTasks({ open }) {
  const [tab, setTab] = React.useState('mine');
  return (
    <div className="screen">
      <PH kick="Workspace · कार्यक्षेत्र" hi="कर्तव्य" en="Tasks"
        lede="What's worth doing today."
        right={<button className="btn btn--fill btn--sm" onClick={() => open('task')}>{I.plus} Task <kbd className="kbd" style={{ marginLeft: 2 }}>N</kbd></button>} />
      <Seg opts={[{ id: 'mine', l: 'Mine', n: 4 }, { id: 'all', l: 'All open', n: TASKS.length }, { id: 'over', l: 'Overdue', n: 1 }, { id: 'done', l: 'Done', n: 1 }]} val={tab} set={setTab} />
      <div className="tbl">
        <div className="tbl__scroll">
          <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,2.4fr) minmax(0,1fr) 110px 100px 110px' }}>
            <span>Task</span><span>Project</span><span>Assignees</span><span>Due</span><span>Status</span>
          </div>
          {['urgent', 'high', 'medium', 'low'].map(p => {
            const items = TASKS.filter(t => t.p === p);
            if (!items.length) return null;
            return (
              <div key={p}>
                <div className="tbl__group"><i className="pdot" style={{ background: PRIO[p] }} /><span>{p}</span><span className="tbl__group-n">{items.length}</span></div>
                {items.map(t => {
                  const [lbl, , c] = STATUS[t.st];
                  return (
                    <button key={t.id} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,2.4fr) minmax(0,1fr) 110px 100px 110px' }} onClick={() => open('task', t)}>
                      <span className="tbl__c"><span className="tbl__id">{t.id}</span><span className="tbl__t">{t.t}</span></span>
                      <span className="tbl__c"><i className="chip__dot" style={{ background: t.pc }} /><span className="tbl__s">{t.proj}</span></span>
                      <span className="tbl__c"><Avs list={t.a} max={2} s={22} /></span>
                      <span className="tbl__c"><Tag c={t.dv === 'danger' ? '#B42318' : t.dv === 'warn' ? '#A66207' : '#74786F'}>{t.due}</Tag></span>
                      <span className="tbl__c"><Tag c={c}>{lbl}</Tag></span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ScreenApprovals() {
  const REQ = [
    { t: 'Diwali campaign budget', who: 'Priya Nair', hi: 'बजट', meta: '₹1.8 L · Marketing', age: '2h' },
    { t: 'Vendor agreement v2 — clause change', who: 'Rohan Iyer', hi: 'अनुबंध', meta: 'Legal review', age: '1d' },
    { t: 'July payroll run', who: 'Aanya Mehta', hi: 'वेतन', meta: '₹7.24 L · 6 employees', age: '3h' },
  ];
  return (
    <div className="screen">
      <PH kick="Clients · ग्राहक" hi="सम्मति" en="Approvals"
        lede="Three waiting. Approve or decline without opening anything." />
      <div className="col" style={{ gap: 10 }}>
        {REQ.map(r => (
          <div key={r.t} className="card" style={{ padding: 'var(--pad-card)', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 14, alignItems: 'center' }}>
            <Av n={r.who} s={38} />
            <div style={{ minWidth: 0 }}>
              <div className="rowflex" style={{ gap: 9 }}><b style={{ fontSize: 14 }}>{r.t}</b><span className="hi mute" style={{ fontSize: 12.5 }}>{r.hi}</span></div>
              <div className="mute" style={{ fontSize: 12, marginTop: 3 }}>{r.who} · {r.meta} · <span className="mono">{r.age} ago</span></div>
            </div>
            <div className="rowflex" style={{ gap: 8, flexShrink: 0 }}>
              <button className="btn btn--out btn--sm">Decline</button>
              <button className="btn btn--fill btn--sm">{I.check} Approve</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Overlays ───────────────────────────────────────────────────────────
function TaskDrawer({ data, close }) {
  const t = data || {};
  const [lbl, hi, c] = STATUS[t.st || 'doing'];
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="drawer">
        <div className="drawer__head">
          <span className="rowflex" style={{ gap: 8, minWidth: 0 }}>
            {t.pc && <i className="chip__dot" style={{ background: t.pc }} />}
            <span className="mute" style={{ fontSize: 12.5 }}>{t.proj}</span>
            <span className="mute">/</span>
            <b className="mono" style={{ fontSize: 12.5 }}>{t.id || 'New'}</b>
          </span>
          <button className="icobtn" style={{ marginLeft: 'auto' }} onClick={close}>{I.x}</button>
        </div>
        <div className="drawer__body">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 500, margin: 0, lineHeight: 1.25 }}>{t.t || 'Untitled task'}</h2>
          <div className="props">
            <div className="prop"><span className="prop__l"><span>Status</span><span className="prop__hi">स्थिति</span></span><span className="prop__v"><Tag c={c}>{lbl}</Tag></span></div>
            <div className="prop"><span className="prop__l"><span>Priority</span><span className="prop__hi">प्राथमिकता</span></span><span className="prop__v"><i className="pdot" style={{ background: PRIO[t.p] || '#74786F' }} /><span style={{ textTransform: 'capitalize' }}>{t.p || 'medium'}</span></span></div>
            <div className="prop"><span className="prop__l"><span>Assignees</span><span className="prop__hi">सौंपा</span></span><span className="prop__v"><Avs list={t.a || []} max={3} s={22} /></span></div>
            <div className="prop"><span className="prop__l"><span>Due</span><span className="prop__hi">तिथि</span></span><span className="prop__v"><Tag c={t.dv === 'danger' ? '#B42318' : '#A66207'}>{t.due || '—'}</Tag></span></div>
          </div>
          <div className="divider" />
          <div>
            <div className="prop__l" style={{ marginBottom: 8 }}><span>Description</span></div>
            <p style={{ fontSize: 13.5, color: 'var(--on-surface-2)', lineHeight: 1.6, margin: 0 }}>
              Cross-reference vendor invoices with the input tax credit reconciliation, then share the draft with CA Sharma for review before the 20 Aug GSTR-3B deadline.
            </p>
          </div>
          <div className="divider" />
          <div>
            <div className="between" style={{ marginBottom: 10 }}><span className="prop__l"><span>Comments</span><span className="prop__hi">टिप्पणी</span></span><span className="mute mono" style={{ fontSize: 11 }}>{t.cm || 0}</span></div>
            <div className="col" style={{ gap: 14 }}>
              {(t.a || ['Aanya Mehta']).slice(0, 2).map((n, i) => (
                <div key={i} className="msg"><Av n={n} s={26} /><div className="msg__b"><div className="msg__head"><span className="msg__who">{n}</span><span className="msg__t">{i ? '1d' : '3h'}</span></div><div className="msg__txt">{i ? 'Two vendor bills still missing HSN — flagged in Ganit.' : 'Working notes are ready for review.'}</div></div></div>
              ))}
            </div>
            <div className="rowflex" style={{ gap: 8, marginTop: 14 }}>
              <input className="inp" placeholder="Write a comment…" />
              <button className="btn btn--fill" style={{ flexShrink: 0 }}>{I.send}</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function InvoiceSheet({ close }) {
  const [gstin, setGstin] = React.useState('27AAACT2727Q1ZW');
  const [showOpt, setShowOpt] = React.useState(false);
  const inter = gstin.slice(0, 2) !== '27';
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="sheet">
        <div className="sheet__head">
          <h3 className="sheet__t">New invoice <span className="hi" style={{ fontSize: 15, color: 'var(--primary)' }}>बीजक</span></h3>
          <span className="mute mono" style={{ fontSize: 11, marginLeft: 'auto' }}>INV-2608</span>
          <button className="icobtn" onClick={close}>{I.x}</button>
        </div>
        <div className="sheet__body">
          <div className="fld">
            <span className="fld__l">Party</span>
            <input className="inp" defaultValue="Tata Steel" />
            <span className="mute" style={{ fontSize: 11.5 }}>Unknown name? <b style={{ color: 'var(--primary)' }}>⌥C</b> creates it without leaving this sheet.</span>
          </div>
          <div className="row2">
            <div className="fld"><span className="fld__l">Recipient GSTIN</span><input className="inp mono" value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} /></div>
            <div className="fld"><span className="fld__l">Invoice date</span><input className="inp" type="date" defaultValue="2026-07-25" /></div>
          </div>
          <div className="rowflex" style={{ gap: 9, padding: '10px 12px', background: 'var(--ok-container)', borderRadius: 'var(--r-sm)' }}>
            <span style={{ color: 'var(--ok)', flexShrink: 0 }}>{I.check}</span>
            <span style={{ fontSize: 12.5, minWidth: 0 }}>
              Derived from GSTIN prefix <b className="mono">{gstin.slice(0, 2) || '––'}</b> — place of supply <b>{inter ? 'inter-state' : 'Maharashtra'}</b>, tax as <b>{inter ? 'IGST' : 'CGST + SGST'}</b>.
            </span>
            <button className="btn btn--out btn--sm" style={{ flexShrink: 0 }}>Change</button>
          </div>
          <div className="divider" />
          <div className="fld">
            <span className="fld__l">Line items</span>
            <div className="tbl" style={{ borderRadius: 'var(--r-sm)' }}>
              <div className="tbl__head" style={{ gridTemplateColumns: 'minmax(0,1fr) 90px 80px 100px', height: 32, fontSize: 9.5 }}>
                <span>Item</span><span>HSN/SAC</span><span>Rate</span><span style={{ textAlign: 'right' }}>Amount</span>
              </div>
              {[['Office fit-out — Phase 2', '995461', '18%', 425000], ['Site supervision', '998399', '18%', 60000]].map(([d, hsn, r, amt]) => (
                <div key={d} className="tbl__row" style={{ gridTemplateColumns: 'minmax(0,1fr) 90px 80px 100px', minHeight: 38 }}>
                  <span className="tbl__c"><span className="tbl__t">{d}</span></span>
                  <span className="tbl__c"><span className="tbl__s mono">{hsn}</span></span>
                  <span className="tbl__c"><span className="tbl__s">{r}</span></span>
                  <span className="tbl__c tbl__c--num">{inr(amt)}</span>
                </div>
              ))}
            </div>
            <button className="btn btn--text btn--sm" style={{ alignSelf: 'flex-start' }}>{I.plus} Add line <kbd className="kbd" style={{ marginLeft: 4 }}>⌥N</kbd></button>
          </div>
          <button className="between" style={{ padding: '10px 0', borderTop: '1px solid var(--outline-variant)', width: '100%' }} onClick={() => setShowOpt(!showOpt)}>
            <span className="fld__l">Optional — PO number, project code, bank details</span>
            <span className="mute">{showOpt ? I.chevL : I.chevR}</span>
          </button>
          {showOpt && (
            <div className="row2">
              <div className="fld"><span className="fld__l">PO number</span><input className="inp" placeholder="Optional" /></div>
              <div className="fld"><span className="fld__l">Project code</span><input className="inp" placeholder="Optional" /></div>
            </div>
          )}
          <div className="col" style={{ gap: 7, paddingTop: 4 }}>
            {[['Taxable value', 485000], [inter ? 'IGST 18%' : 'CGST 9%', inter ? 87300 : 43650], ...(inter ? [] : [['SGST 9%', 43650]])].map(([l, v]) => (
              <div key={l} className="between" style={{ fontSize: 13 }}><span className="mute">{l}</span><span className="mono">{inr(v)}</span></div>
            ))}
            <div className="between" style={{ fontSize: 15, fontWeight: 600, paddingTop: 8, borderTop: '1px solid var(--outline-variant)' }}><span>Total</span><span className="mono" style={{ color: 'var(--primary)' }}>{inr(572300)}</span></div>
          </div>
        </div>
        <div className="sheet__foot">
          <span className="mute" style={{ fontSize: 11.5, marginRight: 'auto' }}>{I.check} Ready for IRN — all mandatory fields present</span>
          <button className="btn btn--out btn--sm" onClick={close}>Save draft <kbd className="kbd" style={{ marginLeft: 4 }}>⌘S</kbd></button>
          <button className="btn btn--fill btn--sm" onClick={close}>Send on WhatsApp</button>
        </div>
      </div>
    </>
  );
}

function KbdSheet({ close }) {
  const G = [
    ['Global', [['⌘K', 'Command palette'], ['?', 'This sheet'], ['N', 'New task'], ['Esc', 'Back one level']]],
    ['Navigate — press G then', [['D', 'Dashboard'], ['C', 'ग्रह CRM'], ['I', 'गणित Finance'], ['H', 'मानव HRMS'], ['S', 'संवाद Messaging']]],
    ['Ganit — finance', [['N', 'New invoice'], ['⌥N', 'Add line item'], ['⌥C', 'Create party inline'], ['⌘S', 'Save draft'], ['F2', 'Switch period']]],
  ];
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="sheet" style={{ width: 'min(560px, calc(100% - 48px))' }}>
        <div className="sheet__head">
          <h3 className="sheet__t">Keyboard</h3>
          <span className="mute" style={{ fontSize: 12, marginLeft: 'auto' }}>Tally-style — usable without a mouse</span>
          <button className="icobtn" onClick={close}>{I.x}</button>
        </div>
        <div className="sheet__body">
          {G.map(([sec, rows]) => (
            <div key={sec}>
              <div className="fld__l" style={{ marginBottom: 8 }}>{sec}</div>
              <div className="col" style={{ gap: 6 }}>
                {rows.map(([k, d]) => (
                  <div key={k + d} className="between" style={{ fontSize: 13 }}><span>{d}</span><kbd className="kbd">{k}</kbd></div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function GenericSheet({ kind, close }) {
  const MAP = {
    task: ['New task', 'कार्य', 'Title, project, assignee, due date.'],
    deal: ['New deal', 'सौदा', 'Company, value, stage — and the next step, which is required.'],
    quote: ['New quote', 'प्रस्ताव', 'Becomes a signable document and then an invoice without retyping.'],
    scan: ['Scan a bill', 'पठन', 'HSN, GSTIN and tax split are read from the image.'],
    sign: ['Send for signature', 'हस्ताक्षर', 'Verify the recipient, then deliver by WhatsApp.'],
    payrun: ['Run July payroll', 'वेतन', 'Reads attendance from मानव. Nothing is entered twice.'],
    contact: ['Contact', 'संपर्क', ''],
  };
  const [t, hi, d] = MAP[kind] || ['Untitled', '', ''];
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="sheet" style={{ width: 'min(520px, calc(100% - 48px))' }}>
        <div className="sheet__head">
          <h3 className="sheet__t">{t} <span className="hi" style={{ fontSize: 15, color: 'var(--primary)' }}>{hi}</span></h3>
          <button className="icobtn" style={{ marginLeft: 'auto' }} onClick={close}>{I.x}</button>
        </div>
        <div className="sheet__body">
          {d && <p className="mute" style={{ fontSize: 13, margin: 0 }}>{d}</p>}
          {kind === 'scan' ? (
            <div className="empty" style={{ border: '2px dashed var(--outline-variant)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-7)' }}>
              <div className="empty__ic">{I.doc}</div>
              <div className="empty__t">Drop a bill here</div>
              <div className="empty__s">Or use your phone camera. Manual entry stays available.</div>
              <div className="rowflex" style={{ gap: 8, marginTop: 10 }}><button className="btn btn--fill btn--sm">Choose file</button><button className="btn btn--out btn--sm">Enter manually</button></div>
            </div>
          ) : (
            <>
              <div className="fld"><span className="fld__l">Title</span><input className="inp" placeholder="What needs doing?" autoFocus /></div>
              <div className="row2">
                <div className="fld"><span className="fld__l">Owner</span><select className="inp">{TEAM.map(m => <option key={m.n}>{m.n}</option>)}</select></div>
                <div className="fld"><span className="fld__l">Due</span><input className="inp" type="date" /></div>
              </div>
              {kind === 'deal' && (
                <div className="fld"><span className="fld__l">Next step — required</span><input className="inp" placeholder="e.g. Discovery call" /><span className="mute" style={{ fontSize: 11.5 }}>A deal without a next step is how deals go stale.</span></div>
              )}
            </>
          )}
        </div>
        <div className="sheet__foot">
          <button className="btn btn--out btn--sm" onClick={close}>Cancel</button>
          <button className="btn btn--fill btn--sm" onClick={close}>Save</button>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { ScreenBoards, ScreenTasks, ScreenApprovals, TaskDrawer, InvoiceSheet, KbdSheet, GenericSheet });
