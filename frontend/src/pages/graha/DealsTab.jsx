import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { RotBadge, Badge, stageColor } from './_shared';
import { inr } from '../../lib/inr';

export default function DealsTab() {
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [stageFilter, setStageFilter] = useState('');
  const [contacts, setContacts] = useState([]);
  const [dealClients, setDealClients] = useState([]);
  const [form, setForm] = useState({ title: '', contact_id: '', client_id: '', value: '', stage: 'New', probability: 20, expected_close_date: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [editDeal, setEditDeal] = useState(null);
  const [editDealSaving, setEditDealSaving] = useState(false);
  const [noteDeal, setNoteDeal] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      let url = '/v1/graha/deals?';
      if (stageFilter) url += `stage=${stageFilter}&`;
      const r = await api.get(url);
      setDeals(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load deals', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadFormData() {
    try {
      const [cr, clr] = await Promise.all([api.get('/v1/graha/contacts'), api.get('/v1/graha/clients')]);
      setContacts(cr.data.data || []);
      setDealClients(clr.data.data || []);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/deals', { ...form, value: parseFloat(form.value) || 0 });
      pushToast({ title: 'Deal created', type: 'success' });
      setShowForm(false);
      setForm({ title: '', contact_id: '', client_id: '', value: '', stage: 'New', probability: 20, expected_close_date: '', notes: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function deleteDeal(dealId, title) {
    if (!window.confirm(`Delete deal "${title}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/v1/graha/deals/${dealId}`);
      pushToast({ title: 'Deal deleted', type: 'success' });
      load();
    } catch { pushToast({ title: 'Could not delete deal', type: 'error' }); }
  }

  async function updateStage(dealId, stage) {
    try {
      await api.patch(`/v1/graha/deals/${dealId}`, { stage });
      pushToast({ title: `Deal moved to ${stage}`, type: 'success' });
      load();
    } catch { pushToast({ title: 'Could not update deal stage', type: 'error' }); }
  }

  async function createInvoice(dealId) {
    try {
      const r = await api.post(`/v1/ganit/invoices/from-deal/${dealId}`);
      if (r.data.status === 'exists') {
        pushToast({ title: 'Invoice already exists for this deal', type: 'info' });
      } else {
        pushToast({ title: `Draft invoice ${r.data.invoice_number} created`, type: 'success' });
      }
      navigate(`/ganit`);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed to create invoice', type: 'error' }); }
  }

  function startEditDeal(d) {
    setEditDeal({
      id: d.id, title: d.title || '', value: d.value || '', stage: d.stage || 'New',
      probability: d.probability ?? 20, expected_close_date: d.expected_close_date || '',
      notes: d.notes || '',
    });
  }

  async function saveEditDeal() {
    if (!editDeal) return;
    setEditDealSaving(true);
    try {
      const { id, ...fields } = editDeal;
      const payload = { ...fields, value: parseFloat(fields.value) || 0 };
      if (!payload.expected_close_date) delete payload.expected_close_date;
      if (!payload.notes) delete payload.notes;
      await api.patch(`/v1/graha/deals/${id}`, payload);
      pushToast({ title: 'Deal updated', type: 'success' });
      setEditDeal(null);
      load();
    } catch { pushToast({ title: 'Could not update deal', type: 'error' }); }
    finally { setEditDealSaving(false); }
  }

  async function saveNote(dealId) {
    setNoteSaving(true);
    try {
      await api.patch(`/v1/graha/deals/${dealId}`, { notes: noteText });
      pushToast({ title: 'Notes updated', type: 'success' });
      setNoteDeal(null);
      load();
    } catch { pushToast({ title: 'Could not update notes', type: 'error' }); }
    finally { setNoteSaving(false); }
  }

  const stages = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select className="k-input" style={{ width: 150 }} value={stageFilter} onChange={e => { setStageFilter(e.target.value); }}>
          <option value="">All Stages</option>
          {stages.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => { setShowForm(true); loadFormData(); }}>+ New Deal</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Deal</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Client / Company</span>
              <select className="k-input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                <option value="">— None —</option>
                {dealClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact</span>
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name} {c.company && `(${c.company})`}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Value (₹)</span>
              <input className="k-input" type="number" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Stage</span>
              <select className="k-input" value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })}>
                {stages.map(s => <option key={s} value={s}>{s}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Probability (%)</span>
              <input className="k-input" type="number" min="0" max="100" value={form.probability} onChange={e => setForm({ ...form, probability: parseInt(e.target.value) || 0 })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Expected Close</span>
              <input className="k-input" type="date" value={form.expected_close_date} onChange={e => setForm({ ...form, expected_close_date: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create Deal'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        deals.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>💼</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No deals yet</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Track your sales pipeline here. Click "+ New Deal" above to add your first opportunity.</div>
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {deals.map(d => (
            <div key={d.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: '12px 16px' }}>
              {editDeal?.id === d.id ? (
                <div>
                  <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Edit Deal</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
                      <input className="k-input" value={editDeal.title} onChange={e => setEditDeal({ ...editDeal, title: e.target.value })} /></label>
                    <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Value (₹)</span>
                      <input className="k-input" type="number" value={editDeal.value} onChange={e => setEditDeal({ ...editDeal, value: e.target.value })} /></label>
                    <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Stage</span>
                      <select className="k-input" value={editDeal.stage} onChange={e => setEditDeal({ ...editDeal, stage: e.target.value })}>
                        {stages.map(s => <option key={s} value={s}>{s}</option>)}
                      </select></label>
                    <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Probability (%)</span>
                      <input className="k-input" type="number" min="0" max="100" value={editDeal.probability} onChange={e => setEditDeal({ ...editDeal, probability: parseInt(e.target.value) || 0 })} /></label>
                    <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Expected Close</span>
                      <input className="k-input" type="date" value={editDeal.expected_close_date} onChange={e => setEditDeal({ ...editDeal, expected_close_date: e.target.value })} /></label>
                  </div>
                  <label style={{ fontSize: 13, display: 'block', marginTop: 12 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
                    <textarea className="k-input" rows={3} style={{ resize: 'vertical' }} value={editDeal.notes} onChange={e => setEditDeal({ ...editDeal, notes: e.target.value })} /></label>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                    <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditDeal(null)}>Cancel</button>
                    <button type="button" className="k-btn k-btn--primary" disabled={editDealSaving} onClick={saveEditDeal}>{editDealSaving ? 'Saving...' : 'Save'}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--rule-soft)' }}
                        onClick={() => startEditDeal(d)}>{d.title}</span>
                      {d.client_name && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--k-primary)', fontWeight: 600 }}>{d.client_name}</span>}
                      {d.contact_name && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--ink-3)' }}>{d.contact_name} {d.contact_company && `· ${d.contact_company}`}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{inr(Number(d.value))}</span>
                      <Badge text={d.stage} color={stageColor(d.stage)} />
                      {d.stage !== 'Won' && d.stage !== 'Lost' && <RotBadge updatedAt={d.updated_at} />}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--ink-3)', alignItems: 'center' }}>
                    <span>Probability: {d.probability}%</span>
                    {d.expected_close_date && <span>Close: {d.expected_close_date}</span>}
                    <div style={{ flex: 1 }} />
                    <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => startEditDeal(d)}>Edit</button>
                    <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => { setNoteDeal(d.id); setNoteText(d.notes || ''); }}>Notes</button>
                    <button className="k-btn k-btn--reject" style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => deleteDeal(d.id, d.title)}>Delete</button>
                    {d.stage === 'Won' && (
                      <button className="k-btn k-btn--primary" style={{ fontSize: 11, padding: '2px 10px' }}
                        onClick={() => createInvoice(d.id)}>Create Invoice</button>
                    )}
                    {stages.filter(s => s !== d.stage && s !== 'Lost').map(s => (
                      <button key={s} className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }}
                        onClick={() => updateStage(d.id, s)}>{s}</button>
                    ))}
                  </div>
                  {/* Inline notes section */}
                  {noteDeal === d.id && (
                    <div style={{ marginTop: 10, padding: '10px 0', borderTop: '1px solid var(--rule-soft)' }}>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
                        <textarea className="k-input" rows={3} style={{ resize: 'vertical' }} value={noteText} onChange={e => setNoteText(e.target.value)} /></label>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                        <button type="button" className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={() => setNoteDeal(null)}>Cancel</button>
                        <button type="button" className="k-btn k-btn--primary" style={{ fontSize: 12 }} disabled={noteSaving} onClick={() => saveNote(d.id)}>{noteSaving ? 'Saving...' : 'Save Notes'}</button>
                      </div>
                    </div>
                  )}
                  {noteDeal !== d.id && d.notes && (
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)', borderTop: '1px solid var(--rule-soft)', paddingTop: 6 }}>
                      {d.notes}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
