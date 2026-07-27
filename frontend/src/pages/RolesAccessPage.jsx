import React from 'react';
import { PageHeader } from '../components/editorial';
import { ErrorState } from '../components/ui';
import { currentUser } from '../lib/auth';

import TabMembers from './org/TabMembers';

import '../styles/org.css';

/**
 * RolesAccessPage — `Roles & access` · अधिकार, the Settings destination the
 * design has and the build did not (`Chrome.jsx:36`, rendered).
 *
 * Everything this screen does was already built and already wired; what was
 * missing was a way in. The roster, the access matrix and the invitation list
 * lived exclusively as `Organisation ▸ Members`, so the answer to "who can
 * reach payroll" was three clicks inside a tab named after something else.
 *
 * It mounts `org/TabMembers` on its matrix half rather than copying it. The
 * design draws the same line — `SetOrg.jsx:130` sends the reader from the
 * Organisation roster to this screen for the grid — and one component behind
 * both means the add, invite, revoke and regrant paths cannot drift apart.
 *
 * ── What is NOT here, and why ────────────────────────────────────────────────
 *
 * `ScreensRBAC.jsx:73` gives this screen ten tabs. Three are built and are on
 * this page: members, matrix, invitations. Four more — role levels, denied
 * states, client portal, module rules — are explanatory screens that document
 * the model rather than change it; they need no endpoint and are not yet built.
 * The last three cannot be built honestly today:
 *
 *   support access   `platform_support_sessions` does not exist
 *                    (`middleware/role_tiers.py:46`)
 *   audit log        `staging.audit_log` does not exist
 *                    (`routers/org_modules.py:150`)
 *   projects         project-scoped grants have no read endpoint
 *
 * A tab that renders controls over a table that is not there is the failure
 * this codebase has already shipped once. They stay off until the tables land.
 */

const ORG_ROLES = ['org_owner', 'org_admin'];

export default function RolesAccessPage() {
  const user = currentUser();
  const orgRole = user?.org_roles?.find(r => ORG_ROLES.includes(r.role_code));
  const isOwner = orgRole?.role_code === 'org_owner';

  // Denial names the grant, never the record (02 §Revision).
  if (!orgRole) {
    return (
      <div className="st">
        <PageHeader kicker="SETTINGS" title="Roles &amp; access" sanskrit="अधिकार" />
        <ErrorState kind="denied" grant="org admin or org owner on this organisation" />
      </div>
    );
  }

  return (
    <div className="st">
      <PageHeader
        kicker="SETTINGS"
        title="Roles &amp; access"
        sanskrit="अधिकार"
        lede="Aekam enables modules for this organisation. You grant them to people, at a level per module."
      />

      <TabMembers isOwner={isOwner} selfUserId={user?.user_id} defaultView="matrix" />
    </div>
  );
}
