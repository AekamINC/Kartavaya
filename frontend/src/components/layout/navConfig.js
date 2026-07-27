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

import { ADMIN_SURFACE_ROLES } from '../admin/adminNav';

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
      // Labels are the designer's, from the same `Chrome.jsx:36` NAV that gave
      // this section its shape — `Finance` not "Invoicing", `ग्रह` not
      // "ग्राहक". Both build labels were paraphrases: Invoicing names one of
      // Ganit's ten tabs, and ग्राहक (customer) is already the Devanagari for
      // Graha's own `clients` tab. Rationale in lib/moduleColors.js.
      { to: '/graha',   icon: 'graha',   en: 'CRM',       hi: 'ग्रह',    gu: 'ગ્રહ',   module: 'graha' },
      { to: '/vikray',  icon: 'vikray',  en: 'Sales',     hi: 'विक्रय',  gu: 'વિક્રય', module: 'vikray' },
      { to: '/ganit',   icon: 'ganit',   en: 'Finance',   hi: 'गणित',    gu: 'ગણિત',   module: 'ganit' },
    ],
  },
  {
    // ── People · जन ────────────────────────────────────────────────────────
    //
    // ORDER is the reference's, read off the RENDERED mockup rather than the
    // prose: `Chrome.jsx:47` runs HRMS · Payroll · Attendance · Messaging, and
    // this list had the last two the other way round. It reads as an accident
    // either way until you see them side by side — the three rows above
    // Attendance are all employee RECORDS, and Messaging is the one row in the
    // group that is a live surface rather than a record, so it belongs last.
    section: 'people', sans: 'जन', gu: 'જન',
    items: [
      { to: '/manav',   icon: 'manav',   en: 'HRMS',      hi: 'मानव',    gu: 'માનવ',   module: 'manav' },
      { to: '/vetana',  icon: 'vetana',  en: 'Payroll',   hi: 'वेतन',    gu: 'વેતન',   module: 'vetana' },
      // Pahchan was routed in App.jsx and rendered a finished page, but it was
      // in NO nav list — it appeared only in EXTRA_ROUTES, which exists to give
      // a breadcrumb to routes that have no sidebar entry. So the module was
      // reachable exclusively by typing the URL. It is a module like the nine
      // above it and belongs in the group with them.
      { to: '/pahchan', icon: 'pahchan', en: 'Attendance', hi: 'पहचान',  gu: 'પહચાન',  module: 'pahchan' },
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
    ],
  },
  {
    // ── Growth · वृद्धि ─────────────────────────────────────────────────────
    //
    // Srijan lives here rather than in a section of its own. The design groups
    // the AI hub with Marketing and Reports because they are the same job —
    // finding and keeping work — and a one-module section is a heading with
    // nothing to head.
    //
    // ORDER, again from the rendered mockup: `Chrome.jsx:53` is Marketing ·
    // AI Hub · Reports, i.e. प्रचार · सृजन · दृष्टि. This list had दृष्टि
    // second and सृजन third. Analytics moves last, which is also where it
    // belongs on its own terms — it reports on what the two rows above it did.
    // `Srijan Admin` has no counterpart in the mockup and stays beside the
    // Srijan row it administers rather than being wedged between them.
    section: 'growth', sans: 'वृद्धि', gu: 'વૃદ્ધિ',
    items: [
      { to: '/prachar', icon: 'prachar', en: 'Marketing', hi: 'प्रचार',  gu: 'પ્રચાર', module: 'prachar' },
      // `module` is the code `require_module(...)` uses, which for the AI hub is
      // `srijan`. Without it these two rows were the only module surfaces in the
      // sidebar with no entitlement predicate at all, so `platform_support` — a
      // role `role_tiers.modules_for()` deliberately grants NOTHING until an org
      // admin approves a session — was offered the Srijan console on the nav.
      { to: '/hub/org', icon: 'hub',      en: 'Srijan',       hi: 'सृजन',           gu: 'સર્જન', module: 'srijan' },
      { to: '/hub',     icon: 'settings', en: 'Srijan Admin', hi: 'सृजन व्यवस्था', gu: 'સર્જન વ્યવસ્થા', adminOnly: true, module: 'srijan' },
      { to: '/dristi',  icon: 'dristi',  en: 'Analytics', hi: 'दृष्टि',  gu: 'દૃષ્ટિ', module: 'dristi' },
    ],
  },
  {
    // ── Clients · मुवक्किल ──────────────────────────────────────────────────
    //
    // eSign is a client-facing surface in the design, not a module among the
    // internal ten — it is the thing a customer's customer actually touches.
    //
    // NOT `ग्राहक`, which this section carried when it was created and which is
    // already the CRM row's label eleven lines up. One sidebar cannot use one
    // word for two things; a reader has no way to tell which sense is meant.
    //
    // The reference avoids the clash by calling CRM `ग्रह`, freeing `ग्राहक` for
    // this heading. The build went the other way for a documented reason —
    // `ग्रह` means *planet*, and `Modules.jsx:28` already recorded that CRM is
    // `ग्राहक`, customer. So the heading moves instead.
    //
    // `मुवक्किल` is the professional-services sense of client, as against `ग्राहक`
    // for a retail customer — which is the right distinction for a firm that
    // keeps customer records in CRM and sends documents to the people it acts
    // for. OWNER: this is a vocabulary call made by a non-native speaker on a
    // bilingual product; override it if a CA firm would say something else.
    section: 'clients', sans: 'मुवक्किल', gu: 'અસીલ',
    items: [
      { to: '/esign',   icon: 'esign',   en: 'E-Sign',    hi: 'प्रमाण',  gu: 'પ્રમાણ', module: 'esign' },
    ],
  },
  {
    // ── Settings · व्यवस्था ──────────────────────────────────────────────────
    //
    // Reconciled against `Chrome.jsx:36`, the NAV the Settings.html harness
    // actually renders, by RUNNING it rather than reading the prose. The design
    // has four rows here — Roles & access, Customization, Organisation, Aekam
    // admin — and the build had four different ones: Categories, Customize,
    // Organisation, Billing. Two of the design's four had no row at all, and
    // one of the build's was a link into a sibling row's tab.
    //
    //   Roles & access  the roster, the access matrix and the invitation list
    //                   were only reachable as a TAB of Organisation. The
    //                   design gives them a destination, so `/settings/roles`
    //                   is one — mounting the same wired component, not a copy.
    //   Aekam admin     the console was fully built, fully guarded and listed
    //                   in EXTRA_ROUTES, which is the set of routes that have
    //                   NO sidebar entry. So the only way an Aekam operator
    //                   reached their own console was to type the URL.
    //   Billing         removed. It pointed at `/settings/organisation?tab=
    //                   billing`, a tab of the row directly above it, and the
    //                   design has no such row. `/billing` still redirects
    //                   there for bookmarks and emailed links.
    //   Categories      kept. Build-only — the design has no equivalent — but
    //                   it is a real page against a real `/categories`
    //                   endpoint, and dropping the row would strand it.
    //
    // `Customization` / `रूपांकन` and `संस्था` are the designer's words. The
    // build's `Customize` / `सजावट` and `संगठन` were a paraphrase; _DESIGN-GAP
    // asks for each of these to be settled deliberately rather than silently,
    // and the reference wins.
    section: 'settings', sans: 'व्यवस्था', gu: 'સેટિંગ્સ',
    items: [
      { to: '/settings/roles',         icon: 'users',         en: 'Roles & access', hi: 'अधिकार',  gu: 'અધિકાર', orgAdminOnly: true },
      { to: '/settings/customize',     icon: 'customize',     en: 'Customization',  hi: 'रूपांकन', gu: 'રૂપાંકન' },
      { to: '/settings/organisation',  icon: 'org',           en: 'Organisation',   hi: 'संस्था',  gu: 'સંસ્થા', orgAdminOnly: true },
      { to: '/settings/categories',    icon: 'categories',    en: 'Categories',     hi: 'वर्ग',    gu: 'વર્ગ' },
      // The console is a different SURFACE — it replaces the sidebar and owns
      // the window — but the door to it belongs on the sidebar, which is where
      // the design puts it. `consoleOnly` is NOT `adminOnly`: see canSeeNavItem.
      { to: '/admin',                  icon: 'admin',         en: 'Aekam admin',    hi: 'ऐकम',     gu: 'ઐકમ', consoleOnly: true },
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
  /**
   * The active organisation's display name, or `null`.
   *
   * `auth_router.py:346` already selects `o.name AS org_name` into every
   * `org_roles` row and has done all along; nothing on the client read it. The
   * FIRST row is the active org, which is the same row `_module_grants` calls
   * `primary` — one definition of "which org am I in", not two.
   *
   * Null for a platform-only operator and for a legacy account that predates
   * `user_roles`. Every caller must render nothing rather than a placeholder:
   * an empty breadcrumb segment reading "—" is worse than no segment.
   */
  const orgName = orgRoles[0]?.org_name || null;
  // Who may open `/admin`, transcribed from `Protected.jsx`'s own test and
  // built on the SAME exported role set, so the sidebar row and the route guard
  // cannot disagree about who the console is for.
  //
  // "Holds any platform role" — which is what `isPlatform` means — is too wide
  // to hang this row on. `srijan_admin` belongs at `/hub`, and
  // `platform_support` reaches nothing until an org admin approves a time-boxed
  // session. Offering either of them a console row is the greyed-out row that
  // advertises what is missing, which RBAC-SPEC's first denied-state rule
  // forbids: no access means absent from the sidebar.
  const canOpenAdmin =
    user?.role === 'admin' || platformRoles.some(r => ADMIN_SURFACE_ROLES.includes(r));
  return {
    isPlatform,
    isOrgOwner,
    isOrgAdmin,
    isClient,
    canOpenAdmin,
    moduleGrants,
    orgName,
    // Legacy `role` column is still the only signal for orgs that predate
    // user_roles, so it is a fallback, not the primary test.
    isOwnerish: isOrgOwner || isOrgAdmin || isPlatform || user?.role === 'owner' || user?.role === 'admin',
  };
}

/** Whether one nav entry is visible to the context `navContext()` returned. */
export function canSeeNavItem(item, ctx) {
  if (item.adminOnly && !ctx.isPlatform) return false;
  // `consoleOnly` is the narrower of the two platform predicates and the
  // difference matters — `adminOnly` admits any platform role, `consoleOnly`
  // admits only the roles `ADMIN_SURFACE_ROLES` names. The Aekam admin row is
  // the second kind: a row that resolves to a console where every screen 403s
  // is worse than no row.
  if (item.consoleOnly && !ctx.canOpenAdmin) return false;
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
  // `/admin` is no longer here: it is a sidebar row now, so NAV_FULL claims the
  // key first and this entry could only ever be dead weight that disagreed with
  // the row's own label.
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
