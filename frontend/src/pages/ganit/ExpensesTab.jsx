import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { StatTile } from '../../components/editorial';
import { Badge } from './_shared';
import { inr } from '../../lib/inr';

export default function ExpensesTab() {
  const { pushToast } = useToast();
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [categories, setCategories] = useState([]);
  const [catFilter, setCatFilter] = useState('');
  const [expStats, setExpStats] = useState(null);
  const [form, setForm] = useState({ title: '', category: 'general', amount: '', tax_amount: 0, expense_date: '', vendor: '', reference: '', notes: '', is_billable: false });
  const [saving, setSaving] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', icon: '📁' });
  const [editExpense, setEditExpense] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => { load(); loadCategories(); loadStats(); }, []);

  async function load() {
    try {
      let url = '/v1/ganit/expenses?';
      if (catFilter) url += `category=${encodeURIComponent(catFilter)}&`;
      const r = await api.get(url);
      setExpenses(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load expenses', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadCategories() {
    try {
      const r = await api.get('/v1/ganit/expense-categories');
      setCategories(r.data.data || []);
    } catch {}
  }

  async function loadStats() {
    try {
      const r = await api.get('/v1/ganit/expense-stats');
      setExpStats(r.data);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const amt = parseFloat(form.amount) || 0;
    const tax = parseFloat(form.tax_amount) || 0;
    try {
      await api.post('/v1/ganit/expenses', { ...form, amount: amt, tax_amount: tax, total: amt + tax });
      pushToast({ title: 'Expense recorded', type: 'success' });
      setShowForm(false);
      setForm({ title: '', category: 'general', amount: '', tax_amount: 0, expense_date: '', vendor: '', reference: '', notes: '', is_billable: false });
      load();
      loadStats();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function deleteExpense(id) {
    try {
      await api.delete(`/v1/ganit/expenses/${id}`);
      setExpenses(prev => prev.filter(x => x.id !== id));
      pushToast({ title: 'Expense deleted', type: 'success' });
      loadStats();
    } catch { pushToast({ title: 'Could not delete expense', type: 'error' }); }
  }

  function startEditExpense(ex) {
    setEditExpense(ex.id);
    setEditForm({ title: ex.title || '', category: ex.category || 'general', amount: ex.amount ?? '', tax_amount: ex.tax_amount ?? 0, expense_date: ex.expense_date || '', vendor: ex.vendor || '', reference: ex.reference || '', notes: ex.notes || '', is_billable: !!ex.is_billable });
  }

  async function saveEditExpense(e) {
    e.preventDefault();
    setEditSaving(true);
    try {
      const amt = parseFloat(editForm.amount) || 0;
      const tax = parseFloat(editForm.tax_amount) || 0;
      await api.patch(`/v1/ganit/expenses/${editExpense}`, { ...editForm, amount: amt, tax_amount: tax, total: amt + tax });
      pushToast({ title: 'Expense updated', type: 'success' });
      setEditExpense(null);
      load(); loadStats();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Could not update expense', type: 'error' }); }
    finally { setEditSaving(false); }
  }

  async function saveCat(e) {
    e.preventDefault();
    try {
      await api.post('/v1/ganit/expense-categories', catForm);
      pushToast({ title: 'Category created', type: 'success' });
      setShowCatForm(false);
      setCatForm({ name: '', icon: '📁' });
      loadCategories();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  return (
    <div>
      {expStats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
          <StatTile label="Total Expenses" value={inr(Number(expStats.total_amount || 0))} />
          <StatTile label="This Month" value={inr(Number(expStats.this_month || 0))} />
          <StatTile label="Billable" value={inr(Number(expStats.billable_amount || 0))} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select className="k-input" style={{ width: 150 }} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
        </select>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--ghost" style={{ fontSize: 13 }} onClick={() => setShowCatForm(true)}>+ Category</button>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ Add Expense</button>
      </div>

      {showCatForm && (
        <form onSubmit={saveCat} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>New Category</h4>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ fontSize: 13, flex: 1 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Icon</span>
              <input className="k-input" style={{ width: 60 }} value={catForm.icon} onChange={e => setCatForm({ ...catForm, icon: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowCatForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Create</button>
          </div>
        </form>
      )}

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Record Expense</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Category</span>
              <select className="k-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                <option value="general">General</option>
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Date *</span>
              <input className="k-input" type="date" required value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Amount (₹) *</span>
              <input className="k-input" type="number" step="0.01" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Tax (₹)</span>
              <input className="k-input" type="number" step="0.01" value={form.tax_amount} onChange={e => setForm({ ...form, tax_amount: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Vendor</span>
              <input className="k-input" value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Reference</span>
              <input className="k-input" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
              <input type="checkbox" checked={form.is_billable} onChange={e => setForm({ ...form, is_billable: e.target.checked })} />
              <span style={{ fontWeight: 600 }}>Billable</span></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Record'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        expenses.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>💸</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No expenses recorded</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Log business expenses here to track spending and generate reports.</div>
          </div>
        ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Date', 'Title', 'Category', 'Vendor', 'Amount', 'Tax', 'Total', 'Billable', ''].map(h => (
                <th key={h} style={{ textAlign: ['Amount', 'Tax', 'Total'].includes(h) ? 'right' : 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {expenses.map(ex => (
              <React.Fragment key={ex.id}>
              <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '10px', fontSize: 12 }}>{ex.expense_date}</td>
                <td style={{ padding: '10px', fontWeight: 600 }}>
                  <span style={{ cursor: 'pointer', color: 'var(--k-primary)', textDecoration: 'underline', textDecorationStyle: 'dotted' }} onClick={() => startEditExpense(ex)}>{ex.title}</span>
                </td>
                <td style={{ padding: '10px' }}><Badge text={ex.category} color="var(--st-in-review)" /></td>
                <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{ex.vendor || '—'}</td>
                <td className="mtbl__num" style={{ padding: '10px' }}>{inr(Number(ex.amount))}</td>
                <td className="mtbl__num" style={{ padding: '10px', color: 'var(--ink-3)' }}>{inr(Number(ex.tax_amount || 0))}</td>
                <td className="mtbl__num" style={{ padding: '10px', fontWeight: 600 }}>{inr(Number(ex.total))}</td>
                <td style={{ padding: '10px' }}>{ex.is_billable ? <Badge text="Yes" color="var(--ok)" /> : '—'}</td>
                <td style={{ padding: '10px', display: 'flex', gap: 8 }}>
                  <button onClick={() => startEditExpense(ex)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--k-primary)', fontSize: 11 }}>Edit</button>
                  <button onClick={() => deleteExpense(ex.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 11 }}>Delete</button>
                </td>
              </tr>
              {editExpense === ex.id && (
                <tr><td colSpan={9} style={{ padding: 0 }}>
                  <form onSubmit={saveEditExpense} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-sm)', padding: 16, margin: '4px 0 8px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
                        <input className="k-input" required value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value })} /></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Category</span>
                        <select className="k-input" value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })}>
                          <option value="general">General</option>
                          {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Date *</span>
                        <input className="k-input" type="date" required value={editForm.expense_date} onChange={e => setEditForm({ ...editForm, expense_date: e.target.value })} /></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Amount</span>
                        <input className="k-input" type="number" step="0.01" required value={editForm.amount} onChange={e => setEditForm({ ...editForm, amount: e.target.value })} /></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Tax</span>
                        <input className="k-input" type="number" step="0.01" value={editForm.tax_amount} onChange={e => setEditForm({ ...editForm, tax_amount: e.target.value })} /></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Vendor</span>
                        <input className="k-input" value={editForm.vendor} onChange={e => setEditForm({ ...editForm, vendor: e.target.value })} /></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Reference</span>
                        <input className="k-input" value={editForm.reference} onChange={e => setEditForm({ ...editForm, reference: e.target.value })} /></label>
                      <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                        <input type="checkbox" checked={editForm.is_billable} onChange={e => setEditForm({ ...editForm, is_billable: e.target.checked })} />
                        <span style={{ fontWeight: 600 }}>Billable</span></label>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                      <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditExpense(null)}>Cancel</button>
                      <button type="submit" className="k-btn k-btn--primary" disabled={editSaving}>{editSaving ? 'Saving…' : 'Save'}</button>
                    </div>
                  </form>
                </td></tr>
              )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
