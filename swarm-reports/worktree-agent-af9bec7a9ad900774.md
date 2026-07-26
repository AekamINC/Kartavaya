# Landing page · Search & command palette · Global motion

Agent branch: `worktree-agent-af9bec7a9ad900774`
Base: `origin/staging` @ 666b0ea
Method: measured in Chromium (Playwright) against a harness built from the real
CSS files on disk, in the app's own load order — not read off the source.

> **Worktree warning for the swarm.** This worktree was created from `main`, not
> `staging`: it opened 13 commits into production history with no
> `design-handover/` and no `design-reference/` at all. `git reset --hard
> origin/staging` fixes it. Any agent that reports "the spec files do not exist"
> has this problem, not a missing spec.

Harness: `scratchpad/build-harness.mjs` copies each real stylesheet verbatim and
links them separately (one giant inlined `<style>` hit a parse break early and
silently dropped `--ix`; separate `<link>`s isolate that). Markup is copied
verbatim from `Hero.jsx`, `AuthShell.jsx`, `AutomationsPage.jsx`, `VetanaPage.jsx`.

---

## 1 · Landing page

### 1.1 The largest phrase on the page — **STALE, the defect is fixed**

The prior claim was that the biggest phrase rendered in the wrong script. It is
now correct, and I measured it rather than reading the rule.

`.lhero__h em` — `आपकी भाषा`, 68px, the largest type on the page:

| | measured |
|---|---|
| computed `font-family` | `"Tiro Devanagari Hindi", "Noto Serif Devanagari", "Nirmala UI", "Kohinoor Devanagari", serif` |
| computed `font-style` | `italic` (Tiro italic **is** loaded — `index.html` requests `Tiro+Devanagari+Hindi:ital@0;1`) |
| computed `letter-spacing` | `normal` |
| `document.fonts.check('italic 400 200px "Tiro Devanagari Hindi"')` | `true` |

**How bad the original bug was, quantified.** Rendering `कर्तव्य` at 200px:

| face | advance width |
|---|---|
| Tiro Devanagari Hindi | **449.60px** |
| Newsreader (the old inherited `--font-display`) | **494.15px** |
| a deliberately absent font (`NoSuchFontXQZ`) | **494.15px** |

Newsreader and the absent font agree **to the pixel**. Newsreader contributes
zero Devanagari glyphs, so before the fix every glyph came from OS fallback —
the phrase was assembled from whatever the machine happened to have. Same shape
for `आपकी भाषा`: Tiro 943.20px vs Newsreader 976.00px.

Screenshot confirms: Devanagari renders in Tiro italic, teal (`--primary-text`,
`rgb(4,107,100)`), optically matched to the Latin line above it.

### 1.2 The conjunct-crushing risk is neutralised globally — **HELD**

`.lhero__h` carries `letter-spacing: -.034em` (measured `-2.312px` at 68px) and
`.au__wm` carries `-.03em` at 288px. Neither reaches the Devanagari, because of

```css
/* editorial.css:2456 */
[lang="hi"], [lang="sa"], [lang="gu"] { letter-spacing: 0 !important; }
```

The `!important` is load-bearing: `[lang="hi"]` and `.au__wm` are both
specificity (0,1,0), and `auth.css` loads *after* `editorial.css`, so without it
`.au__wm` would win. **Do not remove that `!important`.**

Measured on `.au__wm` (`lang="hi"`, 288px): computed `letter-spacing: normal`.
(Chrome serialises a used value of 0 as `"normal"` — that is the guard landing,
not the declaration being absent.)

How much it was saving, measured on `कर्तव्य` at 288px in Tiro:

| tracking | advance | delta |
|---|---|---|
| `normal` | 647.42px | — |
| `-.03em` (`.au__wm`) | 621.51px | −25.91px (−4.0%) |
| `-.034em` (`.lhero__h`) | 618.05px | −29.37px (−4.5%) |

~26px pulled out of four grapheme clusters ≈ 8.6px per gap at display size.

### 1.3 The guard only reaches elements that carry `lang` — one measured escape

The guard is attribute-based, so any Devanagari without a `lang` attribute is
unprotected. 645 Devanagari-bearing code lines exist in `frontend/src`; 39 carry
`lang`. Most of the remainder are data tables (`hi:` fields in `notifSound.js`
etc.) whose *render site* adds `lang`, so they are fine. I probed the real
nestings in the browser rather than guessing:

| probe | source | measured `letter-spacing` | measured font | verdict |
|---|---|---|---|---|
| `.lmod__hi` (`दृष्टि`) | `Modules.jsx:66` | `normal` | Tiro | clean — has `lang="hi"` |
| `.k-section__title-hi` (`वेतन ढाँचा`) | `VetanaPage.jsx:271` | `normal` | Tiro | clean — own `letter-spacing: 0` at `editorial.css:2544` |
| `.k-card__sans` | `ApprovalsPage.jsx:222` | `normal` | Tiro | clean |
| `.hi-mute` | `DashboardPage.jsx:228` | `normal` | Tiro | clean |
| `.gr__preview-brand-hi` | `ReportsPage.jsx:626` | `normal` | Tiro | clean |
| **`.k-rule__step-lbl`** (`WHEN · प्रसंग`) | `AutomationsPage.jsx:327,335,342` | **`1.6px` (+.16em)** | **Inter** | **DEFECT** |

**`.k-rule__step-lbl` — `editorial.css:1951` — two faults in one rule.**

```css
.k-rule__step-lbl { font-family: var(--font-ui), var(--font-hindi); font-size: 10px;
                    letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700; … }
```

1. `--font-ui` (Inter) is listed **first** and Inter has no Devanagari, so
   `प्रसंग` / `यदि` / `क्रिया` resolve through per-glyph fallback — measured
   computed first family is `Inter`. This is the same failure that was just fixed
   on the hero, still live on the Automations page.
2. `letter-spacing: .16em` applies to the Devanagari, directly against this
   file's own rule 500 lines below it ("Never track Devanagari").

The Devanagari there is a bare text sibling inside the tracked label, so it
picks up both. The fix other places already use is `.k-section__title-hi`'s
pattern: wrap the Devanagari in its own span with `lang="hi"`, which the
`editorial.css:2456` guard then zeroes automatically.

**Not fixed by me on purpose.** `editorial.css` is the most contended file in
this swarm (164KB, at least the tokens and dark-tokens agents are in it). A
one-line edit there risks a rebase conflict that would cost this whole report.
Three JSX call sites in `AutomationsPage.jsx` plus one CSS line — cheap for
whoever owns `editorial.css`.

### 1.4 Content rules — all **HELD**

- **No pricing figures.** `Pricing.jsx` carries no currency, no credit counts, no
  "from", no per-seat figure — four tier *names* and one sentence each. The ₹
  amounts in `Hero.jsx:91` and `Features.jsx:63` are sample **invoice** data
  inside the product screenshots (`₹1,24,500`, `CGST 9%`), i.e. what the product
  produces, not what it costs. Not a violation.
- **SOC 2** appears only in a `Trust.jsx` comment explaining its removal.
- **"Start free"** appears only in a `cta.js` comment explaining why it is not
  used. The primary CTA renders as a `disabled` button with a visible reason,
  never as a dead link to `/login`.
- **Brand.** Nav and footer take the wordmark from `lib/brand.jsx`, which spells
  **Kartavaya** (`brand.jsx:62`). `index.html` title and `og:title` spell it
  correctly too.
- **Scroll reveals** default to visible; `.js-rev` is added by JS and the
  observer only *removes* the offset (`LandingPage.jsx:40`), and the effect
  returns early under `prefers-reduced-motion`. This is the correct direction —
  a failed observer leaves a readable page, not a blank one.

### 1.5 Spec defect to record (do not "fix" the code)

**`22-landing-page.md` §"Pricing must match the real plan model" violates
standing owner rule 7.** It prints a credits-per-month table (200 / 500 / 1,000 /
2,000), tells the implementer to "publish it" if a list price exists, and cites
₹4,999. The owner's standing rule is *no pricing figures anywhere*. The build
correctly follows the owner over the spec, and `Pricing.jsx` documents why. The
handover file is the thing that is wrong. This is the exact trap the brief warned
about — the landing page is where it gets violated.

### 1.6 Dead preconnect — `frontend/index.html:54-55`

```html
<link rel="preconnect" href="https://Kartavaya-production.up.railway.app" crossorigin />
<link rel="dns-prefetch" href="https://Kartavaya-production.up.railway.app" />
```

The real backend is `https://kartavya-production.up.railway.app` — no second
`a` — per `frontend/.env.production:1` and the CSP `connect-src` in
`vercel.json:8`. Case is irrelevant in a hostname; the inserted `a` is not. The
CSP does not even allow the spelled-out host, so the app can never connect to
it. The preconnect and dns-prefetch therefore warm a host that is never used,
which is the whole point of having them.

This looks like the brand-spelling correction being applied to an
**infrastructure identifier**. The Railway service is legitimately named
`kartavya-production`; only the *domain* is `kartavaya.com`.

---

## 2 · Search and the command palette

Pending.

## 3 · Global motion system

Pending.

## SigningPage brand check

`frontend/src/pages/SigningPage.jsx` still spells the brand **Kartavya** at
line 151 (`<h1 …>Kartavya</h1>`) and line 312 (`Powered by Kartavya · Aekam Inc`).
Reported, **not edited** — the brief says another agent is converting this file.
It also hardcodes `#0082c6` rather than a token, and does not use `KWordmark`
from `lib/brand.jsx`, which is why it drifted in the first place.
