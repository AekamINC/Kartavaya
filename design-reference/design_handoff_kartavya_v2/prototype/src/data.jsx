// Mock data for the Kartavya prototype — modelled on the real app's shapes
// (tasks, projects/teams, columns, fields, members).

const TEAM = [
  { id: 'u1', name: 'Keval Shah',    initials: 'KS', role: 'admin',  color: '#0082c6', tz: 'IST' },
  { id: 'u2', name: 'Aanya Mehta',   initials: 'AM', role: 'member', color: '#05b7aa', tz: 'IST' },
  { id: 'u3', name: 'Rohan Iyer',    initials: 'RI', role: 'member', color: '#8b5cf6', tz: 'IST' },
  { id: 'u4', name: 'Priya Nair',    initials: 'PN', role: 'member', color: '#ec4899', tz: 'IST' },
  { id: 'u5', name: 'Vikram Joshi',  initials: 'VJ', role: 'admin',  color: '#f59e0b', tz: 'IST' },
  { id: 'u6', name: 'Devika Pillai', initials: 'DP', role: 'member', color: '#10b981', tz: 'IST' },
  { id: 'u7', name: 'Arjun Rao',     initials: 'AR', role: 'client', color: '#6366f1', tz: 'IST' },
];

const PROJECTS = [
  { id: 'p1', name: 'Quarterly GST filing', sanskrit: 'राजस्व', client: 'Aekam Inc',    tasks: 24, progress: 0.62, due: '2026-06-30', color: '#0082c6' },
  { id: 'p2', name: 'Diwali campaign',      sanskrit: 'विपणन', client: 'Saraswati Co.',  tasks: 18, progress: 0.34, due: '2026-10-25', color: '#f59e0b' },
  { id: 'p3', name: 'Bengaluru office fit-out', sanskrit: 'कार्यालय', client: 'Internal', tasks: 31, progress: 0.78, due: '2026-07-12', color: '#05b7aa' },
  { id: 'p4', name: 'Vendor onboarding v2',  sanskrit: 'सहयोग', client: 'Internal',     tasks: 12, progress: 0.21, due: '2026-08-15', color: '#8b5cf6' },
  { id: 'p5', name: 'Mumbai client review',  sanskrit: 'समीक्षा', client: 'Tata Steel',  tasks: 9,  progress: 0.88, due: '2026-05-22', color: '#ec4899' },
];

const COLUMNS = [
  { id: 'c1', key: 'todo',        title: 'To do',       devanagari: 'कार्य',    color: '#94a3b8' },
  { id: 'c2', key: 'in_progress', title: 'In progress', devanagari: 'चालू',     color: '#0082c6' },
  { id: 'c3', key: 'in_review',   title: 'In review',   devanagari: 'समीक्षा',  color: '#a78bfa' },
  { id: 'c4', key: 'done',        title: 'Done',        devanagari: 'सम्पन्न',  color: '#05b7aa' },
];

const TASKS = [
  { id: 'KAR-104', title: 'Compile Q1 GSTR-3B working notes',         project: 'p1', column: 'c2', priority: 'high',   due: '2026-05-15', assignees: ['u1','u2'], updated: '2h ago', comments: 4, attachments: 2, est: 6 },
  { id: 'KAR-108', title: 'Reconcile input tax credit — March',        project: 'p1', column: 'c2', priority: 'medium', due: '2026-05-16', assignees: ['u2'],      updated: '5h ago', comments: 2, attachments: 1, est: 4 },
  { id: 'KAR-112', title: 'CA Sharma — share draft for review',        project: 'p1', column: 'c3', priority: 'high',   due: '2026-05-17', assignees: ['u1'],      updated: 'Yesterday', comments: 1, attachments: 0, est: 1 },
  { id: 'KAR-095', title: 'File GSTR-1 for Saraswati Co.',              project: 'p1', column: 'c4', priority: 'high',   due: '2026-05-10', assignees: ['u5'],      updated: '2d ago', comments: 6, attachments: 3, est: 3, done: true },
  { id: 'KAR-201', title: 'Diwali landing — copy direction',           project: 'p2', column: 'c1', priority: 'medium', due: '2026-09-25', assignees: ['u4'],      updated: '3h ago', comments: 0, attachments: 0, est: 8 },
  { id: 'KAR-202', title: 'Hindi/Marathi creative brief sign-off',     project: 'p2', column: 'c2', priority: 'high',   due: '2026-05-20', assignees: ['u4','u3'], updated: '1h ago', comments: 9, attachments: 5, est: 5 },
  { id: 'KAR-203', title: 'Vendor quote — Borivali print run',         project: 'p2', column: 'c1', priority: 'low',    due: '2026-06-02', assignees: ['u3'],      updated: 'Today', comments: 1, attachments: 1, est: 2 },
  { id: 'KAR-301', title: 'Electrical contractor — site visit',        project: 'p3', column: 'c2', priority: 'urgent', due: '2026-05-14', assignees: ['u5','u6'], updated: '30m ago', comments: 12, attachments: 4, est: 7 },
  { id: 'KAR-308', title: 'BBMP permit — re-submission packet',         project: 'p3', column: 'c2', priority: 'high',   due: '2026-05-19', assignees: ['u5'],      updated: '4h ago', comments: 3, attachments: 8, est: 6 },
  { id: 'KAR-310', title: 'Furniture order — IndiaMART final list',     project: 'p3', column: 'c3', priority: 'medium', due: '2026-05-22', assignees: ['u6'],      updated: 'Yesterday', comments: 2, attachments: 1, est: 3 },
  { id: 'KAR-411', title: 'Vendor agreement template — legal review',  project: 'p4', column: 'c1', priority: 'medium', due: '2026-05-28', assignees: ['u1'],      updated: '6h ago', comments: 1, attachments: 0, est: 4 },
  { id: 'KAR-502', title: 'Tata Steel — invoice formatting fix',       project: 'p5', column: 'c3', priority: 'urgent', due: '2026-05-15', assignees: ['u1','u7'], updated: '15m ago', comments: 5, attachments: 2, est: 2 },
  { id: 'KAR-503', title: 'Send revised SOW for May engagement',        project: 'p5', column: 'c4', priority: 'high',   due: '2026-05-12', assignees: ['u5'],      updated: '3d ago', comments: 8, attachments: 1, est: 1, done: true },
];

const ACTIVITY = [
  { who: 'u5', verb: 'moved',     what: 'KAR-301 Electrical contractor — site visit', to: 'In progress',  when: '12m ago' },
  { who: 'u2', verb: 'commented', what: 'KAR-108 Reconcile input tax credit',          to: '"Got the March ledger from CA Sharma"', when: '1h ago' },
  { who: 'u4', verb: 'created',   what: 'KAR-203 Vendor quote — Borivali print run',   to: 'Diwali campaign · To do', when: '2h ago' },
  { who: 'u1', verb: 'approved',  what: 'KAR-503 Send revised SOW for May engagement', to: 'and marked Done', when: '3h ago' },
  { who: 'u6', verb: 'attached',  what: 'BBMP_permit_v3.pdf',                          to: 'on KAR-308', when: '4h ago' },
  { who: 'u3', verb: 'assigned',  what: 'KAR-202 to Priya Nair',                       to: '', when: 'Yesterday' },
];

// Days of the week — used for the weekly mini-strip on the dashboard.
// Sanskrit names of weekdays used in Indian calendars.
const WEEK_HI = ['सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'रवि'];
const WEEK_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Hindu calendar mock — Vikram Samvat year + tithi for "today" (May 14, 2026)
const HINDU_DATE = { tithi: 'Vaishākha Shukla Pratipadā', samvat: 'विक्रम संवत् 2083', dayHi: 'गुरुवार' };

Object.assign(window, { TEAM, PROJECTS, COLUMNS, TASKS, ACTIVITY, WEEK_HI, WEEK_EN, HINDU_DATE });
