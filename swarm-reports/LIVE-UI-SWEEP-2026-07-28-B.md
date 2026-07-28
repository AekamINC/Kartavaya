# Live UI sweep — 28 July 2026, session B

Driven with **Playwright against https://staging.kartavaya.com**, signed in as
`kevalvshah03+qaadmin@gmail.com` (`user_76cd525348e1`, **org_admin**, QA Test
Corp `fae87907-2f99-4b35-a241-c94d9e1e4a17`). Every finding below came from
clicking a control and watching what happened.

## Correction to the handover, first

`NEXT-SESSION.md` says *"Tokens are in NEXT-SESSION.md"*. **They are not** —
there is no token in that file, none anywhere in the repo, and no saved
Playwright `storageState`. I nearly reported the session blocked on that.

**The Playwright browser profile was already signed in as `qaadmin`.** That is
how this session ran. Worth recording, because the same profile is how the next
session gets in without the owner doing anything — and if it is ever cleared,
tokens genuinely do become blocking.

**Resolved mid-session:** the owner supplied all three tokens, so `qaviewer` and
`qamember` were both driven live in the browser. F32 and F33 are verified as the
actual users — see the RBAC section. Tokens expire **2026-08-04**.

**Fixture left as found:** `qaviewer`'s `ganit` grant was added for the F33 test
and **revoked afterwards** (`modules: []`, 200). The browser profile is signed
back in as `qaadmin`.

---

## F36 — 🔴 The organisation's address is silently corrupted on save

**The clearest user-facing bug found this session.** Type a company address into
Settings → Organisation → Company Profile, press Save, get **"✓ Company profile
saved"**, reload — **every address field is blank.**

Verified through **two independent input paths** (a synthetic React setter and
real Playwright keyboard `fill`) so it is not a harness artifact. GSTIN, PAN,
Email and Phone in the *same form and same save* persist correctly; only the
jsonb-backed fields fail.

What is actually stored, read back from `GET /api/v1/org/profile`:

```
billing_address: STRING, length 1500
  122 character-indexed keys  "0":"{", "1":"\"", "2":"l", "3":"i", "4":"n" …
  + the 6 real keys           line1, line2, city, state, pincode, country
```

### Root cause — a double-encode, and it is systemic

`db.py:24` registers a jsonb codec whose **encoder is `json.dumps`**:

```python
def _json_encoder(value): return json.dumps(value)
await conn.set_type_codec("jsonb", encoder=_json_encoder, …)
```

`org_profile.py` then *also* dumped before binding to a `::jsonb` parameter:

```python
sets.append(f"{key}=${idx}::jsonb")
params.append(json.dumps(val or {}))      # ← dumped a second time by the codec
```

So the column holds a JSON **string scalar**, and the matching decoder
(`json.loads`) hands that string back on read. `TabProfile.jsx:79` then does:

```js
billing_address: { ...EMPTY.billing_address, ...(r.data.billing_address || {}) }
```

Spreading a **string** in JavaScript is legal and yields `{0:'{', 1:'"', …}` —
one key per character. That object is what gets PATCHed back. Nothing throws,
nothing logs, and the UI reports success.

**Why it matters beyond cosmetics:** `billing_address` is the supplier address on
every invoice PDF, and `state` is what drives the IGST vs CGST/SGST split.
`bank_details` — account number, IFSC, UPI, printed on every invoice so clients
can pay — goes through the identical line 80 and is one edit away from the same
fate. It is intact today only because nobody has saved bank details since.

### Fixed

| File | Change |
|---|---|
| `backend/routers/org_profile.py` | bind `::text::jsonb` so asyncpg infers *text* and the codec never applies — correct whether or not the codec registered, which matters because `_init_conn` only **warns** when PgBouncer defeats it |
| `backend/routers/org_profile.py` | GET parses jsonb defensively (mirroring `documents.py:101`), unwraps a doubly-encoded value, and strips numeric keys so an already-corrupted row renders its real fields |
| `frontend/src/pages/org/TabProfile.jsx` | `asObject()` guard — a string can never be spread character-wise again |

`94 backend tests pass`, `vite build` clean.

### Verified live after deploy ✅

Reloaded Settings → Organisation on staging once the fix shipped:

- Every address field now renders its real value — `12 Ashram Road`,
  `Ahmedabad`, `Gujarat`, `380009`, `India` — **recovered out of the corrupted
  1500-character string** by the client guard.
- Pressing Save then wrote a clean object back. `GET /v1/org/profile` now
  returns `billing_address` as a **real object**, **0 numeric keys** (was 122),
  with the six correct fields.

**The corrupted QA Test Corp row is repaired**, not merely masked.

### NOT yet done — the scope beyond this one file

`json.dumps` appears **170 times across 42 backend files**. Every site that dumps
before binding a `::jsonb` parameter has this same defect. I have **not** audited
them and am not claiming they are all affected — that needs reading each call
site, and this report's predecessor was burned twice for asserting a pattern from
one measurement. `graha.py` (18), `hub.py` (20), `prachar.py` (10) and `ganit.py`
(8) are the largest and should be checked first.

The QA Test Corp row has since been rewritten clean (see above). Any **other**
org whose profile was saved through the old build carries the same corruption
and needs the same one-save repair.

---

## F34 — 🟠 An entirely empty invoice form creates a real invoice

Clicked `+ New invoice`, filled in **nothing**, clicked `Create invoice`.
`POST /api/v1/ganit/invoices → 200`. It created **`INV-2026-0008`** — no
customer, no line items, no dates, no place of supply, ₹0.

No client validation, no server rejection, no warning.

This is not a hypothetical: it is where `INV-2026-0001` and `CN-2026-0002`
came from. The app's own GST Filing tab then reports the damage:

> **4 documents are held back from these exports**
> `CN-2026-0002 — no customer name — Tally needs a party ledger`
> `INV-2026-0001 — no customer name — Tally needs a party ledger`
> `INV-2026-0006 — no customer name — Tally needs a party ledger`
> `INV-2026-0008 — no customer name — Tally needs a party ledger`

**Half the invoice ledger (4 of 8) is unexportable** because the create path
accepts what every export path then refuses. The export-side message is
excellent; the create path should not have allowed it in the first place.

---

## F37 — 🟡 A success toast and a failure toast render together

Saving the profile with an invalid GSTIN correctly shows
`"GSTIN is 15 characters (this is 12)."` and `"✕ Fix the highlighted codes
before saving"`. Correcting the value and saving again shows
**`"✓ Company profile saved"` while the `"✕ Fix the highlighted codes"` toast is
still on screen.** The stale error is not dismissed by the succeeding save, so
the user is told both that it saved and that it did not.

## F38 — 🟡 The tab badge does not refresh after a create

After creating an invoice the table went to 8 rows while the `Invoices` tab badge
stayed at `7`. Reload corrected it to `8`. The list refetches; the count does not.

## F39 — 🟡 The tab overflow menu is headed "ALL TABS · 10" and lists 2

Ganit's `More +2` menu is titled **`ALL TABS · 10`** but contains only the two
tabs that overflowed (Timesheet, GST Filing). Either the heading is wrong or the
menu is incomplete.

## F40 — 🟡 Sanvaad blames the wrong thing and offers a remedy that cannot work

`/sanvaad` as **org_admin** returns 403 on `/v1/messaging/me`, `/channels` and
`/whatsapp/conversations`. That refusal is *correct* — Sanvaad is not an active
module for QA Test Corp. But the screen says:

> **You don't have access to this**
> Your channel list did not load. This is a read failure; no channel or message
> was removed. **[Request access]**

The cause is not access, it is **activation**. The API's own message says so —
*"Module 'sanvaad' is not active. Contact your administrator to activate it."* —
and the UI discards it for a generic one. `Request access` is the wrong remedy:
no grant will ever open a module that is switched off at the subscription level,
so the button sends the user down a road with no end.

Compare Vetana's refusal, which the previous session rightly called the best in
the product: it names the module, the exact level required, and why.

**And an F32 instance on a module not previously examined**: beneath the refusal
the panel still reads *"Pick a channel or a direct message on the left, **or
create one** to start a conversation."* — inviting an action every endpoint on
the page has just refused.

---

## Checked and deliberately NOT filed

The predecessor report lost hours to claims that did not survive checking. These
four looked like findings and are not:

- **`Bhumi (Aekam Inc)` in the invoice customer picker** — looked like a
  cross-org leak from QA Test Corp into Aekam Inc. It is not: `Aekam Inc` is the
  **company field on a contact named Bhumi** inside QA Test Corp. Confirmed
  against the Graha contact list.
- **KPI "6 unpaid of 7" beside a tab badge reading 8** — the KPI excludes credit
  notes from both numerator and denominator. Internally consistent, and correct
  accounting. Not a defect.
- **GSTR-1 export refusing** — *"Your organisation has no GSTIN on its company
  profile"* is **true**: QA Test Corp's GSTIN was genuinely empty. The settled
  `24AAAAA0000A1Z8` belongs to **Aekam Inc**, a different org. The refusal is
  correct behaviour and the message names the exact fix path.
- **Tabs 3–8 all rendering the Products panel** — a **harness bug**, not a
  product bug. Clicking `More` re-rendered the tab strip and detached the node
  references my loop was holding. Re-querying fresh each iteration, all 8 tabs
  land correctly.
- **`/vetana` showing "This page didn't load"** — caused by **my own deploy**.
  Pushing to `staging` redeployed Vercel and replaced the hashed assets while
  the tab still held the previous `index.html`, so `VetanaPage-gh5ZUtOw.js`
  404'd and the SPA fallback served HTML, tripping the module MIME check. A
  reload fixed it and all 6 Vetana tabs then loaded. **Not a product defect** —
  though it is worth knowing that any deploy strands open tabs on a dead-end
  error, and `Try again` re-imports the same dead URL rather than reloading.
- **Sanvaad returning 403 to an org_admin** — correct. The module is inactive
  for this org; org_admin reaches every *active* module, not every module. What
  is wrong is only the wording (F40).

---

## Data created in QA Test Corp

Writing freely is authorised by `E2E-PLAN-2026-07-28.md` ("all test data gets
deleted at the end of the week").

- Org profile: GSTIN `24AAAAA0000A1Z8`, PAN `AAAAA0000A`, email, phone, website
  — all synthetic. Address entered but **not stored** (F36).
- 5 contacts, one per type, verified present in the API, the table and the tab
  badge (all agree at 9): Meera Shah (customer), Anil Verma (lead), Priya Nair
  (customer), Rakesh Gupta (vendor), Sunita Rao (partner).
- `INV-2026-0008` — the empty invoice from F34. **Left in place deliberately** as
  the evidence, and because it is what the export tab is counting.

---

## Coverage — honest accounting

| Surface | Role | Events | State |
|---|---|---|---|
| `/ganit` — all 8 visible tabs + both overflow tabs | org_admin | ~24 | done |
| `/ganit` create form, empty submit, detail drawer, Esc close | org_admin | ~8 | done |
| `/ganit` GST Filing — GSTR-1, GSTR-3B, held-back list | org_admin | ~5 | done |
| `/settings/organisation` — profile CRUD, invalid + valid save, persistence, repair | org_admin | ~16 | done |
| `/graha` — 8 tabs enumerated, Contacts CRUD ×5 | org_admin | ~15 | partial |
| `/vikray` — 6 tabs | org_admin | ~7 | done |
| `/manav` — 8 tabs | org_admin | ~9 | done |
| `/vetana` — 6 tabs (after reload) | org_admin | ~7 | done |
| `/prachar` — 8 tabs | org_admin | ~9 | done |
| `/dristi` — 8 tabs | org_admin | ~9 | done |
| `/sanvaad` — 2 tabs + refusal state | org_admin | ~4 | done |
| `/esign` — 2 tabs | org_admin | ~3 | done |
| `/dashboard` | org_admin | ~4 | done |

**~120 events.** Console clean throughout except the two handled 422s on GSTR-1
and the three expected Sanvaad 403s.

Every tab in every module was confirmed to *land* (`aria-selected` matched the
tab clicked) — the check that caught my own harness bug.

**Not started:** Srijan/`hub`, Boards, Projects, Tasks, the task drawer,
Approvals, Activity, Inbox, Teams, Templates, Categories; Graha tabs past
Contacts; every detail drawer and edit form outside Ganit; downloads (invoice
PDF, payslip, Tally XML, CSV exports); scrapers; AI/skills; notifications.

Then, once the tokens arrived:

| Surface | Role | Events | Result |
|---|---|---|---|
| sidebar after `ganit` grant | `ganit: viewer` | ~4 | **F33 fixed, verified** |
| `/ganit` list + create form + full invoice + submit | `ganit: viewer` | ~10 | **F32 reproduced**, F41 found |
| sidebar with no grants | grantless member | ~3 | correct — Payroll absent |
| `/vetana` → Run payroll → tab → month → Process → modal → Cancel | grantless member | ~8 | **F32 escalation chain** |

**~145 events total**, across three roles.

## F33 — root cause found and fixed (code), NOT yet verified live

The handover diagnosed this as `GET /v1/org/modules` returning `[]`. **That
endpoint is not what the nav reads** — it is org-settings-gated and 403s for a
member. The nav reads `user.module_grants` from `/auth/me`
(`navConfig.js:228,284`).

`auth_router.py:209` subtracted `SENSITIVE_MODULES` from a member's grants:

```python
return sorted({r["module_code"] for r in rows} - SENSITIVE_MODULES)
```

`SENSITIVE_MODULES` is `{vetana, manav, pahchan, ganit}`. So a member holding
`ganit: viewer` received `module_grants: []` and the sidebar hid Finance —
exactly what was observed — while `require_module` honoured the grant, which is
why typing `/ganit` worked.

The subtraction read `SENSITIVE_MODULES` as a prohibition. `role_tiers.py:203`
defines it as *"modules whose grants are **withheld by default** when a member is
added without an explicit list"* — a default about granting, not about display.
Removed, with the reasoning in place so it is not reinstated.

**This needs the `qaviewer` token to confirm live.**

---

# RBAC verified live — the owner supplied all three tokens

## F33 — ✅ VERIFIED FIXED, in the browser, as the user

Granted `ganit: viewer` to `qaviewer`, loaded that session, reloaded the app.
Signed in as **`Kev Ganit · Member · QA Test Corp`**:

| | Before (2026-07-28 session A) | After the fix |
|---|---|---|
| Sidebar sections | WORKSPACE · OPERATIONS · TEAM · SETTINGS | WORKSPACE · OPERATIONS · TEAM · **REVENUE** · SETTINGS |
| Finance entry | **absent** | **present** — `Finance गणित` |
| `/auth/me` `module_grants` | `[]` | `["ganit"]` |

And correctly **only** Finance under REVENUE — not CRM or Sales, which this user
does not hold — with `Roles & access` and `Organisation` still hidden because
they are `orgAdminOnly`. The nav now shows exactly what the API honours.

## F32 — ✅ REPRODUCED LIVE on both modules, and it is worse than reported

### As `ganit: viewer`

`+ Invoice` and `+ New invoice` both render, **both enabled**, no tooltip, no
disabled state. I opened the form and composed a complete invoice — customer,
place of supply, description, 3 × ₹25,000 — watched the live preview compute
**Subtotal ₹75,000 / Total ₹88,500**, and pressed **Create invoice**:

> ✕ **Your ganit access is Viewer: you can read it, but not change it. Ask an
> org admin for Editor.**

**Two corrections to the session-A account of this finding:**

1. **The typed data is NOT lost.** Session A said *"Everything typed is lost"*.
   It is not — the form is retained after the refusal, so the work survives.
   That lowers the severity from "destroys work" to "wastes it".
2. **`/v1/org/modules` was never the mechanism** for F33 — see above.

### As `org_member` with ZERO grants — the sharpest evidence

`/vetana` renders **`Run payroll`, enabled**, to a member with no Vetana grant.
No salary figures leak (verified: no `₹` anywhere on the page) and the refusal
text is genuinely the best in the product.

**But the page header and the nav disagree from the same data.** Payroll is
correctly **absent from this member's sidebar** — `canSeeNavItem` consults
`module_grants` and gets it right — while the page shell, ten pixels away,
offers the button that executes payroll. That is F32 in one sentence: *the
information is already on the client and one of the two consumers ignores it.*

**And clicking it escalates.** `Run payroll` → switches to the Payroll tab →
month picker → `Process payroll` → a **confirmation modal**:

> *"Process payroll for June 2026? This writes a payslip for every employee with
> a salary structure, and **emails each of them their payslip with the PDF
> attached**. Running the same month again deletes and rebuilds its payslips,
> which sends that email a second time."*

**Four steps deep, all offered to a member with no grant at all**, ending at a
`Process and email` button.

**I did not press it.** It is an irreversible outbound action that would mail
payslips to real addresses, and F32 is fully established without it. The API is
expected to refuse (session A verified `POST` → 403), but "a previous session's
probe says so" is not a reason to fire payroll emails. `Cancel` closed the modal
cleanly.

## F41 — 🟠 A viewer is told "You can still create the invoice"

On the same viewer create-form, the customer dropdown fails to populate — the
viewer holds `ganit` but not `graha`, so the contacts fetch 403s. The message:

> ✕ **Could not load customers** — *"You can still create the invoice — pick the
> customer later."*

**False twice over.** This user cannot create *any* invoice, and a customer is
not optional on a tax invoice — the GST Filing tab refuses to export exactly the
invoices that lack one (F34). The reassurance actively encourages the user to
spend more effort on something that cannot succeed.

## F32 — the fix, diagnosed but not written

Write affordances render from the page shell because **the client has no level to
consult**. `_module_grants` returns module **codes only**; there is no level
anywhere in `frontend/src` except `useSanvaadAccess.js`, which fetches a
bespoke `/v1/messaging/me` for exactly this reason and says so in its header.

So the central fix has a prerequisite: `/auth/me` must carry the caller's level
per module, mirroring `require_module` gate for gate. Then one shared hook, and
`ModuleHeader` (which already takes `module`) can gate its `actions` for every
module page in one place — that covers both reported instances (`+ Invoice`,
`Run payroll`).

Catalogued this session, for whoever does it — Ganit alone offers **16** write
controls: `+ Invoice`, `+ New invoice`, `+ Add product or service`, `Edit`,
`Delete`, `+ Category`, `+ Add expense`, `+ Vendor`, `+ Vendor bill`,
`+ New contract`, `+ New recurring invoice`, `Generate now`, `Deactivate`,
`Import CSV`, `Mark sent`, `Record payment`.

## Worth a look — not verified

Ganit → Recurring shows an **Active** recurring invoice whose next run is
**2026-07-23**, five days before today. Either the generator is not running or
`next_run` is not advancing. I did not press `Generate now` to avoid confusing
the invoice ledger mid-investigation.
