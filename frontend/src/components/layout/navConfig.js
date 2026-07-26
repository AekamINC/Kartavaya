// Navigation — data, not JSX. One array, no components.
//
// Extracted from Sidebar.jsx so the sidebar, the topbar breadcrumb, the mobile
// drawer and the customization preview share one source of nav truth. Splitting
// it is what makes that possible; while the lists were duplicated they drifted:
//
//   Automations  sidebar स्वचालन  ·  topbar स्वतंत्र  ← means "independent", not "automated"
//   Templates    sidebar साँचा    ·  topbar रचना
//
// The sidebar's values were the correct ones and are kept. The topbar now
// derives its title from this list rather than maintaining a second lookup,
// so the pair cannot drift again.

export const NAV_FULL = [
  {
    section: 'workspace', sans: 'कार्यक्षेत्र', gu: 'કાર્યક્ષેત્ર',
    items: [
      { to: '/dashboard', icon: 'dashboard', en: 'Today',    hi: 'आज',      gu: 'આજ' },
      { to: '/tasks',     icon: 'tasks',     en: 'Tasks',    hi: 'कर्तव्य', gu: 'કાર્ય' },
      { to: '/boards',    icon: 'projects',  en: 'Boards',   hi: 'फ़लक',    gu: 'ફલક' },
      { to: '/projects',  icon: 'projects',  en: 'Projects', hi: 'योजना',   gu: 'યોજના' },
    ],
  },
  {
    section: 'operations', sans: 'प्रचालन', gu: 'સંચાલન',
    items: [
      { to: '/approvals',   icon: 'approvals',   en: 'Approvals',   hi: 'सम्मति',    gu: 'મંજૂરી', badge: 'approvals' },
      { to: '/activity',    icon: 'activity',    en: 'Activity',    hi: 'क्रिया',     gu: 'પ્રવૃત્તિ' },
      { to: '/automations', icon: 'automations', en: 'Automations', hi: 'स्वचालन',   gu: 'સ્વચાલન' },
      { to: '/time',        icon: 'time',        en: 'Time Report', hi: 'काल',       gu: 'સમય' },
      { to: '/reports',     icon: 'reports',     en: 'Reports',     hi: 'प्रतिवेदन', gu: 'અહેવાલ', ownerOnly: true },
      { to: '/templates',   icon: 'templates',   en: 'Templates',   hi: 'साँचा',     gu: 'નમૂનો' },
    ],
  },
  {
    section: 'team', sans: 'दल', gu: 'ટીમ',
    items: [
      { to: '/teams',  icon: 'teams', en: 'Team',  hi: 'सहयोगी', gu: 'સહયોગી' },
      { to: '/inbox',  icon: 'inbox', en: 'Inbox', hi: 'सन्देश', gu: 'સંદેશ', badge: 'unread' },
    ],
  },
  {
    section: 'srijan', sans: 'सृजन', gu: 'સર્જન',
    items: [
      { to: '/hub/org', icon: 'hub',      en: 'Srijan',       hi: 'सृजन',           gu: 'સર્જન' },
      { to: '/hub',     icon: 'settings', en: 'Srijan Admin', hi: 'सृजन व्यवस्था', gu: 'સર્જન વ્યવસ્થા', adminOnly: true },
    ],
  },
  {
    section: 'modules', sans: 'मॉड्यूल', gu: 'મૉડ્યુલ',
    items: [
      { to: '/graha',   icon: 'graha',   en: 'CRM',       hi: 'ग्राह',   gu: 'ગ્રાહ',   module: 'graha' },
      { to: '/ganit',   icon: 'ganit',   en: 'Invoicing', hi: 'गणित',    gu: 'ગણિત',   module: 'ganit' },
      { to: '/manav',   icon: 'manav',   en: 'HRMS',      hi: 'मानव',    gu: 'માનવ',   module: 'manav' },
      { to: '/vikray',  icon: 'vikray',  en: 'Sales',     hi: 'विक्रय',  gu: 'વિક્રય', module: 'vikray' },
      { to: '/vetana',  icon: 'vetana',  en: 'Payroll',   hi: 'वेतन',    gu: 'વેતન',   module: 'vetana' },
      { to: '/dristi',  icon: 'dristi',  en: 'Analytics', hi: 'दृष्टि',  gu: 'દૃષ્ટિ', module: 'dristi' },
      { to: '/prachar', icon: 'prachar', en: 'Marketing', hi: 'प्रचार',  gu: 'પ્રચાર', module: 'prachar' },
      { to: '/esign',   icon: 'esign',   en: 'E-Sign',    hi: 'प्रमाण',  gu: 'પ્રમાણ', module: 'esign' },
      { to: '/sanvaad', icon: 'inbox',   en: 'Messages',  hi: 'संवाद',   gu: 'સંવાદ',  module: 'sanvaad' },
    ],
  },
  {
    section: 'settings', sans: 'व्यवस्था', gu: 'સેટિંગ્સ',
    items: [
      { to: '/settings/categories',    icon: 'categories',    en: 'Categories',    hi: 'वर्ग',   gu: 'વર્ગ' },
      { to: '/settings/notifications', icon: 'notifications', en: 'Notifications', hi: 'सूचना',  gu: 'સૂચના' },
      { to: '/settings/customize',     icon: 'customize',     en: 'Customize',     hi: 'सजावट',  gu: 'સજાવટ' },
      { to: '/billing',                icon: 'billing',       en: 'Billing',       hi: 'बिलिंग', gu: 'બિલિંગ' },
    ],
  },
];

export const NAV_CLIENT = [
  {
    section: 'workspace', sans: 'कार्यक्षेत्र', gu: 'કાર્યક્ષેત્ર',
    items: [
      { to: '/dashboard',              icon: 'dashboard',     en: 'Dashboard',     hi: 'अद्य',    gu: 'ડૅશબોર્ડ' },
      { to: '/client/projects',        icon: 'projects',      en: 'My Projects',   hi: 'योजना',   gu: 'યોજના' },
      { to: '/tasks',                  icon: 'tasks',         en: 'My Tasks',      hi: 'कर्तव्य', gu: 'કાર્ય' },
      { to: '/approvals',              icon: 'approvals',     en: 'Approvals',     hi: 'सम्मति',  gu: 'મંજૂરી' },
      { to: '/inbox',                  icon: 'inbox',         en: 'Inbox',         hi: 'सन्देश',  gu: 'સંદેશ', badge: 'unread' },
      { to: '/settings/notifications', icon: 'notifications', en: 'Notifications', hi: 'सूचना',   gu: 'સૂચના' },
    ],
  },
];

// Routes that are reachable but carry no sidebar entry. Without these the
// breadcrumb falls through to the app name — PAGE_META had 21 entries against
// far more live routes, so eleven pages read "कर्तव्य / Kartavaya".
const EXTRA_ROUTES = [
  { to: '/admin',                 en: 'Admin',           hi: 'प्रशासन' },
  { to: '/admin/billing',         en: 'Admin Billing',   hi: 'बिलिंग प्रशासन' },
  { to: '/admin/orgs',            en: 'Organisations',   hi: 'संस्थाएँ' },
  { to: '/admin/costs',           en: 'Cost Dashboard',  hi: 'लागत' },
  { to: '/hub/clients',           en: 'Srijan Clients',  hi: 'सृजन ग्राहक' },
  { to: '/client',                en: 'Client Portal',   hi: 'पोर्टल' },
  { to: '/settings',              en: 'Settings',        hi: 'व्यवस्था' },
  { to: '/pahchan',               en: 'Pahchan',         hi: 'पहचान' },
];

/** Every known route, flattened — nav items win over extras on collision. */
export const ROUTE_META = (() => {
  const map = {};
  for (const r of EXTRA_ROUTES) map[r.to] = { en: r.en, hi: r.hi };
  for (const group of [...NAV_CLIENT, ...NAV_FULL]) {
    for (const it of group.items) map[it.to] = { en: it.en, hi: it.hi, gu: it.gu, module: it.module };
  }
  return map;
})();

const APP_META = { en: 'Kartavaya', hi: 'कर्तव्य' };

/**
 * Title for a pathname: exact match, else the LONGEST matching prefix.
 *
 * The previous topbar took the first prefix hit from object order, so
 * /hub/clients could resolve to /hub depending on key order. Longest-match is
 * order-independent.
 */
export function resolveRouteMeta(pathname) {
  if (!pathname) return APP_META;
  if (ROUTE_META[pathname]) return ROUTE_META[pathname];
  let best = null;
  for (const key of Object.keys(ROUTE_META)) {
    if (pathname === key || pathname.startsWith(key + '/')) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best ? ROUTE_META[best] : APP_META;
}
