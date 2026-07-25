import React from 'react';

const STATUS_MAP = {
  todo:        { label: 'To Do',       color: '#94a3b8' },
  in_progress: { label: 'In Progress', color: '#0082c6' },
  in_review:   { label: 'In Review',   color: '#a78bfa' },
  done:        { label: 'Done',        color: '#05b7aa' },
  requested:   { label: 'Requested',   color: '#f59e0b' },
  pending:     { label: 'Awaiting Approval', color: '#f59e0b' },
  approved:    { label: 'Approved',    color: '#05b7aa' },
  rejected:    { label: 'Rejected',    color: '#ef4444' },
};

export function StatusChip({ status, columnName, columnColor }) {
  if (columnName) {
    return (
      <span className="k-statuschip" style={{ '--c': columnColor || '#94a3b8' }}>
        <span className="k-statuschip__dot" />{columnName}
      </span>
    );
  }
  const s = STATUS_MAP[status] || { label: status || '—', color: '#94a3b8' };
  return (
    <span className="k-statuschip" style={{ '--c': s.color }}>
      <span className="k-statuschip__dot" />{s.label}
    </span>
  );
}
