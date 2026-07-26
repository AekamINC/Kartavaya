import { lightPalette, darkPalette } from './palette.generated';
import type { GeneratedTokenName } from './palette.generated';
import { FAMILY } from './fonts';

export type ColorScheme = 'light' | 'dark';

/**
 * Brand gradients. #0082c6 and #03a1b6 were the retired brand blue and its
 * midpoint (00 §9); the ramp is the deep → mid → vivid teal stops, matching
 * --k-grad on the web.
 *
 * Both arities exist because LinearGradient's `colors` prop is tuple-typed and
 * eleven call sites wanted two stops rather than three. Without a canonical
 * two-stop pair each of them wrote `['#0082c6', '#05b7aa']` by hand, which is
 * how the retired blue outlived its own removal.
 */
const brand = {
  gradient:  ['#026B64', '#04837A', '#05b7aa'] as [string, string, string],
  gradient2: ['#04837A', '#05b7aa'] as [string, string],
  teal: '#05b7aa',
  blue: '#04837A',
  mid:  '#04837A',
};

/** For call sites that only need the ramp and not the whole theme. */
export const BRAND = brand;
export const BRAND_GRADIENT = brand.gradient;
export const BRAND_GRADIENT_2 = brand.gradient2;

/**
 * The palette is DERIVED, not transcribed.
 *
 * 17-mobile-app.md is emphatic about why: React Native has no CSS custom
 * properties, so this file must hold literals, which makes it the one place in
 * the system that cannot alias and therefore the one guaranteed to go stale. It
 * did, twice. Values now come from `palette.generated.ts`, produced by
 * `npm run tokens` from the web stylesheets, with every var() alias resolved.
 *
 * Only the MAPPING is by hand, because the mobile API predates the CSS names and
 * twenty files consume it: `success` is `--ok`, `approval` is `--warn`, `error`
 * is `--danger`. Renaming a CSS token now breaks this map at compile time
 * instead of leaving a colour quietly undefined.
 *
 * Generating it immediately caught real drift: dark `bg` was #101311 here while
 * the stylesheets had moved to #0C0E11, and the dark surface ramp had diverged
 * at every step.
 */
// `p` is typed as a record of plain strings rather than `typeof lightPalette`
// on purpose. The generated file is `as const`, so its values are literal string
// types; letting those propagate makes every token here a one- or two-member
// union, and `colors.surfaceLow = colors.errorBg` then fails to compile for
// being the wrong literal rather than the wrong colour. The key names stay
// checked — GeneratedTokenName is the union of what the generator emitted, so a
// renamed CSS token still breaks this map at compile time.
const mapPalette = (p: Record<GeneratedTokenName, string>) => ({
  // Surfaces
  bg:         p.bg,
  surface:    p.surface,
  surfaceLow: p.sLow,
  surfaceHigh: p.sHigh,
  // M3 surface levels — the --s-* ramp, lowest to highest
  surface1: p.surface,
  surface2: p.sLow,
  surface3: p.sContainer,
  surface4: p.sHigh,
  surface5: p.sHighest,
  // M3 secondary / tertiary
  secondaryContainer:   p.secondaryContainer,
  onSecondaryContainer: p.onSecondaryContainer,
  tertiaryContainer:    p.tertiaryContainer,
  onTertiaryContainer:  p.onTertiaryContainer,
  // Text
  onSurface:      p.onSurface,
  onSurfaceVar:   p.onSurface2,
  onSurfaceVar2:  p.onSurface3,
  onSurfaceFaint: p.onSurfaceFaint,
  // Shorthand aliases, same values
  ink:  p.onSurface,
  ink2: p.onSurface2,
  ink3: p.onSurface3,
  ink4: p.onSurfaceFaint,
  // Primary. `primaryText` is the one to use for TEXT — `primary` is 4.04:1 on
  // the light canvas and is a fill (00 §7). `primaryHover` reverses direction by
  // theme, so never derive a pressed state by subtracting luminance.
  primary:            p.primary,
  primaryText:        p.primaryText,
  primaryHover:       p.primaryHover,
  primaryContainer:   p.primaryContainer,
  onPrimary:          p.onPrimary,
  onPrimaryContainer: p.onPrimaryContainer,
  // Accents. Mobile names on the left predate the CSS names on the right.
  approval:   p.warn,
  approvalBg: p.warnContainer,
  error:      p.danger,
  errorBg:    p.dangerContainer,
  success:    p.ok,
  successBg:  p.okContainer,
  // Foregrounds for the three accent fills. These arrived with the token layer's
  // dark-mode pass — before it there was no --on-danger at all, so text on a
  // danger fill had to be hardcoded white, which fails against dark mode's
  // lighter salmon danger. Pair each `*Bg` with its `on*Container`, and a solid
  // `error` fill with `onError`.
  onError:            p.onDanger,
  onErrorContainer:   p.onDangerContainer,
  onSuccessContainer: p.onOkContainer,
  onApprovalContainer: p.onWarnContainer,
  // Text that is present but not actionable. Distinct from `ink4`: onSurfaceFaint
  // was DARKENED for contrast in this pass (#9DA096 → #666A61) and its old value
  // became onSurfaceDisabled, so the two are no longer interchangeable.
  inkDisabled: p.onSurfaceDisabled,
  // `purple` was a local invention for the waiting-on-client approval state.
  // --ap-pending-client is the token that actually means that, and 00 §9 keeps
  // it a different hue from --ap-pending on purpose: "waiting on us" versus
  // "waiting on the client" is the distinction the approval flow exists for.
  purple:          p.apPendingClient,
  purpleContainer: p.tertiaryContainer,
  // Borders
  outline:    p.outline,
  outlineVar: p.outlineVariant,
});

const light = {
  ...mapPalette(lightPalette),
  // iOS translucent tab bar. Stays hand-written: RN needs a literal rgba and
  // there is no CSS token for a blurred bar, which is a platform affordance the
  // web does not have.
  tabBg: 'rgba(250,247,240,0.78)',
  // Brand (same both themes for CTAs)
  ...brand,
};

const dark = {
  ...mapPalette(darkPalette),
  tabBg: 'rgba(18,21,26,0.78)',
  ...brand,
};

export type Tokens = typeof light;
export const tokens: Record<ColorScheme, Tokens> = { light, dark };

/**
 * Priority, status and approval colours, from the generated palette.
 *
 * These were four and four arbitrary hexes — #dc2626, #ef4444, #f59e0b, #22c55e
 * and so on — which is the ninth independent status map the product had, and it
 * disagreed with all the others. 00 §9 defines --pr-*, --st-* and --ap-* for
 * exactly this, and half of them alias --ok / --warn / --danger, which is why one
 * contrast fix propagated to every chip on the web and none of it reached here.
 *
 * They FLIP with the theme (00 §9), so these are functions of the scheme rather
 * than constants. The old comment claimed priority was "same both themes"; that
 * was the bug, not the design — a red that reads on cream is not the red that
 * reads on near-black.
 */
const priorityFor = (p: typeof lightPalette | typeof darkPalette): Record<string, string> => ({
  urgent: p.prUrgent,
  high:   p.prHigh,
  medium: p.prMedium,
  low:    p.prLow,
});

const approvalFor = (p: typeof lightPalette | typeof darkPalette): Record<string, string> => ({
  pending:        p.apPending,
  // Kept a different hue from `pending` deliberately. 00 §9: "waiting on us"
  // versus "waiting on the client" is the distinction the approval flow exists
  // to communicate, and a draft that aliased them made the two byte-identical.
  pending_client: p.apPendingClient,
  approved:       p.apApproved,
  rejected:       p.apRejected,
});

const statusFor = (p: typeof lightPalette | typeof darkPalette): Record<string, string> => ({
  todo:        p.stTodo,
  in_progress: p.stInProgress,
  in_review:   p.stInReview,
  requested:   p.stRequested,
  done:        p.stDone,
  rejected:    p.stRejected,
});

export const PRIORITY_COLORS: Record<ColorScheme, Record<string, string>> = {
  light: priorityFor(lightPalette),
  dark:  priorityFor(darkPalette),
};
export const APPROVAL_COLORS: Record<ColorScheme, Record<string, string>> = {
  light: approvalFor(lightPalette),
  dark:  approvalFor(darkPalette),
};
export const STATUS_COLORS: Record<ColorScheme, Record<string, string>> = {
  light: statusFor(lightPalette),
  dark:  statusFor(darkPalette),
};

/**
 * Light-mode maps, kept so the existing call sites compile unchanged.
 *
 * @deprecated Read PRIORITY_COLORS[scheme] / APPROVAL_COLORS[scheme] instead.
 * These two ignore the theme, so a dark-mode chip gets the light-mode hue — the
 * defect they used to have with arbitrary hexes, now merely narrower. Every
 * consumer already calls useTheme() and has `scheme` to hand.
 */
export const PRIORITY_COLOR: Record<string, string> = PRIORITY_COLORS.light;
export const APPROVAL_COLOR: Record<string, string> = APPROVAL_COLORS.light;

/**
 * Translucent tint of a token colour.
 *
 * Replaces the `color + '18'` string concatenation that call sites were using to
 * fake a wash. That works only for a 6-digit hex: the generated palette also
 * carries rgb() and rgba() values (20 of them), and `'rgb(12,14,17)' + '18'` is
 * not a colour at all — RN drops the style and the element renders transparent.
 *
 * `alpha` is 0–1, matching CSS rather than the raw hex byte the concat produced.
 */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));

  const hex = color.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (short) {
    const [, r, g, b] = short;
    return `rgba(${parseInt(r + r, 16)},${parseInt(g + g, 16)},${parseInt(b + b, 16)},${a})`;
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(hex);
  if (long) {
    const [, r, g, b] = long;
    return `rgba(${parseInt(r, 16)},${parseInt(g, 16)},${parseInt(b, 16)},${a})`;
  }
  // rgb() / rgba() — take the three channels and restate the alpha, so an
  // already-translucent token does not compound its own transparency.
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(hex);
  if (rgb) {
    const [, r, g, b] = rgb;
    return `rgba(${r},${g},${b},${a})`;
  }
  // Unrecognised (a named colour, or something new in the palette). Returning it
  // unchanged renders the solid colour, which is wrong but visible — better than
  // an invalid string that renders nothing.
  return color;
}

/**
 * Deterministic project colour from team_id.
 *
 * These are identity colours, not semantic ones — they exist to tell two
 * projects apart at a glance, so they are deliberately a wide spread of hues
 * rather than accent derivatives, and they do not flip with the theme (a project
 * that is violet must stay violet in both, or the mapping stops being learnable).
 *
 * #0082c6 has been replaced. It led both this list and AVATAR_COLORS, so the
 * first project and the first user in every org were painted the brand blue that
 * 00 §9 retired — the most visible possible place for it to survive.
 */
const PROJECT_PALETTE = [
  '#05b7aa','#8b5cf6','#ec4899','#f59e0b',
  '#10b981','#6366f1','#ef4444','#14b8a6',
  '#f97316','#3E5C8A',
];
export function projectColor(teamId: string, override?: string | null): string {
  if (override) return override;
  let hash = 0;
  for (let i = 0; i < teamId.length; i++) hash = teamId.charCodeAt(i) + ((hash << 5) - hash);
  return PROJECT_PALETTE[Math.abs(hash) % PROJECT_PALETTE.length];
}

/**
 * Avatar initials colours. Identity, like PROJECT_PALETTE — stable across themes
 * so a colleague's avatar does not change colour when the user switches to dark.
 * `#0082c6` dropped for the same reason it was dropped there.
 *
 * Three components each kept a private copy of this array, all of them starting
 * with the retired blue. They now import this one.
 */
export const AVATAR_COLORS = [
  '#05b7aa','#8b5cf6','#ec4899','#f59e0b','#10b981','#6366f1','#3E5C8A',
];
export function userInitials(name: string): string {
  const parts = (name || '').trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] || '?').toUpperCase();
}
export function avatarColor(userId: string, index?: number): string {
  if (index !== undefined) return AVATAR_COLORS[index % AVATAR_COLORS.length];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Typography scale.
//
// Families come from FAMILY rather than being spelled again here. They were
// duplicated as string literals in both files, which is one rename away from a
// silent fallback to the system face.
//
// `labelHindi` carries no fontWeight: Tiro Devanagari Hindi ships only a 400, so
// a weight above that is synthesised and a Hindi phrase renders in two weights.
// See theme/fonts.ts.
export const type = {
  displaySerif: { fontFamily: FAMILY.display, fontWeight: '400' as const },
  titleSerif:   { fontFamily: FAMILY.display, fontWeight: '400' as const },
  labelHindi:   { fontFamily: FAMILY.devanagari },
  mono:         { fontFamily: FAMILY.mono, fontWeight: '400' as const },
  // UI sizes
  xs:   { fontSize: 11, lineHeight: 15 },
  sm:   { fontSize: 13, lineHeight: 18 },
  base: { fontSize: 15, lineHeight: 22 },
  lg:   { fontSize: 17, lineHeight: 24 },
  xl:   { fontSize: 20, lineHeight: 28 },
  xxl:  { fontSize: 26, lineHeight: 32 },
  hero: { fontSize: 34, lineHeight: 40 },
};

// Spacing
export const space = {
  1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40,
};

// Radii
export const radius = {
  sm:  8,
  md:  12,
  lg:  16,
  xl:  22,
  full: 999,
};
