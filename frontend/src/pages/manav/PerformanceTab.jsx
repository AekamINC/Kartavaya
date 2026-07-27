// Manav → Performance. Attendance-derived metrics for a month.
//
// Two defects beyond the styling.
//
// 1 · `load()` caught to a toast over `data` left at `[]`, so a failed fetch
//     rendered "No performance data — mark attendance first to see metrics",
//     which tells someone to go and do work that is already done.
//
// 2 · The month picker did nothing until "Load" was pressed, because `load()`
//     ran once on mount from a `useEffect` with an empty dependency array and
//     then only on the button. Changing the month and reading the table gave
//     you the previous month's numbers under the new month's label. The URL is
//     now the state, so the two cannot disagree.
//
// The attendance percentage is computed here from present and absent days
// rather than being sent, so the denominator is stated in the header: it is
// present + absent, and it deliberately excludes leave, holidays and weekends.
// A "92%" with an unstated denominator is not a measurement.
import React, { useState } from 'react';
import { Empty, DataTable, Td } from '../../components/editorial';
import { useList, ErrorNote, Shim, thisMonth, monthRange } from './_shared';

export default function PerformanceTab() {
  const [month, setMonth] = useState(thisMonth());
  const { from, to } = monthRange(month);
  const url = `/v1/manav/performance/summary?from_date=${from}&to_date=${to}`;
  const list = useList(url, [url]);

  return (
    <div>
      <div className="mn-bar">
        <label className="mn-field">
          <span className="mn-field__l">Month</span>
          <input
            className="k-input mn-f--lg"
            type="month"
            value={month}
            max={thisMonth()}
            onChange={e => setMonth(e.target.value)}
          />
        </label>
        <button type="button" className="k-btn k-btn--ghost" onClick={list.reload}>Refresh</button>
      </div>

      {list.loading ? <Shim count={6} />
        : list.error ? <ErrorNote what="The performance summary" error={list.error} onRetry={list.reload} />
          : list.items.length === 0 ? (
            <Empty
              icon="📈"
              title="Nothing to summarise for this month"
              sub={`No attendance is recorded between ${from} and ${to}, so there is nothing to derive metrics from.`}
            />
          ) : (
            <>
              <p className="note note--info mn-bridge">
                <b>Attendance % is present ÷ (present + absent).</b> Leave,
                holidays and weekends are excluded from both sides, so a month
                spent entirely on approved leave does not read as poor
                attendance.
              </p>
              <DataTable columns={[
                'Employee', 'Department',
                { label: 'Present', align: 'right' },
                { label: 'Absent', align: 'right' },
                { label: 'Late', align: 'right' },
                { label: 'Leave', align: 'right' },
                { label: 'Hours', align: 'right' },
                { label: 'Avg/day', align: 'right' },
                { label: 'Attendance', align: 'right' },
              ]}>
                {list.items.map(e => {
                  const present = Number(e.days_present || 0);
                  const absent = Number(e.days_absent || 0);
                  const counted = present + absent;
                  const pct = counted > 0 ? Math.round((present / counted) * 100) : null;
                  const avg = present > 0
                    ? (Number(e.total_work_hours || 0) / present).toFixed(1)
                    : '—';
                  return (
                    <tr key={e.id}>
                      <Td bold>{e.name}</Td>
                      <Td className="mn-t__mute">{e.department || '—'}</Td>
                      <Td align="right" mono><span className="mn-t__n" style={{ '--c': 'var(--ok)' }}>{present}</span></Td>
                      <Td align="right" mono><span className="mn-t__n" style={{ '--c': 'var(--danger)' }}>{absent}</span></Td>
                      <Td align="right" mono><span className="mn-t__n" style={{ '--c': 'var(--tertiary)' }}>{e.days_late}</span></Td>
                      <Td align="right" mono><span className="mn-t__n" style={{ '--c': 'var(--st-in-progress)' }}>{e.leaves_taken}</span></Td>
                      <Td align="right" mono>{Number(e.total_work_hours || 0).toFixed(1)}</Td>
                      <Td align="right" mono>{avg}</Td>
                      <Td align="right" mono>
                        {pct == null
                          ? <span className="mn-t__mute">—</span>
                          : <span className="mn-t__n mn-t__n--b" style={{ '--c': pctColor(pct) }}>{pct}%</span>}
                      </Td>
                    </tr>
                  );
                })}
              </DataTable>
            </>
          )}
    </div>
  );
}

/** The three bands. Written once so the table and any future chart agree. */
function pctColor(pct) {
  if (pct >= 90) return 'var(--ok)';
  if (pct >= 75) return 'var(--warn)';
  return 'var(--danger)';
}
