// Sahayak — data for the assistant thread.
//
// Every claim carries its source, and a source is a route this org can already
// call. That is the constraint the whole surface is built on: the assistant may
// only say things the reader could have gone and looked up, and it must show
// where. `skill_function` steps read data (free); `agent_type` steps are an LLM
// call and cost credits — the same split staging's skill_dispatcher makes.

const SH_SEEDS = [
  ['Who owes us money past 45 days?', 'Reads Ganit receivables'],
  ['What changed on the Tata audit this week?', 'Reads tasks, files and #audit-tata-steel'],
  ['Draft the Diwali note to all clients', 'Writes — nothing sends without you'],
  ['Is anyone about to breach a leave balance?', 'Reads Manav leave ledgers'],
];

const SH_TURNS = [
  {
    q: 'Who owes us money past 45 days, and what have we already chased?',
    at: '11:38 am',
    work: [
      { s: 'done', t: 'Read overdue invoices', k: 'find_overdue_invoices · free' },
      { s: 'done', t: 'Read follow-ups on each customer', k: 'graha_followup_reminders · free' },
      { s: 'done', t: 'Wrote the summary', k: 'agent_type: analysis · 2 credits' },
    ],
    figs: [
      { l: 'Past 45 days', v: '₹18.4 L', s: 'across 6 customers', k: 'GET /v1/ganit/invoices?overdue_gt=45' },
      { l: 'Never chased', v: '2', s: 'no follow-up on record', k: 'GET /v1/graha/follow-ups' },
      { l: 'Oldest', v: '96d', s: 'Nirmal Exports · INV-2104', k: 'GET /v1/ganit/invoices/INV-2104' },
    ],
    body: [
      { t: 'Six customers are past 45 days for ₹18.4 L in total. ', c: [['1', 'GET /v1/ganit/invoices?overdue_gt=45']],
        after: 'Four have had at least one follow-up logged; two have had none at all.' },
      { t: 'The two never chased are Nirmal Exports (₹6.2 L, 96 days) and Shreeji Traders (₹1.1 L, 61 days). ', c: [['2', 'GET /v1/graha/follow-ups?contact_id=…']],
        after: 'Nirmal is the larger exposure and the older one, so it is the first call.' },
      { t: 'Saraswati Textiles is at 52 days but has three follow-ups and a part payment on 28 July, so it is moving. ', c: [['3', 'GET /v1/ganit/payments?invoice=INV-2233']], after: '' },
    ],
    none: {
      t: 'What it would not tell you',
      d: 'You also asked whether any of these are disputed. Nothing in the product records a dispute — there is no field for it on an invoice and no note convention that could be read reliably. Two customers have comment threads that read like disputes, but inferring one from prose would be a guess presented as a fact.',
    },
    acts: ['Open the 6 invoices', 'Create follow-ups for the two', 'Send to Rohan'],
    cost: '2 credits · 4 records read',
    srcs: [
      { t: 'Ganit · Invoices', n: '6 rows', k: 'GET /v1/ganit/invoices?overdue_gt=45' },
      { t: 'Graha · Follow-ups', n: '9 rows', k: 'GET /v1/graha/follow-ups' },
      { t: 'Ganit · Payments', n: '1 row', k: 'GET /v1/ganit/payments' },
      { t: 'Graha · Contacts', n: '6 rows', k: 'GET /v1/graha/contacts' },
    ],
    ev: {
      cols: ['Invoice', 'Customer', 'Amount', 'Days', 'Chased'],
      rows: [
        ['INV-2104', 'Nirmal Exports', '₹6,20,000', '96', 'never'],
        ['INV-2233', 'Saraswati Textiles', '₹4,80,000', '52', '3 times'],
        ['INV-2251', 'Shreeji Traders', '₹1,10,000', '61', 'never'],
        ['INV-2260', 'Tata Steel', '₹3,90,000', '49', '1 time'],
        ['INV-2266', 'Vardhman Traders', '₹1,45,000', '47', '2 times'],
        ['INV-2271', 'Sundar Textiles', '₹95,000', '46', '1 time'],
      ],
    },
  },
];

Object.assign(window, { SH_SEEDS, SH_TURNS });
