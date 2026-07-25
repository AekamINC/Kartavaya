import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge } from './_shared';

export default function ApprovalsTab() {
  const { pushToast } = useToast();
  const [rules, setRules] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ruleEntityFilter, setRuleEntityFilter] = useState('');
  const [requestStatus, setRequestStatus] = useState('pending');
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({ entity_type: 'deal', threshold_amount: '', approver_role: '' });

  const FMT = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;
  const ENTITY_TYPES = ['deal', 'vendor_bill', 'expense_claim'];
  const STATUS_COLORS = { pending: '#f59e0b', approved: '#10b981', rejected: '#ef4444' };

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const params = ruleEntityFilter ? `?entity_type=${ruleEntityFilter}` : '';
      const [rulesR, reqR] = await Promise.all([
        api.get(`/v1/graha/approval-rules${params}`),
        api.get(`/v1/graha/approval-requests?status=${requestStatus}`),
      ]);
      setRules(rulesR.data.data || []);
      setRequests(reqR.data.data || []);
    } catch { pushToast({ title: 'Failed to load approvals', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function createRule(e) {
    e.preventDefault();
    try {
      await api.post('/v1/graha/approval-rules', { ...ruleForm, threshold_amount: parseFloat(ruleForm.threshold_amount) || 0 });
      pushToast({ title: 'Approval rule created', type: 'success' });
      setShowRuleForm(false);
      setRuleForm({ entity_type: 'deal', threshold_amount: '', approver_role: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function deleteRule(id) {
    if (!window.confirm('Delete this approval rule? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/approval-rules/${id}`);
      pushToast({ title: 'Rule deleted', type: 'success' });
      setRules(prev => prev.filter(r => r.id !== id));
    } catch { pushToast({ title: 'Could not delete approval rule', type: 'error' }); }
  }

  async function approveRequest(id) {
    try {
      await api.post(`/v1/graha/approval-requests/${id}/approve`);
      pushToast({ title: 'Request approved', type: 'success' });
      load();
    } catch { pushToast({ title: 'Approve failed', type: 'error' }); }
  }

  async function rejectRequest(id) {
    try {
      await api.post(`/v1/graha/approval-requests/${id}/reject`);
      pushToast({ title: 'Request rejected', type: 'success' });
      load();
    } catch { pushToast({ title: 'Reject failed', type: 'error' }); }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  return (
    <div>
      {/* ── Approval Rules ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>Approval Rules ({rules.length})</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="k-input" style={{ width: 150 }} value={ruleEntityFilter} onChange={e => setRuleEntityFilter(e.target.value)}>
            <option value="">All Entities</option>
            {ENTITY_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
          <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => setShowRuleForm(!showRuleForm)}>+ New Rule</button>
        </div>
      </div>

      {showRuleForm && (
        <form onSubmit={createRule} style={{ border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Entity Type</span>
              <select className="k-input" value={ruleForm.entity_type} onChange={e => setRuleForm({ ...ruleForm, entity_type: e.target.value })}>
                {ENTITY_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Threshold Amount</span>
              <input className="k-input" type="number" value={ruleForm.threshold_amount} onChange={e => setRuleForm({ ...ruleForm, threshold_amount: e.target.value })} required /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Approver Role</span>
              <input className="k-input" value={ruleForm.approver_role} onChange={e => setRuleForm({ ...ruleForm, approver_role: e.target.value })} required /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowRuleForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Create Rule</button>
          </div>
        </form>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 32 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
            {['Entity Type', 'Threshold', 'Approver Role', 'Status', 'Actions'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rules.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              <td style={{ padding: '10px', textTransform: 'capitalize' }}>{r.entity_type.replace(/_/g, ' ')}</td>
              <td style={{ padding: '10px', fontWeight: 600 }}>{FMT(r.threshold_amount)}</td>
              <td style={{ padding: '10px' }}>{r.approver_role}</td>
              <td style={{ padding: '10px' }}><Badge text={r.is_active ? 'Active' : 'Inactive'} color={r.is_active ? '#10b981' : '#6b7280'} /></td>
              <td style={{ padding: '10px' }}>
                <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: '#ef4444' }} onClick={() => deleteRule(r.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {rules.length === 0 && (
            <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>No approval rules defined.</td></tr>
          )}
        </tbody>
      </table>

      {/* ── Pending Requests ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>Approval Requests</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="k-input" style={{ width: 130 }} value={requestStatus} onChange={e => setRequestStatus(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
            {['Entity Type', 'Amount', 'Status', 'Requested By', 'Approver Role', 'Created', 'Actions'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {requests.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              <td style={{ padding: '10px', textTransform: 'capitalize' }}>{r.entity_type.replace(/_/g, ' ')}</td>
              <td style={{ padding: '10px', fontWeight: 600 }}>{FMT(r.amount)}</td>
              <td style={{ padding: '10px' }}><Badge text={r.status} color={STATUS_COLORS[r.status] || '#6b7280'} /></td>
              <td style={{ padding: '10px', fontSize: 11, fontFamily: 'var(--mono)' }}>{r.requested_by?.slice(0, 12) || '—'}</td>
              <td style={{ padding: '10px' }}>{r.approver_role || '—'}</td>
              <td style={{ padding: '10px', fontSize: 11, color: 'var(--ink-3)' }}>{r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '—'}</td>
              <td style={{ padding: '10px' }}>
                {r.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="k-btn k-btn--primary" style={{ fontSize: 11, padding: '2px 10px' }} onClick={() => approveRequest(r.id)}>Approve</button>
                    <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 10px', color: '#ef4444' }} onClick={() => rejectRequest(r.id)}>Reject</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {requests.length === 0 && (
            <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>No {requestStatus} requests.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
