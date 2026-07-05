/**
 * Protected.jsx — auth guard wrapper.
 * Verifies token via /auth/me before rendering children.
 * Roles: admin (full access) | member (no admin page) | client (restricted to client/* pages)
 */
import React, { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { KLogo } from '../../lib/brand';

// Routes clients may NOT access (they are redirected to /client/projects)
const CLIENT_BLOCKED = ['/automations', '/teams', '/time', '/templates', '/activity', '/admin', '/admin/billing'];
// Routes only admins may access
const ADMIN_ONLY     = ['/admin', '/admin/billing'];

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

  if (ready === null) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050e1a' }}>
      <div style={{ textAlign: 'center' }}>
        <KLogo size={40} />
        <div style={{ marginTop: 16, fontSize: 13, color: '#5a7087', fontFamily: "'Inter',sans-serif" }}>Loading Kartavaya…</div>
      </div>
    </div>
  );
  if (!ready) return null;

  const path = location.pathname;
  const role = user?.role;

  // Admin-only route guard
  if (requiredRole === 'admin' && role !== 'admin') return <Navigate to="/dashboard" replace />;
  if (requiredRole && role !== requiredRole && role !== 'admin')  return <Navigate to="/dashboard" replace />;

  // Client: block team-member-only pages
  if (role === 'client') {
    const blocked = CLIENT_BLOCKED.some(prefix => path === prefix || path.startsWith(prefix + '/'));
    if (blocked) return <Navigate to="/client/projects" replace />;
    // Redirect clients landing on /projects to their client view
    if (path === '/projects') return <Navigate to="/client/projects" replace />;
  }

  // Non-admin trying to hit /admin
  if (ADMIN_ONLY.some(p => path === p || path.startsWith(p + '/')) && role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
