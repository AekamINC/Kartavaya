import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeProvider';
import { hindi } from '../theme/fonts';
import { navWidth, type Platform } from '../lib/windowClass';
import { GROUPS, inGroup, type Destination } from './destinations';

/**
 * The expanded drawer — `large` only, ≥1200.
 *
 * ── THIS IS WHERE `More` STOPS EXISTING ─────────────────────────────────────
 *
 * 31-tablet.md §2: "More exists on a phone because five slots cannot hold twelve
 * modules. At 1200 the drawer holds all of them with the content panes still
 * intact, so the compromise has nothing left to solve. Shipping a *More* row
 * inside a drawer that already lists everything is a phone habit surviving into
 * a place it makes no sense."
 *
 * So this component renders EVERY destination, and that is a correctness
 * requirement rather than a completeness one: at `large` there is no other way
 * to reach any of them. `nav/__tests__/destinations.test.ts` fails if anything
 * the phone's More grid can open is absent from a group here.
 *
 * ── THE FOOTER IS NOT DECORATION ────────────────────────────────────────────
 *
 * §3: "Fifteen destinations do not fill 1032pt. The space left over goes to the
 * two things worth reaching from anywhere: whether you are on the clock — the
 * live timer, or the clock-in button, pinned to the bottom — and whether your
 * work has reached the server, one line, stating the queue depth rather than a
 * cloud icon. Both already exist elsewhere in the product; neither is new UI
 * invented to fill a gap."
 *
 * ── WHAT DIFFERS BY PLATFORM (§7) ───────────────────────────────────────────
 *
 *   iPadOS   44-tall rows · small radius · selected row a solid `primary`
 *   Android  52-tall rows · pill · selected row `secondaryContainer`
 *            and the ＋ is an extended FAB rather than a plain button
 */

interface Props {
  platform: Platform;
  current: string;
  onSelect: (dest: Destination) => void;
  onAdd: () => void;
  /** Opens the attendance surface from the footer. */
  onClock: () => void;
  badges: { unread: number; mentions: number };
  /** Queue depth and the age of the oldest write, for the sync line. */
  queued: number;
  oldestLabel: string | null;
  /** Live shift state for the clock button. Null when not clocked in. */
  clockedFor: string | null;
  userName?: string;
  orgName?: string;
  userRole?: string;
}

export default function NavDrawer({
  platform, current, onSelect, onAdd, onClock, badges,
  queued, oldestLabel, clockedFor, userName, orgName, userRole,
}: Props) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const isAndroid = platform === 'android';

  const rowHeight = isAndroid ? 52 : 44;
  const rowRadius = isAndroid ? 26 : 8;

  const badgeFor = (d: Destination) =>
    d.badge === 'unread' ? badges.unread : d.badge === 'mentions' ? badges.mentions : 0;

  return (
    <View
      style={[
        s.drawer,
        {
          width: navWidth('large', platform),
          backgroundColor: isAndroid ? t.surface2 : t.surface,
          borderRightColor: t.outlineVar,
          paddingTop: insets.top + 10,
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      {/* Who you are and which organisation you are in. The org name matters
          here in a way it does not on a phone: this is the only navigation on
          screen, so it is the only place the answer can live. */}
      <View style={s.head}>
        <View style={[s.avatar, { backgroundColor: t.primaryContainer }]}>
          <Text style={[s.avatarText, { color: t.onPrimaryContainer }]}>{initials(userName)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.org, { color: t.ink }]} numberOfLines={1}>{orgName ?? 'Kartavaya'}</Text>
          <Text style={[s.who, { color: t.ink3 }]} numberOfLines={1}>
            {[userName, userRole].filter(Boolean).join(' · ') || '—'}
          </Text>
        </View>
      </View>

      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel="New task"
        style={({ pressed }) => [
          s.newTask,
          {
            // §7: an extended FAB on Android, a plain filled button on iPadOS.
            backgroundColor: isAndroid ? t.tertiaryContainer : t.primary,
            borderRadius: isAndroid ? 16 : 10,
            opacity: pressed ? 0.88 : 1,
          },
        ]}
      >
        <Ionicons name="add" size={19} color={isAndroid ? t.onTertiaryContainer : t.onPrimary} />
        <Text style={[s.newTaskText, { color: isAndroid ? t.onTertiaryContainer : t.onPrimary }]}>
          New task
        </Text>
      </Pressable>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
        {GROUPS.map(g => {
          const items = inGroup(g.id);
          if (items.length === 0) return null;
          return (
            <View key={g.id}>
              {/* A null label is a group that is grouped but not titled —
                  "Work" above Today is a caption on the obvious. */}
              {g.label && (
                <View style={s.sectionHead}>
                  <Text style={[s.section, { color: t.ink3 }]}>{g.label}</Text>
                  {!!g.hi && <Text style={[s.sectionHi, { color: t.ink4 }]}>{g.hi}</Text>}
                </View>
              )}
              {items.map(d => {
                const focused = current === d.key;
                const badge = badgeFor(d);
                const fill = isAndroid ? t.secondaryContainer : t.primary;
                const fg = focused
                  ? (isAndroid ? t.onSecondaryContainer : t.onPrimary)
                  : t.ink2;
                return (
                  <Pressable
                    key={d.key}
                    onPress={() => onSelect(d)}
                    accessibilityRole="button"
                    accessibilityState={focused ? { selected: true } : {}}
                    accessibilityLabel={badge > 0 ? `${d.en}, ${badge} unread` : d.en}
                    style={({ pressed }) => [
                      s.row,
                      {
                        height: rowHeight,
                        borderRadius: rowRadius,
                        backgroundColor: focused ? fill : (pressed ? t.surface2 : 'transparent'),
                      },
                    ]}
                  >
                    <Ionicons name={(focused && d.iconActive) || d.icon} size={20} color={fg} />
                    <Text
                      style={[s.rowText, { color: fg }, focused && s.rowTextOn]}
                      numberOfLines={1}
                    >
                      {d.en}
                    </Text>
                    {/* Devanagari sits on every drawer row — unlike the rail,
                        there is width for it here. 24-bilingual-devanagari.md:
                        a recognition cue on things the user already knows the
                        meaning of, and nav is exactly that. */}
                    <Text style={[s.rowHi, { color: fg }]} numberOfLines={1}>{d.hi}</Text>
                    {badge > 0 && (
                      <Text style={[s.count, { color: fg }]} numberOfLines={1}>
                        {badge > 99 ? '99+' : badge}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      {/* ── The footer, §3 ────────────────────────────────────────────────── */}
      <View style={s.foot}>
        <Pressable
          onPress={onClock}
          accessibilityRole="button"
          accessibilityLabel={clockedFor ? `Clocked in, ${clockedFor}` : 'Clock in'}
          style={({ pressed }) => [
            s.clock,
            {
              backgroundColor: clockedFor ? t.successBg : t.primaryContainer,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Ionicons
            name={clockedFor ? 'radio-button-on' : 'finger-print-outline'}
            size={19}
            color={clockedFor ? t.success : t.onPrimaryContainer}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={[
                s.clockTitle,
                { color: clockedFor ? t.ink : t.onPrimaryContainer },
                !!clockedFor && s.clockTimer,
              ]}
              numberOfLines={1}
            >
              {clockedFor ?? 'Clock in'}
            </Text>
            <Text
              style={[s.clockSub, { color: clockedFor ? t.ink3 : t.onPrimaryContainer }]}
              numberOfLines={1}
            >
              {clockedFor ? 'On the clock' : 'पहचान · not clocked in today'}
            </Text>
          </View>
        </Pressable>

        {/*
          The queue DEPTH and the age of the oldest write, not a cloud icon.
          §3 is explicit about the difference: a cloud says somebody thought
          about syncing; "3 changes queued · oldest 12 min" says what is at risk.
        */}
        <View style={s.sync}>
          <View style={[s.dot, { backgroundColor: queued > 0 ? t.approval : t.success }]} />
          <Text style={[s.syncText, { color: t.ink3 }]} numberOfLines={1}>
            {queued > 0
              ? `${queued} change${queued === 1 ? '' : 's'} queued${oldestLabel ? ` · oldest ${oldestLabel}` : ''}`
              : 'All changes saved'}
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
  drawer: { borderRightWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6, paddingBottom: 14 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 12.5, fontWeight: '700' },
  org: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  who: { fontSize: 11, marginTop: 1 },
  newTask: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    height: 48, marginBottom: 10,
  },
  newTaskText: { fontSize: 14, fontWeight: '700' },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 7, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  section: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  sectionHi: { fontSize: 10.5, ...hindi() },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  rowText: { fontSize: 13.5, fontWeight: '500' },
  rowTextOn: { fontWeight: '700' },
  rowHi: { fontSize: 12, opacity: 0.55, ...hindi() },
  count: { marginLeft: 'auto', fontSize: 11, fontWeight: '700' },
  foot: { marginTop: 'auto', paddingTop: 14, gap: 9 },
  clock: { flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 12, padding: 12, minHeight: 58 },
  clockTitle: { fontSize: 14, fontWeight: '700' },
  clockTimer: { fontVariant: ['tabular-nums'] },
  clockSub: { fontSize: 11, opacity: 0.78, marginTop: 1 },
  sync: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, paddingBottom: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  syncText: { flex: 1, fontSize: 11, lineHeight: 15 },
});
