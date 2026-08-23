// Dristi · HR — headcount, leave, attendance and payroll.
//
// Two separate entitlements meet here. `/hr` refuses outright without Manav —
// there is no non-sensitive remainder in an HR tab — but payroll is Vetana, a
// grant of its own, and reaching employee records does not mean reaching what
// people are paid. So `payroll_trend` arrives empty for a Manav-only caller and
// this tab says which of the two that is, rather than showing an empty payroll
// table that reads as "no payroll has ever been run".
import React from 'react';
import { StatTile, Section } from '../../components/editorial';
import { useDristi, TabState, FMT, NUM, Panel, Meters, Withheld, DataTable, Td } from './_shared';

export default function HRTab() {
  const state = useDristi('/v1/dristi/hr');
  return (
    <TabState state={state} count={5}>
      {(data) => {
        const leave = data.leave_stats || {};
        const att = data.attendance_30d || {};
        const depts = data.departments || [];
        const pay = data.payroll_trend || [];
        const headcount = depts.reduce((a, d) => a + (Number(d.count) || 0), 0);
        const days = Number(att.present_days || 0) + Number(att.absent_days || 0);

        return (
          <div className="dstack">
            <Section title="Leave & attendance" hi="अवकाश व उपस्थिति">
              <div className="k-stats dstats dstats--hr">
                <StatTile label="Leave approved" sanskrit="स्वीकृत" value={NUM(leave.approved)} variant="ok"
                  sub="this calendar year" />
                <StatTile label="Leave pending" sanskrit="प्रतीक्षित" value={NUM(leave.pending)} variant="warn"
                  sub={Number(leave.pending) ? 'awaiting a decision' : 'nothing waiting'} />
                <StatTile label="Present" sanskrit="उपस्थित" value={NUM(att.present_days)} variant="ok"
                  sub="days, last 30" />
                <StatTile label="Absent" sanskrit="अनुपस्थित" value={NUM(att.absent_days)} variant="danger"
                  sub="days, last 30" />
              </div>
              {days > 0 && (
                <p className="dnote">
                  {NUM(att.tracked)} {Number(att.tracked) === 1 ? 'person' : 'people'} tracked
                  across {NUM(days)} recorded {days === 1 ? 'day' : 'days'}.
                </p>
              )}
            </Section>

            <Panel title="Headcount by department" hi="विभाग संख्या"
              right={headcount ? <span className="dcard__meta">{NUM(headcount)} on record</span> : null}>
              {/* Meters rather than a tile grid: departments are parts of one
                  whole, and equal-sized tiles hide which is the big one. */}
              <Meters
                items={depts.map(d => ({
                  label: d.department,
                  pct: headcount ? (Number(d.count) / headcount) * 100 : 0,
                  value: NUM(d.count),
                }))}
                empty="No active employees on record."
              />
            </Panel>

            <Panel title="Payroll trend" hi="वेतन रुझान">
              {!pay.length ? (
                <Withheld
                  what="Payroll figures"
                  module="payroll (Vetana) — or no run has been recorded yet"
                />
              ) : (
                <DataTable arrange="dristi.payroll_months" columns={[
                  'Month',
                  { label: 'Gross', align: 'right' },
                  { label: 'Net', align: 'right' },
                  { label: 'PF', align: 'right' },
                  { label: 'ESI', align: 'right' },
                  { label: 'TDS', align: 'right' },
                  { label: 'Staff', align: 'right' },
                ]}>
                  {pay.map(r => (
                    <tr key={r.month}>
                      <td>{r.month}</td>
                      <Td align="right" mono>{FMT(r.total_gross)}</Td>
                      <Td align="right" mono bold>{FMT(r.total_net)}</Td>
                      <Td align="right" mono>{FMT(r.total_pf)}</Td>
                      <Td align="right" mono>{FMT(r.total_esi)}</Td>
                      <Td align="right" mono>{FMT(r.total_tds)}</Td>
                      <Td align="right" mono>{r.employee_count ? NUM(r.employee_count) : '—'}</Td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </Panel>
          </div>
        );
      }}
    </TabState>
  );
}
