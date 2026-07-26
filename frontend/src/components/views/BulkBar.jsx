import React, { useState } from 'react';
import { api } from '../../lib/api';
import { logger } from '../../lib/utils';
import { BulkBar as BulkShell, Menu, useToast, ConfirmDialog } from '../ui';
import { PRIORITY_LABELS, STATUS_LABELS } from '../../lib/statusColors';

/**
 * BulkBar — status · assignee · due · delete over a row selection
 * (04-boards-table-views.md §2, new).
 *
 * **The bar itself is `ui/Table.jsx`'s `BulkBar`.** That component already
 * states the count before the verbs — "3 selected" and then the actions, so the
 * user reads what they are about to act on before what the action is — and
 * carries `role="status"`. This file supplies the verbs.
 *
 * **On the endpoints.** 04 §4 specs `PATCH /v1/tasks/bulk` and
 * `DELETE /v1/tasks/bulk`. Both now exist (`backend/routers/tasks_bulk.py`), so
 * the `Promise.allSettled` fan-out this file used to carry is gone. Its own
 * header promised "replace the fan-out the day the two bulk endpoints land; the
 * call sites and the reporting stay as they are" — that is exactly what this
 * is. Forty selected rows were forty round trips, forty authorisation checks
 * and forty automation fires, with nothing stopping the selection ending up
 * half-applied if the tab closed midway. One request now, transactional, with
 * per-id savepoints.
 *
 * The reporting did stay. The route answers
 * `{requested, updated, failed, results[]}` where each result is
 * `{task_id, ok, status?, error?}`, which is strictly more than `allSettled`
 * could tell us — it knows a request rejected, not whether the task was missing
 * or the caller was refused. So a partial batch still reports the split
 * honestly, and only ids the server confirmed are written back to local state:
 * a refused row keeps its old value on screen rather than showing a change that
 * did not happen (MOTION-SPEC §7.1 — never lie about state).
 */
export default function BulkBar({ ids, columns = [], teamMembers = [], onClear, onPatched, onDeleted }) {
  const { pushToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [dueOpen, setDueOpen] = useState(false);

  const count = ids.length;

  /**
   * `{requested, updated, failed, results[]}` → a toast and the ids that stuck.
   *
   * The split is reported from `results`, not from whether the request threw:
   * the route answers 200 for a partially-applied batch, because a savepoint
   * rollback on one id is not a failure of the other thirty-nine.
   */
  const report = (data, verb) => {
    const results = Array.isArray(data?.results) ? data.results : [];
    const ok = results.filter(r => r.ok);
    const bad = results.length - ok.length;
    if (!bad) pushToast({ type: 'success', title: `${ok.length} ${ok.length === 1 ? 'task' : 'tasks'} ${verb}` });
    else if (!ok.length) pushToast({ type: 'error', title: `Could not ${verb === 'deleted' ? 'delete' : 'update'} ${bad} ${bad === 1 ? 'task' : 'tasks'}` });
    else pushToast({ type: 'warning', title: `${ok.length} ${verb} · ${bad} failed` });
    return ok;
  };

  /** A whole batch that never reached the server — network, 4xx on the body. */
  const reportThrow = (e, verb) => {
    logger.error('Bulk request failed', e);
    pushToast({
      type: 'error',
      title: `Could not ${verb === 'deleted' ? 'delete' : 'update'} ${count === 1 ? 'the task' : `these ${count} tasks`}`,
      body: e?.response?.data?.detail,
    });
  };

  const patchAll = async (patch, verb = 'updated') => {
    if (!count || busy) return;
    setBusy(true);
    try {
      const { data } = await api.patch('/v1/tasks/bulk', { task_ids: ids, patch });
      const ok = report(data, verb);
      // The route returns `{task_id, ok, status}` per row, not the whole task,
      // so the local merge is the patch we sent plus the server's authoritative
      // status — which is NOT always the status we asked for: moving into a
      // column flagged `is_done` forces `done`. Taking the server's value here
      // is what keeps a bar-moved card and a hand-dragged one in the same state.
      onPatched?.(ok.map(r => ({ task_id: r.task_id, ...patch, ...(r.status ? { status: r.status } : {}) })));
    } catch (e) {
      reportThrow(e, verb);
    } finally {
      setBusy(false);
    }
  };

  const deleteAll = () => {
    setConfirmState({
      title: `Delete ${count} ${count === 1 ? 'task' : 'tasks'}?`,
      message: 'This cannot be undone. Comments, attachments and time entries on these tasks go with them.',
      intent: 'danger',
      confirmLabel: 'Delete',
      confirmText: count > 4 ? 'DELETE' : undefined,
      onConfirm: async () => {
        setBusy(true);
        try {
          // axios sends a DELETE body only under `data`. The route reads
          // `task_ids` from the body rather than the query string because a
          // 200-id selection would overflow a URL.
          const { data } = await api.delete('/v1/tasks/bulk', { data: { task_ids: ids } });
          const ok = report(data, 'deleted');
          onDeleted?.(ok.map(r => r.task_id));
          onClear?.();
        } catch (e) {
          reportThrow(e, 'deleted');
        } finally {
          setBusy(false);
        }
      },
    });
  };

  if (!count) return null;

  const statusItems = Object.entries(STATUS_LABELS).map(([id, label]) => ({
    id, label, onSelect: () => patchAll({ status: id }),
  }));

  const columnItems = (columns || []).map(c => ({
    id: c.column_id, label: c.name, onSelect: () => patchAll({ column_id: c.column_id }),
  }));

  const priorityItems = Object.entries(PRIORITY_LABELS).map(([id, label]) => ({
    id, label, onSelect: () => patchAll({ priority: id }),
  }));

  const assigneeItems = [
    { id: '__none__', label: 'Unassigned', onSelect: () => patchAll({ assignee_user_ids: [] }) },
    ...(teamMembers.length ? [{ sep: true }] : []),
    ...teamMembers.map(m => ({
      id: m.user_id,
      label: m.full_name || m.name || m.email || m.user_id,
      onSelect: () => patchAll({ assignee_user_ids: [m.user_id] }),
    })),
  ];

  return (
    <>
      <BulkShell count={count} onClear={onClear}>
        <Menu
          label="Set status"
          align="left"
          trigger={<span className="btn btn--out btn--sm">Status</span>}
          items={columnItems.length ? [...columnItems, { sep: true }, ...statusItems] : statusItems}
        />
        <Menu
          label="Set priority"
          align="left"
          trigger={<span className="btn btn--out btn--sm">Priority</span>}
          items={priorityItems}
        />
        <Menu
          label="Set assignee"
          align="left"
          trigger={<span className="btn btn--out btn--sm">Assignee</span>}
          items={assigneeItems}
        />

        {/* `.inp`, not `.k-input`. The legacy class hard-codes
            `border-radius: 8px` — 00 §3 forbids a literal radius because it
            ignores the Sharp/Pill setting — and takes its focus border from
            `--k-primary`, an alias of `--primary-vivid`, which is a FILL and
            fails contrast as a 1px ring. `.bulk .inp` sizes it to the bar. */}
        {dueOpen ? (
          <input
            className="inp"
            type="date"
            aria-label="Set due date"
            autoFocus
            onBlur={() => setDueOpen(false)}
            onChange={e => {
              setDueOpen(false);
              patchAll({ due_at: e.target.value ? new Date(e.target.value).toISOString() : null });
            }}
          />
        ) : (
          <button type="button" className="btn btn--out btn--sm" onClick={() => setDueOpen(true)} disabled={busy}>
            Due date
          </button>
        )}

        <button type="button" className="btn btn--danger btn--sm" onClick={deleteAll} disabled={busy}>
          Delete
        </button>
      </BulkShell>

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </>
  );
}
