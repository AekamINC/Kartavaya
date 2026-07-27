# SigningPage.jsx — security & accessibility audit

Scope: `frontend/src/pages/SigningPage.jsx` and the backend it calls
(`backend/routers/esign.py`, `backend/services/esign_service.py`,
`backend/routers/ganit.py`). Lens: security + accessibility only. Behaviour and
design fidelity were audited in parallel by two peers and are not covered here.

Branch: `audit/signingpage-security-a11y`, cut fresh from `origin/staging`
(`18fd4609`) — the worktree was 809 commits stale and was rebranched before any
work. No database was read or written; no email or OTP was dispatched. All
browser verification ran against a stubbed `XMLHttpRequest` on a private vite
instance (port 5931) with `VITE_BACKEND_URL` pointed at `127.0.0.1:1`.

---

## The two questions, answered plainly

**Can anyone sign as anyone else? — No.** The signer's identity is resolved
entirely server-side from the token; nothing in any request body names a signer,
so there is no field a caller can change to become someone else. Tokens are
256-bit (`esign.py:131` `secrets.token_hex(32)`, `esign_service.py:31`
`token_urlsafe(32)`). The `_token` forgery vector **is fixed and holds end to
end** — see S9.

Two qualifications, both real:

- A signer **can sign out of turn**. `sign_order` is collected, stored and
  ordered by, and then never enforced (S3). Signer 3 can sign before signer 1.
  This changes *who may sign when*, so it is flagged as a **product decision**
  and left undecided.
- Until this pass, anyone holding a valid link could sign a document the firm
  had **already cancelled** (S2). Fixed.

**Can a signature be repudiated for want of evidence? — Yes, and this is the
weaker of the two answers.** The server-set facts are sound: `signed_ip`,
`signed_at` and the audit trail are all written server-side and are not
client-supplied (S11). But the artefact is not:

- **No signed PDF is ever produced.** `_generate_signed_certificate`
  (`esign.py:698`) uploads a **JSON** file, and `signed_file_hash`
  (`esign.py:750`) is the SHA-256 of *that JSON*, not of a signed document. The
  `signed_pdf_sha256` this audit was asked to check has no counterpart in the
  schema or the code. The "alterations detectable" limb the module's own
  docstring claims under IT Act §10A (`esign.py:6-7`) rests on
  `original_file_hash` alone — the hash of the *unsigned* input.
- **The signer never receives a copy.** The page promises one
  (`SigningPage.jsx:535`, "A copy will be sent to your email when all parties
  have signed"); `routers/esign.py` sends mail at only three places — request,
  OTP, resend — and none on completion (S13). The counterparty is left holding
  nothing.
- Until this pass, the OTP attempt limiter **permanently disabled itself** after
  its first 15-minute window (S4). Any signature already collected has a weakened
  "signature links to the signatory" limb, because the second factor guarding it
  accepted unlimited guesses.

Nothing here is a *forgery*; the exposure is that a disputing signer has a
credible argument that no tamper-evident artefact of what they signed exists.

---

## Security findings

| # | Claim | Evidence (two line refs) | Verdict |
|---|---|---|---|
| **S1** | **The signing token was transmitted to a third party.** `@vercel/analytics` `inject()` ran unconditionally at boot with no `beforeSend`; Vercel Web Analytics reports `location.pathname` verbatim, so every visit to `/sign/<token>` sent the entire signing authority to Vercel, where it is retained and readable by anyone with project access. This is a plain-SPA build with no route manifest, so no normalisation happens. | `frontend/src/index.jsx:5` (import) · `frontend/src/index.jsx:7` (bare `inject()`, pre-fix) | **FIXED** — `beforeSend` now rewrites `/sign/:token` → `/sign/[token]` and redacts `?token=`; unparseable URLs are dropped. `index.jsx:19`, `:21-26`. Pageview counts preserved. |
| **S2** | **A cancelled or expired document could still be signed.** The read path refused it; the write path never looked at `sign_documents.status` or `expires_at`. The page is fetched once and may sit open for days, and the POST is replayable without the page, so a link issued before a cancellation still produced a recorded signature with a full audit trail. `cancel_document` exists solely to stop signing. | `esign.py:346` (read path enforces) · `esign.py:519` (write path, previously absent) | **FIXED** — `_doc_status_guard` (`esign.py:303`) is now the single answer to "is this signable", called from the read path and both write paths (`:346`, `:519`, `:588`). 410, not 404. |
| **S3** | **Signing order is never enforced.** `sign_order` is collected, persisted and ordered by, but no endpoint gates on it. Signer 3 can sign before signer 1; a document requiring counter-signature in sequence does not get it. | `esign.py:136` (stored) · `esign.py:494-519` (`submit_signature` has no order gate) | **PRODUCT DECISION — reported, not changed.** Enforcing it changes who may sign when. Same gap in the Ganit path: `esign_service.py:224-232`. |
| **S4** | **The OTP attempt limiter permanently disabled itself.** `first_at` was refreshed only when `count == 1` and `count` was never reset, so once the first window lapsed the guard `count >= 5 AND elapsed < 900` could never be true again — unlimited guesses at a 6-digit code, forever, for that token. | `esign.py:446` (key) · `esign.py:458-464` (window logic) | **FIXED** — the window now rolls: a lapsed window starts fresh. Regression test `test_the_limiter_still_blocks_in_a_later_window`. |
| **S5** | **OTP attempt state is process-local RAM**, held on a function attribute. Not shared across workers (so the effective limit is 5 × worker count), cleared by every deploy, and previously never evicted — an unbounded dict keyed by a string an unauthenticated caller chooses. | `esign.py:447` (`getattr(verify_otp, '_attempts', …)`) · `esign_service.py:152` (Ganit path uses a durable `otp_attempts` column instead) | **PARTIALLY FIXED** — lapsed windows are now evicted (`esign.py:453-456`), closing the memory-growth vector. The cross-worker weakness remains: moving the counter to the `otp_attempts` column is a **schema change** and was not made (DB is read-only this pass). |
| **S6** | **`/otp/send` has no per-token or per-signer throttle.** Anyone holding a token can mail-bomb the signer's inbox and burn SES quota; each call also silently replaces the live OTP, so a repeated attacker call invalidates the code the real signer is typing. Only the global 120-writes/min/IP bucket applies, which is per-IP and trivially spread. | `esign.py:372-408` (no throttle) · `server.py:225-240` (the only limit that applies) | **REPORTED** — unfixed. The right fix is the same durable counter as S5. |
| **S7** | **The token reaches application logs on any 500.** The global exception handler logs `request.url.path`, and on this flow the token *is* the path. Verified in-browser: the outbound request is `GET …/api/v1/esign/verify/<token>`. | `server.py:249` (logs `request.url.path`) · `SigningPage.jsx:153` (token in path) | **REPORTED** — unfixed. Structural: the API contract puts the bearer in the path. Moving it to a header is an API change affecting four endpoints (`SigningPage.jsx:153,177,189,208,220`). |
| **S8** | **Two token namespaces collide on one public URL.** `esign_service.send_for_signature` emails `{FRONTEND_URL}/sign/{tok}` for tokens in `ganit_contract_signers`, but `/sign/:token` renders SigningPage, which queries only `sign_signers`. **Every Ganit contract signature link is dead** — it 404s as "Invalid signing link". The parallel Ganit API (`/api/v1/ganit/sign/{token}`) has no frontend at all. | `esign_service.py:104` (mints the URL) · `App.jsx:137` → `SigningPage.jsx:153` (resolves against the other table) | **PRODUCT DECISION — reported, not changed.** Which eSign implementation is canonical is not mine to pick. Note this is a *dead* link, not a cross-tenant leak: a Ganit token cannot resolve to a `sign_signers` row. |
| **S9** | **The `_token` forgery fix HOLDS end to end.** Tokens are carried in a local `outbox` of per-signer tuples and never enter `created`, which the caller returns verbatim as the HTTP body. No sibling of the shape exists: `routers/esign.py` reads `signer['token']` inside its loop at both send sites. | `esign_service.py:58` + `:71` (per-signer outbox) · `esign.py:275` and `:600` (loop-local token) | **VERIFIED SOUND** — covered by `backend/tests/test_esign_signing_links.py` (6 tests, incl. the response-body leak assertion). |
| **S10** | **Injection and escaping are clean on this surface.** Verified in a real browser: an `<img src=x onerror=…>` payload injected into `document_title`, `signer_name` and `document_description` rendered as inert text — **0 nodes injected, handler did not fire**. Email templates escape at the choke point. No `dangerouslySetInnerHTML` anywhere in this flow. | `email_service.py:105-112` (`_preheader` escapes) · `email_service.py:578-582` (`_info_card` escapes label *and* value) | **VERIFIED SOUND** — `_base` also escapes kicker/headline/sanskrit; `lede`/`body_rows` remain caller-escaped and both esign callers use `_h()`. |
| **S11** | **Evidence is server-set.** `signed_ip` from `request.client.host` and `signed_at` from server time; the client cannot choose either. `signature_data` is necessarily client-supplied (it is the mark itself). No token in `localStorage`, `sessionStorage` or any query string. No cross-origin `Referer` leak: `strict-origin-when-cross-origin` sends origin only, and the PDF link carries `rel="noopener noreferrer"`. | `esign.py:528-535` (server-set ip/time) · `server.py:258` + `vercel.json:48` (Referrer-Policy) | **VERIFIED SOUND** |
| **S12** | **No signed PDF is produced and no per-document tamper-evidence exists over the signed result.** The "certificate" is JSON; `signed_file_hash` hashes that JSON. There is no `signed_pdf_sha256` in code or schema. | `esign.py:698` (`_generate_signed_certificate`) · `esign.py:750` (stores hash of the JSON) | **REPORTED** — product/architecture gap, not a code defect to patch here. |
| **S13** | **The completion promise is never kept.** The signer is told a copy will be emailed when all parties sign; no completion email exists. | `SigningPage.jsx:535` (the promise) · `esign.py:278`, `:399`, `:659` (the only three sends — request, OTP, resend) | **REPORTED** — overlaps the behaviour peer's lens; recorded here because it is why the signer holds no counterpart record. |
| **S14** | **`signers_completed` is a read-modify-write race.** Two signers completing concurrently lose an increment, so a fully-signed document can stay `partially_signed` and never generate its certificate. | `esign.py:538` (`signer["signers_completed"] + 1`) · `esign.py:545-550` (writes the stale value back) | **REPORTED** — the correct fix is `signers_completed = signers_completed + 1` in SQL; left alone as it sits inside the behaviour peer's edit surface. |
| **S15** | **No pricing figures anywhere in this flow**, including comments. | `grep -E "₹|INR|\$[0-9]|price|pricing"` over `SigningPage.jsx`, `public.css`, `esign.py` — no matches | **VERIFIED CLEAN** |

### Not verified (security)

- **`sign_signers` column defaults** — in particular whether `otp_verified`
  defaults to `FALSE`. There is no `CREATE TABLE` for `sign_signers` anywhere in
  the repo (only `migrations/029` references it), so the table is managed
  directly in Supabase. The DB was read-only this pass and was not queried. **If
  `otp_verified` defaulted to `TRUE`, OTP would be skipped entirely** —
  `esign.py:367` and `:520` both branch on it. Worth one metadata query.
- **`sign_documents.expires_at` nullability.** `_doc_status_guard` treats `None`
  as "no expiry" (matching the previous behaviour exactly), which is correct only
  if the column is genuinely nullable rather than always populated.
- **Production `Referrer-Policy` on the Railway backend origin** was read from
  source, not from a live response.

---

## Accessibility findings

Spec: `design-handover/23-accessibility.md`. Measured in a real browser at
375×812 (the governing case — these links are opened from email on a phone),
with `document.elementFromPoint` confirming each element actually receives the
tap at its own centre, per the brief.

| # | Claim | Evidence (two line refs) | Verdict |
|---|---|---|---|
| **A1** | **The signature canvas had no keyboard path and no stated fallback.** Measured `tabIndex: -1`, absent from the tab order. It carried a bare `aria-label`, so it *announced* as though it were an operable control while being unreachable. A keyboard or switch user reaching this step landed on "Clear" with no explanation. | `SigningPage.jsx:485` (canvas) · `SigningPage.jsx:487-491` (the fallback prose) | **FIXED** — `role="img"` (the honest description) + `aria-describedby` pointing at explicit prose naming **Type signature** as an accepted alternative of equal legal effect. Confirmed in the a11y tree as `img "Signature drawing area"` followed by the fallback text. |
| **A2** | **The unselected toggle reported no state.** `Chip` sets `aria-pressed={on ? true : undefined}`, so the selected chip announced "pressed" and the unselected announced nothing at all — the user was told which option was on but never that the other was a toggle. Measured: `[{Type signature, null}, {Draw signature, "true"}]`. | `Chip.jsx:24` (the `undefined` default) · `SigningPage.jsx:436` (explicit override) | **FIXED** — `aria-pressed` passed explicitly; `Chip` spreads `...rest` after its own default so this wins without touching the shared component. Now measures `false` / `true`. |
| **A3** | **The signature-method choice was an unlabelled, ungrouped pair.** `ChipRow` rendered a bare `<div class="chips">` — measured `role: null, aria-label: null`. A screen reader announced two unrelated buttons between the document link and a name field, with nothing saying they were alternatives. | `Chip.jsx:52` (`ChipRow`, now spreads `...rest`) · `SigningPage.jsx:434` | **FIXED** — `role="group"` + `aria-label="Signature method"`. Tree now reads `group "Signature method"` containing both buttons. `ChipRow` change is additive. |
| **A4** | **Errors were signalled by colour and not associated with their field.** `.is-error` tints the OTP field; the input had no `aria-invalid` and no `aria-describedby`, and the error span had no `id`. `role="alert"` fires once at the moment of change and is gone by the time the user tabs back to correct it. The sign-step error sits *below the legal notice*, far from the name input it is about. | `SigningPage.jsx:380-383` (OTP field) · `SigningPage.jsx:451-452` + `:499` (name field ↔ its error) | **FIXED** — `aria-invalid` and `aria-describedby` on both inputs, ids on both error spans. |
| **A5** | **The loading state was announced to nobody.** A bare `<div aria-busy aria-label>` — `aria-label` is ignored on an element whose implicit role is `generic`, and the skeletons underneath are bare `<span>`s, so there was no second chance. | `SigningPage.jsx:312` (the div) · `Skeleton.jsx:12-14` (`SkeletonBlock` is an unlabelled `span`) | **FIXED** — `role="status"`. |
| **A6** | **Terminal states were not announced.** After submitting a legally binding signature, `done` / `already_signed` / `declined` silently replaced the form. This page never mounts the toast announcer, so nothing else on it would have spoken. The signer got no confirmation the signature landed. | `SigningPage.jsx:529` (`done`) · `toast.jsx:185-186` (the app's live regions, which this page does not use) | **FIXED** — `role="status"` on all three terminal states (`:529`, `:547`, `:559`). |
| **A7** | **Touch targets below 44×44 on mobile.** Measured at 375×812: signature-method chips **116.1×30.4** and **114.5×30.4**; "View document (PDF)" **136.6×19.5**. (`Clear` measures 54.1×**44.0** on mobile and passes — it is 30.8 only on desktop, which is not the governed case. Sign/Decline are 45.0 and pass.) | `public.css:292` (the new mobile rule) · `SigningPage.jsx:434` (`.sg__sigmode` hook) | **CHIPS FIXED, LINK REPORTED.** See the arithmetic below. |
| **A8** | **Contrast passes in both themes.** Measured every text token on the page against its composited background: minimum on this page is **4.82:1** (`.pub__kick` / `.pub__foot`, 10px, light). Dark minimum **5.50:1** (`.pub__muted`, the IT Act notice). No Devanagari on this page, so the 2.13:1 defect found on its sibling has no analogue here. | measured `.pub__muted` light 5.17:1 / dark 5.50:1 · `.pub__link` light 5.96:1 / dark 10.47:1 | **PASS** — `scripts/contrast-baseline.json` **not** modified; gate reports "no new failures and no regressions", 20 known pairs held. |
| **A9** | **Keyboard and focus are sound.** Focus visible in **both** themes (`solid 1.6px #04837A` light, `#4FD8CB` dark at **10.47:1** against the card — well over the 3:1 that 1.4.11 asks of a focus indicator), `:focus-visible` confirmed true under real `Tab`. Tab order matches visual order exactly. **No `<div onClick>` or `<span onClick>` on this page** — every control is a real `<button>`, `<a>` or `<input>`. | `a11y.css:52` (forced-colors ring) · measured DOM order == visual order for all 6 focusables | **PASS** |
| **A10** | `autoFocus` on the OTP and name inputs moves focus on mount, which can disorient a screen reader user who has not finished hearing the card. Defensible on a single-purpose form. | `SigningPage.jsx:379` · `SigningPage.jsx:450` | **NOTED** — left alone; changing it is a UX judgement, not a defect. |

### The touch-target arithmetic (A7)

The brief warned not to assume, because 44px areas 40.5px apart swallow each
other. Measured clearance **before** any change: **12.0px** from the "View
document (PDF)" link down to the chips, **8.0px** between the two chips.

- Chips need **+13.6px** to reach 44 → **6.8px per side**. 6.8 < 12.0, so they
  fit. **Applied**, scoped to `.sg__sigmode` so the product's read-only status
  chips are untouched. Re-measured after: both chips **44.0px**, gap to the link
  still **12.0px**, `noOverlapWithLink: true`.
- The link needs **+24.5px** → **12.25px per side**. 12.25 + 6.8 = **19.05px
  required against 12.0px available** — enlarging both would make them overlap
  and each swallow the other's taps. **So the link was deliberately not grown.**
  Fixing it requires increasing the `.pub__stack` gap, which is a layout change
  on a shared public surface and belongs to the design peer. **Reported, open.**

### Not verified (accessibility)

- **No real screen reader was run** (NVDA/VoiceOver). All screen-reader claims
  are derived from the computed accessibility tree via `read_page`, which is
  strong evidence for names, roles and structure but does not prove announcement
  *order* or verbosity in a specific AT.
- **`prefers-reduced-motion`** on the skeleton shimmer was not exercised.
- **Windows High Contrast / forced-colors** was read from `a11y.css:52`, not
  rendered under an actual forced-colors profile.

---

## Changes made

| File | Change |
|---|---|
| `frontend/src/index.jsx` | `beforeSend` redacts the signing token from analytics (S1). |
| `backend/routers/esign.py` | `_doc_status_guard` added and applied to sign + decline (S2); OTP attempt window now rolls and evicts (S4, S5). |
| `frontend/src/pages/SigningPage.jsx` | A1–A6: canvas fallback, `aria-pressed`, group label, error association, live regions. |
| `frontend/src/components/ui/Chip.jsx` | `ChipRow` spreads `...rest` so a row can carry group semantics (additive). |
| `frontend/src/styles/public.css` | `.sg__sigmode .chip { min-height: 44px }` on mobile (A7). |
| `backend/tests/test_esign_public_signing_gates.py` | **New**, 13 tests covering S2 and S4. |

Deliberately **not** changed: S3 and S8 (product decisions), S6/S7/S12/S13/S14
(reported), the A7 link (would require a layout change owned by the design peer),
`scripts/contrast-baseline.json` (untouched).

## Gates

| Gate | Result |
|---|---|
| `frontend` → `npm run check` | **PASS** — "no new failures and no regressions"; 20 known pairs held at baseline, baseline file unmodified |
| `frontend` → `npx vitest run` | **PASS** — 47 files / 720 tests, exactly baseline |
| `backend` → `python -m pytest -q` | **PASS** — **1502 passed** (1489 baseline + 13 new), 138 skipped, **0 failed** |

No lockfile churn (`frontend/yarn.lock` was touched by `npm ci` and reverted). No
line-ending-only changes.
