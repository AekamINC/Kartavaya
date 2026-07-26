# Landing page · Search & command palette · Global motion

Agent branch: `worktree-agent-af9bec7a9ad900774`
Base: `origin/staging` (rebased after the spend-limit stop)
Method: measured in Chromium (Playwright) against a harness built from the real
CSS files on disk, in the app's own load order — not read off the source.

Harness: `scratchpad/build-harness.mjs` copies each real stylesheet verbatim and
links them separately. (One giant inlined `<style>` hit a parse break early and
silently dropped `--ix`; separate `<link>`s isolate that — worth knowing if
anyone else builds one.) Markup is copied verbatim from `Hero.jsx`,
`AuthShell.jsx`, `AutomationsPage.jsx`, `VetanaPage.jsx`, `toast.jsx`.

> **Worktree warning.** This worktree was created from `main`, not `staging`: it
> opened 13 commits into production history with no `design-handover/` and no
> `design-reference/`. `git reset --hard origin/staging` fixed it. Matches
> `_COORDINATION.md` §1.

---

## Headline: `/api/search` was returning 404 — fixed

`backend/routers/search.py` has existed since `2a2a27b`, fully implemented —
RBAC-scoped per entity, Devanagari-aware tsquery, per-group failure isolation,
500 lines. **It was never imported and never registered in `server.py`.**

Measured, not inferred — `server.app.openapi()`:

| | paths | `/api/search` present |
|---|---|---|
| before | 497 | **False** |
| after | 498 | True |

The failure was silent from both ends. `CommandPalette.jsx` treats 404/501 as
"this build has no search", sets the module-scoped `RECORD_SEARCH = 'absent'`
and stops asking for the rest of the session. So the palette quietly degraded
to a nav menu, hid its scope chips, and never reported anything wrong. Server
side there was nothing to see either — no route, no error, no log.

Fixed in `backend/server.py` (import + `include_router`). `search.py` defers its
`from server import get_visible_team_ids` to call time specifically so this
registration is not circular — the file was written expecting to be wired up.

### The `search.py:138` module-gate claim — **STALE, twice over**

A sibling reported that `search.py:138` gates on a module code no
`module_subscriptions` row can match, 403-ing the endpoint the way Sanvaad's did.
Neither half holds.

1. **The spelling is already correct.** `_ENTITY_MODULE` maps
   `clients→graha`, `invoices→ganit`, `messages→sanvaad`.
   `PROPOSED_070_sanvaad_spelling.sql` surveyed the live table and records its
   contents: *dristi, ganit, graha, manav, pahchan, prachar, **sanvaad**, srijan,
   vetana, vikray*. All three codes are in it. The `samvada`→`sanvaad` code half
   shipped in `4a966c6`; `role_tiers.ALL_MODULES:75` now reads `sanvaad`.
2. **Search structurally cannot 403 the way Sanvaad did.** `require_module` is
   not a route dependency here. It is called per-entity inside
   `_module_allowed` (`search.py:244-264`) with `except HTTPException: return
   False` — a refusal skips that group and names it in `unavailable`. The route
   itself depends only on `require_user` and `get_org_id`. A bad module code
   would cost one group, never the request.

The Sanvaad comparison was the right instinct and the right thing to check; the
endpoint was indeed dead, just for an unrelated reason that only showed up by
loading the route table.

---

## 1 · Landing page

### 1.1 The largest phrase on the page — **STALE, already fixed**

`.lhero__h em` — `आपकी भाषा`, 68px, the largest type on the page:

| | measured |
|---|---|
| computed `font-family` | `"Tiro Devanagari Hindi", "Noto Serif Devanagari", …` |
| computed `font-style` | `italic` (Tiro italic **is** loaded — `ital@0;1`) |
| computed `letter-spacing` | `normal` |
| `document.fonts.check('italic 400 200px "Tiro Devanagari Hindi"')` | `true` |

**How bad the original bug was, quantified.** `कर्तव्य` at 200px:

| face | advance width |
|---|---|
| Tiro Devanagari Hindi | **449.60px** |
| Newsreader (the old inherited `--font-display`) | **494.15px** |
| a deliberately absent font (`NoSuchFontXQZ`) | **494.15px** |

Newsreader and the absent font agree **to the pixel** — Newsreader contributes
zero Devanagari glyphs, so before the fix every glyph came from OS fallback.
Same shape for `आपकी भाषा`: Tiro 943.20px vs Newsreader 976.00px.

### 1.2 The conjunct-crushing risk is neutralised globally — **HELD**

`.lhero__h` carries `letter-spacing: -.034em` (measured `-2.312px` at 68px) and
`.au__wm` carries `-.03em` at 288px. Neither reaches the Devanagari:

```css
/* editorial.css:2456 */
[lang="hi"], [lang="sa"], [lang="gu"] { letter-spacing: 0 !important; }
```

The `!important` is load-bearing: `[lang="hi"]` and `.au__wm` are both
specificity (0,1,0) and `auth.css` loads *after* `editorial.css`, so without it
`.au__wm` would win. **Do not remove it.** (Chrome serialises a used value of 0
as `"normal"` — that is the guard landing, not the declaration missing.)

What it saves, on `कर्तव्य` at 288px in Tiro:

| tracking | advance | delta |
|---|---|---|
| `normal` | 647.42px | — |
| `-.03em` (`.au__wm`) | 621.51px | −25.91px (−4.0%) |
| `-.034em` (`.lhero__h`) | 618.05px | −29.37px (−4.5%) |

### 1.3 One measured escape from the guard

The guard is attribute-based, so Devanagari without a `lang` attribute is
unprotected. I probed the real nestings rather than guessing:

| probe | source | `letter-spacing` | font | verdict |
|---|---|---|---|---|
| `.lmod__hi` (`दृष्टि`) | `Modules.jsx:66` | `normal` | Tiro | clean |
| `.k-section__title-hi` | `VetanaPage.jsx:271` | `normal` | Tiro | clean (own `letter-spacing: 0`) |
| `.k-card__sans` | `ApprovalsPage.jsx:222` | `normal` | Tiro | clean |
| `.hi-mute` | `DashboardPage.jsx:228` | `normal` | Tiro | clean |
| `.gr__preview-brand-hi` | `ReportsPage.jsx:626` | `normal` | Tiro | clean |
| **`.k-rule__step-lbl`** | `AutomationsPage.jsx:327,335,342` | **`1.6px`** | **Inter** | **DEFECT** |

**`editorial.css:1951` — two faults in one rule.**

```css
.k-rule__step-lbl { font-family: var(--font-ui), var(--font-hindi); font-size: 10px;
                    letter-spacing: 0.16em; text-transform: uppercase; … }
```

1. `--font-ui` (Inter) is listed **first** and Inter has no Devanagari, so
   `प्रसंग` / `यदि` / `क्रिया` render through per-glyph fallback — measured
   computed first family is `Inter`. Same failure that was fixed on the hero,
   still live on Automations.
2. `letter-spacing: .16em` reaches the Devanagari, against this file's own rule
   500 lines below ("Never track Devanagari").

The Devanagari is a bare text sibling inside the tracked label, so it picks up
both. Fix is `.k-section__title-hi`'s existing pattern: wrap it in a span with
`lang="hi"`, which `editorial.css:2456` then zeroes automatically.

**Not fixed by me on purpose** — `editorial.css` is the most contended file in
this swarm and a one-line edit risked a rebase conflict against the whole
report. Three JSX call sites plus one CSS line for whoever owns it.

### 1.4 Content rules — all **HELD**

- **No pricing figures.** `Pricing.jsx` carries no currency, no credit counts, no
  "from", no per-seat figure — four tier names and one sentence each. The ₹
  amounts in `Hero.jsx:91` / `Features.jsx:63` are sample **invoice** data inside
  the product screenshots — what the product produces, not what it costs. Matches
  `_COORDINATION.md` §9's distinction exactly. Not a violation.
- **SOC 2** appears only in a `Trust.jsx` comment explaining its removal.
- **"Start free"** appears only in a `cta.js` comment explaining why it is unused.
  The primary CTA renders `disabled` with a visible reason, never a dead link.
- **Brand.** Nav and footer take the wordmark from `lib/brand.jsx:62`, which
  spells **Kartavaya**. `index.html` title and `og:title` likewise.
- **Scroll reveals** default to visible; `.js-rev` is added by JS and the observer
  only *removes* the offset (`LandingPage.jsx:40`), with an early return under
  reduced motion. Correct direction — a failed observer leaves a readable page.

### 1.5 Spec defect to record

**`22-landing-page.md` §"Pricing must match the real plan model" violates
standing owner rule 9.** It prints a credits-per-month table (200/500/1,000/
2,000), tells the implementer to publish a list price if one exists, and cites
₹4,999. The build correctly follows the owner over the spec. The handover file is
what is wrong. This is the trap the brief warned about, and the landing page is
where it would have landed.

### 1.6 Dead preconnect — `frontend/index.html:54-55`

```html
<link rel="preconnect" href="https://Kartavaya-production.up.railway.app" crossorigin />
<link rel="dns-prefetch" href="https://Kartavaya-production.up.railway.app" />
```

The real backend is `https://kartavya-production.up.railway.app` — no second
`a` — per `frontend/.env.production:1` and the CSP `connect-src` in
`vercel.json:8`. Case is irrelevant in a hostname; the inserted `a` is not, and
the CSP does not even allow the spelled-out host. Both hints therefore warm a
host the app never contacts, which is their entire purpose.

The brand-spelling correction was applied to an **infrastructure identifier**.
The Railway service is legitimately `kartavya-production`; only the *domain* is
`kartavaya.com`. Left for `index.html`'s owner — flagging rather than editing
because the correct value here is the one that looks misspelled.

---

## 2 · Search and the command palette

### 2.1 One registry — **HELD**

`frontend/src/lib/commands.js` is the only command list. `find` returns exactly
one `CommandPalette.jsx` and one `commands.js`; `Topbar.jsx` has no list left
(no `section:`, `shortcut:` or `keywords:` anywhere in it). The two duplicate
components and Topbar's fifth shape were deleted in `9f43c4a`.

### 2.2 Every command resolves — **HELD, with one destination that lied**

All 31 registry entries with a destination check out against `App.jsx`'s 51
declared routes (script: `scratchpad/check-commands.mjs`). No entry falls through
to the `*` catch-all.

Query-param intents, which is where "resolves" and "actually works" diverge:

| entry | honoured? |
|---|---|
| `/projects?new=1` | yes — `ProjectsPage` reads it |
| `/settings/customize?tab=notifications` | yes |
| **`/hub/org?tab=scrapers`** | **no — fixed** |

`OrgSrijanPage.jsx` did `useState('skills')` and never read the query string, so
the Data Tools deep link landed on Srijan's Skills tab. That is precisely the
defect `20-search-palette.md` §3 describes and that `commands.js:75-78` claims to
have fixed — the comment was accurate about the intent and wrong about the
result. There is also **no tab named `scrapers`**: the feature is the `data
catalog` tab, so even a naive param read would have missed.

Fixed with an alias map (`scrapers` → `data catalog`) plus URL sync on click,
using the same idiom as `CustomizeSettingsPage.jsx:50`.

### 2.3 Search proves itself before advertising — **HELD**

The tri-state (`unknown` / `live` / `absent`) is intact and is what made the 404
above survivable instead of a crash or a lie. Kept, and its header comment
corrected — it still claimed the endpoint did not exist.

### 2.4 Ranking — **HELD**

`lib/fuzzyMatch.js` implements `20` §1 exactly: label prefix (90) > `hi` prefix
(88) > label substring, word-boundary-aware (75/60) > `hi` substring (55) >
keyword substring (40) > subsequence **over the label only** (10). A subsequence
hit can never outrank a substring hit, and the subsequence test no longer runs
over the 40-char keyword blob, which was the original "type `ate`, match
everything" bug.

### 2.5 Known duplication, deliberately contained

`editorial.css:3324-3400` still defines a full `.k-cmdk*` block alongside
`palette.css`. This is **known and handled**: `palette.css` scopes every rule
under `[data-k-palette]` (0,2,0 vs 0,1,0) and `KeyboardShortcuts.jsx:7` states
the reason outright — "so those rules outrank the legacy block in
`editorial.css`". Reported as debt, not touched; deleting 60 lines from
`editorial.css` is a conflict waiting to happen.

### 2.6 Divergence between the two specs, for the record

`20` §Styling and `MOTION-SPEC.md` §3 disagree about the palette's own motion:
`20` says `translateY(-10px) scale(.985)`, §3 says `translateY(-6px) scale(.97)`
plus a 4px scrim blur and a 160ms exit. The build follows `20` — defensible,
it is the surface-specific spec — but the palette has **no exit animation at
all**, which both specs imply. Left alone: it is a spec conflict, not a bug, and
picking a winner is the owner's call.

---

## 3 · Global motion system

### 3.1 The 118-durations claim — **STALE**

Current state: **107** time values inside `transition`/`animation` across 26
stylesheets; **30** are not `--ix`-scaled. Of those 30, the large majority are
correct by design:

- **infinite loops** (spinners, shimmers, pulses) — `calc(… * var(--ix))` is
  *wrong* for these, since at `--ix: .001` a 2s loop becomes a 2ms strobe. They
  keep fixed durations and are stopped outright under reduce.
- **`auShake 420ms cubic-bezier(.36,.07,.19,.97)`** (`auth.css:342`) is an
  **exact** `MOTION-SPEC.md` §4 match, literal on purpose.

The genuine remainder — literals that could be tokens — is listed in §3.4.

### 3.2 The reduced-motion strobe — **fixed, and I adopted the mechanism**

Verified against `_COORDINATION.md` §6's measurement (2.000ms / 1.5ms / 0.8ms).
Zero infinite animations are `--ix`-scaled now:

| former strobe | now |
|---|---|
| `.k-skeleton::after` `calc(2s * --ix)` | `1.7s` fixed, `animation: none` at `editorial.css:1748` |
| `.k-shimmer__tile` `calc(1.5s * --ix)` | `1.7s` fixed, stopped at `editorial.css:2768` |
| `.snd__w i` `calc(.8s * --ix)` | `.8s` fixed, stopped at `settings.css:203` |

Both shimmers converged on `1.7s`, which is `MOTION-SPEC.md` §4's
skeleton-shimmer value. The `.animate-pulse` / `.skeleton::after` gap I had found
earlier is also closed (`animations.css:360-361`).

The structural token fix landed too: `--motion-scale-user` now exists as the
writable twin of `--motion-scale`, so `a11y.css`'s `!important` containment could
be retired. **I did not fight any of this** — no changes to the reduced-motion
mechanism, and per `_COORDINATION.md` §7 I did **not** correct the build toward
`16-animations.md:44`, which mandates the strobe.

### 3.3 Fidelity gaps against reference `motion.css` — audited pair by pair

Every row measured in Chromium after the change.

| element | reference | build before | now |
|---|---|---|---|
| Drawer in/out | `--dur-slow --ease-emph` / `--dur-base --ease-exit` | same | **matched already** |
| Tooltip | `dmTip --dur-fast --ease-enter` | same | **matched already** |
| **Modal scrim** | `--dur-fast` | `calc(var(--dur-fast) * var(--ix))` | **fixed** → 0.14s |
| **Modal panel** | `--dur-base --ease-emph`, delay `--dur-fast*.3` | *no animation at all* | **fixed** → 0.22s, delay 0.042s |
| **Toast** | `translateX(16px)`, `--dur-base --ease-emph` | `dmPop` (scale), `--ease-enter` | **fixed** → slide, 0.22s, emph |
| **Popover in** | `--dur-fast --ease-spring` | `--dur-base --ease-enter` | **fixed** → 0.14s, spring |
| **Popover out** | `calc(--dur-fast * .85)` = 119ms | `--dur-fast` = 140ms | **fixed** |
| **Bottom sheet** | `calc(--dur-slow * .84)` = 302ms | `--dur-slow` = 360ms | **fixed** → 0.3024s |
| **Picker mobile sheet** | `--ease-emph-in` | `--ease-enter` | **fixed** |

Two findings worth calling out beyond "wrong number":

- **The modal scrim was double-scaled.** `calc(var(--dur-fast) * var(--ix))`,
  where `--dur-fast` is *already* `calc(140ms * var(--ix))` — so `140ms · ix²`.
  Measured across the scale:

  | `--ix-user` | shipped | fixed |
  |---|---|---|
  | 1 | 0.14s | 0.14s |
  | .5 (Customization "Reduced") | **0.035s** | 0.07s |
  | .001 (OS reduce) | 1.4e-07s | 0.00014s |

  Only the `--ix: 1` case was ever right, which is why nobody saw it. It was the
  **only** such site in `src/styles` — I scanned for the pattern.

- **The popover exit outlived its own unmount.** `.pk__pop.is-closing` ran 140ms
  against a documented 130ms unmount, so the exit keyframe was cut 10ms early.
  The reference's 119ms fits inside it.

Also fixed: `.k-toasts` carried a literal `z-index: 9999`, which paints over the
command palette (620) and the dialog that triggered it (420/421) — the exact
failure `animations.css` §1's ladder exists to prevent, and which its own comment
names. Now `var(--z-toast)`, measured 520.

The toast slide also had to improve on the reference rather than copy it: the
reference assumes one fixed corner, this build offers four
(`settings.css [data-toast-pos]`). Travel now follows the edge the stack sits on
— measured `tr → tstIn`, `tl`/`bl` → `tstInL`, and under 560px all positions →
`tstInM`, the reference's `translateY(12px)` mobile variant.

### 3.4 Remaining gaps — reported, not fixed

Off the token ladder but correctly `--ix`-scaled, so reduced-motion is safe;
these are consistency debt, nearly all in `editorial.css`:

| site | literal |
|---|---|
| `editorial.css:2142, 2305` | `calc(.15s * --ix) ease-out` |
| `editorial.css:2152` | `calc(.2s * --ix) cubic-bezier(.2,.7,.3,1)` |
| `editorial.css:2319` | `calc(.22s * --ix) cubic-bezier(.2,.7,.3,1)` — `.22s` *is* `--dur-base` |
| `editorial.css:2413` | `calc(.18s * --ix) cubic-bezier(.2,.7,.3,1)` |
| `editorial.css:3079, 3151` | `calc(.25s * --ix) cubic-bezier(.25,.8,.25,1)` |
| `editorial.css:3081, 3153` | `calc(.2s * --ix) ease-in` |
| `editorial.css:3328` | `calc(120ms * --ix) ease-out` |
| `editorial.css:3343, 3397` | `calc(150ms * --ix) ease-out` |
| `editorial.css:956, 1621, 2058, 3108`; `kartavaya-design.css:834, 1007` | progress-bar `width` transitions, `.4s`–`.6s`, `cubic-bezier(.25,.8,.25,1)` |
| `brand.css:77, 92, 125, 151` | `0.18s` / `0.4s`, **not `--ix`-scaled at all** |
| `generate-report.css` (8 sites) | `.12s` / `.15s`, **not `--ix`-scaled at all** |

`brand.css` and `generate-report.css` are the two files that genuinely escape the
motion scale. Neither is animation-critical (hover and colour transitions), which
is why they are debt rather than defects — but they are the honest answer to "are
there durations invisible to the reduced-motion scale": **yes, 13 of them**, all
in those two files.

### 3.5 `--ease-emph` diverges from the reference — deliberate, flagged not changed

| source | value |
|---|---|
| reference `tokens.css:47` | `cubic-bezier(.2, 0, 0, 1)` |
| `MOTION-SPEC.md` §2 | `cubic-bezier(.2, 0, 0, 1)` (identical to `--ease-standard`) |
| build `kartavaya-design.css:112` | `cubic-bezier(.16, 1, .3, 1)` — *"expo-out, genuinely distinct"* |

This is the **default** easing, so it is the single highest-leverage divergence
in the system — drawer, modal, toast, palette and sheet transitions all ride it.
The build's reasoning is sound (the reference makes `--ease-emph` and
`--ease-standard` byte-identical, which makes one of them pointless) and it is a
deliberate, commented decision, not drift.

**Left alone deliberately.** Changing the default curve is a look-and-feel
decision across the whole app, it is not a bug, and the owner's "match the
reference" instruction and the build's own documented rationale point opposite
ways. This one needs the owner, not an agent.

---

## SigningPage brand check

`frontend/src/pages/SigningPage.jsx` still spells the brand **Kartavya** at
line 151 (`<h1 …>Kartavya</h1>`) and line 312 (`Powered by Kartavya · Aekam Inc`).
**Reported, not edited** — another agent is converting this file. It also
hardcodes `#0082c6` rather than a token and does not use `KWordmark` from
`lib/brand.jsx`, which is why it drifted.

---

## Claims checked

| claim | verdict |
|---|---|
| Landing page's largest phrase is in the wrong script | **STALE** — fixed; measured Tiro |
| `.au__wm`-style negative tracking crushes `र्त` / `व्य` | **STALE as a live defect** — `editorial.css:2456` neutralises it globally; quantified what it saves |
| `search.py:138` gates on an unmatchable module code, 403-ing search | **STALE** — spelling correct since `4a966c6`, and the gate is per-entity so it cannot 403 the route |
| Search is silently dead like Sanvaad | **HELD, different cause** — the router was never registered; 404 |
| One command registry, no duplicates | **HELD** |
| Every command resolves | **HELD** (31/31); one destination silently ignored its param — fixed |
| Search wired to a real backend, not a local array | **HELD** — `GET /api/search`, 180ms debounce, abort signal; now actually reachable |
| Search proves itself before advertising results | **HELD** |
| `20`:170 says `SigningPage` is in no handover file | **KNOWN ERROR** — it is at `13-module-pages.md` §191, already recorded in `_SOURCE-MAP.md` |
| 118 durations invisible to the reduced-motion scale | **STALE** — 30 unscaled, of which 13 are genuine (`brand.css`, `generate-report.css`); the rest are correct-by-design infinite loops and one exact spec match |
| Reduced-motion strobe | **FIXED by the dark-tokens agent** — verified zero `--ix`-scaled infinite animations; adopted, not fought |
| `SigningPage.jsx` spells Kartavaya | **FAILS** — still "Kartavya", left for the agent converting it |

## What I did not finish

- The `.k-rule__step-lbl` fix (§1.3) — deliberately left to `editorial.css`'s owner.
- The `index.html` preconnect hostname (§1.6) — flagged; the correct value is the
  one that looks misspelled, so it wants a second pair of eyes.
- The `--ease-emph` question (§3.5) — needs the owner.
- The token-ladder cleanup in §3.4 — mechanical, ~20 sites, mostly `editorial.css`.
- No test covers `/api/search`; `backend/tests/` has no search file. The
  registration bug would have been caught by one assertion on the route table.
