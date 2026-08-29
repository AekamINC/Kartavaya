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
  vendor_id: '', item_category: '', rate: '', unit: '',
  effective_from: '', effective_to: '', proration_clause: false, notes: '',
};

const COLUMNS = [
  'Vendor', 'Category',
  { label: 'Rate', align: 'right' },
  'Unit', 'From', 'To', 'Proration', '',
];

export default function RateCardsTab() {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'manage vendor rate cards' });
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [rc, v] = await Promise.allSettled([
        api.get('/v1/ganit/billing/rate-cards'),
        api.get('/v1/ganit/vendors'),
      ]);
      if (rc.status === 'rejected') throw rc.reason;
      setItems(asRows(rc.value));
      setVendors(v.status === 'fulfilled' ? asRows(v.value) : []);
    } catch (e) { setErr(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    const form = editing;
    try {
      const payload = {
        item_category: form.item_category,
        rate: Number(form.rate),
        unit: form.unit,
        effective_from: form.effective_from || null,
        effective_to: form.effective_to || null,
        proration_clause: !!form.proration_clause,
        notes: form.notes || null,
      };
      if (form.id) {
        await api.patch(`/v1/ganit/billing/rate-cards/${form.id}`, payload);
        pushToast({ title: 'Rate card updated', type: 'success' });
      } else {
        await api.post('/v1/ganit/billing/rate-cards', { ...payload, vendor_id: form.vendor_id });
        pushToast({ title: 'Rate card created', type: 'success' });
      }
      setEditing(null);
      load();
    } catch (e) {
      pushToast({ title: e.response?.data?.detail || 'Failed to save', type: 'error' });
    }
  }

  function handleDelete(id) {
    setConfirm({
      message: 'Delete this rate card?',
      intent: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/v1/ganit/billing/rate-cards/${id}`);
          pushToast({ title: 'Rate card deleted', type: 'success' });
          load();
        } catch (e) {
          pushToast({ title: e.response?.data?.detail || 'Failed to delete', type: 'error' });
        }
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
            + Rate Card
          </button>
        )}
        {!canWrite && denial && <span className="gn-denial">{denial}</span>}
      </div>

      {items.length > 0 ? (
        <DataTable columns={COLUMNS} label="Vendor rate cards">
          {items.map(r => (
            <tr key={r.id}>
              <Td bold>{r.vendor_name}</Td>
              <Td>{r.item_category}</Td>
              <Td align="right" mono>{inr(r.rate)}</Td>
              <Td>{r.unit}</Td>
              <Td>{r.effective_from || '—'}</Td>
              <Td>{r.effective_to || '—'}</Td>
              <Td>{r.proration_clause ? 'Yes' : '—'}</Td>
              <Td>
                {canWrite && (
                  <>
                    <button type="button" className="btn btn--ghost btn--xs"
                      onClick={() => setEditing({ ...r, rate: String(r.rate) })}>
                      Edit
                    </button>
                    <button type="button" className="btn btn--ghost btn--xs" onClick={() => handleDelete(r.id)}>
                      Delete
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
          title="No vendor rate cards"
          description="Add a rate card to lock in vendor pricing per item category, effective dates, and proration terms."
          action={canWrite ? '+ Rate Card' : undefined}
          onAction={canWrite ? () => setEditing({ ...BLANK }) : undefined}
        />
      )}

      <Modal
        open={!!editing}
        onOpenChange={v => { if (!v) setEditing(null); }}
        title={editing?.id ? 'Edit Rate Card' : 'New Rate Card'}
        footer={<>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>Cancel</button>
          <button type="button" className="btn btn--fill btn--sm" onClick={save}>Save</button>
        </>}
      >
        {editing && (
          <div className="gn-form__grid">
            {!editing.id && (
              <label className="fld">
                <span className="fld__l">Vendor <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'विक्रेता'}</span></span>
                <select className="inp" value={editing.vendor_id}
                  onChange={e => setEditing({ ...editing, vendor_id: e.target.value })}>
                  <option value="">Select a vendor…</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
            )}
            <label className="fld">
              <span className="fld__l">Item Category <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'वस्तु श्रेणी'}</span></span>
              <input className="inp" value={editing.item_category}
                onChange={e => setEditing({ ...editing, item_category: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Rate <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'दर'}</span></span>
              <input className="inp" type="number" min={0} step="0.01"
                value={editing.rate}
                onChange={e => setEditing({ ...editing, rate: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Unit <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'इकाई'}</span></span>
              <input className="inp" value={editing.unit}
                placeholder="e.g. hours, units, kg"
                onChange={e => setEditing({ ...editing, unit: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Effective From <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'प्रभावी तिथि'}</span></span>
              <DateInput value={editing.effective_from}
                onChange={e => setEditing({ ...editing, effective_from: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Effective To <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'समाप्ति तिथि'}</span></span>
              <DateInput value={editing.effective_to}
                onChange={e => setEditing({ ...editing, effective_to: e.target.value })} />
            </label>
            <label className="fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <input type="checkbox" checked={!!editing.proration_clause}
                onChange={e => setEditing({ ...editing, proration_clause: e.target.checked })} />
              <span>Proration Clause <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'यथानुपात खंड'}</span></span>
            </label>
            <label className="fld gn-form__wide">
              <span className="fld__l">Notes <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{'टिप्पणियाँ'}</span></span>
              <textarea className="inp" rows={2} value={editing.notes}
                onChange={e => setEditing({ ...editing, notes: e.target.value })} />
            </label>
          </div>
        )}
      </Modal>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
