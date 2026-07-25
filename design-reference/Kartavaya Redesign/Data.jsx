// Shared mock data + small helpers
const AVC = ['#0082c6', '#04837A', '#8A5730', '#5C6450', '#5b6ee0', '#B42318', '#A66207', '#7c5cbf'];
const ini = n => (n || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
const inr = n => '₹' + n.toLocaleString('en-IN');
const lakh = n => n >= 10000000 ? '₹' + (n / 10000000).toFixed(2) + ' Cr' : n >= 100000 ? '₹' + (n / 100000).toFixed(1) + ' L' : inr(n);

const PRIO = { urgent: '#B42318', high: '#A66207', medium: '#0082c6', low: '#74786F' };
const STATUS = { todo: ['To Do', 'कार्य', '#8E8D87'], doing: ['In Progress', 'चालू', '#0082c6'], review: ['In Review', 'समीक्षा', '#7c5cbf'], done: ['Done', 'सम्पन्न', '#04837A'] };

function Av({ n, s = 26, ring, c }) {
  return <span className={'av' + (ring ? ' av--ring' : '')} style={{ width: s, height: s, fontSize: Math.round(s * .38), background: c || AVC[(n || '').length % AVC.length] }} title={n}>{ini(n)}</span>;
}
function Avs({ list = [], max = 3, s = 24 }) {
  const show = list.slice(0, max), extra = list.length - show.length;
  return <span className="avs">{show.map((n, i) => <Av key={i} n={n} s={s} ring c={AVC[i % AVC.length]} />)}{extra > 0 && <span className="avs__more" style={{ width: s, height: s }}>+{extra}</span>}</span>;
}
function Tag({ c, children }) { return <span className="tag" style={{ '--c': c }}><span className="tag__dot" />{children}</span>; }
function Stat({ lbl, hi, v, sub, trend, kind }) {
  return (
    <div className={'stat' + (kind ? ' stat--' + kind : '')}>
      <div className="stat__lbl"><span>{lbl}</span>{hi && <span className="stat__hi">{hi}</span>}</div>
      <div className="stat__v">{v}</div>
      {(sub || trend) && <div className="stat__sub">{trend && <span className={'stat__trend ' + (trend > 0 ? 'up' : 'down')}>{trend > 0 ? '▲' : '▼'} {Math.abs(trend)}%</span>}{trend && sub ? ' · ' : ''}{sub}</div>}
    </div>
  );
}
function PH({ kick, hi, en, lede, right }) {
  return (
    <header className="ph">
      <div className="ph__txt">
        {kick && <div className="ph__kick">{kick}</div>}
        <h1 className="ph__h1"><span className="ph__hi">{hi}</span><span className="ph__en">{en}</span></h1>
        {lede && <p className="ph__lede">{lede}</p>}
      </div>
      {right && <div className="ph__act">{right}</div>}
    </header>
  );
}
function Card({ title, hi, right, children, flush, tonal }) {
  return (
    <section className={'card' + (tonal ? ' card--tonal' : '')}>
      {(title || right) && (
        <header className="card__head">
          <div className="card__titles">{title && <h3 className="card__title">{title}</h3>}{hi && <span className="card__hi">{hi}</span>}</div>
          {right}
        </header>
      )}
      <div className={'card__body' + (flush ? ' card__body--flush' : '')}>{children}</div>
    </section>
  );
}
function Empty({ ic, t, s, action }) {
  return <div className="empty"><div className="empty__ic">{ic || I.doc}</div><div className="empty__t">{t}</div><div className="empty__s">{s}</div>{action}</div>;
}
function Sk({ w, h = 12, r, circle }) {
  return <span className={'sk' + (circle ? ' sk--circle' : '')} style={{ width: w, height: h, borderRadius: r }} />;
}
function Seg({ opts, val, set }) {
  return <div className="seg">{opts.map(o => <button key={o.id} className={'seg__b' + (val === o.id ? ' on' : '')} onClick={() => set(o.id)}>{o.l}{o.n != null && <span className="seg__n">{o.n}</span>}</button>)}</div>;
}

// ── Data ────────────────────────────────────────────────────────────────
const TASKS = [
  { id: 'KAR-582', t: 'Tata Steel — Mumbai office fit-out review', p: 'urgent', st: 'review', due: 'Today', dv: 'danger', proj: 'Mumbai review', pc: '#B42318', a: ['Keval Shah', 'Aanya Mehta'], cm: 4 , sub: 4, subDone: 3, appr: true },
  { id: 'KAR-184', t: 'Compile Q1 GSTR-3B working notes', p: 'high', st: 'doing', due: 'Tomorrow', dv: 'warn', proj: 'Quarterly GST', pc: '#0082c6', a: ['Keval Shah', 'Rohan Iyer'], cm: 7 , sub: 6, subDone: 2, men: true },
  { id: 'KAR-112', t: 'Share Diwali campaign draft with CA Sharma', p: 'medium', st: 'doing', due: 'In 3d', dv: 'normal', proj: 'Diwali campaign', pc: '#A66207', a: ['Priya Nair'], cm: 2 , sub: 0, subDone: 0 },
  { id: 'KAR-411', t: 'Vendor agreement template — clause update', p: 'low', st: 'todo', due: '2 Aug', dv: 'muted', proj: 'Vendor onboarding', pc: '#5b6ee0', a: ['Rohan Iyer'], cm: 0 , sub: 0, subDone: 0 },
  { id: 'KAR-090', t: 'Reconcile input tax credit for June', p: 'high', st: 'todo', due: 'In 5d', dv: 'normal', proj: 'Quarterly GST', pc: '#0082c6', a: ['Aanya Mehta'], cm: 1 , sub: 0, subDone: 0 },
  { id: 'KAR-077', t: 'Bengaluru payroll — verify PF challan', p: 'medium', st: 'done', due: 'Done', dv: 'muted', proj: 'Payroll July', pc: '#04837A', a: ['Priya Nair'], cm: 3 , sub: 0, subDone: 0 },
];

const DEALS = [
  { st: 0, co: 'Saraswati Textiles', v: 480000, own: 'Keval Shah', next: 'Discovery call', when: 'Tomorrow', rot: false },
  { st: 0, co: 'Nirmal Exports', v: 220000, own: 'Priya Nair', next: null, when: null, rot: true },
  { st: 1, co: 'Tata Steel — Mumbai', v: 1850000, own: 'Keval Shah', next: 'Send proposal', when: 'In 2d', rot: false },
  { st: 1, co: 'Kalyan Jewellers', v: 640000, own: 'Aanya Mehta', next: 'Follow-up email', when: 'Today', rot: false },
  { st: 2, co: 'Godrej Interio', v: 1240000, own: 'Rohan Iyer', next: 'Site visit', when: 'In 4d', rot: false },
  { st: 3, co: 'Bharat Forge', v: 2100000, own: 'Keval Shah', next: 'Negotiate terms', when: 'Today', rot: false },
  { st: 3, co: 'Amul Dairy Co-op', v: 780000, own: 'Priya Nair', next: null, when: null, rot: true },
  { st: 4, co: 'Wipro Consumer', v: 3400000, own: 'Aanya Mehta', next: 'Contract review', when: 'In 6d', rot: false },
  { st: 5, co: 'Asian Paints', v: 1560000, own: 'Keval Shah', next: 'Won — onboard', when: '—', rot: false },
];
const STAGES = [
  { hi: 'नवीन', en: 'New Lead', prob: 10, c: '#8E8D87' },
  { hi: 'योग्य', en: 'Qualified', prob: 25, c: '#0082c6' },
  { hi: 'प्रस्ताव', en: 'Proposal', prob: 45, c: '#7c5cbf' },
  { hi: 'वार्ता', en: 'Negotiation', prob: 65, c: '#A66207' },
  { hi: 'समीक्षा', en: 'Contract', prob: 85, c: '#04837A' },
  { hi: 'विजित', en: 'Won', prob: 100, c: '#04837A' },
];

const CONTACTS = [
  { n: 'Ramesh Iyer', co: 'Saraswati Textiles', role: 'Director', city: 'Surat', gst: '24AACCS1234F1Z5', val: 480000, last: '2d ago' },
  { n: 'Meera Joshi', co: 'Tata Steel', role: 'Procurement Head', city: 'Mumbai', gst: '27AAACT2727Q1ZW', val: 1850000, last: 'Today' },
  { n: 'Anil Kapoor', co: 'Godrej Interio', role: 'GM Facilities', city: 'Mumbai', gst: '27AAACG1234M1Z8', val: 1240000, last: '1w ago' },
  { n: 'Sunita Reddy', co: 'Bharat Forge', role: 'CFO', city: 'Pune', gst: '27AAACB4567L1ZP', val: 2100000, last: '3d ago' },
  { n: 'Vikram Malhotra', co: 'Wipro Consumer', role: 'VP Ops', city: 'Bengaluru', gst: '29AAACW7890R1ZK', val: 3400000, last: '5h ago' },
  { n: 'Deepa Krishnan', co: 'Asian Paints', role: 'Category Lead', city: 'Mumbai', gst: '27AAACA3456N1ZQ', val: 1560000, last: 'Yesterday' },
];

const INVOICES = [
  { id: 'INV-2607', co: 'Tata Steel', amt: 425000, gst: 76500, st: 'overdue', due: '12d overdue', pos: 'Maharashtra', igst: false, msme: true },
  { id: 'INV-2606', co: 'Wipro Consumer', amt: 890000, gst: 160200, st: 'sent', due: 'In 8d', pos: 'Karnataka', igst: true, msme: false },
  { id: 'INV-2605', co: 'Godrej Interio', amt: 312000, gst: 56160, st: 'paid', due: 'Paid', pos: 'Maharashtra', igst: false, msme: false },
  { id: 'INV-2604', co: 'Saraswati Textiles', amt: 148000, gst: 26640, st: 'draft', due: 'Draft', pos: 'Gujarat', igst: true, msme: true },
  { id: 'INV-2603', co: 'Bharat Forge', amt: 675000, gst: 121500, st: 'sent', due: 'In 3d', pos: 'Maharashtra', igst: false, msme: false },
];
const INV_ST = { paid: ['Paid', '#04837A'], sent: ['Sent', '#0082c6'], overdue: ['Overdue', '#B42318'], draft: ['Draft', '#8E8D87'] };

const TEAM = [
  { n: 'Keval Shah', r: 'Owner', hi: 'स्वामी', dept: 'Leadership', city: 'Mumbai', status: 'in', open: 4 },
  { n: 'Aanya Mehta', r: 'Manager', hi: 'प्रबंधक', dept: 'Finance', city: 'Mumbai', status: 'in', open: 3 },
  { n: 'Rohan Iyer', r: 'Member', hi: 'सदस्य', dept: 'Legal', city: 'Pune', status: 'leave', open: 2 },
  { n: 'Priya Nair', r: 'Member', hi: 'सदस्य', dept: 'Marketing', city: 'Bengaluru', status: 'wfh', open: 5 },
  { n: 'Arjun Desai', r: 'Member', hi: 'सदस्य', dept: 'Sales', city: 'Mumbai', status: 'in', open: 1 },
  { n: 'Fatima Sheikh', r: 'Manager', hi: 'प्रबंधक', dept: 'Operations', city: 'Hyderabad', status: 'in', open: 6 },
];

// Real tab structures, lifted from staging pages — nothing dropped
const MODULE_TABS = {
  graha: ['today', 'clients', 'contacts', 'deals', 'kanban', 'pipeline', 'follow-ups', 'labels', 'activities', 'reports', 'automations', 'territories', 'fields', 'web-forms', 'approvals', 'documents', 'dedupe'],
  ganit: ['invoices', 'products', 'expenses', 'payables', 'contracts', 'e-sign', 'recurring', 'bank', 'timesheet', 'stats'],
  manav: ['employees', 'attendance', 'shifts', 'leaves', 'expenses', 'recruitment', 'announcements', 'departments', 'holidays', 'performance', 'assets'],
  vetana: ['dashboard', 'structures', 'payroll', 'payslips', 'loans', 'statutory'],
  vikray: ['dashboard', 'orders', 'stock', 'pipeline', 'targets', 'customers'],
  prachar: ['dashboard', 'campaigns', 'ads', 'sequences', 'templates', 'automations', 'unsubscribes', 'events'],
  dristi: ['overview', 'revenue', 'pipeline', 'hr', 'sales', 'reports', 'dashboards', 'pivot'],
  sanvaad: ['channels', 'whatsapp'],
  esign: ['documents', 'create'],
  srijan: ['skills', 'content', 'generate', 'data catalog', 'data runs', 'credits'],
  hub: ['generate', 'content', 'chat', 'knowledge', 'publish', 'brand', 'credits'],
  boards: ['kanban', 'table', 'calendar', 'timeline', 'workload', 'priority', 'mytasks'],
};
const TAB_HI = {
  today: 'आज', clients: 'ग्राहक', contacts: 'संपर्क', deals: 'सौदे', kanban: 'फलक', pipeline: 'प्रवाह', 'follow-ups': 'अनुसरण', labels: 'नाम', activities: 'क्रिया', reports: 'रिपोर्ट', automations: 'स्वचालन', territories: 'क्षेत्र', fields: 'क्षेत्र', 'web-forms': 'प्रपत्र', approvals: 'सम्मति', documents: 'दस्तावेज़', dedupe: 'शोधन',
  invoices: 'बीजक', products: 'वस्तु', expenses: 'व्यय', payables: 'देय', contracts: 'अनुबंध', 'e-sign': 'हस्ताक्षर', recurring: 'आवर्ती', bank: 'बैंक', timesheet: 'समय', stats: 'आँकड़े',
  employees: 'कर्मचारी', attendance: 'उपस्थिति', shifts: 'पारी', leaves: 'अवकाश', recruitment: 'भर्ती', announcements: 'सूचना', departments: 'विभाग', holidays: 'छुट्टी', performance: 'प्रदर्शन', assets: 'संपत्ति',
  dashboard: 'मुख्य', structures: 'संरचना', payroll: 'वेतन', payslips: 'पर्ची', loans: 'ऋण', statutory: 'अनुपालन',
  orders: 'आदेश', stock: 'भंडार', targets: 'लक्ष्य', customers: 'ग्राहक',
  campaigns: 'अभियान', ads: 'विज्ञापन', sequences: 'क्रम', templates: 'साँचा', unsubscribes: 'निकास', events: 'घटना',
  overview: 'सारांश', revenue: 'राजस्व', hr: 'मानव', sales: 'विक्रय', dashboards: 'पटल', pivot: 'सारणी',
  channels: 'माध्यम', whatsapp: 'व्हाट्सएप', create: 'नया', conversations: 'बातचीत', 'auto-replies': 'स्वउत्तर', accounts: 'खाता',
  appearance: 'रूप', typography: 'अक्षर', layout: 'ढाँचा', language: 'भाषा', notifications: 'सूचना', data: 'गोपनीयता',
  profile: 'रूपरेखा', billing: 'बीजक', modules: 'खंड', security: 'सुरक्षा', 'danger zone': 'संकट',
  active: 'सक्रिय', queue: 'प्रतीक्षा', history: 'इतिहास', users: 'लोग', orgs: 'संस्था', costs: 'व्यय',
  members: 'सदस्य', matrix: 'सारणी', 'role levels': 'स्तर', 'denied states': 'निषेध', 'client portal': 'ग्राहक', 'module rules': 'नियम', invitations: 'निमंत्रण', 'support access': 'सहायता', 'audit log': 'अभिलेख', projects: 'परियोजना',
  skills: 'कौशल', content: 'सामग्री', generate: 'सृजन', 'data catalog': 'सूची', 'data runs': 'प्रयोग', credits: 'श्रेय',
  knowledge: 'ज्ञान', publish: 'प्रकाशन', brand: 'ब्रांड', chat: 'संवाद',
  table: 'सूची', calendar: 'पंचांग', timeline: 'कालरेखा', workload: 'भार', priority: 'प्राथमिकता', mytasks: 'मेरे कार्य',
};

// Keeps every tab. First `max` inline, the rest in a More popover.
function TabBar({ tabs, val, set, max = 6, counts = {} }) {
  const [more, setMore] = React.useState(false);
  let head = tabs.slice(0, max), tail = tabs.slice(max);
  if (tail.includes(val)) { head = [...tabs.slice(0, max - 1), val]; tail = tabs.filter(t => !head.includes(t)); }
  return (
    <div className="tabs">
      <div className="tabs__scroll">
        {head.map(t => (
          <button key={t} className={'tabs__b' + (val === t ? ' on' : '')} onClick={() => set(t)}>
            <span className="tabs__en">{t}</span>
            <span className="tabs__hi">{TAB_HI[t] || ''}</span>
            {counts[t] != null && <span className="seg__n">{counts[t]}</span>}
          </button>
        ))}
      </div>
      {tail.length > 0 && (
        <div className="tabs__ovf">
          <button className={'tabs__b tabs__more' + (more ? ' on' : '')} onClick={() => setMore(!more)}>
            More<span className="tabs__hi">+{tail.length}</span>
          </button>
          {more && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 110 }} onClick={() => setMore(false)} />
              <div className="pop" style={{ top: 'calc(100% + 6px)', right: 0, minWidth: 230, maxWidth: 'min(280px, 90vw)', maxHeight: 340, overflowY: 'auto' }}>
                <div className="pop__head">All tabs · {tabs.length}</div>
                {tail.map(t => (
                  <button key={t} className="pop__row" onClick={() => { set(t); setMore(false); }}>
                    <span style={{ textTransform: 'capitalize' }}>{t}</span>
                    <span className="hi mute" style={{ marginLeft: 'auto', fontSize: 12 }}>{TAB_HI[t] || ''}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Placeholder for tabs that exist in the repo but aren't built out in this pass
function TabStub({ tab, module }) {
  return (
    <Card>
      <Empty ic={I.doc} t={<span style={{ textTransform: 'capitalize' }}>{tab} <span className="hi" style={{ color: 'var(--primary)', fontSize: '.8em' }}>{TAB_HI[tab] || ''}</span></span>}
        s={'This tab exists in ' + module + ' on staging and is carried through here. Styling is applied; the content is not built out in this pass.'} />
    </Card>
  );
}

Object.assign(window, { AVC, ini, inr, lakh, PRIO, STATUS, Av, Avs, Tag, Stat, PH, Card, Empty, Sk, Seg, TabBar, TabStub, MODULE_TABS, TAB_HI, TASKS, DEALS, STAGES, CONTACTS, INVOICES, INV_ST, TEAM });
