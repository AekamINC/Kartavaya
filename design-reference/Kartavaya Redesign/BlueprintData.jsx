// System blueprint — data. Provenance: 'src' verified in staging, 'ui' implied
// by the design, 'gap' needed and absent. Nothing here is unmarked.
const P = {
  src: ['Source', 'Read in kevalvshah/Kartavya@staging — frontend or backend, cited per row'],
  ui: ['Design', 'Implied by the prototype. NOT checked against the backend — treat as a proposal'],
  gap: ['Gap', 'Believed absent. Verify against backend/ before building — see the legend note'],
};

const MACHINES = [
  {
    id: 'task', name: 'Task', hi: 'कार्य', prov: 'src',
    from: 'drawer/constants.js · STATUS_COLORS keys, StatusBar order',
    note: 'Six states, but only four are a line. requested and rejected are an approval loop hanging off in_review — they are not stages, and rendering them in the same pipeline is why the drawer and the list disagree about what a status is.',
    states: [
      { id: 'todo', label: 'To do', tone: 'idle', x: 0 },
      { id: 'in_progress', label: 'In progress', tone: 'live', x: 1 },
      { id: 'in_review', label: 'In review', tone: 'live', x: 2 },
      { id: 'done', label: 'Done', tone: 'ok', x: 3 },
      { id: 'requested', label: 'Changes requested', tone: 'warn', x: 2, y: 1 },
      { id: 'rejected', label: 'Rejected', tone: 'bad', x: 3, y: 1 },
    ],
    edges: [
      ['todo', 'in_progress', 'any member with project write'],
      ['in_progress', 'in_review', 'any member with project write'],
      ['in_review', 'done', 'approver only, if approval required'],
      ['in_review', 'requested', 'approver — notes required'],
      ['requested', 'in_progress', 'assignee'],
      ['in_review', 'rejected', 'approver — notes required'],
    ],
    api: 'PATCH /v1/tasks/{id}  { status }',
    guards: [
      ['Backward moves', 'Allowed except out of done. Reopening a done task is a new state change, audited.'],
      ['Notes', 'Mandatory on requested and rejected. The UI disables the button until non-empty; the server must enforce it too.'],
      ['Approval gate', 'in_review → done is approver-only when the project requires approval. Otherwise any writer.'],
    ],
  },
  {
    id: 'approval', name: 'Approval', hi: 'अनुमोदन', prov: 'src',
    from: 'ApprovalsPage.jsx · openApproveFlow branches on type and loads /teams/:id/clients',
    note: 'pending_client is the state the whole module exists for — "waiting on us" versus "waiting on the client" is a different escalation path, a different SLA and a different notification target. It is not a sub-case of pending.',
    states: [
      { id: 'pending', label: 'Pending', tone: 'warn', x: 0 },
      { id: 'pending_client', label: 'With client', tone: 'info', x: 1 },
      { id: 'approved', label: 'Approved', tone: 'ok', x: 2 },
      { id: 'rejected', label: 'Rejected', tone: 'bad', x: 2, y: 1 },
    ],
    edges: [
      ['pending', 'approved', 'internal approver'],
      ['pending', 'pending_client', 'approver forwards — client selected'],
      ['pending_client', 'approved', 'client, via portal'],
      ['pending_client', 'rejected', 'client — notes surface to the team'],
      ['pending', 'rejected', 'internal approver — notes required'],
    ],
    api: 'POST /v1/approvals/{id}/approve · /reject · /forward  { notes, client_id? }',
    guards: [
      ['Forward target', 'A client must be selected from /teams/:id/clients. Forwarding to nobody is the failure mode to block.'],
      ['Client identity', 'The portal approver is a client contact, not an org member. Auth is a scoped share token — see 19-client-portal.md.'],
      ['Rejection notes', 'Required in both directions and visible to the task creator.'],
    ],
  },
  {
    id: 'order', name: 'Sales order', hi: 'आदेश', prov: 'src',
    from: 'VikrayPage.jsx · NEXT_STATUS / NEXT_LABEL, verbatim',
    note: 'Strictly linear, one forward action at a time, with edit and cancel closing after dispatch. This is the cleanest state machine in the codebase and the UI renders it as a single button whose label changes — which hides the shape entirely.',
    states: [
      { id: 'draft', label: 'Draft', tone: 'idle', x: 0 },
      { id: 'confirmed', label: 'Confirmed', tone: 'live', x: 1 },
      { id: 'dispatched', label: 'Dispatched', tone: 'live', x: 2 },
      { id: 'delivered', label: 'Delivered', tone: 'live', x: 3 },
      { id: 'closed', label: 'Closed', tone: 'ok', x: 4 },
      { id: 'cancelled', label: 'Cancelled', tone: 'bad', x: 1, y: 1 },
    ],
    edges: [
      ['draft', 'confirmed', 'Confirm Order'],
      ['confirmed', 'dispatched', 'Mark Dispatched'],
      ['dispatched', 'delivered', 'Mark Delivered'],
      ['delivered', 'closed', 'Close Order'],
      ['draft', 'cancelled', 'DELETE — draft or confirmed only'],
      ['confirmed', 'cancelled', 'DELETE — draft or confirmed only'],
    ],
    api: 'PATCH /v1/vikray/orders/{id}/status  { status }',
    guards: [
      ['Invoice once', 'status !== draft && !invoice_id. Enforce server-side; the button is only a hint.'],
      ['Mutability', 'Edit and cancel allowed in draft and confirmed only. After dispatch an order is a shipped fact.'],
      ['Cross-module', 'POST /invoice writes into Ganit. A user with Vikray write and no Ganit access can currently mint an invoice they cannot read.'],
    ],
  },
  {
    id: 'invite', name: 'Member invite', hi: 'निमंत्रण', prov: 'src',
    from: 'backend/invite_router.py · auth_router.py:142 · tests/test_auth.py',
    note: 'There is no open signup route and the owner has confirmed there will not be one, so every account originates here. This machine was badged Source while citing a design document; the handler was then read and it is cited properly below. The 7-day TTL is real — invite_router.py:280 — and resend already does the right thing.',
    states: [
      { id: 'sent', label: 'Sent', tone: 'live', x: 0 },
      { id: 'accepted', label: 'Accepted', tone: 'ok', x: 1 },
      { id: 'expired', label: 'Expired', tone: 'idle', x: 1, y: 1 },
      { id: 'revoked', label: 'Revoked', tone: 'bad', x: 2, y: 1 },
    ],
    edges: [
      ['sent', 'accepted', 'invitee sets a password'],
      ['sent', 'expired', 'TTL elapses — 7 days'],
      ['sent', 'revoked', 'org admin'],
      ['expired', 'sent', 'resend issues a NEW token'],
    ],
    api: 'POST /api/auth/accept-invite  (read) · create + revoke in backend/invite_router.py, prefix not read',
    guards: [
      ['TTL', 'timedelta(days=7) at invite_router.py:280. accept-invite re-checks expires_at server-side at auth_router.py:156 and does not trust the link.'],
      ['Resend', 'Already correct — UPDATE invites SET expires_at=NOW() WHERE email=$1 AND accepted_at IS NULL, then insert fresh. The old token dies immediately rather than running in parallel.'],
      ['Revoke', 'revoke_invite at invite_router.py:381. Admin-gated via _require_admin.'],
      ['Enumeration', 'auth_router.py:149 and :157 return different messages for invalid and expired. To an unauthenticated caller that is an oracle for whether an address was ever invited — collapse them.'],
    ],
  },
  {
    id: 'attendance', name: 'Attendance day', hi: 'उपस्थिति', prov: 'ui',
    from: 'MESSAGING-ATTENDANCE-SPEC.md and the Pahchan screens',
    note: 'The only machine whose transitions are triggered by physical presence, so every guard is a trust boundary. Face and geo are evidence attached to a transition, not states of their own.',
    states: [
      { id: 'absent', label: 'Not marked', tone: 'idle', x: 0 },
      { id: 'in', label: 'Clocked in', tone: 'ok', x: 1 },
      { id: 'break', label: 'On break', tone: 'warn', x: 2 },
      { id: 'out', label: 'Clocked out', tone: 'live', x: 3 },
      { id: 'leave', label: 'On leave', tone: 'info', x: 1, y: 1 },
      { id: 'anomaly', label: 'Flagged', tone: 'bad', x: 3, y: 1 },
    ],
    edges: [
      ['absent', 'in', 'face match + inside geo-fence'],
      ['in', 'break', 'self'],
      ['break', 'in', 'self'],
      ['in', 'out', 'face match'],
      ['absent', 'leave', 'approved leave request'],
      ['out', 'anomaly', 'server rule — see guards'],
    ],
    api: 'POST /v1/pahchan/clock  { kind, face_embedding, lat, lng, accuracy }',
    guards: [
      ['Never trust the client', 'Face matching and fence evaluation happen server-side. The device sends an embedding and a coordinate; it does not send a verdict.'],
      ['Anomaly is derived', 'Outside fence, duration beyond shift, impossible travel between marks, duplicate device. Computed on write, not asserted by the app.'],
      ['Biometric storage', 'Store the embedding, never the image. It is biometric data under the DPDP Act and needs its own retention rule.'],
      ['Offline', 'Marks queue offline with the device clock, and the server records both device time and receipt time. Divergence is itself an anomaly signal.'],
    ],
  },
];

const ENTITIES = [
  { g: 'Tenancy', items: [
    ['org', 'src', 'Tenant root. Every table below is scoped to it — this is the RLS boundary.', 'name · gstin · pan · address · logo_url · plan · created_at'],
    ['user', 'src', 'Global identity. A person can belong to several orgs.', 'email · name · avatar_url · locale · created_at'],
    ['membership', 'src', 'user × org, and where the role lives. Not a column on user.', 'user_id · org_id · role · status · invited_by'],
    ['module_grant', 'ui', 'Per-member, per-module. Vetana, Ganit and Manav grant nothing until explicit — by role, per the owner.', 'membership_id · module · access(none|read|write)'],
    ['invite', 'src', 'Single-use token. The only route to an account.', 'org_id · email · role · grants · token_hash · expires_at · state'],
    ['support_session', 'ui', 'Aekam impersonation. Writes to the customer audit log and emails the owner — never silent.', 'org_id · operator_id · reason · started_at · ended_at'],
  ]},
  { g: 'Work', items: [
    ['project', 'src', 'Owns its columns and its approval requirement.', 'org_id · name · requires_approval · archived'],
    ['column', 'src', 'Ordered per project. Board columns are data, not an enum.', 'project_id · name · position · color'],
    ['task', 'src', 'The central entity. Six statuses; see the Task machine.', 'project_id · column_id · title · description · status · priority · due_at · created_by'],
    ['task_assignee', 'src', 'Many-to-many. The UI is multi-select with checkmarks.', 'task_id · membership_id'],
    ['subtask', 'src', 'Ordered, independently assignable, own completion.', 'task_id · title · done · assignee_id · position'],
    ['comment', 'src', 'Editable, soft-deleted, carries mentions.', 'task_id · author_id · body · edited_at · deleted_at'],
    ['mention', 'ui', 'Extracted on write so notification fanout is a join, not a body scan.', 'comment_id|message_id · membership_id'],
    ['attachment', 'src', 'Max 10 per task. Per-file privacy with an explicit viewer list.', 'task_id · name · size · mime · storage_key · is_private · uploaded_by'],
    ['attachment_grant', 'ui', 'Who may see a private file. Absent = private to uploader.', 'attachment_id · membership_id'],
    ['time_entry', 'src', 'Timer or manual. Store started_at/ended_at, never an accumulating counter.', 'task_id · membership_id · started_at · ended_at · minutes · note'],
    ['approval', 'src', 'Four states, optionally forwarded to a client.', 'task_id · requested_by · approver_id · client_id · state · notes'],
  ]},
  { g: 'Messaging', items: [
    ['channel', 'src', 'Public, private or DM. DM is a channel with two members.', 'org_id · name · kind · created_by · archived'],
    ['channel_member', 'src', 'Also carries per-user read position.', 'channel_id · membership_id · last_read_at · muted'],
    ['message', 'src', 'Threaded via parent_id. Edits and soft deletes are visible states.', 'channel_id · author_id · parent_id · body · edited_at · deleted_at'],
    ['reaction', 'ui', 'One row per user per emoji. Counts are aggregates, never stored.', 'message_id · membership_id · emoji'],
    ['wa_conversation', 'ui', 'Varta. Mirrors a WhatsApp thread against a Graha contact.', 'org_id · contact_id · wa_id · window_expires_at'],
    ['wa_template', 'ui', 'Meta-approved templates. Outside the 24h window only templates may be sent.', 'name · language · status · body'],
  ]},
  { g: 'Business', items: [
    ['contact', 'src', 'Graha. Customers and leads. Vikray reads, never writes.', 'org_id · name · company · gstin · email · phone'],
    ['product', 'src', 'Ganit. Autofills order lines with HSN, rate, GST rate, unit.', 'org_id · name · hsn_code · price · gst_rate · unit'],
    ['sales_order', 'src', 'Five states. Totals are server-authoritative.', 'org_id · contact_id · order_number · status · is_igst · subtotal · cgst · sgst · igst · discount · total · invoice_id'],
    ['order_line', 'src', 'Currently a JSON blob on the order — normalise it.', 'order_id · description · hsn_code · quantity · unit · rate · gst_rate · discount_pct'],
    ['stock', 'src', 'Per product. Adjustments carry a reason the UI does not yet surface.', 'product_id · quantity_on_hand · low_stock_threshold'],
    ['invoice', 'src', 'Generated from an order, once. Compliance fields are mandatory.', 'org_id · order_id · invoice_number · place_of_supply · issued_at'],
    ['attendance_mark', 'ui', 'One row per clock event, not per day. The day is a view.', 'membership_id · kind · at · device_at · lat · lng · face_score · anomaly'],
  ]},
  { g: 'Cross-cutting', items: [
    ['notification', 'src', 'Eight kinds with Hindi labels. Fanned out from mention and state-change writes.', 'membership_id · kind · title · body · url · read_at'],
    ['audit_log', 'ui', 'Append-only. Support sessions and destructive actions land here.', 'org_id · actor_id · action · entity · entity_id · meta · at'],
    ['outbox', 'gap', 'Transactional outbox. Without it a task PATCH can commit while its notification and websocket fanout are lost.', 'id · topic · payload · created_at · published_at'],
    ['idempotency_key', 'gap', 'Required for the mobile queue — see Sync. Nothing in staging deduplicates a replayed mutation.', 'key · membership_id · endpoint · response · created_at'],
  ]},
];

const REALTIME = [
  ['Typing', 'channel:{id}', 'ephemeral', 'Never persisted. 3s expiry, client-side debounce. Pure pub/sub — if it is in the database it is wrong.'],
  ['Presence', 'org:{id}', 'ephemeral', 'Connection-derived. Reconciled on connect, not written per heartbeat.'],
  ['New message', 'channel:{id}', 'durable', 'Persist, then publish via outbox. A message that exists for the socket and not the database is the worst outcome here.'],
  ['Unread count', 'user:{id}', 'derived', 'Computed from channel_member.last_read_at. Do not maintain a counter column; it will drift and it cannot be recomputed.'],
  ['Notification', 'user:{id}', 'durable', 'Same row drives in-app, push and email. One record, three transports, so read state stays consistent.'],
  ['Task changed', 'project:{id}', 'durable', 'Board and table subscribe. Needed for two people on one board — the current UI has no reconciliation at all.'],
  ['Timer', 'user:{id}', 'derived', 'Never stream ticks. Publish started_at once; every client computes elapsed locally.'],
  ['Approval', 'user:{id}', 'durable', 'Forwarding to a client must reach a portal session, which is a different auth scope.'],
];

const SYNC = [
  ['Queue', 'src', 'mobile/src/offline/mutationQueue.ts exists. Read it before designing around it — this session cited it without opening it, which is exactly the error 25 §3 is about.'],
  ['Idempotency', 'gap', 'Every queued mutation needs a client-generated key, echoed by the server. Without it, a replay after a flaky response double-creates.'],
  ['Ordering', 'ui', 'Per-entity FIFO, not global. A comment on a task that failed to create must fail with it, not overtake it.'],
  ['Conflict', 'ui', 'Last-write-wins per field is acceptable for title, description, due date. It is not acceptable for status — a state transition must re-evaluate its guard server-side and can legitimately be rejected on replay.'],
  ['Attendance', 'ui', 'Never LWW. Both device_at and received_at are recorded, and divergence is an anomaly input rather than something to reconcile away.'],
  ['Surfacing', 'ui', 'A rejected mutation must be visible, not swallowed. The offline banner covers connectivity; a failed replay needs its own resolution path.'],
];

const PERMS = {
  roles: ['Owner', 'Admin', 'Manager', 'Member', 'Client'],
  rows: [
    ['Projects & tasks', ['full', 'full', 'full', 'write', 'none']],
    ['Approve work', ['full', 'full', 'full', 'none', 'scoped']],
    ['Sanvaad', ['full', 'full', 'full', 'write', 'none']],
    ['Varta (WhatsApp)', ['full', 'full', 'write', 'none', 'none']],
    ['Graha (CRM)', ['full', 'full', 'write', 'read', 'none']],
    ['Vikray (Sales)', ['full', 'full', 'write', 'read', 'none']],
    ['Ganit (Accounts)', ['full', 'grant', 'grant', 'grant', 'none']],
    ['Vetana (Payroll)', ['full', 'grant', 'grant', 'grant', 'none']],
    ['Manav (HR)', ['full', 'grant', 'grant', 'grant', 'none']],
    ['Pahchan (own)', ['full', 'full', 'full', 'full', 'none']],
    ['Pahchan (all)', ['full', 'full', 'read', 'none', 'none']],
    ['Members & roles', ['full', 'full', 'read', 'none', 'none']],
    ['Billing', ['full', 'read', 'none', 'none', 'none']],
    ['Delete org', ['full', 'none', 'none', 'none', 'none']],
    ['Shared files', ['full', 'full', 'full', 'write', 'read']],
  ],
};

const OPEN = [
  ['Order lines are a JSON blob', 'src', 'line_items is stored as JSON and parsed with JSON.parse(o.line_items || \'[]\') in two places. No line-level query, no HSN aggregation, no GST report without scanning every order. Normalise before there is volume.'],
  ['Totals computed twice', 'src', 'The create form does GST arithmetic client-side; the detail view reads server values. Two implementations that can disagree, on money. Server is authoritative; the client figure must be labelled an estimate.'],
  ['No outbox', 'gap', 'Notification fanout and socket publishes are side effects of request handlers. A commit that succeeds while its fanout fails leaves a task changed and nobody told.'],
  ['Eight status maps', 'src', 'Colour is defined in eight places that disagree — a done task is green in the drawer and teal in the list. Fixed in the design by aliasing to tokens; the API should return the status key only and never a colour.'],
  ['Cross-module authorisation', 'src', 'POST /v1/vikray/orders/{id}/invoice writes into Ganit, which is a sensitive module. The grant check has to consider the target module, not the calling one.'],
  ['Client auth scope', 'ui', 'A client approver is not a member. Portal access is a scoped share token with its own lifetime, and it must not resolve to a membership row.'],
  ['Soft-delete semantics', 'ui', 'Comments and messages show a tombstone; tasks and orders do not. Decide per entity and make it explicit — an inconsistent delete is a support burden.'],
  ['Org deletion is queued', 'ui', 'Seven days, not immediate, per the owner. That needs a scheduled job and a restore path, not a cascade.'],
];

Object.assign(window, { P, MACHINES, ENTITIES, REALTIME, SYNC, PERMS, OPEN });
