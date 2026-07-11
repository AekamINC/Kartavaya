import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile, TabBar, Section, Badge, Shimmer, Empty, BackButton, ModCard, DataTable, Td } from '../components/editorial';

const STATUS_COLORS = { draft: '#6E7B91', scheduled: '#0082c6', sending: '#8b5cf6', sent: '#10b981', paused: '#f59e0b', cancelled: '#9ca3af' };

const TABS = ['dashboard', 'campaigns', 'templates', 'automations', 'unsubscribes'];

export default function PracharPage() {
  const [tab, setTab] = useState('dashboard');
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px 48px' }}>
      <PageHeader title="Prachar" sanskrit="प्रचार" lede="Marketing — Campaigns, Templates & Automations" />
      <TabBar tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'campaigns' && <CampaignsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'automations' && <AutomationsTab />}
      {tab === 'unsubscribes' && <UnsubscribesTab />}
    </div>
  );
}

function DashboardTab() {
  const [data, setData] = useState(null);
  const toast = useToast();
  useEffect(() => { api.get('/api/v1/prachar/dashboard').then(setData).catch(e => toast.error(e.message)); }, []);
  if (!data) return <Shimmer count={8} />;
  const { campaigns, delivery } = data;
  return (
    <>
      <Section title="Campaigns" hi="अभियान">
        <div className="k-stats">
          <StatTile label="Total Campaigns" value={campaigns.total || 0} />
          <StatTile label="Sent" value={campaigns.sent || 0} variant="teal" />
          <StatTile label="Drafts" value={campaigns.drafts || 0} />
          <StatTile label="Scheduled" value={campaigns.scheduled || 0} variant="blue" />
        </div>
      </Section>

      <Section title="Delivery Stats" hi="वितरण">
        <div className="k-stats">
          <StatTile label="Total Sent" value={delivery.total_sent || 0} />
          <StatTile label="Opened" value={delivery.total_opened || 0} variant="teal" />
          <StatTile label="Clicked" value={delivery.total_clicked || 0} variant="blue" />
          <StatTile label="Bounced" value={delivery.total_bounced || 0} variant="red" />
        </div>
      </Section>

      <Section title="Assets" hi="संसाधन">
        <div className="k-stats">
          <StatTile label="Templates" value={data.templates_count} />
          <StatTile label="Automations" value={data.automations_count} />
          <StatTile label="Unsubscribes" value={data.unsubscribes_count} variant="amber" />
        </div>
      </Section>

      {data.recent_campaigns.length > 0 && (
        <Section title="Recent Campaigns" hi="हाल के अभियान">
          <DataTable columns={['Name', 'Status', { label: 'Recipients', align: 'right' }, { label: 'Opened', align: 'right' }, { label: 'Clicked', align: 'right' }]}>
            {data.recent_campaigns.map(c => (
              <tr key={c.id}>
                <td style={{ fontWeight: 500 }}>{c.name}</td>
                <td><Badge text={c.status} color={STATUS_COLORS[c.status]} /></td>
                <Td align="right">{c.total_recipients || 0}</Td>
                <Td align="right">{c.total_opened || 0}</Td>
                <Td align="right">{c.total_clicked || 0}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </>
  );
}

function CampaignsTab() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);
  const toast = useToast();

  const load = () => api.get('/api/v1/prachar/campaigns').then(r => { setCampaigns(r.data); setLoading(false); }).catch(e => { toast.error(e.message); setLoading(false); });
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
        <BackButton onClick={() => setDetail(null)} label="Back to campaigns" />
        <div className="k-detail">
          <div className="k-detail__header">
            <div>
              <h3 className="k-detail__title">{detail.name}</h3>
              <p className="k-detail__sub">{detail.channel} · {detail.total_recipients || 0} recipients</p>
            </div>
            <Badge text={detail.status} color={STATUS_COLORS[detail.status]} />
          </div>

          <div className="k-metabar">
            <span>Subject: <strong>{detail.subject}</strong></span>
          </div>

          {(detail.status === 'draft' || detail.status === 'scheduled') && (
            <div className="k-detail__actions">
              <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => send(detail.id)}>Send Now</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (form) {
    return (
      <div>
        <BackButton onClick={() => setForm(null)} label="Back to campaigns" />
        <div className="k-formpanel">
          <h3 style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-display)', margin: '0 0 20px' }}>New Campaign</h3>
          <div className="k-formpanel__grid k-formpanel__grid--2">
            <label className="k-formpanel__label">Campaign name
              <input placeholder="e.g. July Newsletter" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="k-formpanel__input" />
            </label>
            <label className="k-formpanel__label">Subject line
              <input placeholder="e.g. Your monthly update" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} className="k-formpanel__input" />
            </label>
          </div>
          <div className="k-formpanel__grid k-formpanel__grid--2">
            <label className="k-formpanel__label">Channel
              <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })} className="k-formpanel__input">
                <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
              </select>
            </label>
          </div>
          <label className="k-formpanel__label" style={{ marginBottom: 16 }}>Body HTML
            <textarea placeholder="Campaign body content…" value={form.body_html} onChange={e => setForm({ ...form, body_html: e.target.value })} rows={6} className="k-formpanel__input" style={{ minHeight: 120 }} />
          </label>
          <div className="k-formpanel__actions">
            <button onClick={save} className="k-btn k-btn--primary" style={{ fontSize: 13 }}>Create Campaign</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="k-section__head" style={{ marginBottom: 20 }}>
        <h3 className="k-section__title">All Campaigns<span className="k-section__title-hi">अभियान</span></h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }}
          onClick={() => setForm({ name: '', subject: '', body_html: '', channel: 'email', audience_filter: {} })}>
          + New Campaign
        </button>
      </div>

      {loading ? <Shimmer count={4} /> : campaigns.length === 0 ? (
        <Empty icon="📣" title="No campaigns yet" sub="Create your first marketing campaign to reach your audience." cta="+ New Campaign" onCta={() => setForm({ name: '', subject: '', body_html: '', channel: 'email', audience_filter: {} })} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {campaigns.map(c => (
            <ModCard key={c.id} onClick={() => setDetail(c)}>
              <div>
                <strong style={{ fontSize: 14 }}>{c.name}</strong>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{c.channel} · {c.total_recipients || 0} recipients</p>
              </div>
              <Badge text={c.status} color={STATUS_COLORS[c.status]} />
            </ModCard>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const toast = useToast();

  const load = () => api.get('/api/v1/prachar/templates').then(r => { setTemplates(r.data); setLoading(false); }).catch(e => { toast.error(e.message); setLoading(false); });
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
        <BackButton onClick={() => setForm(null)} label="Back to templates" />
        <div className="k-formpanel">
          <h3 style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-display)', margin: '0 0 20px' }}>New Template</h3>
          <div className="k-formpanel__grid k-formpanel__grid--2">
            <label className="k-formpanel__label">Template name
              <input placeholder="e.g. Welcome Email" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="k-formpanel__input" />
            </label>
            <label className="k-formpanel__label">Subject
              <input placeholder="e.g. Welcome to {{company}}" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} className="k-formpanel__input" />
            </label>
          </div>
          <div className="k-formpanel__grid k-formpanel__grid--2">
            <label className="k-formpanel__label">Category
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="k-formpanel__input">
                <option value="general">General</option><option value="newsletter">Newsletter</option>
                <option value="promotional">Promotional</option><option value="transactional">Transactional</option>
              </select>
            </label>
          </div>
          <label className="k-formpanel__label" style={{ marginBottom: 16 }}>Body HTML
            <textarea placeholder="Template body content…" value={form.body_html} onChange={e => setForm({ ...form, body_html: e.target.value })} rows={8} className="k-formpanel__input" style={{ minHeight: 160 }} />
          </label>
          <div className="k-formpanel__actions">
            <button onClick={save} className="k-btn k-btn--primary" style={{ fontSize: 13 }}>Create Template</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="k-section__head" style={{ marginBottom: 20 }}>
        <h3 className="k-section__title">Email Templates<span className="k-section__title-hi">टेम्पलेट</span></h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }}
          onClick={() => setForm({ name: '', subject: '', body_html: '', body_text: '', category: 'general', variables: [] })}>
          + New Template
        </button>
      </div>

      {loading ? <Shimmer count={3} /> : templates.length === 0 ? (
        <Empty icon="✉️" title="No templates yet" sub="Create reusable email templates for your campaigns." cta="+ New Template" onCta={() => setForm({ name: '', subject: '', body_html: '', body_text: '', category: 'general', variables: [] })} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {templates.map(t => (
            <div key={t.id} className="k-modcard" style={{ cursor: 'default' }}>
              <div>
                <strong style={{ fontSize: 14 }}>{t.name}</strong>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
                  <Badge text={t.category} color="#6E7B91" /> <span style={{ marginLeft: 6 }}>Subject: {t.subject}</span>
                </p>
              </div>
              <button onClick={() => remove(t.id)} style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AutomationsTab() {
  const [automations, setAutomations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const toast = useToast();

  const load = () => api.get('/api/v1/prachar/automations').then(r => { setAutomations(r.data); setLoading(false); }).catch(e => { toast.error(e.message); setLoading(false); });
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
        <BackButton onClick={() => setForm(null)} label="Back to automations" />
        <div className="k-formpanel">
          <h3 style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-display)', margin: '0 0 20px' }}>New Automation</h3>
          <div className="k-formpanel__grid k-formpanel__grid--2">
            <label className="k-formpanel__label">Automation name
              <input placeholder="e.g. Welcome series" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="k-formpanel__input" />
            </label>
          </div>
          <div className="k-formpanel__grid k-formpanel__grid--2">
            <label className="k-formpanel__label">Trigger
              <select value={form.trigger_type} onChange={e => setForm({ ...form, trigger_type: e.target.value })} className="k-formpanel__input">
                <option value="contact_created">Contact Created</option>
                <option value="contact_converted">Contact Converted</option>
                <option value="deal_won">Deal Won</option>
                <option value="deal_lost">Deal Lost</option>
                <option value="label_added">Label Added</option>
                <option value="score_above">Score Above Threshold</option>
                <option value="manual">Manual Trigger</option>
              </select>
            </label>
            <label className="k-formpanel__label">Action
              <select value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })} className="k-formpanel__input">
                <option value="send_email">Send Email</option>
                <option value="add_label">Add Label</option>
                <option value="update_score">Update Score</option>
                <option value="create_follow_up">Create Follow-up</option>
                <option value="notify_owner">Notify Owner</option>
              </select>
            </label>
          </div>
          <div className="k-formpanel__actions">
            <button onClick={save} className="k-btn k-btn--primary" style={{ fontSize: 13 }}>Create Automation</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="k-section__head" style={{ marginBottom: 20 }}>
        <h3 className="k-section__title">Automations<span className="k-section__title-hi">स्वचालन</span></h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }}
          onClick={() => setForm({ name: '', trigger_type: 'contact_created', trigger_config: {}, action_type: 'send_email', action_config: {}, is_active: true })}>
          + New Automation
        </button>
      </div>

      {loading ? <Shimmer count={3} /> : automations.length === 0 ? (
        <Empty icon="⚡" title="No automations yet" sub="Set up automated workflows triggered by contact events and deal changes." cta="+ New Automation" onCta={() => setForm({ name: '', trigger_type: 'contact_created', trigger_config: {}, action_type: 'send_email', action_config: {}, is_active: true })} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {automations.map(a => (
            <div key={a.id} className="k-modcard" style={{ cursor: 'default' }}>
              <div>
                <strong style={{ fontSize: 14 }}>{a.name}</strong>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
                  When: <em>{a.trigger_type.replace(/_/g, ' ')}</em> → {a.action_type.replace(/_/g, ' ')}
                </p>
                {a.run_count > 0 && <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{a.run_count} runs</p>}
              </div>
              <button onClick={() => remove(a.id)} style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UnsubscribesTab() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const toast = useToast();

  const load = () => api.get('/api/v1/prachar/unsubscribes').then(r => { setList(r.data); setLoading(false); }).catch(e => { toast.error(e.message); setLoading(false); });
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com"
          className="k-formpanel__input" style={{ flex: 1 }} />
        <button onClick={add} className="k-btn k-btn--primary" style={{ fontSize: 13 }}>Add</button>
      </div>

      {loading ? <Shimmer count={3} /> : list.length === 0 ? (
        <Empty icon="🚫" title="No unsubscribes" sub="Contacts who opt out of communications will appear here." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.map(u => (
            <div key={u.id} className="k-modcard" style={{ cursor: 'default' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{u.email}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{u.reason || 'manual'}</div>
              </div>
              <button onClick={() => remove(u.id)} style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
