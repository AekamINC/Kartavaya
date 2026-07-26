import { apiClient } from './client';
import type { Task, Subtask } from './types';

export const tasksApi = {
  list:   (params?: Record<string, unknown>) =>
    apiClient.get<Task[]>('/tasks', { params }).then(r => r.data),

  get:    (taskId: string) =>
    apiClient.get<Task>(`/tasks/${taskId}`).then(r => r.data),

  create: (body: Partial<Task>) =>
    apiClient.post<Task>('/tasks', body).then(r => r.data),

  update: (taskId: string, body: Partial<Task>) =>
    apiClient.put<Task>(`/tasks/${taskId}`, body).then(r => r.data),

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
