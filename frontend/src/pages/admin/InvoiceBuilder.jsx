import React from 'react';
import { Button, Field, Input, Tag } from '../../components/ui';
import { api } from '../../lib/api';
import { inr } from '../../lib/inr';
import { gstBreakdown, defaultTreatment, supplierStateKnown, TREATMENTS } from './gst';
import { monthLabel, refusalMessage } from './BillingLineRow';
import { currentPeriod } from '../../lib/dates';

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
 *     into them.
 *   · `staging.invoice_billing_lines.amount` — 096 §2, "denormalised from the
 *     line AT ISSUE TIME", written by `billing_lines.record_billed`, which used
 *     to copy `l.amount` and never saw this form at all.
 *
 * Edit a loaded row and the document said ₹18,000 while the row that exists to
 * prove what was charged said ₹9,000. Setting its qty to 2 said it too, without
 * a rupee figure being typed at all — that half is closed at the source, two
 * sections down, because it was never only an arithmetic disagreement.
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
 *
 * ── A LOADED ROW HAS NO QUANTITY ────────────────────────────────────────────
 *
 * `org_billing_lines` HAS NO QUANTITY COLUMN. A line is an amount, a cadence and
 * a span; "× 2" is not a term anybody agreed and there is nowhere to record one.
 * What it MEANT, every time, was two months — and two months is the one thing
 * this form cannot deliver, because `record_billed` books a line against exactly
 * ONE period: `create_invoice` derives it from `period_start`, and says in its
 * own words that a multi-month invoice books its lines against the FIRST month.
 *
 * So a monthly line billed × 2 in August charges the client for two months and
 * discharges one. July is still not billed, the July preview offers it again,
 * neither document says the client has already paid for that month, and
 * `uq_ibl_line_period` — the index the whole join table exists for — never sees
 * a second row to refuse. The qty box on a loaded row was an affordance for the
 * exact double charge `invoice_billing_lines` was built to prevent.
 *
 * A loaded row's quantity is therefore 1, shown rather than typed, and a missed
 * month is caught up with its own invoice for that month — which is also the
 * only shape `record_billed` will book. A TYPED row keeps its qty: it is a
 * free-text document line, it discharges nothing, and it is billed exactly once,
 * here. The amount of a loaded row stays editable, because charging something
 * other than the standing term is a real thing to do and is now recorded as what
 * was charged.
 *
 * ── WHAT THE SERVER WORKED OUT AND THIS SCREEN USED TO THROW AWAY ───────────
 *
 * `lines_due_in_period` answers with THREE lists and this form read one. The
 * other two are both answers to "why is that row not here?", and the cost of not
 * rendering them is the same each time: an operator who cannot see why a line is
 * missing types it back in by hand, which is the double charge arriving through
 * the keyboard instead of through the query.
 *
 *   · `already_billed` — on an invoice already, with its number. Rendered since
 *     the block shipped.
 *   · `superseded`     — standing this month and NOT due, because an earlier
 *     line of the same kind covers the month. A support plan stopped and
 *     restarted shows TWO rows in the billing block and puts ONE on the invoice.
 *     Each entry names the row that is carrying the month, what that row costs
 *     and the month it stops, so this screen can say when the missing one
 *     starts. It is rendered beside `already_billed` and reads the same way.
 *
 * ── AND THE ONE THING ONLY THE CREATE RESPONSE KNOWS: `payment_note` ────────
 *
 * `POST /admin/invoices` answers with `payment_note` when the document it just
 * wrote carries no UPI details — no organisation is flagged as the platform
 * payee, or that org has no UPI address, or 096 has not landed. UPI on the
 * invoice is the WHOLE collection mechanism; there is no payment gateway and
 * there will not be one, so that sentence is "this invoice cannot be paid" and
 * it is said at the one moment somebody can still act on it. It is computed at
 * issue time and returned nowhere else, so `submit` awaits `onCreate` and renders
 * what came back.
 *
 * IT SHOWS ONLY IF THE CALLER HANDS THE RESPONSE BACK. `AdminBillingPage`'s
 * `createInvoice` returns nothing today, and its `guard()` wrapper drops a return
 * value of its own, so on that page the note stays hidden until both pass the
 * body through. Both shapes are accepted here — the body, or an axios response
 * with the body on `.data` — so whichever way it is handed over, it renders.
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
  // A loaded row has no quantity — see the docblock. Settled here and not only
  // in the markup, so the figure the subtotal adds up, the figure the amended
  // note quotes and the figure that is posted cannot come apart if a qty ever
  // survives on a row that is later filled from a line.
  const q = row.line_id ? 1 : (row.qty === '' ? 1 : num(row.qty));
  return Math.round(num(row.amount) * q * 100) / 100;
}

/* The billing period is `lib/dates.currentPeriod` — IST, matching
   `credits.current_period()`. This file declared its own on a UTC clock,
   with a note explaining that UTC was what the server used. It was, until
   2026-09-04; both sides read IST now, and a form that picks its own clock
   is the bug that note was written to prevent. */

/** The last day of `YYYY-MM`, as `YYYY-MM-DD`. */
function monthEnd(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The first of the month AFTER a `YYYY-MM-DD` period date — the month a
 *  superseded line starts being due in. Built as a string and handed to
 *  `monthLabel` rather than formatted here, so it cannot come out in a second
 *  dialect from every other month on this screen. */
function nextMonthStart(iso) {
  const [y, m] = String(iso || '').split('-').map(Number);
  if (!y || !m) return '';
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** Which row is carrying the month, named the way `_not_due_detail` names it: a
 *  fee stopped and restarted carries the SAME description on both rows, and
 *  "'Platform fee' is covered by 'Platform fee'" tells an operator nothing about
 *  which of the two they are reading. */
function coveringName(s) {
  return s.covered_by_description && s.covered_by_description !== s.description
    ? `“${s.covered_by_description}”`
    : `the earlier ${s.kind} line`;
}

export default function InvoiceBuilder({ org, busy, onCreate }) {
  const [period, setPeriod] = React.useState({ start: '', end: '', due: '' });
  const [rows, setRows] = React.useState([blank()]);
  const [treatment, setTreatment] = React.useState(() => defaultTreatment(org?.gstin));
  const [month, setMonth] = React.useState(currentPeriod);
  const [loading, setLoading] = React.useState(false);
  const [loadErr, setLoadErr] = React.useState('');
  const [billed, setBilled] = React.useState([]);
  const [superseded, setSuperseded] = React.useState([]);
  // The month the rows and the two blocks below actually describe. NOT `month`:
  // the picker keeps moving after a load, and a block that re-labels itself to a
  // month it never described is a worse answer than an unlabelled one.
  const [loaded, setLoaded] = React.useState('');
  const [payNote, setPayNote] = React.useState('');

  // A new org means a new tax treatment. Without this the operator's last
  // choice silently carries onto the next company they bill.
  React.useEffect(() => { setTreatment(defaultTreatment(org?.gstin)); }, [org?.id, org?.gstin]);

  // …and a new org means somebody else's lines. Clearing is not politeness, it
  // is the difference between two invoices and one wrong one. `payNote` goes
  // with them: it names an invoice raised for the org being navigated away from.
  React.useEffect(() => {
    setBilled([]); setSuperseded([]); setLoaded(''); setLoadErr(''); setPayNote('');
  }, [org?.id]);

  const loadLines = async () => {
    if (!org?.id) return;
    setLoading(true);
    setLoadErr('');
    try {
      const res = await api.get(`/v1/billing/orgs/${org.id}/invoice-preview`, { params: { period: month } });
      const due = res.data?.lines || [];
      setBilled(res.data?.already_billed || []);
      // Why a row is missing, in the two shapes the server distinguishes. Both
      // blocks are read as "and here is what I did NOT load", so both are
      // emptied together and refilled together.
      setSuperseded(res.data?.superseded || []);
      setLoaded(month);
      // `signed_amount`, NOT `amount`. A credit line stores its magnitude —
      // `org_billing_lines.amount` is CHECK (amount >= 0) — and the server
      // decides the sign from the kind in one place (`_signed_amount`). Loading
      // the magnitude would put a ₹4,000 refund on the invoice as a ₹4,000
      // charge, which is the two-debit bug wearing the fix's clothes. Falls back
      // to `amount` so a server that has not deployed this yet still loads.
      setRows(due.length
        ? due.map(l => ({
          description: l.description || '', qty: '1',
          amount: String(l.signed_amount ?? l.amount ?? ''), line_id: l.line_id,
          line_amount: Number(l.signed_amount ?? l.amount ?? 0), line_cadence: l.cadence,
          line_kind: l.kind,
        }))
        : [blank()]);
      // The period the lines are due in, so the operator is not typing a date
      // the lines already state. The DUE date stays theirs — it is a payment
      // term, not a fact about the month.
      setPeriod(p => ({ ...p, start: `${month}-01`, end: monthEnd(month) }));
    } catch (e) {
      // The blocks describe a load that did not happen. Left standing, August's
      // "already billed" sits under a picker that now says September and answers
      // a question nobody asked.
      setBilled([]); setSuperseded([]); setLoaded('');
      setLoadErr(refusalMessage(e, 'Could not load this month’s billing lines.'));
    } finally { setLoading(false); }
  };

  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows(rs => [...rs, blank()]);
  const dropRow = i => setRows(rs => (rs.length === 1 ? rs : rs.filter((_, j) => j !== i)));

  const subtotal = rows.reduce((s, r) => s + lineTotal(r), 0);
  const bd = gstBreakdown(subtotal, treatment);

  /** The month the loaded rows and the two "not loaded" blocks are about. Every
   *  sentence below that names a month names this one; only the Load button
   *  names the picker, because the picker is the month about to be asked for. */
  const loadedLabel = loaded ? monthLabel(`${loaded}-01`) : '—';
  const fromLines = rows.some(r => r.line_id);

  const hint = !supplierStateKnown()
    ? 'Supplier state is not configured (VITE_AEKAM_STATE_CODE), so this cannot be derived — choose it.'
    : !org?.gstin
      ? 'This organisation has no GSTIN in the console payload, so the place of supply cannot be derived — choose it.'
      : 'Derived from the customer GSTIN against the supplier state. Override if the place of supply differs.';

  /** A row somebody typed and finished: a description and money on it.
   *
   *  `!== 0`, not `> 0`. A credit is money on the row — it is the row that
   *  gives money back — and requiring a positive figure made an invoice whose
   *  only line is a ₹4,000 credit impossible to raise, which is exactly the
   *  document a mid-cycle downgrade needs. A ₹0 row is still unfinished. */
  const payable = r => Boolean(r.description.trim()) && num(r.amount) !== 0;

  /* At least one row worth sending. Deliberately NOT satisfied by loaded rows
     alone summing to zero: a ₹0 line rides along on an invoice, but it is not a
     reason to raise one. */
  const ready = Boolean(
    org?.id && period.start && period.end && period.due && rows.some(payable),
  );

  const submit = async () => {
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
    const created = await onCreate?.({
      period_start: period.start,
      period_end: period.end,
      due_date: period.due,
      // `amount` is the whole line total, because the column the server sums is
      // `item.amount` and it is also the figure it books against the billing
      // line. `qty` and `unit_amount` ride along for the document; on a loaded
      // row the quantity is 1 by construction — see the docblock.
      line_items: kept.map(r => ({
        description: r.description.trim(),
        amount: lineTotal(r),
        qty: r.line_id ? 1 : (r.qty === '' ? 1 : num(r.qty)),
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
    /* WHETHER OR NOT IT WORKED, exactly as before this became awaitable. The
       caller reports its own failures and resolves the same way either way, so
       "clear only on success" is not a state this form can tell apart — and of
       the two ways to be wrong, leaving a raised invoice's rows on screen for
       somebody to press Create over again is the one that costs money. Loaded
       rows come back from "Load lines"; typed ones do not, which is the price. */
    setRows([blank()]);
    setPeriod({ start: '', end: '', due: '' });
    setBilled([]);
    setSuperseded([]);
    setLoaded('');
    // The one thing the create response says that nothing else can. Blank when
    // the invoice is payable, and blank when the caller kept the body to itself.
    setPayNote(created?.payment_note || created?.data?.payment_note || '');
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
            {billed.length} line{billed.length === 1 ? '' : 's'} for {loadedLabel} {billed.length === 1 ? 'is' : 'are'} already
            billed and are not loaded. Raising them again would charge them twice.
          </p>
          {/* NOT `.inb__r` — that grid's fourth column is 34px, sized for a
              remove button, and a Tag dropped into it overflows the card. */}
          {billed.map((b, i) => (
            <div className="inb__r--done" key={b.line_id}>
              {/* An unnamed line is numbered by its POSITION, not by eight characters
                  of its uuid. The reader is looking at an ordered list and can
                  count; the uuid told them nothing and matched nothing they
                  could see elsewhere. */}
              <span>{b.description || `Line ${i + 1}`}</span>
              {b.amount !== undefined && b.amount !== null && <b>{inr(b.amount)}</b>}
              <Tag color="var(--on-surface-3)">already on {b.invoice_number}</Tag>
            </div>
          ))}
        </div>
      )}

      {/* The second reason a row is missing, in the same shape as the first,
          because to an operator they are one question. `already_billed` says
          "this month is settled"; this says "this month belongs to another row".
          Both end the same way if nobody says them out loud — the fee gets typed
          back in by hand, and the hand-typed row carries no line id, so nothing
          in the no-double-charge table ever sees it. */}
      {superseded.length > 0 && (
        <div className="inb__billed">
          <p className="apg__secn">
            {superseded.length} line{superseded.length === 1 ? '' : 's'} stand{superseded.length === 1 ? 's' : ''} in {loadedLabel} and
            {superseded.length === 1 ? ' is' : ' are'} not due in it — an earlier line of the same
            kind already covers the month, so only that one is loaded.
          </p>
          {superseded.map(s => {
            /* The last month the covering line is billed for. NULL means it is
               still running, and this row is not due at all while that holds —
               there is no month to name and saying one would be a promise. */
            const through = s.covered_by_period_end ? monthLabel(s.covered_by_period_end) : '';
            return (
              <div className="inb__r--done" key={s.line_id}>
                <span>{s.description || `Line ${i + 1}`}</span>
                <b>{inr(s.amount)}</b>
                <Tag color="var(--on-surface-3)">not due in {loadedLabel}</Tag>
                <span>
                  {coveringName(s)} at {inr(s.covered_by_amount)} carries {loadedLabel}
                  {/* Only when it says something the sentence has not: a line
                      that stops in the month being billed would otherwise read
                      "carries Aug 2026 and is billed through Aug 2026". */}
                  {through && through !== loadedLabel ? ` and is billed through ${through}` : ''}
                  {through
                    ? `, so this one starts ${monthLabel(nextMonthStart(s.covered_by_period_end))}.`
                    : ' and is still running, so this one is not due until that line is ended.'}
                </span>
              </div>
            );
          })}
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
        /* Charged ≠ what the line says. One way in now that the quantity is
           gone: somebody retyped the amount. That is a real thing to do and is
           booked as what was charged; it is only the NEXT month it says nothing
           about, which is what the note below is for. */
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
              {r.line_id ? (
                /* Shown, not disabled: a greyed box invites the click that does
                   nothing, which is the trade `.obl__mirror` was written for on
                   the mirrored monthly price. A billing line has no quantity to
                   set — the docblock has the whole argument, and the note under
                   the rows says it where the operator is looking. */
                <span className="obl__mirror">
                  1
                  <span className="k-sr-only"> — quantity, fixed on a row loaded from a billing line</span>
                </span>
              ) : (
                <Input
                  aria-label={`Line ${i + 1} quantity`}
                  type="number" min="1" step="1" value={r.qty}
                  onChange={e => setRow(i, { qty: e.target.value })}
                />
              )}
              {/* `step="any"`, not a sales increment. `step="100"` with `min="0"`
                  makes any amount that is not a multiple of 100 fail HTML
                  constraint validation — a ₹4,999 line would have been rejected by
                  the field, and no invoice amount is owed in round hundreds.

                  AND NO `min` AT ALL, for the same class of reason: a credit
                  loads as a negative figure, and `min="0"` would have made the
                  browser refuse the form on a row the server had just sent. The
                  floor that matters is on the billing line — `amount >= 0` with
                  the sign carried by the kind — not on what a document may
                  charge. */}
              <Input
                aria-label={`Line ${i + 1} amount`}
                type="number" step="any" value={r.amount}
                onChange={e => setRow(i, { amount: e.target.value })}
              />
              <button
                type="button" className="inb__x"
                aria-label={`Remove line ${i + 1}`}
                title={r.line_id
                  ? `Removes it from this invoice. The line is not billed and not marked billed — it stays due for ${loadedLabel} and loads again.`
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

      {/* Said once, beside the rows it is about, and only when there is a loaded
          row to be about. The screen has to state what it does with a quantity,
          because the control it removed is the one an operator would have
          reached for to bill a month they missed. */}
      {fromLines && (
        <p className="obl__note">
          A loaded line has no quantity. It is an agreed amount per period, and this invoice
          marks it billed for one month, so “× 2” would charge two months and discharge one —
          the other stays due and loads again. Bill a missed month on its own invoice for that
          month. The amount stays editable, and whatever it charges is what gets recorded
          against the line.
        </p>
      )}

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

      {/* The server's sentence, rendered as it was written. It is about the
          document that has just been raised — an invoice with no UPI details on
          it, which with no payment gateway anywhere in this product means an
          invoice nobody can pay — and it names what to fix. Left standing until
          the next invoice or the next organisation, because it describes
          something that is still true. */}
      {payNote && <p className="inb__note" role="alert">{payNote}</p>}
    </div>
  );
}
