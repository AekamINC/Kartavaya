import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../../components/editorial';
import { Avatar } from '../../components/ui';
import { SkeletonText } from '../../components/ui/Skeleton';
import { errorKind } from '../../components/ui/ErrorState';
import { useToast } from '../../components/ui/toast';
import { api } from '../../lib/api';
import { relTime } from '../../lib/utils';

/**
 * Approvals — the first card in the reference dashboard's right column
 * (`ScreensCore.jsx::ScreenDash`, the `Card title="Approvals" hi="सम्मति"` block).
 * The build had no equivalent: `/approvals` existed as a page, but the thing the
 * design puts on the home screen — three rows you can clear without navigating —
 * was never built.
 *
 * WHY IT FETCHES ITSELF rather than taking a prop like `ReceivablesKPI`. It is
 * the only panel on Today that WRITES, so it owns state the page has no use for:
 * per-row in-flight flags, an open reason field, and a list that must reload
 * after a decision. Threading four more values through `DashboardPage` to serve
 * one card is how that file grows a second job.
 *
 * ── The decline button is not symmetric with approve, and cannot be ─────────
 * `POST /approvals/{id}/review` rejects with 400 "Rejection reason is required"
 * when `notes` is empty (`server.py:1634`). So an inline ✗ that posts straight
 * away is a button that always fails. `ApprovalsPage` solves this with a modal;
 * duplicating that modal here would be a second dialog with its own copy for one
 * field.
 *
 * Instead ✗ opens a one-line reason field inside the row. Approve stays inline,
 * because approve genuinely takes no required input. The asymmetry is the
 * server's rule made visible rather than hidden behind a button that 400s.
 *
 * `send_to_client` is deliberately NOT offered here. That flow needs the
 * project's client list and a recipient choice; it belongs on the full page, and
 * the link to it is in the card header.
 */

/** `/approvals/pending` returns two shapes — see `server.py:1418`. */
function titleOf(r) {
  return r.task_title
      || r.request_data?.title
      || r.title
      || 'Untitled request';
}

function metaOf(r) {
  const bits = [];
  if (r.request_type === 'task_completion') bits.push('Task completion');
  else if (r.request_type) bits.push(String(r.request_type).replace(/_/g, ' '));
  if (r.priority) bits.push(r.priority);
  return bits.join(' · ');
}

export default function ApprovalsCard({ onOpenApprovals }) {
  const { pushToast } = useToast();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [busy,    setBusy]    = useState({});
  const [reason,  setReason]  = useState({ id: null, text: '' });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/approvals/pending')
      .then(r => setRows(Array.isArray(r.data) ? r.data : []))
      // A failed fetch must not render as "nothing waiting on you" — that is the
      // approvals form of "the board is clear" and it is the reason someone
      // misses a payroll run.
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = async (id, status, notes = '') => {
    setBusy(b => ({ ...b, [id]: true }));
    try {
      await api.post(`/approvals/${id}/review`, { status, notes });
      pushToast({ type: 'success', title: status === 'approved' ? 'Approved' : 'Declined' });
      setReason({ id: null, text: '' });
      // Reload rather than splice: approving a task can change what else is
      // pending, and the server is the only thing that knows.
      load();
    } catch (e) {
      pushToast({
        type: 'error',
        title: 'Could not record that decision',
        message: e?.response?.data?.detail || 'Try again in a moment.',
      });
    } finally {
      setBusy(b => { const n = { ...b }; delete n[id]; return n; });
    }
  };

  const head = loading ? null
    : error ? null
    : rows.length > 0
      ? <span className="k-approvals__waiting">{rows.length} waiting</span>
      : <button className="k-link" onClick={onOpenApprovals}>History →</button>;

  return (
    <Card title="Approvals" sanskrit="सम्मति" right={head}>
      {loading ? (
        <div className="k-approvals" aria-busy="true">
          {[0, 1, 2].map(i => (
            <div key={i} className="k-approvals__row">
              <SkeletonText width={26} height={26} />
              <div className="k-approvals__body">
                <SkeletonText width="70%" height={13} />
                <SkeletonText width="45%" height={11} />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="k-approvals__failed" role="alert">
          <p className="k-today__quiet">
            {errorKind(error) === 'offline'
              ? 'We could not reach the server, so we cannot say what is waiting.'
              : errorKind(error) === 'denied'
                ? 'You do not have access to approvals in this workspace.'
                : 'Approvals did not load. This is not a claim that none are waiting.'}
          </p>
          {errorKind(error) !== 'denied' && (
            <button className="k-link" onClick={load}>Try again</button>
          )}
        </div>
      ) : rows.length === 0 ? (
        <p className="k-today__quiet">Nothing is waiting on your decision.</p>
      ) : (
        <div className="k-approvals">
          {rows.slice(0, 4).map(r => {
            const id      = r.approval_id;
            const who     = r.requester_name || r.requested_by_name || 'Someone';
            const meta    = metaOf(r);
            const when    = relTime(r.created_at);
            const isBusy  = !!busy[id];
            const asking  = reason.id === id;
            return (
              <div key={id} className="k-approvals__row">
                <Avatar name={who} size={26} />
                <div className="k-approvals__body">
                  <div className="k-approvals__title">{titleOf(r)}</div>
                  <div className="k-approvals__meta">
                    {who}{meta ? ` · ${meta}` : ''}{when ? ` · ${when}` : ''}
                  </div>
                  {asking && (
                    <div className="k-approvals__reason">
                      <input
                        className="k-approvals__reasonin"
                        autoFocus
                        value={reason.text}
                        placeholder="Why are you declining?"
                        onChange={e => setReason({ id, text: e.target.value })}
                        onKeyDown={e => {
                          if (e.key === 'Escape') setReason({ id: null, text: '' });
                          if (e.key === 'Enter' && reason.text.trim()) decide(id, 'rejected', reason.text.trim());
                        }}
                      />
                      <button
                        className="k-btn k-btn--sm"
                        disabled={!reason.text.trim() || isBusy}
                        onClick={() => decide(id, 'rejected', reason.text.trim())}
                      >
                        Decline
                      </button>
                      <button
                        className="k-btn k-btn--ghost k-btn--sm"
                        onClick={() => setReason({ id: null, text: '' })}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                {!asking && (
                  <div className="k-approvals__acts">
                    <button
                      className="k-approvals__act k-approvals__act--yes"
                      disabled={isBusy}
                      title="Approve"
                      aria-label={`Approve: ${titleOf(r)}`}
                      onClick={() => decide(id, 'approved')}
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3.2L13 5" /></svg>
                    </button>
                    <button
                      className="k-approvals__act k-approvals__act--no"
                      disabled={isBusy}
                      title="Decline — a reason is required"
                      aria-label={`Decline: ${titleOf(r)}`}
                      onClick={() => setReason({ id, text: '' })}
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {rows.length > 4 && (
            <button className="k-link k-approvals__more" onClick={onOpenApprovals}>
              {rows.length - 4} more →
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
