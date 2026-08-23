// Vetana → Statutory. What is owed to the state for a month, and by when.
//
// The reference (`ScreensThin.jsx` `VetanaStatutory`) is a two-column screen: a
// compliance calendar on the left, this month's totals and the org's
// registrations on the right. Two of those three are built here from real data.
//
// The THIRD is deliberately absent. The reference's "Registrations" card lists a
// PF establishment code, an ESIC employer code, a PT enrolment certificate and a
// TAN. `staging.organisations` has a column for none of them — they arrive with
// `PROPOSED_080_statutory_document_identifiers.sql`, which has not been applied,
// and `/v1/org/profile` does not expose them. Rendering that card would mean
// inventing four identifiers on a compliance screen. See the header of
// `statutoryCalendar.js` for the same argument about professional tax dates.
import React, { useState } from 'react';
import { Section, StatTile, DataTable, Td } from '../../components/editorial';
import Tag from '../../components/ui/Tag';
import {
  useResource, ErrorNote, FMT, Shim, monthName, thisMonth, shortDate,
} from './_shared';
import { complianceCalendar } from './statutoryCalendar';
import { useLanguage } from '../../components/CustomizePanel';
import { secondaryOf } from '../../lib/labels';
import { Secondary } from '../../components/Bilingual';

const STATUS = {
  overdue: { label: 'Overdue', color: 'var(--danger)' },
  due: { label: 'Due', color: 'var(--warn)' },
  'no-date': { label: 'State schedule', color: 'var(--on-surface-3)' },
};

export default function StatutoryTab() {
  const [month, setMonth] = useState(thisMonth());
  const res = useResource(
    `/v1/vetana/statutory-summary${month ? `?month=${encodeURIComponent(month)}` : ''}`,
    [month],
  );

  return (
    <div>
      <div className="k-section__head vt-head">
        <h3 className="k-section__title">
          Statutory<Secondary className="k-section__title-hi" value="वैधानिक" />
        </h3>
        <label className="vt-field">
          <span className="vt-field__l">Month</span>
          <input
            type="month"
            value={month}
            max={thisMonth()}
            onChange={e => setMonth(e.target.value)}
            className="k-formpanel__input vt-field__in"
          />
        </label>
      </div>

      {res.loading ? <Shim count={6} />
        : res.error ? <ErrorNote what="The statutory summary" error={res.error} onRetry={res.reload} />
          : <Summary data={res.data} month={month} />}
    </div>
  );
}

function Summary({ data, month }) {
  // ONE LABEL SHAPE — `.vt-cal__hi` is not in `[data-language="en"]`'s six-name
  // list. Read once, HERE: the calendar rows are mapped in this component, not
  // in the tab above it.
  const lang = useLanguage();
  const totals = data.totals || {};
  const employees = data.employees || [];
  const rows = complianceCalendar(data.month || month, totals);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const max = rows.reduce((m, r) => Math.max(m, r.amount), 0);

  const nothing = total === 0;

  return (
    <>
      <div className="k-stats">
        <StatTile label="Provident fund" sanskrit="निधि" variant="warn"
          value={FMT(Number(totals.total_pf_employee || 0) + Number(totals.total_pf_employer || 0))}
          sub={`employee ${FMT(totals.total_pf_employee)} · employer ${FMT(totals.total_pf_employer)}`} />
        <StatTile label="State insurance" sanskrit="बीमा" variant="warn"
          value={FMT(Number(totals.total_esi_employee || 0) + Number(totals.total_esi_employer || 0))}
          sub={`employee ${FMT(totals.total_esi_employee)} · employer ${FMT(totals.total_esi_employer)}`} />
        <StatTile label="Professional tax" sanskrit="व्यवसाय" value={FMT(totals.total_pt)} sub="deducted from pay" />
        <StatTile label="TDS on salary" sanskrit="कर" variant="danger" value={FMT(totals.total_tds)} sub="deposited to the exchequer" />
      </div>

      <Section
        title="Compliance calendar"
        hi="अनुपालन"
        right={<span className="vt-cap">{monthName(data.month || month)} run</span>}
      >
        {nothing ? (
          <p className="note">
            <b>Nothing was deducted in {monthName(data.month || month)}.</b> Either
            the month has not been processed, or no payslip in it carried a
            statutory deduction. There is nothing to file.
          </p>
        ) : (
          <div className="vt-cal">
            {rows.map(r => {
              const st = STATUS[r.status];
              const rowIn = secondaryOf(r.hi, lang);
              return (
                <article key={r.key} className={`vt-cal__i${r.status === 'overdue' ? ' vt-cal__i--late' : ''}`}>
                  <div className="vt-cal__top">
                    <span className="vt-cal__form">{r.form}</span>
                    <span className="vt-cal__names">
                      <b className="vt-cal__t">{r.title}</b>
                      {rowIn.secondary && <Secondary className="vt-cal__hi" value={rowIn.secondary} />}
                    </span>
                    <span className="vt-cal__fig">
                      <span className="vt-cal__amt">{FMT(r.amount)}</span>
                      <span className="vt-cal__due">
                        {r.due
                          ? <>due {shortDate(r.due)}{r.status === 'due' && ` · in ${r.daysLeft}d`}</>
                          : 'no national due date'}
                      </span>
                    </span>
                  </div>
                  <p className="vt-cal__n">{r.note}</p>
                  {/* The rule is printed, not merely applied. A compliance date a
                      reader cannot check is a date they have to trust. */}
                  <p className="vt-cal__rule">{r.rule}</p>
                  <div className="vt-cal__foot">
                    <Tag color={st.color}>{r.nil ? 'Nothing due' : st.label}</Tag>
                    <span className="vt-bar vt-bar--slim vt-cal__bar" title={`${FMT(r.amount)} of ${FMT(max)}`}>
                      <span className="vt-bar__f" style={{ width: `${max > 0 ? Math.round((r.amount / max) * 100) : 0}%` }} />
                    </span>
                  </div>
                </article>
              );
            })}
            <div className="vt-cal__sum">
              <span>Total statutory for {monthName(data.month || month)}</span>
              <b className="vt-cal__amt">{FMT(total)}</b>
            </div>
          </div>
        )}
      </Section>

      <Section title="Employee-wise register" hi="कर्मचारी विवरण">
        {employees.length === 0 ? (
          <p className="note">
            <b>No payslips in {monthName(data.month || month)}.</b> The register is
            built from that month’s payslips — process the month on the Payroll
            tab and it fills in.
          </p>
        ) : (
          <>
            <DataTable arrange="vetana.statutory_employees" columns={[
              'Employee', 'Code', 'PAN', 'UAN',
              { label: 'Basic', align: 'right' }, { label: 'Gross', align: 'right' },
              { label: 'PF (E)', align: 'right' }, { label: 'PF (R)', align: 'right' },
              { label: 'ESI (E)', align: 'right' }, { label: 'ESI (R)', align: 'right' },
              { label: 'PT', align: 'right' }, { label: 'TDS', align: 'right' },
            ]}>
              {employees.map((e, i) => (
                <tr key={e.payslip_number || i}>
                  <td>{e.employee_name}</td>
                  <Td mono>{e.employee_code}</Td>
                  <Td mono>{e.pan || '—'}</Td>
                  <Td mono>{e.uan || '—'}</Td>
                  <Td align="right" mono>{FMT(e.basic)}</Td>
                  <Td align="right" mono>{FMT(e.gross)}</Td>
                  <Td align="right" mono>{FMT(e.pf_employee)}</Td>
                  <Td align="right" mono>{FMT(e.pf_employer)}</Td>
                  <Td align="right" mono>{FMT(e.esi_employee)}</Td>
                  <Td align="right" mono>{FMT(e.esi_employer)}</Td>
                  <Td align="right" mono>{FMT(e.professional_tax)}</Td>
                  <Td align="right" mono>{FMT(e.tds)}</Td>
                </tr>
              ))}
            </DataTable>
            <p className="vt-cap vt-cap--note">
              PAN and UAN are masked at every access level — the figures are what
              the filing needs, and the full identifiers are on the payslip PDF.
            </p>
          </>
        )}
      </Section>
    </>
  );
}
