/**
 * ClientShell — the portal chrome (19-client-portal.md · Shell).
 *
 *   ClientShell
 *   ├── header  (firm logo from /v1/org/profile · project name · client name · sign out)
 *   ├── nav     (Overview · Approvals ● 2 · Files — three items, horizontal, no icons)
 *   └── children
 *
 * No sidebar. The firm's brand, not ours. A client has no modules, so a module
 * rail would be thirty destinations they can never reach — and the one they
 * could reach would be a different product from the one their accountant is
 * describing to them on the phone.
 *
 * 19 asks for this at `components/layout/ClientShell.jsx` with a route of its
 * own outside `AppShell`. It lives here instead, and it is NOT a layout route —
 * it takes `children`, not an `<Outlet />`, and every portal page renders it
 * itself. `App.jsx` must therefore mount the portal pages directly and must NOT
 * wrap them in a second shell, or a client gets two headers. The exact route
 * block is in the report.
 *
 * The stylesheet is imported here rather than from `styles/index.css`: the
 * portal ships its own CSS with itself.
 */
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiLogout } from '../../lib/auth';
import { Button } from '../../components/ui';
import '../../styles/client.css';

/**
 * Three destinations, three paths.
 *
 * These are the routes `App.jsx` is adding — `/client/approvals` and
 * `/client/files` do not exist yet, and until they land the app's catch-all
 * (`App.jsx:218`, `<Route path="*" element={<Navigate to="/dashboard" />}`)
 * swallows them. `ClientPages.jsx` resolves the view from the PATHNAME first
 * and falls back to `?view=`, so the old query links in already-sent emails
 * keep working after the routes land.
 */
export const NAV = [
  { view: 'overview', label: 'Overview', to: '/client' },
  { view: 'approvals', label: 'Approvals', to: '/client/approvals' },
  { view: 'files', label: 'Files', to: '/client/files' },
];

export default function ClientShell({ firm, view, approvalCount = 0, projectName, clientName, children }) {
  const navigate = useNavigate();

  async function signOut() {
    await apiLogout();
    navigate('/login', { replace: true });
  }

  // The firm's logo, or the firm's NAME in --font-display — never a Kartavaya
  // mark. 18-documents.md holds the same rule for printed documents, for the
  // same reason: the client's relationship is with their accountant.
  const mark = firm?.logoUrl
    ? <img className="cl-head__logo" src={firm.logoUrl} alt={firm.name || 'Firm logo'} />
    : <p className="cl-head__firm">{firm?.name || 'Client portal'}</p>;

  return (
    <div className="cl-shell">
      <header className="cl-head">
        {mark}
        {projectName && <span className="cl-head__proj">{projectName}</span>}
        <div className="cl-head__side">
          {clientName && <span className="cl-head__who">{clientName}</span>}
          <Button variant="text" size="sm" onClick={signOut}>Sign out</Button>
        </div>
      </header>

      {/* aria-current is set by hand rather than by NavLink: `/client` is a
          prefix of both other paths, so NavLink's own matching would mark
          Overview current on all three screens. */}
      <nav className="cl-nav" aria-label="Portal">
        {NAV.map(item => (
          <Link
            key={item.view}
            to={item.to}
            aria-current={view === item.view ? 'page' : undefined}
          >
            {item.label}
            {item.view === 'approvals' && approvalCount > 0 && (
              <>
                {/* The badge itself is decoration around a number. `aria-label`
                    on a bare <span> is not reliably announced — it needs a role
                    to hang off — so the count reaches a screen reader as real
                    text inside the link instead. */}
                <span className="cl-nav__n" aria-hidden="true">{approvalCount}</span>
                <span className="k-sr-only">
                  {approvalCount === 1 ? ', 1 waiting for you' : `, ${approvalCount} waiting for you`}
                </span>
              </>
            )}
          </Link>
        ))}
      </nav>

      <main className="cl-main">{children}</main>
    </div>
  );
}
