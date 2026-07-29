// Ganit · timesheet billing — turn logged hours into an invoice.
//
// The contact was a free-text UUID box ("Contact ID"), which asked the user to
// paste a database key. It is a picker now, loaded from the same contacts
// endpoint the invoice form uses.
import React, { useEffect, useState } from 'react';
import { api, rows, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';

export default function TimesheetTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'invoice time' });
  const { pushToast } = useToast();
  const [form, setForm] = useState({ date_from: '', date_to: '', contact_id: '', is_igst: false });
  const [contacts, setContacts] = useState([]);
  const [contactsFailed, setContactsFailed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get('/v1/graha/contacts')
      .then(r => setContacts(rows(r)))
      .catch(() => setContactsFailed(true));
  }, []);

  async function generate(e) {
    e.preventDefault();
    if (!form.date_from || !form.date_to) {
      pushToast({ title: 'Select a date range', type: 'error' });
      return;
    }
    if (form.date_to < form.date_from) {
      pushToast({ title: 'The end date falls before the start date', type: 'error' });
      return;
    }
    setGenerating(true);
    setResult(null);
    try {
      const payload = {
        employee_ids: [],
        date_from: form.date_from,
        date_to: form.date_to,
        is_igst: form.is_igst,
      };
      if (form.contact_id) payload.contact_id = form.contact_id;
      const r = await api.post('/v1/ganit/invoices/from-time-entries', payload);
      const data = body(r);
      setResult(data);
      pushToast({ title: `Invoice ${data.invoice_number} created`, type: 'success' });
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Could not generate the invoice', type: 'error' });
    } finally { setGenerating(false); }
  }

  return (
    <div>
      <form className="gn-form" onSubmit={generate}>
        <h3 className="gn-form__t">Invoice from timesheets</h3>

        <div className="gn-form__grid gn-form__grid--flush">
          <label className="fld">
            <span className="fld__l">From date<span className="fld__req">*</span></span>
            <input className="inp" type="date" required value={form.date_from}
              onChange={e => setForm({ ...form, date_from: e.target.value })} />
          </label>
          <label className="fld">
            <span className="fld__l">To date<span className="fld__req">*</span></span>
            <input className="inp" type="date" required value={form.date_to}
              onChange={e => setForm({ ...form, date_to: e.target.value })} />
          </label>
          <label className="fld">
            <span className="fld__l">Customer</span>
            <select className="inp" value={form.contact_id}
              onChange={e => setForm({ ...form, contact_id: e.target.value })}>
              <option value="">Unassigned</option>
              {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>)}
            </select>
            {contactsFailed && (
              <span className="fld__hint">Customers could not be loaded — the invoice can still be generated unassigned.</span>
            )}
          </label>
          <label className="gn-chk">
            <input type="checkbox" checked={form.is_igst}
              onChange={e => setForm({ ...form, is_igst: e.target.checked })} />
            <span>Inter-state (IGST)</span>
          </label>
        </div>

        <div className="gn-form__acts">
          <button type="submit" className="btn btn--fill btn--sm" disabled={generating || !canWrite} title={denial || undefined}>
            {generating ? 'Generating…' : 'Generate invoice'}
          </button>
        </div>
      </form>

      {result && (
        <div className="gn-panel gn-panel--ok">
          <h4 className="gn-panel__h gn-panel__h--ok">Invoice created</h4>
          <div className="gn-facts">
            <div>Invoice <span className="gn-facts__v">{result.invoice_number}</span></div>
            <div>Total <span className="gn-facts__v">{inr(Number(result.total || 0))}</span></div>
            <div>Entries billed <span className="gn-facts__v">{result.entries_billed}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
