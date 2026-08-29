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
import { HeadCell } from '../../components/ui/Table';
import {
  CreatedCell, UpdatedCell, ByCell, CREATED_KEY, UPDATED_KEY,
} from '../../components/ui/CreatedColumn';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from '../../components/ui/CustomizeColumns';
import { apiErrorText } from '../../lib/apiError';

const ENTITY_TYPES = ['deal', 'vendor_bill', 'expense_claim'];
const STATUS_COLORS = { pending: 'var(--warn)', approved: 'var(--ok)', rejected: 'var(--danger)' };

/**
 * The two tables on this tab, declared once each — and two keys, because a
 * RULE and a REQUEST are different records that only share a screen. Neither
 * table is sortable today, so no column carries a `sortKey`; the arrangement is
 * order, visibility and width only.
 *
 * `fixed` on Entity Type and Actions in both. A rule is identified by what it
 * applies to and at what threshold, and a request by what it is asking about —
 * Entity Type is the first of those and the one every other cell qualifies.
 * Actions carries Delete on the rules and Approve/Reject on the requests, and
 * an approvals queue with no way to approve is the one failure this screen
 * cannot survive.
 */
const APPROVAL_RULE_COLUMNS = [
  { id: 'entity_type', label: 'Entity Type', fixed: true },
  { id: 'threshold_amount', label: 'Threshold' },
  { id: 'approver_role', label: 'Approver Role' },
  { id: 'is_active', label: 'Status' },
  /* ── THE AUDIT PAIR, and why the RULES table is where it belongs ────────
     A rule decides whose signature a deal over a threshold needs. Changing
     the threshold — or retiring the rule, which this tab does with a Delete
     button — changes who has to approve every deal from that moment on, with
     no record on screen of who decided that. That is a governance question,
     not a nicety, and migration 202 is what made it answerable by giving
     `graha_approval_rules` a `created_by` at all.

     "Set by" and "Changed by" rather than Created/Updated by: a threshold is
     SET, and the verbs on this screen (Approve, Reject, Create Rule) are
     already the language of a decision. `updated_at` is the load-bearing one
     — `trg_touch_graha_approval_rules` moves that stamp on every edit, so a
     rule whose Updated date is later than its Created date has been changed
     since it was written, and the next cell says by whom.

     No `sortKey` on any of the four, matching every other column here:
     neither table on this tab runs `useTableView`, and a header that offers a
     sort nothing implements is worse than one that does not. The columns are
     arrangeable, hideable and resizable like the rest.

     Names only — `created_by`/`updated_by` hold `users.user_id`, which is a
     member id and never renders. `has_creator`/`has_updater` come across so
     ByCell can say `unknown` for a rule set by somebody who has since left,
     rather than an em dash claiming nobody set it. */
  { id: CREATED_KEY, label: 'Created', className: 'tbl__created' },
  { id: 'created_by_name', label: 'Set by', className: 'tbl__by' },
  { id: UPDATED_KEY, label: 'Updated', className: 'tbl__created' },
  { id: 'updated_by_name', label: 'Changed by', className: 'tbl__by' },
  { id: 'actions', label: 'Actions', fixed: true },
];

/**
 * ── THE REQUESTS TABLE HAD ITS ACTORS ALL ALONG, AS IDS ────────────────────
 *
 * `graha_approval_requests` already records `requested_by` and `approved_by`,
 * so migrations 201/202 gave it nothing — it was never missing an author. It
 * was missing the RESOLUTION, and this cell printed
 * `r.requested_by?.slice(0, 12)`: a truncated `users.user_id` on screen, which
 * is the names-not-ids rule broken. `check-rendered-ids.mjs` did not catch it
 * because that ratchet is positional, and twelve characters of
 * `user_f1a0a472b98f` do not read as an id shape.
 *
 * `list_approval_requests` now resolves both, aliasing the requester to
 * `created_by_name`/`has_creator` so the contract matches every other table in
 * the product. The APPROVER keeps its own name: "approved by" is a different
 * fact from "last edited by" and must not be read as one.
 *
 * There is still no `updated_*` pair, and that is correct rather than pending —
 * a request is raised once and then decided; `decided_at` and the approver ARE
 * its state change. Declaring an "Updated by" column here would render an em
 * dash on every row for ever.
 */
const APPROVAL_REQUEST_COLUMNS = [
  { id: 'entity_type', label: 'Entity Type', fixed: true },
  { id: 'amount', label: 'Amount' },
  { id: 'status', label: 'Status' },
  { id: 'requested_by', label: 'Requested By' },
  { id: 'approver_role', label: 'Approver Role' },
  { id: CREATED_KEY, label: 'Created', className: 'tbl__created' },
  { id: 'approved_by_name', label: 'Decided by', className: 'tbl__by' },
  { id: 'actions', label: 'Actions', fixed: true },
];

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
    } catch (e2) { pushToast({ title: apiErrorText(e2, 'Failed'), type: 'error' }); }
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

  // ABOVE the two early returns below: a loading or errored render that called
  // fewer hooks than a loaded one is exactly the "rendered fewer hooks than
  // expected" crash, and this component returns early twice.
  const ruleCols = useColumnPrefs('graha.approval_rules', APPROVAL_RULE_COLUMNS);
  const reqCols = useColumnPrefs('graha.approval_requests', APPROVAL_REQUEST_COLUMNS);

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
          {/* No TableToolbar on this tab, so the control joins the section
              header's own control row rather than claiming a bar of its own. */}
          <ColumnsButton cols={ruleCols} />
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

      <div className="tbl__wrap gr__group">
        <table className="tbl">
          <thead>
            <tr>
              {ruleCols.columns.map(c => (
                <HeadCell key={c.id} width={c.width} onResize={w => ruleCols.setWidth(c.id, w)}>
                  {c.label}
                </HeadCell>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id}>
                {ruleCols.cells({
                  entity_type: <td className="gr__td--cap">{r.entity_type.replace(/_/g, ' ')}</td>,
                  threshold_amount: <td className="gr__td--name">{FMT(r.threshold_amount)}</td>,
                  approver_role: <td>{r.approver_role}</td>,
                  is_active: <td><Badge text={r.is_active ? 'Active' : 'Inactive'} color={r.is_active ? 'var(--ok)' : 'var(--on-surface-3)'} /></td>,
                  [CREATED_KEY]: <CreatedCell value={r.created_at} />,
                  created_by_name: <ByCell name={r.created_by_name} hasActor={r.has_creator} />,
                  [UPDATED_KEY]: <UpdatedCell value={r.updated_at} />,
                  updated_by_name: <ByCell name={r.updated_by_name} hasActor={r.has_updater} />,
                  actions: <td><button className="k-btn k-btn--reject" onClick={() => deleteRule(r.id)}>Delete</button></td>,
                })}
              </tr>
            ))}
            {rules.length === 0 && (
              // Spans what is on screen, not a literal 5 a hidden column would
              // falsify — the sentence would otherwise stop short of the table.
              <tr><td className="gr__none" colSpan={ruleCols.columns.length}>No approval rules defined.</td></tr>
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
          <ColumnsButton cols={reqCols} />
        </div>
      </div>

      <div className="tbl__wrap">
        <table className="tbl">
          <thead>
            <tr>
              {reqCols.columns.map(c => (
                <HeadCell key={c.id} width={c.width} onResize={w => reqCols.setWidth(c.id, w)}>
                  {c.label}
                </HeadCell>
              ))}
            </tr>
          </thead>
          <tbody>
            {requests.map(r => (
              <tr key={r.id}>
                {reqCols.cells({
                  entity_type: <td className="gr__td--cap">{r.entity_type.replace(/_/g, ' ')}</td>,
                  amount: <td className="gr__td--name">{FMT(r.amount)}</td>,
                  status: <td><Badge text={r.status} color={STATUS_COLORS[r.status] || 'var(--on-surface-3)'} /></td>,
                  // The NAME the API now resolves — never `r.requested_by`,
                  // which is still in the payload and is a user id.
                  requested_by: <ByCell name={r.created_by_name} hasActor={r.has_creator} />,
                  approver_role: <td>{r.approver_role || '—'}</td>,
                  [CREATED_KEY]: <CreatedCell value={r.created_at} />,
                  // `has_approver`, not `has_updater`: a request is DECIDED,
                  // not edited, and the two absences differ here as everywhere
                  // — an em dash means undecided, `unknown` means the approver's
                  // account is gone.
                  approved_by_name: <ByCell name={r.approved_by_name} hasActor={r.has_approver} />,
                  actions: (
                    <td>
                      {r.status === 'pending' && (
                        <div className="gr__sacts">
                          <button className="k-btn k-btn--primary" onClick={() => approveRequest(r.id)} disabled={!canWrite} title={denial || undefined}>Approve</button>
                          <button className="k-btn k-btn--reject" onClick={() => rejectRequest(r.id)}>Reject</button>
                        </div>
                      )}
                    </td>
                  ),
                })}
              </tr>
            ))}
            {requests.length === 0 && (
              <tr><td className="gr__none" colSpan={reqCols.columns.length}>No {requestStatus} requests.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
