import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { hindi } from '../../theme/fonts';
import { a11yButton } from '../../components/a11y';
import Refresher from '../../components/Refresher';
import ScreenState, { StaleBar, type ScreenStatus } from '../../components/ScreenState';
import CardList from '../../components/CardList';

/** Horizontal padding on the scroll body. Exported through `ModuleCards`. */
const BODY_PAD = 16;

/**
 * The frame every light module surface shares: header, scroll body, the four
 * non-ready states, and the boundary note.
 *
 * 17-mobile-app.md: "The light modules are deliberately the CHECKING view, not
 * the DOING view … Each screen states where the boundary is rather than
 * silently omitting actions — a user who can't find invoice creation should be
 * told it's desktop-only, not left hunting."
 *
 * `boundary` is therefore a required prop, not an optional one. Seven screens
 * each omit a different set of actions, and the only way that stays honest is
 * if a screen cannot be written without saying which.
 */

interface Props {
  /** English name, e.g. "Invoicing". */
  title:    string;
  /** Devanagari name, e.g. "गणित". Rendered in the Indic face. */
  hi:       string;
  status:   ScreenStatus;
  /** True when data is on screen but the device has since gone offline. */
  stale?:   boolean;
  onRetry?: () => void;
  refreshing?: boolean;
  /** Sentence naming what this screen cannot do and where that work happens. */
  boundary: string;
  /** Copy for the empty state, which differs per module. */
  emptyTitle?: string;
  emptyBody?:  string;
  children: React.ReactNode;
}

export default function ModuleShell({
  title, hi, status, stale, onRetry, refreshing, boundary,
  emptyTitle, emptyBody, children,
}: Props) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();

  const showBody = status === 'ready' || status === 'empty';

  return (
    <View style={[s.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10} {...a11yButton('Back')}>
          <Ionicons name="chevron-back" size={24} color={t.ink2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: t.ink }]} accessibilityRole="header">{title}</Text>
          <Text style={[s.titleHi, { color: t.primaryText }]}>{hi}</Text>
        </View>
      </View>

      {!showBody ? (
        <ScreenState status={status} onRetry={onRetry} />
      ) : (
        <ScrollView
          contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 40 }]}
          /* refreshControl removed — any RefreshControl blanks the whole list on
           this build. See components/Refresher.tsx. */
        >
          {stale && <StaleBar />}

          {status === 'empty' ? (
            <View style={s.empty}>
              <Ionicons name="file-tray-outline" size={28} color={t.ink3} />
              <Text style={[s.emptyTitle, { color: t.ink }]}>{emptyTitle ?? 'Nothing here yet'}</Text>
              {!!emptyBody && <Text style={[s.emptyBody, { color: t.ink3 }]}>{emptyBody}</Text>}
            </View>
          ) : children}

          <View style={[s.boundary, { borderColor: t.outlineVar }]}>
            <Ionicons name="desktop-outline" size={14} color={t.ink4} />
            <Text style={[s.boundaryText, { color: t.ink3 }]}>{boundary}</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ── Shared pieces the surfaces build from ────────────────────────────────────

/** A figure with a label. `tone` colours the figure, never the label. */
export function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  const { t } = useTheme();
  return (
    <View
      style={[s.stat, { backgroundColor: t.surface, borderColor: t.outlineVar }]}
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={[s.statValue, { color: tone ?? t.ink }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      <Text style={[s.statLabel, { color: t.ink3 }]} numberOfLines={2}>{label}</Text>
    </View>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <View style={s.statRow}>{children}</View>;
}

export function SectionHead({ label, hi: hiText, right }: { label: string; hi?: string; right?: string }) {
  const { t } = useTheme();
  return (
    <View style={s.sectionHead}>
      <Text style={[s.sectionLabel, { color: t.ink3 }]}>{label}</Text>
      {!!hiText && <Text style={[s.sectionHi, { color: t.ink4 }]}>{hiText}</Text>}
      {!!right && <Text style={[s.sectionRight, { color: t.primaryText }]}>{right}</Text>}
    </View>
  );
}

/**
 * The card flow, pre-fitted to this frame — 31-tablet.md §3.
 *
 * A module row sits inside the padded scroll body, so it is `BODY_PAD * 2`
 * narrower than the window's content region that `CardList` measures. Wrapping
 * that here rather than at six call sites means the day the padding changes,
 * the column thresholds follow it instead of quietly going stale.
 *
 * Wrap only the ROWS. `StatRow`, `SectionHead` and the boundary note stay
 * outside it and keep spanning the full width, which is what §3 asks for.
 */
export function ModuleCards({ children }: { children: React.ReactNode }) {
  return <CardList inset={BODY_PAD * 2}>{children}</CardList>;
}

/** A bordered card. The one surface primitive every module row sits in. */
export function Card({ children, accent }: { children: React.ReactNode; accent?: string }) {
  const { t } = useTheme();
  return (
    <View style={[
      s.card,
      { backgroundColor: t.surface, borderColor: t.outlineVar },
      accent ? { borderLeftWidth: 3, borderLeftColor: accent } : null,
    ]}>
      {children}
    </View>
  );
}

/** Status pill. `tone` is the text colour; the fill is derived from it. */
export function Tag({ text, tone, bg }: { text: string; tone: string; bg: string }) {
  return (
    <View style={[s.tag, { backgroundColor: bg }]}>
      <Text style={[s.tagText, { color: tone }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 10 },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  titleHi: { fontSize: 13, marginTop: 1, ...hindi() },
  body: { paddingHorizontal: BODY_PAD, gap: 8 },

  empty: { alignItems: 'center', gap: 6, paddingVertical: 44, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  emptyBody: { fontSize: 13, lineHeight: 19, textAlign: 'center' },

  boundary: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderTopWidth: 1, paddingTop: 14, marginTop: 18,
  },
  boundaryText: { flex: 1, fontSize: 12, lineHeight: 17.5 },

  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: {
    flexGrow: 1, flexBasis: '30%', minWidth: 96,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 10, gap: 3,
  },
  statValue: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  statLabel: { fontSize: 10.5, lineHeight: 14, fontWeight: '600' },

  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 18, marginBottom: 2 },
  sectionLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.3 },
  sectionHi: { fontSize: 11.5, ...hindi() },
  sectionRight: { marginLeft: 'auto', fontSize: 12.5, fontWeight: '800' },

  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 5 },

  tag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  tagText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.2 },
});
