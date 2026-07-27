import React from 'react';
import { Modal } from '../../components/ui/modal';
import { Field, Textarea, Select } from '../../components/ui/Field';
import Button from '../../components/ui/Button';

/**
 * The three decision dialogs, split out of ApprovalsPage.jsx.
 *
 * Each previously hand-rolled its own label — the same nine CSS properties
 * inline, four times over, once with `--ink-3` and three times with
 * `--on-surface-3` — and its own textarea sizing. They are `Field` + `Textarea`
 * now, so the label, the focus ring and the disabled treatment come from the
 * system and match every other form in the product.
 *
 * `k-btn k-btn--primary` in the footers is `Button variant="fill"`: the legacy
 * class pair predates the current button system and has no `:active` scale, no
 * loading state and a different corner radius from every other button on the
 * page it opens over.
 */

function TitleWithHindi({ children, hi }) {
  return <>{children}<span className="apv-modal__hi" lang="hi" aria-hidden="true">{hi}</span></>;
}

/** Approve, with the option to forward to a client for their own approval. */
export function ApproveModal({ open, onClose, notes, setNotes, clients, clientUserId, setClientUserId, onConfirm }) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      dataTestId="approve-modal"
      size="sm"
      title={<TitleWithHindi hi="स्वीकृत करें">Approve task</TitleWithHindi>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="fill" onClick={onConfirm}>
            {clientUserId ? 'Approve & send to client' : 'Approve & mark done'}
          </Button>
        </>
      }
    >
      <div className="apv-modal__stack">
        <Field label="Notes" htmlFor="apv-approve-note" hint="Optional — the requester sees this.">
          <Textarea
            id="apv-approve-note"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add a note for the requester…"
          />
        </Field>

        <div className="apv-send">
          <span className="apv-send__t">Send for client approval?</span>
          <span className="apv-send__d">
            Pick a client to email them an approval link, or leave blank to mark the task done.
          </span>
          {clients.length === 0 ? (
            <span className="apv-send__none">No clients have been added to this project yet.</span>
          ) : (
            <Select value={clientUserId} onChange={(e) => setClientUserId(e.target.value)}>
              <option value="">— Skip client approval —</option>
              {clients.map((c) => (
                <option key={c.user_id} value={c.user_id}>
                  {c.display_name}{c.email ? ` (${c.email})` : ''}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** A client approving their own task — with the comment box that did not exist. */
export function ClientApproveModal({ open, onClose, note, setNote, onConfirm }) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      dataTestId="client-approve-modal"
      size="sm"
      title={<TitleWithHindi hi="स्वीकृत">Approve</TitleWithHindi>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="fill" onClick={onConfirm}>Approve</Button>
        </>
      }
    >
      <Field label="Comment" htmlFor="apv-client-note" hint="Optional.">
        <Textarea
          id="apv-client-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything to pass back with the approval…"
        />
      </Field>
    </Modal>
  );
}

/** Reject. The reason is required — the confirm stays disabled without one. */
export function RejectModal({ open, onClose, note, setNote, onConfirm }) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      dataTestId="reject-modal"
      size="sm"
      title={<TitleWithHindi hi="अस्वीकृत करें">Reject task</TitleWithHindi>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {/* dangerfill, not a ghost button wearing an inline red. This is the
              confirmed destructive action inside a dialog the reviewer opened on
              purpose — the one case Button's docblock names for a filled red. */}
          <Button variant="dangerfill" onClick={onConfirm} disabled={!note.trim()}>
            Confirm rejection
          </Button>
        </>
      }
    >
      <Field label="Reason" htmlFor="apv-reject-note" required hint="The requester sees this.">
        <Textarea
          id="apv-reject-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why is this being rejected?"
        />
      </Field>
    </Modal>
  );
}
