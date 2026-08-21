import React from 'react';
import {
  Button, Cell, EmptyState, HeadCell, Row, Table, TableBody, TableHead, Tag,
} from '../../components/ui';
import { grouped } from '../../lib/inr';
import { CreditFigure } from './UsageBySource';

/**
 * SpendByPerson — who in this organisation spent the credits, and what ceiling
 * they are spending against.
 *
 * The owner's requirement is one sentence: "money is money and needs to be
 * metered, capped and visibility." This table is the visibility half and the
 * capped half in the same rows, because an admin who has just seen that one
 * person burned 60% of the month's allowance should not have to go and find a
 * different screen to do anything about it.
 *
 * Three things this table refuses to do:
 *
 *  · It does not fold a system spend into a person. A row with no `user_id` is a
 *    scheduled job, a webhook or a pre-095 ledger row, and attributing it to
 *    whoever happens to sort first would be a lie with someone's name on it. It
 *    gets its own row, labelled, and sorts last.
 *  · It does not present a ceiling as an allocation. A ceiling is a LIMIT on the
 *    shared org balance and nothing is debited from a member, which is why the
 *    ceilings can sum to more than the balance and why that is legitimate rather
 *    than a bug. The commitment line above says so in the org's own numbers.
 *  · It does not render "spent nothing" and "spent zero-priced work" the same —
 *    see `CreditFigure`.
 */

/** A ledger row with no user. Sorted last, never merged into a person. */
const SYSTEM_ROW_NAME = 'System / unattributed';

function personName(p) {
  if (!p.user_id) return SYSTEM_ROW_NAME;
  // NEVER the user_id. A UUID in a person column is the thing
  // `check-rendered-ids` exists to stop, and it reads as a corrupt row rather
  // than as a missing name. A member with neither name nor address on file is a
  // real state — say so in words.
  return p.name || p.email || 'Name not recorded';
}

/**
 * Credits descending, with the unattributed row pinned to the bottom. Sorting it
 * by size would put "System" above real people on a quiet month, which reads as
 * an accusation of the wrong party.
 */
function ordered(people) {
  return [...(people || [])].sort((a, b) => {
    if (!a.user_id !== !b.user_id) return a.user_id ? -1 : 1;
    return (Number(b.credits) || 0) - (Number(a.credits) || 0);
  });
}

function share(credits, total) {
  const t = Number(total) || 0;
  if (t <= 0) return null;
  return Math.round(((Number(credits) || 0) / t) * 100);
}

function CeilingCell({ cap }) {
  if (!cap || cap.cap === null || cap.cap === undefined) {
    return <span className="bl__none" aria-label="no ceiling set">—</span>;
  }
  if (Number(cap.cap) === 0) {
    return <Tag color="var(--danger)">Blocked</Tag>;
  }
  const pct = Math.min(100, Math.round(((Number(cap.spent) || 0) / Number(cap.cap)) * 100));
  return (
    <span className="bl__cap">
      <span className="bl__cap-n">{grouped(cap.spent || 0)} / {grouped(cap.cap)}</span>
      {/* `--pct` is the one genuinely per-row value, so it arrives as a custom
          property and the stylesheet owns the width. */}
      <span className="bl__mtr" role="progressbar" aria-valuenow={pct} aria-valuemin={0}
        aria-valuemax={100} aria-label="Ceiling used">
        <span className={`bl__mtr-f${pct >= 100 ? ' over' : ''}`} style={{ '--pct': `${pct}%` }} />
      </span>
    </span>
  );
}

export default function SpendByPerson({
  people, total, caps, commitment, isPlatformOrg, platformView,
  selected, onSelect, onDrill, onSetCeiling, maySetCeiling, scopeLabel,
}) {
  const rows = ordered(people);
  const capOf = uid => (uid ? caps?.[uid] : null);

  const capped = commitment?.capped_members ?? 0;
  const uncapped = commitment?.uncapped_members ?? 0;
  const over = Number(commitment?.over_committed_by) || 0;

  return (
    <div className="bl__people">
      {commitment && (
        <p className="bl__note">
          {capped} of {capped + uncapped} people have a ceiling. Ceilings total{' '}
          {grouped(commitment.sum_of_caps || 0)} credits against a balance of{' '}
          {isPlatformOrg ? 'unlimited' : grouped(commitment.org_total || 0)}.
          {isPlatformOrg && ' Balance is unlimited here; ceilings still bind.'}
        </p>
      )}
      {over > 0 && (
        <p className="bl__note bl__note--warn">
          <Tag color="var(--warn)">Over-committed</Tag>
          Ceilings exceed the balance by {grouped(over)} credits — they are limits, not reservations.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={{ en: 'Nobody spent anything here', hi: 'कोई व्यय नहीं' }}
          description={scopeLabel
            ? `No credits were charged against ${scopeLabel} in this period.`
            : 'No credits were charged in this period.'}
        />
      ) : (
        <Table className="bl__tbl">
          <TableHead>
            <HeadCell>Person</HeadCell>
            <HeadCell num>Credits</HeadCell>
            <HeadCell num>Share of period</HeadCell>
            <HeadCell>Ceiling</HeadCell>
            <HeadCell num>Transactions</HeadCell>
            {maySetCeiling && <HeadCell><span className="k-sr-only">Set ceiling</span></HeadCell>}
          </TableHead>
          <TableBody>
            {rows.map(p => {
              const pct = share(p.credits, total);
              const cap = capOf(p.user_id);
              const on = selected && selected === p.user_id;
              return (
                <Row key={p.user_id || 'system'} on={on}>
                  <Cell>
                    {p.user_id ? (
                      <button
                        type="button"
                        className="bl__lnk"
                        aria-pressed={on}
                        onClick={() => onSelect?.(on ? null : p.user_id)}
                      >
                        <span className="bl__ph-n">{personName(p)}</span>
                        {/* Suppressed on the Aekam console. A customer's
                            member addresses are the customer's, and this
                            table's job — who spent the credits — is answered
                            by the name. See `platformView`. */}
                        {!platformView && p.email && <span className="bl__ph-e">{p.email}</span>}
                      </button>
                    ) : (
                      <span className="bl__ph">
                        <span className="bl__ph-n">{SYSTEM_ROW_NAME}</span>
                        <span className="bl__ph-e">Scheduled work and rows with no user recorded</span>
                      </span>
                    )}
                  </Cell>
                  <Cell num>
                    {p.user_id ? (
                      <button
                        type="button"
                        className="bl__lnk bl__lnk--fig"
                        onClick={() => onDrill?.(p.user_id, personName(p))}
                      >
                        <CreditFigure credits={p.credits} txCount={p.tx_count} />
                      </button>
                    ) : (
                      /* No drill-down: the transactions endpoint filters by
                         user_id, and "no user" is not a value it can be given. */
                      <CreditFigure credits={p.credits} txCount={p.tx_count} />
                    )}
                  </Cell>
                  <Cell num>{pct === null ? '—' : `${pct}%`}</Cell>
                  <Cell><CeilingCell cap={cap} /></Cell>
                  <Cell num>{grouped(p.tx_count || 0)}</Cell>
                  {maySetCeiling && (
                    <Cell>
                      {p.user_id && (
                        <Button size="sm" variant="out" onClick={() => onSetCeiling?.(p, cap)}>
                          Set ceiling
                        </Button>
                      )}
                    </Cell>
                  )}
                </Row>
              );
            })}
          </TableBody>
        </Table>
      )}

      {isPlatformOrg && (
        <p className="bl__note">
          Recorded, not deducted — this organisation’s wallet is unlimited. Every figure
          above is what it would have paid.
        </p>
      )}
    </div>
  );
}
