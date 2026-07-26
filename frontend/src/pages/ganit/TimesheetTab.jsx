import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { inr } from '../../lib/inr';

export default function TimesheetTab() {
  const { pushToast } = useToast();
  const [form, setForm] = useState({ date_from: '', date_to: '', contact_id: '', is_igst: false });
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);

  const FMT = v => inr(Number(v || 0));

  async function generate(e) {
    e.preventDefault();
    if (!form.date_from || !form.date_to) { pushToast({ title: 'Select date range', type: 'error' }); return; }
    setGenerating(true);
    setResult(null);
    try {
      const body = {
        employee_ids: [],
        date_from: form.date_from,
        date_to: form.date_to,
        is_igst: form.is_igst,
      };
      if (form.contact_id) body.contact_id = form.contact_id;
      const r = await api.post('/v1/ganit/invoices/from-time-entries', body);
      setResult(r.data);
      pushToast({ title: `Invoice ${r.data.invoice_number} created`, type: 'success' });
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Generation failed', type: 'error' }); }
    finally { setGenerating(false); }
  }

  return (
    <div>
      <form onSubmit={generate} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Generate Invoice from Timesheets</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>From Date *</span>
            <input className="k-input" type="date" required value={form.date_from} onChange={e => setForm({ ...form, date_from: e.target.value })} /></label>
          <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>To Date *</span>
            <input className="k-input" type="date" required value={form.date_to} onChange={e => setForm({ ...form, date_to: e.target.value })} /></label>
          <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact ID</span>
            <input className="k-input" placeholder="Optional" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })} /></label>
        </div>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <input type="checkbox" checked={form.is_igst} onChange={e => setForm({ ...form, is_igst: e.target.checked })} />
          <span style={{ fontWeight: 600 }}>Inter-state (IGST)</span></label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="submit" className="k-btn k-btn--primary" disabled={generating}>{generating ? 'Generating…' : 'Generate Invoice'}</button>
        </div>
      </form>

      {result && (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--ok)', borderRadius: 'var(--r-md)', padding: 24 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: 'var(--ok)' }}>Invoice Created</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
            <div><strong>Invoice #:</strong> <span style={{ fontFamily: 'var(--font-mono)' }}>{result.invoice_number}</span></div>
            <div><strong>Total:</strong> <span style={{ fontWeight: 700 }}>{FMT(result.total)}</span></div>
            <div><strong>Entries Billed:</strong> {result.entries_billed}</div>
          </div>
        </div>
      )}
    </div>
  );
}
