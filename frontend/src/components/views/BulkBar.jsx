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
 * `DELETE /v1/tasks/bulk`. Neither exists on the backend, and the backend is
 * not this batch's to write, so each action fans out over the per-task
 * endpoints that do exist. Two consequences are stated rather than hidden:
 *
 *  · The fan-out is `allSettled`, never `all`. A rejected `all` abandons the
 *    remaining requests after the first failure, leaving a selection where an
 *    arbitrary prefix was applied and the rest was not — and the user has no
 *    way to tell which. `allSettled` finishes the batch and the toast reports
 *    the split honestly: "12 updated · 2 failed".
 *  · Only rows that actually succeeded are written back to local state, so a
 *    failed row keeps its old value on screen instead of showing a change the
 *    server rejected.
 *
 * Replace the fan-out the day the two bulk endpoints land; the call sites and
 * the reporting stay as they are.
 */
export default function BulkBar({ ids, columns = [], teamMembers = [], onClear, onPatched, onDeleted }) {
  const { pushToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [dueOpen, setDueOpen] = useState(false);

  const count = ids.length;

  const report = (results, verb) => {
    const ok = results.filter(r => r.status === 'fulfilled');
    const bad = results.length - ok.length;
    if (!bad) pushToast({ type: 'success', title: `${ok.length} ${ok.length === 1 ? 'task' : 'tasks'} ${verb}` });
    else if (!ok.length) pushToast({ type: 'error', title: `Could not ${verb === 'deleted' ? 'delete' : 'update'} ${bad} ${bad === 1 ? 'task' : 'tasks'}` });
    else pushToast({ type: 'warning', title: `${ok.length} ${verb} · ${bad} failed` });
    return ok;
  };

  const patchAll = async (patch, verb = 'updated') => {
    if (!count || busy) return;
    setBusy(true);
    try {
      const results = await Promise.allSettled(ids.map(id => api.patch(`/tasks/${id}`, patch)));
      const ok = report(results, verb);
      onPatched?.(ok.map(r => r.value.data).filter(Boolean));
    } catch (e) {
      logger.error('Bulk patch failed', e);
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
          const results = await Promise.allSettled(ids.map(id => api.delete(`/tasks/${id}`)));
          report(results, 'deleted');
          const gone = ids.filter((_, i) => results[i].status === 'fulfilled');
          onDeleted?.(gone);
          onClear?.();
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
