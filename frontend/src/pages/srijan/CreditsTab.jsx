// Srijan → Credits. The org pool, your slice of it, and the ledger.
//
// NOTE ON FIGURES: credits only. What a credit costs in rupees is our price and
// does not belong on a tenant surface — the backend already stopped serving
// `price_per_credit_inr` for this reason.
import React from 'react';
import { DataTable, Td } from '../../components/editorial';
import { ErrorNote, Shim } from '../hub/_shared';
import { AGENT_LABELS, stamp } from './_shared';

export default function CreditsTab({ credits, loading, error, onRetry }) {
  if (loading) return <Shim count={4} />;
  if (error) return <ErrorNote what="Your credit balance" error={error} onRetry={onRetry} />;

  const org = credits?.org_balance || {};
  const you = credits?.user_allocation || {};
  const plan = org.plan_credits ?? 0;
  const orgUsed = org.used ?? 0;
  const orgLeft = plan > 0 ? Math.max(0, plan - orgUsed) : (org.balance ?? null);
  const yourLeft = (you.allocated ?? 0) - (you.used ?? 0);
  const txns = credits?.recent_transactions || [];
  const costs = credits?.credit_costs || {};

  return (
    <div className="sr-credits">
      <div className="sr-figs">
        {[
          ['Organisation balance', 'संस्था', orgLeft, plan > 0 ? `${orgUsed} of ${plan} used this month` : 'no plan allocation set'],
          ['Your allocation', 'आवंटन', you.allocated ?? 0, 'set by an org admin'],
          ['You have used', 'प्रयोग', you.used ?? 0, 'this month'],
          ['You have left', 'शेष', yourLeft, yourLeft <= 0 ? 'ask an admin to raise your allocation' : 'available to spend'],
        ].map(([label, hi, value, sub]) => (
          <div className="sr-fig" key={label}>
            <div className="sr-fig__l">
              {label}
              <span className="sr-fig__hi" lang="hi" aria-hidden="true">{hi}</span>
            </div>
            <div className="sr-fig__v">{value ?? '—'}</div>
            <div className="sr-fig__s">{sub}</div>
          </div>
        ))}
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
          <span className="hb-card__hi" lang="hi">व्यय</span>
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
          <span className="hb-card__hi" lang="hi">इतिहास</span>
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
