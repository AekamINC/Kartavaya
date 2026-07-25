// Accent, English and Hindi label per module — one source.
//
// 13-module-pages.md sources this from "01-navigation.md", but 01 never defines
// it and neither does design-reference/. The hexes therefore live in
// styles/module.css (as theme-flipping tokens, since the two palettes are
// opposite temperatures); this file maps module id → token reference.
//
// Colours are var() references rather than literals so a module accent is
// correct in both themes without any consumer knowing which theme is active.

export const MODULES = {
  graha:     { color: 'var(--m-graha)',     en: 'CRM',        hi: 'ग्राह',   route: '/graha' },
  ganit:     { color: 'var(--m-ganit)',     en: 'Invoicing',  hi: 'गणित',    route: '/ganit' },
  manav:     { color: 'var(--m-manav)',     en: 'HRMS',       hi: 'मानव',    route: '/manav' },
  vikray:    { color: 'var(--m-vikray)',    en: 'Sales',      hi: 'विक्रय',  route: '/vikray' },
  vetana:    { color: 'var(--m-vetana)',    en: 'Payroll',    hi: 'वेतन',    route: '/vetana' },
  dristi:    { color: 'var(--m-dristi)',    en: 'Analytics',  hi: 'दृष्टि',  route: '/dristi' },
  prachar:   { color: 'var(--m-prachar)',   en: 'Marketing',  hi: 'प्रचार',  route: '/prachar' },
  esign:     { color: 'var(--m-esign)',     en: 'E-Sign',     hi: 'प्रमाण',  route: '/esign' },
  sanvaad:   { color: 'var(--m-sanvaad)',   en: 'Messages',   hi: 'संवाद',   route: '/sanvaad' },
  hub:       { color: 'var(--m-hub)',       en: 'Srijan Admin', hi: 'सृजन व्यवस्था', route: '/hub' },
  srijan:    { color: 'var(--m-srijan)',    en: 'Srijan',     hi: 'सृजन',    route: '/hub/org' },
  pahchan:   { color: 'var(--m-pahchan)',   en: 'Pahchan',    hi: 'पहचान',   route: '/pahchan' },
  boards:    { color: 'var(--m-boards)',    en: 'Boards',     hi: 'फ़लक',    route: '/boards' },
  approvals: { color: 'var(--m-approvals)', en: 'Approvals',  hi: 'सम्मति',  route: '/approvals' },
  reports:   { color: 'var(--m-reports)',   en: 'Reports',    hi: 'प्रतिवेदन', route: '/reports' },
};

const FALLBACK = 'var(--primary)';

/** Accent for a module id, or the user's primary if the id is unknown. */
export const moduleColor = id => MODULES[id]?.color || FALLBACK;

export const moduleMeta = id => MODULES[id] || null;
