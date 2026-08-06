/**
 * ChatPane.jsx — header, log, composer for one channel. `.m2c`.
 *
 * §8 — HONESTY ABOUT REAL TIME. The header's sub-line reads "N members · updates
 * every few seconds" and there is no green live dot anywhere on this surface.
 * The reason is that the claim would be false: `/live` is a POLL on a four-second
 * interval, and it is a poll for a structural reason rather than an unfinished
 * one — Supabase's pooler runs transaction mode on :6543 where `LISTEN/NOTIFY`
 * does not work, and the service runs several gunicorn workers, so an in-process
 * broadcast would reach one worker's clients and nobody else's. A pulsing dot
 * that says "live" over a four-second poll is a promise the transport cannot
 * keep, and the person it misleads is the one deciding whether to phone instead.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { avatarBg, ErrorState, errorKind, useToast } from '../../components/ui';
import MessageLog from './MessageLog';
import Composer from './Composer';
import ChannelDetails from './ChannelDetails';
import LockedComposer from './LockedComposer';
import PinnedBar from './PinnedBar';
import ThreadPanel from './ThreadPanel';
import SahayakCard from '../../components/sanvaad/SahayakCard';
import { channelIcon, SvIcons } from './icons';
import { toneStyle } from './channelTone';
import useChannelMessages from './useChannelMessages';
import useMediaQuery from '../../hooks/useMediaQuery';
import { useExitAnimation } from '../../hooks/useExitAnimation';
import { ASK_LABEL } from './useSahayak';

/**
 * The phone band. ONE string, declared here and imported by `ChannelsTab`.
 *
 * `messaging.css:238-242` explains the prototype's side of it: `.m2--mob` is a
 * CLASS so a 390px phone frame gets phone layout inside a desktop viewport. On
 * the real surface the same rules hang off the 767px query — but the class is
 * still needed, because collapsing the grid to one column is only half the job.
 * With two columns stacked in one track the rail and the conversation are both
 * on screen, one above the other, and the reader scrolls past a whole channel
 * list to reach the message they tapped. One of the two has to not be rendered,
 * and that is a decision only JavaScript can take.
 *
 * TWO COMPONENTS NOW ASK THE SAME QUESTION and they must not be able to
 * disagree. `ChannelsTab` uses it to decide which grid column is rendered; this
 * file uses it to decide whether a thread opens inline or as `ThreadPanel`. A
 * second literal 767 would be a layout constant in two files — and a build in
 * which the shell has collapsed to one column while the log is still indenting
 * replies is precisely the state §2 says a phone has no room for.
 *
 * DECLARED IN THE LEAF, IMPORTED BY THE SHELL, and that direction is the whole
 * reason: `ChannelsTab` already imports `ChatPane`, so this is one more binding
 * on an edge that exists. The other direction would be an import cycle.
 */
export const PHONE = '(max-width: 767px)';

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
 * and is what these two numbers exist for.
 *
 * THE OLD JUSTIFICATION HERE WAS THAT THE REPLIES LIVED IN A PANEL THIS PANE
 * DID NOT OWN. That sentence is now false — the panel is rendered below, from
 * this file — and the constants survive it, because the wait was never really
 * about ownership. MEASURED: `list_messages` filters `parent_message_id IS
 * NULL` on both of its arms, so a reply is not in the log's page under any
 * presentation. Whichever one is on screen, the replies arrive by request:
 * `threadReplies.useThreadReplies` fires `GET /messages/:id/thread` when a row
 * expands and `ThreadPanel` fires the same call when it mounts. So the node a
 * deep link is aiming at is one round trip away on a DESKTOP as well as on a
 * phone, and no number of animation frames will produce it. `citeJump` below
 * re-implements this identical wait at a 2-second deadline for exactly that
 * reason.
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
  channel, me, meId, meName, access, onSent, onBack,
  onChannelChanged,
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
   * It is now an ID that reaches `MessageLog` and expands one row's inline
   * thread, rather than a root ROW handed to a panel. The panel needed the whole
   * row because it drew a header above the replies; an inline thread is already
   * under its own message and needs nothing but the match.
   *
   * Null for an ordinary mention, which is the whole of today's behaviour.
   */
  focusThreadId = null,
  /**
   * SAHAYAK, AND WHY THREE OF ITS FOUR PIECES ARE PROPS.
   *
   * `28-messaging-v2.md` §7 puts the assistant in three places on this surface:
   * a card in the log, a side panel, and a button in the composer. The panel is
   * the THIRD GRID TRACK (`.m2--rail.m2--aside` — `296px | 1fr | 336px`), and
   * the class that makes that track exist is on `.m2`, which is `ChannelsTab`'s
   * element and not this one's. So the shell owns the open flag and the request
   * hook, and this pane receives them: it renders the card at the divider, the
   * two triggers, and nothing else.
   *
   * `undefined` hides every one of them — the same rule the four message props
   * already follow. A caller with no panel gets no button for one.
   */
  sahayak = null,
  sahayakOpen = false,
  onToggleSahayak,
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
   *    so a reply is never in the log's own page and `getElementById` for one
   *    could only ever return null. A mention written inside a thread therefore
   *    dropped the reader at the bottom of the channel with nothing highlighted
   *    — while the mentions feed sat there quoting the reply's text at them,
   *    which proves something was said and then refuses to show where.
   *  · IT WAITS, THEN GIVES UP OUT LOUD. The old `if (!el) return` is the
   *    defect stated plainly: a dead link and a slow one produced the identical
   *    nothing. The replies are a round trip away — `GET /messages/:id/thread`
   *    fires when the row expands — so one animation frame is not a fair test.
   *    Neither is waiting forever, so the wait has a deadline and the deadline
   *    has a sentence.
   *  · IT RE-ARMS. `focused` was a boolean set once for the life of the pane,
   *    which is right for a remount (this component is keyed by channel id) and
   *    wrong for a second notification in the SAME channel: the ref was already
   *    true and the second click did nothing at all. The guard is now the
   *    target itself, so the same target twice is still one jump.
   *
   * `rootMissing` MEANS WHAT IT HAS ALWAYS MEANT: the root is not among the
   * fifty rows this pane is holding. Both presentations need it and neither can
   * recover from its absence — an inline thread hangs off a row, and a row that
   * is not in the log has nowhere to expand from; `ThreadPanel` dereferences
   * `root.id` to fetch its replies, so a panel opened without one would throw
   * rather than explain. What changed is only that the OPEN is a piece of state
   * (`openThreadId`) read by `MessageLog` and by the panel below, rather than a
   * call into a sibling, so this effect needs the id and not the row.
   *
   * `msg--new` is added to the node directly rather than through a prop. React
   * owns that className and will overwrite it on the row's next render, which is
   * at most one poll away — but the entrance animation is `--dur-base`, so it
   * has finished long before the poll it is racing.
   */
  const [openThreadId, setOpenThreadId] = useState(null);
  const focusedKey = useRef(null);
  /**
   * `messages` read through a ref, not a dependency. The retry loop below must
   * survive the poll: with `messages` in the dep array every four-second tick
   * would tear the effect down mid-wait, and the cleanup would cancel the timer
   * that was about to find the reply.
   */
  const msgsRef = useRef(messages);
  useEffect(() => { msgsRef.current = messages; }, [messages]);

  /* ── The same thread, two presentations ───────────────────────────────────
   *
   * `28-messaging-v2.md` §2, and the sentence it is explicit about: "**Do not
   * delete `ThreadPanel`.** It stays as the mobile presentation of the same
   * data — a phone has no room to indent — and it is what a deep link to a
   * reply still opens. What goes away is it being the *only* way to read a
   * reply."
   *
   * ONE PIECE OF STATE DRIVES BOTH. `openThreadId` is the thread the reader has
   * opened; the viewport decides what opening it looks like. Below `PHONE` the
   * inline body is withheld from `MessageLog` and the panel is rendered
   * instead; above it, the reverse. The DISCLOSURE — `.m2th__open`, the face
   * stack and the count — is untouched at every width, because `Message` gates
   * it on `thread_count > 0 && !small` and never on a breakpoint. So the entry
   * point is the same control on a phone as on a laptop; only what it reveals
   * differs.
   *
   * MEASURED, on why the indent is not simply left to shrink: `.m2th` is
   * `border-left: 2px` plus `padding-left: 12px` — 14px — and every `.m2th*`
   * rule sits OUTSIDE both the `.m2--mob` block and the 767px query in
   * `sanvaad.css`, exactly as it does in `messaging.css`. At 375px that leaves a
   * reply bubble about 299px wide after the log's padding, the row's padding,
   * the indent and the 26px avatar. It renders. §2's claim is that it should
   * not have to.
   *
   * THE PANEL IS RENDERED HERE AND NOT BY `ChannelsTab`, which owned it before.
   * The shell holds no thread state at all any more; putting the panel back
   * there would mean lifting `openThreadId` out of this file and pushing
   * `members`, `canPost` and the root ROW back down — the exact wiring §2
   * removed. The panel needs nothing this component does not already hold, and
   * `.m2c` is `position: relative` (sanvaad.css:2801, and again as the inline
   * style below), which is the positioned ancestor the overlay wants.
   *
   * NO NEW CSS, AND THAT IS MEASURED RATHER THAN ASSUMED. `@media (max-width:
   * 900px)` at sanvaad.css:2428 already declares `.sv__thread { position:
   * absolute; inset: 0; border-left: 0; z-index: 4 }` with an UNSCOPED selector,
   * and 767 ≤ 900, so the rule is in force at every width this branch can be
   * reached at. Probed in Chromium at 375x812 with this markup inside
   * `.m2--mob .m2c`: the panel resolves to 375x812 at (0,0) — the whole column —
   * on an opaque `--s-low`, and `elementFromPoint` at the centre of `.m2jump`
   * and at the centre of the channel composer returns the PANEL's children in
   * both cases. `.m2jump` shares the z-index 4 band and is a sibling earlier in
   * the tree, so document order settles it in the panel's favour. Nothing to add.
   *
   * (The same probe run WITHOUT `kartavaya-design.css` linked reported a
   * transparent panel and no ground under the replies — `--s-low` and
   * `--conv-ground` are declared there, not in `editorial.css`. An unresolved
   * `var()` drops the whole declaration silently, which is the one CSS failure
   * that looks exactly like no CSS at all. Recorded because it cost a probe.)
   */
  const phone = useMediaQuery(PHONE);

  /**
   * The root ROW, held across the exit.
   *
   * `ThreadPanel` draws the root above the replies and fetches by `root.id`, so
   * it needs the row and not the id. The row is looked up in the log because
   * that is the only place it can be — `list_messages` returns parents, so a
   * root is a log row unless it has scrolled past the fifty this pane holds,
   * which is the `rootMissing` case above and is refused rather than rendered.
   *
   * The ref is what lets the exit animation finish. `onClose` clears
   * `openThreadId` in the same frame, so `threadRoot` is null for the whole of
   * the closing render; without a held copy the panel would vanish instantly and
   * `svThreadOut` — a declared exit with its own keyframes — would never play.
   * It is written in an effect rather than during render so the closing render
   * still reads the PREVIOUS value.
   */
  const threadRoot = useMemo(
    () => (openThreadId == null
      ? null
      : messages.find(m => String(m.id) === String(openThreadId)) || null),
    [messages, openThreadId]
  );
  const lastThreadRoot = useRef(null);
  useEffect(() => { if (threadRoot) lastThreadRoot.current = threadRoot; }, [threadRoot]);
  /* `useExitAnimation` rather than a `closing` boolean written by hand: it
     already owns the three pieces this needs and gets each of them right — the
     `closingRef` that stops the ENTRANCE's `animationend` being read as the
     exit, the `e.target !== e.currentTarget` filter that stops a skeleton or a
     reply's own animation inside the panel from unmounting it, and a 600ms
     ceiling for the case where the event cannot arrive at all. */
  const threadExit = useExitAnimation(phone && !!threadRoot);
  const panelRoot = threadRoot || lastThreadRoot.current;

  /**
   * A CITE IS A CONTROL. `sahayak.css`, first paragraph: "Every claim carries a
   * <cite>, and the cite is a control — it opens the record. That is what
   * separates this from a chatbot."
   *
   * So a citation in a Sahayak card lands the reader on the message somebody
   * actually typed. It is the deep-link path above, minus the deep link: the
   * cite already carries its root (`parent_message_id`, put on it by
   * `build_transcript` on the server), so a cited REPLY expands its thread
   * first and then waits for the fetch that thread costs.
   *
   * The wait is short — 2 seconds against the deep link's 6 — because there is
   * no navigation in front of it: the log is already on screen and the only
   * thing outstanding is `GET /messages/:id/thread`. And it gives up out loud
   * for the same reason the deep link does: a dead cite and a slow one must not
   * produce the identical nothing.
   */
  const citeJump = useCallback((cite) => {
    const id = cite?.message_id;
    if (!id) return;
    const root = cite.parent_message_id;
    if (root) {
      const inLog = msgsRef.current.some(m => String(m.id) === String(root));
      if (!inLog) {
        pushToast({
          type: 'info',
          title: 'That message is in a thread further back — load earlier messages, then open it.',
        });
        return;
      }
      setOpenThreadId(String(root));
    }
    const deadline = Date.now() + 2000;
    const attempt = () => {
      const el = document.getElementById(`m-${id}`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('msg--new');
        setTimeout(() => el.classList.remove('msg--new'), 1000);
        return;
      }
      if (Date.now() < deadline) { setTimeout(attempt, FOCUS_POLL_MS); return; }
      pushToast({
        type: 'info',
        title: 'That message is further back — load earlier messages to reach it.',
      });
    };
    setTimeout(attempt, 0);
  }, [pushToast]);

  /* The points of a catch-up answer, and only of a catch-up answer. Empty for
     every other question and for an answer whose every claim failed the
     server's citation check — in which case the log shows nothing at all,
     because a card at the unread divider saying "I have nothing" is a worse
     answer than the divider on its own. The panel is where an empty result is
     explained; see `SahayakAside`'s three sentences. */
  const catchUpPoints = (sahayak?.asked === 'catch_up' && Array.isArray(sahayak?.answer?.points))
    ? sahayak.answer.points
    : [];

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
      if (root) setOpenThreadId(String(focusThreadId));
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
    // render that `setOpenThreadId` above just scheduled, and
    // `requestAnimationFrame` can run before React has committed it.
    timer = setTimeout(attempt, 0);
    return () => { clearTimeout(timer); clearFlash?.(); };
  }, [focusMessageId, focusThreadId, loading, pushToast]);

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
      /**
       * OPEN THE THREAD THE REPLY WENT INTO, then disarm the reply bar.
       *
       * This line used to read `onOpenThread?.(replyTo)`. `onOpenThread` was a
       * prop back when `ChannelsTab` owned `ThreadPanel` and the pane had to
       * call up to open it; §2 moved the open into this file as `openThreadId`
       * and the call site was never re-pointed. It was an UNDECLARED binding,
       * and optional chaining does not guard one — `onOpenThread?.(x)` throws
       * `ReferenceError` exactly as `onOpenThread(x)` would, because the guard
       * is on the VALUE being nullish, not on the name existing. The throw
       * landed inside this `try`, so every threaded reply POSTed successfully
       * and then showed "Failed to send" over a retained draft and a still-armed
       * reply bar, with `onSent` never firing. The obvious next action — press
       * Enter again — double-posted.
       *
       * `replyTo` is the thread ROOT, not the reply just written: `onReply(msg)`
       * is handed the row the tray is on (Message.jsx:851) or the row the inline
       * disclosure hangs off (Message.jsx:729), and nested replies are rendered
       * WITHOUT `onReply` (Message.jsx:738-777), so a reply can never become the
       * target. `openThreadId` is compared as a string everywhere else in this
       * file, so it is stringified here too.
       */
      if (replyTo) { setOpenThreadId(String(replyTo.id)); setReplyTo(null); }
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
  const dm = channel.type === 'dm';

  /**
   * §8 — WHAT THE SUB-LINE IS ALLOWED TO CLAIM.
   *
   * `messaging.css`'s own words for a channel are "N members · updates every few
   * seconds". Not "live", not a pulsing dot: the transport is a four-second poll
   * and the sentence says so in the plainest way that is still short enough to
   * sit under a title. A DM has no member count worth printing — there are two
   * of you — so it carries the description instead, and falls back to the same
   * honest sentence when there is none.
   */
  const sub = dm
    ? (channel.description || 'Direct message · updates every few seconds')
    : `${memberCount || 0} member${memberCount === 1 ? '' : 's'} · updates every few seconds`;

  /**
   * The face stack. Four, then `+n`.
   *
   * `GET /channels/:id/members` is already fetched by this pane's hook, so the
   * stack costs no request. It is hidden on a DM — a stack of two faces beside
   * the name of one of them is noise — and hidden while `members` is empty,
   * which is both "still loading" and "the request failed": a stack that draws
   * `+undefined` is worse than a header with nothing in that slot.
   *
   * The whole group is one `title`, not one per face. It duplicates the member
   * count that the button beside it already announces, so the faces are
   * decoration and are kept out of the accessibility tree rather than read out
   * as four unlabelled elements.
   */
  const faces = (!dm && members.length) ? members.slice(0, 4) : [];
  const facesExtra = Math.max(0, (memberCount || members.length) - faces.length);

  return (
    /* `position: relative` inline, exactly as `Msg2Chat.jsx:219` writes it.
       `.m2jump` is `position: absolute; bottom: 84px` and has to measure from
       THIS column rather than from the scroll box it floats over — a pill
       positioned inside `.m2log` would scroll away with the messages, which is
       the one thing a jump-to-latest control must not do. `messaging.css` gives
       `.m2c` no `position`, so the prototype puts it here and so does this. */
    <div className="m2__col m2c" style={{ position: 'relative' }}>
      {/* The same tone the rail's row carries, on the header's glyph tile.
          A channel that is blue in the list and grey once opened is a colour
          scheme that stops being a navigation aid at the exact moment it is
          being used to confirm you opened the right room. `toneStyle` returns
          `undefined` for a DM, so a direct message's header is untouched. */}
      <header className="m2c__hd" style={toneStyle(channel)}>
        {onBack && (
          <button type="button" className="svbtn" onClick={onBack} aria-label="Back to channels">
            {SvIcons.back}
          </button>
        )}
        <span className="m2c__ic" aria-hidden="true">{channelIcon(channel.type)}</span>
        <div className="m2c__id">
          <h2 className="m2c__n">
            {name}
            {archived && <span className="m2m__tag">archived</span>}
          </h2>
          <p className="m2c__sub">{sub}</p>
        </div>
        {faces.length > 0 && (
          <span className="m2c__faces" aria-hidden="true" title={`${memberCount} members`}>
            {faces.map(m => (
              <i key={m.user_id} style={{ background: avatarBg(m.full_name) }}>
                {String(m.full_name || '?').trim().charAt(0).toUpperCase()}
              </i>
            ))}
            {facesExtra > 0 && <i className="more">+{facesExtra}</i>}
          </span>
        )}
        <span className="m2c__acts">
          {/* "Catch me up" — `Msg2Chat.jsx:246`, the prototype's own header
              control, and the trigger for entry point ONE. The card it produces
              renders at the unread divider, not here; this only asks.

              GATED ON THERE BEING A DIVIDER TO PUT IT ON. `lastReadAt` is
              captured once when the pane mounts, so a reader who has read the
              channel has none — and a summary of what you missed, in a channel
              where you missed nothing, is a card that has to invent a subject.
              The prototype's is open on first paint because a prototype has no
              wallet; this one is pressed, because asking spends a credit. */}
          {sahayak && lastReadAt && (
            <button
              type="button"
              className="m2cp__ai"
              onClick={() => sahayak.ask('catch_up', lastReadAt)}
              disabled={sahayak.busy}
              aria-label="Ask Sahayak what you missed in this conversation"
            >
              {SvIcons.spark}
              {sahayak.busy && sahayak.asked === 'catch_up' ? 'Reading…' : 'Catch me up'}
            </button>
          )}
          {/* Entry point TWO's toggle. `.on` is `.svbtn`'s pressed state and
              `aria-pressed` is the half a screen reader can hear. */}
          {onToggleSahayak && (
            <button
              type="button"
              className={`svbtn${sahayakOpen ? ' on' : ''}`}
              /* Called with no argument, deliberately: `onToggleSahayak(next)`
                 takes an OPTIONAL boolean and flips when it is absent, and
                 handing it the click event instead would make every press read
                 as "open". */
              onClick={() => onToggleSahayak()}
              aria-pressed={sahayakOpen}
              aria-label="Sahayak panel"
            >
              {SvIcons.spark}
            </button>
          )}
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
          an ordinary one whose composer had mysteriously vanished.
          `--warn`, because the composer below is about to be a different shape
          and the reader needs to know why before they reach for it. */}
      {archived && (
        <div className="m2c__banner m2c__banner--warn">
          <span className="ch__ic" aria-hidden="true">{SvIcons.lock}</span>
          <span>
            <b>This channel is archived.</b> History stays readable and searchable; nobody can post.
          </span>
        </div>
      )}

      {/* `.m2c__banner--mute` — the quieter of the two, because nothing about
          the composer changes. It exists to close a specific gap: the rail
          suppresses a muted channel's unread COUNT but never its mention badge,
          and a reader who has just walked into a muted room needs to know which
          of the two rules is in force before they conclude nobody has been
          talking. `channel.muted` is the caller's own membership flag, patched
          by `PUT /channels/:id/mute` and refreshed by `/live`. */}
      {channel.muted && !archived && (
        <div className="m2c__banner m2c__banner--mute">
          <span className="ch__ic" aria-hidden="true">{SvIcons.bellOff}</span>
          <span>Muted. You still get mentions — nobody mutes their own name.</span>
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
          /* Which row's inline thread is expanded, and the setter that moves it.
             ONE at a time, and the state is here rather than inside each row
             for that reason: two threads open at once turns the log into a tree
             and the reader loses the through-line of the conversation. It is
             also what a deep link writes into — see the focus effect.

             WITHHELD ON A PHONE, and only withheld: `InlineThread` renders its
             `.m2th__body` on `open` alone, so passing null keeps the disclosure
             row — the faces, the count, "last at 20m ago" — and suppresses the
             indented replies under it. The same tap therefore opens the same
             thread on both surfaces; below 767px what it opens is `ThreadPanel`
             at the foot of this file. Passing `openThreadId` here as well would
             put the replies on screen twice, and the second copy would stamp a
             duplicate `id="m-<replyId>"` that the deep link's
             `getElementById` would then resolve to whichever came first. */
          openThreadId={phone ? null : openThreadId}
          onToggleThread={id => setOpenThreadId(cur => (cur === id ? null : id))}
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
          /* §7, entry point one — the catch-up card, at the divider.
             `MessageLog` decides WHERE the divider fell and renders this node
             under it; this file decides WHAT is in it. Only the catch-up answer
             belongs in the log: "what was decided" and "what is still open" are
             questions about the whole conversation and are answered in the
             panel, where the reader asked them. */
          unreadSlot={sahayak && sahayak.asked === 'catch_up' && !sahayak.busy
            && !sahayak.error && catchUpPoints.length > 0 ? (
              <SahayakCard
                inline
                title={`Caught up — ${sahayak.answer.message_count} message${
                  sahayak.answer.message_count === 1 ? '' : 's'} since you last read`}
                points={catchUpPoints}
                dropped={Number(sahayak.answer.dropped) || 0}
                foot={Number(sahayak.answer.credits) > 0
                  ? `${sahayak.answer.credits} credit${sahayak.answer.credits === 1 ? '' : 's'}`
                  : undefined}
                onCite={citeJump}
                onClose={sahayak.clear}
              />
            ) : null}
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
          <div className="m2typing">
            <span className="m2dots" aria-hidden="true"><i /><i /><i /></span>
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
          /* The placeholder no longer changes with a thread panel, because there
             is no panel to be open. A reply target still changes it, and that
             half lives in `Composer` where the reply bar is. */
          placeholder={`Message ${channel.type === 'dm' ? name : `#${name}`}…`}
          members={members}
          onTyping={onTyping}
          allowBroadcast={allowBroadcast}
          /* §7, entry point three. `Messaging v2.html:107` — the composer's
             `.m2cp__ai` opens the panel; it does not write a draft. */
          onAsk={onToggleSahayak ? () => onToggleSahayak(true) : undefined}
        />
      ) : (
        <LockedComposer reason={archived ? 'archived' : 'viewer'} />
      )}

      {/* The mobile presentation of the thread the reader just opened, and the
          target a deep link to a reply lands on.

          LAST CHILD OF `.m2c`, deliberately. It is `position: absolute; inset:
          0` against this column, so it covers the log, the typing line and the
          composer — everything the reader is not reading while they are in a
          thread — and leaves the rail alone, which on a phone is not rendered
          anyway. Ordering it after `.m2jump` is what puts it over the pill;
          both sit in the same z-index band.

          `panelRoot` rather than `threadRoot`, so the row survives the exit.
          Guarded on it being present at all: a root outside this pane's fifty
          rows is the `rootMissing` case, and `ThreadPanel` dereferences
          `root.id` on mount — a panel with no root would throw instead of
          explaining, which is the failure the focus effect's third sentence
          exists to prevent. */}
      {threadExit.alive && panelRoot && (
        <ThreadPanel
          channelId={channel.id}
          root={panelRoot}
          me={me}
          meId={meId}
          meName={meName}
          /* The channel's member list, already fetched by this pane's hook —
             the panel's mention vocabulary, for the replies and for its own
             composer. Fetching it a second time inside the panel would be a
             round trip for something two lines up. */
          members={members}
          canPost={canPost}
          /* The same two reasons the locked composer above distinguishes, so a
             thread in an archived channel does not tell the reader their
             permissions are the problem. */
          lockReason={archived ? 'archived' : 'viewer'}
          closing={threadExit.closing}
          onAnimationEnd={threadExit.onAnimationEnd}
          onClose={() => setOpenThreadId(null)}
        />
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
