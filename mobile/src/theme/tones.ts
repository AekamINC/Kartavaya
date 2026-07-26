/**
 * tones.ts — the notification "tone" colour map, once.
 *
 * A notification has a tone (mention, approval, assigned, comment, status,
 * success, danger, neutral) and three surfaces render a coloured badge for it:
 * `InboxScreen`, `MeScreen` and `NotificationBanner`. Each kept its own copy of
 * the map, and they had diverged in the way copies always do — two were written
 * against theme tokens and flipped correctly with dark mode, and the third was
 * eight hardcoded hexes and did not.
 *
 * ── What the hardcoded copy actually did ─────────────────────────────────────
 *
 * Measured over the real dark surface (#12151A), foreground against its own
 * translucent wash. These are ICON colours, so the threshold is WCAG 1.4.11's
 * 3:1 for non-text, not 4.5:1:
 *
 *     tone       light            dark
 *     assigned   5.17:1  pass     2.14:1  FAIL
 *     comment    4.22:1  pass     2.73:1  FAIL
 *     status     5.18:1  pass     2.45:1  FAIL
 *     success    4.15:1  pass     2.63:1  FAIL
 *     danger     4.14:1  pass     3.05:1  marginal
 *     approval   3.54:1  pass     3.07:1  marginal
 *     mention    3.52:1  pass     3.38:1  marginal
 *
 * Four tones below the non-text floor in dark mode, and the same colours were
 * correct in light — which is exactly the signature of a table that does not
 * flip. A `rgba(167,139,250,0.18)` wash designed to sit on cream sits on
 * near-black instead, and the violet icon on top of it all but disappears.
 *
 * The two token-driven copies were fine — every pair clears 3:1 in both themes,
 * worst case 4.07:1 — so this file adopts their values and the hardcoded copy is
 * the one that goes.
 *
 * Keeping it here rather than in any one component is the point: this map has
 * been written three times and gone wrong once. There is now one of it.
 */

import type { Tokens } from './tokens';
import type { NotifKind } from '../api/types';

/** The visual tones. Narrower than NotifKind — several kinds share a tone. */
export type Tone =
  | 'mention' | 'approval' | 'assigned' | 'comment'
  | 'status'  | 'success'  | 'danger'   | 'neutral';

/**
 * Notification kind → tone.
 *
 * Also duplicated three times previously, and it had drifted too: the banner
 * mapped `created` to neutral while the inbox omitted it entirely, so a
 * "created" notification got a tone in one surface and fell through to a
 * default in another.
 */
export const KIND_TONE: Record<NotifKind, Tone> = {
  mention:          'mention',
  comment:          'comment',
  approval_request: 'approval',
  approved:         'success',
  rejected:         'danger',
  assigned:         'assigned',
  status_changed:   'status',
  done:             'success',
  created:          'neutral',
};

/** Ionicons glyph per tone. */
export const TONE_ICON: Record<Tone, string> = {
  mention:  'at',
  approval: 'shield-checkmark',
  assigned: 'person',
  comment:  'chatbubble',
  status:   'layers',
  success:  'checkmark-circle',
  danger:   'flag',
  neutral:  'ellipse-outline',
};

export interface ToneColors {
  /** Badge container. */
  bg: string;
  /** Icon on that container. Non-text, so 3:1 is the bar. */
  fg: string;
}

/**
 * Tone colours for the CURRENT theme.
 *
 * Takes the resolved token set rather than the scheme name so that a caller
 * cannot pass one and render with the other — the mistake the deprecated
 * PRIORITY_COLOR / APPROVAL_COLOR maps in tokens.ts still allow.
 *
 * `assigned` deliberately pairs the violet `purple` (--ap-pending-client) with
 * `purpleContainer`. That container currently resolves to the TERTIARY ramp,
 * which is a peach — violet on peach is legible (4.48:1 light, 4.07:1 dark,
 * both over the 3:1 icon floor) but it is a hue mismatch, and there is no
 * purple container token on the web side to point at. Reported rather than
 * invented here: making one up in the mobile layer is precisely the drift this
 * file exists to end.
 */
export function toneColors(t: Tokens): Record<Tone, ToneColors> {
  return {
    mention:  { bg: t.secondaryContainer, fg: t.onSecondaryContainer },
    approval: { bg: t.tertiaryContainer,  fg: t.onTertiaryContainer },
    assigned: { bg: t.purpleContainer,    fg: t.purple },
    comment:  { bg: t.primaryContainer,   fg: t.onPrimaryContainer },
    status:   { bg: t.secondaryContainer, fg: t.onSecondaryContainer },
    success:  { bg: t.primaryContainer,   fg: t.onPrimaryContainer },
    danger:   { bg: t.errorBg,            fg: t.error },
    neutral:  { bg: t.surface2,           fg: t.ink2 },
  };
}

/** Convenience: colours for one notification kind. */
export function toneFor(t: Tokens, kind: NotifKind): ToneColors & { icon: string; tone: Tone } {
  const tone = KIND_TONE[kind] ?? 'neutral';
  return { ...toneColors(t)[tone], icon: TONE_ICON[tone], tone };
}
