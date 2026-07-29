// Graha · approvals — the threshold rules and the requests they raise.
//
// 47 inline styles are now `gr__*` classes.
//
// The single `catch { toast }` around both loads fell through to two "nothing
// here" table rows: "No approval rules defined" and "No {status} requests".
// The second is the dangerous one — a pending approval that failed to load
// reads as an empty queue, and an empty queue is a reason to stop looking.
// Both tables now render an error state with a retry instead.
import React, { useState, useEffect } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonRegion, SkeletonList } from '../../components/ui/Skeleton';
import { Badge } from './_shared';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';

const ENTITY_TYPES = ['deal', 'vendor_bill', 'expense_claim'];
const STATUS_COLORS = { pending: 'var(--warn)', approved: 'var(--ok)', rejected: 'var(--danger)' };

export default function ApprovalsTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change CRM settings' });
  const { pushToast } = useToast();
  const [rules, setRules] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [ruleEntityFilter, setRuleEntityFilter] = useState('');
  const [requestStatus, setRequestStatus] = useState('pending');
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({ entity_type: 'deal', threshold_amount: '', approver_role: '' });

  const FMT = v => inr(Number(v || 0));

  useEffect(() => { load(); }, []);

  async function load() {
    setErr(null);
    try {
      const params = ruleEntityFilter ? `?entity_type=${ruleEntityFilter}` : '';
      const [rulesR, reqR] = await Promise.all([
        api.get(`/v1/graha/approval-rules${params}`),
        api.get(`/v1/graha/approval-requests?status=${requestStatus}`),
      ]);
      setRules(rows(rulesR));
      setRequests(rows(reqR));
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load approvals', type: 'error' });
    }
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
    } catch (e2) { pushToast({ title: e2.response?.data?.detail || 'Failed', type: 'error' }); }
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

  if (loading) return <SkeletonRegion label="Loading approvals"><SkeletonList rows={6} /></SkeletonRegion>;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  return (
    <div>
      <div className="gr__shead">
        <h3 className="gr__st">Approval Rules ({rules.length})</h3>
        <div className="gr__sacts">
          <select className="k-input gr__sel gr__sel--wide" aria-label="Filter rules by entity" value={ruleEntityFilter} onChange={e => setRuleEntityFilter(e.target.value)}>
            <option value="">All Entities</option>
            {ENTITY_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <button className="k-btn k-btn--ghost" onClick={load}>Filter</button>
          <button className="k-btn k-btn--primary" onClick={() => setShowRuleForm(!showRuleForm)} disabled={!canWrite} title={denial || undefined}>+ New Rule</button>
        </div>
      </div>

      {showRuleForm && (
        <form onSubmit={createRule} className="gr__panel gr__panel--flat">
          <div className="gr__grid gr__grid--3">
            <label className="gr__f"><span className="gr__fl">Entity Type</span>
              <select className="k-input" value={ruleForm.entity_type} onChange={e => setRuleForm({ ...ruleForm, entity_type: e.target.value })}>
                {ENTITY_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select></label>
            <label className="gr__f"><span className="gr__fl">Threshold Amount</span>
              <input className="k-input" type="number" required value={ruleForm.threshold_amount} onChange={e => setRuleForm({ ...ruleForm, threshold_amount: e.target.value })} /></label>
            <label className="gr__f"><span className="gr__fl">Approver Role</span>
              <input className="k-input" required value={ruleForm.approver_role} onChange={e => setRuleForm({ ...ruleForm, approver_role: e.target.value })} /></label>
          </div>
          <div className="gr__acts">
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowRuleForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={!canWrite} title={denial || undefined}>Create Rule</button>
          </div>
        </form>
      )}

      <div className="gr__tblwrap gr__tblwrap--bare gr__group">
        <table className="gr__tbl">
          <thead>
            <tr>{['Entity Type', 'Threshold', 'Approver Role', 'Status', 'Actions'].map(h => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id}>
                <td className="gr__td--cap">{r.entity_type.replace(/_/g, ' ')}</td>
                <td className="gr__td--name">{FMT(r.threshold_amount)}</td>
                <td>{r.approver_role}</td>
                <td><Badge text={r.is_active ? 'Active' : 'Inactive'} color={r.is_active ? 'var(--ok)' : 'var(--on-surface-3)'} /></td>
                <td><button className="k-btn k-btn--reject" onClick={() => deleteRule(r.id)}>Delete</button></td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr><td className="gr__none" colSpan={5}>No approval rules defined.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="gr__shead">
        <h3 className="gr__st">Approval Requests</h3>
        <div className="gr__sacts">
          <select className="k-input gr__sel" aria-label="Filter requests by status" value={requestStatus} onChange={e => setRequestStatus(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <button className="k-btn k-btn--ghost" onClick={load}>Filter</button>
        </div>
      </div>

      <div className="gr__tblwrap gr__tblwrap--bare">
        <table className="gr__tbl">
          <thead>
            <tr>{['Entity Type', 'Amount', 'Status', 'Requested By', 'Approver Role', 'Created', 'Actions'].map(h => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {requests.map(r => (
              <tr key={r.id}>
                <td className="gr__td--cap">{r.entity_type.replace(/_/g, ' ')}</td>
                <td className="gr__td--name">{FMT(r.amount)}</td>
                <td><Badge text={r.status} color={STATUS_COLORS[r.status] || 'var(--on-surface-3)'} /></td>
                <td className="gr__td--id">{r.requested_by?.slice(0, 12) || '—'}</td>
                <td>{r.approver_role || '—'}</td>
                <td className="gr__td--when">{r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '—'}</td>
                <td>
                  {r.status === 'pending' && (
                    <div className="gr__sacts">
                      <button className="k-btn k-btn--primary" onClick={() => approveRequest(r.id)} disabled={!canWrite} title={denial || undefined}>Approve</button>
                      <button className="k-btn k-btn--reject" onClick={() => rejectRequest(r.id)}>Reject</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr><td className="gr__none" colSpan={7}>No {requestStatus} requests.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
