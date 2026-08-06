// Skills marketplace — data.
//
// Grounded in staging: `hub_skill_templates` carries skill_type
// (content | automation | detection | analysis), scope, module, category,
// steps[], estimated_credits, icon, is_system. A step is either a
// `skill_function` (reads your data, free) or an `agent_type` (an LLM call that
// costs credits). `WRITE_SKILL_FUNCTIONS` is the set that can change something —
// which is the only distinction that matters when asking permission.
//
// Aekam authors every skill. An organisation browses and REQUESTS; it cannot
// install. That is today's real rule — `assign_skill_to_org` is guarded by
// OPERATIONS_CONSOLE_ROLES, which holds no org-tier role — and the design states
// it rather than offering a button that 403s.

const MK_MODULES = [
  ['ganit', 'Ganit', 'गणित', 'Finance & GST', '#04837A'],
  ['graha', 'Graha', 'ग्राहक', 'CRM', '#3E5C8A'],
  ['manav', 'Manav', 'मानव', 'People', '#6E5AA0'],
  ['vetana', 'Vetana', 'वेतन', 'Payroll', '#955806'],
  ['vikray', 'Vikray', 'विक्रय', 'Sales', '#14743A'],
  ['kartavya', 'Kartavya', 'कर्तव्य', 'Work', '#5A6270'],
  ['dristi', 'Dristi', 'दृष्टि', 'Reports', '#6B4FBF'],
  ['prachar', 'Prachar', 'प्रचार', 'Marketing', '#A0426E'],
];

const MK_TYPES = [
  ['automation', 'Automation', 'Runs on a schedule and does the work'],
  ['detection', 'Detection', 'Watches for a condition and tells you'],
  ['analysis', 'Analysis', 'Reads your data and explains it'],
  ['content', 'Content', 'Writes something for you to approve'],
];

// status: 'active' | 'requested' | 'open' | 'blocked'
const MK_SKILLS = [
  { id: 's1', icon: 'chase', name: 'Receivables chase', hi: 'वसूली', mod: 'ganit', type: 'automation',
    d: 'Every Monday, finds invoices past their due date and emails each customer a chase with the invoice attached. Escalates to the account owner after the third attempt.',
    steps: [['data', 'find_overdue_invoices'], ['data', 'graha_followup_reminders'], ['ai', 'email']],
    reads: ['Invoices and their payment status', 'Customer contacts and follow-up history'],
    writes: ['Sends email to customers', 'Logs a follow-up against each contact'],
    run: 3, fee: 0, runs: 1840, orgs: 22, rating: 4.6, status: 'active', featured: true,
    every: 'Every Monday, 7:00 am' },

  { id: 's2', icon: 'brief', name: 'Monday morning brief', hi: 'साप्ताहिक', mod: 'dristi', type: 'analysis',
    d: 'One email at the start of the week: cash position, what is overdue, what is due, and which tasks slipped. Assembled from the modules you actually use — nothing about a module you have not turned on.',
    steps: [['data', 'aggregate_kpis'], ['data', 'find_overdue_invoices'], ['data', 'find_overdue_tasks'], ['ai', 'email']],
    reads: ['KPI aggregates across active modules', 'Overdue invoices', 'Overdue tasks'],
    writes: ['Sends one email to the recipients you name'],
    run: 4, fee: 2500, runs: 620, orgs: 14, rating: 4.8, status: 'open', featured: true,
    every: 'Every Monday, 8:30 am' },

  { id: 's3', icon: 'watch', name: 'GST filing watch', hi: 'कर सतर्कता', mod: 'ganit', type: 'detection',
    d: 'Checks every invoice in the period for the things that fail e-invoice validation — missing HSN, a blank place of supply, an inter-state invoice taxed as intra-state — and raises them before the 20th, not after.',
    steps: [['data', 'ganit_validate_invoices'], ['ai', 'analysis']],
    reads: ['Invoices, HSN codes, place of supply, tax split'],
    writes: ['Creates a task for each problem found'],
    run: 2, fee: 0, runs: 940, orgs: 19, rating: 4.9, status: 'open', featured: true,
    every: 'Daily from the 14th' },

  { id: 's4', icon: 'stale', name: 'Stale deal detection', hi: 'ठहरे सौदे', mod: 'graha', type: 'detection',
    d: 'Finds deals that have not moved in 14 days and tells the owner, with the last thing that happened on each so the nudge is useful rather than generic.',
    steps: [['data', 'graha_stale_deals'], ['ai', 'email']],
    reads: ['Deals, stages and stage history', 'Activity timeline per deal'],
    writes: ['Notifies the deal owner in-app and by email'],
    run: 2, fee: 0, runs: 1120, orgs: 17, rating: 4.4, status: 'requested' },

  { id: 's5', icon: 'hours', name: 'Attendance to payroll', hi: 'उपस्थिति', mod: 'vetana', type: 'automation',
    d: 'At the end of the cycle, publishes the approved attendance window into the payroll run and lists what it could not resolve — unreviewed punches, missing references, open corrections.',
    steps: [['data', 'pahchan_publish_window'], ['data', 'vetana_trigger_payroll']],
    reads: ['Approved attendance punches for the window', 'Payroll structures'],
    writes: ['Writes hours into the draft payroll run', 'Never approves a run — a person does that'],
    run: 0, fee: 0, runs: 310, orgs: 8, rating: 4.7, status: 'open', sensitive: true,
    every: 'Last day of the cycle' },

  { id: 's6', icon: 'stock', name: 'Low stock alert', hi: 'न्यून भंडार', mod: 'vikray', type: 'detection',
    d: 'Watches stock against each item’s threshold and warns before an order cannot be fulfilled, not after a customer has been promised a date.',
    steps: [['data', 'vikray_low_stock_alert']],
    reads: ['Stock levels and per-item thresholds', 'Open sales orders'],
    writes: ['Notifies the sales owner'],
    run: 0, fee: 0, runs: 2210, orgs: 11, rating: 4.5, status: 'open', every: 'Every 6 hours' },

  { id: 's7', icon: 'hire', name: 'Onboarding checklist', hi: 'नियुक्ति', mod: 'manav', type: 'automation',
    d: 'When an employee is created, builds their joining checklist from the role — documents, assets, accesses, the induction task — and assigns each item to whoever owns it.',
    steps: [['data', 'manav_onboarding_checklist']],
    reads: ['New employee record and role', 'Asset catalogue'],
    writes: ['Creates tasks and assigns them', 'Creates asset allocation requests'],
    run: 0, fee: 0, runs: 480, orgs: 13, rating: 4.3, status: 'open', sensitive: true,
    every: 'On employee creation' },

  { id: 's8', icon: 'escalate', name: 'Deadline escalation', hi: 'समय-सीमा', mod: 'kartavya', type: 'automation',
    d: 'Escalates a task that is past due and untouched to the assignee’s reporting line, once, with what it is blocking. Not a reminder loop.',
    steps: [['data', 'pm_deadline_escalation']],
    reads: ['Tasks, due dates, assignees and reporting lines'],
    writes: ['Notifies the reporting line'],
    run: 0, fee: 0, runs: 3400, orgs: 24, rating: 4.2, status: 'active', every: 'Daily, 9:00 am' },

  { id: 's9', icon: 'festival', name: 'Festival calendar', hi: 'त्योहार', mod: 'prachar', type: 'content',
    d: 'Three posts per festival across Instagram and LinkedIn plus an offer ad, written from your brand profile. Drafts land in the content library; nothing publishes without approval.',
    steps: [['ai', 'social_media'], ['ai', 'social_media'], ['ai', 'ad_copy']],
    reads: ['Your brand profile and tone', 'Festival calendar'],
    writes: ['Creates draft content items — no publishing'],
    run: 5, fee: 0, runs: 760, orgs: 9, rating: 4.1, status: 'open' },

  { id: 's10', icon: 'tags', name: 'Expense categorisation', hi: 'व्यय वर्ग', mod: 'ganit', type: 'analysis',
    d: 'Proposes a ledger category for every uncategorised expense, with the reason. You accept or reject in bulk — it never books anything on its own.',
    steps: [['data', 'ganit_categorize_expenses'], ['ai', 'analysis']],
    reads: ['Uncategorised expenses', 'Your chart of accounts and past categorisations'],
    writes: ['Nothing. Proposals only, until you accept them'],
    run: 2, fee: 0, runs: 1490, orgs: 16, rating: 4.6, status: 'open' },

  { id: 's11', icon: 'dedupe', name: 'Contact de-duplication', hi: 'दोहराव', mod: 'graha', type: 'detection',
    d: 'Finds contacts that are probably the same person and shows the evidence for each pair. Merging is yours — a wrong merge is not reversible.',
    steps: [['data', 'graha_contact_dedup']],
    reads: ['Contacts, emails, phone numbers and company names'],
    writes: ['Nothing. Proposes pairs for you to merge'],
    run: 0, fee: 0, runs: 340, orgs: 12, rating: 4.0, status: 'open' },

  { id: 's12', icon: 'shifts', name: 'Shift scheduling', hi: 'पाली', mod: 'manav', type: 'automation',
    d: 'Drafts next week’s roster from shift definitions, leave already approved and the bids people have put in. A draft — you publish it.',
    steps: [['data', 'manav_schedule_shifts']],
    reads: ['Shift definitions, approved leave, shift bids'],
    writes: ['Creates a draft roster'],
    run: 0, fee: 0, runs: 190, orgs: 5, rating: 3.9, status: 'blocked', sensitive: true,
    blocker: 'Needs Manav → Shifts, which is not active on your organisation.' },
];

Object.assign(window, { MK_MODULES, MK_TYPES, MK_SKILLS });
