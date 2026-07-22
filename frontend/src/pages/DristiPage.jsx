import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile, TabBar, Section, Badge, Shimmer, Empty, DataTable, Td } from '../components/editorial';

const FMT = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const PCT = v => `${Number(v || 0).toFixed(1)}%`;

const TABS = ['overview', 'revenue', 'pipeline', 'hr', 'sales', 'reports', 'dashboards', 'pivot'];

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
      {tab === 'reports' && <ReportsTab />}
      {tab === 'dashboards' && <DashboardsTab />}
      {tab === 'pivot' && <PivotTab />}
    </div>
  );
}

function OverviewTab() {
  const [data, setData] = useState(null);
  const { pushToast } = useToast();
  useEffect(() => { api.get('/v1/dristi/overview').then(r => setData(r.data)).catch(e => pushToast({ type: 'error', title: e.message })); }, []);
  if (!data) return <Shimmer count={8} />;
  const crm = data.crm || {}, deals = data.deals || {}, revenue = data.revenue || {};
  const hr = data.hr || {}, orders = data.orders || {}, payroll = data.payroll || {}, tasks = data.tasks || {};
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
  const { pushToast } = useToast();
  useEffect(() => { api.get('/v1/dristi/revenue').then(r => setData(r.data)).catch(e => pushToast({ type: 'error', title: e.message })); }, []);
  if (!data) return <Shimmer count={4} />;
  return (
    <Section title="Revenue Trend" hi="राजस्व रुझान">
      <DataTable columns={['Month', { label: 'Invoiced', align: 'right' }, { label: 'Collected', align: 'right' }, { label: 'Expenses', align: 'right' }, { label: 'Profit', align: 'right' }]}>
        {(data.trend || []).map(r => (
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
  const { pushToast } = useToast();
  useEffect(() => { api.get('/v1/dristi/pipeline').then(r => setData(r.data)).catch(e => pushToast({ type: 'error', title: e.message })); }, []);
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
          {(data.stages || []).map(s => (
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
          {(data.top_contacts || []).map((c, i) => (
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
  const { pushToast } = useToast();
  useEffect(() => { api.get('/v1/dristi/hr').then(r => setData(r.data)).catch(e => pushToast({ type: 'error', title: e.message })); }, []);
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
          {(data.departments || []).map(d => (
            <div key={d.department} className="k-stat">
              <div className="k-stat__lbl"><span>{d.department}</span></div>
              <div className="k-stat__val" style={{ fontSize: 28 }}>{d.count}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Payroll Trend" hi="वेतन रुझान">
        <DataTable columns={['Month', { label: 'Gross', align: 'right' }, { label: 'Net', align: 'right' }, { label: 'PF', align: 'right' }, { label: 'ESI', align: 'right' }, { label: 'TDS', align: 'right' }, { label: 'Employees', align: 'right' }]}>
          {(data.payroll_trend || []).map(r => (
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
  const { pushToast } = useToast();
  useEffect(() => { api.get('/v1/dristi/sales').then(r => setData(r.data)).catch(e => pushToast({ type: 'error', title: e.message })); }, []);
  if (!data) return <Shimmer count={4} />;
  return (
    <>
      <Section title="Order Trend" hi="आदेश रुझान">
        <DataTable columns={['Month', { label: 'Orders', align: 'right' }, { label: 'Value', align: 'right' }]}>
          {(data.order_trend || []).map(r => (
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
          {(data.status_split || []).map(s => (
            <div key={s.status} className="k-stat">
              <div className="k-stat__lbl"><span style={{ textTransform: 'capitalize' }}>{s.status}</span></div>
              <div className="k-stat__val" style={{ fontSize: 28 }}>{s.count}</div>
              <div className="k-stat__sub">{FMT(s.value)}</div>
            </div>
          ))}
        </div>
      </Section>

      {(data.leaderboard || []).length > 0 && (
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

const FREQ_COLORS = { daily: '#6366f1', weekly: '#0082c6', monthly: '#10b981' };
const REPORT_TYPES = ['overview', 'revenue', 'pipeline', 'hr', 'sales', 'custom'];
const FREQUENCIES = ['daily', 'weekly', 'monthly'];
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ReportsTab() {
  const [reports, setReports] = useState(null);
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [logs, setLogs] = useState(null);
  const { pushToast } = useToast();

  const load = () => api.get('/v1/dristi/scheduled-reports').then(r => { setReports(Array.isArray(r.data) ? r.data : []); }).catch(() => setReports([]));
  useEffect(() => { load(); }, []);

  const runNow = async (id) => {
    try { await api.post(`/v1/dristi/scheduled-reports/${id}/run-now`); pushToast({ type: 'success', title: 'Report triggered' }); } catch (e) { pushToast({ type: 'error', title: e.message }); }
  };

  const remove = async (id) => {
    try { await api.delete(`/v1/dristi/scheduled-reports/${id}`); pushToast({ type: 'success', title: 'Deleted' }); if (view === 'detail') { setView('list'); setSelected(null); } load(); } catch (e) { pushToast({ type: 'error', title: e.message }); }
  };

  const toggleActive = async (r) => {
    try { await api.patch(`/v1/dristi/scheduled-reports/${r.id}`, { is_active: !r.is_active }); load(); } catch (e) { pushToast({ type: 'error', title: e.message }); }
  };

  const openDetail = async (r) => {
    setSelected(r); setView('detail'); setLogs(null);
    api.get(`/v1/dristi/scheduled-reports/${r.id}/logs`).then(res => setLogs(res.data)).catch(e => pushToast({ type: 'error', title: e.message }));
  };

  const openCreate = () => {
    setForm({ name: '', report_type: 'overview', frequency: 'weekly', day_of_week: null, day_of_month: null, time_utc: '08:00', recipients: '', file_formats: ['pdf'] });
    setView('create');
  };

  const submitCreate = async () => {
    const recipients = form.recipients.split('\n').map(s => s.trim()).filter(Boolean);
    if (!form.name.trim() || recipients.length === 0) { pushToast({ type: 'error', title: 'Name and at least one recipient required' }); return; }
    try {
      await api.post('/v1/dristi/scheduled-reports', {
        name: form.name.trim(), report_type: form.report_type, frequency: form.frequency,
        day_of_week: form.frequency === 'weekly' ? Number(form.day_of_week) : null,
        day_of_month: form.frequency === 'monthly' ? Number(form.day_of_month) : null,
        time_utc: form.time_utc, file_formats: form.file_formats, recipients, dashboard_id: null, filters: {}
      });
      pushToast({ type: 'success', title: 'Report scheduled' }); setView('list'); load();
    } catch (e) { pushToast({ type: 'error', title: e.message }); }
  };

  const exportCSV = (type) => {
    window.open(`/v1/dristi/exports/${type}?format=csv`, '_blank');
  };

  if (!reports) return <Shimmer count={4} />;

  if (view === 'create') return (
    <div>
      <button className="k-btn k-btn--ghost" onClick={() => setView('list')} style={{ fontSize: 13, marginBottom: 16 }}>← Back</button>
      <Section title="Schedule Report" hi="रिपोर्ट अनुसूची">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 480 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Name
            <input className="k-formpanel__input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ marginTop: 4, width: '100%' }} />
          </label>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Report Type
            <select className="k-formpanel__input" value={form.report_type} onChange={e => setForm({ ...form, report_type: e.target.value })} style={{ marginTop: 4, width: '100%' }}>
              {REPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Frequency
            <select className="k-formpanel__input" value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} style={{ marginTop: 4, width: '100%' }}>
              {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          {form.frequency === 'weekly' && (
            <label style={{ fontSize: 13, fontWeight: 600 }}>Day of Week
              <select className="k-formpanel__input" value={form.day_of_week ?? ''} onChange={e => setForm({ ...form, day_of_week: e.target.value })} style={{ marginTop: 4, width: '100%' }}>
                <option value="">Select…</option>
                {DAYS_OF_WEEK.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </label>
          )}
          {form.frequency === 'monthly' && (
            <label style={{ fontSize: 13, fontWeight: 600 }}>Day of Month
              <input className="k-formpanel__input" type="number" min={1} max={31} value={form.day_of_month ?? ''} onChange={e => setForm({ ...form, day_of_month: e.target.value })} style={{ marginTop: 4, width: '100%' }} />
            </label>
          )}
          <label style={{ fontSize: 13, fontWeight: 600 }}>Time (UTC)
            <input className="k-formpanel__input" type="time" value={form.time_utc} onChange={e => setForm({ ...form, time_utc: e.target.value })} style={{ marginTop: 4, width: '100%' }} />
          </label>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Recipients (one email per line)
            <textarea className="k-formpanel__input" rows={3} value={form.recipients} onChange={e => setForm({ ...form, recipients: e.target.value })} style={{ marginTop: 4, width: '100%' }} />
          </label>
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>File Formats</legend>
            {['pdf', 'csv', 'json'].map(fmt => (
              <label key={fmt} style={{ marginRight: 16, fontSize: 13 }}>
                <input type="checkbox" checked={form.file_formats.includes(fmt)} onChange={e => {
                  const next = e.target.checked ? [...form.file_formats, fmt] : form.file_formats.filter(f => f !== fmt);
                  setForm({ ...form, file_formats: next });
                }} style={{ marginRight: 4 }} />
                {fmt.toUpperCase()}
              </label>
            ))}
          </fieldset>
          <button className="k-btn k-btn--primary" onClick={submitCreate} style={{ fontSize: 13, alignSelf: 'flex-start' }}>Schedule</button>
        </div>
      </Section>
    </div>
  );

  if (view === 'detail' && selected) return (
    <div>
      <button className="k-btn k-btn--ghost" onClick={() => { setView('list'); setSelected(null); }} style={{ fontSize: 13, marginBottom: 16 }}>← Back</button>
      <Section title={selected.name} hi="रिपोर्ट विवरण">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <Badge color={FREQ_COLORS[selected.frequency]}>{selected.frequency}</Badge>
          <Badge>{selected.report_type}</Badge>
          <span style={{ fontSize: 13 }}>{selected.recipients?.length || 0} recipient(s)</span>
          {selected.last_sent_at && <span style={{ fontSize: 12, color: 'var(--k-muted)' }}>Last sent: {new Date(selected.last_sent_at).toLocaleString()}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <button className="k-btn k-btn--primary" onClick={() => runNow(selected.id)} style={{ fontSize: 13 }}>Run Now</button>
          <button onClick={() => remove(selected.id)} style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Delete</button>
        </div>
      </Section>
      <Section title="Delivery Logs" hi="वितरण लॉग">
        {!logs ? <Shimmer count={3} /> : logs.length === 0 ? <Empty icon="📬" title="No logs yet" sub="Logs will appear after the report has been sent." /> : (
          <DataTable columns={['Sent At', 'Status', { label: 'Recipients', align: 'right' }, 'Error']}>
            {logs.map((l, i) => (
              <tr key={i}>
                <td style={{ fontSize: 13 }}>{new Date(l.sent_at).toLocaleString()}</td>
                <td><Badge color={l.status === 'sent' ? '#10b981' : '#ef4444'}>{l.status}</Badge></td>
                <Td align="right">{l.recipients_count}</Td>
                <td style={{ fontSize: 12, color: '#ef4444' }}>{l.error || '—'}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="k-btn k-btn--primary" onClick={openCreate} style={{ fontSize: 13 }}>+ Schedule Report</button>
      </div>
      {reports.length === 0 ? (
        <Empty icon="📅" title="No scheduled reports" sub="Schedule automated report delivery to your team via email." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {reports.map(r => (
            <div key={r.id} className="k-modcard" style={{ cursor: 'pointer' }} onClick={() => openDetail(r)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Badge>{r.report_type}</Badge>
                  <Badge color={FREQ_COLORS[r.frequency]}>{r.frequency}</Badge>
                  <span style={{ fontSize: 12, color: 'var(--k-muted)' }}>{r.recipients?.length || 0} recipient(s)</span>
                  {r.last_sent_at && <span style={{ fontSize: 11, color: 'var(--k-muted)' }}>Last: {new Date(r.last_sent_at).toLocaleString()}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                <button onClick={() => toggleActive(r)} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--k-border)', background: r.is_active ? '#10b981' : 'var(--k-bg-2)', color: r.is_active ? '#fff' : 'var(--k-fg)', cursor: 'pointer' }}>{r.is_active ? 'Active' : 'Paused'}</button>
                <button className="k-btn k-btn--ghost" onClick={() => runNow(r.id)} style={{ fontSize: 12 }}>Run Now</button>
                <button onClick={() => remove(r.id)} style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Section title="Export Data" hi="डेटा निर्यात" style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['overview', 'revenue', 'pipeline', 'hr', 'sales'].map(t => (
            <button key={t} className="k-btn k-btn--ghost" onClick={() => exportCSV(t)} style={{ fontSize: 13, textTransform: 'capitalize' }}>📥 {t} CSV</button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function DashboardsTab() {
  const [dashboards, setDashboards] = useState([]);
  const [name, setName] = useState('');
  const { pushToast } = useToast();

  const load = () => api.get('/v1/dristi/dashboards').then(r => setDashboards(Array.isArray(r.data) ? r.data : [])).catch(() => setDashboards([]));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    await api.post('/v1/dristi/dashboards', { name: name.trim(), widgets: [] });
    setName(''); load();
    pushToast({ type: 'success', title: 'Dashboard created' });
  };

  const remove = async (id) => {
    await api.delete(`/v1/dristi/dashboards/${id}`);
    load(); pushToast({ type: 'success', title: 'Deleted' });
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


function PivotTab() {
  const { pushToast } = useToast();
  const [meta, setMeta] = useState(null);
  const [source, setSource] = useState('invoices');
  const [groupBy, setGroupBy] = useState('');
  const [measure, setMeasure] = useState('count');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get('/v1/dristi/widget-types').then(r => setMeta(r.data)).catch(() => {}); }, []);

  const sourceColumns = {
    invoices: ['invoice_date','invoice_type','total','payment_status','currency'],
    deals: ['stage','value','expected_close'],
    contacts: ['contact_type','source','company','lead_score'],
    orders: ['order_date','status','total'],
    employees: ['department','designation','employment_type','status'],
    expenses: ['category','amount','total','expense_date','status'],
    tickets: ['priority','status','category'],
    events: ['event_type','status'],
  };

  async function runQuery() {
    setLoading(true);
    try {
      const r = await api.post('/v1/dristi/query', { source, group_by: groupBy, measure, date_from: dateFrom, date_to: dateTo });
      setResult(r.data);
    } catch (e) { pushToast({ title: e.response?.data?.detail || 'Query failed', type: 'error' }); }
    setLoading(false);
  }

  return (
    <Section title="Pivot Query Builder" hi="विश्लेषण निर्माता">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Source
          <select value={source} onChange={e => { setSource(e.target.value); setGroupBy(''); }} className="k-input" style={{ minWidth: 140 }}>
            {(meta?.sources || Object.keys(sourceColumns)).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Group By
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)} className="k-input" style={{ minWidth: 140 }}>
            <option value="">— none —</option>
            {(sourceColumns[source] || []).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Measure
          <select value={measure} onChange={e => setMeasure(e.target.value)} className="k-input" style={{ minWidth: 100 }}>
            <option value="count">Count</option>
            <option value="sum">Sum</option>
            <option value="avg">Average</option>
          </select>
        </label>
        <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          From
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="k-input" />
        </label>
        <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          To
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="k-input" />
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button onClick={runQuery} disabled={loading} className="k-btn k-btn--primary">{loading ? 'Running…' : 'Run Query'}</button>
        </div>
      </div>

      {result && (
        <div style={{ marginTop: 8 }}>
          {Array.isArray(result.data) ? (
            <DataTable cols={['Label', 'Value']}>
              {result.data.map((r, i) => (
                <tr key={i}><Td>{String(r.label ?? '—')}</Td><Td>{typeof r.value === 'number' && r.value > 100 ? FMT(r.value) : r.value}</Td></tr>
              ))}
            </DataTable>
          ) : (
            <div className="k-stats">
              <StatTile label="Result" value={typeof result.data.value === 'number' && result.data.value > 100 ? FMT(result.data.value) : result.data.value} variant="blue" />
              <StatTile label="Count" value={result.data.count || 0} />
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
