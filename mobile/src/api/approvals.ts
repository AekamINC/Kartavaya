import { apiClient } from './client';

/**
 * Approvals.
 *
 * 17-mobile-app.md: "swipe right approve, left decline, batch select, decline
 * gated on a reason". The backend is `server.py` /api/approvals/*, not a router
 * module — there is no routers/approvals.py, which is why this looked missing.
 *
 * The list endpoint returns TWO shapes concatenated (server.py:993):
 *
 *   · Rows from the `approvals` table — a request to CREATE a task. These carry
 *     `request_type` and a `request_data` blob and no `task_id`.
 *   · Task-level approvals — a request to mark work DONE. These are synthesised
 *     with `approval_id = 'task_approval--' || task_id` and carry `task_title`.
 *
 * They are not interchangeable and the UI has to tell them apart, so the union
 * below is discriminated on `task_id` rather than being flattened into one
 * optional-everything interface.
 *
 * THE SEPARATOR IS `--`, NOT `::`. tasks.ts had `::` and every review it sent
 * 404'd; see the note there.
 */

export const TASK_APPROVAL_PREFIX = 'task_approval--';

export interface ApprovalBase {
  approval_id:         string;
  team_id:             string;
  created_at:          string | null;
  requester_name?:     string | null;
  requested_by_email?: string | null;
  notes?:              string | null;
  request_type?:       string | null;
}

/** A request to mark existing work complete. */
export interface TaskApproval extends ApprovalBase {
  task_id:      string;
  task_title:   string;
  priority?:    string | null;
  task_due_at?: string | null;
}

/** A request to create a task at all. */
export interface RequestApproval extends ApprovalBase {
  task_id?:      undefined;
  request_data?: Record<string, unknown> | string | null;
  status?:       string | null;
}

export type PendingApproval = TaskApproval | RequestApproval;

export const isTaskApproval = (a: PendingApproval): a is TaskApproval =>
  typeof (a as TaskApproval).task_id === 'string' && !!(a as TaskApproval).task_id;

export interface ApprovalHistoryRow {
  approval_id:     string;
  task_id:         string;
  task_title:      string;
  status:          'approved' | 'rejected';
  notes?:          string | null;
  updated_at:      string | null;
  requester_name?: string | null;
}

/** Title for a row, whichever shape it is. */
export function approvalTitle(a: PendingApproval): string {
  // `task_title` is TYPED `string` and is not always SENT. The tablet's Today
  // column rendered three approvals as bullets with no text beside them, and
  // used this same value as a React key, so the row was both blank and
  // unkeyed. A type is a claim about the server, not a guarantee from it.
  if (isTaskApproval(a)) {
    return typeof a.task_title === 'string' && a.task_title.trim()
      ? a.task_title
      : 'Untitled task';
  }
  const data = (a as RequestApproval).request_data;
  if (data && typeof data === 'object' && 'title' in data) {
    const title = (data as Record<string, unknown>).title;
    if (typeof title === 'string' && title.trim()) return title;
  }
  if (typeof data === 'string') {
    // request_data is jsonb on one path and a JSON string on the other.
    try {
      const parsed = JSON.parse(data) as { title?: unknown };
      if (typeof parsed.title === 'string' && parsed.title.trim()) return parsed.title;
    } catch {
      /* fall through to the generic label */
    }
  }
  return 'Untitled request';
}

export const approvalsApi = {
  pending: () =>
    apiClient.get<PendingApproval[]>('/approvals/pending').then(r => r.data),

  history: () =>
    apiClient.get<ApprovalHistoryRow[]>('/approvals/history').then(r => r.data),

  /**
   * Approve or reject.
   *
   * `notes` is REQUIRED when rejecting — server.py:1209 returns 400
   * "Rejection reason is required" without it. The screen gates on this before
   * calling, so a decline cannot be sent blind.
   */
  review: (
    approvalId: string,
    status: 'approved' | 'rejected',
    opts?: { notes?: string; send_to_client?: boolean; client_email?: string },
  ) =>
    apiClient
      .post(`/approvals/${approvalId}/review`, { status, notes: opts?.notes ?? '', ...opts })
      .then(r => r.data),
};
