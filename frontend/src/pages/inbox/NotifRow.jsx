import React from 'react';
import { relTime } from '../../lib/utils';
import { kindOf } from './notifKinds';

/**
 * NotifRow — one notification. Shared by the Inbox and, when `layout/` adopts
 * it, by the bell panel: `21-notifications-inbox.md` specifies "same NotifRow,
 * same hook, no second fetch" for the Inbox page, so the row vocabulary is
 * `.k-notif__*` rather than anything page-local.
 *
 * Unread is an inset left bar, not a background tint. A tinted row plus a hover
 * tint gives four visual states for two booleans, and the two middle ones are
 * indistinguishable — which is the state staging shipped
 * (`.k-inboxrow.is-unread` tints, `.k-inboxrow:hover` also changes, and a read
 * row under the pointer looks like an unread row at rest).
 *
 * The row is a real `<button>`. It was one before and that was right — it takes
 * Enter and Space, lands in the tab order, and gets `:focus-visible` from
 * `components.css` for free.
 */
export default function NotifRow({ notif, onOpen }) {
  const kind = kindOf(notif);
  const unread = !notif.read_at;

  return (
    <button
      type="button"
      className="k-notif__row"
      data-unread={unread ? 'true' : 'false'}
      // `--k` is the kind colour, set per instance. One class covers all eight
      // rather than a modifier per kind, and the value stays a token reference
      // so it flips with the theme.
      style={{ '--k': kind.color }}
      onClick={() => onOpen?.(notif)}
    >
      <span className="k-notif__dot" aria-hidden="true" />

      <span className="k-notif__body">
        <span className="k-notif__head">
          <span className="k-notif__kind">
            {/* The English label carries the truncation, not its container.
                `.k-notif__head` aligns on the baseline, and an inline-flex box
                with `overflow: hidden` reports its BOTTOM MARGIN EDGE as its
                baseline instead of its first line's — so putting the ellipsis
                on `.k-notif__kind` lifted the whole label a few pixels clear of
                the timestamp it is supposed to sit level with. */}
            <span className="k-notif__kind-en">{kind.en}</span>
            <span className="k-notif__kind-hi" lang="hi">{kind.hi}</span>
          </span>
          {/* The bar and the dot are colour; a screen reader gets the word. */}
          {unread && <span className="k-sr-only">Unread</span>}
          <time className="k-notif__ago" dateTime={notif.created_at || undefined}>
            {relTime(notif.created_at)}
          </time>
        </span>

        <span className="k-notif__t">{notif.title}</span>
        {notif.message && <span className="k-notif__m">{notif.message}</span>}
      </span>
    </button>
  );
}
