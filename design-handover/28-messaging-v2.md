# 28 · Messaging v2 — Sanvaad + Varta

**Prerequisites:** `00-tokens.md`, `02-common-components.md`, `06-sanvaad-varta.md`.
`06` stays the reference for channels, mentions, reactions and the WhatsApp
window. This file is the restructure on top of it, and where the two disagree
this one is later.

**Prototype:** `Kartavaya Redesign/Messaging v2.html` · `messaging.css` ·
`Msg2.jsx`, `Msg2Chat.jsx`, `Msg2Aside.jsx`, `Msg2Data.jsx`.

**Build this surface to the pixel.** `messaging.css` is the reference, not an
impression of one — match spacing, radii, shadow steps and type exactly as
drawn, in both themes. Where this file and the stylesheet disagree, the
stylesheet is right. The one thing to *add* rather than match is the `kamal`
ground in §6.

## Files to change
- `pages/sanvaad/` — 22 files. `ChatPane.jsx`, `ChannelList.jsx`, `MessageLog.jsx`,
  `Message.jsx`, `ThreadPanel.jsx`, `Composer.jsx`, `ChannelsTab.jsx`
- `pages/sanvaad/varta/` — 6 files. `WhatsAppTab.jsx`, `WAChat.jsx`, `WindowBanner.jsx`
- `styles/sanvaad.css` — 108 KB, the largest surface stylesheet in the repo

## Files to create
- `components/sanvaad/RecordCard.jsx` — the embedded record, one component, five kinds
- `components/sanvaad/InlineThread.jsx` — replies in the log
- `pages/sanvaad/MessagingTabs.jsx` — the two-tab module shell

## Estimated scope
One module, two tabs, ~28 files touched. The thread change is a data change
before it is a UI change — read §2 first.

---

## 1 · Two tabs, and why they are not one list

Sanvaad and Varta are **one module and two tabs**. They are not one list.

An internal channel and a customer's WhatsApp thread look alike in a rail and
behave nothing alike. One is a colleague on an unmetered surface you control.
The other is a person outside the firm, on a metered channel, inside a 24-hour
window, where a free-text reply outside that window is refused by WhatsApp and
where an approved template is the only way to reopen it. A shared list makes
sending the wrong thing to the wrong audience a one-click mistake.

**So the separation is a safety boundary, not a filing preference**, and it is
the reason the earlier draft of this design — which folded WhatsApp in as a
fourth row type — was wrong.

The tab bar carries a per-tab unread count. The WhatsApp tab also carries the
connected business number, because an operator needs to know which number a
customer is seeing before they answer as the firm.

## 2 · Threads, inline — the structural fix

**The defect:** threads are write-only. You can reply into one and the replies
are unreachable.

**The cause is not the UI.** `list_messages` filters `parent_message_id IS NULL`,
so a reply is *never* in the channel log. Replies exist only inside
`ThreadPanel`, which `ChannelsTab` owns as a **sibling** of `ChatPane` in a third
grid column. `ChatPane` cannot render them, cannot await them, and its own deep-link
code has a six-second retry loop and three separate failure sentences purely to
cope with that fact.

**The fix:** the log is the whole record. A message with replies renders a
`m2th__open` control — face stack, count, time of the last reply — that expands
the replies **in place**, indented under their parent behind a 2px accent rule.
Reply composition stays in the same expanded block.

Two things this needs from the server:

1. `GET /v1/messaging/channels/:id/messages` gains `include_reply_counts=1`, so a
   parent arrives knowing it has replies without a request per message.
2. `GET /v1/messaging/messages/:id/thread` stays as it is and is fetched on
   expand. It does not need to change.

**Do not delete `ThreadPanel`.** It stays as the mobile presentation of the same
data — a phone has no room to indent — and it is what a deep link to a reply
still opens. What goes away is it being the *only* way to read a reply.

Once this lands, delete `FOCUS_WAIT_MS`, `FOCUS_POLL_MS` and the `rootMissing`
branch in `ChatPane`. All three exist to wait for a node in a panel this pane
does not own; when the reply is in the log, `getElementById` finds it on the
first frame.

## 3 · Bubbles, and a canvas of its own

A conversation is not a table, and this is the one surface in the product that
should not look like the rest of it.

The log gets a tinted canvas with a faint motif; every message sits in a bubble
on it. Own messages read from the right in `--primary-container` with the
asymmetric corner pointing back at the speaker — the only sender cue that
survives when grouping hides the avatar. Values in `messaging.css`.

**Records, photos and voice notes live INSIDE the bubble.** They are part of
what someone said, not attachments beside it.

## 4 · The product's own objects, in the conversation

This is what makes the surface worth using rather than a copy of a consumer
messenger. People already discuss invoices and approvals in chat; today they do
it by pasting a number and switching tabs.

| Kind | Renders | Tone |
|---|---|---|
| `invoice` | Customer, amount, status, place of supply, tax split, HSN state | `--m-ganit` |
| `task` | Assignee, due, subtask progress bar | `--m-kartavya` |
| `ask` | Approval request, approver, due — and the answer once given | `--warn` |
| `payment` | Amount, date, against which invoice | `--m-ganit` |
| `order` | Customer, value, stage | `--m-vikray` |

The accent is the module's own colour, so an invoice in chat is recognisably the
same object as an invoice in Ganit. `.m2rec` reads `--rc`; a sixth kind is one
data entry and no new CSS.

Also in the bubble: a **quoted reply** (the message being answered, clamped to
two lines), a **photo grid**, a **voice note** with a real waveform, and a
**link preview**. Photos are `<image-slot>` in the prototype because I cannot
generate images — on implementation they are the uploaded file's thumbnail.

## 5 · Delivered and read must not look the same

They were the same `'✓✓'` string, so you could not tell whether a customer had
seen your message. Now: **sent** one tick in `--on-surface-3`, **delivered** two
ticks in `--on-surface-3`, **read** two ticks in `--tick-read`. The word is
rendered beside the glyph on own messages rather than relying on colour alone —
`23-accessibility.md` §4, and a tick pair is 16px of colour difference.

## 6 · The conversation ground is a per-user setting

Two axes, stored beside `accent` and `density`:

```
data-conv-pattern   none | jaali | patola | star | lines | kamal
data-conv-ground    warm | paper | deep | accent
```

Definitions in `tokens.css`. Every pattern comes from the motif study the brand
already did — jaali (the pierced architectural screen), patola (Gujarati
double-ikat), the star mandala, a fine hatch. Two hard rules: **the motif is
texture, never pattern**, held at ~10% stroke so it cannot compete with a
message; and it is **never used on a module page**, because the whole point is
that these two surfaces are not module pages.

### `kamal` — to be added, and the only thing on these two surfaces that is

The five patterns above ship as drawn. **Add a sixth, drawn from the lotus**, so
the ground and the product's one waiting state share a hand. Everything needed
to build it is already in `components/brand/Lotus.jsx`:

- **Use the rosette course only** — `LOTUS_COURSES[0]`, ten lobes at `r34–r70`,
  half-width 12, plus the `r32` eye. The outer twenty-petal course (`r76–r120`)
  is what makes the loader read as a mark, and a mark that repeats is a
  watermark rather than a ground. Leave it out. `lotusLobe()` gives the path
  verbatim; do not redraw it.
- **Same three rules as the loader**: one pen (uniform stroke width across every
  lobe and the eye), one colour, no opacity ramp *inside* the figure. The whole
  tile then sits at the same ~10% the other five use.
- **Do not let it grid up.** Rotate the rosette off-axis and offset alternate
  rows by half a tile. A ten-fold figure repeating on a square lattice reads as
  a logo laid out on a page, which is the one thing this must not look like.
- **Two tiles, light and dark**, stroke colour baked in — same reason as every
  other motif, a data URI cannot read a custom property.
- Sizes join the existing ramp: `44px 44px` small, `96px 96px` at
  `--conv-motif-lg`. It reads at both or it does not ship.

It is not the default. `jaali` stays the default; `kamal` is the one a person
chooses when they want the product's own figure behind their conversation.

The tint axis moves the **ground**, not the line, because a data URI cannot read
a custom property and accent-tinting the ink would need one tile per accent per
theme with twelve accents shipping.

People spend hours in a chat window and have opinions about it. That is the same
argument that put translucency and text size in Customization.

## 7 · Sahayak in the conversation

Three entry points, one assistant:

- **A catch-up card in the log**, at the unread divider — the point the reader
  left off is the only place a summary of what they missed belongs.
- **A side panel** (`.sh-aside`), scoped to the open conversation. Scope is
  stated at the top, because "summarise this" is a different question in a
  channel of nine and a customer thread.
- **Draft with Sahayak** in the composer.

Every line cites its source and a cite is a control. The panel also shows what
it **would not** answer — see `29-sahayak.md` §2, which is the contract.

## 8 · Honesty about real-time

Messaging is **poll-based and has to be**: Supabase's pooler runs transaction
mode on :6543 where `LISTEN/NOTIFY` does not work, and the service runs several
gunicorn workers, so there is no push to have instead. `/live` polls at 4s.

Do not design anything that implies instant delivery. The channel header says
"updates every few seconds" rather than showing a green live dot. The typing
line keeps its 6-second local hush on a sender who has just posted, or the log
shows a finished message with "Rohan is typing…" underneath it.

## 9 · Rules carried forward from the source

- `@channel`/`@here` need channel admin **above 15 members**; below it anyone may
  broadcast, because paging four colleagues is not paging the firm. The popup
  must apply the same rule — the server resolves a non-admin's `@channel` on a
  bigger channel to zero recipients and returns the message normally.
- Pins cap at **50 per channel**; unpin is the pinner or a channel admin.
- Muting suppresses the **count** and not the **mention**. Nobody mutes their own
  name, which is why the mention badge is `--danger` and survives muting.
- `useStickyScroll` is correct and already fixed. **Do not touch it.** `wasNear`
  is written by the scroll listener and read when content lands, so it is always
  the state as of the last thing the *user* did.

## 10 · Three structures, and which to ship

The prototype switches between them.

| | What it is | Ship it? |
|---|---|---|
| **Unified rail** | Channels and DMs in one list, filter chips | **Yes.** Best for triage, which is what opening messages is |
| Sectioned | Channels and Direct as labelled groups | No. Unread scattered across two lists |
| Focus | Rail collapses to tiles, ⌘K to switch | As a **toggle**, not a default. Real for two-or-three-room users |

## 11 · Mobile

One column: list, then conversation. Threads expand in place — the same fix as
desktop, and the reason it works on a phone at all.

**The hover tray has no touch equivalent and must not be relied on.** `.m2tray`
is `display: none` under the mobile class; react, reply, pin and delete move to
a long-press sheet. A control that needs a pointer that never arrives is the
same defect as a nav hidden by breakpoint with no replacement.

Composer text is 16px on mobile — anything smaller triggers iOS zoom-on-focus.

## 12 · Endpoints

| Verb | Route | Note |
|---|---|---|
| GET | `/v1/messaging/channels` | Rail. Carries `unread_count`, `mention_count`, `muted`, `my_last_read` |
| GET | `/v1/messaging/channels/:id/messages` | **Add `include_reply_counts`** — §2 |
| GET | `/v1/messaging/messages/:id/thread` | Unchanged; fetched on expand |
| GET | `/v1/messaging/live` | 4s poll. Typing capped at 5, caller excluded |
| GET | `/v1/messaging/directory` | The only user list an ordinary member can read |
| POST | `/v1/messaging/dm` | Exists; `create_channel` refuses `type='dm'` |
| — | `/v1/messaging/messages/:id/record` | **Needed.** Attach a record to a message (§4) |

## 14 · Elevation

Both conversational surfaces **float**. The module is one continuous surface, so
it is a bordered, rounded, elevated card rather than a flat fill running
edge-to-edge in its panel — the same decision upstream `sahayak.css` already
made for the assistant, extended to messaging for consistency.

Two shadow steps, never one: the tight one seats the card, the wide one lifts it.
A single mid shadow reads as a border with a smudge.

Three consequences worth stating, because each was a real fix:

- **The rail gets a hairline shadow at its seam**, not only a 1px rule. A rule
  alone reads as a table-cell boundary, which is the thing this surface exists
  not to be.
- **Message bubbles carry their own small elevation.** They sit on a patterned
  ground, and without an edge and a little lift the motif reads through them as
  noise rather than behind them as texture. Same for every block in Sahayak's
  thread.
- **On a phone the module does not float.** A card with a shadow inside a device
  bezel is depth with nothing to sit on. `.m2mod:has(> .m2--mob)` drops the
  border, radius and shadow.

## 13 · What changes

| File | Change |
|---|---|
| `ChannelsTab.jsx` | Owns two tabs, not three columns. Per-tab unread |
| `ChatPane.jsx` | Bubbles; records in the log; delete the focus retry loop after §2 |
| `ChannelList.jsx` | One row type for channels and DMs; filter chips; WhatsApp removed |
| `Message.jsx` | Bubble, quote block, record card, photos, voice, link, tick states |
| `ThreadPanel.jsx` | Kept for mobile and deep links only |
| `MessageLog.jsx` | Day pills; renders inline threads |
| `varta/WhatsAppTab.jsx` | Becomes a first-class tab with the window filter chips |
| `styles/sanvaad.css` | Restyled against `messaging.css`. 108 KB — expect to delete more than you add |
