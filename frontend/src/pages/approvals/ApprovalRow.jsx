import React from 'react';
import { relTime } from '../../lib/utils';
import { PriorityDot, DueChip } from '../../components/editorial';
import Button from '../../components/ui/Button';
import StatusChip from '../../components/ui/StatusChip';

/**
 * One row in the pending queue.
 *
 * Split out of ApprovalsPage.jsx, which rendered this inline three times over
 * with slightly different action sets — the staff pair, the client pair, and a
 * status-only variant — so a change to the row had to be made three times and
 * had drifted twice already.
 *
 * `request_data` arrives as either a JSON string or an object depending on
 * which of the two queries in `/approvals/pending` produced the row (the
 * approvals table stores it as text; the task-level branch builds a dict). The
 * parse is guarded because a malformed value here previously threw inside the
 * map and blanked the ENTIRE queue — one bad row taking out every good one.
 */
function requestData(raw) {
  if (!raw) return {};
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

export default function ApprovalRow({ row, isClient, deciding, onOpenTask, onApprove, onReject }) {
  const data = requestData(row.request_data);
  const title = data.title || row.task_title || 'Untitled task';
  const desc = data.description || row.notes || '';
  const priority = data.priority || row.priority || 'medium';
  const requester = row.requester_name || row.requested_by_name || (isClient ? 'You' : 'Client');

  const isTaskApproval = !!row.approval_id?.startsWith('task_approval--');
  const staffActions = !isClient;
  const clientActions = isClient && isTaskApproval && row.approval_status === 'pending_client';

  return (
    <div className="apv-row">
      <div className="apv-row__main">
        <PriorityDot priority={priority} />
        <div className="apv-row__body">
          {row.task_id ? (
            /* A real <button>. This was a <div onClick> with cursor:pointer set
               from an inline ternary, so it was unreachable by keyboard and
               invisible to a screen reader — on the control that opens the work
               you are being asked to judge. */
            <button type="button" className="apv-row__t--link" onClick={() => onOpenTask(row.task_id)}>
              {title}
            </button>
          ) : (
            <div className="apv-row__t">{title}</div>
          )}

          {desc && <div className="apv-row__desc">{desc}</div>}

          <div className="apv-row__meta">
            <span>Requested by <strong>{requester}</strong></span>
            {row.created_at && <span>· {relTime(row.created_at)}</span>}
            {row.task_due_at && <DueChip date={row.task_due_at} />}
          </div>
        </div>
      </div>

      {(staffActions || clientActions) && (
        <div className="apv-row__actions">
          <Button
            variant="fill"
            size="sm"
            loading={deciding}
            onClick={() => onApprove(row.approval_id, row.team_id)}
          >
            Approve
          </Button>
          <Button variant="danger" size="sm" disabled={deciding} onClick={() => onReject(row.approval_id)}>
            Reject
          </Button>
        </div>
      )}

      {isClient && !isTaskApproval && <StatusChip status="pending" label="Pending admin review" />}
    </div>
  );
}
