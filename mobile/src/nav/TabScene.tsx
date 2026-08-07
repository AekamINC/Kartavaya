/**
 * TabScene — the tab CHANGE, which this app did not have.
 *
 * ── What was missing ────────────────────────────────────────────────────────
 *
 * `@react-navigation/bottom-tabs` v6 has no scene animation. Tabs cut, hard, on
 * the frame the press lands. That is not a stylistic gap: with five tabs that
 * each open onto a full-bleed list, the only thing distinguishing "I switched
 * tab" from "the list I was reading re-rendered" is that the content changed.
 *
 * The reference animates it and says which direction you went:
 *
 *   `motion.css:186`  `.dm-tabs__p { animation: dmPanel var(--dur-base) var(--ease-emph) }`
 *   `motion.css:187`  `@keyframes dmPanel { from { opacity: 0; transform: translateX(var(--dx)) } }`
 *   `IxDrawer.jsx:373` `style={{ '--dx': dir > 0 ? '10px' : '-10px' }}`
 *
 * The SIGN is the information. A panel that always enters from the same side
 * says nothing about which way you moved through the bar; entering from the
 * right when you went right is the same spatial promise a stack push makes.
 *
 * ── Reduced motion ──────────────────────────────────────────────────────────
 *
 * `amplitude()` takes the 10px to 0 and `duration()` takes the 220ms to 0, so
 * the scene simply appears — the same answer `theme/motion.ts` gives everywhere
 * else, and the correct one here: a tab change is a destination, and there is no
 * information in the travel that the new content does not already carry.
 *
 * ── THE FADE IS GONE, AND ON PURPOSE ────────────────────────────────────────
 *
 * 2026-08-07. The owner reported a tablet showing the navigation rail beside a
 * completely empty pane. It was this file.
 *
 * The scene used to open at `opacity: 0` and animate up to 1. On this build —
 * Expo 54 / RN 0.81 / Fabric, `newArchEnabled=true` — that native-driver
 * animation does not complete, so every scene stayed at zero and the app was a
 * blank rectangle with working navigation beside it. Confirmed on an 800dp
 * emulator, twice in each direction, each after a COLD RESTART: with the
 * opacity binding the pane is empty; without it Today renders in full.
 *
 * The root cause is unproven and it is the same family as
 * `components/Refresher.tsx` — an old-architecture assumption that fails
 * silently under Fabric rather than throwing.
 *
 * So the rule this file now follows: **a scene's visibility is never gated on
 * an animation completing.** Opacity is not animated at all. `translateX`
 * still carries the direction cue, because the worst a stuck translate can do
 * is leave a pane 10px off — it cannot hide the product. Do not reinstate the
 * fade to get the effect back without first proving on a device that the
 * animation reaches its `toValue`.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useIsFocused, useNavigationState } from '@react-navigation/native';
import { amplitude, duration, useReducedMotion, TAB } from '../theme/motion';

/**
 * Wraps a tab screen component. Used as `component={TabScene.wrap(TodayScreen)}`
 * rather than as a nested element, so the screen keeps its own identity in the
 * navigator and its own state across tab presses.
 */
export function withTabTransition<P extends object>(
  Screen: React.ComponentType<P>,
): React.ComponentType<P> {
  return function TabSceneWrapper(props: P) {
    return (
      <TabScene>
        <Screen {...props} />
      </TabScene>
    );
  };
}

export default function TabScene({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const focused = useIsFocused();

  // The index of the tab navigator this scene belongs to. Read from the state
  // rather than tracked locally, so a tab reached by a deep link or a
  // programmatic navigate animates the same way a press does.
  const index = useNavigationState(state => state.index);
  const previous = useRef(index);

  const anim = useRef(new Animated.Value(1)).current;
  // Signed travel, in px. Held in a ref because it is read during the effect
  // that starts the animation and must not itself trigger a render.
  const dx = useRef(0);

  useEffect(() => {
    if (!focused) {
      // Reset while off-screen so the next focus starts from the beginning
      // rather than wherever an interrupted animation stopped.
      previous.current = index;
      return;
    }

    const from = previous.current;
    previous.current = index;

    // FIRST FOCUS IS NOT A TAB CHANGE. Animating it made the mount path depend
    // on an animation, which is the half of the bug that was reachable without
    // touching the bar at all — see the header.
    if (from === index) {
      anim.setValue(1);
      return;
    }

    const direction = index >= from ? 1 : -1;
    dx.current = amplitude(TAB.panelDx, reduced) * direction;

    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: duration(TAB.panel, reduced),
      easing: TAB.panelEase,
      useNativeDriver: true,
    }).start(({ finished }) => {
      // An interrupted animation must still come to REST, not stop wherever it
      // was. Without this a scene torn down mid-transition returns at whatever
      // offset it had reached.
      if (!finished) anim.setValue(1);
    });
  }, [focused, index, reduced, anim]);

  return (
    <Animated.View
      style={[
        s.fill,
        {
          /*
           * NO OPACITY. This is the whole of the fix, and it is a deliberate
           * loss of the fade — see the header.
           */
          transform: [{
            translateX: anim.interpolate({
              inputRange:  [0, 1],
              outputRange: [dx.current, 0],
            }),
          }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
});
