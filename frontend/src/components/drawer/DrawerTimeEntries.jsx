import React, { useState, useEffect } from 'react';
import { Play, Square, Clock, Trash2 } from 'lucide-react';
import { fmtMinutes } from './constants';

/** Live elapsed timer that ticks every second from a given ISO start time. */
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
    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
      {h ? `${h}:` : ''}{String(m).padStart(2, '0')}:{String(sec).padStart(2, '0')}
    </span>
  );
}

/**
 * DrawerTimeEntries — active timer control, manual log entry, and entry list.
 */
export default function DrawerTimeEntries({
  timer, entries,
  manualMin, setManualMin, manualDesc, setManualDesc,
  startTimer, stopTimer, addManual, deleteEntry,
}) {
  return (
    <div>
      {/* Timer control */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20,
        padding: '12px 16px', background: 'var(--bg-soft)',
        borderRadius: 'var(--r-md)', border: '1px solid var(--rule)',
      }}>
        {timer ? (
          <>
            <button
              onClick={stopTimer}
              className="k-btn k-btn--sm"
              // Was a hardcoded #dc2626. --danger is themed (#B42318 light,
              // #F2867A dark), so every other danger surface lightens in dark
              // mode while this button stayed at light-mode weight on a dark
              // panel.
              style={{ background: 'var(--danger)', color: 'var(--on-primary)', border: 'none', display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <Square size={11} /> Stop
            </button>
            <Clock size={13} style={{ color: 'var(--ink-3)' }} />
            <ElapsedTimer startedAt={timer.started_at} />
          </>
        ) : (
          <button
            onClick={startTimer}
            className="k-btn k-btn--primary k-btn--sm"
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <Play size={11} /> Start Timer
          </button>
        )}
      </div>

      {/* Manual log */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        <input
          type="number"
          min="1"
          value={manualMin}
          onChange={e => setManualMin(e.target.value)}
          placeholder="mins"
          className="k-input"
          style={{ width: 70 }}
        />
        <input
          value={manualDesc}
          onChange={e => setManualDesc(e.target.value)}
          placeholder="Description (optional)"
          className="k-input"
          style={{ flex: 1 }}
        />
        <button onClick={addManual} className="k-btn k-btn--ghost k-btn--sm">+ Log</button>
      </div>

      {/* Entry list */}
      {entries.length === 0 ? (
        <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No time logged yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {entries.map(e => (
            <div
              key={e.entry_id}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '9px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13,
              }}
            >
              <span style={{ color: 'var(--ink-2)' }}>
                {e.description || <span style={{ color: 'var(--ink-3)' }}>No description</span>}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {fmtMinutes(e.minutes)}
                </strong>
                <button
                  onClick={() => deleteEntry(e.entry_id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}
                  aria-label="Delete time entry"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
          <div style={{ textAlign: 'right', fontWeight: 600, fontSize: 13, paddingTop: 10, color: 'var(--ink-2)' }}>
            Total: {fmtMinutes(entries.reduce((sum, e) => sum + (e.minutes || 0), 0))}
          </div>
        </div>
      )}
    </div>
  );
}
