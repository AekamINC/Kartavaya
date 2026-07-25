# Email system + /approve landing screen

Six design artifacts. Five HTML emails sent from the backend, plus one
public landing page that opens when the recipient clicks an Approve link in
an email.

Open `Email System.html` in this folder for the full design canvas — all six
artifacts at once, with focus mode for each.

---

## 1. Transactional emails

All emails share the same envelope: warm paper background (`#F6F3EC`), a
white card with `--rule` border, Newsreader display heading paired with a
Devanagari subtitle, single dominant CTA in the brand gradient, signed off
with the Bhagavad Gita tagline on welcome emails.

| # | Trigger | From → To | Subject | CTA(s) | Backend file (existing) |
|---|---|---|---|---|---|
| 1 | Admin invites a new user | Admin → invitee | `[Admin] invited you to [Workspace] on Kartavya` | **Accept invite** / View workspace | `email_service.py` → `send_invite()` |
| 2 | User accepts invite & signs in for the first time | System → new user | `Welcome to Kartavya, [Name]` | **Open Kartavya** / Quickstart | `email_service.py` → `send_welcome()` (NEW) |
| 3 | Client submits a new task request | Client → admin + project owners | `Approval needed: [task title]` | **Approve & queue** / Decline with reason (magic-link to `/approve`) | `email_service.py` → `send_approval_request()` (NEW) |
| 4 | Admin approves a client's request | System → client | `Your request was approved` | **View task** / Open portal | `email_service.py` → `send_request_approved()` (NEW) |
| 5 | Task completed by a team member | Team → client/requester | `Done: [task title]` | **Approve & close** / Send back with notes | `email_service.py` → `send_task_done()` (NEW) |

### Production templating

The designs in `Email System.html` use modern CSS (flex, `color-mix`, custom
properties). Real email clients — especially **Outlook on Windows** and
mobile Gmail clipping — need table-based layouts and inline styles. Convert
each email to a Mailchimp-style template:

1. Wrap the envelope in a `<table>` with `cellpadding="0"`, `cellspacing="0"`,
   `border="0"`, centered with a 100% outer table.
2. Inline every CSS rule with [premailer](https://github.com/peterbe/premailer)
   or similar. Keep `--font-display` as a literal `font-family: "Newsreader", Georgia, serif;`.
3. Replace `color-mix(in srgb, …)` with the pre-computed hex (the docs in
   `DESIGN_TOKENS.md` already list these — e.g. mix(danger 8%, surface) ≈ `#F8E9E5`).
4. Replace flex/grid with `<td>` columns. The "row" pattern (`em__row`)
   becomes a 2-column table per row.
5. Replace gradient backgrounds with bulletproof VML for Outlook + a
   `background-image` fallback. [Buttons.cm](https://buttons.cm/) generates
   the boilerplate.
6. Host fonts via `<link>` (Gmail/Apple Mail) AND list system fallbacks
   (`Georgia`, `serif`) — Outlook will not load web fonts.
7. Use absolute URLs for every asset, including the wordmark if it ever
   becomes an image (currently it's pure text).
8. Test with [Email on Acid](https://www.emailonacid.com) or
   [Litmus](https://litmus.com) — minimum target list: Gmail web,
   Gmail iOS, Apple Mail macOS, Outlook 365 web, Outlook 2019 desktop.

---

## 1a. Mobile email compatibility — Gmail / Outlook / Apple Mail

**Target list (India-first):**

| Client | Min version | Notes |
|---|---|---|
| Gmail Android app | Android 15+ on Pixel/Samsung/Xiaomi/OnePlus | dominant in India |
| Gmail iOS app | iOS 17+ | second-most common |
| Apple Mail (iPhone) | iOS 17+ Mail.app | renders most modern CSS |
| Outlook mobile (iOS + Android) | Outlook 4.2400+ | uses Word rendering on desktop, WebKit on mobile — much friendlier on phones |
| Gmail web | Latest | both desktop and mobile browser fallback |
| Outlook 365 web + Outlook 2019/2021 desktop | — | the strictest renderer — drives the table-based markup decision |

**Hard rules** (apply to every template before sending to SES):

1. **No `display: flex` or `display: grid`** in production HTML. Use
   `<table>` with `align="left"` for side-by-side, `<table>` stacked for
   columns. The prototype uses flex/grid only for the design review.
2. **No CSS custom properties (`var(--…)`)**. Premailer expands them; if a
   property survives, Outlook 2019 drops it. Bake every color to a literal
   hex.
3. **No `color-mix()`**. Pre-compute the resulting hex (see
   `DESIGN_TOKENS.md` for the mix-to-hex conversions used in the design).
4. **No web fonts as the primary stack**. Always end the font stack with
   `Georgia, serif` (for Newsreader) or `Helvetica, Arial, sans-serif`
   (for Inter). Outlook desktop ignores `@import` and `<link>` fonts.
5. **Devanagari text renders fine on every modern Android + iOS** without a
   web font — both ship Noto Sans Devanagari (Android) or Devanagari MT
   (iOS) by default. Keep `font-family: "Tiro Devanagari Hindi", "Noto Serif Devanagari", serif`
   so the web font is used where available and the system font is the
   fallback. **Do not rasterize Devanagari to images** — text remains
   selectable, accessible, and scales for users with larger system font
   sizes on Android 15 / iOS 17.
6. **Minimum tappable target 44×44px** for every link and button. The
   current CTA padding (`13px 22px` + 14px text) puts the hit area at
   ~46×44 — pass. Don't shrink in production.
7. **Minimum body text 14px**; iOS Mail auto-bumps below 13px which
   reflows the whole email and breaks the layout. Current design uses 15px
   body / 14.5px secondary — pass.
8. **No fixed-width content > 600px** on the outer table — the prototype's
   640px envelope is intentional but the real email should sit on a
   600px table with the envelope padding inside that. Gmail iOS will
   horizontal-scroll anything wider than ~620px on iPhone 15/16 portrait.
9. **Single-column on narrow screens.** Wrap the side-by-side CTA buttons
   (Approve + Decline) in a stacked layout under
   `@media screen and (max-width:480px) { .em__cta-row td { display:block; width:100%; }}`.
10. **Dark mode handling** — both iOS 17 Mail and Gmail iOS auto-invert
    light emails to dark. Add `@media (prefers-color-scheme: dark)` rules
    to lock the paper-canvas surfaces:

    ```css
    @media (prefers-color-scheme: dark) {
      .em__envelope { background:#0B1828 !important; border-color:#1A2A45 !important; }
      .em__h1, .em b { color:#E6EEFC !important; }
      .em__lede, .em p { color:#B0BDD4 !important; }
      .em__card { background:#122035 !important; border-color:#1A2A45 !important; }
    }
    ```

    Use `!important` because Gmail and Outlook ignore non-`!important` rules
    in dark-mode media queries.
11. **No images for content.** The designs are entirely text + CSS — no
    images means no broken hotlinks, no privacy-tracker blocking, no
    slow loads on Indian mobile networks. **Keep it text-only.** The only
    image-like element is the avatar circle, which is a CSS background.
12. **Preheader text** — first 80 chars hidden as preview text:

    ```html
    <div style="display:none;font-size:1px;color:#F6F3EC;line-height:1px;mso-hide:all;">
      Keval has invited you to Aekam Inc on Kartavya — accept by May 21.
    </div>
    ```
    Write a unique preheader for each of the 5 emails.
13. **From / Reply-to** — send as `Kartavya <hello@kartavya.app>` with
    `Reply-To` set to the actor's email so admin replies route correctly.

**Quick visual test matrix** (do this before production rollout):

| Email | iOS 17 Mail | Gmail iOS | Gmail Android 15 | Outlook iOS | Outlook desktop |
|---|---|---|---|---|---|
| 1 Invite | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2 Welcome | ✓ | ✓ | ✓ | ✓ | ✓ |
| 3 Approval request | ✓ + tap Approve goes to /approve | ✓ | ✓ | ✓ | ✓ |
| 4 Approved | ✓ | ✓ | ✓ | ✓ | ✓ |
| 5 Task done | ✓ | ✓ | ✓ | ✓ | ✓ |

Run this in [Email on Acid](https://www.emailonacid.com) once; SES doesn't
need to be involved until the templates pass.

### Variables to interpolate

Use whatever templating system the backend already uses (the README mentions
AWS SES — they take Jinja2-style variables in template definitions).

| Variable | Used in emails | Example value |
|---|---|---|
| `recipient_name` | All | `Aanya Mehta` |
| `recipient_first_name` | 1, 2, 4, 5 | `Aanya` |
| `actor_name` | 1, 3, 4, 5 | `Keval Shah` |
| `actor_role` | 1, 3 | `Admin` |
| `workspace_name` | 1, 2 | `Aekam Inc` |
| `workspace_hindi` | 1 | `मुख्य कार्यस्थल` |
| `invite_url` | 1 | `https://kartavya.app/accept-invite?token=…` |
| `invite_expires_at` | 1 | `May 21, 2026` |
| `task_id` | 3, 4, 5 | `KAR-502` |
| `task_title` | 3, 4, 5 | `Update invoice template — add CGST/SGST split` |
| `project_name` | 3, 4, 5 | `Mumbai client review` |
| `project_hindi` | 3, 4, 5 | `समीक्षा` |
| `priority` | 3, 4 | `High` |
| `due_date` | 3, 4 | `May 22, 2026` |
| `requester_note` | 3 | "The CA flagged this in last month's review…" |
| `approve_url` | 3, 5 | `https://kartavya.app/approve?token=…` |
| `reject_url` | 3, 5 | `https://kartavya.app/approve?token=…&action=reject` |
| `assignees` | 4 | `Keval Shah, Vikram Joshi` |
| `time_spent` | 5 | `3h 20m across 2 sessions` |
| `completer_name` | 5 | `Vikram Joshi` |
| `completer_note` | 5 | "Added the CGST/SGST split…" |
| `attachments[]` | 5 | `[Invoice_v3.pdf, Reconciliation_Apr.xlsx]` |

---

## 2. `/approve` — magic-link approval landing

A public route (no auth shell, no sidebar, no topbar) that opens when an
admin clicks the **Approve & queue** or **Decline** link in an email.

### Behavior

```
GET /approve?token=<jwt>
  → validate token via GET /api/approvals/by-token/<jwt>
  → if valid, render the approval landing page (Email System.html → ApproveScreen)
  → if invalid/expired/used → render the error variant (TBD — design as a follow-up if needed)

POST /api/approvals/by-token/<jwt>/approve
  → mark task status: requested → todo
  → send EmailApproved (#4) to the requester
  → render success state ("Approved — opening Kartavya in 3…")

POST /api/approvals/by-token/<jwt>/reject
  → reveal the "Reason" textarea inline
  → on submit: mark task status: requested → rejected (soft delete)
  → send a "Request declined" variant of EmailApproved with the reason
  → render success state
```

### Token

JWT, signed by the backend, single-use. Payload:

```json
{
  "approval_id": "appr_4f9a82c",
  "approver_user_id": "u_keval",
  "kind": "task_request",
  "exp": 1779648458,
  "jti": "tok_4f9_a82c"
}
```

After successful approve/reject, server marks the `jti` as consumed in a
small `consumed_tokens` table so the link can't be replayed.

### Page structure

Two-column layout (`1.5fr / 1fr`):

- **Left column** — Kicker, big Newsreader headline ("X needs your sign-off"),
  Devanagari sub, lede paragraph. Below, a single editorial card with the full
  request details: task title, props grid (project, priority, requested by,
  submitted, target date, suggested assignee), description, requester notes.
- **Right column** — Action card (big green Approve button, ghost Decline
  button, helper text), then a small metadata card showing the token, expiry,
  approver, source email — visible so the admin can verify they're approving
  the right thing.

### What this is **not**

Not a login screen. Not a dashboard. Not a redirect. The whole point of the
magic link is that one-click approval works without forcing the admin to
sign in on their phone. The token IS the authentication.

If an admin opens the link on the same device where they're already signed
in to Kartavya, the topbar shows "Signed in as Keval Shah" with a link to
the full dashboard — but the approval can still be done from this page.

---

## 3. Backend changes (out of scope for the frontend handoff)

Listed here so the backend owner knows what's needed:

| File | Change |
|---|---|
| `backend/email_service.py` | Add `send_welcome`, `send_approval_request`, `send_request_approved`, `send_task_done`. Reuse `send_invite`. |
| `backend/approvals_router.py` | Add `kind="task_request"` rows. Add `GET /api/approvals/by-token/<jwt>` and `POST .../approve` and `POST .../reject`. |
| `backend/server.py` | Add `requested` to STATUS enum. Gate `POST /api/tasks` so client users land in `requested`. |
| `backend/utils.py` | JWT sign/verify helpers for approval tokens (single-use, embedded `jti`). |
| `backend/migrations/` | New migration: add `requested` to status enum; add `consumed_tokens` table. |
| AWS SES template registration | Upload the 5 new HTML templates after they're converted to table-based form. |

---

## 4. Files in this folder

```
prototype/emails/
├── README.md                ← this file
├── Email System.html        ← design canvas — open this to review
├── email-styles.css         ← editorial design tokens for emails + /approve
├── email-components.jsx     ← React components for all 6 designs
└── design-canvas.jsx        ← canvas host (starter component)
```
