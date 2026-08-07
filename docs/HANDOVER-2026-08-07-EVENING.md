# Handover — 2026-08-07, evening

Written for the session the owner scheduled about an hour after 19:50 IST.
Everything here was measured against a device or against staging tonight.
Nothing is estimated.

---

## Where things stand

`staging` is pushed and green. Backend deployed at `ec2ed2b5`; the CSS fix
(`d4b8f80d`) precedes it. **Production was not touched** — no migration, no
production deploy, and the branch it tracks is unchanged.

- `mobile/` — 457 tests pass, `tsc --noEmit` exit 0
- `frontend/` — `npm run build` passes, `npm run check` exit 0
- Release APK built, v2-signed, verified: `build/Kartavaya-2.0.1-release.apk`

---

## What shipped tonight

Seven fixes. Each has a test that was proved to fail against the old code first.

| Commit | Fix |
|---|---|
| `2b2be2e0` | `TabScene` opened every screen at `opacity: 0`; the Fabric animation never completed, so the app was invisible |
| `be3ca64a` | Board chip rows unbounded on both flex ends |
| `f44edcf2` | Clock-in waited on a GPS fix with no timeout |
| `ff420731` | Location permission moved before the shutter |
| `66f6a61a` | The APK signature check had never actually run |
| `d4b8f80d` | Orphaned CSS broke the Vercel build |
| `ec2ed2b5` | **Every credit spend in the product was throwing** |

### The two that matter most

**The app was invisible, and three separate owner reports were one bug.**
`TabScene` opened each tab scene at `opacity: 0` and animated up to 1. On Expo
54 / RN 0.81 / Fabric that native-driver animation does not complete, so scenes
stayed at zero — mounted, laid out at full size, invisible. The tablet's empty
content pane, the task detail that "would not dismiss" (back *was* popping and
revealing an invisible Today), and the blank body on launch were all this.

`uiautomator dump` is what named it: the content region present with correct
bounds and no children. Screenshots could not distinguish "not rendered" from
"invisible".

The rule the file now carries: **a scene's visibility is never gated on an
animation completing.** Opacity is not animated at all; `translateX` keeps the
direction cue, because a stuck translate can only misplace a pane by 10px — it
cannot hide the product.

**Every credit spend was failing, and it was reported as "Sahayak is broken".**
`POST /api/v1/hub/chat` returned 500 in 0.72s — too fast to have called a model.
`services/credits.py` wrote `balance=$1+$2`; asyncpg sends parameters untyped,
Postgres saw `unknown + unknown` and refused with `AmbiguousFunctionError`.
Because the charge happens *before* the model call, no API key was ever reached.
Anything that debits credits failed identically — scrapers, skills, chat.

Proved against the live database with `conn.prepare()`, which parses and plans
without writing anything.

---

## The four approved jobs

The owner approved the plan and asked for these in this order. **Nothing has
been started.**

### 1 · Sahayak — start here

No decision pending and no migration. Details in the memory note
`sahayak-state-and-requirements`.

**Correction carried forward:** an earlier report said the grounding layer was
"never imported by the chat route". That was wrong — it read `hub_chat.py`, an
older router, while the live route is `routers/hub.py:sahayak_chat`, which
imports `services.sahayak_answer` at line 64 and uses it throughout. Grounding
works; verified live.

The real fault: `plan_for()` substring-matches against **nine** intents.
`"overdue task"` matches, `"open tasks"` does not. On no match it returns `[]`,
reads nothing, and the model answers ungrounded — producing *"I don't currently
have access to your task records"*, which is false. The degradation is silent.

Owner's requirements:

1. Read only the caller's own org, from **both Postgres and R2**
2. Respect per-user module permission — `withheld_for` stays the authority
3. Internet search via the Gemini key. `_call_gemini(grounded=True)` exists and
   turns on only when `task="chatbot"` is passed — verify the route passes
   `task`, not just `agent_type`; the file records that exact past bug
4. Rich UI matching the prototype — cards, work steps, figures, evidence,
   sources, refusal. Reference is
   `design-reference/Kartavaya Redesign/SahayakData.jsx`. The API already
   returns every one of those fields

Unconfirmed: one grounded reply came back `answered: true` with an empty message
body. Reproduce before treating it as a bug.

### 2 · Org switcher and the cross-org leak

**Blocked** on the owner putting `E2E_GODMODE_TOKEN` into `.env.e2e`. The
console snippet given to them copies it silently and prints only the account's
email.

Two leaks are recorded from an earlier audit — the `X-Org-Id` header being
honoured for platform roles it should not be, and a team-visibility function
returning every team in the database. Prove what actually leaks before changing
anything; half of those findings are usually stale. This touches tenant
isolation, where a wrong fix is worse than the bug.

### 3 · WhatsApp Business

Today it is in `ALL_PLATFORMS` with no entry in `OAUTH_CONFIGS`, so it answers
`400 Unsupported platform`. It is not an OAuth connector — Meta's Cloud API
wants phone number ID, WABA ID, a permanent token, a verify token the user
invents, and a read-only webhook URL to copy out. Plus a Test connection button.

### 4 · Connector credentials page

Largest. Migration approved by the owner ("approved as no one is working").

- **Both** models: Aekam-level default **and** per-client override. Lookup order
  per-client → Aekam → env var, so nothing that works today breaks
- **Forms must be platform-specific, not generic.** The owner was explicit. One
  shared "client id / secret" pair is not acceptable
- Each card shows the redirect URL to paste into that network's console
- Secrets encrypted at rest, never returned to the browser, owner/admin only
- **TikTok removed** (banned in India). **Twitter kept** — currently
  unconnectable; note X API v2 posting is a paid tier, establish cost first
- Telegram and Snapchat are also unconnectable and the owner has not ruled on
  them. Ask
- JustDial / IndiaMART: build the credentials form, but these are inbound lead
  sources, not publish targets. Ingestion is its own job once real keys exist

There is no existing credentials table. `staging.hub_social_accounts` holds
connected accounts and tokens only. **Staging and production share this schema.**

---

## Staging health, measured

207 parameterless GET endpoints probed as the E2E owner. **183 answered 200.**

- 17 × 403 are correct — platform-admin routes refused to an org owner
- 5 × 422 were the probe's fault, calling endpoints without required query
  parameters
- **`/api/v1/graha/inbound-emails` → 500**, undiagnosed
- **`/api/v1/me/requests` → 503** — the `account_requests` table does not exist
  on this environment

Every connector credential environment variable is absent, so no OAuth flow can
complete today. The E2E org has zero hub clients.

Writes were never exercised. This proves the product is reachable and healthy;
it does not prove flows complete.

---

## Traps

- **Hot reload lies on the mobile build.** Fast Refresh returned stale frames
  and produced three false readings in one session. Cold-restart between every
  probe: `adb shell am force-stop com.aekaminc.Kartavaya`, then relaunch
- **The Expo app is `com.aekaminc.Kartavaya`.** `com.aekam.kartavaya` is the old
  Capacitor wrapper and is also installed on the emulator
- **`npm run check` exits 0 on CSS that cannot be parsed** — it never runs
  `vite build`. That is how a broken stylesheet reached Vercel tonight. Run
  `npm run build` before pushing anything touching `.css`
- **Get route paths from `/openapi.json`**, never from memory. Guessed paths
  produced 404s that were reported as findings twice today
- Git Bash `/tmp` and `/c/...` paths are invisible to the Windows `python` on
  this machine. Pipe into `python -c` via stdin or use `C:/...` paths

---

## Still open from before

Production is ~1,144 commits behind and needs a rehearsal, not a push. Sanvaad
vocabulary conversion is parked. Three PNGs still carry the old diamond.
Pull-to-refresh is gone app-wide on mobile and the RefreshControl root cause is
still unproven. iOS and iPadOS are blocked on an Apple Developer account — the
code and config are ready, the machine is not.
