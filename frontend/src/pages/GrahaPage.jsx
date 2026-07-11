import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';

const CONTACT_TYPES = ['lead', 'customer', 'vendor', 'partner'];
const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note', 'task'];
const TYPE_COLORS = { lead: '#f59e0b', customer: '#10b981', vendor: '#6366f1', partner: '#0082c6' };
const STAGE_COLORS = { New: '#6E7B91', Qualified: '#f59e0b', Proposal: '#0082c6', Negotiation: '#8b5cf6', Won: '#10b981', Lost: '#ef4444' };

function Badge({ text, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${color}18`, color }}>{text}</span>
  );
}

const TABS = ['contacts', 'deals', 'kanban', 'pipeline', 'follow-ups', 'labels', 'activities'];

export default function GrahaPage() {
  const [tab, setTab] = useState('contacts');

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px 48px' }}>
      <PageHeader title="Graha · ग्राह" subtitle="CRM — Contacts, Deals & Pipeline" />

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--rule-soft)', overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--k-primary)' : 'var(--ink-3)',
              borderBottom: tab === t ? '2px solid var(--k-primary)' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'contacts' && <ContactsTab />}
      {tab === 'deals' && <DealsTab />}
      {tab === 'kanban' && <KanbanTab />}
      {tab === 'pipeline' && <PipelineTab />}
      {tab === 'follow-ups' && <FollowUpsTab />}
      {tab === 'labels' && <LabelsTab />}
      {tab === 'activities' && <ActivitiesTab />}
    </div>
  );
}


function ContactsTab() {
  const { pushToast } = useToast();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', designation: '', contact_type: 'lead', gstin: '', source: '' });
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      let url = '/v1/graha/contacts?';
      if (search) url += `search=${encodeURIComponent(search)}&`;
      if (typeFilter) url += `contact_type=${typeFilter}&`;
      const r = await api.get(url);
      setContacts(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load contacts', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/contacts', form);
      pushToast({ title: 'Contact created', type: 'success' });
      setShowForm(false);
      setForm({ name: '', email: '', phone: '', company: '', designation: '', contact_type: 'lead', gstin: '', source: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function loadDetail(id) {
    try {
      const r = await api.get(`/v1/graha/contacts/${id}`);
      setDetail(r.data);
    } catch { pushToast({ title: 'Failed to load contact', type: 'error' }); }
  }

  async function deleteContact(id) {
    try {
      await api.delete(`/v1/graha/contacts/${id}`);
      setContacts(prev => prev.filter(c => c.id !== id));
      if (detail?.contact?.id === id) setDetail(null);
      pushToast({ title: 'Contact deleted', type: 'success' });
    } catch { pushToast({ title: 'Delete failed', type: 'error' }); }
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
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => setDetail(null)}>← Back to list</button>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{c.name}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>{c.company} {c.designation && `· ${c.designation}`}</p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {c.contact_type === 'lead' && (
                <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => convertLead(c.id)}>Convert to Customer</button>
              )}
              <Badge text={c.contact_type} color={TYPE_COLORS[c.contact_type] || '#6E7B91'} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
            <div><strong>Email:</strong> {c.email || '—'}</div>
            <div><strong>Phone:</strong> {c.phone || '—'}</div>
            <div><strong>GSTIN:</strong> {c.gstin || '—'}</div>
            <div><strong>PAN:</strong> {c.pan || '—'}</div>
            <div><strong>Source:</strong> {c.source || '—'}</div>
            <div><strong>Lead Score:</strong> {c.lead_score ?? '—'}</div>
          </div>
          {c.notes && <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 12 }}>{c.notes}</p>}
        </div>

        {detail.labels?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Labels</h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {detail.labels.map(l => (
                <span key={l.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 12px',
                  borderRadius: 99, background: `${l.color || '#6366f1'}18`, color: l.color || '#6366f1', fontWeight: 600 }}>
                  {l.name}
                  <button onClick={() => removeLabel(c.id, l.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {detail.deals?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Deals ({detail.deals.length})</h4>
            {detail.deals.map(d => (
              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13 }}>
                <span>{d.title}</span>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>₹{Number(d.value).toLocaleString('en-IN')}</span>
                  <Badge text={d.stage} color={STAGE_COLORS[d.stage] || '#6E7B91'} />
                </div>
              </div>
            ))}
          </div>
        )}

        {detail.follow_ups?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Follow-ups ({detail.follow_ups.length})</h4>
            {detail.follow_ups.map(f => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13, alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 600, textDecoration: f.is_completed ? 'line-through' : 'none' }}>{f.title}</span>
                  {f.description && <span style={{ marginLeft: 8, color: 'var(--ink-3)' }}>{f.description}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{new Date(f.due_at).toLocaleDateString('en-IN')}</span>
                  <Badge text={f.is_completed ? 'Done' : 'Pending'} color={f.is_completed ? '#10b981' : '#f59e0b'} />
                </div>
              </div>
            ))}
          </div>
        )}

        {detail.activities?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Activities</h4>
            {detail.activities.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13, alignItems: 'center' }}>
                <Badge text={a.activity_type} color="#6E7B91" />
                <span>{a.title}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>{new Date(a.created_at).toLocaleDateString('en-IN')}</span>
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
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
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
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Phone</span>
              <input className="k-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Company</span>
              <input className="k-input" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Designation</span>
              <input className="k-input" value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>GSTIN</span>
              <input className="k-input" value={form.gstin} onChange={e => setForm({ ...form, gstin: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Source</span>
              <input className="k-input" placeholder="e.g. Website, Referral" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Create Contact'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        contacts.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No contacts found.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Name', 'Company', 'Email', 'Phone', 'Type', 'Score', ''].map(h => (
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
                <td style={{ padding: '10px' }}><Badge text={c.contact_type} color={TYPE_COLORS[c.contact_type] || '#6E7B91'} /></td>
                <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{c.lead_score ?? '—'}</td>
                <td style={{ padding: '10px' }}>
                  <button onClick={e => { e.stopPropagation(); deleteContact(c.id); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11 }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}


function DealsTab() {
  const { pushToast } = useToast();
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [stageFilter, setStageFilter] = useState('');
  const [contacts, setContacts] = useState([]);
  const [form, setForm] = useState({ title: '', contact_id: '', value: '', stage: 'New', probability: 20, expected_close_date: '', notes: '' });
  const [saving, setSaving] = useState(false);

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
      await api.post('/v1/graha/deals', { ...form, value: parseFloat(form.value) || 0 });
      pushToast({ title: 'Deal created', type: 'success' });
      setShowForm(false);
      setForm({ title: '', contact_id: '', value: '', stage: 'New', probability: 20, expected_close_date: '', notes: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function updateStage(dealId, stage) {
    try {
      await api.patch(`/v1/graha/deals/${dealId}`, { stage });
      pushToast({ title: `Deal moved to ${stage}`, type: 'success' });
      load();
    } catch { pushToast({ title: 'Update failed', type: 'error' }); }
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
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => { setShowForm(true); loadContacts(); }}>+ New Deal</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Deal</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
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
        deals.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No deals found.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {deals.map(d => (
            <div key={d.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{d.title}</span>
                  {d.contact_name && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--ink-3)' }}>{d.contact_name} {d.contact_company && `· ${d.contact_company}`}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>₹{Number(d.value).toLocaleString('en-IN')}</span>
                  <Badge text={d.stage} color={STAGE_COLORS[d.stage] || '#6E7B91'} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--ink-3)', alignItems: 'center' }}>
                <span>Probability: {d.probability}%</span>
                {d.expected_close_date && <span>Close: {d.expected_close_date}</span>}
                <div style={{ flex: 1 }} />
                {stages.filter(s => s !== d.stage && s !== 'Lost').map(s => (
                  <button key={s} className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }}
                    onClick={() => updateStage(d.id, s)}>{s}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function KanbanTab() {
  const { pushToast } = useToast();
  const [kanban, setKanban] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/graha/deals/kanban');
      setKanban(r.data.stages || {});
    } catch { pushToast({ title: 'Failed to load kanban', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function moveStage(dealId, newStage) {
    try {
      await api.patch(`/v1/graha/deals/${dealId}`, { stage: newStage });
      pushToast({ title: `Moved to ${newStage}`, type: 'success' });
      load();
    } catch { pushToast({ title: 'Move failed', type: 'error' }); }
  }

  const stages = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p>;

  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
      {stages.map(stage => {
        const deals = kanban[stage] || [];
        const total = deals.reduce((s, d) => s + Number(d.value || 0), 0);
        return (
          <div key={stage} style={{ minWidth: 220, flex: '1 0 220px', background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Badge text={stage} color={STAGE_COLORS[stage] || '#6E7B91'} />
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{deals.length}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>₹{total.toLocaleString('en-IN')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {deals.map(d => (
                <div key={d.id} style={{ background: 'var(--bg)', border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{d.title}</div>
                  {d.contact_name && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>{d.contact_name}</div>}
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>₹{Number(d.value || 0).toLocaleString('en-IN')}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {stages.filter(s => s !== stage).map(s => (
                      <button key={s} onClick={() => moveStage(d.id, s)}
                        style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${STAGE_COLORS[s]}18`,
                          color: STAGE_COLORS[s], border: 'none', cursor: 'pointer', fontWeight: 600 }}>{s}</button>
                    ))}
                  </div>
                </div>
              ))}
              {deals.length === 0 && <p style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', padding: 12 }}>No deals</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}


function PipelineTab() {
  const { pushToast } = useToast();
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/graha/pipeline-summary');
      setSummary(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load pipeline', type: 'error' }); }
    finally { setLoading(false); }
  }

  const total = summary.reduce((s, r) => s + Number(r.total_value), 0);

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatTile label="Total Pipeline" value={`₹${total.toLocaleString('en-IN')}`} />
        <StatTile label="Active Deals" value={summary.reduce((s, r) => s + Number(r.count), 0)} />
      </div>

      {summary.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No deals yet. Create deals to see your pipeline.</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {summary.map(s => (
            <div key={s.stage} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <Badge text={s.stage} color={STAGE_COLORS[s.stage] || '#6E7B91'} />
              <div style={{ fontSize: 28, fontWeight: 800, margin: '12px 0 4px', color: 'var(--ink-1)' }}>{Number(s.count)}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>₹{Number(s.total_value).toLocaleString('en-IN')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function FollowUpsTab() {
  const { pushToast } = useToast();
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [deals, setDeals] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [form, setForm] = useState({ title: '', description: '', contact_id: '', deal_id: '', due_at: '', remind_at: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      let url = '/v1/graha/follow-ups?';
      if (statusFilter) url += `status=${statusFilter}&`;
      const r = await api.get(url);
      setFollowUps(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load follow-ups', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadOptions() {
    try {
      const [c, d] = await Promise.all([api.get('/v1/graha/contacts'), api.get('/v1/graha/deals')]);
      setContacts(c.data.data || []);
      setDeals(d.data.data || []);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/follow-ups', form);
      pushToast({ title: 'Follow-up created', type: 'success' });
      setShowForm(false);
      setForm({ title: '', description: '', contact_id: '', deal_id: '', due_at: '', remind_at: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function complete(id) {
    try {
      await api.patch(`/v1/graha/follow-ups/${id}/complete`);
      pushToast({ title: 'Marked complete', type: 'success' });
      load();
    } catch { pushToast({ title: 'Failed', type: 'error' }); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/graha/follow-ups/${id}`);
      pushToast({ title: 'Follow-up deleted', type: 'success' });
      setFollowUps(prev => prev.filter(f => f.id !== id));
    } catch { pushToast({ title: 'Delete failed', type: 'error' }); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select className="k-input" style={{ width: 130 }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); }}>
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
        </select>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => { setShowForm(true); loadOptions(); }}>+ New Follow-up</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Follow-up</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Due Date *</span>
              <input className="k-input" type="datetime-local" required value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact</span>
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Deal</span>
              <select className="k-input" value={form.deal_id} onChange={e => setForm({ ...form, deal_id: e.target.value })}>
                <option value="">None</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Remind At</span>
              <input className="k-input" type="datetime-local" value={form.remind_at} onChange={e => setForm({ ...form, remind_at: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <input className="k-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        followUps.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No follow-ups found.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {followUps.map(f => {
            const overdue = !f.is_completed && new Date(f.due_at) < new Date();
            return (
              <div key={f.id} style={{ background: 'var(--surface-1)', border: `1px solid ${overdue ? '#ef444440' : 'var(--rule-soft)'}`, borderRadius: 10, padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, textDecoration: f.is_completed ? 'line-through' : 'none' }}>{f.title}</span>
                  <Badge text={f.is_completed ? 'Done' : overdue ? 'Overdue' : 'Pending'}
                    color={f.is_completed ? '#10b981' : overdue ? '#ef4444' : '#f59e0b'} />
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 6 }}>
                  {f.contact_name && <span>{f.contact_name} · </span>}
                  {f.deal_title && <span>{f.deal_title} · </span>}
                  <span>Due: {new Date(f.due_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  {f.description && <span> · {f.description}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {!f.is_completed && (
                    <button className="k-btn k-btn--primary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => complete(f.id)}>Complete</button>
                  )}
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '3px 10px', color: '#ef4444' }} onClick={() => remove(f.id)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


function LabelsTab() {
  const { pushToast } = useToast();
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', color: '#6366f1' });
  const [saving, setSaving] = useState(false);
  const [assignForm, setAssignForm] = useState({ contact_id: '', label_id: '' });
  const [showAssign, setShowAssign] = useState(false);
  const [contacts, setContacts] = useState([]);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/graha/labels');
      setLabels(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load labels', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/labels', form);
      pushToast({ title: 'Label created', type: 'success' });
      setShowForm(false);
      setForm({ name: '', color: '#6366f1' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/graha/labels/${id}`);
      pushToast({ title: 'Label deleted', type: 'success' });
      setLabels(prev => prev.filter(l => l.id !== id));
    } catch { pushToast({ title: 'Delete failed', type: 'error' }); }
  }

  async function loadContacts() {
    try {
      const r = await api.get('/v1/graha/contacts');
      setContacts(r.data.data || []);
    } catch {}
  }

  async function assignLabel(e) {
    e.preventDefault();
    try {
      await api.post(`/v1/graha/contacts/${assignForm.contact_id}/labels/${assignForm.label_id}`);
      pushToast({ title: 'Label assigned', type: 'success' });
      setShowAssign(false);
      setAssignForm({ contact_id: '', label_id: '' });
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ New Label</button>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 13 }} onClick={() => { setShowAssign(true); loadContacts(); }}>Assign to Contact</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Label</h3>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ fontSize: 13, flex: 1 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Color</span>
              <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })}
                style={{ width: 48, height: 36, border: '1px solid var(--rule-soft)', borderRadius: 6, cursor: 'pointer' }} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {showAssign && (
        <form onSubmit={assignLabel} style={{ background: 'var(--surface-1)', border: '1px solid var(--k-primary)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Assign Label to Contact</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact *</span>
              <select className="k-input" required value={assignForm.contact_id} onChange={e => setAssignForm({ ...assignForm, contact_id: e.target.value })}>
                <option value="">Select…</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Label *</span>
              <select className="k-input" required value={assignForm.label_id} onChange={e => setAssignForm({ ...assignForm, label_id: e.target.value })}>
                <option value="">Select…</option>
                {labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowAssign(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Assign</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        labels.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No labels yet.</p> : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {labels.map(l => (
            <div key={l.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 16, height: 16, borderRadius: 4, background: l.color || '#6366f1' }} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>{l.name}</span>
              <button onClick={() => remove(l.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11, marginLeft: 8 }}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function ActivitiesTab() {
  const { pushToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ activity_type: 'note', title: '', description: '', deal_id: '', contact_id: '' });
  const [saving, setSaving] = useState(false);
  const [deals, setDeals] = useState([]);
  const [contacts, setContacts] = useState([]);

  async function loadOptions() {
    try {
      const [d, c] = await Promise.all([
        api.get('/v1/graha/deals'), api.get('/v1/graha/contacts'),
      ]);
      setDeals(d.data.data || []);
      setContacts(c.data.data || []);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/graha/activities', form);
      pushToast({ title: 'Activity logged', type: 'success' });
      setShowForm(false);
      setForm({ activity_type: 'note', title: '', description: '', deal_id: '', contact_id: '' });
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <button className="k-btn k-btn--primary" style={{ fontSize: 13, marginBottom: 16 }} onClick={() => { setShowForm(true); loadOptions(); }}>
        + Log Activity
      </button>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Log Activity</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Type</span>
              <select className="k-input" value={form.activity_type} onChange={e => setForm({ ...form, activity_type: e.target.value })}>
                {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Deal</span>
              <select className="k-input" value={form.deal_id} onChange={e => setForm({ ...form, deal_id: e.target.value })}>
                <option value="">None</option>
                {deals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact</span>
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <textarea className="k-input" rows={3} value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })} style={{ resize: 'vertical' }} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Log Activity'}</button>
          </div>
        </form>
      )}

      {!showForm && (
        <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>
          Activities are logged against contacts and deals. Open a contact or deal to see its full activity history.
        </p>
      )}
    </div>
  );
}
