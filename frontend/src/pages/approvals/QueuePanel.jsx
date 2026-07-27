import React from 'react';
import { Card, CardHead, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { SkeletonText } from '../../components/ui/Skeleton';
import ApprovalRow from './ApprovalRow';

/**
 * The pending queue, with LOADING, ERROR and EMPTY as three separate states.
 *
 * This is the defect this page existed to demonstrate. `load()` caught every
 * failure into a toast and left `requests` at `[]`, and the render then said:
 *
 *     {!loading && rows.length === 0 && <EmptyState title="No pending approvals" />}
 *
 * So a 500, a dropped connection or an expired session all produced the
 * sentence "No pending approvals — you are all caught up." on a queue that had
 * not been read. A toast is transient and the empty state is permanent, so
 * thirty seconds later the screen was simply lying.
 *
 * On most screens that is a cosmetic bug. Here an empty queue is a reason to
 * STOP LOOKING: the reviewer closes the tab and the work sits unapproved. The
 * three states are now mutually exclusive branches and `error` outranks
 * `empty`, because "we could not read the queue" is never improved by guessing
 * that the queue is empty.
 */
export default function QueuePanel({
  title, sanskrit, rows, loading, error, onRetry,
  isClient, deciding, onOpenTask, onApprove, onReject,
}) {
  return (
    <Card>
      <CardHead title={title} sanskrit={sanskrit} />
      <CardBody flush>
        {loading && (
          <div className="apv-row" aria-busy="true" aria-label="Loading approvals">
            <div className="apv-row__main">
              <div className="apv-row__body">
                <SkeletonText width="55%" height={14} />
                <SkeletonText width="80%" height={11} />
                <SkeletonText width="35%" height={10} />
              </div>
            </div>
          </div>
        )}

        {!loading && error && (
          <ErrorState kind={error} onRetry={onRetry} />
        )}

        {!loading && !error && rows.length === 0 && (
          <EmptyState
            illustration="success"
            title={{ en: 'No pending approvals', hi: 'कोई लंबित अनुमोदन नहीं' }}
            description={isClient
              ? 'No tasks are awaiting your review right now.'
              : 'Nothing pending right now — you are all caught up.'}
          />
        )}

        {!loading && !error && rows.map((row) => (
          <ApprovalRow
            key={row.approval_id}
            row={row}
            isClient={isClient}
            deciding={!!deciding[row.approval_id]}
            onOpenTask={onOpenTask}
            onApprove={onApprove}
            onReject={onReject}
          />
        ))}
      </CardBody>
    </Card>
  );
}
