// Sahayak → Credits. The org pool, your slice of it, and the ledger.
//
// NOTE ON FIGURES: credits only. What a credit costs in rupees is our price and
// does not belong on a tenant surface — the backend already stopped serving
// `price_per_credit_inr` for this reason.
import React from 'react';
import { DataTable, Td } from '../../components/editorial';
import { ErrorNote, Shim } from '../hub/_shared';
import { AGENT_LABELS, stamp } from './_shared';
import { useLanguage } from '../../components/CustomizePanel';
import { secondaryOf } from '../../lib/labels';
import { Secondary } from '../../components/Bilingual';

export default function CreditsTab({ credits, loading, error, onRetry }) {
  // ONE LABEL SHAPE — this class is not one of the six `[data-language="en"]`
  // knows about, so its Devanagari rendered under English too.
  // Read once: the four figures are mapped.
  const lang = useLanguage();
  if (loading) return <Shim count={4} />;
  if (error) return <ErrorNote what="Your credit balance" error={error} onRetry={onRetry} />;

  const org = credits?.org_balance || {};
  // null when no allocation row exists — not the same as an allocation of zero.
  // Without a row `deduct_org_credits` applies no personal cap and the run comes
  // out of the org pool.
  const you = credits?.user_allocation || null;
  const capped = !!you;
  const plan = org.plan_credits ?? 0;
  const orgUsed = org.used ?? 0;
  // `org.balance` — the stored wallet, which is the figure `deduct_org_credits`
  // holds FOR UPDATE and refuses against. `plan - used` was a third independent
  // computation of the same number (the reply did it, `OrgSahayakPage` did it,
  // and so did this), and all three drifted from the wallet the moment a
  // balance carried anything older than this month: 744 on screen, 324
  // enforceable, measured 2026-07-29.
  const orgLeft = org.balance ?? null;
  const yourLeft = capped ? (you.allocated ?? 0) - (you.used ?? 0) : orgLeft;
  const txns = credits?.recent_transactions || [];
  const costs = credits?.credit_costs || {};

  return (
    <div className="sr-credits">
      <div className="sr-figs">
        {[
          ['Organisation balance', 'संस्था', orgLeft, plan > 0 ? `${orgUsed} spent this month · plan gives ${plan}` : 'no plan allocation set'],
          ['Your allocation', 'आवंटन', capped ? you.allocated : '—', capped ? 'set by an org admin' : 'no personal cap set'],
          ['You have used', 'प्रयोग', capped ? you.used : '—', capped ? 'this month' : 'counted against the org pool'],
          ['You have left', 'शेष', yourLeft ?? '—',
            !capped ? 'you spend from the org pool'
              : yourLeft <= 0 ? 'ask an admin to raise your allocation' : 'available to spend'],
        ].map(([label, hi, value, sub]) => {
          const figIn = secondaryOf(hi, lang);
          return (
          <div className="sr-fig" key={label}>
            <div className="sr-fig__l">
              {label}
              {figIn.secondary && (
                <Secondary className="sr-fig__hi" value={figIn.secondary} />
              )}
            </div>
            <div className="sr-fig__v">{value ?? '—'}</div>
            <div className="sr-fig__s">{sub}</div>
          </div>
          );
        })}
      </div>

      {plan > 0 && (
        <div className="sr-usage">
          <div className="hb-meter" role="img" aria-label={`${orgUsed} of ${plan} organisation credits used this month`}>
            <span className="hb-meter__f" style={{ '--pct': `${Math.min(100, (orgUsed / plan) * 100)}%` }} />
          </div>
          <p className="hb-cap">
            Resets at the start of next month. Unused plan credits do not carry over.
          </p>
        </div>
      )}

      <section className="hb-card">
        <h3 className="hb-card__t">
          What each action spends
          <Secondary className="hb-card__hi" value="व्यय" />
        </h3>
        {Object.keys(costs).length === 0 ? (
          <p className="hb-cap">The cost table was not included in this response.</p>
        ) : (
          <div className="hb-tags sr-costs">
            {Object.entries(costs).map(([k, v]) => (
              <span className="hb-tag sr-cost" key={k}>
                {AGENT_LABELS[k] || k.replace(/_/g, ' ')}
                <b className="hb-mono">{v} cr</b>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="hb-card hb-card--flush">
        <h3 className="hb-card__t hb-card__t--inset">
          Recent transactions
          <Secondary className="hb-card__hi" value="इतिहास" />
        </h3>
        {txns.length === 0 ? (
          /* Reachable only on a SUCCESSFUL response — the failure path returned
             above. That is what makes this sentence safe to write. */
          <p className="hb-none">
            Nothing has moved through the org wallet yet. Generating content or running a skill
            pack records a debit here.
          </p>
        ) : (
          <div className="hb-scroll">
            <DataTable columns={['When', 'Description', { label: 'Amount', align: 'right' }, { label: 'Balance after', align: 'right' }]}>
              {txns.map(tx => (
                <tr key={tx.id}>
                  <Td mono>{stamp(tx.created_at)}</Td>
                  <Td>{tx.description || '—'}</Td>
                  <Td align="right" mono bold color={tx.amount > 0 ? 'var(--ok)' : 'var(--danger)'}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount}
                  </Td>
                  <Td align="right" mono>{tx.balance_after}</Td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </section>
    </div>
  );
}
