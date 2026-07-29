// Hub → Credits. The wallet, the top-up, and the ledger that explains it.
//
// The ledger is the reason this tab needs its three states kept apart more than
// any other in the module. `catch {}` followed by `transactions.length === 0`
// printed "No transactions yet." over a wallet that had been spending all month
// — a false statement about the account, on the one surface someone opens
// specifically to reconcile a balance.
//
// NOTE ON FIGURES: credits only. What a credit costs in rupees is our price and
// does not belong on a tenant surface.
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { DataTable, Td } from '../../components/editorial';
import { Resource, StatusPill, TX_TONE, useResource, creditLabel, errText, stamp, words } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';

export default function CreditsTab({ clientId, wallet, onRefresh }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change Srijan content' });
  const { pushToast } = useToast();
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const ledger = useResource(clientId ? `/v1/hub/clients/${clientId}/credits` : null, [clientId]);
  const txns = ledger.error || ledger.data == null ? null : (ledger.data.recent_transactions || []);

  const balance = wallet?.balance;
  const allocation = wallet?.monthly_allocation;
  const used = allocation != null && balance != null ? Math.max(0, allocation - balance) : null;

  async function topup(e) {
    e.preventDefault();
    const n = parseInt(amount, 10);
    if (!Number.isFinite(n) || n < 1) {
      pushToast({ title: 'Enter a whole number of credits.', type: 'error' });
      return;
    }
    setBusy(true);
    try {
      await api.post(`/v1/hub/clients/${clientId}/credits/topup`, { amount: n, notes });
      pushToast({ title: `${creditLabel(n)} added`, type: 'success' });
      setAmount('');
      setNotes('');
      onRefresh?.();
      ledger.reload();
    } catch (err) {
      pushToast({ title: errText(err, 'Top-up failed.'), type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hb-credits">
      <div className="hb-two">
        <section className="hb-card">
          <h3 className="hb-card__t">
            Balance
            <span className="hb-card__hi" lang="hi">श्रेय</span>
          </h3>
          <div className="hb-fig">{balance ?? '—'}</div>
          <div className="hb-cap">
            {balance == null
              ? 'The wallet did not load.'
              : allocation
                ? <>of a {allocation} monthly allocation</>
                : 'no monthly allocation set'}
          </div>

          {/* The proportion bar is a second reading of a figure already printed,
              never the only carrier — 00 §12. It is omitted rather than drawn at
              zero when the allocation is unknown, because a full-width empty
              track reads as "nothing left". */}
          {allocation > 0 && balance != null && (
            <>
              <div className="hb-meter" role="img"
                aria-label={`${used} of ${allocation} credits used this month`}>
                <span className="hb-meter__f" style={{ '--pct': `${Math.min(100, (used / allocation) * 100)}%` }} />
              </div>
              <div className="hb-cap hb-meter__cap">{used} used this month</div>
            </>
          )}
        </section>

        <form className="hb-card hb-form" onSubmit={topup}>
          <h3 className="hb-card__t">
            Add credits
            <span className="hb-card__hi" lang="hi">वृद्धि</span>
          </h3>
          <label className="hb-field">
            <span className="hb-field__l">Credits to add</span>
            <input className="k-input" type="number" min="1" step="1" required inputMode="numeric"
              value={amount} onChange={e => setAmount(e.target.value)} />
          </label>
          <label className="hb-field">
            <span className="hb-field__l">Note</span>
            <input className="k-input" placeholder="Why this top-up happened"
              value={notes} onChange={e => setNotes(e.target.value)} />
          </label>
          <button type="submit" className="k-btn k-btn--primary hb-btn--block" disabled={busy || !canWrite} title={denial || undefined}>
            {busy ? 'Adding…' : 'Add credits'}
          </button>
          <p className="hb-cap hb-form__note">
            Recorded in the ledger below with your name against it.
          </p>
        </form>
      </div>

      <section className="hb-card hb-card--flush">
        <h3 className="hb-card__t hb-card__t--inset">
          Transaction history
          <span className="hb-card__hi" lang="hi">इतिहास</span>
        </h3>
        <Resource
          state={{ ...ledger, items: txns }}
          what="The credit ledger"
          empty={<p className="hb-none">
            Nothing has moved through this wallet yet. Generating content or running a
            skill pack will record a debit here.
          </p>}
        >
          <div className="hb-scroll">
            <DataTable columns={['Type', { label: 'Amount', align: 'right' }, { label: 'Balance after', align: 'right' }, 'Description', 'When']}>
              {txns?.map(tx => (
                <tr key={tx.id}>
                  <Td><StatusPill status={words(tx.tx_type)} tone={TX_TONE[tx.tx_type]} /></Td>
                  <Td align="right" mono bold color={tx.amount < 0 ? 'var(--danger)' : 'var(--ok)'}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount}
                  </Td>
                  <Td align="right" mono>{tx.balance_after}</Td>
                  <Td>{tx.description || '—'}</Td>
                  <Td mono>{stamp(tx.created_at)}</Td>
                </tr>
              ))}
            </DataTable>
          </div>
        </Resource>
      </section>
    </div>
  );
}
