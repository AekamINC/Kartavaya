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

const TABS = ['contacts', 'deals', 'pipeline', 'activities'];

export default function GrahaPage() {
  const { pushToast } = useToast();
  const [tab, setTab] = useState('contacts');

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px 48px' }}>
      <PageHeader title="Graha · ग्राह" subtitle="CRM — Contacts, Deals & Pipeline" />

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--rule-soft)' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--k-primary)' : 'var(--ink-3)',
              borderBottom: tab === t ? '2px solid var(--k-primary)' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer', textTransform: 'capitalize' }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'contacts' && <ContactsTab />}
      {tab === 'deals' && <DealsTab />}
      {tab === 'pipeline' && <PipelineTab />}
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
            <Badge text={c.contact_type} color={TYPE_COLORS[c.contact_type] || '#6E7B91'} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
            <div><strong>Email:</strong> {c.email || '—'}</div>
            <div><strong>Phone:</strong> {c.phone || '—'}</div>
            <div><strong>GSTIN:</strong> {c.gstin || '—'}</div>
            <div><strong>PAN:</strong> {c.pan || '—'}</div>
            <div><strong>Source:</strong> {c.source || '—'}</div>
          </div>
          {c.notes && <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 12 }}>{c.notes}</p>}
        </div>

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
              {['Name', 'Company', 'Email', 'Phone', 'Type', ''].map(h => (
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
