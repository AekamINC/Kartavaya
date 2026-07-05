import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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

export default function HubDashboardPage() {
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/v1/hub/dashboard')
      .then(r => setData(r.data))
      .catch(() => pushToast({ title: 'Failed to load Srijan dashboard', type: 'error' }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Loading…</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Srijan module not available.</div>;

  const { stats, recent_content, credit_costs } = data;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 24px 48px' }}>
      <PageHeader title="Srijan · सृजन" subtitle="AI-powered marketing — clients, content, credits" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
        <StatTile label="Clients" value={stats.total_clients} />
        <StatTile label="Total Credits" value={stats.total_credits.toLocaleString('en-IN')} />
        <StatTile label="Content Items" value={stats.total_content} />
        <StatTile label="Pending Review" value={stats.pending_review} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: 'var(--ink-1)' }}>Quick Actions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={() => navigate('/hub/clients')} className="k-btn k-btn--primary" style={{ justifyContent: 'flex-start' }}>
              Manage Clients
            </button>
            <button onClick={() => navigate('/hub/clients')} className="k-btn k-btn--ghost" style={{ justifyContent: 'flex-start' }}>
              Generate Content
            </button>
          </div>
        </div>

        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: 'var(--ink-1)' }}>Credit Costs</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {Object.entries(credit_costs).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--rule-soft)' }}>
                <span style={{ color: 'var(--ink-2)' }}>{AGENT_LABELS[k] || k}</span>
                <span style={{ fontWeight: 700, color: 'var(--ink-1)' }}>{v} cr</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: 'var(--ink-1)' }}>Recent Content</h3>
        {recent_content.length === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No content generated yet. Create a client and start generating!</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                {['Title', 'Client', 'Type', 'Status', 'Created'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent_content.map(item => (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '10px 12px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--ink-2)' }}>{item.client_name}</td>
                  <td style={{ padding: '10px 12px' }}>{AGENT_LABELS[item.agent_type] || item.agent_type}</td>
                  <td style={{ padding: '10px 12px' }}><Badge status={item.status} /></td>
                  <td style={{ padding: '10px 12px', color: 'var(--ink-3)', fontSize: 12 }}>{new Date(item.created_at).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
