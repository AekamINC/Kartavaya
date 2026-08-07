/**
 * Protected.jsx — the auth and authorisation gate on every non-public route.
 *
 * Verifies the token against `/auth/me` before rendering anything, then applies
 * three redirects, in this order:
 *
 *   1. client        — a portal client is confined to /client/*
 *   2. onboarding    — an org that has not finished setup goes to /onboarding
 *   3. platform      — /admin needs a CONSOLE platform role, not merely any one
 *
 * The client rule is FIRST on purpose; see the comment at rule 1.
 *
 * ── The client rule changed shape (19-client-portal.md)
 *
 * It used to be a DENY-LIST: seven paths a client could not reach, everything
 * else allowed. So a client could open `/dashboard`, `/boards`, `/inbox`,
 * `/approvals`, `/graha`, `/ganit` and every other module screen — the whole
 * staff product, rendered inside the staff shell, wrapped in the module sidebar
 * that 19's never-see list opens with. The list was also stale on its own
 * terms: it named `/automations` and `/teams` but not `/boards`, `/reports`,
 * `/hub`, `/vetana` or any of the ten module routes added since it was written.
 * That is the failure mode every deny-list has — it protects the paths that
 * existed on the day somebody wrote it.
 *
 * It is now an ALLOW-LIST. A client may be at `/client/*` and nowhere else, so
 * a staff route added next month is covered the day it lands rather than the
 * day someone remembers this file.
 *
 * The predicate is `navContext().isClient`, shared with the nav, so "who is a
 * client" has one definition: `role === 'client'` AND no org membership. A
 * client flag on somebody who also holds an org role is staff who happens to be
 * marked, and confining them to the portal would lock a colleague out of their
 * own workspace.
 *
 * ── The onboarding gate (12-auth-onboarding.md §5)
 *
 * `12` asks for "a redirect into it when `org.onboarding_complete` is false".
 * The test is `=== false`, explicitly, NOT falsy — absent means "no opinion" and
 * changes nothing, so a payload that has never heard of onboarding, or a request
 * where the server could not resolve the org, redirects nobody.
 *
 * That reasoning was written when `/auth/me` returned no `org` object at all and
 * the field existed nowhere in the backend, so the gate was dead code for its
 * whole life. `auth_router._org_for` now supplies `org: {id, name,
 * onboarding_complete}` on `/auth/me`, `/login` and `/refresh`, reading
 * `staging.organisations.onboarding_complete` (migration 116) and reporting TRUE
 * while that column is absent. The rule survives unchanged; it finally has
 * something to read.
 *
 * THREE MORE CONDITIONS GUARD IT, and each one is a way this gate becomes a
 * trap rather than a redirect:
 *
 *   · THE CALLER MUST BE ABLE TO GET OUT. `POST /api/v1/org/profile/
 *     onboarding-complete` is `ORG_SETTINGS_ROLES` — org_owner and org_admin —
 *     and every step of the wizard that reaches the server is guarded the same
 *     way. An org_member redirected here has no press on any screen that can
 *     clear the flag, so they would be held on the wizard for as long as their
 *     owner never finished it. This is also the settled invite-only rule from
 *     the other side: somebody invited into an existing org is not sent through
 *     that org's setup. AUTH-SPEC.md:22 says the invited path also ends at
 *     `/onboarding`; that is overridden deliberately, and the trap is why.
 *
 *   · THE SESSION LATCH. `kv_onboarding_done` is written by the wizard BEFORE
 *     it posts, so a completion whose write failed still costs the user nothing
 *     for the rest of the session — while a fresh session tomorrow re-offers
 *     the wizard, which is the right outcome for setup that genuinely was not
 *     recorded.
 *
 *   · `path !== '/onboarding'`, or the redirect points at itself.
 */
import React, { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { apiRefreshSession } from '../../lib/auth';
import { KLogo } from '../../lib/brand';
import BrandLoader from './BrandLoader';
import { navContext } from './navConfig';
import { ADMIN_SURFACE_ROLES } from '../admin/adminNav';

/** Where a confined client is sent, and the only prefix they may occupy. */
const CLIENT_HOME = '/client';

/** Platform console. */
const PLATFORM_PREFIX = '/admin';

/**
 * How often a tab that is left open slides its own session forward.
 *
 * The JWT is minted for seven days (`auth_router.JWT_TTL_DAYS`) and there is no
 * refresh token, so `POST /auth/refresh` can only extend a token that is still
 * valid. Six hours is far inside that window and cheap: a tab open across a
 * working week never hits the expiry, and a tab that has been closed for eight
 * days still expires, which is the behaviour a session length is for.
 */
const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;

function underPath(path, prefix) {
  return path === prefix || path.startsWith(prefix + '/');
}

/**
 * The onboarding latch — SESSION storage, deliberately, not local.
 *
 * The wizard sets this the instant the user finishes, BEFORE it tries to tell
 * the server. If that POST fails — offline, a Railway restart, a 500 — the user
 * still leaves, and this key is what stops the gate from putting them straight
 * back. Without it a failed completion write is an infinite bounce between
 * `/dashboard` and `/onboarding`, one `/auth/me` per lap.
 *
 * SESSION rather than LOCAL because the two failure modes are not equally bad.
 * Local storage would hide a genuinely unrecorded setup forever, on that device,
 * and the org would never be prompted again. Session storage costs the user
 * nothing for the rest of the sitting and re-offers the wizard next time — which
 * is the correct outcome for setup the server never heard about.
 *
 * Both functions swallow their own errors. Storage throws in Safari private mode
 * and in an iframe with third-party storage blocked, and neither of those may be
 * allowed to break an auth gate.
 */
export const ONBOARDING_LATCH_KEY = 'kv_onboarding_done';

export function latchOnboardingDone() {
  try { sessionStorage.setItem(ONBOARDING_LATCH_KEY, '1'); } catch { /* private mode */ }
}

export function onboardingLatched() {
  try { return sessionStorage.getItem(ONBOARDING_LATCH_KEY) === '1'; } catch { return false; }
}

export default function Protected({ children, requiredRole }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [ready, setReady] = useState(null);
  const [user,  setUser]  = useState(null);
  /** Set only when `/auth/me` failed for a reason that is not the session. */
  const [reachError, setReachError] = useState(false);

  useEffect(() => {
    let live = true;
    if (!localStorage.getItem('auth_token')) {
      navigate('/login', { replace: true, state: { from: location.pathname } });
      setReady(false); return;
    }
    api.get('/auth/me')
      .then((r) => {
        if (!live) return;
        localStorage.setItem('Kartavaya_user', JSON.stringify(r.data));
        setUser(r.data); setReady(true);
      })
      .catch((err) => {
        if (!live) return;
        /**
         * A 401 is the session; ANYTHING ELSE IS NOT, and this used to treat
         * them the same — every failure deleted `auth_token` and bounced to
         * `/login`. `api.js` retries a dead network three times at 800/1600/
         * 2400ms and then rejects, so a lift, a tunnel or a Railway restart
         * ended with the user signed out and their token destroyed, with no
         * way to tell that from a real expiry.
         *
         * `api.js`'s 401 branch clears the session and hard-redirects to
         * `/login?expired=1` for a 401 raised anywhere in the product, which is
         * where that rule belongs — a 401 arrives from any request on any page,
         * not only from this one. The same move is repeated here so the gate is
         * correct WITHOUT the interceptor: they agree on the destination and
         * the query, so whichever runs first, the outcome is the same.
         */
        if (err?.response?.status === 401) {
          try {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('Kartavaya_user');
          } catch { /* private mode — the redirect still has to happen */ }
          navigate('/login?expired=1', { replace: true });
          setReady(false);
          return;
        }
        setReachError(true);
        setReady(false);
      });
    return () => { live = false; };
  }, []);

  /**
   * Slide the session forward while the tab is open — AUTH-SPEC and
   * `12-auth-onboarding.md` both assume a refresh exists, and until now none
   * did, in any form. A rejection is swallowed on purpose: the token may still
   * be days from expiry, and `api.js` owns the case where it is not.
   */
  useEffect(() => {
    if (!ready) return undefined;
    const t = setInterval(() => { apiRefreshSession().catch(() => {}); }, REFRESH_EVERY_MS);
    return () => clearInterval(t);
  }, [ready]);

  // Tokens, not the hardcoded #050e1a slab with #5a7087 text this used to
  // paint. Both are the retired cold-blue set (00 §9) and neither followed the
  // theme, so the first frame of every authenticated load was dark whatever the
  // user had chosen, and then snapped.
  /**
   * The boot gate is the lotus, not a 40px logo over the words "Loading
   * Kartavaya…".
   *
   * This is the longest wait in the product — a cold load blocks here until
   * `/auth/me` answers — and it was the one place still telling the reader that
   * nothing had happened yet. `PageLoader` (every lazy route) has drawn the mark
   * since it was built; this screen did not, so the first frame after sign-in
   * and the first frame of a route change were two different products.
   *
   * `full` rather than the default 60vh: nothing else is on screen, so the mark
   * takes the middle of it.
   */
  if (ready === null) return <BrandLoader full size={196} label="Loading Kartavaya" />;

  /**
   * The server could not be reached, and the session is very probably fine. Say
   * that, and offer the retry — the alternative this replaces was a silent
   * sign-out that also deleted the token, so the user's next move was to find
   * their password.
   */
  if (reachError) return (
    <div className="k-boot">
      <div className="k-boot__in">
        <KLogo size={104} />
        <p className="k-boot__t">Could not reach Kartavaya</p>
        <p className="k-boot__d">
          Your session is still valid — this is a connection problem, not a sign-out.
        </p>
        <button type="button" className="au__btn" onClick={() => window.location.reload()}>
          <span>Try again</span>
        </button>
      </div>
    </div>
  );

  if (!ready) return null;

  const path = location.pathname;
  const ctx = navContext(user);
  // The legacy `role === 'admin'` fallback stays until every operator carries a
  // row in `platform_roles`.
  const isPlatform = ctx.isPlatform || user?.role === 'admin';

  /**
   * Who may open `/admin` — the SAME test `AdminShell` applies, from the same
   * exported set, so the two cannot drift.
   *
   * "Holds any platform role" is too wide. `sahayak_admin`'s surface is the
   * Sahayak hub at `/hub`, not the console; `platform_support` reaches nothing at
   * all until an org admin approves a time-boxed session. Both used to resolve
   * `/admin` and land on four rows that each 403 — the same shape as the defect
   * where the route was gated on an ORG role while the shell gated on platform
   * roles: it resolves, and then there is nothing behind it.
   */
  const platformRoles = Array.isArray(user?.platform_roles) ? user.platform_roles : [];
  const canOpenAdmin =
    user?.role === 'admin' || platformRoles.some(r => ADMIN_SURFACE_ROLES.includes(r));

  // 1 · Client confinement. Allow-list, not deny-list.
  //
  // This runs FIRST, ahead of the onboarding redirect, and the order is the
  // point. `/onboarding` is a staff surface outside `/client/*` — six steps that
  // set up an ORGANISATION, invite its members and create its first project. A
  // client has no organisation to set up; they were invited into somebody
  // else's. While the onboarding gate ran first, any client whose payload ever
  // carried `onboarding_complete: false` would have been redirected onto that
  // wizard and then ALLOWED TO STAY THERE, because rule 1's own `path !==
  // '/onboarding'` test lets the destination through. That is a hole straight
  // through the allow-list, opened by a field rather than by a route.
  //
  // It is latent rather than live today — `auth_router.py::_safe_user` returns
  // no `onboarding_complete` and no `org` object, so the test cannot fire. The
  // whole reason the allow-list replaced a deny-list is that a guard must not
  // depend on nobody adding the thing that breaks it.
  if (ctx.isClient) {
    if (!underPath(path, CLIENT_HOME)) return <Navigate to={CLIENT_HOME} replace />;
    return children;
  }

  // 2 · Onboarding — staff only, by the ordering above.
  //
  // `=== false`, never falsy, and never a fallback to some other key. The old
  // second half of this test (`user?.onboarding_complete === false`) is gone: no
  // endpoint ever emitted a per-user flag, the column migration 116 adds is on
  // the ORGANISATION, and a per-user spelling would re-run org setup for every
  // colleague of an org that is already configured.
  const onboardingIncomplete = user?.org?.onboarding_complete === false;
  // Only somebody who can CLEAR the flag may be held by it. See the docblock.
  const orgRoles = Array.isArray(user?.org_roles) ? user.org_roles : [];
  const canFinishOnboarding = orgRoles.some(
    (r) => r?.org_id === user?.org?.id
      && (r?.role_code === 'org_owner' || r?.role_code === 'org_admin'),
  );
  if (onboardingIncomplete && canFinishOnboarding && path !== '/onboarding'
      && !onboardingLatched()) {
    return <Navigate to="/onboarding" replace />;
  }

  // A non-client must not sit inside the portal either. The portal reads
  // `/client/*` endpoints that return a deliberately thin, client-shaped
  // payload, so a staff user there sees a reduced version of their own data
  // and reasonably concludes something is broken.
  if (underPath(path, CLIENT_HOME)) return <Navigate to="/dashboard" replace />;

  // 3 · Platform console.
  if (underPath(path, PLATFORM_PREFIX) && !canOpenAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  if (requiredRole === 'admin' && !isPlatform) return <Navigate to="/dashboard" replace />;
  if (requiredRole && user?.role !== requiredRole && !isPlatform) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
