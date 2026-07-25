// Landing page — feature sections, pricing, trust, footer.
function FKanban() {
  return (
    <div className="lshot">
      <div className="lshot__bar"><span className="lart__dots"><i /><i /><i /></span><span className="lart__crumb"><span className="hi">कर्तव्य</span> Kartavya · Boards</span></div>
      <div className="lshot__b">
        <div className="tabs" style={{ marginBottom: 12 }}>
          <div className="tabs__scroll">{['kanban', 'table', 'calendar', 'timeline'].map((t, i) => (
            <button key={t} className={'tabs__b' + (i === 0 ? ' on' : '')}><span className="tabs__en">{t}</span><span className="tabs__hi">{TAB_HI[t]}</span></button>
          ))}</div>
        </div>
        <div className="board" style={{ gridAutoColumns: 'minmax(158px, 1fr)' }}>
          {Object.entries(STATUS).map(([k, [en, hi, c]]) => (
            <div key={k} className="bcol" style={{ padding: 9 }}>
              <div className="bcol__head" style={{ paddingBottom: 7 }}>
                <span className="bcol__bar" style={{ background: c }} /><span className="bcol__t" style={{ fontSize: 10.5 }}>{en}</span><span className="bcol__hi" style={{ fontSize: 11 }}>{hi}</span>
                <span className="bcol__n">{TASKS.filter(t => t.st === k).length}</span>
              </div>
              {TASKS.filter(t => t.st === k).slice(0, 2).map(t => (
                <div key={t.id} className="bcard" style={{ padding: '9px 10px', gap: 7 }}>
                  <div className="bcard__top"><span className="pdot" style={{ background: PRIO[t.p] }} /><span className="bcard__id" style={{ fontSize: 9.5 }}>{t.id}</span></div>
                  <div className="bcard__t" style={{ fontSize: 11.5, lineHeight: 1.35 }}>{t.t}</div>
                  <div className="bcard__foot"><Avs list={t.a} max={2} s={17} /><span className="tag" style={{ '--c': t.pc, marginLeft: 'auto', fontSize: 10 }}>{t.proj}</span></div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function FPipe() {
  return (
    <div className="lshot">
      <div className="lshot__bar"><span className="lart__dots"><i /><i /><i /></span><span className="lart__crumb"><span className="hi">ग्रह</span> Graha · Pipeline</span></div>
      <div className="lshot__b">
        <div className="pipe" style={{ gridAutoColumns: 'minmax(146px, 1fr)' }}>
          {STAGES.slice(0, 4).map((s, i) => {
            const d = DEALS.filter(x => x.st === i);
            return (
              <div key={s.en} className="pipe__col">
                <div className="pipe__head" style={{ padding: '8px 10px' }}>
                  <div className="pipe__t" style={{ fontSize: 10 }}>{s.en}<span className="pipe__hi">{s.hi}</span></div>
                  <div className="pipe__sum" style={{ fontSize: 15 }}>{lakh(d.reduce((a, x) => a + x.v, 0))}</div>
                  <div className="pipe__n">{d.length} deals · {s.prob}%</div>
                </div>
                {d.slice(0, 1).map(x => (
                  <div key={x.co} className="deal" style={{ padding: '9px 10px', gap: 6 }}>
                    <div className="deal__co" style={{ fontSize: 11.5 }}>{x.co}</div>
                    <div className="deal__v" style={{ fontSize: 12 }}>{lakh(x.v)}</div>
                    <div className="deal__foot"><Av n={x.own} s={17} />{x.rot ? <span className="tag" style={{ '--c': '#B42318', fontSize: 10 }}>No next step</span> : <span className="tbl__s" style={{ fontSize: 10 }}>{x.when}</span>}</div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
function FInvoice() {
  return (
    <div className="lshot">
      <div className="lshot__bar"><span className="lart__dots"><i /><i /><i /></span><span className="lart__crumb"><span className="hi">गणित</span> Ganit · Invoices</span></div>
      <div className="lshot__b">
        <div className="stats" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 12 }}>
          <Stat lbl="Outstanding" hi="बाकी" v="₹18.4 L" sub="9 invoices" kind="warn" />
          <Stat lbl="Overdue" hi="विलंबित" v="₹5.0 L" sub="1 invoice" kind="danger" />
          <Stat lbl="Collected" hi="प्राप्त" v="₹42.1 L" trend={12} kind="ok" />
        </div>
        <div className="tbl"><div className="tbl__head" style={{ gridTemplateColumns: '.8fr 1.3fr .9fr .9fr .8fr' }}>
          <span>Invoice</span><span>Client</span><span>Amount</span><span>GST</span><span>Status</span></div>
          {INVOICES.slice(0, 4).map(v => (
            <div key={v.id} className="tbl__row" style={{ gridTemplateColumns: '.8fr 1.3fr .9fr .9fr .8fr', minHeight: 38 }}>
              <span className="tbl__c"><span className="tbl__id">{v.id}</span></span>
              <span className="tbl__c"><span className="tbl__t" style={{ fontSize: 11.5 }}>{v.co}</span></span>
              <span className="tbl__c tbl__c--num" style={{ fontSize: 11.5 }}>{inr(v.amt)}</span>
              <span className="tbl__c tbl__c--num" style={{ fontSize: 11 }}>{v.igst ? 'IGST' : 'CGST+S'}</span>
              <span className="tbl__c"><Tag c={INV_ST[v.st][1]}>{INV_ST[v.st][0]}</Tag></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function FPeople() {
  return (
    <div className="lshot">
      <div className="lshot__bar"><span className="lart__dots"><i /><i /><i /></span><span className="lart__crumb"><span className="hi">पहचान</span> Pahchan → <span className="hi">वेतन</span> Vetana</span></div>
      <div className="lshot__b">
        <div className="tbl"><div className="tbl__head" style={{ gridTemplateColumns: '1.4fr .8fr .7fr .8fr' }}>
          <span>Employee</span><span>In</span><span>Hours</span><span>Net pay</span></div>
          {[['Keval Shah', '08:52', '8h 40m', 242200], ['Aanya Mehta', '09:04', '8h 12m', 140100], ['Rohan Iyer', '—', 'On leave', 100800], ['Priya Nair', '09:31', '7h 58m', 79600]].map(([n, t, h, p]) => (
            <div key={n} className="tbl__row" style={{ gridTemplateColumns: '1.4fr .8fr .7fr .8fr', minHeight: 40 }}>
              <span className="tbl__c"><Av n={n} s={22} /><span className="tbl__t" style={{ fontSize: 11.5 }}>{n}</span></span>
              <span className="tbl__c"><span className="mono tbl__s">{t}</span></span>
              <span className="tbl__c"><span className="tbl__s" style={{ fontSize: 11 }}>{h}</span></span>
              <span className="tbl__c tbl__c--num" style={{ fontSize: 11.5 }}>{inr(p)}</span>
            </div>
          ))}
        </div>
        <div className="lshot__note">{I.check} Attendance flows straight into the payroll run — nobody types hours twice.</div>
      </div>
    </div>
  );
}
function FAI() {
  return (
    <div className="lshot">
      <div className="lshot__bar"><span className="lart__dots"><i /><i /><i /></span><span className="lart__crumb"><span className="hi">सृजन</span> Srijan · Assistant</span></div>
      <div className="lshot__b" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="msg msg--me"><div className="msg__b"><div className="msg__txt">Which invoices are overdue and who owns them?</div></div><Av n="Keval Shah" s={26} /></div>
        <div className="msg msg--ai">
          <span className="av" style={{ width: 26, height: 26, background: 'var(--primary)', color: 'var(--on-primary)' }}>{I.ai}</span>
          <div className="msg__b">
            <div className="msg__txt">One invoice is overdue: <b>INV-2607</b>, Tata Steel, ₹5,01,500, 12 days past due. Owner is Aanya Mehta. The MSME 45-day rule applies. Placeholder response.</div>
            <div className="chips" style={{ marginTop: 9 }}>
              <button className="btn btn--fill btn--sm">Draft a reminder</button>
              <button className="btn btn--out btn--sm">Open in गणित</button>
            </div>
          </div>
        </div>
        <div className="lshot__note">{SI.lock} The assistant answers with <b>your</b> permissions. If you have no payroll access, it cannot read payroll for you.</div>
      </div>
    </div>
  );
}

const FEATS = [
  { k: 'Projects & tasks', hi: 'कर्तव्य', t: 'Work that carries its own paperwork.', p: 'Boards, tasks, subtasks, time and approvals — with the invoice, the agreement and the client conversation attached to the same record. Seven views over one dataset, so the person who wants a Gantt and the person who wants a checklist are looking at the same truth.', pts: ['Kanban, table, calendar, timeline, workload', 'Subtasks with their own assignees', 'Approvals with a full audit trail'], art: FKanban },
  { k: 'CRM & sales', hi: 'ग्रह', t: 'A pipeline that admits when a deal has gone quiet.', p: 'Deals, contacts, follow-ups and territories. Any deal with no next step is flagged in red rather than sitting politely in a column — the single most useful thing a small-business CRM can do.', pts: ['Stale deals surfaced, not hidden', 'GSTIN on the contact record', 'Quotation → order → invoice in one chain'], art: FPipe, flip: true },
  { k: 'Finance', hi: 'गणित', t: 'GST that your CA does not have to redo.', p: 'Invoices with CGST/SGST or IGST resolved from place of supply, e-way bills, TDS, expenses and payables. MSME 45-day terms are tracked because being paid late is the actual problem.', pts: ['Place-of-supply tax resolution', 'GSTR-1, 2B and 3B working views', 'Bank reconciliation and recurring invoices'], art: FInvoice },
  { k: 'People', hi: 'मानव · वेतन · पहचान', t: 'Attendance, payroll and leave as one chain.', p: 'Face check-in on a phone that works offline for 72 hours, shifts, geo-fencing and regularisation — feeding a payroll run that already knows who was present. Payroll is the most sensitive module in the product and it is built that way.', pts: ['Offline-first face attendance', 'PF, PT, ESI and TDS built in', 'Approver and Admin are deliberately separate'], art: FPeople, flip: true },
  { k: 'AI & messaging', hi: 'सृजन · संवाद', t: 'An assistant with your permissions, not its own.', p: 'Ask questions across your own data, and run the answer as an action. Team channels sit next to a shared WhatsApp Business inbox, so the customer conversation and the internal one are in the same product.', pts: ['Answers scoped to your module access', 'WhatsApp templates with Meta approval states', 'Module events arrive as messages, not noise'], art: FAI },
];

function LFeatures() {
  return (
    <section className="lsec lsec--alt" id="features">
      <div className="lwrap">
        <header className="lsec__h" data-rev>
          <span className="lsec__k">How it works</span>
          <h2 className="lsec__t">Five parts of a business that stop being five systems.</h2>
        </header>
        <div className="lfeats">
          {FEATS.map(f => (
            <div key={f.k} className={'lfeat' + (f.flip ? ' flip' : '')} data-rev>
              <div className="lfeat__txt">
                <div className="lfeat__k"><span className="hi">{f.hi}</span><span>{f.k}</span></div>
                <h3 className="lfeat__t">{f.t}</h3>
                <p className="lfeat__p">{f.p}</p>
                <ul className="lfeat__ul">{f.pts.map(p => <li key={p}>{I.check}<span>{p}</span></li>)}</ul>
              </div>
              <div className="lfeat__art"><f.art /></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Plan tiers and credit allowances are the real ones from the platform admin —
// free/starter/growth/scale at 200/500/1000/2000. Price is negotiated per org,
// so no figure is printed here rather than an invented one.
const PLANS = [
  { n: 'Free', hi: 'निःशुल्क', id: 'free', cr: 200, quote: false, d: 'For a founder testing whether this fits.', f: ['Projects, tasks and boards', 'Three modules of your choice', '2 GB of files', 'Community support'], cta: 'Start free', kind: 'out' },
  { n: 'Starter', hi: 'आरंभ', id: 'starter', cr: 500, quote: true, d: 'A small team running its own work end to end.', f: ['Up to eight modules', 'GST invoicing and expenses', 'WhatsApp Business inbox', 'Role-level access control', 'Email support in Hindi and English'], cta: 'Get a quote', kind: 'out' },
  { n: 'Growth', hi: 'वृद्धि', id: 'growth', cr: 1000, quote: true, d: 'The whole company on one system.', f: ['All fifteen modules', 'Face attendance and payroll', 'Client portal and eSign', 'Approval chains and audit log', 'Priority support'], cta: 'Get a quote', kind: 'fill', best: true },
  { n: 'Scale', hi: 'विस्तार', id: 'scale', cr: 2000, quote: true, d: 'Multi-entity groups and regulated industries.', f: ['Multiple organisations', 'Single sign-on and SCIM', 'Dedicated onboarding', 'Custom credit top-ups', 'Contractual SLA and residency'], cta: 'Talk to us', kind: 'out' },
];

function LPricing() {
  return (
    <section className="lsec" id="pricing">
      <div className="lwrap">
        <header className="lsec__h" data-rev>
          <span className="lsec__k">Pricing</span>
          <h2 className="lsec__t">Priced for the company, not per person.</h2>
          <p className="lsec__l">Per-seat pricing punishes you for hiring, so we quote per organisation instead — on your module set and your AI usage. The tier decides what you can reach and how many AI credits come with it.</p>
        </header>
        <div className="lplans" data-rev>
          {PLANS.map(p => (
            <div key={p.n} className={'lplan' + (p.best ? ' best' : '')}>
              {p.best && <span className="lplan__flag">Most chosen</span>}
              <div className="lplan__h">
                <span className="lplan__n">{p.n}<i className="hi">{p.hi}</i></span>
                <div className="lplan__v">
                  {p.quote ? <><b>On quote</b><span>per organisation</span></> : <><b>₹0</b><span>forever</span></>}
                </div>
                <p className="lplan__d">{p.d}</p>
                <div className="lplan__cr">{p.cr.toLocaleString('en-IN')}<i>AI credits / month</i></div>
              </div>
              <ul className="lplan__f">{p.f.map(f => <li key={f}>{I.check}<span>{f}</span></li>)}</ul>
              <button className={'lbtn lbtn--' + p.kind + ' lbtn--lg'} style={{ width: '100%' }}>{p.cta}</button>
            </div>
          ))}
        </div>
        <div className="lnote lnote--c" data-rev>One credit is one AI request against your own data — a draft, a summary, a question answered from your records. Usage is metered and shown in the product before it is billed, in rupees. Unused credits do not carry over; top-ups are available on any paid tier. All quotes in INR, GST at 18% charged on top.</div>
      </div>
    </section>
  );
}

function LTrust() {
  return (
    <section className="lsec lsec--dark" id="trust">
      <span className="lhero__wm hi" aria-hidden="true" style={{ opacity: .04 }}>भारत</span>
      <div className="lwrap">
        <header className="lsec__h lsec__h--c" data-rev>
          <span className="lsec__k">Built for India</span>
          <h2 className="lsec__t">Not a global product with a rupee symbol added.</h2>
          <p className="lsec__l">GST, TDS, PF, MSME terms, WhatsApp as the default channel, and Hindi in the interface rather than in a translation file.</p>
        </header>
        <div className="ltgrid" data-rev>
          {[
            ['GST and e-way bills', 'Place of supply resolves CGST/SGST or IGST. GSTR-1, 2B and 3B working views. HSN validation before you file.'],
            ['Data hosted in India', 'Primary and backup regions both inside the country. Residency is contractual on Enterprise.'],
            ['WhatsApp Business API', 'A shared team inbox on the Meta Cloud API, with template approval states and consent tracked per contact.'],
            ['Three languages, properly', 'Hindi, English and Gujarati across the interface, invoices and notifications — not just the marketing site.'],
            ['Statutory payroll', 'PF, PT, ESI and TDS computed in the run, with challans and payslips generated from it.'],
            ['Role-level access', 'Five levels per module. Payroll defaults to no access, and Admin cannot approve a payroll run.'],
          ].map(([t, d]) => (
            <div key={t} className="ltcard"><span className="ltcard__ic">{I.check}</span><b>{t}</b><p>{d}</p></div>
          ))}
        </div>
        <div className="ltlogos" data-rev>
          <span className="ltlogos__k">Works with</span>
          <div className="ltlogos__r">
            {['WhatsApp Business', 'Razorpay', 'Google Workspace', 'Tally export', 'Supabase', 'Zoho Books'].map(l => <span key={l} className="ltlogo">{l}</span>)}
          </div>
          <span className="ltlogos__f">Wordmarks stand in for real logo assets — swap before launch.</span>
        </div>
        <div className="ltsec" data-rev>
          {[['Encryption', 'TLS 1.3 in transit, AES-256 at rest'], ['Access control', 'Per-module RBAC with a full audit log'], ['Backups', 'Point-in-time recovery, 30 days'], ['Data residency', 'Mumbai region — data never leaves India']].map(([t, d]) => (
            <div key={t} className="ltsec__i"><span>{SI.lock}</span><b>{t}</b><i>{d}</i></div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LCta() {
  return (
    <section className="lcta">
      <div className="lwrap lcta__in" data-rev>
        <h2 className="lcta__h">Stop paying five vendors<br /><em>to not talk to each other.</em></h2>
        <p className="lcta__p">Kartavaya is invite-only while we onboard the first cohort. Tell us about your team and we'll set the org up with you.</p>
        <div className="lhero__cta" style={{ justifyContent: 'center' }}>
          <button className="lbtn lbtn--fill lbtn--lg">Request access<span className="lbtn__sub">we reply within a working day</span></button>
          <button className="lbtn lbtn--out lbtn--lg">Book a demo</button>
        </div>
      </div>
    </section>
  );
}

function LFooter() {
  const COLS = [
    ['Product', ['Overview', 'Modules', 'Pricing', 'Roadmap', 'What’s new']],
    ['Modules', ['Kartavya · Projects', 'Graha · CRM', 'Ganit · Finance', 'Vetana · Payroll', 'Sanvaad · Messaging']],
    ['Company', ['About Aekam', 'Careers', 'Blog', 'Contact', 'Partner with us']],
    ['Legal', ['Terms of service', 'Privacy policy', 'Cookie policy', 'Data processing', 'Security']],
  ];
  return (
    <footer className="lfoot">
      <div className="lwrap">
        <div className="lfoot__top">
          <div className="lfoot__brand">
            <a className="lnav__brand" href="#top"><Mark size={32} /><span><b>Kartavaya</b><i className="hi">कर्तव्य</i></span></a>
            <p>One platform for the whole business. Built in Mumbai for Indian small and mid-sized companies.</p>
            <div className="lfoot__lang">
              {I.hub}
              <select className="lfoot__sel" defaultValue="en"><option value="en">English</option><option value="hi">हिन्दी</option><option value="gu">ગુજરાતી</option></select>
            </div>
          </div>
          {COLS.map(([t, links]) => (
            <div key={t} className="lfoot__col">
              <span className="lfoot__ct">{t}</span>
              {links.map(l => <a key={l} href="#top">{l}</a>)}
            </div>
          ))}
        </div>
        <div className="lfoot__bot">
          <span>© 2026 Aekam Inc. All rights reserved.</span>
          <span className="lfoot__made">Made in Mumbai · <span className="hi">मुंबई में बनाया गया</span></span>
          <span className="lfoot__soc">
            {['in', 'X', 'gh'].map(s => <a key={s} href="#top" aria-label={s}>{s}</a>)}
          </span>
        </div>
      </div>
    </footer>
  );
}

function LandingApp() {
  useReveal();
  return (
    <div className="lpage">
      <LNav />
      <LHero />
      <LModules />
      <LFeatures />
      <LPricing />
      <LTrust />
      <LCta />
      <LFooter />
    </div>
  );
}

Object.assign(window, { LFeatures, LPricing, LTrust, LCta, LFooter, LandingApp, FEATS, PLANS });
