# file-signingpage-behaviour

`frontend/src/pages/SigningPage.jsx` — audited for **behaviour and correctness**
only. Design fidelity and security/a11y were two other agents' lenses this run
and are not touched here. The prior pass on this file
(`verify--attachment-cost-leaks-signingpage.md` §2) was entirely about colour
tokens, dark mode and the `Kartavya` misspelling; **nothing in this report
overlaps it**.

Branched fresh from `origin/staging` (`18fd4609`). The worktree was seeded 809
commits stale — `SigningPage.jsx` did not exist at its HEAD — so the branch was
recreated rather than rebased.

## How this was verified

Two independent harnesses, both of which had to defeat the same obstacle: the
page builds its **own** axios instance at module scope
(`SigningPage.jsx:47`, `axios.create({ baseURL: API })`), so a mocked `lib/api`
reaches none of it. `axios.create` merges `axios.defaults` **at creation time**,
so the seam works only if `axios.defaults.adapter` is installed *before* the
module is imported — hence a top-level `await import` after the assignment, not
a static import.

1. **jsdom / vitest** — `frontend/src/__tests__/signingPageBehaviour.test.jsx`,
   41 tests. Drives all six steps and every failure mode. Canvas 2D context and
   `toDataURL` are stubbed so the harness can count paper repaints and listener
   attachments.
2. **A real browser** — vite from this worktree on **`127.0.0.1:5907`** (not
   :5173), driven with `javascript_tool` (screenshots are still failing with
   "Browser pane is not displayed", so `read_page`/`javascript_tool` only). A
   gitignored `frontend/__probe.html` + `src/__probe.jsx` mounted the page under
   a `MemoryRouter` with the same stubbed adapter. This is where the canvas
   claims are measured in **actual pixels** — jsdom cannot paint. Probe files
   deleted afterwards; the paths are already in `.gitignore`.

**Nothing was dispatched.** No email, no OTP, no database write, no request left
the machine — every response came from the stub table, and each test asserts on
the payload that *would* have been sent. Staging and production share one
Supabase project, so this was a hard constraint, not a preference.

---

## Findings table

Verdict key: **FIXED** = defect found and repaired here · **OK** = behaves
correctly, now covered by a test · **REPORTED** = real defect, deliberately not
fixed here · **NOT VERIFIED** = could not reach it.

### Step 1 · loading

| state | expected | actual | verdict | evidence |
|---|---|---|---|---|
| initial mount | skeleton, `aria-busy`, no error, no empty document | exactly that | OK | `[aria-busy="true"]` present, `.k-err` null, text contains neither `Sign:` nor `Something broke` |
| loading vs empty vs error | three distinct states | three distinct branches, no fall-through | OK | a failed read always clears `aria-busy` and always paints `.k-err` — asserted for 404, 500 and a dropped connection |

### Step 2 · token lifecycle (the initial `GET /v1/esign/verify/{token}`)

| state | expected | actual | verdict | evidence |
|---|---|---|---|---|
| malformed / unknown token → 404 | "doesn't exist", not "server broke" | `kind=missing`, "This doesn't exist, or it was deleted" + *Invalid signing link* | OK | `esign.py:317` |
| withdrawn document → 410 | true and distinct | `kind=request` + *This document has been cancelled or expired* | OK | `esign.py:320` |
| expired link → 410 | true and distinct | `kind=request` + *This signing link has expired* | OK | `esign.py:327`. Distinct from withdrawn — the server's own `detail` carries the difference |
| spent token → 400 | no retry button, never "server broke" | `kind=request`, zero buttons, no "Something broke" | OK | `errorKind` maps every non-403/404 4xx to `request` (`ErrorState.jsx:33`); this page does use it |
| **500** | something to press | **zero interactive elements on the entire page** — the copy said "Try again in a moment" over a card with no button, no link and no nav chrome to escape through | **FIXED** | measured: `[500] interactive elements on page= []`. Now renders **Try again**, wired to a re-read; browser-confirmed the retry re-fetches and reaches `Sign: Master Services Agreement` |
| **network drop** | say nothing was sent | `kind=offline` — correct — but the shared copy reads **"Changes are saved and will sync when you're back."** This page holds no draft and syncs nothing. On a signing screen it answers "did my signature go through?" with a falsehood | **FIXED** | now "Nothing has been sent. Reconnect and open this link again." Page-local `detail` only — `ErrorState`'s shared COPY is untouched, so no other page moves |

Note: the 410 states share the generic title *"That request wasn't accepted"*.
The title is `ErrorState`'s and shared with every other page; the true, specific
sentence arrives as the server's `detail`, which is displayed. Changing the
shared title was out of scope for one page's audit.

### Step 3 · otp_send

| state | expected | actual | verdict | evidence |
|---|---|---|---|---|
| render | document title, signer name, PDF link, Decline | all four present | OK | link `https://r2.example/doc.pdf` |
| send succeeds | advance carrying the masked address | advances; `r.data.email` → `data.maskedEmail` | OK | matches `esign.py:390` `{"sent", "email"}` |
| send → 400 *Already signed* | stay, show the reason | stays, shows it | OK | does **not** advance |
| send → network drop | do not blame the signer | said "Failed to send OTP" — neutral but uninformative | **FIXED** | now "You appear to be offline…" |

### Step 4 · otp_verify

| state | expected | actual | verdict | evidence |
|---|---|---|---|---|
| **PDF link** | readable here too | **absent** — the only step in the flow with no link to the document, and the one where the signer is idle waiting on an email | **FIXED** | same rule as the known-history fix: readability must not depend on which step you stand on |
| code < 6 digits | caught locally, no request | 0 requests, "Enter the 6-digit code" | OK | |
| wrong code → 400 | server's wording | "Invalid OTP" | OK | `esign.py:437` |
| rate limit → 429 | passed through | "Too many attempts. Request a new OTP." | OK | `esign.py:418` |
| **500** | must not accuse the signer | **"Invalid OTP"** — the code was correct; the page blamed the user for our fault and sent them round a loop that cannot succeed | **FIXED** | fallback now derives from `errorKind`; the server's `detail` still wins when present |
| **network drop** | must not accuse the signer | **"Invalid OTP"** — same defect | **FIXED** | now "You appear to be offline…" |
| correct code | reach a signable state, no stale error | reaches `sign`, zero alerts left | OK | |
| Decline from this step | — | not offered here (it is on steps 3 and 5) | NOT FIXED — noted | judged UX, not a behavioural break; left for the design lens |

### Step 5 · sign

`otp_required` is `not signer["otp_verified"]` (`esign.py:348`), so **a first
visit is always the OTP path**. `otp_required: false` is the *resume* case — the
signer verified, closed the tab and reopened the link. It is reachable in
production and it is the only way to land on `sign` directly. Both paths were
driven; both reach a signable state.

| state | expected | actual | verdict | evidence |
|---|---|---|---|---|
| no-OTP resume | document linked, page signable | PDF link present, IT Act notice present, Sign present | OK | guards the known-history regression (link once existed only in the `otp_send` branch) |
| empty typed name | caught locally | 0 requests, "Type your name to sign" | OK | |
| typed signature | trimmed name, real tally | sends `{signature_data:"Asha Rao", signature_type:"type"}`; renders "1/3 signers have signed" without claiming completion | OK | matches `esign.py:509` |
| all signers in | announce completion | "2/2 signers have signed. All signatures collected." only when `document_status==='completed'` | OK | |
| 403 | server's wording, nothing claimed signed | shown inline, no "Document signed" | OK | `esign.py:469` |
| 500 / network drop | say nothing was signed, stay retryable | said "Failed to submit signature" | **FIXED** | now distinguishes offline/server and states "Nothing has been signed"; button re-enabled |

### Step 5b · the drawn signature — the most serious finding

| state | expected | actual | verdict | evidence |
|---|---|---|---|---|
| **untouched canvas** | refuse | **submitted**. `toDataURL` on blank paper is a valid PNG; the page sent it and rendered **"Document signed — 1/1 signers have signed. All signatures collected."** A legally binding document recorded as signed by someone who drew nothing | **FIXED** | browser-measured. Now: 0 requests, "Draw your signature above to sign" |
| **any unrelated re-render** | leave the drawing alone | **erased it.** `initCanvas` was an inline arrow, so its identity changed every render; React detaches and reattaches such a ref, re-running the body — which `fillRect`s the whole canvas in paper and re-binds 7 listeners | **FIXED** | jsdom: `fillRect` 1→2→3, listeners 7→14→21 from opening and cancelling one dialog. **Browser, in pixels: ink `1129` → `0` the instant the Decline dialog opened.** After the fix: `1129` → `1129` |
| **failure then retry** | resend the real ink | the three re-renders of a failed attempt (busy on, error, busy off) wiped the canvas, so pressing Sign again sent a **blank PNG — and the server accepted it** | **FIXED** | browser: after draw → dialog → cancel → Sign, the payload was `data:image/png;base64,iVBORw0K…` (blank) and the page said "Document signed". After the fix the second attempt sends 8706 bytes of real ink |
| Clear | reset to "nothing drawn" | repainted paper but left no "no ink" state to check | FIXED | `Clear` now also resets the ink flag |
| canvas ref missing | say something | `if (!canvas) return;` — the only control on the page went inert with no explanation | FIXED | now messages "The signature pad did not load…" |

The realistic path to all of this: a signer draws, presses **Decline** to read
what declining means, presses **Cancel**, then presses **Sign document**. Their
signature is gone from the screen and a blank image is filed as their signature.

### Step 6 · declined

| state | expected | actual | verdict | evidence |
|---|---|---|---|---|
| Decline pressed | confirm first, send nothing | `ConfirmDialog` with a real title; 0 requests until confirmed | OK | `window.confirm` already replaced |
| confirmed | send reason, terminal state | `{reason:"Declined by signer"}`, "You have declined to sign this document." | OK | `esign.py:543` |
| decline → 400 | say so | shows "Already signed" inline; does not claim declined | OK | not silent — an earlier read of mine was wrong, corrected by clicking the *dialog's* button rather than the page's |
| decline → network drop | state nothing changed | said "Failed to decline" | **FIXED** | now "You appear to be offline…" / "Nothing has changed." |

### Idempotency and double-submit

| state | expected | actual | verdict | evidence |
|---|---|---|---|---|
| ordinary double-click | one submission | **one POST.** `busy` disables the button, and React 18 flushes discrete updates before the second click's task | OK — *not* the defect it looked like | measured: `[after click1] disabled=true POSTs=1`, `[after click2] POSTs=1` |
| two dispatches in one task | one submission | **2 POSTs.** `busy` only bites after a render | **FIXED** | a `useRef` latch set synchronously in the handler; the guarantee no longer depends on render timing. Applied to all four write paths |
| reload after signing | terminal state | `already_signed`, dated **"20 Jul 2026"**, with no Sign or Decline control | OK | browser-confirmed; the `20/7/2026` regression has not returned |
| signed row, null timestamp | still a sentence | "You have already signed this document." — no "Invalid Date" | OK | |

### Response shapes — every endpoint read against `backend/routers/esign.py`

| call | fields the page reads | backend | verdict |
|---|---|---|---|
| `GET /v1/esign/verify/{token}` | `status`, `signed_at`, `document_title`, `document_description`, `file_url`, `signer_name`, `signer_email`, `otp_required` | `esign.py:330`, `:341` | OK — all present |
| `POST …/otp/send` | `email` | `:390` `{"sent","email"}` | OK |
| `POST …/otp/verify` | — | `:448` | OK |
| `POST …/sign` | `document_status`, `signers_completed`, `signers_total` | `:509` | OK |
| `POST …/decline` | — | `:543` | OK |

No `SELECT *` field-name mismatch on this page's endpoints: `get_signing_page`
selects `s.*` joined to explicitly named document columns and returns a
hand-built dict, so the wire shape is pinned regardless of the table.

### Every promise has a rejection handler

Swept for the `TaskDrawer` pattern (a read with no `.catch`, leaving a section
silently empty). **Five** axios calls in this file; **all five** have a
`.catch`/`try…catch`. `ConfirmDialog` awaits `onConfirm`, and `doDecline` cannot
reject — its own `try/catch` is total. **No gap.**

---

## REPORTED, not fixed

### 1 · Ganit contract signing links land on a page that cannot read them

**Severity: high — customer-facing dead link.** Found while checking response
shapes, as the brief directed.

`backend/services/esign_service.py:104` builds the signer's email link as:

```py
sign_url = f"{frontend_url}/sign/{tok}"
```

`tok` is a token in `staging.ganit_contract_signers`. `/sign/:token` is the only
signing route in `App.jsx:137` and it renders this page, which calls
`GET /api/v1/esign/verify/{token}` — a lookup against **`staging.sign_signers`**
(`esign.py:313`). A Ganit token is never in that table, so the request 404s and
the customer is shown **"This doesn't exist, or it was deleted."**

The Ganit flow has its own complete public API at `routers/ganit.py:1293–1343`
(`GET /v1/ganit/sign/{token}`, then `/otp`, `/verify`, `/submit`) with a
different response shape entirely — `contract_title`, `contract_file_url`,
`otp_verified` — and no frontend route consumes it. The send path is live:
`ganit.py:1268` calls `send_for_signature`.

This is adjacent to the fault fixed today (four bugs under one `except
Exception` that answered "sent" while sending nothing). The *sending* is now
fixed; the *link it sends* still points at a page that cannot read it.

Not fixed here because the honest repair is a decision, not a patch: either
teach this page a second protocol (two response shapes, three different
sub-paths — a feature, not a defect fix) or give Ganit its own route. Either
choice belongs to the owner.

### 2 · `POST …/sign` is not idempotent server-side

`esign.py:486` reads `signers_completed` and writes `+1`, and the
`status == 'signed'` guard is evaluated against a row fetched *before* any
concurrent write commits. Two requests that overlap can both pass the guard and
both increment, marking a multi-signer document `completed` off one signer. The
client-side latch added here closes the browser-originated case; the endpoint
should be made idempotent (conditional `UPDATE … WHERE status <> 'signed'`, and
derive the count rather than incrementing it). Backend, not this file.

---

## NOT VERIFIED

- **The ConfirmDialog exit animation after a failed decline.** In jsdom the
  dialog stays mounted because `animationend` never fires; that is a harness
  artefact of `useExitAnimation`, not the page. Whether the error message behind
  it is legible during the real exit was not measured.
- **Real OTP delivery, real token expiry, real R2 `file_url` signing.** All
  require dispatching mail or writing to the shared Supabase project. Out of
  bounds by instruction. `_refresh_file_url` (`esign.py:33`) calls `sign_key`
  with no `try`; if it raises, the whole verify 500s and the signer gets the
  server error state. Not exercised.
- **Touch drawing on a real touchscreen.** The `touchstart`/`touchmove`
  handlers were driven only through their mouse equivalents.
- **Concurrency against the live endpoint** — finding 2 above is read from the
  SQL, not reproduced.

---

## Changes

`frontend/src/pages/SigningPage.jsx` — +129 / −16.

- `initCanvas` wrapped in `useCallback([])` with a null-unmount branch, so React
  stops detaching and reattaching it every render.
- `hasInkRef` — set only when a stroke actually lands, cleared on Clear and on
  unmount; an untouched canvas is refused.
- `inFlightRef` latch on all four write paths.
- `loadDoc` extracted from the mount effect so `ErrorState` gets an `onRetry`,
  passed only for `kind === 'server'` (`denied` would render "Request access",
  meaningless to a signer with no account).
- `failMsg` — inline error copy derives from `errorKind`; the server's `detail`
  still wins whenever it sends one.
- Page-local truthful `detail` for the offline state.
- PDF link added to the `otp_verify` step.

`frontend/src/__tests__/signingPageBehaviour.test.jsx` — new, 41 tests.
**13 of them fail against the unmodified page** (verified by stashing the fix
and re-running), which is the regression proof that they test the defects rather
than the repair.

## Gates

```
npm run check    check-tokens: 356 declared, 244 referenced, 0 missing
                 check-classes: 3545 selectors, 2728 classes used, 0 missing a rule
                 check-contrast: no new failures and no regressions
                 EXIT: 0

npx vitest run   Test Files  48 passed (48)
                 Tests       761 passed (761)
                 EXIT: 0
```

Was 47 files / 720 tests; the 41 added here account for the difference exactly.
No lockfile touched. The line-ending-only churn git introduced on
`visual-regression.test.jsx.snap` was reverted — the snapshot is untouched.
