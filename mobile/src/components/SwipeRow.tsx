import React, { useCallback, useRef, useState } from 'react';
import {
  Animated, View, Text, StyleSheet, Platform, Vibration,
  type AccessibilityActionEvent,
} from 'react-native';
import {
  PanGestureHandler,
  type PanGestureHandlerGestureEvent,
  type PanGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { settle, useReducedMotion } from '../theme/motion';

/**
 * One swipe primitive, used by tasks, approvals and messages.
 *
 * 17-mobile-app.md is explicit that this exists exactly once: "Tasks, approvals
 * and messages all swipe; three implementations would drift in threshold, haptic
 * timing and colour." So the threshold, the commit feel and the action colours
 * live here and nowhere else.
 *
 * Built on PanGestureHandler rather than PanResponder deliberately. These rows
 * live inside a vertically-scrolling FlatList, and `activeOffsetX` with
 * `failOffsetY` hands the gesture to the list the moment the finger travels more
 * vertically than horizontally. PanResponder has to arbitrate that by hand and
 * loses often enough to feel broken.
 *
 * RN's own Animated rather than Reanimated, because Reanimated is not a
 * dependency of this app. `useNativeDriver` keeps the translation off the JS
 * thread, which is what matters for a drag.
 *
 * A SWIPE IS NEVER THE ONLY WAY TO DO THE THING. Every action is also exposed as
 * an `accessibilityAction`, so VoiceOver and TalkBack users get it from the
 * actions rotor. A gesture-only affordance is invisible to a screen reader and
 * impossible for anyone with limited fine motor control.
 */

/** Travel before the action commits. One number, shared by every swipe surface. */
export const SWIPE_THRESHOLD = 84;

/**
 * Beyond this the row is dragged but will not commit further.
 *
 * NOT passed through `amplitude()`, and that is deliberate. Reduced motion
 * suppresses motion the SYSTEM starts, not the pixels a finger is currently
 * dragging — collapsing this to 0 would leave the row welded in place under the
 * touch and make the whole gesture undiscoverable for the users most likely to
 * be relying on the accessibility action instead. What does collapse is the
 * release: `settle` goes to 0ms, so the row returns without the spring.
 */
const MAX_TRAVEL = 132;

export interface SwipeAction {
  /** Shown behind the row as it opens, and used as the accessibility action label. */
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Background behind the row. Pass a theme token, never a literal. */
  color: string;
  /** Icon and label colour on that background. */
  onColor?: string;
  onTrigger: () => void;
}

export interface SwipeRowProps {
  children: React.ReactNode;
  /** Revealed by swiping right — the affirmative action (complete, approve). */
  right?: SwipeAction;
  /** Revealed by swiping left — the negative one (decline, archive). */
  left?: SwipeAction;
  /** Disable the gesture without unmounting, e.g. while a mutation is in flight. */
  disabled?: boolean;
  /** Describes the row itself to a screen reader. */
  accessibilityLabel?: string;
}

/**
 * Commit feedback, as 17's platform table specifies: `impactAsync` on iOS, a
 * short `Vibration` pulse on Android.
 *
 * Not the same call on both, deliberately. `Vibration.vibrate` on iOS is a fixed
 * ~400ms buzz with no intensity control, which for a swipe confirmation reads as
 * an error rather than an acknowledgement. iOS gets the light impact; Android
 * gets 12ms, which is the shortest pulse most devices render distinctly.
 *
 * Failure here is swallowed on purpose. A device with haptics disabled, or an
 * emulator with no motor, must not turn a completed swipe into a rejected
 * promise — the action already happened.
 */
function commitFeedback() {
  if (Platform.OS === 'ios') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    return;
  }
  Vibration.vibrate(12);
}

/**
 * Fired the first time a drag crosses SWIPE_THRESHOLD, before the finger lifts.
 *
 * Without it the row is a guess: the action panel is showing from the first
 * pixel of travel, so there is nothing on screen that distinguishes "open" from
 * "far enough to commit", and the only way to learn which one you were at is to
 * let go and see what happened. MOTION-SPEC §7.1 — never lie about state — and
 * an affordance that reveals its threshold only after the irreversible part is
 * the same defect in gesture form.
 *
 * Deliberately lighter than `commitFeedback`. This one says "release now and it
 * will happen"; that one says "it happened". Two identical taps would make the
 * second meaningless.
 */
function armFeedback() {
  if (Platform.OS === 'ios') {
    void Haptics.selectionAsync().catch(() => {});
    return;
  }
  Vibration.vibrate(8);
}

export default function SwipeRow({
  children, right, left, disabled = false, accessibilityLabel,
}: SwipeRowProps) {
  const { t } = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  // The shared signal from theme/motion, not a fourth private copy of the
  // AccessibilityInfo subscription. This component had its own before that file
  // existed; keeping it meant a change to the reduced-motion policy had to be
  // made in two places and was made in one.
  const reduceMotion = useReducedMotion();
  const [revealed, setRevealed] = useState<'left' | 'right' | null>(null);
  /** True once this drag has crossed the commit threshold. Reset on each new drag. */
  const armed = useRef(false);

  const settleBack = useCallback(() => {
    setRevealed(null);
    armed.current = false;
    // `settle` is a 220ms timing on --ease-spring, which is what the reference
    // is: `mobile.css:72` `.mtask--sw { transition: transform var(--dur-base)
    // var(--ease-spring) }`. It collapses to 0ms under reduced motion, so the
    // explicit `setValue` branch this used to need is gone.
    settle(translateX, 0, reduceMotion).start();
  }, [reduceMotion, translateX]);

  const onGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: translateX } }],
    {
      useNativeDriver: true,
      // Runs alongside the native-driven translation. The only work here is the
      // one-shot arm haptic; the drag itself never touches the JS thread.
      listener: (e: PanGestureHandlerGestureEvent) => {
        const past = Math.abs(e.nativeEvent.translationX) >= SWIPE_THRESHOLD;
        const action = e.nativeEvent.translationX > 0 ? right : left;
        if (past && action && !armed.current) {
          armed.current = true;
          armFeedback();
        } else if (!past && armed.current) {
          // Dragged back under the threshold. Re-arming is silent: a finger
          // hovering on the boundary would otherwise buzz on every crossing.
          armed.current = false;
        }
      },
    },
  );

  const onHandlerStateChange = useCallback((e: PanGestureHandlerStateChangeEvent) => {
    const { translationX, state } = e.nativeEvent;

    if (state === State.BEGAN) { armed.current = false; return; }

    if (state === State.ACTIVE) {
      const dir = translationX > 0 ? 'right' : translationX < 0 ? 'left' : null;
      // Only reveal a side that actually has an action, so a one-sided row does
      // not open onto an empty coloured panel.
      if (dir === 'right' && right) setRevealed('right');
      else if (dir === 'left' && left) setRevealed('left');
      return;
    }

    if (state === State.END || state === State.CANCELLED || state === State.FAILED) {
      const past = Math.abs(translationX) >= SWIPE_THRESHOLD;
      const action = translationX > 0 ? right : left;
      if (state === State.END && past && action) {
        commitFeedback();
        // Settle first, then fire. Firing while the row is still open leaves the
        // action panel showing under a row that is about to unmount or re-render.
        settleBack();
        action.onTrigger();
        return;
      }
      settleBack();
    }
  }, [left, right, settleBack]);

  const actions = [
    ...(right ? [{ name: 'swipe-right', label: right.label }] : []),
    ...(left ? [{ name: 'swipe-left', label: left.label }] : []),
  ];

  const onAccessibilityAction = useCallback((e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'swipe-right') right?.onTrigger();
    if (e.nativeEvent.actionName === 'swipe-left') left?.onTrigger();
  }, [left, right]);

  const active = revealed === 'right' ? right : revealed === 'left' ? left : null;

  return (
    <View
      style={s.wrap}
      accessible={false}
      accessibilityActions={actions.length ? actions : undefined}
      onAccessibilityAction={actions.length ? onAccessibilityAction : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      {/* Action panel. Rendered under the row and only while a side is open, so
          a resting row costs nothing and shows no colour. */}
      {active && (
        <View
          style={[
            s.panel,
            {
              backgroundColor: active.color,
              justifyContent: revealed === 'right' ? 'flex-start' : 'flex-end',
            },
          ]}
          pointerEvents="none"
        >
          <View style={s.panelInner}>
            <Ionicons name={active.icon} size={19} color={active.onColor ?? '#FFFFFF'} />
            <Text style={[s.panelLabel, { color: active.onColor ?? '#FFFFFF' }]}>
              {active.label}
            </Text>
          </View>
        </View>
      )}

      <PanGestureHandler
        enabled={!disabled}
        onGestureEvent={onGestureEvent}
        onHandlerStateChange={onHandlerStateChange}
        // Hands the gesture back to the enclosing list as soon as the finger is
        // travelling vertically. Without failOffsetY a diagonal drag steals the
        // scroll and the list feels stuck.
        activeOffsetX={[-12, 12]}
        failOffsetY={[-14, 14]}
      >
        <Animated.View
          style={{
            transform: [{
              translateX: translateX.interpolate({
                inputRange: [-MAX_TRAVEL * 2, -MAX_TRAVEL, 0, MAX_TRAVEL, MAX_TRAVEL * 2],
                // Clamped past MAX_TRAVEL so the row cannot be dragged off screen,
                // and clamped to 0 on a side with no action.
                outputRange: [
                  left ? -MAX_TRAVEL : 0, left ? -MAX_TRAVEL : 0,
                  0,
                  right ? MAX_TRAVEL : 0, right ? MAX_TRAVEL : 0,
                ],
              }),
            }],
            backgroundColor: t.bg,
          }}
        >
          {children}
        </Animated.View>
      </PanGestureHandler>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'relative' },
  panel: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  panelInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // 11px is 00 §12's metadata floor. This label is a confirmation of an action
  // in progress, so it does not go below it.
  panelLabel: { fontSize: 12.5, fontWeight: '700' },
});
