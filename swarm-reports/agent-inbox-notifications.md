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

### Claim D — "nine delivery modes and an overnight schedule had no UI, and were given one" → **HELD, and incomplete**

`frontend/src/components/customize/NotifyPrefs.jsx:32-42` renders nine rows against
`GET/PUT /api/me/notification_prefs`, and `push_service.DEFAULT_PREFS` has the same
nine keys in the same order. That is real and it works.

What it does not cover — reported, not edited, because customize is another agent's:

- **`created` has a UI row and NO emitter.** Nothing in the backend ever writes
  `type='created'`. Grepped every `INSERT INTO notifications` (list in §2). A user
  can set "New tasks" to Off, Mine, Project or All and it governs nothing.
- **`reminder` had an emitter and NO row.** It is the highest-volume kind the product
  emits — every due-date reminder from `routers/task_reminders.py` and from the
  `/notifications/poll` sweep — and it had no `DEFAULT_PREFS` entry, so the mode
  lookup fell through to `MODE_ALWAYS` and no user could turn it down. **A sibling
  added the backend key while I was stopped** (`"reminder": "always"`), and **my two
  call-site gates are what make it do anything** — before those, nothing on the
  reminder path consulted prefs at all, so the key existed and still governed nothing.
  It is now genuinely enforced. **The UI row is still missing and is one line, yours:**
  `{ id: 'reminder', label: 'Reminders', fallback: 'always', hint: 'A task you are on is coming due.' }`
  in `KINDS` in `NotifyPrefs.jsx`.

---

## 2. Every notification type the backend can emit

Enumerated from the WRITERS — every `INSERT INTO notifications` in `backend/` — not
from the frontend's map. Nine writers, fourteen distinct `type` literals.

| `type` written | writer | display kind BEFORE | AFTER |
| --- | --- | --- | --- |
| `approval_request` | `server.py:1202` | approval | approval |
| `rejected` | `server.py:1335`, `approvals_router.py` | rejected | rejected |
| `approved` | `server.py:1401`, `approvals_router.py:459,560` | approved | approved |
| `comment` | `server.py:1580` | comment | comment |
| `assigned` | `server.py:2143` | assigned | assigned |
| `status_changed` | `server.py:2173` | neutral (deliberate) | unchanged |
| `done` | `server.py:2217` | neutral (deliberate) | unchanged |
| `reminder` | `server.py:2655,2689`, `task_reminders.py:97` | due | due |
| `mention` | `services/mentions.py:99` | mention | mention |
| **`request`** | **`approvals_router.py:214`** | **NEUTRAL — BUG** | **approval** |
| **`deadline_warning`** | **`agents/deadline_agent.py:85`** | **NEUTRAL — BUG** | **due** |
| **`deadline_escalation`** | **`agents/deadline_agent.py:110`** | **NEUTRAL — BUG** | **due** |
| `workload_warning` | `agents/workload_agent.py:44` | neutral | neutral (correct) |
| `automation` | `services/automation_engine.py:61` | neutral | neutral (correct) |

### The one that mattered: `request`

`POST /api/tasks/{task_id}/request-approval` → `send_approval_notification(..., "request", ...)`
→ `_notify` wrote `type='request'` **verbatim**. Meanwhile the *same function*, twelve
lines later, normalised the PUSH kind to `approval_request`:

```python
kind=notification_type if notification_type in ("approved", "rejected") else "approval_request",
```

One event, two names. `push_service.DEFAULT_PREFS`, `NotifyPrefs.jsx` and
`notifKinds.js` are all keyed on `approval_request`; nothing recognised `request`.
Consequences, both real:

1. It rendered with the neutral bell instead of the amber approval dot.
2. **It was invisible in the Inbox's Approvals tab.** `matchesTab` filters on the
   KIND (`APPROVAL_KINDS.has(kindKeyOf(notif))`), which was `null`. Every approval
   request raised through the approvals router was missing from the tab whose entire
   job is to list pending decisions. It was still visible under *All*, with a generic
   dot — which is precisely why nobody noticed.

**Fixed as a frontend alias only — the backend still writes `request`.**

I had originally also normalised the stored `type` to `approval_request` for new rows.
**The coordinator ruled against it and the ruling is right**, so I reverted it. The
reason is sharper than "don't touch data": staging and production share one Supabase
project, so `notifications` already holds `request` rows *that live users will open*.
Writing a second name for the same event splits the table down a deploy boundary — the
Approvals tab would work for rows after it and not for rows before it, which is the
same bug with a shorter blast radius and no way to tell from the UI which half you are
looking at. Normalising the write is only correct alongside a backfill, and a backfill
is a database write.

So `notifKinds.EXACT` carries **both** `request` and `approval_request`, both resolving
to the `approval` kind. Every row ever written renders with the amber dot and reaches
the Approvals tab, with nothing in the database touched.

What I kept from that commit is one line that stores no new type: `_notify` now points
the row at `/approvals` instead of `/tasks`. `server.py`'s own `approval_request` row
has always used `/approvals`; this one sent the reviewer to the board to go and find
it. That changes where **new** rows point and nothing about what they *are*.

Also fixed while there: `_notify` sent the reviewer to `/tasks`, while `server.py`'s
own `approval_request` row has always used `/approvals`. The two halves of one event
should not disagree about where it points.

`workload_warning` and `automation` are **left unmapped on purpose.** Neither is one
of the eight, and `21-notifications-inbox.md` is explicit: "Do not add a ninth kind
without adding its email template and its row in the `09` preference table — a kind
the user cannot switch off is a kind they will mute entirely." Mapping `request` →
approval and `deadline_*` → due adds no kind; it routes existing strings to kinds
that already exist and already have preference rows.

---

## 3. Quiet hours — the wrap-around proof

### The arithmetic, both sides

`backend/services/push_service.py:_in_quiet_hours` and
`frontend/src/context/NotificationContext.jsx:inQuietHours` are two implementations of
one rule, in two languages, in two processes. **Nothing compared them.** They now
assert the same 17-row table:
`backend/tests/test_quiet_hours_parity.py::PARITY` and the `PARITY` block in
`frontend/src/pages/inbox/__tests__/notifications.test.jsx`.

Both were already **correct**. The proof, rather than the fix:

```
start <= end  →  start <= now <  end        # 09:00–17:00, and start==end
start >  end  →  now >= start || now < end  # 22:00–07:00, wrapping midnight
```

The wrap branch is the whole point. `22:00 → 07:00` **is not an interval on a number
line** — no minute is both ≥ 1320 and < 420 — so the naive single-comparison form
returns false for all 1440 minutes and the schedule almost every user picks silences
**nothing at all**.

`tests/test_push_prefs.py` (a sibling's) already samples five minutes inside the window.
**A sampled test cannot reliably catch this class of bug**, because the off-by-one does
not make the window *wrong*, it makes it **empty** — a sample only catches that if it
happens to land inside. So the proof is exhaustive rather than sampled, and stated as
three arithmetic facts over all 1440 minutes of a day:

| assertion | value | naive form gives | "always quiet" form gives |
| --- | --- | --- | --- |
| overnight `22:00–07:00` silences | **540** min (120 + 420) | 0 | 1440 |
| daytime `09:00–17:00` silences | **480** min | 480 | 480 |
| `22:00–07:00` and `07:00–22:00` partition the day | every minute in exactly one | fails | fails |

The third is the strongest, because it states the property *without reference to either
branch of the implementation*: for all 1440 minutes, `night != day`. Both suites assert
the 540; the partition test is the one that would survive a rewrite.

Boundaries pinned on both sides: **start inclusive, end exclusive** (22:00 is quiet,
07:00 is not; 21:59 is not, 06:59 is). And `start == end` is an **empty** window, not a
24-hour one — the reading that lets a user clear their schedule by setting both ends
the same. The opposite reading would mean setting 07:00/07:00 to "turn it off" turned
it permanently ON with no visible cause.

Zone: the window is a wall-clock range in **one fixed zone**. The server evaluates it
against `datetime.now(IST)`; the browser computes IST minutes from UTC plus a fixed
offset rather than from `getHours()`. A user in London reading the device clock would
be shown quiet hours ending at 07:00 and see toasts stop 5½ hours off what the server
does. `test_window_is_evaluated_in_ist` pins the Python side, `istMinutes` the browser.

### The real defect: TWO delivery paths ignored the window entirely

`send_web_push` and `send_expo_push` take a `user_id` and fire. Neither accepts a
`kind`; neither reads `notification_prefs`. **Two call sites used them directly**, so
everything raised through either went to the device regardless of quiet hours *and*
regardless of the per-kind switch:

| call site | kinds affected |
| --- | --- |
| `server.py:create_notification` | `approval_request`, `assigned`, `comment`, `approved`, `rejected`, `status_changed`, `done` |
| `routers/task_reminders.py` (`channel_push`) | `reminder` |

`create_notification` is the helper **nearly every notification in the product goes
through**, so this was not an edge: it was the default path.

This is worse than a missing setting. The vocabulary was never missing — `DEFAULT_PREFS`
has every one of those kinds and the customize hub renders a switch for each. It was
simply never consulted on either path, so the user set it, watched it save, and still
got buzzed at 3am. A control that reports success and changes nothing teaches people
the product lies.

**Both are gated now**, on `push_service.prefs_allow()`.

> **Credit and convergence.** I had extracted my own `delivery_allowed()` for this. While
> I was stopped, a sibling landed a materially better `push_service.py` on staging —
> `_parse_hhmm` hardening so a malformed `quiet_start` cannot silently mute a user
> forever, `VALID_MODES`, `_coerce_prefs` for the PgBouncer path where the jsonb codec
> is skipped, `_resolve_mode` degrading corruption to the kind's *documented* default
> rather than the loudest one — and their own `prefs_allow()`. **I took their file
> wholesale and deleted mine.** Their header states the two call sites and records that
> the fix was "reported, not made — `server.py` is owned elsewhere". `server.py` and
> `task_reminders.py` are in my lane, so I made it, and updated their header to say so.

`prefs_allow` fails **open** — losing an approval request to a prefs-lookup timeout is
a bigger harm than one unwanted buzz.

**Both rows are still written, above the gate.** Quiet hours suppress the device, never
the record: the notification arrives in the Inbox with its real timestamp, because the
record is when it happened, not when you were willing to be interrupted by it. Pinned
by two source-ordering assertions, so a later refactor that moves an INSERT inside a
push branch fails.

`is_mine` defaults to `True` — the permissive reading of `mine_only`. Deliberate: `off`
and quiet hours are unambiguous and are now enforced, but deciding *whose* event it is
needs ownership context these call sites do not carry, and guessing wrong would silence
something the user asked for.

Frontend display: `NotificationBanner.jsx:216` renders the quiet-hours row only when
`inQuiet`, which is `snap.quiet.loaded && inQuietHours(...)` — a window that has not
been read back from the server is never announced. It ticks once a minute so a tab
left open across 22:00 stops claiming notifications are arriving. Both verified.

---

## 4. Read/unread, mark-all, pagination

### Pagination — did not exist; now real, end to end

`GET /notifications` was `... ORDER BY created_at DESC LIMIT 200`, no params, and the
frontend fetched it once. Anyone past 200 notifications simply could not reach the
201st, and everyone loaded a 200-row DOM on first paint.

**Backend** (`server.py`): keyset pagination on `(created_at, notification_id)` via
`limit` / `before` / `before_id`.

- **Keyset, not offset.** Rows are inserted at the head of this table while the user
  is reading it, so `OFFSET 40` after one arrival re-serves a row already on screen
  and skips one that never was.
- **The tiebreaker is load-bearing.** `_notify_status_changed` and the reminder
  dispatch each insert a row per recipient inside one loop, so a batch shares a
  `created_at` to the microsecond. Ordering on that column alone leaves the order
  inside a batch undefined, and a cursor sitting mid-batch drops or repeats its
  neighbours. `(created_at, notification_id)` is unique — the id is the PK.
- `ORDER BY` gained `, notification_id DESC` to match the cursor.
- **`limit` still defaults to 200**, so every existing caller is served exactly what
  it was. This matters: `mobile/src/api/notifications.ts` sends no paging params.

**Frontend**: `loadMoreNotifications()` in the store, anchored on the oldest row held;
`hasMore` inferred from a full page (a short page is the last page — the endpoint
returns no total, and a count query on every poll to save one empty request at the very
end is the wrong trade); `loadingMore` and `pageError` kept **separate** from `loading`
and `error` so a failed page cannot blank a list that is still good; a refresh **resets**
paging rather than splicing a fresh page one onto stale later pages with an unknown gap
between them. Overlapping rows are deduped — the cursor is exclusive server-side, but
a row can arrive by the poll between the two requests.

The control sits under the whole list, not under the tab, because the tabs are filters
over one array. Not an infinite scroller: this list is the record of what you were
told and people come here to find something they half remember; a scroller has no end
to reach and no position to return to.

### Optimistic reads — two bugs, one of them data loss

Both were genuinely optimistic and did revert. Two problems:

1. **The rollback destroyed unrelated notifications.** Both mutations reverted with
   `set({ items: prev })` — restoring the array snapshot taken *before* the request.
   The poll runs every 60s and `ingestNotifications` prepends to that same array, so a
   notification arriving during the round trip was **deleted** by the rollback of an
   unrelated failed click. A notification silently lost, by the list whose whole
   purpose is not to lose them. The rollback is now surgical: it undoes exactly the
   `read_at` values this call set, on whatever the array is now. Pinned by
   `a rollback does not delete a notification that arrived mid-flight`.
2. **The revert was silent.** A failed mark-read set `error`, which `InboxPage` renders
   only when `!items.length` — so in practice nothing was shown at all. Rows the user
   had just cleared quietly reappeared as unread with no explanation, and the only
   conclusion available is that the product is broken. `mutationError` is now surfaced
   in both the Inbox and the bell, deliberately distinct from `error` so it never
   raises a page-level failure card over a list that is fine.

Request shapes verified as one-per-call and pinned: `markRead` → `{ notification_ids }`,
`markAll` → `{ mark_all: true }`, never both keys together.

### Panel states

| panel | loading | empty | error | before |
| --- | --- | --- | --- | --- |
| Inbox page | `InboxSkeleton` + sr-only status | ✓ + a distinct per-tab filtered-to-zero state | ✓ `ErrorState` + retry | already correct |
| Inbox paging | `loadingMore` on the button | n/a | ✓ beside the button | **did not exist** |
| Bell popover | ✓ | ✓ | **✓ ADDED** | **no error branch at all** |
| Banner | n/a | renders nothing | `failed` on the enable action | already correct |

**The bell's missing error branch was the worst state in this surface.** A failed fetch
left `isLoading` false and `items` empty, so it rendered *"You're all caught up"* — the
app cheerfully asserting the user had nothing waiting at the exact moment it had no
idea whether they did. Someone with an approval pending would close the bell and walk
away. The empty state is now reachable only when the fetch actually **succeeded** and
returned nothing.

---

## 5. Other defects found and fixed in this surface

- **`shouldDeliver(type, prefs)` was passing the prefs object as the OPTIONS bag.**
  `AppShell.jsx` called `shouldDeliver(n?.type, prefs)`; the signature is
  `shouldDeliver(type, { quiet, prefs, now, isMine })`. It behaved correctly only
  because `k_prefs` happens to contain no key named `quiet`, `prefs`, `now` or
  `isMine`, so every destructured default still applied. One unrelated
  `CustomizePanel` default away from `quiet` destructuring to the wrong object and
  `inQuietHours` reading `undefined.start` — silently disabling the gate. Now
  `shouldDeliver(n?.type, { prefs })`.
- **A second `/notifications/poll` timer.** `AppShell` ran its own 5-minute poll purely
  to read `r.data.approvals`, because the provider exposed only `fresh`. That endpoint
  is **not a read**: `poll_notifications` processes due reminders and INSERTS
  notification rows as a side effect, so the second timer was running that sweep at a
  cadence nobody chose. Added `onPoll(payload)` to `NotificationProvider` — one call,
  both numbers, which is what `01-navigation.md` §4 asked for — and deleted the timer.

---

## 6. Email inventory (for the email agent — I changed no template)

### Does the template system match `design-reference/`?

`backend/email_service.py:48-71` bakes hex constants. Compared against
`design-reference/email-styles.css:5-21`, **every token matches exactly**:

| token | `email-styles.css` | `email_service.py` |
| --- | --- | --- |
| bg / bg-soft | `#F6F3EC` / `#F0ECDF` | `_BG` / `_BG_SOFT` ✓ |
| surface | `#FCFAF5` | `_SURFACE` ✓ |
| rule / rule-soft | `#E2DCC9` / `#EFE9D8` | `_RULE` / `_RULE_SOFT` ✓ |
| ink / 2 / 3 | `#1A2230` / `#4A5468` / `#6E7B91` | `_INK` / `_INK2` / `_INK3` ✓ |
| primary / mid / deep | `#05b7aa` / `#03a1b6` / `#0082c6` | `_TEAL` / `_MID` / `_DEEP` ✓ |
| danger / warn / ok | `#C0392B` / `#B06A00` / `#0A7A6E` | ✓ ✓ ✓ |
| font-display | `"Newsreader", Georgia, serif` | `_FONT_DISP` ✓ |
| font-ui | `Inter, …` | `_FONT_UI` ✓ |
| font-hindi | `"Tiro Devanagari Hindi","Noto Serif Devanagari","Newsreader",serif` | `_FONT_HINDI` ✓ |

Bilingual rule honoured: Devanagari is set in `_FONT_HINDI` (Tiro, single weight), and
`--ink-faint` — the non-text-only token — has no constant in `email_service.py` at all,
so it cannot be misused as text.

**Two geometry discrepancies, both yours to rule on:**

1. **Envelope width.** `email-styles.css` sets `.em{width:640px}`;
   `email_service.py:_base` renders `<table class="em__envelope" width="600">`.
   40px narrower than the design. (600 is the conventional safe email width; 640 is
   what the reference says. A deliberate call either way, but it is currently
   undocumented.)
2. **Outer padding.** Reference `.em{padding:48px 40px 40px}`; backend outer cell is
   `padding:32px 16px 40px`. The envelope's own `40px 36px` matches.

Everything else in `_base` — brand bar 22px/500 display + 16px Hindi in `_MID` +
`By Aekam Inc` at 10px/0.2em/700 in `_INK3`, `border-radius:18px`, and the exact
two-layer shadow — is character-identical to `.em__brand*` / `.em__envelope`.
`_dark_mode_css()` adds a `prefers-color-scheme:dark` block the reference CSS does not
carry; it looks correct and is additive.

### Which notification types have an email

| `type` | email function | wired? |
| --- | --- | --- |
| `approval_request` (`server.py`) | `send_approval_request_email` | ✓ |
| `approval_request` (`approvals_router`) | `send_approval_notification_email` → dispatches to request/decision | ✓ |
| `approved` | `send_approval_notification_email` / `send_request_approved_email` | ✓ |
| `rejected` | `send_approval_notification_email` | ✓ |
| `assigned` | `send_task_assignment_email` (`server.py:2147`) | ✓ |
| `mention` | `send_mention_email` (`mentions.py:111`) | ✓ |
| `status_changed` | `send_status_changed_email` | ✓ |
| `done` | `send_task_done_email` | ✓ |
| `reminder` (`task_reminders.py`) | `send_task_reminder_email` | ✓ |
| `reminder` (`/notifications/poll` sweep) | — | **✗ no email** |
| **`comment`** | **`send_comment_email` EXISTS at `email_service.py:615`** | **✗ NEVER CALLED** |
| `deadline_warning` | — | ✗ none |
| `deadline_escalation` | — | ✗ none |
| `workload_warning` | — | ✗ none |
| `automation` | `send_email` with caller-supplied HTML | ✗ bypasses the template system entirely |

### `"The reviewer"` — confirmed, and worse than it reads

`email_service.py:1145-1146`:

```python
return send_approval_decision_email(
    user_email, user_name, "The reviewer", task_title, task_id or "", notification_type, notes)
```

The approver's name never reaches the template — but `send_approval_decision_email`
does not merely mention it in passing. It uses `reviewer_name` in **three** places
(`:712-714`): the preheader, and twice in the body sentence, which renders as

> Hi **Priya**, **The reviewer** has **approved** your task:

`send_approval_notification` already looks the recipient up and already threads
`requester_name` through for the request branch; the decision branch has no
equivalent parameter at all, so fixing it means adding one — `reviewer_name` —
and passing `actor_display(user)` from the four `approvals_router` call sites that
reach the decision path. Backend change, so flag it to whoever owns
`approvals_router`; I did not take it because it is an email-content change and
you asked me not to collide.

**The finding worth your time: `send_comment_email` is dead code.**
`grep -rn send_comment_email backend/` returns exactly one hit — the definition. The
`comment` notification at `server.py:1580` writes a DB row and fires a push, and sends
no email, while `NotifyPrefs` offers the user a "Comments" delivery mode they will
reasonably read as covering email. A designed template that no path reaches.

`automation` is the other gap: `automation_engine.py:54` calls `send_email` with
`cfg.get("html", "")` — raw caller-supplied HTML, outside `_base`, so an automation
email carries none of the brand system.

`OUTBOUND_MODE` verified live: `email_service.send_email:271` calls
`outbound.suppressed("email", …)` as its first act, and `push_service.send_push` does
the same for push. **I sent nothing.** Every test in this change uses a mocked `api`
(frontend) or a fake pool object (backend); no test touches a network, a device or the
database.

---

## 7. Verification

Run from `frontend/`, **unpiped**, exit codes checked — per `_COORDINATION.md` §2, a
piped invocation reports `tail`'s status and hides a failure.

| gate | result | exit |
| --- | --- | --- |
| `node scripts/check-tokens.mjs` | 339 declared, 233 referenced, **0 missing** | `0` |
| `node scripts/check-classes.mjs` | 2120 selectors, 1443 classes, **0 missing a rule** | `0` |
| `npx vitest run` (frontend) | **272 passed**, 0 failed | — |
| `python -m pytest` (backend) | **418 passed**, 1 failed | — |

The one backend failure is `tests/test_ganit.py::test_create_invoice_success`
(`TypeError: 'MagicMock' …`). **Pre-existing and not mine** — I verified it
independently by stashing my entire working tree and re-running on clean
`origin/staging`, where it fails identically. `_COORDINATION.md` §8 records that three
other agents confirmed the same, and names the cause (`conftest.make_pool()` leaves
`conn_mock.fetchval` a bare MagicMock). Invoicing; nothing to do with notifications.

New tests:
- `backend/tests/test_quiet_hours_parity.py` — 28 cases. Deliberately **does not**
  duplicate the sibling's `test_push_prefs.py`; it adds only the exhaustive proof, the
  cross-language parity table, and the two call-site gates.
- `frontend/src/pages/inbox/__tests__/notifications.test.jsx` — 15 → **61** cases.

Base verified: `git merge-base --is-ancestor origin/main HEAD` → not main-based;
`origin/staging` is an ancestor of HEAD, and `git diff --stat origin/staging` lists only
files I own.

## 7b. Resumed run — what changed after the spend-limit stop

- Rebased onto `origin/staging` twice; the tip had moved 8 commits.
- **Took the sibling's `push_service.py` wholesale** and deleted my `delivery_allowed`
  and my `test_quiet_hours.py`. Theirs is better; two overlapping gates and two
  overlapping suites is how they drift.
- **Reverted my backend `type` normalisation** on the coordinator's ruling (§2).
- **Extended the fix to `server.py:create_notification`** — the sibling's header named
  it as the second ungated path and deferred it as out of their ownership. It is in
  mine, it is the path nearly every notification takes, and it is now gated.
- Confirmed the `normalise_prefs` / quiet-hours-reset fix on the prefs PUT **has
  landed** (`server.py:861-901`), so the write path can be trusted. I still wrote
  nothing to the database.

## 8. Not finished / handed on

- **`NotifyPrefs.jsx` needs one row** for `reminder`. The backend key is now in
  `DEFAULT_PREFS` (landed by a sibling while I was stopped) **and is now actually
  enforced** by my two call-site gates — so the switch is real, enforced, and still
  invisible in the UI. One line:
  `{ id: 'reminder', label: 'Reminders', fallback: 'always', hint: 'A task you are on is coming due.' }`.
  Customize is another agent's surface, so it is yours.
- **`created` has a preference row and no emitter.** Nothing in the backend writes
  `type='created'` — grepped every `INSERT INTO notifications`. The switch governs
  nothing. Drop it, or wire an emitter.
- **`send_comment_email` is never called** (§6). The email agent's call, not mine.
- **`"The reviewer"` hardcode** at `email_service.py:1146` (§6) — needs a
  `reviewer_name` parameter threaded from the four `approvals_router` decision call
  sites. Backend change on someone else's file; not taken.
- **Envelope width 600 vs 640** and the outer padding (§6). The email agent's call.
- **Mobile client drift**, outside my lane but worth someone's:
  `mobile/src/api/notifications.ts` calls `/notifications/mark_read` and
  `/notifications/unread_count` — **underscores**. The backend serves
  `/notifications/mark-read` (hyphen) and has no `unread_count` endpoint at all.
  Marking read from the mobile app cannot be working.
- **No browser verification.** This surface needs an authenticated session against a
  live backend, and the shared-DB rule makes exercising the write paths (mark-read,
  the reminder dispatch) the wrong thing to do from a worktree. Correctness here is
  carried by the 118 tests across the two suites, not by a screenshot.
- `shouldDeliver` special-cases `type === 'support'` to ignore quiet hours, per
  `11-platform-admin.md`. **No backend path emits a `support` notification** — the
  branch is forward-looking and currently unreachable. Left in place; recorded so it is
  not mistaken for working coverage.

