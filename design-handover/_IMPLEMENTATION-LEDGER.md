# Implementation ledger

**Not part of the numbered handover set.** Claude Design owns `00`–`25` and `README.md`. This file is mine — what I found, what I decided provisionally, what must be re-checked. Claude Design never sees it and should not be asked to reconcile against it.

Last updated: 2026-07-25

---

## 1 · File status on disk

| Files | State |
|---|---|
| `00`–`24`, `README.md` | **All 25 present.** `00` is canonical |
| `14`, `17` | Claude Design's real reissues, **forward-patched by me** to `00` §7's darkened values — they shipped quoting `#16803F`/`#A66207`/`#74786F` while declaring `00` authoritative |
| `06` | Bundle version restored — it carried a section heading the earlier copy had lost |
| `25-qa-acceptance.md` | Parked by agreement — written after implementation starts |

Reference material is in **`design-reference/`** (4.9 MB): nine HTML prototypes, the six specs, the real stylesheets (`tokens.css`, `app.css`, `motion.css`, per-surface CSS), 16 `guidelines/` token pages, `docs/` with `doc-page.js` and `brand.css`, the mark asset, and the mobile prototype. `design-handover/` stays the spec; `design-reference/` is what it quotes.

**`design-reference/Kartavaya Redesign/docs/doc-page.js` is the vendored web component** `18-documents.md` requires. Copy to `public/doc-page.js` — do not fork.

---

## 2 · What the corrected `00` fixed — verified independently

Recomputed every darkened value rather than taking the file's word. All confirmed against `--bg` `#F3EFE6` (L = 0.8650), WCAG 2.x sRGB:

| Token | New | on `--bg` | Was |
|---|---|---|---|
| `--on-surface-3` | `#666A61` | 4.82:1 | `#74786F`, 3.9:1 — failed |
| `--warn` | `#955806` | 4.98:1 | `#A66207`, 4.19:1 — failed |
| `--ok` | `#14743A` | 5.10:1 | `#16803F`, 4.36:1 — failed |
| `--st-in-progress` | `#3E5C8A` | 5.90:1 | — |
| `--st-todo` | `#5A6270` | 5.36:1 | — |
| `--st-in-review` | `#6E5AA0` | 5.04:1 | — |

Also verified fixed: `--shadow-4` in both palettes; `--radius-base` 12 → 10 (now a selectable option); type scale `calc()`-derived with `max()` floors; `--ix-user`/`--ix` split so the OS reduced-motion media query wins; `--ease-emph` now a genuine expo-out distinct from `--ease-standard`; `--tick-read` `#4FC3F7`; `#0082c6` gone from all three tokens; status colours flip with theme and three alias `--ok`/`--warn`/`--danger`; `--primary-hover` reverses direction by theme with `applyPrefs` re-running on theme change.

`--font-indic` vs `--font-hindi` corrected across nine files, with the watermark exception (`05`, `12`) documented in `24` — fixed decorative glyphs stay Devanagari and must not follow the language setting. That distinction is right.

**Aliasing is why the fix propagated.** Because `--st-done`, `--st-requested`, `--st-rejected`, the `--ap-*` set and `--pr-*` reference the semantic tokens rather than restating hexes, darkening three values corrected every status chip. Preserve that on implementation — do not re-expand any alias to a literal.

---

## 3 · Open defects in the delivered files

### 3.1 · `--on-surface-faint` is declared non-text and used as text in seven places

`00` §12 and `23` both mark `#9DA096` (2.3:1 on `--bg`) **non-text only**. Component CSS in the same batch uses it for text:

| File | Rule | What it colours |
|---|---|---|
| `02:65` | `.inp::placeholder` | **placeholder text** — often carries format hints (`27AAAPA1234A1Z5`, `DD/MM/YYYY`) |
| `03:78` | `.dr__id` | task ID, 11px mono — read aloud on calls |
| `03:80` | `.dr__lbl-hi` | Hindi sub-label on drawer fields, 12px |
| `03:114` | `.dr__st-as--none` | the unassigned state |
| `05:164` | `.trow__id` | task ID in the row, 10.5px |
| `13:72` | `.mt__n` | count beside module tabs |
| `20:128` | `.k-cmdk__section` | palette section headers |

Only `01:91` `.crumb__sep` is genuinely decorative. **Resolution at implementation: everything above moves to `--on-surface-3` (4.8:1).** Placeholder is the most serious — a form hint at 2.3:1 is unreadable for the audience the product is sold to.

### 3.2 · Hardcoded sub-11px literals defeat both the floor and the slider

`00` §2 added `max(11.5px, …)` / `max(11px, …)` floors to enforce §12 "mechanically". Ten component rules bypass the tokens with literals below the floor: `01:55` `.side__hi` 10px, `01:57` `.side__badge` 10px, `01:95` `.kbd` 10.5px, `02:97` `.tag` 10.5px, `03:79` `.dr__lbl` 10px, `05:99` `.hero__date` 10.5px, `05:164` 10.5px, `07:122` `.preg th` 10px, `13:72` 10.5px, `24:114` `.bi__in` 10px.

Two consequences, and the second is worse:

1. The floor enforces nothing — a mechanism only applies to what uses it.
2. **These do not scale with the Text size slider**, which is the entire point of the `calc()` rework. A user on base 20px gets a 20px nav label above a 10px Devanagari sub-label.

`24` argues 10px for `.bi__in` deliberately, with 11px named as the fallback. That argument holds for the *ratio* but not for the *literal* — use `calc(var(--font-size-base) * .71)` with a `max(10px, …)` floor so it tracks the slider.

### 3.3 · Stale comments in `00` §9

```css
--st-requested: var(--warn);   /* #A66207 */   ← superseded, now #955806
--st-done:      var(--ok);     /* #16803F */   ← superseded, now #14743A
```

The aliases are correct; the comments document values §7 replaced in the same file. Cosmetic, but it will mislead whoever reads §9 without §7.

---

## 3.4 · `23-accessibility.md` is partly misdiagnosed — verified against the source

Two of the five "fix before building anything" defects in `CLAUDE-CODE-START-HERE.md` do not match `frontend/src`:

**"`ConfirmDialog` sets `aria-modal` with no `role`" — false.** The file has `role="alertdialog"` on the line directly above the two it quotes. The recommended fix was already applied at some point. What *was* real: `cd-title`/`cd-msg` were hardcoded ids.

**"Nothing traps focus anywhere" — partly false.** The grep for `focusTrap`/`focusLock` returns zero, and that is true, but it searched identifier names rather than behaviour. `ConfirmDialog` had a working hand-rolled trap in its `handleKeyDown`. `modal.jsx` genuinely had none, and neither did the drawer, palette or sheets.

**A real defect the file missed:** `ConfirmDialog`'s focus restore was broken. One effect focused the Cancel button; the next captured `document.activeElement` to restore later. React runs effects in declaration order, so it captured the Cancel button — and on close restored focus to a node that had just unmounted, dropping the user at `<body>`. This is precisely the failure `23` warns about in prose while its own diff leaves it in place. Fixed by moving restore into `FocusTrap`, which captures before moving focus inward.

Lesson for the rest of the implementation: **the handover's defect claims are line-quotes, not behavioural checks.** Verify each against the file before acting on it.

---

## 4 · Open decisions

1. **Landing page bilingual hierarchy.** `22` inverts it — Hindi leads in the module grid. The user ruled "English main, Hindi sub" globally. **User's call.**
2. **Vikray (Sales · विक्रय) scope.** Page, route and palette entry; covered by no file. Plus nine more in `20` §Unreported.
3. **`lib/labels.js` Sanskrit column.** `24`: do not machine-fill. Blocked on content from the user.
4. **Face matching provider** — on-device vs cloud (`17`). Changes first-run consent copy.
5. **GST split.** Single `gst` column cannot represent intra-state CGST+SGST (`11`, `18`). Schema change.

### Decided 2026-07-25

**Language → option (a).** Drop हिन्दी and ગુજરાતી as standalone interface languages. Keep all four bilingual options — EN · EN+SA · EN+HI · EN+GU. Gujarati is **not** removed: EN+GU stays, so the `gu` column and the `--font-indic` runtime switch are both still required. A stored `hi`/`gu` in `localStorage` must fall through to `en+hi`, not render the raw key.

**CTA → invite-only.** No signup route, no `POST /auth/signup`, no email verification, no trial limits. `22`'s CTA becomes Request a demo / Talk to us, needing a lead-capture endpoint landing in Graha. Onboarding wizard still required for invited users. SOC 2 badge must not ship.

**Pricing → no free tier.** `free` becomes `basic`, charged manually per client by user count.

---

## 5 · Billing schema, verified against the live database

Read-only queries, 2026-07-25, project `toacecaewujfxjfrjwco` (`ap-southeast-1`).

**Staging and production are separate *schemas* in one project** — `staging` (178 tables) holds all billing; `public` (41 tables) has no plan, price or credit column. Narrower than "one schema for both", but still one database.

**Blast radius of the plan rename: 2 organisations, 2 subscriptions, both already carrying a `monthly_price` override.** Safe. Do it as a migration anyway.

`staging.plans` holds **seven rows in two generations**:

| Gen | Code | ₹/mo | `default_credits` | `is_active` |
|---|---|---|---|---|
| 1 (04 Jul) | `free` | 0 | 200 | **true** |
| 1 | `professional` | 99 | 500 | false |
| 1 | `business` | 149 | 1000 | false |
| 1 | `enterprise` | 249 | 2000 | false |
| 2 (08 Jul) | `starter` | 10,000 | 500 | true |
| 2 | `growth` | 15,000 | 1000 | true |
| 2 | `scale` | 20,000 | 2000 | true |

`price_monthly` carries **two incompatible unit conventions in one column** — gen-1 is 99–249, gen-2 is 10,000–20,000. Anything reading the catalogue without filtering `is_active` mixes them.

**Defect no handover file caught — three different credit numbers per tier:**

| Tier | `plans.default_credits` | `plans.features.srijan_credits_monthly` | `hub_tiers.credits_monthly` |
|---|---|---|---|
| Starter | 500 | 500 | **1000** |
| Growth | 1000 | **1500** | **1500** |
| Scale / Pro | 2000 | **5000** | 2000 |

`staging.hub_tiers` is a second parallel catalogue (`starter`/`growth`/`pro`) at the same prices with different credits and a different feature shape. Resolve before any pricing surface renders a number.

**Correction to `11-platform-admin.md`:** it states no Professional plan exists. It does — `code: 'professional'`, `is_active: false`. The "Upgrade to Professional or higher" string points at a *retired* plan, not a missing one.

**Schema gap for the chosen model.** Per-user charging has nowhere to live: `max_users` is null on every plan except `free` (5), and there is no `price_per_user_monthly` on `plans` — only on `add_on_modules`. Currently expressible only as a manual figure in `organisations.monthly_price`.

---

## 6 · Palette properties that will cause regressions

1. **The themes are opposite temperatures.** Light is warm (R > G > B), dark is cool (B > G > R). A tint sampled from light cannot be reused in dark — wrong hue, not just wrong luminance. Cross-fade surfaces; never animate a colour between themes.
2. **`--primary-container` inverts.** Light container is lighter than primary; dark container is darker. Filled chips, selected pills and progress tracks break in exactly one theme.
3. **`--primary-hover` also inverts**, and `applyPrefs` must re-run on theme change or the accent keeps the previous theme's hover direction.
4. **`--side-ink` is not one value** — `#161A18` light, `#080A0D` dark. The sidebar/canvas gap nearly vanishes in dark, so `--side-rule` becomes the only separation.
5. **`color-mix` percentages are not theme-portable.** 8% on cream reads; 8% on `#0C0E11` does not. Meaningful tints need ~2× in dark.
6. **No `calc()` in React Native.** Radius and duration scales must be JS functions recomputed on preference change, or those two preferences work on web and silently not in the app.

---

## 6a · How `00-tokens.md` was actually implemented

Shipped. Two deviations from the handover, both deliberate.

**1 · The handover names the wrong file — partly.** `00` says to rewrite
`styles/kartavaya-design.css` and never mentions `lib/tokens.css`. Both define
tokens: `lib/tokens.css` has 97 vars and loads *first* via the `styles/index.css`
barrel; `kartavaya-design.css` has the 35 that the app actually consumes
(`--ink`, `--rule`, `--k-primary`). `kartavaya-design.css` was the right target;
`lib/tokens.css` is a near-dead older vocabulary (`--accent-default`: 2 uses)
that still supplies the font `@import`s, so it stays.

**2 · No wholesale replacement — an alias layer instead.** `00` says "replace
the token block wholesale". Measured first: the legacy names have **~2,957
references** (`--ink-3` alone 907, `--rule-soft` 475, `--k-primary` 380) and the
new names had **zero**. A wholesale swap breaks every screen in one commit.

So the new system is the source of truth and every legacy name is aliased onto
it at the bottom of the token block:

```css
--ink: var(--on-surface);  --ink-3: var(--on-surface-3);
--rule: var(--outline-variant);  --bg-soft: var(--s-low);  …
```

Nothing broke, new work uses the new names, and files 01–24 migrate consumers
as they restyle each surface. **Delete a line from the alias block when its
last reference goes.** Same treatment for `dark-theme.css`: emptied rather than
deleted (`00` says delete) because ~48 references were live and it also owned
scrollbar and selection styling.

**The critical fix was in `applyPrefs`, not the CSS.** It wrote `--bg`,
`--ink`, `--rule` as *inline styles on the root element*, which outrank any
stylesheet — the new palette would never have rendered. That block is gone;
CSS owns colour under `[data-theme]`.

Other `applyPrefs` corrections: `data-theme` now resolves `system` to
light/dark (it wrote `"system"` through, matching no rule, so system mode
silently rendered light); `--ix-user` replaces `--ix`; `--primary` receives the
accent and reverses hover direction by theme; the `SANS_IDS` branch whose two
arms were identical is deleted. `system` is now a live `matchMedia`
subscription. A blocking script in `index.html` sets `data-theme` before first
paint, so dark-mode users no longer get a white flash.

Verified in-browser: legacy aliases resolve to new values, dark flips
correctly, `--st-done` follows `--ok` across themes (so the contrast fix reaches
every status chip for free), the Text size slider now moves the whole scale
(20.02px → 28.6px → 17.16px at base 14/20/12), and `--t-label-sm` clamps to
exactly 11px at base 12 where unclamped it would be 9.48px.

**Not verified:** that the `prefers-reduced-motion` media query beats an inline
`--ix-user`. The mechanism is right, but the test machine has the OS setting
off. Confirm on a machine with reduce-motion enabled.

§3.1 and §3.2 below are **not yet applied** — both are component-level, not
token-level, and belong with the files that restyle those components.

---

## 7 · Sequencing

1. ~~`23-accessibility.md`~~ — done.
2. ~~`00-tokens.md`~~ — done; see §6a. §3.1/§3.2 still outstanding at component level.
3. Split the three module monoliths (Graha 150 KB, Manav 133 KB, Ganit 125 KB) **before** restyling — per `13`.
4. `lib/statusColors.js` — now trivial, since `02` aliases `var(--st-*)`.
5. The two ship-blockers: `addToast` and message scrollback (`06`).
6. `01` navigation → `02` components → the rest.

**Never hide a nav by breakpoint without shipping its replacement in the same commit.** Broken three times already (`.side`, `.adm__side`, `.ob--m`).

---

## 8 · Standing constraints (not from the handover)

- Staging and production share one Supabase project. Warn before any write-path change.
- Pahchan selfies are biometric-adjacent: private bucket, short-lived signed URLs, stated retention.
- Margin and cost data must never serialize outside `[data-surface='platform']` — enforced server-side, not by CSS.
- Support access and impersonation are never silent: audit log, email to owner, visible violet banner.
- Domain is **kartavaya.com**.
