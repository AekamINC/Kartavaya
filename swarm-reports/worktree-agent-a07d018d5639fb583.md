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
