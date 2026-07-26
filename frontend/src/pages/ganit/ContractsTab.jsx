import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge, CONTRACT_COLORS } from './_shared';
import { inr } from '../../lib/inr';

export default function ContractsTab() {
  const { pushToast } = useToast();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [contacts, setContacts] = useState([]);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ title: '', contact_id: '', description: '', contract_value: '', start_date: '', end_date: '', renewal_reminder_days: 30, notes: '' });
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      let url = '/v1/ganit/contracts?';
      if (statusFilter) url += `status=${statusFilter}&`;
      const r = await api.get(url);
      setContracts(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load contracts', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadContacts() {
    try {
      const r = await api.get('/v1/graha/contacts');
      setContacts(r.data.data || []);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/ganit/contracts', { ...form, contract_value: parseFloat(form.contract_value) || 0 });
      pushToast({ title: 'Contract created', type: 'success' });
      setShowForm(false);
      setForm({ title: '', contact_id: '', description: '', contract_value: '', start_date: '', end_date: '', renewal_reminder_days: 30, notes: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function updateStatus(id, status) {
    try {
      await api.patch(`/v1/ganit/contracts/${id}`, { status });
      pushToast({ title: `Contract → ${status}`, type: 'success' });
      load();
      if (detail) loadDetail(id);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function loadDetail(id) {
    try {
      const r = await api.get(`/v1/ganit/contracts/${id}`);
      setDetail(r.data);
      setEditMode(false);
    } catch { pushToast({ title: 'Failed to load contract', type: 'error' }); }
  }

  function startEditContract(c) {
    setEditForm({ title: c.title || '', contact_id: c.contact_id || '', description: c.description || '', contract_value: c.contract_value ?? '', start_date: c.start_date || '', end_date: c.end_date || '', renewal_reminder_days: c.renewal_reminder_days ?? 30, notes: c.notes || '' });
    setEditMode(true);
    loadContacts();
  }

  async function saveEditContract(e) {
    e.preventDefault();
    setEditSaving(true);
    try {
      await api.patch(`/v1/ganit/contracts/${detail.contract.id}`, { ...editForm, contract_value: parseFloat(editForm.contract_value) || 0 });
      pushToast({ title: 'Contract updated', type: 'success' });
      setEditMode(false);
      loadDetail(detail.contract.id);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Could not update contract', type: 'error' }); }
    finally { setEditSaving(false); }
  }

  if (detail) {
    const c = detail.contract;
    return (
      <div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => setDetail(null)}>← Back to list</button>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{c.title}</h3>
              {c.contact_name && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>{c.contact_name}</p>}
            </div>
            <Badge text={c.status} color={CONTRACT_COLORS[c.status] || 'var(--on-surface-3)'} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
            <div><strong>Value:</strong> {inr(Number(c.contract_value || 0))}</div>
            <div><strong>Start:</strong> {c.start_date || '—'}</div>
            <div><strong>End:</strong> {c.end_date || '—'}</div>
            <div><strong>Reminder:</strong> {c.renewal_reminder_days} days before</div>
          </div>
          {c.description && <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 12 }}>{c.description}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => startEditContract(c)}>Edit</button>
            {['draft', 'active', 'expired', 'cancelled', 'renewed'].filter(s => s !== c.status).map(s => (
              <button key={s} className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={() => updateStatus(c.id, s)}>{s}</button>
            ))}
          </div>
        </div>

        {editMode && (
          <form onSubmit={saveEditContract} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Edit Contract</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
                <input className="k-input" required value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact</span>
                <select className="k-input" value={editForm.contact_id} onChange={e => setEditForm({ ...editForm, contact_id: e.target.value })}>
                  <option value="">None</option>
                  {contacts.map(ct => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                </select></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Value</span>
                <input className="k-input" type="number" step="0.01" value={editForm.contract_value} onChange={e => setEditForm({ ...editForm, contract_value: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Reminder (days)</span>
                <input className="k-input" type="number" value={editForm.renewal_reminder_days} onChange={e => setEditForm({ ...editForm, renewal_reminder_days: parseInt(e.target.value) || 30 })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Start Date</span>
                <input className="k-input" type="date" value={editForm.start_date} onChange={e => setEditForm({ ...editForm, start_date: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>End Date</span>
                <input className="k-input" type="date" value={editForm.end_date} onChange={e => setEditForm({ ...editForm, end_date: e.target.value })} /></label>
              <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
                <textarea className="k-input" rows={2} value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} style={{ resize: 'vertical' }} /></label>
              <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
                <textarea className="k-input" rows={2} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} style={{ resize: 'vertical' }} /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditMode(false)}>Cancel</button>
              <button type="submit" className="k-btn k-btn--primary" disabled={editSaving}>{editSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        )}

        {detail.invoices?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Related Invoices ({detail.invoices.length})</h4>
            {detail.invoices.map(inv => (
              <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{inv.invoice_number}</span>
                <span style={{ fontWeight: 600 }}>{inr(Number(inv.total))}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select className="k-input" style={{ width: 130 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          {['draft', 'active', 'expired', 'cancelled', 'renewed'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => { setShowForm(true); loadContacts(); }}>+ New Contract</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Contract</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact</span>
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Value (₹)</span>
              <input className="k-input" type="number" step="0.01" value={form.contract_value} onChange={e => setForm({ ...form, contract_value: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Reminder (days before end)</span>
              <input className="k-input" type="number" value={form.renewal_reminder_days} onChange={e => setForm({ ...form, renewal_reminder_days: parseInt(e.target.value) || 30 })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Start Date</span>
              <input className="k-input" type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>End Date</span>
              <input className="k-input" type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <textarea className="k-input" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ resize: 'vertical' }} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        contracts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No contracts yet</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Create contracts for recurring services or long-term agreements with clients.</div>
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {contracts.map(c => (
            <div key={c.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: '12px 16px', cursor: 'pointer' }}
              onClick={() => loadDetail(c.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{c.title}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700 }}>{inr(Number(c.contract_value || 0))}</span>
                  <Badge text={c.status} color={CONTRACT_COLORS[c.status] || 'var(--on-surface-3)'} />
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {c.contact_name && <span>{c.contact_name} · </span>}
                {c.start_date && <span>{c.start_date} → {c.end_date || '…'}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
