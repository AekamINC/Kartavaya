// Accent, English and Hindi label per module — one source.
//
// 13-module-pages.md sources this from "01-navigation.md", but 01 never defines
// it and neither does design-reference/. The hexes therefore live in
// styles/module.css (as theme-flipping tokens, since the two palettes are
// opposite temperatures); this file maps module id → token reference.
//
// Colours are var() references rather than literals so a module accent is
// correct in both themes without any consumer knowing which theme is active.

// `en`/`hi` here are the designer's words, taken from the rendered reference
// (`Chrome.jsx` NAV) rather than paraphrased:
//   · ganit is **Finance**, not "Invoicing" — the module also holds expenses,
//     payables, bank and contracts, so "Invoicing" named a tenth of it. The
//     reference agrees in three places: NAV, the page title "FINANCE & GST",
//     and Landing2.jsx:265's "Ganit · Finance".
//   · graha is **ग्रह**, not "ग्राहक" — ग्राहक means *customer*, and it is
//     already the Devanagari for Graha's `clients` tab and Vikray's
//     `customers`. One word cannot label the module and a tab inside it.
export const MODULES = {
  graha:     { color: 'var(--m-graha)',     en: 'CRM',        hi: 'ग्रह',     route: '/graha' },
  ganit:     { color: 'var(--m-ganit)',     en: 'Finance',    hi: 'गणित',    route: '/ganit' },
  kray:      { color: 'var(--m-kray)',      en: 'Procurement', hi: 'क्रय',    route: '/kray' },
  manav:     { color: 'var(--m-manav)',     en: 'HRMS',       hi: 'मानव',    route: '/manav' },
  vikray:    { color: 'var(--m-vikray)',    en: 'Sales',      hi: 'विक्रय',  route: '/vikray' },
  vetana:    { color: 'var(--m-vetana)',    en: 'Payroll',    hi: 'वेतन',    route: '/vetana' },
  dristi:    { color: 'var(--m-dristi)',    en: 'Analytics',  hi: 'दृष्टि',  route: '/dristi' },
  prachar:   { color: 'var(--m-prachar)',   en: 'Marketing',  hi: 'प्रचार',  route: '/prachar' },
  esign:     { color: 'var(--m-esign)',     en: 'E-Sign',     hi: 'प्रमाण',  route: '/esign' },
  sanvaad:   { color: 'var(--m-sanvaad)',   en: 'Messages',   hi: 'संवाद',   route: '/sanvaad' },
  hub:       { color: 'var(--m-hub)',       en: 'Sahayak Admin', hi: 'सहायक व्यवस्था', route: '/hub' },
  sahayak:    { color: 'var(--m-sahayak)',    en: 'Sahayak',    hi: 'सहायक',   route: '/hub/org' },
  pahchan:   { color: 'var(--m-pahchan)',   en: 'Pahchan',    hi: 'पहचान',   route: '/pahchan' },
  boards:    { color: 'var(--m-boards)',    en: 'Boards',     hi: 'फ़लक',    route: '/boards' },
  approvals: { color: 'var(--m-approvals)', en: 'Approvals',  hi: 'सम्मति',  route: '/approvals' },
  reports:   { color: 'var(--m-reports)',   en: 'Reports',    hi: 'प्रतिवेदन', route: '/reports' },
};

const FALLBACK = 'var(--primary)';

/** Accent for a module id, or the user's primary if the id is unknown. */
export const moduleColor = id => MODULES[id]?.color || FALLBACK;

export const moduleMeta = id => MODULES[id] || null;
