import React from 'react';
import { Card, CardHead, CardBody } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/ErrorState';
import { SkeletonText } from '../../components/ui/Skeleton';
import StatusChip from '../../components/ui/StatusChip';
import { relTime } from '../../lib/utils';

/**
 * Recent decisions.
 *
 * Rendered only when `history.length > 0` before, which folded three different
 * situations into one blank space: still loading, failed to load, and genuinely
 * no decisions yet. `/approvals/history` was fetched with `.catch(() => {})` —
 * a swallowed rejection with no state written anywhere — so a failure was
 * indistinguishable from a quiet week.
 *
 * The empty case still renders nothing, and that is deliberate: this is a
 * secondary panel and a firm that has decided nothing today does not need to be
 * told so twice. A FAILURE is different — it gets said out loud, because the
 * absence of a decision list is otherwise read as "nothing was decided", which
 * on an audit surface is a claim, not a blank.
 */
export default function HistoryPanel({ rows, loading, error, onRetry }) {
  if (!loading && !error && !rows.length) return null;

  return (
    <Card>
      <CardHead title="Recent decisions" sanskrit="हाल के निर्णय" />
      <CardBody flush>
        {loading && (
          <div className="apv-row" aria-busy="true" aria-label="Loading recent decisions">
            <div className="apv-row__main">
              <div className="apv-row__body">
                <SkeletonText width="45%" height={13} />
                <SkeletonText width="30%" height={10} />
              </div>
            </div>
          </div>
        )}

        {!loading && error && <ErrorState kind={error} onRetry={onRetry} />}

        {!loading && !error && rows.slice(0, 8).map((h, i) => (
          <div key={h.approval_id || i} className="apv-row">
            <div className="apv-row__main">
              <StatusChip status={h.status} />
              <div className="apv-row__body">
                <div className="apv-row__t">{h.task_title || 'Untitled'}</div>
                <div className="apv-row__meta">
                  <span>{relTime(h.updated_at || h.created_at)}</span>
                  {h.notes && <span>· {h.notes}</span>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
