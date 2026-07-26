import { storage } from './storage';

/**
 * The one running timer, remembered locally.
 *
 * WHY THIS EXISTS AT ALL. `backend/routers/time_entries.py` has no endpoint that
 * returns the caller's open entry — `ended_at IS NULL` is queried only inside
 * `/start` (line 87) and `/stop` (line 109), and `/report` filters running
 * entries out entirely. So there is no way to ask the server "what am I timing?"
 *
 * Two screens need the answer — TaskDetail, to show stop instead of start, and
 * Time, to render the live card — so the record lives here rather than in either
 * of them. Duplicating the MMKV key in two files is how they drift into
 * disagreeing about whether a timer is running.
 *
 * The server remains the authority on the ENTRY. This is a local note about it,
 * and it is disposable: `/stop` closes whatever is open for the user regardless
 * of what is stored here, and a 404 from `/stop` means this note is stale and
 * should be cleared. Losing it costs a UI affordance, never a time entry.
 *
 * Known limitation, stated rather than hidden: a timer started on the web is
 * invisible to the app until the backend exposes a read endpoint.
 */

const RUNNING_KEY = 'time_running_entry';

export interface RunningTimer {
  entry_id:   string;
  task_id:    string;
  task_title: string;
  /** Server-issued start time. The elapsed figure is derived from this on every
   *  tick rather than accumulated, so backgrounding cannot lose minutes. */
  started_at: string;
}

export function getRunningTimer(): RunningTimer | null {
  const raw = storage.getString(RUNNING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RunningTimer;
    // A record with no start time cannot produce an elapsed figure, so treat it
    // as absent rather than rendering NaN.
    return parsed?.started_at ? parsed : null;
  } catch {
    return null;
  }
}

export function setRunningTimer(timer: RunningTimer): void {
  storage.set(RUNNING_KEY, JSON.stringify(timer));
}

export function clearRunningTimer(): void {
  storage.delete(RUNNING_KEY);
}
