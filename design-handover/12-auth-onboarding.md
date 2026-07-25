# 12 · Auth and onboarding

Prereq: `00-tokens.md`, `02-common-components.md`. Every screen state, the strength rules and the invite-vs-signup decision are in `AUTH-SPEC.md`.

Design source: `Auth.jsx`, `AuthForms.jsx`, `auth.css`, `Onboarding.jsx`, `onboarding.css`, `Auth Emails.html`.

Staging source: `pages/LoginPage.jsx` (14,764 bytes), `components/layout/AuthShell.jsx`.

---

## Two facts about staging

**The auth flow never received the warm-earthy palette.** `AuthShell.jsx` is cold blue — `#f4fafd` light, `#0a1628` dark — with the legacy blue→teal gradient. It is the first screen a user ever sees and the only one still on the old system. Same gap as `mobile/src/theme/tokens.ts` (`17-mobile-app.md`).

**It is invite-only.** There is no signup route, no OAuth, no self-serve path. `LoginPage.jsx` handles login, accept-invite, forgot and reset. So the landing page's "Start free" is a **business-model change**, not a restyle. Both paths are designed and coexist; an invited user skips module selection because the org already chose.

Errors surface only as toasts — no inline field validation anywhere in the flow. A wrong password produces a toast in the corner while the field that caused it looks fine.

---

## 1 · Exact CSS

### Split shell

```css
.au{min-height:100vh;display:grid;grid-template-columns:minmax(0,1.06fr) minmax(0,.94fr)}
.au__brand{position:relative;overflow:hidden;padding:44px;display:flex;flex-direction:column;background:rgb(var(--side-ink));color:var(--side-fg)}
.au__mesh{position:absolute;inset:0;pointer-events:none;background:radial-gradient(48% 42% at 22% 18%,color-mix(in srgb,var(--primary-vivid) 26%,transparent),transparent 70%),radial-gradient(42% 38% at 78% 74%,color-mix(in srgb,var(--tertiary) 20%,transparent),transparent 72%)}
.au__wm{position:absolute;right:-4%;bottom:-6%;font-family:var(--font-hindi);font-size:clamp(170px,20vw,300px);line-height:.8;color:#fff;opacity:.045;pointer-events:none}
.au__form{display:flex;align-items:center;justify-content:center;padding:44px;background:var(--bg)}
.au__box{width:100%;max-width:392px}
@media(max-width:900px){.au{grid-template-columns:1fr}.au__brand{display:none}}
```

The brand panel is hidden below 900px rather than stacked. A tall decorative panel above the form on a phone means the user scrolls past marketing to reach a password field.

### M3 tonal field

```css
.fld{position:relative}
.fld__i{width:100%;height:54px;padding:21px 14px 7px;border:0;border-bottom:1px solid var(--outline);border-radius:var(--r-sm) var(--r-sm) 0 0;background:var(--s-container);font:inherit;font-size:14.5px;color:var(--on-surface);transition:background var(--dur-fast),border-color var(--dur-fast)}
.fld__i:hover{background:var(--s-high)}
.fld__i:focus{outline:none;border-bottom:2px solid var(--primary);padding-bottom:6px;background:var(--s-high)}
.fld__l{position:absolute;left:14px;top:17px;font-size:14.5px;color:var(--on-surface-3);pointer-events:none;transform-origin:left top;transition:transform var(--dur-fast) var(--ease-standard),color var(--dur-fast)}
.fld__i:focus~.fld__l,.fld__i:not(:placeholder-shown)~.fld__l{transform:translateY(-11px) scale(.74);color:var(--primary)}
.fld__i[aria-invalid="true"]{border-bottom-color:var(--danger)}
.fld__i[aria-invalid="true"]~.fld__l{color:var(--danger)}
.fld__e{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--danger);margin-top:5px;animation:fldE var(--dur-base) var(--ease-emph)}
@keyframes fldE{from{opacity:0;transform:translateY(-3px)}}
```

The label scales rather than shrinking font-size, so the transition is compositor-only. `:not(:placeholder-shown)` means a `placeholder=" "` is required on the input — without it the label never floats for a pre-filled field, which is exactly the accept-invite case where the email arrives populated.

`aria-invalid` drives both the border and the label colour, so the error is announced and visible without a separate class.

### Strength meter

```css
.stg{display:flex;gap:3px;margin-top:8px}
.stg__b{flex:1;height:3px;border-radius:2px;background:var(--s-high);transition:background var(--dur-base) var(--ease-standard)}
.stg__b.on1{background:var(--danger)}
.stg__b.on2{background:var(--warn)}
.stg__b.on3{background:#A6A44A}
.stg__b.on4{background:var(--ok)}
.stg__t{font-size:11px;color:var(--on-surface-3);margin-top:5px}
```

Four segments, and the label states what is missing rather than scoring the user — "add a number" beats "weak". Strength rules in `AUTH-SPEC.md`.

### Onboarding rail

```css
.ob__rail{display:flex;align-items:center;gap:0;margin-bottom:34px}
.ob__st{display:flex;align-items:center;gap:8px;flex-shrink:0}
.ob__n{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:11.5px;font-weight:700;background:var(--s-container);color:var(--on-surface-3);transition:background var(--dur-base),color var(--dur-base)}
.ob__st.on .ob__n{background:var(--primary);color:var(--on-primary)}
.ob__st.done .ob__n{background:var(--ok);color:#fff}
.ob__lb{font-size:12px;color:var(--on-surface-3)}
.ob__st.on .ob__lb{color:var(--on-surface);font-weight:600}
.ob__line{flex:1;height:1px;background:var(--outline-variant);margin:0 11px;min-width:14px}
.ob__st.done+.ob__line{background:var(--ok)}
@media(max-width:720px){.ob__lb{display:none}.ob__st.on .ob__lb{display:block}}
```

On a phone only the current step keeps its label; the rest collapse to numbered dots. Five labels on a 393px rail truncate to nonsense.

### Step transition

```css
.ob__pane{animation:obIn var(--dur-slow) var(--ease-emph)}
.ob__pane.back{animation:obBack var(--dur-slow) var(--ease-emph)}
@keyframes obIn{from{opacity:0;transform:translateX(22px)}}
@keyframes obBack{from{opacity:0;transform:translateX(-22px)}}
```

Direction-aware: forward slides in from the right, Back from the left. Both must be `transform`/`opacity` only — a step pane containing a module grid is expensive to relayout.

### Skip state

```css
.obs__dash{width:34px;height:34px;border-radius:50%;background:var(--s-container);color:var(--on-surface-3);display:grid;place-items:center;font-size:17px}
.obs__r--pend{color:var(--on-surface-3)}
.obs__r--pend .obs__ic{border:1px dashed var(--outline);border-radius:50%;padding:3px}
```

Skipping shows a neutral dash, not a checkmark, and the three summary rows switch to a dashed pending state — "Recommended modules are on", "No one invited yet", "No project yet". Claiming setup is complete when it was skipped is a lie the user will discover on the empty dashboard.

---

## 2 · Component trees

```
AuthShell                                components/layout/AuthShell.jsx
├── BrandPanel   mesh · watermark · rotating module line
└── FormPanel → children

LoginPage                                pages/LoginPage.jsx
├── LoginForm         email · password · remember · forgot
├── AcceptInviteForm  invited (org known) · expired
├── ForgotForm        always the same confirmation, regardless of account existence
└── ResetForm         strength meter · confirm · states its side effects

OnboardingWizard                         pages/OnboardingPage.jsx
├── StepRail
├── StepProfile · StepOrg · StepModules · StepInvite · StepTemplate
└── StepDone   or SkippedSummary
```

---

## 3 · New files

```
frontend/src/pages/auth/LoginForm.jsx
frontend/src/pages/auth/AcceptInviteForm.jsx
frontend/src/pages/auth/ForgotForm.jsx
frontend/src/pages/auth/ResetForm.jsx
frontend/src/pages/auth/SignupForm.jsx           only if self-serve is approved
frontend/src/pages/OnboardingPage.jsx
frontend/src/pages/onboarding/Step*.jsx          five
frontend/src/components/auth/Field.jsx           the tonal field above
frontend/src/components/auth/StrengthMeter.jsx
frontend/src/lib/passwordRules.js
frontend/src/styles/auth.css
emails/welcome.html · invitation.html · reset.html · support-access.html
```

Email templates are table-based, 600px, inline styles only, `role="presentation"`, no flexbox — built and verified in `Auth Emails.html`. Devanagari needs a serif fallback stack because several clients have no Devanagari face and will otherwise render boxes.

---

## 4 · Endpoints

Existing: `POST /auth/login` · `POST /auth/accept-invite` · `POST /auth/forgot-password` · `POST /auth/reset-password`.

| Endpoint | Change |
|---|---|
| `POST /auth/forgot-password` | must return the **same** response whether or not the account exists — otherwise it is an account-enumeration oracle |
| `POST /auth/reset-password` | invalidate all other sessions and say so on the screen |
| `GET /auth/invite/:token` | **new** — org name, inviter, role and grants, so the accept screen can show what is being accepted |
| `POST /auth/signup` | **new**, only if self-serve is approved |
| `GET/POST /v1/onboarding` | **new** — resumable progress; the client also writes `kv_onboarding` locally so a refresh doesn't lose a step |

---

## 5 · What changes in existing files

| File | Bytes | Change |
|---|---|---|
| `components/layout/AuthShell.jsx` | — | **Repalette from cold blue to warm-earthy.** `#f4fafd` → `--bg`, `#0a1628` → `rgb(var(--side-ink))`, legacy gradient → `--primary`/`--primary-vivid`. Add the mesh, watermark and rotating module line |
| `pages/LoginPage.jsx` | 14,764 | Split into the four forms. **Add inline validation** — toast-only errors mean the field that failed gives no signal. Keep the toast for network failures |
| `lib/api.js` | — | 401 handling should distinguish an expired session from bad credentials; today both land as a generic error |
| `index.html` | — | Preload the display + Devanagari faces; the auth screen is a first paint with no cache |
| `App.jsx` | — | `/onboarding` route, and a redirect into it when `org.onboarding_complete` is false |

### The decision that gates this file

Invite-only or open signup. The screens exist for both and share every component; what differs is whether `/signup` is routed and whether the landing CTA is honest. Until that is settled, "Start free" on the landing page leads somewhere that does not exist — which is worse than a "Request access" button that works.
