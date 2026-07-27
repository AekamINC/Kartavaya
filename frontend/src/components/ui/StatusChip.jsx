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

  // Attendance review flags (Pahchan). Folded in from PUNCH_* rather than kept
  // as a private map on the register — 07-pahchan.md §"Attendance states are not
  // in statusColors.js" is explicit about wanting one file to look in.
  //
  // THIS FIXES A LIVE DEFECT, not a hypothetical one. `Register.jsx` was calling
  // `<StatusChip status={FLAG_TONE[f]} label={FLAG_LABEL[f]} />` — and this
  // component takes no `label` prop, so every flag chip in the register rendered
  // a generic task word: "Requested" where the spec says "Outside site",
  // "Rejected" where it says "Simulated location", "In Review" for weak GPS. The
  // reviewer's only per-row summary of WHY a punch needs a look was four
  // task-tracker nouns that say nothing about attendance. `EnrollQueue.jsx` lost
  // its labels the same way. No key collides with a task or approval state.
  ...Object.fromEntries(
    Object.keys(PUNCH_LABELS).map(k => [k, { label: PUNCH_LABELS[k], color: PUNCH_COLORS[k] }]),
  ),
};

const FALLBACK = 'var(--on-surface-3)';

/**
 * `label` overrides the word STATUS_MAP would have printed, keeping the tone —
 * the dot colour and the tint — that `status` selects.
 *
 * It was accepted by exactly one caller and honoured by none. Pahchan's
 * register passes `label={FLAG_LABEL[f]}` for every punch flag
 * (Register.jsx:419) and is the only call site in the build that passes it, so
 * the prop was dropped on the floor and its whole eight-entry table was dead
 * code. Measured in the rendered register: fourteen punches carrying eight
 * distinct flags rendered THREE distinct chips — "Requested", "In Review",
 * "Rejected". A punch that was outside its site read "Requested"; one with a
 * simulated location read "Rejected"; weak GPS read "In Review".
 *
 * Those are workflow words for a task, and this is not a task. The reviewer's
 * whole job on this screen is to tell one kind of wrong from another, and the
 * chip was telling them a category that does not exist here instead of the one
 * that does. Additive: the other eight call sites pass no `label` and are
 * untouched.
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
