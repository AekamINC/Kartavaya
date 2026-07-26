import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge, EMP_TYPES, STATUS_COLORS } from './_shared';

export default function EmployeesTab({ onUpdate }) {
  const { pushToast } = useToast();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [editEmp, setEditEmp] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  // Aadhaar, PAN and the bank account arrive masked. Full values come from a
  // separate endpoint that only org owners/admins may call, and every read of
  // it is written to the audit log — so this stays null until asked for.
  const [pii, setPii] = useState(null);
  const [piiLoading, setPiiLoading] = useState(false);
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
      setPii(null);   // never carry a revealed value across employees
    } catch { pushToast({ title: 'Failed to load employee', type: 'error' }); }
  }

  async function revealPii(id) {
    setPiiLoading(true);
    try {
      const r = await api.get(`/v1/manav/employees/${id}/sensitive`);
      setPii(r.data.employee);
    } catch (err) {
      pushToast({
        title: err.response?.status === 403
          ? 'Only an org owner or admin can view identity documents'
          : (err.response?.data?.detail || 'Could not reveal details'),
        type: 'error',
      });
    } finally { setPiiLoading(false); }
  }

  function startEditEmp(emp) {
    setEditEmp(emp.id);
    setEditForm({
      name: emp.name || '', email: emp.email || '', phone: emp.phone || '',
      department: emp.department || '', designation: emp.designation || '',
      employment_type: emp.employment_type || 'full_time',
    });
  }

  async function saveEditEmp(e) {
    e.preventDefault();
    setEditSaving(true);
    try {
      await api.patch(`/v1/manav/employees/${editEmp}`, editForm);
      pushToast({ title: 'Employee updated', type: 'success' });
      setEditEmp(null);
      load();
      if (detail) loadDetail(editEmp);
      onUpdate?.();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Could not update employee', type: 'error' }); }
    finally { setEditSaving(false); }
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
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Badge text={emp.status} color={STATUS_COLORS[emp.status] || '#6E7B91'} />
              <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={() => startEditEmp(emp)}>Edit</button>
            </div>
          </div>

          {editEmp === emp.id && (
            <form onSubmit={saveEditEmp} style={{ background: 'var(--surface-0)', border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16, marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name</span>
                  <input className="k-input" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></label>
                <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Email</span>
                  <input className="k-input" type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} /></label>
                <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Phone</span>
                  <input className="k-input" value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} /></label>
                <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Department</span>
                  <input className="k-input" value={editForm.department} onChange={e => setEditForm({ ...editForm, department: e.target.value })} /></label>
                <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Designation</span>
                  <input className="k-input" value={editForm.designation} onChange={e => setEditForm({ ...editForm, designation: e.target.value })} /></label>
                <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Employment Type</span>
                  <select className="k-input" value={editForm.employment_type} onChange={e => setEditForm({ ...editForm, employment_type: e.target.value })}>
                    {EMP_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                  </select></label>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditEmp(null)}>Cancel</button>
                <button type="submit" className="k-btn k-btn--primary" disabled={editSaving}>{editSaving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
            <div><strong>Email:</strong> {emp.email || '—'}</div>
            <div><strong>Phone:</strong> {emp.phone || '—'}</div>
            <div><strong>Type:</strong> {emp.employment_type?.replace('_', ' ')}</div>
            <div><strong>Joining:</strong> {emp.date_of_joining || '—'}</div>
            <div><strong>DOB:</strong> {emp.date_of_birth || '—'}</div>
            <div><strong>Gender:</strong> {emp.gender || '—'}</div>
            <div><strong>PAN:</strong> {(pii ? pii.pan : emp.pan) || '—'}</div>
            <div><strong>Aadhaar:</strong> {(pii ? pii.aadhaar : emp.aadhaar) || '—'}</div>
            <div><strong>UAN:</strong> {emp.uan || '—'}</div>
            <div><strong>Shift:</strong> {emp.shift}</div>
            <div><strong>Blood Group:</strong> {emp.blood_group || '—'}</div>
          </div>

          {(emp.pan || emp.aadhaar) && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {pii ? (
                <>
                  <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                    Identity documents shown in full. This access was logged.
                  </span>
                  <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={() => setPii(null)}>Hide</button>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                    Identity documents are masked. Revealing them is recorded in the audit log.
                  </span>
                  <button
                    className="k-btn k-btn--ghost"
                    style={{ fontSize: 12 }}
                    disabled={piiLoading}
                    onClick={() => revealPii(emp.id)}
                  >
                    {piiLoading ? 'Revealing…' : 'Reveal'}
                  </button>
                </>
              )}
            </div>
          )}
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
        employees.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No employees yet</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Add your team members to manage attendance, leaves, and payroll from one place.</div>
          </div>
        ) : (
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
