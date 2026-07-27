import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { Badge, CONTACT_TYPES, TYPE_COLORS, stageColor, SOURCE_COLORS } from './_shared';
import { mixAlpha } from '../../lib/statusColors';
import ContactTimeline from './ContactTimeline';
import { inr } from '../../lib/inr';

export default function ContactsTab() {
  const { pushToast } = useToast();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', designation: '', contact_type: 'lead', gstin: '', source: '', client_id: '' });
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [clientOptions, setClientOptions] = useState([]);
  const [editContact, setEditContact] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  // A failed load left `contacts` at [] and rendered the "No contacts yet"
  // EmptyState — which invites the user to add one, on a list that may be full.
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/v1/graha/clients').then(r => setClientOptions(r.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => { load(); }, []);

  async function load() {
    setErr(null);
    try {
      let url = '/v1/graha/contacts?';
      if (search) url += `search=${encodeURIComponent(search)}&`;
      if (typeFilter) url += `contact_type=${typeFilter}&`;
      const r = await api.get(url);
      setContacts(r.data.data || []);
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load contacts', type: 'error' });
    }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/contacts', form);
      pushToast({ title: 'Contact created', type: 'success' });
      setShowForm(false);
      setForm({ name: '', email: '', phone: '', company: '', designation: '', contact_type: 'lead', gstin: '', source: '', client_id: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  function startEditContact(c) {
    setEditContact({
      id: c.id, name: c.name || '', email: c.email || '', phone: c.phone || '', mobile: c.mobile || '',
      company: c.company || '', designation: c.designation || '', contact_type: c.contact_type || 'lead',
      notes: c.notes || '', source: c.source || '', lead_score: c.lead_score ?? '', website: c.website || '',
      gstin: c.gstin || '', pan: c.pan || '',
    });
  }

  async function saveEditContact() {
    if (!editContact) return;
    setEditSaving(true);
    try {
      const { id, ...fields } = editContact;
      await api.patch(`/v1/graha/contacts/${id}`, fields);
      pushToast({ title: 'Contact updated', type: 'success' });
      setEditContact(null);
      loadDetail(id);
      load();
    } catch { pushToast({ title: 'Could not update contact', type: 'error' }); }
    finally { setEditSaving(false); }
  }

  async function loadDetail(id) {
    try {
      const r = await api.get(`/v1/graha/contacts/${id}`);
      setDetail(r.data);
    } catch { pushToast({ title: 'Failed to load contact', type: 'error' }); }
  }

  async function deleteContact(id) {
    if (!window.confirm('Delete this contact? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/contacts/${id}`);
      setContacts(prev => prev.filter(c => c.id !== id));
      if (detail?.contact?.id === id) setDetail(null);
      pushToast({ title: 'Contact deleted', type: 'success' });
    } catch { pushToast({ title: 'Could not delete contact', type: 'error' }); }
  }

  async function convertLead(id) {
    try {
      await api.post(`/v1/graha/contacts/${id}/convert`);
      pushToast({ title: 'Lead converted to customer', type: 'success' });
      loadDetail(id);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Conversion failed', type: 'error' }); }
  }

  async function removeLabel(contactId, labelId) {
    try {
      await api.delete(`/v1/graha/contacts/${contactId}/labels/${labelId}`);
      pushToast({ title: 'Label removed', type: 'success' });
      loadDetail(contactId);
    } catch { pushToast({ title: 'Failed to remove label', type: 'error' }); }
  }

  if (detail) {
    const c = detail.contact;
    return (
      <div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => { setDetail(null); setEditContact(null); }}>← Back to list</button>

        {editContact ? (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Edit Contact</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
                <input className="k-input" value={editContact.name} onChange={e => setEditContact({ ...editContact, name: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Type</span>
                <select className="k-input" value={editContact.contact_type} onChange={e => setEditContact({ ...editContact, contact_type: e.target.value })}>
                  {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Email</span>
                <input className="k-input" type="email" value={editContact.email} onChange={e => setEditContact({ ...editContact, email: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Phone</span>
                <input className="k-input" type="tel" value={editContact.phone} onChange={e => setEditContact({ ...editContact, phone: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Mobile</span>
                <input className="k-input" type="tel" value={editContact.mobile} onChange={e => setEditContact({ ...editContact, mobile: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Company</span>
                <input className="k-input" value={editContact.company} onChange={e => setEditContact({ ...editContact, company: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Designation</span>
                <input className="k-input" value={editContact.designation} onChange={e => setEditContact({ ...editContact, designation: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Source</span>
                <input className="k-input" value={editContact.source} onChange={e => setEditContact({ ...editContact, source: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Lead Score</span>
                <input className="k-input" type="number" min="0" max="100" value={editContact.lead_score} onChange={e => setEditContact({ ...editContact, lead_score: parseInt(e.target.value) || 0 })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Website</span>
                <input className="k-input" value={editContact.website} onChange={e => setEditContact({ ...editContact, website: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>GSTIN</span>
                <input className="k-input" value={editContact.gstin} onChange={e => setEditContact({ ...editContact, gstin: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>PAN</span>
                <input className="k-input" value={editContact.pan} onChange={e => setEditContact({ ...editContact, pan: e.target.value })} /></label>
            </div>
            <label style={{ fontSize: 13, display: 'block', marginTop: 12 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
              <textarea className="k-input" rows={3} style={{ resize: 'vertical' }} value={editContact.notes} onChange={e => setEditContact({ ...editContact, notes: e.target.value })} /></label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditContact(null)}>Cancel</button>
              <button type="button" className="k-btn k-btn--primary" disabled={editSaving} onClick={saveEditContact}>{editSaving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        ) : (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{c.name}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>{c.company} {c.designation && `· ${c.designation}`}</p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={() => startEditContact(c)}>Edit</button>
              {c.contact_type === 'lead' && (
                <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => convertLead(c.id)}>Convert to Customer</button>
              )}
              <Badge text={c.contact_type} color={TYPE_COLORS[c.contact_type] || 'var(--on-surface-3)'} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
            <div><strong>Email:</strong> {c.email || '—'}</div>
            <div><strong>Phone:</strong> {c.phone || '—'}</div>
            <div><strong>GSTIN:</strong> {c.gstin || '—'}</div>
            <div><strong>PAN:</strong> {c.pan || '—'}</div>
            <div><strong>Source:</strong> {c.source || '—'}</div>
            <div><strong>Lead Score:</strong> {c.lead_score ?? '—'}/100</div>
            <div><strong>Assigned To:</strong> {c.assigned_to ? c.assigned_to.substring(0, 8) + '...' : '—'}</div>
            <div><strong>Last Contacted:</strong> {c.last_contacted_at ? new Date(c.last_contacted_at).toLocaleDateString('en-IN') : '—'}</div>
            <div><strong>Converted:</strong> {c.converted_at ? new Date(c.converted_at).toLocaleDateString('en-IN') : '—'}</div>
          </div>
          {c.lead_score_reasons?.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
              <strong>Score reasons:</strong> {(typeof c.lead_score_reasons === 'string' ? JSON.parse(c.lead_score_reasons) : c.lead_score_reasons).join(', ')}
            </div>
          )}
          {c.notes && <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 12 }}>{c.notes}</p>}
        </div>
        )}

        {detail.labels?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Labels</h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {detail.labels.map(l => (
                // A label colour is user data and may be any hex, so this tint
                // is computed with color-mix rather than a hex-alpha suffix — the
                // suffix broke the moment the fallback became a token reference.
                <span key={l.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 12px',
                  borderRadius: 'var(--r-pill)', background: mixAlpha(l.color || 'var(--on-surface-3)', 9), color: l.color || 'var(--on-surface-3)', fontWeight: 600 }}>
                  {l.name}
                  <button onClick={() => removeLabel(c.id, l.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {detail.deals?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Deals ({detail.deals.length})</h4>
            {detail.deals.map(d => (
              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13 }}>
                <span>{d.title}</span>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>{inr(Number(d.value))}</span>
                  <Badge text={d.stage} color={stageColor(d.stage)} />
                </div>
              </div>
            ))}
          </div>
        )}

        {detail.follow_ups?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Follow-ups ({detail.follow_ups.length})</h4>
            {detail.follow_ups.map(f => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13, alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 600, textDecoration: f.is_completed ? 'line-through' : 'none' }}>{f.title}</span>
                  {f.description && <span style={{ marginLeft: 8, color: 'var(--ink-3)' }}>{f.description}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{new Date(f.due_at).toLocaleDateString('en-IN')}</span>
                  <Badge text={f.is_completed ? 'Done' : 'Pending'} color={f.is_completed ? 'var(--ok)' : 'var(--warn)'} />
                </div>
              </div>
            ))}
          </div>
        )}

        {detail.activities?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Activities</h4>
            {detail.activities.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13, alignItems: 'center' }}>
                <Badge text={a.activity_type} color="var(--on-surface-3)" />
                <span>{a.title}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>{new Date(a.created_at).toLocaleDateString('en-IN')}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24 }}>
          <ContactTimeline contactId={c.id} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input className="k-input" style={{ flex: 1 }} placeholder="Search contacts…" value={search}
          onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
        <select className="k-input" style={{ width: 130 }} value={typeFilter} onChange={e => { setTypeFilter(e.target.value); }}>
          <option value="">All Types</option>
          {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ Add Contact</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Contact</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Type</span>
              <select className="k-input" value={form.contact_type} onChange={e => setForm({ ...form, contact_type: e.target.value })}>
                {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Email</span>
              <input className="k-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Phone / Mobile</span>
              <input className="k-input" type="tel" placeholder="+91 98765 43210" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Company</span>
              <input className="k-input" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Designation</span>
              <input className="k-input" value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>GSTIN</span>
              <input className="k-input" value={form.gstin} onChange={e => setForm({ ...form, gstin: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Source</span>
              <input className="k-input" placeholder="e.g. Website, Referral" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Client / Company</span>
              <select className="k-input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                <option value="">— None —</option>
                {clientOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Create Contact'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <SkeletonRegion label="Loading contacts"><SkeletonList rows={6} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) :
        contacts.length === 0 ? (
          <EmptyState
            illustration="contacts"
            title={{ en: 'No contacts yet', hi: 'कोई संपर्क नहीं' }}
            description="Add leads, customers, vendors, or partners to start building relationships here."
            action="Add Contact"
            onAction={() => setShowForm(true)}
          />
        ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Name', 'Company', 'Email', 'Phone', 'Type', 'Source', 'Score', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {contacts.map(c => (
              <tr key={c.id} style={{ borderBottom: '1px solid var(--rule-soft)', cursor: 'pointer' }} onClick={() => loadDetail(c.id)}>
                <td style={{ padding: '10px', fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{c.company || '—'}</td>
                <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{c.email || '—'}</td>
                <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{c.phone || '—'}</td>
                <td style={{ padding: '10px' }}><Badge text={c.contact_type} color={TYPE_COLORS[c.contact_type] || 'var(--on-surface-3)'} /></td>
                <td style={{ padding: '10px' }}>{c.source ? <Badge text={c.source} color={SOURCE_COLORS[c.source] || 'var(--on-surface-3)'} /> : '—'}</td>
                <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{c.lead_score ?? '—'}</td>
                <td style={{ padding: '10px' }}>
                  <button onClick={e => { e.stopPropagation(); deleteContact(c.id); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 11 }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
