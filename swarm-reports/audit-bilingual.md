# Bilingual / Devanagari audit

Branch `audit/bilingual-devanagari`, based on `origin/staging` @ `190fa73a`
(verified with `git log -1 --oneline origin/staging` at checkout; staging has
since moved to `765a2bf7`, whose two commits touch only
`backend/routers/{dashboards,hub_publish,vetana}.py` and a peer report — no
overlap with anything below).

Spec: `design-handover/24-bilingual-devanagari.md`. Canonical words:
`design-reference/Kartavaya Redesign/{Data.jsx, Chrome.jsx, Mobile.jsx,
MobileModules.jsx}`.

---

## 1. Coverage — what was measured, and what could not be

**Enumerated:** every `.jsx`/`.js` under `frontend/src`, every `.tsx`/`.ts`
under `mobile/src`, `backend/**/*.py|html|txt`, and all `frontend/src/styles/*.css`.
**281 files carry Devanagari or Gujarati** (1,489 source lines):

| surface | files | lines |
|---|---|---|
| web JSX/JS | 199 | 1,117 |
| web CSS | 17 | 52 |
| mobile TSX/TS | 31 | 146 |
| backend (email, PDF, routers) | 34 | 174 |

**Measured in a real browser** (own Vite on **:5931**, not :5173; own tab
`tab-33`; reclaimed one tab whose server was confirmed dead by port probe —
5611/5700/5877/5612 were all dead, 5220/5461/5477/5188 alive and left alone):

| what | how | Devanagari nodes measured |
|---|---|---|
| Landing page | real route on the real dev server | 20 |
| 12 app component contexts | harness loading the **real** `App.jsx` CSS chain + ancestry copied verbatim from each source file | 22 |
| 15 email templates | rendered via `backend/scripts/preview_emails.py`, iframed and measured | 41 |
| **total** | | **83** |

**Screenshots were not used — they have failed all session.** Every typography
number below comes from `getComputedStyle` via `javascript_tool`, plus
advance-width probes for font-fallback questions.

**Could not reach — 3 surfaces, and how each was covered instead:**

1. **Authenticated app routes in a live browser.** No backend credentials, and
   the DB is read-only for this task. Covered by the harness (real stylesheet
   cascade, ancestry copied from source) plus static analysis of all 199 files.
   Residual risk: a wrapper that only exists at runtime could add tracking the
   harness does not reproduce.
2. **Mobile rendering.** React Native has no DOM and no emulator here. Covered
   by static analysis against the `theme/fonts.ts` contract, which is enforceable
   because Devanagari there may only get a family through `hindi()`.
3. **Rendered PDFs.** `weasyprint` is not importable in this environment.
   Covered by source analysis of the font contract; finding **B3** is the one
   place that matters and is reported rather than fixed for exactly this reason.

---

## 2. Pair table — build word vs reference word

Verdicts are against the reference's own word for the **same destination**.

### 2.1 Web sidebar — `navConfig.js` vs `Chrome.jsx` NAV

| English | build | reference | verdict |
|---|---|---|---|
| Tasks | कर्तव्य | कर्तव्य | MATCH |
| CRM | ग्रह | ग्रह | MATCH |
| Sales | विक्रय | विक्रय | MATCH |
| Finance | गणित | गणित | MATCH |
| HRMS | मानव | मानव | MATCH |
| Payroll | वेतन | वेतन | MATCH |
| Attendance | पहचान | पहचान | MATCH |
| Marketing | प्रचार | प्रचार | MATCH |
| Approvals | सम्मति | सम्मति | MATCH |
| Roles & access | अधिकार | अधिकार | MATCH |
| Customization | रूपांकन | रूपांकन | MATCH |
| Organisation | संस्था | संस्था | MATCH |
| Aekam admin | ऐकम | ऐकम | MATCH |
| Boards | फ़लक | फलक | **correct as built — see note** |
| Analytics | दृष्टि | दृष्टि (as "Reports") | Devanagari MATCH; Latin rename → **W1** |
| E-Sign | प्रमाण | हस्ताक्षर | **MISMATCH → W2** |
| Messages | संवाद | संवाद | MATCH |
| Inbox | सन्देश | सन्देश (`ui_kits/app/Chrome.jsx:33`, `guidelines/type-hindi.html`) | MATCH |

Section headings — `कार्यक्षेत्र · राजस्व · जन · वृद्धि · ग्राहक · व्यवस्था` — all
MATCH. `प्रचालन`/`दल`/`द्वार` are build-only sections with no reference entry.

**Boards `फ़लक` is right, do not "fix" it.** `24 §92` states the nuqta form
`फ़लक` is the correct **`hi`** value and the nuqta-less `फलक` is the **`sa`**
form. `Chrome.jsx` has a single `hi` field carrying the `sa` spelling. A
future sweep that "aligns" this to the mockup would be a regression; noted here
so it does not get made twice.

**`Reports` is not a mismatch.** An `en`-keyed join collides two different
destinations: the build's `Reports/प्रतिवेदन` is the `/reports` operations page,
while the reference's `Reports/दृष्टि` is the Dristi module the build calls
`Analytics/दृष्टि`. The Devanagari tracks Dristi correctly in both.

### 2.2 Module tabs — `tabLabels.js` vs `Data.jsx` `TAB_HI`

**108 keys, 108 exact matches, 0 mismatches, 0 missing, 0 extra.** A verbatim
port. Diffed programmatically, not by eye.

### 2.3 Mobile — `MoreScreen`/`BottomBar` vs `Mobile.jsx` + `MobileModules.jsx`

| English | build (now) | reference | verdict |
|---|---|---|---|
| Today | आज | आज | MATCH |
| Tasks | कर्तव्य | कर्तव्य | MATCH |
| Messages | संवाद | संवाद | MATCH |
| More | अधिक | अधिक | MATCH |
| Approvals | सम्मति | सम्मति | MATCH |
| Reminders | स्मरण | स्मरण | MATCH |
| Attendance | पहचान | पहचान | MATCH |
| Payslips | वेतन | वेतन | MATCH |
| Assistant | सृजन | सृजन | MATCH |
| CRM | ~~ग्राहक~~ → **ग्रह** | ग्रह | **was MISMATCH — FIXED (M1)** |
| Inbox | ~~संदेश-पेटी~~ → **सूचना** | सूचना | **was MISMATCH — FIXED (M2)** |
| Time | काल | समय | **MISMATCH → M3 (report only)** |
| Invoicing / HR / Analytics | गणित / मानव / दृष्टि | Finance / HRMS / Reports | Devanagari MATCH; Latin rename → **W1** |

Devanagari on mobile is otherwise correct throughout: `BottomBar` was already
right on the `संवाद`/`सन्देश` distinction, and `BiLabel.tsx` makes the
tracked-kicker defect structurally unrepresentable.

---

## 3. Typography — every computed violation

Measured `font-family` / `font-weight` / `letter-spacing` / `text-transform` on
83 Devanagari nodes. **Five violations found; three fixed, two reported.**

| # | surface | node | computed (before) | why it is a defect | status |
|---|---|---|---|---|---|
| T1 | `pages/today/ReceivablesKPI.jsx:33` | `प्राप्य` in `.k-hero-kpi__label` | **fw 700 · ls 1.68px · uppercase** | all three inherited from the one label on Today that is bold+tracked+uppercase. 1.68px tracking detaches the repha in `प्र` and splits the `प्य` ligature | **FIXED** |
| T2 | `styles/generate-report.css:554` | `पूर्व निर्यात` in `.gr__history-hi` | **fw 500** | Tiro ships 400 only → synthetic bold. Sibling `.gr__export-hi` under an identical 500 parent already declares 400; this one was missed | **FIXED** |
| T3 | `pages/vikray/OrderDetail.jsx:237` | `गणित` inside `<b>` in a denial note | **family Inter · fw 600** | `--font-ui` has no Devanagari coverage — measured **89.45px vs Tiro's 85.45px**, i.e. a system-font substitution — *and* weight 600 on a 400-only face, *and* on the spec's No list | **FIXED** |
| T4 | `services/cost_report_pdf.py` | 5 Devanagari strings | **Georgia / Helvetica, no Devanagari face at all** | sole PDF that bypasses `doc_render`; renders tofu, with no `deva_span()` Latin fallback | **REPORTED (B3)** |
| T5 | `email_service.py:1140` | `सप्ताह का नाय␣␣` | correct type, **corrupt bytes** | two `U+FFFD` where `क` belongs | **FIXED (B1)** |

**Verified after the fix**, same harness: 22/22 Devanagari nodes at Tiro / 400 /
`normal` / `none`, **0 remaining violations**. `प्राप्य` now also picks up the
`[lang="hi"]` Devanagari leading (19.47px) while its parent stays
700/1.68px/uppercase — the child neutralises all three, exactly as
`.side__sec-hi` already does for the sidebar heading.

### Confirmed healthy (measured, not assumed)

- **`.mt__b` tab strip** — the strip nine pages render. Latin→Devanagari gap
  measured at **exactly 7px** on all three tabs (`en.right`→`hi.left` rects, not
  `innerText`). The 13px double-fix regression is genuinely resolved; the flex
  `gap` is the single surviving mechanism.
- **Sidebar section headings** — parent computes 700/1.7px/uppercase, child
  `राजस्व` computes 400/normal/none. The neutralisation works.
- **Landing page** — 20 Devanagari nodes, all Tiro/400/normal/none, all
  `lang`-tagged. CRM reads **ग्रह**; the earlier "landing says ग्राहक" defect is
  already fixed. `ग्राहक` on that page belongs to the Clients fragment, correctly.
- **Emails** — 41 Devanagari nodes across 15 templates, all clean. The
  `LATIN · देवनागरी` splitter in `email_service.py` works; B1 was the only fault.
- **Gujarati font path** — under `en+gu`, `--font-indic` becomes
  `'Noto Sans Gujarati', …, 'Tiro Devanagari Hindi', …`. Measured: Gujarati
  resolves to Noto Sans Gujarati (live node), Devanagari still resolves to Tiro
  (85.45px == Tiro control). Both faces are loaded with `display=swap`. Correct.

### False positives I discarded (verified against a second source)

Recording these so the next sweep does not re-file them:

- **`.au__sub` (`AuthShell.jsx:163`)** — computed `font-family` reads `Inter`,
  which looks like a missing Devanagari face. It is not: the declared stack is
  `var(--font-ui), var(--font-hindi)`, and per-glyph fallback puts the
  Devanagari on Tiro. Proved by advance width — **85.45px, identical to the
  Tiro control**. Not a defect.
- **`InboxPage.jsx:215`** — my first pass flagged it as missing `lang`; the real
  markup already has `lang="hi"`. That reading was an artifact of a class name
  my own harness invented. (It does raise a separate *placement* question — see
  W3.)

---

## 4. Fixes made

All on `audit/bilingual-devanagari`, committed. Each changes one word or adds
one reset; none introduces a second mechanism where one already exists.

- **B1 · `backend/email_service.py:1140`** — `सप्ताह का नाय␣␣` → `सप्ताह का नायक`.
  Two `U+FFFD` bytes replaced `क`. **This shipped in every weekly digest email.**
  Confirmed at byte level (`EF BF BD EF BF BD` where `E0 A4 95` belongs) and
  end-to-end in the rendered template, against two sibling controls that are
  intact: daily `दिन का नायक`, monthly `माह का नायक`.
- **M1 · `mobile/.../MoreScreen.tsx` + `modules/GrahaScreen.tsx`** — CRM
  `ग्राहक` → `ग्रह` (label, screen title, docstring). Three reference sources
  agree (`Chrome.jsx:36`, `MobileModules.jsx:7`, `Mobile.jsx` MMODULES), the web
  already read `ग्रह`, and `ग्राहक` is spent on the Clients section heading — so
  one word was labelling two destinations.
- **M2 · `mobile/.../MoreScreen.tsx`** — Inbox `संदेश-पेटी` → `सूचना`. The old
  word appears in **no** reference file and disagreed with the screen the row
  opens: `InboxScreen.tsx:154` already renders `Inbox · सूचना`, and the reference
  labels this exact destination `Notifications · सूचना`.
- **T1 · `ReceivablesKPI.jsx` + `styles/today.css`** — added `lang="hi"` (zeroes
  the inherited tracking via the existing `[lang="hi"]` rule and supplies
  Devanagari leading) and extended the selector `today.css` **already owns** with
  `font-weight:400; text-transform:none`. No new mechanism, no second file.
- **T2 · `styles/generate-report.css`** — added `font-weight:400` to
  `.gr__history-hi`, matching its sibling.
- **T3 · `pages/vikray/OrderDetail.jsx`** — removed `(गणित)` from the
  permission-denied sentence.
- **B2 · `backend/routers/graha.py:2`** — docstring `ग्राह` → `ग्रह`. `ग्राह` is
  *grāha*, a crocodile — the exact word `24 §203` calls out. Comment-only.

### Gates — all green, all matching baseline

| gate | result |
|---|---|
| `check-tokens.mjs` | 356 declared, 0 missing |
| `check-classes.mjs` | 3,517 selectors, 0 missing a rule |
| `npx vite build` | built in 13.65s |
| `npx vitest run` | **43 files / 682 tests passed**, exit 0 |
| `mobile: npx tsc --noEmit` | exit 0 |
| `backend: python -m pytest -q` | **1475 passed, 122 skipped**, 0 failed |

No `yarn.lock` / `package-lock.json` and no line-ending-only changes committed.
No email sent — `preview_emails.py` renders to disk and forces `OUTBOUND_MODE=dry`.
No database access. `main` untouched.

---

## 5. Reported, not fixed — needs a product decision

**W1 · Mobile module names diverge from the reference (as briefed).**
`Invoicing`/`HR`/`Analytics` where the reference says `Finance`/`HRMS`/`Reports`.
The Devanagari is correct in every case; only the Latin differs. Web has the
same divergence for `Analytics` vs `Reports`. Renames — reported, not made.
Note the reference's mobile files *do* endorse the build on two others:
`Payslips` and `Assistant` are the reference's own mobile words.

**W2 · eSign is `प्रमाण` in the build, `हस्ताक्षर` in four reference sources**
(`Chrome.jsx:65`, `MobileModules.jsx:13`, `Mobile.jsx` MMODULES, and
`TAB_HI['e-sign']`). Left alone deliberately: the build is *self-consistent*
(`navConfig.js` + landing page both say `प्रमाण`), so this is a module-identity
rename touching a public page — not the CRM case, where the build contradicted
itself. Worth noting the build already contradicts itself *once*: the `e-sign`
**tab** inside Ganit renders `हस्ताक्षर` (verbatim from `TAB_HI`) while the
sidebar **module** row says `प्रमाण`.

**W3 · Devanagari in error and empty-state text — one clear case, one pattern.**
`24 §199` puts validation messages, error text and empty-state explanations on
the No list.
- Clear: `InboxPage.jsx:215` appends `सहेजा नहीं गया` inside a save-failure
  sentence. Typography is correct; the *placement* is not. One-line removal —
  held back only because it is a content change in a peer-shared file.
- Pattern, needs a ruling: the build consistently uses **bilingual short title +
  English explanatory body** (`EmptyState title={{en,hi}}` with an English
  `description`; `NotificationBanner` `title`+`hi` with an English `body`). That
  arguably satisfies the rule as written — the *explanation* stays English — and
  it is deliberate and systematic, not accidental. Confirm the reading rather
  than let a later sweep strip ~20 of these unilaterally.

**M3 · Mobile `Time` is `काल`, reference says `समय`.** Not fixed: the build is
self-consistent (`MoreScreen` + `TimeScreen`) *and* matches the web sidebar's
`Time Report · काल`. Changing mobile alone would create a new web/mobile split.
Decide once, apply to both.

**M4 · `TodayScreen.tsx:174` hardcodes `वैशाख`.** It is a **constant**, printed
beside a live date, so it is wrong for roughly eleven months of the year — the
exact defect `lib/vikram.js` exists to document and that the web already fixed
("showing a specific Hindu month that is wrong is worse than showing none,
particularly to the audience most likely to notice"). Not fixed because the
sources genuinely disagree: `design-reference/mobile/{android,ios}-screens.jsx`
*do* render `वैशाख`, while canonical `Mobile.jsx:103` uses `आज`. Three options,
all defensible: `आज` (canonical mockup), `विक्रम संवत् {year}` (web's resolution,
`vikramLabel()`), or drop it. **Recommend porting `vikramLabel()`** — it is the
only one that is both decorative and true. Flagging prominently: it is on the
most-visited mobile screen and the audience most likely to notice is the one
taking delivery.

**B3 · `backend/services/cost_report_pdf.py` bypasses the document font contract.**
Eight of nine PDF services import `services/doc_render as R` and wrap Devanagari
in `R.deva_span()`. This one imports neither. Its stacks are
`Georgia, "Times New Roman", serif` and `"Helvetica Neue", Arial, sans-serif` —
**no Devanagari face, no `@font-face`** — so all five strings (`उपयोग एवं लागत
प्रतिवेदन`, `AI सेवाएं`, `डेटा सेवाएं`, `डेटा कैटलॉग`, `क्रेडिट उपयोग प्रतिवेदन`)
render as tofu, with no `deva_span()` fallback to degrade to Latin. Two of them
sit in `<h2>`, which is bold by default — a synthetic bold on top of a missing
face. The file's own docstring calls it "Client-facing", so the English-only
platform exemption does not apply. **Not fixed because `weasyprint` is not
importable here and there is no `cost_report` PDF test — I will not change a
document generator I cannot render.** Fix is mechanical: import `doc_render as R`,
adopt its `@font-face` block, wrap each string in `R.deva_span(text, latin)`.

**B4 · Seven corrupted comment characters** at `email_service.py` lines 1016,
1076, 1126, 1175, 1204, 1241, 1270 — the same encoding accident that produced
B1, landing in box-drawing rules. Zero user impact, comment-only. Left alone to
keep the diff to the one line that ships; worth a separate tidy.

**G1 · Gujarati is still half-populated (`24 §6`).** `gu` exists in
`navConfig.js` (47 entries) and nowhere else: `lib/commands.js` has 37 `hi` and
**0** `gu`; `pages/inbox/notifKinds.js` has 18 `hi` and **0** `gu`;
`tabLabels.js` is Devanagari-only across all 108 tabs. So an `EN+GU` user gets
Gujarati in the sidebar and Devanagari in the command palette, the inbox and
every module tab strip — three scripts on one screen, which is precisely what
`24 §58` describes. The *font* plumbing is correct (verified above); the
*vocabulary* is missing. **Do not machine-fill it** — `24 §94` warns against
exactly that for `sa`, and the same reasoning applies. This is a translation
commission, and it is the largest open item in this area.
