// Dristi · overview — the cross-module summary.
//
// This is the tab that made the per-source withholding necessary. It reads six
// modules, and the server returns a `withheld` list naming the blocks it
// declined rather than sending zeros, so each block below either shows figures
// or says why it doesn't. A withheld payroll total drawn as ₹0 is
// indistinguishable from a company that paid nobody this year, and the
// difference between those two is the whole value of the number.
import React from 'react';
import { Section, StatTile } from '../../components/editorial';
import { useDristi, TabState, FMT, NUM, PCT, Withheld, Bars } from './_shared';

/** Which module each withheld block reads — mirrors `_OVERVIEW_SOURCES`. */
const SOURCE_LABEL = {
  crm: 'the CRM (Graha)',
  deals: 'the CRM (Graha)',
  revenue: 'accounting (Ganit)',
  hr: 'HR records (Manav)',
  orders: 'the order book (Vikray)',
  payroll: 'payroll (Vetana)',
};

export default function OverviewTab() {
  const state = useDristi('/v1/dristi/overview');
  return (
    <TabState state={state} count={8}>
      {(data) => {
        const withheld = new Set(data.withheld || []);
        const crm = data.crm || {};
        const deals = data.deals || {};
        const revenue = data.revenue || {};
        const hr = data.hr || {};
        const orders = data.orders || {};
        const payroll = data.payroll || {};
        const tasks = data.tasks || {};

        const total = Number(deals.total_deals) || 0;
        const won = Number(deals.won_deals) || 0;

        return (
          <>
            <Section title="CRM & Sales" hi="ग्राहक व बिक्री">
              {withheld.has('crm') ? <Withheld what="Contacts and deals" module={SOURCE_LABEL.crm} /> : (
                <>
                  <div className="k-stats">
                    <StatTile label="Contacts" sanskrit="संपर्क" value={NUM(crm.total_contacts)} />
                    <StatTile label="Leads" sanskrit="संभावना" value={NUM(crm.leads)} />
                    <StatTile label="Customers" sanskrit="ग्राहक" value={NUM(crm.customers)} />
                    <StatTile label="Open pipeline" sanskrit="प्रवाह" value={FMT(deals.pipeline_value)} variant="info" />
                  </div>
                  <div className="k-stats dstats--next">
                    <StatTile label="Won deals" sanskrit="विजित" value={NUM(won)} variant="ok"
                      sub={total ? `of ${NUM(total)} deals` : 'no deals yet'} />
                    <StatTile label="Won value" value={FMT(deals.won_value)} variant="ok" />
                    <StatTile label="Win rate" value={total ? PCT(won / total * 100) : '—'}
                      sub={total ? 'closed and open' : 'needs a closed deal'} />
                  </div>
                </>
              )}
            </Section>

            <Section title="Finance & Orders" hi="वित्त व आदेश">
              {withheld.has('revenue')
                ? <Withheld what="Invoiced, collected and outstanding" module={SOURCE_LABEL.revenue} />
                : (
                  <div className="k-stats">
                    <StatTile label="Invoiced" sanskrit="बीजक" value={FMT(revenue.total_invoiced)} />
                    <StatTile label="Collected" sanskrit="प्राप्त" value={FMT(revenue.total_collected)} variant="ok" />
                    {/* Outstanding is a warn tone because it is money you are owed
                        and have not been paid — the caption says so in words too,
                        so the colour is never the only carrier. */}
                    <StatTile label="Outstanding" sanskrit="बकाया" value={FMT(revenue.outstanding)} variant="warn"
                      sub="unpaid and not cancelled" />
                  </div>
                )}
              {withheld.has('orders')
                ? <Withheld what="Orders" module={SOURCE_LABEL.orders} />
                : (
                  <div className="k-stats dstats--next">
                    <StatTile label="Orders" sanskrit="आदेश" value={NUM(orders.total_orders)} />
                    <StatTile label="Order value" value={FMT(orders.order_value)} />
                    <StatTile label="Fulfilled" sanskrit="पूर्ण" value={NUM(orders.fulfilled)} variant="ok" />
                  </div>
                )}
            </Section>

            <Section title="People & Payroll" hi="जन व वेतन">
              {withheld.has('hr')
                ? <Withheld what="Headcount" module={SOURCE_LABEL.hr} />
                : (
                  <div className="k-stats">
                    <StatTile label="Headcount" sanskrit="संख्या" value={NUM(hr.headcount)} />
                    <StatTile label="In a department" value={NUM(hr.in_departments)}
                      sub={hr.headcount ? `of ${NUM(hr.headcount)} on record` : undefined} />
                  </div>
                )}
              {withheld.has('payroll')
                ? <Withheld what="Payroll and statutory totals" module={SOURCE_LABEL.payroll} />
                : (
                  <div className="k-stats dstats--next">
                    <StatTile label="YTD payroll" sanskrit="वेतन" value={FMT(payroll.ytd_payroll)} />
                    <StatTile label="YTD statutory" sanskrit="अनुपालन" value={FMT(payroll.ytd_statutory)}
                      sub="PF · ESI · TDS" />
                  </div>
                )}
            </Section>

            {/* Tasks are the one block with no module gate — they are the shared
                work surface, not another module's ledger, so they always draw. */}
            <Section title="Work" hi="कार्य">
              <div className="k-stats">
                <StatTile label="Total tasks" sanskrit="कुल" value={NUM(tasks.total_tasks)} />
                <StatTile label="Active" sanskrit="सक्रिय" value={NUM(tasks.active_tasks)} variant="info" />
                <StatTile label="Done" sanskrit="पूर्ण" value={NUM(tasks.done_tasks)} variant="ok" />
                <StatTile label="Overdue" sanskrit="विलंबित" value={NUM(tasks.overdue_tasks)} variant="danger"
                  sub={Number(tasks.overdue_tasks) ? 'past due, not done' : 'nothing late'} />
              </div>
              <Bars
                items={[
                  { label: 'Active', value: tasks.active_tasks },
                  { label: 'Done', value: tasks.done_tasks },
                  { label: 'Overdue', value: tasks.overdue_tasks },
                ]}
                empty="No tasks on record yet."
              />
            </Section>
          </>
        );
      }}
    </TabState>
  );
}
