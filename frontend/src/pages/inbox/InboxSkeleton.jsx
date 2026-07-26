import React from 'react';

/**
 * InboxSkeleton — the loading state, in the shape of the thing that replaces it.
 *
 * The page used the generic `SkeletonList`, which draws a two-column table row:
 * one wide bar on the left, one narrow bar on the right, inside its own card at
 * `--r-lg`. The Inbox does not look like that. Its rows are a dot, an uppercase
 * kind label with a timestamp opposite, and one or two lines of text, inside a
 * card at `--r-md`. So the skeleton and the list it stood in for disagreed on
 * the corner radius, the row height and where every line sat, and the page
 * visibly re-laid itself the moment the fetch landed.
 *
 * A skeleton is a promise about what is coming. It is worth exactly as much as
 * that promise is accurate — `26 §7` puts it as the layout not moving when the
 * content arrives. This one reuses the row's own grid, so it cannot drift: the
 * dot column, the gap and the padding are `.k-notif__row`'s.
 *
 * Widths vary per row from the index rather than at random — a re-render must
 * not reshuffle the bars, and `Math.random()` in a render body does exactly
 * that.
 */
export default function InboxSkeleton({ rows = 6 }) {
  return (
    <div className="k-inboxpg__groups" aria-hidden="true">
      <section className="k-inboxpg__group">
        <div className="k-inboxpg__grouph k-inboxpg__grouph--skel">
          <span className="k-skeleton k-skeleton--text" style={{ width: 92, height: 15 }} />
        </div>
        <div className="k-inboxpg__list">
          {Array.from({ length: rows }).map((_, i) => (
            <div className="k-notif__row k-notif__row--skel" key={i}>
              {/* The row's own dot, painted in the skeleton's grey rather than
                  a kind colour. Reusing `.k-notif__dot` keeps the 8px circle
                  and its 5px optical offset identical to the real row; a
                  shimmer on an 8px circle reads as noise, so it does not get
                  `.k-skeleton`. */}
              <span className="k-notif__dot" style={{ '--k': 'var(--outline-variant)' }} />
              <span className="k-notif__body">
                <span className="k-notif__head">
                  <span
                    className="k-skeleton k-skeleton--text"
                    style={{ width: `${88 + ((i * 17) % 40)}px`, height: 9 }}
                  />
                  <span
                    className="k-skeleton k-skeleton--text k-notif__ago"
                    style={{ width: 44, height: 9 }}
                  />
                </span>
                <span
                  className="k-skeleton k-skeleton--text"
                  style={{ width: `${54 + ((i * 13) % 30)}%`, height: 12, marginTop: 5 }}
                />
                <span
                  className="k-skeleton k-skeleton--text"
                  style={{ width: `${38 + ((i * 11) % 26)}%`, height: 10, marginTop: 5 }}
                />
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
