/**
 * MentionsPanel.jsx — every message that said your name, in one list.
 *
 * ── Why this file exists
 *
 * `GET /v1/messaging/mentions` and `POST /v1/messaging/mentions/read` landed
 * with migration 093 and had ZERO callers anywhere in `frontend/src`, and
 * `usePresence` computed the `mention_unread` tail of `/live` on every
 * four-second poll and handed it to a `ChannelsTab` that destructured neither
 * it nor `refresh`. So the only trace of a mention in the whole product was the
 * rail's per-channel `@3`: it says a channel holds three of them and nothing
 * about which messages, from whom, or when. The one place a reader could act on
 * a mention was `notifications` — and a notification is not written at all for a
 * MUTED channel (`fan_out_mentions` writes the mention row and suppresses only
 * the notification and the push), so a mention in a muted channel was reachable
 * exclusively by opening that channel and reading back through it.
 *
 * ── The contract, read off `routers/messaging.py` rather than guessed
 *
 * `GET /mentions` answers a BARE ARRAY — not `{results, more}` like `/search`.
 * Each row is:
 *
 *   { id, channel_id, message_id, kind, created_at, read_at,
 *     channel_name, channel_type, content, sender_id, sender_name,
 *     sender_avatar }
 *
 * `id` is the MENTION's id and `message_id` is the message's; the jump needs the
 * second and the mark-read needs the first, and confusing the two is the exact
 * class of defect this module keeps producing.
 *
 * `kind` is one of `'user' | 'here' | 'channel'` (`samvaad_mentions._resolve`).
 * `channel_name` arrives as `#accounts` for a room and as the OTHER
 * participant's name for a DM (`_channel_label_sql`), which is why one leading
 * hash is stripped below — the row draws `channelIcon()` and `##accounts` is
 * what leaving it in looks like. `SearchPanel` carries the same correction.
 *
 * PAGING IS KEYSET, NOT OFFSET, and the cursor is a MENTION ID. `before` is
 * compared as `(created_at, id) < (that row's pair)`, because `fan_out_mentions`
 * inserts one row per recipient in a single statement and a batch therefore
 * shares a `created_at` to the microsecond. There is no `more` flag on the
 * response, so a full page is treated as "there may be another" and the button
 * disappears when a page comes back short or empty — one wasted request when the
 * total is an exact multiple of the page size, which is cheaper than a
 * `COUNT(*)` over the whole feed on every open.
 *
 * `POST /mentions/read` takes `{mention_ids: []}` OR `{mark_all: true}` and
 * refuses BOTH in one call with a 400 (`MentionsReadIn`). Only the mark-all arm
 * is sent from here, and the reason the per-row arm is not is worth stating: a
 * row that is CLICKED opens its channel, and `POST /channels/{id}/read` — which
 * `useChannelMessages` already fires on mount — clears `read_at` for every
 * mention in that channel in the same transaction as `last_read_at`. Sending a
 * per-row mark as well would be a second write, a hundred milliseconds after the
 * first, against a budget of 120 writes per client IP per minute that four
 * colleagues behind one office NAT share. The rows are flipped locally instead.
 *
 * ── An empty feed is not always an empty feed
 *
 * `list_mentions` returns `[]` outright when migration 093 has not been applied
 * to the database this process talks to (`_parity_ready`). That window is real —
 * migrations here are run by hand — and it is indistinguishable from "nobody has
 * mentioned you" over the wire. It is survivable only because `/live` answers
 * `mention_unread: 0` in the same window, so the badge, the rail and this panel
 * all agree on the same wrong answer rather than contradicting each other.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { EmptyState, ErrorState, errorKind, SkeletonList } from '../../components/ui';
import { useExitAnimation } from '../../hooks/useExitAnimation';
import { formatTime } from '../../lib/timeFormat';
import { dayLabel, splitMentions } from './messageUtils';
import { channelIcon, SvIcons } from './icons';
import { Secondary } from '../../components/Bilingual';

/** `limit: int = Query(30, ge=1, le=100)`. */
const PAGE = 30;

/**
 * `#` comes from the icon OR from the server's string, never from both — the
 * same correction `SearchPanel.channelLabel` makes, for the same reason: this
 * endpoint and `/search` share `_channel_label_sql`, which prefixes a room's
 * name with a hash while `GET /channels` returns it bare.
 */
function channelLabel(r) {
  const raw = String(r.channel_name || '').trim().replace(/^#/, '');
  return raw || 'Direct message';
}

/**
 * The message body, flattened to one run of inline nodes with `@name` lifted
 * out.
 *
 * `splitMentions` and NOT `parseRich`, and the reason is the markup rather than
 * the effort. A row here is a `<button>`, whose content model is phrasing
 * content only, and `parseRich` emits `<pre>`, `<ul>` and `<blockquote>` for a
 * message that happens to contain a fence or a list — block boxes inside a
 * button, which is invalid and lays out unpredictably. `splitMentions` is the
 * same single mention parser the message log uses (two parsers that agree today
 * are two parsers that disagree after the next edit —
 * `__tests__/renderMentions.test.jsx` exists to remember that), and it produces
 * nothing but strings and mention markers.
 *
 * `names` is `[meName]` alone. The parser needs the known display names to match
 * a mention that spans a space — with no list, `@Keval Shah` matches only
 * `@Keval` — and on THIS surface the only name that has to be right is the
 * reader's own, because a mention feed exists to show where somebody said it.
 * Every other `@handle` still matches through the bare `[\w.-]+` arm.
 *
 * Whitespace is collapsed first, exactly as `SearchPanel` collapses a snippet: a
 * message opening with a fenced code block would otherwise contribute two lines
 * of newlines to a row that is clamped to two lines.
 */
function bodyParts(content, meName) {
  const flat = String(content || '').replace(/\s+/g, ' ').trim();
  return splitMentions(flat, meName ? [meName] : [], meName).map((p, i) => (
    typeof p === 'string'
      ? <React.Fragment key={i}>{p}</React.Fragment>
      : <span key={i} className={`msg__mn${p.me ? ' msg__mn--me' : ''}`}>{p.mention}</span>
  ));
}

/** `@here` and `@channel` are worth naming; a direct mention is the default and
 *  a tag saying so on every row would be noise. */
const KIND_TAG = { here: '@here', channel: '@channel' };

function MentionRow({ r, meName, onOpen }) {
  const unread = !r.read_at;
  // Date AND time, not `relTime`. `SearchPanel` settles this for the sibling
  // panel and the reasoning transfers exactly: a rail row answers "which
  // conversation moved last", and one entry in a feed that reaches back months
  // answers "is this the one I remember" — which needs "12 Mar 2026, 4:18 PM".
  // The ISO value stays on `dateTime` for anything reading the markup.
  const when = `${dayLabel(r.created_at).en}, ${formatTime(r.created_at)}`;

  return (
    <button
      type="button"
      className={`sv__mnp-r${unread ? ' is-unread' : ''}`}
      onClick={() => onOpen(r)}
    >
      <span className="sv__mnp-c">
        <span className="ch__ic" aria-hidden="true">{channelIcon(r.channel_type)}</span>
        {channelLabel(r)}
        {' · '}
        {/* `sender_name` is a LEFT JOIN on `users`, so a mention written by a
            since-deleted account arrives with a null name rather than no row.
            The mention still happened; only the name is gone. */}
        {r.sender_name || 'Unknown'}
        {' · '}
        <time dateTime={r.created_at}>{when}</time>
        {KIND_TAG[r.kind] && <span className="sv__mnp-k">{KIND_TAG[r.kind]}</span>}
        {/* A dot with a name, not a bare dot. Unread is carried by a colour and
            a heavier row, and 23-accessibility.md's rule is that a state whose
            only carrier is colour has to be in the accessible name too — the
            same reasoning `.sv__pres` and `.ch__mute` follow. The row is a
            button, so this lands inside its accessible name. */}
        {unread && <span className="sv__mnp-u" role="img" aria-label="Unread" />}
      </span>
      <span className="sv__mnp-s">{bodyParts(r.content, meName)}</span>
    </button>
  );
}

export default function MentionsPanel({
  open, onClose, meName = null, onJump, onRead,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [marking, setMarking] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const box = useRef(null);

  /**
   * The feed is fetched when the panel OPENS and not on a timer.
   *
   * `/live` already carries the count every four seconds, which is what the
   * badge on the trigger needs; the list itself is read, acted on and dismissed.
   * A second poll for a surface nobody is staring at would double this module's
   * request rate to keep a list fresh that closes as soon as it is used.
   */
  useEffect(() => {
    if (!open) return undefined;
    let dead = false;
    setLoading(true);
    api.get('/v1/messaging/mentions', {
      params: { limit: PAGE, ...(unreadOnly ? { unread_only: true } : {}) },
    })
      .then((r) => {
        if (dead) return;
        const got = Array.isArray(r.data) ? r.data : [];
        setRows(got);
        setMore(got.length === PAGE);
        setError(null);
      })
      .catch((e) => {
        if (dead) return;
        setError(e);
        setRows([]);
        setMore(false);
      })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [open, unreadOnly]);

  /**
   * The keyset cursor is the LAST ROW'S MENTION ID, never its `created_at` and
   * never an offset. The server compares `(created_at, id)` as a pair precisely
   * because a fan-out batch shares a timestamp; handing it anything else here
   * would silently drop or repeat the neighbours of whichever row the page
   * happened to end on.
   */
  const loadMore = useCallback(async () => {
    const last = rows[rows.length - 1];
    if (loadingMore || !more || !last) return;
    setLoadingMore(true);
    try {
      const r = await api.get('/v1/messaging/mentions', {
        params: {
          limit: PAGE,
          before: last.id,
          ...(unreadOnly ? { unread_only: true } : {}),
        },
      });
      const got = Array.isArray(r.data) ? r.data : [];
      // De-duplicated by id anyway. The cursor makes a repeat impossible in
      // theory, and "impossible in theory" is how a list ends up rendering two
      // React children with the same key.
      setRows((prev) => {
        const seen = new Set(prev.map(x => String(x.id)));
        return [...prev, ...got.filter(x => x && !seen.has(String(x.id)))];
      });
      setMore(got.length === PAGE);
    } catch (e) {
      // The page already on screen stays. A failed continuation is not a failed
      // feed, and blanking thirty good rows to report it would be.
      setError(e);
    } finally {
      setLoadingMore(false);
    }
  }, [more, loadingMore, rows, unreadOnly]);

  const unread = useMemo(() => rows.filter(r => !r.read_at).length, [rows]);

  /**
   * `{mark_all: true}` alone — sending `mention_ids` beside it is a 400, not a
   * merge, because "I sent ids AND mark_all" has two readings and the server
   * refuses to guess.
   *
   * Deliberately NOT scoped by `channel_id` even though the body accepts one:
   * the button says "Mark all read" and it is above a list of every channel.
   *
   * It clears mentions that arrived after this list was fetched, too. That is
   * the server's behaviour and it is the right one — a button that leaves behind
   * an invisible unread it could not see would put the badge back a moment after
   * clearing it, and the reader would have no way to find what it was counting.
   *
   * `onRead` forces a `/live` tick rather than waiting out the interval, so the
   * trigger's badge and every per-channel `@n` in the rail clear at once; the
   * local flip below is what keeps THIS list from waiting four seconds for it.
   */
  const markAll = async () => {
    if (marking || !unread) return;
    setMarking(true);
    const stamp = new Date().toISOString();
    try {
      await api.post('/v1/messaging/mentions/read', { mark_all: true });
      setRows(prev => prev.map(r => (r.read_at ? r : { ...r, read_at: stamp })));
      onRead?.();
    } catch (e) {
      setError(e);
    } finally {
      setMarking(false);
    }
  };

  /**
   * Opening a mention needs no write of its own — see the header. `jumpTo`
   * selects the channel, `useChannelMessages` posts `/channels/{id}/read` on
   * mount, and that statement clears `read_at` for EVERY mention in that channel
   * inside the same transaction as `last_read_at`. So the local flip is for the
   * whole channel and not for the one row, which is what the server just did.
   *
   * The flip happens whether or not the jump resolved. It does not have to be
   * conditional: `jumpTo` only fails when the channel is no longer in this
   * reader's list, in which case no `/read` was posted — and re-opening the
   * panel refetches from the server, which is the authority.
   */
  const openRow = async (r) => {
    const cid = String(r.channel_id);
    const stamp = new Date().toISOString();
    setRows(prev => prev.map(x => (
      String(x.channel_id) === cid && !x.read_at ? { ...x, read_at: stamp } : x
    )));
    await onJump?.(r);
  };

  /**
   * `.sv__mnp.is-closing` runs `svSrchOut` and carries `pointer-events: none`,
   * and neither happens if React has already removed the node — the exact defect
   * `useExitAnimation` exists for. The click-through half is not cosmetic:
   * `overlay-motion.test.jsx` asserts every closing overlay in the app is
   * click-through, and this panel covers the whole message log, so dismissing it
   * and immediately clicking a message has to hit the message.
   */
  const { alive, closing, onAnimationEnd } = useExitAnimation(open);

  // Focus moves INTO the panel when it opens, and that is what makes the Escape
  // handler below reachable at all — a keydown listener on an element nothing is
  // focused inside never fires. `SearchPanel` gets this for free from its
  // `autoFocus` input; this panel has no field, and landing focus on "Mark all
  // read" would put a keyboard user one Space away from clearing every badge
  // they have. So the container itself takes it.
  useEffect(() => { if (alive && open) box.current?.focus(); }, [alive, open]);

  if (!alive) return null;

  return (
    <aside
      ref={box}
      tabIndex={-1}
      className={`sv__mnp${closing ? ' is-closing' : ''}`}
      role="region"
      aria-label="Mentions"
      onAnimationEnd={onAnimationEnd}
      // Escape closes this panel and stops there. The shell above listens for
      // Escape to close the thread; without the stop, one press would close both
      // and the reader would lose the conversation they were reading.
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); }
      }}
    >
      <div className="sv__mnp-f">
        <h2 className="sv__mnp-h">
          Mentions
          <Secondary className="sv__hi" value="उल्लेख" />
        </h2>
        {/* `.sv__ltog` is the rail's own Active/All switch and `SearchPanel`'s
            scope switch — a small pill that states a filter and shows whether it
            is on. Reused rather than redrawn; a third toggle style for the same
            idea is how a surface ends up with three vocabularies. */}
        <button
          type="button"
          className="sv__ltog"
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly(v => !v)}
        >
          Only unread
        </button>
        <button
          type="button"
          className="btn btn--out btn--sm"
          onClick={markAll}
          // Disabled on zero rather than hidden: the button is the answer to
          // "how do I get rid of this badge", and a control that vanishes once
          // it has worked cannot be found again by somebody looking for it.
          disabled={marking || unread === 0}
        >
          {marking ? 'Marking…' : 'Mark all read'}
        </button>
        <button type="button" className="svbtn" onClick={onClose} aria-label="Close mentions">
          {SvIcons.close}
        </button>
      </div>

      <div className="sv__mnp-l" aria-busy={loading ? 'true' : undefined}>
        {loading && rows.length === 0 && !error && <SkeletonList rows={5} showAvatar />}

        {error && (
          <ErrorState
            kind={errorKind(error)}
            /* The server's own sentence wins where it has one. A 403 on this
               module is either an inactive module or a missing grant, and only
               the API knows which — the correction `ChannelList` and
               `SearchPanel` both carry. */
            title={errorKind(error) === 'denied' ? 'Mentions can’t be opened' : undefined}
            detail={errorKind(error) === 'offline'
              ? 'Mentions need a connection. Nothing has been lost — this reads what is already recorded, it does not change it.'
              : (error?.response?.data?.detail
                || 'Your mentions did not load. This is a read failure; no mention was cleared or removed.')}
          />
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="sv__mnp-e">
            <EmptyState
              illustration="teams"
              title={unreadOnly
                ? { en: 'Nothing unread', hi: 'कुछ भी अपठित नहीं' }
                : { en: 'No mentions yet', hi: 'अभी कोई उल्लेख नहीं' }}
              /* Two different sentences, because the filter changes what the
                 emptiness means. "No mentions yet" under an active Only-unread
                 switch is a claim about the whole feed made from a filtered
                 view, and the reader would have no reason to look for the
                 switch that is hiding the rest. */
              description={unreadOnly
                ? 'Every mention you have is already read. Turn the switch off to see them again.'
                : 'When somebody writes your name in a channel or a direct message, it lands here — including in channels you have muted.'}
            />
          </div>
        )}

        {rows.map(r => (
          <MentionRow key={r.id} r={r} meName={meName} onOpen={openRow} />
        ))}

        {rows.length > 0 && more && (
          <div className="sv__older">
            <button
              type="button"
              className="btn btn--out btn--sm"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load older mentions'}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
