import React from 'react';
import { View, StyleSheet } from 'react-native';

/**
 * One row of a flowed `FlatList` — the render half of `lib/cardRows.ts`.
 *
 * `chunkRows` decides WHICH cards share a row; this decides how wide they are.
 * The two are separate because the first is arithmetic that can be unit tested
 * and the second is layout that cannot.
 *
 * ── THE SHORT LAST ROW ──────────────────────────────────────────────────────
 *
 * `chunkRows` leaves the last row short rather than padding it, so a lone card
 * in a three-column list would otherwise stretch to the full width and read as
 * a layout bug. `columns` is therefore passed in and each cell is sized against
 * THAT, not against the row's own length — the gap at the end is empty space,
 * which is what it should look like.
 */
export interface CardRowProps {
  children: React.ReactNode;
  /** How many cells wide the row is, INCLUDING the empty ones. */
  columns: number;
  /** Gap between cards, both axes. Matches CardList's default. */
  gap?: number;
}

export default function CardRow({ children, columns, gap = 10 }: CardRowProps) {
  const items = React.Children.toArray(children).filter(Boolean);

  // One column is the phone, and the phone is not a grid — returning the child
  // untouched keeps its own margins rather than imposing a gutter nobody asked
  // for, exactly as CardList does at one column.
  if (columns <= 1) return <>{items}</>;

  return (
    <View style={[s.row, { marginHorizontal: -gap / 2 }]}>
      {items.map((child, i) => (
        <View key={i} style={{ width: `${100 / columns}%`, paddingHorizontal: gap / 2 }}>
          {child}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch' },
});
