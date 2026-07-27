# Verification — Pahchan · Sanvaad · eSign · Org settings · Client portal · Today · Customize · Inbox

Branched fresh from `origin/staging` at `0a69bef1` on `verify/pahchan-sanvaad-org`.
Verified 2026-07-27. **64 files** — every file in the assigned set has a verdict below.

---

## How the evidence was gathered

Every page in this set sits behind `<Protected>`. Staging and production share one
Supabase project and Pahchan holds real biometric data, so **no session was created and
the database was never read or written**. Instead a harness (`frontend/__verify/`, the
same pattern as the existing `frontend/__measure/`) mounts the **real shipping
components** inside the **real `AppShell`** with the **real five-stylesheet graph in
`App.jsx`'s import order**, and replaces `api.defaults.adapter` before any component
mounts, so every request resolves locally.

- Own vite server on **:5362** from this worktree. `location.href` asserted on every
  read — every measurement below was taken at
  `http://127.0.0.1:5362/__verify/index.html?...`. **:5173 was never used.**
- **No face image was ever fetched.** Pahchan photo endpoints resolve to a flat SVG
  generated in-page (`fixtures.js` · `FACE`). No biometric frame was fetched, cached,
  written to a fixture, logged or transmitted.
- Service-worker registration and `Notification` are stubbed out. **No push, email,
  WhatsApp message or any other outbound side effect occurred.**
- `?state=loading|empty|error` forces each of the three states independently, so the
  distinction between them is measured rather than assumed.

**Screenshots were not usable** — the Browser pane reported a 0×0 viewport until
`resize_window` was called, and the pane went unresponsive twice. All evidence below is
therefore `read_page` structure/copy and `javascript_tool` **computed layout**
(`getComputedStyle`, `getBoundingClientRect`, `scrollHeight` vs `clientHeight`).
Nothing is reported as verified on the strength of an image.

### Which reference applies to Pahchan

`ScreensPahchan.jsx:25` `ScreenPahchan` is **superseded**, and this matters for reading
the table. It shows a five-pose face registration (Front/Left/Right/Up/Down), on-device
face matching ("Only a match result is sent — never the image") and the tab set
`clock · my attendance · regularization · anomalies · geo-fence · reports`.
`design-handover/07-pahchan.md` — and `PahchanReview.jsx`, `PahchanClock.jsx`,
`PahchanAdmin.jsx`, `PahchanData.jsx`, the v1 references — replace all of it with
**human comparison against two enrollment reference photos**, face matching parked to
v2, device enrollment dropped. `MODULE_TABS` in `Data.jsx:120` has **no `pahchan` key at
all**, so the tab structure is genuinely new. Pahchan is therefore verified against
`07-pahchan.md` + the `Pahchan*.jsx` v1 set; divergence from `ScreensPahchan.jsx` is
intentional supersession, not drift.

---

## Settled behaviour — re-confirmed, not relitigated

| Behaviour | Holds? | Evidence |
|---|---|---|
| Pahchan retakes: 3, then flagged for a manager | **Yes** | `backend/routers/pahchan.py:93` `RETRY_FLAG_THRESHOLD = 3`; `:276` `if body.retry_count >= RETRY_FLAG_THRESHOLD`. Line 86 comment: "retake limit 3. Enforced on the client". |
| The shutter is NEVER hidden | **Not in these files** | There is no web clock-in surface. `grep` for `getUserMedia`/shutter across `frontend/src` returns only `EnrollQueue.jsx`/`History.jsx` (unrelated). The camera lives in the mobile app (`17-mobile-app.md`) — another agent's area. Server-side, the punch is *flagged*, never rejected. |
| `Register.jsx` per-row Confirm/Flag reusing the same gate | **Yes** | Rendered at 1440px: `btns: ["Needs a look 3","All 4","Confirm","Flag","Send enrollment request","Confirm","Flag"]`. Both buttons call `seek(i)` then the same `record()` the keyboard calls (`Register.jsx:876,884`). |
| Confirm disabled until the comparison is ready; Flag never | **Yes** | `Register.jsx:870` `disabled={compare[p.id] !== COMPARE.READY}`; the Flag button (`:880`) has no `disabled`. The `noref` row renders "Send enrollment request" instead of Confirm. |
| **Sanvaad viewer gets a LOCKED COMPOSER** | **Yes — now confirmed in the UI** | At `?access=viewer`, `.cmp--locked` present, `textareas: 0` (the composer is gone, not disabled), text = *"Your Sanvaad access is **Viewer**: you can read every channel you are a member of, but not send…"* — `ScreensSanvaad.jsx:291` verbatim. Archived renders its own distinct copy plus a banner. Backend: `_require_editor` appears 9× in `messaging.py` (1 def + 8 guarded write paths); `/messaging/me:152-154` returns `{level, can_post, can_manage}`, which is exactly what `useSanvaadAccess.js` reads. |
| Publish refuses to overwrite `marked_by='manual'` | **Yes** | `PublishPayroll.jsx` renders a "Left alone — entered by hand" figure and a "Left as HR entered them" table from `skipped_manual`, with the hint "A day HR typed is never overwritten by a re-run." |

---

## Defects fixed (5 files)

All five are the same class or adjacent to it, all inside the assigned file set.

1. **`sanvaad/ChannelsTab.jsx` + `sanvaad/ChannelList.jsx` — a failed channel list was
   rendered as an empty one.** `catch { setChannels([]) }` put *"No channels yet. Create
   one to start messaging."* in front of a member of nine channels whose request 500'd,
   and offered the one action that is wrong in every failure case. Now three states, with
   `ErrorState` + retry replacing both section empties.
2. **`sanvaad/varta/WhatsAppTab.jsx` — same, on the shared customer inbox.**
   `.catch(() => setRows([]))` reported a 500 as *"No open conversations. They appear
   here when a customer messages your WhatsApp number."*
3. **`sanvaad/varta/WhatsAppTab.jsx:176` — a raw database identifier in the UI.**
   `Assigned · ${c.assigned_to}` printed a bare user id beside a customer's name.
   `varta_conversations.assigned_to` is `TEXT` (`058_sanvaad_messaging.sql:120`) and
   `list_conversations` is `SELECT c.*` with no name join (`whatsapp.py:121-131`), so no
   name is available. Now "Assigned to you" / "Assigned to a teammate" / "Unassigned" —
   the distinction that decides whether you open the row. *A real name needs a backend
   join; noted, not smuggled in.*
4. **`sanvaad/varta/TemplatePicker.jsx` — same, on the one path that can still reach a
   customer.** Once the 24-hour window closes an approved template is the only way to
   reply. A failed fetch said *"No approved templates yet… add one under Templates"* —
   sending the operator to author a template they already have.
5. **`sanvaad/LockedComposer.jsx` — the viewer branch dead-ended.** Its own header
   promised the bar "offers a way out", `useSanvaadAccess.js` said it had a
   `Request Editor` button, and `ScreensSanvaad.jsx:293` has one — the UI had nothing.
   A button is the wrong shape: there is **no request-approval flow for grants anywhere
   in Kartavaya** (`RestrictedNote.jsx:26`: *"Access is granted by role, not by request
   approval"*). The bar now names who can grant it, in the product's existing words, and
   both stale docstrings are corrected.

## Defects found and NOT fixed

- **Tab strips are horizontally clipped at 393px with no visible scrollbar.**
  Measured at 393px: `.mt` (Pahchan) is `clientW 351` / `scrollW 624`, with
  `overflow-x: auto; scrollbar-width: none` (`module.css:103`); the last tab (Policy)
  ends at **x = 640 in a 394px viewport** and there is no "More" menu because Pahchan has
  exactly `max = 6` tabs. The same shape appears on Org settings (`.tabs__b` to x=624),
  Customize (x=646) and Inbox (x=579) via `.tabs__list`
  (`components.css:196`, also `scrollbar-width: none` and *without* `.mt`'s edge-fade
  gradients). This is the exact failure `ModuleTabs.jsx`'s own header says it was written
  to fix — the More popover solves >6 tabs, not a narrow viewport. Tabs stay reachable by
  touch swipe, so this is discoverability, not unreachability.
  **Not fixed: the change is in `ModuleTabs.jsx` / `components.css`, shared by nine module
  pages and outside this agent's file set, with other agents in flight.**
- **`SanvaadPage.jsx` is on the old page chrome.** It renders `PageHeader` + `Tabs`;
  `PahchanPage.jsx`'s header documents three measured ways that chrome differs from
  `13-module-pages.md` §1 and moved to `ModuleHeader` + `ModuleTabs`. `EsignPage.jsx`
  already uses the module chrome. Sanvaad is the odd one out. Also a copy divergence:
  reference `ScreensSanvaad.jsx:219` is `kick="People · जन"` / `en="Messaging"` / lede
  *"Unread and starred only. Threads open beside the log…"*; the build has no kicker,
  title "Messages", lede "Internal channels and WhatsApp, in one place".
- **Four remaining swallowed errors, lower stakes than the five fixed:**
  `ChannelDetails.jsx:57` (members → `[]`), `ChannelDetails.jsx:74` /
  `ChannelList.jsx:60` (directory search → `[]`), `ChannelsTab.jsx:137` (archived →
  `[]`), `TabMembers.jsx:193` (invites → `[]`).
- **`Register.jsx` bilingual pairing is uneven.** `TAB_HI` has entries only for `payroll`
  (वेतन) and `history` (इतिहास); `register`, `corrections`, `enrollment` and `policy`
  render English-only, so two of six Pahchan tabs are bilingual and four are not. Every
  *section* heading inside them is correctly bilingual. Fix is one data edit in
  `components/module/tabLabels.js` — outside this file set.
- **`esign/*` uses `lucide-react`** where `01-navigation.md` §3 standardises on
  `navIcons.jsx`. Not isolated (13 files repo-wide), so recorded as a systemic note.

---

## Cross-cutting measurements

| Check | Result | Evidence |
|---|---|---|
| **`.kv` independent scroll** | **Holds** | At 1440×900: `grid-template-rows: "900px 0px"` — the row is bounded by the 100vh box, not by its tallest item. `.kv__content` `overflow-y: auto` and scrollable on every tall page (Pahchan Policy at 393px: `clientH 726` / `scrollH 3385`). Measured with the faithful five-stylesheet probe the CSS comment demands. |
| **Desktop layout, Pahchan** — *explicitly not done before* | **Done, all 6 tabs** | 1440×900, every tab clicked and probed: no crash, no JS error, `overflows: false` on all six. Panel heights 374 / 260 / 220 / 751 / 474 / 2188 px. |
| **393px, Pahchan** — *all screens, not just register+policy* | **Done, all 6 tabs** | `docScrollW 394 = docClientW 394` on every tab. `.kv__side` `display:none`, `.kv__mobbar` and `.mnav` `flex`. `.kv__content` scrollable on all six. Tables scroll inside their own `overflow-x: auto` wrapper (`clientW 351` / `scrollW 424`). |
| **393px, other pages** | **Clean** | eSign, Org, Customize, Today, Inbox each measured in an isolated iframe at 393×852: `docScrollW 393 = docClientW 393`, no crash, no JS error, correct mobile chrome swap. Sanvaad at 393px collapses to one column (`grid-template-columns: 349.6px`), `data-pane` switches `list`→`chat`, and a "Back to channels" button appears. |
| **Dark mode** | **Clean** | 22 tokens probed on `<html data-theme="dark">`: **0 unresolved, 0 fallbacks**. `--bg #0C0E11`, `--surface #12151A`, `--on-surface #E9E7E1`, `--primary`/`--primary-text`/`--primary-vivid` all `#05b7aa`, `--danger #F2867A`, `--ok #5BD98A`, `--warn #E8B45C`, `--tertiary #F0BB90`, `--warn-container #4A3312`, `--ok-container #14432A`, `--r-md 12px`, `--pad-page 28px`. |
| **Three states are three states** | **Now true across the set** | Forced independently. Five of six Pahchan tabs give distinct error copy + retry; five give labelled `role="status"` skeleton regions. Four Sanvaad/Varta false-empties fixed. Client portal correct on all three views before any change. |
| **No pricing figures** | **Confirmed** | Billing tab reads "pricing is agreed per organisation"; no figure rendered, none added. |
| **Brand** | **Confirmed** | "Kartavaya" / kartavaya.com throughout; no new occurrences introduced. |

---

## Per-file verdicts

Verdicts: **matches** = agrees with its reference/spec; **differs** = a named deviation;
**broken** = crashes or renders wrong data. **NOT VERIFIED** marks anything not
established by evidence I actually gathered.

### Pahchan — `PahchanPage.jsx` + `pages/pahchan/` (8)

| File | Verdict | What differs | Evidence |
|---|---|---|---|
| `PahchanPage.jsx` | **matches** | — | `ModuleHeader` + `ModuleTabs` per 13 §1. Renders "Pahchan / पहचान"; 6 tabs in the documented order (register first per §3). No crash at 1440 or 393. |
| `pahchan/Register.jsx` | **matches** | Tab label English-only (`TAB_HI` gap, see above) | Full three-state sweep. Loading: 85 skeleton nodes, `role=status`, "Loading the register…". Error: *"Punches are safe — this is a read failure, not data loss."* + Try again. Ready: 3 flagged rows of 4, `th` = Person/Compare/Time/Where/Verdict (col 1 blank by design). Confirm gated on `COMPARE.READY`, Flag ungated, `noref` row swaps to "Send enrollment request". |
| `pahchan/Corrections.jsx` | **matches** | — | Filters Pending 2 / Approved / Declined / All; `th` = Employee/Day/Asking for/Reason/Decision; Approve + Decline per row. Error copy: *"The corrections did not load. Requests are safe…"*. Decline gated on a reason (`064` CHECK mirrored client-side). |
| `pahchan/PublishPayroll.jsx` | **matches** | No `ErrorState` — correct here | It is a form, not a list: nothing to load but the policy read, which fails soft by design so "overtime is off" is never claimed on a failed read. Failures arrive as toasts on the action ("Could not build the preview" / "Nothing was published"). Dry run is the default; Publish is disabled until a preview **of the current range** exists (`stale` guard verified in source). |
| `pahchan/History.jsx` | **matches** | — | Month calendar + 6-state legend (Clocked in and out / Still clocked in / Flagged awaiting review / Reviewed and cleared / Flagged by a reviewer / Nothing recorded), "What is held about you / आपका विवरण". Groups by `captured_at` not `received_at` (07 §4). Distinct "No employee record / कोई रिकॉर्ड नहीं" state verified. |
| `pahchan/EnrollQueue.jsx` | **matches** | — | Both halves render: "Awaiting approval / स्वीकृति हेतु" (`th` Photo/Employee/Slot/Taken/Action, 2 photos, Approve) and "Not yet verifiable / अपूर्ण" (Employee/On file/Status → "1 of 2", "One reference only"). Both empties distinct: "Nothing waiting / कुछ शेष नहीं", "Everyone is enrolled / सभी पंजीकृत". |
| `pahchan/PahchanPolicy.jsx` | **matches** | — | 5 sections: Shift and overtime / Geofence and flags / Sites / Retention / Reports, all bilingual. Every field carries its statutory reason (Factories Act §51/§54/§59) and the retention fields state their consequence per 07 §5. "Count punches made outside a site" copy explicitly says turning it off does **not** reject the punch (07 §2). 2188px at 1440, scrolls cleanly. |
| `pahchan/Sites.jsx` | **matches** | — | Renders inside Policy. `th` = Site/Coordinates/Radius/Status, 2 rows, "Add a site". List-and-add only, with the documented reason (no backend update/delete; moving a site would retroactively change past punches). |
| `pahchan/__tests__/register-comparison.test.jsx` | **matches** | — | Passes in the 41-file / 665-test run. |

### Sanvaad — `SanvaadPage.jsx` + `pages/sanvaad/` (15)

| File | Verdict | What differs | Evidence |
|---|---|---|---|
| `SanvaadPage.jsx` | **differs** | Old chrome (`PageHeader` + `Tabs`) where every other module page uses `ModuleHeader` + `ModuleTabs`; no kicker; title "Messages" vs reference "Messaging"; different lede | Rendered header: `["Messages संवाद", "संवाद", "Internal channels and WhatsApp, in one place"]`. Tabs "Channels चैनल" / "WhatsApp वार्ता" — the 06 §opening weighting (WhatsApp above वार्ता) is correct. |
| `sanvaad/ChannelsTab.jsx` | **fixed** | Was: failed list rendered as empty | Now `listError` → `ErrorState` + retry. Verified: error path shows *"Your channel list did not load…"*; happy path unregressed (4 channels + DM rail). |
| `sanvaad/ChannelList.jsx` | **fixed** | Was: two section empties claimed non-membership on a failed load | Now takes `error`/`onRetry`; both section empties and the archived section suppressed while `error`. |
| `sanvaad/ChatPane.jsx` | **matches** | — | `canPost = access.canPost && !archived` mirrors `ScreensSanvaad.jsx:195`. Archived banner + locked composer both render. Viewer loses the reaction tray and reply/edit/delete, not just the composer (`ScreensSanvaad.jsx:153`) — verified: `textareas: 0` for a viewer. |
| `sanvaad/LockedComposer.jsx` | **fixed** | Was: viewer branch offered no way out despite three sources promising one | Now names who can grant Editor, matching `RestrictedNote.jsx:26`. Rendered text verified end-to-end; archived branch unchanged and still distinct. |
| `sanvaad/Composer.jsx` | **matches** | — | `<textarea>` (06 §8 satisfied), placeholder "Write a message…", present only for an editor. |
| `sanvaad/Message.jsx` | **matches** | — | 3 message blocks with author, `formatTime` stamps, `(edited)`, system-message variant, reaction chips (👍1) and the 5-emoji quick tray (👍 ✅ 👀 ❤️ 😂 — content, kept per 06 §Plus), "2 replies · Last reply 3h ago". |
| `sanvaad/MessageLog.jsx` | **matches** | — | Date separator "Today आज" and unread divider "New messages नए संदेश" both render; divider captured once per channel (`ChatPane.jsx:32`) so it does not follow the reader down the log. |
| `sanvaad/ThreadPanel.jsx` | **matches** | — | Present and wired; renders `LockedComposer` for a viewer (`:228`). Exit animation is `animationend`-driven with a ceiling timeout. **Thread panel open/close not exercised in the browser — NOT VERIFIED beyond source.** |
| `sanvaad/ChannelDetails.jsx` | **differs** | `catch { setMembers([]) }` (`:57`) — a failed member fetch reads as a channel with no members | Source. Dialog itself not opened in the browser — **rendering NOT VERIFIED**. |
| `sanvaad/icons.jsx` | **matches** | — | Lock, hash, users, back, dots, clock, send all render as inline 16px stroke SVG; verified in the locked-composer `innerHTML`. Quick-reaction emoji correctly retained as content. |
| `sanvaad/varta/WhatsAppTab.jsx` | **fixed** | Was: (a) failed fetch → empty state, (b) raw `assigned_to` id | Both fixed and verified. Sub-tabs Conversations/Templates/Auto-replies/Accounts; filters Open/Pending/Done; status chips from a Varta-specific map (not the task map — `pending` would otherwise render "Awaiting Approval"). Residual nit: the "Done" chip filters `resolved` and the row chip says "Resolved"; the empty-state now echoes the chip's own label. |
| `sanvaad/varta/WAChat.jsx` | **matches** | — | Already imports `ErrorState`/`errorKind`. Renders the thread with `formatTime`, delivery ticks, and the window banner above the composer. |
| `sanvaad/varta/WindowBanner.jsx` | **matches** | — | Three distinct states verified in source and one ("has not messaged you yet") on screen. Derivation is `windowState()` on `direction === 'inbound'` + 24h, and the file documents that a >50-outbound conversation reads as never-opened — *the safe direction to be wrong in*. |
| `sanvaad/varta/TemplatePicker.jsx` | **fixed** | Was: failed template fetch → "No approved templates yet" | Now `ErrorState` + retry, with copy that distinguishes offline from a server failure. Only `status === 'approved'` offered, unchanged. |

### eSign — `EsignPage.jsx` + `pages/esign/` (4)

| File | Verdict | What differs | Evidence |
|---|---|---|---|
| `EsignPage.jsx` | **matches** | — | `ModuleHeader` + `ModuleTabs` (correct chrome). "E-Sign / प्रमाण", tabs "Documents दस्तावेज़" / "New document नया" — matches `MODULE_TABS.esign = ['documents','create']` and `TAB_HI`. Carries the s.10A IT Act 2000 notice and the "not a DSC" caveat. |
| `esign/DocumentsTab.jsx` | **matches** | — | Three states already correct and documented. Rows: "Engagement letter — Tata Steel / Sent / Signed 1/2 / Created 27 Jul 2026 / **Expires 20 Aug 2026 (in 23d)**" — the absolute-plus-signed-relative fix its header describes, verified rendering. Filter chips All/draft/sent/partially signed/completed/cancelled with a distinct per-filter empty. |
| `esign/DetailTab.jsx` | **matches** | — | Signer list with per-signer status and signed date, Cancel document, audit trail section, `kind="missing"` state for a deleted document (observed). Uses `lucide-react` — see systemic note. |
| `esign/CreateTab.jsx` | **matches** | — | Fields Title* / Description / Document* / Expires in / Signers*, PDF-only drop zone with "up to 20 MB", and per-field help ("Shown to signers above the document", "Signers cannot open it after that"). Uses `lucide-react`. |

### Org settings — `pages/org/` (12)

All 12 render; all six tabs bilingual and matching `Data.jsx` `TAB_HI`; no crash, no
overflow at 1440 or 393. The denied branch was also exercised: a member without an org
grant gets `ErrorState kind="denied"` — *"You need org admin or org owner on this
organisation."*

| File | Verdict | What differs | Evidence |
|---|---|---|---|
| `org/TabProfile.jsx` | **matches** | — | Logo drop zone with the "where it appears" destinations (Invoice PDF header (Ganit), Payslip PDF header (Vetana), Client portal), and unwired destinations labelled as such. |
| `org/TabMembers.jsx` | **differs** | `catch(() => setInvites([]))` (`:193`) — a failed invite fetch reads as no pending invites | Renders "Members · 3", a List / Access matrix toggle, `th` = Member/Role/Module grants/Actions, 3 rows with the "· you" self-marker, and an add-or-invite affordance. |
| `org/MemberTable.jsx` | **matches** | — | One row per member with grants visible without expanding; `Menu` for row actions; deterministic `avatarBg`. |
| `org/GrantChips.jsx` | **matches** | — | "three then +n", level-coloured not module-coloured — the scanning question is who can approve. |
| `org/AccessMatrix.jsx` | **matches** | — | Present and reachable from the Members tab toggle; the transpose view (08 §1) an auditor needs. **Grid not measured cell-by-cell — NOT VERIFIED at that depth.** |
| `org/TabBilling.jsx` | **matches** | — | Plan/Seats/Status/Modules, credits block (Plan credits / Used / Balance, AI · Scrapers), and *"Changing plan is handled by your account manager at Aekam — there is no self-serve upgrade, and pricing is agreed per organisation."* **No pricing figure rendered.** |
| `org/PlanComparison.jsx` | **matches** | — | The previously-dead `plans` state now rendered. **Populated comparison not measured (endpoint shape) — NOT VERIFIED beyond mounting without error.** |
| `org/TabModules.jsx` | **matches** | — | Honest about the gap: switches are read-only "until `PATCH /v1/org/modules` exists", and modules are stated to be part of the subscription. |
| `org/ModuleCard.jsx` | **matches** | — | Inactive at `opacity: .68` keeping the module's identity colour, so the grid stays scannable. |
| `org/TabSecurity.jsx` | **matches** | — | Every control disabled with the reason on screen: *"None of this is stored yet. /v1/org/security and the org_security table are unbuilt, and the product has no two-factor flow to enforce."* Correct — a control that silently drops a setting is worse than a disabled one. |
| `org/TabDanger.jsx` | **matches** | — | Reflects the **2026-07-26 role model**, superseding `10-org-settings.md` §2/§4: neither org_owner nor org_admin can delete or transfer; both are done by Aekam with both parties contacted and an audit entry. |
| `org/LogoUpload.jsx` | **matches** | — | Drop zone + preview + destinations, with the 512px guidance and the reason (print scaling). |

### Client portal — `pages/client/` (7)

Mounted outside `AppShell` with its own chrome, as 19 requires.

| File | Verdict | What differs | Evidence |
|---|---|---|---|
| `client/ClientShell.jsx` | **matches** | — | Header shows **"Aekam & Associates"** — the firm, never a Kartavaya mark. Nav is exactly Overview / Approvals / Files. `aria-current="page"` correct on each of the three views (`["-","page","-"]` on Approvals, `["-","-","page"]` on Files). **`.kv__side` / `.side` absent — no module rail.** |
| `client/ClientHome.jsx` | **matches** | — | "In progress / प्रगति में · 2" + Request work, then the work list. Three states all distinct (error verified). |
| `client/WorkList.jsx` | **matches** | — | No kanban, no assignees, no internal status vocabulary: rows read "Vendor agreement template — clause update · #000411 · Expected 27 Jul · **With us**". |
| `client/ClientApprovals.jsx` | **matches** | — | "Needs your approval / आपकी स्वीकृति"; empty *"Nothing needs your approval / कुछ भी लंबित नहीं"*; error distinct. One-click approve with no confirm, and Request changes gated on a note (source). |
| `client/ClientFiles.jsx` | **matches** | — | "Files / संचिका"; empty *"No files shared yet / अभी कोई संचिका नहीं"*; error distinct. Download only, no delete. |
| `client/ClientProject.jsx` | **matches** | — | Replaces the old kanban that leaked the firm's staff list, every task's assignees and the firm's internal column names. **Not rendered in the browser (needs a project id) — NOT VERIFIED beyond source.** |
| `client/RequestWork.jsx` | **matches** | — | Posts to `POST /client/tasks/request`; no assignee picker (the reason it is not `NewTaskModal`). **Form not submitted — deliberately, it is a write path.** |
| `client/__tests__/smoke.test.jsx` | **matches** | — | Passes in the 41-file run. |

### Today / dashboard — `pages/today/` (10)

Whole page rendered at 1440 and 393; no crash, no JS error, no overflow.

| File | Verdict | What differs | Evidence |
|---|---|---|---|
| `today/StatRow.jsx` | **matches** | — | Four tiles with the semantic variants 05 §1 specifies: "OPEN TASKS खुला 2 / across 1 project", "DUE TODAY आज 2 / 1 high priority", "OVERDUE विलंबित 0 / all on track", "DONE THIS WEEK इस सप्ताह 0 / keep going". Real `StatTile`s, not hand-rolled `.k-stat`. |
| `today/QuickActions.jsx` | **matches** | — | "New task नया कार्य / Create invoice चालान / Add contact संपर्क / Log time समय" — `navIcons` strokes, no emoji. |
| `today/ReceivablesKPI.jsx` | **matches** | — | "RECEIVABLES प्राप्य", Collected वसूला / Overdue विलंबित / Invoices कुल चालान. Server-gated on `/v1/ganit/stats` per 05 §4. |
| `today/TaskListCard.jsx` | **matches** | — | "On your plate / आपके हाथ में" with "View all →", ids `#000411`/`#000090`, due chips, avatar stack. |
| `today/CashPosition.jsx` | **matches** | — | Card renders. **12-bar chart and the 30d/Quarter toggle not exercised — NOT VERIFIED beyond mounting.** |
| `today/ProjectStatus.jsx` | **matches** | — | Card renders; colours from the shared `lib/statusColors.js`, not the drawer's private copy. |
| `today/ApprovalsCard.jsx` | **matches** | — | Card renders; imports `errorKind`, so failure is distinguishable. |
| `today/UpcomingWeek.jsx` | **matches** | — | "Upcoming this week / आगामी सप्ताह" with the distinct quiet empty *"Nothing due in the next seven days."* |
| `today/TeamPulse.jsx` | **matches** | — | Card renders; avatar colour hashes the name, so a colleague keeps their colour as the feed reorders. |
| `today/TodaySkeleton.jsx` | **matches** | — | One region for the whole body, so a screen reader gets one `aria-busy` announcement rather than two. |

### Customize — `pages/customize/` (6)

All 6 tabs rendered and read; labels match `Data.jsx` `TAB_HI` exactly.

| File | Verdict | What differs | Evidence |
|---|---|---|---|
| `customize/TabAppearance.jsx` | **matches** | — | "Appearance रूप". Mode Light/Dark/System with *"System follows your device, including when it switches at sunset."*; 12 named accents + Custom. |
| `customize/TabTypography.jsx` | **matches** | — | "Typography अक्षर". Nine display faces each with a one-word character label (Newsreader *editorial*, Spectral *literary*, Instrument Serif *modern*, Playfair *elegant*, Lora *readable*, Inter *clean*, DM Sans *geometric*, Poppins *friendly*, Source Sans 3 *technical*), plus a separate interface face. |
| `customize/TabLayout.jsx` | **matches** | — | "Layout ढाँचा". Sidebar Wide/Rail, Density Compact/Cozy/Comfy ("Cozy is the default"), Corner radius driving every `--r-*` step. |
| `customize/TabLanguage.jsx` | **matches** | — | "Language भाषा". EN / EN+सं / EN+हि / EN+ગુ, with the rule stated: *"The second script appears alongside English labels, not instead of them."* |
| `customize/TabNotifications.jsx` | **matches** | — | "Notifications सूचना". Reports capability and permission honestly — with the harness denying permission it read *"Supported: Yes · Permission: denied — Blocked in your browser settings"* and disabled Enable. Quiet hours documented as wrapping midnight. |
| `customize/TabData.jsx` | **matches** | — | "Data & privacy गोपनीयता". Export as JSON; storage explained (device-local, applied before first paint, *"They don't sync between devices yet."*). |

### Inbox — `pages/inbox/` (3)

| File | Verdict | What differs | Evidence |
|---|---|---|---|
| `inbox/NotifRow.jsx` | **matches** | — | Real `<button>`; unread as an inset left bar with `data-unread`, not a background tint (avoiding the four-states-for-two-booleans problem); the kind colour rides `--k` and is never the only carrier — the kind label sits beside it in English and Hindi; "Unread" reaches a screen reader as `k-sr-only` text. |
| `inbox/InboxSkeleton.jsx` | **matches** | — | Rendered in the loading state; shaped like the row it replaces (dot + kind label + timestamp + one or two lines at `--r-md`) rather than the generic two-column `SkeletonList`. |
| `inbox/__tests__/notifications.test.jsx` | **matches** | — | Passes in the 41-file run. |

*Inbox page context, measured:* filter chips with counts — All सब 3 / Unread अपठित 2 /
Approvals स्वीकृति 0 / Mentions उल्लेख 0 / Assigned सौंपा 0 — date grouping "Today आज 3",
"Mark all read", and a push-blocked banner (*"a page can't ask again once that's set"*).
`notifKinds.js` maps eight kinds enumerated from the backend writers, not invented.

---

## Gates

Run from `frontend/`, after every change:

```
node scripts/check-tokens.mjs   → 356 declared, 244 referenced, 0 missing
node scripts/check-classes.mjs  → 3499 selectors defined, 2690 classes used, 0 missing a rule
npx vite build                  → ✓ built in 21.53s
npx vitest run                  → EXIT: 0 · 41 files / 665 tests passed · 0 "unhandled"
```

Baseline (41 files / 665 tests, exit 0) held exactly.

## Notes for whoever picks this up

- `frontend/__verify/` is committed as evidence infrastructure, alongside the existing
  `frontend/__measure/`. Nothing in the app imports it. `frontend/.env.local` points
  `VITE_BACKEND_URL` at `127.0.0.1:9` (the discard port) and is gitignored — it exists
  only to satisfy `api.js`'s hard guard, and every request is answered by the local
  adapter regardless.
- The tab-strip clipping at 393px is the largest unfixed item and touches nine module
  pages. It wants one owner for `ModuleTabs.jsx` + `components.css`, not five agents.
