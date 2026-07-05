import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';

const AGENT_LABELS = {
  social_media: 'Social Media', blog: 'Blog', ad_copy: 'Ad Copy',
  email: 'Email', whatsapp: 'WhatsApp', lead_magnet: 'Lead Magnet',
};

const STATUS_COLORS = {
  draft: '#6E7B91', pending_review: '#f59e0b', approved: '#10b981',
  rejected: '#ef4444', published: '#0082c6', archived: '#9ca3af',
};

function Badge({ status }) {
  const c = STATUS_COLORS[status] || '#6E7B91';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${c}18`, color: c }}>
      {status?.replace(/_/g, ' ')}
    </span>
  );
}

const TABS = ['overview', 'content', 'generate', 'brand', 'credits'];

export default function HubClientDetailPage() {
  const { clientId } = useParams();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [client, setClient] = useState(null);
  const [brand, setBrand] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [contentCount, setContentCount] = useState(0);
  const [content, setContent] = useState([]);
  const [loading, setLoading] = useState(true);

  // Generate form
  const [genForm, setGenForm] = useState({ agent_type: 'social_media', brief: '', platform: '', language: 'en', extra_instructions: '' });
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState(null);

  // Brand form
  const [brandForm, setBrandForm] = useState({});
  const [savingBrand, setSavingBrand] = useState(false);

  useEffect(() => { loadClient(); }, [clientId]);
  useEffect(() => { if (tab === 'content') loadContent(); }, [tab]);

  async function loadClient() {
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}`);
      setClient(r.data.client);
      setBrand(r.data.brand);
      setWallet(r.data.wallet);
      setContentCount(r.data.content_count);
      if (r.data.brand) setBrandForm(r.data.brand);
    } catch {
      pushToast({ title: 'Failed to load client', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function loadContent() {
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}/content`);
      setContent(r.data.data || []);
    } catch {
      pushToast({ title: 'Failed to load content', type: 'error' });
    }
  }

  async function handleGenerate(e) {
    e.preventDefault();
    setGenerating(true);
    setGenResult(null);
    try {
      const r = await api.post(`/v1/hub/clients/${clientId}/generate`, genForm);
      setGenResult(r.data);
      setWallet(w => w ? { ...w, balance: r.data.credits_remaining } : w);
      pushToast({ title: 'Content generated!', type: 'success' });
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Generation failed', type: 'error' });
    } finally {
      setGenerating(false);
    }
  }

  async function handleBrandSave() {
    setSavingBrand(true);
    try {
      const { id, client_id, created_at, updated_at, ...fields } = brandForm;
      await api.put(`/v1/hub/clients/${clientId}/brand`, fields);
      pushToast({ title: 'Brand profile updated', type: 'success' });
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Failed to save', type: 'error' });
    } finally {
      setSavingBrand(false);
    }
  }

  async function handleReview(contentId, status) {
    try {
      await api.patch(`/v1/hub/clients/${clientId}/content/${contentId}/review`, { status });
      pushToast({ title: `Content ${status}`, type: 'success' });
      loadContent();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Review failed', type: 'error' });
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Loading…</div>;
  if (!client) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Client not found.</div>;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 24px 48px' }}>
      <div style={{ marginBottom: 8 }}>
        <button onClick={() => navigate('/hub/clients')} className="k-btn k-btn--ghost" style={{ fontSize: 12 }}>← Back to Clients</button>
      </div>
      <PageHeader title={client.name} subtitle={`${client.slug} · ${client.industry || 'No industry'}`} />

      {/* Tabs */}
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

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
            <StatTile label="Credits" value={wallet?.balance ?? 0} />
            <StatTile label="Monthly Allocation" value={wallet?.monthly_allocation ?? 0} />
            <StatTile label="Content Items" value={contentCount} />
          </div>
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Contact</h3>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.8 }}>
              <div><strong>Name:</strong> {client.contact_name || '—'}</div>
              <div><strong>Email:</strong> {client.contact_email || '—'}</div>
              <div><strong>Phone:</strong> {client.contact_phone || '—'}</div>
              <div><strong>Website:</strong> {client.website || '—'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Content Tab */}
      {tab === 'content' && (
        <div>
          {content.length === 0 ? (
            <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 24, textAlign: 'center' }}>No content yet. Switch to the Generate tab to create content.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {content.map(item => (
                <div key={item.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{item.title}</span>
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-3)' }}>{AGENT_LABELS[item.agent_type]}</span>
                    </div>
                    <Badge status={item.status} />
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '0 0 12px', whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'hidden' }}>
                    {item.body}
                  </p>
                  {(item.status === 'draft' || item.status === 'pending_review') && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="k-btn k-btn--primary" style={{ fontSize: 12, padding: '4px 12px' }}
                        onClick={() => handleReview(item.id, 'approved')}>Approve</button>
                      <button className="k-btn k-btn--ghost" style={{ fontSize: 12, padding: '4px 12px', color: '#ef4444' }}
                        onClick={() => handleReview(item.id, 'rejected')}>Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Generate Tab */}
      {tab === 'generate' && (
        <div>
          <form onSubmit={handleGenerate} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 24 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Generate Content</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Agent Type</span>
                <select className="k-input" value={genForm.agent_type}
                  onChange={e => setGenForm({ ...genForm, agent_type: e.target.value })}>
                  {Object.entries(AGENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Platform</span>
                <input className="k-input" placeholder="e.g. Instagram, LinkedIn" value={genForm.platform}
                  onChange={e => setGenForm({ ...genForm, platform: e.target.value })} />
              </label>
              <label style={{ fontSize: 13, gridColumn: '1 / -1' }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Brief *</span>
                <textarea className="k-input" rows={3} required placeholder="Describe what content you need…" value={genForm.brief}
                  onChange={e => setGenForm({ ...genForm, brief: e.target.value })} style={{ resize: 'vertical' }} />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Language</span>
                <select className="k-input" value={genForm.language}
                  onChange={e => setGenForm({ ...genForm, language: e.target.value })}>
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="gu">Gujarati</option>
                  <option value="mr">Marathi</option>
                  <option value="ta">Tamil</option>
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Extra Instructions</span>
                <input className="k-input" placeholder="Any additional context…" value={genForm.extra_instructions}
                  onChange={e => setGenForm({ ...genForm, extra_instructions: e.target.value })} />
              </label>
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Credits available: <strong>{wallet?.balance ?? 0}</strong></span>
              <button type="submit" className="k-btn k-btn--primary" disabled={generating}>
                {generating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </form>

          {genResult && (
            <div style={{ background: 'var(--surface-1)', border: '1px solid var(--k-primary)', borderRadius: 12, padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Generated Content</h3>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {genResult.ai.provider} / {genResult.ai.model}
                </span>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, color: 'var(--ink-1)', padding: 16,
                background: 'var(--surface-0)', borderRadius: 8, border: '1px solid var(--rule-soft)' }}>
                {genResult.content.body}
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-3)' }}>
                Credits remaining: <strong>{genResult.credits_remaining}</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Brand Tab */}
      {tab === 'brand' && (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Brand Profile</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Brand Voice</span>
              <textarea className="k-input" rows={2} placeholder="e.g. Professional yet approachable, data-driven…"
                value={brandForm.brand_voice || ''}
                onChange={e => setBrandForm({ ...brandForm, brand_voice: e.target.value })} style={{ resize: 'vertical' }} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Tone</span>
              <select className="k-input" value={brandForm.tone || 'professional'}
                onChange={e => setBrandForm({ ...brandForm, tone: e.target.value })}>
                <option value="professional">Professional</option>
                <option value="casual">Casual</option>
                <option value="friendly">Friendly</option>
                <option value="bold">Bold</option>
                <option value="inspirational">Inspirational</option>
                <option value="witty">Witty</option>
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Tagline</span>
              <input className="k-input" value={brandForm.tagline || ''}
                onChange={e => setBrandForm({ ...brandForm, tagline: e.target.value })} />
            </label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Target Audience</span>
              <textarea className="k-input" rows={2} placeholder="e.g. Small business owners in India aged 25-45…"
                value={brandForm.target_audience || ''}
                onChange={e => setBrandForm({ ...brandForm, target_audience: e.target.value })} style={{ resize: 'vertical' }} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Primary Color</span>
              <input className="k-input" type="color" value={brandForm.color_primary || '#0082c6'}
                onChange={e => setBrandForm({ ...brandForm, color_primary: e.target.value })} />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Secondary Color</span>
              <input className="k-input" type="color" value={brandForm.color_secondary || '#05b7aa'}
                onChange={e => setBrandForm({ ...brandForm, color_secondary: e.target.value })} />
            </label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Content Do's</span>
              <textarea className="k-input" rows={2} placeholder="e.g. Use data and statistics, include CTAs…"
                value={brandForm.content_dos || ''}
                onChange={e => setBrandForm({ ...brandForm, content_dos: e.target.value })} style={{ resize: 'vertical' }} />
            </label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}>
              <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Content Don'ts</span>
              <textarea className="k-input" rows={2} placeholder="e.g. Avoid slang, don't use competitor names…"
                value={brandForm.content_donts || ''}
                onChange={e => setBrandForm({ ...brandForm, content_donts: e.target.value })} style={{ resize: 'vertical' }} />
            </label>
          </div>
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="k-btn k-btn--primary" onClick={handleBrandSave} disabled={savingBrand}>
              {savingBrand ? 'Saving…' : 'Save Brand Profile'}
            </button>
          </div>
        </div>
      )}

      {/* Credits Tab */}
      {tab === 'credits' && <CreditTab clientId={clientId} wallet={wallet} onRefresh={loadClient} />}
    </div>
  );
}

function CreditTab({ clientId, wallet, onRefresh }) {
  const { pushToast } = useToast();
  const [transactions, setTransactions] = useState([]);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupNotes, setTopupNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadTx(); }, []);

  async function loadTx() {
    try {
      const r = await api.get(`/v1/hub/clients/${clientId}/credits`);
      setTransactions(r.data.recent_transactions || []);
    } catch {
      pushToast({ title: 'Failed to load credit history', type: 'error' });
    }
  }

  async function handleTopup(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/v1/hub/clients/${clientId}/credits/topup`, {
        amount: parseInt(topupAmount, 10), notes: topupNotes,
      });
      pushToast({ title: 'Credits added', type: 'success' });
      setTopupAmount('');
      setTopupNotes('');
      onRefresh();
      loadTx();
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Topup failed', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const TX_COLORS = { debit: '#ef4444', credit: '#10b981', refill: '#0082c6', topup: '#10b981', refund: '#f59e0b' };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Balance</h3>
          <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--k-primary)' }}>{wallet?.balance ?? 0}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>Monthly allocation: {wallet?.monthly_allocation ?? 0}</div>
        </div>

        <form onSubmit={handleTopup} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Add Credits</h3>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Amount</span>
            <input className="k-input" type="number" min="1" required value={topupAmount}
              onChange={e => setTopupAmount(e.target.value)} />
          </label>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
            <span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
            <input className="k-input" value={topupNotes} onChange={e => setTopupNotes(e.target.value)} />
          </label>
          <button type="submit" className="k-btn k-btn--primary" disabled={saving} style={{ width: '100%' }}>
            {saving ? 'Adding…' : 'Add Credits'}
          </button>
        </form>
      </div>

      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Transaction History</h3>
        {transactions.length === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No transactions yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                {['Type', 'Amount', 'Balance After', 'Description', 'Date'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transactions.map(tx => (
                <tr key={tx.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 99,
                      background: `${TX_COLORS[tx.tx_type] || '#6E7B91'}18`, color: TX_COLORS[tx.tx_type] || '#6E7B91' }}>
                      {tx.tx_type}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: tx.amount < 0 ? '#ef4444' : '#10b981' }}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount}
                  </td>
                  <td style={{ padding: '10px 12px' }}>{tx.balance_after}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--ink-2)' }}>{tx.description}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--ink-3)', fontSize: 12 }}>{new Date(tx.created_at).toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
