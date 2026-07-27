/**
 * Enough of `react-native` to load a `.ts` module that imports it.
 *
 * This is NOT a renderer and is not trying to become one. Node's type-stripping
 * does not transform JSX, so no `.tsx` file can be loaded in this suite at all —
 * this stub only exists so that plain `.ts` modules which import a type or
 * `StyleSheet` from `react-native` (notably `theme/fonts.ts`) can be exercised.
 *
 * `StyleSheet.create` is the identity function, which is what the real one
 * effectively is on modern RN — it returns the object it was given. That means a
 * style object read back in a test is the same one the app ships.
 *
 * The type-only names (`TextStyle`, `ViewStyle`, `StyleProp`) are exported as
 * runtime values because the app imports them with a plain `import {}` rather
 * than `import type {}`. Node strips types but not the import statement, so the
 * named binding has to exist or module linking fails.
 */

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  flatten: (style: unknown) => (Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style),
  hairlineWidth: 1,
};

export const Platform = {
  OS: 'ios' as 'ios' | 'android',
  select: <T,>(spec: { ios?: T; android?: T; default?: T }): T | undefined =>
    spec.ios ?? spec.default,
  Version: 17,
};

export const Dimensions = {
  get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  addEventListener: () => ({ remove: () => undefined }),
};

// Type-only names the app imports as values. See the header.
export const TextStyle = undefined;
export const ViewStyle = undefined;
export const ImageStyle = undefined;
export const StyleProp = undefined;

// Components are placeholders — nothing in this suite renders.
export const View = 'View';
export const Text = 'Text';
export const Pressable = 'Pressable';
export const TouchableOpacity = 'TouchableOpacity';
export const ActivityIndicator = 'ActivityIndicator';
export const ScrollView = 'ScrollView';
// Erasable syntax only — no `enum`, no parameter properties. Node strips types
// rather than compiling them, so `constructor(public v: number)` is a hard
// parse error here, not a style preference. Same rule as `screenStatus.ts`.
class AnimatedValue {
  value: number;
  constructor(value: number) { this.value = value; }
  setValue(next: number): void { this.value = next; }
  interpolate(): AnimatedValue { return this; }
}

export const Animated = {
  Value: AnimatedValue,
  View: 'Animated.View',
  Text: 'Animated.Text',
  timing: () => ({ start: () => undefined }),
  sequence: () => ({ start: () => undefined }),
  parallel: () => ({ start: () => undefined }),
  spring: () => ({ start: () => undefined }),
};
export const Easing = { bezier: () => undefined, out: (x: unknown) => x, ease: undefined };
export const AccessibilityInfo = {
  isReduceMotionEnabled: async () => false,
  addEventListener: () => ({ remove: () => undefined }),
};
export const Appearance = {
  getColorScheme: () => 'light',
  addChangeListener: () => ({ remove: () => undefined }),
};
