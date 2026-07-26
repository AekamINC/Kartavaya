import React from 'react';
import { SkeletonCard, SkeletonRegion } from '../../components/ui';

/**
 * One skeleton for the whole Today body — 05-today-dashboard.md §5.
 *
 * The page ran two systems: `SkeletonCardGrid` for the stat row and a separate
 * `SkeletonRegion` for the two-column body. Two regions means two `aria-busy`
 * announcements for one load, and the stat grid was outside the live region
 * entirely, so a screen reader was told the page was loading only after the
 * first half of it had already been described.
 *
 * §5 asks for one `<Skeleton preset="today">`. The preset itself belongs in
 * `ui/Skeleton.jsx`, which this change does not own, so it lives here as a
 * composition of the existing primitives — same result, one region, and shaped
 * like what actually loads (26 §9: a skeleton whose shape does not match the
 * content produces a visible jump, which is worse than a spinner).
 */
export default function TodaySkeleton() {
  return (
    <SkeletonRegion label="Loading your day…">
      <div className="k-stats">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
      </div>
      <div className="k-twocol k-today__skelbody">
        <div className="k-col k-col--main">
          <SkeletonCard lines={5} />
          <SkeletonCard lines={4} />
        </div>
        <div className="k-col k-col--side">
          <SkeletonCard lines={3} showAvatar />
          <SkeletonCard lines={3} showAvatar />
          <SkeletonCard lines={2} />
        </div>
      </div>
    </SkeletonRegion>
  );
}
