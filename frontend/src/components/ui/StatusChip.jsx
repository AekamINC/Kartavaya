import React from 'react';
import {
  STATUS_COLORS, APPROVAL_COLORS, PUNCH_COLORS, PUNCH_LABELS,
} from '../../lib/statusColors';

// Colours and labels come from lib/statusColors.js. This file used to carry its
// own map, which disagreed with drawer/constants.js on every shared state.
const STATUS_MAP = {
  todo:           { label: 'To Do',             color: STATUS_COLORS.todo },
  in_progress:    { label: 'In Progress',       color: STATUS_COLORS.in_progress },
  in_review:      { label: 'In Review',         color: STATUS_COLORS.in_review },
  done:           { label: 'Done',              color: STATUS_COLORS.done },
  requested:      { label: 'Requested',         color: STATUS_COLORS.requested },
  // approval states
  pending:        { label: 'Awaiting Approval', color: APPROVAL_COLORS.pending },
  pending_client: { label: 'Client Review',     color: APPROVAL_COLORS.pending_client },
  approved:       { label: 'Approved',          color: APPROVAL_COLORS.approved },
  rejected:       { label: 'Rejected',          color: APPROVAL_COLORS.rejected },

  // Attendance review flags (Pahchan) — 07-pahchan.md §"Attendance states are
  // not in statusColors.js" asks for a sixth map "rather than a tenth private
  // one", so the flags resolve here and the register passes the raw flag.
  //
  // This and the `label` prop below were two independent fixes for one bug, and
  // they compose rather than duplicate: `label` lets ANY caller override a word
  // while keeping the tone, and this makes the punch flags resolve correctly
  // with no override needed. Neither is redundant — remove the spread and every
  // punch flag falls through to FALLBACK grey with its own key as the text.
  //
  // No key collides with a task or approval state.
  ...Object.fromEntries(
    Object.keys(PUNCH_LABELS).map(k => [k, { label: PUNCH_LABELS[k], color: PUNCH_COLORS[k] }]),
  ),
};

const FALLBACK = 'var(--on-surface-3)';

/**
 * `label` overrides the word STATUS_MAP would have printed, keeping the tone —
 * the dot colour and the tint — that `status` selects.
 *
 * HISTORY, because the register no longer shows it. The prop was accepted by
 * exactly one caller and honoured by none: Pahchan's register passed
 * `label={FLAG_LABEL[f]}` for every punch flag and was the only call site in the
 * build that passed it, so an eight-entry table of the things that can be wrong
 * with a punch was dead code. Measured in the rendered register, fourteen
 * punches carrying eight distinct flags rendered THREE distinct chips —
 * "Requested", "In Review", "Rejected". A punch outside its site read
 * "Requested"; a simulated location read "Rejected"; weak GPS read "In Review".
 *
 * Those are workflow words for a task, and this is not a task. The reviewer's
 * whole job on that screen is telling one kind of wrong from another, and the
 * chip was naming a category that does not exist there instead of the one that
 * does.
 *
 * The register now passes the raw flag and no label — the PUNCH_* entries in
 * STATUS_MAP above resolve it. `label` stays because it is the general answer:
 * additive, and the other eight call sites pass none and are untouched.
 */
export default function StatusChip({ status, approvalStatus, columnName, columnColor, label }) {
  // Approval state takes precedence when active
  const activeApproval = approvalStatus && approvalStatus !== 'approved' && approvalStatus !== 'rejected';
  const decidedApproval = approvalStatus === 'approved' || approvalStatus === 'rejected';

  if (activeApproval || decidedApproval) {
    const s = STATUS_MAP[approvalStatus] || { label: approvalStatus, color: FALLBACK };
    return (
      <span className="k-statuschip" style={{ '--c': s.color }}>
        <span className="k-statuschip__dot" />
        {label ?? s.label}
      </span>
    );
  }

  // Use column name + color when available (more accurate than raw status field)
  if (columnName) {
    return (
      <span className="k-statuschip" style={{ '--c': columnColor || FALLBACK }}>
        <span className="k-statuschip__dot" />
        {label ?? columnName}
      </span>
    );
  }

  const s = STATUS_MAP[status] || { label: status || '—', color: FALLBACK };
  return (
    <span className="k-statuschip" style={{ '--c': s.color }}>
      <span className="k-statuschip__dot" />
      {label ?? s.label}
    </span>
  );
}
