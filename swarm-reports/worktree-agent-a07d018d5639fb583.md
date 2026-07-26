# Auth & Onboarding — agent report

Branch: `worktree-agent-a07d018d5639fb583`
Surface: `pages/LoginPage.jsx`, `components/layout/AuthShell.jsx`, `styles/auth.css`,
`pages/onboarding/*`, auth email templates.
Governing spec: `design-handover/12-auth-onboarding.md`, `24-bilingual-devanagari.md`,
`14-dark-mode.md`, `00-tokens.md`.

> Written incrementally. Every line below was confirmed at the time it was written.

---

## 0 · Worktree correction (before any work)

This worktree was branched from **`main`**, not `staging` — HEAD was `1aa4985`,
13 commits on the production line and **271 commits behind `origin/staging`**.
Reset to `origin/staging` (`2a2a27b`) before touching anything. Nothing was lost:
`1aa4985` is still `main`'s tip.

Worth flagging to the coordinator — if other agents' worktrees were cut the same
way, they are editing a pre-redesign tree and their diffs will not apply.

---

## 1 · Font measurements (real probe, Chrome 150 / Windows)

Probe: standalone page, Google Fonts loaded exactly as `frontend/index.html` loads
them, `document.fonts.load()` + `await document.fonts.ready` before every
measurement, widths from `getBoundingClientRect()`. Probe lives in the scratchpad
and is **not** committed.

Token values under test, from `styles/kartavaya-design.css:41-43`:

```
--font-ui:    'Inter', system-ui, -apple-system, sans-serif
--font-hindi: 'Tiro Devanagari Hindi', 'Noto Serif Devanagari', 'Nirmala UI', 'Kohinoor Devanagari', serif
```

### 1a · `.au__sub` — pure Devanagari at 60px

String: `आपकाव्यापारएकहीजगह` (spaces and comma removed so only the script is measured)

| Stack | Width | Meaning |
|---|---|---|
| `--font-ui` alone | **580.85px** | the pre-fix broken state |
| `--font-ui, --font-hindi` (**current** `auth.css:131`) | **540.19px** | what ships today |
| `--font-hindi` alone | **540.19px** | Tiro reference |

**580.85 / 540.19 = 1.0753 → the broken state was 7.5% wider.**

The original defect report claimed "581px versus Tiro's 540px at 60px — 7.5%
wider". Measured: **580.85 vs 540.19, 7.5%**. The claim was correct to the pixel.

**CLAIM 1 — HELD (as a past defect), and the fix is now VERIFIED CORRECT.**
Current stack renders Devanagari at exactly Tiro's width. A generic family
(`sans-serif`) mid-list does **not** terminate per-glyph fallback in Chrome, so
`var(--font-ui), var(--font-hindi)` does reach Tiro. The CSS comment's reasoning
is right.

### 1b · The mixed string, and why it is not 1:1

Full string `आपका व्यापार, एक ही जगह`: current = 624.98, Tiro-only = 620.40,
delta **+4.58px**. This is **not** a fallback failure. Space and comma are covered
by Inter, so in the current stack Inter claims them:

| char | Inter | Tiro | delta |
|---|---|---|---|
| 5 × space | 84.38 | 78.00 | +6.38 |
| comma | 17.29 | 17.83 | −0.54 |

Net +5.84 predicted vs +4.58 measured (residual is shaping across the mixed runs).
Latin measured identical with and without the appended stack (673.13 both) —
**the fix does not steal Latin**, which was its stated design goal.

### 1c · `.au__wm` tracking crush

`कर्तव्य` at 256px in `--font-hindi`:

| tracking | width |
|---|---|
| `-.03em` (the rule in `auth.css:32`) | 552.45px |
| `normal` | 575.50px |

Crush = **23.05px total**, i.e. −7.68px per gap × 3 gaps. The claim's "−7.68px at
256px" arithmetic is exactly right.

**CLAIM 2 — the fix is PRESENT.** `AuthShell.jsx:115` renders
`<span className="au__wm" lang="hi" aria-hidden="true">कर्तव्य</span>`, and
`editorial.css:2456` is `[lang="hi"], [lang="sa"], [lang="gu"] { letter-spacing: 0 !important; }`.
`!important` beats `.au__wm`'s non-important declaration regardless of order, so
tracking resets to 0. Verified on the live rendered page — see §1e.

### 1d · Tiro is single-weight — confirmed by descriptor, not by width

Enumerating `document.fonts` for the family returns **six** registered faces
(roman + italic across the loaded subsets) and **every one has `weight: "400"`**:

```
[{family:'Tiro Devanagari Hindi', weight:'400', style:'italic'},  … ×3
 {family:'Tiro Devanagari Hindi', weight:'400', style:'normal'},  … ×3]
tiroWeights: ["400"]        tiroIsSingleWeight: true
```

Inter, for contrast, registers 300/400/500/600/700.

**Methodology note that matters:** advance width is a **useless** faux-bold
detector. Tiro at 400/500/700 all measured **620.40px** — identical — because
Chrome synthesises bold by smearing the outline without changing metrics. Anyone
testing this by width will wrongly conclude there is no faux bold. The weight
descriptor is the authoritative signal.

**CLAIM 3 — HELD.** Any Devanagari under a ≥500 rule on this surface is
synthesised. Occurrences found and fixed are listed in §2.

---

## 2 · Fixes made, each backed by the reference source

Compared our `auth.css` against the reference `auth.css` / `onboarding.css` line
by line rather than reasoning about what the rule ought to be.

### 2a · `.ob__mod-hi` was faux-bold — FIXED

| | our `auth.css` (before) | reference `onboarding.css:65` |
|---|---|---|
| font-family | `--font-hindi` | `--font-hindi` |
| font-size | 15px | **17px** |
| font-weight | **500** | **400** |
| line-height | — | **1.35** |

The reference writes this rule against a `<b>` element — which defaults to bold —
and explicitly resets `font-weight: 400`. It is the only `b` in that file given a
weight at all, i.e. the reference author hit this exact problem and fixed it.

Confirmed live: computed `font-weight: 500` on the rendered `.ob__mod-hi`, on a
family whose every registered face is weight 400. Now 400 / 17px / 1.35.

**This was the only faux-bold occurrence on the whole surface** — verified by
reading computed style on all eight Devanagari elements, §2d.

### 2b · `.au__hi` and `.ob__hi` were on the language-following token — FIXED

Both render **hardcoded** Devanagari that never switches with the language
setting (`प्रवेश`, `स्वागत`, `कोई बात नहीं`, `नया पासवर्ड` in `LoginPage.jsx`;
`कर्तव्य में आपका स्वागत है`, `सब तैयार है`, `बाद में कर लेंगे` in the onboarding
steps). Both were on `--font-indic`. The reference uses `--font-hindi`:

- `auth.css:58` → `.au-h__hi { font-family: var(--font-hindi); font-size: .62em; … }`
- `onboarding.css:40` → `.ob-hi { font-family: var(--font-hindi); font-size: 15px; … }`

`.ob__hi` also took the reference's 15px (was 14px).

**Today this is a no-op in pixels — and I verified that rather than assuming it.**
Another agent already patched `--font-indic` at the token level
(`CustomizePanel.jsx:294`) so the EN+GU value appends the Devanagari stack.
Measured at 60px, string `कर्तव्य में आपका स्वागत है`:

| stack | width |
|---|---|
| EN+GU `--font-indic`, **patched** | **568.99px** |
| `--font-hindi` | **568.99px** |
| EN+GU `--font-indic`, **unpatched** (`'Noto Sans Gujarati','Shruti',sans-serif`) | **610.17px** |

Pure-Devanagari control (spaces removed, since Noto Sans Gujarati *does* cover the
space and would mask a partial failure): 506.59px both. That patch is real and it
works — **7.2% breakage avoided**.

The change is therefore about naming the correct token, not correcting a visible
break: a fixed glyph should not depend on a runtime safety net in the
customization panel continuing to hold.

### 2c · Spec defects in the reference itself — recorded, not silently followed

1. **The reference contains the `.au__sub` bug that started this.** Reference
   `auth.css:24` is
   `.au-brand__p { font-size:13px; line-height:1.68; color:var(--side-fg-mute); … }`
   — **no `font-family`** — and `Auth.jsx:56` puts the mixed Devanagari+Latin
   string in it. The original defect was inherited from the design source, and our
   `font-family: var(--font-ui), var(--font-hindi)` goes *beyond* the reference.
   §1a says the fix is correct. The reference should adopt it.
2. **The reference sets negative tracking on Devanagari.** Reference
   `auth.css:13` `.au-brand__wm { … letter-spacing:-.03em }` on `कर्तव्य`, which
   `24-bilingual-devanagari.md` forbids outright ("Never set `letter-spacing` on
   Devanagari. Tracking breaks conjunct ligatures"). Our `lang="hi"` +
   `editorial.css:2456` reset is the correct mitigation; the reference rule is the
   defect.
3. **The reference puts text on `--on-surface-faint`.** `onboarding.css:66`
   `.ob-mod__t i { … color: var(--on-surface-faint) }` — that token is NON-TEXT
   ONLY. Our `.ob__mod-en` already uses `--on-surface-3`; deviation kept.

### 2d · Live cascade audit — all eight Devanagari elements

Real CSS files served and loaded in the real `App.jsx` import order, real DOM
shapes copied from the components, values read with `getComputedStyle`:

```
.au__wm      w=400 ls=normal fam=Tiro Devanagari Hindi size=207.2px
.au__sub     w=400 ls=normal fam=Inter                 size=13px
.au__rot-hi  w=400 ls=normal fam=Tiro Devanagari Hindi size=21px
.au__hi      w=400 ls=normal fam=Tiro Devanagari Hindi size=16.7px
.ob__wm      w=400 ls=normal fam=Tiro Devanagari Hindi size=227.92px
.ob__hi      w=400 ls=normal fam=Tiro Devanagari Hindi size=15px
.ob__mod-hi  w=400 ls=normal fam=Tiro Devanagari Hindi size=17px
.ob__tpl-hi  w=400 ls=normal fam=Tiro Devanagari Hindi size=12px
violations: []
```

`.au__sub` resolving to Inter first is correct — Latin leads, Devanagari falls
through to Tiro, proven by width in §1a.

`.au__wm` computed `letter-spacing: normal` **confirms CLAIM 2's fix on the live
cascade**, not merely by reading the CSS.

Gates green after these changes (re-run bare on the final branch, no pipe —
§2 of `_COORDINATION.md`): tokens 339 declared / 233 referenced / 0 missing;
classes 2114 defined / 1437 used / 0 missing a rule. Both exit 0.

---

## 3 · The auth flows, driven in a real browser

Vite dev server, real components, **network intercepted at the browser** so no
request reached a backend. Nothing was written to a database and **no email was
ever triggered** — the invite and reset paths were exercised against fulfilled
routes only.

`node_modules` was not installed in the worktree; the main repo's was junctioned
in. `git status` stayed clean, **no lockfile was touched**.

| Flow | Result |
|---|---|
| **Login submits** | **YES.** `POST /api/auth/login`, body `{"email":"Keval@Example.com","password":"hunter2-not-real"}` |
| Email trimmed, password not | Confirmed — typed `␣␣Keval@Example.com␣␣`, sent trimmed; password preserved byte-for-byte |
| Inline validation precedes the request | Confirmed — invalid email produced `aria-invalid="true"` + "That does not look like an email address." and **zero requests** |
| Empty submit | Names both fields: "Enter your email address." / "Enter your password." |
| Rejected credential | Banner + `.is-shake` present at 180ms, cleared by 1000ms |
| Network failure | Toast "Could not reach the server", **no** banner — correct per 12 §5 |
| Forgot password | Conditional confirmation, 60s resend countdown runs |
| Accept-invite / reset without a token | Specific, correct dead-end states with a route out |
| Onboarding endpoints | All real — `POST /invites` (`invite_router.py:274`), `POST /teams` (`server.py:1766`), columns GET/POST/PUT/DELETE (`server.py:837/846/857/873`) |

**Login was not broken.** All four named exports match what `App.jsx:38-41`
lazy-imports, and all four routes resolve.

### 3a · Four defects found here, all fixed

1. **The 429 banner printed slowapi's raw string.** Measured:
   `Rate limit exceeded: 5 per 1 minute` rendered verbatim on the sign-in screen
   (login is `5/minute`, forgot-password `3/minute`). Now "Too many attempts.
   Wait a minute and try again." The forgot-password toast gets its own wording,
   because "try again in a moment" is the wrong advice when only waiting helps.
2. **The sign-in banner echoed the server's `detail` verbatim** — precisely where
   an enumeration oracle would appear. Verified with a hostile stub: a backend
   answering `"No account exists with that email address"` had that string
   rendered to the user. The form now prints its own copy and never the
   server's; re-tested, the generic message is shown instead. `accept-invite`
   and `reset` keep `detail`, where it is useful and there is nothing to protect.
3. **A 500 printed whatever was in `detail`**, including a stubbed
   `asyncpg.exceptions.UndefinedColumnError`. Now a plain sentence.
4. **`POST /invites` was being retried — and it sends an email.** Measured: one
   call against a 503 put **four requests on the wire**. A gateway 503 in the
   Railway restart window arrives *after* the backend created the invite and
   mailed the person, so each retry mails them again — up to four identical
   invitations to a client. Now `noRetry`, the opt-out `api.js` already
   documents for uploads "to avoid double-sending". Re-measured: **1 request**.
   `POST /teams` got it too — a non-idempotent create that would otherwise leave
   duplicate projects and orphan all but the last.

### 3b · Not fixed, recorded — login is slow to report a dead network

`api.js` retries network failures 3× at 800/1600/2400ms, so the sign-in button
sits on "Signing in…" for **~4.8s** before the toast appears. Sampled every
500ms: first feedback at 5000ms. Defensible for background fetches, wrong for a
foreground credential submit where the user is watching. Changing the shared
interceptor's semantics affects every surface, so it is flagged rather than
altered.

---

## 4 · Dark mode — and a correction to my own earlier claim

**I first reported a severe dark-mode defect here. It was my test that was
wrong, and the palette is fine.** Recording it because the methodology trap will
catch the next person.

Setting `data-theme="dark"` with `setAttribute` is **not** a valid theme switch
in this app. `applyPrefs` (`CustomizePanel.jsx:191-225`) writes `--primary`,
`--primary-text`, `--primary-hover` and `--primary-vivid` as **inline custom
properties on `:root`**, and an inline property beats every stylesheet rule. So
poking the attribute flips the token-file values while leaving the inline ones
frozen at the previous theme — which reads exactly like a broken dark mode.

Driving the real preference (`k_prefs.mode`, then reload) instead, all four auth
screens are correct in both themes: `--s-container` `#EEE9DC` → `#1D2229`,
input text 14.0:1 light and 12.93:1 dark, kick/link on the vivid accent in dark.

Contrast, measured on the rendered pages, WCAG AA 4.5:1 for normal text:

| pair | light | dark |
|---|---|---|
| input text / input bg | 14.00 | 12.93 |
| floating label / input bg | 4.56 | 4.81 |
| h1 / page | 14.79 | 15.63 |
| kick / page | 7.48 | 7.69 |
| lede · note / page | 4.82 | 5.81 |
| link / page | 7.48 | 7.69 |
| brand em · rot-k / brand panel | 7.00 | 7.89 |
| rot-l · wordmark / brand panel | 17.57 | 19.82 |
| **button label / button fill** | **4.30 ✗** | 5.52 |

One failure, and it is not an auth bug — see §5.

---

## 5 · The primary button label fails AA, and it is a global token defect

`00-tokens.md:471` states `--on-primary` on `--primary` is **5.1:1, pass**. Two
things are wrong with that row.

**It does not match its own static tokens.** White `#FFFFFF` on `--primary`
`#04837A` measures **4.63:1**, not 5.1.

**And those static values are not what runs.** `applyPrefs` overrides `--primary`
inline with the accent's derived `mid` (light) / `color` (dark), so the shipped
pair is never the one the table was computed against. At the **default teal**,
light mode is **4.30:1 — below AA**, on the "Sign in" button of the first screen.

The accent is user-configurable, so I measured all twelve presets:

**Light — white on `--primary` (`mid`): 3 of 12 fail**

| preset | ratio |
|---|---|
| saffron | **3.18** |
| coral | **3.87** |
| teal *(default)* | **4.30** |

**Dark — `--on-primary` `#00332F` on `--primary` (`color`): 10 of 12 fail**

| preset | ratio | | preset | ratio |
|---|---|---|---|---|
| forest | **1.96** | | rose | **3.01** |
| crimson | **2.21** | | indigo | **3.10** |
| violet | **2.43** | | emerald | **3.68** |
| slate | **2.91** | | blue | **3.77** |
| amber | **4.35** | | coral | **4.40** |

Only teal (5.52) and saffron (6.46) pass in dark. `--on-primary` in dark is the
fixed literal `#00332F`, a dark teal — it is a sensible partner for a teal accent
and for nothing else. Against violet it is 2.43:1.

**The codebase already solved this problem one token over.** `deriveAccentText`
(`CustomizePanel.jsx:149-157`) *measures* and steps lightness down until the
value clears 4.5:1, with a comment saying that taking a derived value "on trust
would leave each one an unmeasured contrast risk". `mid` and `--on-primary` never
got the same treatment.

**Recommended fix (not applied):** derive `--on-primary` the same way — pick
white or a dark tone by measurement against the resolved `--primary`, and darken
`mid` until white clears. **I did not apply it:** it changes every primary button
in the product across twelve accents, which is a blast radius an auth-surface
agent should not take unilaterally mid-swarm. It belongs to the tokens owner.

---

## 6 · Gaps confirmed present, none of them regressions

Each of these is something `12-auth-onboarding.md` asks for that does not exist.
The code is honest about all of them — nothing claims a capability it lacks.

- **No `GET /auth/invite/:token`** (12 §4 lists it as NEW). So the accept screen
  cannot show org, inviter, role or grants, and `auth.css` deliberately ships no
  CSS for that panel — a comment in the file says why.
- **No `GET/POST /v1/onboarding`.** Resume is the local `kv_onboarding` write and
  only that; a phone→laptop handoff does not resume, and nothing claims it does.
- **Three of five onboarding steps have no endpoint** (profile, org, module set).
  They save locally and `StepDone` reports them in the dashed PENDING state
  rather than ticking them.
- **No session refresh.** There is no `/auth/refresh` and no refresh token issued
  anywhere in `auth_router.py`. The JWT is minted at login and expires. So "verify
  session refresh" has nothing to verify — it does not exist.
- **`api.js` has no 401 handling at all** (12 §5 asks it to distinguish an expired
  session from bad credentials). Nothing redirects to `/login` on expiry.
- **`reset-password` does not invalidate other sessions** (12 §4). The screen
  correctly does *not* claim it does, and a comment records why.
- **No `emails/` directory.** The four templates 12 §3 asks for do not exist as
  files; `email_service.py:1087` builds the reset mail inline. The design source
  is `design-reference/Kartavaya Redesign/Auth Emails.html`. **Left alone for the
  dedicated email agent** — recorded, not rewritten.
- **Accept-invite returns 409 "An account with this email already exists"**, a
  mild enumeration signal — but it is gated behind holding a valid invite token,
  which already implies knowing the address. Low severity, not changed.

---

## 7 · Branch hygiene

This branch was rebuilt. The original was cut from `main` (271 commits behind),
and a later `pull --rebase` against a stale remote replayed 47 other agents'
staging commits as duplicates, leaving it 50 ahead of staging.

Recovery, per the coordinator: verified the duplicates were already on staging by
subject (`fix(sanvaad): drop Devanagari…` → `47af41d`, `refactor(boards): delete
the dead TaskEditor…` → `88eaab4`), then branched fresh from `origin/staging` and
cherry-picked **only** the three commits that are mine. The messy tip is tagged
`backup-messy-a07d018` locally and preserved at
`origin/rescue/a07d018d5639fb583`. Nothing was force-pushed.

---

## 8 · Claims: held vs stale

| Claim | Verdict |
|---|---|
| `.au__sub` had no font rule; Devanagari fell to an OS face | **HELD as history** — reproduced the exact numbers, 580.85 vs 540.19 = 7.5% |
| …and it is now fixed | **HELD** — measured identical to Tiro, 540.19px |
| `.au__wm` tracking crushes the conjuncts | **HELD** — 23.05px total crush at 256px |
| …and `lang="hi"` fires a reset that fixes it | **HELD** — computed `letter-spacing: normal` on the live cascade |
| Tiro ships a single weight; Devanagari in a 700/800 label is faux-bold | **HELD** — all six registered faces are weight 400; one occurrence found (`.ob__mod-hi` at 500) and fixed |
| "Login was broken and rebuilt — verify it submits" | **STALE** — it submits, correctly, with the right trimming |
| Onboarding might be stubbed | **STALE** — every available endpoint is real and wired; the three unavailable ones are honestly reported as pending |
| Dark mode is on the old palette | **STALE** — correct in both themes; my own contrary claim was a bad test method (§4) |
| Error states leak account existence | **STALE at the backend, REAL at the frontend** — backend is single-branch and correct, but the frontend echoed `detail` verbatim and would have leaked any future backend change. Fixed. |

My own §1 claim of a dark-mode break was **wrong and is retracted in §4**.
