// Admin (Aekam platform console) nav — data, not JSX. 01-navigation.md §3.
//
// These four entries used to be appended into the app sidebar's `settings`
// group, which put "administer every customer org" one row below "Billing" on
// the same list a tenant user reads. Admin is a different SURFACE, not a page:
// it replaces the sidebar and owns the window (01 §1 · Admin surface).

export const ADMIN_NAV = [
  { to: '/admin',         icon: 'admin',   en: 'Overview',       hi: 'प्रशासन' },
  { to: '/admin/orgs',    icon: 'org',     en: 'Organisations',  hi: 'संस्थाएँ', count: 'orgs' },
  { to: '/admin/billing', icon: 'billing', en: 'Billing',        hi: 'बिलिंग' },
  { to: '/admin/costs',   icon: 'chart',   en: 'Cost dashboard', hi: 'लागत' },
];

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
