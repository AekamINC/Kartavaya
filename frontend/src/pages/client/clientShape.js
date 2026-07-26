/**
 * clientShape.js — the boundary every client payload crosses.
 *
 * `19-client-portal.md`: "The failure mode is a well-meaning
 * `GET /api/client/tasks` that returns the full task object and lets the
 * component pick fields. Then one `{JSON.stringify(task)}` in a debug branch,
 * or one new field rendered by a shared component, leaks it. **The endpoint
 * returns a client shape, or this will leak eventually.**"
 *
 * ── The API now builds that shape. This module reads BOTH.
 *
 * Three leaks were live when this module was written, and all three are fixed
 * server-side now — `backend/server.py`, verified by reading it:
 *
 *   · `GET /api/client/tasks` is `response_model=List[ClientTaskOut]`
 *     (server.py:968), an allow-list. It was `List[TaskOut]`, which carried
 *     `assignee_names`, `assignee_emails`, `estimated_minutes`, `subtasks` and
 *     `custom_fields` to an external party.
 *   · That handler now calls `_filter_private_attachments` BEFORE
 *     `_refresh_task_attachments` (server.py:1006-1009), so a private file is
 *     not even handed a fresh signed R2 URL on the way out. It called neither
 *     before, uniquely among the task reads.
 *   · `GET /api/client/approvals` is `response_model=List[ClientApprovalOut]`
 *     (server.py:1031) and both of its queries are scoped to approvals the
 *     caller raised or that sit on a task shared with them. It used to hand a
 *     client the FIRM's own pending queue, with `requested_by_email` on every
 *     row.
 *
 * So the reduction below is no longer the only thing standing between a client
 * and the firm's internals — but it is still the only thing standing between
 * them and a MID-DEPLOY frontend, and this repo ships the two halves
 * separately. Both wire shapes are handled: a `taskId` key means the server
 * shaped it, anything else is a raw `TaskOut` and gets reduced here as before.
 * When the two halves have been deployed together for a release, the legacy arm
 * can go; until then removing it turns a rollback into an empty portal.
 *
 * Everything below returns a NEW object built key by key. Nothing spreads the
 * incoming row — not even the already-shaped one. A spread is how a field added
 * upstream next month arrives here without anyone deciding it should, and that
 * is as true of `ClientTaskOut` as it was of `TaskOut`.
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

const STATES = [WITH_US, WITH_YOU, DONE];

/**
 * `pending_client` outranks status: a task can be `in_review` and waiting on the
 * client at the same time, and the waiting is the part they need to act on.
 * `rejected` is With us — the client asked for changes and the firm has them.
 *
 * The same three strings as `_client_state` (server.py:916). When the payload is
 * already shaped, its `state` is taken as given — re-deriving it here from a
 * `status` the client shape deliberately does not carry would be a second
 * mapping, which is the drift 19 asks the serializer to prevent.
 */
export function clientState(raw) {
  if (STATES.includes(raw?.state)) return raw.state;
  if (raw?.approval_status === 'pending_client') return WITH_YOU;
  if (raw?.status === 'done') return DONE;
  return WITH_US;
}

/**
 * Did the server shape this row?
 *
 * `ClientTaskOut` serialises `task_id` under the alias `taskId`; a raw `TaskOut`
 * has `task_id` and no camel key. One discriminator, checked in one place.
 */
export function isShapedTask(raw) {
  return !!raw && typeof raw.taskId === 'string';
}

/** The same question for `/client/approvals`. `ClientApprovalOut` → `approvalId`. */
export function isShapedApproval(raw) {
  return !!raw && typeof raw.approvalId === 'string';
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
 * `_filter_private_attachments` (server.py:2148), which `/client/tasks` now
 * applies before it re-signs the URLs. The filter survives here for the
 * mid-deploy case, and because a filter that runs twice costs nothing while a
 * filter that runs zero times cost a firm its private files.
 *
 * `size` / `sharedBy` / `sharedAt` land only on the shaped payload —
 * `Attachment` gained `size`, `uploaded_by_name` and `uploaded_at`
 * (server.py:498-510) and `_client_files` maps them. On a legacy row they are
 * simply absent, and `ClientFiles` prints what is there rather than inventing
 * an attribution.
 */
export function visibleAttachments(raw, meId) {
  if (isShapedTask(raw)) {
    const shaped = Array.isArray(raw.files) ? raw.files : [];
    return shaped
      .filter(a => a && a.url)
      .map(a => ({
        name: a.name || 'Attachment',
        url: a.url,
        size: Number.isFinite(a.size) ? a.size : null,
        sharedBy: a.sharedBy || null,
        sharedAt: a.sharedAt || null,
      }));
  }
  const list = Array.isArray(raw?.attachments) ? raw.attachments : [];
  return list
    .filter(a => a && a.url && (!a.is_private || (Array.isArray(a.visible_to) && a.visible_to.includes(meId))))
    .map(a => ({
      name: a.name || 'Attachment',
      url: a.url,
      size: Number.isFinite(a.size) ? a.size : null,
      sharedBy: a.uploaded_by_name || null,
      sharedAt: a.uploaded_at || null,
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

  // Already shaped by the API. Still copied key by key rather than spread:
  // `ClientTaskOut` is an allow-list today, and this stays the place that says
  // which of its keys the portal actually renders.
  if (isShapedTask(raw)) {
    const d = raw.decision;
    return {
      taskId: raw.taskId,
      ref: raw.ref || shortId(raw.taskId),
      title: raw.title || 'Untitled',
      note: raw.note || '',
      state: clientState(raw),
      expectedAt: raw.expectedAt || null,
      updatedAt: raw.updatedAt || raw.createdAt || null,
      createdAt: raw.createdAt || null,
      requestedBy: raw.requestedBy || null,
      projectId: raw.projectId || null,
      files: visibleAttachments(raw, meId),
      decision: d && d.outcome
        ? { outcome: d.outcome, note: d.note || '', at: d.at || null }
        : null,
      awaitingMe: raw.awaitingMe === true,
    };
  }

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

/**
 * The client's task list: theirs only, reduced, newest first.
 *
 * `isMine` runs on legacy rows ONLY. A shaped row has no `created_by_user_id`,
 * no `assignee_user_ids` and no `approved_by` to test — running the same filter
 * over it would reject every row and paint an empty portal for a client who has
 * work. The server does that narrowing itself now (server.py:987-999): its
 * WHERE clause is the same five cases, applied where it can actually be
 * enforced.
 */
export function toClientTasks(rows, meId) {
  return (Array.isArray(rows) ? rows : [])
    .filter(r => (isShapedTask(r) ? true : isMine(r, meId)))
    .map(r => toClientTask(r, meId))
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

/**
 * The approval queue — the rows waiting on THE READER.
 *
 * `/client/approvals` still concatenates two result sets, in both wire shapes.
 * Only the second is waiting on the client: it is synthesised from tasks whose
 * `approval_status = 'pending_client'` and its `approval_id` is
 * `task_approval--<task_id>` (server.py:1073). The first set is now scoped to
 * approvals the client RAISED — their own Request work rows — which are pending
 * on the firm, and putting those under "Needs your approval" would ask a client
 * to approve their own request.
 *
 * The `task_approval--` prefix is the discriminator in both shapes. The old code
 * also required `approval_status === 'pending_client'`; `ClientApprovalOut` has
 * no status field at all — deliberately, it is internal vocabulary — so that
 * second check is applied only where it exists, on a legacy row.
 */
const TASK_APPROVAL = 'task_approval--';

export function toClientApprovals(rows, tasksById = {}) {
  return (Array.isArray(rows) ? rows : [])
    .map(r => {
      if (isShapedApproval(r)) {
        if (!r.approvalId.startsWith(TASK_APPROVAL) || !r.taskId) return null;
        const task = tasksById[r.taskId] || null;
        return {
          taskId: r.taskId,
          ref: r.ref || shortId(r.taskId),
          title: r.title || task?.title || 'Untitled',
          ask: r.ask || task?.note || '',
          requestedBy: r.requestedBy || null,
          requestedAt: r.requestedAt || null,
          // The approval carries no files of its own on purpose: the portal
          // joins to the task by id and reads them there, so attachment
          // filtering has one home rather than two.
          files: task?.files || [],
        };
      }
      if (typeof r?.approval_id !== 'string'
        || !r.approval_id.startsWith(TASK_APPROVAL)
        || r.approval_status !== 'pending_client'
        || !r.task_id) return null;
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
    .filter(Boolean)
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

/**
 * "412 KB". Returns '' when the byte count is unknown, and the row then simply
 * does not print a size — 19 asks a file to read "name, size, who shared it,
 * when", and the honest answer for a file uploaded before `Attachment` gained
 * those fields is silence, not a guess.
 *
 * 1000, not 1024: this is a size shown to an accountant, not to an engineer,
 * and it is the unit every OS file browser has used for over a decade.
 */
export function sizeLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1000;
  let i = 0;
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i += 1; }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
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
