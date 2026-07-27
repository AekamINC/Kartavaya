// Dristi · revenue — invoiced, collected and spent, by month.
//
// The reference's first chart card is "Revenue by month · मासिक राजस्व", a bar
// chart. This tab was a bare table of five numeric columns: correct, and
// impossible to read a trend off. The table stays underneath it, because the
// figures are what get exported and argued about — the chart answers "which way
// is this going", the table answers "how much exactly".
import React from 'react';
import { DataTable, Td } from '../../components/editorial';
import { useDristi, TabState, FMT, MONEY, Panel, Bars, downloadCSV } from './_shared';

export default function RevenueTab() {
  const state = useDristi('/v1/dristi/revenue');
  return (
    <TabState state={state} count={5}>
      {(data) => {
        const trend = data.trend || [];
        const has = trend.some(r => r.invoiced || r.collected || r.expenses);
        const totals = trend.reduce((a, r) => ({
          invoiced: a.invoiced + Number(r.invoiced || 0),
          collected: a.collected + Number(r.collected || 0),
          expenses: a.expenses + Number(r.expenses || 0),
          profit: a.profit + Number(r.profit || 0),
        }), { invoiced: 0, collected: 0, expenses: 0, profit: 0 });

        return (
          <div className="dstack">
            <Panel
              title="Collected by month" hi="मासिक राजस्व"
              right={<button type="button" className="k-btn k-btn--ghost k-btn--sm"
                disabled={!has}
                onClick={() => downloadCSV('revenue-trend.csv',
                  ['Month', 'Invoiced', 'Collected', 'Expenses', 'Profit'],
                  trend.map(r => [r.month, r.invoiced, r.collected, r.expenses, r.profit]))}>
                Export CSV
              </button>}
            >
              <Bars
                items={trend.map(r => ({ label: r.month, value: r.collected }))}
                format={MONEY}
                empty="No invoices have been raised in this window."
              />
            </Panel>

            <Panel title="Month by month" hi="विवरण">
              {!has ? (
                <p className="dnone">
                  No invoices or expenses in the last six months. Raise an invoice in Ganit
                  and it appears here.
                </p>
              ) : (
                <DataTable columns={[
                  'Month',
                  { label: 'Invoiced', align: 'right' },
                  { label: 'Collected', align: 'right' },
                  { label: 'Expenses', align: 'right' },
                  { label: 'Profit', align: 'right' },
                ]}>
                  {trend.map(r => (
                    <tr key={r.month}>
                      <td>{r.month}</td>
                      <Td align="right" mono>{FMT(r.invoiced)}</Td>
                      <Td align="right" mono>{FMT(r.collected)}</Td>
                      <Td align="right" mono>{FMT(r.expenses)}</Td>
                      {/* Profit is the one figure whose SIGN is the message, so it
                          is the one that carries a colour — and the minus sign
                          carries it too, for anyone who cannot see the tone. */}
                      <Td align="right" mono bold
                        className={Number(r.profit) < 0 ? 'dneg' : 'dpos'}>
                        {FMT(r.profit)}
                      </Td>
                    </tr>
                  ))}
                  <tr className="mtbl__tot">
                    <td>Total</td>
                    <Td align="right" mono>{FMT(totals.invoiced)}</Td>
                    <Td align="right" mono>{FMT(totals.collected)}</Td>
                    <Td align="right" mono>{FMT(totals.expenses)}</Td>
                    <Td align="right" mono bold className={totals.profit < 0 ? 'dneg' : 'dpos'}>
                      {FMT(totals.profit)}
                    </Td>
                  </tr>
                </DataTable>
              )}
            </Panel>
          </div>
        );
      }}
    </TabState>
  );
}
