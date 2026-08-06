// Messaging v2 — data. Shapes mirror staging: list_channels rows carry
// unread_count, mention_count, muted, member_count, my_last_read, is_archived,
// type ('public' | 'private' | 'dm'); Varta rows add the 24-hour window from
// varta/waWindow.js. Names are Indian SME / CA-firm realistic.

const M2_PEOPLE = {
  me:     { id: 'u1', name: 'You',           init: 'KS', c: '#04837A' },
  rohan:  { id: 'u2', name: 'Rohan Mehta',   init: 'RM', c: '#3E5C8A', p: 'on' },
  priya:  { id: 'u3', name: 'Priya Sharma',  init: 'PS', c: '#6E5AA0', p: 'away' },
  anil:   { id: 'u4', name: 'Anil Kumar',    init: 'AK', c: '#955806', p: 'off' },
  divya:  { id: 'u5', name: 'Divya Nair',    init: 'DN', c: '#14743A', p: 'on' },
  ramesh: { id: 'u6', name: 'Ramesh Patel',  init: 'RP', c: '#5A6270', p: 'off' },
};

// kind: 'channel' | 'dm' | 'wa'.  win: minutes left in the WhatsApp window.
const M2_CONVOS = [
  { id: 'c1', kind: 'channel', name: 'gst-filings', hi: 'जीएसटी', c: '#04837A',
    members: 9, unread: 4, mentions: 1, when: '2m', muted: false,
    last: 'Rohan: @You — the 3B for Saraswati needs your sign-off' },
  { id: 'c2', kind: 'channel', name: 'audit-tata-steel', hi: 'अंकेक्षण', c: '#3E5C8A',
    members: 6, unread: 12, mentions: 0, when: '18m', muted: true,
    last: 'Divya: uploaded the fixed-asset register' },
  { id: 'c3', kind: 'channel', name: 'general', hi: 'सामान्य', c: '#5A6270',
    members: 24, unread: 0, mentions: 0, when: '1h', muted: false,
    last: 'Priya: Diwali office timings are up on the board' },
  { id: 'c4', kind: 'channel', name: 'vikray-orders', hi: 'विक्रय', c: '#6E5AA0',
    members: 5, unread: 0, mentions: 0, when: '3h', muted: false,
    last: 'Anil: SO-2418 is short on HSN 7208' },
  { id: 'c9', kind: 'channel', name: 'q1-closing', hi: 'तिमाही', c: '#955806',
    members: 4, unread: 0, mentions: 0, when: '12 Jul', muted: false, archived: true,
    last: 'Closed after the June filing' },

  { id: 'd1', kind: 'dm', who: 'rohan', unread: 2, mentions: 0, when: '5m',
    last: 'Can you look at the ITC mismatch before 6?' },
  { id: 'd2', kind: 'dm', who: 'priya', unread: 0, mentions: 0, when: '40m',
    last: 'You: sent the payslip run for approval' },
  { id: 'd3', kind: 'dm', who: 'anil', unread: 0, mentions: 0, when: 'Yesterday',
    last: 'Thanks — got it' },

  { id: 'w1', kind: 'wa', name: 'Saraswati Textiles', person: 'Ramesh Patel',
    phone: '+91 98250 41xxx', unread: 3, mentions: 0, when: '8m', win: 252,
    last: 'When can we expect the invoice for March?' },
  { id: 'w2', kind: 'wa', name: 'Nirmal Exports', person: 'Sunita Rao',
    phone: '+91 99040 77xxx', unread: 0, mentions: 0, when: '2d', win: 0,
    last: 'You: Sharing the signed quotation.' },
  { id: 'w3', kind: 'wa', name: 'Shreeji Traders', person: 'Manoj Shah',
    phone: '+91 97260 15xxx', unread: 1, mentions: 0, when: '55m', win: 46,
    last: 'Received, thank you' },
];

// Messages for c1. `run` continues the previous sender's block.
// tick: 'sent' | 'delivered' | 'read' — own messages only.
// A message may carry any of: t (text), file, quote, rec (an embedded record),
// ph (photos), voice, link. The record cards are the point — people already
// discuss invoices and approvals in chat, and today they do it by pasting a
// number and switching tabs.
const M2_LOG = [
  { id: 'm1', day: 'Yesterday' },
  { who: 'divya', at: '4:12 pm', id: 'm2',
    t: 'GSTR-3B for Saraswati Textiles is drafted. Two invoices are missing HSN codes so I have parked them.' },
  { who: 'divya', at: '4:12 pm', id: 'm3', run: true,
    file: { name: 'GSTR-3B-draft-Jul2026.pdf', meta: 'PDF · 248 KB' } },
  { who: 'me', at: '4:31 pm', id: 'm4', tick: 'read', t: 'Good. Which two?' },
  { who: 'divya', at: '4:33 pm', id: 'm5',
    t: 'INV-2291 and INV-2304. Both are HSN 7208 — I have asked Anil.',
    rec: { kind: 'invoice', mod: 'Ganit', hi: 'गणित', c: '#04837A', ref: 'INV-2291',
      t: 'Saraswati Textiles Pvt Ltd', amt: '₹4,80,000',
      fields: [['Status', 'Overdue 52d'], ['Place of supply', 'Gujarat'], ['Tax', 'CGST + SGST'], ['HSN', 'missing']],
      acts: ['Open in Ganit', 'Add HSN'] },
    rx: [{ e: '👍', n: 2, mine: true }],
    thread: { n: 3, at: '4:58 pm', faces: ['anil', 'divya', 'rohan'], replies: [
      { who: 'anil', at: '4:41 pm', t: '7208 is right for hot-rolled coil. I will patch both.' },
      { who: 'divya', at: '4:52 pm', t: 'Patched on my side too — re-running the draft.' },
      { who: 'rohan', at: '4:58 pm', t: 'Then we are clear to file on the 20th.' },
    ] } },
  { id: 'm6', day: 'Today' },
  { who: 'priya', at: '10:04 am', id: 'm7',
    t: 'Reminder — the ITC reconciliation for Q1 closes Friday. Anything unmatched after that rolls to next quarter.',
    link: { host: 'cbic-gst.gov.in', t: 'Circular 214/8/2026-GST — input tax credit reversal timelines',
      d: 'Clarifies the treatment of credit notes issued after the annual return, and the window for reversal without interest.' } },
  { who: 'anil', at: '10:26 am', id: 'm8b',
    voice: { d: '0:34', bars: [3, 6, 11, 8, 14, 18, 12, 9, 15, 20, 16, 11, 7, 13, 17, 10, 6, 12, 8, 4, 9, 14, 7, 5] } },
  { id: 'm8', newLine: true },
  { who: 'rohan', at: '11:22 am', id: 'm9',
    quote: { who: 'divya', t: 'Patched on my side too — re-running the draft.' },
    t: '@You — the 3B for Saraswati needs your sign-off. Divya has cleared both HSN gaps.',
    mentionsMe: true },
  { who: 'rohan', at: '11:22 am', id: 'm10', run: true,
    t: 'Also: @channel please do not touch the Tata working papers until the partner review is done.' },
  { who: 'divya', at: '11:34 am', id: 'm10b',
    t: 'Stock count photos from the Ahmedabad godown, for the 7208 reconciliation.',
    ph: { n: 2, cap: 'Two photos · tap to open' } },
  { who: 'me', at: '11:38 am', id: 'm10c', tick: 'read',
    t: 'Signed off. Raising the filing approval here so it is on the record.',
    rec: { kind: 'ask', mod: 'Approval', hi: 'स्वीकरण', c: '#955806', ref: 'APR-1182',
      t: 'File GSTR-3B — Saraswati Textiles', amt: '',
      fields: [['Requested by', 'You'], ['Approver', 'Rohan Mehta'], ['Due', '20 Aug']],
      acts: [], done: 'Approved by Rohan Mehta at 11:41 am' } },
  { who: 'divya', at: '11:40 am', id: 'm11',
    t: 'Re-ran it. Totals match the books now.',
    rec: { kind: 'task', mod: 'Kartavya', hi: 'कर्तव्य', c: '#3E5C8A', ref: 'TSK-4471',
      t: 'File GSTR-3B for Saraswati Textiles', amt: '',
      fields: [['Assignee', 'Divya Nair'], ['Due', '20 Aug'], ['Subtasks', '4 of 5']],
      pct: 80, acts: ['Open task'] },
    rx: [{ e: '🎉', n: 3, mine: false }, { e: '✅', n: 1, mine: false }] },
];

// The Sahayak catch-up card. Sources are real staging routes — the assistant
// cites where each line came from, which is its whole contract.
const M2_CATCHUP = {
  since: '10:04 am',
  n: 5,
  points: [
    { t: 'Saraswati Textiles GSTR-3B is drafted and now reconciles — the two missing HSN codes on INV-2291 and INV-2304 are patched.',
      src: [{ l: 'Ganit · invoices', k: 'GET /v1/ganit/invoices' }, { l: '3 messages', k: '#gst-filings' }] },
    { t: 'It is waiting on your sign-off before the 20 Aug filing.',
      src: [{ l: 'Approvals queue', k: 'GET /v1/approvals?state=requested' }] },
    { t: 'The Tata working papers are frozen until partner review — Rohan asked the channel directly.',
      src: [{ l: '1 message', k: '#gst-filings · 11:22 am' }] },
  ],
  actions: ['Approve the 3B', 'Open INV-2291', 'Draft a reply'],
};

Object.assign(window, { M2_PEOPLE, M2_CONVOS, M2_LOG, M2_CATCHUP });
