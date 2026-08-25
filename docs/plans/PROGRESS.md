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

<!-- Next: when Phase 1/2 work lands, add lines here and flip STATUS.md rows. -->
