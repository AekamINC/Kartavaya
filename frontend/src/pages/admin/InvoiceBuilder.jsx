import React from 'react';
import { Button, Field, Input, Tag } from '../../components/ui';
import { api } from '../../lib/api';
import { inr } from '../../lib/inr';
import { gstBreakdown, defaultTreatment, supplierStateKnown, TREATMENTS } from './gst';
import { monthLabel, refusalMessage } from './BillingLineRow';

/**
 * InvoiceBuilder — 11-platform-admin.md §1 "Invoice builder".
 *
 * Two defects from 11, both confirmed against the branch:
 *
 *  · "`line_items` is already an array; the form builds one."
 *    `subscription.py:37  line_items: list[dict]` — the API has supported
 *    multi-line invoices since it was written, and the form exposed a single
 *    description and a single amount. Fixed here: rows are added and removed,
 *    and the payload is the array the endpoint already expects.
 *
 *  · "GST is hardcoded to 18% flat… A single `gst` column cannot represent a
 *    compliant intra-state invoice."
 *    The rate is genuinely 18%; the BREAKDOWN is what is missing. The split is
 *    computed and printed here as CGST+SGST or IGST — never a generic "GST" —
 *    and `gst.js` documents exactly which part of that survives the round trip
 *    and which needs a migration on `staging.subscription_invoices`.
 *
 * Nothing here computes the total that is charged. The server does that, from
 * `line_items`, at `subscription.py:292`. This shows the operator what the
 * server is about to produce, which is why the subtotal is derived from the
 * same rows rather than typed.
 *
 * ── Loading the month's billing lines (BUILD SPEC §4.6) ──────────────────────
 *
 * An invoice is a QUERY over the lines due in a period, not a hand-typed total.
 * "Load lines" fills these rows from `GET /billing/orgs/{id}/invoice-preview`
 * and carries their ids through to `POST /admin/invoices` as `line_ids`, which
 * writes `invoice_billing_lines` in the same transaction — the table whose
 * unique index is the no-double-charge rule.
 *
 * It does NOT become the only way to raise one. Kartavaya's clients agree terms
 * verbally; an invoice must stay creatable standalone, never derived from an
 * order, and nothing may gate provisioning on one existing. So hand-typed rows
 * can be added beside loaded ones, a typed row is billed exactly once and here,
 * and an invoice with no `line_ids` at all is still a valid invoice.
 *
 * ── AN EDITED ROW MUST BOOK WHAT IT CHARGES: `line_id` ON THE ITEM ───────────
 *
 * Pressing Create writes the money down twice, and the two used to be able to
 * disagree:
 *
 *   · `subscription_invoices.line_items` — the frozen snapshot THE CLIENT READS
 *     and pays, built from the rows below, so it carries whatever was typed
 *     into them (with `qty` already folded into `amount`).
 *   · `staging.invoice_billing_lines.amount` — 096 §2, "denormalised from the
 *     line AT ISSUE TIME", written by `billing_lines.record_billed`, which used
 *     to copy `l.amount` and never saw this form at all.
 *
 * Edit a loaded row, or set its qty to 2, and the document said ₹18,000 while
 * the row that exists to prove what was charged said ₹9,000.
 *
 * `services/billing_lines.record_billed` settles it — THE INVOICE IS
 * AUTHORITATIVE, in its words: "`line_items` and `total_amount` are what the
 * client reads and pays; the line is a standing term that the invoice quotes."
 * So the rows stay editable and the join row follows the invoice, through a new
 * `amounts={line_id: amount}` argument. That module named the two edits that
 * close the gap, in files it does not own, and THIS IS THE FIRST OF THEM:
 * `line_items` entries that came from a line now carry their `line_id`, so
 * `create_invoice` can build `{item["line_id"]: item["amount"]}` from a single
 * list instead of trying to zip two of different lengths — a hand-typed row has
 * no line id, and pairing by position would book one row's edit against another
 * row's line. The second edit is `create_invoice` passing that mapping on; until
 * it does, `record_billed` falls back to the line's own amount, which is right
 * for every unedited row and wrong for an edited one.
 *
 * `line_ids` STAYS, unchanged and separate. It is the list of what this invoice
 * discharges, and it is not derivable from `line_items` for a handler that has
 * not been taught the new key yet.
 *
 * ── AND THE ROW SAYS WHEN IT HAS BEEN AMENDED ───────────────────────────────
 *
 * Editing the row changes THIS document and nothing else: the billing line keeps
 * its own amount and bills that again next month. An operator who discounts
 * August and expects September to follow has not been refused, they have been
 * misread, so an amended row says what the line still costs and where to change
 * it. `PATCH /billing/orgs/{id}/lines/{line_id}` is that place — except for a
 * PLATFORM line, whose amount that route refuses because it mirrors
 * `organisations.monthly_price`; only `PATCH /admin/orgs/{id}/settings` writes
 * both in one transaction.
 */

/** `line_amount` is the billing line's OWN amount as loaded, kept beside the
 *  editable one so the row can tell the operator when the two have parted. It is
 *  local to this form and never sent: what the invoice charges is
 *  `line_items[].amount`, and that is now the figure booked against the line. */
const blank = () => ({ description: '', qty: '1', amount: '', line_id: null, line_amount: null });

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Money compared as integers. Two rupee figures that are the same money can
 *  differ as float64, and a row that claims it was amended when it was not is
 *  the same wolf as a row that stays quiet when it was. */
const paise = v => Math.round(num(v) * 100);

export function lineTotal(row) {
  const q = row.qty === '' ? 1 : num(row.qty);
  return Math.round(num(row.amount) * q * 100) / 100;
}

/** `YYYY-MM` for today, UTC — the grain `credits.current_period()` uses, and the
 *  grain a billing line's `period_start` is stored at. Read locally, an operator
 *  in IST opening this at 00:30 on the 1st would be offered next month's lines
 *  while the server still considers the previous month open. */
function thisMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The last day of `YYYY-MM`, as `YYYY-MM-DD`. */
function monthEnd(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export default function InvoiceBuilder({ org, busy, onCreate }) {
  const [period, setPeriod] = React.useState({ start: '', end: '', due: '' });
  const [rows, setRows] = React.useState([blank()]);
  const [treatment, setTreatment] = React.useState(() => defaultTreatment(org?.gstin));
  const [month, setMonth] = React.useState(thisMonth);
  const [loading, setLoading] = React.useState(false);
  const [loadErr, setLoadErr] = React.useState('');
  const [billed, setBilled] = React.useState([]);

  // A new org means a new tax treatment. Without this the operator's last
  // choice silently carries onto the next company they bill.
  React.useEffect(() => { setTreatment(defaultTreatment(org?.gstin)); }, [org?.id, org?.gstin]);

  // …and a new org means somebody else's lines. Clearing is not politeness, it
  // is the difference between two invoices and one wrong one.
  React.useEffect(() => { setBilled([]); setLoadErr(''); }, [org?.id]);

  const loadLines = async () => {
    if (!org?.id) return;
    setLoading(true);
    setLoadErr('');
    try {
      const res = await api.get(`/v1/billing/orgs/${org.id}/invoice-preview`, { params: { period: month } });
      const due = res.data?.lines || [];
      setBilled(res.data?.already_billed || []);
      setRows(due.length
        ? due.map(l => ({
          description: l.description || '', qty: '1',
          amount: String(l.amount ?? ''), line_id: l.line_id,
          line_amount: Number(l.amount ?? 0), line_cadence: l.cadence,
        }))
        : [blank()]);
      // The period the lines are due in, so the operator is not typing a date
      // the lines already state. The DUE date stays theirs — it is a payment
      // term, not a fact about the month.
      setPeriod(p => ({ ...p, start: `${month}-01`, end: monthEnd(month) }));
    } catch (e) {
      setLoadErr(refusalMessage(e, 'Could not load this month’s billing lines.'));
    } finally { setLoading(false); }
  };

  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows(rs => [...rs, blank()]);
  const dropRow = i => setRows(rs => (rs.length === 1 ? rs : rs.filter((_, j) => j !== i)));

  const subtotal = rows.reduce((s, r) => s + lineTotal(r), 0);
  const bd = gstBreakdown(subtotal, treatment);

  const hint = !supplierStateKnown()
    ? 'Supplier state is not configured (VITE_AEKAM_STATE_CODE), so this cannot be derived — choose it.'
    : !org?.gstin
      ? 'This organisation has no GSTIN in the console payload, so the place of supply cannot be derived — choose it.'
      : 'Derived from the customer GSTIN against the supplier state. Override if the place of supply differs.';

  /** A row somebody typed and finished: a description and money on it. */
  const payable = r => Boolean(r.description.trim()) && num(r.amount) > 0;

  /* At least one row worth sending. Deliberately NOT satisfied by loaded rows
     alone summing to zero: a ₹0 line rides along on an invoice, but it is not a
     reason to raise one. */
  const ready = Boolean(
    org?.id && period.start && period.end && period.due && rows.some(payable),
  );

  const submit = () => {
    if (!ready) return;
    /* A loaded row needs a description, not an amount. ₹0 is a legal line
       amount — `org_billing_lines` only requires `amount >= 0` — and dropping
       such a row on `amount > 0` would leave it off `line_items` AND off
       `line_ids`, so it would stay due for this period for ever: offered by
       every preview, dischargeable by nothing. A typed ₹0 row is an unfinished
       row and is still dropped. */
    const kept = rows.filter(r => (r.line_id ? Boolean(r.description.trim()) : payable(r)));
    // Only the rows still standing when Create was pressed. A line the operator
    // deleted from the form must not be marked billed by `invoice_billing_lines`
    // — that would silently forgive it for the rest of the period.
    const lineIds = kept.map(r => r.line_id).filter(Boolean);
    onCreate?.({
      period_start: period.start,
      period_end: period.end,
      due_date: period.due,
      // qty is folded into `amount` because the column the server sums is
      // `item.amount`. Sending a qty it does not read would show a line total
      // on screen that the invoice does not agree with.
      line_items: kept.map(r => ({
        description: r.description.trim(),
        amount: lineTotal(r),
        qty: r.qty === '' ? 1 : num(r.qty),
        unit_amount: num(r.amount),
        // Only on the entries that came from a line. `create_invoice` builds
        // `record_billed(amounts={item["line_id"]: item["amount"]})` from this,
        // so the join row records what this document charged rather than what
        // the line happens to say today — the amount and its line id travel as
        // one object because two parallel lists of different lengths cannot be
        // paired without guessing. Absent on a typed row, which discharges
        // nothing and has nothing to be paired with.
        ...(r.line_id ? { line_id: r.line_id } : {}),
      })),
      // Absent, not empty, when nothing was loaded: `[]` and "no lines" are the
      // same thing to this endpoint, and sending the key on a hand-typed invoice
      // says the operator meant to bill lines and found none.
      ...(lineIds.length ? { line_ids: lineIds } : {}),
      // Display-only, for the caller's log. `gst.js` explains why it does not
      // reach the database.
      gst_treatment: treatment,
    });
    setRows([blank()]);
    setPeriod({ start: '', end: '', due: '' });
    setBilled([]);
  };

  return (
    <div className="inb">
      {/* The lines-first path, offered before the empty rows so the operator
          reaches for the query rather than for the keyboard. */}
      <div className="inb__load">
        <Field label="Bill the lines due in" htmlFor="inb-month">
          {p => (
            <Input
              {...p} type="month" value={month}
              onChange={e => setMonth(e.target.value)}
            />
          )}
        </Field>
        <Button
          variant="out" size="sm"
          disabled={!org?.id || !month || loading}
          onClick={loadLines}
        >
          {loading ? 'Loading…' : `Load lines for ${monthLabel(`${month}-01`)}`}
        </Button>
        <span className="apg__secn">
          Or type the rows below — an invoice never has to come from lines.
        </span>
      </div>

      {loadErr && <p className="inb__note" role="alert">{loadErr}</p>}

      {billed.length > 0 && (
        <div className="inb__billed">
          <p className="apg__secn">
            {billed.length} line{billed.length === 1 ? '' : 's'} for {monthLabel(`${month}-01`)} {billed.length === 1 ? 'is' : 'are'} already
            billed and are not loaded. Raising them again would charge them twice.
          </p>
          {/* NOT `.inb__r` — that grid's fourth column is 34px, sized for a
              remove button, and a Tag dropped into it overflows the card. */}
          {billed.map(b => (
            <div className="inb__r--done" key={b.line_id}>
              <span>{b.description || `Line ${String(b.line_id).slice(0, 8)}`}</span>
              {b.amount !== undefined && b.amount !== null && <b>{inr(b.amount)}</b>}
              <Tag color="var(--on-surface-3)">already on {b.invoice_number}</Tag>
            </div>
          ))}
        </div>
      )}

      <div className="adm-form">
        <Field label="Period start" htmlFor="inb-start">
          {p => <Input {...p} type="date" value={period.start} onChange={e => setPeriod(v => ({ ...v, start: e.target.value }))} />}
        </Field>
        <Field label="Period end" htmlFor="inb-end">
          {p => <Input {...p} type="date" value={period.end} onChange={e => setPeriod(v => ({ ...v, end: e.target.value }))} />}
        </Field>
        <Field label="Due date" htmlFor="inb-due">
          {p => <Input {...p} type="date" value={period.due} onChange={e => setPeriod(v => ({ ...v, due: e.target.value }))} />}
        </Field>
      </div>

      <div className="inb__hd" aria-hidden="true">
        <span>Description</span>
        <span>Qty</span>
        <span>Amount ₹</span>
        <span />
      </div>

      {rows.map((r, i) => {
        /* Charged ≠ what the line says. `lineTotal` folds qty in, so this is
           true of "× 2" as well as of a retyped amount — the two ways this form
           can bill something other than the standing term. */
        const amended = Boolean(r.line_id) && paise(lineTotal(r)) !== paise(r.line_amount);
        return (
          /* A loaded row carries its `line_id` through to `invoice_billing_lines`;
             a typed one carries nothing and is billed exactly once, here. The
             keyline is the only difference the operator can see, and it matters:
             deleting a loaded row leaves that line due next month. */
          <React.Fragment key={i}>
            <div className={`inb__r${r.line_id ? ' inb__r--line' : ''}`}>
              <Input
                aria-label={`Line ${i + 1} description${r.line_id ? ' (from a billing line)' : ''}`}
                value={r.description}
                placeholder="Subscription — Growth, Aug 2026"
                onChange={e => setRow(i, { description: e.target.value })}
              />
              <Input
                aria-label={`Line ${i + 1} quantity`}
                type="number" min="1" step="1" value={r.qty}
                onChange={e => setRow(i, { qty: e.target.value })}
              />
              {/* `step="any"`, not a sales increment. `step="100"` with `min="0"`
                  makes any amount that is not a multiple of 100 fail HTML
                  constraint validation — a ₹4,999 line would have been rejected by
                  the field, and no invoice amount is owed in round hundreds. */}
              <Input
                aria-label={`Line ${i + 1} amount`}
                type="number" min="0" step="any" value={r.amount}
                onChange={e => setRow(i, { amount: e.target.value })}
              />
              <button
                type="button" className="inb__x"
                aria-label={`Remove line ${i + 1}`}
                title={r.line_id
                  ? `Removes it from this invoice. The line is not billed and not marked billed — it stays due for ${monthLabel(`${month}-01`)} and loads again.`
                  : undefined}
                disabled={rows.length === 1}
                onClick={() => dropRow(i)}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            </div>
            {/* Not a refusal — this invoice may charge whatever was agreed, and
                what it charges is what gets booked against the line. It is the
                NEXT month the operator has not been told about. */}
            {amended && (
              <p className="obl__note">
                Line {i + 1} is billed here at {inr(lineTotal(r), { decimals: 2 })} and recorded
                as charged at that figure. The billing line itself still says{' '}
                {inr(r.line_amount ?? 0, { decimals: 2 })}
                {r.line_cadence === 'monthly' ? ' and bills that again next month' : ''} — amend
                it in the organisation’s billing lines if this is the new standing price rather
                than a figure for this invoice only.
              </p>
            )}
          </React.Fragment>
        );
      })}

      <div className="adm-actions">
        <Button variant="text" size="sm" onClick={addRow}>+ Add line</Button>
      </div>

      {/* The treatment is a decision, not an inference. It is pre-selected when
          both state codes are known and left unmade when they are not.
          A <label for> would point at a group rather than a control, so the
          group carries its own name and the caption is plain text. */}
      <div className="fld">
        <span className="fld__l">Place of supply</span>
        <div className="adm-seg" role="group" aria-label="GST treatment">
          {TREATMENTS.map(t => (
            <button
              key={t.id}
              type="button"
              aria-pressed={treatment === t.id}
              className={treatment === t.id ? 'on' : undefined}
              onClick={() => setTreatment(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* Honest about which end is missing. `GET /v1/admin/orgs` does not
            select `gstin` even though the column exists on
            staging.organisations, so today the customer end is the usual gap
            and the choice is manual whatever the supplier state is set to. */}
        <span className="fld__hint">{hint}</span>
      </div>

      <div className="inb__sum">
        <div className="inb__row"><span>Subtotal</span><b>{inr(bd.subtotal, { decimals: 2 })}</b></div>
        {bd.lines.map(l => (
          <div className="inb__row inb__gst" key={l.label}>
            <span>{l.label} @ {(l.rate * 100).toFixed(l.rate * 100 % 1 ? 1 : 0)}%</span>
            <b>{inr(l.amount, { decimals: 2 })}</b>
          </div>
        ))}
        <div className="inb__row inb__tot"><span>Total</span><b>{inr(bd.total, { decimals: 2 })}</b></div>
      </div>

      <p className="inb__note">
        The server recomputes GST as a single 18% figure into one <code>gst</code> column
        on <code>subscription_invoices</code>. The split above is what the document must
        show; storing it as separate CGST/SGST/IGST columns is a migration this screen
        cannot make. Tenant tax invoices (Ganit) already store the split in full.
      </p>

      <div className="adm-actions">
        <Button variant="fill" disabled={!ready || busy} onClick={submit}>
          {busy ? 'Creating…' : 'Create invoice'}
        </Button>
        {!org?.id && <span className="osc__none">Choose an organisation first.</span>}
      </div>
    </div>
  );
}
