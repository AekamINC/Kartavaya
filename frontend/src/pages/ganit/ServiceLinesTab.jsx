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
import { Secondary } from '../../components/Bilingual';
import DateInput from '../../components/ui/DateInput';

const KINDS = ['retainer', 'subscription', 'one_off'];
const CADENCES = ['monthly', 'quarterly', 'annual', 'one_off'];

const BLANK = {
  profile_id: '', kind: 'retainer', description: '', amount: '',
  cadence: 'monthly', period_start: '', period_end: '',
  billing_direction: 'advance', auto_invoice: false,
};

const COLUMNS_ACTIVE = [
  'Client', 'Kind', 'Description',
  { label: 'Amount', align: 'right' },
  'Cadence', 'Start', 'Auto', '',
];

const COLUMNS_ENDED = [
  'Client', 'Description',
  { label: 'Amount', align: 'right' },
  'Period',
];

export default function ServiceLinesTab() {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'manage service lines' });
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [sl, pr] = await Promise.allSettled([
        api.get('/v1/ganit/billing/service-lines'),
        api.get('/v1/ganit/billing/profiles'),
      ]);
      if (sl.status === 'rejected') throw sl.reason;
      setItems(asRows(sl.value));
      setProfiles(pr.status === 'fulfilled' ? asRows(pr.value) : []);
    } catch (e) { setErr(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    const form = editing;
    try {
      if (form.id) {
        await api.patch(`/v1/ganit/billing/service-lines/${form.id}`, {
          description: form.description,
          amount: Number(form.amount),
          period_end: form.period_end || null,
          auto_invoice: form.auto_invoice,
        });
        pushToast({ title: 'Service line updated', type: 'success' });
      } else {
        await api.post('/v1/ganit/billing/service-lines', {
          ...form,
          amount: Number(form.amount),
          period_end: form.period_end || null,
        });
        pushToast({ title: 'Service line created', type: 'success' });
      }
      setEditing(null);
      load();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Failed to save', type: 'error' });
    }
  }

  if (loading) return <SkeletonList />;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  const active = items.filter(i => !i.period_end || new Date(i.period_end) > new Date());
  const ended = items.filter(i => i.period_end && new Date(i.period_end) <= new Date());

  return (
    <div>
      <div className="gn-bar">
        <span className="gn-bar__sp" />
        {canWrite && (
          <button type="button" className="btn btn--fill btn--sm" onClick={() => setEditing({ ...BLANK })}>
            + Service Line
          </button>
        )}
        {!canWrite && denial && <span className="gn-denial">{denial}</span>}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="ganit"
          title="No service lines"
          description="Add recurring retainers, subscriptions, or one-off charges for your clients."
          action={canWrite ? '+ Service Line' : undefined}
          onAction={canWrite ? () => setEditing({ ...BLANK }) : undefined}
        />
      ) : null}

      {active.length > 0 && (
        <>
          <h3 className="gn-section-head"><Secondary en="Active" hi="सक्रिय" /></h3>
          <DataTable columns={COLUMNS_ACTIVE} label="Active service lines">
            {active.map(sl => (
              <tr key={sl.id}>
                <Td bold>{sl.client_name}</Td>
                <Td>{sl.kind.replace('_', ' ')}</Td>
                <Td>{sl.description}</Td>
                <Td align="right" mono>{inr(sl.amount)}</Td>
                <Td>{sl.cadence.replace('_', ' ')}</Td>
                <Td>{sl.period_start}</Td>
                <Td>{sl.auto_invoice ? 'Yes' : '—'}</Td>
                <Td>
                  {canWrite && (
                    <button type="button" className="btn btn--ghost btn--xs" onClick={() => setEditing({ ...sl, amount: String(sl.amount) })}>
                      Edit
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </DataTable>
        </>
      )}

      {ended.length > 0 && (
        <>
          <h3 className="gn-section-head" style={{ marginTop: 'var(--sp-5)' }}><Secondary en="Ended" hi="समाप्त" /></h3>
          <DataTable columns={COLUMNS_ENDED} label="Ended service lines">
            {ended.map(sl => (
              <tr key={sl.id} style={{ opacity: 0.6 }}>
                <Td>{sl.client_name}</Td>
                <Td>{sl.description}</Td>
                <Td align="right" mono>{inr(sl.amount)}</Td>
                <Td>{sl.period_start} – {sl.period_end}</Td>
              </tr>
            ))}
          </DataTable>
        </>
      )}

      <Modal
        open={!!editing}
        onOpenChange={v => { if (!v) setEditing(null); }}
        title={editing?.id ? 'Edit Service Line' : 'New Service Line'}
        footer={<>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>Cancel</button>
          <button type="button" className="btn btn--fill btn--sm" onClick={save}>Save</button>
        </>}
      >
        {editing && (
          <div className="gn-form__grid">
            {!editing.id && (
              <label className="fld">
                <span className="fld__l"><Secondary en="Billing Profile" hi="बिलिंग प्रोफ़ाइल" /></span>
                <select className="inp" value={editing.profile_id}
                  onChange={e => setEditing({ ...editing, profile_id: e.target.value })}>
                  <option value="">Select…</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>{p.client_name} ({p.billing_cycle})</option>
                  ))}
                </select>
              </label>
            )}
            {!editing.id && (
              <label className="fld">
                <span className="fld__l"><Secondary en="Kind" hi="प्रकार" /></span>
                <select className="inp" value={editing.kind}
                  onChange={e => setEditing({ ...editing, kind: e.target.value })}>
                  {KINDS.map(k => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
                </select>
              </label>
            )}
            <label className="fld">
              <span className="fld__l"><Secondary en="Description" hi="विवरण" /></span>
              <input className="inp" value={editing.description}
                onChange={e => setEditing({ ...editing, description: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l"><Secondary en="Amount" hi="राशि" /></span>
              <input className="inp" type="number" min={0} step="0.01"
                value={editing.amount}
                onChange={e => setEditing({ ...editing, amount: e.target.value })} />
            </label>
            {!editing.id && (
              <label className="fld">
                <span className="fld__l"><Secondary en="Cadence" hi="आवृत्ति" /></span>
                <select className="inp" value={editing.cadence}
                  onChange={e => setEditing({ ...editing, cadence: e.target.value })}>
                  {CADENCES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                </select>
              </label>
            )}
            {!editing.id && (
              <label className="fld">
                <span className="fld__l"><Secondary en="Period Start" hi="अवधि प्रारंभ" /></span>
                <DateInput value={editing.period_start}
                  onChange={v => setEditing({ ...editing, period_start: v })} />
              </label>
            )}
            <label className="fld">
              <span className="fld__l"><Secondary en="Period End" hi="अवधि समाप्ति" /></span>
              <DateInput value={editing.period_end}
                onChange={v => setEditing({ ...editing, period_end: v })} />
            </label>
            <label className="fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <input type="checkbox" checked={editing.auto_invoice}
                onChange={e => setEditing({ ...editing, auto_invoice: e.target.checked })} />
              <span><Secondary en="Auto-generate invoices" hi="स्वतः चालान" /></span>
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
