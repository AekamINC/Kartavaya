/**
 * clientShape.js — the client shape, built on the frontend because the endpoint
 * does not build it yet.
 *
 * `19-client-portal.md`: "The failure mode is a well-meaning
 * `GET /api/client/tasks` that returns the full task object and lets the
 * component pick fields. Then one `{JSON.stringify(task)}` in a debug branch,
 * or one new field rendered by a shared component, leaks it. **The endpoint
 * returns a client shape, or this will leak eventually.**"
 *
 * That is exactly what ships today. Verified against `backend/server.py`:
 *
 *   · `GET /api/client/tasks` is `response_model=List[TaskOut]` (server.py:754).
 *     `TaskOut` (server.py:492-504) carries `assignee_emails`, `assignee_names`,
 *     `estimated_minutes`, `custom_fields`, `subtasks`, `assignee_user_ids` and
 *     `approved_by`. Four of those are on 19's never-see list; two are
 *     time-derived.
 *   · That handler calls `_refresh_task_attachments` but NOT
 *     `_filter_private_attachments` (server.py:774-776), which every other task
 *     read does (server.py:1934). Attachments a firm marked private, with live
 *     signed R2 URLs, are returned to the client verbatim.
 *   · `GET /api/client/approvals` (server.py:797) returns rows from the
 *     `approvals` table whose status is `pending` — the firm's own internal
 *     queue, not the client's — each carrying `requested_by_email`.
 *
 * None of that is fixable from `frontend/src/pages/client/**`. So this module is
 * the boundary instead: every payload crosses it before a component sees it,
 * and a component that renders `task.assignee_names` cannot compile against the
 * result because the key is gone. It is defence in depth, not the fix. The fix
 * is a client serializer in the API, and it is in the report.
 *
 * Everything below returns a NEW object built key by key. Nothing spreads the
 * raw row — a spread is how a field added upstream next month arrives here
 * without anyone deciding it should.
 */

/* ── The three states ──────────────────────────────────────────────────────
 *
 * Six internal statuses map to three. `in_review` means nothing to a client;
 * "With us" and "With you" answer the only question they have, which is whether
 * the ball is in their court.
 */
export const WITH_US = 'with_us';
export const WITH_YOU = 'with_you';
export const DONE = 'done';

export const STATE_LABEL = {
  [WITH_US]: 'With us',
  [WITH_YOU]: 'With you',
  [DONE]: 'Done',
};

export const STATE_CLASS = {
  [WITH_US]: 'cl-state',
  [WITH_YOU]: 'cl-state cl-state--you',
  [DONE]: 'cl-state cl-state--done',
};

/**
 * `pending_client` outranks status: a task can be `in_review` and waiting on the
 * client at the same time, and the waiting is the part they need to act on.
 * `rejected` is With us — the client asked for changes and the firm has them.
 */
export function clientState(raw) {
  if (raw?.approval_status === 'pending_client') return WITH_YOU;
  if (raw?.status === 'done') return DONE;
  return WITH_US;
}

/** `#a1b2c3` — never a sequential integer, which counts the firm's customers. */
export function shortId(taskId) {
  return taskId ? `#${String(taskId).slice(-6)}` : '';
}

/**
 * A client sees ONLY their own tasks.
 *
 * `/client/tasks` is broader than that: its fourth WHERE clause is
 * `EXISTS(SELECT 1 FROM project_assignments pa WHERE pa.team_id=t.team_id AND
 * pa.user_id=$1)` (server.py:768), so a client assigned to a project receives
 * every task in it, including work assigned to a member they have never met.
 * Narrow it here to the three cases that are actually theirs: they raised it,
 * they are on it, or their sign-off is the gate.
 *
 * A task reached only through `task_clients` is indistinguishable from one
 * reached through the project in this payload — but such a task is either
 * awaiting them or already decided by them, and both are covered below.
 */
export function isMine(raw, meId) {
  if (!raw || !meId) return false;
  if (raw.created_by_user_id === meId) return true;
  if (Array.isArray(raw.assignee_user_ids) && raw.assignee_user_ids.includes(meId)) return true;
  if (raw.approval_status === 'pending_client') return true;
  if (raw.approved_by === meId) return true;
  return false;
}

/**
 * Attachments a client may see.
 *
 * `is_private: false` is "public to project" — the drawer's own wording — and a
 * client on the project is inside that boundary. A private file is visible only
 * when the firm named this client in `visible_to`. This mirrors
 * `_filter_private_attachments` (server.py:1934), which `/client/tasks` skips.
 */
export function visibleAttachments(raw, meId) {
  const list = Array.isArray(raw?.attachments) ? raw.attachments : [];
  return list
    .filter(a => a && a.url && (!a.is_private || (Array.isArray(a.visible_to) && a.visible_to.includes(meId))))
    .map(a => ({
      name: a.name || 'Attachment',
      url: a.url,
      // `key` and `visible_to` are deliberately not carried: one is storage
      // internals, the other is a list of user ids belonging to other people.
    }));
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i;
const PDF_RE = /\.pdf(\?|$)/i;

export function previewKind(name = '', url = '') {
  if (IMAGE_RE.test(name) || IMAGE_RE.test(url)) return 'image';
  if (PDF_RE.test(name) || PDF_RE.test(url)) return 'pdf';
  return 'file';
}

/**
 * One task, reduced.
 *
 * Dropped on purpose, each because 19 names it or because it is derived from
 * something 19 names: `assignee_user_ids`, `assignee_emails`, `assignee_names`
 * (other members' data, and the assignee picker leak); `estimated_minutes`
 * (time, and everything derived from it); `custom_fields` and `subtasks` (the
 * firm's internal decomposition of the work); `approved_by`, `approval_id`,
 * `column_id`, `board_id`, `sort_order`, `user_id`, `category_id`, `priority`
 * (the firm's triage, not the client's), `tags`.
 *
 * `created_by_name` is kept: 19's ApprovalCard is explicitly "who asked and
 * when — Aanya Mehta · 2 days ago". A name is the contact; an email is not.
 */
export function toClientTask(raw, meId) {
  if (!raw) return null;
  return {
    taskId: raw.task_id,
    ref: shortId(raw.task_id),
    title: raw.title || 'Untitled',
    // The description is what the firm wrote for the client to read. It is the
    // only prose that crosses; comments never do — see `comments` in the report.
    note: raw.description || '',
    state: clientState(raw),
    expectedAt: raw.due_at || null,
    updatedAt: raw.updated_at || raw.created_at || null,
    createdAt: raw.created_at || null,
    requestedBy: raw.created_by_name || null,
    projectId: raw.team_id || null,
    files: visibleAttachments(raw, meId),
    // The client's own decision, so it can be shown back to them later.
    decision:
      raw.approved_by === meId && (raw.approval_status === 'approved' || raw.approval_status === 'rejected')
        ? { outcome: raw.approval_status, note: raw.approval_notes || '', at: raw.approval_decided_at || null }
        : null,
    awaitingMe: raw.approval_status === 'pending_client',
  };
}

/** The client's task list: theirs only, reduced, newest first. */
export function toClientTasks(rows, meId) {
  return (Array.isArray(rows) ? rows : [])
    .filter(r => isMine(r, meId))
    .map(r => toClientTask(r, meId))
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

/**
 * The approval queue.
 *
 * `/client/approvals` concatenates two result sets. The first is the `approvals`
 * table filtered to `status='pending'` — the FIRM's queue, which a client is
 * handed purely because they share a project — and it carries
 * `requested_by_email`. Only the second set, synthesised with an
 * `approval_id` of `task_approval--<task_id>` and an `approval_status` of
 * `pending_client`, is waiting on the reader.
 *
 * Filtering on both markers rather than one is deliberate: the prefix alone
 * would survive a status change upstream, and the status alone appears on rows
 * of the first shape too.
 */
export function toClientApprovals(rows, tasksById = {}) {
  return (Array.isArray(rows) ? rows : [])
    .filter(r => typeof r?.approval_id === 'string'
      && r.approval_id.startsWith('task_approval--')
      && r.approval_status === 'pending_client'
      && r.task_id)
    .map(r => {
      const task = tasksById[r.task_id] || null;
      return {
        taskId: r.task_id,
        ref: shortId(r.task_id),
        title: r.task_title || task?.title || 'Untitled',
        // The ask, verbatim. `request_data` is the row the firm submitted; the
        // task's own description is the fallback when it is absent.
        ask: r.request_data?.description || task?.note || '',
        requestedBy: r.requested_by_name || null,
        requestedAt: r.created_at || null,
        files: task?.files || [],
      };
    })
    .sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0));
}

/**
 * Dates, in the two forms the portal needs.
 *
 * Neither is a third due-date vocabulary. `relTime` in `lib/utils.js` stays the
 * one relative formatter and is used directly for "2d ago"; these two are
 * absolute, and there is deliberately no "3d overdue" among them. Lateness is
 * the firm's problem to raise, not a scold the portal delivers to the customer
 * who is waiting on it.
 */
export function expectedLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    day: '2-digit', month: 'short', ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "26 Jul 2026, 3:12 pm" — the written record, which has to be unambiguous. */
export function stampLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** The firm's identity, from /v1/org/profile. Nothing else on that row travels. */
export function toFirm(raw) {
  return {
    name: raw?.name || '',
    logoUrl: raw?.logo_url || '',
  };
}
