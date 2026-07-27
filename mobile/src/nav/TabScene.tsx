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

    const direction = index >= previous.current ? 1 : -1;
    previous.current = index;
    dx.current = amplitude(TAB.panelDx, reduced) * direction;

    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: duration(TAB.panel, reduced),
      easing: TAB.panelEase,
      useNativeDriver: true,
    }).start();
  }, [focused, index, reduced, anim]);

  return (
    <Animated.View
      style={[
        s.fill,
        {
          opacity: anim,
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
