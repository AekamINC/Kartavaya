import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge, LEAVE_COLORS } from './_shared';

export default function LeavesTab() {
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
  const [reqForm, setReqForm] = useState({ employee_id: '', leave_type_id: '', start_date: '', end_date: '', days: 1, reason: '' });
  const [typeForm, setTypeForm] = useState({ name: '', code: '', annual_quota: 12, is_paid: true, carry_forward: false });
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState([]);

  useEffect(() => { load(); loadTypes(); loadEmployees(); }, []);

  async function loadEmployees() {
    try { const r = await api.get('/v1/manav/employees'); setEmployees(r.data.data || []); } catch {}
  }

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
      setReqForm({ employee_id: '', leave_type_id: '', start_date: '', end_date: '', days: 1, reason: '' });
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
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Employee *</span>
              <select className="k-input" required value={reqForm.employee_id} onChange={e => setReqForm({ ...reqForm, employee_id: e.target.value })}>
                <option value="">Select employee…</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_code})</option>)}
              </select></label>
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
        leaves.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏖️</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No leave requests</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Leave requests from employees will appear here for approval.</div>
          </div>
        ) : (
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
