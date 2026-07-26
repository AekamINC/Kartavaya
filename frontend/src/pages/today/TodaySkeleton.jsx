import React from 'react';
import { SkeletonCard, SkeletonRegion, SkeletonText, StatTile } from '../../components/ui';

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
 *
 * TWO SHAPES DID NOT MATCH, and both moved the page on arrival.
 *
 * The stat row stood in with `SkeletonCard`, which is `--r-lg` and
 * `--sp-4 --sp-5` — where `.k-stat` is `--r-md` and `16px 17px` (05 §1). Wrong
 * radius, wrong padding, wrong height. It is now a real `StatTile` carrying
 * shimmer blocks instead of text: the tile geometry cannot drift from itself,
 * and it costs no new markup. Heights track the type in `.k-stat__lbl` /
 * `__val` / `__sub` so the swap is invisible.
 *
 * And there was no placeholder for the quick-actions row at all, so both
 * columns dropped by a full button row the moment the data landed.
 */

/**
 * Heights are the line boxes of the type they stand in for, not round numbers:
 * `.k-stat__val` is 31px at line-height 1.1, `.k-stat__hi` is 11px Devanagari
 * (the taller of the two halves of the label row, so it sets that row), and
 * `.k-stat__sub` is 11.5px. Widths are the four real strings measured at their
 * own tracking — `.k-stat__lbl` carries `.16em`, which is a sixth of its width
 * again and is why an eyeballed label block always came out short.
 */
const VAL_H = 34;
const TILES = [
  { id: 'open',  label: 70, sanskrit: 30, value: 24, sub:  94 }, // OPEN TASKS · खुला
  { id: 'due',   label: 63, sanskrit: 20, value: 20, sub:  77 }, // DUE TODAY · आज
  { id: 'late',  label: 49, sanskrit: 42, value: 20, sub:  66 }, // OVERDUE · विलंबित
  { id: 'done',  label: 98, sanskrit: 52, value: 28, sub: 116 }, // DONE THIS WEEK · इस सप्ताह
];

/** The four quick-action buttons: icon, English label, Devanagari label, and
 *  `.btn--sm`'s 6px/11px padding over a 1px border — 30px tall. */
const ACTIONS = [152, 166, 154, 126];

export default function TodaySkeleton() {
  return (
    <SkeletonRegion label="Loading your day…">
      <div className="k-stats">
        {TILES.map(t => (
          <StatTile
            key={t.id}
            variant="neutral"
            label={<SkeletonText width={t.label} height={12} />}
            sanskrit={<SkeletonText width={t.sanskrit} height={16} />}
            value={<SkeletonText width={t.value} height={VAL_H} />}
            sub={<SkeletonText width={t.sub} height={14} />}
          />
        ))}
      </div>

      <div className="k-today__skelacts">
        {ACTIONS.map(w => <SkeletonText key={w} width={w} height={30} />)}
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
