// Shared mock data + tokens for the Kartavya mobile companion.
// Trimmed/reshaped from the desktop prototype's data.jsx to focus on
// the screens this app actually exposes.

const KP = {
  primary: '#05b7aa',
  mid:     '#03a1b6',
  deep:    '#0082c6',
  grad:    'linear-gradient(90deg,#0082c6,#03a1b6,#05b7aa)',
  gradD:   'linear-gradient(135deg,#0082c6,#05b7aa)',
};

const M_TEAM = [
  { id: 'u1', name: 'Keval',  initials: 'KS', color: '#0082c6' },
  { id: 'u2', name: 'Aanya',  initials: 'AM', color: '#05b7aa' },
  { id: 'u3', name: 'Rohan',  initials: 'RI', color: '#8b5cf6' },
  { id: 'u4', name: 'Priya',  initials: 'PN', color: '#ec4899' },
  { id: 'u5', name: 'Vikram', initials: 'VJ', color: '#f59e0b' },
  { id: 'u6', name: 'Devika', initials: 'DP', color: '#10b981' },
  { id: 'u7', name: 'Arjun',  initials: 'AR', color: '#6366f1' },
];

const M_PROJECTS = [
  { id: 'p1', name: 'Quarterly GST filing',  sans: 'राजस्व',   client: 'Aekam Inc',     open: 14, total: 24, progress: 0.62, color: '#0082c6' },
  { id: 'p2', name: 'Diwali campaign',       sans: 'विपणन',    client: 'Saraswati Co.', open: 11, total: 18, progress: 0.34, color: '#f59e0b' },
  { id: 'p3', name: 'Bengaluru office fit-out', sans: 'कार्यालय', client: 'Internal',   open: 8,  total: 31, progress: 0.78, color: '#05b7aa' },
  { id: 'p4', name: 'Vendor onboarding v2',  sans: 'सहयोग',    client: 'Internal',      open: 9,  total: 12, progress: 0.21, color: '#8b5cf6' },
  { id: 'p5', name: 'Mumbai client review',  sans: 'समीक्षा',  client: 'Tata Steel',    open: 2,  total: 9,  progress: 0.88, color: '#ec4899' },
];

// Columns match the real Kartavya schema — "Approval" is a first-class column
// that moves the task into the approval workflow on entry.
const M_COLUMNS = [
  { id: 'c1', key: 'todo',     title: 'To do',       hi: 'कार्य',    color: '#94a3b8' },
  { id: 'c2', key: 'doing',    title: 'In progress', hi: 'चालू',     color: '#0082c6' },
  { id: 'c3', key: 'approval', title: 'Approval',    hi: 'अनुमोदन',  color: '#f59e0b', isApproval: true },
  { id: 'c4', key: 'review',   title: 'Client review', hi: 'समीक्षा', color: '#a78bfa' },
  { id: 'c5', key: 'done',     title: 'Done',        hi: 'सम्पन्न',  color: '#05b7aa' },
];

const M_VIEWS = [
  { id: 'board',    label: 'Board',    hi: 'कार्यफलक' },
  { id: 'list',     label: 'List',     hi: 'सूची' },
  { id: 'schedule', label: 'Schedule', hi: 'समय' },
  { id: 'tracker',  label: 'Tracker',  hi: 'प्रगति' },
];

// "Today" — the user's slice of work across projects.
const M_TODAY = [
  { id: 'KAR-301', title: 'Electrical contractor — site visit', project: 'p3', column: 'c2', priority: 'urgent', due: 'Today · 4:00pm', overdue: false, assignees: ['u5','u6'], comments: 12, files: 4, mention: true, syncing: true },
  { id: 'KAR-202', title: 'Hindi/Marathi creative brief sign-off', project: 'p2', column: 'c2', priority: 'high',   due: 'Today',         overdue: false, assignees: ['u4','u3'], comments: 9,  files: 5, mention: false, approval: 'requested' },
  { id: 'KAR-502', title: 'Tata Steel — invoice formatting fix',  project: 'p5', column: 'c3', priority: 'urgent', due: 'Tomorrow',       overdue: false, assignees: ['u1','u7'], comments: 5,  files: 2 },
  { id: 'KAR-104', title: 'Compile Q1 GSTR-3B working notes',     project: 'p1', column: 'c2', priority: 'high',   due: 'Fri · 15 May',   overdue: false, assignees: ['u1','u2'], comments: 4,  files: 2 },
  { id: 'KAR-308', title: 'BBMP permit — re-submission packet',   project: 'p3', column: 'c2', priority: 'high',   due: 'Sat · 19 May',   overdue: false, assignees: ['u5'],     comments: 3,  files: 8 },
  { id: 'KAR-411', title: 'Vendor agreement template — legal review', project: 'p4', column: 'c1', priority: 'medium', due: 'Wed · 28 May', overdue: false, assignees: ['u1'],   comments: 1,  files: 0 },
];

// Cards on the board (project p3 — Bengaluru office fit-out)
// approvalStatus: 'pending' (awaiting owner) | 'pending_client' (awaiting client) | 'approved' | null
const M_BOARD = {
  c1: [
    { id: 'KAR-318', title: 'Furniture vendor shortlist — IndiaMART', priority: 'medium', due: '24 May', assignees: ['u6'], comments: 2, files: 1 },
    { id: 'KAR-322', title: 'WiFi mesh + AP placement plan',          priority: 'low',    due: '30 May', assignees: ['u3'], comments: 0, files: 0 },
  ],
  c2: [
    { id: 'KAR-301', title: 'Electrical contractor — site visit',   priority: 'urgent', due: 'Today · 4:00pm', assignees: ['u5','u6'], comments: 12, files: 4, mention: true, syncing: true },
    { id: 'KAR-308', title: 'BBMP permit — re-submission packet',   priority: 'high',   due: '19 May',   assignees: ['u5'],     comments: 3,  files: 8 },
    { id: 'KAR-315', title: 'Reception signage — Devanagari proof', priority: 'medium', due: '21 May',   assignees: ['u4'],     comments: 6,  files: 3 },
  ],
  c3: [
    { id: 'KAR-310', title: 'Furniture order — IndiaMART final list', priority: 'medium', due: '22 May', assignees: ['u6'], comments: 2, files: 1, approvalStatus: 'pending',        approvalBy: 'u6' },
    { id: 'KAR-303', title: 'Revised BOQ — vendor commit',           priority: 'urgent', due: 'Today',  assignees: ['u5'],     comments: 5, files: 2, approvalStatus: 'pending',        approvalBy: 'u5', mention: true },
  ],
  c4: [
    { id: 'KAR-295', title: 'Brand palette — Tata Steel sign-off',   priority: 'high', due: '20 May', assignees: ['u4'], comments: 9, files: 3, approvalStatus: 'pending_client', approvalBy: 'u1' },
  ],
  c5: [
    { id: 'KAR-298', title: 'Lease registration — Borivali office', priority: 'high', due: '08 May', assignees: ['u1'], comments: 8, files: 3, approvalStatus: 'approved' },
    { id: 'KAR-289', title: 'Architect SOW — final signoff',        priority: 'high', due: '02 May', assignees: ['u1','u5'], comments: 14, files: 6, approvalStatus: 'approved' },
  ],
};

// One detailed task for the Task Detail screen — KAR-301
const M_TASK_DETAIL = {
  id: 'KAR-301',
  title: 'Electrical contractor — site visit & inspection',
  project: 'p3',
  column: 'c2',
  priority: 'urgent',
  due: 'Today, 4:00pm IST',
  assignees: ['u5','u6'],
  reporter: 'u1',
  estimate: '7h',
  description:
    'Walk-through with Mehta Electricals at the Koramangala site. Validate load calculations for the open-plan area, confirm 3-phase requirements for the server closet, and lock the conduit layout for the meeting rooms. Bring the signed BOQ and the BBMP single-line diagram.',
  // The owner viewing this task sees: "Vikram requested your approval".
  // approvalStatus: 'pending' → awaiting owner | 'pending_client' → awaiting client
  approvalStatus: 'pending',
  approval: {
    requestedBy: 'u5',      // member who moved the card into the Approval column
    requestedAt: '1h ago',
    decisionBy: 'u1',       // owner whose decision is awaited
    note: 'Need sign-off on revised BOQ before I commit to vendor. Photos in BOQ_v3.',
  },
  // Subtasks — schema matches backend: { subtask_id, title, is_done, order }
  subtasks: [
    { subtask_id: 'sub_a', title: 'Confirm 3-phase requirement w/ server-closet vendor', is_done: true,  order: 0 },
    { subtask_id: 'sub_b', title: 'Walk meeting-room conduit layout w/ Mehta foreman',   is_done: true,  order: 1 },
    { subtask_id: 'sub_c', title: 'Sign BOQ_v3 and hand to vendor',                       is_done: false, order: 2 },
    { subtask_id: 'sub_d', title: 'Schedule AV-closet review with Devika',                is_done: false, order: 3 },
    { subtask_id: 'sub_e', title: 'Email site-visit summary to Keval',                    is_done: false, order: 4 },
  ],
  files: [
    { name: 'BOQ_v3_signed.pdf',     size: '2.4 MB', kind: 'PDF', by: 'u5', when: '2h ago' },
    { name: 'site_layout_v2.dwg',    size: '8.1 MB', kind: 'DWG', by: 'u6', when: 'Yesterday' },
    { name: 'BBMP_SLD.pdf',          size: '1.1 MB', kind: 'PDF', by: 'u1', when: '3d ago' },
  ],
  comments: [
    { by: 'u5', when: '12m ago', text: 'Mehta team confirmed 4pm. Bringing two electricians and the foreman.', mention: false },
    { by: 'u1', when: '08m ago', text: 'Great. @Devika please join — we need you for the AV closet review.', mention: 'u6' },
    { by: 'u6', when: 'just now', text: 'On my way. Also pinging building security to escort them in.', mention: false },
  ],
  activity: [
    { who: 'u5', verb: 'moved', what: 'to In progress', when: '2h ago' },
    { who: 'u5', verb: 'attached', what: 'BOQ_v3_signed.pdf', when: '2h ago' },
    { who: 'u5', verb: 'requested approval', what: 'from Keval', when: '1h ago' },
  ],
};

// Inbox notifications — covers the full task-event taxonomy:
//   mention | comment | approval_request | approved | rejected
//   assigned | status_changed | done | created
const M_INBOX = [
  { id: 'n1', kind: 'mention',          who: 'u1', text: '@Devika please join — we need you for the AV closet review.', task: 'KAR-301 Electrical contractor — site visit', project: 'p3', when: '8m ago',  unread: true },
  { id: 'n2', kind: 'approval_request', who: 'u5', text: 'requested your approval on the revised BOQ',                  task: 'KAR-301 Electrical contractor — site visit', project: 'p3', when: '1h ago', unread: true, priority: 'urgent' },
  { id: 'n3', kind: 'assigned',         who: 'u5', text: 'assigned you to a new task',                                  task: 'KAR-301 Electrical contractor — site visit', project: 'p3', when: '1h ago', unread: true },
  { id: 'n4', kind: 'comment',          who: 'u2', text: 'Got the March ledger from CA Sharma — uploading now.',        task: 'KAR-108 Reconcile input tax credit',         project: 'p1', when: '2h ago', unread: true },
  { id: 'n5', kind: 'status_changed',   who: 'u5', text: 'moved task from In progress → Approval',                      task: 'KAR-301 Electrical contractor — site visit', project: 'p3', when: '2h ago', unread: false },
  { id: 'n6', kind: 'created',          who: 'u3', text: 'created a new task in this project',                          task: 'KAR-322 WiFi mesh + AP placement plan',      project: 'p3', when: '3h ago', unread: false },
  { id: 'n7', kind: 'mention',          who: 'u4', text: '@Keval the Marathi headline reads a bit stiff — thoughts?',   task: 'KAR-202 Hindi/Marathi creative brief',       project: 'p2', when: '3h ago', unread: false },
  { id: 'n8', kind: 'approved',         who: 'u1', text: 'approved your task and marked it Done',                       task: 'KAR-503 Send revised SOW for May engagement', project: 'p5', when: 'Yesterday', unread: false },
  { id: 'n9', kind: 'done',             who: 'u5', text: 'completed a task in this project',                            task: 'KAR-289 Architect SOW — final signoff',      project: 'p3', when: 'Yesterday', unread: false },
  { id: 'n10', kind: 'approval_request', who: 'u6', text: 'requested your approval on the final furniture list',        task: 'KAR-310 Furniture order — IndiaMART',         project: 'p3', when: 'Yesterday', unread: false },
  { id: 'n11', kind: 'rejected',         who: 'u1', text: 'requested changes — see notes',                              task: 'KAR-318 Furniture vendor shortlist — IndiaMART', project: 'p3', when: 'Yesterday', unread: false },
  { id: 'n12', kind: 'status_changed',   who: 'u4', text: 'moved task from To do → In progress',                        task: 'KAR-315 Reception signage — Devanagari proof', project: 'p3', when: '2d ago', unread: false },
];

// Notification kind labels + glyph mapping — drives both Inbox UI and Settings.
const M_NOTIF_KINDS = [
  { id: 'mention',          label: '@ Mentions',     hi: 'उल्लेख',  desc: 'Someone @-tags you in a comment.',           tone: 'mention',  push: 'always' },
  { id: 'approval_request', label: 'Approval needed', hi: 'अनुमोदन', desc: 'A teammate requests your sign-off.',         tone: 'approval', push: 'always' },
  { id: 'approved',         label: 'Approved',       hi: 'स्वीकृत', desc: 'Your task was approved & advanced.',         tone: 'success',  push: 'always' },
  { id: 'rejected',         label: 'Changes requested', hi: 'बदलाव', desc: 'Owner asked for changes on your task.',      tone: 'danger',   push: 'always' },
  { id: 'assigned',         label: 'Assigned to you', hi: 'सौंपा',   desc: 'You were added as an assignee.',             tone: 'assigned', push: 'always' },
  { id: 'comment',          label: 'New comments',   hi: 'टिप्पणी',  desc: 'Any comment on a task you\'re involved in.',  tone: 'comment',  push: 'mine_only' },
  { id: 'status_changed',   label: 'Status changes', hi: 'स्थिति',   desc: 'Task moves between columns.',                tone: 'status',   push: 'project' },
  { id: 'done',             label: 'Task done',      hi: 'सम्पन्न',   desc: 'A task in your project was completed.',     tone: 'success',  push: 'project' },
  { id: 'created',          label: 'New tasks',      hi: 'नया कार्य', desc: 'Anyone creates a task in your project.',     tone: 'neutral',  push: 'off' },
];

const M_NOTIF_TONE_STYLES = {
  mention:  { iconName: 'at',    fg: '#0082c6', bg: 'rgba(0,130,198,0.16)' },
  approval: { iconName: 'check', fg: '#B06A00', bg: 'rgba(255,159,10,0.18)' },
  assigned: { iconName: 'person', fg: '#6750A4', bg: 'rgba(167,139,250,0.18)' },
  comment:  { iconName: 'tray',  fg: '#0A7A6E', bg: 'rgba(5,183,170,0.16)' },
  status:   { iconName: 'square-stack', fg: '#0082c6', bg: 'rgba(0,130,198,0.14)' },
  success:  { iconName: 'check', fg: '#0A7A6E', bg: 'rgba(5,183,170,0.18)' },
  danger:   { iconName: 'flag',  fg: '#C0392B', bg: 'rgba(192,57,43,0.14)' },
  neutral:  { iconName: 'square-stack', fg: '#6E7B91', bg: 'rgba(60,60,67,0.10)' },
};

// Maps a notification kind → tone style.
const M_NOTIF_KIND_TONE = {
  mention:           'mention',
  comment:           'comment',
  approval_request:  'approval',
  approved:          'success',
  rejected:          'danger',
  assigned:          'assigned',
  status_changed:    'status',
  done:              'success',
  created:           'neutral',
};

const M_TASK_PROJECT = (pid) => M_PROJECTS.find(p => p.id === pid);
const M_USER = (uid) => M_TEAM.find(u => u.id === uid);
const M_KIND_LABEL = { mention: 'MENTION', approval: 'APPROVAL', comment: 'COMMENT' };
const M_PRIO_COLOR = { urgent: '#C0392B', high: '#B06A00', medium: '#0082c6', low: '#7D8BA6' };
const M_PRIO_LABEL = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };

Object.assign(window, {
  KP, M_TEAM, M_PROJECTS, M_COLUMNS, M_VIEWS, M_TODAY, M_BOARD,
  M_TASK_DETAIL, M_INBOX, M_NOTIF_KINDS, M_NOTIF_TONE_STYLES, M_NOTIF_KIND_TONE,
  M_TASK_PROJECT, M_USER, M_KIND_LABEL, M_PRIO_COLOR, M_PRIO_LABEL,
});
