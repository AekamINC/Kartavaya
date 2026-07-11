import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';

const FMT = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const PCT = v => `${Number(v || 0).toFixed(1)}%`;

const TABS = ['overview', 'revenue', 'pipeline', 'hr', 'sales', 'dashboards'];

export default function DristiPage() {
  const [tab, setTab] = useState('overview');
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px 48px' }}>
      <PageHeader title="Dristi · दृष्टि" subtitle="Analytics — Cross-module KPIs & Trends" />
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
      {tab === 'overview' && <OverviewTab />}
      {tab === 'revenue' && <RevenueTab />}
      {tab === 'pipeline' && <PipelineTab />}
      {tab === 'hr' && <HRTab />}
      {tab === 'sales' && <SalesTab />}
      {tab === 'dashboards' && <DashboardsTab />}
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────

function OverviewTab() {
  const [data, setData] = useState(null);
  const toast = useToast();
  useEffect(() => { api.get('/api/v1/dristi/overview').then(setData).catch(e => toast.error(e.message)); }, []);
  if (!data) return <p style={{ color: 'var(--ink-3)' }}>Loading...</p>;
  const { crm, deals, revenue, hr, orders, payroll, tasks } = data;
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--ink-2)' }}>CRM & Sales</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatTile label="Contacts" value={crm.total_contacts || 0} />
        <StatTile label="Leads" value={crm.leads || 0} />
        <StatTile label="Customers" value={crm.customers || 0} />
        <StatTile label="Pipeline" value={FMT(deals.pipeline_value)} />
        <StatTile label="Won Deals" value={deals.won_deals || 0} />
        <StatTile label="Won Value" value={FMT(deals.won_value)} />
        <StatTile label="Win Rate" value={PCT((deals.won_deals / Math.max(deals.total_deals, 1)) * 100)} />
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--ink-2)' }}>Finance & Orders</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatTile label="Invoiced" value={FMT(revenue.total_invoiced)} />
        <StatTile label="Collected" value={FMT(revenue.total_collected)} />
        <StatTile label="Outstanding" value={FMT(revenue.outstanding)} />
        <StatTile label="Orders" value={orders.total_orders || 0} />
        <StatTile label="Order Value" value={FMT(orders.order_value)} />
        <StatTile label="Fulfilled" value={orders.fulfilled || 0} />
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--ink-2)' }}>HR & Payroll</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatTile label="Headcount" value={hr.headcount || 0} />
        <StatTile label="YTD Payroll" value={FMT(payroll.ytd_payroll)} />
        <StatTile label="YTD Statutory" value={FMT(payroll.ytd_statutory)} />
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--ink-2)' }}>Tasks</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        <StatTile label="Total Tasks" value={tasks.total_tasks || 0} />
        <StatTile label="Active" value={tasks.active_tasks || 0} />
        <StatTile label="Done" value={tasks.done_tasks || 0} />
        <StatTile label="Overdue" value={tasks.overdue_tasks || 0} />
      </div>
    </div>
  );
}

// ── Revenue ─────────────────────────────────────────────────

function RevenueTab() {
  const [data, setData] = useState(null);
  const toast = useToast();
  useEffect(() => { api.get('/api/v1/dristi/revenue').then(setData).catch(e => toast.error(e.message)); }, []);
  if (!data) return <p style={{ color: 'var(--ink-3)' }}>Loading...</p>;
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Revenue Trend (6 months)</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
            <th style={TH}>Month</th><th style={TH}>Invoiced</th><th style={TH}>Collected</th><th style={TH}>Expenses</th><th style={TH}>Profit</th>
          </tr></thead>
          <tbody>
            {data.trend.map(r => (
              <tr key={r.month} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={TD}>{r.month}</td>
                <td style={TD}>{FMT(r.invoiced)}</td>
                <td style={TD}>{FMT(r.collected)}</td>
                <td style={TD}>{FMT(r.expenses)}</td>
                <td style={{ ...TD, color: r.profit >= 0 ? '#10b981' : '#ef4444' }}>{FMT(r.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Pipeline ────────────────────────────────────────────────

function PipelineTab() {
  const [data, setData] = useState(null);
  const toast = useToast();
  useEffect(() => { api.get('/api/v1/dristi/pipeline').then(setData).catch(e => toast.error(e.message)); }, []);
  if (!data) return <p style={{ color: 'var(--ink-3)' }}>Loading...</p>;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatTile label="Total Deals" value={data.conversion.total || 0} />
        <StatTile label="Won" value={data.conversion.won || 0} />
        <StatTile label="Lost" value={data.conversion.lost || 0} />
        <StatTile label="Win Rate" value={`${data.conversion.win_rate || 0}%`} />
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Stage Breakdown</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        {data.stages.map(s => (
          <div key={s.stage} style={{ background: 'var(--surface-2)', padding: '12px 16px', borderRadius: 8, minWidth: 140 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>{s.stage}</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{s.count}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{FMT(s.value)}</div>
          </div>
        ))}
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Top Customers (by Won Value)</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
            <th style={TH}>Name</th><th style={TH}>Company</th><th style={TH}>Deals</th><th style={TH}>Total Value</th>
          </tr></thead>
          <tbody>
            {data.top_contacts.map((c, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={TD}>{c.name}</td><td style={TD}>{c.company || '-'}</td>
                <td style={TD}>{c.deal_count}</td><td style={TD}>{FMT(c.total_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── HR ──────────────────────────────────────────────────────

function HRTab() {
  const [data, setData] = useState(null);
  const toast = useToast();
  useEffect(() => { api.get('/api/v1/dristi/hr').then(setData).catch(e => toast.error(e.message)); }, []);
  if (!data) return <p style={{ color: 'var(--ink-3)' }}>Loading...</p>;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatTile label="Leave Approved" value={data.leave_stats.approved || 0} />
        <StatTile label="Leave Pending" value={data.leave_stats.pending || 0} />
        <StatTile label="Present (30d)" value={data.attendance_30d.present_days || 0} />
        <StatTile label="Absent (30d)" value={data.attendance_30d.absent_days || 0} />
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Department Headcount</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        {data.departments.map(d => (
          <div key={d.department} style={{ background: 'var(--surface-2)', padding: '10px 16px', borderRadius: 8, minWidth: 120 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{d.department}</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{d.count}</div>
          </div>
        ))}
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Payroll Trend</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
            <th style={TH}>Month</th><th style={TH}>Gross</th><th style={TH}>Net</th><th style={TH}>PF</th><th style={TH}>ESI</th><th style={TH}>TDS</th><th style={TH}>Employees</th>
          </tr></thead>
          <tbody>
            {data.payroll_trend.map(r => (
              <tr key={r.month} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={TD}>{r.month}</td><td style={TD}>{FMT(r.total_gross)}</td>
                <td style={TD}>{FMT(r.total_net)}</td><td style={TD}>{FMT(r.total_pf)}</td>
                <td style={TD}>{FMT(r.total_esi)}</td><td style={TD}>{FMT(r.total_tds)}</td>
                <td style={TD}>{r.employee_count || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Sales ───────────────────────────────────────────────────

function SalesTab() {
  const [data, setData] = useState(null);
  const toast = useToast();
  useEffect(() => { api.get('/api/v1/dristi/sales').then(setData).catch(e => toast.error(e.message)); }, []);
  if (!data) return <p style={{ color: 'var(--ink-3)' }}>Loading...</p>;
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Order Trend (6 months)</h3>
      <div style={{ overflowX: 'auto', marginBottom: 24 }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
            <th style={TH}>Month</th><th style={TH}>Orders</th><th style={TH}>Value</th>
          </tr></thead>
          <tbody>
            {data.order_trend.map(r => (
              <tr key={r.month} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={TD}>{r.month}</td><td style={TD}>{r.orders}</td><td style={TD}>{FMT(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Order Status Split</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        {data.status_split.map(s => (
          <div key={s.status} style={{ background: 'var(--surface-2)', padding: '10px 16px', borderRadius: 8, minWidth: 120 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', textTransform: 'capitalize' }}>{s.status}</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{s.count}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{FMT(s.value)}</div>
          </div>
        ))}
      </div>
      {data.leaderboard.length > 0 && <>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Sales Leaderboard</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              <th style={TH}>Name</th><th style={TH}>Target</th><th style={TH}>Actual</th><th style={TH}>Achievement</th>
            </tr></thead>
            <tbody>
              {data.leaderboard.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={TD}>{r.name}</td><td style={TD}>{FMT(r.target_amount)}</td>
                  <td style={TD}>{FMT(r.actual_amount)}</td><td style={TD}>{r.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  );
}

// ── Saved Dashboards ────────────────────────────────────────

function DashboardsTab() {
  const [dashboards, setDashboards] = useState([]);
  const [name, setName] = useState('');
  const toast = useToast();

  const load = () => api.get('/api/v1/dristi/dashboards').then(r => setDashboards(r.data)).catch(e => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    await api.post('/api/v1/dristi/dashboards', { name: name.trim(), widgets: [] });
    setName(''); load();
    toast.success('Dashboard created');
  };

  const remove = async (id) => {
    await api.delete(`/api/v1/dristi/dashboards/${id}`);
    load(); toast.success('Deleted');
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New dashboard name..."
          style={{ flex: 1, padding: '8px 12px', fontSize: 13, border: '1px solid var(--rule-soft)', borderRadius: 6, background: 'var(--surface-1)' }} />
        <button onClick={create} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--k-primary)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Create</button>
      </div>
      {dashboards.length === 0 && <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No saved dashboards yet.</p>}
      {dashboards.map(d => (
        <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', marginBottom: 8, background: 'var(--surface-2)', borderRadius: 8 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{d.name}</div>
            {d.is_default && <span style={{ fontSize: 10, color: 'var(--k-primary)' }}>DEFAULT</span>}
          </div>
          <button onClick={() => remove(d.id)} style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>
        </div>
      ))}
    </div>
  );
}

// ── Shared styles ───────────────────────────────────────────
const TH = { textAlign: 'left', padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' };
const TD = { padding: '8px 12px' };
