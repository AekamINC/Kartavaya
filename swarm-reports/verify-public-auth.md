# Verification pass — public + auth surfaces

**Branch** `verify/public-auth-surfaces`, cut fresh from `origin/staging` at `0a69bef1`
(the worktree seeded stale at `1aa49855`, ~737 commits behind — rebranched before any work).

**Method.** Own Vite dev server from this worktree on `127.0.0.1:5611` (NOT :5173, which serves
the main checkout). `location.href` asserted on every read. A local mock API on `127.0.0.1:8099`
served fixture responses so every state could be driven **without touching the shared
staging/production Supabase** and without sending any email, OTP or WhatsApp message. No database
was read or written; no real token was used.

**Screenshots.** One captured (ApprovePage, dark, ready). Every attempt after that failed with
*"the Browser pane is not displayed, so the page is not compositing frames."* Everything below is
therefore **measured** — `getComputedStyle`, `getBoundingClientRect`,
`documentElement.scrollWidth > clientWidth`, and a WCAG relative-luminance contrast sweep over
every text-bearing node — rather than eyeballed. Where a number appears, it was computed in the
live page.

**Themes were emulated at the OS level** (`prefers-color-scheme`), not by forcing `data-theme`.
That distinction mattered: forcing the attribute while the OS disagreed produced a phantom 2.32:1
failure on ApprovePage's Reject button that does not exist for a real visitor. Some rules key off
`prefers-color-scheme` rather than `[data-theme]`, so attribute-forcing is not a valid way to test
themes in this codebase.

---

## Verdicts

| file | verdict | what differs | evidence |
|---|---|---|---|
| `pages/ApprovePage.jsx` | **broken → fixed** | Dark-mode bilingual text was near-invisible. `अनुमोदन` measured **2.13:1** and the `by Aekam Inc` wordmark **2.25:1** (both need 4.5). Root cause below. | Contrast sweep at 1280 and 393, dark + light. After fix: **0 failures in both themes**. Loading / error / ready / approved / rejected all render as distinct branches. 393px: `scrollWidth 394 = clientWidth 394`, no overflow; buttons 44/45px tall. 401 does **not** bounce (`location.pathname` stayed `/approve`). |
| `pages/SigningPage.jsx` | **broken → fixed** | Same dark-mode token defect. Separately: the **"View document (PDF)" link existed only in the OTP branch**, so a signer with `otp_required:false` reached the IT-Act-2000 binding notice with **zero `<a>` elements on the page** — asked to sign a document they could not open. Also `toLocaleDateString('en-IN')` with no options rendered `20/7/2026` where ApprovePage renders `24 Jul 2026`. | All three fixed and re-verified live. States exercised: loading, error, otp_send, otp_verify (masked email, field 210px, `inputMode=numeric`, `autocomplete=one-time-code`, `maxLength=6`, autofocus — all spec-correct), sign, already_signed, declined. 393px: no overflow, 0 contrast failures. |
| `pages/LoginPage.jsx` (login) | **differs** (deliberate, documented) | `.au` grid is `minmax(0,1.06fr) minmax(0,.94fr)` → measured **53% brand / 47% form**. Reference `auth.css:7` specifies `minmax(0,44%) minmax(0,56%)` — i.e. the proportions are **inverted**, and the decorative panel is given more room than the form. **This one is undocumented.** Brand panel is also `display:none` below 900px where AUTH-SPEC says it must stack ("A width is not a reason to drop the brand") — but that deviation *is* documented in `AuthShell.jsx` with sound reasoning. | Measured `getBoundingClientRect` at 1280: brand 678px, form 602px. Copy matches spec: bilingual `Sign in to Kartavaya / प्रवेश`, invite-only note, remember-email, forgot link. Rotator: 3 variants, 3 dots, watermark present. Ships **no pricing figure and no invented quote** — `AuthShell.jsx` explicitly refuses both. Field height 54px vs spec 56px. |
| `ForgotPasswordPage` (in `LoginPage.jsx`) | **matches** | — | 60s resend countdown implemented (`AUTH-SPEC` "sent, with a 60s resend countdown"). Non-disclosure copy correct: *"If {email} has an account…"*. Inline invalid-email error; 429 handled with distinct copy. Bilingual `Forgot your password? / कोई बात नहीं`. No overflow. |
| `ResetPasswordPage` (in `LoginPage.jsx`) | **matches** | — | Strength meter driven live: `abc` → `Too short`, `Str0ng!Passw0rd#2026` → `Strong`. Confirm-match indicator verified by DOM: mismatch → `.aufld__mark--no` `rgb(180,35,24)` (red cross), match → `.aufld__mark--ok` `rgb(20,116,58)` (green tick) — exactly the spec's "green tick / red cross". Expired link is a **screen** with "Request a new link", matching the reference's `AU_SCREENS`, not a banner. |
| `AcceptInvitePage` (in `LoginPage.jsx`) | **matches** (exceeds spec) | — | Driven with a mocked preview. Renders org, member count, inviter, role, **and the module grants with per-module levels** (`ग्रह/CRM/Approver`), expiry, and the address lock. Spec asks for org + inviter + role + grants; all present. States built beyond spec: no-token, loading, dead-404, **unreachable** (network ≠ expired), declined, `account_exists`. |
| `pages/marketing/**` (9 files) | **broken → fixed** | `sections/Modules.jsx:32` labelled Graha **ग्राहक**. The design reference's own landing files use **ग्रह** in all three places (`Landing.jsx:6`, `Landing2.jsx:36`, `Landing2.jsx:134`), as do `navConfig.js:64` and `lib/moduleColors.js`. ग्राहक is already spent on the Clients section heading (`navConfig.js:143`), so a prospect would meet the same word labelling two different things. The file's own comment claimed it was "checked against navConfig.js so the page cannot drift" — it had drifted. Fixed to ग्रह. | Rendered `#modules` before/after; `ग्राहक` gone, `ग्रह` present. **No pricing figures**: `#pricing` contains zero digits and zero currency symbols — tier names + "Talk to us for a quote" only. The five ₹ figures on the page are all inside `.lfrag`/`.lframe` product mockups (a demo GST invoice whose arithmetic is internally consistent: 1,05,508 + 9,496 + 9,496 = 1,24,500), not Kartavaya prices. **No SOC 2 claim** (spec-required removal, honoured). 393px: no overflow, zero offenders. Footer, Trust, Modules, Nav, Hero verified from rendered output. |
| `pages/onboarding/**` (9 files) | **matches** | — | Walked steps 1→5 live. Rail fully labelled at desktop (Profile · Organisation · Modules · Team · Project), collapsing to numbers at 393px. Industry list matches AUTH-SPEC exactly (7 entries). **Preselection verified**: choosing `CA / Legal practice` selected Boards, CRM, Finance, E-Sign — precisely the spec's `['kartavya','ganit','graha','esign']`, with the spec's `kartavya` correctly reconciled to `boards` (already noted in `data.js:34`). Sensitive modules carry `SENSITIVE` tags + the org-role note. Step 4 shows an honest empty state. Step 5 includes the India-specific "GST filing cycle" template. No overflow at 393 or 1280. |

---

## Root cause behind both public-page failures

`applyPrefs` (`CustomizePanel.jsx:205-211`) writes four **theme-dependent** accent tokens as
**inline styles** on `<html>`: `--primary`, `--primary-hover`, `--primary-text`, `--on-primary`.
Its own comment says it "must re-run on theme change, not only on preference change."

`DEFAULT_PREFS.mode` is `'light'` and `index.html`'s blocking bootstrap also defaults to `'light'`.
So for a stranger — no `k_prefs` — applyPrefs runs once with `dark === false` and writes the
**light** values. `ApprovePage` and `SigningPage` then flip `data-theme` to dark for a dark-OS
visitor via `useOsThemeForStrangers`, **without re-running applyPrefs**. An inline style outranks
the `[data-theme="dark"]` block in `kartavaya-design.css:369` that exists to correct exactly these,
so the surfaces went dark while the accent stayed light:

```
--primary-text  #005650  (light value)  on  --bg #0C0E11 (dark surface)
```

Measured on `/approve`, dark OS, before the fix:

| element | measured | needs |
|---|---|---|
| `अनुमोदन` (`.card__hi`, the Devanagari half of the bilingual pair) | **2.13:1** | 4.5 |
| `by Aekam Inc` (`KWordmark`) | **2.25:1** | 4.5 |

Removing the four inline properties is the correct repair rather than recomputing them: this branch
is only reached when `k_prefs` is absent, so there is no chosen accent to preserve, and the
stylesheet's per-theme values are the measured ones. Verified live — `--primary-text` resolves to
`#4FD8CB` and the sweep returns **0 failures**; unmount restores whatever was there.

---

## Fixes made (all in my own files)

1. **`ApprovePage.jsx`** — `useOsThemeForStrangers` now clears the four theme-dependent accent
   properties when it flips the theme for a stranger, and restores them on unmount.
2. **`SigningPage.jsx`** — same repair in its duplicate copy of that effect. *(The two effects are
   byte-identical in intent and remain duplicated; extracting a shared hook was out of scope for a
   verification pass.)*
3. **`SigningPage.jsx`** — "View document (PDF)" now renders on the `sign` step, not only on
   `otp_send`. Whether the document is readable no longer depends on whether an OTP was configured.
4. **`SigningPage.jsx`** — `already_signed` date now uses the same `DATE` options object as
   ApprovePage, so the two public pages agree (`20 Jul 2026`, not `20/7/2026`).
5. **`marketing/sections/Modules.jsx`** — Graha relabelled ग्राहक → **ग्रह**, matching the design
   reference, the nav and the module registry; the stale justifying comment was replaced with the
   evidence.

Nothing was restyled. No file outside the assigned list was modified.

---

## Referred out (shared files — not touched, chips raised)

- **`components/ui/ErrorState.jsx` — `errorKind()` maps 400 to `server`.** `approvals_router.py:562`
  and `:633` raise `HTTPException(400, "This approval link is no longer active")`. Verified live:
  `/approve` then renders the title *"Something broke on our side, not yours"* directly above the
  body *"This approval link is no longer active"* — self-contradictory, and it tells a client's
  customer to retry a link that will never work. Shared across many pages, so left alone.
- **`styles/editorial.css:925` — `.k-btn--primary` label contrast in dark.** `--k-grad` has no dark
  branch (applyPrefs writes it theme-independently), so the `--on-primary` `#00332F` label measures
  **1.62 / 3.23 / 5.52** against the gradient's three stops. White would be 8.58 / 4.30 / 2.51 —
  neither colour passes across the whole gradient. The comment justifying the current value states
  the gradient "is the light mint there", which is factually wrong. ~454 `.k-btn` call sites.

---

## NOT VERIFIED — honest gaps

- **The reference HTML harnesses were never rendered.** `.claude/launch.json` has **no `design-docs`
  entry** (only `kartavya-frontend` and `kartavya-backend`), so there was no configured way to serve
  them. I compared against the reference **source** instead — `auth.css`, `Landing.jsx`,
  `Landing2.jsx`, `AUTH-SPEC.md`, `ScreensWork.jsx`, `ScreensMore.jsx` — read directly. Side-by-side
  visual diffing against the running prototypes did not happen.
- **Screenshots**: one only. All other visual confirmation is measured, not seen. Pure-visual defects
  with no computed signature (spacing rhythm, optical alignment, shadow weight, the watermark's 40s
  drift) would not have been caught.
- **`ScreensWork.jsx:93 ScreenApprovals` and `ScreensMore.jsx:318 ScreenEsign` were not compared
  element-by-element** against the live pages. I verified the live pages against the *specs* and
  against measured layout, not against those two reference screens line by line.
- **`onboarding/StepDone.jsx`** — the terminal "Done" screen was not reached (it is not in the
  5-step rail; completing the wizard would have posted real writes). Its self-drawing checkmark and
  the three tips are unverified.
- **`onboarding/StepInvite.jsx` paste-list parsing** — the empty state was verified; the spec's
  split on `[,\s\n;]+`, per-address validation and duplicate-naming were **not** exercised.
- **`onboarding/icons.jsx`** — not individually verified beyond icons rendering in context.
- **SigningPage draw-signature canvas** — no stroke was drawn, so the paper/ink `getComputedStyle`
  round-trip and `toDataURL` output are unverified. This is the legally binding artefact and
  deserves its own pass.
- **Marketing motion** — hero parallax, the `IntersectionObserver` reveal, and
  `prefers-reduced-motion` behaviour were not tested.
- **Landing/auth do not follow the OS theme.** A dark-OS prospect gets a light landing page and a
  light `/login`, because the bootstrap defaults to `'light'` and only `/approve` and `/sign` install
  `useOsThemeForStrangers`. Reported as an observation, **not** changed — the same
  stranger-has-no-prefs reasoning that justified the effect on the public pages arguably applies
  here, but changing it is a visible restyle and an owner's call.
- **Real backend** — everything was driven against a local mock. No response shape was confirmed
  against the live API, so a field-name mismatch of the kind ApprovePage's docblock describes
  (`approval.notes` vs `task.notes`) could still exist elsewhere and would not have shown up.

---

## Launch risk, unrelated to fidelity

`pages/marketing/cta.js` — the landing page's **primary CTA has no destination**. `VITE_LEAD_CTA_HREF`
is unset, so "Request a demo" renders inert and a visitor-facing note reads *"We are not taking demo
requests through this page yet."* The file argues persuasively against guessing an address, and I
have not guessed one. But with delivery on **15 August**, a public marketing page whose only working
action is "Sign in" is a business gap, not a styling one, and it needs an owner decision.

---

## Gates

Run from `frontend/` on the final tree:

```
node scripts/check-tokens.mjs   → pass
node scripts/check-classes.mjs  → pass (3499 selectors, 2690 classes used, 0 missing a rule)
npx vite build                  → ✓ built in 25.79s, exit 0
npx vitest run                  → Test Files 41 passed (41) · Tests 665 passed (665) · EXIT: 0
grep -ci unhandled /tmp/vt.log  → 0
```

Matches the stated baseline of 41 files / 665 tests, exit 0, exactly.
