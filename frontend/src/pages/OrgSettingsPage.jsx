import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/editorial';
import { Tabs, ErrorState } from '../components/ui';
import { currentUser } from '../lib/auth';
import { api } from '../lib/api';

import TabProfile from './org/TabProfile';
import TabMembers from './org/TabMembers';
import TabBilling from './org/TabBilling';
import TabModules from './org/TabModules';
import TabSecurity from './org/TabSecurity';
import TabDanger from './org/TabDanger';

import '../styles/org.css';

/**
 * OrgSettingsPage — the organisation hub (10-org-settings.md §2).
 *
 * The page was one 26 KB scroll: company profile, member list and an add-member
 * row, all in a single 720px column, with every rule written as an inline style
 * against the retired `--ink` / `--rule-soft` vocabulary. It is now a tab shell
 * and six panels in `pages/org/`.
 *
 * Tier 2, as settled 2026-07-26: **org_owner and org_admin both manage the org.**
 * Neither can delete it or transfer ownership — those two moved to Aekam
 * platform staff, which is why the danger tab has no buttons on it. What the
 * owner still decides alone is which modules an org_admin may reach, so
 * `isOwner` is threaded to the members tab and nowhere else.
 */

const ORG_ROLES = ['org_owner', 'org_admin'];

/**
 * The Devanagari beside each tab, from the designer's own `TAB_HI`
 * (`Data.jsx:134`). Only visible by running `Settings.html` — `SetOrg.jsx:351`
 * hands `TabBar` bare keys and the word arrives from a lookup two files away.
 *
 * `Danger zone` is the one place the harness contradicts itself, and the
 * contradiction resolves cleanly: `ORG_TABS` labels it `'Danger zone'` and
 * `TAB_HI` keys its Devanagari under `'danger zone'` — but `TabBar` is passed
 * `ORG_TABS.map(t => t[0])`, so it renders the KEY, `danger`, which then misses
 * its own Devanagari entry. Two independent pieces of the design say
 * `Danger zone · संकट`; only the key-instead-of-label plumbing says otherwise.
 */
const hi = w => <span className="tabs__hi" lang="hi">{w}</span>;

export default function OrgSettingsPage() {
  const user = currentUser();
  const [params, setParams] = useSearchParams();

  const orgRole = user?.org_roles?.find(r => ORG_ROLES.includes(r.role_code));
  const isOwner = orgRole?.role_code === 'org_owner';

  // Members and Modules carry a count in the design (`SetOrg.jsx:351`), and in
  // the rendered mockup both numbers are on screen while Profile is the open
  // tab — so they cannot come only from the panels that own those lists.
  // `Tabs` renders one panel at a time, so Members has not mounted yet and has
  // nothing to report.
  //
  // Hence two writers into one guarded setter:
  //
  //   the shell   fetches both counts once, so they are present on arrival.
  //   the panels  report again as their own lists change, so adding a member
  //               does not leave a chip insisting there are still three.
  //
  // The guard is load-bearing rather than tidiness. A panel reports on every
  // load; an unguarded setState hands back a fresh object, re-renders the
  // shell, re-renders the panel and gets reported to again. Same number in,
  // same object out, no render — asserted in `orgSettingsTabs.test.jsx`.
  const [counts, setCounts] = useState({});
  const report = useCallback((key, n) => {
    setCounts(c => (c[key] === n ? c : { ...c, [key]: n }));
  }, []);

  // Counts only. A failure is silent and leaves the chip absent, because a tab
  // bar is not the place to report that a list could not be counted — the panel
  // itself does that properly when you open it.
  //
  // The dependency is a BOOLEAN, not `orgRole`. `currentUser()` builds a fresh
  // object on every call, so `org_roles.find(...)` hands back a new reference
  // each render and an effect keyed on it re-fires every time this component
  // re-renders — including the re-render its own response causes. That fetched
  // both lists twice on arrival and would have gone round again for every
  // subsequent render; it settled only because the guarded setter stopped
  // turning identical counts into new state. Caught by the request counter in
  // `orgSettingsTabs.test.jsx`, which is the whole reason it counts.
  const canReadOrg = Boolean(orgRole);
  useEffect(() => {
    if (!canReadOrg) return;
    api.get('/v1/org/members')
      .then(r => report('members', (Array.isArray(r.data) ? r.data : []).length))
      .catch(() => {});
    api.get('/v1/subscription/current')
      .then(r => report('modules', (r.data?.active_modules || []).length))
      .catch(() => {});
  }, [canReadOrg, report]);

  const tabs = useMemo(() => ([
    { value: 'profile',  label: <>Profile{hi('रूपरेखा')}</>,  content: <TabProfile /> },
    {
      value: 'members', label: <>Members{hi('सदस्य')}</>, count: counts.members,
      content: <TabMembers isOwner={isOwner} selfUserId={user?.user_id} onCount={n => report('members', n)} />,
    },
    { value: 'billing',  label: <>Billing{hi('बीजक')}</>,   content: <TabBilling /> },
    {
      value: 'modules', label: <>Modules{hi('खंड')}</>, count: counts.modules,
      content: <TabModules onCount={n => report('modules', n)} />,
    },
    { value: 'security', label: <>Security{hi('सुरक्षा')}</>, content: <TabSecurity /> },
    { value: 'danger',   label: <>Danger zone{hi('संकट')}</>, content: <TabDanger orgName={orgRole?.org_name} /> },
  ]), [isOwner, user?.user_id, orgRole?.org_name, counts.members, counts.modules, report]);

  // Denial names the grant, never the record (02 §Revision). "You are not an
  // org admin" is actionable; "no permission" sends the user to support.
  if (!orgRole) {
    return (
      <div className="st">
        <PageHeader kicker="SETTINGS" title="Organisation" sanskrit="संस्था" />
        <ErrorState kind="denied" grant="org admin or org owner on this organisation" />
      </div>
    );
  }

  const requested = params.get('tab');
  const initial = tabs.some(t => t.value === requested) ? requested : 'profile';

  return (
    <div className="st">
      <PageHeader
        kicker="SETTINGS"
        title="Organisation"
        // संस्था is the design's word for this destination (Chrome.jsx:36).
        // संगठन reads as "organising" rather than as the institution itself.
        sanskrit="संस्था"
        lede={orgRole.org_name
          ? `${orgRole.org_name} — company details, members, billing and access.`
          : 'Company details, members, billing and access.'}
      />

      <Tabs
        tabs={tabs}
        defaultTab={initial}
        // `replace`, so switching tabs does not fill the back button with six
        // entries the user then has to press their way out of.
        onChange={v => setParams(v === 'profile' ? {} : { tab: v }, { replace: true })}
      />
    </div>
  );
}
