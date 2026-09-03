/**
 * Skeleton.jsx — reusable shimmer loading placeholders.
 * Dimensions are chosen to match the real content they stand in for
 * (see DashboardPage / TasksListPage usage) to avoid layout shift (CLS).
 *
 * Base classes come from editorial.css (`k-skeleton*`). Keep this file
 * as the single source of truth for skeleton markup/variants.
 */
import React from 'react';

/** Base shimmer block. Pass width/height/radius via style. */
function SkeletonBlock({ className = '', style, ...rest }) {
  return <span className={`k-skeleton ${className}`} style={style} {...rest} />;
}

/** Single line of text, configurable width/height. */
export function SkeletonText({ width = '100%', height = 14, style, className = '', ...rest }) {
  return (
    <SkeletonBlock
      className={`k-skeleton--text ${className}`}
      style={{ width, height, ...style }}
      {...rest}
    />
  );
}

/** Circular placeholder — avatars, avatar stacks, icon badges. */
export function SkeletonAvatar({ size = 32, style, className = '', ...rest }) {
  return (
    <SkeletonBlock
      className={`k-skeleton--avatar ${className}`}
      style={{ width: size, height: size, ...style }}
      {...rest}
    />
  );
}

/** Card placeholder — kanban cards, dashboard widgets, stat tiles. */
export function SkeletonCard({ lines = 3, showAvatar = false, className = '', style }) {
  return (
    <div className={`k-skeleton-card ${className}`} style={style} aria-hidden="true">
      <div className="k-skeleton-card__top">
        <SkeletonText width="40%" height={11} />
        {showAvatar && <SkeletonAvatar size={22} />}
      </div>
      <SkeletonText width="85%" height={16} style={{ marginTop: 10 }} />
      {Array.from({ length: Math.max(0, lines - 1) }).map((_, i) => (
        <SkeletonText
          key={i}
          width={i === lines - 2 ? '55%' : '75%'}
          height={12}
          style={{ marginTop: 8 }}
        />
      ))}
    </div>
  );
}

/** Grid of SkeletonCard — e.g. dashboard stat tiles / kanban column bodies. */
export function SkeletonCardGrid({ count = 4, columns = 4, lines = 2, style }) {
  return (
    <div
      className="k-skeleton-grid"
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, ...style }}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  );
}

/** Table rows placeholder — list views (Tasks, Contacts, Invoices, etc). */
export function SkeletonTable({ rows = 6, columns = 5, showAvatar = true, className = '', style }) {
  const colWidths = Array.from({ length: columns }).map((_, i) => {
    if (i === 0) return '32%';
    if (i === columns - 1) return '10%';
    return `${Math.floor(58 / Math.max(1, columns - 2))}%`;
  });
  return (
    <div className={`k-skeleton-table ${className}`} style={style} aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="k-skeleton-table__row">
          {colWidths.map((w, c) => (
            <div key={c} className="k-skeleton-table__cell" style={{ width: w }}>
              {c === 0 && showAvatar && <SkeletonAvatar size={20} />}
              <SkeletonText width={c === 0 ? '70%' : '60%'} height={12} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Full page skeleton — sidebar-aware (assumes it renders inside `.kv__content`,
 * i.e. sidebar/topbar are already rendered by the app shell). Provides a
 * page-header placeholder + stat row + two-column body so it can stand in
 * for most screens while data loads.
 */
export function SkeletonPage({ withStats = true, withTable = false, className = '', style }) {
  return (
    <div className={`k-screen ${className}`} style={style} aria-hidden="true">
      <div className="k-skeleton-pageh">
        <SkeletonText width={120} height={11} />
        <SkeletonText width="38%" height={30} style={{ marginTop: 10 }} />
        <SkeletonText width="52%" height={13} style={{ marginTop: 10 }} />
      </div>

      {withStats && (
        <div className="k-skeleton-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      )}

      {withTable ? (
        <SkeletonTable rows={8} columns={5} />
      ) : (
        <div className="k-twocol">
          <div className="k-col">
            <SkeletonCard lines={5} />
            <SkeletonCard lines={4} />
          </div>
          <div className="k-col">
            <SkeletonCard lines={3} showAvatar />
            <SkeletonCard lines={3} showAvatar />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Per-page presets — 02-common-components.md §5 ─────────────────────────
   "Skeletons are SHAPED LIKE THE CONTENT, not grey rectangles" (26 §9). A
   skeleton whose shape does not match what loads produces a visible jump on
   arrival, which is worse than a spinner: the spinner at least never lied about
   what was coming.

   Table and page presets already existed. These are the three that did not, and
   each mirrors a real layout rather than approximating one — a list row is an
   avatar plus two lines of unequal length, a board is columns of cards, and a
   chat alternates sides because a one-sided chat skeleton reads as an empty
   conversation. */

/** List rows — tasks, contacts, invoices, anything with an avatar and a title. */
export function SkeletonList({ rows = 6, showAvatar = true, className = '', style, label = 'Loading…' }) {
  // Announces itself unless an explicit `SkeletonRegion` already does — see
  // `Announced`. `if (loading) return <SkeletonList />` is the spelling most
  // call sites use, and before this it was silent to a screen reader while
  // looking perfectly busy to an eye (Suite 20.06).
  return (
    <Announced label={label}>
      <div className={`k-skeleton-table ${className}`} style={style} aria-hidden="true">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="k-skeleton-table__row">
            <div className="k-skeleton-table__cell" style={{ width: '100%' }}>
              {showAvatar && <SkeletonAvatar size={24} />}
              <SkeletonText width={`${52 + ((r * 13) % 26)}%`} height={13} />
            </div>
            <div className="k-skeleton-table__cell" style={{ width: '22%' }}>
              <SkeletonText width="70%" height={11} />
            </div>
          </div>
        ))}
      </div>
    </Announced>
  );
}

/** Kanban — columns, each with a header count and a few cards. */
export function SkeletonBoard({ columns = 4, cards = 3, className = '', style }) {
  return (
    <div
      className={`k-skeleton-grid ${className}`}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, ...style }}
      aria-hidden="true"
    >
      {Array.from({ length: columns }).map((_, c) => (
        <div key={c} className="k-col">
          <SkeletonText width="45%" height={11} />
          {Array.from({ length: cards }).map((_, i) => (
            <SkeletonCard key={i} lines={2} showAvatar />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Chat scrollback. Alternating sides, so it reads as a conversation. */
export function SkeletonChat({ rows = 5, className = '', style }) {
  return (
    <div className={`k-skeleton-chat ${className}`} style={style} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`k-skeleton-chat__r${i % 3 === 2 ? ' k-skeleton-chat__r--out' : ''}`}>
          {i % 3 !== 2 && <SkeletonAvatar size={26} />}
          <SkeletonText width={`${34 + ((i * 17) % 34)}%`} height={30} />
        </div>
      ))}
    </div>
  );
}

/**
 * True when something up the tree is already a `SkeletonRegion`.
 *
 * Without this, making the primitives announce themselves would DOUBLE-announce
 * on every screen that already wraps them properly — two nested `role="status"`
 * `aria-live` regions, so a screen reader says "Loading contacts" twice. The
 * screens that got it right must not be punished for the ones that did not.
 */
const InSkeletonRegion = React.createContext(false);

/**
 * Announce a skeleton, UNLESS an explicit `SkeletonRegion` already does.
 *
 * ── WHY THE PRIMITIVES ANNOUNCE THEMSELVES NOW ──────────────────────────────
 *
 * Suite 20.06, 2026-08-31: **7 of 10 sampled screens announced nothing at all**
 * while loading — `role=status 0, aria-busy 0`. `vetana#payslips` was the sharp
 * case: a skeleton IS drawn, so the screen looks busy to an eye and is silent to
 * a screen reader.
 *
 * The three that passed each remembered to write
 * `<SkeletonRegion label="…"><SkeletonList/></SkeletonRegion>` by hand. That is
 * the defect: the contract lived in a wrapper every call site had to remember,
 * and `if (loading) return <SkeletonList />` is the obvious, shorter, wrong
 * spelling. Fixing seven call sites would leave the eighth to be written next
 * month, so the primitive carries the contract and the wrapper stays available
 * for a bespoke label.
 */
export function Announced({ label, children }) {
  const inside = React.useContext(InSkeletonRegion);
  if (inside) return children;
  return <SkeletonRegion label={label}>{children}</SkeletonRegion>;
}

/**
 * Wrapper that exposes the aria-busy/role="status" contract in one place.
 * Wrap any of the above (or a group of them) with this when the skeleton
 * stands in for a live region of the page and deserves a specific label.
 */
export function SkeletonRegion({ label = 'Loading…', children, className = '', style }) {
  return (
    <InSkeletonRegion.Provider value>
      <div className={className} style={style} role="status" aria-busy="true" aria-live="polite">
        <span className="k-sr-only">{label}</span>
        {children}
      </div>
    </InSkeletonRegion.Provider>
  );
}

/**
 * The module-page shimmer: `count` tiles, announced.
 *
 * Hub, Manav and Vetana each declared this identically in their own
 * `_shared.jsx` until 2026-09-03, and each copy carried the same accessibility
 * note in a comment — which is the argument for it being here. Suite 20.06
 * (2026-08-31) found 7 of 10 sampled screens loading with `role=status 0,
 * aria-busy 0`, and `vetana#payslips` was the sharp one: a Shim IS drawn, so
 * the screen looks busy to an eye and is silent to a screen reader. A fix made
 * in one of three copies leaves the other two exactly as they were.
 *
 * `Announced` is a no-op when an explicit `SkeletonRegion` already wraps this,
 * so the screens that were written correctly do not start saying it twice.
 */
export function Shim({ count = 4, label = 'Loading…' }) {
  return (
    <Announced label={label}>
      <div className="k-shimmer" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => <div key={i} className="k-shimmer__tile" />)}
      </div>
    </Announced>
  );
}

export default {
  SkeletonText,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonCardGrid,
  SkeletonTable,
  SkeletonList,
  SkeletonBoard,
  SkeletonChat,
  SkeletonPage,
  SkeletonRegion,
};
