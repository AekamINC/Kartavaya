import React, { useState, useEffect } from 'react';
import { Play, Square, Clock, Trash2 } from 'lucide-react';
import { fmtMinutes } from './constants';

/**
 * ElapsedTimer — kept, deliberately (03 §5).
 *
 * It recomputes from `startedAt` on every tick instead of incrementing a
 * counter, so it does not drift across a backgrounded tab where `setInterval`
 * is throttled to once a minute. An incrementing version reads 3 minutes after
 * an hour in a background tab; this one is always right the instant you look at
 * it.
 *
 * `font-variant-numeric: tabular-nums` on it is mandatory and lives in
 * `.dr__tm-el` — without it the digits change width every second and the whole
 * row jitters.
 */
function ElapsedTimer({ startedAt }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const base = Date.now() - new Date(startedAt).getTime();
    setElapsed(base);
    const id = setInterval(() => setElapsed(Date.now() - new Date(startedAt).getTime()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const s   = Math.floor(elapsed / 1000);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  return (
    <span className="dr__tm-el" role="timer" aria-live="off">
      {h ? `${h}:` : ''}{String(m).padStart(2, '0')}:{String(sec).padStart(2, '0')}
    </span>
  );
}

/**
 * DrawerTimeEntries — the running timer, the manual log row, and the entry list.
 *
 * The Stop button is `.btn--danger`, which is OUTLINED. 02 §1: a filled red
 * button reads as the primary action on the screen, which a destructive or
 * terminating action never is — the one exception being a confirmed delete
 * inside a dialog the user already opened. Stopping a timer is neither.
 *
 * 03 §5 says to replace "the hardcoded `#dc2626` Stop button". That literal was
 * already gone before this batch — the button was on `var(--danger)` with a
 * comment explaining the fix — so what actually changed is filled → outlined.
 */
export default function DrawerTimeEntries({
  timer, entries,
  manualMin, setManualMin, manualDesc, setManualDesc,
  startTimer, stopTimer, addManual, deleteEntry,
}) {
  const total = entries.reduce((sum, e) => sum + (e.minutes || 0), 0);

  return (
    <div>
      <div className="dr__tm">
        {timer ? (
          <>
            <button type="button" className="btn btn--danger btn--sm" onClick={stopTimer}>
              <Square size={11} /> Stop
            </button>
            <Clock size={13} className="dr__tm-ic" aria-hidden="true" />
            <ElapsedTimer startedAt={timer.started_at} />
          </>
        ) : (
          <button type="button" className="btn btn--fill btn--sm" onClick={startTimer}>
            <Play size={11} /> Start timer
          </button>
        )}
      </div>

      <div className="dr__tm-log">
        <input
          type="number" min="1"
          className="inp dr__tm-min"
          aria-label="Minutes to log"
          placeholder="mins"
          value={manualMin}
          onChange={e => setManualMin(e.target.value)}
        />
        <input
          className="inp"
          aria-label="Description for the logged time"
          placeholder="Description (optional)"
          value={manualDesc}
          onChange={e => setManualDesc(e.target.value)}
        />
        <button type="button" className="btn btn--out btn--sm" onClick={addManual} disabled={!manualMin}>
          Log
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="dr__empty">No time logged yet.</p>
      ) : (
        <div>
          {entries.map(e => (
            <div key={e.entry_id} className="dr__tm-row">
              <span className={`dr__tm-desc${e.description ? '' : ' is-empty'}`}>
                {e.description || 'No description'}
              </span>
              <span className="dr__tm-r">
                <strong className="dr__tm-min-v">{fmtMinutes(e.minutes)}</strong>
                <button type="button" className="dr__ico dr__ico--danger"
                  aria-label="Delete time entry" onClick={() => deleteEntry(e.entry_id)}>
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
          ))}
          <div className="dr__tm-total">Total: {fmtMinutes(total)}</div>
        </div>
      )}
    </div>
  );
}
