// Manav → Expense claims. Reimbursement requests and their approval.
//
// `load()` caught to a toast and left `claims` at `[]`, so a failed fetch
// rendered "No expense claims — employee reimbursement requests will show up
// here": a claim of fact about money owed, printed when the truth is that the
// request failed. `loadEmployees()` was a bare `catch {}`.
//
// The filter also re-fetched through a `useEffect` keyed on `statusFilter`
// while `load()` closed over the previous value, so the list lagged the select
// by one change. `useList` keyed on the URL removes that class of bug entirely:
// the URL IS the state.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty } from '../../components/editorial';
import { Badge, CLAIM_COLORS, CLAIM_CATEGORIES, useList, ErrorNote, Shim, errText } from './_shared';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';

export default function ExpensesTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const { pushToast } = useToast();
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [acting, setActing] = useState('');

  const url = `/v1/manav/expense-claims${statusFilter ? `?status=${statusFilter}` : ''}`;
  const claims = useList(url, [url]);
  const employees = useList('/v1/manav/employees');

  async function action(claimId, decision) {
    setActing(claimId + decision);
    try {
      await api.patch(
        `/v1/manav/expense-claims/${claimId}/${decision}`,
        decision === 'reject' ? { status: 'rejected' } : undefined,
      );
      pushToast({ title: `Claim ${decision === 'approve' ? 'approved' : 'rejected'}`, type: 'success' });
      claims.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The decision could not be recorded.'), type: 'error' });
    } finally { setActing(''); }
  }

  return (
    <div>
      <div className="mn-bar">
        <label className="mn-field">
          <span className="mn-field__l">Status</span>
          <select className="k-input mn-f--sm" value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {['pending', 'approved', 'rejected', 'paid'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="mn-bar__gap" />
        <button type="button" className="k-btn k-btn--primary" onClick={() => setShowForm(true)}
          disabled={!canWrite} title={denial || undefined}>
          + Submit claim
        </button>
      </div>

      {showForm && (
        <ClaimForm
          employees={employees}
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); claims.reload(); }}
          pushToast={pushToast}
        />
      )}

      {claims.loading ? <Shim count={4} />
        : claims.error ? <ErrorNote what="Expense claims" error={claims.error} onRetry={claims.reload} />
          : claims.items.length === 0 ? (
            <Empty
              icon="🧾"
              title={statusFilter ? `No ${statusFilter} claims` : 'No expense claims'}
              sub={statusFilter
                ? 'Clear the status filter to see every claim.'
                : 'Employee reimbursement requests appear here for approval.'}
            />
          ) : (
            <div className="mn-list">
              {claims.items.map(c => (
                <article key={c.id} className="mn-rec">
                  <div className="mn-rec__top">
                    <div className="mn-rec__who">
                      <span className="mn-rec__name">{c.employee_name}</span>
                      <span className="mn-rec__code">{c.employee_code}</span>
                    </div>
                    <div className="mn-rec__end">
                      <span className="mn-rec__amt">{inr(Number(c.amount))}</span>
                      <Badge text={c.status} color={CLAIM_COLORS[c.status] || 'var(--on-surface-3)'} />
                    </div>
                  </div>
                  <div className="mn-rec__body">
                    <strong className="mn-cap">{c.category}</strong> · {c.expense_date}
                    {c.description && <> · {c.description}</>}
                    {c.rejection_reason && (
                      <span className="mn-rec__rej"> · Rejected: {c.rejection_reason}</span>
                    )}
                  </div>
                  {c.status === 'pending' && (
                    <div className="mn-rec__act">
                      <button type="button" className="k-btn k-btn--primary k-btn--sm"
                        disabled={!!acting || !canWrite} onClick={() => action(c.id, 'approve')} title={denial || undefined}>
                        {acting === c.id + 'approve' ? 'Approving…' : 'Approve'}
                      </button>
                      <button type="button" className="k-btn k-btn--ghost k-btn--sm k-btn--reject"
                        disabled={!!acting} onClick={() => action(c.id, 'reject')}>
                        {acting === c.id + 'reject' ? 'Rejecting…' : 'Reject'}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
    </div>
  );
}

function ClaimForm({ employees, onClose, onCreated, pushToast }) {
  // F32 — this component owns its own write controls, so it asks
  // the same question rather than taking the answer as a prop.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change HR records' });
  const [saving, setSaving] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState('');
  const [form, setForm] = useState({
    employee_id: '', category: 'travel', expense_date: '',
    amount: '', description: '', receipt_urls: [],
  });

  function addReceipt() {
    const v = receiptUrl.trim();
    if (!v) return;
    setForm(f => ({ ...f, receipt_urls: [...f.receipt_urls, v] }));
    setReceiptUrl('');
  }

  function dropReceipt(i) {
    setForm(f => ({ ...f, receipt_urls: f.receipt_urls.filter((_, n) => n !== i) }));
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/expense-claims', { ...form, amount: parseFloat(form.amount) || 0 });
      pushToast({ title: 'Expense claim submitted', type: 'success' });
      onCreated();
    } catch (err) {
      pushToast({ title: errText(err, 'The claim could not be submitted.'), type: 'error' });
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="k-formpanel">
      <h4 className="k-section__title">Submit expense claim</h4>

      {employees.error && (
        <ErrorNote what="The employee list" error={employees.error} onRetry={employees.reload} />
      )}

      <div className="k-formpanel__grid k-formpanel__grid--3">
        <label className="k-formpanel__label">
          <span>Employee *</span>
          <select className="k-formpanel__input" required value={form.employee_id}
            disabled={employees.loading || !!employees.error}
            onChange={e => setForm({ ...form, employee_id: e.target.value })}>
            <option value="">
              {employees.loading ? 'Loading…' : employees.error ? 'Unavailable' : 'Select employee…'}
            </option>
            {(employees.items || []).map(emp => (
              <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code})</option>
            ))}
          </select>
        </label>
        <label className="k-formpanel__label">
          <span>Category</span>
          <select className="k-formpanel__input" value={form.category}
            onChange={e => setForm({ ...form, category: e.target.value })}>
            {CLAIM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="k-formpanel__label">
          <span>Date *</span>
          <input className="k-formpanel__input" type="date" required value={form.expense_date}
            onChange={e => setForm({ ...form, expense_date: e.target.value })} />
        </label>
        <label className="k-formpanel__label">
          <span>Amount *</span>
          <input className="k-formpanel__input" type="number" min="0" step="0.01" required
            value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
        </label>
        <label className="k-formpanel__label mn-fw">
          <span>Description</span>
          <textarea className="k-formpanel__input mn-ta" rows={2} value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })} />
        </label>
        <div className="k-formpanel__label mn-fw">
          <span>Receipts</span>
          <div className="mn-inline">
            <input
              className="k-formpanel__input"
              placeholder="Paste a receipt image or PDF URL"
              aria-label="Receipt URL"
              value={receiptUrl}
              onChange={e => setReceiptUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addReceipt(); } }}
            />
            <button type="button" className="k-btn k-btn--ghost" onClick={addReceipt}>Add</button>
          </div>
          {form.receipt_urls.length > 0 && (
            <ul className="mn-chiplist">
              {form.receipt_urls.map((u, i) => (
                <li key={u + i} className="mn-chiplist__i">
                  <span className="mn-chiplist__u">{u}</span>
                  <button type="button" className="mn-chiplist__x"
                    aria-label={`Remove receipt ${i + 1}`} onClick={() => dropReceipt(i)}>×</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="k-formpanel__actions">
        <button type="button" className="k-btn k-btn--ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="k-btn k-btn--primary" disabled={saving || !!employees.error || !canWrite} title={denial || undefined}>
          {saving ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </form>
  );
}
