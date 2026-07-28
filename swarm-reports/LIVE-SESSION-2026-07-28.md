# Live session — 2026-07-28, from 15:05 BST

Real browser (Playwright) against **https://staging.kartavaya.com**.
Order per the plan: **compare → implement → test**.

---

## NEEDS THE OWNER

*(kept at the top, updated as the session runs)*

1. **RBAC sign-ins.** I can create the account ladder under a QA org and can
   verify the grant rows and the nav, but I cannot type a password, so the
   actual refusals must be observed by you — one sign-in per account. See
   the RBAC section for exactly which refusal to look for on each.
   *(status: pending — accounts not yet created at time of writing)*

2. **A product decision on F4 — invoice/deal list pagination.** Every list
   endpoint silently truncates (invoices at 200, deals at 200, vendor bills at
   200, bank statements at 500) with no total and no way to page. Above the cap
   the UI both hides rows and displays wrong totals. Fixing it properly means
   changing the response envelope on those endpoints and adding paging to the
   tables that read them — a real change, across the money path, 2.5 weeks
   before handover. **Options:** (a) full pagination on the six financial
   endpoints now; (b) raise the caps and add a visible "showing N of M" so
   nothing is silently hidden, then paginate after handover; (c) leave and
   accept it. My recommendation is **(b) then (a)** — (b) is small, removes the
   silent-wrong-number class of bug immediately, and does not risk the money
   path this close to handover. **Your call, and I have not started it.**

---

## Findings

### F1 — CSP block is FIXED and live. The console entry is a tool artifact. ✅

`E2E-PLAN-2026-07-28.md` records this as fixed in `8724dc9c`. Re-verified
live, because the Playwright console still surfaced:

```
Executing inline script violates ... 'script-src 'self' https://va.vercel-scripts.com'.
Either 'unsafe-inline', a hash ('sha256-4pEVfXQ1F7eho+kcMi5Ain6DIWMGHPGjtPExuWptQ+I='),
or a nonce is required.  @ https://staging.kartavaya.com/:14
```

That message is **stale** and should not be re-fixed. Three things say so:

- The header actually served on both `/` and `/dashboard` **contains** that
  exact hash: `script-src 'self' 'sha256-4pEVfXQ1F7eho+kcMi5Ain6DIWMGHPGjtPExuWptQ+I=' https://va.vercel-scripts.com`.
- The violation text quotes an enforced directive *without* the hash — i.e. a
  policy from before the deploy.
- Decisive: `data-platform` reads `win` live, and **nothing in `frontend/src`
  sets it** — only the inline script in `index.html` does. Its presence is
  proof the script executed.

`browser_console_messages` also reported `Total messages: 0 (Errors: 0)` while
returning that one entry, which is the tell.

**Care point that still stands:** if that inline script is ever edited the hash
must be regenerated, or this becomes real again.

### F2 — Windows glass override was half-done everywhere, now fixed at the token ✅

**Measured live before the fix**, `data-platform="win"` correctly set:

| Element | background | backdrop-filter |
|---|---|---|
| `.side` | `rgb(22,26,24)` opaque ✓ | `blur(13.2px) saturate(1.3)` ✗ |
| `.top` | `rgb(245,241,231)` opaque ✓ | `blur(13.2px) saturate(1.3)` ✗ |
| `.mnav` | opaque ✓ | `blur(13.2px) saturate(1.3)` ✗ |
| `.kv__mobbar` | opaque ✓ | `blur(13.2px) saturate(1.3)` ✗ |

The plan framed this as "add `backdrop-filter: none` to each". Reading the
spec first showed that to be the wrong shape of fix.
`design-reference/Kartavaya Redesign/tokens.css:238` does it **once, at the
token**:

```css
[data-platform="win"] { --glass-blur: 0px; --glass-alpha: 1; }
@media (prefers-reduced-transparency: reduce) { :root { --glass-blur: 0px; --glass-alpha: 1; } }
```

and `00-tokens.md:162` agrees — *"replaces **every** glass background"*. Every
glass surface already reads those two tokens, so one rule covers all of them
including ones written later. Patching surface by surface is why it kept coming
back half-finished; a count of the surfaces at the time of the fix:

- had the override: `.side` `.top` `.mnav` `.kv__mobbar` `.k-notif`
  `.tbl__bulk` `[data-k-palette] .k-cmdk` `[data-k-palette] .k-shortcuts`
- **did not**: `.lnav.solid` (landing.css:52)
- dead code, no override needed: `.k-glass` (editorial.css:4089) and
  `.card--glass` (components.css:110) are **unused in any JSX**;
  `.k-cmdk`/`.k-shortcuts` in editorial.css:3972/4026 are the legacy block that
  `KeyboardShortcuts.jsx:7` says is deliberately outranked by palette.css.

Shipped in `56745798`. The per-surface `backdrop-filter: none` rules were kept
on the always-visible chrome: `blur(0px)` is a visual no-op but still allocates
a compositing layer, and `01-navigation.md §43`'s stated reason for the opt-out
is Windows GPU/driver behaviour rather than appearance.

**Bonus defect found by reading the spec:** `prefers-reduced-transparency` was
**absent from the codebase entirely** (`grep` → no match). A user who asks the
OS to reduce transparency got full glass anyway. Added from `tokens.css:240`.

Gates: `check-tokens`, `check-classes`, `check-contrast` all pass (7 known
baseline contrast pairs, no new failures). `vite build` clean.

### F3 — `.side` blur value: the prose file is stale, the token is right ℹ️

The plan asked whether `.side` measuring `blur(13.2px)` against
`01-navigation.md §38`'s `blur(30px) saturate(1.8)` is drift.

**It is not drift — §38 is a pre-tokenisation snapshot.** The reference CSS
(`tokens.css:58`) and `00-tokens.md:154` both define
`--glass-blur: calc(22px * var(--glass-mix))` with `--glass-mix: .6`, giving
`13.2px`, and `--glass-sat: calc(1 + .5 * .6)` = `1.3`. Live measured exactly
those. §38's literals reproduce at no value of `--glass-mix`
(`1 + .5m = 1.8` → `m = 1.6` → blur `35.2px`, not 30). Per the plan's own rule
— reference CSS wins over prose — **the implementation is correct and no change
is warranted.** Closing this one rather than leaving it open.

### F4 — 🔴 HIGH · List endpoints silently truncate. Invoices are capped at 200.

**This is the most serious thing found so far, and it is not a design issue.**

Noticed because the Graha CRM page contradicts itself. Same screen, same moment:

- header: *"**199** deals have no next step"* with a **Fix** button
- panel: *"**510** deals have no next step. They are marked below."*

Both trace to one root cause.

**`/api/v1/graha/deals` returns exactly 200 rows and there is no way to get the rest.**

```python
# backend/routers/graha.py:686
query += "ORDER BY d.created_at DESC LIMIT 200"
rows = await pool.fetch(query, *params)
return {"data": [dict(r) for r in rows]}
```

Verified live:

| Check | Result |
|---|---|
| `/api/v1/graha/deals` | 200 rows |
| `/api/v1/graha/deals?limit=600` | **still 200** — no `limit` param exists |
| `/api/v1/graha/reports/forecast` | `510 New + 1 Discovery` = **511 deals** |
| response envelope | `{"data": [...]}` — **no total, no cursor, no page count** |

So **311 deals are unreachable from the Deals tab**, and nothing on screen says so.

The "199" is an artefact of that cap: the UI derives it client-side over whatever
rows it got (200 loaded − 1 that has a follow-up = 199). The panel's "510" comes
from the forecast aggregate, which sees all 511. The panel is right; the header is
wrong; **the header will always be wrong for any org with more than 200 deals.**

Confirmed the next-step relationship separately — `/api/v1/graha/follow-ups`
returns 1 row and deal objects carry no next-step field, so "510 have no next
step" is genuinely correct.

**The pattern is systemic, not one endpoint.** Across `backend/routers/`:

- **59** hardcoded `LIMIT n` clauses in list handlers
- only **3 of 40** routers accept an `offset` at all

The financially significant ones, all with no pagination and no total:

| Endpoint | File | Cap |
|---|---|---|
| `GET /invoices` | `ganit.py:394` | **200** |
| `GET /expenses` | `ganit.py:965` | 200 |
| `GET /contracts` | `ganit.py:1134` | 200 |
| `GET /vendor-bills` | `ganit.py:1782` | 200 |
| `GET /bank-statements` | `ganit.py:1999` | 500 |
| `GET /deals` | `graha.py:686` | 200 |

**Why this is urgent rather than a nice-to-have.** Two accounting firms take
handover on 15 August. A practice passes 200 invoices inside its first year, and
at that point older invoices stop being reachable in the UI with no error, no
empty state and no "showing 200 of N" — the list just ends. For an accounting
product the invoice list is the product. Silent truncation of financial records
is worse than an error, because an error gets reported and this does not.

Any total the UI computes client-side from one of these lists is also wrong above
the cap, exactly as the Graha "199" is — so this produces confidently displayed
incorrect numbers, not just missing rows.

**Not yet fixed** — see the decision note at the top of this file.

---

## Event log

*Format: page → action → expected → actual → console → network.*

| # | Page | Action | Expected | Actual | Console | Network |
|---|---|---|---|---|---|---|
| 1 | `/` | Load, existing session | Redirect to `/dashboard` | Redirected ✓ | clean (F1) | all 200 |
| 2 | `/dashboard` | Initial render | Real content, no empty tables | Receivables, cash chart, task list, activity all populated ✓ | clean | 13 calls, all 200 |
| 3 | `/dashboard` | Verify `total_outstanding` ₹152 | Not a rounding bug | API returns `151.6`; render correct ✓ | — | 200 |
| 4 | `/dashboard` | Check repeated `/notifications/poll` | Not a runaway timer | 60s interval; `onFresh`/`onPoll` both `useCallback([])` so the effect does not re-subscribe. Repeats were my own navigations ✓ | — | 200 |
| 5 | `/dashboard` | a11y landmark scan | Unique landmark names | 🟠 **TWO landmarks both labelled "Notifications"** — toast container `.k-toasts` and the notification panel. Ambiguous to a screen reader | — | — |
| 6 | `/settings/customize` | Navigate during my own deploy | — | Old chunk hashes 404 → SPA rewrite serves HTML → `Failed to load module script` ×5 → ErrorBoundary. Recovered on reload. **Real class of bug: any user mid-session during a deploy hits this.** No chunk-error retry handler exists | 9 errors | 404s |
| 7 | `/settings/customize` | Reload, measure glass under `data-platform=win` | blur 0, no compositing layer | `--glass-blur: 0px`, `--glass-alpha: 1`, `.side`/`.top` `backdrop-filter: none` ✓ **F2 fix verified live** | clean | 200 |
| 8 | `/settings/customize` | Enumerate tabs | 6 per spec | Appearance · Typography · Layout · Language · Notifications · Data & privacy ✓ | clean | — |
| 9 | Appearance tab | Check live accent preview | `.accpv` present | Present ✓ — plus `.sbg` sidebar-bg cards, `.acc` accent grid | clean | — |
| 10 | Typography tab | Check type preview | `.tpv` with 4 vars | Present with `--pv-d` `--pv-u` `--pv-fs` `--pv-lh` ✓ 13 font rows, each rendered in its own face ✓ | clean | — |
| 11 | Typography tab | Select display font "Spectral" | Preview updates live | `--pv-d` → Spectral, `.tpv h4` → Spectral, **and the whole app** `--font-display` → Spectral ✓ instant-apply, no save button | clean | — |
| 12 | Typography tab | Revert to Newsreader | Restores | Restored ✓ (owner's own prefs left as found) | clean | — |
| 13 | Layout tab | Enumerate control groups | 4 per spec | Sidebar width · Density · Corner radius · Animation ✓ | clean | — |
| 14 | Layout tab | Density → Compact | Applies + persists | `data-density="compact"` on `<html>`, written to `k_prefs` ✓ | clean | — |
| 15 | Layout tab | Density → Cozy (revert) | Restores | Restored ✓ | clean | — |
| 16 | `/graha` | Load | Real content | Loaded, 6 top tabs + **"More +11"** → 17 tabs total, confirming the nested tab tree | clean | all 200 |
| 17 | `/graha` pipeline | Read the two "no next step" counts | Agree | 🔴 **199 vs 510 — contradict.** Root cause F4 | clean | all 200 |
| 18 | `/graha` | `deals?limit=600` | Honours limit | 🔴 Still 200 — no limit param. F4 | — | 200 |

