import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import {
  Button, ConfirmDialog, ErrorState, errorKind, Tag, useToast,
  Table, TableHead, TableBody, Row, Cell, HeadCell,
} from '../../components/ui';
import { inr } from '../../lib/inr';
import BillingLineRow, {
  blankLine, lineBase, lineReady, monthLabel, refusalMessage,
} from './BillingLineRow';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from '../../components/ui/CustomizeColumns';

/**
 * The ledger of what this organisation is billed, declared once.
 *
 * `fixed` on Kind: it is what a line IS, and every other cell is a number or a
 * date that means nothing detached from it. There is no actions column — a line
 * is edited through the forms above the table, not from the row — so Kind is
 * the single pin.
 *
 * `Source` ships hidden. It answers "where did this line come from" and reads
 * "—" on the great majority of rows, which is a column of dashes in front of an
 * operator checking money. It is one tick away for the day somebody needs it,
 * and `defaultHidden` is the page deciding out loud rather than nobody
 * deciding — see the reconcile contract in useColumnPrefs.
 */
const BILLING_LINE_COLUMNS = [
  { id: 'kind', label: 'Kind', fixed: true },
  { id: 'description', label: 'Description' },
  { id: 'amount', label: 'Amount', num: true },
  { id: 'cadence', label: 'Cadence' },
  { id: 'from', label: 'From' },
  { id: 'until', label: 'Until' },
  { id: 'source', label: 'Source', defaultHidden: true },
];

/**
 * BillingLinesBlock — what an org is billed, as rows instead of as a number
 * typed into a form (BUILD SPEC §4.3).
 *
 * `staging.org_billing_lines` is authoritative. `organisations.monthly_price`
 * survives as a denormalised mirror of the single open `platform` line, because
 * four endpoints select it and three screens render it, and
 * `v_org_platform_line_drift` must always return zero rows.
 *
 * That contract decides how the platform fee is saved here, and it is the one
 * decision in this file worth reading twice:
 *
 *   · The AMOUNT goes through `PATCH /v1/admin/orgs/{id}/settings`, which writes
 *     `monthly_price` and the platform line in ONE transaction. Writing the line
 *     directly would leave the scalar behind, and the drift view would stop
 *     being empty — which is the whole reason it exists.
 *   · The DESCRIPTION goes through `PATCH /billing/orgs/{id}/lines/{line_id}`,
 *     because no second copy of it exists and nothing can drift.
 *   · When both changed, the money goes first. A stale label is recoverable by
 *     saving again; a price that moved on one side only is a wrong invoice.
 *
 * Nothing here names a credit table. Top-ups are `TopUpDialog`, which calls the
 * one top-up endpoint that already exists.
 */

/**
 * `YYYY-MM` for the month this console is acting on — UTC, because
 * `credits.current_period()` is UTC and this string becomes a `period_start`.
 *
 * Read locally it is wrong for five and a half hours every month: at 00:30 IST
 * on the 1st the server is still in the previous period, so a support line
 * saved here would be stamped with a month that has not begun and would not be
 * billed until it did. A billing period cannot depend on where the operator is
 * sitting.
 */
function currentPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The four rows, in the order the owner listed them. `setup` is the one-off. */
const ROWS = [
  {
    kind: 'platform', label: 'Platform fee', sanskrit: 'मंच शुल्क', cadence: 'monthly',
    showToggle: false,
    hint: 'Always billed, one amount, no toggle. Saving this also writes the organisation’s '
        + 'monthly price — the two are one transaction, so they cannot disagree. ₹0 means no '
        + 'platform line is raised.',
  },
  {
    kind: 'support', label: 'Support plan', sanskrit: 'सहायता', cadence: 'monthly',
    hint: 'Recurs every month until it is ended. Ending it never deletes the row — an already '
        + 'issued invoice must keep saying what it was for.',
  },
  {
    kind: 'setup', label: 'Integration setup', sanskrit: 'संयोजन', cadence: 'one_off',
    hint: 'Charged once, in this month only. A one-off is never “open”, so this row opens blank '
        + 'every time and adding a second one bills both.',
  },
  {
    kind: 'ongoing', label: 'Ongoing support', sanskrit: 'निरंतर सहायता', cadence: 'monthly',
    hint: 'A second recurring line, separate from the support plan, for work agreed after the '
        + 'contract started.',
  },
];

const KIND_LABEL = {
  platform: 'Platform fee', support: 'Support plan', setup: 'Integration setup',
  ongoing: 'Ongoing support', topup: 'Credit top-up',
};

/** The open (still-recurring) line of a kind. One by index for `platform`. */
const openLineOf = (lines, kind) =>
  lines.find(l => l.kind === kind && l.cadence === 'monthly' && !l.period_end) || null;

/* A DATE column reaches the client as `2026-08-01`, but a driver or a
   serialiser that hands back a timestamp would break an `===` against
   `${period}-01` silently — and silently would mean a duplicate one-off line.
   Compared on the month, which is the grain every one of these dates has. */
const monthOf = d => String(d || '').slice(0, 7);
const dayOf = d => String(d || '').slice(0, 10);

/** Where a line came from, when it was not typed into this block. */
function sourceOf(line) {
  const ref = line.source_ref || '';
  if (ref.startsWith('credit_tx:')) {
    return `from top-up on ${monthLabel(line.created_at || line.period_start)}`;
  }
  if (ref.startsWith('marketplace_request:')) return 'from a marketplace request';
  return '—';
}

export default function BillingLinesBlock(props) {
  // Declared on its own line for scripts/check-write-gates.mjs — see BillingLineRow.
  const { canWrite, reason } = props;
  const { orgId, monthlyPrice, onChanged } = props;

  const { pushToast } = useToast();
  const [period] = useState(currentPeriod);
  const [lines, setLines] = useState(null);
  const [totals, setTotals] = useState({ monthly: null, one_off: null });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [form, setForm] = useState(() => Object.fromEntries(ROWS.map(r => [r.kind, blankLine()])));

  const load = useCallback(async () => {
    const res = await api.get(`/v1/billing/orgs/${orgId}/lines`, { params: { period } });
    const rows = res.data?.data || [];
    setLines(rows);
    setTotals({ monthly: res.data?.monthly_total ?? null, one_off: res.data?.one_off_total ?? null });
    setErr(null);
    return rows;
  }, [orgId, period]);

  /* The form is re-seeded from the server on every load. A monthly row shows
     the line the org is actually being charged; the one-off row is always
     blank, because a one_off has `period_end = period_start` by CHECK and is
     therefore never open — there is nothing for it to reflect. */
  const seed = useCallback((rows) => {
    setForm(Object.fromEntries(ROWS.map(r => [
      r.kind,
      r.cadence === 'one_off'
        ? blankLine()
        : lineBase(openLineOf(rows, r.kind), r.showToggle !== false),
    ])));
  }, []);

  useEffect(() => {
    let live = true;
    load()
      .then(rows => { if (live) seed(rows); })
      .catch(e => { if (live) setErr(e); });
    return () => { live = false; };
  }, [load, seed]);

  const refresh = async () => { const rows = await load(); seed(rows); onChanged?.(); };

  const act = async (tag, fn) => {
    setBusy(tag);
    try {
      await fn();
      await refresh();
    } catch (e) {
      // Rendered verbatim. A 409 from an already-invoiced line says which
      // invoice; parsing that sentence for the number is how it goes stale.
      pushToast({ type: 'error', title: refusalMessage(e, 'Could not save this billing line') });
    } finally { setBusy(''); }
  };

  const setRow = (kind, next) => setForm(f => ({ ...f, [kind]: next }));

  /* Unticking a monthly row ENDS the line — it never deletes it, and it names
     the month the charge stops before it happens. */
  const toggle = (row, next) => {
    const existing = row.cadence === 'monthly' ? openLineOf(lines || [], row.kind) : null;
    if (!next && existing) {
      setConfirm({
        title: `Stop billing ${row.label.toLowerCase()}?`,
        message: `${existing.description} — ${inr(existing.amount ?? 0)}/month. It is billed `
               + `through ${monthLabel(`${period}-01`)} and not after. The line is kept, not `
               + `deleted: an invoice already issued must keep saying what it was for.`,
        confirmLabel: 'Stop it',
        intent: 'warn',
        onConfirm: () => act(row.kind, () => api.post(`/v1/billing/orgs/${orgId}/lines/${existing.id}/end`)),
      });
      return;
    }
    // Unticked means inert AND empty: a description left behind from a line
    // nobody saved is a number waiting to be agreed to by accident.
    setRow(row.kind, next ? { ...form[row.kind], enabled: true } : blankLine());
  };

  const save = (row) => {
    const v = form[row.kind];
    if (!lineReady(v)) return;
    const existing = row.cadence === 'monthly' ? openLineOf(lines || [], row.kind) : null;

    if (row.kind === 'platform') {
      act('platform', async () => {
        const amount = Number(v.amount);
        // Money first — see the docblock. `PATCH /settings` is the only write
        // that keeps `monthly_price` and the platform line in step.
        if (!existing || Number(existing.amount) !== amount) {
          await api.patch(`/v1/admin/orgs/${orgId}/settings`, { monthly_price: amount });
        }
        const rows = await load();
        const line = openLineOf(rows, 'platform');
        const wanted = v.description.trim();
        if (line && wanted && line.description !== wanted) {
          await api.patch(`/v1/billing/orgs/${orgId}/lines/${line.id}`, { description: wanted });
        }
      });
      return;
    }

    const body = { description: v.description.trim(), amount: Number(v.amount) };

    if (existing) {
      act(row.kind, () => api.patch(`/v1/billing/orgs/${orgId}/lines/${existing.id}`, body));
      return;
    }

    const post = () => act(row.kind, () => api.post(`/v1/billing/orgs/${orgId}/lines`, {
      ...body, kind: row.kind, cadence: row.cadence, period_start: `${period}-01`,
    }));

    /* A one-off has no unique index to stop a second one, so a duplicate is
       caught here rather than at the invoice. The operator may genuinely want
       two setup fees in a month; they may not want them by accident. */
    const sameMonth = (lines || []).filter(
      l => l.kind === row.kind && l.cadence === 'one_off' && monthOf(l.period_start) === period,
    );
    if (sameMonth.length) {
      setConfirm({
        title: `Add a second ${row.label.toLowerCase()} line?`,
        message: `${monthLabel(`${period}-01`)} already carries ${sameMonth.length} `
               + `${row.label.toLowerCase()} line${sameMonth.length === 1 ? '' : 's'}: `
               + `${sameMonth.map(l => `${l.description} (${inr(l.amount ?? 0)})`).join(', ')}. `
               + `Adding this one bills them all on the same invoice.`,
        confirmLabel: 'Add it anyway',
        intent: 'warn',
        onConfirm: post,
      });
      return;
    }
    post();
  };

  /* A one-off row binds to nothing, so it cannot derive its own summary — and a
     setup row reading "Not billed" in a month that already carries a setup fee
     is the row telling the operator to charge it twice. */
  const stateOf = (row) => {
    if (row.cadence !== 'one_off') return undefined;
    const same = (lines || []).filter(
      l => l.kind === row.kind && l.cadence === 'one_off' && monthOf(l.period_start) === period,
    );
    if (!same.length) return 'Nothing this month';
    const sum = same.reduce((s, l) => s + Number(l.amount || 0), 0);
    return `${inr(sum)} already this month · ${same.length} line${same.length === 1 ? '' : 's'}`;
  };

  const ordered = useMemo(
    () => [...(lines || [])].sort((a, b) => String(b.period_start).localeCompare(String(a.period_start))),
    [lines],
  );

  if (err) {
    return (
      <section className="apg__sec">
        <div className="apg__sech"><h3 className="apg__sect">Billing lines</h3></div>
        {/* `refresh` rejects when the retry fails too; swallowed here so the
            retry button reports through the same ErrorState rather than as an
            unhandled rejection in the console. */}
        <ErrorState
          kind={errorKind(err)}
          grant="billing access to this organisation"
          onRetry={() => { refresh().catch(setErr); }}
        />
      </section>
    );
  }

  const periodStart = `${period}-01`;
  const ended = l => Boolean(l.period_end) && dayOf(l.period_end) < periodStart;

  /* ── The mirror check, and the one thing it must never be compared against ──
   *
   * `monthly_price` mirrors ONE row: the OPEN `platform` line. Support plan and
   * ongoing support are recurring revenue the scalar has never held and cannot
   * be measured against. 096 §5 defines drift in exactly two terms —
   *
   *     COALESCE(o.monthly_price, 0) <> COALESCE(l.amount, 0)
   *          -- l = the org's platform line WHERE period_end IS NULL
   *
   * — and this is that predicate in JSX, so this screen and
   * `v_org_platform_line_drift` can never report different things about the same
   * organisation.
   *
   * Measured against the period's recurring TOTAL instead, it was wrong in both
   * directions and quietly so: one support plan priced above the platform fee
   * makes the total the larger number for good, so a genuine drift can never
   * again show up as "scalar exceeds lines" and the warning goes permanently
   * silent on exactly the org it exists for; one priced below fires it while the
   * two halves of the mirror agree to the paisa. Neither is a display bug — the
   * first hides a wrong invoice and the second teaches the operator to ignore
   * the banner that would have named one.
   *
   * Compared in paise, not rupees. Both sides are NUMERIC(_,2) arriving as
   * float64 (`billing_lines._row_to_line` explains why the edge is a float), and
   * a `!==` between two floats that are the same money is a warning nobody can
   * ever clear.
   *
   * Silent when `monthlyPrice` is absent from the payload: the scalar is
   * unknown, not zero, and accusing an org of drift on a field we were not sent
   * is the same wolf in a different coat.
   */
  const cols = useColumnPrefs('admin.org_billing_lines', BILLING_LINE_COLUMNS);

  const paise = v => Math.round(Number(v || 0) * 100);
  const platformLine = lines ? openLineOf(lines, 'platform') : null;
  const drift = monthlyPrice !== null && monthlyPrice !== undefined
    && lines !== null
    && paise(monthlyPrice) !== paise(platformLine?.amount);

  return (
    <>
      <section className="apg__sec">
        <div className="apg__sech">
          <h3 className="apg__sect">Billing lines</h3>
          <span className="apg__secn">{monthLabel(periodStart)}</span>
          <ColumnsButton cols={cols} />
        </div>

        {!canWrite && (
          <p className="obl__note">
            Read-only. Changing what an organisation is billed needs platform owner,
            platform manager or account/finance access. {reason || ''}
          </p>
        )}

        {lines === null ? (
          <p className="apg__secn">Loading billing lines…</p>
        ) : (
          <>
            {ROWS.map(row => (
              <BillingLineRow
                key={row.kind}
                kind={row.kind}
                label={row.label}
                sanskrit={row.sanskrit}
                hint={row.hint}
                cadence={row.cadence}
                showToggle={row.showToggle !== false}
                state={stateOf(row)}
                value={form[row.kind]}
                existing={row.cadence === 'monthly' ? openLineOf(lines, row.kind) : null}
                busy={busy === row.kind}
                canWrite={canWrite}
                reason={reason}
                onChange={next => (next.enabled === form[row.kind].enabled
                  ? setRow(row.kind, next)
                  : toggle(row, next.enabled))}
                onSave={() => save(row)}
                onRevert={() => setRow(
                  row.kind,
                  row.cadence === 'one_off'
                    ? blankLine()
                    : lineBase(openLineOf(lines, row.kind), row.showToggle !== false),
                )}
              />
            ))}

            {/* Line 4 is deliberately absent from this block. A top-up line is a
                fact about a payment that has already happened, so it is created
                by the top-up dialog at the moment the credits are added — never
                typed, and never configured in advance. */}
            <p className="obl__note">
              Credit top-ups are not configured here. Tick “add to the next invoice” in the
              top-up dialog and the line is created in the same transaction as the credits.
            </p>

            <div className="obl__foot">
              {ordered.length === 0 ? (
                <p className="apg__secn">No billing lines yet. The platform fee above raises the first one.</p>
              ) : (
                <Table>
                  <TableHead>
                    {cols.columns.map(c => (
                      <HeadCell
                        key={c.id}
                        num={c.num}
                        width={c.width}
                        onResize={w => cols.setWidth(c.id, w)}
                      >
                        {c.label}
                      </HeadCell>
                    ))}
                  </TableHead>
                  <TableBody>
                    {ordered.map(l => (
                      <Row key={l.id} className={ended(l) ? 'obl__done' : undefined}>
                        {cols.cells({
                          kind: <Cell>{KIND_LABEL[l.kind] || l.kind}</Cell>,
                          description: <Cell>{l.description}</Cell>,
                          amount: <Cell num>{inr(l.amount ?? 0)}</Cell>,
                          cadence: <Cell>{l.cadence === 'monthly' ? 'Monthly' : 'One-off'}</Cell>,
                          from: <Cell>{monthLabel(l.period_start)}</Cell>,
                          until: (
                            <Cell>
                              {l.period_end
                                ? <Tag color="var(--on-surface-3)">{monthLabel(l.period_end)}</Tag>
                                : 'Open'}
                            </Cell>
                          ),
                          source: <Cell><span className="obl__src">{sourceOf(l)}</span></Cell>,
                        })}
                      </Row>
                    ))}
                  </TableBody>
                </Table>
              )}

              {/* The totals are the server's, not a sum computed here: which
                  lines are due in a period is a query the API already answers,
                  and re-deriving it on the client is how the two disagree. */}
              {(totals.monthly !== null || totals.one_off !== null) && (
                <p className="obl__note">
                  {inr(totals.monthly ?? 0)}/month recurring · {inr(totals.one_off ?? 0)} one-off
                  this period. Ended lines stay listed, greyed.
                </p>
              )}
              {drift && (
                <p className="inb__note" role="status">
                  Stored monthly price {inr(monthlyPrice)} · open platform line{' '}
                  {platformLine ? inr(platformLine.amount ?? 0) : 'none'}. Those two are one
                  number kept in two places and they must always agree. The line is what this
                  organisation is charged; the scalar is a mirror of that ONE line and of nothing
                  else — the support and ongoing-support lines above are separate charges and
                  never touch it. Save the platform fee to write both in one transaction.
                </p>
              )}
            </div>
          </>
        )}
      </section>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
