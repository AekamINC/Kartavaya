// Ganit · contracts — the agreements invoices are raised against.
import React, { useCallback, useEffect, useState } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { Badge, CONTRACT_COLORS } from './_shared';
import { inr } from '../../lib/inr';
import ContractDetail from './ContractDetail';

const STATUSES = ['draft', 'active', 'expired', 'cancelled', 'renewed'];
const BLANK = {
  title: '', contact_id: '', description: '', contract_value: '',
  start_date: '', end_date: '', renewal_reminder_days: 30, notes: '',
};

export default function ContractsTab() {
  const { pushToast } = useToast();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [contacts, setContacts] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState({ ...BLANK });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const params = statusFilter ? { status: statusFilter } : undefined;
      const r = await api.get('/v1/ganit/contracts', { params });
      setContracts(rows(r));
    } catch (e) {
      // The status filter used to be applied only when `load` was pressed, so
      // choosing a status did nothing until you hit "Filter". It is a
      // dependency of `load` now and re-runs on change.
      setErr(e);
      setContracts([]);
    } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  function openForm() {
    setShowForm(true);
    api.get('/v1/graha/contacts').then(r => setContacts(rows(r))).catch(() => {});
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/ganit/contracts', {
        ...form, contract_value: parseFloat(form.contract_value) || 0,
      });
      pushToast({ title: 'Contract created', type: 'success' });
      setShowForm(false);
      setForm({ ...BLANK });
      load();
    } catch (err2) {
      pushToast({ title: err2.response?.data?.detail || 'Could not create the contract', type: 'error' });
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="gn-bar">
        <label className="gn-bar__f">
          <span className="gn-bar__fl">Status</span>
          <select className="inp gn-bar__sel" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <span className="gn-bar__sp" />
        <button type="button" className="btn btn--fill btn--sm"
          onClick={() => (showForm ? setShowForm(false) : openForm())}>
          {showForm ? 'Close form' : '+ New contract'}
        </button>
      </div>

      {showForm && (
        <form className="gn-form" onSubmit={save}>
          <h3 className="gn-form__t">New contract</h3>
          <div className="gn-form__grid gn-form__grid--2 gn-form__grid--flush">
            <label className="fld">
              <span className="fld__l">Title<span className="fld__req">*</span></span>
              <input className="inp" required value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Customer</span>
              <select className="inp" value={form.contact_id}
                onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="fld">
              <span className="fld__l">Value (₹)</span>
              <input className="inp" type="number" step="0.01" value={form.contract_value}
                onChange={e => setForm({ ...form, contract_value: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">Reminder (days before end)</span>
              <input className="inp" type="number" value={form.renewal_reminder_days}
                onChange={e => setForm({ ...form, renewal_reminder_days: parseInt(e.target.value, 10) || 30 })} />
            </label>
            <label className="fld">
              <span className="fld__l">Start date</span>
              <input className="inp" type="date" value={form.start_date}
                onChange={e => setForm({ ...form, start_date: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">End date</span>
              <input className="inp" type="date" value={form.end_date}
                onChange={e => setForm({ ...form, end_date: e.target.value })} />
            </label>
            <label className="fld gn-form__wide">
              <span className="fld__l">Description</span>
              <textarea className="inp gn-ta" rows={2} value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })} />
            </label>
          </div>
          <div className="gn-form__acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <SkeletonRegion label="Loading contracts"><SkeletonList rows={5} showAvatar={false} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : contracts.length === 0 ? (
        statusFilter ? (
          <EmptyState
            illustration="search"
            title={{ en: `No ${statusFilter} contracts`, hi: 'कोई अनुबंध नहीं' }}
            description="Nothing sits at this status right now. Clear the filter to see every contract."
            action="Show all contracts"
            onAction={() => setStatusFilter('')}
          />
        ) : (
          <EmptyState
            illustration="generic"
            title={{ en: 'No contracts yet', hi: 'कोई अनुबंध नहीं' }}
            description="Record retainers and long-term agreements here. Kartavaya reminds you before one lapses, and invoices raised against it stay linked."
            action="+ New contract"
            onAction={openForm}
          />
        )
      ) : (
        <div className="gn-list">
          {contracts.map(c => (
            <button type="button" key={c.id} className="gn-row" onClick={() => setOpenId(c.id)}>
              <span className="gn-row__head">
                <span className="gn-row__t">{c.title}</span>
                <span className="gn-row__r">
                  <span className="gn-row__v">{inr(Number(c.contract_value || 0))}</span>
                  <Badge text={c.status} color={CONTRACT_COLORS[c.status] || 'var(--on-surface-3)'} />
                </span>
              </span>
              <span className="gn-row__meta">
                <span>
                  {c.contact_name && `${c.contact_name} · `}
                  {c.start_date && `${c.start_date} → ${c.end_date || '…'}`}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {openId && (
        <ContractDetail
          contractId={openId}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
