import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile, TabBar, Section, Badge, Shimmer, Empty, BackButton, ModCard, DataTable, Td } from '../components/editorial';

const RUN_COLORS = { draft: '#6E7B91', processed: '#0082c6', approved: '#8b5cf6', disbursed: '#10b981' };
const PS_COLORS = { generated: '#6E7B91', approved: '#8b5cf6', disbursed: '#10b981' };
const FMT = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;

const LOAN_COLORS = { active: '#0082c6', closed: '#10b981', written_off: '#6E7B91' };
const TABS = ['dashboard', 'structures', 'payroll', 'payslips', 'loans', 'statutory'];

export default function VetanaPage() {
  const [tab, setTab] = useState('dashboard');
  return (
    <div style={{ padding: '0 0 48px' }}>
      <PageHeader title="Vetana" sanskrit="वेतन" lede="Payroll — Salary Structures, Processing & Compliance" />
      <TabBar tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'structures' && <StructuresTab />}
      {tab === 'payroll' && <PayrollTab />}
      {tab === 'payslips' && <PayslipsTab />}
      {tab === 'loans' && <LoansTab />}
      {tab === 'statutory' && <StatutoryTab />}
    </div>
  );
}


function DashboardTab() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/v1/vetana/dashboard').then(r => setData(r.data)).catch(() => {}); }, []);
  if (!data) return <Shimmer count={8} />;
  const run = data.latest_run;
  const ytd = data.ytd || {};
  return (
    <>
      {run && (
        <Section title={`Current Month — ${run.month}`} hi="चालू माह">
          <div className="k-stats">
            <StatTile label="Headcount" value={data.headcount} />
            <StatTile label="Gross Pay" value={FMT(run.total_gross)} />
            <StatTile label="Net Pay" value={FMT(run.total_net)} variant="teal" />
            <StatTile label="Processed" value={run.employee_count} sub="employees" />
          </div>
        </Section>
      )}
      <Section title="Year to Date" hi="वार्षिक">
        <div className="k-stats">
          <StatTile label="YTD Gross" value={FMT(ytd.ytd_gross)} />
          <StatTile label="YTD PF" value={FMT(ytd.ytd_pf)} variant="amber" />
          <StatTile label="YTD ESI" value={FMT(ytd.ytd_esi)} variant="amber" />
          <StatTile label="YTD TDS" value={FMT(ytd.ytd_tds)} variant="red" />
        </div>
      </Section>

      {data.department_split.length > 0 && (
        <Section title="Department Split" hi="विभाग">
          <DataTable columns={['Department', { label: 'Employees', align: 'right' }, { label: 'Gross', align: 'right' }, { label: 'Net', align: 'right' }]}>
            {data.department_split.map((d, i) => (
              <tr key={i}>
                <td>{d.department || 'Unassigned'}</td>
                <Td align="right">{d.employees}</Td>
                <Td align="right" mono>{FMT(d.dept_gross)}</Td>
                <Td align="right" mono>{FMT(d.dept_net)}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </>
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

  const [editingStruct, setEditingStruct] = useState(false);
  const [structEditForm, setStructEditForm] = useState({});
  const [structEditSaving, setStructEditSaving] = useState(false);

  async function loadDetail(id) {
    try { const r = await api.get(`/v1/vetana/salary-structures/${id}`); setDetail(r.data); setEditingStruct(false); } catch { pushToast({ title: 'Failed to load', type: 'error' }); }
  }

  function startStructEdit() {
    const s = detail;
    setStructEditForm({
      ctc_annual: Number(s.ctc_annual || 0), basic: Number(s.basic || 0), hra: Number(s.hra || 0),
      da: Number(s.da || 0), special_allowance: Number(s.special_allowance || 0),
      conveyance: Number(s.conveyance || 0), medical: Number(s.medical || 0),
      pf_enabled: !!s.pf_enabled, esi_enabled: !!s.esi_enabled,
    });
    setEditingStruct(true);
  }

  async function saveStructEdit(e) {
    e.preventDefault();
    setStructEditSaving(true);
    try {
      await api.patch(`/v1/vetana/salary-structures/${detail.id}`, structEditForm);
      pushToast({ title: 'Salary structure updated', type: 'success' });
      setEditingStruct(false);
      loadDetail(detail.id);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Could not update salary structure', type: 'error' }); }
    finally { setStructEditSaving(false); }
  }

  if (detail) {
    const s = detail;
    const monthly = Number(s.ctc_annual || 0) / 12;
    return (
      <div>
        <BackButton onClick={() => { setDetail(null); setEditingStruct(false); }} label="Back to list" />
        <div className="k-detail">
          <div className="k-detail__header">
            <div>
              <h3 className="k-detail__title">{s.employee_name}</h3>
              <p className="k-detail__sub">Effective from: {s.effective_from} · CTC: {FMT(s.ctc_annual)}/yr ({FMT(monthly)}/mo)</p>
            </div>
            {!editingStruct && <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={startStructEdit}>Edit</button>}
          </div>

          {editingStruct ? (
            <form onSubmit={saveStructEdit} className="k-formpanel" style={{ marginTop: 16 }}>
              <div className="k-formpanel__grid k-formpanel__grid--3">
                <label className="k-formpanel__label">Annual CTC (₹)
                  <input type="number" value={structEditForm.ctc_annual} onChange={e => setStructEditForm(f => ({ ...f, ctc_annual: Number(e.target.value) }))} className="k-input" />
                </label>
              </div>
              <Section title="Monthly Breakdown" hi="मासिक विवरण">
                <div className="k-formpanel__grid k-formpanel__grid--3">
                  {[['Basic', 'basic'], ['HRA', 'hra'], ['DA', 'da'], ['Special Allowance', 'special_allowance'], ['Conveyance', 'conveyance'], ['Medical', 'medical']].map(([label, key]) => (
                    <label key={key} className="k-formpanel__label">{label}
                      <input type="number" value={structEditForm[key]} onChange={e => setStructEditForm(f => ({ ...f, [key]: Number(e.target.value) }))} className="k-input" />
                    </label>
                  ))}
                </div>
              </Section>
              <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                {[['PF Enabled', 'pf_enabled'], ['ESI Enabled', 'esi_enabled']].map(([label, key]) => (
                  <label key={key} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-2)' }}>
                    <input type="checkbox" checked={structEditForm[key]} onChange={e => setStructEditForm(f => ({ ...f, [key]: e.target.checked }))} /> {label}
                  </label>
                ))}
              </div>
              <div className="k-formpanel__actions">
                <button type="submit" className="k-btn k-btn--primary" disabled={structEditSaving} style={{ fontSize: 13 }}>{structEditSaving ? 'Saving...' : 'Save Changes'}</button>
                <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditingStruct(false)} style={{ fontSize: 13 }}>Cancel</button>
              </div>
            </form>
          ) : (
            <>
              <Section title="Monthly Earnings" hi="मासिक आय">
                <DataTable columns={['Component', { label: 'Amount', align: 'right' }]}>
                  {[['Basic', s.basic], ['HRA', s.hra], ['DA', s.da], ['Special Allowance', s.special_allowance],
                    ['Conveyance', s.conveyance], ['Medical', s.medical]].map(([label, val]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <Td align="right" mono bold>{FMT(val)}</Td>
                    </tr>
                  ))}
                  <tr style={{ background: 'color-mix(in srgb, var(--k-primary) 4%, transparent)' }}>
                    <td style={{ fontWeight: 700 }}>Total Monthly</td>
                    <Td align="right" mono bold>
                      {FMT(Number(s.basic || 0) + Number(s.hra || 0) + Number(s.da || 0) + Number(s.special_allowance || 0) + Number(s.conveyance || 0) + Number(s.medical || 0))}
                    </Td>
                  </tr>
                </DataTable>
              </Section>

              <Section title="Statutory Configuration" hi="वैधानिक">
                <div style={{ display: 'flex', gap: 20, fontSize: 13, flexWrap: 'wrap' }}>
                  {[
                    ['PF', s.pf_enabled], ['ESI', s.esi_enabled], ['PT', s.pt_applicable],
                  ].map(([label, on]) => (
                    <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: on ? '#10b981' : 'var(--rule-soft)' }} />
                      {label}: {on ? 'Enabled' : 'Disabled'}
                    </span>
                  ))}
                  <span>TDS Regime: <strong>{s.tds_regime === 'new' ? 'New' : 'Old'}</strong></span>
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="k-section__head" style={{ marginBottom: 20 }}>
        <h3 className="k-section__title">Salary Structures<span className="k-section__title-hi">वेतन ढाँचा</span></h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }}
          onClick={() => { setShowForm(!showForm); if (!showForm) loadEmployees(); }}>
          {showForm ? 'Cancel' : '+ New Structure'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="k-formpanel">
          <div className="k-formpanel__grid k-formpanel__grid--3">
            <label className="k-formpanel__label">Employee
              <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} className="k-formpanel__input">
                <option value="">Select…</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name || emp.full_name || `${emp.first_name} ${emp.last_name}`} ({emp.employee_code})</option>)}
              </select>
            </label>
            <label className="k-formpanel__label">Effective From
              <input type="date" value={form.effective_from} onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))} className="k-formpanel__input" />
            </label>
            <label className="k-formpanel__label">Annual CTC (₹)
              <input type="number" value={form.ctc_annual} onChange={e => autoSplit(Number(e.target.value))} className="k-formpanel__input" />
            </label>
          </div>

          <Section title="Monthly Breakdown" hi="मासिक विवरण">
            <div className="k-formpanel__grid k-formpanel__grid--3">
              {[['Basic', 'basic'], ['HRA', 'hra'], ['DA', 'da'], ['Special Allowance', 'special_allowance'], ['Conveyance', 'conveyance'], ['Medical', 'medical']].map(([label, key]) => (
                <label key={key} className="k-formpanel__label">{label}
                  <input type="number" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: Number(e.target.value) }))} className="k-formpanel__input" />
                </label>
              ))}
            </div>
          </Section>

          <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            {[['PF Enabled', 'pf_enabled'], ['ESI Enabled', 'esi_enabled'], ['Professional Tax', 'pt_applicable']].map(([label, key]) => (
              <label key={key} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-2)' }}>
                <input type="checkbox" checked={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} /> {label}
              </label>
            ))}
            <label className="k-formpanel__label" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>TDS Regime
              <select value={form.tds_regime} onChange={e => setForm(f => ({ ...f, tds_regime: e.target.value }))} className="k-formpanel__input" style={{ width: 'auto' }}>
                <option value="new">New</option>
                <option value="old">Old</option>
              </select>
            </label>
          </div>

          <div className="k-formpanel__actions">
            <button type="submit" className="k-btn k-btn--primary" disabled={saving} style={{ fontSize: 13 }}>{saving ? 'Saving…' : 'Save Structure'}</button>
          </div>
        </form>
      )}

      {loading ? <Shimmer count={4} /> : structures.length === 0 ? (
        <Empty icon="💰" title="No salary structures" sub="Define salary structures for your employees to enable payroll processing." cta="+ New Structure" onCta={() => { setShowForm(true); loadEmployees(); }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {structures.map(s => (
            <ModCard key={s.id} onClick={() => loadDetail(s.id)}>
              <div>
                <strong style={{ fontSize: 14 }}>{s.employee_name}</strong>
                <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 8 }}>{s.employee_code}</span>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>Effective: {s.effective_from}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{FMT(s.ctc_annual)}/yr</span>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{FMT(Number(s.ctc_annual || 0) / 12)}/mo</p>
              </div>
            </ModCard>
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
      loadDetail(detail.id); load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function revertRun() {
    if (!detail) return;
    try {
      await api.patch(`/v1/vetana/payroll/runs/${detail.id}/revert`);
      pushToast({ title: 'Payroll reverted to draft', type: 'success' });
      loadDetail(detail.id); load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  if (detail) {
    const payslips = detail.payslips || [];
    return (
      <div>
        <BackButton onClick={() => setDetail(null)} label="Back to runs" />
        <div className="k-detail">
          <div className="k-detail__header">
            <div>
              <h3 className="k-detail__title">Payroll — {detail.month}</h3>
              <p className="k-detail__sub">{detail.employee_count} employees</p>
            </div>
            <Badge text={detail.status} color={RUN_COLORS[detail.status]} />
          </div>

          <div className="k-stats" style={{ marginBottom: 20 }}>
            <StatTile label="Gross" value={FMT(detail.total_gross)} />
            <StatTile label="Deductions" value={FMT(detail.total_deductions)} variant="red" />
            <StatTile label="Net Pay" value={FMT(detail.total_net)} variant="teal" />
            <StatTile label="PF" value={FMT(detail.total_pf)} variant="amber" />
          </div>
          <div className="k-stats" style={{ marginBottom: 20 }}>
            <StatTile label="ESI" value={FMT(detail.total_esi)} variant="amber" />
            <StatTile label="TDS" value={FMT(detail.total_tds)} variant="red" />
          </div>

          {(detail.status === 'processed' || detail.status === 'approved') && (
            <div className="k-detail__actions">
              {detail.status === 'processed' && <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={approveRun}>Approve Payroll</button>}
              <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={revertRun}>Revert to Draft</button>
            </div>
          )}
        </div>

        <Section title="Employee Breakdown" hi="कर्मचारी विवरण">
          <DataTable columns={['Employee', { label: 'Days', align: 'right' }, { label: 'Gross', align: 'right' }, { label: 'PF', align: 'right' }, { label: 'ESI', align: 'right' }, { label: 'PT', align: 'right' }, { label: 'TDS', align: 'right' }, { label: 'Net Pay', align: 'right' }]}>
            {payslips.map(p => (
              <tr key={p.id}>
                <td>{p.employee_name} <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{p.employee_code}</span></td>
                <Td align="right">{p.present_days}/{p.working_days}</Td>
                <Td align="right" mono>{FMT(p.gross)}</Td>
                <Td align="right" mono>{FMT(p.pf_employee)}</Td>
                <Td align="right" mono>{FMT(p.esi_employee)}</Td>
                <Td align="right" mono>{FMT(p.professional_tax)}</Td>
                <Td align="right" mono>{FMT(p.tds)}</Td>
                <Td align="right" mono bold>{FMT(p.net_pay)}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      </div>
    );
  }

  return (
    <div>
      <div className="k-section__head" style={{ marginBottom: 20 }}>
        <h3 className="k-section__title">Payroll Runs<span className="k-section__title-hi">वेतन संसाधन</span></h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="k-formpanel__input" style={{ width: 'auto' }} />
          <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={processPayroll} disabled={processing}>
            {processing ? 'Processing…' : 'Process Payroll'}
          </button>
        </div>
      </div>

      {loading ? <Shimmer count={4} /> : runs.length === 0 ? (
        <Empty icon="📋" title="No payroll runs" sub="Select a month and process payroll to generate payslips for your team." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {runs.map(r => (
            <ModCard key={r.id} onClick={() => loadDetail(r.id)}>
              <div>
                <strong style={{ fontSize: 14 }}>{r.month}</strong>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{r.employee_count} employees</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{FMT(r.total_net)}</span>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--ink-3)' }}>Gross: {FMT(r.total_gross)}</p>
                </div>
                <Badge text={r.status} color={RUN_COLORS[r.status]} />
              </div>
            </ModCard>
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
      loadDetail(detail.id); load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  if (detail) {
    const p = detail;
    return (
      <div>
        <BackButton onClick={() => setDetail(null)} label="Back to list" />
        <div className="k-detail">
          <div className="k-detail__header">
            <div>
              <h3 className="k-detail__title">{p.payslip_number}</h3>
              <p className="k-detail__sub">{p.employee_name} · {p.employee_code} · {p.month}</p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Badge text={p.status} color={PS_COLORS[p.status]} />
              <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={async () => {
                try {
                  const res = await api.get(`/v1/vetana/payslips/${p.id}/pdf`, { responseType: 'blob' });
                  const url = URL.createObjectURL(res.data);
                  const a = document.createElement('a');
                  a.href = url; a.download = `Payslip-${p.payslip_number}.pdf`; a.click();
                  URL.revokeObjectURL(url);
                } catch { /* toast handled by interceptor */ }
              }}>Download PDF</button>
              {p.status === 'approved' && <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={disburse}>Mark Disbursed</button>}
            </div>
          </div>

          <div className="k-metabar">
            <span>Working Days: <strong>{p.working_days}</strong></span>
            <span>Present: <strong>{p.present_days}</strong></span>
            <span>Paid Leaves: <strong>{p.leaves_paid}</strong></span>
            <span>Unpaid: <strong>{p.leaves_unpaid}</strong></span>
            {Number(p.overtime_hours) > 0 && <span>Overtime: <strong>{p.overtime_hours}h</strong></span>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
            <Section title="Earnings" hi="आय">
              <DataTable columns={['Component', { label: 'Amount', align: 'right' }]}>
                {[['Basic', p.basic], ['HRA', p.hra], ['DA', p.da], ['Special Allowance', p.special_allowance],
                  ['Conveyance', p.conveyance], ['Medical', p.medical], ['Overtime', p.overtime_pay]].filter(([, v]) => Number(v) > 0).map(([label, val]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <Td align="right" mono>{FMT(val)}</Td>
                  </tr>
                ))}
                <tr style={{ background: 'color-mix(in srgb, var(--k-primary) 4%, transparent)' }}>
                  <td style={{ fontWeight: 700 }}>Gross</td>
                  <Td align="right" mono bold>{FMT(p.gross)}</Td>
                </tr>
              </DataTable>
            </Section>

            <div>
              <Section title="Deductions" hi="कटौती">
                <DataTable columns={['Component', { label: 'Amount', align: 'right' }]}>
                  {[['PF (Employee)', p.pf_employee], ['ESI (Employee)', p.esi_employee],
                    ['Professional Tax', p.professional_tax], ['TDS', p.tds],
                    ['Loan Repayment', p.loan_deduction]].filter(([, v]) => Number(v) > 0).map(([label, val]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <Td align="right" mono color="#ef4444">{FMT(val)}</Td>
                    </tr>
                  ))}
                  <tr style={{ background: 'color-mix(in srgb, #ef4444 4%, transparent)' }}>
                    <td style={{ fontWeight: 700 }}>Total Deductions</td>
                    <Td align="right" mono bold color="#ef4444">{FMT(p.total_deductions)}</Td>
                  </tr>
                </DataTable>
              </Section>

              {Number(p.reimbursements) > 0 && (
                <p style={{ margin: '8px 0', fontSize: 13, color: '#10b981' }}>+ Expense Reimbursement: <strong>{FMT(p.reimbursements)}</strong></p>
              )}

              <div className="k-netbox">
                <p className="k-netbox__label">Net Pay</p>
                <p className="k-netbox__value">{FMT(p.net_pay)}</p>
              </div>

              <div style={{ marginTop: 16, fontSize: 12, color: 'var(--ink-3)' }}>
                <p style={{ margin: '3px 0' }}>PF (Employer): {FMT(p.pf_employer)}</p>
                <p style={{ margin: '3px 0' }}>ESI (Employer): {FMT(p.esi_employer)}</p>
                {p.pan && <p style={{ margin: '3px 0' }}>PAN: {p.pan} · UAN: {p.uan || '—'}</p>}
                {p.bank_name && <p style={{ margin: '3px 0' }}>Bank: {p.bank_name} · A/C: {p.bank_account}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="k-section__head" style={{ marginBottom: 20 }}>
        <h3 className="k-section__title">Payslips<span className="k-section__title-hi">वेतन पर्ची</span></h3>
        <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="k-formpanel__input" style={{ width: 'auto' }} />
      </div>

      {loading ? <Shimmer count={4} /> : payslips.length === 0 ? (
        <Empty icon="📄" title="No payslips" sub="Process payroll to generate payslips for your employees." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {payslips.map(p => (
            <ModCard key={p.id} onClick={() => loadDetail(p.id)}>
              <div>
                <strong style={{ fontSize: 14 }}>{p.employee_name}</strong>
                <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 8 }}>{p.payslip_number}</span>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{p.month}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{FMT(p.net_pay)}</span>
                <Badge text={p.status} color={PS_COLORS[p.status]} />
              </div>
            </ModCard>
          ))}
        </div>
      )}
    </div>
  );
}


function StatutoryTab() {
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

  if (!data) return <Shimmer count={6} />;

  const totals = data.totals || {};
  return (
    <div>
      <div className="k-section__head" style={{ marginBottom: 20 }}>
        <h3 className="k-section__title">Statutory Summary — {data.month}<span className="k-section__title-hi">वैधानिक</span></h3>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="k-formpanel__input" style={{ width: 'auto' }} />
      </div>

      <Section title="Totals" hi="कुल">
        <div className="k-stats">
          <StatTile label="PF (Employee)" value={FMT(totals.total_pf_employee)} variant="amber" />
          <StatTile label="PF (Employer)" value={FMT(totals.total_pf_employer)} variant="amber" />
          <StatTile label="ESI (Employee)" value={FMT(totals.total_esi_employee)} />
          <StatTile label="ESI (Employer)" value={FMT(totals.total_esi_employer)} />
        </div>
        <div className="k-stats" style={{ marginTop: 12 }}>
          <StatTile label="Professional Tax" value={FMT(totals.total_pt)} />
          <StatTile label="TDS" value={FMT(totals.total_tds)} variant="red" />
        </div>
      </Section>

      {data.employees && data.employees.length > 0 && (
        <Section title="Employee-wise Breakdown" hi="कर्मचारी विवरण">
          <DataTable columns={['Employee', 'Code', 'PAN', 'UAN', { label: 'Basic', align: 'right' }, { label: 'Gross', align: 'right' }, { label: 'PF(E)', align: 'right' }, { label: 'PF(R)', align: 'right' }, { label: 'ESI(E)', align: 'right' }, { label: 'ESI(R)', align: 'right' }, { label: 'PT', align: 'right' }, { label: 'TDS', align: 'right' }]}>
            {data.employees.map((e, i) => (
              <tr key={i}>
                <td>{e.employee_name}</td>
                <Td mono>{e.employee_code}</Td>
                <Td mono>{e.pan || '—'}</Td>
                <Td mono>{e.uan || '—'}</Td>
                <Td align="right" mono>{FMT(e.basic)}</Td>
                <Td align="right" mono>{FMT(e.gross)}</Td>
                <Td align="right" mono>{FMT(e.pf_employee)}</Td>
                <Td align="right" mono>{FMT(e.pf_employer)}</Td>
                <Td align="right" mono>{FMT(e.esi_employee)}</Td>
                <Td align="right" mono>{FMT(e.esi_employer)}</Td>
                <Td align="right" mono>{FMT(e.professional_tax)}</Td>
                <Td align="right" mono>{FMT(e.tds)}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}


function LoansTab() {
  const { pushToast } = useToast();
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ employee_id: '', principal_amount: 0, emi_amount: 0, disbursed_date: '', notes: '' });
  const [editLoanId, setEditLoanId] = useState(null);
  const [loanEditForm, setLoanEditForm] = useState({});
  const [loanEditSaving, setLoanEditSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try { const r = await api.get('/v1/vetana/loans'); setLoans(r.data.data || []); } catch {}
    finally { setLoading(false); }
  }

  async function loadEmployees() {
    try { const r = await api.get('/v1/manav/employees'); setEmployees(r.data.data || []); } catch {}
  }

  async function save(e) {
    e.preventDefault();
    if (!form.employee_id) { pushToast({ title: 'Select an employee', type: 'error' }); return; }
    setSaving(true);
    try {
      await api.post('/v1/vetana/loans', form);
      pushToast({ title: 'Loan recorded', type: 'success' });
      setShowForm(false);
      setForm({ employee_id: '', principal_amount: 0, emi_amount: 0, disbursed_date: '', notes: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function writeOff(id) {
    try {
      await api.patch(`/v1/vetana/loans/${id}`, { status: 'written_off' });
      pushToast({ title: 'Loan written off', type: 'success' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  function startLoanEdit(l) {
    setEditLoanId(l.id);
    setLoanEditForm({ emi_amount: Number(l.emi_amount || 0), notes: l.notes || '' });
  }

  async function saveLoanEdit(e) {
    e.preventDefault();
    setLoanEditSaving(true);
    try {
      await api.patch(`/v1/vetana/loans/${editLoanId}`, loanEditForm);
      pushToast({ title: 'Loan updated', type: 'success' });
      setEditLoanId(null);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Could not update loan', type: 'error' }); }
    finally { setLoanEditSaving(false); }
  }

  return (
    <div>
      <div className="k-section__head" style={{ marginBottom: 20 }}>
        <h3 className="k-section__title">Loans &amp; Advances<span className="k-section__title-hi">ऋण एवं अग्रिम</span></h3>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }}
          onClick={() => { setShowForm(!showForm); if (!showForm) loadEmployees(); }}>
          {showForm ? 'Cancel' : '+ New Loan'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="k-formpanel">
          <div className="k-formpanel__grid k-formpanel__grid--3">
            <label className="k-formpanel__label">Employee
              <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} className="k-formpanel__input">
                <option value="">Select…</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name || emp.full_name || `${emp.first_name} ${emp.last_name}`} ({emp.employee_code})</option>)}
              </select>
            </label>
            <label className="k-formpanel__label">Principal Amount (₹)
              <input type="number" value={form.principal_amount} onChange={e => setForm(f => ({ ...f, principal_amount: Number(e.target.value) }))} className="k-formpanel__input" />
            </label>
            <label className="k-formpanel__label">Monthly EMI (₹)
              <input type="number" value={form.emi_amount} onChange={e => setForm(f => ({ ...f, emi_amount: Number(e.target.value) }))} className="k-formpanel__input" />
            </label>
            <label className="k-formpanel__label">Disbursed Date
              <input type="date" value={form.disbursed_date} onChange={e => setForm(f => ({ ...f, disbursed_date: e.target.value }))} className="k-formpanel__input" />
            </label>
            <label className="k-formpanel__label">Notes
              <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="k-formpanel__input" />
            </label>
          </div>
          <div className="k-formpanel__actions">
            <button type="submit" className="k-btn k-btn--primary" disabled={saving} style={{ fontSize: 13 }}>{saving ? 'Saving…' : 'Save Loan'}</button>
          </div>
        </form>
      )}

      {loading ? <Shimmer count={4} /> : loans.length === 0 ? (
        <Empty icon="🏦" title="No loans or advances" sub="Record a salary advance or loan — EMIs are auto-deducted from payroll each month." cta="+ New Loan" onCta={() => { setShowForm(true); loadEmployees(); }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loans.map(l => (
            <ModCard key={l.id}>
              <div>
                <strong style={{ fontSize: 14 }}>{l.employee_name}</strong>
                <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 8 }}>{l.employee_code}</span>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>Disbursed {l.disbursed_date} · EMI {FMT(l.emi_amount)}/mo</p>
                {editLoanId === l.id && (
                  <form onSubmit={saveLoanEdit} style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 12, color: 'var(--ink-2)' }}>EMI (₹)
                      <input type="number" value={loanEditForm.emi_amount} onChange={e => setLoanEditForm(f => ({ ...f, emi_amount: Number(e.target.value) }))} className="k-input" style={{ width: 100 }} />
                    </label>
                    <label style={{ fontSize: 12, color: 'var(--ink-2)' }}>Notes
                      <input value={loanEditForm.notes} onChange={e => setLoanEditForm(f => ({ ...f, notes: e.target.value }))} className="k-input" style={{ width: 160 }} />
                    </label>
                    <button type="submit" className="k-btn k-btn--primary" disabled={loanEditSaving} style={{ fontSize: 11 }}>{loanEditSaving ? '...' : 'Save'}</button>
                    <button type="button" className="k-btn k-btn--ghost" style={{ fontSize: 11 }} onClick={() => setEditLoanId(null)}>Cancel</button>
                  </form>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{FMT(l.balance_remaining)}</span>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--ink-3)' }}>of {FMT(l.principal_amount)}</p>
                </div>
                <Badge text={l.status} color={LOAN_COLORS[l.status]} />
                {l.status === 'active' && editLoanId !== l.id && (
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 11 }} onClick={() => startLoanEdit(l)}>Edit</button>
                )}
                {l.status === 'active' && (
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 11 }} onClick={() => writeOff(l.id)}>Write Off</button>
                )}
              </div>
            </ModCard>
          ))}
        </div>
      )}
    </div>
  );
}
