# Notifications & Inbox

## Prerequisites
- `00-tokens.md`, `02-common-components.md`
- `09-customization.md` — tab 5 owns the preference UI; this file owns delivery
- `23-accessibility.md` — toasts need a live region

## Files to modify
- `frontend/src/pages/InboxPage.jsx` — legacy tokens, own state, own fetch
- `frontend/src/components/NotificationsModal.jsx` — same data, second copy of the state
- `frontend/src/components/layout/AppShell.jsx` — the poll, the synthetic toast, the permission prompt
- `frontend/src/components/layout/NotifToast.jsx` — live region, DND gate
- `frontend/src/pages/NotificationsSettingsPage.jsx` — unguarded `Notification.permission`; merges into `09`
- `frontend/src/lib/notifSound.js` — keep; add the DND check

## Files to create
- `frontend/src/hooks/useNotifications.js`
- `frontend/src/lib/notifKinds.js`

## Estimated scope
- 2 new files, 6 modified. The redesign is mostly consolidation.

---

## Defect 1 · Three components own the same data independently

```
AppShell.jsx           GET /notifications/poll   every N seconds → unread count + toasts
NotificationsModal.jsx GET /notifications        on open         → its own items[]
InboxPage.jsx          GET /notifications        on mount        → its own notifications[]
```

Three fetches, three copies of state, no shared source. Observable consequences:

- Mark something read in the bell dropdown, then open Inbox: **it is unread again** until Inbox refetches.
- Mark all read in Inbox: the bell badge keeps its old count until the next poll.
- Both are correct according to their own state and disagree with each other.

They also disagree on the request shape to the same endpoint:

```js
// NotificationsModal.jsx:23
api.post('/notifications/mark-read', { mark_all: true, notification_ids: [] })
// InboxPage.jsx:53
api.post('/notifications/mark-read', { mark_all: true })
```

One sends an empty array, the other omits the key. Both apparently work, which means the endpoint tolerates two shapes — and the next change to it will break exactly one caller.

**Fix: one hook, one cache.**

```js
// hooks/useNotifications.js — the only thing that talks to /notifications
export function useNotifications() {
  const qc = useQueryClient();
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => Array.isArray(r.data) ? r.data : []),
    staleTime: 30_000,
  });
  const markRead = useMutation({
    mutationFn: ids => api.post('/notifications/mark-read', { notification_ids: ids }),
    onMutate: ids => {                       // optimistic — the badge must move instantly
      qc.setQueryData(['notifications'], prev =>
        prev.map(n => ids.includes(n.notification_id) ? { ...n, read_at: new Date().toISOString() } : n));
    },
    onError: (_e, _ids, ctx) => qc.setQueryData(['notifications'], ctx.prev),
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/mark-read', { mark_all: true }),
    onMutate: () => qc.setQueryData(['notifications'], prev =>
      prev.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))),
  });
  return { items: data, unread: data.filter(n => !n.read_at).length, isLoading, error, markRead, markAll };
}
```

Bell, Inbox and the count all read from this. `AppShell`'s poll invalidates the key instead of holding its own array. Pick **one** request shape — `{ notification_ids: [...] }` or `{ mark_all: true }`, never both in one call — and make the backend reject the other.

## Defect 2 · The content-free toast

`AppShell.jsx` line 135:

```js
setToasts(prev => [...prev, { notification_id: \`synth-\${Date.now()}\`,
  title: 'New notification', message: 'Open notifications to view', url: null }]);
```

When the poll reports unread items but returns no payload for them, the app manufactures a toast that says a notification exists and declines to say what. It has no `url`, so it is not even clickable — the user must find the bell themselves.

A notification that does not say what happened is worse than none: it interrupts, costs a decision, and returns nothing. **Delete this branch.** If the poll knows the count but not the content, update the badge silently and let the user open the bell when they choose. An unexplained interruption is a bug, not a fallback.

## Defect 3 · `Notification.permission` read without a guard

`AppShell.jsx` guards correctly at line 45 — `if (!('Notification' in window)) return`. `NotificationsSettingsPage.jsx` line 18 does not:

```js
setPermission(Notification.permission);   // throws where the API is absent
```

Absent in iOS Safari before 16.4, in embedded webviews, and on any page not in a secure context. The settings page throws on mount there — a blank screen where the fix is one guard. Carry it into `09-customization.md` tab 5:

```js
const supported = typeof window !== 'undefined' && 'Notification' in window;
const [permission, setPermission] = useState(supported ? Notification.permission : 'unsupported');
```

`unsupported` needs its own UI state — "Your browser doesn't support push notifications" — not the `denied` copy, which tells the user to change a browser setting that does not exist.

## Defect 4 · The permission prompt fires on a timer

`AppShell.jsx` sets `notifPrompt` after **4 seconds** on the user's first authenticated load. Four seconds into their first ever session, before they have created anything, a permission request appears. Deny once and the browser blocks it permanently — no code can ask again.

Ask after the first action that would produce a notification: assigning a task to someone, requesting an approval, sending a message. The prompt then explains itself, because the user just did the thing it is about. Gate on an event, not a `setTimeout`.

## Defect 5 · Inbox is on the legacy palette

`InboxPage.jsx` line 16: `color: 'var(--ink-3)'`, `bg: 'var(--bg-soft)'`. Neither is in `00-tokens.md`. This is the third vocabulary `14-dark-mode.md` describes, and it means Inbox never received the design system.

---

## The eight kinds

One map, replacing the inline `getKind` in `InboxPage.jsx`:

```js
// lib/notifKinds.js
export const KINDS = {
  assigned:  { en:'Assigned to you',   hi:'आपको सौंपा',    color:'var(--st-in-progress)', icon:'user' },
  mention:   { en:'Mentioned you',     hi:'उल्लेख',        color:'var(--primary)',        icon:'at' },
  comment:   { en:'New comment',       hi:'टिप्पणी',       color:'var(--on-surface-3)',   icon:'message' },
  approval:  { en:'Approval needed',   hi:'स्वीकृति चाहिए', color:'var(--ap-pending)',     icon:'check-circle' },
  approved:  { en:'Approved',          hi:'स्वीकृत',       color:'var(--ok)',             icon:'check' },
  rejected:  { en:'Changes requested', hi:'बदलाव',         color:'var(--danger)',         icon:'x' },
  due:       { en:'Due soon',          hi:'नियत',          color:'var(--warn)',           icon:'clock' },
  support:   { en:'Support access',    hi:'सहायता',        color:'var(--pf-keyline)',     icon:'shield' },
};
```

Colours are the `00-tokens.md` §9 tokens, so they flip with the theme. Do not add a ninth kind without adding its email template and its row in the `09` preference table — a kind the user cannot switch off is a kind they will mute entirely by disabling notifications.

## Bell panel

```
NotificationBell (Topbar)
├── button  aria-label="Notifications" · badge when unread > 0
└── Popover  (382px, anchored right — not the current centred modal)
    ├── header: "Notifications · सूचनाएं" · Mark all read
    ├── list: max-height 60vh, scrolls
    │   └── NotifRow  kind dot · title · body (2-line clamp) · relative time · unread bar
    ├── EmptyState  "You're all caught up"
    └── footer: "Open Inbox →"
```

**A popover, not a modal.** `NotificationsModal.jsx` is centred and scrimmed, which stops the work behind it for a glance at a list. Anchor it under the bell.

```css
.k-notif{width:382px;max-width:calc(100vw - 24px);border-radius:var(--r-lg);background:rgba(var(--glass-tint),var(--glass-alpha));backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-sat));border:1px solid var(--outline-variant);box-shadow:var(--shadow-3);overflow:hidden}
.k-notif__row{display:grid;grid-template-columns:auto 1fr;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--outline-variant);cursor:pointer;transition:background var(--dur-fast)}
.k-notif__row:hover{background:var(--s-low)}
.k-notif__row[data-unread="true"]{box-shadow:inset 2px 0 0 var(--primary)}
.k-notif__dot{width:8px;height:8px;border-radius:50%;background:var(--k);margin-top:5px}
.k-notif__t{font-size:var(--t-body-sm);color:var(--on-surface);line-height:1.45}
.k-notif__m{font-size:var(--t-label);color:var(--on-surface-3);line-height:1.5;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.k-notif__ago{font-size:var(--t-label-sm);color:var(--on-surface-faint);font-family:var(--font-mono)}
```

Unread is marked by an inset left bar, not a background tint — a tinted row plus a hover tint gives four visual states for two booleans.

## Inbox page

Five tabs — All · Unread · Approvals · Mentions · Assigned — grouped by Today / Yesterday / This week / Earlier. Same `NotifRow`, same hook, no second fetch.

Reading a notification does not delete it. `19-client-portal.md` makes the same point about the approval record: "did I get told about that?" is a question people ask weeks later.

## Delivery — one gate, three channels

```
event → shouldDeliver(kind, prefs)
        ├── in-app toast   always, unless DND
        ├── browser push   if permission granted && prefs.push && !DND
        └── email          if prefs.email[kind]
```

```js
export function inDND(prefs, now = new Date()) {
  if (!prefs.dnd) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  const [fh, fm] = prefs.dndFrom.split(':').map(Number);
  const [th, tm] = prefs.dndTo.split(':').map(Number);
  const from = fh * 60 + fm, to = th * 60 + tm;
  return from <= to ? (m >= from && m < to) : (m >= from || m < to);  // handles 20:00 → 09:00
}
```

The wrap case is the whole point — quiet hours nearly always cross midnight, and a naive `from <= m && m < to` silences nothing.

**DND suppresses the toast, the sound and the push. It never suppresses the notification.** It arrives in the Inbox with its real timestamp, exactly as `17-mobile-app.md` records for Pahchan's offline buffer: the record is when it happened, not when you saw it.

**`support` ignores DND and ignores the email preference.** `09-customization.md` locks that email on. A customer being asked to grant access to their own data is told immediately, at 3am, whatever their settings say — and `11-platform-admin.md` states that support access is never silent.

## Sound

`lib/notifSound.js` is fine and stays — `NOTIF_SOUND_GROUPS`, `kv_notif_sound`, `playNotifSound()`, `playPraiseSound()`. Two changes: gate on `inDND()`, and move the preference read into the `k_prefs` object so it syncs across devices instead of living alone in `localStorage`.

`playPraiseSound` is called from `DrawerMeta.jsx` and `KanbanView.jsx` on completion. It is a different intent from a notification and should follow the same DND gate but its own toggle — someone who wants silent notifications may still want the completion sound, and vice versa.

## Accessibility

Toasts need the live region from `23-accessibility.md` defect 3, which does not currently exist — nothing in the notification path is announced to a screen reader today. The bell button needs `aria-label="Notifications"` (it has one) plus the count: `aria-label={\`Notifications, \${unread} unread\`}`, or the badge is invisible to anyone not looking at it.
