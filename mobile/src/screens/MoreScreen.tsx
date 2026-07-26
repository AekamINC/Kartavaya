import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { hindi } from '../theme/fonts';
import { useNotifications } from '../context/NotificationContext';
import type { RootStackParamList } from '../nav/RootStack';

/**
 * More — the eight destinations that no longer have a tab.
 *
 * 17-mobile-app.md moved Messages into the fourth slot and Inbox under here.
 * Inbox keeps its unread badge, because burying a count is how a notification
 * surface stops being checked.
 *
 * The light module surfaces are deliberately the CHECKING view, not the DOING
 * view — Ganit shows what is outstanding but cannot raise an invoice, Vetana
 * shows only your own payslips. Each states its boundary rather than silently
 * omitting the action, so a user hunting for invoice creation is told it is
 * desktop-only instead of concluding the app is broken.
 */

type Nav = NativeStackNavigationProp<RootStackParamList, 'Main'>;
type Glyph = keyof typeof Ionicons.glyphMap;

interface Dest {
  key:    string;
  en:     string;
  hi:     string;
  icon:   Glyph;
  route?: keyof RootStackParamList;
  /** Shown in place of navigation when the surface is not built yet. */
  note?:  string;
  badge?: 'unread';
}

const WORK: Dest[] = [
  { key: 'boards',    en: 'Boards',    hi: 'फ़लक',      icon: 'grid-outline',            route: 'Board' },
  { key: 'inbox',     en: 'Inbox',     hi: 'संदेश-पेटी', icon: 'notifications-outline',   route: 'Inbox', badge: 'unread' },
  { key: 'approvals', en: 'Approvals', hi: 'सम्मति',     icon: 'checkmark-circle-outline', route: 'Approvals' },
  { key: 'time',      en: 'Time',      hi: 'काल',        icon: 'time-outline',            route: 'Time' },
  { key: 'reminders', en: 'Reminders', hi: 'स्मरण',      icon: 'alarm-outline',           route: 'Reminders' },
];

/**
 * All seven module surfaces are built and routed. They were `note` entries —
 * tiles that opened a "not on mobile yet" toast — and Srijan and Prachar were
 * missing from the list entirely, though 17 §Screens lists seven.
 *
 * Each surface states its own boundary on the screen itself rather than in a
 * toast here, which is the point 17 makes: the user should be told where the
 * work happens while looking at the data, not instead of seeing it.
 *
 * A user whose org lacks a module, or who holds no grant for it, gets a 403 and
 * the surface renders its `forbidden` state. The tile stays visible on purpose —
 * hiding it would leave someone who has been told "check Vetana on your phone"
 * with nothing to find and no explanation.
 */
const MODULES: Dest[] = [
  { key: 'pahchan', en: 'Attendance', hi: 'पहचान',  icon: 'finger-print-outline', route: 'Clock' },
  { key: 'graha',   en: 'CRM',        hi: 'ग्राहक',  icon: 'people-outline',       route: 'Graha' },
  { key: 'ganit',   en: 'Invoicing',  hi: 'गणित',    icon: 'receipt-outline',      route: 'Ganit' },
  { key: 'manav',   en: 'HR',         hi: 'मानव',    icon: 'id-card-outline',      route: 'Manav' },
  { key: 'vetana',  en: 'Payslips',   hi: 'वेतन',    icon: 'cash-outline',         route: 'Vetana' },
  { key: 'dristi',  en: 'Analytics',  hi: 'दृष्टि',  icon: 'stats-chart-outline',  route: 'Dristi' },
  { key: 'srijan',  en: 'Assistant',  hi: 'सृजन',    icon: 'sparkles-outline',     route: 'Srijan' },
  { key: 'prachar', en: 'Marketing',  hi: 'प्रचार',  icon: 'megaphone-outline',    route: 'Prachar' },
];

export default function MoreScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const { unread } = useNotifications();
  const [notice, setNotice] = React.useState<string | null>(null);

  const open = (dest: Dest) => {
    if (dest.route) { nav.navigate(dest.route as never); return; }
    setNotice(dest.note ?? null);
  };

  const section = (label: string, hi: string, items: Dest[]) => (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text style={[s.sectionLabel, { color: t.ink3 }]}>{label}</Text>
        <Text style={[s.sectionHi, { color: t.ink4 }]}>{hi}</Text>
      </View>
      <View style={s.grid}>
        {items.map(dest => {
          const badge = dest.badge === 'unread' ? unread : 0;
          return (
            <Pressable
              key={dest.key}
              onPress={() => open(dest)}
              accessibilityRole="button"
              accessibilityLabel={badge > 0 ? `${dest.en}, ${badge} unread` : dest.en}
              accessibilityHint={dest.route ? undefined : dest.note}
              style={({ pressed }) => [
                s.tile,
                {
                  backgroundColor: pressed ? t.surface2 : t.surface,
                  borderColor: t.outlineVar,
                  // A destination that is not built yet reads as available but
                  // quieter, rather than being hidden — 17's point about telling
                  // the user where the boundary is.
                  opacity: dest.route ? 1 : 0.72,
                },
              ]}
            >
              <View style={s.tileTop}>
                <Ionicons name={dest.icon} size={20} color={t.primaryText} />
                {badge > 0 && (
                  <View style={[s.badge, { backgroundColor: t.error }]}>
                    <Text style={s.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                  </View>
                )}
              </View>
              <Text style={[s.tileEn, { color: t.ink }]} numberOfLines={1}>{dest.en}</Text>
              <Text style={[s.tileHi, { color: t.ink3 }]} numberOfLines={1}>{dest.hi}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={[s.pad, { paddingTop: insets.top + 8 }]}
    >
      <Text style={[s.title, { color: t.ink }]}>More</Text>
      <Text style={[s.titleHi, { color: t.primaryText }]}>अधिक</Text>

      {section('Work', 'कार्य', WORK)}
      {section('Modules', 'मॉड्यूल', MODULES)}

      <Pressable
        onPress={() => nav.navigate('Settings')}
        accessibilityRole="button"
        style={({ pressed }) => [
          s.settingsRow,
          { backgroundColor: pressed ? t.surface2 : t.surface, borderColor: t.outlineVar },
        ]}
      >
        <Ionicons name="settings-outline" size={19} color={t.ink2} />
        <View style={{ flex: 1 }}>
          <Text style={[s.tileEn, { color: t.ink }]}>Settings</Text>
          <Text style={[s.tileHi, { color: t.ink3 }]}>सेटिंग्स</Text>
        </View>
        <Ionicons name="chevron-forward" size={17} color={t.ink4} />
      </Pressable>

      {notice && (
        <View style={[s.notice, { backgroundColor: t.primaryContainer }]}>
          <Ionicons name="information-circle-outline" size={17} color={t.onPrimaryContainer} />
          <Text style={[s.noticeText, { color: t.onPrimaryContainer }]}>{notice}</Text>
          <Pressable onPress={() => setNotice(null)} accessibilityLabel="Dismiss" hitSlop={8}>
            <Ionicons name="close" size={16} color={t.onPrimaryContainer} />
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  pad: { paddingHorizontal: 20, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.4 },
  titleHi: { fontSize: 14, marginTop: 2, ...hindi() },
  section: { marginTop: 24 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  sectionHi: { fontSize: 11.5, ...hindi() },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '31%', minWidth: 96, flexGrow: 1,
    borderWidth: 1, borderRadius: 12, padding: 12, gap: 2,
  },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  tileEn: { fontSize: 13.5, fontWeight: '600' },
  tileHi: { fontSize: 11.5, ...hindi() },
  badge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF' },
  settingsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 24,
  },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 10, padding: 12, marginTop: 16,
  },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
});
