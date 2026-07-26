# Mobile app — screens, wiring, endpoints

Branch: `agent/mobile-app-screens`, cut from `origin/staging` and rebased onto it
after the spend-limit stop. Scope: `mobile/` — Expo 51 + React Native + **TypeScript**.
Spec: `design-handover/17-mobile-app.md`.

> **Worktree note.** The worktree branch `worktree-agent-afc9794a5dd0e78e0` was cut
> from `main`, not `staging` — 13 commits ahead of a merge-base 272 behind
> `origin/staging`, with no `design-handover/` in it at all. This is `_COORDINATION.md`
> §1 exactly. A fresh branch was cut from `origin/staging` instead and no spec was
> ever reported missing on that basis. `main` was not touched.

## Gate commands and results

| Gate | Command | Result |
|---|---|---|
| Mobile typecheck | `cd mobile && npx tsc --noEmit` | **exit 0** |
| Web tokens | `cd frontend && node scripts/check-tokens.mjs` | **exit 0** — 339 declared, 233 referenced, 0 missing |
| Web classes | `cd frontend && node scripts/check-classes.mjs` | **exit 0** — 2114 selectors, 1437 classes, 0 missing |

`npm run typecheck` is already declared in `mobile/package.json`. There is **no lint
config in `mobile/`** — `tsc --noEmit` is the only mobile gate. Both web gates were run
from `frontend/` with no shell pipeline, per `_COORDINATION.md` §2.

Deps installed with `npm ci --ignore-scripts`. **`mobile/package-lock.json` is unmodified** —
`git diff origin/staging..HEAD -- mobile/package-lock.json` is empty.

Baseline before any change: `npx tsc --noEmit` exited 0 on clean `origin/staging`.

---

## 1. Verification of the claims in my brief

| Claim | Verdict | Evidence |
|---|---|---|
| Palette is generated, not transcribed | **HELD** | Generator is **`mobile/scripts/gen-tokens.mjs`**; output is **`mobile/src/theme/palette.generated.ts`**. To change a colour, edit `frontend/src/styles/tokens.css` and run `npm run tokens` in `mobile/`. |
| …but `tokens.ts` is the generated file | **STALE** | 17 §"New files" says `theme/tokens.ts  rewritten`. It is not the artefact. `tokens.ts` is a hand-written **mapping layer** (`ok`→`success`, `warn`→`approval`, `danger`→`error`) over the generated palette, and is meant to be edited. `palette.generated.ts` is the one never to touch by hand. |
| Retired blue `#0082c6` removed | **WAS STALE — now fixed** | Nothing in `theme/`, `nav/`, `screens/` or `components/` held it as a value; every hit there is prose explaining the removal. But **`mobile/src/theme.js` still held it live**: `blue: '#0082c6'`, `mid: '#03a1b6'`, and both gradient arrays. Unimported, so invisible to a runtime check — and one import from putting the retired blue back on screen. **Deleted in this branch.** Re-verified: zero live occurrences remain. |
| Five-tab nav + attendance-only shell | **HELD** | `nav/RootStack.tsx` — Today · Tasks · Create · Messages · More, `CreateStub` returns null and `BottomBar` intercepts the press; `PahchanTabs` is Clock · Me; shell chosen by `isAttendanceOnly(user.role)`, from the role, not a flag. |
| `SwipeRow` + swipe-to-complete via offline queue | **HELD** | `components/SwipeRow.tsx`, one definition, 229 lines. |
| Punch queue, 72-hour retention | **HELD** | `offline/punchQueue.ts`. Pahchan-owned — not modified here. |
| EAS build config pointed at a hostname that 404s | **STALE — already correct** | `mobile/eas.json`: `development`, `preview` and `simulator` all set `EXPO_PUBLIC_API_URL=https://kartavya-staging.up.railway.app`; only `production` names production. **Both verified live this run: `curl /api/health` → 200 on each.** `src/api/client.ts` and `src/config.js` also fall back to staging, never production — correct, because the two share one Supabase project. No profile points at nothing. |

### Claims from the coordinator's backend notes

| Claim | Verdict | Evidence |
|---|---|---|
| A module gated on a code no `module_subscriptions` row can hold 403s everyone | **HELD as a mechanism, but does not affect any mobile screen** | All seven module codes I wired — `graha`, `ganit`, `manav`, `vetana`, `dristi`, `srijan`, `prachar` — are in the canonical twelve-code `ALL_MODULES` (`middleware/role_tiers.py:74`). |
| `admin_orgs.py:812-816` accepts only eight module codes | **STALE on current staging** | It now does `ALL_MODULES = frozenset(ROLE_TIER_MODULES)` — a straight import of all twelve. The retyped eight-code list and its comment describing the bug are both still there, but as history. |
| Messaging was gated on `samvada` and 403'd everyone | **STALE — fixed** | `routers/messaging.py:27` reads `require_module("sanvaad")`. Relevant to me because Messages and Chat are mobile screens; they are not blanket-403'd. |

---

## 2. Screen inventory against `17-mobile-app.md` §Screens

Every screen below is reachable and reads from a real endpoint. **There is no mock
data and no stub anywhere in `mobile/src/screens/`** — verified by grepping every
`*Api.*` call site across all 24 screens.

| Screen | File | Endpoints | Status |
|---|---|---|---|
| Today | `screens/TodayScreen.tsx` | `GET /api/tasks` | pre-existing |
| Tasks | `screens/TasksScreen.tsx` | `GET /api/tasks`, `PUT /api/tasks/{id}` | pre-existing |
| Task detail | `screens/TaskDetailScreen.tsx` | `GET/PUT /api/tasks/{id}`, `/comments`, `/subtasks`, `/attachments`, `/request-approval`, `/approvals/{id}/review`, `/client-approve`, `/client-reject`, `/projects/{id}/columns`, `/teams/{id}`, `/time/*` | pre-existing |
| Board detail | `screens/BoardScreen.tsx` | `GET /api/teams`, `/projects/{id}/columns`, `GET/POST /api/tasks` | pre-existing |
| Boards list | `screens/BoardsScreen.tsx` | `GET /api/teams` | pre-existing |
| Messages | `screens/MessagesScreen.tsx` | `GET /api/v1/messaging/channels` | pre-existing |
| Chat | `screens/ChatScreen.tsx` | `/api/v1/messaging/messages`, `/react`, `/read`, send, edit, delete | pre-existing |
| Pahchan clock | `screens/pahchan/ClockScreen.tsx` | `/api/v1/pahchan/punch`, `/me`, photo upload | Pahchan-owned |
| Pahchan enrol | `screens/pahchan/EnrollScreen.tsx` | `/api/v1/pahchan/enrollment` | Pahchan-owned |
| **Pahchan history** | — | — | **MISSING** — see §5 |
| Approvals | `screens/ApprovalsScreen.tsx` | `GET /api/approvals/pending`, `/history`, `POST /api/approvals/{id}/review` | pre-existing |
| Inbox | `screens/InboxScreen.tsx` | `GET /api/notifications`, `POST /api/notifications/mark_read` | pre-existing |
| Time | `screens/TimeScreen.tsx` | `GET /api/time/report`, `POST /api/time/stop` | pre-existing |
| **Reminders** | `screens/RemindersScreen.tsx` | `GET /api/tasks?assigned_to_me=true`, `GET /api/tasks/{id}`, `PUT /api/tasks/{id}/reminders` | **built this run** |
| Settings | `screens/SettingsScreen.tsx` | `GET/PUT /api/me/notification_prefs`, `POST /api/me/push_tokens` | pre-existing |
| More | `screens/MoreScreen.tsx` | notification count via context | **rewired this run** |
| Me | `screens/MeScreen.tsx` | `GET/PUT /api/me/notification_prefs` | pre-existing; **incomplete, see §5** |
| Login | `screens/LoginScreen.tsx` | `POST /api/auth/login` | pre-existing |
| Client portal | `screens/ClientPortalScreen.tsx` | `GET /api/client/tasks`, task comments | pre-existing |

### The seven light module surfaces — all built this run

17 §Screens calls for seven. Five existed as `note` entries in `MoreScreen` — tiles
that opened a "not built yet" toast — and **Srijan and Prachar were absent entirely**.

| Surface | File | Endpoints |
|---|---|---|
| Graha · CRM | `screens/modules/GrahaScreen.tsx` | `GET /api/v1/graha/pipeline-summary`, `GET /api/v1/graha/deals` |
| Ganit · Invoicing | `screens/modules/GanitScreen.tsx` | `GET /api/v1/ganit/stats`, `GET /api/v1/ganit/invoices?invoice_type=tax_invoice` |
| Manav · HR | `screens/modules/ManavScreen.tsx` | `GET /api/v1/manav/stats`, `/leaves?status=pending`, `/holidays`; `PATCH /api/v1/manav/leaves/{id}/action` |
| Vetana · Payslips | `screens/modules/VetanaScreen.tsx` | `GET /api/v1/vetana/payslips` |
| Dristi · Analytics | `screens/modules/DristiScreen.tsx` | `GET /api/v1/dristi/overview`, `GET /api/v1/dristi/revenue?months=6` |
| Srijan · Assistant | `screens/modules/SrijanScreen.tsx` | `GET /api/v1/hub/dashboard` |
| Prachar · Marketing | `screens/modules/PracharScreen.tsx` | `GET /api/v1/prachar/dashboard` |

All seven are registered in `RootStack`, routed from `MoreScreen`, and deep-linkable
(`crm`, `invoices`, `hr`, `payslips`, `analytics`, `assistant`, `marketing`).

---

## 3. Offline, and the other five states

`components/ScreenState.tsx` defines the six states these screens actually have, and
`hooks/useOnline.ts` is now the single definition of "online" — the expression
`isConnected && isInternetReachable !== false`, which `useOfflineMutation`,
`NewTaskSheet` and `App` had each written out separately. The `!== false` is
load-bearing: the reachability probe returns `null` while in flight, so a plain
truthiness test reports every device as offline for the first second after a cold start.

Resolution order, and why:

1. **Data beats everything.** Query results persist to MMKV, so a cached figure renders
   with a `StaleBar` rather than being blanked for an offline placeholder.
2. **`forbidden` beats `offline`.** A 403 is an answer that arrived; losing the
   connection afterwards does not make it less true.
3. **`offline` beats `error`.** TanStack retries twice before surfacing `isError`, so an
   offline screen rendering the error state makes the user sit through two doomed
   retries to be told the wrong thing.

`forbidden` exists because `require_module` raises **403** both when the org lacks a
module and when the user holds no grant. On a module surface that is the answer, not a
failure — so it renders as a boundary in plain words, with no alarm colour. Module tiles
stay visible for modules the user cannot reach, deliberately: hiding them leaves someone
told to "check Vetana on your phone" with nothing to find and no explanation.

The **global** offline banner in `App.tsx` was already correct and states queue depth
("3 changes waiting to sync", punches counted separately). Not modified.

Writes that are deliberately **not** queued offline, with the reason stated to the user
in the UI rather than only in code:

- **Leave approve/decline** — debits the balance and emails the employee. A decision
  replayed hours later mails a stale answer.
- **Reminder changes** — a reminder armed now and delivered hours later is worse than
  one never armed.

---

## 4. Findings worth acting on

**a. `useQuery(...).data` is `any` throughout the mobile app.** Under the pinned TS
5.3.3, TanStack Query v5.51 returns `UseQueryResult<NoInfer<TData>, Error>` with `TData`
unresolved. Probed directly: `const bad: number = q.data` compiles clean on a query whose
`queryFn` is typed `Promise<Deal[]>`. **Passing the type argument explicitly does not fix
it** — I tried that first and it still resolves to `any`. What works is annotating the
value read out of the hook (`const rows: Deal[] = q.data ?? []`), which every screen in
`screens/modules/` and `RemindersScreen` now does. This affects **every pre-existing
`useQuery` in the app**, not just mine — no mobile screen currently gets any type
checking on its server data. The root fix is a TypeScript bump, which rewrites
`package-lock.json`, so it is flagged rather than done.

**b. A legacy task reminder can fire exactly once, ever.** `tasks.reminder_at` is live —
`/api/notifications/poll` and `/api/notifications/process` both dispatch it — but nothing
in the backend ever resets `reminder_sent_at`, and both queries require it to be `NULL`.
So a snooze built on that field would appear to work and then silently never arrive.
`RemindersScreen` therefore writes only to `task_reminders` via
`PUT /api/tasks/{id}/reminders`, whose rows are always re-armable. Worth a backend fix
regardless: the web drawer has the same trap available to it.

**c. `GET /api/tasks` returns `reminders: []` unconditionally.** `TaskOut` defaults it and
only the detail path fills it in (`server.py:2252`), so `[]` from a list means "not
loaded", not "none set". Any UI that renders reminder state from a list response is
wrong on every row. `RemindersScreen` fetches per task in the sheet instead — one request
per interaction, not per row.

**d. `PUT /tasks/{id}/reminders` silently drops unknown offsets.**
`_replace_task_reminders` `continue`s past any offset outside
`{2880,1440,240,120,60,30,15}` and coerces an empty channel list to `["in_app"]` — both
without erroring. A caller gets 200 with fewer or different reminders than it asked for.
The client now sends only accepted values and refuses to turn the last channel off, so
the UI and the stored row cannot disagree.

**e. Ganit has no payment-reminder endpoint.** The reference design
(`MobileModules.jsx:74`) puts a "Send reminder for INV-…" button on this screen and argues
it belongs on the phone. `routers/ganit.py` exposes nothing for it, and anything actually
leaving the building is governed by OUTBOUND_MODE. The button is **not** built; the
boundary note names it as the one action still missing rather than shipping a control
wired to nothing.

**f. Srijan's chat is client-scoped, so the mobile assistant is not the reference's ask
box.** Every route in `routers/hub_chat.py` is `/clients/{client_id}/chat/sessions…`, so a
phone assistant would have to make the user pick a client before asking anything — and
every question spends model budget from the easiest place in the product to fire one by
accident. Shipped as the checking view over `GET /api/v1/hub/dashboard`, with the
assistant named as absent. **Wiring the ask box is a decision about runtime spend and
client scoping, not a missing screen** — it needs the owner.

**g. Spec/reference disagreement on the seventh surface.** 17 §Screens lists *Prachar* as
the seventh module surface; `MobileModules.jsx` implements *eSign / Hastakshar* instead
and has no Prachar. I built **Prachar**, following the spec. `routers/esign.py` exists and
is gated on `require_module("esign")`, so an eSign surface is buildable if the owner wants
the reference's set instead.

---

## 5. What I did not finish

- **Pahchan history** (month calendar, 7 states, legend). Listed in 17 §Screens; does not
  exist in any form. Left alone deliberately — attendance is a sibling's, and
  `07-pahchan.md` is where its 7 states are defined. **Unbuilt and unowned as of this
  branch.**
- **`Me` does not carry what `07 §9` says it must.** `RootStack.tsx:141-143` comments
  that `Me` holds "their own reference pair, their register, and the retention promise in
  plain words". `MeScreen.tsx` is a profile header plus notification preferences — none
  of those three. For the attendance-only shell, `Me` is one of only two destinations, so
  this is a bigger gap there than it looks. **Pahchan-owned; reported, not edited.**
- **`components/Sheet.tsx`**, listed in 17 §New files. Does not exist; `NewTaskSheet`,
  `AttachmentSourceSheet`, `ManavScreen` and `RemindersScreen` each build their own modal.
  Mine follow the same shape (grab handle, scrim, `onRequestClose` for Android back), but
  extracting the primitive means editing sibling-owned screens and was not attempted.
- **Platform differences in 17 §"not optional" are only partly done.** Android hardware
  back is handled on the sheets I wrote (`onRequestClose`); I did not audit the
  pre-existing modals. Haptics on swipe commit live in `SwipeRow`; I added none.
- **No runtime verification.** There is no simulator or device in this environment, so
  every screen here is verified by typecheck and by reading the endpoint contracts in
  `backend/routers/`, not by running the app. The response *shapes* were read from the SQL
  in each handler — including column names, e.g. `vetana_payslips` has `gross` and
  `disbursed_at`, not `gross_earnings`/`paid_on` — but no response body was observed.
- **R2 URL expiry (9 hours)** was flagged by the coordinator. No screen I wrote renders an
  attachment, so nothing here caches a signed URL. `TaskDetailScreen` does handle
  attachments and is pre-existing — **not audited by me.**
