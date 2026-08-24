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

const BLANK = {
  client_id: '', billing_cycle: 'monthly', anchor_day: 1,
  payment_terms_days: 30, currency: 'INR', gst_treatment: 'registered',
  credit_limit: '', notes: '',
};

const CYCLES = ['monthly', 'quarterly', 'annual'];
const GST = ['registered', 'unregistered', 'composition', 'overseas', 'sez'];

const COLUMNS = [
  'Client', 'Cycle', 'Anchor Day',
  { label: 'Terms', align: 'right' },
  'GST',
  { label: 'Credit Limit', align: 'right' },
  '',
];

export default function BillingProfilesTab() {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'manage billing profiles' });
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const [clients, setClients] = useState([]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [p, c] = await Promise.allSettled([
        api.get('/v1/ganit/billing/profiles'),
        api.get('/v1/graha/clients'),
      ]);
      if (p.status === 'rejected') throw p.reason;
      setItems(asRows(p.value));
      setClients(c.status === 'fulfilled' ? asRows(c.value) : []);
    } catch (e) { setErr(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    const form = editing;
    try {
      if (form.id) {
        await api.patch(`/v1/ganit/billing/profiles/${form.id}`, {
          billing_cycle: form.billing_cycle,
          anchor_day: Number(form.anchor_day),
          payment_terms_days: Number(form.payment_terms_days),
          currency: form.currency,
          gst_treatment: form.gst_treatment,
          credit_limit: form.credit_limit ? Number(form.credit_limit) : null,
          notes: form.notes,
        });
        pushToast({ title: 'Billing profile updated', type: 'success' });
      } else {
        await api.post('/v1/ganit/billing/profiles', {
          ...form,
          anchor_day: Number(form.anchor_day),
          payment_terms_days: Number(form.payment_terms_days),
          credit_limit: form.credit_limit ? Number(form.credit_limit) : null,
        });
        pushToast({ title: 'Billing profile created', type: 'success' });
      }
      setEditing(null);
      load();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Failed to save', type: 'error' });
    }
  }

  if (loading) return <SkeletonList />;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  const usedClients = new Set(items.map(i => i.client_id));
  const available = clients.filter(c => !usedClients.has(c.id));

  return (
    <div>
      <div className="gn-bar">
        <span className="gn-bar__sp" />
        {canWrite && (
          <button type="button" className="btn btn--fill btn--sm" onClick={() => setEditing({ ...BLANK })}>
            + Billing Profile
          </button>
        )}
        {!canWrite && denial && <span className="gn-denial">{denial}</span>}
      </div>

      {items.length > 0 ? (
        <DataTable columns={COLUMNS} label="Billing profiles">
          {items.map(p => (
            <tr key={p.id}>
              <Td bold>{p.client_name}</Td>
              <Td>{p.billing_cycle}</Td>
              <Td>{p.anchor_day}</Td>
              <Td align="right" mono>{p.payment_terms_days}d</Td>
              <Td>{p.gst_treatment}</Td>
              <Td align="right" mono>{p.credit_limit ? inr(p.credit_limit) : '—'}</Td>
              <Td>
                {canWrite && (
                  <button type="button" className="btn btn--ghost btn--xs" onClick={() => setEditing({ ...p })}>
                    Edit
                  </button>
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <EmptyState
          icon="ganit"
          title="No billing profiles"
          description="Create a billing profile for a client to set up their billing cycle, terms, and GST treatment."
          action={canWrite ? '+ Billing Profile' : undefined}
          onAction={canWrite ? () => setEditing({ ...BLANK }) : undefined}
        />
      )}

      <Modal
        open={!!editing}
        onOpenChange={v => { if (!v) setEditing(null); }}
        title={editing?.id ? 'Edit Billing Profile' : 'New Billing Profile'}
        footer={<>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>Cancel</button>
          <button type="button" className="btn btn--fill btn--sm" onClick={save}>Save</button>
        </>}
      >
        {editing && (
          <div className="gn-form__grid">
            {!editing.id && (
              <label className="fld">
                <span className="fld__l"><Secondary en="Client" hi="ग्राहक" /></span>
                <select
                  className="inp"
                  value={editing.client_id}
                  onChange={e => setEditing({ ...editing, client_id: e.target.value })}
                >
                  <option value="">Select a client…</option>
                  {available.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
            <label className="fld">
              <span className="fld__l"><Secondary en="Billing Cycle" hi="बिलिंग चक्र" /></span>
              <select className="inp" value={editing.billing_cycle}
                onChange={e => setEditing({ ...editing, billing_cycle: e.target.value })}>
                {CYCLES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="fld">
              <span className="fld__l"><Secondary en="Anchor Day (1–28)" hi="एंकर दिन" /></span>
              <input className="inp" type="number" min={1} max={28}
                value={editing.anchor_day}
                onChange={e => setEditing({ ...editing, anchor_day: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l"><Secondary en="Payment Terms (days)" hi="भुगतान शर्तें" /></span>
              <input className="inp" type="number" min={0}
                value={editing.payment_terms_days}
                onChange={e => setEditing({ ...editing, payment_terms_days: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l"><Secondary en="GST Treatment" hi="जीएसटी उपचार" /></span>
              <select className="inp" value={editing.gst_treatment}
                onChange={e => setEditing({ ...editing, gst_treatment: e.target.value })}>
                {GST.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label className="fld">
              <span className="fld__l"><Secondary en="Credit Limit" hi="क्रेडिट सीमा" /></span>
              <input className="inp" type="number" min={0}
                value={editing.credit_limit}
                onChange={e => setEditing({ ...editing, credit_limit: e.target.value })} />
            </label>
            <label className="fld gn-form__wide">
              <span className="fld__l"><Secondary en="Notes" hi="टिप्पणियाँ" /></span>
              <textarea className="inp" rows={2} value={editing.notes}
                onChange={e => setEditing({ ...editing, notes: e.target.value })} />
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
