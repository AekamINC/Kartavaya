# Email — every message this product sends

Branch: `worktree-agent-adc88842edc7bd7c9`
Surface: **all outbound email.** `backend/email_service.py`, `backend/services/employee_email.py`,
and every ad-hoc HTML builder scattered across routers and skills.
Governing spec: `design-reference/Kartavaya Redesign/Auth Emails.html`,
`design-reference/Email System.html` + `email-*.jsx` / `email-*.css`,
`design-reference/Kartavaya Redesign/tokens.css`, `design-handover/24-bilingual-devanagari.md`.

> Written incrementally. Every line was confirmed at the time it was written.
> **No email was sent at any point.** The preview harness renders to disk and
> imports nothing from the send path — see §7.
>
> **Status: complete.** Interrupted once by the account spend limit; work was
> rescued from `rescue/adc88842edc7bd7c9`, rebased onto `origin/staging`, and
> finished. Sections 8–12 were written after that resume.

---

## 0 · Worktree correction (before any work)

This worktree was cut from **`main`**, not `staging`. HEAD was `1aa4985` — 13 commits
on the production line, **272 commits behind `origin/staging`**. Reset to
`origin/staging` (`666b0ea`) before touching anything. Nothing lost: `1aa4985` is
still `main`'s tip and every one of those 13 commits is contained in `main`.

This is the **second** independent agent to hit it —
`swarm-reports/worktree-agent-a07d018d5639fb583.md` §0 reports the identical HEAD
(`1aa4985`, 271 behind at the time). **The worktree cutter is branching from `main`.**
Any agent that did not check is editing a pre-redesign tree and its diff will not apply.

---

## 1 · Prior coverage — checked, and there is none

Task brief said other agents were inventorying auth/notification email. Searched
every `swarm-reports/*.md` that exists on any ref (`git log --all --diff-filter=A`,
12 reports). Exactly one mention of email anywhere:

- `worktree-agent-a07d018d5639fb583.md:5` lists "auth email templates" in its
  surface line — and then **never mentions email again** (`grep -i email` over the
  whole file returns that one line). That agent measured Devanagari font widths in
  `auth.css` for the login *screen*.

**No agent has touched an email template.** Nothing here is a duplicate.
Its font measurement *is* directly useful to me and I use it in §6.

---

## 2 · Inventory — every email the backend can send

35 send paths. `_base` = the designed shell in `email_service.py`.

### A · `backend/email_service.py` — 14 senders, all on the `_base` shell

| # | Function | Trigger (call site) | Subject | Designed version? |
|---|---|---|---|---|
| 1 | `send_invite_email` | `invite_router.py:315` invite created; alias `send_team_invite_email` | `{inviter} invited you to {workspace} on Kartavaya` | **YES** — `Auth Emails.html` #invite |
| 2 | `send_welcome_email` | `auth_router.py:201` register-via-invite | `Welcome to Kartavaya` | **YES** — `Auth Emails.html` #welcome |
| 3 | `send_password_reset_email` | `auth_router.py:278`, `invite_router.py:384` | `Reset your Kartavaya password` | **YES** — `Auth Emails.html` #reset |
| 4 | `send_approval_request_email` | `server.py:1211`, `server.py:1374`, `approvals_router.py:384` | `Approval needed: {task}` | **YES** — `Email System.html` artboard 3 |
| 5 | `send_request_approved_email` | `server.py:1489` | `Your request was approved: {task}` | **YES** — artboard 4 |
| 6 | `send_task_done_email` | `server.py:2224` | `Done: {task}` | **YES** — artboard 5 |
| 7 | `send_report_email` | `routers/reports.py:472` scheduled-report cron | `{Freq} Report: {team} ({from} to {to})` | **YES** — artboards 6/7/8/9 + `email-reports.jsx` |
| 8 | `send_task_assignment_email` | `server.py:2147` | `New task assigned: {task}` | no |
| 9 | `send_comment_email` | **no live call site** | `New comment on: {task}` | no |
| 10 | `send_mention_email` | `services/mentions.py:111` | `{actor} mentioned you` | no |
| 11 | `send_task_reminder_email` | `routers/task_reminders.py:111` | `Reminder: {task}` | no |
| 12 | `send_team_sync_email` | `approvals_router.py:455`, `:556` | `Client approved: {task}` | no |
| 13 | `send_approval_decision_email` | via `send_approval_notification_email`, `approvals_router.py:134` | `Task {approved\|rejected}: {task}` | no |
| 14 | `send_status_changed_email` | `server.py:2192` | `Task updated: {task}` | no |

### B · `backend/services/employee_email.py` — 8 senders, also on `_base`

| # | Function | Trigger | Subject | Designed? |
|---|---|---|---|---|
| 15 | `send_leave_decision_email` | `manav.py:819` leave approved/rejected | `Leave {Decision} — {type}` | no |
| 16 | `send_expense_decision_email` | `manav.py:1680`, `:1711` | `Expense {Decision} — {claim}` | no |
| 17 | `send_announcement_email` | `manav.py:994` (fan-out to all employees) | `Announcement — {title}` | no |
| 18 | `send_shift_schedule_email` | `manav.py:1293` | `Shift Assigned — {shift} on {date}` | no |
| 19 | `send_asset_email` | `manav.py:2086`, `:2118` | `Asset {Assigned\|Returned} — {name}` | no |
| 20 | `send_loan_email` | `vetana.py:1124` | `Loan {Status}` | no |
| 21 | `send_payslip_email` | `vetana.py:599` (PDF attachment) | `Payslip Ready — {month} ({no})` | no — `docs/Payslip.html` is the **PDF**, not the email |
| 22 | `send_performance_email` | **no live call site** | `Performance Review — {period}` | no |

### C · Off-design ad-hoc HTML — bypasses `_base` entirely

| # | Builder | Trigger | Subject | Designed? |
|---|---|---|---|---|
| 23 | `routers/esign.py::_build_signing_email` | `esign.py:278` send-for-signature, `:593` resend | `Please sign: {title}` / `Reminder: Please sign — {title}` | no |
| 24 | `routers/esign.py::_build_otp_email` | `esign.py:380` signer OTP | `Your signing verification code` | no |
| 25 | `services/reminder_service.py::_build_reminder_html` | reminder cron, 6 reminder types | 6 fixed subjects | no |
| 26 | `services/automation_engine.py:54` | automation rule action | `cfg["subject"]` — **org-authored** | n/a |
| 27 | `routers/prachar.py:399` | marketing campaign send | campaign subject — **org-authored** | n/a |
| 28 | `skills/action/campaign_sender.py:59` | campaign via skill | campaign subject — **org-authored** | n/a |
| 29 | `skills/action/sequence_step_executor.py:64` | drip sequence step | step subject — **org-authored** | n/a |
| 30 | `skills/action/document_expiry.py:46`, `:89` | contract expiring / warranty expiring | `Contract expiring soon: {title}` / `Asset warranty expiring: {name}` | no |
| 31 | `skills/action/escalation_chain.py:81` | SLA escalation to manager | `Escalation: {type} - {label}` | no |
| 32 | `skills/action/notification_fan_out.py:38` | multi-channel fan-out | `{title}` | no |
| 33 | `skills/action/onboarding_chain.py:37` | employee onboarding step 1 | `Welcome to the team, {name}!` | no |

### D · Paths that cannot execute

| # | Site | Defect |
|---|---|---|
| 34 | `routers/dristi.py:625` | `from services.email_service import send_email` — **that module does not exist.** `ls backend/services/` confirms. Raises `ImportError`, swallowed by the enclosing `try`. Scheduled-report "run now" silently reports success and mails nobody. |
| 35 | `services/esign_service.py:71`, `:115` | same non-existent `services.email_service`; both wrapped in `try/except Exception` that logs a warning. Ganit contract signing and its OTP **never send**. |

---

## 3 · Findings — claims, each marked HELD / STALE with evidence

Numbering is `E-nn`. All line numbers are against `origin/staging` @ `666b0ea`.

### E-01 — Two senders bypass the `OUTBOUND_MODE=dry` kill switch — **HELD** — *fixed*

`outbound.py` docstring claims the guard is placed "at the narrowest choke point in
each channel … so a new caller is covered automatically". For email that choke point
is `email_service.send_email()`, which does call `suppressed()` at line 271.

**Two senders never go through it.**

- `email_service.send_report_email` builds its own `MIMEMultipart` and calls
  `ses_client.send_raw_email` directly at `email_service.py:1073`.
- `services/employee_email.send_payslip_email`, when `pdf_bytes` is truthy, takes the
  `_send_with_attachment` branch and calls `_resend_client.Emails.send` at
  `employee_email.py:205` or `ses_client.send_raw_email` at `:217`.

Neither imports `outbound`. On a staging box with `OUTBOUND_MODE=dry` — which shares
production credentials and **the same Supabase database** — the scheduled-report cron
and any payroll run would deliver **real email to real customers**.

This is the single most dangerous thing on my surface and it is why the swarm brief
puts "never send a real email" at maximum force. Fixed by adding the `suppressed()`
guard to both, at the top of the sender, before any MIME is built.

### E-02 — Devanagari at 18px is 2.41:1 on the surface it sits on — **HELD** — *fixed*

`_base()` renders the Sanskrit subhead under every headline as
`color:{_TEAL}` = `#05b7aa` on `_SURFACE` = `#FCFAF5`.

Measured **2.41:1**. WCAG AA needs 4.5:1 for body text, 3:1 even for large text.
This is on *every single designed email in the product* — 22 of the 35 paths.

Same root cause, same file:

| Element | Pair | Ratio | Verdict |
|---|---|---|---|
| Sanskrit subhead, 18px | `#05b7aa` on `#FCFAF5` | **2.41:1** | FAIL |
| Kicker, 11px uppercase | `#03a1b6` on `#FCFAF5` | **2.97:1** | FAIL |
| Footer / bottom-bar links | `#0082c6` on `#FCFAF5` | 4.02:1 | large-only |

### E-03 — The primary button is white-on-teal at 2.51:1 in Outlook — **HELD** — *fixed*

`_cta_row()` at `email_service.py:246` emits
`background-color:#05b7aa;background:linear-gradient(90deg,#0082c6,#03a1b6,#05b7aa)`.

The gradient is the *design*; the flat colour is the *fallback*. Outlook's Word
rendering engine drops `background:linear-gradient(...)` and keeps `background-color`,
so every Outlook recipient sees `#FFFFFF` on `#05b7aa` — **2.51:1**. The label on the
product's main call to action is effectively unreadable for a large share of Indian
business users, who are the target market.

The spec fixes this on its own: `Auth Emails.html` uses a **flat `#04837A`** button
(`tokens.css --primary`), white label, **4.63:1**. No gradient, no fallback problem.

### E-04 — `_base()` interpolates 4 parameters without escaping — **HELD** — *fixed*

`_base(preheader, kicker, headline, sanskrit, lede, body_rows)`. `preheader` is escaped
inside `_preheader()`. **`kicker`, `headline`, `sanskrit` and `lede` are dropped into
the document raw** (lines 145, 148, 149, 150).

Most callers remembered to escape. These did not:

| Caller | Parameter | Value |
|---|---|---|
| `employee_email.send_announcement_email:80` | `headline` | `str(title)` — announcement title, org-authored |
| `employee_email.send_announcement_email:82` | `lede` | contains `{employee_name}` |
| `employee_email.send_leave_decision_email:40` | `lede` | `{employee_name}`, `{leave_type}`, `{reviewer_name}` |
| `employee_email.send_expense_decision_email:64` | `lede` | `{employee_name}`, `{claim_title}`, `{reviewer_name}` |
| `employee_email.send_asset_email:126` | `lede` | `{employee_name}`, `{asset_name}` |
| `employee_email.send_shift_schedule_email:104` | `lede` | `{employee_name}` |
| `employee_email.send_loan_email:149` | `lede` | `{employee_name}` |
| `employee_email.send_payslip_email:173` | `lede` | `{employee_name}`, `{month}` |
| `employee_email.send_performance_email:246` | `lede` | `{employee_name}`, `{review_period}`, `{reviewer_name}` |

`employee_name` comes from `staging.manav_employees.name`; `title` and `body_content`
from the announcement composer. An HR admin who names an employee
`</p><a href="https://evil/">Click to re-verify payroll</a><p>` gets that anchor
rendered inside a Kartavaya-branded payslip email. That is a phishing primitive with
the product's own branding attached, delivered to that employee's inbox.

Fixed by escaping **inside `_base()`** rather than at 9 call sites — same reasoning
`outbound.py` gives for guarding at the choke point. `lede` and `body_rows` stay
HTML-bearing by design (callers legitimately pass `<strong>`), so those keep
call-site escaping; `kicker`, `headline` and `sanskrit` are now escaped centrally.

### E-05 — `_build_reminder_html` interpolates two user values raw — **HELD** — *fixed*

`services/reminder_service.py:185-186`:

```python
<p>Hi {name},</p>
<p>{rem['message'] or 'You have a pending item that needs your attention.'}</p>
```

`name` is `users.full_name`; `message` is `staging.reminders.message`, written by
whoever created the reminder. Neither is escaped. Same injection as E-04, and this one
reaches any user a reminder can be addressed to.

### E-06 — Three subjects are not CRLF-stripped — **HELD** — *fixed*

`_safe_subject()` exists at `email_service.py:74` precisely to strip CR/LF from subject
values, and 18 senders use it. Three do not:

| Sender | Line | Subject |
|---|---|---|
| `send_invite_email` | `:394` | `f"{inviter_name} invited you to {workspace_name} on Kartavaya"` |
| `send_status_changed_email` | `:1130` | `f"Task updated: {task_title}"` |
| `send_welcome_email` | `:458` | `f"Welcome to Kartavaya"` — constant, no risk, but flagged for consistency |

`send_invite_email` is the worst of the three: `workspace_name` is the org name and
`inviter_name` a user's display name, both freely settable. Reaches the SES/Resend
API and, in the raw-MIME senders, an actual header. Fixed.

### E-07 — Report champion initials are unescaped — **HELD** — *fixed*

`email_service.py:874`:

```python
init = "".join(p[0].upper() for p in nm.split()[:2])
```

`nm` itself is escaped at line 904 (`_h(nm)`); `init` is not, and it is built from the
**first character of each word** of the same string. A display name starting `<` puts a
raw `<` into the avatar div. Narrow, but it is the same value the author already
decided needed escaping two lines down. Fixed.

Also unescaped in the same function: `day_label` (`:923`, derived from a DB date) and
`cnt_b` / `cnt` (`:910`, `:969`, DB counts). Coerced with `int()` rather than escaped,
which is the stronger fix for a numeric.

### E-08 — Every `await send_email(...)` is a `TypeError` — **HELD** — *not fixed, out of scope*

`send_email` is `def`, not `async def`, and returns `bool` (`email_service.py:266`,
`:311`). `await True` raises `TypeError: object bool can't be used in 'await'
expression`. Eight call sites `await` it:

`skills/action/campaign_sender.py:59`, `document_expiry.py:46` and `:89`,
`escalation_chain.py:81`, `notification_fan_out.py:38`, `onboarding_chain.py:37`,
`sequence_step_executor.py:64`, plus the two dead-module sites in §2D.

Every one is inside `try/except Exception`, so the failure is silent — and
`campaign_sender` and `sequence_step_executor` then mark the row `failed` in the DB
while `notification_fan_out` and `escalation_chain` just log. **These emails have
never sent.** Left alone deliberately: making them work would start delivering mail
that currently does not go out, on a branch nobody has reviewed, and it is a
behaviour change rather than a design conversion. Flagged for a dedicated fix.

### E-09 — `#9DA096` and `#74786F` in the spec fail AA — **HELD** — *spec defect, deviated*

`Auth Emails.html` uses `#9DA096` for the "by Aekam Inc" lockup, every uppercase
micro-label ("YOUR WORKSPACE", "WITH ACCESS TO", "HOW THIS WORKS") and the entire
footer block; `#74786F` for secondary body text.

| Pair | Ratio |
|---|---|
| `#9DA096` on `#FCFAF5` surface | **2.55:1** |
| `#9DA096` on `#F0ECDF` card | **2.25:1** |
| `#74786F` on `#FCFAF5` surface | **4.32:1** |
| `#74786F` on `#F0ECDF` card | **3.81:1** |

All below 4.5:1, all carrying content text. Per the standing rule in
`design-handover/_SOURCE-MAP.md` — *"A spec'd colour pair below 4.5:1 for body text is
a spec defect to report, not a thing to ship"* — I did not ship them.

`tokens.css` supplies the fix in its own vocabulary: `--on-surface-3: #666A61` →
**5.30:1** on surface, **4.68:1** on card. Every use of both greys resolves to that.
`#9DA096` is `tokens.css --on-surface-disabled`, whose own comment says
*"for INACTIVE CONTROLS ONLY … Never for content"* — so the spec is using it against
the instruction printed in the token file it derives from.

### E-10 — The spec uses `--primary` as text, which `tokens.css` forbids — **HELD** — *spec defect, deviated*

`Auth Emails.html` paints the Devanagari module glyphs (कर्तव्य, गणित, ग्रह, हस्ताक्षर, दृष्टि)
and the "tell us" link in `#04837A`. Measured **4.44:1** on surface, **3.92:1** on the
`#F0ECDF` card those glyphs actually sit on.

`tokens.css:92` states the rule outright:

```
--primary-text: #046B64;   /* 5.2:1 on --bg. --primary is 4.04:1 — a fill, never text */
```

`#04837A` is kept for **fills** (button backgrounds — white on it is 4.63:1, fine).
Brand-coloured **text** resolves to `--primary-text` `#046B64` — **6.11:1** surface,
**5.40:1** card.

### E-11 — Live email loads webfonts via `<link>`, which Gmail strips — **HELD** — *fixed*

`email_service.py:119` puts a `<link href="https://fonts.googleapis.com/css2?...">`
in `<head>`. Gmail (web, iOS, Android), Outlook.com and Yahoo all strip `<link>` from
email. So `Newsreader` and `Tiro Devanagari Hindi` never load for the majority of
recipients, and every `font-family` in the document silently falls to its next entry.

The spec already resolved this and the current code did not follow it:
`Auth Emails.html` declares **`Georgia,serif`** for display — a font present on every
Windows, macOS, iOS and Android device — and loads **no webfont at all**. Removed the
`<link>`; display type is now Georgia, matching the spec byte-for-byte.

### E-12 — Legacy ink ramp is blue-grey; the spec's is warm — **HELD** — *fixed*

`email_service.py:56-58` vs `Auth Emails.html`:

| Role | Shipping | Spec | `tokens.css` name |
|---|---|---|---|
| ink | `#1A2230` | `#1B1D1A` | `--on-surface` |
| ink-2 | `#4A5468` | `#4A4E48` | `--on-surface-2` |
| ink-3 | `#6E7B91` | `#74786F` → `#666A61` (E-09) | `--on-surface-3` |
| primary | `#05b7aa` gradient | `#04837A` | `--primary` |
| danger | `#C0392B` | `#B42318` | `--danger` |
| warn container | `#FEF3E2` | `#FBE3BE` | `--warn-container` |
| outline | `#C8C0AA` | `#D8D1BE` | `--outline-variant` |

Surfaces (`#F6F3EC` page, `#FCFAF5` envelope, `#F0ECDF` card, `#E2DCC9` rule) already
matched and are unchanged — those four come from `email-styles.css`, not `tokens.css`,
and the spec keeps them. See §4 for why the palette is a **hybrid** and how the
resolver handles that.

### E-13 — The email design layer is two files that disagree — **HELD** — *spec ambiguity, resolved*

`design-reference/email-styles.css` and
`design-reference/Kartavaya Redesign/Auth Emails.html` are both email spec and they
do not agree.

- `email-styles.css` header comment says "**Kartavya** editorial email" — the old
  brand spelling the owner has corrected repeatedly. Its ink ramp
  (`#1A2230/#4A5468/#6E7B91`) and teal gradient are exactly what
  `email_service.py` ships today. It is the **older** layer, and the current backend
  is a faithful conversion **of it**.
- `Auth Emails.html` lives inside `Kartavaya Redesign/` — the folder
  `_SOURCE-MAP.md` §2 calls "where pixel-perfect actually lives" — spells the brand
  correctly, and its ink/brand/semantic values resolve cleanly to `tokens.css`.
  It also carries `600px · table layout · inline styles · dark-mode safe` in its own
  preview chrome, which reads as a deliberate statement of email discipline.

**Resolved in favour of `Auth Emails.html`** for the ink ramp, brand and semantic
colours, and in favour of `email-styles.css` for the four paper surfaces that
`Auth Emails.html` itself reuses unchanged. That is not a compromise — it is what
`Auth Emails.html` literally does; §4 traces every value.

*This is the finding I am least certain about* and the one worth a human decision:
if the owner considers `email-styles.css` current rather than superseded, the ink
ramp reverts — but E-02 and E-03 (both WCAG failures) then come back with it, so
that call cannot be made on fidelity grounds alone.

---

## 4 · How tokens are resolved (§ answers the "no CSS custom properties" rule)

Email clients do not support `var()`. The brief says to **resolve tokens to literal
values at build time from `tokens.css` rather than transcribing them by hand** —
transcription is how `#1A2230` ended up standing in for `#1B1D1A`.

`backend/scripts/build_email_tokens.py` does that:

1. Parses `:root` / `[data-theme="light"]` / `[data-theme="dark"]` out of
   `design-reference/Kartavaya Redesign/tokens.css`.
2. Parses `:root` out of `design-reference/email-styles.css`.
3. Resolves `var()` chains transitively, drops anything containing `calc()`,
   `color-mix()` or `linear-gradient()` — none of which survive an email client.
4. Emits `backend/email_tokens.py`: literal hex only, each constant annotated with
   the CSS variable and source file it came from.
5. Re-runs the WCAG check on every foreground/background pair the templates use and
   **fails the build** if a text pair drops below 4.5:1.

The generated file is committed (the backend must not read `design-reference/` at
runtime), and the generator is idempotent — CI can re-run it and diff.

Where the two sources disagree, `EMAIL_OVERRIDES` in the generator names the winner
and the reason, in one place, rather than scattering the decision. The two
accessibility deviations (E-09, E-10) are declared there too, each with its measured
ratio, so nobody has to re-derive why the spec's literal value was not used.

---

## 5 · Dark mode

`Auth Emails.html` labels itself "dark-mode safe" but ships **no**
`prefers-color-scheme` block — it relies on light-only markup with explicit
backgrounds on every cell, which is the conservative approach: clients that
force-invert get a consistent result, clients that do not leave it alone.

The shipping `_dark_mode_css()` already had a `@media (prefers-color-scheme:dark)`
block, but it only restyled four classes and left the outer page background, the
footer, the info card, the stat tiles and the button light — producing light text on
light chrome in a dark client. Half a dark mode is worse than none.

Approach taken, following what the reference files do and closing the gap:

- Every colour-bearing cell keeps an **explicit inline background**, so a client that
  ignores the media query renders the light design intact.
- The `@media (prefers-color-scheme:dark)` block now covers the **complete** set:
  page, envelope, card, info card, rules, all three ink levels, footer, link colour.
  Dark values come from the `[data-theme="dark"]` block of `tokens.css` — resolved by
  the same generator, not hand-picked.
- `<meta name="color-scheme" content="light dark">` and
  `<meta name="supported-color-schemes" content="light dark">` added, which is what
  stops Apple Mail and Outlook.com applying their own blanket inversion on top.
- The primary button keeps `#04837A` in both schemes. `tokens.css` dark `--primary`
  is `#4FD8CB`, which needs **dark** label text; a button whose label colour has to
  flip is a button that breaks in every client with partial media-query support.
  `#04837A` with a white label is 4.63:1 on light and reads correctly on dark.
  Documented in the generator as a deliberate non-resolution.

---

## 6 · Bilingual / Devanagari — **the spec does address it, and it is right**

The brief flagged this as a likely spec gap. It is not one. `Auth Emails.html:282`
states the rule verbatim:

> "Module names carry Devanagari, so the Hindi webfont must be declared with a serif
> fallback — most clients will render the fallback and that is fine."

So the spec has **already accepted** that Tiro will not load in email and designed for
the fallback. The rule to implement is: *declare Tiro first, guarantee a real
Devanagari-capable fallback, and do not depend on Tiro's metrics.*

The shipping stack was `'Tiro Devanagari Hindi', 'Noto Serif Devanagari', 'Newsreader', Georgia, serif`.
Both webfonts fail to load (E-11); `Newsreader` and `Georgia` have **zero Devanagari
coverage**; so the string reaches the bare generic `serif` and the client picks
whatever it likes — which on a stock Windows install is a UI sans, not a serif.

Fixed stack, named system fonts before the generic:

```
'Tiro Devanagari Hindi', 'Noto Serif Devanagari', 'Nirmala UI',
'Kohinoor Devanagari', 'Devanagari Sangam MN', Georgia, serif
```

- `Nirmala UI` — Windows 8+, present on every target machine
- `Kohinoor Devanagari` / `Devanagari Sangam MN` — macOS and iOS
- Android: system fallback reaches Noto Sans Devanagari without being named
- `Georgia` before `serif` so the **Latin** run in a mixed string stays on the display
  face rather than being handed to a Devanagari font's Latin glyphs

This matches the `--font-hindi` stack the sibling auth agent measured in
`auth.css` (`worktree-agent-a07d018d5639fb583.md` §1a), which named `Nirmala UI` and
`Kohinoor Devanagari` for exactly this reason and measured the result at Tiro's own
width. Email now uses the same list. Consistency across the two surfaces was worth
more than inventing a second stack.

**`--font-indic` is not used anywhere in email** — `_SOURCE-MAP.md` records that
`24-bilingual-devanagari.md` is wrong to recommend it, because under an EN+GU
preference it resolves to Noto Sans Gujarati, which cannot draw Devanagari at all.
Fixed Devanagari takes `--font-hindi`. Email has no language preference to read, so
the stack is hard-resolved.

**Spec gap I did find:** `24-bilingual-devanagari.md`'s "No" list forbids Devanagari
in table column headers, and `send_report_email` puts it in the section-header right
column (`कार्य सारांश`, `गति`, `वरीयता क्रम`). Those are section headers rather than
column headers, so I read it as compliant and left it — recording it here because the
distinction is thin and someone will ask.

---

## 7 · Preview harness — how to look at these without sending anything

`backend/scripts/preview_emails.py`.

- Renders **every** template in the inventory to standalone `.html`, plus an
  `index.html` with a client-width switcher.
- Imports only the pure builder functions. It **never** touches `send_email`,
  `resend`, or `boto3`; it sets `OUTBOUND_MODE=dry` before importing anything as a
  second belt.
- Output goes to `backend/scripts/_email_preview/`, which is **gitignored**. The
  harness is committed, the rendered HTML is not.
- Every sample value is deliberately hostile — org names, task titles and employee
  names all contain `<script>`, `"` and `<img onerror>` payloads, so a regression in
  escaping is visible in the rendered page rather than needing to be reasoned about.

```
python backend/scripts/preview_emails.py
```

---

## 8 · Items handed to me by siblings — one HELD, one STALE

### E-14 — The decision email hardcoded `"The reviewer"` — **HELD** — *fixed*

`email_service.py:1336` (pre-fix) passed the string literal `"The reviewer"` as
`reviewer_name` into `send_approval_decision_email`. Every approve/reject email in
the product therefore read *"The reviewer has approved your task"*.

The information was not missing — it was discarded. Every handler
(`approvals_router.py:604`, `:632`, and seven more) writes the decider to
`tasks.approved_by` immediately **before** calling `send_approval_notification`.

Fixed by resolving it in the dispatcher from `tasks.approved_by` rather than
threading a new argument through nine call sites — fewer edits, and it cannot be
forgotten by a tenth caller added later. The literal survives as the fallback,
because a slightly generic decision email beats one that fails on an empty join.

### E-15 — `type='request'` has an email path and it IS styled — **STALE (for email)**

The claim was "notification `type='request'` is not one of the eight specified
kinds; if it has an email path, it is unstyled." The conditional resolves, but not
the way the claim expects:

- It **does** have an email path — `send_approval_notification_email` branches on
  `notification_type == "request"` (`email_service.py:1331`).
- That branch calls `send_approval_request_email`, which is **inventory row 4** —
  one of the seven templates that *does* have a designed version
  (`Email System.html` artboard 3, `EmailApprovalRequest`). Verified by rendering:
  it emits the full designed shell.

So on the email surface there is nothing to fix. `type='request'` being absent
from the in-app notification centre's eight kinds is real, but it is a
notification-centre finding, not an email one — `_notify` writes
`notifications.type='request'` at `approvals_router.py:117` and the **email** is
correctly styled. Flagging so the sibling who owns that surface is not waiting on
me.

---

## 9 · Test-suite send safety — **verified for email specifically**

The coordinator asked me to confirm the `OUTBOUND_MODE` fix holds for email,
since my surface touches send code most. It does, with one caveat that was mine
to fix.

**The conftest fix is real and correctly placed.** `backend/tests/conftest.py:39`:

```python
os.environ["OUTBOUND_MODE"] = "dry"
```

Three things make it load-bearing rather than decorative, all verified:
1. It is `os.environ[...]`, **not** `setdefault` — a developer with `live` in
   their shell cannot silently defeat it.
2. It sits **above** the app imports. `outbound.MODE` is read once at import time
   (`outbound.py:34`), so ordering is the whole game.
3. There is a tripwire asserting it (`tests/test_push_prefs.py:49`).

**The caveat, which was the more dangerous half:** `suppressed()` only protects
senders that *call* it. Two email senders did not — see E-01. So on staging the
guard was genuinely in force for 33 of 35 paths and genuinely absent for the two
that carry payslips and scheduled reports. Both are now closed
(`email_service.py:926`, `employee_email.py:183`). The conftest fix and the
bypass fix are complementary; neither alone was sufficient.

**No email was sent at any point in this work.** The preview harness additionally
refuses to run if a provider client exists (§7), so rendering cannot become
delivery even with the flags wrong.

---

## 10 · Bilingual / Devanagari — plainly stated

**The design files DO address it.** This is not a spec gap. `Auth Emails.html:282`:

> "Module names carry Devanagari, so the Hindi webfont must be declared with a
> serif fallback — most clients will render the fallback and that is fine."

The spec has already accepted that Tiro will not load in most mail clients and
designed for the fallback. That is the correct call — see E-11: Gmail,
Outlook.com and Yahoo all strip `<link>`, so a webfont is not available to be
chosen. **There is no webfont option to weigh; there is only the fallback.**

What I found wrong was the *implementation*, not the spec. The shipping stack was
`'Tiro Devanagari Hindi', 'Noto Serif Devanagari', 'Newsreader', Georgia, serif`
— in which the two webfonts never load, and `Newsreader` and `Georgia` have
**zero Devanagari coverage**, so the string falls through to the bare generic and
the client picks whatever it likes. On a stock Windows install that is a UI sans,
not a serif. See §6 for the corrected stack and why each face is named.

**The one place the spec is silent, and my decision:** it says nothing about
`letter-spacing` or `text-transform` in email. `24-bilingual-devanagari.md:146`
and `:153` forbid both on Devanagari at the app layer, and 16 email templates
were violating both (E-16). I applied the app rule to email rather than inventing
an email-specific convention.

### E-16 — 16 templates tracked and uppercased Devanagari — **HELD** — *fixed*

`_base()` rendered the eyebrow label with
`letter-spacing:0.22em; text-transform:uppercase`, and 16 senders pass a kicker
shaped `LATIN · देवनागरी`:

`"NEW TASK · कार्य"`, `"COMMENT · टिप्पणी"`, `"MENTION · उल्लेख"`,
`"REMINDER · स्मरण"`, `"APPROVED · स्वीकृत"`, `"STATUS UPDATE · स्थिति"`,
`"PASSWORD RESET · पासवर्ड रीसेट"`, `"LEAVE · अवकाश"`, `"EXPENSE · व्यय"`,
`"ANNOUNCEMENT · घोषणा"`, `"SHIFT · पारी"`, `"ASSET · संपत्ति"`, `"LOAN · ऋण"`,
`"PAYSLIP · वेतन पर्ची"`, `"PERFORMANCE · प्रदर्शन"`, `"VERIFICATION · सत्यापन"`.

`24-bilingual-devanagari.md:146` — *"Never set letter-spacing on Devanagari.
Tracking breaks conjunct ligatures — क्ष and ज्ञ render as separate glyphs with a
gap."* And `:153` — *"Also never `text-transform: uppercase`, since Devanagari
and Gujarati are unicase, so it does nothing to them while the Latin beside them
changes, breaking the pair."*

`पासवर्ड`, `प्रदर्शन`, `स्वीकृत` and `हस्ताक्षर` all carry conjuncts (`स्व`, `प्र`, `र्ड`, `स्त`).

Fixed in `_kicker_html()`: the label is split on its separator, the Latin run
keeps tracking and uppercase, the Devanagari run gets `lang="hi"`,
`letter-spacing:normal` and `text-transform:none`. **All 16 fixed without
touching a call site.** The preview harness asserts the rule on every render, so
it cannot regress silently.

Worth noting: the report builder's champion callout already did this correctly
(`letter-spacing:0; text-transform:none` on `champ_hi`), so the constraint was
known — it just was not applied at the shell.

---

## 11 · What I changed

Five commits on this branch.

| Area | Change |
|---|---|
| `backend/scripts/build_email_tokens.py` | **New.** Resolves `tokens.css` + `email-styles.css` to literal hex, records provenance per constant, gates 17 contrast pairs at build time, `--check` for CI. |
| `backend/email_tokens.py` | **New, generated.** The literals every template now reads. |
| `backend/email_service.py` | Shell rebuilt to `Auth Emails.html`: 600px, 14px radius, `role="presentation"`, Georgia display, no webfont `<link>`, flat `#04837A` button, brand lockup, complete dark-mode block, mobile stack. `kicker`/`headline`/`sanskrit` escaped centrally. `_kicker_html`, `_quote_block`, `_notice`, `_fallback_url` added. Kill-switch guard on `send_report_email`. Three subjects CRLF-stripped. Legacy palette swept. |
| `backend/services/employee_email.py` | 9 unescaped `lede` interpolations fixed; announcement body escaped; kill-switch guard on the payslip attachment branch. |
| `backend/approvals_router.py` | Reviewer name resolved from `tasks.approved_by`. |
| `backend/routers/esign.py` | Both builders converted to the shared shell. |
| `backend/services/reminder_service.py` | Converted; two injections fixed; wrong brand/domain/teal removed. |
| `backend/scripts/preview_emails.py` | **New.** 29-template renderer + escaping/bilingual/client-compat audit. |
| `.gitignore` | Rendered previews excluded. |

**Verification:** 29/29 templates pass the audit. Both frontend gates green
(`check-tokens`: 0 missing; `check-classes`: 0 missing). `build_email_tokens.py
--check` clean. All touched modules import. No lockfile touched, no DB write, no
migration, no email sent.

---

## 12 · What I could not finish

**E-08 — the eight `await send_email(...)` sites are still broken.** `send_email`
is sync and returns `bool`; `await True` raises `TypeError`, caught by a bare
`except` at every site. Those eight emails have never sent. I deliberately did
not fix them: making them work *starts delivering mail that currently does not go
out*, which is a behaviour change rather than a design conversion, and doing that
on an unreviewed branch on a surface where the standing rule is "never send a
real email" is the wrong trade. Needs its own change with a human deciding
whether each should send at all. Sites listed in §2D and E-08.

**§2D — two dead imports of a module that does not exist.**
`routers/dristi.py:625` and `services/esign_service.py:71`/`:115` import
`services.email_service`. Scheduled-report "run now" and Ganit contract signing
report success and mail nobody. Same reasoning as E-08 — fixing the import turns
on delivery.

**Marketing/campaign HTML is org-authored and unconverted** (inventory 26–29).
`prachar.py`, `campaign_sender.py`, `sequence_step_executor.py` and
`automation_engine.py` send HTML composed by the customer. It is not ours to
restyle, and the design files do not spec a campaign wrapper. Left alone
deliberately; flagging that no sanitisation is applied to it either, which is a
policy question (an org emailing its own contacts) rather than a bug.

**The support-access email is specced but not wired.** `Auth Emails.html` #support
is a complete fourth auth template with a violet platform keyline, and **no
backend sender exists for it**. I built the shell support (`accent` parameter,
`PLATFORM_VIOLET` token) and render it in the harness as `04-support-access` so
the gap is visible, but wiring it needs the platform-support request flow, which
is another agent's surface.

**Not visually diffed against the spec by a human.** I verified geometry, type,
colour and structure programmatically and rendered all 29, but nobody has looked
at them in a real client. `Litmus`-style cross-client testing is the obvious next
step and I could not do it from here.
