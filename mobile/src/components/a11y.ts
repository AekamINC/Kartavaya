/**
 * a11y.ts — Accessibility prop factories
 * ───────────────────────────────────────
 * Helpers that return the correct RN accessibility props.
 * Import and spread onto Touchable* / Pressable components.
 *
 * Usage:
 *   <TouchableOpacity {...a11yButton('Mark task done')} onPress={...}>
 *   <View {...a11yHeading('Today')}>
 *   <TextInput {...a11yInput('Task title', 'Enter the task title')} />
 */

import type { AccessibilityRole, Insets } from 'react-native';

/**
 * The minimum touch target, from MOTION-SPEC §5's Touch column: `Row height 44px
 * minimum`, and explicitly for the smallest control in the app —
 * `Checkbox / tick | 20–22px, 44px hit area`. Same number as the iOS HIG and
 * WCAG 2.2 SC 2.5.8's enhanced target size.
 */
export const MIN_TOUCH = 44;

/**
 * The `hitSlop` that grows a control of `size` px up to MIN_TOUCH.
 *
 * `hitSlop` is the right tool here and padding is not. The spec asks for two
 * different numbers at once — a 20px checkbox that is 44px to the finger — and
 * padding cannot do that, because padding grows the drawn box too. hitSlop
 * extends only the touch region, leaving the visual size alone.
 *
 * Measured state of the app when this was written: of the touch targets that
 * declare an explicit size, most were under 44px and only a handful used
 * hitSlop at all. The starkest is the subtask checkbox — `{ width: 20, height:
 * 20 }` with no slop, i.e. exactly the visual size the spec asks for and none of
 * the hit area it asks for in the same sentence.
 *
 *     <TouchableOpacity style={s.checkbox} hitSlop={hitSlopTo(20)} …>
 *
 * Returns undefined when the control is already large enough, so it can be
 * spread unconditionally without adding a pointless prop.
 */
export function hitSlopTo(size: number, min = MIN_TOUCH): Insets | undefined {
  const grow = (min - size) / 2;
  if (grow <= 0) return undefined;
  return { top: grow, bottom: grow, left: grow, right: grow };
}

/** Interactive button / pressable element */
export function a11yButton(label: string, hint?: string) {
  return {
    accessible:           true as const,
    accessibilityRole:    'button' as AccessibilityRole,
    accessibilityLabel:   label,
    ...(hint ? { accessibilityHint: hint } : {}),
  };
}

/** Link that navigates somewhere */
export function a11yLink(label: string, hint?: string) {
  return {
    accessible:           true as const,
    accessibilityRole:    'link' as AccessibilityRole,
    accessibilityLabel:   label,
    ...(hint ? { accessibilityHint: hint } : {}),
  };
}

/** Screen section heading */
export function a11yHeading(label: string) {
  return {
    accessible:           true as const,
    accessibilityRole:    'header' as AccessibilityRole,
    accessibilityLabel:   label,
  };
}

/** Text input / form field */
export function a11yInput(label: string, hint?: string) {
  return {
    accessibilityLabel: label,
    ...(hint ? { accessibilityHint: hint } : {}),
    accessible: true as const,
  };
}

/** Toggle / checkbox */
export function a11yToggle(label: string, checked: boolean, hint?: string) {
  return {
    accessible:             true as const,
    accessibilityRole:      'checkbox' as AccessibilityRole,
    accessibilityLabel:     label,
    accessibilityState:     { checked },
    ...(hint ? { accessibilityHint: hint } : {}),
  };
}

/** Image with description */
export function a11yImage(label: string) {
  return {
    accessible:           true as const,
    accessibilityRole:    'image' as AccessibilityRole,
    accessibilityLabel:   label,
  };
}

/** Pure display element that should be announced */
export function a11yText(label: string) {
  return {
    accessible:        true as const,
    accessibilityLabel: label,
  };
}

/** Mark as a selected item in a list (e.g. active tab) */
export function a11ySelected(label: string, selected: boolean) {
  return {
    accessible:          true as const,
    accessibilityLabel:  label,
    accessibilityState:  { selected },
  };
}
