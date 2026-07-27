/* __verify/fixtures.js — canned server answers for the verification harness.
 *
 * NOTHING HERE IS REAL DATA. Every name is invented, every id is a literal, and
 * there is deliberately no face image: Pahchan photo endpoints resolve to a
 * locally generated SVG data URI, so the harness never fetches, caches or
 * writes a biometric frame. See the header of main.jsx.
 */

const day = new Date().toISOString().slice(0, 10);
const at = (h, m) => `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;

/* A neutral placeholder "face" — flat shapes, no likeness, generated in-page. */
export const FACE = (label) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 62">`
    + `<rect width="50" height="62" fill="#d8d2c6"/>`
    + `<circle cx="25" cy="23" r="11" fill="#b6ae9e"/>`
    + `<rect x="8" y="38" width="34" height="24" rx="10" fill="#b6ae9e"/>`
    + `<text x="25" y="58" font-size="7" text-anchor="middle" fill="#4a463f">${label}</text>`
    + `</svg>`,
  );

export const PUNCHES = [
  {
    id: 'p1', employee_name: 'Aarav Mehta', employee_id: 'e1',
    captured_at: at(9, 12), received_at: at(9, 12), direction: 'in',
    site_name: 'Andheri office', distance_m: 38, accuracy_m: 12,
    lat: 19.1197, lng: 72.8468, has_photo: true,
    reference_ids: ['r1', 'r2'], flags: [], review_verdict: null,
    source: 'live', mock_location: false, marked_by: 'device',
  },
  {
    id: 'p2', employee_name: 'Priya Nair', employee_id: 'e2',
    captured_at: at(9, 34), received_at: at(9, 34), direction: 'in',
    site_name: 'Andheri office', distance_m: 412, accuracy_m: 184,
    lat: 19.1231, lng: 72.8501, has_photo: true,
    reference_ids: ['r3', 'r4'], flags: ['geo', 'accuracy'], review_verdict: null,
    source: 'live', mock_location: null, marked_by: 'device',
  },
  {
    id: 'p3', employee_name: 'Rohan Iyer', employee_id: 'e3',
    captured_at: at(9, 51), received_at: at(10, 6), direction: 'in',
    site_name: null, distance_m: null, accuracy_m: null,
    lat: null, lng: null, has_photo: true,
    reference_ids: [], flags: ['noref', 'offline'], review_verdict: null,
    source: 'offline', mock_location: null, marked_by: 'device',
  },
  {
    id: 'p4', employee_name: 'Meera Joshi', employee_id: 'e4',
    captured_at: at(10, 2), received_at: at(10, 2), direction: 'out',
    site_name: 'Client site — Powai', distance_m: 22, accuracy_m: 9,
    lat: 19.1176, lng: 72.9060, has_photo: true,
    reference_ids: ['r5', 'r6'], flags: ['mock'], review_verdict: null,
    source: 'live', mock_location: true, marked_by: 'device',
  },
];

export const POLICY = {
  punch_photo_retention_days: 45,
  geofence_radius_m: 150,
  grace_minutes: 10,
  overtime_enabled: true,
  auto_accept_days: 7,
  workday_minutes: 480,
  half_day_minutes: 240,
  require_photo: true,
  allow_offline: true,
  shifts: [
    { id: 's1', name: 'General', start: '09:30', end: '18:30', days: [1, 2, 3, 4, 5] },
    { id: 's2', name: 'Early', start: '07:00', end: '16:00', days: [1, 2, 3, 4, 5, 6] },
  ],
};

export const SITES = [
  { id: 'st1', name: 'Andheri office', lat: 19.1197, lng: 72.8468, radius_m: 150, address: 'Andheri East, Mumbai', active: true },
  { id: 'st2', name: 'Client site — Powai', lat: 19.1176, lng: 72.9060, radius_m: 250, address: 'Powai, Mumbai', active: true },
];

/* `/enrollment/queue/pending` answers `{pending_approval, incomplete}`. */
export const ENROLL_QUEUE = {
  pending_approval: [
    { id: 'r7', photo_id: 'r7', employee_name: 'Sana Kapoor', employee_id: 'e5', captured_at: at(8, 40), submitted_at: at(8, 40), pose: 'front', status: 'pending' },
    { id: 'r9', photo_id: 'r9', employee_name: 'Vikram Rao', employee_id: 'e6', captured_at: at(8, 55), submitted_at: at(8, 55), pose: 'three_quarter', status: 'pending' },
  ],
  incomplete: [
    { employee_id: 'e7', employee_name: 'Nikhil Desai', approved_count: 1, pending_count: 0, needed: 2 },
  ],
};

export const REGULARISATIONS = [
  {
    id: 'g1', employee_name: 'Priya Nair', employee_id: 'e2', on: day,
    reason: 'Client visit — phone had no signal at the site.',
    requested_at: at(11, 0), status: 'pending', kind: 'missing_punch',
    requested_in: '09:15', requested_out: '18:30',
  },
  {
    id: 'g2', employee_name: 'Rohan Iyer', employee_id: 'e3', on: day,
    reason: 'App crashed on clock-out.', requested_at: at(19, 5),
    status: 'pending', kind: 'missing_punch', requested_in: null, requested_out: '18:45',
  },
];

/* `/pahchan/me` answers `{employee, punches, retention}` — punches, not days.
 * Two per working day so History can pair an `in` with an `out`. */
const MONTH = day.slice(0, 7);
const myPunches = [];
for (let d = 1; d <= 24; d += 1) {
  const dd = String(d).padStart(2, '0');
  const dow = new Date(`${MONTH}-${dd}T00:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6) continue;            // weekly off
  if (d === 9) continue;                            // an absence
  const flags = d === 5 ? ['late'] : d === 12 ? ['geo'] : [];
  myPunches.push({
    id: `mp${d}i`, direction: 'in', captured_at: `${MONTH}-${dd}T09:${d === 5 ? '48' : '12'}:00Z`,
    received_at: `${MONTH}-${dd}T09:12:00Z`, site_name: 'Andheri office',
    flags, review_verdict: d === 12 ? 'flagged' : null, has_photo: true,
    accuracy_m: 12, distance_m: 38, marked_by: d === 3 ? 'manual' : 'device', source: 'live',
  });
  if (d !== 18) {                                   // one day left open
    myPunches.push({
      id: `mp${d}o`, direction: 'out', captured_at: `${MONTH}-${dd}T18:40:00Z`,
      received_at: `${MONTH}-${dd}T18:40:00Z`, site_name: 'Andheri office',
      flags: [], review_verdict: null, has_photo: true,
      accuracy_m: 11, distance_m: 30, marked_by: 'device', source: 'live',
    });
  }
}
export const MY_ATTENDANCE = {
  employee: { id: 'e1', name: 'Keval Shah', code: 'EMP-0001', joined_on: '2025-04-01' },
  punches: myPunches,
  retention: { punch_photo_retention_days: 45, record_retention_years: 3 },
};

export const CHANNELS = [
  { id: 'c-gst', name: 'gst-filings', type: 'channel', description: 'GSTR-1 and 3B for every client', unread_count: 3, member_count: 9, is_archived: false, my_last_read: at(8, 0), is_starred: true },
  { id: 'c-audit', name: 'audit-2026', type: 'private', description: 'Statutory audit working papers', unread_count: 0, member_count: 4, is_archived: false, my_last_read: at(8, 0), is_starred: false },
  { id: 'c-dm', name: 'Priya Nair', type: 'dm', description: null, unread_count: 1, member_count: 2, is_archived: false, my_last_read: at(8, 0), is_starred: false },
  { id: 'c-old', name: 'diwali-2025', type: 'channel', description: 'Closed campaign', unread_count: 0, member_count: 12, is_archived: true, my_last_read: at(8, 0), is_starred: false },
];

/* `list_messages` field names — sender_name/content/type, not author/body. */
export const MESSAGES = [
  { id: 'm1', channel_id: 'c-gst', content: 'GSTR-3B for Tata Steel is filed. Challan attached to the task.', sender_id: 'u2', sender_name: 'Aarav Mehta', sender_avatar: null, created_at: at(9, 2), is_edited: false, is_deleted: false, reactions: [{ emoji: '👍', count: 2, mine: false }], thread_count: 2, last_reply_at: at(9, 9), type: 'text', seen_by: [], seen_count: 3, metadata: null },
  { id: 'm2', channel_id: 'c-gst', content: 'Task PROJ-114 moved to In Review', sender_id: null, sender_name: null, sender_avatar: null, created_at: at(9, 20), is_edited: false, is_deleted: false, reactions: [], thread_count: 0, last_reply_at: null, type: 'system', seen_by: [], seen_count: 0, metadata: null },
  { id: 'm3', channel_id: 'c-gst', content: 'Can someone check the ITC reconciliation before I file?', sender_id: 'u3', sender_name: 'Keval Shah', sender_avatar: null, created_at: at(10, 5), is_edited: true, is_deleted: false, reactions: [], thread_count: 0, last_reply_at: null, type: 'text', seen_by: [], seen_count: 1, metadata: null },
];

export const THREAD = [
  { id: 'm1-1', channel_id: 'c-gst', content: 'Challan number is on the task.', sender_id: 'u3', sender_name: 'Keval Shah', created_at: at(9, 6), reactions: [], thread_count: 0, type: 'text', is_edited: false, is_deleted: false },
  { id: 'm1-2', channel_id: 'c-gst', content: 'Confirmed, thanks.', sender_id: 'u4', sender_name: 'Priya Nair', created_at: at(9, 9), reactions: [], thread_count: 0, type: 'text', is_edited: false, is_deleted: false },
];

export const DIRECTORY = [
  { user_id: 'u2', name: 'Aarav Mehta', email: 'aarav@example.test' },
  { user_id: 'u4', name: 'Priya Nair', email: 'priya@example.test' },
];

/* `GET /v1/esign/documents` answers an envelope — `r.data.data` (DocumentsTab). */
export const ESIGN_DOCS = [
  { id: 'd1', title: 'Engagement letter — Tata Steel', status: 'sent', created_at: at(9, 0), expires_at: '2026-08-20T00:00:00Z', signers_total: 2, signers_completed: 1, file_name: 'engagement.pdf', page_count: 4, signers: [{ id: 'sg1', name: 'Meera Joshi', email: 'meera@example.test', status: 'pending', order: 1 }, { id: 'sg2', name: 'Keval Shah', email: 'keval@example.test', status: 'signed', order: 2, signed_at: at(9, 30) }] },
  { id: 'd2', title: 'NDA — Powai vendor', status: 'completed', created_at: at(8, 0), expires_at: null, signers_total: 1, signers_completed: 1, file_name: 'nda.pdf', page_count: 2, signers: [{ id: 'sg3', name: 'Vikram Rao', email: 'vikram@example.test', status: 'signed', order: 1, signed_at: at(8, 20) }] },
  { id: 'd3', title: 'Board resolution', status: 'draft', created_at: at(7, 0), expires_at: null, signers_total: 0, signers_completed: 0, file_name: null, page_count: 0, signers: [] },
];

export const ESIGN_AUDIT = [
  { id: 'a1', event: 'created', actor_name: 'Keval Shah', at: at(9, 0), ip: null, detail: null },
  { id: 'a2', event: 'sent', actor_name: 'Keval Shah', at: at(9, 5), ip: null, detail: 'Sent to 2 signers' },
  { id: 'a3', event: 'viewed', actor_name: 'Meera Joshi', at: at(9, 22), ip: '203.0.113.7', detail: null },
  { id: 'a4', event: 'signed', actor_name: 'Keval Shah', at: at(9, 30), ip: '203.0.113.9', detail: 'OTP verified' },
];

export const WA_CONVERSATIONS = [
  { id: 'w1', contact_name: 'Meera Joshi', name: 'Meera Joshi', phone_number: '+911100000001', last_message: 'Sending the challan now', last_message_at: at(10, 0), unread_count: 2, window_expires_at: at(22, 0), status: 'open', assigned_to: null },
  { id: 'w2', contact_name: 'Vikram Rao', name: 'Vikram Rao', phone_number: '+911100000002', last_message: 'Received, thank you', last_message_at: at(6, 0), unread_count: 0, window_expires_at: at(6, 30), status: 'done', assigned_to: 'u3' },
];

export const WA_MESSAGES = [
  { id: 'wm1', direction: 'in', content: 'Sending the challan now', created_at: at(9, 55), status: 'delivered', sender_name: 'Meera Joshi', sender_id: null, type: 'text' },
  { id: 'wm2', direction: 'out', content: 'Thank you — received.', created_at: at(10, 0), status: 'read', sender_name: 'Keval Shah', sender_id: 'u3', type: 'text' },
];

export const WA_TEMPLATES = [
  { name: 'payment_reminder', language: 'en', status: 'APPROVED', category: 'UTILITY', body: 'Hello {{1}}, invoice {{2}} is overdue.' },
  { name: 'filing_done', language: 'en', status: 'APPROVED', category: 'UTILITY', body: 'Your {{1}} filing is complete.' },
];

export const ORG = {
  id: 'org1', name: 'Aekam & Associates', legal_name: 'Aekam and Associates LLP',
  gstin: '27AAAAA0000A1Z5', pan: 'AAAAA0000A', logo_url: null,
  address_line1: '4th floor, Andheri East', city: 'Mumbai', state: 'Maharashtra',
  pincode: '400069', country: 'India', phone: '+91 22 0000 0000',
  email: 'hello@example.test', website: 'https://kartavaya.com',
  plan: 'growth', seats_used: 14, seats_total: 25, member_count: 14,
  created_at: '2025-04-01T00:00:00Z', timezone: 'Asia/Kolkata',
  fiscal_year_start: '04-01', currency: 'INR',
};

export const MEMBERS = [
  { user_id: 'u3', name: 'Keval Shah', email: 'keval@example.test', platform_role: 'org_owner', org_role: 'owner', status: 'active', last_active_at: at(10, 0), grants: [{ module: 'pahchan', level: 'admin' }, { module: 'sanvaad', level: 'editor' }] },
  { user_id: 'u2', name: 'Aarav Mehta', email: 'aarav@example.test', platform_role: 'member', org_role: 'member', status: 'active', last_active_at: at(9, 0), grants: [{ module: 'sanvaad', level: 'viewer' }] },
  { user_id: 'u4', name: 'Priya Nair', email: 'priya@example.test', platform_role: 'member', org_role: 'member', status: 'invited', last_active_at: null, grants: [] },
];

export const MODULES = [
  { key: 'pahchan', name: 'Pahchan', hi: 'पहचान', enabled: true, description: 'Attendance' },
  { key: 'sanvaad', name: 'Sanvaad', hi: 'संवाद', enabled: true, description: 'Messaging' },
  { key: 'vetana', name: 'Vetana', hi: 'वेतन', enabled: false, description: 'Payroll' },
  { key: 'ganit', name: 'Ganit', hi: 'गणित', enabled: true, description: 'Accounting' },
];

export const NOTIFICATIONS = [
  { id: 'n1', kind: 'approval_requested', title: 'Meera Joshi requested approval', body: 'Engagement letter — Tata Steel', created_at: at(10, 0), read_at: null, link: '/approvals' },
  { id: 'n2', kind: 'mention', title: 'Aarav Mehta mentioned you', body: 'in #gst-filings', created_at: at(9, 30), read_at: null, link: '/sanvaad' },
  { id: 'n3', kind: 'task_assigned', title: 'Task assigned', body: 'Reconcile input tax credit for June', created_at: at(8, 0), read_at: at(8, 5), link: '/tasks' },
];

export const TASKS = [
  { task_id: 'kartavya-000411', title: 'Vendor agreement template — clause update', status: 'todo', priority: 'low', due_at: at(18, 0), assignee_user_ids: ['u3'], assignee_names: ['Keval Shah'], team_id: 't1', comment_count: 1, attachments: [], subtasks: [] },
  { task_id: 'kartavya-000090', title: 'Reconcile input tax credit for June', status: 'in_progress', priority: 'high', due_at: at(12, 0), assignee_user_ids: ['u3'], assignee_names: ['Keval Shah'], team_id: 't1', comment_count: 3, attachments: [], subtasks: [] },
];

export const CLIENT_PROJECTS = [
  { id: 'cp1', team_id: 't1', name: 'Statutory audit 2026', status: 'in_progress', open_tasks: 4, done_tasks: 11, updated_at: at(10, 0), owner_name: 'Keval Shah' },
  { id: 'cp2', team_id: 't2', name: 'Monthly GST compliance', status: 'in_progress', open_tasks: 2, done_tasks: 30, updated_at: at(9, 0), owner_name: 'Aarav Mehta' },
];
