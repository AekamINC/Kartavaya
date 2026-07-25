// Landing page — nav, hero, module showcase.
// The hero and feature visuals are built from the real app classes in app.css,
// not drawn illustrations, so what the page promises is what the product renders.
const LMODS = [
  { hi: 'कर्तव्य', en: 'Kartavya', d: 'Projects, boards, tasks and time', ic: 'task', c: '#0082c6' },
  { hi: 'ग्रह', en: 'Graha', d: 'CRM, contacts, deals and follow-ups', ic: 'crm', c: '#04837A' },
  { hi: 'विक्रय', en: 'Vikray', d: 'Orders, stock, targets', ic: 'sales', c: '#5b6ee0' },
  { hi: 'गणित', en: 'Ganit', d: 'GST invoices, expenses, e-way bills', ic: 'fin', c: '#A66207' },
  { hi: 'मानव', en: 'Manav', d: 'Employees, leave, documents', ic: 'hr', c: '#8A5730' },
  { hi: 'वेतन', en: 'Vetana', d: 'Payroll, payslips, PF and TDS', ic: 'pay', c: '#B42318' },
  { hi: 'पहचान', en: 'Pahchan', d: 'Face attendance, shifts, geo-fence', ic: 'clock', c: '#7c5cbf' },
  { hi: 'संवाद', en: 'Sanvaad', d: 'Team channels and WhatsApp inbox', ic: 'chat', c: '#1FA855' },
  { hi: 'प्रचार', en: 'Prachar', d: 'Campaigns, sequences, ads', ic: 'mkt', c: '#c2703c' },
  { hi: 'सृजन', en: 'Srijan', d: 'AI assistant across your own data', ic: 'ai', c: '#6c8c3f' },
  { hi: 'दृष्टि', en: 'Dristi', d: 'Reports, dashboards, pivots', ic: 'report', c: '#0082c6' },
  { hi: 'केंद्र', en: 'Kendra', d: 'Client portal with real containment', ic: 'hub', c: '#04837A' },
  { hi: 'हस्ताक्षर', en: 'eSign', d: 'Send, sign, store agreements', ic: 'sign', c: '#5C6450' },
  { hi: 'सम्मति', en: 'Sammati', d: 'Approvals with an audit trail', ic: 'check', c: '#A66207' },
  { hi: 'अधिकार', en: 'Adhikar', d: 'Roles and access, per module', ic: 'gear', c: '#74786F' },
];

function useReveal() {
  React.useEffect(() => {
    const els = document.querySelectorAll('[data-rev]');
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px', threshold: .08 });
    els.forEach(e => io.observe(e));
    return () => io.disconnect();
  }, []);
}

function LNav() {
  const [solid, setSolid] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  React.useEffect(() => {
    const h = () => setSolid(window.scrollY > 24);
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);
  const LINKS = [['Modules', '#modules'], ['How it works', '#features'], ['Pricing', '#pricing'], ['Built for India', '#trust']];
  const jump = href => { const el = document.querySelector(href); if (el) window.scrollTo({ top: el.offsetTop - 66, behavior: 'smooth' }); setMenu(false); };
  return (
    <>
      <header className={'lnav' + (solid ? ' solid' : '')}>
        <a className="lnav__brand" href="#top" onClick={e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          <Mark size={30} />
          <span><b>Kartavaya</b><i className="hi">कर्तव्य</i></span>
        </a>
        <nav className="lnav__links">
          {LINKS.map(([l, h]) => <button key={l} onClick={() => jump(h)}>{l}</button>)}
        </nav>
        <div className="lnav__act">
          <button className="lbtn lbtn--ghost">Log in</button>
          <button className="lbtn lbtn--fill">Request access</button>
        </div>
        <button className="lnav__burger" onClick={() => setMenu(true)} aria-label="Menu">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 5.5h14M3 10h14M3 14.5h14" /></svg>
        </button>
      </header>
      {menu && (
        <div className="lmenu">
          <div className="lmenu__h">
            <a className="lnav__brand" href="#top"><Mark size={30} /><span><b>Kartavaya</b><i className="hi">कर्तव्य</i></span></a>
            <button className="icobtn" onClick={() => setMenu(false)} aria-label="Close">{I.x}</button>
          </div>
          <nav className="lmenu__links">
            {LINKS.map(([l, h], i) => <button key={l} style={{ animationDelay: i * 40 + 'ms' }} onClick={() => jump(h)}>{l}<span>{I.chevR}</span></button>)}
          </nav>
          <div className="lmenu__act">
            <button className="lbtn lbtn--fill lbtn--lg">Request access</button>
            <button className="lbtn lbtn--out lbtn--lg">Log in</button>
          </div>
        </div>
      )}
    </>
  );
}

// Real product fragments, floated over the hero with light parallax.
function HeroArt() {
  const [y, setY] = React.useState(0);
  React.useEffect(() => {
    let raf = 0;
    const h = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setY(window.scrollY)); };
    window.addEventListener('scroll', h, { passive: true });
    return () => { window.removeEventListener('scroll', h); cancelAnimationFrame(raf); };
  }, []);
  const p = (k) => ({ transform: `translate3d(0, ${y * k}px, 0)` });
  return (
    <div className="lart">
      <div className="lart__main" style={p(-0.04)}>
        <div className="lart__bar">
          <span className="lart__dots"><i /><i /><i /></span>
          <span className="lart__crumb"><span className="hi">कर्तव्य</span> Boards</span>
        </div>
        <div className="lart__body">
          <div className="board" style={{ gridAutoColumns: 'minmax(150px, 1fr)' }}>
            {[['To Do', 'कार्य', '#8E8D87', 2], ['In Progress', 'चालू', '#0082c6', 2], ['Done', 'सम्पन्न', '#04837A', 1]].map(([t, hi, c, n]) => (
              <div key={t} className="bcol" style={{ padding: 9 }}>
                <div className="bcol__head" style={{ paddingBottom: 7 }}>
                  <span className="bcol__bar" style={{ background: c }} />
                  <span className="bcol__t" style={{ fontSize: 10.5 }}>{t}</span>
                  <span className="bcol__hi" style={{ fontSize: 11 }}>{hi}</span>
                </div>
                {Array.from({ length: n }).map((_, i) => (
                  <div key={i} className="bcard" style={{ padding: '8px 9px', gap: 6 }}>
                    <div className="bcard__top"><span className="pdot" style={{ background: i ? '#A66207' : '#B42318' }} /><span className="bcard__id" style={{ fontSize: 9 }}>KAR-{580 + i + n}</span></div>
                    <div className="bcard__t" style={{ fontSize: 11, lineHeight: 1.35 }}>{['Tata Steel fit-out review', 'GSTR-3B working notes', 'Vendor clause update'][(i + n) % 3]}</div>
                    <div className="bcard__foot"><Avs list={['Keval Shah', 'Aanya Mehta']} max={2} s={16} /></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="lart__f lart__f--inv" style={p(0.07)}>
        <div className="lart__f-k">गणित · Invoice</div>
        <div className="lart__f-r"><b>INV-2607</b><span className="tag" style={{ '--c': '#B42318' }}>Overdue</span></div>
        <div className="lart__f-v mono">₹5,01,500</div>
        <div className="lart__f-s">Tata Steel · MSME 45-day clause</div>
      </div>
      <div className="lart__f lart__f--chat" style={p(-0.1)}>
        <div className="lart__f-k">संवाद · WhatsApp</div>
        <div className="lart__chat">
          <span className="lart__bub">Placeholder — can you share the revised invoice?</span>
          <span className="lart__bub out">Sending it now {SI.tick2}</span>
        </div>
      </div>
      <div className="lart__f lart__f--att" style={p(0.12)}>
        <div className="lart__f-k">पहचान · Attendance</div>
        <div className="lart__f-r" style={{ gap: 8 }}><Av n="Priya Nair" s={22} /><b style={{ fontSize: 11.5 }}>Clocked in 09:02</b></div>
        <div className="lart__f-s">Face verified · inside geo-fence</div>
      </div>
    </div>
  );
}

function LHero() {
  return (
    <section className="lhero" id="top">
      <span className="lhero__mesh" />
      <span className="lhero__wm hi" aria-hidden="true">कर्तव्य</span>
      <div className="lwrap lhero__in">
        <div className="lhero__txt" data-rev>
          <span className="lpill">15 modules · one flat price · built in India</span>
          <h1 className="lhero__h">
            Your business,<br /><em>one platform.</em>
            <span className="lhero__hi hi">आपका व्यापार, एक ही जगह।</span>
          </h1>
          <p className="lhero__p">
            Projects, clients, invoices, payroll, attendance and WhatsApp — in one place, in Hindi and English,
            priced flat for the whole company. Turn on the modules you need and leave the rest switched off.
          </p>
          <div className="lhero__cta">
            <button className="lbtn lbtn--fill lbtn--lg">Request access<span className="lbtn__sub">we reply within a working day</span></button>
            <button className="lbtn lbtn--ghost lbtn--lg">Book a demo</button>
          </div>
          <div className="lhero__trust">
            {['GST compliant', 'Data hosted in India', 'Hindi · English · Gujarati', 'WhatsApp Business API'].map(t => (
              <span key={t}>{I.check} {t}</span>
            ))}
          </div>
        </div>
        <div className="lhero__art" data-rev><HeroArt /></div>
      </div>
    </section>
  );
}

function LModules() {
  const [sel, setSel] = React.useState(null);
  return (
    <section className="lsec" id="modules">
      <div className="lwrap">
        <header className="lsec__h" data-rev>
          <span className="lsec__k">The modules</span>
          <h2 className="lsec__t">Fifteen tools that already know about each other.</h2>
          <p className="lsec__l">
            An invoice knows which project it came from. A payslip knows who was present. Nothing is re-entered,
            because nothing lives in a separate app. Every module carries a Hindi name because that is what your team says out loud.
          </p>
        </header>
        <div className="lmods" data-rev>
          {LMODS.map(m => (
            <button key={m.en} className={'lmod' + (sel === m.en ? ' on' : '')} style={{ '--c': m.c }} onClick={() => setSel(sel === m.en ? null : m.en)}>
              <span className="lmod__ic">{I[m.ic]}</span>
              <span className="lmod__hi hi">{m.hi}</span>
              <span className="lmod__en">{m.en}</span>
              <span className="lmod__d">{m.d}</span>
            </button>
          ))}
        </div>
        <div className="lnote" data-rev>
          <b>You will not see all fifteen.</b> A CA firm gets seven items in the sidebar; a trading company gets a different eight.
          The rest stay off until you ask, so the product never feels like somebody else’s software.
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { LMODS, useReveal, LNav, LHero, HeroArt, LModules });
