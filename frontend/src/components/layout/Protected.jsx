/**
 * Protected.jsx — the auth and authorisation gate on every non-public route.
 *
 * Verifies the token against `/auth/me` before rendering anything, then applies
 * three redirects, in this order:
 *
 *   1. onboarding    — an org that has not finished setup goes to /onboarding
 *   2. client        — a portal client is confined to /client/*
 *   3. platform      — /admin needs a platform role
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
 * The test is `=== false`, explicitly, NOT falsy. `/auth/me` does not return the
 * field today — `auth_router.py:125 _safe_user` returns the user row plus
 * `platform_roles` and `org_roles` and nothing else — so under a falsy test
 * every existing user in production would be thrown into a six-step wizard on
 * their next page load. Absent means "no opinion" and changes nothing; only an
 * explicit `false` from the server redirects.
 */
import React, { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { KLogo } from '../../lib/brand';
import { navContext } from './navConfig';

/** Where a confined client is sent, and the only prefix they may occupy. */
const CLIENT_HOME = '/client';

/** Platform console. */
const PLATFORM_PREFIX = '/admin';

function underPath(path, prefix) {
  return path === prefix || path.startsWith(prefix + '/');
}

export default function Protected({ children, requiredRole }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [ready, setReady] = useState(null);
  const [user,  setUser]  = useState(null);

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
      .catch(() => {
        if (!live) return;
        localStorage.removeItem('auth_token');
        navigate('/login', { replace: true });
        setReady(false);
      });
    return () => { live = false; };
  }, []);

  // Tokens, not the hardcoded #050e1a slab with #5a7087 text this used to
  // paint. Both are the retired cold-blue set (00 §9) and neither followed the
  // theme, so the first frame of every authenticated load was dark whatever the
  // user had chosen, and then snapped.
  if (ready === null) return (
    <div className="k-boot">
      <div className="k-boot__in">
        <KLogo size={40} />
        <p className="k-boot__t">Loading Kartavaya…</p>
      </div>
    </div>
  );
  if (!ready) return null;

  const path = location.pathname;
  const ctx = navContext(user);
  // Matches `AdminShell.jsx:30` exactly. The legacy `role === 'admin'` fallback
  // stays until every operator carries a row in `platform_roles`; the two
  // gates must agree, or the route resolves and then renders nothing.
  const isPlatform = ctx.isPlatform || user?.role === 'admin';

  // 1 · Onboarding.
  const onboardingIncomplete =
    user?.org?.onboarding_complete === false || user?.onboarding_complete === false;
  if (onboardingIncomplete && path !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  // 2 · Client confinement. Allow-list, not deny-list.
  if (ctx.isClient) {
    if (!underPath(path, CLIENT_HOME)) return <Navigate to={CLIENT_HOME} replace />;
    return children;
  }

  // A non-client must not sit inside the portal either. The portal reads
  // `/client/*` endpoints that return a deliberately thin, client-shaped
  // payload, so a staff user there sees a reduced version of their own data
  // and reasonably concludes something is broken.
  if (underPath(path, CLIENT_HOME)) return <Navigate to="/dashboard" replace />;

  // 3 · Platform console.
  if (underPath(path, PLATFORM_PREFIX) && !isPlatform) {
    return <Navigate to="/dashboard" replace />;
  }

  if (requiredRole === 'admin' && !isPlatform) return <Navigate to="/dashboard" replace />;
  if (requiredRole && user?.role !== requiredRole && !isPlatform) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
