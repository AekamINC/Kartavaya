/**
 * The eight kinds — `21-notifications-inbox.md`.
 *
 * One map, replacing the inline `getKind` in `InboxPage.jsx`, which carried its
 * own four-entry table with a hardcoded `#8b5cf6` and a `default` row painted in
 * `--ink-3` / `--bg-soft`. Neither of those is in `00-tokens.md`; they are the
 * third token vocabulary `14-dark-mode.md` describes, and they are why Inbox
 * never received the design system.
 *
 * The colours here are the `00 §9` status tokens, so they flip with the theme.
 * They paint the 8px dot only — a fill, never text. `--primary` is 4.04:1 on
 * `--bg` and is not a text colour; the row's own words are `--on-surface` and
 * the kind label is `--on-surface-2`, both measured. The dot is also never the
 * only carrier of meaning (26 §8): the kind label sits beside it in words.
 *
 * The handover puts this in `lib/notifKinds.js`. It lives under `pages/inbox/`
 * because `lib/` is outside this change's file ownership; the export surface is
 * the one the handover specifies, so the move is a path edit when the bell in
 * `layout/` adopts it.
 *
 * DO NOT ADD A NINTH KIND without adding its email template and its row in the
 * `09` preference table. A kind the user cannot switch off is a kind they will
 * mute entirely by disabling notifications.
 */

export const KINDS = {
  assigned: { en: 'Assigned to you',   hi: 'आपको सौंपा',     color: 'var(--st-in-progress)', icon: 'user' },
  mention:  { en: 'Mentioned you',     hi: 'उल्लेख',          color: 'var(--primary)',        icon: 'at' },
  comment:  { en: 'New comment',       hi: 'टिप्पणी',         color: 'var(--on-surface-3)',   icon: 'message' },
  approval: { en: 'Approval needed',   hi: 'स्वीकृति चाहिए',  color: 'var(--ap-pending)',     icon: 'check-circle' },
  approved: { en: 'Approved',          hi: 'स्वीकृत',         color: 'var(--ok)',             icon: 'check' },
  rejected: { en: 'Changes requested', hi: 'बदलाव',           color: 'var(--danger)',         icon: 'x' },
  due:      { en: 'Due soon',          hi: 'नियत',            color: 'var(--warn)',           icon: 'clock' },
  support:  { en: 'Support access',    hi: 'सहायता',          color: 'var(--pf-keyline)',     icon: 'shield' },
};

/**
 * The `type` strings the backend actually writes, mapped to the eight.
 *
 * `server.py` emits `assigned`, `mention`, `comment`, `approval_request`,
 * `approved`, `rejected`, `reminder`, `status_changed`, `done` and `created`.
 * The last four have no kind here and must not be given one — see the warning
 * above. They render with the neutral dot and their own title, which is the
 * honest outcome: the row still says what happened, it just does not claim a
 * category the preference table cannot switch off.
 */
const EXACT = {
  assigned: 'assigned',
  assign: 'assigned',
  assignment: 'assigned',
  mention: 'mention',
  mentioned: 'mention',
  comment: 'comment',
  approval: 'approval',
  approval_request: 'approval',
  requested: 'approval',
  approved: 'approved',
  rejected: 'rejected',
  reminder: 'due',
  due: 'due',
  due_soon: 'due',
  support: 'support',
  support_access: 'support',
};

/**
 * Ordered substring fallbacks, for type strings the exact table has not seen.
 * Order matters: `approval_request` must not fall into `approved`, so the
 * longer, more specific stems are tested first.
 */
const FUZZY = [
  ['mention', 'mention'],
  ['assign', 'assigned'],
  ['approval', 'approval'],
  ['approved', 'approved'],
  ['reject', 'rejected'],
  ['comment', 'comment'],
  ['remind', 'due'],
  ['due', 'due'],
  ['support', 'support'],
];

/** The kind KEY for a notification, or `null` when it maps to none of the eight. */
export function kindKeyOf(notif) {
  const t = String(notif?.type || '').toLowerCase().trim();
  if (!t) return null;
  if (EXACT[t]) return EXACT[t];
  for (const [stem, key] of FUZZY) if (t.includes(stem)) return key;
  return null;
}

/** The kind ENTRY, or a neutral stand-in that claims no category. */
export const NEUTRAL_KIND = {
  en: 'Notification', hi: 'सूचना', color: 'var(--on-surface-3)', icon: 'bell',
};

export function kindOf(notif) {
  const key = kindKeyOf(notif);
  return key ? KINDS[key] : NEUTRAL_KIND;
}

/* ── Tabs ──────────────────────────────────────────────────────────────────
   Five tabs — All · Unread · Approvals · Mentions · Assigned. Filters only;
   the same array feeds all five, and no tab fetches. */

export const INBOX_TABS = [
  { value: 'all',       label: 'All',       hi: 'सब' },
  { value: 'unread',    label: 'Unread',    hi: 'अपठित' },
  { value: 'approvals', label: 'Approvals', hi: 'स्वीकृति' },
  { value: 'mentions',  label: 'Mentions',  hi: 'उल्लेख' },
  { value: 'assigned',  label: 'Assigned',  hi: 'सौंपा' },
];

const APPROVAL_KINDS = new Set(['approval', 'approved', 'rejected']);

export function matchesTab(notif, tab) {
  switch (tab) {
    case 'unread':    return !notif.read_at;
    case 'approvals': return APPROVAL_KINDS.has(kindKeyOf(notif));
    case 'mentions':  return kindKeyOf(notif) === 'mention';
    case 'assigned':  return kindKeyOf(notif) === 'assigned';
    default:          return true;
  }
}

export function filterByTab(items, tab) {
  return tab === 'all' ? items : items.filter((n) => matchesTab(n, tab));
}

export function countForTab(items, tab) {
  return tab === 'all' ? items.length : items.reduce((n, it) => n + (matchesTab(it, tab) ? 1 : 0), 0);
}

/* ── Grouping ──────────────────────────────────────────────────────────────
   Today / Yesterday / This week / Earlier, by calendar day rather than by
   elapsed hours: something posted at 23:50 is "Yesterday" at 00:10, not
   "20m ago, Today". */

export const GROUPS = [
  { key: 'today',     label: 'Today',     hi: 'आज' },
  { key: 'yesterday', label: 'Yesterday', hi: 'कल' },
  { key: 'week',      label: 'This week', hi: 'इस सप्ताह' },
  { key: 'earlier',   label: 'Earlier',   hi: 'पहले' },
];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function groupKeyOf(created, now = new Date()) {
  const t = new Date(created);
  if (Number.isNaN(t.getTime())) return 'earlier';
  const days = Math.round((startOfDay(now) - startOfDay(t)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'week';
  return 'earlier';
}

/**
 * Group in list order. The API returns `ORDER BY created_at DESC`, so walking
 * the array preserves that ordering inside each bucket without a second sort.
 */
export function groupNotifications(items, now = new Date()) {
  const buckets = new Map(GROUPS.map((g) => [g.key, []]));
  for (const n of items) buckets.get(groupKeyOf(n.created_at, now)).push(n);
  return GROUPS
    .map((g) => ({ ...g, items: buckets.get(g.key) }))
    .filter((g) => g.items.length > 0);
}
