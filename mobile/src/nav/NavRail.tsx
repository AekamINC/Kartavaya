import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeProvider';
import { toPair } from '../theme/labels';
import { navWidth, railSlots, railItems, type Platform } from '../lib/windowClass';
import { GROUPS, DESTINATIONS, type Destination } from './destinations';

/**
 * The navigation rail — `medium` and `expanded`.
 *
 * 31-tablet.md §2: "The bottom bar does not survive the transition, and not
 * because there is room for a rail. A bar pinned to the bottom of a 1280dp
 * screen puts primary navigation a full hand-span from the text being read, and
 * in landscape it spends scarce vertical space on chrome."
 *
 * ── IT FILLS TO FIT, AND THAT IS THE PROTOTYPE'S RULE NOT THE PROSE'S ────────
 *
 * §2's prose gives the rail six fixed destinations. `Tablet.jsx:25` gives it
 * fifteen and fills to fit by height, with the remainder behind More — "on a
 * tall tablet held upright there is no remainder, so More does not appear at
 * all." The prototype is the spec (see the project's design-source rule), and it
 * is also the better behaviour: a fixed six wastes 600dp of rail on an iPad Pro
 * held upright.
 *
 * The arithmetic is in `lib/windowClass.ts` and unit tested. What is NOT
 * negotiable and so is not computed: `RAIL_ITEM` is 63dp, which clears both
 * touch floors in §4 (44pt iPadOS, 48dp Android). If a window is too short for
 * another destination the answer is More — never a smaller target. §4: "Touch
 * targets do not shrink because the screen grew."
 *
 * ── WHAT DIFFERS BY PLATFORM (§7) ───────────────────────────────────────────
 *
 *   iPadOS   72 wide · tinted glyph and label · no indicator · NO ＋ (it lives
 *            in the pane's own toolbar)
 *   Android  80 wide · Material pill behind the active glyph · ＋ is a FAB at
 *            the head of the rail
 */

interface Props {
  platform: Platform;
  /** The `key` of the active destination, or `'more'` when the More pane is open. */
  current: string;
  onSelect: (dest: Destination) => void;
  /** Opens the More surface. Only ever called when the rail has overflowed. */
  onMore: () => void;
  /** Android only — the FAB. iPadOS passes it and it is deliberately unused. */
  onAdd: () => void;
  /** Live counts, keyed by `BadgeSource`. */
  badges: { unread: number; mentions: number };
  /** True when anything is waiting to reach the server. */
  pending: boolean;
  /** For the footer avatar. */
  userName?: string;
}

/** Group boundaries, so a rule can be drawn between them without a second list. */
const GROUP_ORDER = GROUPS.map(g => g.id);

export default function NavRail({
  platform, current, onSelect, onMore, onAdd, badges, pending, userName,
}: Props) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const isAndroid = platform === 'android';

  /**
   * The rail's OWN height, not the window's.
   *
   * `railSlots` deliberately does not subtract a status bar, because the
   * prototype's `h - 64` was compensating for a status bar it drew itself. Here
   * the insets are real and subtracting twice would cost a destination on every
   * device.
   */
  const [available, setAvailable] = React.useState(0);
  const slots = railSlots(available || 800, platform);
  const { shown, overflow } = railItems(DESTINATIONS, slots);

  const badgeFor = (d: Destination) =>
    d.badge === 'unread' ? badges.unread : d.badge === 'mentions' ? badges.mentions : 0;

  return (
    <View
      onLayout={e => setAvailable(e.nativeEvent.layout.height)}
      style={[
        s.rail,
        {
          width: navWidth('medium', platform),
          backgroundColor: isAndroid ? t.surface2 : t.surface,
          borderRightColor: t.outlineVar,
          paddingTop: insets.top + 10,
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
      accessibilityRole="tablist"
    >
      {/* §7: the ＋ is a FAB at the head of the Android rail. On iPadOS it is a
          toolbar button in the pane, so the rail starts at its first
          destination — rendering one here would be an Android habit on iOS. */}
      {isAndroid && (
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="New task"
          style={({ pressed }) => [
            s.fab,
            { backgroundColor: t.tertiaryContainer, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Ionicons name="add" size={22} color={t.onTertiaryContainer} />
        </Pressable>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.items}
        // The rail is sized to not need scrolling. It is scrollable anyway, so
        // that a font-scale setting large enough to break the arithmetic degrades
        // into a scroll rather than clipping the last destination silently.
      >
        {shown.map((d, i) => {
          const focused = current === d.key;
          const label = toPair(d);
          const badge = badgeFor(d);
          const rule = i > 0
            && GROUP_ORDER.indexOf(d.group) !== GROUP_ORDER.indexOf(shown[i - 1].group);

          return (
            <React.Fragment key={d.key}>
              {rule && <View style={[s.rule, { backgroundColor: t.outlineVar }]} />}
              <Pressable
                onPress={() => onSelect(d)}
                accessibilityRole="tab"
                accessibilityState={focused ? { selected: true } : {}}
                accessibilityLabel={badge > 0 ? `${d.en}, ${badge} unread` : d.en}
                style={s.item}
              >
                <View
                  style={[
                    s.glyph,
                    // Android gets the Material pill behind the glyph; iPadOS
                    // tints the glyph itself and has no indicator (§7).
                    isAndroid && focused && { backgroundColor: t.secondaryContainer },
                  ]}
                >
                  <Ionicons
                    name={(focused && d.iconActive) || d.icon}
                    size={21}
                    color={
                      isAndroid
                        ? (focused ? t.onSecondaryContainer : t.ink3)
                        : (focused ? t.primaryText : t.ink3)
                    }
                  />
                  {badge > 0 && (
                    <View style={[s.badge, { backgroundColor: t.error }]}>
                      <Text style={s.badgeText} numberOfLines={1}>
                        {badge > 99 ? '99+' : badge}
                      </Text>
                    </View>
                  )}
                </View>
                <Text
                  style={[
                    s.label,
                    { color: focused ? (isAndroid ? t.ink : t.primaryText) : t.ink3 },
                    focused && s.labelOn,
                  ]}
                  numberOfLines={1}
                >
                  {label.en}
                </Text>
              </Pressable>
            </React.Fragment>
          );
        })}

        {overflow && (
          <Pressable
            onPress={onMore}
            accessibilityRole="tab"
            accessibilityState={current === 'more' ? { selected: true } : {}}
            accessibilityLabel="More"
            style={s.item}
          >
            <View style={s.glyph}>
              <Ionicons
                name="ellipsis-horizontal"
                size={21}
                color={current === 'more' ? t.primaryText : t.ink3}
              />
            </View>
            <Text style={[s.label, { color: current === 'more' ? t.primaryText : t.ink3 }]}>
              More
            </Text>
          </Pressable>
        )}
      </ScrollView>

      {/*
        The footer. §3's argument for the drawer applies here in miniature: the
        rail runs out of rows before it runs out of height, and what belongs in
        the space left over is whether your work has reached the server. One
        line stating the queue state — not a cloud icon, which says only that
        somebody thought about syncing.
      */}
      <View style={[s.foot, { borderTopColor: t.outlineVar }]}>
        <View style={s.sync}>
          <View style={[s.dot, { backgroundColor: pending ? t.approval : t.success }]} />
          <Text style={[s.syncText, { color: t.ink3 }]} numberOfLines={1}>
            {pending ? 'Queued' : 'Synced'}
          </Text>
        </View>
        <View style={[s.avatar, { backgroundColor: t.primaryContainer }]}>
          <Text style={[s.avatarText, { color: t.onPrimaryContainer }]}>
            {initials(userName)}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** Up to two letters. Falls back to a dash rather than rendering an empty ring. */
function initials(name?: string): string {
  if (!name?.trim()) return '–';
  return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

const s = StyleSheet.create({
  rail:  { borderRightWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  items: { alignItems: 'center', paddingBottom: 6 },
  fab: {
    width: 56, height: 56, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  item:  { alignItems: 'center', paddingVertical: 6, gap: 3, width: '100%' },
  glyph: { width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 10, fontWeight: '600', letterSpacing: -0.1, paddingHorizontal: 3 },
  labelOn: { fontWeight: '700' },
  rule:  { width: 40, height: StyleSheet.hairlineWidth, marginVertical: 5 },
  badge: {
    position: 'absolute', top: -1, right: 8,
    minWidth: 15, height: 15, borderRadius: 8, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { fontSize: 9.5, fontWeight: '800', color: '#FFFFFF' },
  foot: {
    width: '100%', paddingTop: 11, alignItems: 'center', gap: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sync:     { alignItems: 'center', gap: 4 },
  dot:      { width: 7, height: 7, borderRadius: 4 },
  syncText: { fontSize: 8.5, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' },
  avatar:   { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 11, fontWeight: '700' },
});
