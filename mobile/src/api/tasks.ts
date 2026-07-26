import { apiClient } from './client';
import type { Task, Subtask, TaskReminder, ReminderChannel } from './types';

/**
 * The offsets the server will accept, newest-first for display.
 *
 * `REMINDER_OFFSETS` in server.py:522 is a set of exactly these seven values and
 * `_replace_task_reminders` silently `continue`s past anything else — so an
 * unlisted offset is not rejected with an error, it is dropped, and the caller
 * gets a 200 with fewer reminders than it asked for. Sending only these means
 * the response always matches the request.
 */
export const REMINDER_OFFSETS = [2880, 1440, 240, 120, 60, 30, 15] as const;

export const REMINDER_OFFSET_LABEL: Record<number, string> = {
  2880: '2 days before',
  1440: '1 day before',
  240:  '4 hours before',
  120:  '2 hours before',
  60:   '1 hour before',
  30:   '30 minutes before',
  15:   '15 minutes before',
};

export const REMINDER_CHANNEL_LABEL: Record<ReminderChannel, string> = {
  in_app: 'In app',
  push:   'Push',
  email:  'Email',
};

export const tasksApi = {
  list:   (params?: Record<string, unknown>) =>
    apiClient.get<Task[]>('/tasks', { params }).then(r => r.data),

  get:    (taskId: string) =>
    apiClient.get<Task>(`/tasks/${taskId}`).then(r => r.data),

  create: (body: Partial<Task>) =>
    apiClient.post<Task>('/tasks', body).then(r => r.data),

  update: (taskId: string, body: Partial<Task>) =>
    apiClient.put<Task>(`/tasks/${taskId}`, body).then(r => r.data),

  /**
   * PUT /api/tasks/{id}/reminders — replace the whole pending set.
   *
   * This is a REPLACE, not a merge: `_replace_task_reminders` deletes every
   * unsent row for the task before inserting, inside one transaction. Sending
   * `[]` is therefore how you turn reminders off, and sending one offset when
   * three were set removes the other two. There is no per-reminder delete.
   *
   * Two server rules the caller must respect:
   *   · 400 "Task has no due date" if the task has none and the payload is
   *     non-empty — offsets are relative to `due_at`, so there is nothing to
   *     compute from. An empty payload on a task with no due date is fine.
   *   · Already-sent rows are left alone. Only unsent ones are replaced, so a
   *     reminder that has already fired stays in the history.
   *
   * Preferred over the legacy `reminder_at` field for anything the app arms:
   * `reminder_sent_at` is never reset by any endpoint and the poll query
   * requires it to be NULL, so a legacy reminder can fire exactly once and can
   * never be re-armed. These rows can.
   */
  setReminders: (
    taskId: string,
    reminders: { offset_minutes: number; channels: ReminderChannel[] }[],
  ) => apiClient.put<TaskReminder[]>(`/tasks/${taskId}/reminders`, reminders).then(r => r.data),

  move:   (taskId: string, columnId: string, order = 0) =>
    apiClient.patch<Task>(`/tasks/${taskId}/move`, { column_id: columnId, order }).then(r => r.data),

  delete: (taskId: string) =>
    apiClient.delete(`/tasks/${taskId}`).then(r => r.data),

  // Subtasks
  addSubtask:    (taskId: string, title: string) =>
    apiClient.post<Task>(`/tasks/${taskId}/subtasks`, { title }).then(r => r.data),

  toggleSubtask: (taskId: string, subtaskId: string) =>
    apiClient.patch<Task>(`/tasks/${taskId}/subtasks/${subtaskId}`).then(r => r.data),

  updateSubtask: (taskId: string, subtaskId: string, body: Partial<Subtask>) =>
    apiClient.put<Task>(`/tasks/${taskId}/subtasks/${subtaskId}`, body).then(r => r.data),

  deleteSubtask: (taskId: string, subtaskId: string) =>
    apiClient.delete<Task>(`/tasks/${taskId}/subtasks/${subtaskId}`).then(r => r.data),

  // Comments
  getComments:   (taskId: string) =>
    apiClient.get(`/tasks/${taskId}/comments`).then(r => r.data),

  addComment:    (taskId: string, body: string) =>
    apiClient.post(`/tasks/${taskId}/comments`, { body }).then(r => r.data),

  editComment:   (taskId: string, commentId: string, body: string) =>
    apiClient.put(`/tasks/${taskId}/comments/${commentId}`, { body }).then(r => r.data),

  deleteComment: (taskId: string, commentId: string) =>
    apiClient.delete(`/tasks/${taskId}/comments/${commentId}`).then(r => r.data),

  // Approvals
  requestApproval: (taskId: string, notes?: string) =>
    apiClient.post(`/tasks/${taskId}/request-approval`, { notes }).then(r => r.data),

  /**
   * Review a task-level approval.
   *
   * TWO CONTRACT BUGS FIXED HERE, both of which made this call fail outright:
   *
   * 1. The id separator is `--`, not `::`. The server builds the id as
   *    CONCAT('task_approval--', t.task_id) (server.py:1008) and dispatches on
   *    approval_id.startswith("task_approval--") (server.py:1191). A `::` id
   *    misses that branch, falls through to the plain `approvals` table lookup,
   *    finds nothing and 404s. The web client and the backend tests both use
   *    `--`; mobile was the only caller using `::`.
   *
   * 2. There is no `pending_client` status. The server rejects anything that is
   *    not "approved" or "rejected" with a 400. Sending to the client is
   *    status="approved" plus send_to_client and client_email — that is what
   *    ApprovalsPage.jsx:110 does, and the server routes it to
   *    _approve_task_send_client.
   *
   * `sendToClient` is modelled as its own argument rather than a status so the
   * impossible state cannot be expressed at the call site.
   */
  reviewApproval: (taskId: string, status: 'approved' | 'rejected', opts?: {
    notes?: string; send_to_client?: boolean; client_email?: string;
  }) => apiClient.post(`/approvals/task_approval--${taskId}/review`, {
    status, notes: opts?.notes ?? '', ...opts,
  }).then(r => r.data),

  clientApprove: (taskId: string) =>
    apiClient.post(`/tasks/${taskId}/client-approve`, { notes: '' }).then(r => r.data),

  clientReject:  (taskId: string, notes: string) =>
    apiClient.post(`/tasks/${taskId}/client-reject`, { notes }).then(r => r.data),

  // Attachments
  uploadAttachment: (taskId: string, formData: FormData) =>
    apiClient.post<Task>(`/tasks/${taskId}/attachments`, formData).then(r => r.data),

  deleteAttachment: (taskId: string, key: string) =>
    apiClient.delete(`/tasks/${taskId}/attachments/${encodeURIComponent(key)}`).then(r => r.data),
};
