import React, { useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, StatusBar, Animated, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { hindi } from '../../theme/fonts';
import { useTheme } from '../../theme/ThemeProvider';
import { duration, useReducedMotion, DUR, EASE } from '../../theme/motion';
import {
  NOTICE_TITLE, NOTICE_LEDE, NOTICE_ACK, NOTICE_LEGAL, noticeLines,
  type NoticeRetention,
} from './noticeCopy';

/**
 * The DPDP notice — `PhNotice` in the prototype
 * (`design-reference/Kartavaya Redesign/PahchanClock.jsx:174-206`), which existed
 * in no form in `mobile/src`, `frontend/src` or `backend/`.
 *
 * ── THE TWO MODES ARE ONE COMPONENT ON PURPOSE ────────────────────────────────
 *
 * `gate` is the screen served before the camera. `reference` is the same six
 * lines on the Me tab afterwards. They are one file because the moment they are
 * two, one of them gets a word changed and the product serves a notice it can no
 * longer show you again. The only differences are the chrome and the button.
 *
 * ── `gate` IS OPAQUE, AND IT IS ABOVE THE CAMERA ─────────────────────────────
 *
 * Not a sheet over the preview: the camera must not open before the notice is
 * read, and a translucent overlay over a live face is the visual claim that it
 * already has. `ClockScreen` renders this instead of the permission screen, not
 * on top of it — you tell somebody why you want their camera before you ask for
 * it, and `useCameraPermissions` has asked nothing at that point.
 *
 * ── ONE TAP AND IT IS GONE FOREVER ───────────────────────────────────────────
 *
 * No dismiss, no back, no X. The tap is the acknowledgement and the gate clears
 * on the LOCAL latch (`noticeAck.ts`), never on the server's answer — 07 §2,
 * nothing blocks a punch, and "no signal" is the case this module exists for.
 */

type Mode = 'gate' | 'reference';

interface Props {
  mode: Mode;
  /** The theme object, as every other Pahchan component takes it. */
  t: any;
  retention?: Partial<NoticeRetention> | null;
  /** Present only in `gate`. Absent in `reference` — there is no button there. */
  onAck?: () => void;
  saving?: boolean;
  /** "Recorded on this device" — said out loud rather than dressed as a save. */
  saveNote?: string | null;
  /** `reference` only: when they read it, if that is known. */
  acknowledgedAt?: string | null;
}

/**
 * One disclosure line. Closed by default, open one at a time — six paragraphs
 * open at once is the policy page this exists to not be.
 */
function Row({
  label, text, open, onToggle, t, reduced, first,
}: {
  label: string; text: string; open: boolean; onToggle: () => void;
  t: any; reduced: boolean; first: boolean;
}) {
  const spin = useRef(new Animated.Value(open ? 1 : 0)).current;

  React.useEffect(() => {
    Animated.timing(spin, {
      toValue: open ? 1 : 0,
      duration: duration(DUR.base, reduced),
      easing: EASE.standard,
      useNativeDriver: true,
    }).start();
  }, [open, reduced, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });

  // `outlineVar`, NOT `outlineVariant`. The token is spelled `outlineVar` in
  // `theme/tokens.ts:157`; `MyBiometrics.tsx` reached for `outlineVariant` and
  // therefore took its `??` fallback on every render, in both themes, silently.
  // A `??` on a key that does not exist is not a fallback — it is the only
  // branch. (A `{/* */}` comment here rather than a `//` one would be a build
  // error: it would make two children of a parenthesised return.)
  return (
    <View style={[s.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.outlineVar }]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        // The chevron is the same fact drawn; `expanded` is what a screen reader
        // reads, so the glyph is hidden from it rather than announced twice.
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        hitSlop={6}
        style={({ pressed }) => [s.q, pressed && { opacity: 0.6 }]}
      >
        <Text style={[s.k, { color: t.ink }]}>{label}</Text>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons
            name="chevron-forward" size={15} color={t.ink3}
            accessibilityElementsHidden importantForAccessibility="no"
          />
        </Animated.View>
      </Pressable>
      {open && <Text style={[s.a, { color: t.ink2 }]}>{text}</Text>}
    </View>
  );
}

export default function AttendanceNotice({
  mode, t, retention, onAck, saving, saveNote, acknowledgedAt,
}: Props) {
  const insets = useSafeAreaInsets();
  // `t` arrives as a prop, the way every other Pahchan component takes it. Only
  // `scheme` is read from context, and only for the status bar — `t` carries no
  // light/dark flag.
  const { scheme } = useTheme();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState<number | null>(null);
  const lines = noticeLines(retention);

  const body = (
    <>
      <View style={s.head}>
        <Text style={[s.title, { color: t.ink }]} accessibilityRole="header">
          {NOTICE_TITLE.en}
        </Text>
        {/* Tiro Devanagari Hindi, named. Without a family the platform picks its
            own Devanagari fallback, so the Hindi on the one screen an
            attendance-only employee is served would not be in the app's face.
            No weight and no tracking: Tiro ships only 400, and RN applies
            tracking AFTER shaping, which breaks the शिरोरेखा. */}
        <Text style={[s.titleHi, { color: t.primaryText }]}>
          {NOTICE_TITLE.hi}
        </Text>
        <Text style={[s.lede, { color: t.ink2 }]}>{NOTICE_LEDE}</Text>
      </View>

      <View style={[s.list, { backgroundColor: t.surfaceLow }]}>
        {lines.map((line, i) => (
          <Row
            key={line.key}
            label={line.key}
            text={line.text}
            open={open === i}
            onToggle={() => setOpen(open === i ? null : i)}
            t={t}
            reduced={reduced}
            first={i === 0}
          />
        ))}
      </View>

      <View style={s.foot}>
        {onAck && (
          <Pressable
            onPress={onAck}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={NOTICE_ACK}
            accessibilityState={{ disabled: !!saving }}
            style={({ pressed }) => [
              s.cta,
              { backgroundColor: t.primary, opacity: pressed || saving ? 0.75 : 1 },
            ]}
          >
            {saving
              ? <ActivityIndicator color={t.onPrimary} />
              : <Text style={[s.ctaText, { color: t.onPrimary }]}>{NOTICE_ACK}</Text>}
          </Pressable>
        )}

        {!onAck && acknowledgedAt && (
          <Text style={[s.read, { color: t.ink2 }]}>
            You read this on {formatDay(acknowledgedAt)}.
          </Text>
        )}

        {saveNote ? <Text style={[s.note, { color: t.ink3 }]}>{saveNote}</Text> : null}

        <Text style={[s.legal, { color: t.ink3 }]}>{NOTICE_LEGAL}</Text>
      </View>
    </>
  );

  if (mode === 'reference') {
    // Sits inside the Me tab's own ScrollView. No scroller of its own — nesting
    // one inside another is how a list stops scrolling on Android — and no
    // horizontal padding, because the section it sits in already has it.
    return <View style={s.refWrap}>{body}</View>;
  }

  return (
    <View style={[s.gateRoot, { backgroundColor: t.bg, paddingTop: insets.top + 16 }]}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <ScrollView
        contentContainerStyle={[s.gateScroll, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        {body}
      </ScrollView>
    </View>
  );
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'a date this device could not read';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

const s = StyleSheet.create({
  gateRoot:   { flex: 1 },
  gateScroll: { paddingHorizontal: 20 },
  refWrap:    { paddingTop: 18 },

  head:    { paddingBottom: 12, gap: 2 },
  title:   { fontSize: 19, fontWeight: '700', letterSpacing: -0.2 },
  // Devanagari: family named, weight 400 (Tiro ships no other), tracking 0.
  titleHi: { fontSize: 13.5, letterSpacing: 0, ...hindi() },
  lede:    { fontSize: 12.5, lineHeight: 18, paddingTop: 6 },

  list: { borderRadius: 16, paddingHorizontal: 14 },
  row:  {},
  q: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    // 44pt of touch target for a 13px label — this is the only control on the
    // gate besides the button, and it is what a person taps six times.
    minHeight: 44, paddingVertical: 11,
  },
  k: { flex: 1, fontSize: 13, fontWeight: '500' },
  a: { fontSize: 12, lineHeight: 20.5, paddingRight: 24, paddingBottom: 13 },

  foot:    { paddingTop: 16 },
  cta:     { borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  ctaText: { fontSize: 14.5, fontWeight: '700' },
  read:    { fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
  note:    { fontSize: 11.5, lineHeight: 16.5, textAlign: 'center', paddingTop: 9 },
  legal:   { fontSize: 10.5, lineHeight: 16, textAlign: 'center', paddingTop: 9 },
});
