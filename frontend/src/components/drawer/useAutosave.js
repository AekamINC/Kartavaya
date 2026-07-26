import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useAutosave — debounce 800ms · idle → saving → saved → error (03 §3).
 *
 * PATH DEVIATION, stated plainly: 03 §3 puts this at
 * `frontend/src/hooks/useAutosave.js`. This batch owns `components/drawer/**`
 * and nothing else, and six other agents are editing the tree concurrently, so
 * it lives beside its only consumer rather than being written into a shared
 * directory this batch does not own. Move it to `hooks/` when the drawer is not
 * the only caller — the module has no drawer-specific code in it.
 *
 * Three things this exists to stop the description textarea doing:
 *
 *  · Saving on every keystroke. The staging textarea saved on blur only, which
 *    is the opposite failure — close the drawer with the field focused and the
 *    edit is gone. Debounced-plus-flush-on-blur is the pair that loses nothing.
 *  · Reporting "Saved" for a request that failed. The status is driven by the
 *    promise, not by having sent it.
 *  · Firing after unmount. Every timer is cleared on unmount, and a `seq` guard
 *    drops the response of a superseded save so a slow first request cannot
 *    overwrite the status of a fast second one.
 */
const IDLE = 'idle', SAVING = 'saving', SAVED = 'saved', ERROR = 'error';

export default function useAutosave(save, { delay = 800, savedFor = 1600 } = {}) {
  const [status, setStatus] = useState(IDLE);
  const timer = useRef(null);
  const settle = useRef(null);
  const pending = useRef(undefined);
  const seq = useRef(0);
  const alive = useRef(true);
  const saveRef = useRef(save);

  saveRef.current = save;

  useEffect(() => () => {
    alive.current = false;
    clearTimeout(timer.current);
    clearTimeout(settle.current);
  }, []);

  const run = useCallback(async (value) => {
    const mine = ++seq.current;
    pending.current = undefined;
    setStatus(SAVING);
    try {
      await saveRef.current(value);
      if (!alive.current || mine !== seq.current) return;
      setStatus(SAVED);
      clearTimeout(settle.current);
      settle.current = setTimeout(() => { if (alive.current) setStatus(IDLE); }, savedFor);
    } catch {
      if (!alive.current || mine !== seq.current) return;
      setStatus(ERROR);
    }
  }, [savedFor]);

  /** Queue a save. Later calls within `delay` replace the earlier value. */
  const schedule = useCallback((value) => {
    pending.current = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(value), delay);
  }, [delay, run]);

  /** Commit now — on blur, on close, on Ctrl+Enter. No-op when nothing is queued. */
  const flush = useCallback(() => {
    if (pending.current === undefined) return;
    clearTimeout(timer.current);
    run(pending.current);
  }, [run]);

  /** Drop anything queued without saving it — used when the task changes. */
  const reset = useCallback(() => {
    clearTimeout(timer.current);
    clearTimeout(settle.current);
    pending.current = undefined;
    seq.current += 1;
    setStatus(IDLE);
  }, []);

  return { status, schedule, flush, reset };
}

export { IDLE, SAVING, SAVED, ERROR };
