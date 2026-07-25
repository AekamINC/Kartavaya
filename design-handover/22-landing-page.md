# Landing Page

## Prerequisites
- `00-tokens.md`, `02-common-components.md`
- `12-auth-onboarding.md` — where the CTAs go, and the invite-only problem
- `19-client-portal.md` — the same "a stranger is reading this" constraint

## Files to modify
- `frontend/src/App.jsx` — a public unauthenticated route at `/`
- `frontend/index.html` — meta, OG tags, title

## Files to create
- `frontend/src/pages/marketing/LandingPage.jsx`
- `frontend/src/pages/marketing/sections/` — `Hero`, `Modules`, `Features`, `Pricing`, `Trust`, `Footer`
- `frontend/src/styles/landing.css`

## Estimated scope
- 8 new files, 2 modified. Nothing existing is restyled — this surface does not exist yet.

---

## Not out of scope, and here is why

No public marketing page exists anywhere in the repo. `/` currently resolves to the app, which redirects to login.

It gets specced rather than waived because it is **the only surface a person sees before deciding whether to trust the product with their clients' GSTINs and bank details**. Every other screen in this handover is used by someone who has already decided. This one is read by someone who has not, in about forty seconds, probably on a phone, probably from a WhatsApp link sent by another CA.

## The blocking problem: the primary CTA has nowhere to go

The prototype's hero button says **Start free**. `12-auth-onboarding.md` records that staging is **invite-only** — there is no signup route, no signup endpoint, and `LoginPage.jsx` exports only login, accept-invite, forgot and reset.

So "Start free" is not a broken link to fix in CSS. It is a business-model question:

- **Open signup** — the CTA works as written, and `12`'s signup flow plus the onboarding wizard in `Onboarding.html` are already designed for it. Needs `POST /auth/signup`, email verification, and a decision about trial limits.
- **Stay invite-only** — the CTA becomes **Request a demo** or **Talk to us**, pointing at a form or a WhatsApp link. Honest, and appropriate for a product sold to CA firms through referral. Needs a lead capture endpoint and somewhere for those leads to land — plausibly Graha, which is the CRM this product already ships.

**Do not ship the page with "Start free" pointing at `/login`.** A visitor clicks it, lands on a password field for an account they do not have, and leaves. That is worse than no landing page.

Until this is decided, build the page with the CTA as a prop.

## Structure

```
LandingPage
├── Nav          transparent → solid on scroll, burger under 860px
├── Hero         headline · subhead · CTA pair · trust line · product visual
├── Modules      15 module cards, Hindi name leading
├── Features     3–4 alternating rows, each with a real product visual
├── Pricing      4 plans, credit-based
├── Trust        data residency, GST compliance, audit trail, backups
└── Footer       product · company · legal · language selector
```

## Product visuals are real app fragments

The prototype composes the hero and feature visuals from **actual app components** — a real task card, a real Sanvaad thread, a real invoice row — rendered small inside a browser frame, not drawn as illustration.

Keep this. Three reasons: the screenshots are always current because they are the components; an illustration of a UI is a promise the product has to keep, and it usually differs in a way that reads as bait; and it makes the marketing page a consumer of the design system, so a token change propagates here too.

The cost is that `landing.css` must load `app.css` for those fragments to render. Accept it — the alternative is a second copy of every component's styling.

## Pricing must match the real plan model

The prototype originally showed Free / Pro / Enterprise at ₹4,999. That was invented. The real model, from `AdminOrgsPage.jsx`:

| Plan | Credits/month |
|---|---|
| free | 200 |
| starter | 500 |
| growth | 1,000 |
| scale | 2,000 |

A credit is **one AI request against your own data** — say so plainly on the page, because "credits" means nothing to a CA and sounds like a metering trick.

**One thing to verify before this page goes public.** I originally had you change the prices to "On quote" because plans looked per-org negotiated. `AdminBillingPage.jsx` shows the plan catalogue **does** carry `price_monthly`, and modules carry `price_per_user_monthly`. Most likely a list price with a per-org override — but which one billing actually charges against is unconfirmed. If there is a real list price, publish it: a public price is a significant trust signal to a small firm, and "On quote" reads as "we will work out what you can afford".

Also: `AdminBillingPage.jsx` tells users to *"Upgrade to Professional or higher"* and **no Professional plan exists** in the catalogue. Fix that string wherever it appears before publishing any pricing page — the two must not contradict.

The monthly/annual toggle from the prototype is gone. It was meaningless without listed prices; restore it only if annual pricing genuinely exists.

## Trust — remove the claim we cannot make

The prototype's trust section carries a **SOC 2 badge**. That is a placeholder and must not ship. An unaudited SOC 2 claim to accounting firms is a compliance misrepresentation to exactly the audience that will check.

Replace with claims that are true and verifiable today:

- **Data stays in India** — if the R2 buckets and Postgres are in an Indian region. Verify before writing it.
- **GST-compliant invoicing** — GSTR-1 and GSTR-3B summaries, HSN, CGST/SGST/IGST. True, and `docs/` demonstrates it.
- **Every action is logged** — the audit trail from `08-rbac-screens.md`, including platform support access.
- **Your client's data is not visible to other clients** — the module-grant model from `08`.

Every claim links to something a visitor can inspect. A trust section that cannot be checked is decoration.

## Copy

Hindi module names lead in the module grid, because they are the product's actual vocabulary and a CA firm in Ahmedabad recognises गणित faster than "Invoicing". English is the supporting line. This is the one place the bilingual hierarchy inverts from `24-bilingual-devanagari.md`'s rule, and deliberately: on the marketing page the Devanagari **is** the differentiator, not a recognition cue.

No em-dash-heavy agency copy, no "revolutionise", no invented customer counts, no fabricated testimonials. If there are real customers willing to be named, that section is worth more than the rest of the page combined; if not, leave it out rather than inventing one.

## Styling

`landing.css` uses a marketing type scale over the same tokens — larger display sizes, more negative tracking, the same colours. `00-tokens.md` §2 still governs.

```css
.lhero__h{font-family:var(--font-display);font-size:clamp(40px,5.4vw,68px);font-weight:400;line-height:1.06;letter-spacing:-.034em}
.lsec{padding:82px 0}
.lwrap{width:min(1240px,100% - 44px);margin:0 auto}
```

Scroll reveals are `[data-rev]` → `.in` via `IntersectionObserver`, opacity plus 18px rise, and they must be **no-ops under reduced motion** — content that never appears because the observer did not fire is a blank page, so default to visible and let the observer remove the offset, never the reverse.

## Responsive

Three breakpoints: 1080 (hero and feature rows go single-column), 860 (nav collapses to a burger), 560 (padding tightens, CTAs go full-width).

The desktop two-column hero was verified above 1024px. Two fixes came out of that pass and are in the prototype: the plan cards' credit chips were 20px out of alignment because description height varied — pin the chip row with `margin-top: auto` rather than a fixed height; and four cards need a narrower track than `minmax(262px, 1fr)` gives at 1240px.

## Meta

```html
<title>Kartavaya — practice management for Indian accounting firms</title>
<meta name="description" content="…">
<meta property="og:image" content="/og-kartavaya.png">   <!-- 1200×630, real UI, not a logo on a gradient -->
```

Most visits will arrive from a WhatsApp link, which renders the OG card. That image is doing as much work as the hero.

## Performance

The page loads `app.css` for the product fragments, which is heavy for a marketing page. Acceptable, with two conditions: the landing route must not pull the authenticated bundle (no `AppShell`, no React Query provider, no auth context), and the fragments must be static markup — no data fetching, no `useEffect`, no skeletons. They are pictures that happen to be made of components.
