// Status, approval and priority colour — the single map.
//
// Read the tokens; do not restate hexes. Three of the six statuses ARE --ok /
// --warn / --danger, so they inherit any contrast fix made in 00 §7 without
// this file changing. Re-expanding one of these to a literal is what caused
// the drift being fixed here.
//
// Before this file, the same six states were written out independently in
// drawer/constants.js and editorial/StatusChip.jsx, and they disagreed:
//   done       #16a34a (drawer, green)  vs #05b7aa (chip, teal)
//   requested  #9333ea (drawer, purple) vs #f59e0b (chip, amber)
//   todo       #64748b                  vs #94a3b8
//   in_review  #8b5cf6                  vs #a78bfa
//   in_progress both #0082c6 — the retired brand blue, gone in 00 §9
// Approval colours disagreed across all four states as well.
//
// Values are CSS custom-property references, valid anywhere a colour is:
// inline style, className var, or `${c}18` alpha suffix — see the note on
// mixAlpha below for that last case.

export const STATUS_COLORS = {
  todo:        'var(--st-todo)',
  in_progress: 'var(--st-in-progress)',
  in_review:   'var(--st-in-review)',
  requested:   'var(--st-requested)',   // = --warn
  done:        'var(--st-done)',        // = --ok
  rejected:    'var(--st-rejected)',    // = --danger
};

export const APPROVAL_COLORS = {
  pending:        'var(--ap-pending)',
  pending_client: 'var(--ap-pending-client)',
  approved:       'var(--ap-approved)',
  rejected:       'var(--ap-rejected)',
};

export const PRIORITY_COLORS = {
  urgent: 'var(--pr-urgent)',
  high:   'var(--pr-high)',
  medium: 'var(--pr-medium)',
  low:    'var(--pr-low)',
};

export const STATUS_LABELS = {
  todo:        'To do',
  in_progress: 'In progress',
  in_review:   'In review',
  done:        'Done',
  requested:   'Requested',
  rejected:    'Declined',
};

// The Devanagari half of the same six labels. It was a FOURTH status-label map,
// written out identically in DashboardPage.jsx and TasksListPage.jsx as a local
// `STATUS_HI` (05-today-dashboard.md §5 asks for it to be folded in here). Two
// copies of a translation table is how "requested" ends up meaning two things.
export const STATUS_LABELS_HI = {
  todo:        'कार्य',
  in_progress: 'चालू',
  in_review:   'समीक्षा',
  done:        'सम्पन्न',
  requested:   'अनुरोध',
  rejected:    'अस्वीकृत',
};

export const APPROVAL_LABELS = {
  pending:        'Awaiting Approval',
  pending_client: 'Awaiting Client Approval',
  approved:       'Approved',
  rejected:       'Rejected',
};

export const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

// Subscription and invoice states. A separate domain from task status, but it
// lives here so there is still ONE file to look in for a status colour —
// BillingPage had a sixth private map of hardcoded hexes.
export const BILLING_COLORS = {
  active:    'var(--ok)',
  paid:      'var(--ok)',
  trialing:  'var(--warn)',
  pending:   'var(--warn)',
  paused:    'var(--on-surface-3)',
  cancelled: 'var(--danger)',
  overdue:   'var(--danger)',
};

export const BILLING_LABELS = {
  active: 'Active', paid: 'Paid', trialing: 'Trialing', pending: 'Pending',
  paused: 'Paused', cancelled: 'Cancelled', overdue: 'Overdue',
};

// Sales order lifecycle (Vikray). draft → confirmed → dispatched → delivered →
// closed, plus cancelled. `cancelled` is NOT --danger: an order the customer
// withdrew is a normal terminal state, not an error, and colouring it red makes
// a routine list look like a list of failures.
export const ORDER_COLORS = {
  draft:      'var(--on-surface-2)',
  confirmed:  'var(--st-in-progress)',
  dispatched: 'var(--st-in-review)',
  delivered:  'var(--ok)',
  closed:     'var(--primary)',
  cancelled:  'var(--on-surface-3)',
};

export const ORDER_LABELS = {
  draft: 'Draft', confirmed: 'Confirmed', dispatched: 'Dispatched',
  delivered: 'Delivered', closed: 'Closed', cancelled: 'Cancelled',
};

export const orderColor = s => ORDER_COLORS[s] || FALLBACK;

export const billingColor = s => BILLING_COLORS[s] || FALLBACK;
/** Title-cased label for an enum, so `active` never reaches the user as-is. */
export const billingLabel = s =>
  BILLING_LABELS[s] || (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—');

const FALLBACK = 'var(--on-surface-3)';

export const statusColor   = s => STATUS_COLORS[s]   || FALLBACK;
export const approvalColor = s => APPROVAL_COLORS[s] || FALLBACK;
export const priorityColor = p => PRIORITY_COLORS[p] || FALLBACK;

// The old maps were hexes, so call sites built tints by string concatenation:
// `STATUS_COLORS[s] + '18'`. That silently produces "var(--st-done)18", which
// is not a colour and renders as nothing. Any such site must use this instead.
export const mixAlpha = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
