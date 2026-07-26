import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';

const STATUS_COLORS = {
  active: '#10b981', trialing: '#f59e0b', paused: '#6E7B91',
  cancelled: '#ef4444', pending: '#f59e0b', paid: '#10b981', overdue: '#ef4444',
};

function Badge({ status }) {
  const c = STATUS_COLORS[status] || '#6E7B91';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${c}18`, color: c }}>
      {status}
    </span>
  );
}

function Card({ title, children, style }) {
  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)',
      borderRadius: 12, padding: 24, ...style }}>
      {title && <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: 'var(--ink-1)' }}>{title}</h3>}
      {children}
    </div>
  );
}

function CreditUsage() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/v1/subscription/cost-report?period=30d')
      .then(r => setData(r.data))
      .catch(() => {});
  }, []);
  if (!data) return null;
  const pct = data.plan_credits > 0 ? Math.min(100, Math.round((data.total_credits_used / data.plan_credits) * 100)) : 0;
  return (
    <Card title="Credit Usage — This Month" style={{ marginBottom: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Plan Credits</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>{data.plan_credits}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Used</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: data.is_over_plan ? '#ef4444' : 'var(--ink)' }}>{data.total_credits_used}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Balance</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: data.current_balance <= 0 ? '#ef4444' : '#10b981' }}>{data.current_balance}</div>
        </div>
        {data.overage_credits > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '.06em' }}>Overage (Chargeable)</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#ef4444' }}>{data.overage_credits}</div>
          </div>
        )}
      </div>
      <div style={{ background: 'var(--bg-soft)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#ef4444' : 'var(--k-primary)', borderRadius: 6, transition: 'width 0.3s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>
        <span>AI: {data.ai_credits_used} · Scraper: {data.scraper_credits_used}</span>
        <span>{pct}% used</span>
      </div>
    </Card>
  );
}

export default function BillingPage() {
  const { pushToast } = useToast();
  const [sub, setSub] = useState(null);
  const [modules, setModules] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [usage, setUsage] = useState(null);
  const [plans, setPlans] = useState([]);
  const [availableModules, setAvailableModules] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const [cur, inv, usg, catalog] = await Promise.all([
        api.get('/v1/subscription/current'),
        api.get('/v1/subscription/invoices'),
        api.get('/v1/subscription/usage'),
        api.get('/v1/subscription/plans'),
      ]);
      setSub(cur.data.subscription);
      setModules(cur.data.active_modules || []);
      setInvoices(inv.data.data || []);
      setUsage(usg.data);
      setPlans(catalog.data.plans || []);
      setAvailableModules(catalog.data.modules || []);
    } catch (e) {
      pushToast({ title: 'Failed to load billing data', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Loading…</div>;

  const planName = sub?.plan_name || 'Free';
  const maxUsers = sub?.max_users || 5;
  const userCount = usage?.user_count || 0;

  return (
    <div style={{ padding: '0 0 48px' }}>
      <PageHeader title="Billing & Subscription" sanskrit="शुल्क" lede="Manage your plan, modules, and invoices" />

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
        <StatTile label="Current Plan" value={planName} />
        <StatTile label="Users" value={`${userCount} / ${maxUsers}`} />
        <StatTile label="Status" value={sub?.status || 'active'} />
        <StatTile label="Active Modules" value={modules.length} />
      </div>

      {/* Active modules */}
      <Card title="Active Modules" style={{ marginBottom: 24 }}>
        {modules.length === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No add-on modules activated. Contact your admin to enable modules.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {modules.map(m => (
              <span key={m} style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px',
                borderRadius: 99, background: 'var(--k-primary-ghost)', color: 'var(--k-primary)' }}>
                {m.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* Credit usage */}
      <CreditUsage />

      {/* Usage report download */}
      <Card title="Usage Report" style={{ marginBottom: 24 }}>
        <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: '0 0 12px' }}>
          Download a detailed credit usage report for your records.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['7d', '30d', '90d', 'ytd'].map(p => (
            <button key={p} className="k-btn k-btn--sm k-btn--ghost"
              onClick={async () => {
                try {
                  const res = await api.get(`/v1/subscription/cost-report/pdf?period=${p}`, { responseType: 'blob' });
                  const url = URL.createObjectURL(res.data);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `UsageReport-${p}.pdf`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch { pushToast({ title: 'Report generation failed', type: 'error' }); }
              }}>
              ↓ {p === 'ytd' ? 'Year to Date' : p === '7d' ? 'Last 7 days' : p === '30d' ? 'Last 30 days' : 'Last 90 days'}
            </button>
          ))}
        </div>
      </Card>

      {/* Invoice history */}
      <Card title="Invoice History">
        {invoices.length === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No invoices yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                {['Invoice #', 'Period', 'Total', 'GST', 'Status', 'Due Date'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{inv.invoice_number}</td>
                  <td style={{ padding: '10px 12px' }}>{inv.period_start} → {inv.period_end}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>₹{inv.total?.toLocaleString('en-IN')}</td>
                  <td style={{ padding: '10px 12px' }}>₹{inv.gst?.toLocaleString('en-IN')}</td>
                  <td style={{ padding: '10px 12px' }}><Badge status={inv.payment_status} /></td>
                  <td style={{ padding: '10px 12px' }}>{inv.due_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
