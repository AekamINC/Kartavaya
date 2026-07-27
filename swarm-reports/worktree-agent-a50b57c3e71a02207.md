# Sanvaad + Varta — STRUCTURE lens

Branch `worktree-agent-a50b57c3e71a02207`. Reference **rendered**, not read:
`design-reference/Kartavaya Redesign/*` copied to `frontend/public/__ref/` and
served on `127.0.0.1:5397`; the Sanvaad screen was driven to its default state and
its DOM dumped. The dump matches `ScreensSanvaad.jsx` element for element, so the
JSX is a faithful description of what renders and the tables below are built from
both. `<html data-density="cozy" data-display="serif">` confirmed on the harness.

> Note on method: the shared Chrome and Playwright browsers are contended by ~20
> sibling agents — tabs were navigated out from under this agent four times. The
> reference was therefore served from this worktree on its own port and captured
> in single batched `evaluate` calls. States captured live: channel list, chat
> header, log, composer. States read from source: All-mode list (archived
> section), viewer composer, thread panel, Varta's four tabs.

---

## The headline: six live routes with no caller, and what that costs

A sibling found that the tray's More menu was the one control never built, which
left `edit`, `delete` and `?before=` reachable only by the server. That is the
same class of defect as the one below, but not the same size.

`backend/routers/messaging.py` publishes 16 endpoints. The frontend calls 9.
These **six have zero callers anywhere in `frontend/src`**:

| Route | What it does | What its absence means |
|---|---|---|
| `POST /v1/messaging/channels/{id}/members` | add a member | **a private channel can never have a second member** |
| `GET /v1/messaging/channels/{id}/members` | the member list | the header shows a count, never faces |
| `DELETE /v1/messaging/channels/{id}/members/{uid}` | remove a member | nobody can be removed |
| `POST /v1/messaging/dm` | find-or-create a DM | **no DM can ever exist** |
| `PATCH /v1/messaging/channels/{id}` | rename / describe / archive | no channel can be renamed or archived |
| `GET /v1/messaging/unread` | global unread | no unread count outside the module |

Two of those are not cosmetic:

1. **A private channel is permanently a channel of one.** `create_channel`
   inserts exactly one membership row — the creator, as `admin`
   (`messaging.py:149`). `add_member` is the only other writer of that table and
   nothing calls it. `list_messages` refuses a non-member on a private channel
   (`messaging.py:344`). So "Private" in the create form produces a room only its
   author can ever read or write. The option is offered, it is not defective in
   the backend, and there is no path to a second person.

2. **The "Direct messages" section can never be non-empty.** `create_channel`
   rejects `type='dm'` outright — *"Use /dm endpoint for DM channels"*
   (`messaging.py:139-140`) — and `/dm` has no caller. `ChannelList.jsx:129-136`
   renders a `Direct messages` heading over `channels.filter(c => c.type ===
   'dm')`, a list that is empty by construction.

Both are invisible from prose and from the running app alike: the create form
succeeds, the channel appears, and it simply never gains a member.

---

## Pane and control enumeration

Legend — **·** present · **~** partial · **✗** missing.

### 1 · Channel list rail (`.chat__side` → `.sv__list`)

| # | Reference control | Build | |
|---|---|---|---|
| 1.1 | `Sanvaad` rail label | `Channels चैनल` | ~ |
| 1.2 | `All` / `Unread` toggle (`showAll`) | — | ✗ |
| 1.3 | `+` new channel | present | · |
| 1.4 | — | search box | build extra |
| 1.5 | Section `Starred · तारांकित` | — | ✗ no star column in 058 |
| 1.6 | Section `Channels · माध्यम` | `Channels` | · |
| 1.7 | Section `Direct · सीधा` | `Direct messages` | ✗ dead — see above |
| 1.8 | Section `Archived · संग्रहित` | — | ✗ `list_channels` hard-filters `is_archived = FALSE` |
| 1.9 | `chat__more` — "N more channels" | — | ✗ |
| 1.10 | Row: bilingual `hi` + `en` label | name only | ✗ no `name_hi` column |
| 1.11 | Row: mute bell | — | ✗ `samvada_channel_members.muted` has no reader **and no writer** |
| 1.12 | Row: `archived` tag | — | ✗ |
| 1.13 | Row: unread badge | present | · |
| 1.14 | Row: `@n` mention variant | — | ✗ no mention detection server-side |
| 1.15 | Row: DM avatar instead of glyph | glyph only | ~ |

### 2 · Chat header (`.chat__head` → `.sv__hd`)

| # | Reference control | Build | |
|---|---|---|---|
| 2.1 | Mobile channel picker (`.bsheet`) | back button | ~ |
| 2.2 | Channel name | present | · |
| 2.3 | `#` / `🔒` + latin slug subtitle | icon only | ~ |
| 2.4 | Star toggle | — | ✗ not in schema |
| 2.5 | `muted` tag | — | ✗ |
| 2.6 | Topic (`description`) | present | · |
| 2.7 | Member avatars, max 4 | numeric count | ~ `GET members` uncalled |
| 2.8 | Channel settings `⋯` | — | ✗ `PATCH` uncalled |
| 2.9 | Archived banner + `Unarchive` | — | ✗ |

### 3 · Message log (`.chat__log` → `.sv__log`)

| # | Reference | Build | |
|---|---|---|---|
| 3.1 | Day divider | present | · |
| 3.2 | `New messages · नए संदेश` | present | · |
| 3.3 | System message: module glyph, `system` tag, action button | — | ✗ `type='system'` renders as an ordinary message |
| 3.4 | Tombstone | present | · |
| 3.5 | Continuation row + gutter time | present | · |
| 3.6 | Reaction chips + add | present | · |
| 3.7 | Thread link | present | ~ no reply-author avatars |
| 3.8 | `Seen by …` | present | · |
| 3.9 | Typing indicator | — | ✗ no transport |
| 3.10 | Attachment row | — | ✗ `samvada_message_attachments` has no endpoint at all |
| 3.11 | `@mention` styling | present | · |
| 3.12 | Scrollback (`?before=`) | present | · |

### 4 · Composer (`.composer` → `.cmp`)

| # | Reference | Build | |
|---|---|---|---|
| 4.1 | Attach (clip) | — | ✗ |
| 4.2 | Textarea, Enter sends | present | · |
| 4.3 | Emoji | present | · |
| 4.4 | Send | present | · |
| 4.5 | Locked — viewer RBAC + `Request Editor` | — | ✗ |
| 4.6 | Locked — archived channel | — | ✗ |

### 5 · Thread panel (`.thr` → `.sv__thread`)

| # | Reference | Build | |
|---|---|---|---|
| 5.1 | `Thread` + `सूत्र` + `in #channel` | `Thread` + count | ~ |
| 5.2 | Root message | present | · |
| 5.3 | `N replies` count row | in header | · |
| 5.4 | Replies | present | · |
| 5.5 | Reply textarea | present | · |
| 5.6 | `Also send to channel` checkbox | — | ✗ no server support |
| 5.7 | Reply button | present | · |
| 5.8 | Edit / delete on a reply | — | ✗ `onEdit`/`onDelete` not passed |

### 6 · Varta (`ScreensVarta.jsx`)

Four tabs exist in both. Depth differs sharply.

| # | Reference | Build | |
|---|---|---|---|
| 6.1 | Header: number + live dot | header, no number/dot | ~ |
| 6.2 | Conversations: seg filter **with counts** | seg filter, no counts | ~ |
| 6.3 | Conversation row: company, last, assignee, `not opted in` | name, last, assignee | ~ no company, no opt-in |
| 6.4 | Chat header: `Assign`, `Resolve`/`Reopen`, contact panel | name + phone only | ✗ no endpoint for either |
| 6.5 | Contact side panel (opt-in, window, CRM link, labels, note) | — | ✗ |
| 6.6 | Bubble: template tag, header, footer, buttons | body text only | ~ |
| 6.7 | Delivery ticks, 5 states | present | · |
| 6.8 | Failed + `error_code` + "send template instead" | error shown, no action | ~ |
| 6.9 | Opt-in gate blocking the composer | — | ✗ `varta_contacts.opted_in` never read |
| 6.10 | 24h window → template-only | present (`waWindow.js`) | · |
| 6.11 | Templates: table, editor sheet, Meta round-trip, preview | read-only cards | ✗ |
| 6.12 | Auto-replies: ordered 1–4, editable, live toggle | read-only rows | ~ no PATCH exists |
| 6.13 | Accounts: quality, limit, verification, opt-in sources, month stats | name/phone/status | ~ |

**Varta safety:** `send_wa_message` (`whatsapp.py:188`) carries
`# TODO: Call Meta Cloud API` and only inserts a `pending` row. No code path in
this repo reaches Meta, so nothing here can emit a real WhatsApp message. No
outbound path was added by this agent.

---

## Not built, and why

| Item | Reason |
|---|---|
| Attachments (3.10, 4.1) | needs upload plumbing + a `samvada_message_attachments` endpoint that does not exist; R2 signing lives in another module |
| Star (1.5, 2.4) | no column in 058 — a migration, not a wiring gap |
| Mute (1.11, 2.5) | column exists, no writer; needs a new endpoint + a settings surface |
| `@n` mention badge (1.14) | server does not parse mentions |
| Typing (3.9) | needs realtime; polling cannot carry it |
| `Also send to channel` (5.6) | `send_message` writes one row; needs a server flag |
| Varta templates editor (6.11) | Meta submit/approve round-trip is a backend integration |
| Varta assign / resolve (6.4) | `varta_conversations.status` / `assigned_to` have no PATCH |

---

## Changes made

### Backend — `backend/routers/messaging.py`

| Change | Why |
|---|---|
| `_require_editor()` on send, edit, delete, add-reaction, create-channel, update-channel, add-member, find-or-create-dm | `MESSAGING-ATTENDANCE-SPEC.md:73`. `require_module` checked only that a grant ROW EXISTS, so `viewer` — the level every new grant starts at — could do everything `editor` could. The level was decorative. |
| `GET /v1/messaging/me` | returns `{level, can_post, can_manage}`. Nothing in `frontend/src` could learn the level: `/v1/me` carries module CODES, not levels. |
| `GET /v1/messaging/directory` | org people, identity fields only. `add_member` and `find_or_create_dm` both need a `user_id` the caller had nowhere to get — `/v1/org/members` is gated on org_admin. |
| `list_channels?archived=true` | `is_archived = FALSE` was hard-coded, so archiving a channel deleted it from the UI's world: no history, no unarchive. |
| `send_message` refuses an archived channel | now that a client can reach one. `ScreensSanvaad.jsx:290` — "nobody can post, including admins". |
| `list_members` uses `_assert_channel_access` | **security.** It checked the channel was in the caller's org, not that the caller could see it — any org member could enumerate a private channel's members, and a DM's, which names who is talking to whom. |
| `remove_reaction` deliberately NOT gated | it deletes only the caller's own row; gating it would strand a demoted user with a reaction they cannot withdraw. |

Level checks sit **after** each org-scoped 404. Putting them first would have let
`test_add_reaction_404_for_other_org_message` pass on a 403 raised before the org
filter ran — the test would then hold even with cross-tenant scoping deleted.

### Backend — `backend/tests/test_messaging_security.py`

`_grant_level()` helper; `test_add_reaction_succeeds_own_org` now states the
editor grant it needs (it previously passed with **no grant at all**, which was
the bug). Five new tests: viewer cannot react, viewer cannot send, editor can
send, nobody posts to an archived channel, and the two `list_members` access
cases. **18 passed.**

### Frontend

| File | Change |
|---|---|
| `useSanvaadAccess.js` *(new)* | reads `GET /v1/messaging/me`. Fails **closed** on 403 (the module gate), **open** on any other error — the server refuses the send itself, so a blip must not take the module away from an editor. |
| `LockedComposer.jsx` *(new)* | the two locked bars. Viewer and archived are different sentences on purpose; one shared "you cannot post here" would imply an archived channel is a permissions problem. |
| `ChannelDetails.jsx` *(new)* | the `⋯` sheet. Rename, topic, member list, add, remove, archive, unarchive — the surface for four dead routes. |
| `ChannelList.jsx` | All/Active toggle, Archived section, `archived` row tag, **New direct message** picker. |
| `ChannelsTab.jsx` | archived list as a second lazy call, `openDm`, `channelChanged`, access threaded down. |
| `ChatPane.jsx` | settings `⋯`, member-count button, archived banner, locked composer, and the whole hover tray withdrawn from a viewer (`ScreensSanvaad.jsx:153` gates the tray, not just the composer). |
| `Message.jsx` | `SystemMsg` — `type='system'` rendered with a module glyph, `system` tag, tonal panel and optional deep link from `metadata`. It previously rendered as an ordinary message, so a task update from Kartavya looked like a person had typed it. |
| `messageUtils.js` | a system row never joins a continuation run — it carries the triggering user's `sender_id` and would otherwise group under their message and lose its header. |
| `ThreadPanel.jsx` | edit and delete on the root and on every reply. The endpoints always applied to replies; the panel simply never passed the handlers, so a typo in a thread was permanent while the same typo in the channel was not. |
| `icons.jsx`, `sanvaad.css` | `bolt` glyph; archived, banner, toggle, locked-composer, system-message and settings-sheet rules. |

---

## Risks and side effects — read before merging

1. **The editor gate is a live behaviour change.** Any org member whose Sanvaad
   grant sits at the default `viewer` **loses the ability to post, react, edit,
   delete and create channels**. That is what the spec asks for and what the
   reference draws, and the UI now explains it in place rather than failing
   silently — but it is a real change in what existing users can do. It is safe
   here only because migration 058 was applied today and this module has never
   run in anger. Raising someone is `org_member_modules.role` → `editor`, through
   the member editor that already exists.
2. **`list_channels` default is unchanged** (live channels only), so no existing
   caller sees different rows. `?archived=true` is opt-in.
3. **No DB writes were made.** Staging and production share one Supabase
   instance; everything here is code.
4. **No outbound message of any kind was sent.** `send_wa_message` still carries
   its `TODO: Call Meta Cloud API` and only writes a `pending` row — no Meta path
   exists in the repo and none was added.
5. **`Request Editor` is not built.** `ScreensSanvaad.jsx:293` draws the button;
   there is no endpoint to request a grant, and a button that does nothing is
   worse than none. The locked bar names the level and what Editor adds instead.
6. **`ConfirmDialog` was not used for archiving.** It portals to `document.body`
   while `Sheet` traps focus in its own subtree, so the dialog would open outside
   the trap and be pulled back out of it. Confirmed inline instead; archiving is
   reversible from the same panel.
7. **Deleted messages still vanish for everyone but the deleter.**
   `list_messages` filters `is_deleted = FALSE`, so the tombstone in `Message.jsx`
   is visible only to the person who deleted, until they switch channels. The
   design shows a tombstone every member sees; reaching it needs the server to
   return deleted rows with content stripped. Unchanged here, and still open.
