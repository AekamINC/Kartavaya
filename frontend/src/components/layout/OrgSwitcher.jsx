import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { getActiveOrg, setActiveOrg } from '../../lib/orgContext';

/**
 * Which organisation this session is acting as.
 *
 * ── What it fixes ───────────────────────────────────────────────────────────
 * There was no switcher. `org_resolver` fell back to the user's OLDEST
 * membership — `ORDER BY granted_at LIMIT 1` — and nothing in the product ever
 * sent `X-Org-Id`, so a member of two organisations could only ever reach the
 * first one they were added to. A firm with a practice and a consultancy arm,
 * which is the ordinary shape of the customers this is built for, could not see
 * the second at all.
 *
 * ── Renders nothing for most people ─────────────────────────────────────────
 * One organisation means no choice to make, and a picker with a single entry is
 * furniture that implies a decision exists. It appears only when there are two
 * or more.
 *
 * ── Switching is a hard boundary ────────────────────────────────────────────
 * `setActiveOrg` reloads the document rather than re-rendering under a new
 * header. Every module page holds fetched rows in component state, and swapping
 * the header without a reload would leave one tenant's invoices on screen while
 * the next request returns another's — which is the exact hazard
 * `pages/admin/orgScope.js` warns about. The reload closes that window
 * completely instead of asking every page to notice.
 */
export default function OrgSwitcher({ rail }) {
  const [orgs, setOrgs] = useState([]);
  const [active, setActive] = useState(getActiveOrg());

  useEffect(() => {
    let alive = true;
    api.get('/v1/org/memberships')
      .then((r) => {
        if (!alive) return;
        const list = r.data?.data || [];
        setOrgs(list);
        // With no stored choice the server resolves to the oldest membership,
        // which the endpoint returns first. Showing that as selected means the
        // control tells the truth before anyone has touched it.
        if (!getActiveOrg() && r.data?.default_id) setActive(r.data.default_id);
      })
      // A switcher that cannot list is simply absent. It is a convenience, and
      // failing loudly here would put an error on every page of the app.
      .catch(() => { if (alive) setOrgs([]); });
    return () => { alive = false; };
  }, []);

  if (orgs.length < 2) return null;

  const current = orgs.find((o) => o.id === active) || orgs[0];

  if (rail) {
    // Collapsed rail: the initial only, but still a real control — a person
    // who has collapsed the sidebar has not stopped needing to know which
    // company they are about to raise an invoice for.
    return (
      <div className="side__org side__org--rail" title={`Acting as ${current.name}`}>
        <span aria-hidden="true">{current.name.trim().charAt(0).toUpperCase()}</span>
      </div>
    );
  }

  return (
    <div className="side__org">
      <label className="side__org-l" htmlFor="side-org">Organisation</label>
      <select
        id="side-org"
        className="side__org-sel"
        value={current.id}
        onChange={(e) => setActiveOrg(e.target.value)}
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}
