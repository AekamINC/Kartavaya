import { apiClient } from './client';

/**
 * Time tracking. Backend: `backend/routers/time_entries.py`, prefix `/api/time`.
 *
 * TWO CONTRACT DETAILS THAT ARE EASY TO GET WRONG:
 *
 *   · `/start` takes `task_id` as a QUERY parameter, not a body field —
 *     `async def start_timer(task_id: str, ...)` with no Pydantic model, which
 *     FastAPI reads from the query string. Posting it as JSON yields a 422.
 *   · `/report` returns only CLOSED entries (`te.ended_at IS NOT NULL`), so the
 *     running timer never appears in it.
 *
 * KNOWN BACKEND GAP: there is no endpoint that returns the caller's currently
 * running timer. `ended_at IS NULL` is queried only inside `/start` (line 87)
 * and `/stop` (line 109), never exposed for reading. A client therefore cannot
 * discover a timer that was started elsewhere — the screen persists its own
 * running state and says so rather than pretending to know.
 */

export interface TimeEntry {
  entry_id:     string;
  task_id:      string;
  task_title?:  string | null;
  started_at:   string;
  ended_at?:    string | null;
  minutes:      number | null;
  description?: string | null;
  user_name?:   string | null;
}

export interface TimeReport {
  entries:       TimeEntry[];
  total_minutes: number;
}

export const timeApi = {
  /** Closed entries only, newest first, capped at 500 by the server. */
  report: (params?: { team_id?: string; user_id_filter?: string }) =>
    apiClient.get<TimeReport>('/time/report', { params }).then(r => r.data),

  forTask: (taskId: string) =>
    apiClient.get<TimeReport>(`/time/task/${taskId}`).then(r => r.data),

  /** `task_id` goes in the query string — see the note above. */
  start: (taskId: string) =>
    apiClient
      .post<{ entry_id: string; started_at: string }>('/time/start', null, { params: { task_id: taskId } })
      .then(r => r.data),

  stop: () =>
    apiClient
      .post<{ entry_id: string; task_id: string; minutes: number }>('/time/stop', {})
      .then(r => r.data),

  remove: (entryId: string) =>
    apiClient.delete(`/time/${entryId}`).then(r => r.data),
};
