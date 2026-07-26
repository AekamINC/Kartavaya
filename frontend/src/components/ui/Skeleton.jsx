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

/**
 * Wrapper that exposes the aria-busy/role="status" contract in one place.
 * Wrap any of the above (or a group of them) with this when the skeleton
 * stands in for a live region of the page.
 */
export function SkeletonRegion({ label = 'Loading…', children, className = '', style }) {
  return (
    <div className={className} style={style} role="status" aria-busy="true" aria-live="polite">
      <span className="k-sr-only">{label}</span>
      {children}
    </div>
  );
}

export default {
  SkeletonText,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonCardGrid,
  SkeletonTable,
  SkeletonPage,
  SkeletonRegion,
};
