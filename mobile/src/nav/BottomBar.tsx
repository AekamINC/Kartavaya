import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTheme } from '../theme/ThemeProvider';
import { hindi } from '../theme/fonts';
import { duration, usePressScale, useReducedMotion, TAB } from '../theme/motion';

/**
 * The five-tab bar: Today · Tasks · ＋ · Messages · More.
 *
 * Extracted from RootStack per 17-mobile-app.md, for two reasons beyond tidiness.
 *
 * The gradient was hardcoded `['#0082c6', '#03a1b6', '#05b7aa']` with a matching
 * `shadowColor: '#0082c6'` — the retired brand blue that 00 §9 removed, on the
 * single most prominent control in the app, and it survived the palette
 * migration because it was inline in a navigator config rather than in the
 * theme. It now reads `brand.gradient` from tokens, so it tracks the accent.
 *
 * The ＋ is an ACTION, not a destination. Its tab press opens the sheet and does
 * not navigate; pushing a screen for it breaks the back stack, because Android
 * hardware back then pops to a screen the user never chose to visit.
 */

type IconPair = [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap];

/** Active / inactive glyph per route. Bilingual labels come from LABELS below. */
const ICONS: Record<string, IconPair> = {
  Today:    ['today', 'today-outline'],
  Tasks:    ['checkbox', 'checkbox-outline'],
  Messages: ['chatbubbles', 'chatbubbles-outline'],
  More:     ['ellipsis-horizontal-circle', 'ellipsis-horizontal-circle-outline'],
  // Attendance-only shell (07-pahchan.md §9)
  Clock:    ['finger-print', 'finger-print-outline'],
  Me:       ['person-circle', 'person-circle-outline'],
};

/**
 * 24-bilingual-devanagari.md: Devanagari is a recognition cue on things the user
 * already knows the meaning of, and nav is exactly that — the same five items
 * every day. English leads, Devanagari sits under it.
 */
const LABELS: Record<string, { en: string; hi: string }> = {
  Today:    { en: 'Today',    hi: 'आज' },
  Tasks:    { en: 'Tasks',    hi: 'कर्तव्य' },
  Messages: { en: 'Messages', hi: 'संवाद' },
  More:     { en: 'More',     hi: 'अधिक' },
  Clock:    { en: 'Clock',    hi: 'उपस्थिति' },
  Me:       { en: 'Me',       hi: 'मैं' },
};

export interface BottomBarProps extends BottomTabBarProps {
  /** Route name that opens the create sheet instead of navigating. */
  actionRoute?: string;
  onAction?: () => void;
  /** Per-route badge counts, e.g. { Messages: 3 }. */
  badges?: Record<string, number>;
}

/**
 * The active-tab indicator, and why it slides.
 *
 * `mobile.css:297` draws `.mnav2__ind` — a 30×3px bar along the top edge of the
 * active tab — and `Mobile App.html:177` renders it **only on Android**
 * (`screen === k && d.os === 'android'`). That is right: an indicator bar is
 * Material's convention and iOS tab bars do not have one, so this follows the
 * platform rather than the file.
 *
 * The reference gives it no transition, so the reference's own bar jumps. Its
 * shared tabs primitive does not — `motion.css:185` `.dm-tabs__ind` transitions
 * `left` and `width` over `--dur-base` `--ease-emph` — and that is the version
 * taken here, because a jumping indicator is indistinguishable from two
 * separate indicators appearing and disappearing.
 *
 * `left` is animated rather than `transform: translateX` so the bar tracks tab
 * boundaries measured in layout units. That means it cannot use the native
 * driver; it is a 3px bar moving once per press, which is the one case where
 * that is an acceptable trade.
 */
function Indicator({ count, index, color, reduced }: {
  count: number; index: number; color: string; reduced: boolean;
}) {
  const pos = useRef(new Animated.Value(index)).current;

  useEffect(() => {
    Animated.timing(pos, {
      toValue: index,
      duration: duration(TAB.indicator, reduced),
      easing: TAB.indicatorEase,
      useNativeDriver: false,
    }).start();
  }, [index, reduced, pos]);

  const tabWidth = 100 / count;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        s.indicator,
        {
          backgroundColor: color,
          width: 30,
          left: pos.interpolate({
            inputRange:  [0, 1],
            outputRange: [`${tabWidth / 2}%`, `${tabWidth * 1.5}%`],
            // Beyond index 1 the same step repeats, so extrapolation is exactly
            // right and avoids listing every tab.
            extrapolate: 'extend',
          }),
          marginLeft: -15,
        },
      ]}
    />
  );
}

export default function BottomBar({
  state, descriptors, navigation, actionRoute, onAction, badges,
}: BottomBarProps) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const isIOS = Platform.OS === 'ios';
  const reduced = useReducedMotion();
  // The ＋ is a 56px gradient circle with a shadow and, until now, no press
  // state whatsoever — the most prominent control in the app and the only one
  // that gave nothing back on touch.
  const action = usePressScale(0.94, reduced);

  return (
    <View
      style={[
        s.bar,
        {
          // iOS floats a translucent bar over content; Android sits on a solid
          // surface with elevation. 17 lists this as not optional.
          backgroundColor: isIOS ? t.tabBg : t.surface,
          borderTopColor:  isIOS ? t.outlineVar : t.outline,
          borderTopWidth:  isIOS ? StyleSheet.hairlineWidth : 1,
          paddingBottom:   Math.max(insets.bottom, isIOS ? 20 : 8),
          elevation:       isIOS ? 0 : 4,
        },
      ]}
    >
      {!isIOS && (
        <Indicator
          count={state.routes.length}
          index={state.index}
          color={t.primaryText}
          reduced={reduced}
        />
      )}

      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const label = LABELS[route.name] ?? { en: route.name, hi: '' };
        const isAction = route.name === actionRoute;

        const onPress = () => {
          if (isAction) { onAction?.(); return; }
          const event = navigation.emit({
            type: 'tabPress', target: route.key, canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name as never);
        };

        if (isAction) {
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              {...action.handlers}
              accessibilityRole="button"
              accessibilityLabel="Create"
              style={s.actionWrap}
              hitSlop={8}
            >
              <Animated.View style={{ transform: [{ scale: action.scale }] }}>
                <LinearGradient
                  colors={t.gradient as [string, string, string]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[s.actionPill, { shadowColor: t.primary }]}
                >
                  <Ionicons name="add" size={26} color={t.onPrimary} />
                </LinearGradient>
              </Animated.View>
            </Pressable>
          );
        }

        const [active, inactive] = ICONS[route.name] ?? ['ellipse', 'ellipse-outline'];
        const tint = focused ? t.primaryText : t.ink3;
        const badge = badges?.[route.name] ?? 0;

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={label.en}
            style={s.tab}
            hitSlop={4}
          >
            <View>
              <Ionicons name={focused ? active : inactive} size={22} color={tint} />
              {badge > 0 && (
                <View style={[s.badge, { backgroundColor: t.error, borderColor: isIOS ? t.tabBg : t.surface }]}>
                  <Text style={[s.badgeText, { color: '#FFFFFF' }]} numberOfLines={1}>
                    {badge > 99 ? '99+' : badge}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[s.label, { color: tint }]} numberOfLines={1}>{label.en}</Text>
            {!!label.hi && (
              <Text style={[s.labelHi, { color: focused ? tint : t.ink4 }]} numberOfLines={1}>
                {label.hi}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 8,
    paddingHorizontal: 4,
  },
  // mobile.css:297 — `position: absolute; top: 0; width: 30px; height: 3px;
  // border-radius: 0 0 3px 3px`. Android only; see Indicator.
  indicator: {
    position: 'absolute',
    top: 0,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', gap: 1 },
  // 00 §12 puts the metadata floor at 11px. The Devanagari sub-label sits at
  // 9.5px only because it is a recognition cue beside a label that is already
  // legible — never the sole carrier of meaning.
  label:   { fontSize: 10, fontWeight: '700', marginTop: 2 },
  // No fontWeight: Tiro ships only a 400 and a synthesised bold is exactly the
  // mixed-weight defect theme/fonts.ts documents.
  labelHi: { fontSize: 9.5, ...hindi() },
  actionWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: -18 },
  actionPill: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 8,
  },
  badge: {
    position: 'absolute', top: -5, right: -10,
    minWidth: 17, height: 17, borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: 10, fontWeight: '800' },
});
