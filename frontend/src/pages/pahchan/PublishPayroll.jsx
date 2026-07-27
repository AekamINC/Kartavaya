import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Section, DataTable, Td } from '../../components/editorial';
import Note from '../../components/module/Note';

/**
 * Push attendance to payroll — `POST /api/v1/pahchan/attendance/publish`.
 *
 * Pahchan writes `pahchan_punches`; Vetana reads `manav_attendance`. Nothing
 * joined them until the bridge was written, and nothing called the bridge until
 * this screen: people clocked in every day and the payroll run could not see a
 * minute of it.
 *
 * THE DRY RUN IS THE DEFAULT, AND THAT IS THE POINT. The first sensible thing to
 * do with a payroll input is look at it. The endpoint returns exactly what would
 * be written without writing it, so the button that writes is the second button
 * a person presses, never the first.
 *
 * Three results have to be readable, because each one means a person's pay is
 * different from what the operator assumed:
 *
 *   withheld    A day whose punches are flagged and unreviewed. The bridge
 *               refuses to emit an 'absent' row for it — asserting someone did
 *               not work, on the strength of a punch nobody has looked at, is
 *               the same manufactured verification 07 §3 is written against.
 *               The fix is the register, not this screen.
 *   skipped     A day HR typed by hand. Never overwritten by a re-run.
 *   overtime    Computed, or not computed. "0.0 overtime" and "overtime was
 *               never computed" look identical on a payslip and mean opposite
 *               things, so the endpoint says which, and so does this.
 */

const iso = d => d.toISOString().slice(0, 10);

function defaultRange() {
  const now = new Date();
  return {
    from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: iso(now),
  };
}

function Figure({ label, value, hint, tone }) {
  return (
    <div
      style={{
        flex: '1 1 150px', minWidth: 130, padding: '11px 13px',
        background: 'var(--s-low)', borderRadius: 'var(--r-sm)',
        border: '1px solid var(--outline-variant)',
      }}
    >
      <div style={{ fontSize: 11.5, color: 'var(--on-surface-3)' }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 20, marginTop: 2,
        color: tone || 'var(--on-surface)',
      }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--on-surface-3)', marginTop: 3, lineHeight: 1.5 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export default function PublishPayroll() {
  const { pushToast } = useToast();
  const [range, setRange] = useState(defaultRange);
  const [busy, setBusy] = useState(null);          // 'preview' | 'publish'
  const [result, setResult] = useState(null);
  const [overtimeOn, setOvertimeOn] = useState(null);

  // Read on mount so the screen can say, before anybody presses anything,
  // whether overtime will be computed at all. Finding that out from a summary
  // after the write is the wrong order.
  useEffect(() => {
    let alive = true;
    api.get('/v1/pahchan/policy')
      .then(r => { if (alive) setOvertimeOn(!!r.data?.overtime_enabled); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const run = async (dryRun) => {
    setBusy(dryRun ? 'preview' : 'publish');
    try {
      const r = await api.post('/v1/pahchan/attendance/publish', {
        from_date: range.from,
        to_date: range.to,
        dry_run: dryRun,
      });
      // Stamped with the range it was built for. Without this, changing the
      // dates after a preview leaves Publish enabled against figures the
      // operator never saw — which is the one thing the preview exists to stop.
      setResult({ ...r.data, __from: range.from, __to: range.to });
      if (!dryRun) {
        pushToast({
          type: 'success',
          title: `${r.data.rows_written} attendance rows written`,
          message: r.data.skipped_manual_rows
            ? `${r.data.skipped_manual_rows} days HR entered by hand were left alone.`
            : 'Payroll can now price this period.',
        });
      }
    } catch (err) {
      pushToast({
        type: 'error',
        title: dryRun ? 'Could not build the preview' : 'Nothing was published',
        message: err.response?.data?.detail || 'Try again.',
      });
    } finally {
      setBusy(null);
    }
  };

  const stale = result && (result.__from !== range.from || result.__to !== range.to);

  return (
    <Section title="Payroll" hi="वेतन को भेजें">
      <Note>
        Attendance does not reach payroll by itself. This pairs each day&rsquo;s punches
        into the rows Vetana prices, and it is safe to run again — every value is
        derived and the write is keyed on employee and date, so a second pass over an
        unchanged period changes nothing. Run it again as corrections land.
      </Note>

      {overtimeOn === false && (
        <Note variant="warn">
          Overtime is off for this organisation, so <code>overtime_hours</code> is left
          untouched rather than written as zero. Turn it on under Policy → Shift and
          overtime if these hours should carry an overtime rate.
        </Note>
      )}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', margin: '4px 0 16px' }}>
        {[['from', 'From'], ['to', 'To']].map(([key, label]) => (
          <label className="fld" key={key} style={{ display: 'block' }}>
            <span className="fld__l">{label}</span>
            <input
              className="inp"
              type="date"
              style={{ maxWidth: 170 }}
              value={range[key]}
              onChange={e => setRange(r => ({ ...r, [key]: e.target.value }))}
            />
          </label>
        ))}
        <button
          className="btn btn--ghost"
          disabled={!!busy || !range.from || !range.to}
          onClick={() => run(true)}
        >
          {busy === 'preview' ? 'Building…' : 'Preview'}
        </button>
        <button
          className="btn btn--fill"
          /* Not reachable until a preview of THIS range has been looked at. The
             endpoint would happily write on the first call; making the operator
             see the figures first is the whole reason dry_run exists. */
          disabled={!!busy || !result || result.dry_run === false || stale}
          onClick={() => run(false)}
        >
          {busy === 'publish' ? 'Publishing…' : 'Publish to payroll'}
        </button>
      </div>

      {!result && (
        <p style={{ fontSize: 12.5, color: 'var(--on-surface-3)', lineHeight: 1.7, maxWidth: '68ch' }}>
          Preview first. It returns exactly what would be written without writing it —
          including the days it refuses to build, which are the ones worth reading.
        </p>
      )}

      {result && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <Figure
              label={result.dry_run ? 'Days that would be built' : 'Days built'}
              value={result.days_built ?? 0}
            />
            <Figure
              label="Withheld — awaiting review"
              value={result.days_withheld_pending_review ?? 0}
              tone={result.days_withheld_pending_review ? 'var(--warn)' : undefined}
              hint="Flagged punches nobody has cleared. Clear them on the Register."
            />
            <Figure
              label="Rows written"
              value={result.dry_run ? '—' : (result.rows_written ?? 0)}
              hint={result.dry_run ? 'Nothing was written; this was a preview.' : undefined}
            />
            <Figure
              label="Left alone — entered by hand"
              value={result.skipped_manual_rows ?? 0}
              hint="A day HR typed is never overwritten by a re-run."
            />
            <Figure
              label="Overtime"
              value={result.overtime?.computed
                ? `${result.overtime.total_hours ?? 0} h`
                : 'Not computed'}
              tone={result.overtime?.computed ? undefined : 'var(--on-surface-3)'}
              hint={result.overtime?.computed
                ? `Beyond ${result.overtime.daily_threshold_hours}h a day or ${result.overtime.weekly_threshold_hours}h a week, at ${result.overtime.multiplier}×.`
                : result.overtime?.reason}
            />
          </div>

          {!!(result.withheld_days || []).length && (
            <Section title="Withheld, pending review" hi="समीक्षा शेष">
              <Note variant="warn">
                These days have punches that are flagged and unreviewed, so no attendance
                row was built for them. That is deliberate: writing an
                &ldquo;absent&rdquo; row here would assert somebody did not work, on the
                strength of a punch nobody has looked at. Clear them on the Register and
                run this again.
              </Note>
              <DataTable columns={['Employee', 'Day']}>
                {result.withheld_days.map(d => (
                  <tr key={`${d.employee_id}-${d.date}`}>
                    <Td mono>{d.employee_id}</Td>
                    <Td mono>{d.date}</Td>
                  </tr>
                ))}
              </DataTable>
            </Section>
          )}

          {!!(result.skipped_manual || []).length && (
            <Section title="Left as HR entered them" hi="हस्तलिखित">
              <DataTable columns={['Employee', 'Day']}>
                {result.skipped_manual.map(d => (
                  <tr key={`${d.employee_id}-${d.date}`}>
                    <Td mono>{d.employee_id}</Td>
                    <Td mono>{d.date}</Td>
                  </tr>
                ))}
              </DataTable>
            </Section>
          )}
        </>
      )}
    </Section>
  );
}
