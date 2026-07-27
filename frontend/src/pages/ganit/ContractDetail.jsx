// Ganit · one contract — the record drawer.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, rows, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import FocusTrap from '../../components/ui/FocusTrap';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';
import { Badge, CONTRACT_COLORS } from './_shared';

const STATUSES = ['draft', 'active', 'expired', 'cancelled', 'renewed'];

export default function ContractDetail({ contractId, onClose, onChanged }) {
  const { pushToast } = useToast();
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [saving, setSaving] = useState(false);

  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      // `{contract: …, invoices: […]}` — a bare object, not an envelope.
      const r = await api.get(`/v1/ganit/contracts/${contractId}`);
      setDetail(body(r));
    } catch (e) {
      setErr(e);
      setDetail(null);
    }
  }, [contractId]);

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

  const c = detail?.contract;

  async function updateStatus(status) {
    setBusy(true);
    try {
      await api.patch(`/v1/ganit/contracts/${contractId}`, { status });
      pushToast({ title: `Contract is now ${status}`, type: 'success' });
      await load();
      onChanged?.();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Could not update the contract', type: 'error' });
    } finally { setBusy(false); }
  }

  function startEdit() {
    setDraft({
      title: c.title || '', contact_id: c.contact_id || '', description: c.description || '',
      contract_value: c.contract_value ?? '', start_date: c.start_date || '',
      end_date: c.end_date || '', renewal_reminder_days: c.renewal_reminder_days ?? 30,
      notes: c.notes || '',
    });
    setEditing(true);
    api.get('/v1/graha/contacts').then(r => setContacts(rows(r))).catch(() => {});
  }

  async function saveEdit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/v1/ganit/contracts/${contractId}`, {
        ...draft, contract_value: parseFloat(draft.contract_value) || 0,
      });
      pushToast({ title: 'Contract updated', type: 'success' });
      setEditing(false);
      await load();
      onChanged?.();
    } catch (e2) {
      pushToast({ title: e2.response?.data?.detail || 'Could not update the contract', type: 'error' });
    } finally { setSaving(false); }
  }

  const panel = (
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
          aria-label={c ? `Contract ${c.title}` : 'Contract'}
          onAnimationEnd={onExitEnd}
        >
          <header className="dr__head">
            <div className="dr__crumb">
              <span className="dr__crumb-p">Contracts</span>
              <span className="dr__crumb-sep">/</span>
              <span className="dr__crumb-t">{c ? c.title : 'Contract'}</span>
            </div>
            <div className="dr__acts">
              <button type="button" className="dr__ico" aria-label="Close" onClick={requestClose}>×</button>
            </div>
          </header>

          {err ? (
            <div className="dr__body"><ErrorState kind={errorKind(err)} onRetry={load} /></div>
          ) : !c ? (
            <div className="dr__body">
              <SkeletonRegion label="Loading the contract">
                <SkeletonList rows={5} showAvatar={false} />
              </SkeletonRegion>
            </div>
          ) : (
            <>
              <div className="gnd__title">
                <h2 className="gnd__num">{c.title}</h2>
                {c.contact_name && <span className="gnd__when">{c.contact_name}</span>}
                <Badge text={c.status} color={CONTRACT_COLORS[c.status] || 'var(--on-surface-3)'} />
              </div>

              <div className="gnd__acts">
                {!editing && (
                  <button type="button" className="btn btn--out btn--sm" onClick={startEdit}>Edit</button>
                )}
                {STATUSES.filter(s => s !== c.status).map(s => (
                  <button key={s} type="button" className="btn btn--ghost btn--sm" disabled={busy}
                    onClick={() => updateStatus(s)}>
                    Mark {s}
                  </button>
                ))}
              </div>

              <div className="dr__body">
                <section className="dr__sec">
                  <div className="gn-facts">
                    <div>Value <span className="gn-facts__v">{inr(Number(c.contract_value || 0))}</span></div>
                    <div>Start <span className="gn-facts__v">{c.start_date || '—'}</span></div>
                    <div>End <span className="gn-facts__v">{c.end_date || '—'}</span></div>
                    <div>Reminder <span className="gn-facts__v">{c.renewal_reminder_days} days before</span></div>
                  </div>
                </section>

                {c.description && !editing && (
                  <section className="dr__sec">
                    <h3 className="dr__lbl">Description<span className="dr__lbl-hi" lang="hi">विवरण</span></h3>
                    <p className="gnd__contact">{c.description}</p>
                  </section>
                )}

                {editing && draft && (
                  <form className="dr__sec gn-form gn-form--accent" onSubmit={saveEdit}>
                    <h4 className="gn-form__h">Edit contract</h4>
                    <div className="gn-form__grid gn-form__grid--2 gn-form__grid--flush">
                      <label className="fld">
                        <span className="fld__l">Title<span className="fld__req">*</span></span>
                        <input className="inp" required value={draft.title}
                          onChange={e => setDraft({ ...draft, title: e.target.value })} />
                      </label>
                      <label className="fld">
                        <span className="fld__l">Customer</span>
                        <select className="inp" value={draft.contact_id}
                          onChange={e => setDraft({ ...draft, contact_id: e.target.value })}>
                          <option value="">None</option>
                          {contacts.map(ct => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                        </select>
                      </label>
                      <label className="fld">
                        <span className="fld__l">Value (₹)</span>
                        <input className="inp" type="number" step="0.01" value={draft.contract_value}
                          onChange={e => setDraft({ ...draft, contract_value: e.target.value })} />
                      </label>
                      <label className="fld">
                        <span className="fld__l">Reminder (days)</span>
                        <input className="inp" type="number" value={draft.renewal_reminder_days}
                          onChange={e => setDraft({ ...draft, renewal_reminder_days: parseInt(e.target.value, 10) || 30 })} />
                      </label>
                      <label className="fld">
                        <span className="fld__l">Start date</span>
                        <input className="inp" type="date" value={draft.start_date}
                          onChange={e => setDraft({ ...draft, start_date: e.target.value })} />
                      </label>
                      <label className="fld">
                        <span className="fld__l">End date</span>
                        <input className="inp" type="date" value={draft.end_date}
                          onChange={e => setDraft({ ...draft, end_date: e.target.value })} />
                      </label>
                      <label className="fld gn-form__wide">
                        <span className="fld__l">Description</span>
                        <textarea className="inp gn-ta" rows={2} value={draft.description}
                          onChange={e => setDraft({ ...draft, description: e.target.value })} />
                      </label>
                      <label className="fld gn-form__wide">
                        <span className="fld__l">Notes</span>
                        <textarea className="inp gn-ta" rows={2} value={draft.notes}
                          onChange={e => setDraft({ ...draft, notes: e.target.value })} />
                      </label>
                    </div>
                    <div className="gn-form__acts">
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(false)}>Discard</button>
                      <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
                        {saving ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </form>
                )}

                {detail.invoices?.length > 0 && (
                  <section className="dr__sec">
                    <h3 className="dr__lbl">Related invoices<span className="dr__lbl-hi" lang="hi">बीजक</span></h3>
                    {detail.invoices.map(inv => (
                      <div key={inv.id} className="gn-pay__row">
                        <span className="gn-tbl__id">{inv.invoice_number}</span>
                        <span className="gn-pay__amt">{inr(Number(inv.total))}</span>
                      </div>
                    ))}
                  </section>
                )}
              </div>
            </>
          )}
        </div>
      </FocusTrap>
    </div>
  );

  return createPortal(panel, document.body);
}
