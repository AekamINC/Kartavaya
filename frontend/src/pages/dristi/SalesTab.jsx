// Dristi · sales — orders over time, status split, and target vs actual.
//
// The reference's fourth chart card is the `row` kind — horizontal meters, one
// per person ("Team utilisation · उपयोग"). The leaderboard is exactly that
// shape and was a four-column table, where a 34% and a 96% look the same until
// you read them.
//
// The leaderboard joins won deals out of Graha, which is a separate entitlement
// from the order book, so the server withholds it on its own and names it.
import React from 'react';
import { StatTile, Section } from '../../components/editorial';
import { useDristi, TabState, FMT, MONEY, NUM, Panel, Bars, Meters, Withheld, downloadCSV } from './_shared';

export default function SalesTab() {
  const state = useDristi('/v1/dristi/sales');
  return (
    <TabState state={state} count={5}>
      {(data) => {
        const trend = data.order_trend || [];
        const split = data.status_split || [];
        const board = data.leaderboard || [];
        const withheld = new Set(data.withheld || []);
        const orders = split.reduce((a, s) => a + (Number(s.count) || 0), 0);
        const value = split.reduce((a, s) => a + (Number(s.value) || 0), 0);

        return (
          <div className="dstack">
            <Section title="Order book" hi="आदेश पुस्तिका">
              <div className="k-stats dstats dstats--orders">
                <StatTile label="Orders" sanskrit="आदेश" value={NUM(orders)} />
                <StatTile label="Order value" sanskrit="मूल्य" value={FMT(value)} variant="info" />
                <StatTile label="Statuses" value={NUM(split.length)}
                  sub={split.length ? 'in use' : 'no orders yet'} />
              </div>
            </Section>

            <Panel title="Orders by month" hi="आदेश रुझान"
              right={<button type="button" className="k-btn k-btn--ghost k-btn--sm"
                disabled={!trend.length}
                onClick={() => downloadCSV('order-trend.csv', ['Month', 'Orders', 'Value'],
                  trend.map(r => [r.month, r.orders, r.value]))}>
                Export CSV
              </button>}>
              <Bars
                items={trend.map(r => ({ label: r.month, value: r.value }))}
                format={MONEY}
                empty="No orders in the last six months."
              />
            </Panel>

            <Panel title="Status split" hi="स्थिति विभाजन">
              <Meters
                items={split.map(s => ({
                  label: s.status,
                  pct: orders ? (Number(s.count) / orders) * 100 : 0,
                  value: `${NUM(s.count)} · ${MONEY(s.value)}`,
                }))}
                empty="No orders on record."
              />
            </Panel>

            <Panel title="Against target" hi="लक्ष्य सापेक्ष"
              right={<span className="dcard__meta">current period</span>}>
              {withheld.has('leaderboard') ? (
                <Withheld what="Target vs actual" module="the CRM (Graha), where won deals live" />
              ) : (
                <Meters
                  items={board.map(r => ({
                    label: r.name || 'Unnamed',
                    pct: Number(r.pct) || 0,
                    // Both figures, because a bar at 96% of a small target is
                    // not the same achievement as 96% of a large one.
                    value: `${r.pct ?? 0}% · ${MONEY(r.actual_amount)} of ${MONEY(r.target_amount)}`,
                    tone: Number(r.pct) >= 100 ? 'ok' : Number(r.pct) < 50 ? 'warn' : undefined,
                  }))}
                  empty="No sales targets are set for the current period. Set them in Vikray."
                />
              )}
            </Panel>
          </div>
        );
      }}
    </TabState>
  );
}
