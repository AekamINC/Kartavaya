# Email verification — every outbound message in `backend/`

Branch `verify/emails`, cut fresh from `origin/staging` @ `0a69bef1`.
Backend suite after changes: **1459 passed, 31 skipped, 0 failed** (baseline 1450 + 9 new tests).

**Nothing was sent.** Every verdict below comes from rendering a template to a
string and asserting on it, with `OUTBOUND_MODE=dry` and no provider client
constructed. `process_payroll` was never called; template 25 was verified by
rendering the builder it uses.

---

## The one answer that matters

> **Is there any template that sends to an external person — a client's customer —
> that does NOT match the design?**

**Yes. Three, and one of them is not merely off-design, it is dead.**

1. **Ganit contract signature request** and **2. Ganit signing OTP**
   (`services/esign_service.py:66` and `:114`) — an accounting firm sends an
   engagement letter to its client through
   `POST /api/ganit/contracts/{id}/send-for-signature`. Both emails import
   `from services.email_service import send_email`. **That module does not
   exist** — `email_service` lives at the backend root. The `ModuleNotFoundError`
   is swallowed by the surrounding `except Exception`, logged as
   `"Failed to send signing email"`, and the endpoint still returns
   `{"status": "sent"}`.

   So the client never receives the request. And because the OTP mail is broken
   the same way, even a signer who is handed the link out of band can never pass
   the second factor. **That signing flow cannot complete.** The markup those two
   would send, if the import were fixed, is a bare `<p>` blob — no envelope, no
   lockup, no footer, no preheader.

   There is also a token defect in the same function. `send_for_signature`
   (`services/esign_service.py:41-72`) builds `sign_url` from
   `created[...].get('_token', token)`. No dict in `created` ever carries a
   `_token` key, so it always falls through to `token` — the loop variable,
   holding the **last** signer's token. Every signer would be sent the same
   link, and whoever opened it first could sign as somebody else. Fixing the
   import without fixing this would turn a dead feature into a signature-forgery
   vector, which is why I did not enable it.

3. **Prachar marketing campaign** (`routers/prachar.py:399`) — goes to the
   customer's own contact list, i.e. strangers. Not on the shell, and **carries
   no unsubscribe link and no `List-Unsubscribe` header**. The suppression list
   (`staging.prachar_unsubscribes`) is honoured on send, but nothing in the mail
   gives a recipient any way to get onto it. There is no physical postal address
   in the body either — the shared footer says "Aekam Inc · Ahmedabad, IN", a
   city, not an address.

The **e-sign request on the `sign_documents` path** (`routers/esign.py`,
template 27) — the other e-sign implementation, and the one wired to the Hastakshar
module — is on the shell and **matches**. There are two parallel e-sign
implementations in this codebase; only one of them can send mail.

---

## Verdict table

Legend — **matches**: on the shell, structure/brand/escaping all clean.
**differs**: renders correctly, content or behaviour departs from the spec.
**broken**: does not reach the recipient, or reaches them wrong.

### On the design shell — built by `email_service._base()`

| # | Template | Trigger | Verdict | What differs | Evidence |
|---|---|---|---|---|---|
| 01 | Invite | `POST /api/invites` (`invite_router.py:361`); `POST /api/orgs/{id}/invites` (`org_invites.py:222`) | **differs** | Spec's own note on `Auth Emails.html` #invite: *shows the **grants**, not just the org*. Card shows `WORKSPACE / INVITED BY / YOUR ROLE / EXPIRES` — one org role, no per-module grants. The data is already computed at `org_invites.py:262` (`grants`) and simply not passed. Reference footer also has a "Report this invite" link; implementation has none. | Rendered; harness PASS; geometry/colour identical to reference |
| 02 | Welcome | `POST /auth/accept-invite` (`auth_router.py:459`) | **differs** | Subject is `"Welcome to Kartavaya"`; spec META says `"Aekam Inc is ready — welcome to Kartavaya"` (names the org). Preheader differs from spec text. Body is a 4-step Devanagari-numeral list; reference is "Three things worth knowing" (⌘K, add to phone, invite team). Reference has **one** primary action; implementation adds a ghost "Read the quickstart" pointing at the same `/dashboard` URL. | Rendered; harness PASS |
| 03 | Password reset | `POST /auth/forgot-password` (`auth_router.py:572`); `POST /api/users/{id}/send-reset-link` (`invite_router.py:457`) | **differs** | Two gaps. (a) Copy states *"Setting a new password signs out every other device."* **It does not.** `reset_password` (`auth_router.py:594`) rewrites the hash and issues a new JWT; there is no token store, so existing sessions stay valid — stated outright in `auth_router.py:508`. The email makes a security promise the product does not keep. (b) Reference footer carries the request origin (`Requested from Mumbai, IN · 103.21.x.x · 25 Jul 2026`); implementation omits it. Subject, preheader, expiry copy, sign-out sentence, amber notice and fallback URL all match. | Rendered; harness PASS; `auth_router.py:594-613` read |
| 04 | Support access | — | **broken (never wired)** | Fully specced in `Auth Emails.html` #support, and `21-notifications-inbox.md` says this email *cannot be switched off*. **No caller exists anywhere in `backend/`.** The builder is only reachable from the preview harness. Also: reference recolours the lockup subtitle to "Platform support request" in `#7C5CBF` and renders Deny in danger red inside a bordered box; the shell renders the violet keyline but keeps "by Aekam Inc" and a grey ghost link. | Grep across `backend/`: zero call sites |
| 05 | Approval request | `POST /api/client/tasks/request` (`server.py:1394`); `POST /api/approvals` (`server.py:1566`); `POST /api/tasks/{id}/request-client-approval` (`approvals_router.py:432`) | **differs** | `Email System.html` wraps the buttons in an `em__bigcta` block with a framed question — *"Move this into the team's queue?"*. Implementation renders a bare CTA row. Kicker, both button labels and the follow-up sentence match verbatim. | `email-components.jsx:184-190`; rendered |
| 06 | Request approved | `POST /api/approvals/{id}/review` (`server.py:1681`) | **matches** | — | Kicker, CTA pair ("View task" / "Open portal") match `email-components.jsx:244` |
| 07 | Task done → client | task moved to done (`server.py:2423`) | **differs** | Same missing `em__bigcta` frame — spec question is *"Looks good?"*. Labels "Approve & close" / "Send back with notes" match. | `email-components.jsx:295-301` |
| 08 | Task assigned | assignment (`server.py:2356`) | **matches** | — | Rendered; harness PASS |
| 09 | New comment | — | **broken (dead code)** | `send_comment_email` (`email_service.py:866`) has **no caller**. Comment notifications reach in-app and push only. `comment` is a live kind in `DEFAULT_PREFS`. | Grep: definition only |
| 10 | Mention | `services/mentions.py:110` | **matches** | — | Rendered; harness PASS |
| 11 | Task due reminder | `routers/task_reminders.py:139` (cron) | **matches** | — | Rendered; harness PASS |
| 12 | Client approved → team | `POST /api/tasks/{id}/client-approve` (`approvals_router.py:508`, `:609`) | **matches** | — | Rendered; harness PASS |
| 13 | Decision — approved | `approvals_router.py:181` | **matches** | — | Rendered; harness PASS |
| 14 | Decision — rejected | `approvals_router.py:181` | **matches** | — | Rendered; harness PASS |
| 15 | Status changed | `server.py:2400` | **matches** | — | Rendered; harness PASS |
| 16 | Daily report | `routers/reports.py:481` (dispatch cron) | **broken (provider)** | `send_report_email._send()` guards on `if not ses_client` only. **Resend is the primary provider** (`email_service.py:25`) — when `RESEND_API_KEY` is set, `ses_client` is `None`, so this branch logs `[EMAIL-DEV]` and returns. No report is delivered and no error is raised. The PDF/XLSX attachments exist only on the SES path. | `email_service.py:1228`; provider selection at `:25-46` |
| 17 | Weekly report | as above | **broken (provider)** | Same. HTML itself renders correctly. | as above |
| 18 | Monthly report | as above | **broken (provider)** | Same. Gita block renders only here (`show_gita`), matching `email-components.jsx:136`. | as above |
| 19 | Leave decision | `routers/manav.py:964` | **matches** | — | Rendered; harness PASS |
| 20 | Expense decision | `routers/manav.py:1918`, `:1949` | **differs** | **No CTA at all** — `body_rows=card`. Dead end; every sibling in this family links back to the module. | Rendered: zero `#04837A` fills |
| 21 | Announcement | `routers/manav.py:1147` | **matches** | Body escaped then `\n`→`<br>`, correctly matching the plain-`textarea` composer. | Rendered; harness PASS |
| 22 | Shift assigned | `routers/manav.py:1471` | **matches** | — | Rendered; harness PASS |
| 23 | Asset assigned | `routers/manav.py:2341`, `:2374` | **differs** | **No CTA.** | Rendered: zero fills |
| 24 | Loan update | `routers/vetana.py:1300` | **differs** | **No CTA.** | Rendered: zero fills |
| 25 | Payslip | `process_payroll` (`routers/vetana.py:675`) | **matches** | Attachment confirmed correct: `generate_payslip_pdf` is called per employee inside the loop and attached as `Payslip-{payslip_number}.pdf`; the "PDF is attached" line is conditional on `pdf_bytes`, so a run that fails validation does not claim an attachment it lacks. | `routers/vetana.py:694-713` read; template rendered. **Endpoint never called.** |
| 26 | Performance review | — | **broken (dead code)** | `send_performance_email` (`services/employee_email.py:254`) has **no caller**. | Grep: definition only |
| 27 | Signature request (Hastakshar) | `POST /api/esign/documents/{id}/send` (`esign.py:272`); resend (`:599`) | **matches** | On the shell, fallback URL present, transactional footer note. **This is the e-sign path that works.** | Rendered; harness PASS |
| 28 | Signing OTP (Hastakshar) | `POST /api/esign/verify/{token}/otp` (`esign.py:378`) | **matches** | Code correctly kept out of the preheader. | Rendered; harness PASS |
| 29 | Generic reminder | `services/reminder_service.py:138` (cron) | **matches** | Six reminder kinds, each with its Devanagari cue. | Rendered; harness PASS |

### Not on the shell — markup hand-written at the call site

None of these nine pass through `_base()`, so none has an envelope, lockup,
footer, preheader, dark-mode block, or escaping. All nine are **differs** at
minimum against both spec documents, which define one email system.

| # | Template | Trigger | Verdict | What differs | Evidence |
|---|---|---|---|---|---|
| 30 | Scheduled report "run now" | `routers/dristi.py:791` | **differs** | Bare `<p>` + `<pre>` dump of up to 5000 chars of raw JSON. Values *are* escaped (`html.escape`), so it is safe — just entirely undesigned. | Harness: `NOT ON THE SHELL` |
| 31 | Prachar campaign | `POST /api/prachar/campaigns/{id}/send` (`prachar.py:399`) | **differs — external** | No shell, **no unsubscribe link, no `List-Unsubscribe` header**, no postal address. `{{name}}`/`{{email}}`/`{{company}}` substituted **unescaped** (`prachar.py:394`). | Harness: 5 unescaped-payload hits |
| 32 | Automation `send_email` action | `services/automation_engine.py:54` | **differs** | Sends `cfg["html"]` verbatim. Recipient is validated as a workspace member first, which is the important control. | Harness: `NOT ON THE SHELL` |
| 33 | Ganit signature request | `POST /api/ganit/contracts/{id}/send-for-signature` (`esign_service.py:66`) | **broken — external** | See headline. Wrong module → never sends. Signer name unescaped. Token bug sends every signer the last signer's link. | `ModuleNotFoundError` reproduced |
| 34 | Ganit signing OTP | `POST /api/ganit/sign/{token}/otp` (`esign_service.py:114`) | **broken — external** | Same wrong module. Signing cannot complete. | `ModuleNotFoundError` reproduced |
| 35 | Employee welcome (skill) | `services/skills/action/onboarding_chain.py:37` | **differs** | No shell. `emp['name']` unescaped. | Harness: 2 unescaped hits |
| 36 | Contract expiring (skill) | `services/skills/action/document_expiry.py:46` | **differs** | No shell. `creator_name`, `title` unescaped. | Harness: 2 unescaped hits |
| 37 | Asset warranty expiring (skill) | `services/skills/action/document_expiry.py:89` | **differs** | No shell. | Harness: `NOT ON THE SHELL` |
| 38 | Notification fan-out (skill) | `services/skills/action/notification_fan_out.py:38` | **differs** | No shell. `body` interpolated raw into `<p>`. | Harness: 1 unescaped hit |

---

## Cross-cutting findings

**Notification preferences do not gate email — at all.**
`21-notifications-inbox.md` specifies `event → shouldDeliver(kind, prefs)` with
three channels, the third being `email if prefs.email[kind]`. `prefs_allow()`
exists and is correct, but its only two call sites are
`server.py:458` and `task_reminders.py:134` — **both push**. No email path in
`backend/` reads `notification_prefs`. Every notification email sends
unconditionally, at any hour, and the "Notification settings" link in every
footer changes nothing about email. This is the same class of defect
`push_service.py`'s own docstring describes as *"worse than a missing switch —
the user sets it, watches it save, and still gets the notification."*

**No security-alert emails exist.** The brief listed this as a known family.
`routers/org_security.py` contains no email code. There is no
password-changed confirmation, no new-device notice, no suspicious-login alert.
Combined with template 03's unkept sign-out promise, a stolen session is both
unrevokable and unannounced.

**Brand and typography are correct everywhere on the shell.** All 29 shelled
templates: 600px envelope, `#FCFAF5` surface, `1px #E2DCC9` border, 14px radius,
Georgia 27px `#1B1D1A` headline, `#04837A` button fill with `#FFFFFF` label —
byte-identical to `Auth Emails.html`. `--org-accent-2` `#0082c6` appears in
**zero** templates, which is correct: brand.css uses the secondary only for the
logo-mark gradient, the mark is shipped as a raster `<img>`, and Outlook drops
gradients. Every Devanagari run carries `lang="hi"`, `letter-spacing:normal`
and `text-transform:none` — checked by regex across every `<span>` containing
Devanagari, not just the ones with a `lang` attribute.

**Email-client reality holds on the shell.** No external stylesheet, no
webfont `<link>`, no `var(--…)`, no gradient, no flex/grid, tables with
`role="presentation"` throughout, inline styles, MSO conditional wrapper. One
remote image (`https://kartavaya.com/kartavaya-mark.png` — asset confirmed
present at `frontend/public/kartavaya-mark.png`) with `alt="Kartavaya"`, and the
wordmark beside it is live text, so a blocked-image inbox still reads
"Kartavaya · by Aekam Inc" rather than showing an empty letterhead.

**Escaping holds on the shell.** All 29 pass a hostile-fixture audit —
`<script>`, `<img onerror>`, an attribute-breakout quote payload, an org name
that *is* well-formed markup, RTL override, and Devanagari conjuncts — with no
double-escaping. A client name containing an apostrophe or `<` renders as text.
The six unshelled templates flagged above do not.

**Links are correct.** Every `href` in every rendered template is absolute and
on `kartavaya.com`. No `kartavya.com` anywhere. Query strings carry only opaque
tokens — no email addresses, names or ids.

---

## What I changed

Commit `fc9e75f3` on `verify/emails`. All inside `backend/`.

1. **Added a `text/plain` alternative to every email.** There was none anywhere:
   Resend got an `html` key alone, and both raw-MIME senders attached a single
   `text/html` part inside a `multipart/alternative`. New `to_plaintext()` in
   `email_service.py` rewrites anchors as `label <url>` rather than stripping
   them, so a magic link survives; drops the preheader's 30 invisible spacers;
   preserves Devanagari. Wired into `send_email`, `send_report_email` and
   `send_payslip_email` (text part attached first, so a text-only client picks
   it). 9 new tests in `tests/test_email_plaintext.py`.

2. **Removed `await` from six sync `send_email` calls** in
   `services/skills/action/`. Reproduced live: `send_email` threads internally
   and returns `bool`, so the `await` raised `TypeError` **after** the send
   thread had already started. The mail went out and the caller then recorded it
   as failed — campaign contacts written back `'failed'` and re-sent on the next
   run, and sequence enrolments never advancing, so the same step went to the
   same contact on every cron pass.

3. **Fixed the preview harness.** `preview_emails.py` did not set `JWT_SECRET`,
   so importing `routers/esign` raised and templates 27 and 28 dropped out as
   `RENDER ERROR` while the contact sheet still said 29 — the two that reach an
   external signer were the two nobody saw. It now also renders the nine
   unshelled senders, and `audit()` checks external stylesheets, flex/grid,
   missing `alt`, non-absolute hrefs, the kartavya/kartavaya spelling, and
   whether a document is on the shell at all.

Reproduce: `cd backend && python scripts/preview_emails.py` → 29 PASS, 9 FAIL.

**Deliberately not fixed**, because each enables or alters a send path and
wants your call before 15 August:
`services/esign_service.py` (fixing the import turns on two dead sends, one of
which would leak signer tokens — fix the token bug first);
`send_report_email`'s Resend branch (turns the report cron back on);
email/notification-preference gating; Prachar unsubscribe; the invite grants block.

---

## NOT VERIFIED

- **Rendering in real mail clients.** No email was sent to any inbox, so nothing
  here is confirmed in Gmail, Outlook desktop, Apple Mail or Gmail Android. The
  verdicts are static analysis of the HTML plus browser-rendered comparison
  against the reference. Outlook's Word engine in particular is asserted from the
  code's own documented rules, not observed.
- **Screenshots.** The browser pane would not composite
  (`"Browser pane is not displayed"`), so all visual comparison was done via
  `javascript_tool` (computed styles and attribute extraction on both the
  reference and the rendered output) and `read_page`. No image evidence exists.
- **Resend attachment encoding.** `services/employee_email.py:228` passes
  `"content": list(pdf_bytes)`. Whether Resend's Python SDK accepts a list of
  ints cannot be checked without calling the provider. **The payslip attachment
  is unverified on the Resend path.** It is correct on the SES path (raw MIME,
  base64).
- **Deliverability and DNS.** `FROM_EMAIL` defaults to
  `Kartavaya <no-reply@aekaminc.com>` while every link points at
  `kartavaya.com`. Whether SPF/DKIM/DMARC are aligned for the sending domain is
  outside this repo. A signature request arriving from a different domain than
  the one it links to is a trust and deliverability question worth answering
  before 15 August.
- **No `Reply-To` on any transactional email.** Every `send_email` call passes
  `reply_to=None`, so a client's customer replying to a signature request or an
  invoice reaches `no-reply@`. Whether that mailbox is monitored is unknown.
- **The two spec documents disagree and I resolved it by age.**
  `Email System.html` (title still reads "Kartavya", the old spelling) specifies
  a **640px** envelope; `Auth Emails.html` specifies **600px**. The
  implementation uses 600px. I treated the newer document as authoritative;
  confirm that is right.
- **Prachar campaign body** is authored by the customer in the composer, so
  "matches the design" is not a meaningful question for its content — only for
  the wrapper it does not have.
- **Live database.** Read-only throughout; no query was run against Supabase.
