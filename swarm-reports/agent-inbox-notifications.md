# Inbox & Notification surface — findings

Branch: `agent/inbox-notifications`. Base: `origin/staging` @ `2a2a27b`.
Governing spec: `design-handover/21-notifications-inbox.md`.

Written incrementally. Every line-number claim below was opened at the time of writing.

---

## 0. Environment note

The worktree was handed to me checked out at `1aa4985`, **271 commits behind
`origin/staging`** and carrying 13 commits about R2 attachments that are not in
staging at all. Nothing on it was mine. I branched `agent/inbox-notifications`
off `origin/staging` rather than working on that stale tree — anything built on
`1aa4985` would have re-reverted five months of staging on merge.

`frontend/node_modules` is absent in worktrees; junctioned from the main
checkout to run vitest. Not committed (gitignored).

Baseline before any edit of mine:
- `node frontend/scripts/check-tokens.mjs` → 279 declared, 229 referenced, 0 missing.
- `node frontend/scripts/check-classes.mjs` → 2096 selectors, 1416 classes, 0 missing a rule.
- `npx vitest run src/pages/inbox` → 15 passed.

---

## 1. Verification of the three claims I was handed

### Claim A — "three notification stores were consolidated into one" → **HELD**

Grepped every place notification state is held.
`frontend/src/context/NotificationContext.jsx` is a single module-level store
(`let state`, `listeners`, `useSyncExternalStore`). Confirmed the three former
owners now read it and hold no array of their own:

- `frontend/src/pages/InboxPage.jsx:44` — `useNotifications()`, no `useState` for items, no `api.get`.
- `frontend/src/components/NotificationsModal.jsx:49` — `useNotifications({ autoLoad: open })`, no local `items`.
- `frontend/src/components/layout/AppShell.jsx:137` — `useNotifications({ autoLoad: false })`; its
  only remaining local array is `toasts`, which is the transient card stack, not the list.

`grep -rn "api.get('/notifications" frontend/src` returns three hits, and the **list**
endpoint is fetched from exactly one of them — `NotificationContext.jsx:180`. The other
two are `/notifications/poll` (`NotificationContext.jsx:566`, `AppShell.jsx:247`).
The request-shape split the handover complained about is also gone: `markRead` sends
`{ notification_ids }` only, `markAll` sends `{ mark_all: true }` only.

Caveat recorded, not a defect: `AppShell.jsx:244` still runs its **own** 5-minute
`GET /notifications/poll` purely to read `r.data.approvals`, so that endpoint is hit by
two independent timers. The file's own comment says the fix belongs in the provider and
was left because `context/` was out of that agent's ownership. It is in mine — fixed, see §3.

### Claim B — "quiet hours already enforced on the backend" → **HELD**

`backend/services/push_service.py:41-56` `_in_quiet_hours` is real, wrap-aware and
called at line 108 before any token fetch. See §2 for the full proof.

### Claim C — "AppShell had an unguarded `Notification.permission` inside the poll" → **STALE (already fixed)**

`grep -rn "Notification\.permission" frontend/src` returns three hits, all guarded:

| file:line | guarded by |
| --- | --- |
| `context/NotificationContext.jsx:418` | `'Notification' in window` on line 417 |
| `pages/customize/TabNotifications.jsx:34` | `hasNotification ? … : 'unsupported'` |
| (comments only) `components/NotificationBanner.jsx:14` | — |

`AppShell.jsx` reads permission only through `notifPermission()` (lines 100, 109, 213).
There is no raw access left in the poll or anywhere else in that file. The claim
described a real past bug; it does not describe the current tree.

---

*(sections 2–5 appended as work lands)*
