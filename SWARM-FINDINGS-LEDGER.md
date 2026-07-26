# SWARM FINDINGS LEDGER — resume point

**Written 2026-07-26.** Session ended mid-run. This file is the durable record;
the scratchpad copy is session-scoped and will be gone.

## ⚠️ STATE ON DISK RIGHT NOW — READ BEFORE DOING ANYTHING

- **206 files uncommitted · 185 tracked · +8,032 / −3,398**
- Last commit: `a7ce481 fix(security): stop serving the full API map…`
- **NOTHING from the 20-agent run is committed.** All of it is working-tree only.
- **9 of 20 agents reported. 11 were still running when the session ended.**
  Their file edits ARE on disk. Their written reports are NOT recoverable —
  they lived in session-scoped temp files.

### First three things to do on resume

1. `cd frontend && npm run check && npx vite build --logLevel error && npx vitest run`
   Last known: check exit 0 · build exit 0 · **260 tests passing / 15 files**.
   `cd mobile && npx tsc --noEmit` was **exit 0**.
   `cd backend && JWT_SECRET=dummy python -c "import server"` was clean.
2. Delete two junk artifacts before committing: `frontend/nul.css` (a Windows
   reserved-device redirect artifact, contains a stray copy of `a11y.css`) and
   `frontend/.parse-tmp.mjs` (an agent's esbuild helper).
3. Then work section A below, in order. A7 first.

### The method that produced this file, and why it worked
Collect every agent claim, act on NONE of them until cross-referenced.
Corroboration across independent agents raises confidence; contradiction means
one is wrong and I go read the file myself. This caught two claims that
"resolved themselves" mid-run (another agent had already fixed them) and five
places where MY OWN brief to an agent was wrong.

**Standing lesson: roughly half of all defect claims in this project are stale.
Never act on a quoted line number without re-reading the file.**

---

# Cross-Agent Findings Ledger

Method: collect every agent's claims, do NOT act on any of them yet. Once all 20
land, cross-run them. Corroboration across independent agents raises confidence;
contradiction means one of them is wrong and I go read the file.

Confidence legend:
- **CORROBORATED** — 2+ independent agents, or 1 agent + my own verification
- **SINGLE** — one agent, unverified
- **CONTRADICTED** — agents disagree, needs adjudication
- **SELF-RESOLVED** — was true, another agent fixed it during this run

Landed: 4 of 20 (common-components, backend-client-leaks, routing-shell, documents-esign)

---

## A. SECURITY / DATA EXPOSURE  (highest priority)

### A1. Private attachments served with live signed R2 URLs — **CORROBORATED ×4**
- client-portal agent (earlier run): `/api/client/tasks` missing `_filter_private_attachments`
- backend-leaks agent: HELD, fixed `/api/client/tasks`; filter now runs BEFORE re-signing
- documents agent: says **TWO** sites, not one — also `GET /api/tasks`
- **my own grep**: `_refresh_task_attachments` called at 1008, 2045, 2251.
  Filtered at 1007 ✓, **2045 NOT filtered**, 2276 ✓.
- VERDICT: documents agent is right. One leak site remains at ~2045, exposed to
  ANY org member (not just clients). NOT YET FIXED. Do not fix until fleet lands.

### A2. Client could reach the entire staff product — **SINGLE (routing agent), serious**
`Protected`'s client rule was a DENY-LIST of 7 paths, so `/dashboard`, `/boards`,
`/inbox`, `/graha` and every module route were open to a client inside the staff
shell. Now an allow-list (`/client/*` only). Agent says fixed.
- Cross-check needed: does the client-portal agent corroborate?

### A3. Client API served the firm's internal approvals + staff emails — **CORROBORATED ×2**
- client-portal agent: `/api/client/approvals` returns firm's queue + `requested_by_email`
- backend-leaks agent: PARTIALLY STALE — table-wide scan was already project-scoped;
  the email leak and `SELECT a.*` (reviewed_by, review_notes, request_type) held. Fixed.
- VERDICT: real, narrower than first claimed, now fixed.

### A4. Comments: API served clients every comment on any reachable task — **SINGLE, worse than reported**
backend-leaks agent. Portal didn't render them, but the API returned them.
Added `is_client_visible` (default False). Migration PROPOSED_056, not applied.

### A5. `SigningPage.jsx` — public signer view, unconverted — **SINGLE, high value**
39 hardcoded colours, `#0082c6` ×5, no dark mode at all, and spells the brand
**"Kartavya"** not **"Kartavaya"** (lines 151, 312). This is what a client's client
sees — the commercial face of the e-sign wedge.
- Owner has corrected the Kartavaya spelling repeatedly. Worth checking myself.

---

## B. CONTRADICTIONS TO ADJUDICATE

### B1. `Attachment` model missing size/uploader
- documents agent: still missing at `server.py:498-500`
- backend-leaks agent: FIXED, added size/uploaded_by/uploaded_by_name/uploaded_at
- **my check**: model now HAS all four fields.
- VERDICT: **SELF-RESOLVED**. Documents agent read it before the fix landed.

### B2. `${c}18` hex-alpha producing `"var(--st-done)18"`
- boards agent (earlier): live in MyTasksView, PriorityView, WorkloadView
- common-components agent: **STALE**, zero survivors under `components/**`;
  remaining matches are correct by spec (CustomizePanel operates on real hexes,
  00 §11 literally specifies `${acc.color}29`)
- VERDICT: both true, different directories. Boards agent fixed the views.

### B3. `--on-surface-disabled` declared nowhere
- reported by 4+ agents across both runs
- common-components agent: **STALE** — tokens agent declared it this session
  (`kartavaya-design.css:163` light, `:237` dark)
- VERDICT: **SELF-RESOLVED**. But stale workarounds remain in `drawer.css:72-75`
  and `landing.css:116-122` that should now switch to the real token.

### B4. My own brief was wrong twice
- I told common-components "02 specifies icon stroke widths" — it specifies NO icons at all
- I gave it ownership of `components/icons/**` — **does not exist**; icons live in `layout/navIcons.jsx`
- backend-leaks + documents agents: my line numbers ran ~34 low throughout
- LESSON: my briefs carried stale line numbers from earlier agent reports. Stop
  quoting line numbers I haven't re-verified.

### B5. My claim #4 to the routing agent (unguarded `Notification.permission`)
- I said `AppShell.jsx:55,57`
- routing agent: STALE as written — guard sat at :54, directly above.
  **But the real defect was at :154**, inside the poll effect.
- VERDICT: I was right that a defect existed, wrong about where.

---

## C. DEAD CODE (converging evidence)

### C1. `components/TaskEditor.jsx` — **CORROBORATED ×3**
- routing agent: migrated AppShell to NewTaskModal; **zero importers**
- documents agent: 22 hardcoded literals, duplicate drop zone + lightbox,
  `var(--k-primary, #0082c6)` retired blue in a fallback
- **my check**: 0 importers confirmed
- VERDICT: delete, don't fix. 595 lines.

### C2. `pages/BillingPage.jsx` — **CONTRADICTED**
- routing agent: dead, zero importers, folded into `org/TabBilling.jsx`
- **my check**: 6 references still present
- VERDICT: needs adjudication — my grep may be catching comments/strings.

### C3. `modern-components.css` — **SINGLE**
14 class roots, ZERO renderers, still imported at `styles/index.css:8`.
Retired `#0082c6` ×4, hardcoded radii, `rgba(255,255,255,…)` that can't flip.
Emptied to a tombstone by common-components agent.

### C4. `pages/ScrapersPage.jsx` — **SINGLE**
Zero importers, superseded by inline tab in `OrgSrijanPage.jsx:920`. Deliberately
not routed because it hardcodes the retired blue.

---

## D. REAL BUGS FOUND THAT NO HANDOVER LISTED

- **StatTile cross-file specificity**: `components.css` `.k-stat--ok .k-stat__val` (0,2,0)
  beat `editorial.css` `.k-stat__val` (0,1,0) ACROSS FILES. `ok`/`danger` painted the
  number, `info`/`blue`/`teal` didn't. (common-components)
- **DueChip painted the one case the spec suppresses** — done + no due date rendered
  a bare em-dash chip. Guard tested `danger`, but that case returns `muted`. (common-components)
- **`variant="dangerfill"` fell through to `ghost`** — delete buttons rendering grey. (common-components)
- **`Toggle` had `role="switch"` AND `aria-pressed`** — invalid pairing. (common-components)
- **`Popover` exit animation never played once** — unmounted instantly. (common-components)
- **`relTime` appended "ago" unconditionally** — a doc expiring in 12 days read
  **"Expires 12d ago"**. Live in e-sign list AND detail. (documents)
- **`ICONS.settings` never existed** — one nav row rendered an empty gap. (routing)
- **Pahchan was in NO nav list** — finished, routed, reachable only by typing the URL. (routing)
- **`canSeeNavItem` never read `item.module`** — all ten module entries declared a
  `module` key nothing filtered on. (routing)
- **`/admin` gated on org `role === 'admin'`** while AdminShell gates on platform
  roles — route resolved, then rendered nothing. (routing)
- **`ROUTE_META` last-wins** made the Organisation breadcrumb read "Billing". (routing)
- **`_refresh_task_attachments` rebuilt `Attachment` field-by-field** — would have
  silently dropped all four new fields on every read. (backend-leaks, self-caught)
- **`model_dump()` with a datetime raises TypeError in json.dumps** — 4 write paths
  would have 500'd on any task carrying an attachment. (backend-leaks, self-caught)

---

## E. BREAKING CHANGES INTRODUCED THIS RUN (must wire before commit)

Backend changed the client endpoint shapes. These call sites WILL break:
- `frontend/src/pages/TasksListPage.jsx:106`
- `frontend/src/pages/ApprovalsPage.jsx:41`
- `mobile/src/screens/ClientPortalScreen.tsx:32,39`
- `frontend/src/pages/client/__tests__/smoke.test.jsx:76-77`
- `frontend/src/pages/client/clientShape.js` — stopgaps now redundant

Still on the old shape: `POST /api/client/tasks/request` returns `TaskOut`
(shape violation, not a live leak — row is fresh and client-owned).

---

## F. SPEC PROBLEMS (design-handover is wrong, not the code)

- **`18-documents.md` is NOT about attachments.** It specifies eight print-ready
  documents on a vendored `<doc-page>` web component. What I briefed as `18`
  (file lists, drop zones, lightbox, e-sign) is actually `03 §5` and `13`.
  Source exists at `design-reference/Kartavaya Redesign/docs/` — 9 HTML files.
- **`SettingsPage.jsx` does not exist and never did.** I invented it in a brief.
- **`20-search-palette.md:170`** claims `SigningPage` is absent from every handover
  file — it is specced at `13-module-pages.md:191`.
- **Tooltip: `02 §2` says 400ms, `26 §6` says 300ms.** Build follows 26.
- **eSign Hindi: `13 §2` says हस्ताक्षर, `lib/moduleColors.js:19` says प्रमाण.** Unsettled.
- **`26 §5` specifies `aria-selected` on a segmented control** — invalid on `role="radio"`.
  Two agents independently chose the standard over the spec.

---

## G. DUPLICATION (converging)

- **Buttons exist 3×**: `.btn` (components.css), `.k-btn` (editorial.css:604),
  `.k-btn-primary` (brand.css:80)
- **EmptyState exists 2× under one name**: `ui/EmptyState.jsx` (`.empty`) and
  `components/module/Note.jsx` (`.mempty`)
- **Drop zones exist 4×**: drawer (correct), TaskEditor (broken), `org/LogoUpload.jsx`
  (correct), documents (new shared one)
- **Tables**: an earlier agent found the same table implemented 9 times
- **`.k-segctrl` hand-rolled at ~6 call sites** with no component

---
# UPDATE — 5 of 20 landed (+ bilingual-devanagari)

## A6. Login page rendered Devanagari in a font with zero coverage — **SINGLE, measured**
`styles/auth.css` `.au__sub` had NO font rule, so `आपका व्यापार…` inherited Inter and
fell to the OS face. Measured: **581px vs Tiro's 540px at 60px — 7.5% wider**, while
`.au__rot-hi` two lines below rendered in Tiro. Two faces in one panel, on the first
screen of the product. Agent fixed it.
- Corroborates the landing-page bug from the earlier run (same class, different file).
- This is now the **5th independent instance** of the Devanagari-font defect.

## B6. `--font-indic` is the WRONG token for fixed Devanagari — **SINGLE, systemic**
~25 rules follow handover `24`'s instruction to use `--font-indic`. Under an EN+GU
preference that resolves to Noto Sans Gujarati, which has **zero Devanagari coverage**
— so ~25 surfaces broke at once. Agent fixed it at ONE binding point rather than 25
collision-prone edits.
- NOTE: this means **handover 24's own instruction is wrong**, not the code. Add to §F.

## B7. `PageHeader` hardcoded `lang="sa"` across ~40 call sites — **SINGLE, verified by agent**
Agent checked all 53 values: **none is Sanskrit-only**, and several are impossible in
Sanskrit — `फ़ोल्डर`/`डेटा` (nuqta loanwords), `खाते` (Hindi oblique), `संस्थाएँ`/`परियोजनाएँ`
(Hindi `-एँ` plural; Sanskrit takes `-आः`). Changed to `hi`. Screen readers pick a voice
from this attribute, so it was also an a11y defect.
- Cross-check with the accessibility agent when it lands.

## C5. `ग्राह` typo for CRM — **STALE** (bilingual agent)
All 11 module names verified correct at every call site including `navConfig.js`.
I put this in the brief from an earlier report. My error, again from an unverified quote.

## C6. Public Sans vs Inter — **RESOLVED: keep Inter**
`00 §2` names Public Sans as the `--font-ui` default. It is **not loaded** in
`index.html`; CSS, `DEFAULTS` and `UI_FONTS[0]` all consistently say Inter.
Switching would need the font loaded first. Handover is aspirational here.

## D-extra. More real bugs no handover listed
- **Watermark `lang` was load-bearing, not polish**: `.au__wm` had
  `letter-spacing: -.03em` = **−7.68px at 256px**, crushing the `र्त`/`व्य` conjuncts
  of कर्तव्य. Adding `lang="hi"` fires the existing reset. (bilingual)
- **Tiro Devanagari is single-weight (400)** — Devanagari in bold labels renders
  **faux-bold** at 700/800. Needs the span split to resolve. (bilingual)
- **`ApprovePage:21`** SVG had `fontFamily="serif"` on Devanagari. (bilingual)

## F-extra. More spec problems
- **`24` itself is wrong** about `--font-indic` for fixed Devanagari (see B6).
- **`24` explicit "No" list is being violated in 6 places** (content, not font):
  Devanagari in table column headers (`ReportsPage:271`, `TimeReportPage:273`),
  input placeholders (`sanvaad/ChatPane.jsx:78`, `Composer.jsx:114`, `ThreadPanel.jsx:124`),
  and error text (`ErrorBoundary.jsx:19`).
- **`navConfig.js` semantic mismatches**: `:19` Tasks pairs `कर्तव्य` (duty) with
  `કાર્ય` (work) — `કર્તવ્ય` exists; `:145` Dashboard pairs `अद्य` with transliterated `ડૅશબોર્ડ`.
- **eSign Hindi still unsettled** — `13 §2` says हस्ताक्षर, `moduleColors.js:19` says प्रमाण.
  documents agent and bilingual agent BOTH flagged it independently. **CORROBORATED ×2.**

## E-extra. Cross-agent overlap risk
bilingual agent lists ~30 call sites needing a **span split** (Devanagari inside
uppercase + tracked labels — `24` forbids both). It could only fix the font, not the
structure. Overlaps files owned by: boards agent (`TaskEditor`, `BoardsPage`),
module-pages agent (`ReportsPage`, `TimeReportPage`, `AutomationsPage`, `TemplatesPage`).
DO NOT dispatch this until those land.

---
# UPDATE — 6 of 20 landed (+ today-dashboard)

## H. DATA CORRECTNESS — new category, and it is the most alarming one
The Today dashboard is the first screen after login. Nine of its numbers were wrong.
None of this is cosmetic and none was in any handover file.

- **"DUE TODAY" counted COMPLETED tasks.** `dueToday` had no `isOpen` filter while the
  lede sentence directly above it did — so the tile and the sentence disagreed on the
  same screen. "DUE TODAY 7" could mean four already ticked off.
- **"N% completion rate" was not a rate.** `completedWeek ÷ tasks.length` — this week's
  closures over EVERY task the org ever created. It **falls as the board grows**, however
  much work you close. Replaced with a like-for-like previous-7-days comparison, because
  no honest denominator exists on this page.
- **"across N projects"** — two more false statements under the `|| 1` already fixed:
  `open 9, N 0` rendered "no projects yet" with nine tasks open.
- **Week-strip dots counted done tasks** — phantom load on days whose work was finished.
- **Project status bar did not sum to its own denominator.** Drew 4 statuses; `requested`
  and `rejected` are live 5th/6th — invisible in the bar, absent from the legend, still
  in the meter's denominator.
- **"Waiting on others" swallowed your own unassigned work** — a task you created and had
  not assigned went into "waiting", naming nobody to wait on.
- **Activity feed gated on `teams.length`** — a user with project assignments but no team
  row has a real feed and was shown "No activity in the last few days".
- **Raw enum reached the reader**: "Priya **status_changed** Q3 GST filing".
- **The project chip never rendered at all** — `/api/tasks` returns `team_id` and no
  `team_name`, so every `<ProjectTag name={t.team_name}>` read `undefined`.

### H1. `list_tasks` caps at `LIMIT 500` — **SINGLE, highest-value backend item**
`server.py:1705`, `min(limit, 500)`. EVERY org-wide figure on Today — open, due today,
overdue, done this week, status bar, week-strip dots — is derived client-side from that
one page of rows, so all of them **silently understate above 500 tasks**. This is the
argument for a server-computed `GET /v1/me/stats`.
- Cross-check: does the module-pages or boards agent hit the same cap elsewhere?

## B8. `--font-indic` — POTENTIAL AGENT COLLISION, verify before commit
- bilingual agent: `--font-indic` is WRONG for fixed Devanagari (under EN+GU it resolves
  to Noto Sans Gujarati, zero Devanagari coverage). Fixed at ONE binding point by
  appending the Devanagari stack to the Gujarati binding in `CustomizePanel.jsx`.
- today agent: moved `.k-hero__greet`, `.k-card__sans` and 4 KPI labels **onto**
  `--font-indic`, per handover `24 §129`.
- These are compatible ONLY IF the bilingual agent's binding fix landed first and holds.
- **ACTION: verify the greeting renders Tiro under BOTH EN+HI and EN+GU before commit.**

## C7. `--font-ui: Inter` vs `00 §2` "Public Sans" — **CORROBORATED ×2, RESOLVED: keep Inter**
- bilingual agent: Public Sans is not loaded in `index.html`; CSS/DEFAULTS/UI_FONTS all say Inter
- today agent: same finding independently, `kartavaya-design.css:41`
- VERDICT: spec is aspirational. Keep Inter unless the font is loaded first.

## F-extra 2. `05`'s stated design source does not exist
`05` line 5 cites `ScreensCore.jsx → ScreenToday` and `app.css §Hero, §Stat tiles`.
**There is no `ScreenToday`** in `design-reference/Kartavaya Redesign/ScreensCore.jsx`,
and `app.css` has none of those blocks. Its one relevant line **contradicts** `05 §1`'s
own CSS (`minmax(180px,1fr)` vs `minmax(196px,1fr)`). So `05 §1` is the spec author's
invention, not a transcription of the approved design.
- This matters for "pixel perfect": for Today, the handover IS the source, and it does
  not match the design-reference bundle. Worth telling the owner.

## D-extra 2. Skeletons were not shaped like their content
- stat-row skeleton used `SkeletonCard` (`--r-lg`, `--sp-4/5`) where `.k-stat` is
  `--r-md` + `16px 17px` → **~23px jump** on arrival
- quick-actions had **no placeholder at all** — both columns dropped a full button row
- hero lede was `null` while loading → hero ~24px shorter, whole page stepped down

---
# UPDATE — 8 of 20 landed (+ platform-admin, animations)

## A7. THE STROBE — **highest severity in the run. Accessibility HARM, not a defect.**
An INFINITE animation written as `calc(Xs * var(--ix))` does not stop under reduced
motion — it **accelerates without end**. Measured live at Animations = None:

| Site | Result |
|---|---|
| `editorial.css:1646` `.k-skeleton::after` | `k-shimmer` at **2ms**, infinite |
| `editorial.css:2615` `.k-shimmer__tile` | `k-shimmer` at **1.5ms**, infinite |
| `settings.css:179` `.snd__c.on .snd__w i` | `sndW` at **0.8ms**, infinite alternate |

So a user who sets Animations = None — the user most likely to NEED it — gets a
**strobing skeleton at frame rate on every loading screen**. Exactly backwards, and a
photosensitivity/seizure concern.
`editorial.css:1659` has a `prefers-reduced-motion` media query that covers the OS path
but NOT the runtime preference, and there is no attribute for CSS to select on.
**`settings.css:182-184` carries a comment asserting the opposite** ("the bars hold
static without a second media query here") — measured false.
- FIX: fixed duration on infinite animations; drive amplitude/opacity from `--motion-scale`.
- Owner-facing: this is the one I would fix before any pixel work.

## A8. Aekam's raw cost basis is served to tenants — **SINGLE, commercial leak**
Three endpoints guarded only by `require_user` + `get_org_id` return `cost_usd`:
- `backend/routers/scrapers.py:322` `GET /runs/{run_id}`
- `backend/routers/scrapers.py:492` `GET /runs`
- `backend/routers/hub.py:1144` `/ai-feedback`, `:1174` `/ai-feedback/stats` (`cost_usd`/`total_cost`)
`billed_inr` is legitimate (what the tenant was charged); `cost_usd` is Aekam's cost.
`11 §1` requires serializer-level containment; `MarginCell`'s UI guard does not help.
Also `subscription.py:97` does `SELECT s.*` — a wildcard that will leak any cost column
added to `staging.subscriptions` later.

## B9. `--motion-scale` OS path had NEVER worked — **CORROBORATED ×2**
`applyPrefs` writes `--motion-scale` **inline**, and inline style outranks a media query,
so `kartavaya-design.css:115`'s `--motion-scale: 0` could never apply.
- animations agent proved the cascade in the live document
- a11y agent found it independently and contained it in `styles/a11y.css:39-47` with
  `!important` (author `!important` DOES beat inline)
- VERDICT: real. Containment holds but is now load-bearing for `animations.css`.
  Structural fix (`--motion-scale-user` twin) still outstanding.

## B10. MY OWN GATE HAS A BLIND SPOT — **SINGLE, verified by agent, affects everything**
`check-tokens.mjs:44` sets `STYLE_DIR = 'src/styles'`, so **`frontend/src/lib/tokens.css`
is invisible to the gate**. A token declared there and referenced from any stylesheet
FAILS the gate even though the browser resolves it fine.
- I wrote that gate. This is my bug, and it has been silently shaping agent decisions —
  the animations agent routed around it by declaring the z-ladder elsewhere.
- ACTION: fix `check-tokens.mjs` to scan `src/lib/*.css` too.

## D-extra 3. Duplicate keyframes, one running INVERTED
- `@keyframes fadeIn` and `pulse` declared **twice** (`index.css:7,9` and old
  `animations.css:6,52`). `animations.css` loads later and won app-wide, so `index.css`'s
  `.anim-fade` animated a 10px rise it never asked for and **`pulse` ran inverted**.
- `@keyframes k-shimmer` declared **twice inside `editorial.css`** (`1662` and `2617`)
  with **opposite directions**. The second wins, so `.k-skeleton::after` sweeps
  backwards at double range relative to its authored base position.
- The ENTIRE old `animations.css` was dead — `.animate-*`, `.skeleton`, `.stagger-item`,
  `.hover-lift`, `.ripple` had zero references app-wide.

## D-extra 4. Modal and toast have no exit animation at all
`.modal__panel` has NO entrance either — only the scrim animates. `modal.jsx` has no
`useExitAnimation`/`is-closing`. `.tst` animates in then unmounts instantly.
`16 §6`'s claims about `modal.jsx` and `toast.jsx` both **HELD**.

## A9. Four admin controls that 403/400 — **SINGLE (platform-admin)**
`components/admin/adminNav.js` offers all four entries to anyone with any platform role,
but server guards are narrower. Worst case: the Platform-roles tab gave
`platform_manager`/`platform_staff`/`account_manager` a 403 toast and an empty table
reading **"Nobody holds a platform role"** — the most misleading possible answer.
Also 4 module toggles (Sanvaad, Varta, eSign, Pahchan) returned **400 Unknown module**
because `admin_orgs.py:812` validates against its own 8-code literal.
- CORROBORATES the module-list divergence already logged (org_members had the same 8 vs 12).

## A10. PRICING FIGURES FOUND AGAIN — **standing rule violated**
`AdminOrgsPage.jsx` hardcoded `monthly_price: 10000`, `max_users: 5`,
`monthly_credits: 500`, and a per-tier credits map (0/500/1000/2000); the seats hint
illustrated "fives… a floor of five… a negotiated 12". All removed.
- This is the THIRD independent place pricing figures have surfaced this session
  (landing docblock, ledger table, now admin defaults).

### A10b. The seats field rejected the exact case its own hint promised
`step="5"` with `min="1"` on max_users makes a negotiated **12 fail HTML constraint
validation**. Same for `step="500"` on price and `step="100"` on invoice amount
(₹4,999 was invalid). Directly contradicts the owner's rule that Aekam enters seats
manually per org.

## C8. More role drift — backend
- `admin_orgs.py:775` — `platform_roles = set(ALL_PLATFORM_ROLES) | {"developer"}`.
  `POST /roles/assign` will accept and STORE a `developer` row that `modules_for()` and
  `org_resolver.py` both ignore → a dead grant. **`developer` is not a role code.**
- `subscription.py:610` — `"is_platform_admin": "platform_admin" in platform_roles`
  tests ONLY the legacy alias, so a `platform_owner` reads **False**. Use `is_god_mode()`.
- CORROBORATES the god-mode-rename lockout risk already fixed in 31 guards.

## F-extra 3. `11`'s central claim inverts on reading
`11` says every platform endpoint needs `/v1/admin/orgs/:orgId/…` or "the console cannot
do the job its navigation promises". It doesn't: `org_resolver.py:22-49` reads `X-Org-Id`
first and lets platform staff resolve to any org. And `record_payment` takes no org
because **the invoice id IS the scope** — the payment could never land on the operator's
org. What was genuinely wrong was narrower: the operator couldn't SEE whose invoice it was.

---
# UPDATE — 9 of 20 landed (+ org-settings/rbac)

## A11. THE OWNER'S "one user can have both" DECISION IS NOT REPRESENTABLE — **CONFIRMED BY ME IN THE LIVE DB**
Owner's exact words: *"one user can have both FYI but auditable."* I wrote that into
`role_tiers.py` and told the owner it was implemented. It is not, and cannot be:

```
org_member_modules_user_id_org_id_module_code_key  UNIQUE (user_id, org_id, module_code)
```

One level per (user, module). So admin **and** approver on Vetana cannot both exist.
Sending both in one save violates the unique index rather than returning a clean 400.
- MY ERROR: I documented a capability the schema forbids, in a comment that reads as
  settled fact, and reported it to the owner as done.
- FIX: `UNIQUE (user_id, org_id, module_code, role)` + `level_satisfies` becomes
  "ANY held level satisfies". Needs a migration; table is at 0 rows so it is still free.

## A12. `sanvaad` vs `samvada` — the CHECK I WROTE USES THE WRONG SPELLING — **CONFIRMED BY ME**
Live DB:
- `staging.module_subscriptions.module_code` = **`sanvaad`**
- `org_member_modules_level_is_meaningful` CHECK names **`samvada`** ← I wrote this
- `role_tiers.ALL_MODULES` holds **`samvada`**
- `components/layout/navConfig.js:60` gates on **`sanvaad`**

Consequence: a grant written as `sanvaad` does NOT match the CHECK's no-approver rule
for `samvada`, so **someone can be granted `approver` on a module that has nothing to
approve** — the exact case the constraint exists to prevent. And subscription lookups
miss across the two spellings.
- MY ERROR: I took the spelling from `role_tiers.ALL_MODULES` without checking it
  against the data. Table at 0 rows, so still free to fix.
- FIX: one spelling server-side. `sanvaad` matches the live data and the nav.

## C9. `.gc`/`.rb` duplicates — **THERE WERE NONE. My brief was wrong again.**
Agent grepped all of `frontend/src`: exactly ONE definition (`styles/org.css`), two
consumers. `styles/rbac.css` was never created. The previous agent's "delete the
duplicates when 08 lands" note pointed at a copy that does not exist, and I repeated it.
- Running count of my briefs being wrong: 5.

## C10. `levels.js` vs `role_tiers.py` — **NO DRIFT** (verified line-by-line + live DB)
LEVELS, SEPARATED_DUTY, NO_APPROVER, NO_VIEWER, DEFAULT all match, and all match the
live CHECK constraints. `levelSatisfies`/`validLevels` mirror the Python exactly.

## A13. `require_module` ignores grant rows for org_admin — **SINGLE**
`backend/middleware/subscription.py:119-126` short-circuits for BOTH org roles, so an
`org_admin` reaches every active module without a grant. The settled Tier-2 rule is
*"org_owner decides which modules an org_admin can reach"* — **nothing enforces it.**
- CORROBORATES the platform-admin agent's finding that the UI promises limits the
  server does not apply.

## B11. `PROPOSED_065` would BREAK the settled model if run after 066 — **SINGLE, high risk**
`PROPOSED_065_module_role_levels.sql:83-88` adds an `org_member_modules_not_sensitive`
CHECK that would **forbid grant rows on vetana/ganit/manav/pahchan** — contradicting
Tier 4 and breaking three rows of the grant editor. Verified NOT applied.
- ACTION: delete it or mark it superseded before anyone runs 065.

## B12. `PROPOSED_066` §1 IS APPLIED but still named `PROPOSED_`
Confirmed applied in the live DB (column + both CHECKs present). The filename says
proposed, so the next reader will think it is pending and may re-run it.

## D-extra 5. `HIERARCHICAL_MODULES` is dead and its comment does not add up
`role_tiers.py:205-210` — referenced by nothing; comment says "Eight of the eleven" but
there are 13 tier-4 codes, and varta/pahchan/manav are in neither set. Harmless by
fallthrough, misleading to read. I wrote this too.

---
# MOBILE STATUS (agent still running — verified by me, read-only)

`npx tsc --noEmit` → **exit 0**. 21 files modified, 6 new.

NEW screens closing the gap list from the pre-session context:
`ApprovalsScreen.tsx` · `ChatScreen.tsx` · `TimeScreen.tsx` · `api/approvals.ts` ·
`api/time.ts` · `lib/runningTimer.ts`
Also touched: `theme/fonts.ts`, `theme/palette.generated.ts` (regenerated), `theme/tokens.ts`,
`TaskDetailScreen.tsx` + 3 of its parts, `nav/RootStack.tsx`, `nav/BottomBar.tsx`.

## APK → STAGING: **CONFIRMED CORRECT** (the owner's explicit requirement)
- `src/config.js:14` — defaults to `https://kartavya-staging.up.railway.app`, with a
  documented fallback for when `EXPO_PUBLIC_API_URL` is unset (bare `expo start`,
  misconfigured EAS profile). Fails toward staging, not production. Good.
- `.env.example:13` — staging. Production URL present but commented as the alternative.

## A6/B6 CORROBORATED ON A THIRD PLATFORM
`theme/fonts.ts` independently reaches the SAME Devanagari conclusion the web agents did:
- "Newsreader and Space Mono have ZERO Devanagari coverage"
- Devanagari never names a family directly at a call site; it goes through `hindi()`
- **Tiro Devanagari Hindi ships ONE weight (400)** — asking for 700 does not produce
  bold Tiro. `hindi()` never emits above 400.
This is now **3 independent platforms** (marketing web, auth web, React Native) reaching
the same finding. Confidence: as high as it gets.
- OPEN: `assets/fonts/` contains only `NotoSansDevanagari-Bold.ttf`, which fonts.ts
  itself marks UNUSED. Verify Tiro is actually bundled before calling mobile fonts done.

---

# AGENT ROSTER — who landed, who did not

## Landed and reported (9)
1. common-components (`ui/**`, `components.css`)
2. backend-client-leaks (`server.py`)
3. routing-nav-shell (`App.jsx`, `layout/**`, `navConfig.js`) — **biggest unblock**
4. documents-esign (`EsignPage`, `pages/esign/**`)
5. bilingual-devanagari (fonts, `lang`, `index.html`)
6. today-dashboard (`DashboardPage`, `pages/today/**`)
7. platform-admin (`pages/admin/**`)
8. animations (`styles/animations.css`) — **found the strobe**
9. org-settings-rbac (`pages/org/**`)

## Still running when the session ended (11) — edits on disk, reports lost
boards/tasks/drawer · module-pages · dark-mode+tokens · mobile-web-responsive ·
accessibility · client-portal · inbox-notifications · sanvaad-varta ·
auth-onboarding · marketing-landing · **mobile-app**

On resume: their work is in the tree but UNREVIEWED. Re-derive their state by
reading the files and the gates, not by trusting this list.

## Never launched (4) — the concurrency cap is 20
`.claude/settings.local.json` now sets `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: 30`
(takes effect on restart). These four were rejected and still need doing:
- **org backend endpoints** — `org_profile` 4 missing fields, `PATCH /v1/org/modules`,
  `/v1/org/security`. Three settings tabs render inert without them.
- **self-scoped module access** — `SELF_SCOPED_MODULES = {vetana, manav, pahchan}`
  is declared and NOT IMPLEMENTED. Every employee should read their own payslip,
  profile and attendance with no grant. It is a query filter, not a schema change.
- **account/prefs endpoints** — `/v1/me/sessions|export|delete`.
  NOTE: `_create_token` is stateless with NO revocation, so a "signs you out
  everywhere" claim would be FALSE. Build only what is truthful.
- **backend RBAC test suite** — `backend/tests/`. Must not write to the shared DB.

---

# ⚠️ THE SHARED-DATABASE CONSTRAINT (unchanged, still true)

`staging` and `public` are two SCHEMAS IN ONE SUPABASE PROJECT
(`toacecaewujfxjfrjwco`). A write to any `public.*` table touches production.
Every agent was told: read-only inspection, migrations proposed as files only.
**Production still reads `public.team_members` and never `staging.user_roles`,
so none of today's RBAC work reaches production until that migration.** That is
insulation now and the main risk at cutover.

Verified live this session: `org_member_modules.role` exists, both CHECKs applied,
**0 grant rows**, 6 pahchan tables, `team_members` roles = client/member/owner.
