/**
 * useQueueStatus — a live view of both offline queues.
 *
 * ── The gap this closes ──────────────────────────────────────────────────────
 *
 * Both queues were readable only by calling `getQueueCount()` at a moment in
 * time, and the only caller that mattered was `App.tsx`'s NetInfo listener. So a
 * queued write was announced once, in a banner, at the instant connectivity
 * dropped — and then nothing on screen ever mentioned it again. Enqueue three
 * more edits while offline and the banner still said what it said when the
 * signal went. `ClockScreen` had the same shape: `setPending(getPunchCount())`
 * on a `[phase]` effect, so the pending count refreshed only when the user
 * happened to take another photo.
 *
 * MMKV publishes value changes, so the queue can push instead of being polled.
 * That is the whole difference between "the app told me once" and "the app is
 * showing me".
 *
 * ── The two queues stay two ─────────────────────────────────────────────────
 *
 * They are reported side by side and never summed. A queued edit and a queued
 * clock-in are not the same risk: an edit that fails is an edit you make again,
 * and a punch that fails is an unpaid day. `punchQueue`'s own header says it —
 * they have different retention, different retry rules and different
 * consequences, so a combined "4 items pending" would flatten the one number
 * anybody actually needs to act on.
 */
import { useCallback, useEffect, useState } from 'react';
import { storage } from '../lib/storage';
import { getQueueSummary, type QueueSummary } from '../offline/mutationQueue';
import { getPunchSummary, type PunchSummary } from '../offline/punchQueue';

/**
 * The MMKV keys the two queues persist under.
 *
 * Duplicated from the queue modules rather than exported from them, on purpose:
 * exporting the key invites something outside the queue to write it. The
 * listener below tolerates being wrong in the safe direction — an unrecognised
 * key simply does not trigger a re-read.
 */
const MUTATION_KEY = 'mutation_queue';
const PUNCH_KEY    = 'punch_queue';

export interface QueueStatus {
  changes: QueueSummary;
  punches: PunchSummary;
  /** True when either queue has anything in it. */
  anyPending: boolean;
  /** Force a re-read. For callers that mutate a queue and cannot wait a tick. */
  refresh: () => void;
}

export function useQueueStatus(): QueueStatus {
  const [changes, setChanges] = useState<QueueSummary>(() => getQueueSummary());
  const [punches, setPunches] = useState<PunchSummary>(() => getPunchSummary());

  const refresh = useCallback(() => {
    setChanges(getQueueSummary());
    setPunches(getPunchSummary());
  }, []);

  useEffect(() => {
    // Re-read on mount as well as subscribing: a subscription only reports the
    // NEXT change, and a screen mounting onto an already-full queue would
    // otherwise render as if nothing were pending until something else moved.
    refresh();

    const sub = storage.addOnValueChangedListener(key => {
      if (key === MUTATION_KEY) setChanges(getQueueSummary());
      else if (key === PUNCH_KEY) setPunches(getPunchSummary());
    });

    // `hoursLeft` decreases without anything being written, so the punch summary
    // is also re-read on a slow timer. A minute is fine — the value is displayed
    // in whole hours, and a tighter interval would wake the JS thread to
    // recompute a number that has not changed.
    const tick = setInterval(() => setPunches(getPunchSummary()), 60_000);

    return () => { sub.remove(); clearInterval(tick); };
  }, [refresh]);

  return {
    changes,
    punches,
    anyPending: changes.count > 0 || punches.count > 0,
    refresh,
  };
}

/**
 * "12 min", "3 h", "2 days" — the shape the reference banner uses.
 *
 * Deliberately coarse. This sits inside a sentence about queued work, and
 * `oldest 12 min` is the useful reading; `oldest 12 min 41 s` is a stopwatch
 * nobody asked for and a re-render every second to maintain it.
 */
export function agoLabel(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.max(0, Math.floor((now - then) / 60_000));
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}
