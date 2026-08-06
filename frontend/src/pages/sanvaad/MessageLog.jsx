/**
 * MessageLog.jsx — `.m2log`: date separators, the unread divider, consecutive
 * grouping, and the jump-to-latest pill.
 *
 * THE LOG IS NOT A TABLE, and this is the one surface in the product that should
 * not look like the rest of it. `.m2log` carries its own tinted canvas
 * (`--conv-ground`) and its own motif (`--conv-motif`), both per-user settings
 * beside accent and density, and every message sits in a bubble on it so the eye
 * reads TURNS rather than rows. `.sv__log` was a flat list on `--bg`.
 *
 * THE JUMP PILL IS A SIBLING OF THE SCROLL BOX, not a child of it. `.m2jump` is
 * `position: absolute; bottom: 84px` and measures from `.m2c`, which `ChatPane`
 * gives `position: relative` for exactly this. The old `.sv__logwrap` wrapper
 * existed to be that positioning context; with `.m2c` doing the job this
 * component returns a fragment, and the wrapper is gone rather than kept as an
 * unstyled div between the grid column and its flex children.
 */
import React, { useMemo } from 'react';
import { EmptyState, SkeletonChat } from '../../components/ui';
import Message from './Message';
import { ChatArt, SvIcons } from './icons';
import { dayKey, dayLabel, isContinuation } from './messageUtils';
import useStickyScroll from './useStickyScroll';
import { Secondary } from '../../components/Bilingual';

/**
 * A shared empty array for the `members` default. A fresh `[]` in the parameter
 * list is a new identity on every render where the prop is omitted, which would
 * re-run the `names` memo below on every render and defeat the point of
 * memoising it.
 */
const EMPTY = [];

/**
 * "Today · आज" — the Devanagari half needs `--font-indic`, so it is its own
 * node. One wrapper, because `.m2div__p` is a single pill: leaving the label as
 * two loose children would put the pill's own letter-spacing between the word
 * and its translation.
 */
export function DayLabel({ iso }) {
  const { en, hi } = dayLabel(iso);
  return (
    <>
      {en}{hi && <Secondary className="sv__hi" value={hi} />}
    </>
  );
}

export default function MessageLog({
  // `emptyBody` and no `emptyTitle`. The pair was declared together and only
  // the body was ever passed: `ChatPane` names the channel in the sentence
  // ("Nothing has been said in #accounts yet"), which is the half that has to
  // change per channel. The heading above it is the same four words every time.
  messages, loading, meId, meName, lastReadAt, onReact, onReply, emptyBody,
  onEdit, onDelete, onLoadOlder, hasOlder = false, loadingOlder = false,
  // The channel's member list, for the mention vocabulary below.
  members = EMPTY,
  // Pinning, forwarded straight through to `Message`. This layer holds no pin
  // logic of its own: `ChatPane` owns the handlers and the "may I unpin this"
  // rule, and `Message` owns the control. Passing `undefined` is what removes
  // the control, exactly as it does for `onReact` and `onReply`, so these are
  // forwarded unguarded rather than defaulted to a no-op.
  onPin, onUnpin,
  // A PREDICATE over a message row, not a boolean — the server's rule is "the
  // person who pinned it, or a channel admin", which is per-message because
  // `pinned_by` is. `Message` wants the answer, not the question, so it is
  // applied per row below.
  canUnpin,
  /**
   * The inline thread. `28-messaging-v2.md` §2.
   *
   * `openThreadId` is held by `ChatPane` rather than by each row, so exactly one
   * thread is expanded at a time — two open at once turns the log into a tree
   * and the reader loses the through-line of the conversation.
   *
   * There is deliberately no `channelId` and no `me` here, which the old
   * `ThreadPanel` needed and this does not: a reply is still POSTed by the
   * CHANNEL composer with `parent_message_id`, so the write path is unchanged
   * and `InlineThread` only ever reads.
   */
  openThreadId = null, onToggleThread,
  /**
   * `28-messaging-v2.md` §7, entry point one: "A catch-up card in the log, at
   * the unread divider — the point the reader left off is the only place a
   * summary of what they missed belongs."
   *
   * A NODE AND NOT A FLAG, because this component holds no assistant state and
   * must not learn any: `ChatPane` owns the request, the credit and the error,
   * and this file owns the one fact `ChatPane` cannot know — WHERE the divider
   * fell. `Msg2Chat.jsx:277-281` renders the card in exactly this position, as
   * a sibling of `.m2div--new` inside the same fragment.
   *
   * When there is no divider — everything is read, or the reader has never left
   * — nothing renders it, which is correct rather than a gap: a summary of what
   * you missed, in a channel where you missed nothing, is a card that has to
   * invent a subject.
   */
  unreadSlot = null,
}) {
  // A cheap signature, so a re-render that changes nothing about the messages
  // does not re-run the scroll decision.
  const sig = `${messages.length}:${messages[messages.length - 1]?.id || ''}`;
  const { logRef, pinned, jump } = useStickyScroll(sig);

  // The mention vocabulary: everyone in the channel, then everyone who has
  // spoken in the loaded page.
  //
  // The member list is the half that matters and the half that used to be
  // missing. Deriving this from senders alone meant a colleague who had never
  // posted here could not be rendered as a mention even though the server had
  // already resolved and notified them — the message said `@Priya` in plain
  // text while Priya's inbox said she had been mentioned.
  //
  // Senders stay in the union rather than being replaced by it, because the two
  // sets genuinely differ: somebody who has since left the channel is off the
  // member list but still owns the messages they wrote, and `members` is empty
  // until `list_members` lands and stays empty if it failed. Union degrades to
  // the old behaviour in that case instead of to nothing.
  const names = useMemo(
    () => [...new Set([
      ...members.map(m => m?.full_name),
      ...messages.map(m => m.sender_name),
    ].filter(Boolean))],
    [members, messages]
  );

  /* ── Where the log is cut, decided once for the whole list ────────────────
   *
   * This used to be four expressions inside the `map`, with `dividerShown`
   * mutated as the loop went. That was fine while every decision was about the
   * message BEFORE — `continuation` is — and stopped being fine the moment
   * bubbles arrived, because the tail and the timestamp are decisions about the
   * message AFTER. Asking "will the next row draw a divider?" from inside a loop
   * that sets the divider flag as it goes is a question whose answer depends on
   * where in the loop body you ask it, and getting that wrong produces one
   * missing tail somewhere in the middle of a channel: invisible in review,
   * invisible in a test that renders three messages, and wrong on screen.
   *
   * So the cuts are computed in one pass, up front, and both directions read the
   * same array. A row is grouped with the one above it only when NOTHING is
   * drawn between them — no date separator, no unread rule — which is the same
   * condition in both directions by construction rather than by agreement.
   *
   * `runEnd` is then simply "the row below me is not grouped with me", and the
   * last row in the list always ends its run.
   */
  const rows = useMemo(() => {
    const readMs = lastReadAt ? new Date(lastReadAt).getTime() : 0;
    let dividerShown = false;
    const out = messages.map((m, i) => {
      const prev = messages[i - 1];
      const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
      // The unread divider goes above the first message the reader has not
      // seen, and only above their own first unseen one — a message they sent
      // themselves is not unread.
      const unread = !dividerShown
        && readMs > 0
        && new Date(m.created_at).getTime() > readMs
        && String(m.sender_id) !== String(meId);
      if (unread) dividerShown = true;
      return {
        m,
        newDay,
        unread,
        cont: !newDay && !unread && isContinuation(m, prev),
        runEnd: true,
      };
    });
    // Second pass, because `cont` for row i+1 is not known while row i is being
    // built — `dividerShown` has to have reached it first.
    for (let i = 0; i < out.length - 1; i += 1) out[i].runEnd = !out[i + 1].cont;
    return out;
  }, [messages, lastReadAt, meId]);

  return (
    <>
      <div className="m2log" ref={logRef}>
        {loading && <SkeletonChat rows={5} />}

        {/* Scrollback. The control sits at the TOP of the log rather than
            firing on scroll: an infinite loader that prepends rows fights the
            near-bottom autoscroll in `useStickyScroll`, and a reader who has
            scrolled up to find something is already looking at this end. */}
        {!loading && messages.length > 0 && hasOlder && onLoadOlder && (
          <div className="m2older">
            <button type="button" className="btn btn--out btn--sm" onClick={onLoadOlder} disabled={loadingOlder}>
              {loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        )}

        {!loading && messages.length === 0 && (
          <EmptyState
            icon={ChatArt}
            title={{ en: 'No messages yet', hi: 'अभी कोई संदेश नहीं' }}
            description={emptyBody || 'Say something to start the conversation. Everyone in the channel will see it.'}
          />
        )}

        {!loading && rows.map(({ m, newDay, unread, cont, runEnd }) => (
          <React.Fragment key={m.id}>
            {/* A CENTRED PILL, not a rule with a label in it. `.sv__sep` drew
                two hairlines with the date between them, which is a table
                divider — the shape this surface is deliberately not. */}
            {newDay && <div className="m2div"><span className="m2div__p"><DayLabel iso={m.created_at} /></span></div>}
            {/* "New messages · नए संदेश" — the same pill in `--danger`. A bare
                "New" reads as a label on the message under it rather than as a
                rule across the log. */}
            {unread && (
              <>
                <div className="m2div m2div--new">
                  <span className="m2div__p">
                    New messages<Secondary className="sv__hi" value="नए संदेश" />
                  </span>
                </div>
                {unreadSlot}
              </>
            )}
            <Message
              msg={m}
              continuation={cont}
              runEnd={runEnd}
              meId={meId}
              meName={meName}
              names={names}
              members={members}
              onReact={onReact}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onPin={onPin}
              onUnpin={onUnpin}
              threadOpen={openThreadId != null && String(openThreadId) === String(m.id)}
              onToggleThread={onToggleThread}
              // The predicate applied to THIS row. Defaulting to `false` when
              // no predicate was given matches `Message`'s own default and
              // keeps the ✕ off a message nobody has claimed the right to
              // unpin, which is the safe direction: the server would answer
              // 403 anyway, and a control that 403s is worse than no control.
              canUnpin={typeof canUnpin === 'function' ? canUnpin(m) : false}
            />
          </React.Fragment>
        ))}
      </div>

      {/* 06 §1: "When they're not near the bottom, show the jump-to-latest pill
          instead of moving them." */}
      {!loading && !pinned && messages.length > 0 && (
        <button type="button" className="m2jump" onClick={jump}>
          {SvIcons.down}
          Jump to latest
        </button>
      )}
    </>
  );
}
