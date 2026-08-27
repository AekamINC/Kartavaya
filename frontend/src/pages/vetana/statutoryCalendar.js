// The compliance calendar behind the Statutory tab.
//
// `design-reference/Kartavaya Redesign/ScreensThin.jsx` `VetanaStatutory()`
// renders a calendar of five filings with amounts, forms and due dates. In the
// reference those are literals in an array. Here every AMOUNT comes from
// `/v1/vetana/statutory-summary` — the org's own payslip totals for the month —
// and every DATE is derived from the wage month by the statutory rule, which is
// named on the row so a reader can check it rather than trust it.
//
// ── What is deliberately NOT here ────────────────────────────────────────────
//
// Professional tax has no national due date. It is levied by state under the
// respective Shops & Establishments / Professions Tax Acts, and the schedule
// (monthly, quarterly or annual, and on which day) differs by state and by the
// size of the employer's liability. The reference hard-codes "31 Aug 2026" and
// the Maharashtra form MTR-6, because the reference is a mockup of one firm in
// Mumbai.
//
// Deriving a date from a state we do not reliably hold, for a schedule that has
// no single rule, would produce a plausible-looking wrong date on a compliance
// screen — the exact failure the payslip generator refuses to commit. So PT
// carries its real amount and says openly that its date follows the state
// schedule. A missing date a reader can see is safe; an invented one is not.
//
// The reference's "Registrations" card (PF code, ESIC code, PT EC, TAN) is
// likewise absent: `staging.organisations` has no column for any of the four.
// They arrive with `PROPOSED_090_statutory_document_identifiers.sql`, which has
// not been applied, and `/v1/org/profile` does not expose them. There is nothing
// truthful to render, so nothing is rendered.

/** Last day of a `YYYY-MM` month, as `YYYY-MM-DD`. */
function endOf(year, month1) {
  const last = new Date(year, month1, 0).getDate();
  return `${year}-${String(month1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/** The `day` of the month AFTER the given wage month, as `YYYY-MM-DD`. */
function dayAfterMonth(year, month1, day) {
  const y = month1 === 12 ? year + 1 : year;
  const m = month1 === 12 ? 1 : month1 + 1;
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The TDS quarterly return (Form 24Q) covering a wage month.
 *
 * Indian financial year, so the quarters are Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar.
 * Rule 31A(2) due dates: 31 July, 31 October, 31 January, and 31 May for the
 * last quarter — the fourth is the odd one out and is the one most often got
 * wrong by assuming "one month after the quarter".
 */
function tdsQuarter(year, month1) {
  if (month1 >= 4 && month1 <= 6) return { q: 'Q1', covers: 'Apr–Jun', due: `${year}-07-31` };
  if (month1 >= 7 && month1 <= 9) return { q: 'Q2', covers: 'Jul–Sep', due: `${year}-10-31` };
  if (month1 >= 10) return { q: 'Q3', covers: 'Oct–Dec', due: `${year + 1}-01-31` };
  return { q: 'Q4', covers: 'Jan–Mar', due: `${year}-05-31` };
}

/**
 * Build the calendar for one wage month against that month's real totals.
 *
 * `totals` is the `totals` object from `/v1/vetana/statutory-summary`.
 * `today` is injectable so the overdue/due split is testable rather than
 * dependent on the wall clock.
 *
 * A row whose amount is zero is still returned, with `nil: true`. Nothing was
 * deducted under that head this month, and that is a fact worth showing — a
 * calendar that hides the ESI row when ESI is zero looks the same as a calendar
 * for an org that has no ESI liability at all.
 */
export function complianceCalendar(month, totals = {}, today = new Date()) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return [];
  const [year, month1] = month.split('-').map(Number);
  const n = v => Number(v || 0);

  const pf = n(totals.total_pf_employee) + n(totals.total_pf_employer);
  const esi = n(totals.total_esi_employee) + n(totals.total_esi_employer);
  const pt = n(totals.total_pt);
  const tds = n(totals.total_tds);
  const quarter = tdsQuarter(year, month1);

  const rows = [
    {
      key: 'pf',
      form: 'ECR',
      title: 'Provident fund — ECR upload',
      hi: 'भविष्य निधि',
      amount: pf,
      due: dayAfterMonth(year, month1, 15),
      rule: 'EPF Scheme 1952, para 38 — within 15 days of the close of the month.',
      note: 'Employee and employer contributions together. The ECR is the return; '
        + 'the challan is the payment made against it.',
    },
    {
      key: 'esi',
      form: 'ESIC',
      title: 'Employees’ State Insurance — monthly contribution',
      hi: 'राज्य बीमा',
      amount: esi,
      due: dayAfterMonth(year, month1, 15),
      rule: 'ESI (General) Regulations 1950, reg. 31 — within 15 days of the last day of the month.',
      note: 'Employee 0.75% and employer 3.25% of wages. Employees above the wage '
        + 'ceiling are outside the scheme and contribute nothing.',
    },
    {
      key: 'pt',
      form: 'PT',
      title: 'Professional tax',
      hi: 'व्यवसाय कर',
      amount: pt,
      due: null,
      rule: 'Levied by state. The return period and due date follow your state’s '
        + 'Professions Tax Act, so no date is asserted here.',
      note: 'The amount is what was actually deducted across this month’s payslips.',
    },
    {
      key: 'tds',
      form: '24Q',
      title: `TDS on salary — ${quarter.q} return`,
      hi: 'स्रोत कर',
      amount: tds,
      due: quarter.due,
      rule: `Income-tax Rules, 31A(2) — ${quarter.q} (${quarter.covers}) return. `
        + 'The monthly deposit under Rule 30 is due by the 7th and is separate from this return.',
      note: `This figure is ${monthLabel(month)} alone; the return covers the whole quarter.`,
    },
  ];

  const todayISO = toISO(today);
  return rows.map(r => ({
    ...r,
    nil: r.amount === 0,
    status: r.due == null ? 'no-date' : (r.due < todayISO ? 'overdue' : 'due'),
    daysLeft: r.due == null ? null : daysBetween(todayISO, r.due),
  }));
}

function toISO(d) {
  const y = d.getFullYear();
  return `${y}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(aISO, bISO) {
  const a = new Date(`${aISO}T00:00:00`);
  const b = new Date(`${bISO}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
}

/**
 * The single next filing — what the module header's "Compliance due" figure
 * shows. The earliest future date wins; if anything is already overdue that
 * comes first, because an overdue filing is the more urgent fact.
 */
export function nextFiling(rows) {
  const dated = rows.filter(r => r.due && !r.nil);
  if (!dated.length) return null;
  const overdue = dated.filter(r => r.status === 'overdue');
  const pool = overdue.length ? overdue : dated;
  return pool.reduce((best, r) => (best == null || r.due < best.due ? r : best), null);
}

export { endOf };
