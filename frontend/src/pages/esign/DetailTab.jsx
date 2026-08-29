import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Download, ExternalLink, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import {
  Card, CardHead, CardBody, Button, ConfirmDialog,
  ErrorState, errorKind, SkeletonCard,
} from '../../components/ui';
import Note from '../../components/module/Note';
import { apiErrorText } from '../../lib/apiError';
import {
  EsignStatusPill, AuditTrail, FileTypeIcon, formatDate, relSigned,
} from '../../components/documents';

/**
 * One document: status, signers, actions, audit trail.
 *
 * Changes of substance over the previous version:
 *
 *  · **Cancel is confirmed.** It was a one-click irreversible action that
 *    invalidates every outstanding signing link. `ConfirmDialog` is the shipped
 *    primitive for exactly this and was already in the barrel.
 *  · **Dates are absolute.** `relTime` was used for `expires_at`, and it
 *    appends "ago" unconditionally — a document expiring in twelve days read
 *    "Expires 12d ago".
 *  · **A failed load renders `ErrorState`**, not a bare "Document not found"
 *    line that blamed the record for a network error.
 *  · **The audit trail is an ordered list**, newest first — see AuditTrail.
 *
 * The signed-certificate link is left as a link and never auto-opened: it is a
 * signed URL to a legal artefact, and a surface that fetches it on render puts
 * it in history and referrer logs for anyone who merely opened the page.
 *
 * **Two artefacts, two names.** This surface offered one button, "Signing
 * certificate", pointed at `signed_file_url`. That column held a JSON audit
 * blob — the backend never produced an executed PDF at all — so the one thing a
 * signing product exists to hand back was missing, and the button that looked
 * like it handed it back gave you machine-readable evidence instead. They are
 * now separate and named for what they are: the **signed document** (the pages
 * that were signed, with the signature page bound in) and the **audit
 * certificate** (the JSON trail). A document completed before the pipeline
 * existed shows the assemble action rather than a dead end.
 */
export default function DetailTab({ docId, onBack }) {
  const toast = useToast();
  const [doc, setDoc] = useState(null);
  const [signers, setSigners] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/v1/esign/documents/${docId}`);
      setDoc(r.data.document);
      setSigners(r.data.signers || []);
      setAudit(r.data.audit_trail || []);
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => { load(); }, [load]);

  const handleSend = async () => {
    setSending(true);
    try {
      await api.post(`/v1/esign/documents/${docId}/send`);
      toast.success('Sent. Every signer has an email with their own link.');
      load();
    } catch (e) {
      toast.error(apiErrorText(e, 'Could not send the document.'));
    } finally { setSending(false); }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await api.post(`/v1/esign/documents/${docId}/cancel`);
      toast.success('Cancelled. All outstanding signing links are now dead.');
      setConfirmCancel(false);
      load();
    } catch (e) {
      toast.error(apiErrorText(e, 'Could not cancel the document.'));
    } finally { setCancelling(false); }
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      const r = await api.post(`/v1/esign/documents/${docId}/rebuild`);
      // `appended_original` is reported rather than assumed. If the file that
      // was signed is not a PDF it cannot be bound in, and the copy is the
      // signature record alone — the person downloading it should know which
      // of the two they are holding before they send it to a counterparty.
      toast.success(r.data?.appended_original
        ? 'Signed document assembled — the original with the signature page bound in.'
        : 'Signature record assembled. The signed file is not a PDF, so it could not be bound in.');
      load();
    } catch (e) {
      toast.error(apiErrorText(e, 'Could not assemble the signed document.'));
    } finally { setRebuilding(false); }
  };

  const handleResend = async (signerId, name) => {
    try {
      await api.post(`/v1/esign/documents/${docId}/resend/${signerId}`);
      toast.success(`Reminder sent to ${name}.`);
    } catch (e) {
      toast.error(apiErrorText(e, 'Could not send the reminder.'));
    }
  };

  const back = (
    <Button variant="text" size="sm" onClick={onBack}>
      <ArrowLeft size={14} aria-hidden="true" /> All documents
    </Button>
  );

  if (loading) return <div>{back}<SkeletonCard lines={5} /></div>;

  if (err) {
    return (
      <div>
        {back}
        <ErrorState kind={errorKind(err)} onRetry={load} backTo={onBack} backLabel="All documents" />
      </div>
    );
  }
  if (!doc) {
    return (
      <div>
        {back}
        <ErrorState kind="missing" backTo={onBack} backLabel="All documents" />
      </div>
    );
  }

  const pending = doc.file_url === 'pending' || !doc.file_url;
  const total = Number(doc.signers_total) || 0;
  const done = Number(doc.signers_completed) || 0;

  return (
    <div className="docpane">
      {back}

      <Card>
        <CardHead
          title={doc.title}
          actions={<EsignStatusPill status={doc.status} />}
        />
        <CardBody>
          {doc.description && <p className="docrow__d">{doc.description}</p>}

          <div className="docdet__grid">
            <div>
              <span className="docdet__k">Signed</span>
              <span className="docdet__v">{done} of {total}</span>
            </div>
            <div>
              <span className="docdet__k">Created</span>
              <span className="docdet__v">{formatDate(doc.created_at)}</span>
            </div>
            <div>
              <span className="docdet__k">Expires</span>
              <span className="docdet__v">
                {doc.expires_at ? `${formatDate(doc.expires_at)} (${relSigned(doc.expires_at)})` : 'Never'}
              </span>
            </div>
          </div>

          {!pending && (
            <p className="docdz__picked" style={{ marginTop: 'var(--sp-4)' }}>
              <FileTypeIcon name={doc.file_name || `${doc.title}.pdf`} size={22} />
              <span className="docdz__nm">{doc.file_name || 'Document PDF'}</span>
              <a className="btn btn--out btn--sm" href={doc.file_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} aria-hidden="true" /> Open
              </a>
            </p>
          )}

          {doc.status === 'completed' && (
            <div className="docdet__artefacts">
              {doc.signed_file_url ? (
                <a className="btn btn--fill" href={doc.signed_file_url} target="_blank" rel="noopener noreferrer">
                  <Download size={14} aria-hidden="true" /> Signed document (PDF)
                </a>
              ) : (
                <Button variant="fill" onClick={handleRebuild} disabled={rebuilding}>
                  <Download size={14} aria-hidden="true" />
                  {rebuilding ? 'Assembling…' : 'Assemble signed document'}
                </Button>
              )}
              {doc.certificate_file_url && (
                <a className="btn btn--out" href={doc.certificate_file_url} target="_blank" rel="noopener noreferrer">
                  <Download size={14} aria-hidden="true" /> Audit certificate (JSON)
                </a>
              )}
            </div>
          )}

          {doc.status === 'completed' && !doc.signed_file_url && (
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <Note variant="warn">
                This document was completed before signed copies were generated. Everything
                needed to assemble it — the file that was signed and every signature — is on
                record, so it can be built now.
              </Note>
            </div>
          )}

          {doc.status === 'draft' && pending && (
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <Note variant="warn">
                This draft has <b>no PDF attached</b>. It cannot be sent until one is uploaded.
              </Note>
            </div>
          )}

          <div className="docdet__acts">
            {doc.status === 'draft' && !pending && (
              <Button variant="fill" onClick={handleSend} disabled={sending}>
                <Send size={14} aria-hidden="true" /> {sending ? 'Sending…' : 'Send for signing'}
              </Button>
            )}
            {['draft', 'sent', 'partially_signed'].includes(doc.status) && (
              <Button variant="danger" onClick={() => setConfirmCancel(true)} disabled={cancelling}>
                Cancel document
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Signers" />
        <CardBody>
          <div className="docsg">
            {signers.map(s => (
              <div className="docsg__r" key={s.id}>
                <span className="docsg__n" aria-hidden="true">{s.sign_order ?? '·'}</span>
                <span className="docsg__who">
                  <span className="docsg__nm">{s.name}</span>
                  <span className="docsg__ct">
                    {s.email}{s.phone ? ` · ${s.phone}` : ''}
                  </span>
                </span>
                <span className="docsg__side">
                  {s.signed_at && (
                    <time className="docsg__at" dateTime={s.signed_at}>{formatDate(s.signed_at)}</time>
                  )}
                  <EsignStatusPill status={s.status} kind="signer" />
                  {['sent', 'opened'].includes(s.status) && doc.status !== 'cancelled' && (
                    <Button variant="out" size="sm" onClick={() => handleResend(s.id, s.name)}>
                      Remind
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Audit trail" />
        <CardBody>
          <AuditTrail entries={audit} />
        </CardBody>
      </Card>

      {/* ConfirmDialog takes a `state` object, not open/title/message props —
          nine call sites depend on that shape. */}
      <ConfirmDialog
        state={confirmCancel ? {
          title: 'Cancel this document?',
          message:
            'Every outstanding signing link stops working immediately, including for signers who have already opened it. '
            + (done > 0
              ? `${done} signature${done === 1 ? '' : 's'} already collected stay in the audit trail. `
              : '')
            + 'This cannot be undone.',
          confirmLabel: cancelling ? 'Cancelling…' : 'Cancel document',
          intent: 'danger',
          onConfirm: handleCancel,
        } : null}
        onClose={() => setConfirmCancel(false)}
      />
    </div>
  );
}
