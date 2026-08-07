import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeProvider';
import { useWindowClass } from '../hooks/useWindowClass';
import type { Platform } from '../lib/windowClass';

/**
 * List and detail, side by side — 31-tablet.md §3.
 *
 * ── THE RULE IS CONTENT WIDTH, NOT THE WIDTH CLASS ──────────────────────────
 *
 * "List and detail sit side by side whenever the content region can hold both.
 * The floor is 660dp of content, not a width class — below it the detail would
 * be narrower than a phone, and above it there is no reason to do anything
 * else. That includes portrait: an iPad Pro held upright has 950dp of content,
 * which is more than most laptops give a mail client."
 *
 * `TabletScreens.jsx:132` records that tying these two together WAS the bug, so
 * `useWindowClass` computes them separately and this component reads `split`
 * rather than `cls`.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * It does not hold the selection, and it does not navigate.
 *
 * §6: "Selection lives above the layout, never inside a pane." The reason is
 * the resize story — drag an iPad app into Slide Over and the detail becomes the
 * full window with a back button, ON THE SAME RECORD; drag it back out and the
 * two panes return with that record still selected. Selection kept inside the
 * pane would be unmounted by the very transition it has to survive.
 *
 * So the calling screen owns "which task is open" and passes the rendered
 * detail down. Below the floor this renders ONLY the list, and the screen keeps
 * doing what it does on a phone: push the detail as a route.
 *
 * ── STACKING IS FOR A SUPPORTING PANE, AND FOR ONE SCREEN ────────────────────
 *
 * "Do not stack a detail under its own list. It was tried and it is wrong: a
 * task list above a task detail reads as two half-height windows rather than one
 * surface, and the divider moves every time the list length changes. Stacking is
 * for a SUPPORTING pane only — content that is not the detail of the row above
 * it — and Approvals is the one screen that has one."
 *
 * §9's file table implies stacking is general. It is not: `TabletScreens.jsx:274`
 * gates it on `screen === 'approvals'`. `supporting` exists so that gate is
 * expressed at the call site rather than guessed here.
 */

export interface PaneHostProps {
  platform: Platform;
  /** The leading pane. Always rendered. */
  list: React.ReactNode;
  /**
   * The trailing pane. Rendered only when there is room — a screen may pass a
   * detail it built eagerly and trust this not to show it below the floor.
   */
  detail?: React.ReactNode;
  /**
   * Stack the second pane BELOW the first instead of beside it, and cap the
   * leader's height. Approvals only — see the header.
   */
  supporting?: boolean;
  /** Height cap for the leader when stacked, as a percentage string. */
  leaderHeight?: `${number}%`;
}

export default function PaneHost({
  platform, list, detail, supporting = false, leaderHeight = '52%',
}: PaneHostProps) {
  const { t } = useTheme();
  const { split, listWidth, stacked } = useWindowClass(platform);

  // A supporting pane needs room BELOW, so it asks about height; a detail pane
  // needs room BESIDE, so it asks about width. Two panes, two questions.
  const stack = supporting && stacked;

  if (!split && !stack) return <View style={s.solo}>{list}</View>;

  if (stack) {
    return (
      <View style={s.column}>
        <View style={[s.leaderStacked, { maxHeight: leaderHeight, borderBottomColor: t.outlineVar }]}>
          {list}
        </View>
        <View style={[s.trailing, { backgroundColor: t.surface }]}>{detail}</View>
      </View>
    );
  }

  return (
    <View style={s.row}>
      <View style={[s.leader, { width: listWidth, borderRightColor: t.outlineVar, backgroundColor: t.bg }]}>
        {list}
      </View>
      <View style={[s.trailing, { backgroundColor: t.surface }]}>{detail}</View>
    </View>
  );
}

/**
 * The empty detail pane.
 *
 * §3: "The empty detail pane is designed, not defaulted. A grey *no item
 * selected* wastes the larger half of the screen. It carries the jaali ground at
 * 68px, the screen's own icon, and a line saying what the pane is for."
 *
 * There is no jaali motif in the mobile token layer — it is a CSS
 * `background-image` on the web and React Native has no equivalent without
 * shipping an asset — so this uses the low surface instead and keeps the other
 * two: the screen's own icon, and a sentence about what the pane does rather
 * than a statement of the obvious.
 *
 * AND ON TASKS IT NEVER APPEARS. "The pane opens the first task. A second pane
 * that arrives empty is 750pt of nothing on an 11-inch iPad in landscape.
 * Selecting a task has no side effect, so there is no reason to make the user do
 * it. Messages does not auto-open, and the difference is the whole rule: opening
 * a conversation marks it read, and a side effect the user did not ask for is
 * worse than a placeholder."
 */
export function EmptyPane({
  icon, title, body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  const { t } = useTheme();
  return (
    <View style={[s.empty, { backgroundColor: t.surfaceLow }]}>
      <View style={s.emptyInner}>
        <View style={[s.emptyIcon, { backgroundColor: t.surface }]}>
          <Ionicons name={icon} size={22} color={t.ink4} />
        </View>
        <Text style={[s.emptyTitle, { color: t.ink }]}>{title}</Text>
        <Text style={[s.emptyBody, { color: t.ink3 }]}>{body}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  solo:   { flex: 1, minWidth: 0 },
  row:    { flex: 1, flexDirection: 'row', minHeight: 0 },
  column: { flex: 1, flexDirection: 'column', minWidth: 0 },
  leader: { flexShrink: 0, borderRightWidth: StyleSheet.hairlineWidth },
  leaderStacked: { flexShrink: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  trailing: { flex: 1, minWidth: 0, minHeight: 0 },
  empty:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 44 },
  emptyInner: { maxWidth: 300, alignItems: 'center', gap: 9 },
  emptyIcon: {
    width: 54, height: 54, borderRadius: 27,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  emptyBody:  { fontSize: 12.5, lineHeight: 19, textAlign: 'center' },
});
