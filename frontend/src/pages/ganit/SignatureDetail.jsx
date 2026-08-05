// Ganit · one contract's signature state — the record drawer.
//
// Sending for signature EMAILS the signers. The button therefore states what it
// will do before it does it, and asks once — this is the only control in the
// module that dispatches something to a third party.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import FocusTrap from '../../components/ui/FocusTrap';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import ErrorState from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';
import { Badge, CONTRACT_COLORS, SIGN_STATUS_COLORS, SIGN_OUTSTANDING } from './_shared';
import { loadSignatureState } from './ESignTab';
import useModuleWrite from '../../hooks/useModuleWrite';

const BLANK_SIGNER = { name: '', email: '', role: 'signer' };

export default function SignatureDetail({ contract, onClose, onChanged }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'send for signature' });
  const { pushToast } = useToast();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signers, setSigners] = useState([{ ...BLANK_SIGNER }]);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setState(await loadSignatureState(contract.id));
    setLoading(false);
  }, [contract.id]);

  useEffect(() => { load(); }, [load]);

  const requestClose = useCallback(() => {
    closingRef.current = true;
    setClosing(true);
  }, []);

  const onExitEnd = useCallback(e => {
    if (e.target !== e.currentTarget || !closingRef.current) return;
    closingRef.current = false;
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); requestClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  function updateSigner(i, field, val) {
    setSigners(s => { const n = [...s]; n[i] = { ...n[i], [field]: val }; return n; });
  }

  async function send() {
    setSending(true);
    try {
      await api.post(`/v1/ganit/contracts/${contract.id}/send-for-signature`, { signers });
      pushToast({ title: 'Sent for signature', type: 'success' });
      await load();
      onChanged?.();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Could not send for signature', type: 'error' });
    } finally { setSending(false); }
  }

  function confirmSend(e) {
    e.preventDefault();
    if (!signers.every(s => s.name.trim() && s.email.trim())) {
      pushToast({ title: 'Every signer needs a name and an email', type: 'error' });
      return;
    }
    setConfirm({
      title: `Email ${signers.length === 1 ? 'this signer' : `these ${signers.length} signers`}?`,
      message: `A signing link goes to ${signers.map(s => s.email).join(', ')}. They can open and sign the contract from it.`,
      confirmLabel: 'Send',
      onConfirm: send,
    });
  }

  async function cancelSignature() {
    setCancelling(true);
    try {
      await api.post(`/v1/ganit/contracts/${contract.id}/cancel-signature`);
      pushToast({ title: 'Signature request cancelled', type: 'success' });
      await load();
      onChanged?.();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Could not cancel the request', type: 'error' });
    } finally { setCancelling(false); }
  }

  const sig = state?.status;
  const sent = !!sig?.signers?.length;
  const canCancel = sent && sig.signers.some(s => SIGN_OUTSTANDING.includes(s.status));
  const trail = state?.trail || [];

  const panel = (
    <>
      <div
        className={`dr__scrim${closing ? ' is-closing' : ''}`}
        role="presentation"
        onClick={e => e.target === e.currentTarget && requestClose()}
      >
        <FocusTrap active>
          <div
            className={`dr gnd${closing ? ' is-closing' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={`Signatures for ${contract.title}`}
            onAnimationEnd={onExitEnd}
          >
            <header className="dr__head">
              <div className="dr__crumb">
                <span className="dr__crumb-p">e-Sign</span>
                <span className="dr__crumb-sep">/</span>
                <span className="dr__crumb-t">{contract.title}</span>
              </div>
              <div className="dr__acts">
                <button type="button" className="dr__ico" aria-label="Close" onClick={requestClose}>×</button>
              </div>
            </header>

            <div className="gnd__title">
              <h2 className="gnd__num">{contract.title}</h2>
              {contract.contact_name && <span className="gnd__when">{contract.contact_name}</span>}
              <span className="gn-row__v">{inr(Number(contract.contract_value || 0))}</span>
              <Badge text={contract.status} color={CONTRACT_COLORS[contract.status] || 'var(--on-surface-3)'} />
            </div>

            <div className="dr__body">
              {loading ? (
                <SkeletonRegion label="Loading the signature state">
                  <SkeletonList rows={4} showAvatar={false} />
                </SkeletonRegion>
              ) : state?.statusFailed ? (
                // The signature state IS this drawer's subject, so its failure
                // is the drawer's error. Rendering the "send for signature"
                // form instead would invite a second send on a contract that
                // may already be out.
                <ErrorState kind="server" onRetry={load} />
              ) : (
                <>
                  {sent ? (
                    <section className="dr__sec">
                      <div className="gn-panel__head">
                        <h3 className="dr__lbl">Signers<span className="dr__lbl-hi" lang="hi">हस्ताक्षरकर्ता</span></h3>
                        {canCancel && (
                          <button
                            type="button" className="btn btn--danger btn--sm" disabled={cancelling || !canWrite}
                            onClick={() => setConfirm({
                              title: 'Cancel the signature request?',
                              message: 'Outstanding signing links stop working. Signatures already collected are kept.',
                              confirmLabel: 'Cancel request',
                              onConfirm: cancelSignature,
                            })} title={denial || undefined}>
                            {cancelling ? 'Cancelling…' : 'Cancel request'}
                          </button>
                        )}
                      </div>
                      {sig.signers.map((s, i) => (
                        <div key={s.id || i} className="gn-sig__row">
                          <span>
                            <span className="gn-sig__name">{s.name}</span>
                            <span className="gn-sig__email">{s.email}</span>
                          </span>
                          <span className="gn-sig__r">
                            {s.signed_at && (
                              <span className="gn-sig__when">{new Date(s.signed_at).toLocaleString('en-IN')}</span>
                            )}
                            <Badge text={s.status} color={SIGN_STATUS_COLORS[s.status] || 'var(--on-surface-3)'} />
                          </span>
                        </div>
                      ))}
                    </section>
                  ) : (
                    <form className="dr__sec" onSubmit={confirmSend}>
                      <h3 className="dr__lbl">Send for signature<span className="dr__lbl-hi" lang="hi">भेजें</span></h3>
                      {signers.map((s, i) => (
                        <div key={i} className="gn-li" style={{ '--gn-li': '1fr 1fr 30px' }}>
                          <div>
                            {i === 0 && <span className="gn-li__l">Name</span>}
                            <input className="inp" placeholder="Signer name" value={s.name}
                              onChange={e => updateSigner(i, 'name', e.target.value)} />
                          </div>
                          <div>
                            {i === 0 && <span className="gn-li__l">Email</span>}
                            <input className="inp" type="email" placeholder="Signer email" value={s.email}
                              onChange={e => updateSigner(i, 'email', e.target.value)} />
                          </div>
                          <button type="button" className="gn-li__x" aria-label={`Remove signer ${i + 1}`}
                            disabled={signers.length === 1}
                            onClick={() => setSigners(list => list.filter((_, j) => j !== i))}>
                            ×
                          </button>
                        </div>
                      ))}
                      <button type="button" className="btn btn--ghost btn--sm"
                        onClick={() => setSigners(s => [...s, { ...BLANK_SIGNER }])}>
                        + Add signer
                      </button>
                      <div className="gn-form__acts">
                        <button type="submit" className="btn btn--fill btn--sm" disabled={sending || !canWrite} title={denial || undefined}>
                          {sending ? 'Sending…' : 'Send for signature'}
                        </button>
                      </div>
                      <p className="gn-est__note">
                        Each signer is emailed their own link. Nothing is sent until you confirm.
                      </p>
                    </form>
                  )}

                  <section className="dr__sec">
                    <h3 className="dr__lbl">Audit trail<span className="dr__lbl-hi" lang="hi">अभिलेख</span></h3>
                    {state?.trailFailed ? (
                      <p className="note note--warn" role="status">
                        The audit trail could not be loaded. This is signing evidence — treat its
                        absence here as a loading failure, not as an absence of events.
                      </p>
                    ) : trail.length === 0 ? (
                      <p className="dr__empty">Nothing has been recorded against this contract yet.</p>
                    ) : (
                      trail.map((ev, i) => (
                        <div key={ev.id || i} className="gn-sig__row">
                          <span>
                            <span className="gn-sig__name">{ev.event}</span>
                            {ev.actor_email && <span className="gn-sig__email">{ev.actor_email}</span>}
                            {ev.ip_address && <span className="gn-sig__ip">{ev.ip_address}</span>}
                          </span>
                          <span className="gn-sig__when">
                            {ev.timestamp ? new Date(ev.timestamp).toLocaleString('en-IN') : '—'}
                          </span>
                        </div>
                      ))
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
        </FocusTrap>
      </div>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );

  return createPortal(panel, document.body);
}
