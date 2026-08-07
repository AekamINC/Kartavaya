import React from 'react';
import { View, StyleSheet } from 'react-native';

import { useWindowClass } from '../hooks/useWindowClass';
import { gridColumns } from '../lib/windowClass';
import { devicePlatform } from '../nav/platform';

/**
 * The card flow — 31-tablet.md §3.
 *
 * "A single column of cards across 700dp is a phone layout that happens to be
 * wide — the most common way a tablet build looks unfinished. Where a pane is
 * not split, cards flow TWO abreast above 640dp of content and THREE above
 * 1040, while headers, filters, segmented controls and section rules keep
 * spanning the full width."
 *
 * ── WHY A WRAPPER AND NOT `numColumns` ──────────────────────────────────────
 *
 * `FlatList` has `numColumns`, and it would be the obvious tool. Three reasons
 * it is not used here:
 *
 *   · `SectionList` — which Today and the board list are built on — does not
 *     support it at all.
 *   · Changing `numColumns` on a mounted FlatList throws unless `key` changes
 *     too, so a rotation between one and two columns would either crash or
 *     remount the list and lose its scroll position. §6: "It is a resize, not a
 *     remount."
 *   · It flows EVERY item, including the ones §3 says must keep spanning the
 *     full width.
 *
 * So this wraps the cards a caller chooses to flow, and leaves everything else
 * alone. It is the "grid-column: 1 / -1" half of `.tpane--grid` expressed as
 * "don't put those inside".
 *
 * The column count itself is `gridColumns()` in `lib/windowClass.ts`, unit
 * tested against the device table — this component only distributes.
 */

export interface CardListProps {
  children: React.ReactNode;
  /**
   * Content width to measure against. Defaults to the window's content region,
   * which is right for a full-width pane and WRONG inside a split one — a list
   * pane is 280–400dp and would otherwise be told it has room for three.
   */
  width?: number;
  /**
   * Horizontal padding to subtract from the MEASURED content region, for a
   * caller that sits inside a padded frame and so is narrower than the window.
   * Ignored when `width` is passed — that caller has already measured itself,
   * and subtracting again would double-count.
   */
  inset?: number;
  /** Gap between cards, both axes. */
  gap?: number;
}

export default function CardList({ children, width, inset = 0, gap = 10 }: CardListProps) {
  const { content, columns: windowColumns } = useWindowClass(devicePlatform());

  // A caller inside a pane passes its own width; everyone else measures the
  // content region. `gridColumns` is not re-derived here — one definition of
  // the thresholds, in the file that is tested for them.
  //
  // The inset branch is the exception, and it has to re-derive: `useWindowClass`
  // hands back `columns` already computed from the full content region, and
  // there is no way to ask it "…but for 32dp less". Same thresholds, and a test
  // pins the two spellings together.
  const columns = width === undefined
    ? (inset === 0 ? windowColumns : gridColumns(content - inset))
    : width >= 1040 ? 3 : width >= 640 ? 2 : 1;

  const items = React.Children.toArray(children).filter(Boolean);

  // One column is the phone, and the phone is not a grid — returning the
  // children untouched keeps their own margins rather than imposing a gutter
  // nobody asked for.
  if (columns === 1) return <>{items}</>;

  return (
    <View style={[s.row, { marginHorizontal: -gap / 2 }]}>
      {items.map((child, i) => (
        <View
          key={i}
          style={{ width: `${100 / columns}%`, paddingHorizontal: gap / 2, paddingBottom: gap }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
});
