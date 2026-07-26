import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge, CLAIM_COLORS, CLAIM_CATEGORIES } from './_shared';
import { inr } from '../../lib/inr';

export default function ExpensesTab() {
  const { pushToast } = useToast();
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ employee_id: '', category: 'travel', expense_date: '', amount: '', description: '', receipt_urls: [] });
  const [receiptUrl, setReceiptUrl] = useState('');
  const [employees, setEmployees] = useState([]);

  useEffect(() => { load(); loadEmployees(); }, [statusFilter]);

  async function loadEmployees() {
    try { const r = await api.get('/v1/manav/employees'); setEmployees(r.data.data || []); } catch {}
  }

  async function load() {
    try {
      let url = '/v1/manav/expense-claims?';
      if (statusFilter) url += `status=${statusFilter}&`;
      const r = await api.get(url);
      setClaims(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load expense claims', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/expense-claims', { ...form, amount: parseFloat(form.amount) || 0 });
      pushToast({ title: 'Expense claim submitted', type: 'success' });
      setShowForm(false);
      setForm({ employee_id: '', category: 'travel', expense_date: '', amount: '', description: '', receipt_urls: [] });
      setReceiptUrl('');
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  function addReceipt() {
    if (!receiptUrl.trim()) return;
    setForm(f => ({ ...f, receipt_urls: [...f.receipt_urls, receiptUrl.trim()] }));
    setReceiptUrl('');
  }

  async function action(claimId, decision) {
    try {
      await api.patch(`/v1/manav/expense-claims/${claimId}/${decision}`, decision === 'reject' ? { status: 'rejected' } : undefined);
      pushToast({ title: `Claim ${decision === 'approve' ? 'approved' : 'rejected'}`, type: 'success' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="k-input" style={{ width: 130 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          {['pending', 'approved', 'rejected', 'paid'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ Submit Claim</button>
      </div>

      {showForm && (
        <form onSubmit={submit} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Submit Expense Claim</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Employee *</span>
              <select className="k-input" required value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value })}>
                <option value="">Select employee…</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code})</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Category</span>
              <select className="k-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {CLAIM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Date *</span>
              <input className="k-input" type="date" required value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Amount (₹) *</span>
              <input className="k-input" type="number" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <textarea className="k-input" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ resize: 'vertical' }} /></label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Receipt URL</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="k-input" placeholder="Paste receipt image/PDF URL" value={receiptUrl} onChange={e => setReceiptUrl(e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={addReceipt}>Add</button>
              </div>
              {form.receipt_urls.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)' }}>{form.receipt_urls.length} receipt(s) attached</div>
              )}
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Submitting…' : 'Submit'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        claims.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🧾</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No expense claims</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Employee reimbursement requests will show up here.</div>
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {claims.map(c => (
            <div key={c.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{c.employee_name}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-3)' }}>{c.employee_code}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{inr(Number(c.amount))}</span>
                  <Badge text={c.status} color={CLAIM_COLORS[c.status] || 'var(--on-surface-3)'} />
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                <strong style={{ textTransform: 'capitalize' }}>{c.category}</strong> · {c.expense_date}
                {c.description && <span> · {c.description}</span>}
                {c.rejection_reason && <span style={{ color: 'var(--danger)' }}> · Rejected: {c.rejection_reason}</span>}
              </div>
              {c.status === 'pending' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="k-btn k-btn--primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => action(c.id, 'approve')}>Approve</button>
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 12, padding: '4px 12px', color: 'var(--danger)' }} onClick={() => action(c.id, 'reject')}>Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
