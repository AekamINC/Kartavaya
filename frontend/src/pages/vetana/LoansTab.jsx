// Vetana → Loans and advances. Money lent, recovered from pay each month.
//
// A loan here is not a ledger entry: `process_payroll` reads active loans and
// deducts `min(emi_amount, balance_remaining)` from that month's net. So every
// figure on this tab is a figure that comes out of somebody's pay, and the tab
// says so rather than presenting a neutral list of records.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Badge, Empty, ModCard } from '../../components/editorial';
import { useList, ErrorNote, FMT, Shim, LOAN_COLORS, errText, empName } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';

const BLANK = { employee_id: '', principal_amount: 0, emi_amount: 0, disbursed_date: '', notes: '' };

export default function LoansTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'issue loans' });
  const { pushToast } = useToast();
  const list = useList('/v1/vetana/loans');
  const [showForm, setShowForm] = useState(false);
  const [employees, setEmployees] = useState({ loading: false, error: '', items: [] });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  async function openForm() {
    setShowForm(true);
    setEmployees({ loading: true, error: '', items: [] });
    try {
      const r = await api.get('/v1/manav/employees');
      setEmployees({ loading: false, error: '', items: r.data.data || [] });
    } catch (err) {
      setEmployees({ loading: false, error: errText(err, 'The employee list could not be loaded.'), items: [] });
    }
  }

  async function save(e) {
    e.preventDefault();
    if (!form.employee_id) { pushToast({ title: 'Choose an employee first.', type: 'error' }); return; }
    if (Number(form.principal_amount) <= 0 || Number(form.emi_amount) <= 0) {
      pushToast({ title: 'Principal and EMI both have to be more than zero.', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      await api.post('/v1/vetana/loans', form);
      pushToast({ title: 'Loan recorded — the employee has been emailed', type: 'success' });
      setShowForm(false);
      setForm(BLANK);
      list.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The loan could not be recorded.'), type: 'error' });
    } finally { setSaving(false); }
  }

  async function patch(id, body, done) {
    try {
      await api.patch(`/v1/vetana/loans/${id}`, body);
      pushToast({ title: done, type: 'success' });
      setEditId(null);
      list.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'The loan could not be updated.'), type: 'error' });
    }
  }

  // Months left at the current EMI — the fact somebody actually wants when
  // looking at a balance, and nothing was computing it.
  const monthsLeft = l => {
    const emi = Number(l.emi_amount || 0);
    const bal = Number(l.balance_remaining || 0);
    if (emi <= 0 || bal <= 0) return null;
    return Math.ceil(bal / emi);
  };

  return (
    <div>
      <div className="k-section__head vt-head">
        <h3 className="k-section__title">
          Loans &amp; advances<Secondary className="k-section__title-hi" value="ऋण एवं अग्रिम" />
        </h3>
        <button
          type="button"
          className="k-btn k-btn--primary"
          disabled={!canWrite}
          title={denial || undefined}
          onClick={() => { if (showForm) setShowForm(false); else openForm(); }}
        >
          {showForm ? 'Cancel' : '+ New loan'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="k-formpanel">
          {employees.error && (
            <ErrorNote what="The employee list" error={employees.error} onRetry={openForm} />
          )}
          <div className="k-formpanel__grid k-formpanel__grid--3">
            <label className="k-formpanel__label">Employee
              <select
                value={form.employee_id}
                onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
                className="k-formpanel__input"
                disabled={employees.loading || !!employees.error}
              >
                <option value="">{employees.loading ? 'Loading…' : 'Select…'}</option>
                {employees.items.map(emp => (
                  <option key={emp.id} value={emp.id}>{empName(emp)} ({emp.employee_code})</option>
                ))}
              </select>
            </label>
            <label className="k-formpanel__label">Principal (₹)
              <input
                type="number" min="1"
                value={form.principal_amount}
                onChange={e => setForm(f => ({ ...f, principal_amount: Number(e.target.value) }))}
                className="k-formpanel__input"
              />
            </label>
            <label className="k-formpanel__label">Monthly EMI (₹)
              <input
                type="number" min="1"
                value={form.emi_amount}
                onChange={e => setForm(f => ({ ...f, emi_amount: Number(e.target.value) }))}
                className="k-formpanel__input"
              />
            </label>
            <label className="k-formpanel__label">Disbursed on
              <input
                type="date"
                value={form.disbursed_date}
                onChange={e => setForm(f => ({ ...f, disbursed_date: e.target.value }))}
                className="k-formpanel__input"
              />
            </label>
            <label className="k-formpanel__label">Note
              <input
                type="text"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="k-formpanel__input"
              />
            </label>
          </div>
          <p className="note note--info">
            The EMI is deducted from net pay on every run while the loan is
            active, and the employee is emailed when it is recorded.
          </p>
          <div className="k-formpanel__actions">
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save loan'}
            </button>
          </div>
        </form>
      )}

      {list.loading ? <Shim count={4} />
        : list.error ? <ErrorNote what="Loans and advances" error={list.error} onRetry={list.reload} />
          : list.items.length === 0 ? (
            <Empty
              icon="🏦"
              title="No loans or advances"
              sub={canWrite
                ? 'Record a salary advance or loan and its EMI is deducted from payroll automatically each month until the balance clears.'
                : `A loan or salary advance has its EMI deducted from payroll automatically each month until the balance clears. ${denial}`}
              cta={canWrite ? '+ New loan' : undefined}
              onCta={canWrite ? openForm : undefined}
            />
          ) : (
            <div className="vt-list">
              {list.items.map(l => {
                const left = monthsLeft(l);
                const paid = Number(l.principal_amount || 0) - Number(l.balance_remaining || 0);
                const pct = Number(l.principal_amount) > 0
                  ? Math.round((paid / Number(l.principal_amount)) * 100) : 0;
                return (
                  <ModCard key={l.id}>
                    <div className="vt-loan__main">
                      <strong className="vt-row__t">{l.employee_name}</strong>
                      <span className="vt-code">{l.employee_code}</span>
                      <p className="vt-row__s">
                        Disbursed {l.disbursed_date} · EMI {FMT(l.emi_amount)}/mo
                        {l.status === 'active' && left != null && (
                          <> · {left} {left === 1 ? 'month' : 'months'} left</>
                        )}
                      </p>
                      {l.notes && <p className="vt-row__s">{l.notes}</p>}
                      {l.status === 'active' && (
                        <span className="vt-bar vt-bar--slim" title={`${pct}% repaid`}>
                          <span className="vt-bar__f" style={{ width: `${pct}%` }} />
                        </span>
                      )}
                      {editId === l.id && (
                        <form
                          className="vt-inline"
                          onSubmit={async e => {
                            e.preventDefault();
                            setEditSaving(true);
                            await patch(l.id, editForm, 'Loan updated');
                            setEditSaving(false);
                          }}
                        >
                          <label className="vt-field">
                            <span className="vt-field__l">EMI (₹)</span>
                            <input
                              type="number" min="1"
                              value={editForm.emi_amount}
                              onChange={e => setEditForm(f => ({ ...f, emi_amount: Number(e.target.value) }))}
                              className="k-input vt-field__in"
                            />
                          </label>
                          <label className="vt-field">
                            <span className="vt-field__l">Note</span>
                            <input
                              value={editForm.notes}
                              onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                              className="k-input vt-field__in"
                            />
                          </label>
                          <button type="submit" className="k-btn k-btn--primary" disabled={editSaving}>
                            {editSaving ? 'Saving…' : 'Save'}
                          </button>
                          <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditId(null)}>
                            Cancel
                          </button>
                        </form>
                      )}
                    </div>
                    <div className="vt-row__end">
                      <div className="vt-row__fig">
                        <span className="vt-row__num">{FMT(l.balance_remaining)}</span>
                        <p className="vt-row__sub">of {FMT(l.principal_amount)}</p>
                      </div>
                      <Badge text={l.status.replace('_', ' ')} color={LOAN_COLORS[l.status]} />
                      {l.status === 'active' && editId !== l.id && (
                        <button
                          type="button"
                          className="k-btn k-btn--ghost"
                          onClick={() => { setEditId(l.id); setEditForm({ emi_amount: Number(l.emi_amount || 0), notes: l.notes || '' }); }}
                        >
                          Edit
                        </button>
                      )}
                      {l.status === 'active' && (
                        <button
                          type="button"
                          className="k-btn k-btn--ghost"
                          onClick={() => setConfirm({
                            title: `Write off ${l.employee_name}’s loan?`,
                            message:
                              `${FMT(l.balance_remaining)} is still outstanding. Writing it off stops the `
                              + 'EMI being deducted from future payroll runs and closes the balance. '
                              + 'It does not reverse deductions already taken.',
                            confirmLabel: 'Write off',
                            intent: 'danger',
                            onConfirm: () => patch(l.id, { status: 'written_off' }, 'Loan written off'),
                          })}
                        >
                          Write off
                        </button>
                      )}
                    </div>
                  </ModCard>
                );
              })}
            </div>
          )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
