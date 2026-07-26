import React from 'react';
import { APPROVAL_STATUS_LABEL, APPROVAL_STATUS_COLOR } from './constants';
import { mixAlpha } from '../../lib/statusColors';

/**
 * DrawerApproval — approval status badge plus all action panels:
 * request, admin approve (with optional client forwarding), admin reject,
 * client approve/reject.
 */
export default function DrawerApproval({
  task,
  isApprovalColumn,
  isOwnerAdmin, isClient,
  showApprovePanel,  setShowApprovePanel,
  showRequestPanel,  setShowRequestPanel,
  showRejectInput,   setShowRejectInput,
  approvalLoading,
  approvalNotes,     setApprovalNotes,
  requestNotes,      setRequestNotes,
  rejectNote,        setRejectNote,
  clientList,        clientUserId, setClientUserId,
  requestApproval,   openApprovePanel,
  approveTask,       rejectTask,
  clientApproveTask, clientRejectTask,
}) {
  const statusColor = APPROVAL_STATUS_COLOR[task.approval_status] || 'var(--on-surface-3)';

  return (
    <div style={{
      marginBottom: 20, padding: '14px 16px',
      background: 'var(--bg-soft)', border: '1px solid var(--rule)',
      borderRadius: 'var(--r-md)',
    }}>
      {/* Label + status badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: task.approval_status ? 10 : 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
          Approval{' '}
          <span style={{ fontFamily: 'var(--font-hindi)', textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 12 }}>
            &#x0905;&#x0928;&#x0941;&#x092E;&#x094B;&#x0926;&#x0928;
          </span>
        </span>
        {task.approval_status && (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 99,
            color: statusColor,
            background: mixAlpha(statusColor, 9),
            border: `1px solid ${mixAlpha(statusColor, 25)}`,
          }}>
            {APPROVAL_STATUS_LABEL[task.approval_status] || task.approval_status}
          </span>
        )}
      </div>

      {/* Request approval (no active approval) */}
      {!task.approval_status && !showRequestPanel && (
        <button
          className="k-btn k-btn--ghost k-btn--sm"
          onClick={() => setShowRequestPanel(true)}
          style={{ marginTop: 4, fontSize: 12 }}
        >
          &#8594; Send for Approval
        </button>
      )}

      {showRequestPanel && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={requestNotes}
            onChange={e => setRequestNotes(e.target.value)}
            placeholder="Notes for the approver (optional)&hellip;"
            rows={2}
            className="k-input"
            style={{ width: '100%', resize: 'none', boxSizing: 'border-box', fontSize: 12 }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="k-btn k-btn--ghost k-btn--sm" onClick={() => setShowRequestPanel(false)}>Cancel</button>
            <button className="k-btn k-btn--primary k-btn--sm" onClick={requestApproval} disabled={approvalLoading}>
              {approvalLoading ? '…' : '→ Send for Approval'}
            </button>
          </div>
        </div>
      )}

      {/* Re-send if previously rejected */}
      {task.approval_status === 'rejected' && !showRequestPanel && (
        <button
          className="k-btn k-btn--ghost k-btn--sm"
          onClick={() => setShowRequestPanel(true)}
          style={{ marginTop: 6, fontSize: 12 }}
        >
          &#8594; Re-send for Approval
        </button>
      )}

      {/* Admin: approve / reject when pending */}
      {isOwnerAdmin && task.approval_status === 'pending' && !showApprovePanel && !showRejectInput && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button className="k-btn k-btn--primary k-btn--sm" onClick={openApprovePanel}>&#10004; Approve</button>
          <button
            className="k-btn k-btn--ghost k-btn--sm"
            onClick={() => setShowRejectInput(true)}
            style={{ color: 'var(--k-danger)' }}
          >
            &#10005; Reject
          </button>
        </div>
      )}

      {/* Admin: approve panel with optional client forwarding */}
      {showApprovePanel && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={approvalNotes}
            onChange={e => setApprovalNotes(e.target.value)}
            placeholder="Notes (optional)&hellip;"
            rows={2}
            className="k-input"
            style={{ width: '100%', resize: 'none', boxSizing: 'border-box', fontSize: 12 }}
          />
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 5 }}>
              Send to client for approval?
            </div>
            {clientList.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontStyle: 'italic' }}>No clients on this project.</div>
            ) : (
              <select
                value={clientUserId}
                onChange={e => setClientUserId(e.target.value)}
                className="k-input"
                style={{ width: '100%', fontSize: 12, boxSizing: 'border-box' }}
              >
                <option value="">&ndash; Skip, mark as Done &ndash;</option>
                {clientList.map(c => (
                  <option key={c.user_id} value={c.user_id}>
                    {c.display_name}{c.email ? ` (${c.email})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="k-btn k-btn--ghost k-btn--sm" onClick={() => setShowApprovePanel(false)}>Cancel</button>
            <button className="k-btn k-btn--primary k-btn--sm" onClick={approveTask} disabled={approvalLoading}>
              {approvalLoading ? '…' : clientUserId ? '✔ Approve & Send to Client' : '✔ Approve & Done'}
            </button>
          </div>
        </div>
      )}

      {/* Admin: reject panel */}
      {showRejectInput && isOwnerAdmin && task.approval_status === 'pending' && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={rejectNote}
            onChange={e => setRejectNote(e.target.value)}
            placeholder="Reason for rejection (required)&hellip;"
            rows={2}
            className="k-input"
            style={{ width: '100%', resize: 'none', boxSizing: 'border-box', fontSize: 12 }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="k-btn k-btn--ghost k-btn--sm" onClick={() => setShowRejectInput(false)}>Cancel</button>
            <button
              className="k-btn k-btn--ghost k-btn--sm"
              onClick={rejectTask}
              disabled={approvalLoading || !rejectNote.trim()}
              style={{ color: 'var(--k-danger)', borderColor: 'var(--k-danger)' }}
            >
              {approvalLoading ? '…' : '✕ Reject'}
            </button>
          </div>
        </div>
      )}

      {/* Client: approve / reject when pending_client */}
      {isClient && task.approval_status === 'pending_client' && !showRejectInput && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button className="k-btn k-btn--primary k-btn--sm" onClick={clientApproveTask} disabled={approvalLoading}>
            {approvalLoading ? '…' : '✔ Approve'}
          </button>
          <button
            className="k-btn k-btn--ghost k-btn--sm"
            onClick={() => setShowRejectInput(true)}
            style={{ color: 'var(--k-danger)' }}
          >
            ✕ Reject
          </button>
        </div>
      )}

      {isClient && task.approval_status === 'pending_client' && showRejectInput && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={rejectNote}
            onChange={e => setRejectNote(e.target.value)}
            placeholder="Reason for rejection (required)&hellip;"
            rows={2}
            className="k-input"
            style={{ width: '100%', resize: 'none', boxSizing: 'border-box', fontSize: 12 }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="k-btn k-btn--ghost k-btn--sm" onClick={() => setShowRejectInput(false)}>Cancel</button>
            <button
              className="k-btn k-btn--ghost k-btn--sm"
              onClick={clientRejectTask}
              disabled={approvalLoading || !rejectNote.trim()}
              style={{ color: 'var(--k-danger)', borderColor: 'var(--k-danger)' }}
            >
              {approvalLoading ? '…' : '✕ Reject'}
            </button>
          </div>
        </div>
      )}

      {/* Internal users: waiting message while client reviews */}
      {!isClient && task.approval_status === 'pending_client' && (
        <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '8px 0 0' }}>
          Approval request sent to client. Waiting for their response.
        </p>
      )}
    </div>
  );
}
