import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile, TabBar, Section, Badge, Shimmer, Empty, DataTable, Td } from '../components/editorial';

const FMT = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const PCT = v => `${Number(v || 0).toFixed(1)}%`;

const TABS = ['overview', 'revenue', 'pipeline', 'hr', 'sales', 'dashboards'];

export default function DristiPage() {
  const [tab, setTab] = useState('overview');
  return (
    <div style={{ padding: '0 0 48px' }}>
      <PageHeader title="Dristi" sanskrit="दृष्टि" lede="Analytics — Cross-module KPIs & Trends" />
      <TabBar tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'overview' && <OverviewTab />}
      {tab === 'revenue' && <RevenueTab />}
      {tab === 'pipeline' && <PipelineTab />}
      {tab === 'hr' && <HRTab />}
      {tab === 'sales' && <SalesTab />}
      {tab === 'dashboards' && <DashboardsTab />}
    </div>
  );
}

function OverviewTab() {
  const [data, setData] = useState(null);
  const toast = useToast();
  useEffect(() => { api.get('/api/v1/dristi/overview').then(setData).catch(e => toast.error(e.message)); }, []);
  if (!data) return <Shimmer count={8} />;
  const { crm, deals, revenue, hr, orders, payroll, tasks } = data;
  return (
    <>
      <Section title="CRM & Sales" hi="ग्राहक व बिक्री">
        <div className="k-stats">
          <StatTile label="Contacts" value={crm.total_contacts || 0} />
          <StatTile label="Leads" value={crm.leads || 0} />
          <StatTile label="Customers" value={crm.customers || 0} />
          <StatTile label="Pipeline" value={FMT(deals.pipeline_value)} variant="blue" />
        </div>
        <div className="k-stats" style={{ marginTop: 12 }}>
          <StatTile label="Won Deals" value={deals.won_deals || 0} variant="teal" />
          <StatTile label="Won Value" value={FMT(deals.won_value)} variant="teal" />
          <StatTile label="Win Rate" value={PCT((deals.won_deals / Math.max(deals.total_deals, 1)) * 100)} />
        </div>
      </Section>

      <Section title="Finance & Orders" hi="वित्त व आदेश">
        <div className="k-stats">
          <StatTile label="Invoiced" value={FMT(revenue.total_invoiced)} />
          <StatTile label="Collected" value={FMT(revenue.total_collected)} variant="teal" />
          <StatTile label="Outstanding" value={FMT(revenue.outstanding)} variant="amber" />
          <StatTile label="Orders" value={orders.total_orders || 0} />
        </div>
        <div className="k-stats" style={{ marginTop: 12 }}>
          <StatTile label="Order Value" value={FMT(orders.order_value)} />
          <StatTile label="Fulfilled" value={orders.fulfilled || 0} variant="teal" />
        </div>
      </Section>

      <Section title="HR & Payroll" hi="मानव व वेतन">
        <div className="k-stats">
          <StatTile label="Headcount" value={hr.headcount || 0} />
          <StatTile label="YTD Payroll" value={FMT(payroll.ytd_payroll)} />
          <StatTile label="YTD Statutory" value={FMT(payroll.ytd_statutory)} variant="amber" />
        </div>
      </Section>

      <Section title="Tasks" hi="कार्य">
        <div className="k-stats">
          <StatTile label="Total Tasks" value={tasks.total_tasks || 0} />
          <StatTile label="Active" value={tasks.active_tasks || 0} variant="blue" />
          <StatTile label="Done" value={tasks.done_tasks || 0} variant="teal" />
          <StatTile label="Overdue" value={tasks.overdue_tasks || 0} variant="red" />
        </div>
      </Section>
    </>
  );
}

function RevenueTab() {
  const [data, setData] = useState(null);
  const toast = useToast();
  useEffect(() => { api.get('/api/v1/dristi/revenue').then(setData).catch(e => toast.error(e.message)); }, []);
  if (!data) return <Shimmer count={4} />;
  return (
    <Section title="Revenue Trend" hi="राजस्व रुझान">
      <DataTable columns={['Month', { label: 'Invoiced', align: 'right' }, { label: 'Collected', align: 'right' }, { label: 'Expenses', align: 'right' }, { label: 'Profit', align: 'right' }]}>
        {data.trend.map(r => (
          <tr key={r.month}>
            <td>{r.month}</td>
            <Td align="right" mono>{FMT(r.invoiced)}</Td>
            <Td align="right" mono>{FMT(r.collected)}</Td>
            <Td align="right" mono>{FMT(r.expenses)}</Td>
            <Td align="right" mono bold color={r.profit >= 0 ? '#10b981' : '#ef4444'}>{FMT(r.profit)}</Td>
          </tr>
        ))}
      </DataTable>
    </Section>
  );
}

function PipelineTab() {
  const [data, setData] = useState(null);
  const toast = useToast();
  useEffect(() => { api.get('/api/v1/dristi/pipeline').then(setData).catch(e => toast.error(e.message)); }, []);
  if (!data) return <Shimmer count={4} />;
  return (
    <>
      <Section title="Conversion" hi="रूपांतरण">
        <div className="k-stats">
          <StatTile label="Total Deals" value={data.conversion.total || 0} />
          <StatTile label="Won" value={data.conversion.won || 0} variant="teal" />
          <StatTile label="Lost" value={data.conversion.lost || 0} variant="red" />
          <StatTile label="Win Rate" value={`${data.conversion.win_rate || 0}%`} variant="blue" />
        </div>
      </Section>

      <Section title="Stage Breakdown" hi="चरण विवरण">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          {data.stages.map(s => (
            <div key={s.stage} className="k-stat">
              <div className="k-stat__lbl"><span>{s.stage}</span></div>
              <div className="k-stat__val" style={{ fontSize: 28 }}>{s.count}</div>
              <div className="k-stat__sub">{FMT(s.value)}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Top Customers" hi="शीर्ष ग्राहक">
        <DataTable columns={['Name', 'Company', { label: 'Deals', align: 'right' }, { label: 'Total Value', align: 'right' }]}>
          {data.top_contacts.map((c, i) => (
            <tr key={i}>
              <td>{c.name}</td>
              <td>{c.company || '—'}</td>
              <Td align="right">{c.deal_count}</Td>
              <Td align="right" mono bold>{FMT(c.total_value)}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </>
  );
}

function HRTab() {
  const [data, setData] = useState(null);
  const toast = useToast();
  useEffect(() => { api.get('/api/v1/dristi/hr').then(setData).catch(e => toast.error(e.message)); }, []);
  if (!data) return <Shimmer count={4} />;
  return (
    <>
      <Section title="Leave & Attendance" hi="अवकाश व उपस्थिति">
        <div className="k-stats">
          <StatTile label="Leave Approved" value={data.leave_stats.approved || 0} variant="teal" />
          <StatTile label="Leave Pending" value={data.leave_stats.pending || 0} variant="amber" />
          <StatTile label="Present (30d)" value={data.attendance_30d.present_days || 0} variant="teal" />
          <StatTile label="Absent (30d)" value={data.attendance_30d.absent_days || 0} variant="red" />
        </div>
      </Section>

      <Section title="Department Headcount" hi="विभाग संख्या">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {data.departments.map(d => (
            <div key={d.department} className="k-stat">
              <div className="k-stat__lbl"><span>{d.department}</span></div>
              <div className="k-stat__val" style={{ fontSize: 28 }}>{d.count}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Payroll Trend" hi="वेतन रुझान">
        <DataTable columns={['Month', { label: 'Gross', align: 'right' }, { label: 'Net', align: 'right' }, { label: 'PF', align: 'right' }, { label: 'ESI', align: 'right' }, { label: 'TDS', align: 'right' }, { label: 'Employees', align: 'right' }]}>
          {data.payroll_trend.map(r => (
            <tr key={r.month}>
              <td>{r.month}</td>
              <Td align="right" mono>{FMT(r.total_gross)}</Td>
              <Td align="right" mono>{FMT(r.total_net)}</Td>
              <Td align="right" mono>{FMT(r.total_pf)}</Td>
              <Td align="right" mono>{FMT(r.total_esi)}</Td>
              <Td align="right" mono>{FMT(r.total_tds)}</Td>
              <Td align="right">{r.employee_count || '—'}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </>
  );
}

function SalesTab() {
  const [data, setData] = useState(null);
  const toast = useToast();
  useEffect(() => { api.get('/api/v1/dristi/sales').then(setData).catch(e => toast.error(e.message)); }, []);
  if (!data) return <Shimmer count={4} />;
  return (
    <>
      <Section title="Order Trend" hi="आदेश रुझान">
        <DataTable columns={['Month', { label: 'Orders', align: 'right' }, { label: 'Value', align: 'right' }]}>
          {data.order_trend.map(r => (
            <tr key={r.month}>
              <td>{r.month}</td>
              <Td align="right">{r.orders}</Td>
              <Td align="right" mono bold>{FMT(r.value)}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section title="Order Status Split" hi="स्थिति विभाजन">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {data.status_split.map(s => (
            <div key={s.status} className="k-stat">
              <div className="k-stat__lbl"><span style={{ textTransform: 'capitalize' }}>{s.status}</span></div>
              <div className="k-stat__val" style={{ fontSize: 28 }}>{s.count}</div>
              <div className="k-stat__sub">{FMT(s.value)}</div>
            </div>
          ))}
        </div>
      </Section>

      {data.leaderboard.length > 0 && (
        <Section title="Sales Leaderboard" hi="बिक्री नेता">
          <DataTable columns={['Name', { label: 'Target', align: 'right' }, { label: 'Actual', align: 'right' }, { label: 'Achievement', align: 'right' }]}>
            {data.leaderboard.map((r, i) => (
              <tr key={i}>
                <td>{r.name}</td>
                <Td align="right" mono>{FMT(r.target_amount)}</Td>
                <Td align="right" mono>{FMT(r.actual_amount)}</Td>
                <Td align="right" bold color={r.pct >= 100 ? '#10b981' : undefined}>{r.pct}%</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </>
  );
}

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
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New dashboard name…"
          className="k-formpanel__input" style={{ flex: 1 }} />
        <button onClick={create} className="k-btn k-btn--primary" style={{ fontSize: 13 }}>Create</button>
      </div>
      {dashboards.length === 0 ? (
        <Empty icon="📊" title="No saved dashboards" sub="Create custom dashboards to track the metrics that matter most to your team." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {dashboards.map(d => (
            <div key={d.id} className="k-modcard" style={{ cursor: 'default' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{d.name}</div>
                {d.is_default && <span style={{ fontSize: 10, color: 'var(--k-primary)', fontWeight: 700, letterSpacing: '.06em' }}>DEFAULT</span>}
              </div>
              <button onClick={() => remove(d.id)} style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
