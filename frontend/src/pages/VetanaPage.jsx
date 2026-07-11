import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';

const RUN_COLORS = { draft: '#6E7B91', processed: '#0082c6', approved: '#8b5cf6', disbursed: '#10b981' };
const PS_COLORS = { generated: '#6E7B91', approved: '#8b5cf6', disbursed: '#10b981' };
const FMT = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;

function Badge({ text, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${color}18`, color }}>{text}</span>
  );
}

const TABS = ['dashboard', 'structures', 'payroll', 'payslips', 'statutory'];

export default function VetanaPage() {
  const [tab, setTab] = useState('dashboard');
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px 48px' }}>
      <PageHeader title="Vetana · वेतन" subtitle="Payroll — Salary Structures, Processing & Compliance" />
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
      {tab === 'structures' && <StructuresTab />}
      {tab === 'payroll' && <PayrollTab />}
      {tab === 'payslips' && <PayslipsTab />}
      {tab === 'statutory' && <StatutoryTab />}
    </div>
  );
}


function DashboardTab() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/v1/vetana/dashboard').then(r => setData(r.data)).catch(() => {}); }, []);
  if (!data) return <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading dashboard…</p>;
  const run = data.latest_run;
  const ytd = data.ytd || {};
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatTile label="Headcount" value={data.headcount} />
        {run && <>
          <StatTile label={`Gross (${run.month})`} value={FMT(run.total_gross)} />
          <StatTile label={`Net Pay (${run.month})`} value={FMT(run.total_net)} />
          <StatTile label="Employees Processed" value={run.employee_count} />
        </>}
        <StatTile label="YTD Gross" value={FMT(ytd.ytd_gross)} />
        <StatTile label="YTD PF" value={FMT(ytd.ytd_pf)} />
        <StatTile label="YTD ESI" value={FMT(ytd.ytd_esi)} />
        <StatTile label="YTD TDS" value={FMT(ytd.ytd_tds)} />
      </div>

      {data.department_split.length > 0 && (
        <div>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Department Split {run && `(${run.month})`}</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--rule-soft)' }}>
                {['Department', 'Employees', 'Gross', 'Net'].map(h => (
                  <th key={h} style={{ textAlign: h === 'Department' ? 'left' : 'right', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.department_split.map((d, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '8px 10px' }}>{d.department || 'Unassigned'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{d.employees}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{FMT(d.dept_gross)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{FMT(d.dept_net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


function StructuresTab() {
  const { pushToast } = useToast();
  const [structures, setStructures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);

  const [form, setForm] = useState({
    employee_id: '', effective_from: '', ctc_annual: 0, basic: 0, hra: 0, da: 0,
    special_allowance: 0, conveyance: 0, medical: 0, pf_enabled: true, esi_enabled: false,
    pt_applicable: true, tds_regime: 'new', notes: '',
  });

  useEffect(() => { load(); }, []);

  async function load() {
    try { const r = await api.get('/v1/vetana/salary-structures'); setStructures(r.data.data || []); } catch {}
    finally { setLoading(false); }
  }

  async function loadEmployees() {
    try { const r = await api.get('/v1/manav/employees'); setEmployees(r.data.data || []); } catch {}
  }

  function autoSplit(ctc) {
    const monthly = ctc / 12;
    const basic = Math.round(monthly * 0.40);
    const hra = Math.round(basic * 0.50);
    const da = Math.round(monthly * 0.05);
    const conv = 1600;
    const med = 1250;
    const special = Math.round(monthly - basic - hra - da - conv - med);
    setForm(f => ({ ...f, ctc_annual: ctc, basic, hra, da, special_allowance: Math.max(special, 0), conveyance: conv, medical: med }));
  }

  async function save(e) {
    e.preventDefault();
    if (!form.employee_id) { pushToast({ title: 'Select an employee', type: 'error' }); return; }
    setSaving(true);
    try {
      await api.post('/v1/vetana/salary-structures', form);
      pushToast({ title: 'Salary structure saved', type: 'success' });
      setShowForm(false);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function loadDetail(id) {
    try { const r = await api.get(`/v1/vetana/salary-structures/${id}`); setDetail(r.data); } catch { pushToast({ title: 'Failed to load', type: 'error' }); }
  }

  if (detail) {
    const s = detail;
    const monthly = Number(s.ctc_annual || 0) / 12;
    return (
      <div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => setDetail(null)}>← Back to list</button>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700 }}>{s.employee_name}</h3>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--ink-3)' }}>Effective from: {s.effective_from} · CTC: {FMT(s.ctc_annual)}/yr ({FMT(monthly)}/mo)</p>

          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Monthly Earnings</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
            <tbody>
              {[['Basic', s.basic], ['HRA', s.hra], ['DA', s.da], ['Special Allowance', s.special_allowance],
                ['Conveyance', s.conveyance], ['Medical', s.medical]].map(([label, val]) => (
                <tr key={label} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '6px 10px' }}>{label}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{FMT(val)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--rule-soft)' }}>
                <td style={{ padding: '8px 10px', fontWeight: 700 }}>Total Monthly</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>
                  {FMT(Number(s.basic || 0) + Number(s.hra || 0) + Number(s.da || 0) + Number(s.special_allowance || 0) + Number(s.conveyance || 0) + Number(s.medical || 0))}
                </td>
              </tr>
            </tbody>
          </table>

          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Statutory Configuration</h4>
          <div style={{ display: 'flex', gap: 16, fontSize: 13, flexWrap: 'wrap' }}>
            <span>PF: {s.pf_enabled ? '✓ Enabled' : '✗ Disabled'}</span>
            <span>ESI: {s.esi_enabled ? '✓ Enabled' : '✗ Disabled'}</span>
            <span>PT: {s.pt_applicable ? '✓ Applicable' : '✗ N/A'}</span>
            <span>TDS Regime: {s.tds_regime === 'new' ? 'New' : 'Old'}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }}
          onClick={() => { setShowForm(!showForm); if (!showForm) loadEmployees(); }}>
          {showForm ? 'Cancel' : '+ New Structure'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 12 }}>Employee
              <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)', marginTop: 4 }}>
                <option value="">Select…</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.full_name || `${emp.first_name} ${emp.last_name}`} ({emp.employee_code})</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12 }}>Effective From
              <input type="date" value={form.effective_from} onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)', marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12 }}>Annual CTC (₹)
              <input type="number" value={form.ctc_annual} onChange={e => autoSplit(Number(e.target.value))}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)', marginTop: 4 }} />
            </label>
          </div>

          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Monthly Breakdown</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
            {[['Basic', 'basic'], ['HRA', 'hra'], ['DA', 'da'], ['Special Allowance', 'special_allowance'], ['Conveyance', 'conveyance'], ['Medical', 'medical']].map(([label, key]) => (
              <label key={key} style={{ fontSize: 12 }}>{label}
                <input type="number" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: Number(e.target.value) }))}
                  style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)', marginTop: 4 }} />
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={form.pf_enabled} onChange={e => setForm(f => ({ ...f, pf_enabled: e.target.checked }))} /> PF Enabled
            </label>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={form.esi_enabled} onChange={e => setForm(f => ({ ...f, esi_enabled: e.target.checked }))} /> ESI Enabled
            </label>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={form.pt_applicable} onChange={e => setForm(f => ({ ...f, pt_applicable: e.target.checked }))} /> Professional Tax
            </label>
            <label style={{ fontSize: 12 }}>TDS Regime
              <select value={form.tds_regime} onChange={e => setForm(f => ({ ...f, tds_regime: e.target.value }))}
                style={{ marginLeft: 6, padding: '4px 8px', fontSize: 12, borderRadius: 4, border: '1px solid var(--rule-soft)' }}>
                <option value="new">New</option>
                <option value="old">Old</option>
              </select>
            </label>
          </div>

          <button type="submit" className="k-btn k-btn--primary" disabled={saving} style={{ fontSize: 13 }}>{saving ? 'Saving…' : 'Save Structure'}</button>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading…</p> : structures.length === 0 ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No salary structures defined yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {structures.map(s => (
            <div key={s.id} onClick={() => loadDetail(s.id)}
              style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '14px 18px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: 14 }}>{s.employee_name}</strong>
                <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 8 }}>{s.employee_code}</span>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>Effective: {s.effective_from}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{FMT(s.ctc_annual)}/yr</span>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{FMT(Number(s.ctc_annual || 0) / 12)}/mo</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function PayrollTab() {
  const { pushToast } = useToast();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState('');
  const [processing, setProcessing] = useState(false);
  const [detail, setDetail] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try { const r = await api.get('/v1/vetana/payroll/runs'); setRuns(r.data.data || []); } catch {}
    finally { setLoading(false); }
  }

  async function processPayroll() {
    if (!month) { pushToast({ title: 'Select a month', type: 'error' }); return; }
    setProcessing(true);
    try {
      const r = await api.post('/v1/vetana/payroll/process', { month });
      pushToast({ title: `Processed ${r.data.employee_count} employees — Net: ${FMT(r.data.total_net)}`, type: 'success' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setProcessing(false); }
  }

  async function loadDetail(id) {
    try { const r = await api.get(`/v1/vetana/payroll/runs/${id}`); setDetail(r.data); } catch { pushToast({ title: 'Failed to load', type: 'error' }); }
  }

  async function approveRun() {
    if (!detail) return;
    try {
      await api.patch(`/v1/vetana/payroll/runs/${detail.id}/approve`);
      pushToast({ title: 'Payroll approved', type: 'success' });
      loadDetail(detail.id);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function revertRun() {
    if (!detail) return;
    try {
      await api.patch(`/v1/vetana/payroll/runs/${detail.id}/revert`);
      pushToast({ title: 'Payroll reverted to draft', type: 'success' });
      loadDetail(detail.id);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  if (detail) {
    const payslips = detail.payslips || [];
    return (
      <div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => setDetail(null)}>← Back to runs</button>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Payroll — {detail.month}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-3)' }}>{detail.employee_count} employees</p>
            </div>
            <Badge text={detail.status} color={RUN_COLORS[detail.status] || '#6E7B91'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
            <StatTile label="Gross" value={FMT(detail.total_gross)} />
            <StatTile label="Deductions" value={FMT(detail.total_deductions)} />
            <StatTile label="Net Pay" value={FMT(detail.total_net)} />
            <StatTile label="PF (Total)" value={FMT(detail.total_pf)} />
            <StatTile label="ESI (Total)" value={FMT(detail.total_esi)} />
            <StatTile label="TDS" value={FMT(detail.total_tds)} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {detail.status === 'processed' && <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={approveRun}>Approve Payroll</button>}
            {detail.status === 'processed' && <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={revertRun}>Revert to Draft</button>}
          </div>
        </div>

        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Employee Breakdown</h4>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--rule-soft)' }}>
              {['Employee', 'Days', 'Gross', 'PF', 'ESI', 'PT', 'TDS', 'Net Pay'].map(h => (
                <th key={h} style={{ textAlign: h === 'Employee' ? 'left' : 'right', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payslips.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '8px 10px' }}>{p.employee_name} <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{p.employee_code}</span></td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{p.present_days}/{p.working_days}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{FMT(p.gross)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{FMT(p.pf_employee)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{FMT(p.esi_employee)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{FMT(p.professional_tax)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{FMT(p.tds)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{FMT(p.net_pay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Payroll Runs</h4>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            style={{ padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)' }} />
          <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={processPayroll} disabled={processing}>
            {processing ? 'Processing…' : 'Process Payroll'}
          </button>
        </div>
      </div>

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading…</p> : runs.length === 0 ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No payroll runs yet. Select a month and process.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {runs.map(r => (
            <div key={r.id} onClick={() => loadDetail(r.id)}
              style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '14px 18px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: 14 }}>{r.month}</strong>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{r.employee_count} employees</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{FMT(r.total_net)}</span>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--ink-3)' }}>Gross: {FMT(r.total_gross)}</p>
                </div>
                <Badge text={r.status} color={RUN_COLORS[r.status] || '#6E7B91'} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function PayslipsTab() {
  const { pushToast } = useToast();
  const [payslips, setPayslips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState('');
  const [detail, setDetail] = useState(null);

  useEffect(() => { load(); }, [monthFilter]);

  async function load() {
    try {
      let url = '/v1/vetana/payslips?';
      if (monthFilter) url += `month=${monthFilter}&`;
      const r = await api.get(url);
      setPayslips(r.data.data || []);
    } catch {}
    finally { setLoading(false); }
  }

  async function loadDetail(id) {
    try { const r = await api.get(`/v1/vetana/payslips/${id}`); setDetail(r.data); } catch { pushToast({ title: 'Failed to load', type: 'error' }); }
  }

  async function disburse() {
    if (!detail) return;
    try {
      await api.patch(`/v1/vetana/payslips/${detail.id}/disburse`);
      pushToast({ title: 'Payslip marked as disbursed', type: 'success' });
      loadDetail(detail.id);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  if (detail) {
    const p = detail;
    return (
      <div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => setDetail(null)}>← Back to list</button>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{p.payslip_number}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>{p.employee_name} · {p.employee_code} · {p.month}</p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Badge text={p.status} color={PS_COLORS[p.status] || '#6E7B91'} />
              {p.status === 'approved' && <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={disburse}>Mark Disbursed</button>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Attendance</h4>
              <div style={{ fontSize: 13 }}>
                <p style={{ margin: '4px 0' }}>Working Days: {p.working_days} · Present: {p.present_days}</p>
                <p style={{ margin: '4px 0' }}>Paid Leaves: {p.leaves_paid} · Unpaid: {p.leaves_unpaid}</p>
                {Number(p.overtime_hours) > 0 && <p style={{ margin: '4px 0' }}>Overtime: {p.overtime_hours}h</p>}
              </div>

              <h4 style={{ fontSize: 13, fontWeight: 600, margin: '16px 0 8px' }}>Earnings</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {[['Basic', p.basic], ['HRA', p.hra], ['DA', p.da], ['Special Allowance', p.special_allowance],
                    ['Conveyance', p.conveyance], ['Medical', p.medical], ['Overtime', p.overtime_pay]].filter(([, v]) => Number(v) > 0).map(([label, val]) => (
                    <tr key={label} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                      <td style={{ padding: '4px 0' }}>{label}</td>
                      <td style={{ padding: '4px 0', textAlign: 'right' }}>{FMT(val)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--rule-soft)' }}>
                    <td style={{ padding: '6px 0', fontWeight: 700 }}>Gross</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 700 }}>{FMT(p.gross)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Deductions</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {[['PF (Employee)', p.pf_employee], ['ESI (Employee)', p.esi_employee],
                    ['Professional Tax', p.professional_tax], ['TDS', p.tds]].filter(([, v]) => Number(v) > 0).map(([label, val]) => (
                    <tr key={label} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                      <td style={{ padding: '4px 0' }}>{label}</td>
                      <td style={{ padding: '4px 0', textAlign: 'right', color: '#ef4444' }}>{FMT(val)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--rule-soft)' }}>
                    <td style={{ padding: '6px 0', fontWeight: 700 }}>Total Deductions</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 700, color: '#ef4444' }}>{FMT(p.total_deductions)}</td>
                  </tr>
                </tbody>
              </table>

              <div style={{ marginTop: 16, padding: 16, background: 'var(--surface-2, #f9fafb)', borderRadius: 8, textAlign: 'center' }}>
                <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 4px' }}>Net Pay</p>
                <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#10b981' }}>{FMT(p.net_pay)}</p>
              </div>

              <div style={{ marginTop: 16, fontSize: 12, color: 'var(--ink-3)' }}>
                <p style={{ margin: '2px 0' }}>PF (Employer): {FMT(p.pf_employer)}</p>
                <p style={{ margin: '2px 0' }}>ESI (Employer): {FMT(p.esi_employer)}</p>
              </div>

              {p.pan && <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>PAN: {p.pan} · UAN: {p.uan || '—'}</p>}
              {p.bank_name && <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>Bank: {p.bank_name} · A/C: {p.bank_account}</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Payslips</h4>
        <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
          style={{ padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)' }} />
      </div>

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading…</p> : payslips.length === 0 ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No payslips generated yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {payslips.map(p => (
            <div key={p.id} onClick={() => loadDetail(p.id)}
              style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '14px 18px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: 14 }}>{p.employee_name}</strong>
                <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 8 }}>{p.payslip_number}</span>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{p.month}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{FMT(p.net_pay)}</span>
                <Badge text={p.status} color={PS_COLORS[p.status] || '#6E7B91'} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function StatutoryTab() {
  const { pushToast } = useToast();
  const [data, setData] = useState(null);
  const [month, setMonth] = useState('');

  useEffect(() => { load(); }, [month]);

  async function load() {
    try {
      let url = '/v1/vetana/statutory-summary';
      if (month) url += `?month=${month}`;
      const r = await api.get(url);
      setData(r.data);
    } catch {}
  }

  if (!data) return <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading…</p>;

  const totals = data.totals || {};
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Statutory Summary — {data.month}</h4>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          style={{ padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--rule-soft)' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatTile label="PF (Employee)" value={FMT(totals.total_pf_employee)} />
        <StatTile label="PF (Employer)" value={FMT(totals.total_pf_employer)} />
        <StatTile label="ESI (Employee)" value={FMT(totals.total_esi_employee)} />
        <StatTile label="ESI (Employer)" value={FMT(totals.total_esi_employer)} />
        <StatTile label="Professional Tax" value={FMT(totals.total_pt)} />
        <StatTile label="TDS" value={FMT(totals.total_tds)} />
      </div>

      {data.employees && data.employees.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 800 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--rule-soft)' }}>
                {['Employee', 'Code', 'PAN', 'UAN', 'Basic', 'Gross', 'PF(E)', 'PF(R)', 'ESI(E)', 'ESI(R)', 'PT', 'TDS'].map(h => (
                  <th key={h} style={{ textAlign: ['Employee', 'Code', 'PAN', 'UAN'].includes(h) ? 'left' : 'right', padding: '6px 8px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '6px 8px' }}>{e.employee_name}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)' }}>{e.employee_code}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)' }}>{e.pan || '—'}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)' }}>{e.uan || '—'}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{FMT(e.basic)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{FMT(e.gross)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{FMT(e.pf_employee)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{FMT(e.pf_employer)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{FMT(e.esi_employee)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{FMT(e.esi_employer)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{FMT(e.professional_tax)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{FMT(e.tds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
