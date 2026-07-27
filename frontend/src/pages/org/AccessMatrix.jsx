import React, { useMemo } from 'react';
import { ORG_MODULES, isModuleActive } from './catalogue';
import { isSeparatedDuty, levelColor, levelLabel } from './levels';

/**
 * AccessMatrix — every member against every module, in one grid (08 §1).
 *
 * The member list answers "what can this person reach". This answers the
 * question an auditor actually asks, which is the transpose: "who can reach
 * payroll". Three chips and a `+n` per row cannot answer it — the fourth grant
 * is behind a hover, and you cannot compare a column that is not drawn.
 *
 * Read-only, deliberately. Editing happens one member at a time in the sheet,
 * where the separated-duty rule and the sensitive tag are on the row being
 * changed. A grid of clickable cells is a fast way to give someone payroll by
 * mis-clicking one row down.
 *
 * ── Two things this grid must not lie about ────────────────────────────────
 * 1 · org_owner and org_admin reach every ACTIVE module without a grant row.
 *     `middleware/subscription.py` gate 2 returns early for both:
 *
 *         org_role = ... role_code IN ('org_owner','org_admin')
 *         if not org_role:   # org_member needs explicit grant
 *
 *     So an owner or admin row with no grants is not "no access" — it is total
 *     access, and drawing an empty row would be the most misleading thing on
 *     this screen. Those cells read "by role".
 *
 * 2 · On Vetana and Ganit, admin does not satisfy approver. A cell reading
 *     `Admin` on those two columns means the person configures the module and
 *     CANNOT release money against it. The column header carries the marker so
 *     the qualification is attached to the cells it governs.
 */

/** What one member/module cell says, and what colour it says it in. */
function cellFor(member, code) {
  const grant = (member.grants || []).find(g => g.code === code);
  if (grant) {
    const level = grant.level || 'viewer';
    return { label: levelLabel(level), color: levelColor(level), set: true, kind: 'grant' };
  }
  if (member.role_code === 'org_owner' || member.role_code === 'org_admin') {
    return { label: 'by role', color: 'var(--on-surface-2)', set: true, kind: 'role' };
  }
  return { label: '—', set: false, kind: 'none' };
}

export default function AccessMatrix({ members = [], activeCodes = null }) {
  const modules = ORG_MODULES;

  // Precomputed once rather than per cell: isModuleActive walks the catalogue on
  // every call and this would otherwise run members × modules times.
  //
  // `null` means the subscription is unknown — not that nothing is subscribed.
  // Defaulting to an empty array would dim all twelve columns on a failed
  // request, which reads as "this org has no modules" rather than "we could not
  // check", and that is the more alarming of the two to be wrong about.
  const active = useMemo(
    () => (activeCodes == null
      ? null
      : new Set(modules.filter(m => isModuleActive(m.code, activeCodes)).map(m => m.code))),
    [modules, activeCodes],
  );
  const isOn = code => active == null || active.has(code);

  if (!members.length) return null;

  return (
    <>
      {/* tabIndex on a scroll container, so the grid can be reached and panned
          from the keyboard. A horizontally scrolling region that only responds
          to a trackpad is unreachable for anyone not using one (23 §keyboard). */}
      <div className="amx" tabIndex={0} role="region" aria-label="Module access by member">
        <table>
          <thead>
            <tr>
              <th scope="col">Member</th>
              {modules.map(m => (
                <th
                  key={m.code}
                  scope="col"
                  className={isOn(m.code) ? undefined : 'amx__off'}
                  title={isOn(m.code) ? undefined : 'Not active on this subscription'}
                >
                  {m.label}
                  {isSeparatedDuty(m.code) && ' · sep'}
                  {!isOn(m.code) && ' · off'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map(member => (
              <tr key={member.user_id}>
                <th scope="row">{member.full_name || member.email}</th>
                {modules.map(m => {
                  const c = cellFor(member, m.code);
                  return (
                    <td key={m.code}>
                      <span
                        className={`amx__cell${c.set ? ' set' : ''}`}
                        style={c.color ? { '--c': c.color } : undefined}
                      >
                        {/* An em dash announces as "em dash", which is not the
                            information. Twelve of them per empty row is worse. */}
                        {c.kind === 'none' ? (
                          <>
                            <span aria-hidden="true">—</span>
                            <span className="k-sr-only">No access</span>
                          </>
                        ) : c.label}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="of__h of__h--foot">
        <strong>· sep</strong> marks Vetana and Ganit, where <strong>Admin does not
        include Approver</strong> — admin is breadth (salary structures, chart of
        accounts), approver is depth (release payments, close periods). A cell
        reading <em>Admin</em> in one of those two columns configures the module and
        cannot release money against it.
      </p>
      <p className="of__h">
        <strong>by role</strong> is an owner or admin reaching a module through their
        organisation role rather than a grant row. <strong>· off</strong> is a module
        that is not active on this subscription — the column still paints, because a
        grant that outlived its subscription is exactly the row worth finding.
      </p>
    </>
  );
}
