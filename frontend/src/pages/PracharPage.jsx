import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';

const TABS = ['dashboard', 'campaigns', 'templates', 'automations', 'unsubscribes'];

export default function PracharPage() {
  const [tab, setTab] = useState('dashboard');
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px 48px' }}>
      <PageHeader title="Prachar · प्रचार" subtitle="Marketing — Campaigns, Templates & Automations" />
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
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'campaigns' && <CampaignsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'automations' && <AutomationsTab />}
      {tab === 'unsubscribes' && <UnsubscribesTab />}
    </div>
  );
}

// ── Dashboard ───────────────────────────────────────────────

function DashboardTab() {
  const [data, setData] = useState(null);
  const toast = useToast();
  useEffect(() => { api.get('/api/v1/prachar/dashboard').then(setData).catch(e => toast.error(e.message)); }, []);
  if (!data) return <p style={{ color: 'var(--ink-3)' }}>Loading...</p>;
  const { campaigns, delivery } = data;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatTile label="Total Campaigns" value={campaigns.total || 0} />
        <StatTile label="Sent" value={campaigns.sent || 0} />
        <StatTile label="Drafts" value={campaigns.drafts || 0} />
        <StatTile label="Scheduled" value={campaigns.scheduled || 0} />
        <StatTile label="Templates" value={data.templates_count} />
        <StatTile label="Automations" value={data.automations_count} />
        <StatTile label="Unsubscribes" value={data.unsubscribes_count} />
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Delivery Stats (Sent Campaigns)</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatTile label="Total Sent" value={delivery.total_sent || 0} />
        <StatTile label="Opened" value={delivery.total_opened || 0} />
        <StatTile label="Clicked" value={delivery.total_clicked || 0} />
        <StatTile label="Bounced" value={delivery.total_bounced || 0} />
      </div>
      {data.recent_campaigns.length > 0 && <>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Recent Campaigns</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              <th style={TH}>Name</th><th style={TH}>Status</th><th style={TH}>Recipients</th><th style={TH}>Opened</th><th style={TH}>Clicked</th>
            </tr></thead>
            <tbody>
              {data.recent_campaigns.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={TD}>{c.name}</td>
                  <td style={TD}><Badge text={c.status} /></td>
                  <td style={TD}>{c.total_recipients || 0}</td>
                  <td style={TD}>{c.total_opened || 0}</td>
                  <td style={TD}>{c.total_clicked || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  );
}

// ── Campaigns ───────────────────────────────────────────────

function CampaignsTab() {
  const [campaigns, setCampaigns] = useState([]);
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);
  const toast = useToast();

  const load = () => api.get('/api/v1/prachar/campaigns').then(r => setCampaigns(r.data)).catch(e => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim() || !form.subject.trim()) return toast.error('Name and subject required');
    await api.post('/api/v1/prachar/campaigns', form);
    setForm(null); load(); toast.success('Campaign created');
  };

  const send = async (id) => {
    try {
      const r = await api.post(`/api/v1/prachar/campaigns/${id}/send`);
      toast.success(`Sent to ${r.recipients} recipients`);
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (detail) {
    return (
      <div>
        <button onClick={() => setDetail(null)} style={BACK_BTN}>&larr; Back</button>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{detail.name}</h3>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 8 }}>Status: {detail.status} | Channel: {detail.channel}</p>
        <p style={{ fontSize: 13, marginBottom: 16 }}>Subject: {detail.subject}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          {(detail.status === 'draft' || detail.status === 'scheduled') &&
            <button onClick={() => send(detail.id)} style={PRIMARY_BTN}>Send Now</button>}
        </div>
      </div>
    );
  }

  if (form) {
    return (
      <div>
        <button onClick={() => setForm(null)} style={BACK_BTN}>&larr; Back</button>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>New Campaign</h3>
        <div style={{ display: 'grid', gap: 12, maxWidth: 500 }}>
          <input placeholder="Campaign name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={INPUT} />
          <input placeholder="Subject line" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} style={INPUT} />
          <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })} style={INPUT}>
            <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
          </select>
          <textarea placeholder="Body HTML" value={form.body_html} onChange={e => setForm({ ...form, body_html: e.target.value })} rows={6} style={INPUT} />
          <button onClick={save} style={PRIMARY_BTN}>Create Campaign</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => setForm({ name: '', subject: '', body_html: '', channel: 'email', audience_filter: {} })} style={PRIMARY_BTN}>+ New Campaign</button>
      <div style={{ marginTop: 16 }}>
        {campaigns.length === 0 && <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No campaigns yet.</p>}
        {campaigns.map(c => (
          <div key={c.id} onClick={() => setDetail(c)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', marginBottom: 8, background: 'var(--surface-2)', borderRadius: 8, cursor: 'pointer' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{c.channel} &middot; {c.total_recipients || 0} recipients</div>
            </div>
            <Badge text={c.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Templates ───────────────────────────────────────────────

function TemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState(null);
  const toast = useToast();

  const load = () => api.get('/api/v1/prachar/templates').then(r => setTemplates(r.data)).catch(e => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim() || !form.subject.trim()) return toast.error('Name and subject required');
    await api.post('/api/v1/prachar/templates', form);
    setForm(null); load(); toast.success('Template created');
  };

  const remove = async (id) => {
    await api.delete(`/api/v1/prachar/templates/${id}`);
    load(); toast.success('Deleted');
  };

  if (form) {
    return (
      <div>
        <button onClick={() => setForm(null)} style={BACK_BTN}>&larr; Back</button>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>New Template</h3>
        <div style={{ display: 'grid', gap: 12, maxWidth: 500 }}>
          <input placeholder="Template name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={INPUT} />
          <input placeholder="Subject" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} style={INPUT} />
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} style={INPUT}>
            <option value="general">General</option><option value="newsletter">Newsletter</option>
            <option value="promotional">Promotional</option><option value="transactional">Transactional</option>
          </select>
          <textarea placeholder="Body HTML" value={form.body_html} onChange={e => setForm({ ...form, body_html: e.target.value })} rows={8} style={INPUT} />
          <button onClick={save} style={PRIMARY_BTN}>Create Template</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => setForm({ name: '', subject: '', body_html: '', body_text: '', category: 'general', variables: [] })} style={PRIMARY_BTN}>+ New Template</button>
      <div style={{ marginTop: 16 }}>
        {templates.length === 0 && <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No templates yet.</p>}
        {templates.map(t => (
          <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', marginBottom: 8, background: 'var(--surface-2)', borderRadius: 8 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{t.category} &middot; Subject: {t.subject}</div>
            </div>
            <button onClick={() => remove(t.id)} style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Automations ─────────────────────────────────────────────

function AutomationsTab() {
  const [automations, setAutomations] = useState([]);
  const [form, setForm] = useState(null);
  const toast = useToast();

  const load = () => api.get('/api/v1/prachar/automations').then(r => setAutomations(r.data)).catch(e => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim()) return toast.error('Name required');
    await api.post('/api/v1/prachar/automations', form);
    setForm(null); load(); toast.success('Automation created');
  };

  const remove = async (id) => {
    await api.delete(`/api/v1/prachar/automations/${id}`);
    load(); toast.success('Deleted');
  };

  if (form) {
    return (
      <div>
        <button onClick={() => setForm(null)} style={BACK_BTN}>&larr; Back</button>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>New Automation</h3>
        <div style={{ display: 'grid', gap: 12, maxWidth: 500 }}>
          <input placeholder="Automation name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={INPUT} />
          <select value={form.trigger_type} onChange={e => setForm({ ...form, trigger_type: e.target.value })} style={INPUT}>
            <option value="contact_created">Contact Created</option>
            <option value="contact_converted">Contact Converted</option>
            <option value="deal_won">Deal Won</option>
            <option value="deal_lost">Deal Lost</option>
            <option value="label_added">Label Added</option>
            <option value="score_above">Score Above Threshold</option>
            <option value="manual">Manual Trigger</option>
          </select>
          <select value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })} style={INPUT}>
            <option value="send_email">Send Email</option>
            <option value="add_label">Add Label</option>
            <option value="update_score">Update Score</option>
            <option value="create_follow_up">Create Follow-up</option>
            <option value="notify_owner">Notify Owner</option>
          </select>
          <button onClick={save} style={PRIMARY_BTN}>Create Automation</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => setForm({ name: '', trigger_type: 'contact_created', trigger_config: {}, action_type: 'send_email', action_config: {}, is_active: true })} style={PRIMARY_BTN}>+ New Automation</button>
      <div style={{ marginTop: 16 }}>
        {automations.length === 0 && <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No automations yet.</p>}
        {automations.map(a => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', marginBottom: 8, background: 'var(--surface-2)', borderRadius: 8 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                When: {a.trigger_type.replace(/_/g, ' ')} &rarr; {a.action_type.replace(/_/g, ' ')}
              </div>
              {a.run_count > 0 && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Runs: {a.run_count}</div>}
            </div>
            <button onClick={() => remove(a.id)} style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Unsubscribes ────────────────────────────────────────────

function UnsubscribesTab() {
  const [list, setList] = useState([]);
  const [email, setEmail] = useState('');
  const toast = useToast();

  const load = () => api.get('/api/v1/prachar/unsubscribes').then(r => setList(r.data)).catch(e => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!email.trim()) return;
    await api.post(`/api/v1/prachar/unsubscribes?email=${encodeURIComponent(email.trim())}&reason=manual`);
    setEmail(''); load(); toast.success('Added to unsubscribe list');
  };

  const remove = async (id) => {
    await api.delete(`/api/v1/prachar/unsubscribes/${id}`);
    load(); toast.success('Removed');
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com"
          style={{ flex: 1, ...INPUT }} />
        <button onClick={add} style={PRIMARY_BTN}>Add</button>
      </div>
      {list.length === 0 && <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No unsubscribes.</p>}
      {list.map(u => (
        <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', marginBottom: 6, background: 'var(--surface-2)', borderRadius: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{u.email}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{u.reason || 'manual'}</div>
          </div>
          <button onClick={() => remove(u.id)} style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
        </div>
      ))}
    </div>
  );
}

// ── Shared ──────────────────────────────────────────────────

function Badge({ text }) {
  const colors = { draft: '#6E7B91', scheduled: '#0082c6', sending: '#8b5cf6', sent: '#10b981', paused: '#f59e0b', cancelled: '#9ca3af' };
  const c = colors[text] || '#6E7B91';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${c}18`, color: c }}>{text}</span>
  );
}

const TH = { textAlign: 'left', padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' };
const TD = { padding: '8px 12px' };
const INPUT = { padding: '8px 12px', fontSize: 13, border: '1px solid var(--rule-soft)', borderRadius: 6, background: 'var(--surface-1)' };
const PRIMARY_BTN = { padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--k-primary)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' };
const BACK_BTN = { background: 'none', border: 'none', fontSize: 13, color: 'var(--k-primary)', cursor: 'pointer', marginBottom: 16, padding: 0 };
