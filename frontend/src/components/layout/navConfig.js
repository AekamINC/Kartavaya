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
    // ── Revenue · राजस्व ────────────────────────────────────────────────────
    //
    // All ten module rows used to sit in one flat `modules` group. The design
    // does not have a `modules` group — `Chrome.jsx`'s NAV splits these exact
    // modules across Revenue, People, Growth and Clients, each a business
    // function with its own Devanagari heading. A single bucket is how CRM
    // ended up filed under a generic heading instead of beside Sales and
    // Finance, which is where someone selling looks for it.
    //
    // Read from `design-reference/Kartavaya Redesign/Chrome.jsx:36`, the NAV
    // constant the runnable mockups actually render — not from the prose in
    // `01-navigation.md`, which describes the sidebar without listing it.
    section: 'revenue', sans: 'राजस्व', gu: 'રાજસ્વ',
    items: [
      { to: '/graha',   icon: 'graha',   en: 'CRM',       hi: 'ग्राहक',   gu: 'ગ્રાહક',   module: 'graha' },
      { to: '/vikray',  icon: 'vikray',  en: 'Sales',     hi: 'विक्रय',  gu: 'વિક્રય', module: 'vikray' },
      { to: '/ganit',   icon: 'ganit',   en: 'Invoicing', hi: 'गणित',    gu: 'ગણિત',   module: 'ganit' },
    ],
  },
  {
    // ── People · जन ────────────────────────────────────────────────────────
    section: 'people', sans: 'जन', gu: 'જન',
    items: [
      { to: '/manav',   icon: 'manav',   en: 'HRMS',      hi: 'मानव',    gu: 'માનવ',   module: 'manav' },
      { to: '/vetana',  icon: 'vetana',  en: 'Payroll',   hi: 'वेतन',    gu: 'વેતન',   module: 'vetana' },
      // `sanvaad` — ONE spelling, and this is it. The key is compared against
      // `module_grants[]`, which carries whatever code `require_module(...)`
      // gates on, and `routers/messaging.py:27` now gates on `sanvaad`.
      //
      // This row briefly read `samvada` in this branch. It was wrong, and the
      // reason is worth keeping: `role_tiers` and `messaging.py` DID say
      // `samvada` at the time, so matching them looked like matching the source
      // of truth. It was the narrower half of the problem. `require_module`
      // feeds the same string to the grant lookup AND the entitlement lookup,
      // and `module_subscriptions` has never held `samvada` — so the module was
      // 403ing for everyone, org_owner included, and standardising the nav on
      // `samvada` would have preserved that. Settled the other way; the tables
      // keep their `samvada_` prefix, the module code does not.
      { to: '/sanvaad', icon: 'inbox',   en: 'Messages',  hi: 'संवाद',   gu: 'સંવાદ',  module: 'sanvaad' },
      // Pahchan was routed in App.jsx and rendered a finished page, but it was
      // in NO nav list — it appeared only in EXTRA_ROUTES, which exists to give
      // a breadcrumb to routes that have no sidebar entry. So the module was
      // reachable exclusively by typing the URL. It is a module like the nine
      // above it and belongs in the group with them.
      { to: '/pahchan', icon: 'pahchan', en: 'Attendance', hi: 'पहचान',  gu: 'પહચાન',  module: 'pahchan' },
    ],
  },
  {
    // ── Growth · वृद्धि ─────────────────────────────────────────────────────
    //
    // Srijan lives here rather than in a section of its own. The design groups
    // the AI hub with Marketing and Reports because they are the same job —
    // finding and keeping work — and a one-module section is a heading with
    // nothing to head.
    section: 'growth', sans: 'वृद्धि', gu: 'વૃદ્ધિ',
    items: [
      { to: '/prachar', icon: 'prachar', en: 'Marketing', hi: 'प्रचार',  gu: 'પ્રચાર', module: 'prachar' },
      { to: '/dristi',  icon: 'dristi',  en: 'Analytics', hi: 'दृष्टि',  gu: 'દૃષ્ટિ', module: 'dristi' },
      // `module` is the code `require_module(...)` uses, which for the AI hub is
      // `srijan`. Without it these two rows were the only module surfaces in the
      // sidebar with no entitlement predicate at all, so `platform_support` — a
      // role `role_tiers.modules_for()` deliberately grants NOTHING until an org
      // admin approves a session — was offered the Srijan console on the nav.
      { to: '/hub/org', icon: 'hub',      en: 'Srijan',       hi: 'सृजन',           gu: 'સર્જન', module: 'srijan' },
      { to: '/hub',     icon: 'settings', en: 'Srijan Admin', hi: 'सृजन व्यवस्था', gu: 'સર્જન વ્યવસ્થા', adminOnly: true, module: 'srijan' },
    ],
  },
  {
    // ── Clients · ग्राहक ────────────────────────────────────────────────────
    //
    // eSign is a client-facing surface in the design, not a module among the
    // internal ten — it is the thing a customer's customer actually touches.
    section: 'clients', sans: 'ग्राहक', gu: 'ગ્રાહક',
    items: [
      { to: '/esign',   icon: 'esign',   en: 'E-Sign',    hi: 'प्रमाण',  gu: 'પ્રમાણ', module: 'esign' },
    ],
  },
  {
    section: 'settings', sans: 'व्यवस्था', gu: 'સેટિંગ્સ',
    items: [
      { to: '/settings/categories',    icon: 'categories',    en: 'Categories',    hi: 'वर्ग',   gu: 'વર્ગ' },
      { to: '/settings/customize',     icon: 'customize',     en: 'Customize',     hi: 'सजावट',  gu: 'સજાવટ' },
      { to: '/settings/organisation',  icon: 'org',           en: 'Organisation',  hi: 'संगठन',  gu: 'સંગઠન', orgAdminOnly: true },
      // Points at the tab, not at `/billing`. `10-org-settings.md` folded
      // BillingPage.jsx into `org/TabBilling.jsx`; `/billing` survives in
      // App.jsx only as a redirect for bookmarks and emailed links, and a nav
      // item that routes through a redirect flashes the wrong screen first.
      { to: '/settings/organisation?tab=billing', icon: 'billing', en: 'Billing', hi: 'बिलिंग', gu: 'બિલિંગ' },
    ],
  },
];

/**
 * Nav visibility, expressed against `org_roles` rather than the flat
 * `user.role` string.
 *
 * The old predicate lived in Sidebar.jsx as
 *   isMember = !isAdmin && !isClient && user?.role !== 'owner'
 * filtered by `!item.ownerOnly || !isMember`, so a plain `role: 'owner'` user
 * passed — and so did anyone carrying a platform role, because `isAdmin` was
 * folded into the same boolean. Fine while `role` was the source of truth;
 * wrong now that `staging.user_roles` is (RBAC-SPEC.md).
 *
 * Returns the flags every nav surface needs, so the sidebar, the mobile
 * drawer and the bottom bar cannot disagree about who sees what.
 */
export function navContext(user) {
  const platformRoles = Array.isArray(user?.platform_roles) ? user.platform_roles : [];
  const orgRoles      = Array.isArray(user?.org_roles) ? user.org_roles : [];
  const isPlatform    = platformRoles.length > 0;
  const isOrgOwner    = orgRoles.some(r => r.role_code === 'org_owner');
  const isOrgAdmin    = isOrgOwner || orgRoles.some(r => r.role_code === 'org_admin');
  // A client with an org role is staff who also happens to be flagged client;
  // the portal nav is only for someone with no org membership at all.
  const isClient      = user?.role === 'client' && orgRoles.length === 0;
  // `module_grants[]` is what 01 §4 says drives the module predicates, and
  // `/auth/me` now sends it (`auth_router.py::_module_grants`, which mirrors
  // `require_module` gate for gate). Three states, all meaningful:
  //
  //   array   these codes and no others — an EMPTY array means nothing, and the
  //           modules group correctly disappears. RBAC-SPEC · denied state 1:
  //           "No access → absent from the sidebar."
  //   absent  no opinion. The server returns no key for an org_owner/org_admin,
  //           whose reach is the subscription rather than a grant row, and for a
  //           user with no org at all. Every module stays visible.
  //
  // `Array.isArray` is what keeps those apart: a missing signal must never read
  // as an empty grant, or the entire modules group vanishes for administrators.
  const moduleGrants  = Array.isArray(user?.module_grants) ? user.module_grants : null;
  return {
    isPlatform,
    isOrgOwner,
    isOrgAdmin,
    isClient,
    moduleGrants,
    // Legacy `role` column is still the only signal for orgs that predate
    // user_roles, so it is a fallback, not the primary test.
    isOwnerish: isOrgOwner || isOrgAdmin || isPlatform || user?.role === 'owner' || user?.role === 'admin',
  };
}

/** Whether one nav entry is visible to the context `navContext()` returned. */
export function canSeeNavItem(item, ctx) {
  if (item.adminOnly && !ctx.isPlatform) return false;
  if (item.orgAdminOnly && !ctx.isOrgAdmin) return false;
  if (item.ownerOnly && !ctx.isOwnerish) return false;
  // `module` was declared on all ten module entries and read by nothing — the
  // predicate existed in the data and never in the filter. See `moduleGrants`
  // above for why an ABSENT grant list is permissive while an EMPTY one is not:
  // `ctx.moduleGrants` is `null` for "no opinion" and `[]` for "nothing", and
  // only the first of those short-circuits.
  if (item.module && ctx.moduleGrants && !ctx.moduleGrants.includes(item.module)) return false;
  return true;
}

/** Groups filtered for a user, empty groups dropped. */
export function navGroupsFor(user) {
  const ctx = navContext(user);
  const groups = ctx.isClient ? NAV_CLIENT : NAV_FULL;
  return groups
    .map(g => ({ ...g, items: g.items.filter(it => canSeeNavItem(it, ctx)) }))
    .filter(g => g.items.length > 0);
}

/**
 * The five bottom-nav slots (01 §1 · Mobile bottom nav):
 * Today · Tasks · ＋ · Messages · More.
 *
 * `kind: 'fab'` is the compose action, not a route — it opens the task editor.
 * `kind: 'more'` opens MobileDrawer, which is the full sidebar. Without that
 * last slot the bottom bar would be a nav that hides thirty destinations.
 */
export const MOBILE_NAV = [
  { kind: 'link', to: '/dashboard', icon: 'dashboard', en: 'Today',    hi: 'आज',      gu: 'આજ' },
  { kind: 'link', to: '/tasks',     icon: 'tasks',     en: 'Tasks',    hi: 'कर्तव्य', gu: 'કાર્ય' },
  { kind: 'fab',                    icon: 'plus',      en: 'New',      hi: 'नया',     gu: 'નવું' },
  { kind: 'link', to: '/sanvaad',   icon: 'inbox',     en: 'Messages', hi: 'संवाद',   gu: 'સંવાદ', badge: 'unread' },
  { kind: 'more',                   icon: 'more',      en: 'More',     hi: 'अधिक',    gu: 'વધુ' },
];

/**
 * The client portal's three destinations — and nothing else.
 *
 * This list used to be a STAFF sidebar handed to a client: `/dashboard`,
 * `/tasks`, `/approvals`, `/inbox` and `/settings/customize`. Every one of
 * those routes renders a staff screen against a staff endpoint. `/approvals`
 * is `ApprovalsPage`, which is the firm's own approval queue with the
 * requester's name and email on each row; `/inbox` is the staff notification
 * feed. `19-client-portal.md`'s never-see list names both — "the firm's own
 * queue", "team member emails" — and `08-rbac-screens.md` enforces it at the
 * serializer. A nav that points a client at them is an invitation to find out
 * whether the API also forgot.
 *
 * A client no longer reaches `AppShell` at all (`App.jsx` routes `/client/*`
 * through `ClientShell` instead, and `Protected` bounces a client off every
 * staff path), so in practice this list renders nowhere. It is kept, pointed
 * at the portal, for two reasons: `ROUTE_META` builds the breadcrumb map from
 * it, and if some future route ever does put a client in front of the staff
 * sidebar, the failure should be a cosmetic one rather than a disclosure.
 */
export const NAV_CLIENT = [
  {
    section: 'portal', sans: 'द्वार', gu: 'દ્વાર',
    items: [
      { to: '/client',           icon: 'dashboard', en: 'Overview',  hi: 'अवलोकन', gu: 'અવલોકન' },
      { to: '/client/approvals', icon: 'approvals', en: 'Approvals', hi: 'सम्मति',  gu: 'મંજૂરી' },
      { to: '/client/files',     icon: 'documents', en: 'Files',     hi: 'संचिका',  gu: 'ફાઇલ' },
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
  { to: '/settings',              en: 'Settings',        hi: 'व्यवस्था' },
  // Routed but nav-less, and each one previously fell through to the app name.
  { to: '/onboarding',            en: 'Set up',          hi: 'आरम्भ' },
  { to: '/billing',               en: 'Billing',         hi: 'बिलिंग' },
  { to: '/client/projects',       en: 'Your work',       hi: 'कार्य' },
  { to: '/client/project',        en: 'Project',         hi: 'योजना' },
  { to: '/approve',               en: 'Approval',        hi: 'सम्मति' },
  { to: '/sign',                  en: 'Sign document',   hi: 'हस्ताक्षर' },
];

/**
 * Every known route, flattened.
 *
 * FIRST declaration wins, not last. Two nav entries can legitimately share a
 * pathname once an entry carries a query string — Billing points at
 * `/settings/organisation?tab=billing`, which strips to the same key as
 * Organisation. Under last-wins the Organisation page's breadcrumb read
 * "Billing". Nav still beats EXTRA_ROUTES, because the nav groups are walked
 * after the extras and an extra is only kept when nothing has claimed the key.
 */
export const ROUTE_META = (() => {
  const map = {};
  const claim = (key, value) => {
    if (!Object.prototype.hasOwnProperty.call(map, key)) map[key] = value;
  };
  for (const group of [...NAV_CLIENT, ...NAV_FULL]) {
    // Keyed by pathname — a nav entry may carry a query string to land on a
    // specific tab, and resolveRouteMeta is only ever given a bare pathname,
    // so an unstripped key would sit in the map and never match anything.
    for (const it of group.items) {
      claim(it.to.split('?')[0], { en: it.en, hi: it.hi, gu: it.gu, module: it.module });
    }
  }
  for (const r of EXTRA_ROUTES) claim(r.to, { en: r.en, hi: r.hi });
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
