import React from 'react';
import { STATUS_COLORS, APPROVAL_COLORS } from '../../lib/statusColors';

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
};

const FALLBACK = 'var(--on-surface-3)';

export default function StatusChip({ status, approvalStatus, columnName, columnColor }) {
  // Approval state takes precedence when active
  const activeApproval = approvalStatus && approvalStatus !== 'approved' && approvalStatus !== 'rejected';
  const decidedApproval = approvalStatus === 'approved' || approvalStatus === 'rejected';

  if (activeApproval || decidedApproval) {
    const s = STATUS_MAP[approvalStatus] || { label: approvalStatus, color: FALLBACK };
    return (
      <span className="k-statuschip" style={{ '--c': s.color }}>
        <span className="k-statuschip__dot" />
        {s.label}
      </span>
    );
  }

  // Use column name + color when available (more accurate than raw status field)
  if (columnName) {
    return (
      <span className="k-statuschip" style={{ '--c': columnColor || FALLBACK }}>
        <span className="k-statuschip__dot" />
        {columnName}
      </span>
    );
  }

  const s = STATUS_MAP[status] || { label: status || '—', color: FALLBACK };
  return (
    <span className="k-statuschip" style={{ '--c': s.color }}>
      <span className="k-statuschip__dot" />
      {s.label}
    </span>
  );
}
