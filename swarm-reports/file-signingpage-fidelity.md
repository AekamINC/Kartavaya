# SigningPage.jsx — design fidelity audit

**File:** `frontend/src/pages/SigningPage.jsx` (+ its stylesheet `frontend/src/styles/public.css`)
**Route:** `/sign/:token` — public, no session. A client's own CUSTOMER lands here.
**Lens:** design fidelity only. Behaviour/correctness and security/a11y are peers'.
**Branch:** `fidelity/signingpage-esign`, cut fresh from `origin/staging` @ `18fd4609` (the worktree was 809 commits stale).

**How verified.** No screenshots — they have failed all session. Everything below is
`getComputedStyle` measured in **my own headless Chrome over CDP** (own profile, ports
9333–9336), driving a **local-only** mock of the esign endpoints on 127.0.0.1:51884.
No backend, no Supabase, no email, no OTP, no database write. Dark mode was measured
under genuine `Emulation.setEmulatedMedia` `prefers-color-scheme`, never by forcing
`data-theme` — forcing it desyncs from `applyPrefs` and hides the exact defect below.
Reduced motion likewise via real `prefers-reduced-motion` emulation. My own vite ran on
:5247, not :5173.

---

## 1 · What is in the reference and NOT in the build

**The headline finding is about the reference itself: there is no signer-facing screen in
the design system at all.**

`ScreensMore.jsx:318` `ScreenEsign` is the **firm's** module screen — a document list and
an audit-trail card. Its "Send for signature" button and every table row call
`open('sign', d)`, and **no overlay in `App.jsx` handles `kind === 'sign'`** (the handled
kinds are `invoice`, `invite`, `approve-support`, `cell`, `kbd`). Those clicks are dead
ends in the harness. The signer's view was never drawn.

So `ScreenEsign`'s own parts are **correctly absent** from `SigningPage` — they belong to
`EsignPage`, the firm's screen. Enumerated so this is not re-litigated:

| `ScreenEsign` part | In SigningPage? | Correct? |
|---|---|---|
| `PH kick="Clients · ग्राहक" hi="हस्ताक्षर" en="eSign"` + lede | No | Yes — module page header, not a signer's |
| `TabBar` documents/create, `counts={{documents:4}}` | No | Yes — firm-side navigation |
| Document table (Doc/Title/Party/Status/When, 92px/1.6fr/1fr/110px/90px) | No | Yes — firm-side list |
| `DST` status tags (Draft/Sent/Viewed/Signed) | No | Yes — firm-side |
| **`Card title="Audit trail" hi="अभिलेख"`** — 6 events, dot-and-rail timeline | **No** | **See gap A** |
| "Send for signature" primary action | No | Yes — firm-side |

And from `ScreensThin.jsx:391` `EsignCreate`, the nearest thing to a signing surface:

| `EsignCreate` part | In SigningPage? | Verdict |
|---|---|---|
| **Document preview** — `aspect-ratio 1/1.294`, `--shadow-2`, paged, with content | **No** | **GAP B — the largest miss** |
| Field overlays (Signature/Initials/Date), dashed, `--primary` when selected | No | Firm-side authoring |
| Signing-order timeline with numbered `--primary-container` pips | No | Firm-side |
| Deliver-by segmented control, OTP/remind/expire switches | No | Firm-side |
| **`note note--info` — the IT Act statement** | Prose `<p>`, different wording | **GAP C** |

### GAP A — no audit / evidence line for the signer

The reference gives the **firm** a six-event audit trail (`Created by…`, `Recipient
verified…`, `Sent via WhatsApp`, `Opened (IP 49.36.x.x)`, `Signed — OTP verified`,
`Sealed PDF generated`). The signer is shown **nothing** about what is being recorded
about them — not that their IP and open-time are logged, not that a sealed PDF is
produced. On the page where a stranger consents to a legally binding act, the evidence
trail is invisible.

**Not fixed — needs data the build cannot supply.** `/v1/esign/verify/:token` returns
title, description, signer name/email, `file_url`, `otp_required`. No event list. Inventing
one would be fabricating an audit record, which is precisely the thing that must never be
faked. Reported, per the Filters-button / avatar precedent.

### GAP B — no document preview; the signer signs what they cannot see inline

The reference renders the document as a page with a shadow and real content. The build
offers a single text link, `View document (PDF)`, which leaves the page. Measured: on the
`sign` step there is exactly **1 `<a>`** on the whole page and **no** inline preview element.

This matters most on the surface it was written for. The mobile reference states the rule
outright (`MobileModules.jsx:174`): *"Signing on a phone needs the full document readable
first — tapping opens the paged view, not a signature box."* The build shows a signature
box and a link.

**Not fixed — out of fidelity scope and not inventable.** An inline preview needs a PDF
renderer (`pdf.js` or an image derivative from the backend); neither exists on this route,
and `file_url` is a signed URL to a raw PDF. This is a build-a-feature item, not a restyle.
Flagged as the single largest divergence from the design's intent.

### GAP C — the IT Act notice says something different from the reference

| | Text |
|---|---|
| **Reference** (`ScreensThin.jsx:456`, in a `note note--info` with a check glyph) | "An OTP-verified signature with the audit trail is accepted under **section 10A of the IT Act**. It is **not a digital signature certificate** — a few registrars still insist on DSC." |
| **Build** (`SigningPage.jsx`, plain `<p class="pub__muted">`) | "By pressing "Sign document" you agree that this electronic signature is legally binding and has **the same effect as a handwritten signature** under the IT Act, 2000." |

Three divergences: the reference cites **section 10A** and the build cites no section; the
reference **disclaims** DSC equivalence and the build omits that; and the reference presents
it as an **affirmed `note--info` panel**, the build as muted small print.

The build's claim is also *stronger* than the reference's careful one — "the same effect as
a handwritten signature" versus "accepted under section 10A … not a digital signature
certificate".

**Not fixed — deliberately.** Rewriting the legal claim a customer consents to is the
owner's call and a lawyer's, not a fidelity fix. Recommend adopting the reference wording
and the `note note--info` treatment. Escalating rather than editing.

---

## 2 · Part-by-part

Legend: **OK** matches · **FIXED** defect found and repaired here · **GAP** reported, not fixed.

| # | Part | Evidence (measured) | Verdict |
|---|---|---|---|
| 1 | Panels / card chrome | `.pub__card`, `Card`/`CardHead`/`CardBody` from `components/ui/`; `.card__title` = Newsreader 20.02px/500, `ls -0.2002px`, radius 6.96px = `--r-sm` | OK |
| 2 | Document preview | 1 `<a>`, no preview node | **GAP B** |
| 3 | Signature capture — type | `.fldx` + `.sg__preview`; preview pinned to paper/ink | OK (see 15) |
| 4 | Signature capture — draw | canvas 500×160 backing, `--sg-paper #FFFEFB`, `--sg-ink #1B1D1A`, first pixel `255,254,251,255` — paper painted in, not transparent | OK (see 16) |
| 5 | Consent / IT Act notice | wording + treatment differ from reference | **GAP C** |
| 6 | Audit / evidence line | absent | **GAP A** |
| 7 | Completion state | `Document signed` + `1/2 signers have signed.` + close-window copy | OK |
| 8 | Terminal states | `already_signed`, `declined`, `error` all distinct branches; error renders `ErrorState kind` ("This doesn't exist, or it was deleted") not a generic message | OK |
| 9 | **Bilingual pair** | page had **zero Devanagari**; sibling `/approve` carries `अनुमोदन` ×2 on the same `pub-*` chrome | **FIXED** |
| 10 | Devanagari rules | see §3 | **FIXED** |
| 11 | Error text in English only | `24 §199` No-list — error copy is Latin only | OK |
| 12 | Tokens resolve | 356 declared / 244 referenced / **0 missing**; every probed var returned a value, no fallback arm reached | OK |
| 13 | Type scale | `--t-body` 14 · `--t-body-sm` 13.02 · `--t-label` 12.04 · `--t-micro` 10 · `--t-title-lg` 20.02 — all derived, none literal | OK |
| 14 | Spacing / radii | `--pad-page` 28 · `--pad-card` 18 · `--gap-section` 22 · `--sp-2` 8 · `--sp-3` 12 · `--r-sm` `calc(12px*0.58)` | OK |
| 15 | Typed-signature face | `"Brush Script MT", "Segoe Script", cursive` @ **32px literal** | **GAP D** |
| 16 | Canvas backing vs CSS size | CSS 563.25×160 vs backing 500×160 — saved bitmap is x-compressed ~11%, and the factor changes with viewport | **GAP E — peer's lens** |
| 17 | Motion tokens | `--ix 1`, `--motion-scale 1`, `--dur-base calc(220ms*1)` | OK |
| 18 | Reduced motion | under real emulation: `--ix .001`, `--motion-scale 0`, `--dur-base calc(220ms*.001)`, `.btn` transition **0.00014s** — both duration and distance respond | OK |
| 19 | `--ease-emph` | build `cubic-bezier(.16,1,.3,1)` vs MOTION-SPEC §2 `cubic-bezier(.2,0,0,1)` | **GAP F — global** |
| 20 | **Dark mode** | brand mark measured **1.62:1** | **FIXED** — §4 |
| 21 | 393 / 820 / 1280 | no horizontal overflow at any width; actions `column` @393 (both buttons 299px), `row` @820/1280 (142/93) | OK |
| 22 | Dark @ 393 | no overflow; `.btn` `#00332F` on `--primary` `#4FD8CB`; lede/muted on dark surfaces | OK |
| 23 | **Date format** | `already_signed` renders **`20 Jul 2026`** — matches `24 §180` and the reference's own `18 Apr 2026` / `24 Jul`. The `20/7/2026` divergence is gone | OK — holds |
| 24 | Numbers / currency | **no currency and no rupee figure anywhere on this route** — INR formatting is N/A here, not missing | N/A |
| 25 | Signer count numerals | `1/2` has no `tabular-nums`; `18 §90` mandates it for figures | Minor, noted |
| 26 | OTP field | width **210px** exactly (`Components.jsx:131` `--otp 210px`), JetBrains Mono, `ls 6.75px` (=.5em), radius 6.96px | OK |

---

## 3 · Devanagari — the shared-chrome defect

`.pub__kick` is uppercase + `.14em` tracked + weight 600. `/approve` writes
`<span lang="hi">अनुमोदन</span>` **directly inside it**. Measured before:

```
अनुमोदन   family: Inter, system-ui, sans-serif   ← NO Devanagari coverage
          weight: 600                            ← Tiro ships 400 only
          text-transform: uppercase              ← 24 §153 "never"
          letter-spacing: normal                 ← global [lang] guard works
```

The global `[lang="hi"]{letter-spacing:0!important}` (editorial.css:3146) fixed **one third**
of it. `editorial.css:3149` says so in terms: the `[lang]` rules "do NOT reset `font-weight`
or `text-transform`". Inter has no Devanagari glyphs, so every character fell through the
fallback chain; the inherited 600 then made the rasteriser synthesise a bold for a 400-only
face, smearing the शिरोरेखा.

Fixed by adding `.pub__kick [lang]` to `public.css` (`--font-hindi`, weight 400,
`text-transform: none`) — the same repair `editorial.css` already ships as `.k-lbl__in`.
`--font-hindi` not `--font-indic` deliberately: these are fixed JSX literals, and
`--font-indic` repoints to Noto Sans Gujarati under EN+GU, which has zero Devanagari coverage.

Measured after, on both pages:

| node | family | weight | ls | transform | lang | aria-hidden | line-height |
|---|---|---|---|---|---|---|---|
| `हस्ताक्षर` (`/sign`, `.card__hi`) | Tiro Devanagari Hindi | 400 | normal | none | hi | **true** | 24.78px = 14×1.5×1.18 |
| `अनुमोदन` (`/approve`, `.pub__kick`) | Tiro Devanagari Hindi | 400 | normal | none | hi | (none) | 17.7px = 10×1.5×1.18 |

The 1.18 Devanagari leading multiplier (`24 §140`) fires on both.

**Added to SigningPage:** `sanskrit="हस्ताक्षर"` on both `Sign: …` cards, via `CardHead`'s
existing prop so it renders `.card__hi` — `--font-indic`, `lang="hi"`, `aria-hidden="true"`.
`हस्ताक्षर` is what the reference calls this module everywhere it is named (`Chrome.jsx:66`,
`Landing.jsx:17`, `Onboarding.jsx:15`, `ScreenEsign`'s own header). Two public pages sharing
one chrome disagreeing about whether the head is bilingual is the exact defect `public.css`
exists to prevent.

**Judgement call, flagged for veto:** `24 §201` says Devanagari is "a recognition cue on
things the user already knows the meaning of", and this signer knows nothing of the product.
I followed the sibling-page precedent and `§189`'s explicit *Yes: document titles*, but the
owner may reasonably want zero Devanagari on a stranger-facing page. Reverting is a
two-token deletion.

**Left alone (not mine):** `अनुमोदन` on `/approve` has **no `aria-hidden`**, so a screen
reader announces the label twice (`24 §114`); and a second node, `कर्तव्य`, still renders in
Inter — it is outside `.pub__kick`. Both are in `ApprovePage.jsx`, another file.

---

## 4 · Dark mode — the same defect shape, found and fixed

The described defect (`applyPrefs` writing theme-dependent accents as **inline** styles on
`<html>` while the page flips `data-theme` to dark, an inline style outranking the
`[data-theme="dark"]` block) **was only half-repaired.** The effect stripped four properties
— `--primary`, `--primary-hover`, `--primary-text`, `--on-primary`. Those four are clean;
that part holds.

But `applyPrefs` **also** pins the brand-mark gradient, and those are equally
theme-dependent. `kartavaya-design.css`'s dark block defines:

```
--k-mid:       var(--primary)          → #4FD8CB in dark
--k-deep:      var(--primary-hover)    → #6FE6DA in dark
--side-active: color-mix(… var(--primary) 16% …)
```

while `applyPrefs` writes `--k-grad` / `--k-gradD` inline as **fully-resolved light
literals** that no `[data-theme]` rule can reach.

Measured on `/sign`, OS-level dark, `k_prefs` absent (the genuine stranger path). The four
`--primary*` props were correctly dropped, so the `KLogo` glyph moved to the dark palette's
`--on-primary` `#00332F` — and was then painted on the **light** gradient, still pinned at
`#005650 → #00897f → #05b7aa`. Dark ink on dark teal:

| glyph | gradient stop | before | after |
|---|---|---|---|
| `#00332F` | `#005650` (135° start / corner) | **1.62:1** | **9.25:1** |
| `#00332F` | `#00897f` (**centre — where the stroke sits**) | **3.23:1** | **7.93:1** |
| `#00332F` | `#05b7aa` (tail) | 5.52:1 | 5.52:1 |

The Kartavaya mark — the first thing a stranger sees on the most externally visible page in
the product — was rendering at **3.23:1 at its centre and 1.62:1 at the corner** in dark
mode. Directly analogous to the `अनुमोदन` 2.13:1 on the sibling page.

**Fix:** extend the strip list from 4 to 10, adding `--k-primary`, `--k-mid`, `--k-deep`,
`--k-grad`, `--k-gradD`, `--side-active`. `--k-grad` then recomputes from the dark palette
(`#6FE6DA → #4FD8CB → #05b7aa`). Removal (not recomputation) remains right for the reason
the docblock already gives: this branch only runs when `k_prefs` is absent, so there is no
chosen accent to preserve. The existing cleanup restores all ten on unmount.

**Light is unchanged in kind and slightly more correct:** the gradient now resolves from the
token layer (`#026B64 → #04837A → #05b7aa`, white glyph, 6.38 / **4.63** / 2.51) instead of
the preset literals. 4.63:1 is exactly the `--on-primary on --primary` pair the contrast gate
already blesses at AA. The 2.51:1 tail stop is pre-existing light-mode design, present before
and after, and not introduced here.

---

## 5 · Reported, not fixed

- **GAP D — typed-signature face.** `.sg__preview-ink` is
  `"Brush Script MT", "Segoe Script", cursive` at a literal `32px` — untokenised, off the
  type scale, and **neither face ships on Android or iOS**, the platform this route is
  explicitly built for ("opened from email, overwhelmingly on a phone"). On a phone it falls
  to generic `cursive`, which on Android is not a script face. Worse, it is a **preview of
  something else**: what is submitted is the plain string `typedName`, so the server decides
  the rendered signature. The reference has no typed-signature preview, so there is no face
  to match — picking one is the owner's call, not a fidelity repair.
- **GAP E — canvas backing store ≠ CSS size (peer's lens).** Backing 500×160, CSS
  563.25×160 at 1280. `getPos` scales pointer coordinates correctly so drawing tracks the
  finger, but `toDataURL` ships the 500-wide bitmap — the saved signature is horizontally
  compressed ~11%, and the factor **changes with viewport width**, so the same person's
  signature is a different shape on a phone than on a laptop. On the one artefact that is
  legally binding. Correctness, not styling — flagged for the behaviour peer.
- **GAP F — `--ease-emph` (global).** Build `cubic-bezier(.16,1,.3,1)`; MOTION-SPEC §2 says
  `cubic-bezier(.2,0,0,1)` (M3 emphasised). Affects the whole app, not this file.
- **Signer-count numerals.** `1/2` lacks `font-variant-numeric: tabular-nums` (`18 §90`).

## 6 · NOT VERIFIED

- **Rendered HTML harnesses.** `Kartavaya Redesign.html` was **not** opened. The browser
  pane hit its tab cap and every existing tab's server was live on probe except one, which a
  peer reclaimed mid-run; my own CDP Chrome was pointed at the build. The reference was read
  as JSX (`ScreensMore.jsx`, `ScreensThin.jsx`, `App.jsx`, `MobileModules.jsx`, `Chrome.jsx`)
  plus `MOTION-SPEC.md` and the handover files. The owner has said JSX-only reading misses
  things — **this specific gap stands.** What it would most plausibly change: the visual
  weight of `note note--info` (GAP C) and the audit-trail timeline's exact rhythm (GAP A).
- **Real signing round-trip.** Never exercised — no OTP dispatched, no database write, no
  email. `sign` / `decline` / `otp` were answered by a local mock only.
- **Devanagari on a machine without Nirmala UI.** Tiro resolved from the Google Fonts link;
  the Windows/macOS fallback arms were not exercised.
- **`prefers-contrast` / forced-colors.** Not measured.

## 7 · Gates

```
npm run check   → check-tokens: 356 declared, 244 referenced, 0 missing
                  check-classes: 3545 selectors, 2728 classes, 0 missing a rule
                  check-contrast: no new failures and no regressions
                                  (20 known-failing pairs held at baseline — NOT grown)
npx vitest run  → 47 passed (47) · 720 passed (720)   ← exactly baseline
```

## 8 · Changed

| File | Change |
|---|---|
| `frontend/src/pages/SigningPage.jsx` | strip list 4 → 10 props (dark-mode brand mark, 3.23:1 → 7.93:1); `document_description` on the `sign` step; `sanskrit="हस्ताक्षर"` on both signing cards |
| `frontend/src/styles/public.css` | `.pub__kick [lang]` — `--font-hindi`, weight 400, `text-transform: none` |

No lockfile touched, no line-ending churn, no pricing figures. Brand **Kartavaya**, domain
**kartavaya.com**.
