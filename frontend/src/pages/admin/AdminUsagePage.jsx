import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ErrorState, errorKind, Select, SkeletonPage } from '../../components/ui';
import { currentUser } from '../../lib/auth';
import BillingUsageSection from '../billing/BillingUsageSection';
import { readScope, writeScope } from './orgScope';
import { canSeeCost } from './platformRoles';
import '../../styles/admin.css';
import { Secondary } from '../../components/Bilingual';

/**
 * AdminUsagePage — Aekam's view of any org's spend, including its own.
 *
 * This page is a scope bar and one component. `BillingUsageSection` is the same
 * file an org admin sees at `/settings/organisation?tab=billing`, pointed at
 * `/v1/billing/orgs/{org_id}` instead of `/v1/billing/me`. Aekam looking at
 * Aekam is therefore not a special case — it is this page with Aekam Inc chosen
 * in the select, and the `is_platform_org` flag on the balance response makes the
 * section say "recorded, not deducted" on its own.
 *
 * There is deliberately no third component and no "platform view". A forked
 * screen for Aekam would be the one that drifts, and the owner's requirement is
 * that Aekam gets the identical view of itself that it gives its clients.
 *
 * The scope is EXPLICIT and sticky, the `AdminBillingPage` idiom: the org is a
 * path segment on every call, not an ambient header, so a stale render cannot
 * quietly show one company's spend under another company's name.
 *
 * The gate is `canSeeCost` — god mode ∪ `account_finance` — mirroring the
 * `FINANCE_CONSOLE_ROLES` guard the usage endpoints carry. The matching row in
 * `components/admin/adminNav.js` uses the same set; without both, the page is
 * either unreachable or advertised to operators whose every read 403s.
 */
export default function AdminUsagePage() {
  const maySeeCost = canSeeCost(currentUser()?.platform_roles);

  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState(() => readScope());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    if (!maySeeCost) return;
    const res = await api.get('/v1/admin/orgs');
    setOrgs(res.data?.data || []);
  }, [maySeeCost]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    load()
      .catch(e => { if (live) setErr(e); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [load]);

  useEffect(() => { writeScope(orgId); }, [orgId]);

  const org = orgs.find(o => o.id === orgId) || null;

  const pageHead = (
    <header className="apg__head">
      <div className="apg__titles">
        <h1 className="apg__t">
          Usage &amp; spend
          <Secondary className="apg__hi" value="व्यय" />
        </h1>
        <p className="apg__lede">
          Every credit an organisation spent, by source and by person — for the
          organisation named below, including Aekam Inc itself.
        </p>
      </div>
    </header>
  );

  if (!maySeeCost) {
    return (
      <div className="apg">
        {pageHead}
        <ErrorState kind="denied" grant="platform owner or account/finance access" />
      </div>
    );
  }

  if (loading) return <SkeletonPage withStats withTable />;
  if (err) {
    return (
      <div className="apg">
        {pageHead}
        <ErrorState
          kind={errorKind(err)}
          grant="finance access to the platform console"
          onRetry={() => { setLoading(true); load().catch(setErr).finally(() => setLoading(false)); }}
        />
      </div>
    );
  }

  return (
    <div className="apg">
      {pageHead}

      <div className="osc">
        <span className="osc__l">Looking at</span>
        <Select
          aria-label="Organisation whose spend is shown"
          value={orgId}
          onChange={e => setOrgId(e.target.value)}
        >
          <option value="">— Choose an organisation —</option>
          {orgs.map(o => (
            <option key={o.id} value={o.id}>{o.name}{o.is_active ? '' : ' (suspended)'}</option>
          ))}
        </Select>
        <span className="osc__v" aria-live="polite">
          {org
            ? <>{org.name} — {org.plan_name || org.plan_code || 'no plan'}</>
            : <span className="osc__none">Nothing is scoped — choose an organisation to see its spend.</span>}
        </span>
      </div>

      {/* Keyed on the org so a scope change remounts rather than showing the
          previous org's tabs while the new org's reads are in flight. */}
      {orgId && <BillingUsageSection key={orgId} basePath={`/v1/billing/orgs/${orgId}`} />}
    </div>
  );
}
