import React from 'react';
import { Menu, avatarBg } from '../../components/ui';
import { userInitials } from '../../lib/utils';
import GrantChips from './GrantChips';

/**
 * MemberTable — one row per member, grants visible without opening anything.
 *
 * The old list was a stack of flex divs with a `<select>` for the role and a
 * "Modules" button that expanded a checkbox grid inline, which pushed every row
 * below it down the page. A real `<table>` gets the header/cell association from
 * `<th scope>` for free, and the row actions collapse into one Menu so the row
 * does not grow a fourth and fifth control as the model gains verbs.
 *
 * Tier 2, settled 2026-07-26: org_owner and org_admin both manage the org.
 * Neither can be removed here and neither can be demoted here — an owner change
 * is Aekam's to make (see TabDanger). What an OWNER decides alone is which
 * modules an org_admin may reach, which is why `canEditGrants` is a function of
 * `isOwner` for admin rows and true for member rows.
 *
 * That last sentence is the model, not yet the enforcement. `require_module`
 * admits any org_admin regardless of grant rows, so an admin's grants are
 * currently a statement of intent rather than a limit — the grant sheet says so
 * on the admin rows it applies to, and the gap is in the report.
 */

const ROLE_META = {
  org_owner:  { label: 'Owner',  color: 'var(--primary-text)' },
  org_admin:  { label: 'Admin',  color: 'var(--st-in-review)' },
  org_member: { label: 'Member', color: 'var(--on-surface-3)' },
};

const roleMeta = code => ROLE_META[code] || {
  // `org_member`.replace('_', ' ') rendered "org member" — lowercase, to the user.
  label: String(code || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  color: 'var(--on-surface-3)',
};

const Dots = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
  </svg>
);

export default function MemberTable({ members, isOwner, selfUserId, onEditGrants, onChangeRole, onRemove }) {
  return (
    <div className="omt__wrap">
      <table className="omt">
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Role</th>
            <th scope="col">Module grants</th>
            <th scope="col"><span className="k-sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => {
            const owner = m.role_code === 'org_owner';
            const admin = m.role_code === 'org_admin';
            const self = m.user_id === selfUserId;
            const meta = roleMeta(m.role_code);
            // An owner's grants are not editable by anyone in the org: the owner
            // reaches everything by role, and an admin editing them would be
            // privilege escalation by way of a settings screen.
            const canEditGrants = !owner && (isOwner || !admin);

            const actions = [
              canEditGrants && { id: 'grants', label: 'Edit module grants', onSelect: () => onEditGrants(m) },
              !owner && !self && {
                id: 'role',
                label: admin ? 'Make org member' : 'Make org admin',
                onSelect: () => onChangeRole(m, admin ? 'org_member' : 'org_admin'),
              },
              !owner && !self && { sep: true },
              !owner && !self && { id: 'remove', label: 'Remove from organisation', danger: true, onSelect: () => onRemove(m) },
            ].filter(Boolean);

            return (
              <tr key={m.user_id}>
                <td>
                  <span className="omt__who">
                    {/* `av` then `omt__av`: the shared avatar (02 §2) supplies the
                        circle, the --av-bg ground, the overflow clip and the
                        image rule; omt__av restates only the size and the
                        initial's weight, which is all 10 §1 actually pins. */}
                    <span className="av omt__av" style={{ '--av-bg': m.avatar_url ? 'transparent' : avatarBg(m.full_name || m.email) }}>
                      {m.avatar_url
                        ? <img src={m.avatar_url} alt="" />
                        : userInitials(m.full_name || m.email || '?')}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="omt__n">{m.full_name || m.email}</span>
                      <span className="omt__e">
                        {m.email}{m.mobile_number ? ` · ${m.mobile_number}` : ''}
                      </span>
                    </span>
                  </span>
                </td>
                <td>
                  <span className="rb" style={{ '--c': meta.color }}>
                    <span className="rb__dot" />
                    {meta.label}
                    {self && ' · you'}
                  </span>
                </td>
                <td>
                  {owner || admin
                    // Not "No modules", and no longer "Org management only" for
                    // an admin. `middleware/subscription.py` gate 2 short-circuits
                    // for BOTH org roles —
                    //     org_role = ... IN ('org_owner','org_admin')
                    //     if not org_role:   # org_member needs explicit grant
                    // — so an admin with no grant row reaches every active module,
                    // exactly as the owner does. "Org management only" understated
                    // it, which is the wrong direction for a cell an auditor reads.
                    ? <GrantChips grants={m.grants} empty="Every active module, by role" />
                    : <GrantChips grants={m.grants} />}
                </td>
                <td>
                  <span className="omt__act">
                    {actions.length > 0 && (
                      <Menu
                        align="right"
                        label={`Actions for ${m.full_name || m.email}`}
                        items={actions}
                        trigger={Dots}
                      />
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
