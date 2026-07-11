import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';

const EMP_TYPES = ['full_time', 'part_time', 'contract', 'intern', 'consultant'];
const EMP_STATUSES = ['active', 'on_notice', 'terminated', 'resigned', 'absconding'];
const ATT_STATUSES = ['present', 'absent', 'half_day', 'late', 'on_leave', 'holiday', 'weekend'];
const STATUS_COLORS = { active: '#10b981', on_notice: '#f59e0b', terminated: '#ef4444', resigned: '#9ca3af', absconding: '#ef4444' };
const ATT_COLORS = { present: '#10b981', absent: '#ef4444', half_day: '#f59e0b', late: '#6366f1', on_leave: '#0082c6', holiday: '#8b5cf6', weekend: '#9ca3af' };
const LEAVE_COLORS = { pending: '#f59e0b', approved: '#10b981', rejected: '#ef4444', cancelled: '#9ca3af' };
const PRIORITY_COLORS = { low: '#6E7B91', normal: '#0082c6', high: '#f59e0b', urgent: '#ef4444' };

function Badge({ text, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${color}18`, color }}>{text?.replace(/_/g, ' ')}</span>
  );
}

const TABS = ['employees', 'attendance', 'leaves', 'announcements', 'departments', 'holidays', 'performance'];

export default function ManavPage() {
  const { pushToast } = useToast();
  const [tab, setTab] = useState('employees');
  const [stats, setStats] = useState(null);

  useEffect(() => { loadStats(); }, []);

  async function loadStats() {
    try {
      const r = await api.get('/v1/manav/stats');
      setStats(r.data);
    } catch {}
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px 48px' }}>
      <PageHeader title="Manav · मानव" subtitle="HRMS — Employees, Attendance & Leave Management" />

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 24 }}>
          <StatTile label="Employees" value={stats.total_employees} />
          <StatTile label="Departments" value={stats.departments} />
          <StatTile label="Present Today" value={stats.today_present} />
          <StatTile label="Clocked In" value={stats.clocked_in_count ?? '—'} />
          <StatTile label="On Leave" value={stats.on_leave_today ?? '—'} />
          <StatTile label="Pending Leaves" value={stats.pending_leaves} />
          <StatTile label="Announcements" value={stats.announcements_count ?? '—'} />
        </div>
      )}

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

      {tab === 'employees' && <EmployeesTab onUpdate={loadStats} />}
      {tab === 'attendance' && <AttendanceTab />}
      {tab === 'leaves' && <LeavesTab />}
      {tab === 'announcements' && <AnnouncementsTab />}
      {tab === 'departments' && <DepartmentsTab />}
      {tab === 'holidays' && <HolidaysTab />}
      {tab === 'performance' && <PerformanceTab />}
    </div>
  );
}


function EmployeesTab({ onUpdate }) {
  const { pushToast } = useToast();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', employee_code: '', department: '', designation: '',
    date_of_joining: '', date_of_birth: '', gender: '', employment_type: 'full_time',
    pan: '', aadhaar: '', shift: 'general',
  });

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      let url = '/v1/manav/employees?';
      if (search) url += `search=${encodeURIComponent(search)}&`;
      if (deptFilter) url += `department=${encodeURIComponent(deptFilter)}&`;
      const r = await api.get(url);
      setEmployees(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load employees', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/employees', form);
      pushToast({ title: 'Employee added', type: 'success' });
      setShowForm(false);
      setForm({ name: '', email: '', phone: '', employee_code: '', department: '', designation: '',
        date_of_joining: '', date_of_birth: '', gender: '', employment_type: 'full_time',
        pan: '', aadhaar: '', shift: 'general' });
      load();
      onUpdate?.();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function loadDetail(id) {
    try {
      const r = await api.get(`/v1/manav/employees/${id}`);
      setDetail(r.data);
    } catch { pushToast({ title: 'Failed to load employee', type: 'error' }); }
  }

  if (detail) {
    const emp = detail.employee;
    return (
      <div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => setDetail(null)}>← Back to list</button>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{emp.name}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>
                {emp.employee_code && `${emp.employee_code} · `}{emp.designation} {emp.department && `· ${emp.department}`}
              </p>
            </div>
            <Badge text={emp.status} color={STATUS_COLORS[emp.status] || '#6E7B91'} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
            <div><strong>Email:</strong> {emp.email || '—'}</div>
            <div><strong>Phone:</strong> {emp.phone || '—'}</div>
            <div><strong>Type:</strong> {emp.employment_type?.replace('_', ' ')}</div>
            <div><strong>Joining:</strong> {emp.date_of_joining || '—'}</div>
            <div><strong>DOB:</strong> {emp.date_of_birth || '—'}</div>
            <div><strong>Gender:</strong> {emp.gender || '—'}</div>
            <div><strong>PAN:</strong> {emp.pan || '—'}</div>
            <div><strong>Aadhaar:</strong> {emp.aadhaar || '—'}</div>
            <div><strong>UAN:</strong> {emp.uan || '—'}</div>
            <div><strong>Shift:</strong> {emp.shift}</div>
            <div><strong>Blood Group:</strong> {emp.blood_group || '—'}</div>
          </div>
        </div>

        {detail.leave_balances?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Leave Balances (Current Year)</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  {['Leave Type', 'Allocated', 'Used', 'Carried', 'Available'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.leave_balances.map(lb => (
                  <tr key={lb.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{lb.leave_name} ({lb.leave_code})</td>
                    <td style={{ padding: '8px 10px' }}>{lb.allocated}</td>
                    <td style={{ padding: '8px 10px', color: '#ef4444' }}>{lb.used}</td>
                    <td style={{ padding: '8px 10px' }}>{lb.carried_forward}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: '#10b981' }}>{(lb.allocated + lb.carried_forward) - lb.used}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input className="k-input" style={{ flex: 1 }} placeholder="Search employees…" value={search}
          onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
        <input className="k-input" style={{ width: 150 }} placeholder="Department" value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)} />
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ Add Employee</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Employee</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Employee Code</span>
              <input className="k-input" placeholder="e.g. EMP001" value={form.employee_code} onChange={e => setForm({ ...form, employee_code: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Email</span>
              <input className="k-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Phone</span>
              <input className="k-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Department</span>
              <input className="k-input" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Designation</span>
              <input className="k-input" value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Employment Type</span>
              <select className="k-input" value={form.employment_type} onChange={e => setForm({ ...form, employment_type: e.target.value })}>
                {EMP_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Date of Joining</span>
              <input className="k-input" type="date" value={form.date_of_joining} onChange={e => setForm({ ...form, date_of_joining: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Date of Birth</span>
              <input className="k-input" type="date" value={form.date_of_birth} onChange={e => setForm({ ...form, date_of_birth: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Gender</span>
              <select className="k-input" value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
                <option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>PAN</span>
              <input className="k-input" value={form.pan} onChange={e => setForm({ ...form, pan: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Aadhaar</span>
              <input className="k-input" value={form.aadhaar} onChange={e => setForm({ ...form, aadhaar: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Adding…' : 'Add Employee'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        employees.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No employees found.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Code', 'Name', 'Department', 'Designation', 'Type', 'Status'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid var(--rule-soft)', cursor: 'pointer' }} onClick={() => loadDetail(e.id)}>
                <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{e.employee_code || '—'}</td>
                <td style={{ padding: '10px', fontWeight: 600 }}>{e.name}</td>
                <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{e.department || '—'}</td>
                <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{e.designation || '—'}</td>
                <td style={{ padding: '10px' }}>{e.employment_type?.replace('_', ' ')}</td>
                <td style={{ padding: '10px' }}><Badge text={e.status} color={STATUS_COLORS[e.status] || '#6E7B91'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}


function AttendanceTab() {
  const { pushToast } = useToast();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [showMark, setShowMark] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [markForm, setMarkForm] = useState({ employee_id: '', date: new Date().toISOString().split('T')[0], status: 'present', check_in: '', check_out: '', notes: '' });
  const [summary, setSummary] = useState(null);
  const [viewMode, setViewMode] = useState('daily');

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get(`/v1/manav/attendance?date_from=${dateFrom}&date_to=${dateTo}`);
      setRecords(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load attendance', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadSummary() {
    try {
      const month = dateFrom.substring(0, 7);
      const r = await api.get(`/v1/manav/attendance/summary?month=${month}`);
      setSummary(r.data);
    } catch { pushToast({ title: 'Failed to load summary', type: 'error' }); }
  }

  async function loadEmployees() {
    try {
      const r = await api.get('/v1/manav/employees');
      setEmployees(r.data.data || []);
    } catch {}
  }

  async function markAttendance(e) {
    e.preventDefault();
    try {
      await api.post('/v1/manav/attendance', markForm);
      pushToast({ title: 'Attendance marked', type: 'success' });
      setShowMark(false);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input className="k-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: 150 }} />
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>to</span>
        <input className="k-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: 150 }} />
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>View</button>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={() => { setViewMode('summary'); loadSummary(); }}>Monthly Summary</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => { setShowMark(true); loadEmployees(); setViewMode('daily'); }}>Mark Attendance</button>
      </div>

      {showMark && (
        <form onSubmit={markAttendance} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Mark Attendance</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Employee *</span>
              <select className="k-input" required value={markForm.employee_id} onChange={e => setMarkForm({ ...markForm, employee_id: e.target.value })}>
                <option value="">Select…</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code || '—'})</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Date</span>
              <input className="k-input" type="date" value={markForm.date} onChange={e => setMarkForm({ ...markForm, date: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Status</span>
              <select className="k-input" value={markForm.status} onChange={e => setMarkForm({ ...markForm, status: e.target.value })}>
                {ATT_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Check In</span>
              <input className="k-input" type="datetime-local" value={markForm.check_in} onChange={e => setMarkForm({ ...markForm, check_in: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Check Out</span>
              <input className="k-input" type="datetime-local" value={markForm.check_out} onChange={e => setMarkForm({ ...markForm, check_out: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
              <input className="k-input" value={markForm.notes} onChange={e => setMarkForm({ ...markForm, notes: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowMark(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Mark</button>
          </div>
        </form>
      )}

      {viewMode === 'summary' && summary ? (
        <div>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Monthly Summary — {summary.month}</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                {['Code', 'Name', 'Present', 'Absent', 'Half Day', 'Late', 'Leaves', 'Hours', 'OT'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(summary.data || []).map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '8px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.employee_code || '—'}</td>
                  <td style={{ padding: '8px', fontWeight: 600 }}>{r.name}</td>
                  <td style={{ padding: '8px', color: '#10b981' }}>{r.present_days}</td>
                  <td style={{ padding: '8px', color: '#ef4444' }}>{r.absent_days}</td>
                  <td style={{ padding: '8px' }}>{r.half_days}</td>
                  <td style={{ padding: '8px', color: '#6366f1' }}>{r.late_days}</td>
                  <td style={{ padding: '8px', color: '#0082c6' }}>{r.leave_days}</td>
                  <td style={{ padding: '8px' }}>{Number(r.total_hours).toFixed(1)}</td>
                  <td style={{ padding: '8px' }}>{Number(r.overtime_hours).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginTop: 12 }} onClick={() => setViewMode('daily')}>Back to Daily View</button>
        </div>
      ) : (
        <>
          {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
            records.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No attendance records for this date range.</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  {['Date', 'Employee', 'Status', 'Check In', 'Check Out', 'Hours', 'Marked By'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                    <td style={{ padding: '8px' }}>{r.date}</td>
                    <td style={{ padding: '8px', fontWeight: 600 }}>{r.employee_name} <span style={{ fontWeight: 400, color: 'var(--ink-3)', fontSize: 11 }}>({r.employee_code || '—'})</span></td>
                    <td style={{ padding: '8px' }}><Badge text={r.status} color={ATT_COLORS[r.status] || '#6E7B91'} /></td>
                    <td style={{ padding: '8px', fontSize: 12 }}>{r.check_in ? new Date(r.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td style={{ padding: '8px', fontSize: 12 }}>{r.check_out ? new Date(r.check_out).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td style={{ padding: '8px' }}>{r.work_hours ? `${Number(r.work_hours).toFixed(1)}h` : '—'}</td>
                    <td style={{ padding: '8px', fontSize: 11, color: 'var(--ink-3)' }}>{r.marked_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}


function LeavesTab() {
  const { pushToast } = useToast();
  const [leaves, setLeaves] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showRequest, setShowRequest] = useState(false);
  const [showType, setShowType] = useState(false);
  const [showConflict, setShowConflict] = useState(false);
  const [conflicts, setConflicts] = useState(null);
  const [conflictForm, setConflictForm] = useState({ start_date: '', end_date: '', department: '' });
  const [reqForm, setReqForm] = useState({ leave_type_id: '', start_date: '', end_date: '', days: 1, reason: '' });
  const [typeForm, setTypeForm] = useState({ name: '', code: '', annual_quota: 12, is_paid: true, carry_forward: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); loadTypes(); }, []);

  async function load() {
    try {
      let url = '/v1/manav/leaves?';
      if (statusFilter) url += `status=${statusFilter}&`;
      const r = await api.get(url);
      setLeaves(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load leaves', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadTypes() {
    try {
      const r = await api.get('/v1/manav/leave-types');
      setLeaveTypes(r.data.data || []);
    } catch {}
  }

  async function submitRequest(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/leaves', reqForm);
      pushToast({ title: 'Leave request submitted', type: 'success' });
      setShowRequest(false);
      setReqForm({ leave_type_id: '', start_date: '', end_date: '', days: 1, reason: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function createType(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/leave-types', typeForm);
      pushToast({ title: 'Leave type created', type: 'success' });
      setShowType(false);
      setTypeForm({ name: '', code: '', annual_quota: 12, is_paid: true, carry_forward: false });
      loadTypes();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function actionLeave(leaveId, status) {
    try {
      await api.patch(`/v1/manav/leaves/${leaveId}/action`, { status });
      pushToast({ title: `Leave ${status}`, type: 'success' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function checkConflicts(e) {
    e.preventDefault();
    try {
      let url = `/v1/manav/leaves/check-conflicts?start_date=${conflictForm.start_date}&end_date=${conflictForm.end_date}`;
      if (conflictForm.department) url += `&department=${encodeURIComponent(conflictForm.department)}`;
      const r = await api.get(url);
      setConflicts(r.data);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed to check', type: 'error' }); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="k-input" style={{ width: 130 }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); }}>
          <option value="">All Status</option>
          {['pending', 'approved', 'rejected', 'cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--ghost" style={{ fontSize: 13 }} onClick={() => setShowConflict(true)}>Check Conflicts</button>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 13 }} onClick={() => setShowType(true)}>+ Leave Type</button>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowRequest(true)}>+ Request Leave</button>
      </div>

      {showConflict && (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--k-primary)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Check Leave Conflicts</h4>
          <form onSubmit={checkConflicts} style={{ display: 'flex', gap: 12, alignItems: 'end', marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Start *</span>
              <input className="k-input" type="date" required value={conflictForm.start_date} onChange={e => setConflictForm({ ...conflictForm, start_date: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>End *</span>
              <input className="k-input" type="date" required value={conflictForm.end_date} onChange={e => setConflictForm({ ...conflictForm, end_date: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Department</span>
              <input className="k-input" placeholder="Optional" value={conflictForm.department} onChange={e => setConflictForm({ ...conflictForm, department: e.target.value })} /></label>
            <button type="submit" className="k-btn k-btn--primary" style={{ fontSize: 12 }}>Check</button>
            <button type="button" className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={() => { setShowConflict(false); setConflicts(null); }}>Close</button>
          </form>
          {conflicts && (
            <div style={{ fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                <span><strong>Overlap:</strong> {conflicts.overlap_count} of {conflicts.department_size} ({conflicts.overlap_percentage}%)</span>
                <Badge text={conflicts.has_conflict ? 'Conflict' : 'OK'} color={conflicts.has_conflict ? '#ef4444' : '#10b981'} />
              </div>
              {conflicts.has_conflict && (
                <p style={{ color: '#ef4444', fontSize: 12, margin: '4px 0 0' }}>
                  Over 30% of the department would be on leave. Consider rescheduling.
                </p>
              )}
              {conflicts.overlapping_leaves?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {conflicts.overlapping_leaves.map((ol, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--ink-2)', padding: '4px 0' }}>
                      {ol.employee_name} — {ol.start_date} → {ol.end_date} ({ol.leave_type})
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showType && (
        <form onSubmit={createType} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>New Leave Type</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={typeForm.name} onChange={e => setTypeForm({ ...typeForm, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Code *</span>
              <input className="k-input" required placeholder="e.g. CL, SL, EL" value={typeForm.code} onChange={e => setTypeForm({ ...typeForm, code: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Annual Quota</span>
              <input className="k-input" type="number" value={typeForm.annual_quota} onChange={e => setTypeForm({ ...typeForm, annual_quota: parseInt(e.target.value) || 0 })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={typeForm.is_paid} onChange={e => setTypeForm({ ...typeForm, is_paid: e.target.checked })} /> Paid</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={typeForm.carry_forward} onChange={e => setTypeForm({ ...typeForm, carry_forward: e.target.checked })} /> Carry Forward</label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowType(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {showRequest && (
        <form onSubmit={submitRequest} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Request Leave</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Leave Type *</span>
              <select className="k-input" required value={reqForm.leave_type_id} onChange={e => setReqForm({ ...reqForm, leave_type_id: e.target.value })}>
                <option value="">Select…</option>
                {leaveTypes.map(lt => <option key={lt.id} value={lt.id}>{lt.name} ({lt.code})</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Days</span>
              <input className="k-input" type="number" step="0.5" min="0.5" value={reqForm.days} onChange={e => setReqForm({ ...reqForm, days: parseFloat(e.target.value) || 1 })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Start Date *</span>
              <input className="k-input" type="date" required value={reqForm.start_date} onChange={e => setReqForm({ ...reqForm, start_date: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>End Date *</span>
              <input className="k-input" type="date" required value={reqForm.end_date} onChange={e => setReqForm({ ...reqForm, end_date: e.target.value })} /></label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Reason</span>
              <textarea className="k-input" rows={2} value={reqForm.reason}
                onChange={e => setReqForm({ ...reqForm, reason: e.target.value })} style={{ resize: 'vertical' }} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowRequest(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Submitting…' : 'Submit'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        leaves.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No leave requests found.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {leaves.map(lr => (
            <div key={lr.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{lr.employee_name}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-3)' }}>{lr.employee_code}</span>
                </div>
                <Badge text={lr.status} color={LEAVE_COLORS[lr.status] || '#6E7B91'} />
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                <strong>{lr.leave_type_name}</strong> ({lr.leave_type_code}) · {lr.start_date} → {lr.end_date} · {lr.days} day{lr.days > 1 ? 's' : ''}
                {lr.reason && <span> · {lr.reason}</span>}
                {lr.rejection_reason && <span style={{ color: '#ef4444' }}> · Rejected: {lr.rejection_reason}</span>}
              </div>
              {lr.status === 'pending' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="k-btn k-btn--primary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => actionLeave(lr.id, 'approved')}>Approve</button>
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 12, padding: '4px 12px', color: '#ef4444' }} onClick={() => actionLeave(lr.id, 'rejected')}>Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function AnnouncementsTab() {
  const { pushToast } = useToast();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: '', body: '', priority: 'normal', pinned: false, expires_at: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/manav/announcements');
      setAnnouncements(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load announcements', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/v1/manav/announcements/${editing}`, form);
        pushToast({ title: 'Announcement updated', type: 'success' });
        setEditing(null);
      } else {
        await api.post('/v1/manav/announcements', form);
        pushToast({ title: 'Announcement published', type: 'success' });
      }
      setShowForm(false);
      setForm({ title: '', body: '', priority: 'normal', pinned: false, expires_at: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/manav/announcements/${id}`);
      pushToast({ title: 'Announcement removed', type: 'success' });
      setAnnouncements(prev => prev.filter(a => a.id !== id));
    } catch { pushToast({ title: 'Delete failed', type: 'error' }); }
  }

  function startEdit(a) {
    setEditing(a.id);
    setForm({ title: a.title, body: a.body, priority: a.priority, pinned: a.pinned, expires_at: a.expires_at || '' });
    setShowForm(true);
  }

  return (
    <div>
      <button className="k-btn k-btn--primary" style={{ fontSize: 13, marginBottom: 16 }} onClick={() => { setShowForm(true); setEditing(null); setForm({ title: '', body: '', priority: 'normal', pinned: false, expires_at: '' }); }}>
        + New Announcement
      </button>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>{editing ? 'Edit' : 'New'} Announcement</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Body *</span>
              <textarea className="k-input" required rows={4} value={form.body}
                onChange={e => setForm({ ...form, body: e.target.value })} style={{ resize: 'vertical' }} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Priority</span>
              <select className="k-input" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                {['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Expires At</span>
              <input className="k-input" type="datetime-local" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} /></label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={form.pinned} onChange={e => setForm({ ...form, pinned: e.target.checked })} />
              <span style={{ fontWeight: 600 }}>Pin to top</span></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Update' : 'Publish'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        announcements.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No announcements.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {announcements.map(a => (
            <div key={a.id} style={{ background: 'var(--surface-1)', border: `1px solid ${a.pinned ? 'var(--k-primary)' : 'var(--rule-soft)'}`, borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {a.pinned && <span style={{ fontSize: 14 }}>📌</span>}
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{a.title}</h4>
                </div>
                <Badge text={a.priority} color={PRIORITY_COLORS[a.priority] || '#6E7B91'} />
              </div>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{a.body}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {new Date(a.published_at || a.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  {a.expires_at && ` · Expires: ${new Date(a.expires_at).toLocaleDateString('en-IN')}`}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 11 }} onClick={() => startEdit(a)}>Edit</button>
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: '#ef4444' }} onClick={() => remove(a.id)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function DepartmentsTab() {
  const { pushToast } = useToast();
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/manav/departments');
      setDepartments(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load departments', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/departments', form);
      pushToast({ title: 'Department created', type: 'success' });
      setShowForm(false);
      setForm({ name: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <button className="k-btn k-btn--primary" style={{ fontSize: 13, marginBottom: 16 }} onClick={() => setShowForm(true)}>+ Add Department</button>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Department Name *</span>
            <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ maxWidth: 300 }} /></label>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        departments.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No departments yet.</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {departments.map(d => (
            <div key={d.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700 }}>{d.name}</h4>
              <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                <div>{d.employee_count} employee{d.employee_count !== 1 ? 's' : ''}</div>
                {d.head_name && <div style={{ marginTop: 4 }}>Head: {d.head_name}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function HolidaysTab() {
  const { pushToast } = useToast();
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', is_optional: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/manav/holidays');
      setHolidays(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load holidays', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/holidays', form);
      pushToast({ title: 'Holiday added', type: 'success' });
      setShowForm(false);
      setForm({ name: '', date: '', is_optional: false });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function deleteHoliday(id) {
    try {
      await api.delete(`/v1/manav/holidays/${id}`);
      setHolidays(prev => prev.filter(h => h.id !== id));
      pushToast({ title: 'Holiday removed', type: 'success' });
    } catch { pushToast({ title: 'Delete failed', type: 'error' }); }
  }

  return (
    <div>
      <button className="k-btn k-btn--primary" style={{ fontSize: 13, marginBottom: 16 }} onClick={() => setShowForm(true)}>+ Add Holiday</button>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Date *</span>
              <input className="k-input" type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
          </div>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <input type="checkbox" checked={form.is_optional} onChange={e => setForm({ ...form, is_optional: e.target.checked })} />
            <span style={{ fontWeight: 600 }}>Optional Holiday</span></label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Adding…' : 'Add Holiday'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        holidays.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No holidays configured for this year.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Date', 'Name', 'Type', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holidays.map(h => (
              <tr key={h.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '10px' }}>{h.date}</td>
                <td style={{ padding: '10px', fontWeight: 600 }}>{h.name}</td>
                <td style={{ padding: '10px' }}><Badge text={h.is_optional ? 'Optional' : 'Mandatory'} color={h.is_optional ? '#f59e0b' : '#10b981'} /></td>
                <td style={{ padding: '10px' }}>
                  <button onClick={() => deleteHoliday(h.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11 }}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}


function PerformanceTab() {
  const { pushToast } = useToast();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().toISOString().substring(0, 7));

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get(`/v1/manav/performance/summary?month=${month}`);
      setData(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load performance', type: 'error' }); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input className="k-input" type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ width: 180 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={load}>Load</button>
      </div>

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        data.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No performance data for this month.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Employee', 'Department', 'Present', 'Absent', 'Late', 'Leaves Used', 'Total Hours', 'Avg Hours/Day', 'Attendance %'].map(h => (
                <th key={h} style={{ textAlign: ['Present', 'Absent', 'Late', 'Leaves Used', 'Total Hours', 'Avg Hours/Day', 'Attendance %'].includes(h) ? 'right' : 'left',
                  padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map(e => {
              const attendance_pct = e.working_days > 0 ? ((e.present_days / e.working_days) * 100).toFixed(0) : '—';
              const avg_hours = e.present_days > 0 ? (Number(e.total_hours || 0) / e.present_days).toFixed(1) : '—';
              return (
                <tr key={e.employee_id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '10px', fontWeight: 600 }}>{e.employee_name}</td>
                  <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{e.department || '—'}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: '#10b981' }}>{e.present_days}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: '#ef4444' }}>{e.absent_days}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: '#6366f1' }}>{e.late_days}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: '#0082c6' }}>{e.leaves_used}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{Number(e.total_hours || 0).toFixed(1)}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{avg_hours}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>
                    <span style={{ color: Number(attendance_pct) >= 90 ? '#10b981' : Number(attendance_pct) >= 75 ? '#f59e0b' : '#ef4444' }}>
                      {attendance_pct}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
