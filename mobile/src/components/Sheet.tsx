/**
 * Sheet / Dialog — the one presentation primitive for everything that overlays.
 *
 * ── What this replaces, and why it had to be replaced ────────────────────────
 *
 * Every overlay in this app was `<Modal animationType="slide">` or
 * `animationType="fade"`. That prop takes no duration, no curve, and — the part
 * that made it unshippable — **no reduced-motion behaviour of any kind**. It
 * slides the full height of the screen at a fixed platform speed whether or not
 * `AccessibilityInfo.isReduceMotionEnabled()` is true, and there is no prop, no
 * config and no native module hook to change that. A user with Reduce Motion on
 * got the same full-height slide as everyone else, from eleven different call
 * sites.
 *
 * It was also wrong even for users who want motion. MOTION-SPEC §3 gives the
 * bottom sheet an entrance AND a paired exit, and `animationType` cannot express
 * a pair: the same animation plays reversed on dismissal, so the exit is the
 * same length as the entrance. §7.3 — "exits are faster than entrances,
 * decisive out, gentle in" — is not expressible in RN's Modal at all.
 *
 * And the scrim did not animate. `<Pressable style={s.modalOverlay}>` with a
 * flat `rgba(0,0,0,.55)` appeared at full strength on the first frame while the
 * panel was still travelling, so the background went dark before anything
 * explained why. `mobile.css:278` fades it over `--dur-base` `--ease-enter` —
 * measured in the rendered harness at exactly 0.22s / cubic-bezier(0,0,.2,1).
 *
 * ── How the timing works ─────────────────────────────────────────────────────
 *
 * `animationType="none"`, and the motion is ours. Which means the Modal has to
 * stay mounted through the EXIT: `visible` is the caller's intent, `mounted` is
 * whether the Modal is on screen, and they differ for exactly the length of the
 * dismissal. Unmounting on the caller's flag is what makes an exit animation
 * impossible, which is why every one of these had only an entrance.
 *
 * Both halves collapse under reduced motion, and they collapse differently on
 * purpose — this is the two-scalar split from `theme/motion.ts` doing the work
 * it exists for:
 *
 *   · `duration()`  → 0ms. No transition.
 *   · `amplitude()` → 0px of travel, so the panel is composed at its resting
 *                     position rather than teleporting in from below.
 *
 * The scrim's opacity change is kept in both cases. It is not vestibular motion
 * — no translation, no scale, no repetition — and it is the only thing on screen
 * that says the surface underneath is no longer live.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { amplitude, duration, scaleTo, useReducedMotion, DUR, EASE, SHEET } from '../theme/motion';
import { useWindowClass } from '../hooks/useWindowClass';
import { devicePlatform } from '../nav/platform';

/**
 * The bottom-anchored (or centred) frame the panel sits in.
 *
 * A KeyboardAvoidingView when the sheet holds a text field, a plain View when it
 * does not. It has to be the frame rather than something inside the panel:
 * `behavior="padding"` works by adding space at the bottom of its own box, and
 * with `justifyContent: 'flex-end'` that is precisely what lifts the panel clear
 * of the keyboard. Put it inside the panel and it competes with the entrance
 * translate for the same visual property, which is how a sheet ends up jittering
 * as the keyboard opens.
 *
 * `undefined` on Android on purpose — `adjustResize` in the manifest already
 * does this, and stacking `height` on top of it double-counts.
 */
function Frame({ avoidKeyboard, style, children }: {
  avoidKeyboard: boolean;
  style: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  if (!avoidKeyboard) {
    return <View style={style} pointerEvents="box-none">{children}</View>;
  }
  return (
    <KeyboardAvoidingView
      style={style}
      pointerEvents="box-none"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

/**
 * The scrim colour. `motion.css` reads `var(--scrim)`; RN has no cascade, so it
 * is stated once here rather than as the eleventh copy of `rgba(0,0,0,0.55)`.
 * Same in both themes deliberately — a scrim's job is to darken whatever is
 * behind it, and a light-mode scrim over a light surface does not.
 */
const SCRIM = 'rgba(0,0,0,0.55)';

/**
 * How far below its resting place the panel starts.
 *
 * Measured, not guessed: `@keyframes mshUp { from { transform: translateY(100%) } }`
 * — 100% of the PANEL, not of the screen. So the travel is the panel's own
 * height, which means it has to be measured on layout. A fixed pixel start would
 * make a 200px picker and a 600px composer travel at different speeds for the
 * same duration, and the short one would begin visible.
 *
 * Until the first layout lands the panel is held transparent. One frame, and the
 * alternative is a flash of the sheet at its final position before it drops to
 * start.
 */
interface SheetProps {
  visible:  boolean;
  onClose:  () => void;
  children: React.ReactNode;
  /** Applied to the animated panel — the caller keeps its own shape and colour. */
  panelStyle?: StyleProp<ViewStyle>;
  /** Announced on the scrim, which is the tap-to-dismiss target. */
  closeLabel?: string;
  /** Set on any sheet containing a text field. See `Frame`. */
  avoidKeyboard?: boolean;
}

export default function Sheet({
  visible, onClose, children, panelStyle, closeLabel = 'Close', avoidKeyboard = false,
}: SheetProps) {
  const reduced = useReducedMotion();
  /**
   * ── §4 · ABOVE COMPACT A SHEET BECOMES A FORM SHEET ────────────────────────
   *
   * "A bottom sheet is a phone pattern: it is near the thumb because on a phone
   * the thumb is at the bottom. Pinned to the bottom edge of a 1376pt screen it
   * is a long reach from wherever you were reading. On tablets the new-task
   * sheet is centred, ~520pt wide, with the same field set."
   *
   * SAME FIELD SET is the operative half — this is a presentation change and
   * nothing else. Every caller passes the same children and none of them needs
   * to know, which is why the switch lives here rather than at the call sites.
   *
   * The travel shortens with it. A panel that rises 300pt into the middle of the
   * screen reads as a sheet that overshot; §3's Modal row is
   * `scale(.96)→1 + translateY(8px)`, and 8 is the number a centred panel wants.
   */
  const { cls } = useWindowClass(devicePlatform());
  const formSheet = cls !== 'compact';
  const [mounted, setMounted] = useState(visible);
  const [panelH, setPanelH] = useState(0);

  const scrim = useRef(new Animated.Value(0)).current;
  const panel = useRef(new Animated.Value(0)).current; // 0 = offscreen, 1 = resting

  // Enter once the panel has a height to travel. Both animations start together;
  // the scrim finishes first (220ms against 300ms) so the background has settled
  // by the time the panel arrives rather than after it.
  useEffect(() => {
    if (!visible || panelH === 0) return;
    Animated.parallel([
      Animated.timing(scrim, {
        toValue: 1,
        duration: duration(SHEET.scrimIn, reduced),
        easing: SHEET.scrimInEase,
        useNativeDriver: true,
      }),
      Animated.timing(panel, {
        toValue: 1,
        duration: duration(SHEET.in, reduced),
        easing: SHEET.inEase,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, panelH, reduced, scrim, panel]);

  // Exit. The Modal is held mounted for its length, which is the whole reason
  // `mounted` is separate from `visible`.
  useEffect(() => {
    if (visible) { setMounted(true); return; }
    if (!mounted) return;
    Animated.parallel([
      Animated.timing(panel, {
        toValue: 0,
        duration: duration(SHEET.out, reduced),
        easing: SHEET.outEase,
        useNativeDriver: true,
      }),
      Animated.timing(scrim, {
        toValue: 0,
        duration: duration(SHEET.scrimOut, reduced),
        easing: SHEET.scrimOutEase,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      // Only tear down on a completed exit. A re-open mid-dismissal cancels this
      // animation with `finished: false`, and unmounting then would close a sheet
      // the user just asked for again.
      if (finished) setMounted(false);
    });
  }, [visible, mounted, reduced, panel, scrim]);

  const onLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h > 0 && h !== panelH) setPanelH(h);
  }, [panelH]);

  if (!mounted) return null;

  /**
   * The travel. A bottom sheet climbs its own height; a form sheet rises 8pt,
   * per MOTION-SPEC §3's Modal row. Interpolating to a fixed 8 rather than to
   * `panelH` is what makes the centred presentation stop reading as a sheet
   * that came from the bottom of a very tall screen.
   */
  const translateY = panel.interpolate({
    inputRange: [0, 1],
    // The travel is the panel's own height, collapsed to 0 under reduced motion
    // so the sheet composes where it belongs instead of arriving there.
    outputRange: [amplitude(formSheet ? 8 : panelH, reduced), 0],
  });

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Frame avoidKeyboard={avoidKeyboard} style={formSheet ? s.centre : s.root}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM, opacity: scrim }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
          />
        </Animated.View>

        <Animated.View
          onLayout={onLayout}
          style={[
            panelStyle,
            // Centred and capped. `alignSelf` rather than a margin so the panel
            // keeps whatever shape the caller gave it — several pass their own
            // radius, and a bottom sheet's is square across the top.
            formSheet && { maxWidth: 520, width: '100%', alignSelf: 'center' },
            {
              transform: [{ translateY }],
              // Held out of sight for the single frame between mount and the
              // first layout, when the travel distance is not known yet.
              opacity: panelH === 0 ? 0 : 1,
            },
          ]}
        >
          {children}
        </Animated.View>
      </Frame>
    </Modal>
  );
}

/**
 * The centred variant. MOTION-SPEC §3, Modal row:
 *
 *   in   `scale(.96)→1` + `translateY(8px)` · `--dur-base`, 40ms after the scrim
 *   out  `scale(.98)` + fade · `--dur-fast`
 *
 * The 40ms offset is the detail worth keeping. `motion.css:260` writes it as
 * `animation-delay: calc(var(--dur-fast) * .3)` with `backwards` fill — 42ms —
 * so the scrim is already moving before the dialog appears over it. Without the
 * offset both arrive on the same frame and the dialog reads as having been there
 * all along.
 *
 * A confirm dialog stays CENTRED on mobile rather than becoming a sheet (§5:
 * "Confirm dialog · 400px — stays centred on mobile"). It is not navigation, and
 * a sheet reads as somewhere you went.
 */
interface DialogProps {
  visible:  boolean;
  onClose:  () => void;
  children: React.ReactNode;
  panelStyle?: StyleProp<ViewStyle>;
  closeLabel?: string;
  avoidKeyboard?: boolean;
}

export function Dialog({
  visible, onClose, children, panelStyle, closeLabel = 'Close', avoidKeyboard = false,
}: DialogProps) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const scrim = useRef(new Animated.Value(0)).current;
  const body  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.timing(scrim, {
        toValue: 1,
        duration: duration(SHEET.scrimIn, reduced),
        easing: SHEET.scrimInEase,
        useNativeDriver: true,
      }),
      Animated.timing(body, {
        toValue: 1,
        duration: duration(DUR.base, reduced),
        // §3's "40ms after the scrim". Collapsed with the duration, because a
        // delay in front of a 0ms animation is just a stutter.
        delay: duration(Math.round(DUR.fast * 0.3), reduced),
        easing: EASE.emph,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, reduced, scrim, body]);

  useEffect(() => {
    if (visible) { setMounted(true); return; }
    if (!mounted) return;
    Animated.parallel([
      Animated.timing(body, {
        toValue: 0,
        duration: duration(DUR.fast, reduced),
        easing: EASE.exit,
        useNativeDriver: true,
      }),
      Animated.timing(scrim, {
        toValue: 0,
        duration: duration(SHEET.scrimOut, reduced),
        easing: SHEET.scrimOutEase,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => { if (finished) setMounted(false); });
  }, [visible, mounted, reduced, body, scrim]);

  if (!mounted) return null;

  // Two different scales in and out — .96 rising, .98 falling — so the dialog
  // does not retrace its own entrance backwards. §7.3 again.
  const scale = body.interpolate({
    inputRange:  [0, 1],
    outputRange: [scaleTo(visible ? 0.96 : 0.98, reduced), 1],
  });
  const translateY = body.interpolate({
    inputRange:  [0, 1],
    outputRange: [amplitude(8, reduced), 0],
  });

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Frame avoidKeyboard={avoidKeyboard} style={s.centre}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM, opacity: scrim }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
          />
        </Animated.View>

        <Animated.View
          style={[panelStyle, { opacity: body, transform: [{ translateY }, { scale }] }]}
        >
          {children}
        </Animated.View>
      </Frame>
    </Modal>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, justifyContent: 'flex-end' },
  centre: { flex: 1, justifyContent: 'center' },
});
