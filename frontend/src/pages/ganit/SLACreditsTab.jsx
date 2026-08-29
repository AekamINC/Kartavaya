import React, { useCallback, useEffect, useState } from 'react';
import { api, rows as asRows } from '../../lib/api';
import { DataTable, Td } from '../../components/editorial';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';
import { useToast } from '../../components/ui/toast';
import { Modal } from '../../components/ui/modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Secondary } from '../../components/Bilingual';
import DateInput from '../../components/ui/DateInput';

const BLANK = {
  vendor_id: '', sla_metric: '', threshold: '', actual: '',
  credit_amount: '', period: '', rate_card_id: '',
};

const STATUS_TONE = { pending: '', applied: ' gn-tag--ok', waived: '' };

const COLUMNS = [
  'Vendor', 'SLA Metric',
  { label: 'Threshold', align: 'right' },
  { label: 'Actual', align: 'right' },
  { label: 'Credit', align: 'right' },
  'Period', 'Status', '',
];

export default function SLACreditsTab() {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'manage SLA credits' });
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [rateCards, setRateCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirmDlg, setConfirmDlg] = useState(null);
  const [applyModal, setApplyModal] = useState(null);
  const [applyBillId, setApplyBillId] = useState('');
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [sc, v, rc] = await Promise.allSettled([
        api.get('/v1/ganit/billing/sla-credits'),
        api.get('/v1/ganit/vendors'),
        api.get('/v1/ganit/billing/rate-cards'),
      ]);
      if (sc.status === 'rejected') throw sc.reason;
      setItems(asRows(sc.value));
      setVendors(v.status === 'fulfilled' ? asRows(v.value) : []);
      setRateCards(rc.status === 'fulfilled' ? asRows(rc.value) : []);
    } catch (e) { setErr(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    const form = editing;
    try {
      await api.post('/v1/ganit/billing/sla-credits', {
        vendor_id: form.vendor_id,
        sla_metric: form.sla_metric,
        threshold: Number(form.threshold),
        actual: Number(form.actual),
        credit_amount: Number(form.credit_amount),
        period: form.period || null,
        rate_card_id: form.rate_card_id || null,
      });
      pushToast({ title: 'SLA credit recorded', type: 'success' });
      setEditing(null);
      load();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Failed to save', type: 'error' });
    }
  }

  function applyToBill(id) {
    setApplyBillId('');
    setApplyModal(id);
  }

  async function submitApply() {
    if (!applyBillId.trim()) return;
    const id = applyModal;
    setApplyModal(null);
    setBusy(id);
    try {
      await api.post(`/v1/ganit/billing/sla-credits/${id}/apply`, { bill_id: applyBillId.trim() });
      pushToast({ title: 'Credit applied to bill', type: 'success' });
      load();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Failed to apply credit', type: 'error' });
    }
    setBusy(null);
  }

  function waive(id) {
    setConfirmDlg({
      message: 'Waive this SLA credit?',
      intent: 'warn',
      onConfirm: async () => {
        setBusy(id);
        try {
          await api.patch(`/v1/ganit/billing/sla-credits/${id}/waive`);
          pushToast({ title: 'SLA credit waived', type: 'success' });
          load();
        } catch (e) {
          pushToast({ title: e.response?.data?.detail || 'Failed to waive credit', type: 'error' });
        }
        setBusy(null);
      },
    });
  }

  if (loading) return <SkeletonList />;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  return (
    <div>
      <div className="gn-bar">
        <span className="gn-bar__sp" />
        {canWrite && (
          <button type="button" className="btn btn--fill btn--sm" onClick={() => setEditing({ ...BLANK })}>
            + SLA Credit
          </button>
        )}
        {!canWrite && denial && <span className="gn-denial">{denial}</span>}
      </div>

      {items.length > 0 ? (
        <DataTable columns={COLUMNS} label="SLA credits">
          {items.map(s => (
            <tr key={s.id}>
              <Td bold>{s.vendor_name}</Td>
              <Td>{s.sla_metric}</Td>
              <Td align="right" mono>{s.threshold}</Td>
              <Td align="right" mono>{s.actual}</Td>
              <Td align="right" mono>{inr(s.credit_amount)}</Td>
              <Td>{s.period}</Td>
              <Td>
                <span className={`gn-tag${STATUS_TONE[s.status] || ''}`}>
                  {s.status}
                </span>
              </Td>
              <Td>
                {canWrite && s.status === 'pending' && (
                  <>
                    <button type="button" className="btn btn--ghost btn--xs" disabled={busy === s.id}
                      onClick={() => applyToBill(s.id)}>
                      Apply
                    </button>
                    <button type="button" className="btn btn--ghost btn--xs" disabled={busy === s.id}
                      onClick={() => waive(s.id)}>
                      Waive
                    </button>
                  </>
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <EmptyState
          icon="ganit"
          title="No SLA credits"
          description="Record a service-level breach against a vendor to track the credit owed, then apply it to a bill or waive it."
          action={canWrite ? '+ SLA Credit' : undefined}
          onAction={canWrite ? () => setEditing({ ...BLANK }) : undefined}
        />
      )}

      <Modal
        open={!!editing}
        onOpenChange={v => { if (!v) setEditing(null); }}
        title="New SLA Credit"
        footer={<>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>Cancel</button>
          <button type="button" className="btn btn--fill btn--sm" onClick={save}>Save</button>
        </>}
      >
        {editing && (
          <div className="gn-form__grid">
            <label className="fld">
              <span className="fld__l">Vendor <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'विक्रेता'}</span></span>
              <select className="inp" value={editing.vendor_id}
                onChange={e => setEditing({ ...editing, vendor_id: e.target.value })}>
                <option value="">Select a vendor…</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label className="fld">
              <span className="fld__l">SLA Metric <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'एसएलए माप'}</span></span>
              <input className="inp" value={editing.sla_metric}
                placeholder="e.g. Uptime %, Response Time (hrs)"
                onChange={e => setEditing({ ...editing, sla_metric: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Threshold <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'सीमा'}</span></span>
              <input className="inp" type="number" step="0.0001"
                value={editing.threshold}
                onChange={e => setEditing({ ...editing, threshold: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Actual <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'वास्तविक'}</span></span>
              <input className="inp" type="number" step="0.0001"
                value={editing.actual}
                onChange={e => setEditing({ ...editing, actual: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Credit Amount <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'क्रेडिट राशि'}</span></span>
              <input className="inp" type="number" min={0} step="0.01"
                value={editing.credit_amount}
                onChange={e => setEditing({ ...editing, credit_amount: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Period <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'अवधि'}</span></span>
              <DateInput value={editing.period}
                onChange={e => setEditing({ ...editing, period: e.target.value })} />
            </label>
            <label className="fld gn-form__wide">
              <span className="fld__l">Rate Card <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'दर कार्ड'}</span></span>
              <select className="inp" value={editing.rate_card_id}
                onChange={e => setEditing({ ...editing, rate_card_id: e.target.value })}>
                <option value="">None</option>
                {rateCards.map(rc => (
                  <option key={rc.id} value={rc.id}>
                    {rc.vendor_name} — {rc.item_category} ({inr(rc.rate)}/{rc.unit})
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={!!applyModal}
        onOpenChange={v => { if (!v) setApplyModal(null); }}
        title="Apply SLA Credit"
        footer={<>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setApplyModal(null)}>Cancel</button>
          <button type="button" className="btn btn--fill btn--sm" onClick={submitApply} disabled={!applyBillId.trim()}>Apply</button>
        </>}
      >
        <label className="fld">
          <span className="fld__l">Bill ID <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'बिल आईडी'}</span></span>
          <input className="inp" value={applyBillId} onChange={e => setApplyBillId(e.target.value)}
            placeholder="Enter the bill ID to apply this credit to" />
        </label>
      </Modal>

      <ConfirmDialog state={confirmDlg} onClose={() => setConfirmDlg(null)} />
    </div>
  );
}
