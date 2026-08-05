// Ganit · recurring invoices — retainers and subscriptions that raise themselves.
import React, { useCallback, useEffect, useState } from 'react';
import { api, rows, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Badge } from './_shared';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';

const EMPTY_ITEM = { description: '', quantity: 1, rate: 0, gst_rate: 18 };
const BLANK = {
  contact_id: '', frequency: 'monthly', next_date: '', end_date: '',
  auto_send: false, notes: '', template_items: [{ ...EMPTY_ITEM }],
  subtotal: 0, gst_rate: 18, is_igst: false,
};
const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'];

export default function RecurringTab() {
  // F32 — the module is read from the route, never named here. `Generate now`
  // raises a real invoice and `Deactivate` stops a revenue schedule; both were
  // offered to a viewer at full strength.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change schedules' });
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [form, setForm] = useState({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await api.get('/v1/ganit/recurring');
      setItems(rows(r));
    } catch (e) {
      // "No recurring invoices" on a failed fetch tells a firm its retainers
      // have stopped billing. They have not; the request failed.
      setErr(e);
      setItems([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openForm() {
    setShowForm(true);
    api.get('/v1/graha/contacts').then(r => setContacts(rows(r))).catch(() => {});
  }

  function updateItem(i, key, val) {
    setForm(f => {
      const next = [...f.template_items];
      next[i] = { ...next[i], [key]: val };
      return { ...f, template_items: next };
    });
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const subtotal = form.template_items.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.rate) || 0), 0);
    try {
      await api.post('/v1/ganit/recurring', { ...form, subtotal });
      pushToast({ title: 'Recurring invoice created', type: 'success' });
      setShowForm(false);
      setForm({ ...BLANK });
      load();
    } catch (err2) {
      pushToast({ title: err2.response?.data?.detail || 'Could not create the schedule', type: 'error' });
    } finally { setSaving(false); }
  }

  async function deactivate(r) {
    setBusyId(r.id);
    try {
      await api.delete(`/v1/ganit/recurring/${r.id}`);
      pushToast({ title: 'Schedule deactivated', type: 'success' });
      load();
    } catch {
      pushToast({ title: 'Could not deactivate the schedule', type: 'error' });
    } finally { setBusyId(null); }
  }

  async function generateNow(r) {
    setBusyId(r.id);
    try {
      const res = await api.post(`/v1/ganit/recurring/${r.id}/generate`);
      pushToast({ title: `Invoice ${body(res).invoice_number} generated`, type: 'success' });
      load();
    } catch (err2) {
      pushToast({ title: err2.response?.data?.detail || 'Could not generate the invoice', type: 'error' });
    } finally { setBusyId(null); }
  }

  return (
    <div>
      <div className="gn-bar">
        <span className="gn-bar__sp" />
        <button type="button" className="btn btn--fill btn--sm"
          disabled={!canWrite} title={denial || undefined}
          onClick={() => (showForm ? setShowForm(false) : openForm())}>
          {showForm ? 'Close form' : '+ New recurring invoice'}
        </button>
      </div>

      {showForm && canWrite && (
        <form className="gn-form" onSubmit={save}>
          <h3 className="gn-form__t">Recurring invoice</h3>

          <div className="gn-form__grid">
            <label className="fld">
              <span className="fld__l">Customer</span>
              <select className="inp" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="fld">
              <span className="fld__l">Frequency<span className="fld__req">*</span></span>
              <select className="inp" value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })}>
                {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="fld">
              <span className="fld__l">Next date<span className="fld__req">*</span></span>
              <input className="inp" type="date" required value={form.next_date}
                onChange={e => setForm({ ...form, next_date: e.target.value })} />
            </label>
            <label className="fld">
              <span className="fld__l">End date</span>
              <input className="inp" type="date" value={form.end_date}
                onChange={e => setForm({ ...form, end_date: e.target.value })} />
            </label>
            {/*
              This said "Auto-send", and nothing sends.

              The flag is stored, read back and — since the generator was
              repaired — COUNTED (`generate_due_invoices` returns
              `awaiting_send`). What no code anywhere does is email the invoice.
              That is deliberate on the generator's side and well argued:
              `OUTBOUND_MODE` is unset on production, which outbound.py reads as
              "live", so wiring a send into a job about to go on a cron for the
              first time would mail real customers on its first tick.

              So the word had to change, not the behaviour. A checkbox labelled
              "Auto-send" is a promise the product does not keep — the operator
              ticks it, watches the invoice appear on the due date, and assumes
              the customer has it. The label now says what the flag actually
              does, and the hint says plainly that no mail leaves.

              When sending is wired, this comment and the hint come out
              together. See needs_from_orchestrator.
            */}
            <label className="gn-chk gn-chk--stack">
              <span className="gn-chk__ctl">
                <input type="checkbox" checked={form.auto_send}
                  onChange={e => setForm({ ...form, auto_send: e.target.checked })} />
                <span>Flag for sending</span>
              </span>
              <span className="fld__hint">
                Kartavaya does not email invoices on its own yet. The invoice is raised on
                the date shown and waits under Invoices for you to send it.
              </span>
            </label>
            <label className="gn-chk">
              <input type="checkbox" checked={form.is_igst}
                onChange={e => setForm({ ...form, is_igst: e.target.checked })} />
              <span>Inter-state (IGST)</span>
            </label>
          </div>

          <h4 className="gn-form__h">Template items</h4>
          {form.template_items.map((li, i) => (
            <div key={i} className="gn-li" style={{ '--gn-li': '2fr 80px 110px 80px 30px' }}>
              <div>
                {i === 0 && <span className="gn-li__l">Description</span>}
                <input className="inp" placeholder="Description" value={li.description}
                  onChange={e => updateItem(i, 'description', e.target.value)} />
              </div>
              <div>
                {i === 0 && <span className="gn-li__l">Qty</span>}
                <input className="inp" type="number" min="1" value={li.quantity}
                  onChange={e => updateItem(i, 'quantity', parseFloat(e.target.value) || 1)} />
              </div>
              <div>
                {i === 0 && <span className="gn-li__l">Rate</span>}
                <input className="inp" type="number" value={li.rate}
                  onChange={e => updateItem(i, 'rate', parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                {i === 0 && <span className="gn-li__l">GST%</span>}
                <input className="inp" type="number" value={li.gst_rate}
                  onChange={e => updateItem(i, 'gst_rate', parseFloat(e.target.value) || 18)} />
              </div>
              <button type="button" className="gn-li__x" aria-label={`Remove item ${i + 1}`}
                disabled={form.template_items.length === 1}
                onClick={() => setForm(f => ({ ...f, template_items: f.template_items.filter((_, j) => j !== i) }))}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="btn btn--ghost btn--sm"
            onClick={() => setForm(f => ({ ...f, template_items: [...f.template_items, { ...EMPTY_ITEM }] }))}>
            + Add item
          </button>

          <div className="gn-form__acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <SkeletonRegion label="Loading recurring invoices"><SkeletonList rows={4} showAvatar={false} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState
          illustration="generic"
          title={{ en: 'No recurring invoices', hi: 'कोई नियमित बीजक नहीं' }}
          description={canWrite
            ? 'Set up auto-generated invoices for retainers, subscriptions or monthly services. The schedule raises the invoice; sending it stays with you.'
            : `A recurring invoice raises itself on a schedule, for retainers, subscriptions or monthly services. ${denial}`}
          action={canWrite ? '+ New recurring invoice' : undefined}
          onAction={canWrite ? openForm : undefined}
        />
      ) : (
        <div className="gn-list">
          {items.map(r => (
            <div key={r.id} className="gn-row">
              <div className="gn-row__head">
                <span>
                  <Badge text={r.frequency} color="var(--st-in-progress)" />
                  {r.contact_name && <span className="gn-row__ref">{r.contact_name}</span>}
                </span>
                <span className="gn-row__r">
                  <span className="gn-row__v">{inr(Number(r.subtotal || 0))}</span>
                  <Badge text={r.is_active ? 'Active' : 'Inactive'} color={r.is_active ? 'var(--ok)' : 'var(--on-surface-3)'} />
                </span>
              </div>
              <div className="gn-row__meta">
                <span>
                  Next {r.next_date}
                  {r.end_date && ` · ends ${r.end_date}`}
                  {/* This rendered the literal ' · auto-send', producing a row
                      that reads "Next 2026-07-23 · auto-send" — which states
                      that the invoice mails itself on that date. It does not. */}
                  {r.auto_send && ' · flagged to send'}
                </span>
                {r.is_active && (
                  <span className="gn-row__acts">
                    <button type="button" className="btn btn--out btn--sm"
                      disabled={busyId === r.id || !canWrite} title={denial || undefined}
                      onClick={() => generateNow(r)}>
                      {busyId === r.id ? 'Working…' : 'Generate now'}
                    </button>
                    <button
                      type="button" className="btn btn--ghost btn--sm"
                      disabled={busyId === r.id || !canWrite} title={denial || undefined}
                      onClick={() => setConfirm({
                        title: 'Deactivate this schedule?',
                        message: 'No further invoices are raised from it. Invoices already generated are untouched.',
                        confirmLabel: 'Deactivate',
                        onConfirm: () => deactivate(r),
                      })}
                    >
                      Deactivate
                    </button>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
