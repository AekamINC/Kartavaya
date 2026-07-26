# Design source map — where the specification actually lives

Verified 2026-07-26 against the owner's final design zip (`Kartavya (2).zip`).
The zip is **byte-for-byte identical** to what is already committed here. There is
no newer source elsewhere. Everything below is in this repo.

If a spec you need is not listed here, it does not exist — say so in your report
rather than inventing it. One earlier agent was told `SettingsPage.jsx` was specced;
it never was.

---

## 1. `design-handover/` — the written specs (28 files)

Prose specifications, numbered. `00`–`27`. These say what to build.

Two files here are **mine, not the designer's** — they are working notes, not spec:
- `_IMPLEMENTATION-LEDGER.md`
- `_REQUEST-2026-07-26.md`

## 2. `design-reference/Kartavaya Redesign/` — the reference implementation

**This is where pixel-perfect actually lives.** The `.md` files tell you the intent;
these files ARE the answer. Read the JSX and CSS, don't approximate from prose.

| What | Files |
|---|---|
| Tokens, the root source | `tokens.css` |
| Component CSS | `components.css`, `app.css`, `auth.css`, `landing.css`, `settings.css`, `mobile.css`, `onboarding.css`, `pahchan.css`, `blueprint.css` |
| **Motion** | `MOTION-SPEC.md` + `motion.css` |
| Reference components | `Components.jsx`, `Components2.jsx`, `Components3.jsx`, `Chrome.jsx`, `Picker.jsx` |
| Interaction behaviour | `IxKit.jsx`, `IxWork.jsx`, `IxViews.jsx`, `IxDrawer.jsx`, `IxChat.jsx`, `IxFiles.jsx`, `IxOverlays.jsx` |
| Screens | `ScreensCore.jsx`, `ScreensWork.jsx`, `ScreensBiz.jsx`, `ScreensMore.jsx`, `ScreensRBAC.jsx`, `ScreensRBAC2.jsx`, `ScreensSanvaad.jsx`, `ScreensVarta.jsx`, `ScreensPlatform.jsx`, `ScreensPahchan.jsx`, `ScreensThin.jsx` |
| Auth | `AUTH-SPEC.md`, `Auth.jsx`, `AuthForms.jsx`, `Auth Screens.html` |
| Mobile | `Mobile.jsx`, `MobileBoard.jsx`, `MobileTask.jsx`, `MobileModules.jsx`, `MobileMore.jsx`, `Mobile App.html` |
| Pahchan | `PahchanClock.jsx`, `PahchanAdmin.jsx`, `PahchanReview.jsx`, `PahchanData.jsx`, `Pahchan v1.html` |
| Settings / org / admin | `SETTINGS-ADMIN-SPEC.md`, `SetOrg.jsx`, `SetAdmin.jsx`, `SetCustomize.jsx`, `Settings.html` |
| Messaging + attendance | `MESSAGING-ATTENDANCE-SPEC.md` |
| RBAC | `RBAC-SPEC.md` |
| Landing | `Landing.jsx`, `Landing2.jsx`, `Landing Page.html` |
| Onboarding | `Onboarding.jsx`, `Onboarding.html` |
| Rendered mockups | `Kartavaya Redesign.html`, `Component Inventory.html`, `Interaction Catalogue.html`, `System Blueprint.html`, `Start Here.html` |

## 3. `design-reference/Kartavaya Redesign/docs/` — PRINT DOCUMENTS

Eight print-ready documents on a vendored `<doc-page>` web component.
**This is the specification for every PDF this product generates.**

- `doc-page.js` — the component itself
- `brand.css` — the print brand layer
- `Tax Invoice.html`
- `Payslip.html`
- `Quotation.html`
- `Statement of Account.html`
- `GSTR-3B Summary.html`
- `TDS Challan.html`
- `Service Agreement.html`
- `Project Report.html`
- `Document Kit.html`

Note: `design-handover/18-documents.md` describes THESE, not file attachments.
Attachments, drop zones and the lightbox are specced in `03` §5 and `13`.
That mistake has been made before.

## 4. Email

- `design-reference/Kartavaya Redesign/Auth Emails.html` — auth email templates
- `design-reference/Email System.html` — the email system
- `design-reference/email-components.jsx`, `email-reports.jsx`, `email-reports-scale.jsx`
- `design-reference/email-styles.css`, `email-reports.css`
- `design-reference/Report PDF.html`

## 5. Other reference at `design-reference/` root

`CLAUDE-CODE-START-HERE.md`, `CLAUDE_CODE_HANDOFF.md`, `ANTIGRAVITY_HANDOFF.md`,
`SKILL.md`, `guidelines/`, `components/`, `assets/`,
`Kartavya App.html`, `Kartavya Mobile.html`, `design-canvas.jsx`,
`design_handoff_kartavya_v2/`

---

## Known spec defects — the spec is wrong, not the code

Do not "fix" the code to match these. Record any new ones you find.

- **`24-bilingual-devanagari.md` instructs using `--font-indic` for fixed Devanagari.**
  Wrong. Under an EN+GU preference that resolves to Noto Sans Gujarati, which has
  **zero Devanagari coverage** — roughly 25 surfaces broke at once. Fixed Devanagari
  takes `--font-hindi` (Tiro).
- **Tooltip delay: `02` says 400ms, `26` says 300ms.** Build follows 26.
- **`26` §5 specifies `aria-selected` on a segmented control** — invalid on
  `role="radio"`. The standard wins; two agents independently chose it.
- **`00` §2 names Public Sans as the `--font-ui` default.** It is not loaded in
  `index.html`; CSS, `DEFAULTS` and `UI_FONTS[0]` all say Inter. Aspirational.
  Keep Inter unless the font is loaded first.
- **`20-search-palette.md`:170 claims `SigningPage` appears in no handover file.**
  It is specced at `13-module-pages.md` §191.
- **`02` specifies no icons at all**, and `components/icons/**` does not exist —
  icons live in `frontend/src/layout/navIcons.jsx`.
- **`24`'s own "No" list is violated in ~6 places** (content, not font): Devanagari
  in table column headers, input placeholders, and error text.

## Standing owner rules that override any spec

- **No pricing figures anywhere** — not in UI, not in comments, not in docs.
- Brand is **Kartavaya**; domain is **kartavaya.com**.
- All pages fluid and left-aligned. No fixed-width centring.
- Accessibility beats fidelity. A spec'd colour pair below 4.5:1 for body text is a
  spec defect to report, not a thing to ship.
