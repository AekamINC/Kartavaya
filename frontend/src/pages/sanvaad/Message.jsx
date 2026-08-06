/**
 * Message.jsx — one message as a BUBBLE: `.m2m`, its reaction chips, its hover
 * tray, and its thread expanded in place.
 *
 * WHAT CHANGED, AND WHY IT IS NOT A RESTYLE. The row used to be a flat record in
 * a list — avatar, name, time, body — and is now a turn in a conversation. Three
 * consequences worth stating because each one is a rule somebody will otherwise
 * "fix":
 *
 *  · `.m2m__b` IS THE BUBBLE, and it is not the old `.msg__b`. The build's
 *    `.msg__b` was the TEXT BODY and maps to `.m2m__t`; the whole content column
 *    is what becomes the bubble now. Mapping those two by name is the one
 *    mistake this rename invites.
 *  · SIDE IS THE SENDER CUE. `.m2m--mine` flips the grid to `1fr | 36px` and
 *    swaps the asymmetric corner, and `messaging.css:149-151` says why that
 *    matters more than it looks: the corner is the ONLY cue that survives when
 *    grouping hides the avatar. The name is never printed on your own messages —
 *    you know who you are.
 *  · THE THREAD IS INSIDE THE BUBBLE. `.m2th` is a left-ruled block under the
 *    body, and expanding it renders the replies here rather than in a panel
 *    three columns away. See `InlineThread`.
 *
 * TWO ROW TYPES KEEP THEIR OLD CLASSES ON PURPOSE. A tombstone (`.msg--gone`)
 * and a module event (`.msg--sys`) have no counterpart anywhere in
 * `messaging.css` — the prototype has no design for either — so they keep the
 * markup and the rules they already have rather than being given invented `.m2`
 * names. They are the two rows that are NOT somebody speaking, which is also why
 * neither is a bubble.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, ConfirmDialog, Menu, SkeletonChat, ErrorState, errorKind } from '../../components/ui';
import InlineThread from '../../components/sanvaad/InlineThread';
import RecordCard from '../../components/sanvaad/RecordCard';
import { formatTime } from '../../lib/timeFormat';
import { moduleMeta } from '../../lib/moduleColors';
import { relTime } from '../../lib/utils';
import { groupReactions, isContinuation, parseRich, safeHref } from './messageUtils';
import { recordFromMetadata, useThreadReplies } from './threadReplies';
import { SvIcons } from './icons';
import EmojiPicker, { QUICK, rememberEmoji } from './EmojiPicker';
import { Secondary } from '../../components/Bilingual';

/**
 * The five quick reactions. `06-sanvaad-varta.md` §Plus: "The five quick
 * reactions (👍 ✅ 👀 ❤️ 😂) are content, not chrome — those stay."
 *
 * RE-EXPORTED, not declared. The list moved to `EmojiPicker.jsx` when the full
 * picker arrived, because this file now renders that component and a `QUICK`
 * owned here would make the two modules a cycle — which does not fail loudly, it
 * hands one of them a half-initialised namespace. The name stays reachable from
 * here because that is where it has always been imported from.
 */
export { QUICK };

/* ── The body renderer ─────────────────────────────────────────────────────
 *
 * `messageUtils.parseRich` did the parsing and handed back plain data; this
 * turns that data into elements, and the split is the security boundary rather
 * than a tidiness preference. Every leaf below is a JavaScript string placed as
 * a React child, which React escapes on insertion, and a reviewer can confirm
 * the whole defence by checking that this file contains no
 * `dangerouslySetInnerHTML` and no `innerHTML` — which it does not, and must
 * not gain. A channel message is a string one colleague typed that renders in
 * every other colleague's browser; an injected `<img onerror>` here would run
 * for the whole channel rather than for its author.
 *
 * Keys are a token's position in its parent, never its text. Two identical
 * `@Keval Shah` mentions in one message would otherwise share a key, and React
 * would reuse the wrong node the moment the message is edited.
 */

/* A search-term highlighter used to run through here, marking the query inside
 * every text leaf. It was reachable from nowhere — no caller ever passed a term
 * — and `SearchPanel` marks its own snippets, so it was deleted rather than
 * wired. The reasoning is in the report; the short version is that the two jobs
 * are not one job. A result row shows a WINDOW of the body centred on the first
 * hit and marks several tokens in it; this renders a whole message and would
 * have had to mark one term in it. Sharing a highlighter between them would
 * mean one of the two doing the other's job badly. `.msg__hl` is still the
 * class both would have used, and `SearchPanel` still uses it. */
function renderInline(nodes, kp) {
  return nodes.map((n, i) => {
    const k = `${kp}.${i}`;
    if (typeof n === 'string') return <React.Fragment key={k}>{n}</React.Fragment>;
    switch (n.k) {
      // Verbatim. A code span is the one leaf the parser promises nothing else
      // touches, and this renderer keeps that promise.
      case 'code': return <code key={k}>{n.text}</code>;
      case 'b': return <strong key={k}>{renderInline(n.kids, k)}</strong>;
      case 'i': return <em key={k}>{renderInline(n.kids, k)}</em>;
      case 's': return <s key={k}>{renderInline(n.kids, k)}</s>;
      // `href` has already been through `safeHref`'s allowlist — an `a` token
      // does not exist for anything but `http://` and `https://`. `nofollow`
      // sits beside `noopener noreferrer` because this is a link a colleague
      // pasted into a chat box, not one the product is vouching for.
      case 'a': return (
        <a
          key={k}
          className="msg__lnk"
          href={n.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          {n.text}
        </a>
      );
      /* `.men` / `.men--me` — `messaging.css:162-164` scopes both to
         `.m2m__t`, and `.m2m--mine .m2m__t .men` re-tints them because the
         accent container the mention is drawn in IS the own-message bubble's
         background. `.msg__mn` had no such variant and a mention inside your own
         bubble was invisible. */
      case 'mn': return (
        <span key={k} className={`men${n.me ? ' men--me' : ''}`}>{n.mention}</span>
      );
      default: return null;
    }
  });
}

/**
 * `content` → React nodes. Exported because the parse and the render have to
 * stay one pair: a second renderer over the same tokens is how the inserter and
 * the parser drifted apart in `__tests__/renderMentions.test.jsx`.
 */
export function renderRich(text, { names = [], meName = null } = {}) {
  return parseRich(text, { names, meName }).map((b, i) => {
    const k = `b${i}`;
    switch (b.k) {
      case 'pre': return <pre key={k} className="msg__pre"><code>{b.text}</code></pre>;
      case 'quote': return <blockquote key={k}>{renderInline(b.kids, k)}</blockquote>;
      case 'ul': return (
        <ul key={k}>
          {b.items.map((it, j) => <li key={j}>{renderInline(it, `${k}.${j}`)}</li>)}
        </ul>
      );
      case 'ol': return (
        <ol key={k} start={b.start}>
          {b.items.map((it, j) => <li key={j}>{renderInline(it, `${k}.${j}`)}</li>)}
        </ol>
      );
      // A plain run gets NO wrapper element, so a message with no formatting in
      // it produces exactly the DOM this row produced before rich text existed:
      // `.msg__b`'s `white-space: pre-wrap` is still what lays out its newlines,
      // and only the four block kinds above introduce a box of their own.
      default: return <React.Fragment key={k}>{renderInline(b.kids, k)}</React.Fragment>;
    }
  });
}

/** Body text with `@name` lifted out and the formatting subset applied. */
function Body({ text, names, meName }) {
  return renderRich(text, { names, meName });
}

/**
 * The tombstone. `MESSAGING-ATTENDANCE-SPEC.md:24` — "`is_edited` / `is_deleted`
 * → need an 'edited' marker and a tombstone state" — and `ScreensSanvaad.jsx:118`
 * is the shape: a single full-width row, italic, naming who deleted it and when.
 * The build rendered a bare "Message deleted" inside the normal body, so a
 * deleted message still cost an avatar, a name and a timestamp column.
 *
 * Who sees it, precisely — this is not what it first looks like. `delete_message`
 * is a soft delete (`is_deleted=TRUE`) and `list_messages` filters
 * `is_deleted = FALSE`, so the row never comes back from the server again. The
 * poll cannot therefore remove it either: `mergeById` is a UNION, so a local
 * row the incoming page omits is kept, not dropped. The tombstone is
 * consequently visible to the deleter for the rest of the session and to nobody
 * else, and it disappears on the next channel switch.
 *
 * `ScreensSanvaad.jsx` places a deleted row among ordinary messages, so the
 * design intends a tombstone EVERY member sees. Reaching that needs
 * `list_messages` to return deleted rows with the content stripped instead of
 * filtering them out — a change to what every existing client receives, which
 * is recorded in the report rather than made here.
 */
function Tomb({ msg, who, domId }) {
  return (
    <article className="msg msg--gone" id={domId}>
      <span className="msg__tomb">
        {SvIcons.trash}
        Message deleted by {who} · <time dateTime={msg.created_at}>{formatTime(msg.created_at)}</time>
      </span>
    </article>
  );
}

/**
 * A module event. `MESSAGING-ATTENDANCE-SPEC.md:20` is unusually direct about
 * this one: "`type='system'` already exists — module bot messages (task updates
 * from Kartavya, deals from Graha, invoices from Ganit) are a **message type**,
 * not a new mechanism. Render them with no avatar, a module glyph, and a muted
 * tonal background."
 *
 * `samvada_messages.type` has had `'system'` in its CHECK constraint since 058
 * and `list_messages` selects `m.*`, so the value has always arrived at the
 * client — which rendered it as an ordinary message with the sender's face and
 * name on it. A task update from Kartavya therefore looked like a human being
 * had typed it.
 *
 * The module id and the optional deep link come from `metadata`, the JSONB
 * column 058 provides and nothing writes yet:
 *
 *   { "module": "ganit", "action_label": "Open in Ganit", "action_href": "/ganit/…" }
 *
 * Everything is optional and the row degrades to a plain system note without it,
 * because the first producer of these rows does not exist yet and this must not
 * be the thing that breaks when it appears.
 */
/**
 * `metadata.action_href` → a link, or nothing. PRE-EMPTIVE: nothing writes
 * `samvada_messages.metadata` today and `MessageCreate` has no field for it, so
 * this is not reachable and not exploitable right now. It is written now because
 * the moment the first module posts a system message — which is the entire point
 * of the row type — it becomes an author-controlled URL, and the author is
 * whatever code path assembled that JSONB rather than a person anyone reviewed.
 *
 * What it was before: `<Link to={meta.action_href}>` with no check at all, while
 * every other author-controlled URL on this surface — the bare links
 * `parseRich` lifts out of a message body — goes through `safeHref`.
 * `react-router` v7 does NOT close that gap for you. `Link` tests `to` against
 * `/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i`, and for `javascript:alert(1)` that matches,
 * `new URL()` parses, the origin is `"null"` so it is classed EXTERNAL, and the
 * component renders a plain `<a href="javascript:alert(1)">` with its own click
 * handler removed. Verified against `react-router@7.15.0`'s `parseToInfo`.
 *
 * Two arms, because `safeHref` alone would be wrong here in the opposite
 * direction. It is an allowlist of `http://` and `https://` only — written for a
 * URL somebody pasted into a chat box — and the shape this field documents is
 * `"/ganit/…"`, an IN-APP route, which it rejects. Running only the allowlist
 * would therefore not harden the feature, it would delete it silently on the day
 * its first producer shipped.
 *
 *   · A rooted app path is returned as-is, and the character after the slash is
 *     the whole check: `//evil.tld` is scheme-relative and `/\evil.tld` reaches
 *     the same place, because the URL spec folds `\` to `/` for special schemes.
 *     Both leave the origin, so both are refused.
 *   · Anything else falls to `safeHref`, which admits `http(s)` and returns null
 *     for `javascript:`, `data:`, `vbscript:` and `java\tscript:` alike — it
 *     strips control characters before testing the scheme rather than blocking a
 *     list of known-bad ones.
 *
 * Control characters are stripped on BOTH paths, so the app-path arm cannot be
 * walked past with an embedded tab or newline either.
 */
function actionHref(raw) {
  const u = String(raw == null ? '' : raw).trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (/^\/(?![/\\])/.test(u)) return { href: u, external: false };
  const ext = safeHref(u);
  return ext ? { href: ext, external: true } : null;
}

function SystemMsg({ msg, domId }) {
  const meta = (msg.metadata && typeof msg.metadata === 'object') ? msg.metadata : {};
  const mod = moduleMeta(meta.module);
  const when = formatTime(msg.created_at);
  // `typeof … === 'string'`, not truthiness. `metadata` is JSONB and nothing
  // validates its shape on the way in, so `action_label` can be an object or an
  // array — and React throws on an object child, which would take down the whole
  // message log rather than this one row. Same class of problem as the href.
  const action = typeof meta.action_label === 'string' && meta.action_label
    ? actionHref(meta.action_href)
    : null;

  return (
    <article className="msg msg--sys" id={domId}>
      <span
        className="msg__glyph"
        aria-hidden="true"
        style={mod ? { '--glyph': mod.color } : undefined}
      >
        {SvIcons.bolt}
      </span>
      <div className="msg__c">
        <div className="msg__hd">
          <span className="msg__who">
            {mod ? <>{mod.en} <Secondary className="sv__hi" value={mod.hi} /></> : 'System'}
          </span>
          <span className="msg__systag">system</span>
          <time className="msg__when" dateTime={msg.created_at}>{when}</time>
        </div>
        <div className="msg__sysb">
          {msg.content}
          {/* No link at all when `actionHref` refused the URL — deliberately
              silent rather than rendering a dead control or the raw string.
              An `action_href` this component will not follow is a producer bug,
              and the message's own text is what the reader came for. */}
          {action && (action.external ? (
            /* An absolute `http(s)` target leaves the product, so it is an
               anchor and not a `Link`: react-router would render one anyway
               (its own absolute-URL branch), but without `noopener noreferrer
               nofollow` — which a system message the product did not author has
               exactly as much claim to as a link a colleague pasted, and
               `.msg__lnk` above already settles what that claim is. */
            <a
              className="msg__sysa"
              href={action.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {meta.action_label} →
            </a>
          ) : (
            <Link className="msg__sysa" to={action.href}>{meta.action_label} →</Link>
          ))}
        </div>
      </div>
    </article>
  );
}

/**
 * "Seen by Aanya, Rohan +1" — `ScreensSanvaad.jsx:150`, on your own messages
 * only. `seen_by` is the first four readers by `last_read_at` and `seen_count`
 * is the uncapped total, both new on `list_messages`; see the note there for
 * why the receipt is derived from `samvada_channel_members.last_read_at` rather
 * than from `samvada_read_receipts`, which the schema declares and no endpoint
 * has ever written a row to.
 *
 * First names only, because the design shows first names and because a receipt
 * is glanced at, not read.
 */
function Seen({ names: seen, total }) {
  const shown = seen.slice(0, 2).map(n => String(n).split(' ')[0]);
  const extra = Math.max(0, (Number(total) || seen.length) - shown.length);
  return (
    <div className="seen">
      <span className="ch__ic" aria-hidden="true">{SvIcons.eye}</span>
      Seen by {shown.join(', ')}{extra > 0 ? ` +${extra}` : ''}
    </div>
  );
}

export default function Message({
  msg, continuation = false, meId, meName, names, onReact, onReply,
  onEdit, onDelete,
  /**
   * The inline thread. `threadOpen` is owned by `ChatPane` so exactly one is
   * expanded at a time; `onToggleThread` takes the message ID.
   *
   * BOTH DEFAULT TO NOTHING, which is what a reply inside a thread gets — see
   * `small`. A row with no toggle renders the summary line as static text rather
   * than as a button that cannot do anything.
   */
  threadOpen = false, onToggleThread,
  /**
   * This row is itself a reply, rendered inside somebody else's thread.
   *
   * It suppresses the thread block and the hover tray, exactly as
   * `Msg2Chat.jsx:132` and `:151` do: a thread inside a thread is a tree drawn
   * as a list, and the tray's Reply would target a message that is already the
   * answer to something.
   */
  small = false,
  /**
   * Is this the LAST message of its run?
   *
   * `continuation` already answers "is this the first", which is what decides
   * the avatar and the name. It cannot answer this one: the first is a fact
   * about the message BEFORE, and the last is a fact about the message AFTER, so
   * the two have to be computed by whoever holds the list. `MessageLog` and
   * `ThreadPanel` both do it as `!isContinuation(next, this)`.
   *
   * Two things ride on it, both from proposal 09's anatomy table:
   *   · THE TAIL. "5px corner on the speaker's side; 16px elsewhere ...
   *     Suppressed mid-run so a burst reads as one utterance." A run of three
   *     therefore draws one tail, on the bottom bubble, pointing at its author.
   *   · THE TIMESTAMP. "Last bubble of a run — five timestamps for one thought
   *     is noise." A run is under five minutes by construction (`isContinuation`
   *     is the 5-minute rule), so one time for it is not an approximation worth
   *     apologising for; the per-message time is still on hover in the gutter of
   *     every continuation row.
   *
   * DEFAULTS TRUE, which is what a standalone message is — a run of one is both
   * its own first and its own last. So a caller that has not been taught about
   * this prop renders a tail and a timestamp on every row, which is exactly what
   * this component did before it existed.
   */
  runEnd = true,
  // Pinning. Gated by `undefined`, never by `disabled` — the four handlers above
  // already work that way and the call site reads `onPin={canPost ? pin : undefined}`.
  onPin, onUnpin,
  // Whether THIS reader may take a pin off. The server's rule is "the person who
  // pinned it, or a channel admin"; the caller knows both and this component
  // knows neither, so it is computed there and passed in rather than guessed here.
  canUnpin = false,
  // `ChatPane` scrolls a deep-linked or searched-for message into view with
  // `document.getElementById('m-' + id)`, so the row carries that id. It is a
  // prop rather than a constant because the SAME message can be on screen twice
  // — `ThreadPanel` renders the thread root above its replies while the log
  // still holds it — and two elements sharing an id is invalid markup that
  // silently sends `getElementById` to whichever came first.
  anchored = true,
}) {
  const cont = continuation;
  const navigate = useNavigate();
  const rx = groupReactions(msg.reactions, meId);
  /**
   * The replies, fetched only while this row's thread is expanded.
   *
   * The hook is called UNCONDITIONALLY and gated by its own `enabled`, because
   * it is a hook: `threadOpen` changes between renders and a conditional call
   * would reorder React's hook list. `enabled: false` is not a wasted request,
   * it is no request at all.
   */
  const record = recordFromMetadata(msg.metadata);
  const who = msg.sender_name || 'Unknown';
  const threads = Number(msg.thread_count) || 0;
  const when = formatTime(msg.created_at);
  const mine = meId != null && String(msg.sender_id) === String(meId);
  const thread = useThreadReplies(msg.id, {
    enabled: threadOpen && !small && threads > 0,
    count: threads,
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content || '');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const ta = useRef(null);
  /**
   * The `+` button's own DOM node while the full picker is open, else null.
   *
   * The ELEMENT rather than a boolean, because `EmojiPicker` places itself
   * against the trigger's `getBoundingClientRect()` and there is one trigger per
   * message on screen. `e.currentTarget` inside the handler is that node, so
   * this needs no ref and no ref callback — which matters here more than usual:
   * a ref declared at the top of a component that renders fifty times per log is
   * fifty refs, and only one of them is ever read.
   */
  const [picker, setPicker] = useState(null);

  // Opening the editor puts the caret at the END of the existing text, not at
  // the start — an edit is almost always an addition or a correction near the
  // end, and `autoFocus` alone selects nothing and lands at 0.
  useEffect(() => {
    if (!editing) return;
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const openEditor = () => { setDraft(msg.content || ''); setEditing(true); };

  const commit = async () => {
    const next = draft.trim();
    if (!next || busy) return;
    if (next === (msg.content || '').trim()) { setEditing(false); return; }
    setBusy(true);
    try {
      await onEdit(msg, next);
      setEditing(false);
    } catch {
      // Same reasoning as `remove`: this runs straight off an onClick/onKeyDown,
      // so a rejection escapes as an unhandled promise. The toast is raised
      // upstream and the editor deliberately stays open with the draft intact —
      // losing what someone just typed because the save failed is the worse of
      // the two outcomes.
    } finally {
      setBusy(false);
    }
  };

  // Swallowed, not rethrown. `ConfirmDialog` runs `await onConfirm(); onClose()`
  // in its own click handler, so a rejection here would both leave an unhandled
  // promise in the console and skip `onClose`. `ChatPane` has already shown the
  // server's reason in a toast; keeping the dialog open is the retry.
  const remove = async () => {
    setBusy(true);
    try {
      await onDelete(msg);
      setConfirming(false);
    } catch {
      /* toast raised upstream */
    } finally {
      setBusy(false);
    }
  };

  const pinned = !!msg.pinned_at;

  // Swallowed for the same reason `remove` swallows: `Menu` calls `onSelect()`
  // and then `close()` without awaiting, so a rejection escapes as an unhandled
  // promise. The optimistic flip and the toast both live in `useChannelMessages`.
  const togglePin = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await (pinned ? onUnpin : onPin)?.(msg);
    } catch {
      /* toast raised upstream */
    } finally {
      setBusy(false);
    }
  };

  // Unlike edit and delete, pinning is not the author's privilege — anyone who
  // can post can pin. Taking a pin OFF is narrower (the pinner or a channel
  // admin), and when this reader is neither, the row stays in the menu but
  // disabled: hiding it entirely would leave a pinned message with no visible
  // explanation of why it cannot be unpinned.
  const showPin = !msg.is_deleted && (pinned ? !!onUnpin : !!onPin);
  const menu = !msg.is_deleted ? [
    mine && onEdit && { id: 'edit', label: 'Edit message', icon: SvIcons.pencil, onSelect: openEditor },
    showPin && {
      id: 'pin',
      label: pinned ? 'Unpin message' : 'Pin message',
      // The struck-through pin, which is what it was drawn for: one row that
      // changes both its word and its mark between the two states reads as one
      // control, whereas the same glyph under two opposite labels reads as a
      // menu that did not update. `PinnedBar` uses `close` for its ✕ and that
      // is right there — a row in a list of pins is dismissed, not toggled.
      icon: pinned ? SvIcons.pinOff : SvIcons.pin,
      disabled: pinned && !canUnpin,
      onSelect: togglePin,
    },
    mine && onDelete && { id: 'del', label: 'Delete message', icon: SvIcons.trash, danger: true, onSelect: () => setConfirming(true) },
  ].filter(Boolean) : [];

  // `m-<id>` is what `ChatPane` hands `getElementById` after a deep link from a
  // mention notification or a jump from search. An optimistic row's id is a
  // local `tmp:` string, which is a perfectly valid id attribute and simply
  // never gets looked up.
  const domId = anchored && msg.id != null ? `m-${msg.id}` : undefined;

  if (msg.is_deleted) return <Tomb msg={msg} who={who} domId={domId} />;
  // Before the tray, the reactions and the avatar are read: none of them apply
  // to a module event, and a system row has no author to act on.
  if (msg.type === 'system') return <SystemMsg msg={msg} domId={domId} />;

  /**
   * Is the sender's NAME on this row?
   *
   * Two conditions, and the second is `messaging.css:149-151`'s: never on your
   * own messages, because you know who you are and the bubble's side already
   * says so. The first is the run rule — the name belongs to the first bubble of
   * a burst, and `.m2m--run .m2m__hd { display: none }` is the stylesheet's own
   * half of it.
   */
  const named = !cont && !mine;

  /**
   * `.m2m--run` is the class the build called `.msg--cont`, and it is doing more
   * work than a rename: it hides the header AND squares off the asymmetric
   * corner (`border-top-left-radius: var(--r-md)`), so a burst of three draws
   * ONE tail, on the first bubble, pointing at its author.
   *
   * `__pending` is the optimistic row, `__fresh` a message that arrived while
   * the reader was watching; both are motion-only flags set in `messageUtils`
   * and neither is ever sent to or read from the server. `msg--pinned`,
   * `msg--sending`, `msg--new` and `msg--editing` keep their build names — they
   * are build states with no counterpart in `messaging.css`, and inventing an
   * `.m2` name for a rule that does not exist there is the one thing a class
   * with no rule guarantees.
   */
  const cls = `m2m${cont ? ' m2m--run' : ''}`
    + (mine ? ' m2m--mine' : '')
    + (runEnd ? '' : ' msg--mid')
    + (named ? ' msg--named' : '')
    // An edit box is a form, not a bubble, and it gives the column back its full
    // width for as long as it is open — see `.msg--editing` in sanvaad.css.
    + (editing ? ' msg--editing' : '')
    + (msg.__pending ? ' msg--sending' : '')
    + (msg.__fresh ? ' msg--new' : '')
    + (pinned ? ' msg--pinned' : '');

  return (
    <article className={cls} id={domId}>
      {/* THE AVATAR IS ALWAYS RENDERED and `.m2m--run` hides it with
          `visibility: hidden` rather than `display: none`, so a run keeps its
          indent and nothing shifts. That is a change from `.msg__gut`, which
          swapped the avatar for a hover-only timestamp in the same 32px box: the
          gutter existed because a flat log had nowhere else to put a
          continuation's time, and a bubble does — `.m2m__at` is in the header of
          the row that owns it. One element in one place beats two elements
          sharing a slot.

          36px, not 32. `.m2m__av` is `36px` with `align-self: flex-end`, so the
          face sits level with the BOTTOM of the bubble it belongs to — beside
          the last line somebody wrote rather than above the first. */}
      <Avatar className="m2m__av" name={who} src={msg.sender_avatar} size={36} />

      <div className="m2m__b">
        {/* The header normally belongs to the first message of a run, but a pin
            has to be visible wherever the pinned message happens to sit — so a
            pinned continuation row grows a header holding the chip alone rather
            than also regaining a name it does not need. Pinning must not re-flow
            the log.

            THE TIME IS BACK IN THE HEADER and no longer under the bubble. In a
            flat log the timestamp hung below because there was no header on a
            continuation; in a bubble the header IS the line that identifies the
            turn, and `.m2m__hd` is `align-items: baseline` so the name and the
            time sit on one line. `.m2m--mine .m2m__hd` right-aligns it, which is
            what keeps a run of your own messages reading down the right edge. */}
        {(named || pinned || (runEnd && !editing)) && (
          <div className="m2m__hd">
            {named && <span className="m2m__who">{who}</span>}
            {/* `lib/timeFormat.js`, not a second date helper — 06 §5: message
                timestamps must honour the 12h/24h preference. Suppressed while
                editing: an edit box is not a bubble and a time hanging off it
                reads as part of the form. */}
            {runEnd && !editing && (
              <time className="m2m__at" dateTime={msg.created_at}>{when}</time>
            )}
            {pinned && (
              <span className="msg__pin">
                {SvIcons.pin}
                {msg.pinned_by_name ? `Pinned by ${msg.pinned_by_name}` : 'Pinned'}
              </span>
            )}
          </div>
        )}

        {editing ? (
          <div className="msg__edit">
            <textarea
              ref={ta}
              className="cmp__ta msg__edit-ta"
              rows={2}
              aria-label="Edit message"
              value={draft}
              disabled={busy}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
                if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
              }}
            />
            <div className="msg__edit-row">
              <button type="button" className="btn btn--fill btn--sm" onClick={commit} disabled={busy || !draft.trim()}>
                Save
              </button>
              <button type="button" className="btn btn--out btn--sm" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </button>
              <span className="msg__edit-hint">Enter to save · Escape to cancel</span>
            </div>
          </div>
        ) : (
          <>
            <p className="m2m__t">
              <Body text={msg.content} names={names} meName={meName} />
              {/* `.m2m__tag`, appended to the BODY. It sat in the header beside
                  the timestamp, where a continuation row (which has no header)
                  could never show it — so an edited follow-up message was
                  silently indistinguishable from an unedited one. */}
              {msg.is_edited && <span className="m2m__tag">edited</span>}
            </p>
            {/* §4 — the firm's own objects, INSIDE the bubble rather than
                attached beside it: a record somebody shared is part of what they
                said, not an attachment next to it.

                `recordFromMetadata` returns null unless `metadata.record` is
                both present and well-formed, and `RecordCard` refuses an
                unrecognised `kind` on its own — so nothing is drawn today,
                because nothing writes `samvada_messages.metadata` yet.

                `onOpen` and not an `href`: `RecordCard` is a `<button>` only
                when it carries no actions of its own, because a `<button>`
                inside a `<button>` is invalid markup whose inner control is
                unreachable by keyboard in Firefox. A callback works in both
                shapes; an anchor would not. */}
            {record && (
              <RecordCard
                {...record}
                onOpen={record.href ? () => navigate(record.href) : undefined}
              />
            )}
          </>
        )}

        {rx.length > 0 && (
          <div className="m2rx">
            {rx.map(r => (
              <button
                key={r.emoji}
                type="button"
                className={`m2rx__b${r.mine ? ' mine' : ''}`}
                onClick={() => onReact(msg, r.emoji)}
                // `.mine` alone is a colour difference, so the state is also in
                // the accessible name — 23-accessibility.md.
                aria-pressed={r.mine}
                aria-label={`${r.emoji}, ${r.count} ${r.count === 1 ? 'reaction' : 'reactions'}${r.mine ? ', including yours' : ''}`}
              >
                <span aria-hidden="true">{r.emoji}</span>
                <span className="m2rx__n">{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* ── The thread, in place ────────────────────────────────────────────
            §2, and the whole reason this file changed shape.

            `components/sanvaad/InlineThread` is the DISCLOSURE — the face stack,
            the count, the chevron, the `.m2th__body` frame and the "Reply in
            this thread" control. It fetches nothing and renders no reply: the
            replies are its `children`, drawn by this same component, so a reply
            and its parent cannot drift apart in markup or in mention handling.
            The fetch is `useThreadReplies`, on this side of the line because an
            endpoint is not a presentational concern.

            `repliers` IS `thread_faces`, which `list_messages` returns only when
            `include_reply_counts=1` is passed — and `useChannelMessages` passes
            it on both list arms, so the stack is live. It stays guarded on the
            array rather than on the flag: an older cached response, or a caller
            that has not been taught about the parameter, gets a summary line
            with no faces instead of a row of blank circles standing in for
            people nobody named.

            Suppressed on `small`, which is a row already inside somebody else's
            thread: `get_thread` returns ONE level and drawing a second would be
            a tree rendered as a list. */}
        {threads > 0 && !small && (
          <InlineThread
            count={threads}
            /* "· last at 20m ago". Without `last_reply_at` the line said how many
                replies exist but never whether the thread was alive. */
            lastReplyAt={msg.last_reply_at ? relTime(msg.last_reply_at) : undefined}
            repliers={Array.isArray(msg.thread_faces) ? msg.thread_faces : []}
            open={threadOpen}
            onToggle={onToggleThread ? () => onToggleThread(msg.id) : undefined}
            /* The CHANNEL composer's reply target, not a second box. One composer
               per conversation is the reason `.m2cp__reply` exists as a bar above
               the textarea; a thread with a box of its own would mean two drafts
               and two `@` popups. `Composer` posts `parent_message_id`, and the
               count this row watches is what brings the answer back. */
            onReply={onReply ? () => onReply(msg) : undefined}
          >
            {thread.loading && <SkeletonChat rows={2} />}
            {!thread.loading && thread.error && (
              <ErrorState kind={errorKind(thread.error)} onRetry={() => thread.reload()} />
            )}
            {!thread.loading && !thread.error && thread.replies.length === 0 && (
              <p className="sv__none">No replies yet. Be the first.</p>
            )}
            {!thread.loading && !thread.error && thread.replies.map((r, i) => (
              <Message
                key={r.id}
                msg={r}
                continuation={isContinuation(r, thread.replies[i - 1])}
                /* The last reply of its run — the one that keeps the bubble's
                   tail and its timestamp. There is no date separator and no
                   unread rule inside a thread, so unlike `MessageLog` nothing
                   else can cut a run here and the expression is the bare
                   question. */
                runEnd={!isContinuation(thread.replies[i + 1], r)}
                /* ANCHORED. The previous note here said "the same message can
                   be on screen twice" and withheld the id on that basis — but
                   it cannot. `list_messages` filters `AND m.parent_message_id
                   IS NULL` (messaging.py:1665, 1678), so a reply is never a log
                   row, and `ChatPane` holds ONE `openThreadId`, so at most one
                   thread body is mounted. The collision the prop guarded
                   against has no way to occur.
                   Withholding it broke the deep link this inline thread exists
                   to serve: `samvaad_mentions` links `?message=<replyId>
                   &thread=<rootId>`, `ChatPane` opened the thread correctly and
                   then polled `getElementById('m-'+replyId)` for six seconds
                   against a reply that had no id — falling through to "That
                   reply is no longer in the thread. It may have been deleted."
                   while the reply sat expanded and visible on screen. */
                small
                meId={meId}
                meName={meName}
                names={names}
                onReact={onReact}
                onEdit={onEdit && (async (m, content) => {
                  const row = await onEdit(m, content);
                  thread.patchEdit(m.id, content, row);
                  return row;
                })}
                onDelete={onDelete && (async (m) => {
                  await onDelete(m);
                  thread.patchDelete(m.id);
                })}
              />
            ))}
          </InlineThread>
        )}

        {mine && Array.isArray(msg.seen_by) && msg.seen_by.length > 0 && (
          <Seen names={msg.seen_by} total={msg.seen_count} />
        )}

        {/* `IxChat.jsx:138` — the caption under an unacknowledged row. The
            `opacity: .6` on `.msg--sending` is the state; this is the word for
            it, because opacity alone is not a signal a screen reader can read
            and `--motion-scale: 0` must not be able to remove it. */}
        {msg.__pending && <div className="msg__sending" role="status">Sending…</div>}
      </div>

      {/* THE HOVER TRAY. `.m2tray` is `display: none` until `.m2m:hover` or
          `:focus-within`, and it floats ABOVE the bubble's top edge
          (`top: -13px`) rather than beside the row — on `.m2m--mine` it swaps to
          the left, because on that side the bubble's right edge is where the
          content is.

          No tray on a row the server has not acknowledged: its id is a local
          `tmp:` string, so a reaction, a thread reply, an edit or a delete would
          all address a message that does not exist yet. No tray on `small`
          either — a reply already inside a thread has no thread to be replied
          into, and `Msg2Chat.jsx:151` guards the same thing.

          `.m2--mob .m2tray { display: none !important }` is the phone half and
          it is the stylesheet's, not this file's: there is no hover on a touch
          surface, so the controls must not be the only way to reach an action.
          Everything in this tray is also in the overflow menu or in the
          reactions row, which is what makes that safe. */}
      {!editing && !small && !msg.__pending && (onReact || menu.length > 0) && (
        <div className="m2tray">
          {/* `.msg__actb` on all four, INCLUDING the Menu trigger, and that is
              the reason for it rather than `.m2tray button`. `ui/Menu` renders
              its trigger as a `<span role="button">`, so a rule keyed on the
              element would style three of the four controls and leave the fourth
              a bare glyph at a different size. One class, four identical
              buttons. */}
          {onReact && QUICK.map(e => (
            <button
              key={e}
              type="button"
              className="msg__actb"
              // `rememberEmoji` here as well as inside the picker, or the
              // "frequently used" row would only ever learn about glyphs chosen
              // the slow way — and the five in this tray are most of what anyone
              // ever sends.
              onClick={() => { rememberEmoji(e); onReact(msg, e); }}
              aria-label={`React ${e}`}
            >
              <span aria-hidden="true">{e}</span>
            </button>
          ))}
          {/* The door to the rest of them. Proposal 09 §4 puts a full picker
              behind `+` and keeps the five in front of it; the owner's words
              were "give full emoji options", and five faces is not that.
              `e.currentTarget` is stored rather than a boolean because the panel
              places itself against this button's rectangle — see `picker`. */}
          {onReact && (
            <button
              type="button"
              className="msg__actb"
              onClick={e => { const el = e.currentTarget; setPicker(p => (p ? null : el)); }}
              aria-label="Add a reaction"
              aria-expanded={!!picker}
              aria-haspopup="dialog"
            >
              {SvIcons.smilePlus}
            </button>
          )}
          {onReply && (
            <button type="button" className="msg__actb" onClick={() => onReply(msg)} aria-label="Reply in thread">
              {SvIcons.reply}
            </button>
          )}
          {/* `ScreensSanvaad.jsx:157` ends the tray with a "More" button. It was
              the only one of the three not built, which is why edit and delete —
              both of which have had a live endpoint since migration 058 — had no
              way in at all. */}
          {menu.length > 0 && (
            <Menu
              align="right"
              label="Message actions"
              items={menu}
              trigger={<span className="msg__actb">{SvIcons.dots}</span>}
            />
          )}
        </div>
      )}

      {/* OUTSIDE `.m2tray`, deliberately, and inside `<article>` deliberately
          too.
            · Outside the tray, because the tray is `display: none` until the row
              is hovered — a panel rendered inside it would vanish the instant
              the pointer left the message to reach the panel, which is the first
              thing anybody does.
            · Inside the article, because `.m2tray:focus-within` is what keeps
              the tray painted, and the search box in the panel is inside this
              subtree. So opening the picker holds the tray open by itself and
              needs no second "is a menu open" flag.
          Being `position: fixed`, the panel escapes `.m2log`'s scroll box and
          `.m2mod`'s `overflow: hidden` — the same reason `.cmp__mn` is fixed. */}
      {picker && onReact && (
        <EmojiPicker
          anchor={picker}
          label="Add a reaction"
          onPick={(e) => { setPicker(null); onReact(msg, e); }}
          onClose={() => setPicker(null)}
        />
      )}

      {/* `ConfirmDialog` takes a `state` object and renders nothing when it is
          null — it is not an `open` boolean. */}
      <ConfirmDialog
        state={confirming ? {
          title: 'Delete this message?',
          message: 'It disappears for everyone in the channel. This cannot be undone.',
          confirmLabel: 'Delete',
          intent: 'danger',
          onConfirm: remove,
        } : null}
        onClose={() => setConfirming(false)}
      />
    </article>
  );
}
