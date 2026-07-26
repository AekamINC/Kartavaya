import React from 'react';
import StatusChip from '../ui/StatusChip';
import Lbl from './DrawerLabel';

/**
 * DrawerApproval — the approval state and every panel that acts on it:
 * request, admin approve (with optional forwarding to a client), admin reject,
 * client approve/reject.
 *
 * Two things changed and one deliberately did not.
 *
 *  · The state badge is `ui/StatusChip`, so the label and the colour come from
 *    `lib/statusColors.js` (03 §5). It used to build its own pill from
 *    `APPROVAL_STATUS_COLOR` with `mixAlpha(c, 9)` behind `color: c` — a chip
 *    tinted with its own foreground can never reach 4.5:1, because deepening
 *    the tint moves the background toward the text (00 §11). StatusChip puts
 *    the colour in a dot and leaves the text on the surface.
 *  · Both Reject buttons are `.btn--danger`, which is outlined. They used to be
 *    `.k-btn--ghost` with `color: var(--k-danger)` patched on at the call site,
 *    which is the ad-hoc destructive styling 02 §1 exists to end.
 *
 * What did not change: who may do what. Gating still comes from the
 * `isOwnerAdmin` / `isClient` props the drawer resolves, because moving it to
 * per-module grants means reading the RBAC context, and that belongs with the
 * RBAC batch rather than as a side effect of a restyle.
 */
export default function DrawerApproval({
  task,
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
  return (
    <div className="dr__ap">
      <div className="dr__ap-head">
        <Lbl hi="अनुमोदन">Approval</Lbl>
        {task.approval_status && <StatusChip approvalStatus={task.approval_status} />}
      </div>

      {/* No approval yet */}
      {!task.approval_status && !showRequestPanel && (
        <div className="dr__ap-acts">
          <button type="button" className="btn btn--out btn--sm" onClick={() => setShowRequestPanel(true)}>
            Send for approval
          </button>
        </div>
      )}

      {/* Previously rejected — offer a resend */}
      {task.approval_status === 'rejected' && !showRequestPanel && (
        <div className="dr__ap-acts">
          <button type="button" className="btn btn--out btn--sm" onClick={() => setShowRequestPanel(true)}>
            Re-send for approval
          </button>
        </div>
      )}

      {showRequestPanel && (
        <div className="dr__ap-panel">
          <textarea
            className="dr__ta dr__ta--flat"
            aria-label="Notes for the approver"
            placeholder="Notes for the approver (optional)…"
            rows={2}
            value={requestNotes}
            onChange={e => setRequestNotes(e.target.value)}
          />
          <div className="dr__ap-acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowRequestPanel(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn--fill btn--sm" onClick={requestApproval} disabled={approvalLoading}>
              {approvalLoading ? 'Sending…' : 'Send for approval'}
            </button>
          </div>
        </div>
      )}

      {/* Admin: decide a pending request */}
      {isOwnerAdmin && task.approval_status === 'pending' && !showApprovePanel && !showRejectInput && (
        <div className="dr__ap-acts">
          <button type="button" className="btn btn--fill btn--sm" onClick={openApprovePanel}>Approve</button>
          <button type="button" className="btn btn--danger btn--sm" onClick={() => setShowRejectInput(true)}>Reject</button>
        </div>
      )}

      {showApprovePanel && (
        <div className="dr__ap-panel">
          <textarea
            className="dr__ta dr__ta--flat"
            aria-label="Approval notes"
            placeholder="Notes (optional)…"
            rows={2}
            value={approvalNotes}
            onChange={e => setApprovalNotes(e.target.value)}
          />
          <div>
            <div className="dr__ap-sub" id="dr-fwd-lbl">Send to client for approval?</div>
            {clientList.length === 0 ? (
              <div className="dr__ap-none">No clients on this project.</div>
            ) : (
              <select
                className="inp"
                aria-labelledby="dr-fwd-lbl"
                value={clientUserId}
                onChange={e => setClientUserId(e.target.value)}
              >
                <option value="">— Skip, mark as done —</option>
                {clientList.map(c => (
                  <option key={c.user_id} value={c.user_id}>
                    {c.display_name}{c.email ? ` (${c.email})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="dr__ap-acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowApprovePanel(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn--fill btn--sm" onClick={approveTask} disabled={approvalLoading}>
              {approvalLoading ? 'Working…' : clientUserId ? 'Approve & send to client' : 'Approve & done'}
            </button>
          </div>
        </div>
      )}

      {/* Admin: reject */}
      {showRejectInput && isOwnerAdmin && task.approval_status === 'pending' && (
        <div className="dr__ap-panel">
          <textarea
            className="dr__ta dr__ta--flat"
            aria-label="Reason for rejection"
            placeholder="Reason for rejection (required)…"
            rows={2}
            value={rejectNote}
            onChange={e => setRejectNote(e.target.value)}
          />
          <div className="dr__ap-acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowRejectInput(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn--danger btn--sm" onClick={rejectTask}
              disabled={approvalLoading || !rejectNote.trim()}>
              {approvalLoading ? 'Working…' : 'Reject'}
            </button>
          </div>
        </div>
      )}

      {/* Client: decide */}
      {isClient && task.approval_status === 'pending_client' && !showRejectInput && (
        <div className="dr__ap-acts">
          <button type="button" className="btn btn--fill btn--sm" onClick={clientApproveTask} disabled={approvalLoading}>
            {approvalLoading ? 'Working…' : 'Approve'}
          </button>
          <button type="button" className="btn btn--danger btn--sm" onClick={() => setShowRejectInput(true)}>
            Reject
          </button>
        </div>
      )}

      {isClient && task.approval_status === 'pending_client' && showRejectInput && (
        <div className="dr__ap-panel">
          <textarea
            className="dr__ta dr__ta--flat"
            aria-label="Reason for rejection"
            placeholder="Reason for rejection (required)…"
            rows={2}
            value={rejectNote}
            onChange={e => setRejectNote(e.target.value)}
          />
          <div className="dr__ap-acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowRejectInput(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn--danger btn--sm" onClick={clientRejectTask}
              disabled={approvalLoading || !rejectNote.trim()}>
              {approvalLoading ? 'Working…' : 'Reject'}
            </button>
          </div>
        </div>
      )}

      {/* Internal users, while the client reviews */}
      {!isClient && task.approval_status === 'pending_client' && (
        <p className="dr__ap-wait">Approval request sent to the client. Waiting for their response.</p>
      )}
    </div>
  );
}
