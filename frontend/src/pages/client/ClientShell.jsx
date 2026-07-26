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
 * own outside `AppShell`. It lives here instead, and `App.jsx` still nests
 * `/client/*` inside `AppShell` — so the app sidebar is still painted around
 * this. Both are outside this change's file ownership; the route move is in the
 * report. Nothing in this file depends on where it is mounted.
 *
 * The stylesheet is imported here rather than from `styles/index.css`: the
 * portal ships its own CSS with itself.
 */
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiLogout } from '../../lib/auth';
import { Button } from '../../components/ui';
import '../../styles/client.css';

const NAV = [
  { view: 'overview', label: 'Overview' },
  { view: 'approvals', label: 'Approvals' },
  { view: 'files', label: 'Files' },
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

      {/* aria-current is set by hand rather than by NavLink: all three
          destinations share the `/client` path and differ only in the query, so
          NavLink's own matching would mark every one of them current. */}
      <nav className="cl-nav" aria-label="Portal">
        {NAV.map(item => (
          <Link
            key={item.view}
            to={`/client?view=${item.view}`}
            aria-current={view === item.view ? 'page' : undefined}
          >
            {item.label}
            {item.view === 'approvals' && approvalCount > 0 && (
              <span className="cl-nav__n" aria-label={`${approvalCount} waiting`}>{approvalCount}</span>
            )}
          </Link>
        ))}
      </nav>

      <main className="cl-main">{children}</main>
    </div>
  );
}
