# 06 · Sanvaad and Varta (messaging)

Prereq: `00-tokens.md`, `02-common-components.md`. Behaviour and rationale in `MESSAGING-ATTENDANCE-SPEC.md`; interaction demos in `Interaction Catalogue.html` §11.

**Naming:** the WhatsApp surface is labelled **WhatsApp** with **वार्ता / Varta** as subtext, everywhere it appears — tab, sidebar, page header, mobile More grid. WhatsApp is what a user is looking for; Varta is the internal module name and rides beneath it. Same weighting as everywhere else (`01-navigation.md`): the recognised word carries the hierarchy.

Design source: `ScreensSanvaad.jsx`, `ScreensVarta.jsx`, `IxChat.jsx`.

Staging source: one file, `pages/SanvaadPage.jsx` (25,277 bytes) containing `SanvaadPage`, `ChannelsTab`, `ChatView`, `WhatsAppTab`, `WAChat` and `StatusBadge`.

---

## Ten real defects

### 0 · `addToast` is not a function — Sanvaad crashes on the success path

`components/ui/toast.jsx` exports a context whose value is `{ pushToast, error, success, warning, info }`. There is no `addToast`. `SanvaadPage.jsx` destructures one in three places:

```js
const { addToast } = useToast();               // ChannelsTab, ChatView, WAChat
addToast('Channel created', 'success');        // → TypeError: addToast is not a function
```

So **creating a channel succeeds on the server and then throws in the UI**, and every send/create failure throws instead of showing its error. The signature is wrong too — the real API takes an object (`pushToast({title, type})`), not positional arguments.

Fix: `const { pushToast, success, error } = useToast()`, then `success('Channel created')` and `error(e.response?.data?.detail || 'Failed to send')`. Grep the whole tree for `addToast` before shipping — `BillingPage.jsx` uses the correct `pushToast`, so the two conventions coexist and only one works.

### 1 · You cannot read scrollback

### 1 · You cannot read scrollback

```js
useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
useEffect(() => { const iv = setInterval(loadMessages, 5000); return () => clearInterval(iv); }, [loadMessages]);
```

The poll replaces `messages` every 5 seconds. The effect above it scrolls to the bottom whenever `messages` changes. **So scrolling up to read history yanks you back to the bottom within five seconds, every time.** Both `ChatView` and `WAChat` do this.

Autoscroll must be conditional on the user already being near the bottom:

```js
const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
if (nearBottom) el.scrollTop = el.scrollHeight;
else setShowJumpToLatest(true);
```

When they're not near the bottom, show the jump-to-latest pill (`MOTION-SPEC.md` §11) instead of moving them.

### 2b · The poll refetches everything and flashes the loading state

`loadMessages` opens with `setLoading(true)`, so "Loading messages…" reappears every 5 seconds, and the entire message array is replaced — discarding any optimistic local state. Every open channel costs a full message-history transfer every 5 seconds per user.

Replace with Supabase Realtime on `messages` (the backend is already Supabase). If polling has to stay short-term: cursor-based (`?after=<last_id>`), append rather than replace, and never touch `loading` after the first load.

### 3 · Delivered and read are the same glyph

```js
const STATUS_ICONS = { pending: '🕐', sent: '✓', delivered: '✓✓', read: '✓✓', failed: '✕' };
```

`delivered` and `read` render identically. The distinction in every messaging product is **colour** — grey double-tick for delivered, accent for read — and it is not implemented. A user cannot tell whether a customer has seen their message.

### 4 · Threads have no view

`setThreadMsg(m)` sets a "replying to" bar above the composer and posts `parent_message_id`. There is no thread panel. So a reply is sent into a thread, `thread_count` increments, and clicking "💬 3 replies" just sets the reply target again — **the replies are unreachable**. Either build the panel (`MESSAGING-ATTENDANCE-SPEC.md` §Threads) or drop `parent_message_id` and make everything flat. A thread you can write to and not read is worse than no thread.

### 5 · Reactions don't say whether *you* reacted

```js
const grouped = {}; parsed.forEach(r => { grouped[r.emoji] = (grouped[r.emoji] || 0) + 1; });
```

Only counts survive. Clicking an existing chip posts to the same toggle endpoint, so the user cannot tell whether their click will add or remove. Keep `user_ids` per emoji: highlight the chip when it includes you, and use it for the who-reacted tooltip.

### 6 · The API returns reactions as either an array or a JSON string

```js
if (typeof parsed === 'string') try { parsed = JSON.parse(parsed); } catch { parsed = []; }
```

The component defends against two serializations because the backend emits both. Fix it server-side and delete the branch.

### 7 · One emoji reaction costs a full history refetch

`react()` ends with `loadMessages()`. Update the single message from the mutation response.

### 8 · Shift+Enter is dead code

The composer is an `<input>`, and `onKeyDown` checks `!e.shiftKey` before sending. An `<input>` cannot hold a newline, so Shift+Enter does nothing at all — it neither sends nor breaks the line. Use a `<textarea>` that grows to a max height (`MOTION-SPEC.md` §11).

### 9 · The WhatsApp composer ignores Meta's 24-hour window

Outside a 24-hour window from the customer's last message, Meta rejects free-form text — only approved templates go through. `WAChat` offers a plain text field regardless, so the send fails and surfaces as a generic error toast. The composer must know the window state: countdown while open, template picker when closed. This is in `MESSAGING-ATTENDANCE-SPEC.md` §Varta and designed in `ScreensVarta.jsx`.

### Plus: a fourth token vocabulary, and emoji as UI

`SanvaadPage.jsx` uses `--border`, `--err`, `--ink-4`, `--k-deep`, `--k-deep-bg` — none of which appear in the drawer's set (`03-task-drawer.md`), the `k-*` classes, or Tailwind. Map: `--border` → `--outline-variant`, `--err` → `--danger`, `--ink-4` → `--on-surface-faint`, `--k-deep` → `--primary`, `--k-deep-bg` → `--primary-container`.

`StatusBadge` in this file is the **fifth** independent status-colour map in the codebase.

Emoji used as interface: `💬` for DMs, `🔒` for private channels, a 48px `💬` as the empty-state illustration, `💬` on the thread button, `🕐 ✓ ✓✓ ✕` for delivery state, `✕` as the close control. Replace all with `navIcons.jsx`. The five quick reactions (`👍 ✅ 👀 ❤️ 😂`) are content, not chrome — those stay.

---

## 1 · Exact CSS

### Three-pane shell

```css
.sv{display:grid;grid-template-columns:264px minmax(0,1fr);height:calc(100vh - var(--topbar-h) - 46px);border:1px solid var(--outline-variant);border-radius:var(--r-md);overflow:hidden}
.sv--thread{grid-template-columns:264px minmax(0,1fr) 330px}
.sv__list{display:flex;flex-direction:column;background:var(--s-low);border-right:1px solid var(--outline-variant);min-height:0}
.sv__chat{display:flex;flex-direction:column;min-height:0;min-width:0}
```

`min-height: 0` on both flex children is what allows the message log to scroll instead of stretching the grid. Without it the log grows to content height and the whole page scrolls — which is what makes the autoscroll bug in staging so violent.

### Channel row

```css
.ch{display:flex;align-items:flex-start;gap:9px;width:100%;padding:9px 13px;text-align:left;border-left:3px solid transparent;transition:background var(--dur-fast)}
.ch:hover{background:var(--s-container)}
.ch.on{background:var(--primary-container);border-left-color:var(--primary)}
.ch__ic{width:17px;flex-shrink:0;color:var(--on-surface-faint);margin-top:1px}
.ch__n{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ch.unread .ch__n{font-weight:700}
.ch__last{font-size:11.5px;color:var(--on-surface-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.ch__badge{margin-left:auto;flex-shrink:0;min-width:18px;height:18px;padding:0 5px;border-radius:var(--r-pill);background:var(--primary);color:var(--on-primary);font-size:10px;font-weight:700;display:grid;place-items:center}
```

`white-space: nowrap` on `.ch__n` matters more than it looks: a channel slug like `#gst-filing-q2` breaks at the hyphens and wraps to two lines otherwise.

### Message

```css
.msg{display:flex;gap:10px;padding:3px 18px}
.msg:hover{background:var(--s-lowest)}
.msg--cont{padding-top:1px}
.msg--cont .msg__av{visibility:hidden}
.msg__av{width:32px;height:32px;border-radius:50%;flex-shrink:0;font-size:13px;font-weight:700;color:#fff;display:grid;place-items:center}
.msg__hd{display:flex;align-items:baseline;gap:8px}
.msg__who{font-size:13px;font-weight:700}
.msg__when{font-size:10.5px;color:var(--on-surface-faint);font-variant-numeric:tabular-nums}
.msg__b{font-size:13px;line-height:1.5;white-space:pre-wrap;text-wrap:pretty}
.msg__act{position:absolute;top:-10px;right:14px;display:flex;gap:1px;padding:2px;border-radius:var(--r-sm);background:var(--surface);border:1px solid var(--outline-variant);box-shadow:var(--shadow-2);opacity:0;transition:opacity var(--dur-fast)}
.msg:hover .msg__act,.msg:focus-within .msg__act{opacity:1}
```

`.msg--cont` is **consecutive-message grouping**, which staging doesn't have: every message there gets a 32px avatar, a name and a timestamp, so a burst of five messages from one person costs five avatars and five names. Group when the same sender posts within 5 minutes — keep the avatar slot for alignment, hide it with `visibility` so nothing shifts.

Hover actions float in a raised tray rather than reserving a row per message; staging renders six always-present buttons at `opacity: .4` under every message, which is six focusable targets per message for a keyboard user.

### Reaction chips

```css
.rx{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.rx__c{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:var(--r-pill);background:var(--s-container);border:1px solid transparent;font-size:11.5px;transition:background var(--dur-fast),border-color var(--dur-fast)}
.rx__c.mine{background:var(--primary-container);border-color:var(--primary)}
.rx__c b{font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums}
```

`.mine` is the state staging can't express.

### Composer

```css
.cmp{display:flex;align-items:flex-end;gap:8px;padding:11px 18px;border-top:1px solid var(--outline-variant);background:var(--surface)}
.cmp__ta{flex:1;min-height:38px;max-height:180px;resize:none;padding:9px 12px;border-radius:var(--r-md);border:1px solid var(--outline-variant);background:var(--s-lowest);font:inherit;font-size:13px;line-height:1.5}
.cmp__ta:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--primary) 16%,transparent)}
.cmp__send{width:36px;height:36px;border-radius:50%;background:var(--primary);color:var(--on-primary);display:grid;place-items:center;flex-shrink:0}
.cmp__send:disabled{background:var(--s-high);color:var(--on-surface-faint)}
```

Note `background: var(--primary)` — **not** `var(--k-grad)`. That variable doesn't exist and cost the mobile composer its visible send button once already.

### Varta bubbles and the 24-hour window

```css
.wa__b{max-width:70%;padding:8px 13px;border-radius:12px;font-size:13px;line-height:1.5;white-space:pre-wrap}
.wa__b--in{background:var(--s-container);border-bottom-left-radius:3px;align-self:flex-start}
.wa__b--out{background:var(--primary);color:var(--on-primary);border-bottom-right-radius:3px;align-self:flex-end}
.wa__m{display:flex;align-items:center;gap:4px;justify-content:flex-end;font-size:9.5px;margin-top:4px;opacity:.72;font-variant-numeric:tabular-nums}
.wa__tick{width:14px;height:10px}
.wa__tick--read{color:#4FC3F7}
.wa__win{display:flex;align-items:center;gap:8px;padding:8px 18px;font-size:11.5px;background:var(--warn-container);color:var(--warn);border-top:1px solid color-mix(in srgb,var(--warn) 30%,transparent)}
```

The read tick is `#4FC3F7` on both themes — it is a WhatsApp platform convention users recognise, so it is deliberately not a project token. `delivered` uses the same double-tick glyph at inherited colour; **the colour is the whole distinction.**

---

## 2 · Component trees

```
SanvaadPage                              pages/SanvaadPage.jsx
├── PageHeader
├── Tabs  Channels · WhatsApp
├── ChannelsTab
│   ├── ChannelList  search · create · sections (channels/DMs)
│   ├── ChatPane
│   │   ├── ChatHeader     name · description · members · search · ⋯
│   │   ├── MessageLog     date separators · unread divider · grouping
│   │   │   ├── Message → ReactionChips · HoverTray · ThreadLink
│   │   │   └── JumpToLatest
│   │   ├── TypingRow
│   │   └── Composer → EmojiPicker · MentionAutocomplete · FileAttach
│   └── ThreadPanel                                       new
└── WhatsAppTab
    ├── ConversationList  status filter · unread
    ├── WAChat → WindowBanner · TemplatePicker · Bubble
    ├── Templates   Meta approval states
    ├── AutoReplies
    └── Accounts    WABA connection
```

---

## 3 · New files

```
frontend/src/pages/sanvaad/ChannelList.jsx
frontend/src/pages/sanvaad/ChatPane.jsx
frontend/src/pages/sanvaad/MessageLog.jsx
frontend/src/pages/sanvaad/Message.jsx
frontend/src/pages/sanvaad/Composer.jsx
frontend/src/pages/sanvaad/ThreadPanel.jsx
frontend/src/pages/sanvaad/EmojiPicker.jsx
frontend/src/pages/varta/WAChat.jsx
frontend/src/pages/varta/WindowBanner.jsx
frontend/src/pages/varta/TemplatePicker.jsx
frontend/src/hooks/useRealtimeChannel.js      Supabase Realtime subscribe
frontend/src/hooks/useStickyScroll.js         near-bottom autoscroll
frontend/src/styles/sanvaad.css
```

---

## 4 · Endpoints

Existing: `GET/POST /messaging/channels` · `GET/POST /messaging/channels/:id/messages` · `POST /messaging/channels/:id/read` · `POST /messaging/messages/:id/reactions` · `GET /whatsapp/conversations|templates|auto-replies|accounts` · `GET/POST /whatsapp/conversations/:id/messages`.

Changes and additions:

| Endpoint | Change |
|---|---|
| `GET /messaging/channels/:id/messages?after=&limit=` | cursor pagination; return oldest-first so the client stops calling `.reverse()` |
| `POST /messaging/messages/:id/reactions` | move `emoji` from query string into the body; return the updated message; include `user_ids` per emoji |
| `GET /messaging/channels/:id/thread/:messageId` | **new** — the replies that are currently unreachable |
| `GET /whatsapp/conversations/:id/window` | **new** — `{open: bool, expires_at}` for the 24-hour banner |
| `POST /whatsapp/conversations/:id/template` | **new** — send an approved template when the window is closed |
| Realtime | subscribe to `messages`, `reactions`, `typing` on the Supabase channel |

Reactions must be one serialization — an array of `{emoji, user_ids[]}`, never a JSON-encoded string.

---

## 5 · What changes in existing files

| File | Bytes | Change |
|---|---|---|
| `pages/SanvaadPage.jsx` | 25,277 | Split into the tree above. Fix all nine defects. Token map. `StatusBadge` → `ui/StatusChip.jsx`. Emoji chrome → `navIcons.jsx` |
| `components/MentionTextarea.jsx` | 5,058 | Reuse in the composer; share the mention store with `lib/mentions.js` (`03-task-drawer.md`) |
| `components/ui/toast.jsx` | 3,553 | Keep the API; **fix every `addToast` call site**. Replace the four hardcoded legacy hexes (`#05b7aa`, `#e53e3e`, `#f59e0b`, `#0082c6`) with `--ok`/`--danger`/`--warn`/`--primary`, and drop `ts.borderLeft.split(' ')[2]` — extracting a colour back out of a CSS shorthand string breaks the moment the value is a token. Position must honour the `toastPos` preference (`09-customization.md`), which the current fixed `right: 20, top: 20` cannot |
| `lib/utils.js` (`relTime`) | — | Keep for the channel list. Message timestamps should use `lib/timeFormat.js` so they honour the 12h/24h preference |

### The centred chat pane

```jsx
<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}>
  {selectedConv ? <WAChat conversation={selectedConv} /> : <p>Select a conversation</p>}
</div>
```

The same wrapper centres both the empty-state text and the live chat. `WAChat` sets `height: '100%'`, but under `align-items: center` a percentage height resolves against a stretched-then-centred box — so the Varta chat pane does not reliably fill its column. Use two different containers: a centred one for the empty state, a `display: flex; flex-direction: column` one for the chat.
