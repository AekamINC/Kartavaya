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

Gates green after these changes: tokens 279 declared / 229 referenced / 0 missing;
classes 2096 defined / 1416 used / 0 missing a rule.

---
