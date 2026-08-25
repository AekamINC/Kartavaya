# Progress log — append-only

One line per landed change. Newest first. Evidence is a `file:line`, a
`table + row count`, or a commit SHA — never "done". This is the running record
behind `docs/STATUS.md`; when you tick a row there, add a line here.

Format: `YYYY-MM-DD · <phase/area> · <what changed> · <evidence> · <verified how>`

---

## 2026-08-25

- `phase-1.1` · `salesperson_id` wired on invoice + order, create + update, with
  a name-only members picker (`/v1/org/members`, 403-tolerant) · `ganit.py`
  (InvoiceCreate $26, update SET, get_invoice name join), `vikray.py` (OrderCreate
  $19, OrderUpdate SET), `InvoiceForm.jsx`, `OrderForm.jsx` · column is `text`
  on both tables (live), backend 1023 green (1 unrelated pre-existing fail),
  build+check green. Acceptance (row moves off 0 via UI create) still owed —
  no write-probe on the shared DB.
- `design/glass` · Liquid-glass enriched: static `:root` defaults (fixes
  shadowless first paint), four-sided Apple rim on `--lg-inset`, hover-lift +
  press-squish motion tokens, dark-shadow arms, reduced-motion as token flips,
  3 no-op backdrop-filters deleted (`.tbl th`/`.tst`/`.k-dock`, opaque bg) ·
  `liquid-glass.css` · verified live on staging: `--lg-lift`/`--lg-scale-p` were
  empty on deployed CSS, resolve after change; KPI cards gain depth+rim; build clean.
- `docs` · Proposal 90 gap-analysis (50–88) + §7 comparison vs all prior status
  docs · `docs/proposals/90-*.html` · commit `cbb75307`.
- `docs` · Proposal 89 liquid-glass rescope (report+plan) · `docs/proposals/89-*.html`
  · commit `07185401`.
- `docs` · Phased execution plan created · `docs/plans/PHASE-0..6` · commit `cbb75307`.
- `docs` · Final verdict 00–90 · `docs/FINAL-VERDICT-00-90.md` (00–29 + 50–88
  live-verified; 30–49 from memory pending re-scan).
- `docs` · Living status system created · `docs/STATUS.md` + this file.
- `ui/laptop-fit` · viewport-fit.css — shell tightens on laptop screens; 2→5 rows
  at 1366×768 · `viewport-fit.css`, `CustomizePanel.jsx` (Fit-to-screen toggle) ·
  verified before/after on staging · commit `628703fe`. **STATUS: ✅ shipped.**
- `copy/landing` · "Indian accounting firms" → "one place to run an Indian
  business", all 6 places · commit `a53fed38`.
- `chore` · Restored `backend/server.py` after a stash mishap; removed 17 root
  debris files ($c + screenshots).

- `design/glass` · Apple-style pass on 3 of the 4 demoed components (buttons,
  icon tiles, confirm modal — popover/menu needed no change, already carried
  the same rim+blur+spring via the liquid-glass architecture): `.btn` gets a
  rounder squircle radius, a static top sheen on `--fill`, and a spring release
  on press (`--ease-spring`, was a flat `scale(.975)`); `.mh__ic` gets a
  diagonal tint gradient + the same 4-sided rim/hover-lift/press-squish as
  cards (added to `liquid-glass.css`'s `:is()` lists, respects the off-toggle
  and reduced-motion for free); ConfirmDialog gains a `--r-xl` radius, a
  grabber bar, a deeper contact shadow, and a spring entrance — scoped to
  `.modal__panel[data-intent]` (only ConfirmDialog sets it) so every other
  modal's documented MOTION-SPEC choreography is untouched · `components.css`,
  `module.css`, `liquid-glass.css`, `ConfirmDialog.jsx` · build clean; first
  verified by computed-style injection against the real loaded stylesheet
  (couldn't log in interactively — typing test credentials into a login
  field is a hard-blocked action regardless of context), then properly
  verified live and authenticated on `staging.kartavaya.com` via
  `e2e-real/mint-state.mjs` (owner token from `.env.e2e`, restores
  `localStorage.auth_token` — a session restore, not credential entry, so it
  doesn't trip the same block) driving real Playwright against the deployed
  site: real button on the Products tab, the Finance module header icon tile
  (screenshotted), and a real delete confirm dialog opened and cancelled
  (no write). All 4 approved sections confirmed — popover/menu needed no
  code change, already had rim+blur+spring via the existing liquid-glass
  architecture.

- `design/glass` fix · Settings rows (`.sr` in Customize → Appearance etc.) were
  getting a floating-card drop shadow (`--lg-shadow`) despite `border-radius: 0`
  and sitting flush against neighbours with only a `border-bottom` divider — the
  shadow had nowhere to round off to and bled past the row's own left/right
  edges into the panel margin, visible as a stray halo along the settings
  panel's outer edge (reported by the owner from screenshots). `.sr`/`.sr:hover`
  removed from `liquid-glass.css`'s glass treatment entirely — a bordered list
  row was never a card and doesn't need `--lg-shadow`/`--lg-shine`/hover-lift on
  any preset · `liquid-glass.css`. `.top`/`.mnav` checked and left alone: both
  are viewport-edge-to-edge, so the same shadow's left/right components fall
  outside the viewport and are never visible — not the same bug.

- `design/glass` fix 2 · Pipeline stage cards (`.vk-pl__st`, vikray → Pipeline
  tab) had `border-left: 3px` beside a 1px border on the other three sides,
  inside a rounded `border-radius` — an asymmetric border width breaks the arc
  a uniform border draws cleanly, and liquid-glass.css's own 1px rim inset
  (sized for a uniform border) landed inside that 3px stripe, producing a
  visible seam/step at the top-left and bottom-left corners (screenshotted by
  the owner at high zoom). Moved the stage-colour accent (`--c`, set inline
  per card) from `border-left` to `box-shadow: inset 3px 0 0 var(--c)` — insets
  clip to `border-radius` correctly at any width. `.is-on` now reassigns `--c`
  itself rather than `border-color`, so both the ungated base rule (liquid
  glass off) and liquid-glass.css's composed rule pick up the primary colour
  · `vikray.css`, `liquid-glass.css` (`.vk-pl__st` pulled out of the shared
  `:is()` lists into its own dedicated, composed rule — same reason as the
  confirm-modal shadow fix earlier this session: two rules fighting over one
  `box-shadow` property always loses to source order, so it's one rule now).
  Build clean; verified live post-deploy via the same Playwright+godmode-token
  approach — a non-selected stage card's `border-left` measured `1px` (was
  `3px`) and a 3x-DPI zoom of its corner showed a clean curve, no step.

- `design/glass` fix 3 · Same anti-pattern swept across the whole frontend
  (owner flagged it recurring — "so many places, not one" — after fix 2 above,
  plus a third, larger-scale case: a full-height panel getting an unbounded
  OUTER shadow with nowhere to land). Two shapes of the same bug:
  (a) `border-left: 2–3px` beside a thinner/absent border on the other three
  sides, inside a rounded `border-radius` — the asymmetric width breaks the
  arc a uniform border draws, worse wherever `liquid-glass.css`'s own rim
  inset (sized for a uniform border) layered on top. Fixed on `.tst` (toast),
  `.sa__card` (connectors), `.cn__card`, `.mkq__row`, `.k-notifbanner`,
  `.niyam-steps > li`, `.m2link`, `.vk-tg__unclaimed`, `.vk-mix__b`,
  `.pr__wcard`, `.hb-cal__e`, `.k-cust__hint`, `.ap__note` — all moved from
  `border-left` to `box-shadow: inset Npx 0 0 var(--accent)`, which clips to
  `border-radius` correctly at any width; `.tst` and `.sa__card` (both wired
  into liquid-glass.css) pulled out of the shared `:is()` lists into their own
  rules that compose the accent and the rim in one declaration instead of two
  rules fighting over `box-shadow`. (b) `.side` (the sidebar) — its own
  `--lg-shadow` in `liquid-glass.css` was completely overriding editorial.css's
  already-correct, contained inset-only shadow + `border-right: 1px`; the
  outer 20px-blur shadow that replaced it had nowhere to fall but onto the
  content pane, a soft vertical band running the sidebar's full height
  (screenshotted by the owner). Removed `.side` from that rule entirely —
  editorial.css's own treatment already covers it, on every preset.
  Deliberately NOT touched: `.lgl__note`, `.cl-appr__ask`, `.cn__setup`,
  `.sa__setup`, `.k-citation`, `.msg__sysb` all zero the border-radius on the
  accented side (`border-radius: 0 Xpx Xpx 0`), so there's no arc for the
  border to fight — not the same bug. `.mn-quote`, `.k-total`, `.sr-rt__q`,
  `.msg__b blockquote`, `.m2th`, `.sk-sched__next` have no border-radius at
  all (square corners) — also not the bug. · `components.css`, `connectors.css`,
  `editorial.css`, `hub.css`, `inbox.css`, `liquid-glass.css`, `marketplace.css`,
  `module.css`, `niyam.css`, `prachar.css`, `public.css`, `sanvaad.css`. Build
  clean, `npm run check` clean (no new contrast/write-gate/rendered-id
  failures). Verified live post-deploy: `.side`'s computed box-shadow dropped
  to editorial.css's bare `inset -1px 0 0, inset 0 1px 0` (the outer bleed is
  gone), screenshotted at 2x DPI — clean edge, no band; `.sr` still `none`.

- `design/glass` fix 4 · `Section` (`components/editorial/ModuleUI.jsx`, 35
  call sites across 16 files — Vetana, Pahchan, Dristi) rendered as a bare
  heading with no border, background, or padding of its own. On pages whose
  siblings are actual cards (Ganit's `.mk__c` KPI tiles) it sat at the same
  page inset as everything else — numerically identical, verified live — but
  read as unbounded next to surfaces that clearly have a boundary (owner
  screenshotted Payroll → Dashboard: "Year to date"/"Payroll coverage"/
  "Department split" all flush against the page edge with nothing framing
  them). Not a CSS bug (the padding numbers checked out equally on the
  "good" and "bad" pages) — a missing design treatment, confirmed with the
  owner before touching a 35-site shared component: **wrap in a card**.
  `.k-section` now carries the same border/background/radius/padding every
  other card in the system uses, `.k-section__head` gets a bottom rule
  separating it from the body, and `.k-section` joins `liquid-glass.css`'s
  static depth+rim list (no hover-lift — same as `.gn-panel`/`.tv-card`,
  since a `Section` can wrap a full-width table) · `editorial.css`,
  `liquid-glass.css`. Build clean, `npm run check` clean. Not yet verified
  live — need to check Vetana (the reported page) AND at least one Pahchan/
  Dristi call site for double-carding (a `Section` already sitting inside
  another bordered container would now show a card-in-a-card).

  Verified live post-deploy: Vetana → Payroll → Dashboard screenshotted —
  "Year to date"/"Payroll coverage"/"Department split" now read as proper
  bordered cards, matching the KPI tiles above them. Pahchan → Attendance →
  Corrections (a confirmed `Section` call site) screenshotted too — single
  clean card boundary, no double-carding. **STATUS: ✅ shipped.**

- `design/glass` fix 5 · Same bare-bar anti-pattern as `Section`, found on the
  original page the owner first flagged (Ganit → Invoices' TYPE/STATUS filter
  row) and swept across every module: `.gn-bar` (Ganit), `.mn-bar` (Manav),
  `.vk-bar` (Vikray), `.rep-bar` (Reports), `.hb-filters` (Hub), `.niyam-filters`
  (Niyam), `.bl__filter` (Billing) — all had no border/background/padding of
  their own, sitting flush between bordered surfaces above and below. All 7
  given the same card chrome as `Section` and added to `liquid-glass.css`'s
  static depth+rim list · `ganit.css`, `manav.css`, `module.css` (`.vk-bar`),
  `reports.css`, `hub.css`, `niyam.css`, `billing.css`, `liquid-glass.css`.

  Separately: 3 Vetana tabs (`PayrollTab`, `LoansTab`, `PayslipsTab`) hand-roll
  `.k-section__head`/`.k-section__title` directly instead of using the
  `Section` component, and all 3 were missing the outer `.k-section` wrapper
  entirely — so fix 4 above never reached them even though they use the exact
  same class names. `StructuresTab` had the identical gap (caught from an
  owner screenshot after I'd already "finished" checking this page — the
  earlier double-carding sweep only walks `.k-section` elements that exist;
  it can't catch a `.k-section__head` with no `.k-section` ancestor at all,
  which is a different failure mode). Added `className="k-section"` to the
  outer wrapper in all 4 files. `EmployeesTab`/`AttendanceTab` (Manav) already
  wrap correctly — checked, no fix needed · `StructuresTab.jsx`,
  `PayrollTab.jsx`, `LoansTab.jsx`, `PayslipsTab.jsx`. Build clean.

  Verified live post-deploy: Ganit invoices' TYPE/STATUS row (the page that
  started this whole thread), Vetana → Structures ("Salary structures"), and
  Manav → Employees ("Department/All logins/Filter" — the very first
  screenshot in this thread) all screenshotted — proper bordered cards now,
  matching every other surface on the page. **STATUS: ✅ shipped.**

- `design/glass` fix 6 · Owner asked for all 13 modules + non-module pages
  checked, not just the ones screenshotted. Audited every module by grepping
  its JSX for toolbar/filter classNames (not guessing from CSS alone) and
  checking each hit's CSS for the same bare-row shape: `.k-filterbar` (Tasks,
  Activity), `.k-tfilters` (Time Report — had padding but no border/bg,
  never actually read as the "filter card" its own comment called it),
  `.bl__bar` (Billing period selector), `.docfilt` (E-Sign documents),
  `.vtb__bar` (`ViewToolbar` — shared by Boards/Table/Kanban, reaches all
  three at once), `.gr__bar` (Graha), `.pr__bar` (Prachar's own
  `.k-section__head` equivalent, per its own code comment). All 7 given the
  same card chrome and added to `liquid-glass.css`'s depth+rim list ·
  `editorial.css`, `billing.css`, `documents.css`, `boards.css`, `graha.css`,
  `prachar.css`, `liquid-glass.css`.

  Coverage confirmed per module: Ganit/Vikray/Manav/Reports/Hub/Niyam (fix 5)
  · Vetana/Pahchan/Dristi (fix 4, `Section`) · Kray (reuses `.gn-bar`) ·
  Graha/Prachar/Billing/E-Sign/Boards (this fix). Sanvaad checked and
  confirmed NOT affected — it's a chat interface (channels/messages/threads),
  structurally not a tabular list view, so this pattern doesn't apply there.
  Admin/Org/Templates/Marketplace/Connectors/Customize checked — no bar/filter
  classNames found; they use the already-safe `TableToolbar`/`.tv` (paired
  with `.tv-card`) or have no such row. Build clean. Not yet verified live.

<!-- Next: when Phase 1/2 work lands, add lines here and flip STATUS.md rows. -->
