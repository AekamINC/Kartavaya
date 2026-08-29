/**
 * ApprovalsPage.jsx — the internal Approvals queue (`/approvals`).
 *
 * The staff-side counterpart to the public `/approve` landing: the same
 * decision, made by someone who has a session.
 *
 * WHAT CHANGED:
 *
 *  · 470 lines in one file, rendering the same queue row inline three times
 *    with drifting action sets. Split into `pages/approvals/` following the
 *    `pages/ganit/` precedent — the route file keeps its path, the parts move.
 *
 *  · 32 inline styles, several on the RETIRED token names (`--ink-2`,
 *    `--ink-3`, `--ink-faint`, `--bg-soft`, `--rule`). They now resolve only
 *    because `00` aliased the legacy layer; the aliases are not a design.
 *
 *  · LOADING, EMPTY and ERROR were not three states. This is the file the
 *    defect is named after — see QueuePanel's docblock. `load()` swallowed
 *    every failure into a transient toast and left the list at `[]`, so a
 *    failed fetch rendered "No pending approvals — you are all caught up" on a
 *    queue nobody had read. On this screen an empty queue is a reason to stop
 *    looking, which makes that sentence the most expensive false statement in
 *    the product.
 *
 *  · `/approvals/history` and `/approvals/stats` were fetched with
 *    `.catch(() => {})` — rejections swallowed with no state written at all.
 *
 * RESPONSE SHAPES, checked in `backend/server.py`:
 *   · `/approvals/pending`  (:1418) → bare array
 *   · `/approvals/history`  (:1456) → bare array
 *   · `/approvals/stats`    (:1483) → bare object
 * `rows()` accepts a bare array and a `{data:[…]}` envelope both, so it is
 * correct here and stays correct if these routes are ever wrapped. The page
 * previously inlined `Array.isArray(r.data) ? r.data : []` at three call sites.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { api, rows as asRows, body } from '../lib/api';
import { currentUser } from '../lib/auth';
import { navContext } from '../components/layout/navConfig';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';
import { errorKind } from '../components/ui/ErrorState';
import TaskDrawer from '../components/TaskDrawer';
import QueuePanel from './approvals/QueuePanel';
import HistoryPanel from './approvals/HistoryPanel';
import PolicyPanel from './approvals/PolicyPanel';
import { ApproveModal, ClientApproveModal, RejectModal } from './approvals/ApprovalModals';
import { Secondary } from '../components/Bilingual';
import { apiErrorText } from '../lib/apiError';

export default function ApprovalsPage() {
  const { pushToast } = useToast();
  const [requests, setRequests] = useState([]);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);

  // Three states, three variables. `null` means "no failure"; a set value is an
  // errorKind() string that ErrorState turns into the one correct action.
  const [loading, setLoading] = useState(true);
  const [queueErr, setQueueErr] = useState(null);
  const [histLoading, setHistLoading] = useState(false);
  const [histErr, setHistErr] = useState(null);
  const [statsErr, setStatsErr] = useState(false);

  const [deciding, setDeciding] = useState({});
  const [adminTab, setAdminTab] = useState('requests'); // 'requests' | 'work'

  const [clientModal, setClientModal] = useState(null);
  const [clientList, setClientList] = useState([]);
  const [clientUserId, setClientUserId] = useState('');
  const [sendNotes, setSendNotes] = useState('');
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectNote, setRejectNote] = useState('');
  const [clientApproveModal, setClientApproveModal] = useState(null);
  const [clientApproveNote, setClientApproveNote] = useState('');
  const [drawerTaskId, setDrawerTaskId] = useState(null);

  const user = currentUser();
  // The SAME predicate as the route guard. `Protected.jsx` confines
  // `navContext().isClient` to `/client/*`, so a portal client never renders
  // this page; bare `role === 'client'` was a wider set that also caught staff
  // carrying the client flag beside an org role — people the guard deliberately
  // does not confine. They reached this page and took the client branch,
  // fetching `/client/approvals`, which is `List[ClientApprovalOut]` (camelCase
  // `approvalId`/`requestedBy`/`requestedAt`, and no status field at all) into
  // rows that read `approval_id`, `approval_status`, `requested_by_name`,
  // `task_title` and `request_data`.
  const isClient = navContext(user).isClient;

  const load = useCallback(async () => {
    setLoading(true);
    setQueueErr(null);
    try {
      // Staff endpoint only — see the note on `isClient`. A portal client's
      // approvals screen is `pages/client/ClientApprovals.jsx`, which reads the
      // client shape through `clientShape.js`.
      const r = await api.get('/approvals/pending');
      setRequests(asRows(r));
    } catch (e) {
      // Recorded in state, not only shouted at a toast that disappears. The
      // panel has to be able to say "this did not load" for as long as it is
      // true, which is the whole point.
      setQueueErr(errorKind(e));
      pushToast({ type: 'error', title: 'Could not load approvals' });
    } finally {
      setLoading(false);
    }

    if (isClient) return;

    setHistLoading(true);
    setHistErr(null);
    try {
      const h = await api.get('/approvals/history');
      setHistory(asRows(h));
    } catch (e) {
      setHistErr(errorKind(e));
    } finally {
      setHistLoading(false);
    }

    setStatsErr(false);
    try {
      // Counted server-side. Deriving these from /approvals/history was wrong
      // because that endpoint is capped at 50 rows, so a day with more than 50
      // decisions under-reported with a plausible-looking number.
      const st = await api.get('/approvals/stats');
      setStats(body(st));
    } catch {
      setStatsErr(true);
    }
  }, [isClient, pushToast]);

  useEffect(() => { load(); }, [load]);

  const decide = async (approvalId, status, extra = {}) => {
    setDeciding(d => ({ ...d, [approvalId]: true }));
    try {
      await api.post(`/approvals/${approvalId}/review`, { status, notes: extra.notes || '', ...extra });
      pushToast({
        type: 'success',
        title: status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Sent to client',
      });
      load();
    } catch (e) {
      pushToast({ type: 'error', title: 'Action failed', message: apiErrorText(e, 'Try again') });
    } finally {
      setDeciding(d => { const n = { ...d }; delete n[approvalId]; return n; });
    }
  };

  const clientDecideTask = async (approvalId, status, notes = '') => {
    const taskId = approvalId.replace('task_approval--', '');
    setDeciding(d => ({ ...d, [approvalId]: true }));
    try {
      const endpoint = status === 'approved'
        ? `/tasks/${taskId}/client-approve`
        : `/tasks/${taskId}/client-reject`;
      await api.post(endpoint, { notes });
      pushToast({ type: 'success', title: status === 'approved' ? 'Approved' : 'Rejected' });
      load();
    } catch (e) {
      pushToast({ type: 'error', title: 'Action failed', message: apiErrorText(e, 'Try again') });
    } finally {
      setDeciding(d => { const n = { ...d }; delete n[approvalId]; return n; });
    }
  };

  const openApproveFlow = (approvalId, teamId) => {
    if (isClient) { setClientApproveNote(''); setClientApproveModal({ approvalId }); return; }
    // Only task-level approvals get the client-send choice.
    if (approvalId.startsWith('task_approval--')) {
      setClientUserId(''); setSendNotes(''); setClientList([]);
      setClientModal({ approvalId, teamId });
      if (teamId) {
        api.get(`/teams/${teamId}/clients`)
          .then(r => setClientList(asRows(r)))
          .catch(() => setClientList([]));
      }
    } else {
      decide(approvalId, 'approved');
    }
  };

  const openRejectFlow = (approvalId) => { setRejectNote(''); setRejectModal({ approvalId }); };

  const confirmApproveWithClient = async () => {
    const { approvalId } = clientModal;
    const selected = clientList.find(c => c.user_id === clientUserId);
    setClientModal(null);
    await decide(approvalId, 'approved', selected
      ? { send_to_client: true, client_email: selected.email, notes: sendNotes }
      : { send_to_client: false, notes: sendNotes });
  };

  const confirmClientApprove = async () => {
    const { approvalId } = clientApproveModal;
    setClientApproveModal(null);
    await clientDecideTask(approvalId, 'approved', clientApproveNote);
  };

  const confirmReject = async () => {
    const { approvalId } = rejectModal;
    setRejectModal(null);
    if (isClient && approvalId?.startsWith('task_approval--')) {
      await clientDecideTask(approvalId, 'rejected', rejectNote);
    } else {
      await decide(approvalId, 'rejected', { notes: rejectNote });
    }
  };

  // Split staff requests into task-creation requests vs work approvals.
  const taskRequestRows = requests.filter(r => !r.approval_id?.startsWith('task_approval--'));
  const workApprovalRows = requests.filter(r => r.approval_id?.startsWith('task_approval--'));
  const visibleRows = isClient
    ? requests
    : (adminTab === 'requests' ? taskRequestRows : workApprovalRows);

  // '—' when the count genuinely failed, so a broken tile never reads as a real
  // zero. `stats?.x ?? null` alone could not tell those apart.
  const statValue = (key) => (statsErr ? '—' : stats?.[key] ?? '—');

  const TABS = [
    ['requests', 'Task requests', 'अनुरोध', taskRequestRows.length],
    ['work', 'Work approvals', 'कार्य', workApprovalRows.length],
  ];

  return (
    <div className="k-screen">
      <PageHeader
        kicker="REVIEW"
        title={isClient ? 'My Approvals' : 'Approvals'}
        sanskrit="अनुमोदन"
        lede={isClient
          ? 'Tasks sent to you for approval, and your submitted requests.'
          : 'Items waiting on you. Review, approve, or send back.'}
        right={!isClient && (
          <div className="apv-counter">
            {/* The queue count is only honest once the queue has actually been
                read. While it is loading or after it failed this shows '—'
                rather than a confident 0. */}
            <div className="apv-counter__n">{loading || queueErr ? '—' : requests.length}</div>
            <div className="apv-counter__l">awaiting<br />your nod</div>
          </div>
        )}
      />

      {!isClient && (
        <div className="k-stats">
          <StatTile variant="amber" label="PENDING" sanskrit="लंबित"
            value={loading || queueErr ? '—' : requests.length} sub="awaiting your call" />
          <StatTile variant="teal" label="APPROVED" sanskrit="स्वीकृत"
            value={statValue('approved_today')} sub="today" />
          <StatTile variant="red" label="REJECTED" sanskrit="अस्वीकृत"
            value={statValue('rejected_today')} sub="today" />
        </div>
      )}

      {!isClient && statsErr && (
        <div className="note note--warn" role="status">
          <b>Today&rsquo;s decision counts did not load.</b> The queue below is unaffected.
        </div>
      )}

      {!isClient && (
        <div className="apv-seg" role="tablist" aria-label="Approval type">
          {TABS.map(([id, label, hi, n]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={adminTab === id}
              className={`apv-seg__btn${adminTab === id ? ' is-active' : ''}`}
              onClick={() => setAdminTab(id)}
            >
              {label}
              {n > 0 && <span className="apv-seg__n">{n}</span>}
              <Secondary className="apv-seg__hi" value={hi} />
            </button>
          ))}
        </div>
      )}

      <QueuePanel
        title={isClient ? 'Pending approval' : adminTab === 'requests' ? 'Pending task requests' : 'Pending work approvals'}
        sanskrit="लंबित अनुमोदन"
        rows={visibleRows}
        loading={loading}
        error={queueErr}
        onRetry={load}
        isClient={isClient}
        deciding={deciding}
        onOpenTask={setDrawerTaskId}
        onApprove={openApproveFlow}
        onReject={openRejectFlow}
      />

      {!isClient && (
        <HistoryPanel rows={history} loading={histLoading} error={histErr} onRetry={load} />
      )}

      {/* The switch behind the queue. Placed on THIS page and not in project
          settings because the person who empties this queue is the person who
          decides whether it should fill — and because a gate whose control is
          three screens away is a gate people work around. It loads its own data
          and owns its own three states, so a policy failure cannot blank the
          queue above it. */}
      {!isClient && <PolicyPanel />}

      <ApproveModal
        open={!!clientModal}
        onClose={() => setClientModal(null)}
        notes={sendNotes}
        setNotes={setSendNotes}
        clients={clientList}
        clientUserId={clientUserId}
        setClientUserId={setClientUserId}
        onConfirm={confirmApproveWithClient}
      />

      <ClientApproveModal
        open={!!clientApproveModal}
        onClose={() => setClientApproveModal(null)}
        note={clientApproveNote}
        setNote={setClientApproveNote}
        onConfirm={confirmClientApprove}
      />

      <RejectModal
        open={!!rejectModal}
        onClose={() => setRejectModal(null)}
        note={rejectNote}
        setNote={setRejectNote}
        onConfirm={confirmReject}
      />

      <TaskDrawer
        taskId={drawerTaskId}
        open={!!drawerTaskId}
        onClose={() => setDrawerTaskId(null)}
        onSaved={() => { setDrawerTaskId(null); load(); }}
        onDeleted={() => { setDrawerTaskId(null); load(); }}
      />
    </div>
  );
}
