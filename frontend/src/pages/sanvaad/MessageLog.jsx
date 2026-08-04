/**
 * MessageLog.jsx — date separators, the unread divider, consecutive grouping,
 * and the jump-to-latest pill.
 */
import React, { useMemo } from 'react';
import { EmptyState, SkeletonChat } from '../../components/ui';
import Message from './Message';
import { ChatArt, SvIcons } from './icons';
import { dayKey, dayLabel, isContinuation } from './messageUtils';
import useStickyScroll from './useStickyScroll';

/**
 * A shared empty array for the `members` default. A fresh `[]` in the parameter
 * list is a new identity on every render where the prop is omitted, which would
 * re-run the `names` memo below on every render and defeat the point of
 * memoising it. `ChatPane` is currently the only caller and always passes a
 * list, so this guards the next caller rather than a live path.
 */
const EMPTY = [];

/**
 * "Today · आज" — the Devanagari half needs `--font-indic`, so it is its own
 * node. One wrapper, because `.sv__sep` is a flex row whose `gap` separates the
 * two hairline rules: leaving the label as two loose flex items would put that
 * same 12px between the word and its own translation.
 */
export function DayLabel({ iso }) {
  const { en, hi } = dayLabel(iso);
  return (
    <span className="sv__sep-t">
      {en}{hi && <span className="sv__hi" lang="hi">{hi}</span>}
    </span>
  );
}

export default function MessageLog({
  // `emptyBody` and no `emptyTitle`. The pair was declared together and only
  // the body was ever passed: `ChatPane` names the channel in the sentence
  // ("Nothing has been said in #accounts yet"), which is the half that has to
  // change per channel. The heading above it is the same four words every time,
  // so the override was a knob with a default and nothing to turn it — and one
  // that reads as a title this component might be given.
  messages, loading, meId, meName, lastReadAt, onReact, onOpenThread, onReply, emptyBody,
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
  //
  // `splitMentions` dedupes and sorts longest-first itself, so overlap between
  // the two sources costs nothing and the order here is not load-bearing.
  const names = useMemo(
    () => [...new Set([
      ...members.map(m => m?.full_name),
      ...messages.map(m => m.sender_name),
    ].filter(Boolean))],
    [members, messages]
  );

  const readMs = lastReadAt ? new Date(lastReadAt).getTime() : 0;
  let dividerShown = false;

  return (
    <div className="sv__logwrap">
      <div className="sv__log" ref={logRef}>
        {loading && <SkeletonChat rows={5} />}

        {/* Scrollback. The control sits at the TOP of the log rather than
            firing on scroll: an infinite loader that prepends rows fights the
            near-bottom autoscroll in `useStickyScroll`, and a reader who has
            scrolled up to find something is already looking at this end. */}
        {!loading && messages.length > 0 && hasOlder && onLoadOlder && (
          <div className="sv__older">
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

        {!loading && messages.map((m, i) => {
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

          return (
            <React.Fragment key={m.id}>
              {newDay && <div className="sv__sep"><DayLabel iso={m.created_at} /></div>}
              {/* "New messages · नए संदेश" — `ScreensSanvaad.jsx`'s `mdiv--new`.
                  A bare "New" reads as a label on the message under it rather
                  than as a rule across the log. */}
              {unread && (
                <div className="sv__newline">
                  <span className="sv__sep-t">
                    New messages<span className="sv__hi" lang="hi">नए संदेश</span>
                  </span>
                </div>
              )}
              <Message
                msg={m}
                continuation={!newDay && !unread && isContinuation(m, prev)}
                meId={meId}
                meName={meName}
                names={names}
                onReact={onReact}
                onOpenThread={onOpenThread}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={onDelete}
                onPin={onPin}
                onUnpin={onUnpin}
                // The predicate applied to THIS row. Defaulting to `false` when
                // no predicate was given matches `Message`'s own default and
                // keeps the ✕ off a message nobody has claimed the right to
                // unpin, which is the safe direction: the server would answer
                // 403 anyway, and a control that 403s is worse than no control.
                canUnpin={typeof canUnpin === 'function' ? canUnpin(m) : false}
              />
            </React.Fragment>
          );
        })}

      </div>

      {/* 06 §1: "When they're not near the bottom, show the jump-to-latest pill
          instead of moving them." */}
      {!loading && !pinned && messages.length > 0 && (
        <button type="button" className="sv__jump" onClick={jump}>
          {SvIcons.down}
          Jump to latest
        </button>
      )}
    </div>
  );
}
