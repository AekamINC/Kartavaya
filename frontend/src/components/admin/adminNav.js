// Admin (Aekam platform console) nav — data, not JSX. 01-navigation.md §3.
//
// These four entries used to be appended into the app sidebar's `settings`
// group, which put "administer every customer org" one row below "Billing" on
// the same list a tenant user reads. Admin is a different SURFACE, not a page:
// it replaces the sidebar and owns the window (01 §1 · Admin surface).

// ── Tier-1 role sets ─────────────────────────────────────────────────────────
//
// TRANSCRIBED from `backend/middleware/role_tiers.py`, the single source of
// truth, and from the two console sets the routers build on top of it. Every
// literal below is a `require_platform_role(...)` argument at a real call site,
// opened and read rather than inferred:
//
//   CONSOLE   invite_router.py:24 and routers/admin_orgs.py:30 — identical defs
//   BILLING   role_tiers.BILLING_CONSOLE_ROLES · routers/subscription.py:129,
//             193, 245, 287, 328, 361
//   FINANCE   role_tiers.FINANCE_CONSOLE_ROLES · routers/admin_orgs.py:247
//             (platform-analytics), 381, 443
//
// The nav had NO role predicate at all: every row rendered for anyone holding
// any platform role. So `sahayak_admin` and `platform_support` were handed a
// four-row console in which all four rows 403 — and `platform_support` is the
// role specified to hold ZERO access until an org admin approves a time-boxed
// session. `RBAC-SPEC.md` · Denied states rule 1: "No access → absent from the
// sidebar, never a greyed-out row that advertises what is missing."
//
// `platform_admin` travels beside `platform_owner` everywhere, for the reason
// role_tiers gives: the god-mode accounts still hold the legacy row, and the
// alias is retired by migrating data, not by deleting code.
const GOD = ['platform_owner', 'platform_admin'];

/** Customer orgs, members, invites, users. `account_finance` is NOT here. */
export const CONSOLE_ROLES = [...GOD, 'platform_manager', 'platform_staff', 'account_manager'];

/** Subscriptions, plans, invoices, payments. `platform_staff` is deliberately
 *  out — its operating set excludes finance. */
export const BILLING_CONSOLE_ROLES = [...GOD, 'platform_manager', 'account_manager', 'account_finance'];

/** Aekam's OWN commercial data — platform KPIs, cost summaries, margin. Not
 *  widened to `platform_manager`: that role is defined over a CUSTOMER's
 *  modules, and Aekam's P&L is not one of them. */
export const FINANCE_CONSOLE_ROLES = [...GOD, 'account_finance'];

/**
 * Support sessions — asking a customer for time-boxed access, and closing it.
 *
 * WIDER than any other row here and narrower than it should be, and both halves
 * need saying.
 *
 * Wider: every operating and commercial role is in it. `account_finance`
 * chasing an unpaid invoice needs the customer's permission exactly as
 * `platform_staff` does, and a request grants NOTHING until an org owner or
 * admin approves it — so admitting a role to the request screen admits it to
 * no data at all.
 *
 * Narrower than it should be, and this is the gap: `platform_support` — the
 * role this entire feature exists for — is NOT here, and `sahayak_admin` is
 * not either. Not because they should be refused, but because `canOpenAdmin`
 * in `navConfig.js` and `Protected.jsx` both read `ADMIN_SURFACE_ROLES`, which
 * is the union of the three sets above, and `navConfig.test.js` pins those two
 * roles OUT of it. Adding them here without widening that union would give
 * AdminShell a row for a user Protected bounces at the door — the exact
 * disagreement the header of this file warns about.
 *
 * The change that closes it is one line: add `...SUPPORT_CONSOLE_ROLES` to
 * `ADMIN_SURFACE_ROLES` below, and update `navConfig.test.js:47` — which
 * asserts the console row is hidden for both roles on the grounds that they
 * "reach nothing". That grounds stops being true the moment this row exists.
 * It is left alone here because that test belongs to another change in flight.
 */
export const SUPPORT_CONSOLE_ROLES = [
  ...GOD, 'platform_manager', 'platform_staff', 'account_manager', 'account_finance',
];

// ── The rows, against the design's seven ─────────────────────────────────────
//
// `SetAdmin.jsx:4` (ADM_NAV, rendered from Settings.html) has seven:
//
//   Dashboard · मुख्य         cross-org stats, revenue, growth, alerts, health
//   Organisations · संस्था     ✓ /admin/orgs
//   Users · उपयोगकर्ता          ✓ /admin  ← this row
//   Billing & invoices · बीजक  ✓ /admin/billing
//   Cost analytics · व्यय      ✓ /admin/costs
//   Support sessions · सहायता  time-boxed access into a customer org
//   System settings · व्यवस्था  defaults, email templates, maintenance, flags
//
// The three that are absent are absent because there is nothing behind them:
// no `GET /v1/admin/dashboard`; `platform_support_sessions` does not exist
// (`middleware/role_tiers.py:46`); no `/v1/admin/system-settings`. Rows that
// resolve to a screen with no endpoint are the defect this file's history is
// mostly about, so they stay off until the tables and routes land.
//
// This first row was labelled `Overview`, which is what it looked like from
// outside and not what it is. `pages/AdminPage.jsx:870` renders Overview ·
// Accounts · Invites · Platform roles — it is the design's **Users** console,
// and only its first tab is an overview (stat tiles and an R2 folder map, not
// the cross-org Dashboard the design means by that word). Naming it `Overview`
// promised the missing row and delivered a different one.
//
// `Usage & spend` is the fifth, and it is NOT one of the design's seven — it is
// the other half of `Cost dashboard`. Costs is what Aekam PAYS its providers;
// this is what an org SPENT, by source and by person, out of the credit ledger.
// They were one screen for as long as nobody had to answer "which of our people
// burned the allowance", which is now the question the owner asks first. Same
// guard as Costs, `FINANCE_CONSOLE_ROLES`, mirroring the endpoints it reads —
// and it must be here rather than only in `App.jsx`, or `resolveAdminMeta`
// resolves `/admin/usage` to the console root and the operator is bounced.
export const ADMIN_NAV = [
  { to: '/admin',         icon: 'users',    en: 'Users',          hi: 'उपयोगकर्ता',              roles: CONSOLE_ROLES },
  { to: '/admin/orgs',    icon: 'org',      en: 'Organisations',  hi: 'संस्थाएँ', count: 'orgs', roles: CONSOLE_ROLES },
  // Pulse — Aekam-only product-usage analytics (proposal 68). The server gate
  // is `require_platform_role(*CONSOLE_ROLES)` in `routers/pulse.py`, imported
  // from `routers/admin_orgs.py` — the SAME set the two rows above mirror, so
  // this row shows to exactly the operators the endpoints admit and to nobody
  // whose every read would 403.
  { to: '/admin/pulse',   icon: 'dristi',   en: 'Pulse',          hi: 'नाड़ी',                   roles: CONSOLE_ROLES },
  { to: '/admin/billing', icon: 'billing',  en: 'Billing',        hi: 'बिलिंग',                  roles: BILLING_CONSOLE_ROLES },
  { to: '/admin/usage',   icon: 'activity', en: 'Usage & spend',  hi: 'व्यय',                    roles: FINANCE_CONSOLE_ROLES },
  { to: '/admin/costs',   icon: 'chart',    en: 'Cost dashboard', hi: 'लागत',                    roles: FINANCE_CONSOLE_ROLES },
  // The sixth of the design's seven, and the first of the three absent ones to
  // get a screen. It is LAST deliberately: it is the row an operator visits
  // when a ticket forces them to, not one they browse. See
  // `pages/admin/SupportSessionsPage.jsx`.
  { to: '/admin/support', icon: 'approvals',   en: 'Support sessions', hi: 'सहायता',                roles: SUPPORT_CONSOLE_ROLES },
];

/**
 * Who may open the console at all — the union of the rows above.
 *
 * Excludes `sahayak_admin`, whose surface is the Sahayak hub at `/hub` and not
 * anything under `/admin`, and `platform_support`, which reaches nothing until
 * `platform_support_sessions` exists and a session has been approved.
 */
export const ADMIN_SURFACE_ROLES = [
  ...new Set([...CONSOLE_ROLES, ...BILLING_CONSOLE_ROLES, ...FINANCE_CONSOLE_ROLES]),
];

/** Whether a platform-role holder may see one console row. */
export function canSeeAdminItem(item, platformRoles) {
  if (!item.roles) return true;
  const held = Array.isArray(platformRoles) ? platformRoles : [];
  return item.roles.some(r => held.includes(r));
}

/**
 * The rows this operator may actually open.
 *
 * `legacyAdmin` keeps the `users.role === 'admin'` fallback working, and must:
 * it stays until every operator carries a row in `staging.user_roles`, and
 * dropping it mid-migration locks real people out of the console. That is the
 * failure `role_tiers.py` names under "Console guard sets" — a guard written
 * against one spelling of god mode is a total lockout on the day the rows are
 * renamed.
 */
export function adminNavFor(platformRoles, legacyAdmin = false) {
  if (legacyAdmin) return ADMIN_NAV;
  return ADMIN_NAV.filter(it => canSeeAdminItem(it, platformRoles));
}

const ADMIN_ROOT = { en: 'Aekam platform', hi: 'मंच' };

/** Longest-prefix match, so /admin/orgs never resolves to /admin. */
export function resolveAdminMeta(pathname) {
  let best = null;
  for (const it of ADMIN_NAV) {
    if (pathname === it.to || pathname.startsWith(it.to + '/')) {
      if (!best || it.to.length > best.to.length) best = it;
    }
  }
  return best || ADMIN_ROOT;
}

export { ADMIN_ROOT };
