// Dristi · pipeline — conversion, stages and who is buying.
//
// The reference's second chart card is a FUNNEL ("Pipeline by stage · चरण
// अनुसार"). This tab drew a grid of equal-sized count tiles instead, which is
// the one shape that cannot show the thing a pipeline is for: that each stage
// is narrower than the one before it. Stage order is meaning, so the funnel
// never sorts by value — the server already returns the stages in board order.
import React from 'react';
import { DataTable, Td, StatTile, Section } from '../../components/editorial';
import { useDristi, TabState, FMT, NUM, Panel, Funnel } from './_shared';

/** Devanagari for the six default stages; org-configurable stages fall through
 *  to English rather than being transliterated on the fly — a wrong Hindi word
 *  on screen is worse than none. Same rule as graha/PipelineTab. */
const STAGE_HI = {
  New: 'नवीन', Qualified: 'योग्य', Proposal: 'प्रस्ताव',
  Negotiation: 'वार्ता', Won: 'विजित', Lost: 'खोया',
};

export default function PipelineTab() {
  const state = useDristi('/v1/dristi/pipeline');
  return (
    <TabState state={state} count={5}>
      {(data) => {
        const conv = data.conversion || {};
        const stages = data.stages || [];
        const top = data.top_contacts || [];
        // Won and Lost are outcomes, not stages — including them in the funnel
        // makes the funnel widen at the bottom.
        const open = stages.filter(s => s.stage !== 'Won' && s.stage !== 'Lost');

        return (
          <div className="dstack">
            <Section title="Conversion" hi="रूपांतरण">
              <div className="k-stats">
                <StatTile label="Total deals" sanskrit="कुल" value={NUM(conv.total)} />
                <StatTile label="Won" sanskrit="विजित" value={NUM(conv.won)} variant="ok" />
                <StatTile label="Lost" sanskrit="खोया" value={NUM(conv.lost)} variant="danger" />
                <StatTile label="Win rate" value={conv.total ? `${conv.win_rate ?? 0}%` : '—'}
                  variant="info" sub={conv.total ? 'of all deals' : 'no deals yet'} />
              </div>
            </Section>

            <Panel title="Pipeline by stage" hi="चरण अनुसार"
              right={<span className="dcard__meta">open deals only</span>}>
              <Funnel
                items={open.map(s => ({
                  label: STAGE_HI[s.stage] ? `${s.stage} · ${STAGE_HI[s.stage]}` : s.stage,
                  value: s.value,
                  sub: `${NUM(s.count)} ${Number(s.count) === 1 ? 'deal' : 'deals'}`,
                }))}
                empty="No open deals. Won and lost deals are excluded from the funnel."
              />
            </Panel>

            <Panel title="Top customers" hi="शीर्ष ग्राहक"
              right={<span className="dcard__meta">by won value</span>}>
              {!top.length ? (
                <p className="dnone">No deals have been won yet — this ranks customers by closed value.</p>
              ) : (
                <DataTable columns={[
                  'Name', 'Company',
                  { label: 'Deals', align: 'right' },
                  { label: 'Won value', align: 'right' },
                ]}>
                  {top.map((c, i) => (
                    <tr key={`${c.name}-${i}`}>
                      <td>{c.name || '—'}</td>
                      <td>{c.company || '—'}</td>
                      <Td align="right" mono>{NUM(c.deal_count)}</Td>
                      <Td align="right" mono bold>{FMT(c.total_value)}</Td>
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
