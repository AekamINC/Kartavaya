// Vetana → Dashboard. The year, the split, and who is missing from the run.
//
// The current month's gross/deductions/net moved UP to the page-level KPI strip
// (`VetanaPage.jsx`), where the reference puts them. Repeating them here would
// be the same four numbers twice on one screen, so this tab now answers the
// questions the strip cannot: what has the year cost, where is it going, and —
// the one nobody was asking — who is not in the payroll at all.
import React from 'react';
import { Section, StatTile, DataTable, Td } from '../../components/editorial';
import { useResource, useList, Resource, ErrorNote, FMT, Shim, monthName } from './_shared';

export default function DashboardTab() {
  const dash = useResource('/v1/vetana/dashboard');
  // A second, independent request: coverage is a different question from
  // totals and one failing must not blank the other.
  const structures = useList('/v1/vetana/salary-structures');

  if (dash.loading) return <Shim count={8} />;
  if (dash.error) return <ErrorNote what="The payroll dashboard" error={dash.error} onRetry={dash.reload} />;

  const data = dash.data || {};
  const ytd = data.ytd || {};
  const run = data.latest_run;
  const split = data.department_split || [];
  const maxGross = split.reduce((m, d) => Math.max(m, Number(d.dept_gross || 0)), 0);

  return (
    <>
      <Section title="Year to date" hi="वार्षिक">
        <div className="k-stats">
          <StatTile label="Gross paid" sanskrit="सकल" value={FMT(ytd.ytd_gross)} sub="all runs this year" />
          <StatTile label="Provident fund" sanskrit="निधि" value={FMT(ytd.ytd_pf)} variant="warn" sub="employee share" />
          <StatTile label="State insurance" sanskrit="बीमा" value={FMT(ytd.ytd_esi)} variant="warn" sub="employee share" />
          <StatTile label="Tax deducted" sanskrit="कर" value={FMT(ytd.ytd_tds)} variant="danger" sub="TDS on salary" />
        </div>
      </Section>

      <Coverage headcount={data.headcount} structures={structures} />

      <Section
        title="Department split"
        hi="विभाग"
        right={run ? <span className="vt-cap">{monthName(run.month)}</span> : null}
      >
        {!run ? (
          <p className="note">
            <b>No payroll has been run yet.</b> The split appears once a month has
            been processed — it is built from that run’s payslips, not from salary
            structures, so it shows what was actually paid.
          </p>
        ) : split.length === 0 ? (
          <p className="note">
            <b>{monthName(run.month)} produced no payslips.</b> The run exists but
            no employee was priced into it — check that active employees have a
            salary structure effective on or before the end of that month.
          </p>
        ) : (
          <DataTable columns={[
            'Department',
            { label: 'Employees', align: 'right' },
            { label: 'Gross', align: 'right' },
            { label: 'Net', align: 'right' },
            'Share',
          ]}>
            {split.map((d, i) => {
              const gross = Number(d.dept_gross || 0);
              const pct = maxGross > 0 ? Math.round((gross / maxGross) * 100) : 0;
              return (
                <tr key={d.department || i}>
                  <td>{d.department || 'Unassigned'}</td>
                  <Td align="right">{d.employees}</Td>
                  <Td align="right" mono>{FMT(gross)}</Td>
                  <Td align="right" mono>{FMT(d.dept_net)}</Td>
                  <td>
                    {/* The bar is a second reading of the Gross column, not a
                        replacement for it — the figure stays, so the row is
                        still exact and still sortable by eye. */}
                    <span className="vt-bar" title={`${pct}% of the largest department`}>
                      <span className="vt-bar__f" style={{ width: `${pct}%` }} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Section>
    </>
  );
}

/**
 * Who is not in the payroll.
 *
 * `process_payroll` iterates SALARY STRUCTURES, not employees — an active
 * employee with no structure is skipped in silence and appears nowhere in the
 * run, the payslip list or the statutory register. Nothing in the product said
 * so. This is the only place the two counts are put beside each other.
 */
function Coverage({ headcount, structures }) {
  if (structures.loading) return <Shim count={1} />;
  if (structures.error) {
    return (
      <Section title="Payroll coverage" hi="व्याप्ति">
        <ErrorNote what="Salary structure coverage" error={structures.error} onRetry={structures.reload} />
      </Section>
    );
  }

  const total = Number(headcount || 0);
  // One structure row per employee is what the run uses (it de-duplicates by
  // employee and keeps the latest effective date), so count distinct employees.
  const covered = new Set((structures.items || []).map(s => String(s.employee_id))).size;
  const missing = Math.max(total - covered, 0);

  return (
    <Section title="Payroll coverage" hi="व्याप्ति">
      {total === 0 ? (
        <p className="note">
          <b>No active employees.</b> Add people in Manav before defining salary
          structures here.
        </p>
      ) : missing === 0 ? (
        <p className="note note--info">
          <b>All {total} active {total === 1 ? 'employee has' : 'employees have'} a salary structure.</b>{' '}
          Everyone on the roll will be priced into the next run.
        </p>
      ) : (
        <p className="note note--warn">
          <b>{missing} of {total} active {missing === 1 ? 'employee has' : 'employees have'} no salary structure.</b>{' '}
          A payroll run prices salary structures, not people — anyone without one
          is skipped silently and will not appear in the run, the payslips or the
          statutory register. Define a structure for them before processing the month.
        </p>
      )}
    </Section>
  );
}
