import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/editorial';
import { Tabs, ErrorState } from '../components/ui';
import { currentUser } from '../lib/auth';

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

export default function OrgSettingsPage() {
  const user = currentUser();
  const [params, setParams] = useSearchParams();

  const orgRole = user?.org_roles?.find(r => ORG_ROLES.includes(r.role_code));
  const isOwner = orgRole?.role_code === 'org_owner';

  const tabs = useMemo(() => ([
    { value: 'profile',  label: 'Profile',  content: <TabProfile /> },
    { value: 'members',  label: 'Members',  content: <TabMembers isOwner={isOwner} selfUserId={user?.user_id} /> },
    { value: 'billing',  label: 'Billing',  content: <TabBilling /> },
    { value: 'modules',  label: 'Modules',  content: <TabModules /> },
    { value: 'security', label: 'Security', content: <TabSecurity /> },
    { value: 'danger',   label: 'Danger',   content: <TabDanger orgName={orgRole?.org_name} /> },
  ]), [isOwner, user?.user_id, orgRole?.org_name]);

  // Denial names the grant, never the record (02 §Revision). "You are not an
  // org admin" is actionable; "no permission" sends the user to support.
  if (!orgRole) {
    return (
      <div className="st">
        <PageHeader kicker="SETTINGS" title="Organisation" sanskrit="संगठन" />
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
        sanskrit="संगठन"
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
