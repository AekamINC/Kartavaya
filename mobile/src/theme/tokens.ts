export type ColorScheme = 'light' | 'dark';

const brand = {
  // #0082c6 and #03a1b6 were the retired brand blue and its midpoint (00 §9).
  // The ramp is now the deep → mid → vivid teal stops, matching --k-grad.
  gradient: ['#026B64', '#04837A', '#05b7aa'] as string[],
  teal:     '#05b7aa',
  blue:     '#04837A',
  mid:      '#04837A',
};

const light = {
  // Surfaces
  bg:             '#F3EFE6',
  surface:        '#FAF7F0',
  surfaceLow:     '#F5F1E7',
  surfaceHigh:    '#E7E1D1',
  // M3 surface levels
  surface1: '#FAF7F0',
  surface2: '#F5F1E7',
  surface3: '#EEE9DC',
  surface4: '#E7E1D1',
  surface5: '#DFD8C5',
  // M3 secondary / tertiary / purple
  secondaryContainer:   '#E1E7D4',
  onSecondaryContainer: '#1A2013',
  tertiaryContainer:    '#FFDCC3',
  onTertiaryContainer:  '#301A07',
  purpleContainer:      '#EDE7F6',
  purple:               '#7C3AED',
  // iOS translucent tab bar background
  tabBg: 'rgba(250,247,240,0.78)',
  // Text
  onSurface:      '#1B1D1A',
  onSurfaceVar:   '#4A4E48',
  onSurfaceVar2:  '#666A61',
  onSurfaceFaint: '#9DA096',
  // Shorthand aliases
  ink:   '#1B1D1A',
  ink2:  '#4A4E48',
  ink3:  '#666A61',
  ink4:  '#9DA096',
  // Primary (M3 teal)
  primary:          '#04837A',
  primaryContainer: '#B4F1E8',
  onPrimary:        '#FFFFFF',
  onPrimaryContainer: '#00201D',
  // Accents
  approval:       '#955806',
  approvalBg:     '#FBE3BE',
  error:          '#B42318',
  errorBg:        '#FBDAD5',
  success:        '#14743A',
  successBg:      '#C6EFD2',
  // Borders
  outline:        '#ADA692',
  outlineVar:     '#D8D1BE',
  // Brand (same both themes for CTAs)
  ...brand,
};

const dark = {
  bg:             '#101311',
  surface:        '#171A18',
  surfaceLow:     '#131614',
  surfaceHigh:    '#242A27',
  // M3 surface levels
  surface1: '#171A18',
  surface2: '#131614',
  surface3: '#1D2229',
  surface4: '#242A27',
  surface5: '#2A312D',
  // M3 secondary / tertiary / purple
  secondaryContainer:   '#434A36',
  onSecondaryContainer: '#DFE7CB',
  tertiaryContainer:    '#6A3F1A',
  onTertiaryContainer:  '#FFDCC3',
  purpleContainer:      '#2D1B52',
  purple:               '#A78BFA',
  // iOS translucent tab bar background
  tabBg: 'rgba(23,26,24,0.78)',
  onSurface:      '#E8E6DF',
  onSurfaceVar:   '#BFC2B8',
  onSurfaceVar2:  '#94988D',
  onSurfaceFaint: '#6B6F66',
  ink:   '#E8E6DF',
  ink2:  '#BFC2B8',
  ink3:  '#94988D',
  ink4:  '#6B6F66',
  primary:          '#05b7aa',
  primaryContainer: '#00514B',
  onPrimary:        '#00201D',
  onPrimaryContainer: '#74F5E8',
  approval:       '#E8B45C',
  approvalBg:     '#4A3312',
  error:          '#F2867A',
  errorBg:        '#55201B',
  success:        '#5BD98A',
  successBg:      '#14432A',
  outline:        '#6B6F66',
  outlineVar:     '#3A403B',
  ...brand,
};

export type Tokens = typeof light;
export const tokens: Record<ColorScheme, Tokens> = { light, dark };

// Priority colours — same both themes
export const PRIORITY_COLOR: Record<string, string> = {
  urgent:  '#dc2626',
  high:    '#ef4444',
  medium:  '#f59e0b',
  low:     '#22c55e',
};

// Approval status colours
export const APPROVAL_COLOR: Record<string, string> = {
  pending:        '#d97706',
  pending_client: '#7c3aed',
  approved:       '#16a34a',
  rejected:       '#dc2626',
};

// Deterministic project colour from team_id
const PROJECT_PALETTE = [
  '#0082c6','#05b7aa','#8b5cf6','#ec4899',
  '#f59e0b','#10b981','#6366f1','#ef4444',
  '#14b8a6','#f97316',
];
export function projectColor(teamId: string, override?: string | null): string {
  if (override) return override;
  let hash = 0;
  for (let i = 0; i < teamId.length; i++) hash = teamId.charCodeAt(i) + ((hash << 5) - hash);
  return PROJECT_PALETTE[Math.abs(hash) % PROJECT_PALETTE.length];
}

// Avatar initials colours
export const AVATAR_COLORS = [
  '#0082c6','#05b7aa','#8b5cf6','#ec4899','#f59e0b','#10b981','#6366f1',
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

// Typography scale
export const type = {
  displaySerif: { fontFamily: 'Newsreader', fontWeight: '400' as const },
  titleSerif:   { fontFamily: 'Newsreader', fontWeight: '400' as const },
  labelHindi:   { fontFamily: 'TiroDevanagariHindi', fontWeight: '400' as const },
  mono:         { fontFamily: 'SpaceMono', fontWeight: '400' as const },
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
