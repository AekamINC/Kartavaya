/**
 * ChatPane.jsx — header, log, composer for one channel.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorState, errorKind, useToast } from '../../components/ui';
import MessageLog from './MessageLog';
import Composer from './Composer';
import ChannelDetails from './ChannelDetails';
import LockedComposer from './LockedComposer';
import PinnedBar from './PinnedBar';
import { channelIcon, SvIcons } from './icons';
import useChannelMessages from './useChannelMessages';

/**
 * How long somebody stays out of the typing line after one of their messages
 * lands here.
 *
 * The typing line is fed by a poll (D4 — Supabase's pooler runs transaction
 * mode on :6543 where LISTEN/NOTIFY does not work, and the service runs several
 * gunicorn workers, so there is no push to have instead), which means every
 * fact it states is a few seconds old. Most of that staleness is harmless: dots
 * that appear a beat late are still true. One case is not. The sender's own
 * client clears the typing row on send, but that clear rides their NEXT poll,
 * and their message reaches us on OUR poll — so for a moment the log shows the
 * finished message with "Rohan is typing…" underneath it, which reads as a
 * second message on its way that never comes.
 *
 * So a sender is hushed locally the moment their message arrives, for slightly
 * less than the server's own 8-second typing window. The window is the backstop;
 * this is only the gap in front of it.
 */
const HUSH_MS = 6000;

/**
 * §2.2 — `@channel` and `@here` need channel admin ABOVE this many members.
 * Below it anyone may broadcast, because paging four colleagues is not paging
 * the firm. The server enforces it by resolving a non-admin's `@channel` on a
 * bigger channel to zero recipients and returning the message normally; the
 * popup therefore has to apply the same rule, or it offers a token that looks
 * like it worked and notified nobody.
 */
const BROADCAST_FREE_LIMIT = 15;

/**
 * How many names the typing line will read out before it stops naming people.
 *
 * `messaging.py:1216` caps `/live`'s typing list at five and excludes the
 * caller, and says why: "Several people are typing…" is the label above three.
 * This is the client half of that same number — the server ships the names, and
 * this decides when the sentence stops being worth reading.
 */
const TYPING_NAME_LIMIT = 3;

/**
 * "Rohan is typing…" — or what to say instead of four names.
 *
 * English only, deliberately. The bilingual layer is a recognition cue beside
 * fixed labels the reader already knows the meaning of — the module names, the
 * statuses, "Today", "New messages" — and `24-bilingual-devanagari.md` is
 * explicit that it is a frozen enumerated list, not a translation layer for
 * sentences generated at runtime. This one is assembled from whoever happens to
 * be typing, so it is left as prose, the same way the empty-state body below is.
 *
 * Returns null rather than a half-built sentence when no name survives. The
 * server COALESCEs `full_name, name, email` so a blank is unlikely, but the
 * join behind it is a LEFT JOIN and "undefined is typing…" is a worse outcome
 * than a row that quietly does not appear.
 */
/**
 * How long a deep link waits for the message it names to reach the DOM before
 * it gives up and says so.
 *
 * A message in the CHANNEL LOG is already there the moment `loading` clears, so
 * this costs that case one frame. A THREAD REPLY is a different shape of wait
 * and is what these two numbers exist for: `list_messages` filters
 * `parent_message_id IS NULL`, so a reply is never in the log — it exists only
 * inside `ThreadPanel`, which this pane does not own, does not render, and
 * cannot await. Opening the panel is one call to `onOpenThread`; the panel then
 * fetches its own replies, so the node is a round trip away and no number of
 * animation frames will produce it.
 *
 * Six seconds is comfortably past a slow `GET /messages/:id/thread` and still
 * inside the span where the reader remembers clicking the notification — which
 * matters, because what happens at the end of it is a sentence explaining that
 * the thing they clicked for is not there.
 */
const FOCUS_WAIT_MS = 6000;
/** Between attempts. Short enough to feel immediate once the panel paints. */
const FOCUS_POLL_MS = 120;

function typingLabel(list) {
  const names = list.map(t => (t?.full_name || '').trim()).filter(Boolean);
  if (!names.length) return null;
  if (names.length > TYPING_NAME_LIMIT) return 'Several people are typing…';
  if (names.length === 1) return `${names[0]} is typing…`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are typing…`;
}

export default function ChatPane({
  channel, me, meId, meName, access, onOpenThread, onSent, onBack, threadOpen,
  onChannelChanged,
  // All five are new and all five default to what this pane did before them, so
  // a caller that has not been taught about them yet renders exactly today's
  // chat pane rather than a broken one.
  presence = {},
  typing = [],
  focusMessageId = null,
  onOpenSearch,
  onTyping,
  /**
   * The THREAD ROOT a deep link named, when the message it is aiming at is a
   * thread reply. `services/samvaad_mentions.MENTION_URL_THREAD_PARAM` is the
   * other half of this contract and the name it puts on the wire is `thread`;
   * `ChannelsTab` reads the parameter and hands the value down here.
   *
   * Null for an ordinary mention, which is the whole of today's behaviour.
   */
  focusThreadId = null,
  /**
   * Report the channel's member list upward.
   *
   * `ThreadPanel` is a SIBLING of this pane rather than a child — `ChannelsTab`
   * owns the third grid column — and it needs the same list for its own `@`
   * autocomplete and its own mention rendering. Lifting the answer costs
   * nothing; a second `GET /channels/:id/members` from the panel would be a
   * round trip for a list this component's hook is already holding.
   */
  onMembers,
}) {
  const { pushToast } = useToast();
  /**
   * `pins`, `members`, `pin` and `unpin` come from the hook, not from state
   * here.
   *
   * The build spec put them in both places — §5.9 gives this file the member
   * fetch, §5.12 gives the hook the same four — and duplicating them was the
   * worse half of that. `pin` has to roll the OPTIMISTIC `pinned_at` back onto
   * a row in `messages` when the server refuses, and `messages` lives in the
   * hook; a second copy of `pins` in this file would drift from the one the
   * hook keeps in step, which is exactly how a message ends up highlighted in
   * the log and absent from the bar. One owner.
   *
   * Both `pin` and `unpin` take a MESSAGE ID, not a message, and both RETHROW —
   * this layer is where the server's sentence becomes a toast.
   */
  const {
    messages, loading, error, send, react, edit, remove, loadOlder, more, older,
    pin: pinMsg, unpin: unpinMsg, pins, members,
  } = useChannelMessages(channel.id, meId, me);
  const [replyTo, setReplyTo] = useState(null);
  const [settings, setSettings] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);

  // Two independent reasons the composer can be shut, and they say different
  // things. `ScreensSanvaad.jsx:195` — `canPost = role === 'editor' && !archived`.
  const archived = !!channel.is_archived;
  const canPost = (access?.canPost !== false) && !archived;

  // Captured once per channel: the divider must mark where the reader was when
  // they arrived, not follow them down the log as `read` is re-posted.
  // `list_channels` returns the field as `my_last_read`.
  const [lastReadAt] = useState(() => channel.my_last_read || null);

  /**
   * The caller's own row on THIS channel. `access.canPost` is a module level and
   * says nothing about a single channel, so this is the only thing that answers
   * "may I unpin what somebody else pinned" and "is `@channel` mine to use".
   * `list_members` returns `cm.*` joined to `users`, so `role` is on the row.
   */
  const meIsChannelAdmin = members
    .find(m => String(m.user_id) === String(meId))?.role === 'admin';

  // `members` is empty until the request lands and stays empty if it failed, so
  // the count falls back to `list_channels.member_count`, which is already on
  // the row the header renders. When BOTH are unknown the broadcast rows stay
  // hidden — offering a token whose recipients we cannot count is the same
  // defect as offering a button that fails.
  const memberCount = members.length || Number(channel.member_count) || 0;
  const allowBroadcast = meIsChannelAdmin
    || (memberCount > 0 && memberCount <= BROADCAST_FREE_LIMIT);

  /* ── Pins ─────────────────────────────────────────────────────────────────
   *
   * The hook does the optimistic patch, the rollback and the reload; this layer
   * only turns the two refusals that carry a real sentence into a toast. Both
   * sentences matter: `POST .../pin` answers 400 "This channel already has 50
   * pinned messages. Unpin one first." and `DELETE .../pin` answers 403 "Only
   * the person who pinned this, or a channel admin, can unpin it." — neither is
   * something a reader can work out from a silent failure.
   *
   * Both accept the message ROW because that is what `Message`, `MessageLog`
   * and `PinnedBar` all hand back, and hand the id on to the hook.
   */
  const pin = async (msg) => {
    try {
      await pinMsg(msg.id);
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to pin the message' });
    }
  };

  const unpin = async (msg) => {
    try {
      await unpinMsg(msg.id);
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to unpin the message' });
    }
  };

  /**
   * §1.10: the server lets the person who pinned it, or a channel admin, take it
   * down and refuses everybody else. The ✕ follows that rule rather than
   * offering itself to the whole channel and letting a 403 explain afterwards.
   *
   * Both ids are checked for presence before being compared as strings —
   * `String(null)` and `String(undefined)` are distinct, but a `?? ''` fallback
   * on both sides would make two unknowns equal and hand the control to
   * everyone.
   */
  const canUnpin = useCallback((m) => {
    if (!canPost) return false;
    if (meIsChannelAdmin) return true;
    return m?.pinned_by != null && meId != null && String(m.pinned_by) === String(meId);
  }, [canPost, meIsChannelAdmin, meId]);

  const togglePins = () => setPinsOpen(v => !v);

  /**
   * Scroll a message into view by the id `Message` stamps on its row.
   *
   * `list_messages` returns the newest 50 and `loadOlder` walks back one page at
   * a time, so a pin from three months ago is genuinely not in the DOM. Saying
   * so beats a control that silently does nothing, which is how a reader
   * concludes the pin is broken.
   */
  const jumpTo = useCallback((m) => {
    const el = document.getElementById(`m-${m?.id}`);
    if (el) { el.scrollIntoView({ block: 'center' }); return; }
    pushToast({
      type: 'info',
      title: 'That message is further back — load earlier messages to reach it.',
    });
  }, [pushToast]);

  /* ── Deep link from a mention notification ────────────────────────────────
   *
   * `/sanvaad?channel=…&message=…[&thread=…]` is the `url` on every mention
   * notification row, `ChannelsTab` turns the tail into `focusMessageId` and
   * `focusThreadId`, and this is where both land.
   *
   * THREE THINGS THIS DOES THAT THE FIRST VERSION DID NOT.
   *
   *  · IT OPENS THE THREAD. `list_messages` filters `parent_message_id IS NULL`,
   *    so a reply is never in the log and `getElementById` for one could only
   *    ever return null. A mention written inside a thread therefore dropped the
   *    reader at the bottom of the channel with nothing highlighted — while the
   *    mentions feed sat there quoting the reply's text at them, which proves
   *    something was said and then refuses to show where.
   *  · IT WAITS, THEN GIVES UP OUT LOUD. The old `if (!el) return` is the
   *    defect stated plainly: a dead link and a slow one produced the identical
   *    nothing. The panel's replies are a round trip away, so one animation
   *    frame is not a fair test — but neither is waiting forever, so the wait
   *    has a deadline and the deadline has a sentence.
   *  · IT RE-ARMS. `focused` was a boolean set once for the life of the pane,
   *    which is right for a remount (this component is keyed by channel id) and
   *    wrong for a second notification in the SAME channel: the ref was already
   *    true and the second click did nothing at all. The guard is now the
   *    target itself, so the same target twice is still one jump.
   *
   * `msg--new` is added to the node directly rather than through a prop. React
   * owns that className and will overwrite it on the row's next render, which is
   * at most one poll away — but `svMsgIn` is `--dur-base`, so the animation has
   * finished long before the poll it is racing.
   */
  const focusedKey = useRef(null);
  /**
   * `messages` read through a ref, not a dependency. The retry loop below must
   * survive the poll: with `messages` in the dep array every four-second tick
   * would tear the effect down mid-wait, and the cleanup would cancel the timer
   * that was about to find the reply.
   */
  const msgsRef = useRef(messages);
  useEffect(() => { msgsRef.current = messages; }, [messages]);

  useEffect(() => {
    if (!focusMessageId || loading) return undefined;
    const key = `${focusThreadId || ''}:${focusMessageId}`;
    if (focusedKey.current === key) return undefined;
    focusedKey.current = key;

    // The panel has to be open before anything inside it can be in the DOM. The
    // root is looked up in the log because that is the only place it can be:
    // the server sends `thread` as the reply's `parent_message_id`, and a
    // parent is by definition a row `list_messages` returns — unless it has
    // scrolled past the fifty this pane is holding, which is the one case this
    // cannot recover from and says so.
    let rootMissing = false;
    if (focusThreadId) {
      const root = msgsRef.current.find(m => String(m.id) === String(focusThreadId));
      if (root) onOpenThread?.(root);
      else rootMissing = true;
    }

    let timer = null;
    let clearFlash;
    const deadline = Date.now() + FOCUS_WAIT_MS;

    const attempt = () => {
      const el = document.getElementById(`m-${focusMessageId}`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('msg--new');
        const t = setTimeout(() => el.classList.remove('msg--new'), 1000);
        clearFlash = () => clearTimeout(t);
        return;
      }
      if (!rootMissing && Date.now() < deadline) {
        timer = setTimeout(attempt, FOCUS_POLL_MS);
        return;
      }
      // Three different dead ends and three different sentences, because the
      // reader's next move differs in each. Guessing one label for all of them
      // is how "load earlier messages" gets offered for a message that was
      // deleted an hour ago.
      pushToast({
        type: 'info',
        title: rootMissing
          ? 'That mention is in a thread whose first message is further back — load earlier messages, then open the thread.'
          : (focusThreadId
            ? 'That reply is no longer in the thread. It may have been deleted.'
            : 'That message is not on screen — it is either further back in the channel or it has since been deleted.'),
      });
    };

    // A timeout rather than a frame: the first attempt has to land after the
    // render that `onOpenThread` above just scheduled, and `requestAnimationFrame`
    // can run before React has committed it.
    timer = setTimeout(attempt, 0);
    return () => { clearTimeout(timer); clearFlash?.(); };
  }, [focusMessageId, focusThreadId, loading, onOpenThread, pushToast]);

  // Reported on every change, including the empty list this pane starts each
  // channel with — which is what stops the previous channel's members from
  // being offered in a thread opened in the new one.
  useEffect(() => { onMembers?.(members); }, [members, onMembers]);

  /* ── Typing, minus anyone who has just spoken ─────────────────────────────
   *
   * See HUSH_MS. The comparison is deliberately between two local `Date.now()`
   * readings and never between a client clock and a `created_at` from the
   * database: a laptop whose clock is ten minutes out would otherwise either
   * hush nobody or hush everybody forever, and neither failure is visible to
   * the person it happens to.
   *
   * The first page seeds the map without hushing — every sender's newest
   * message is "new" to us on arrival, and hushing the whole channel for six
   * seconds each time somebody opens it would mean the indicator almost never
   * appeared on the one screen where it matters most.
   */
  const seenLatest = useRef(new Map());
  const hushedAt = useRef(new Map());
  const primed = useRef(false);

  useEffect(() => {
    // `messages` is oldest-first, so the last write per sender is their newest.
    const latest = new Map();
    for (const m of messages) {
      if (!m || m.__pending || m.sender_id == null) continue;
      latest.set(String(m.sender_id), String(m.id));
    }
    const now = Date.now();
    for (const [uid, id] of latest) {
      const prev = seenLatest.current.get(uid);
      seenLatest.current.set(uid, id);
      if (primed.current && prev !== id) hushedAt.current.set(uid, now);
    }
    if (!loading) primed.current = true;
  }, [messages, loading]);

  const typingNow = useMemo(() => {
    const now = Date.now();
    return (Array.isArray(typing) ? typing : []).filter((t) => {
      // The server already excludes the caller from `/live`'s typing list; this
      // is the second lock on a door that has to stay shut, because "you are
      // typing" is the one message the reader can definitively falsify.
      if (meId != null && String(t?.user_id) === String(meId)) return false;
      const hushed = hushedAt.current.get(String(t?.user_id));
      return !(hushed && now - hushed < HUSH_MS);
    });
  }, [typing, meId]);

  const typingText = useMemo(() => typingLabel(typingNow), [typingNow]);

  const submit = async (body) => {
    try {
      await send(body, replyTo?.id);
      if (replyTo) { onOpenThread?.(replyTo); setReplyTo(null); }
      // The dots are the sender's own claim about themselves, so the sender's
      // own client is the only place that can retract them the instant they
      // stop being true. Waiting for the poll to notice the empty box would
      // leave "you are typing" standing over a message you have already sent.
      onTyping?.(false);
      onSent?.();
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to send' });
      throw e;
    }
  };

  // Both surface the server's own reason rather than a generic failure — the
  // router answers 403 "Can only edit your own messages" and 404 "Message not
  // found", and either is more use than "Something went wrong".
  const editMsg = async (msg, content) => {
    try {
      return await edit(msg, content);
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to save the edit' });
      throw e;
    }
  };

  const deleteMsg = async (msg) => {
    try {
      await remove(msg);
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to delete the message' });
      throw e;
    }
  };

  const name = channel.type === 'dm' ? (channel.name || 'Direct message') : channel.name;

  return (
    <div className="sv__chat">
      <header className="sv__hd">
        {onBack && (
          <button type="button" className="svbtn" onClick={onBack} aria-label="Back to channels">
            {SvIcons.back}
          </button>
        )}
        <span className="ch__ic" aria-hidden="true">{channelIcon(channel.type)}</span>
        <h2 className="sv__hd-n">{name}</h2>
        {archived && <span className="ch__arch">archived</span>}
        {channel.description && <p className="sv__hd-d">{channel.description}</p>}
        <span className="sv__hd-act">
          {channel.member_count != null && (
            <button
              type="button"
              className="sv__hd-mem"
              onClick={() => setSettings(true)}
              aria-label={`${channel.member_count} members — open channel settings`}
            >
              <span className="ch__ic" aria-hidden="true">{SvIcons.users}</span>
              {channel.member_count}
            </button>
          )}
          {/* `SvIcons.search` has been declared and unused since this module was
              built; it is the search trigger now. Rendered only when a handler
              is given, which is the same `undefined`-hides-the-control rule the
              four message props already follow — the shell owns the panel, so a
              caller that has no panel must not get a button for it. */}
          {onOpenSearch && (
            <button
              type="button"
              className="svbtn"
              onClick={onOpenSearch}
              aria-label="Search messages"
            >
              {SvIcons.search}
            </button>
          )}
          {/* Hidden at zero pins, because `PinnedBar` renders null at zero and
              the button would toggle nothing. The count is in the accessible
              name rather than beside the glyph: `.svbtn` is a 26px square with
              `place-items: center` and a numeral does not fit next to the icon
              — the visible count is the bar's own "1 of N" directly below. */}
          {pins.length > 0 && (
            <button
              type="button"
              className="svbtn"
              onClick={togglePins}
              aria-expanded={pinsOpen}
              aria-label={`Pinned messages (${pins.length})`}
            >
              {SvIcons.pin}
            </button>
          )}
          {/* `ScreensSanvaad.jsx:257`. The only door to PATCH /channels/:id and
              to the three member routes, all four of which have had zero callers
              since 058 — which is why a private channel could never gain a
              second member. */}
          <button
            type="button"
            className="svbtn"
            onClick={() => setSettings(true)}
            aria-label="Channel settings"
            aria-haspopup="dialog"
          >
            {SvIcons.dots}
          </button>
        </span>
      </header>

      {/* `ScreensSanvaad.jsx:260`. Without this an archived channel looked like
          an ordinary one whose composer had mysteriously vanished. */}
      {archived && (
        <div className="sv__banner">
          <span className="ch__ic" aria-hidden="true">{SvIcons.lock}</span>
          This channel is archived. History stays readable and searchable; nobody can post.
        </div>
      )}

      {/* Below the banner and above the log, so an archived channel says why it
          is shut before it says what it kept. Renders nothing at zero pins. */}
      <PinnedBar
        pins={pins}
        open={pinsOpen}
        onToggle={togglePins}
        onJump={jumpTo}
        onUnpin={canPost ? unpin : undefined}
        canUnpin={canUnpin}
      />

      {error ? (
        <div className="sv__blank">
          <ErrorState kind={errorKind(error)} grant="access to this channel" />
        </div>
      ) : (
        <MessageLog
          messages={messages}
          loading={loading}
          meId={meId}
          meName={meName}
          lastReadAt={lastReadAt}
          // The mention vocabulary, from the channel's member list rather than
          // from whoever has already spoken. A colleague who has never posted
          // here could not be rendered as a mention under the old derivation,
          // even when the server had resolved and notified them.
          members={members}
          // A viewer gets no reaction tray and no thread reply — the whole
          // hover tray is gated on `can` in `ScreensSanvaad.jsx:153`, not just
          // the composer. Passing `undefined` is what removes the control.
          onReact={canPost ? react : undefined}
          onOpenThread={onOpenThread}
          onReply={canPost ? setReplyTo : undefined}
          onEdit={canPost ? editMsg : undefined}
          onDelete={canPost ? deleteMsg : undefined}
          onPin={canPost ? pin : undefined}
          onUnpin={canPost ? unpin : undefined}
          // The same predicate `PinnedBar` gets, not the raw admin flag: the
          // rule is "whoever pinned it, or a channel admin", and only the
          // predicate knows the first half. Handing down `meIsChannelAdmin`
          // alone would have hidden the ✕ from the person who pinned the
          // message unless they also ran the channel.
          canUnpin={canUnpin}
          onLoadOlder={loadOlder}
          hasOlder={more}
          loadingOlder={older}
          emptyBody={`Nothing has been said in ${name || 'this channel'} yet. Everyone in it will see what you write.`}
        />
      )}

      {/* The typing line, a sibling of the log rather than a row inside it —
          `06-sanvaad-varta.md` §2 puts `TypingRow` between `MessageLog` and
          `Composer`, and it belongs there: it is a statement about the composer
          below it, not an entry in the transcript above it, and threading it
          through the log would put it inside the scroll container where it
          would drift off screen.

          The live region is the OUTER element and is always mounted, empty.
          `23-accessibility.md` calls this out as "the single most common way
          this gets implemented wrong": a region that appears at the same moment
          as its content is not announced, because the announcement fires on a
          mutation of a region the screen reader was already watching. The
          wrapper carries no class, so it has no padding and no height until
          there is something to say.

          The dots are decoration for a sentence that already says the same
          thing, so they are hidden from the accessibility tree rather than
          announced as three empty elements. */}
      <div aria-live="polite" aria-atomic="true">
        {!error && typingText && (
          <div className="sv__typing">
            <span className="sv__dots" aria-hidden="true"><i /><i /><i /></span>
            {typingText}
          </div>
        )}
      </div>

      {canPost ? (
        <Composer
          emoji
          formatting
          onSend={submit}
          disabled={!!error}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          placeholder={threadOpen ? 'Write in the channel…' : 'Write a message…'}
          members={members}
          onTyping={onTyping}
          allowBroadcast={allowBroadcast}
        />
      ) : (
        <LockedComposer reason={archived ? 'archived' : 'viewer'} />
      )}

      {settings && (
        <ChannelDetails
          channel={channel}
          meId={meId}
          canPost={canPost}
          presence={presence}
          onClose={() => setSettings(false)}
          onChanged={onChannelChanged}
        />
      )}
    </div>
  );
}
