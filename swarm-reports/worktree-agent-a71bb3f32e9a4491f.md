# Sanvaad messaging frontend — agent report

Branch: `worktree-agent-a71bb3f32e9a4491f`
Scope: `frontend/src/pages/sanvaad/**` + `frontend/src/styles/sanvaad.css`
Governing spec: `design-handover/06-sanvaad-varta.md`, `design-handover/24-bilingual-devanagari.md`
Design source: `design-reference/Kartavaya Redesign/{ScreensSanvaad,ScreensVarta,IxChat}.jsx`

Written incrementally. Every line-number claim below was opened and read at the time of writing.

---

## 0 · Worktree was cut from the wrong base — read this first

The worktree arrived on a branch whose HEAD was `1aa4985`, which is the tip of
**`main`**, not `staging`:

```
ahead of origin/staging:   13
behind origin/staging:    271
merge-base:           294e9e2
```

Neither `frontend/src/pages/sanvaad/` nor `design-handover/` exists at that
commit — the entire module and its whole specification are staging-only. Any
agent that started work without checking would have been writing against a
tree 271 commits stale, or would have concluded the module does not exist.

`git branch -a --contains 1aa4985` lists **`main` plus ~20 sibling
`worktree-agent-*` branches**, so this is not specific to me; the whole swarm
appears to have been cut from `main`. Sibling agents should verify their base
before trusting any "file not found" result.

Resolved by `git reset --hard origin/staging` on my own agent branch. `main`
was not touched.

---

## 1 · Claims: HELD vs STALE

### HELD — Devanagari in input placeholders (FIXED)

`24-bilingual-devanagari.md:199` is the governing line:

> **No:** validation messages, error text, empty-state explanations, tooltips,
> form field labels, table column headers, anything inside a data cell.

Three sites, all confirmed by opening the file:

| File | Was |
|---|---|
| `ChatPane.jsx:79` | `'Write a message…  संदेश लिखें'` |
| `Composer.jsx:114` | `'Write a message…  संदेश लिखें'` (default) |
| `ThreadPanel.jsx:141` | `'Reply…  उत्तर दें'` |

Fixed in `6e233ff`. The editorial argument is the handover's own; the
structural argument is stronger and is recorded in `Composer.jsx`: a
placeholder is a plain string attribute, so Devanagari inside one can **never**
carry `lang` or `--font-indic`. `24` requires both of every Indic run — without
`lang` a screen reader speaks Devanagari in the English voice (`24:113`);
without `--font-indic` an EN+GU user is served Devanagari where they chose
Gujarati (`24:131`). Every other Indic string in this module is a nested
element for exactly that reason. A placeholder cannot be one.

**Deliberately not changed** — correctly marked-up Devanagari that the same
spec permits:

- `ChannelList.jsx:65`, `MessageLog.jsx:81`, `WhatsAppTab.jsx:110` — `.sv__hi`
  spans carrying `lang="hi"`.
- `MessageLog.jsx:55`, `ChannelsTab.jsx:99`, `WhatsAppTab.jsx:198/212/239/268`
  — `EmptyState` `{en, hi}` titles. `EmptyState.jsx:120-127,142-145` splits
  these into a `lang`-tagged `.empty__title-hi` span. These are empty-state
  *titles*; the "No" list names empty-state *explanations*, and every
  `description` prop in this module is English-only.
- `messageUtils.js:107,122,123` — day separators ("Today · आज"), rendered
  through `MessageLog.jsx:22`'s `.sv__hi` span with `lang="hi"`.

---

## 2 · The headline: Sanvaad is gated on a module code nothing can activate

This is the answer to "threads must be reachable", and the frontend is not
where it fails. Every link in the chain below was opened and read.

1. `backend/routers/messaging.py:21` — `_gate = require_module("samvada")`.
   Every one of the router's 16 endpoints depends on it.
2. `backend/middleware/subscription.py:180-184` — that literal is matched
   against `staging.module_subscriptions.module_code`:
   ```sql
   SELECT 1 FROM staging.module_subscriptions
   WHERE org_id=$1::uuid AND module_code=$2 AND is_active=TRUE
   ```
   The check runs for **everyone who is not platform staff** — `org_owner` and
   `org_admin` skip the per-user grant check at line 120-126 but still fall
   through to this one. A miss is `403 "Module 'samvada' is not active"`.
3. `backend/routers/admin_orgs.py:812-816` — the **only** endpoint that inserts
   a `module_subscriptions` row accepts eight codes:
   `graha, ganit, manav, vikray, vetana, dristi, prachar, srijan`.
   **Neither `samvada` nor `sanvaad` is among them**, and line 824-825 raises
   `400 "Unknown module"` for anything else.

**So no org can have messaging activated through the application at all.** A
row can only exist if it was written out-of-band, and the gate passes only if
that out-of-band row happens to spell it `samvada`.

`catalogue.js:29-30` states, as a verified-against-live-DB claim, that
`module_subscriptions` holds `sanvaad` and never `samvada`. I could not verify
that myself (no DB read). **If it is true, every Sanvaad endpoint 403s for
every non-platform user, and the module is entirely dead** — the frontend I own
is correctly wired to real routes that all answer 403 before reaching a query.

Corroborating, and the reason nobody noticed:
`backend/tests/test_messaging_security.py:15-21` is an **`autouse` fixture that
overrides `_gate` to a no-op for every test in the file**. The whole messaging
suite is green precisely because it never exercises the gate that fails.

`backend/routers/search.py:138` maps `"messages": "samvada"`, so in-app message
search is behind the same gate and fails the same way.

**This is the other agent's to fix** (`role_tiers.py` / the gate spelling). The
frontend change that pairs with it is one line — `catalogue.js:65`'s `code`
and `subCode` collapse to a single `sanvaad` — and I have deliberately NOT made
it, because flipping the client while the server still says `samvada` breaks
grant writes. **The two halves must land in the same commit.**

`admin_orgs.ALL_MODULES` needs the messaging code added regardless of which
spelling wins, or the module stays unactivatable either way. Nobody currently
owns that line; flagging it here.

---

## 3 · Every `samvada` / `sanvaad` mismatch in frontend files

Module **code** occurrences (the ones that string-match against the backend):

| File · line | Spelling | Note |
|---|---|---|
| `pages/org/catalogue.js:65` | `code: 'samvada'` + `subCode: 'sanvaad'` + `colorKey: 'sanvaad'` | the workaround itself — **three** spellings on one row |
| `pages/org/levels.js:31` | `NO_APPROVER_MODULES = [… 'samvada' …]` | mirrors `role_tiers.py:228`; flips with the backend |
| `pages/AdminOrgsPage.jsx:71` | `{ code: 'samvada', label: 'Sanvaad · Messaging' }` | the operator toggle; also carries `wired: false` (line 63/78) because `admin_orgs.ALL_MODULES` omits it |
| `components/layout/navConfig.js:60` | `module: 'sanvaad'` | nav gate |
| `components/layout/navConfig.js:160` | `to: '/sanvaad'` | mobile nav |
| `lib/moduleColors.js:20` | `sanvaad:` | colour key |
| `lib/commands.js:64` | `id: 'sanvaad'` | palette |
| `pages/onboarding/data.js:20,40,43` | `'sanvaad'` | onboarding presets |
| `App.jsx:85,240` | `SanvaadPage`, `path="sanvaad"` | route |

**Not a mismatch — leave alone.** `pages/sanvaad/useChannelMessages.js:9,104`
and my new comment in `backend/routers/messaging.py` name
`staging.samvada_messages` / `samvada_channel_members`. Those are **physical
table names** from `migrations/058_sanvaad_messaging.sql` and are correctly
`samvada_`. Renaming them is a migration, not a spelling fix.

Net: the frontend says `sanvaad` **everywhere a user or a route is involved**,
and `samvada` **only in the three places that must match a backend grant**. It
is internally consistent and correctly reflects the split. Nothing here should
change until the backend half lands.

### Two of the three claimed workarounds are STALE

| Claim | Verdict |
|---|---|
| `subCode` in `catalogue.js` | **HELD** — `catalogue.js:65` and the accessor at `:101` |
| comment in `TabModules.jsx` | **HELD** — `TabModules.jsx:56-59`, and the `subscriptionCode` guard at `:63` is live code, not just a comment |
| `_ENTITLEMENT_SPELLING` in `backend/routers/org_modules.py` | **STALE — does not exist.** `grep -rn "_ENTITLEMENT_SPELLING" --include=*.py backend/` returns nothing, and `backend/routers/org_modules.py` is not a file. The org routers present are `admin_orgs.py`, `org_members.py`, `org_profile.py` |

Also stale as stated: **"a live CHECK constraint spells it `samvada`."** The
only CHECK naming `samvada` is
`migrations/PROPOSED_066_tier3_tier4_roles.sql:45` — a **PROPOSED**, unapplied
migration — and it constrains `org_member_modules.role`, not a module code.
`module_subscriptions.module_code` is plain `TEXT` with **no** CHECK at all
(`migrations/010_staging_schema_subscription.sql:71`). Nothing in the schema
enforces either spelling; the rows are simply whatever was written.

---

## 4 · Message operations against the actual routes

| Operation | Route | Before | Now |
|---|---|---|---|
| send | `POST /messaging/channels/:id/messages` | wired | wired |
| read receipt (mark) | `POST /messaging/channels/:id/read` | wired | wired |
| thread read | `GET /messaging/messages/:id/thread` | wired | wired |
| reactions | `POST` / `DELETE …/reactions` | wired | wired |
| **edit** | `PATCH /messaging/messages/:id` | **route existed, ZERO callers** | wired |
| **delete** | `DELETE /messaging/messages/:id` | **route existed, ZERO callers** | wired |
| **pagination** | `GET …/messages?before=` | **param existed, never sent** | wired |
| **read receipt (display)** | — | **no endpoint returned it** | added to `list_messages` |

`06 §4` lists `GET /messaging/channels/:id/thread/:messageId` as **new**. It is
not — `GET /messaging/messages/:id/thread` has existed since migration 058 at a
different path. `ThreadPanel.jsx` already used it. **Spec claim stale**, and
the file already says so at its head; I confirmed it rather than re-fixing it.

**Threads were reachable before I started.** `06 §4`'s "the replies are
unreachable" is **STALE** — `ThreadPanel.jsx` exists, is mounted from
`ChannelsTab.jsx:105-115`, and `Message.jsx`'s `.msg__thr` opens it.

### What I added

- **edit / delete** — `MESSAGING-ATTENDANCE-SPEC.md:24` requires an edited
  marker and a tombstone; `is_edited`/`is_deleted` were columns the UI could
  render and never produce. `ScreensSanvaad.jsx:157` ends the hover tray with a
  **More** button, the only one of the three tray controls never built — which
  is exactly why neither operation had a way in.
- **`(edited)` moved to `.msg__ed` on the body** (`app.css:432`). It was in the
  header beside the timestamp, where a **continuation row — which has no
  header — could never show it**, so an edited follow-up message was silently
  indistinguishable from an unedited one. Real bug, found by reading the design.
- **tombstone** `.msg--gone` / `.msg__tomb` (`ScreensSanvaad.jsx:118`,
  `app.css:439`).
- **scrollback** — only the newest 50 messages in a channel were reachable;
  everything older sat on the server unreadable.
- **`.seen` read receipts** and **`.thrl__t` "Last reply …"**, fed by
  `seen_by` / `seen_count` / `last_reply_at`, which I added to `list_messages`.

---

## 5 · Polling and cleanup — claim STALE, all four are clean

"A leaked interval in a chat pane is a real bug" — true in general, **not true
here**. The module polls (no Realtime) and every timer and listener is
released:

| Site | Cleanup |
|---|---|
| `useChannelMessages.js:78-82` | `clearInterval` + `removeEventListener('visibilitychange')` |
| `varta/WAChat.jsx:57-61` | `clearInterval` + `removeEventListener('visibilitychange')` |
| `varta/WindowBanner.jsx:18-19` | `clearInterval` |
| `useStickyScroll.js:52-53` | `removeEventListener('scroll')` |

Both pollers also skip the tick while `document.hidden`, and neither touches
`loading` after the first load — the three things `06 §2b` actually objects to
are already fixed. Realtime is deliberately not used, for the two reasons
documented at `useChannelMessages.js:12-21` (no RLS on `staging.*`, so
`postgres_changes` has no policy to authorise against — publishing it would be
a cross-tenant leak; and the raw row carries none of the four joined fields).
I re-read `migrations/058:83` and confirm the table **is** published, so the
third reason previously given there was indeed wrong.

---

## 6 · Cross-org thread access — blocked, but I found an intra-org hole

**Cross-org: correctly blocked, at both ends.**

- Frontend sends only `channelId` / `messageId`; it never sends an org id.
  `middleware/org_resolver.py:22-40` resolves the org server-side, and an
  `X-Org-Id` header is validated against `staging.user_roles` membership
  (403 if not a member) before it is honoured. A client cannot pick its org.
- `list_messages` (`messaging.py:284-291`) scopes the channel by `org_id` → 404,
  then requires membership for non-public channels → 403.
- `edit`, `delete`, both reaction endpoints and `get_thread` all scope by
  `org_id`.

**The hole I found and fixed** — `get_thread` checked the **org** and not the
**channel**. Any member of the org could read the replies inside a **private
channel they had never joined**, given only a message id. It was the one read
path in the router gated differently from `list_messages`. Fixed in `31fc4a9`
with the same test, order and 404/403 split as `list_messages`.

`mark_read` is not org-scoped, which is harmless: its `UPDATE` is keyed on
`(channel_id, user_id)` and can only ever touch the caller's own membership row.

---

## 7 · Devanagari and fonts — the coordinator's flagged defect is already fixed

The `--font-indic` → Noto Sans Gujarati → zero Devanagari coverage problem is
real **and already mitigated globally**, before I arrived:
`components/CustomizePanel.jsx:292-295` sets `--font-indic` under `en+gu` to
`"'Noto Sans Gujarati', 'Shruti', 'Tiro Devanagari Hindi', 'Nirmala UI', 'Kohinoor Devanagari', sans-serif"`
— Gujarati resolves first, Devanagari falls through to Tiro. So `.sv__hi` on
`--font-indic` renders Tiro under every language setting. **No change needed in
my files**; changing them to `--font-hindi` would be churn with no visual delta.

`.sv__hi` (`sanvaad.css:41-46`) already sets `font-weight: 400`, so the
faux-bold-Tiro-inside-a-700-label case does not arise even though `.sv__lt` is
700. Verified rather than assumed.

The global `[lang="hi"]` guards for line-height and tracking are at
`editorial.css:2450-2456`, and every Devanagari run in this module carries
`lang="hi"`.

---

## 8 · Spec-internal disagreements (recorded, not silently deviated from)

`design-handover/06` and `design-reference/…/app.css` disagree on the message
row. **`06` is the implementation spec and the build follows it**; I did not
churn class names, which would also have broken other agents' work.

| Thing | `app.css` (design source) | `06 §1` (handover) | Built |
|---|---|---|---|
| row layout | `display:grid` 2-col | `display:flex` | flex (`06`) |
| hover tray | `.msg__acts` container / `.msg__act` button | `.msg__act` container | `.msg__act` + `.msg__actb` (`06`) |
| reaction chip | `.rx__b` / `.rx__b.on` | `.rx__c` / `.rx__c.mine` | `.rx__c` (`06`) |
| day separator | `.mdiv`, uppercase + `.12em` tracking | `.sv__sep`, neither | neither — **`24:146-153` forbids tracking and uppercase on the Devanagari half, and the separator is bilingual** |

The separator row is the one place the design source is **provably wrong**
against `24`, so it is a spec defect rather than an implementation gap.

**Second spec defect:** `ScreensSanvaad.jsx` places a deleted row among
ordinary messages, i.e. a tombstone **every member sees**. `list_messages`
filters `is_deleted = FALSE`, so the row never returns from the server and
`mergeById` (a union) cannot drop the local one either — the tombstone is
visible to the deleter for the session and to nobody else. Matching the design
needs `list_messages` to return deleted rows with content stripped instead of
filtering them, which changes what every existing client receives. Recorded,
not done.

---

## 9 · Not finished / handed on

- **`admin_orgs.ALL_MODULES` (`routers/admin_orgs.py:812`) omits messaging
  under both spellings.** Until it is added, no org can activate Sanvaad
  through the app whatever the gate is renamed to. Unowned — needs a home.
- **`catalogue.js:65` + `levels.js:31` + `AdminOrgsPage.jsx:71` must flip to
  `sanvaad` in the same commit as the backend.** Left deliberately.
- **RBAC on the composer.** `MESSAGING-ATTENDANCE-SPEC.md:73` — "viewer reads
  channels, editor sends messages, admin manages channels" — and
  `ScreensSanvaad.jsx:195` gates on `canPost = role === 'editor' && !archived`.
  The built composer is always enabled; `send_message` enforces membership but
  not the module role. Needs the member's grant level on the channels payload.
- **Archived channels** (`is_archived`) are neither styled nor read-only
  (`MESSAGING-ATTENDANCE-SPEC.md:21`).
- **`type='system'` messages** — module-bot rows with a glyph and tonal
  background (`MESSAGING-ATTENDANCE-SPEC.md:20`, `ScreensSanvaad.jsx:119-127`)
  are not rendered; a system message currently draws as an ordinary one.
- **Attachments** — `samvada_message_attachments` exists, `.att` is designed
  (`app.css:442-445`), no endpoint and no UI.
- **Thread-link avatar stack** (`.thrl` `<Avs>`): needs reply-author avatars on
  `list_messages`; I added `last_reply_at` only.
- **Edit/delete are not offered inside `ThreadPanel`** — it passes no
  `onEdit`/`onDelete`, so a reply cannot be edited or deleted. Endpoints work;
  it is a wiring line if wanted.
- **No `node_modules` in the worktree**, so nothing was type-checked or built.
  Both design gates pass; correctness beyond them is by reading.

---

## 10 · Gates

```
check-tokens:  279 declared, 229 referenced, 0 missing
check-classes: 2105 selectors defined, 1426 classes used, 0 missing a rule
```

`frontend/yarn.lock` and `frontend/package-lock.json` untouched throughout.
