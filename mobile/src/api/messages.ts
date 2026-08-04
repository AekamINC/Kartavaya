import { apiClient } from './client';

/**
 * Samvada / Sanvaad messaging.
 *
 * 17-mobile-app.md moves Messages into the fourth tab slot, ahead of Inbox,
 * because messaging is the highest-frequency mobile action.
 *
 * Field names are the server's, snake_case, unchanged — renaming them here would
 * mean two vocabularies for the same record and a mapping layer to keep in step.
 * The types below were checked line by line against
 * `backend/routers/messaging.py`, which turned up three mismatches that made
 * this client non-functional:
 *
 *   1. SENDING WAS BROKEN. `send` posted `{ body }`, but MessageCreate
 *      (messaging.py:477) declares `content`. FastAPI rejected every send with a
 *      422 for a missing required field. The column is `content` too
 *      (058:39), so `body` was never right at any layer.
 *   2. REACTIONS WERE BROKEN. `emoji` is a QUERY parameter on the server
 *      (`emoji: str = Query(...)`, messaging.py:1269), not a body field. Posting
 *      it as JSON was another 422.
 *   3. The message shape was wrong. The server selects `m.*` plus
 *      `u.full_name AS sender_name`, so a message carries `sender_id` /
 *      `sender_name` / `content` — not `user_id` / `user_name` / `body`. Every
 *      "is this mine?" check against `user_id` compared undefined to a real id
 *      and answered no.
 *
 * ── The 093 pass (mentions, search, pins, presence, mute)
 *
 * Re-checked against the same file after migration 093 landed, which turned up
 * two more fields that had been reading `undefined` since this file was written
 * and are now REMOVED rather than deprecated, so the compiler names every reader:
 *
 *   4. `Channel.topic` HAS NEVER EXISTED. 058 named the column `description`
 *      and every channel query is `SELECT c.*`, so the rail's subtitle has been
 *      rendering an absent key.
 *   5. `Message.edited_at` HAS NEVER EXISTED. The columns are `is_edited` and
 *      `updated_at`; the "edited" marker has never appeared for anybody.
 *
 * Removing them is deliberate. A deprecated-but-present optional field fails by
 * rendering nothing, which is precisely the class of defect this whole feature
 * has already paid for three times.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Guards
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * The server does NOT `_valid_uuid`-guard `before` on
 * `GET /channels/{id}/messages`: a malformed value reaches `$3::uuid`, asyncpg
 * raises DataError, and the client gets a 500. `/mentions?before=` and
 * `/search?channel_id=` silently DROP a bad value instead — which is worse in
 * one specific case, because `{mark_all:true, channel_id:'oops'}` then marks the
 * WHOLE ORG read. One guard, used at every call site below, is the answer to all
 * three.
 *
 * Exported because three screens build these ids from route params and a push
 * payload, and neither source is trustworthy.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/* ────────────────────────────────────────────────────────────────────────────
 * Channels
 * ──────────────────────────────────────────────────────────────────────────*/

export type ChannelType = 'public' | 'private' | 'dm';

export interface Channel {
  id:            string;
  org_id:        string;
  /** `''` for a DM — `find_or_create_dm` inserts it empty. Render the other
   *  participant's name, never this. */
  name:          string;
  type:          ChannelType;
  /** The server's column. There has NEVER been a `topic`. */
  description?:  string | null;
  is_archived:   boolean;
  created_by?:   string | null;
  member_count:  number;
  /** Top-level only, `is_deleted=FALSE`, EXCLUDES the caller's own messages, and
   *  a hard 0 for a public channel the caller never joined. Counted by the same
   *  rule as `/live` so the two cannot disagree four seconds apart. */
  unread_count:  number;
  /** 093 additions. Both are always present — the server emits the SQL literal
   *  `0` / `COALESCE(...,FALSE)` even before 093 is applied, precisely so a
   *  spread into a badge cannot render `undefined`. Do not make these optional. */
  mention_count: number;
  muted:         boolean;
  my_last_read?: string | null;
  created_at:    string;
  updated_at:    string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Messages
 * ──────────────────────────────────────────────────────────────────────────*/

/** One reaction row. The server returns these aggregated per message. */
export interface Reaction {
  emoji:   string;
  user_id: string;
}

export interface Message {
  id:                 string;
  org_id?:            string;
  channel_id:         string;
  /** The server's column. NOT `user_id`. */
  sender_id:          string;
  /** Joined from users.full_name. Absent on send/edit, which return a bare
   *  `RETURNING *` with no join — the sender is stamped locally and the next
   *  read brings the enriched row. */
  sender_name?:       string | null;
  sender_avatar?:     string | null;
  /** The server's column. NOT `body`. */
  content:            string;
  /** CHECK (type IN ('text','image','file','system')). `send` accepts only
   *  'text' and 'system'. */
  type:               string;
  parent_message_id?: string | null;
  metadata?:          Record<string, unknown> | null;
  /** The server's columns. There is NO `edited_at`: render the marker from
   *  `is_edited` and the time from `updated_at`. */
  is_edited?:         boolean;
  is_deleted:         boolean;
  /** Direct replies. Absent from `/thread`, `send` and `edit`. */
  thread_count?:      number;
  last_reply_at?:     string | null;
  reactions?:         Reaction[];
  /** Up to 4 full_name strings, sender excluded, ordered by when they read.
   *  `seen_count` is uncapped. Both absent outside `list`. */
  seen_by?:           string[];
  seen_count?:        number;
  /** 093. ABSENT — not null — from the message endpoints before the migration,
   *  which is why these are optional and not merely nullable. `/pins` and
   *  `/search` always carry `pinned_at` as a key. */
  pinned_at?:         string | null;
  pinned_by?:         string | null;
  created_at:         string;
  updated_at?:        string;
}

/**
 * Two things arrive on the wire that must never reach react-query.
 *
 * 1. `search_tsv`. 093 adds it as a GENERATED tsvector column and every message
 *    query is `SELECT m.*` / `RETURNING *`. asyncpg decodes TSVECTOROID with
 *    pgproto's text decoder, so it serialises as a string — a redundant lexeme
 *    dump on every message, on list, on send, on edit and on thread.
 *    `['messaging','messages',id]` IS persisted to MMKV, so leaving it in means
 *    writing a second copy of every message body to disk forever. Deleted here,
 *    once, rather than in four screens that will each forget.
 * 2. `reactions` as a JSON STRING. `db.py` registers json/jsonb text codecs so
 *    it should always be an array — but that registration is best-effort: it
 *    retries three times against PgBouncer and then logs a warning and carries
 *    on (`db.py:106`), so a string is a state this codebase can actually reach.
 *    The web kept a string branch for years for the same reason. Normalised
 *    once, so no renderer has to defend and so `[]` is the answer for the
 *    endpoints that do not aggregate reactions at all (`/thread`, send, edit).
 */
function cleanMessage(m: Message & { search_tsv?: unknown }): Message {
  const { search_tsv: _drop, ...rest } = m;
  let reactions = rest.reactions as unknown;
  if (typeof reactions === 'string') {
    try { reactions = JSON.parse(reactions); } catch { reactions = []; }
  }
  return { ...rest, reactions: Array.isArray(reactions) ? reactions as Reaction[] : [] };
}

/** Exported for `__tests__/messages.test.ts` ONLY. The suite has no transport
 *  (see the note in that file), so the scrubber cannot be reached through a
 *  request and has to be reachable directly. Nothing in `src/screens` may call
 *  it — every endpoint that returns a message already runs it. */
export { cleanMessage as __cleanMessage };

/* ────────────────────────────────────────────────────────────────────────────
 * The live poll
 * ──────────────────────────────────────────────────────────────────────────*/

export type PresenceState = 'online' | 'away';

export interface LiveChannelCounts { unread: number; mentions: number; muted: boolean }

export interface TypingUser { user_id: string; full_name: string | null }

export interface LivePayload {
  /** Keyed by channel UUID. Includes public channels the caller never joined AND
   *  archived channels — `GET /channels` lists neither, because it filters on
   *  `is_archived = $3`. JOIN ON THE RAIL'S LIST; never iterate these keys to
   *  build one. */
  channels:       Record<string, LiveChannelCounts>;
  /** Caller excluded, capped at 5, 8-second window. `[]` unless `channel_id` was
   *  a uuid the caller may read. */
  typing:         TypingUser[];
  /** AN ABSENT KEY MEANS OFFLINE. The server omits anyone staler than 5 minutes
   *  rather than sending "offline" — in a 200-person org that is a 40-byte map
   *  against a 4KB one, every four seconds — and emits `{}` entirely before 093.
   *  Render absent as offline. Never render "unknown". */
  presence:       Record<string, PresenceState>;
  mention_unread: number;
  /** Postgres `now()`, in the same round trip as the counts. Compare `created_at`
   *  against THIS, never `Date.now()`: a Railway container whose clock has
   *  drifted would otherwise date every message wrong. */
  server_time:    string | null;
}

export interface LiveParams {
  channelId?: string | null;
  typing?:    boolean;
  away?:      boolean;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Mentions
 * ──────────────────────────────────────────────────────────────────────────*/

export type MentionKind = 'user' | 'here' | 'channel';

export interface Mention {
  /** THE MENTION ID. This is what `/mentions/read` takes and what `before` pages
   *  on. It is NOT `message_id`. */
  id:                string;
  channel_id:        string;
  message_id:        string;
  kind:              MentionKind;
  created_at:        string;
  read_at:           string | null;
  /** `'#name'` for a room, the other participant's display name for a DM, and
   *  `'Direct message'` when that name cannot be resolved. Never null. */
  channel_name:      string;
  channel_type:      ChannelType;
  /** The full body, not truncated. */
  content:           string;
  sender_id:         string;
  sender_name:       string | null;
  sender_avatar:     string | null;
  /** THE THREAD ROOT. Non-null ⇒ the mention was written inside a reply, which
   *  `list_messages` will never return (`parent_message_id IS NULL`), so the
   *  thread sheet must open on this. Threads are flat; there is no chain to
   *  walk. */
  parent_message_id: string | null;
}

export interface MentionsReadIn {
  mention_ids?: string[];
  mark_all?:    boolean;
  channel_id?:  string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Search
 * ──────────────────────────────────────────────────────────────────────────*/

export interface SearchHit {
  id:                string;
  channel_id:        string;
  content:           string;
  sender_id:         string;
  created_at:        string;
  parent_message_id: string | null;
  /** Always null before 093, but the key is always present — the pre-093 arm
   *  selects `NULL::timestamptz AS pinned_at`. */
  pinned_at:         string | null;
  channel_name:      string;
  channel_type:      ChannelType;
  sender_name:       string | null;
  sender_avatar:     string | null;
}

/**
 * THE ONLY ENDPOINT IN THIS ROUTER THAT IS NEITHER A BARE ARRAY NOR A BARE
 * OBJECT. Reading `.data` off this yields `undefined` and a silent zero-result
 * screen — it has already fooled one test into accusing the product of losing a
 * message. `more` comes from a `LIMIT n+1` look-ahead, not a COUNT, so there is
 * no total to render.
 */
export interface SearchPage {
  results: SearchHit[];
  more:    boolean;
}

export interface SearchParams {
  q:          string;
  channelId?: string;
  fromUser?:  string;
  limit?:     number;
  offset?:    number;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pins
 * ──────────────────────────────────────────────────────────────────────────*/

export interface PinnedMessage {
  id:             string;
  channel_id:     string;
  content:        string;
  sender_id:      string;
  created_at:     string;
  pinned_at:      string;
  pinned_by:      string | null;
  type:           string;
  metadata:       Record<string, unknown> | null;
  sender_name:    string | null;
  sender_avatar:  string | null;
  pinned_by_name: string | null;
  /** THE GAP, stated rather than left to be found: `/pins` does NOT return
   *  `parent_message_id`. A pinned thread reply is reachable in the bar with no
   *  way to compute its root, so tapping one lands in the channel with the row
   *  highlighted and says nothing about a thread. */
}

/* ────────────────────────────────────────────────────────────────────────────
 * Access and directory
 * ──────────────────────────────────────────────────────────────────────────*/

export interface SanvaadAccess {
  module:     'sanvaad';
  /** `null` when the caller holds no grant on this module at all. */
  level:      'viewer' | 'editor' | 'approver' | 'admin' | null;
  can_post:   boolean;
  can_manage: boolean;
}

export interface DirectoryUser {
  user_id:    string;
  /**
   * NULLABLE ONLY ON THE UNSCOPED CALL, where it is the bare `users.full_name`
   * column. Asked for with a `channelId` it is `COALESCE(full_name, name,
   * email)` — the same string the mention resolver matches on — so it is the
   * text to insert after the `@` and it is not blank. Kept nullable rather than
   * split into two types: one endpoint, one row shape, and the readers already
   * have to survive the unscoped arm.
   */
  full_name:  string | null;
  avatar_url: string | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The client
 * ──────────────────────────────────────────────────────────────────────────*/

export const messagesApi = {
  /** `archived=true` returns the archived channels INSTEAD of the live ones —
   *  the server filters `is_archived = $3`, it does not merge the two sets. */
  channels: (archived = false) =>
    apiClient.get<Channel[]>('/v1/messaging/channels', { params: { archived } })
      .then(r => r.data),

  /**
   * CORRECTED TYPE. `GET /unread` returns `{ "<channel_id>": count }` — a map,
   * `HAVING COUNT(*) > 0`, so channels with nothing unread are simply absent.
   * There is no `total` key and there never was: the tab badge that read
   * `.total` has always read `undefined`.
   *
   * ZERO CALLERS, and the claim that used to stand here — that it was "still
   * wired into a screen nobody asked us to touch" — was false. Nothing in
   * `mobile/src` calls this, and the only other mention of the endpoint anywhere
   * in the repo is `frontend/e2e-real/reach.spec.ts:198`, which hits the URL
   * directly rather than through this wrapper.
   *
   * Kept regardless, and not as dead weight: the server route is deliberately
   * alive for this client, and these four lines are the corrected record of a
   * shape that has already been got wrong once.
   *
   * If it is ever called, it is NOT `/live.channels` narrowed down. It JOINs
   * `samvada_channel_members`, so it sees only channels the caller holds a
   * membership row in — no public channel they never joined, no archived one —
   * and it counts from `COALESCE(cm.last_read_at, '1970-01-01')`, so a member
   * row born with a NULL `last_read_at` reports that channel's ENTIRE history as
   * unread. `/live` and `GET /channels` were both taught not to do that; this
   * one was not.
   */
  unread: () =>
    apiClient.get<Record<string, number>>('/v1/messaging/unread').then(r => r.data),

  /**
   * Newest first. `before` is a MESSAGE ID used as a cursor, not a timestamp —
   * the server resolves it to that message's `created_at`.
   *
   * Both parameters are clamped HERE because the server does not clamp them:
   * `before` reaches `$3::uuid` unguarded (a malformed value is a 500, not a
   * 404) and a negative `limit` is a 500 too. Do not bypass this by calling the
   * endpoint directly.
   */
  list: (channelId: string, params?: { before?: string; limit?: number }) => {
    const before = isUuid(params?.before) ? params!.before : undefined;
    const limit  = Math.max(1, Math.min(100, params?.limit ?? 50));
    return apiClient
      .get<Message[]>(`/v1/messaging/channels/${channelId}/messages`, { params: { before, limit } })
      .then(r => r.data.map(cleanMessage));
  },

  /** A reply's parent must be a ROOT. The server refuses a nested one with
   *  "Replies cannot be nested." — inside a thread, pass the root, not the reply
   *  that was tapped. */
  send: (channelId: string, content: string, parentMessageId?: string) =>
    apiClient
      .post<Message>(`/v1/messaging/channels/${channelId}/messages`, {
        content,
        type: 'text',
        parent_message_id: parentMessageId ?? null,
      })
      .then(r => cleanMessage(r.data)),

  edit: (messageId: string, content: string) =>
    apiClient.patch<Message>(`/v1/messaging/messages/${messageId}`, { content })
      .then(r => cleanMessage(r.data)),

  remove: (messageId: string) =>
    apiClient.delete(`/v1/messaging/messages/${messageId}`).then(r => r.data),

  /** The DIRECT children of a root, oldest first. Threads are flat — a reply
   *  never has replies of its own. */
  thread: (messageId: string) =>
    apiClient.get<Message[]>(`/v1/messaging/messages/${messageId}/thread`)
      .then(r => r.data.map(cleanMessage)),

  /** `emoji` goes in the query string, not the body — see the note above. */
  react: (messageId: string, emoji: string) =>
    apiClient
      .post(`/v1/messaging/messages/${messageId}/reactions`, null, { params: { emoji } })
      .then(r => r.data),

  unreact: (messageId: string, emoji: string) =>
    apiClient
      .delete(`/v1/messaging/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`)
      .then(r => r.data),

  /** Marks the channel read up to now. Called on open and on focus, not per
   *  message — the server stores a single last_read_at per member, and it clears
   *  that channel's unread MENTIONS in the same call. */
  markRead: (channelId: string) =>
    apiClient.post(`/v1/messaging/channels/${channelId}/read`, {}).then(r => r.data),

  // ── 093 ────────────────────────────────────────────────────────────────────

  /**
   * ALWAYS 200 — a deleted, archived or foreign channel yields empty lists
   * rather than a 404, so a channel disappearing underneath a running poll
   * cannot raise an error banner for a race the client has already recovered
   * from.
   *
   * This carries the typing ping AND the presence heartbeat AS A GET, on
   * purpose: the write limiter is 120 per IP per minute and a typing POST every
   * three seconds is 20 writes a minute per user, so four colleagues behind one
   * office NAT would spend two thirds of that office's whole write budget on
   * animated dots. DO NOT ADD A POST FOR TYPING OR PRESENCE.
   *
   * There is exactly one caller of this in the app — `LiveProvider`. A second
   * poll is a second interval nobody is bounding.
   */
  live: (p: LiveParams = {}) =>
    apiClient.get<LivePayload>('/v1/messaging/live', {
      params: {
        channel_id: isUuid(p.channelId) ? p.channelId : undefined,
        typing: p.typing ? 1 : 0,
        away:   p.away   ? 1 : 0,
      },
    }).then(r => r.data),

  /**
   * A BARE ARRAY, newest first. `before` is a MENTION id and the server pages
   * keyset on `(created_at, id)` — a fan-out writes one row per recipient inside
   * a single statement, so a batch shares a `created_at` to the microsecond and
   * ordering on that column alone would drop or repeat neighbours.
   *
   * END OF FEED IS A PAGE SHORTER THAN `limit`. There is no `more` flag and no
   * total. `[]` before 093.
   */
  mentions: (params?: { unreadOnly?: boolean; limit?: number; before?: string }) =>
    apiClient.get<Mention[]>('/v1/messaging/mentions', {
      params: {
        unread_only: params?.unreadOnly ? true : undefined,
        limit:  Math.max(1, Math.min(100, params?.limit ?? 30)),
        before: isUuid(params?.before) ? params!.before : undefined,
      },
    }).then(r => r.data),

  /**
   * Three shapes only. Sending BOTH `mention_ids` and `mark_all` is a 400.
   *
   * `channel_id` MUST be a uuid: the server drops an invalid one SILENTLY and
   * the UPDATE then runs unscoped, so `{mark_all:true, channel_id:'oops'}` marks
   * the caller's ENTIRE ORG read. That is why this throws instead of trimming,
   * and why the body is never constructed by hand at a call site.
   *
   * `updated` is 0 on a re-send — the UPDATE requires `read_at IS NULL`.
   */
  markMentionsRead: (body: MentionsReadIn) => {
    if (body.mention_ids?.length && body.mark_all) {
      throw new Error('markMentionsRead: send mention_ids OR mark_all, never both');
    }
    const payload: MentionsReadIn = {};
    if (body.mention_ids?.length) payload.mention_ids = body.mention_ids.filter(isUuid);
    if (body.mark_all) {
      payload.mark_all = true;
      if (body.channel_id !== undefined) {
        if (!isUuid(body.channel_id)) throw new Error('markMentionsRead: channel_id must be a uuid');
        payload.channel_id = body.channel_id;
      }
    }
    return apiClient.post<{ ok: true; updated: number }>('/v1/messaging/mentions/read', payload)
      .then(r => r.data);
  },

  /**
   * RETURNS `{ results, more }` — not a bare array, not a `{data}` envelope. See
   * `SearchPage`.
   *
   * `q` is 2..120 characters or the server 422s, and a FastAPI 422 carries
   * `detail` as an ARRAY while `client.ts` only unwraps a string one, so a
   * validation failure reads "Something went wrong. Please try again." Validate
   * before calling rather than explaining that sentence to a user.
   *
   * `offset` is hard-capped at 500 by the server. Stop there; the result set is
   * ordered by recency within a match set and has no stable cursor to invent.
   */
  search: (p: SearchParams) =>
    apiClient.get<SearchPage>('/v1/messaging/search', {
      params: {
        q: p.q,
        channel_id: isUuid(p.channelId) ? p.channelId : undefined,
        from_user:  p.fromUser || undefined,
        limit:  Math.max(1, Math.min(50,  p.limit  ?? 25)),
        offset: Math.max(0, Math.min(500, p.offset ?? 0)),
      },
    }).then(r => r.data),

  /**
   * 200, not 201. Idempotent — whoever pinned first keeps the attribution and a
   * second caller still gets the timestamp, because from their side the message
   * is now pinned, which is what they asked for.
   *
   * 400 at the 50-pin cap, 403 on an archived channel, and 500 before 093, which
   * is deliberately unguarded on the server: a click that fails should fail
   * loudly. Surface `err.friendlyMessage`.
   */
  pin: (messageId: string) =>
    apiClient.post<{ ok: true; pinned_at: string }>(`/v1/messaging/messages/${messageId}/pin`)
      .then(r => r.data),

  /** ALLOWED on an archived channel, where `pin` is refused — the same asymmetry
   *  the router applies to reactions, because taking something back is not the
   *  act these gates exist to prevent. 403 unless you pinned it or you are a
   *  channel admin. */
  unpin: (messageId: string) =>
    apiClient.delete<{ ok: true }>(`/v1/messaging/messages/${messageId}/pin`).then(r => r.data),

  /**
   * A BARE ARRAY, newest PIN first — `ORDER BY m.pinned_at DESC`, not by when
   * the message was written. The bar and the sheet both show "most recently
   * pinned" and that is the order the reader is being given.
   *
   * Unpaged, and it stays that way: `_PIN_CAP` bounds a channel at fifty pins,
   * so a cursor would be ceremony around a query that cannot grow. `[]` before
   * 093 rather than a 500 — unlike `pin` itself, which is deliberately
   * unguarded — because ChatScreen loads this on EVERY channel open and a throw
   * here would take the chat header down with it.
   *
   * The channel id is uuid-guarded here for the reason stated at the top of this
   * file: it arrives from a route param or a push payload, and the server
   * answers 404 on a malformed one, which would surface as a spurious error on a
   * query that runs unattended behind the message list.
   */
  pins: (channelId: string) => {
    if (!isUuid(channelId)) return Promise.resolve<PinnedMessage[]>([]);
    return apiClient
      .get<PinnedMessage[]>(`/v1/messaging/channels/${channelId}/pins`)
      .then(r => r.data);
  },

  /**
   * Works with or without 093.
   *
   * MUTE NEVER HIDES THE MENTION BADGE. The fan-out still writes the mention row
   * for a muted channel and suppresses only the notification and the push:
   * muting means "do not interrupt me", not "hide from me that I was named".
   *
   * Muting a PUBLIC channel you never joined JOINS YOU TO IT — the preference
   * has nowhere else to live but the membership row — which bumps `member_count`
   * and makes you a broadcast recipient. Unmuting one does not, because the
   * absence of a row already means "not muted".
   */
  setMute: (channelId: string, muted: boolean) =>
    apiClient.put<{ ok: true; muted: boolean }>(`/v1/messaging/channels/${channelId}/mute`, { muted })
      .then(r => r.data),

  /** The only way to learn whether to render a composer or a locked one.
   *  `GET /v1/me` returns module CODES with no level, which answers reach and
   *  not depth. */
  me: () => apiClient.get<SanvaadAccess>('/v1/messaging/me').then(r => r.data),

  /**
   * The @-autocomplete source, and the only user directory an ordinary member
   * can read — `GET /v1/org/members` is org-admin gated. Identity only, no
   * email. The caller is excluded.
   *
   * ── `channelId` IS WHAT MAKES THIS SAFE TO MENTION FROM
   *
   * Unscoped, this is `full_name ILIKE '%q%'` over the whole org — a set the
   * mention resolver will not match in a `private` channel or a `dm`, where
   * `_readable_by` is the member rows and nothing else. Offering a name the
   * resolver cannot resolve posts a message that looks like it named somebody
   * and notifies nobody, with nothing at all said to the sender.
   *
   * Passing the channel makes the SERVER narrow the candidate set to exactly
   * that universe and run the search and the LIMIT inside it, which is the half
   * a client cannot do: filtering an org-wide page locally can only discard
   * rows, never recover a member the server's LIMIT already cut.
   *
   * TWO THINGS CHANGE IN THE RESPONSE, and neither is a new key — the shape is
   * `DirectoryUser[]` either way:
   *   · `full_name` carries `COALESCE(full_name, name, email)`, byte-identical
   *     to the `display` the resolver matches on, so a member whose `full_name`
   *     is NULL is now offerable rather than a blank row to be dropped.
   *   · the rows are already scoped, so nothing downstream needs to filter them.
   *
   * A `channelId` that is not a uuid is REFUSED HERE rather than dropped. The
   * server answers 404 to one on purpose — a caller that asked to be scoped and
   * cannot be must not silently be handed the whole org — and dropping it on
   * this side would reopen exactly that hole one layer up. Same rule, and the
   * same reason, as `markMentionsRead`'s `channel_id` above.
   */
  directory: (q?: string, limit = 20, channelId?: string | null) => {
    if (channelId != null && !isUuid(channelId)) {
      throw new Error('directory: channelId must be a uuid');
    }
    return apiClient
      .get<DirectoryUser[]>('/v1/messaging/directory', {
        // `undefined` is dropped by axios, which is what selects the server's
        // unscoped arm. `null` must never reach the wire — it serialises as the
        // string "null" and the server 404s on it.
        params: { q: q || undefined, limit, channel_id: channelId ?? undefined },
      })
      .then(r => r.data);
  },
};
