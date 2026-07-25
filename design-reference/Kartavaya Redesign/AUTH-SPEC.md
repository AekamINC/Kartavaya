# Auth & public surfaces — implementation handover

Target stack: **Vite + React (JSX, no TypeScript) · plain CSS custom properties in `editorial.css` · FastAPI · Supabase Postgres · no component library.**

Design files: `Landing Page.html` (`Landing.jsx`, `Landing2.jsx`, `landing.css`) · `Auth Screens.html` (`Auth.jsx`, `AuthForms.jsx`, `auth.css`) · `Onboarding.html` (`Onboarding.jsx`, `onboarding.css`) · `Auth Emails.html`.

---

## Settled: invite-only

**Decided 25 Jul 2026 — Kartavaya is invite-only.** There is no public signup route. The landing CTA is "Request access", with no trial promise. The self-serve path below stays documented for whenever it is wanted, but it is NOT in scope.

## Background

Staging is **invite-only**. `LoginPage.jsx` says so in the body copy — "Access is invite-only. Contact your admin to get access." — there is no signup route, no OAuth and no public marketing page. The brief asks for a landing page with **Start Free**, a two-step signup and Google OAuth.

That is a business model change, not a restyle. Both paths are designed and they coexist:

| Path | Entry | Ends at |
|---|---|---|
| **Self-serve** — *not shipping* | `kartavaya.com` → Request access → `/signup` → org setup | `/onboarding` |
| **Invited** | invite email → `/accept-invite?token=` | `/onboarding` (joins an existing org, skips step 2) |

An invited user must **not** see module selection — the org already decided. Step 2 is skipped and the wizard runs 1 → 3 → 4 → 5.

## Palette correction

`AuthShell.jsx` is on an older cold-blue palette (`#f4fafd` fills, `#d0e8f5` borders, `#0a1628` ink, `K.dark`, `K.grad`) that never received the warm-earthy system. Every auth surface moves onto the app tokens, and the branding panel reuses the **sidebar's own ink** (`rgb(var(--side-ink))`) with the same radial glows, so signing in and arriving at the dashboard read as one continuous surface.

---

## Shared auth shell

```
au (grid 44% / 56%)
├── BrandPanel        ← rotating content, one component, four screens
└── AuthPane
    ├── au-h          kick · h1 with italic accent · optional lede
    ├── banner        error / warning / info
    ├── au-fields     AField · APassword · AButton
    ├── OrDivider + social
    └── au-pow        "Powered by Aekam Inc"
```

**Branding panel rotates every 7s** across three variants — a module highlight, the flat-pricing stat, a customer quote — with dots to jump. Same panel on login, signup, forgot, reset and invite, so the left half never changes shape while the right half does. Watermark `कर्तव्य` drifts over 40s (`translate3d(-14px,-10px,0) rotate(-1.2deg)`), which is slow enough to be felt rather than seen.

Below 1024px the panel **stacks above** the form rather than disappearing; only the two phone surfaces swap to the compact header. A width is not a reason to drop the brand.

### M3 filled field, macOS radius

```css
.au-f__box { height:56px; padding:0 14px 9px; background:var(--s-container);
             border-radius:var(--r-sm); }            /* no top border — M3 filled */
.au-f__box:hover                  { background:var(--s-high); }
.au-f.foc .au-f__box              { background:var(--s-lowest);
                                    box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--primary) 40%,transparent); }
.au-f__l                          { transform:translateY(-50%); font-size:13.5px; }
.au-f__l.up                       { transform:translateY(-19px) scale(.82); }  /* 220ms --ease-emph */
.au-f__line                       { height:1px; background:var(--outline); }
.au-f.foc .au-f__line             { background:var(--primary); transform:scaleY(2); }
.au-f.err .au-f__line             { background:var(--danger);  transform:scaleY(2); }
```

Label floats on focus **or** when the field has a value, so a browser autofill never leaves the label sitting on top of the text.

Mobile: box `58px`, buttons `50px`, and every `.au-link` gets a `44px` hit area.

### Password strength

Four segments. Score is length ≥ 8, length ≥ 12, mixed case, digit + symbol — capped at 4, labelled `Too short / Weak / Fair / Good / Strong`, coloured `--danger / --warn / #0082c6 / --ok`. Submit is gated at **score ≥ 2**, not at 4; a hard gate at "strong" makes people append `!1`.

### States per screen

| Screen | States built |
|---|---|
| Login | empty · inline field errors · invalid-credentials banner + form shake (`420ms cubic-bezier(.36,.07,.19,.97)`) with attempts remaining · loading · success |
| Signup step 1 | inline per-field validation · **email already registered** with log-in and reset links inline · strength meter · loading |
| Signup step 2 | industry chips (drives onboarding preselection) · team size · skip |
| Forgot | default · invalid email · **no account found** · sent, with a 60s resend countdown |
| Reset | strength · live confirm match (green tick / red cross) · success · **expired link** |
| Accept invite | new user (name + password) · existing user (link to current account) · shows org, inviter, role **and the module grants** · decline |

**Never disclose account existence.** The forgot-password success copy is deliberately conditional — "If that address has an account…". The `no account found` state in this prototype exists to show the design; wire the real endpoint to return success either way.

---

## Landing page

Sections: nav → hero → module showcase (15) → five alternating feature sections → pricing → trust → CTA → footer.

- Nav is transparent over the hero and becomes `rgba(var(--glass-tint),.82)` + `blur(18px) saturate(1.6)` past `scrollY > 24`.
- Reveal on scroll is one `IntersectionObserver` adding `.in` (`opacity 0→1`, `translateY(18px)→0`, `--dur-xslow`), unobserving after fire. `prefers-reduced-motion` shows everything immediately.
- Hero parallax uses `requestAnimationFrame` on a passive scroll listener, `translate3d` only, coefficients `-0.04 / 0.07 / -0.10 / 0.12`. Below 860px the floating cards become static stacked cards and the transform is forced off.
- **The product visuals are real app components** — `.board`, `.pipe`, `.tbl`, `.msg` from `app.css` — not drawn illustrations. What the page promises is what the app renders. Keep this when implementing; do not swap them for screenshots that will drift.
- Pricing figures are **placeholders** and contradict the real plan model (see `SETTINGS-ADMIN-SPEC.md`: plans are `free/starter/growth/scale` with negotiated prices). Reconcile before launch.
- Integration logos are **text wordmarks standing in for real assets**. The SOC 2 badge is **removed** — Aekam is not certified, and the slot now carries a true claim (data residency) instead.

---

## Onboarding wizard

Five steps: Welcome · Modules · Team · First project · Done. Progress bar plus a labelled step rail; steps slide `±26px` with `--dur-slow` `--ease-emph`, direction following travel.

**Every step auto-saves** to `kv_onboarding` (`{step, mods, invites, proj, tpl, industry}`) — persist server-side too, keyed on the user, so dropping off on a phone resumes on a laptop. The footer says so out loud.

Step 2 preselects from the **industry answered at signup**:

```js
'CA / Legal practice': ['kartavya','ganit','graha','esign']
'IT Services':         ['kartavya','graha','sanvaad','dristi']
'Manufacturing':       ['kartavya','ganit','vikray','manav','pahchan']
'Retail & Trading':    ['ganit','vikray','graha','pahchan']
'Agency':              ['kartavya','graha','prachar','srijan','sanvaad']
'Consulting':          ['kartavya','graha','ganit','dristi']
'Other':               ['kartavya','graha','ganit']
```

Sensitive modules (Ganit, Manav, Vetana) carry a lock tag and switch the card's accent to `--danger` when on. **They are never granted per member** — access follows the org role (Owner and Org admin only), so the step says so rather than implying a grant will follow individually.

Step 3 accepts a single email or a pasted list (split on `[,\s\n;]+`), validates each, names duplicates, and shows an honest empty state rather than nagging. Step 4 templates only seed columns and labels. Step 5 summarises what was actually created and offers three tips — no confetti; a checkmark that draws itself over a slow radial bloom.

Skip is available per step **and** wholesale from step 1. Nothing here is load-bearing.

---

## Email templates

600px, table layout, inline styles, `role="presentation"` on every layout table, no flexbox or grid, no external CSS. Devanagari is declared with a `Georgia, serif` fallback — most clients render the fallback, which is acceptable.

| Template | Subject | Notes |
|---|---|---|
| Welcome | Aekam Inc is ready — welcome to Kartavaya | one primary action, three orienting tips |
| Invitation | Keval Shah invited you to Aekam Inc on Kartavaya | shows the **grants**, not just the org; decline is quieter |
| Password reset | Reset your Kartavaya password | expiry, sign-out side effect, request origin, plain-text URL fallback |
| Support access | Aekam support is asking for 2 hours of access to Aekam Inc | violet keyline = platform not tenant; agent's reason quoted verbatim; **cannot be unsubscribed** |

Every template ends with why it was received. The three transactional ones carry no marketing footer.

---

## API endpoints

```
POST /v1/auth/signup            { name, email, password }
POST /v1/auth/orgs              { name, industry, team_size }   → org, then /onboarding
POST /v1/auth/login             exists
POST /v1/auth/oauth/google      new — id_token exchange
POST /v1/auth/magic-link        new — request; GET /v1/auth/magic-link/:token to consume
POST /v1/auth/forgot-password   exists — must return 200 regardless of account existence
POST /v1/auth/reset-password    exists
POST /v1/auth/accept-invite     exists — add the existing-user branch (no password needed)
GET  /v1/onboarding             resume state
PATCH /v1/onboarding            per-step autosave
POST /v1/onboarding/complete    applies modules, sends invites, creates the project
```

---

## Still open

- Desktop split-screen auth and the hero parallax have only been checked below 1024px.
- Landing pricing must be reconciled with the real plan model before it goes public.
- Gujarati and Hindi locale variants of all four emails.
