/**
 * Who gets the client portal.
 *
 * ── THIS IS A PORT, AND HALF OF IT WAS MISSING ──────────────────────────────
 *
 * The web's definition, `navConfig.js`:
 *
 *     const orgRoles = Array.isArray(user?.org_roles) ? user.org_roles : [];
 *     const isClient = user?.role === 'client' && orgRoles.length === 0;
 *
 * and `Protected.jsx` explains the second half: "A client flag on somebody who
 * also holds an org role is staff who happens to be marked, and confining them
 * to the portal would lock a colleague out of their own workspace."
 *
 * `RootStack` asked only `user.role === 'client'`. On 2026-08-07 the owner
 * signed in on a Samsung A36 as `…+1@gmail.com` — org admin of Unicode Group,
 * and separately a client of Aekam Inc — and got the portal: one screen reading
 * "Your Updates", no tabs, no way out. That branch of the navigator renders a
 * single screen and no tab bar, so there is nothing to navigate back from.
 *
 * A dual relationship like that is not an edge case in this product. Aekam's
 * clients are companies that also run their own org on the same platform; that
 * is the business model, so this shape is COMMON and will only get more so.
 *
 * ── WHY THE ABSENT KEY MEANS "NO ORG" ───────────────────────────────────────
 *
 * `auth_router.py::_safe_user` attaches the key under `if org_roles:` — a plain
 * truthiness test — so an absent key and an empty list are the same answer:
 * this user has no org membership. That is DIFFERENT from `module_grants` right
 * beside it, which is deliberately `is not None` so an empty list can mean
 * "granted nothing". Reading the two the same way is the mistake this comment
 * exists to prevent.
 *
 * Pure on purpose: no React, no React Native, so `node --test` imports it and
 * tests the predicate for real.
 */

export interface PortalUserShape {
  role?: string;
  org_roles?: unknown;
}

/**
 * True only for an EXTERNAL client — flagged `client` and a member of no
 * organisation.
 *
 * When the shape is unrecognisable the answer is `true`, and that direction is
 * chosen rather than fallen into: a wrong `true` shows a real client their own
 * portal, while a wrong `false` would put someone in the staff app. Only for a
 * user already flagged `client`, so no other role can reach it.
 */
export function isPortalOnlyClient(user: PortalUserShape | null | undefined): boolean {
  if (!user || user.role !== 'client') return false;
  const orgRoles = Array.isArray(user.org_roles) ? user.org_roles : [];
  return orgRoles.length === 0;
}
