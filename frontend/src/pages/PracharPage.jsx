import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile, TabBar, Section, Badge, Shimmer, Empty, BackButton, ModCard, DataTable, Td } from '../components/editorial';

const STATUS_COLORS = { draft: '#6E7B91', scheduled: '#0082c6', sending: '#8b5cf6', sent: '#10b981', paused: '#f59e0b', cancelled: '#9ca3af' };

const TABS = ['dashboard', 'campaigns', 'ads', 'sequences', 'templates', 'automations', 'unsubscribes'];

export default function PracharPage() {
  const [tab, setTab] = useState('dashboard');
  return (
    <div style={{ padding: '0 0 48px' }}>
      <PageHeader title="Prachar" sanskrit="प्रचार" lede="Marketing — Campaigns, Templates & Automations" />
      <TabBar tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'campaigns' && <CampaignsTab />}
      {tab === 'ads' && <AdsTab />}
      {tab === 'sequences' && <SequencesTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'automations' && <AutomationsTab />}
      {tab === 'unsubscribes' && <UnsubscribesTab />}
    </div>
  );
}

function DashboardTab() {
  const [data, setData] = useState(null);
  const { pushToast } = useToast();
  useEffect(() => { api.get('/v1/prachar/dashboard').then(setData).catch(e => pushToast({ type: 'error', title: e.message })); }, []);
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
  const { pushToast } = useToast();

  const load = () => api.get('/v1/prachar/campaigns').then(r => { setCampaigns(r.data); setLoading(false); }).catch(e => { pushToast({ type: 'error', title: e.message }); setLoading(false); });
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim() || !form.subject.trim()) return pushToast({ type: 'error', title: 'Name and subject required' });
    await api.post('/v1/prachar/campaigns', form);
    setForm(null); load(); pushToast({ type: 'success', title: 'Campaign created' });
  };

  const send = async (id) => {
    try {
      const r = await api.post(`/v1/prachar/campaigns/${id}/send`);
      pushToast({ type: 'success', title: `Sent to ${r.recipients} recipients` });
      load();
    } catch (e) { pushToast({ type: 'error', title: e.message }); }
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

const SEQ_STATUS_COLORS = { draft: '#6E7B91', active: '#10b981', paused: '#f59e0b', completed: '#0082c6' };

function AdsTab() {
  const [view, setView] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [insights, setInsights] = useState([]);
  const [analysis, setAnalysis] = useState('');
  const [brief, setBrief] = useState('');
  const [loading, setLoading] = useState(true);
  const { pushToast } = useToast();

  useEffect(() => {
    setLoading(true);
    if (view === 'overview') {
      Promise.all([
        api.get('/v1/prachar/ads/overview'),
        api.get('/v1/prachar/ads/accounts')
      ]).then(([ov, acc]) => { setOverview(ov); setAccounts(acc.data || acc); setLoading(false); })
        .catch(e => { pushToast({ type: 'error', title: e.message }); setLoading(false); });
    } else if (view === 'campaigns') {
      api.get('/v1/prachar/ads/campaigns').then(r => { setCampaigns(r.data || r); setLoading(false); }).catch(e => { pushToast({ type: 'error', title: e.message }); setLoading(false); });
    } else if (view === 'insights') {
      api.get('/v1/prachar/ads/insights').then(r => { setInsights(r.data || r); setLoading(false); }).catch(e => { pushToast({ type: 'error', title: e.message }); setLoading(false); });
    } else {
      setLoading(false);
    }
  }, [view]);

  const syncAccount = async (id) => {
    try {
      await api.post('/v1/prachar/ads/accounts/sync', { social_account_id: id });
      pushToast({ type: 'success', title: 'Sync started' });
    } catch (e) { pushToast({ type: 'error', title: e.message }); }
  };

  const runAnalysis = async () => {
    if (!brief.trim()) return pushToast({ type: 'error', title: 'Enter a brief for analysis' });
    try {
      const r = await api.post('/v1/prachar/ads/analyse', { brief });
      setAnalysis(r.analysis || r.result || JSON.stringify(r, null, 2));
    } catch (e) { pushToast({ type: 'error', title: e.message }); }
  };

  const viewTabs = ['overview', 'campaigns', 'insights', 'analysis'];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {viewTabs.map(v => (
          <button key={v} className={`k-btn ${view === v ? 'k-btn--primary' : ''}`} style={{ fontSize: 13 }} onClick={() => setView(v)}>
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {view === 'overview' && (
        loading ? <Shimmer count={6} /> : (
          <>
            <Section title="Ad Overview" hi="विज्ञापन अवलोकन">
              <div className="k-stats">
                <StatTile label="Total Spend" value={overview?.total_spend || 0} />
                <StatTile label="Impressions" value={overview?.total_impressions || 0} />
                <StatTile label="Clicks" value={overview?.total_clicks || 0} variant="blue" />
                <StatTile label="Conversions" value={overview?.total_conversions || 0} variant="teal" />
                <StatTile label="Avg CTR" value={`${(overview?.avg_ctr || 0).toFixed(2)}%`} />
                <StatTile label="Avg CPC" value={overview?.avg_cpc || 0} />
                <StatTile label="Active Campaigns" value={overview?.active_campaigns || 0} variant="blue" />
              </div>
            </Section>
            <Section title="Ad Accounts" hi="विज्ञापन खाते">
              {accounts.length === 0 ? (
                <Empty icon="📊" title="No ad accounts" sub="Connect a social account to pull ad data." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {accounts.map(a => (
                    <ModCard key={a.id}>
                      <div>
                        <strong style={{ fontSize: 14 }}>{a.platform || a.name}</strong>
                        <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{a.account_id || a.id}</p>
                      </div>
                      <button className="k-btn" style={{ fontSize: 12 }} onClick={() => syncAccount(a.social_account_id || a.id)}>Sync</button>
                    </ModCard>
                  ))}
                </div>
              )}
            </Section>
          </>
        )
      )}

      {view === 'campaigns' && (
        loading ? <Shimmer count={4} /> : (
          <Section title="Ad Campaigns" hi="अभियान">
            {campaigns.length === 0 ? (
              <Empty icon="📣" title="No ad campaigns" sub="Sync an ad account to see campaigns." />
            ) : (
              <DataTable columns={['Name', 'Objective', 'Status', { label: 'Daily Budget', align: 'right' }]}>
                {campaigns.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td>{c.objective}</td>
                    <td><Badge text={c.status} color={STATUS_COLORS[c.status] || '#6E7B91'} /></td>
                    <Td align="right">{c.daily_budget || 0}</Td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Section>
        )
      )}

      {view === 'insights' && (
        loading ? <Shimmer count={4} /> : (
          <Section title="Ad Insights" hi="विज्ञापन विश्लेषण">
            {insights.length === 0 ? (
              <Empty icon="📈" title="No insights yet" sub="Run a sync to pull ad performance data." />
            ) : (
              <DataTable columns={['Campaign', 'Date', { label: 'Spend', align: 'right' }, { label: 'Impressions', align: 'right' }, { label: 'Clicks', align: 'right' }, { label: 'Conversions', align: 'right' }, { label: 'CTR', align: 'right' }, { label: 'CPC', align: 'right' }]}>
                {insights.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{r.campaign_name}</td>
                    <td>{r.date}</td>
                    <Td align="right">{r.spend}</Td>
                    <Td align="right">{r.impressions}</Td>
                    <Td align="right">{r.clicks}</Td>
                    <Td align="right">{r.conversions}</Td>
                    <Td align="right">{(r.ctr || 0).toFixed(2)}%</Td>
                    <Td align="right">{r.cpc}</Td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Section>
        )
      )}

      {view === 'analysis' && (
        <Section title="AI Ad Analysis" hi="AI विश्लेषण">
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input value={brief} onChange={e => setBrief(e.target.value)} placeholder="e.g. Analyse last 30 days performance" className="k-formpanel__input" style={{ flex: 1 }} />
            <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={runAnalysis}>Analyse</button>
          </div>
          {analysis && (
            <pre style={{ background: 'var(--surface-2)', padding: 16, borderRadius: 8, fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.6, fontFamily: 'var(--font-mono)' }}>{analysis}</pre>
          )}
        </Section>
      )}
    </div>
  );
}

function SequencesTab() {
  const [sequences, setSequences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);
  const [stats, setStats] = useState(null);
  const [stepForm, setStepForm] = useState(null);
  const [enrollIds, setEnrollIds] = useState('');
  const { pushToast } = useToast();

  const load = () => api.get('/v1/prachar/sequences').then(r => { setSequences(r.data || r); setLoading(false); }).catch(e => { pushToast({ type: 'error', title: e.message }); setLoading(false); });
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim()) return pushToast({ type: 'error', title: 'Name required' });
    await api.post('/v1/prachar/sequences', form);
    setForm(null); load(); pushToast({ type: 'success', title: 'Sequence created' });
  };

  const openDetail = async (seq) => {
    setDetail(seq);
    try {
      const r = await api.get(`/v1/prachar/sequences/${seq.id}/stats`);
      setStats(r);
    } catch (e) { pushToast({ type: 'error', title: e.message }); }
  };

  const addStep = async () => {
    if (!stepForm.subject?.trim()) return pushToast({ type: 'error', title: 'Subject required' });
    await api.post(`/v1/prachar/sequences/${detail.id}/steps`, stepForm);
    pushToast({ type: 'success', title: 'Step added' });
    const r = await api.get(`/v1/prachar/sequences/${detail.id}/stats`);
    setStats(r);
    setStepForm(null);
  };

  const enroll = async () => {
    const ids = enrollIds.split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) return pushToast({ type: 'error', title: 'Enter contact IDs' });
    await api.post(`/v1/prachar/sequences/${detail.id}/enroll`, { contact_ids: ids });
    pushToast({ type: 'success', title: `Enrolled ${ids.length} contacts` });
    setEnrollIds('');
  };

  const pause = async () => {
    await api.post(`/v1/prachar/sequences/${detail.id}/pause`);
    pushToast({ type: 'success', title: 'Sequence paused' });
    setDetail({ ...detail, status: 'paused' });
  };

  if (detail) {
    return (
      <div>
        <BackButton onClick={() => { setDetail(null); setStats(null); setStepForm(null); }} label="Back to sequences" />
        <div className="k-detail">
          <div className="k-detail__header">
            <div>
              <h3 className="k-detail__title">{detail.name}</h3>
              <p className="k-detail__sub">{detail.channel} sequence</p>
            </div>
            <Badge text={detail.status} color={SEQ_STATUS_COLORS[detail.status] || '#6E7B91'} />
          </div>

          <div className="k-detail__actions">
            {detail.status !== 'paused' && detail.status !== 'completed' && (
              <button className="k-btn" style={{ fontSize: 13 }} onClick={pause}>Pause</button>
            )}
          </div>
        </div>

        {stats && (
          <Section title="Stats" hi="आँकड़े">
            <div className="k-stats">
              <StatTile label="Active" value={stats.totals?.active || 0} variant="teal" />
              <StatTile label="Completed" value={stats.totals?.completed || 0} variant="blue" />
              <StatTile label="Replied" value={stats.totals?.replied || 0} />
              <StatTile label="Bounced" value={stats.totals?.bounced || 0} variant="red" />
            </div>
          </Section>
        )}

        <Section title="Steps" hi="चरण">
          {stats?.steps?.length > 0 ? (
            <DataTable columns={['#', 'Channel', 'Subject', { label: 'Delay (days)', align: 'right' }]}>
              {stats.steps.map((s, i) => (
                <tr key={i}>
                  <td>{s.step_order}</td>
                  <td>{s.channel}</td>
                  <td style={{ fontWeight: 500 }}>{s.subject}</td>
                  <Td align="right">{s.delay_days}</Td>
                </tr>
              ))}
            </DataTable>
          ) : (
            <Empty icon="📋" title="No steps yet" sub="Add steps to build your sequence." />
          )}
          {!stepForm ? (
            <button className="k-btn k-btn--primary" style={{ fontSize: 13, marginTop: 12 }} onClick={() => setStepForm({ step_order: (stats?.steps?.length || 0) + 1, channel: 'email', delay_days: 1, subject: '', body_html: '' })}>+ Add Step</button>
          ) : (
            <div className="k-formpanel" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-display)', margin: '0 0 20px' }}>New Step</h3>
              <div className="k-formpanel__grid k-formpanel__grid--2">
                <label className="k-formpanel__label">Step order
                  <input type="number" value={stepForm.step_order} onChange={e => setStepForm({ ...stepForm, step_order: +e.target.value })} className="k-formpanel__input" />
                </label>
                <label className="k-formpanel__label">Delay (days)
                  <input type="number" value={stepForm.delay_days} onChange={e => setStepForm({ ...stepForm, delay_days: +e.target.value })} className="k-formpanel__input" />
                </label>
              </div>
              <div className="k-formpanel__grid k-formpanel__grid--2">
                <label className="k-formpanel__label">Channel
                  <select value={stepForm.channel} onChange={e => setStepForm({ ...stepForm, channel: e.target.value })} className="k-formpanel__input">
                    <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
                  </select>
                </label>
                <label className="k-formpanel__label">Subject
                  <input placeholder="Step subject" value={stepForm.subject} onChange={e => setStepForm({ ...stepForm, subject: e.target.value })} className="k-formpanel__input" />
                </label>
              </div>
              <label className="k-formpanel__label" style={{ marginBottom: 16 }}>Body HTML
                <textarea placeholder="Step body..." value={stepForm.body_html} onChange={e => setStepForm({ ...stepForm, body_html: e.target.value })} rows={4} className="k-formpanel__input" style={{ minHeight: 80 }} />
              </label>
              <div className="k-formpanel__actions">
                <button onClick={addStep} className="k-btn k-btn--primary" style={{ fontSize: 13 }}>Add Step</button>
                <button onClick={() => setStepForm(null)} className="k-btn" style={{ fontSize: 13 }}>Cancel</button>
              </div>
            </div>
          )}
        </Section>

        <Section title="Enroll Contacts" hi="संपर्क जोड़ें">
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={enrollIds} onChange={e => setEnrollIds(e.target.value)} placeholder="Comma-separated contact IDs" className="k-formpanel__input" style={{ flex: 1 }} />
            <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={enroll}>Enroll</button>
          </div>
        </Section>
      </div>
    );
  }

  if (form) {
    return (
      <div>
        <BackButton onClick={() => setForm(null)} label="Back to sequences" />
        <div className="k-formpanel">
          <h3 style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-display)', margin: '0 0 20px' }}>New Sequence</h3>
          <div className="k-formpanel__grid k-formpanel__grid--2">
            <label className="k-formpanel__label">Sequence name
              <input placeholder="e.g. Onboarding drip" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="k-formpanel__input" />
            </label>
            <label className="k-formpanel__label">Channel
              <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })} className="k-formpanel__input">
                <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
              </select>
            </label>
          </div>
          <div className="k-formpanel__actions">
            <button onClick={save} className="k-btn k-btn--primary" style={{ fontSize: 13 }}>Create Sequence</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="k-section__head" style={{ marginBottom: 20 }}>
        <h3 className="k-section__title">Sequences<span className="k-section__title-hi">अनुक्रम</span></h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }}
          onClick={() => setForm({ name: '', channel: 'email', status: 'draft' })}>
          + New Sequence
        </button>
      </div>

      {loading ? <Shimmer count={4} /> : sequences.length === 0 ? (
        <Empty icon="🔄" title="No sequences yet" sub="Create automated multi-step outreach sequences." cta="+ New Sequence" onCta={() => setForm({ name: '', channel: 'email', status: 'draft' })} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sequences.map(s => (
            <ModCard key={s.id} onClick={() => openDetail(s)}>
              <div>
                <strong style={{ fontSize: 14 }}>{s.name}</strong>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{s.channel}</p>
              </div>
              <Badge text={s.status} color={SEQ_STATUS_COLORS[s.status] || '#6E7B91'} />
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
  const { pushToast } = useToast();

  const load = () => api.get('/v1/prachar/templates').then(r => { setTemplates(r.data); setLoading(false); }).catch(e => { pushToast({ type: 'error', title: e.message }); setLoading(false); });
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim() || !form.subject.trim()) return pushToast({ type: 'error', title: 'Name and subject required' });
    await api.post('/v1/prachar/templates', form);
    setForm(null); load(); pushToast({ type: 'success', title: 'Template created' });
  };

  const remove = async (id) => {
    await api.delete(`/v1/prachar/templates/${id}`);
    load(); pushToast({ type: 'success', title: 'Deleted' });
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
  const { pushToast } = useToast();

  const load = () => api.get('/v1/prachar/automations').then(r => { setAutomations(r.data); setLoading(false); }).catch(e => { pushToast({ type: 'error', title: e.message }); setLoading(false); });
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim()) return pushToast({ type: 'error', title: 'Name required' });
    await api.post('/v1/prachar/automations', form);
    setForm(null); load(); pushToast({ type: 'success', title: 'Automation created' });
  };

  const remove = async (id) => {
    await api.delete(`/v1/prachar/automations/${id}`);
    load(); pushToast({ type: 'success', title: 'Deleted' });
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
  const { pushToast } = useToast();

  const load = () => api.get('/v1/prachar/unsubscribes').then(r => { setList(r.data); setLoading(false); }).catch(e => { pushToast({ type: 'error', title: e.message }); setLoading(false); });
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!email.trim()) return;
    await api.post(`/v1/prachar/unsubscribes?email=${encodeURIComponent(email.trim())}&reason=manual`);
    setEmail(''); load(); pushToast({ type: 'success', title: 'Added to unsubscribe list' });
  };

  const remove = async (id) => {
    await api.delete(`/v1/prachar/unsubscribes/${id}`);
    load(); pushToast({ type: 'success', title: 'Removed' });
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
